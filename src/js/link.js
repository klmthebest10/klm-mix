/* KLM Mix - koneksi ke server lokal: KLMCAM (WebRTC latensi rendah), tally, remote HP, relay API */
'use strict';
(function (KM) {
  const S = KM.state;
  const L = KM.link = { ws: null, id: null, peers: new Map(), connected: false, ips: [], ports: {} };

  function send(o) { if (L.ws && L.ws.readyState === 1) L.ws.send(JSON.stringify(o)); }
  L.send = send;

  L.connect = function () {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host + '/ws');
    L.ws = ws;
    ws.onopen = () => { L.connected = true; send({ t: 'hello', role: 'mixer', name: 'KLM Mix' }); setTimeout(() => pushState(true), 300); KM.changed('link'); };
    ws.onclose = () => { L.connected = false; KM.changed('link'); setTimeout(L.connect, 1500); };
    ws.onerror = () => {};
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onMsg(m); };
    fetch('/info').then((r) => r.json()).then((j) => { L.ips = j.ips || []; L.ports = j.ports || {}; KM.changed('link'); }).catch(() => {});
  };

  async function onMsg(m) {
    switch (m.t) {
      case 'welcome': L.id = m.id; L.ips = m.ips || L.ips; break;
      case 'peer-join': {
        const p = { id: m.id, role: m.role, name: m.name, slot: m.slot, ip: m.ip, meta: m.meta || {} };
        L.peers.set(m.id, p);
        if (m.role === 'camera') {
          KM.toast('📱 KLMCAM terhubung: ' + (m.name || 'HP') + ' (slot ' + m.slot + ')', 'ok');
          if (KM.settings.autoAddCam && !S.inputs.find((i) => i.type === 'klmcam' && +i.opts.slot === +m.slot)) {
            KM.inputs.create('klmcam', { title: 'KLMCAM ' + m.slot + ' - ' + (m.name || 'HP'), opts: { slot: +m.slot } });
          }
          L.bindCams();
        } else if (m.role === 'guest') {
          KM.toast('📞 Tamu KLM Call masuk: ' + (m.name || 'Tamu') + ' (slot ' + m.slot + ')', 'ok');
          if (!S.inputs.find((i) => i.type === 'call' && +i.opts.slot === +m.slot)) KM.inputs.create('call', { title: 'Call ' + m.slot + ' - ' + (m.name || 'Tamu'), opts: { slot: +m.slot } });
          L.bindCams();
        } else if (m.role === 'remote') { KM.toast('🎛️ Remote terhubung: ' + (m.name || m.ip)); pushState(true); }
        KM.changed('peers');
        break;
      }
      case 'peer-leave': {
        const p = L.peers.get(m.id); L.peers.delete(m.id);
        if (p && (p.role === 'camera' || p.role === 'guest')) {
          if (p.pc) { try { p.pc.close(); } catch (e) {} }
          const inp = S.inputs.find((i) => i.rt.camId === m.id);
          if (inp) { inp.rt.camId = null; KM.inputTypes[inp.type].setStream(inp, null); }
          KM.toast((p.role === 'guest' ? '📞 Tamu keluar: ' : '📱 KLMCAM terputus: ') + (p.name || ''), 'warn');
        }
        KM.changed('peers');
        break;
      }
      case 'signal': await onSignal(m); break;
      case 'cam-info': { const p = L.peers.get(m.from); if (p) { p.info = m.info; KM.changed('peers'); } break; }
      case 'fn': {
        let ok = false, msg = '';
        try { const r = await KM.api.exec(m.fn, m.params || {}); ok = r !== false; if (typeof r === 'string') msg = r; }
        catch (e) { msg = e.message; }
        send({ t: 'fn-res', to: m.from, reqId: m.reqId, ok, msg });
        break;
      }
      case 'xml': send({ t: 'xml-res', to: m.from, reqId: m.reqId, ok: true, xml: KM.api.xml() }); break;
      case 'get-state': pushState(true, m.from); break;
      case 'sub': { const p = L.peers.get(m.from); if (p) p.sub = { mon: !!m.mon, inputs: !!m.inputs, rate: m.rate || 400 }; break; }
      case 'snap-input': sendInputThumbs(m.from); break;
      case 'utc-status': KM.utc && KM.utc.onStatus(m.status); break;
      case 'score-status': KM.score && KM.score.onStatus(m.status); break;
      case 'utc-shot': { // gambar untuk switcher panel UTC (dibuka dari HP/peramban)
        let data = '';
        try {
          const inp = m.id ? KM.getInput(m.id) : null;
          const src = inp ? inp.rt.thumb : (m.ch === 'pgm' ? KM.engine.prog : KM.engine.prev);
          if (src && src.width) { const w = Math.min(m.w || 854, src.width * 2), h = Math.round(w * src.height / src.width); data = shot(src, w, h, m.q || 0.65).split(',')[1]; }
        } catch (e) {}
        send({ t: 'utc-res', reqId: m.reqId, ok: !!data, data });
        break;
      }
    }
  }

  // ---------- KLMCAM / WebRTC ----------
  L.bindCams = function () {
    for (const inp of S.inputs.filter((i) => i.type === 'klmcam' || i.type === 'call')) {
      if (inp.rt.camId && L.peers.has(inp.rt.camId)) continue;
      const role = inp.type === 'call' ? 'guest' : 'camera';
      const peer = [...L.peers.values()].find((p) => p.role === role && +p.slot === +inp.opts.slot && !S.inputs.some((o) => o.rt.camId === p.id));
      if (peer) startCam(inp, peer);
    }
  };
  function qualityOf(inp) {
    const q = inp.opts.quality || '1080p30';
    const m = /(\d+)p(\d+)/.exec(q) || [0, 1080, 30];
    const h = +m[1]; return { height: h, width: Math.round(h * 16 / 9), fps: +m[2], bitrate: inp.opts.bitrate || 6000, audio: inp.opts.audio !== false };
  }
  function startCam(inp, peer) {
    inp.rt.camId = peer.id;
    if (peer.pc) { try { peer.pc.close(); } catch (e) {} }
    const pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    peer.pc = pc; peer.inputId = inp.id;
    pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'signal', to: peer.id, data: { ice: e.candidate } }); };
    const ms = new MediaStream();
    pc.ontrack = (e) => {
      try { e.receiver.playoutDelayHint = 0; } catch (x) {}
      try { e.receiver.jitterBufferTarget = 0; } catch (x) {}
      ms.addTrack(e.track);
      clearTimeout(inp.rt.setT);
      inp.rt.setT = setTimeout(() => KM.inputTypes[inp.type].setStream(inp, ms), 50);
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState; KM.changed('peers');
      if (pc.connectionState === 'failed') { KM.toast('KLMCAM ' + inp.opts.slot + ': koneksi gagal, mencoba ulang…', 'warn'); setTimeout(() => { if (L.peers.has(peer.id)) startCam(inp, peer); }, 1500); }
    };
    // HP yang membuat offer
    send({ t: inp.type === 'call' ? 'call-start' : 'cam-start', to: peer.id, settings: qualityOf(inp) });
    sendTally();
    KM.changed('peers');
  }
  L.restartCam = (inp) => { const p = L.peers.get(inp.rt.camId); if (p) startCam(inp, p); else L.bindCams(); };

  async function onSignal(m) {
    const p = L.peers.get(m.from); if (!p || !p.pc) return;
    const d = m.data;
    try {
      if (d.sdp) {
        await p.pc.setRemoteDescription(d.sdp);
        const inp = KM.getInput(p.inputId);
        if (d.sdp.type === 'offer' && inp && inp.type === 'call') attachReturn(p.pc, inp);
        if (d.sdp.type === 'offer') {
          const ans = await p.pc.createAnswer();
          await p.pc.setLocalDescription(ans);
          send({ t: 'signal', to: p.id, data: { sdp: p.pc.localDescription } });
        }
      } else if (d.ice) await p.pc.addIceCandidate(d.ice);
    } catch (e) { console.warn('signal', e); }
  }

  /** KLM Call: kirim balik program (return feed) + audio mix-minus ke tamu */
  function attachReturn(pc, inp) {
    const rv = KM.engine.programStream().getVideoTracks()[0];
    const ra = KM.audio.mixMinus(inp).getAudioTracks()[0];
    pc.getTransceivers().forEach((t) => {
      const kind = t.receiver.track && t.receiver.track.kind;
      const tr = kind === 'video' ? rv : kind === 'audio' ? ra : null;
      if (!tr) return;
      try { t.direction = 'sendrecv'; t.sender.replaceTrack(tr); } catch (e) {}
      if (kind === 'video') setTimeout(() => {
        try {
          const prm = t.sender.getParameters(); if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
          prm.encodings[0].maxBitrate = (KM.settings.callReturnKbps || 1500) * 1000;
          prm.encodings[0].scaleResolutionDownBy = Math.max(1, KM.settings.height / 540);
          prm.encodings[0].maxFramerate = 25;
          t.sender.setParameters(prm);
        } catch (e) {}
      }, 500);
    });
  }

  /** kirim perintah kontrol kamera ke HP (zoom, torch, ganti kamera, kualitas, fokus) */
  L.camControl = function (inp, cmd, value) {
    inp = KM.getInput(inp); if (!inp || !inp.rt.camId) return false;
    if (cmd === 'quality') { inp.opts.quality = value; send({ t: 'cam-ctl', to: inp.rt.camId, cmd: 'settings', value: qualityOf(inp) }); return true; }
    send({ t: 'cam-ctl', to: inp.rt.camId, cmd, value }); return true;
  };

  // ---------- tally ke HP & TCP ----------
  let lastTally = '';
  function sendTally() {
    for (const inp of S.inputs) {
      if ((inp.type !== 'klmcam' && inp.type !== 'call') || !inp.rt.camId) continue;
      const st = KM.engine.tallyOf(inp);
      if (inp.rt.tallySent !== st) { inp.rt.tallySent = st; send({ t: 'tally', to: inp.rt.camId, state: st }); }
    }
    const str = S.inputs.map((i) => { const t = KM.engine.tallyOf(i); return t === 'program' ? '1' : t === 'preview' ? '2' : '0'; }).join('');
    if (str !== lastTally) { lastTally = str; send({ t: 'tally-str', str }); }
  }
  L.sendTally = sendTally;
  KM.on('tally', sendTally);
  KM.on('change', (w) => { if (w === 'preview' || w === 'program' || w === 'inputs') { S.inputs.forEach((i) => { i.rt.tallySent = null; }); sendTally(); } });

  // ---------- state & thumbnail untuk remote ----------
  function hasRemote() { for (const p of L.peers.values()) if (p.role === 'remote') return true; return false; }
  function snapState() {
    const A = KM.audio;
    return {
      inputs: S.inputs.map((i, n) => ({
        id: i.id, num: n + 1, title: i.title, type: i.type, tally: KM.engine.tallyOf(i),
        playable: KM.inputs.isPlayable(i), playing: KM.inputs.isPlaying(i), loop: !!i.loop,
        audio: KM.inputs.hasAudio(i) ? { vol: i.audio.vol, mute: i.audio.mute, auto: i.audio.auto } : null,
        title_: i.type === 'title' ? { template: i.opts.template, theme: i.opts.theme, fields: KM.titles.fields(i), defs: KM.titles.defs(i), listLen: i.opts.list.length, listIdx: i.opts.listIdx } : null,
        cam: i.type === 'klmcam' ? { slot: i.opts.slot, online: !!i.rt.camId, quality: i.opts.quality } : null
      })),
      previewId: S.previewId, programId: S.programId,
      overlays: S.overlays.map((o) => ({ inputId: o.inputId, on: o.phase === 'in' || o.phase === 'on' })),
      ftb: S.ftb.on, rec: S.recording, stream: S.streaming, mc: S.multicorder, srt: S.srt ? KM.rec.srtStatus : '',
      transitions: KM.settings.transitions, tbar: S.tbar,
      master: A.master ? { vol: A.master.vol, mute: A.master.muted } : null,
      replay: { enabled: KM.replay.enabled, events: KM.replay.events.map((e) => ({ id: e.id, name: e.name, sec: e.sec })), playing: KM.replay.playing, speed: KM.replay.speed },
      playlist: { running: KM.playlist.running, idx: KM.playlist.idx, len: KM.playlist.items.length },
      utc: KM.utc && KM.utc.status ? { has: KM.utc.has(), onAir: KM.utc.onAir(), eventName: KM.utc.status.eventName, visible: KM.utc.status.visible, oc: KM.utc.status.oc ? KM.utc.status.oc.kind : null } : { has: !!(KM.utc && KM.utc.has()) },
      score: KM.score ? { has: KM.score.has(), onAir: KM.score.onAir() } : null,
      fps: KM.settings.fps, res: KM.settings.width + 'x' + KM.settings.height
    };
  }
  L.snapState = snapState;
  function pushState(force, to) {
    // selalu ke server: switcher panel UTC KLM Acara memakai daftar input & preview/program KLM Mix
    if (!force && !hasRemote() && Date.now() - (pushState.t || 0) < 250) { clearTimeout(pushState.tm); pushState.tm = setTimeout(() => pushState(false), 260); return; }
    pushState.t = Date.now();
    const msg = { t: 'state', state: snapState() };
    if (to) msg.to = to; else msg.bcast = 'remote';
    send(msg);
  }
  KM.on('change-debounced', () => pushState(false));
  KM.on('tally', () => pushState(false));

  const tc = document.createElement('canvas'); tc.width = 384; tc.height = 216; const tx = tc.getContext('2d');
  function shot(src, w, h, q) { tc.width = w; tc.height = h; tx.drawImage(src, 0, 0, w, h); return tc.toDataURL('image/jpeg', q || 0.6); }
  // hanya kirim gambar ke HP yang sedang menampilkannya (hemat data, baterai & CPU)
  const wants = (k) => [...L.peers.values()].filter((p) => p.role === 'remote' && (!p.sub || p.sub[k]));
  let monT = 0;
  setInterval(() => {
    const list = wants('mon'); if (!list.length || !KM.engine.prog) return;
    const now = Date.now(), rate = Math.min(...list.map((p) => (p.sub && p.sub.rate) || 400));
    if (now - monT < rate) return; monT = now;
    const msg = { t: 'thumbs', preview: shot(KM.engine.prev, 384, 216, 0.55), program: shot(KM.engine.prog, 384, 216, 0.55) };
    list.forEach((p) => send(Object.assign({ to: p.id }, msg)));
  }, 200);
  function sendInputThumbs(to) {
    const thumbs = {};
    S.inputs.forEach((i) => { if (i.rt.thumb) thumbs[i.id] = shot(i.rt.thumb, 192, 108, 0.5); });
    send({ t: 'input-thumbs', to, thumbs });
  }
  setInterval(() => {
    const list = wants('inputs'); if (!list.length) return;
    const thumbs = {};
    S.inputs.forEach((i) => { if (i.rt.thumb) thumbs[i.id] = shot(i.rt.thumb, 192, 108, 0.5); });
    list.forEach((p) => send({ t: 'input-thumbs', to: p.id, thumbs }));
  }, 2500);
})(window.KM);
