/* KLM → Layar TV Masjid: Program dikirim langsung lewat WebRTC (WHEP di server lokal KLM, /klm/whep).
   Tanpa SRT / ffmpeg: gateway Layar TV di PC ini (MediaMTX) menarik whep://127.0.0.1:8620/klm/whep dan meneruskannya
   ke TV (juga TV di jaringan lain lewat internet); TV di Wi-Fi yang sama bisa menarik langsung dari KLM. */
'use strict';
(function (KM) {
  const T = KM.tvout = { peers: new Map(), seq: 0 };
  const MAX = 6; // penarik bersamaan (gateway + TV langsung) — tiap penarik satu encoder WebRTC
  const on = () => KM.settings.tvOut !== false;
  T.on = on;
  T.count = () => [...T.peers.values()].filter((p) => p.pc.connectionState === 'connected').length;
  T.list = () => [...T.peers.values()].filter((p) => p.pc.connectionState === 'connected').map((p) => p.ip);

  function pushState() { if (KM.link && KM.link.send) KM.link.send({ t: 'tv-state', on: on() }); }
  T.pushState = pushState;
  T.set = function (v) {
    KM.settings.tvOut = !!v; KM.saveSettings(); pushState();
    if (!v) for (const id of [...T.peers.keys()]) close(id);
    KM.changed('tvout');
  };

  // H.264 diutamakan: didukung HLS gateway (TV beda jaringan) & dekoder perangkat keras Android box
  function preferH264(t) {
    try {
      const caps = (RTCRtpReceiver.getCapabilities && RTCRtpReceiver.getCapabilities('video')) || RTCRtpSender.getCapabilities('video');
      const f = (c) => c.sdpFmtpLine || '';
      const rank = (c) => /h264/i.test(c.mimeType) ? (/packetization-mode=1/.test(f(c)) ? (/profile-level-id=42e01f/i.test(f(c)) ? 0 : 1) : 2) : /rtx|red|ulpfec|flexfec/i.test(c.mimeType) ? 9 : 5;
      t.setCodecPreferences(caps.codecs.slice().sort((a, b) => rank(a) - rank(b)));
    } catch (e) {}
  }
  const gathered = (pc, ms) => new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, ms);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });

  function close(id) {
    const p = T.peers.get(id); if (!p) return;
    T.peers.delete(id); clearTimeout(p.dc);
    try { p.pc.close(); } catch (e) {}
    KM.changed('tvout');
  }
  T.close = close;

  T.offer = async function (m) {
    const reply = (o) => KM.link.send(Object.assign({ t: 'tv-res', to: m.from, reqId: m.reqId }, o));
    if (!on()) return reply({ ok: false, msg: 'Layar TV dimatikan di KLM' });
    if (T.peers.size >= MAX) { // buang yang sudah putus dulu
      for (const [id, p] of T.peers) if (p.pc.connectionState !== 'connected') close(id);
      if (T.peers.size >= MAX) return reply({ ok: false, full: true, msg: 'Penarik Layar TV penuh (' + MAX + ')' });
    }
    const id = 'tv' + (++T.seq) + Math.random().toString(36).slice(2, 7);
    let pc;
    try {
      pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' }); // jaringan lokal: kandidat host cukup
      await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      const v = KM.engine.programStream().getVideoTracks()[0];
      let a = null; try { a = KM.audio.streamOf('M').getAudioTracks()[0] || null; } catch (e) {}
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver && t.receiver.track && t.receiver.track.kind;
        const tr = kind === 'video' ? v : kind === 'audio' ? a : null;
        if (!tr) { try { t.direction = 'inactive'; } catch (e) {} continue; }
        t.direction = 'sendonly';
        await t.sender.replaceTrack(tr);
        if (kind === 'video') preferH264(t);
      }
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc, 2500);
      const p = { id, pc, ip: m.ip || '', at: Date.now(), dc: 0 };
      T.peers.set(id, p);
      pc.addEventListener('connectionstatechange', () => {
        const st = pc.connectionState;
        clearTimeout(p.dc);
        if (st === 'failed' || st === 'closed') close(id);
        else if (st === 'disconnected') p.dc = setTimeout(() => close(id), 8000);
        else if (st === 'connected') tune(pc);
        KM.changed('tvout');
      });
      setTimeout(() => { if (T.peers.has(id) && pc.connectionState !== 'connected') close(id); }, 20000); // tak pernah tersambung
      reply({ ok: true, id, sdp: pc.localDescription.sdp });
    } catch (e) {
      try { pc && pc.close(); } catch (x) {}
      reply({ ok: false, msg: 'Program KLM gagal dikirim: ' + (e.message || e) });
    }
  };

  // kualitas untuk TV: resolusi program dipertahankan, bitrate bawaan 4 Mbps (Pengaturan → SRT / TV)
  function tune(pc) {
    for (const s of pc.getSenders()) {
      if (!s.track || s.track.kind !== 'video') continue;
      try {
        const prm = s.getParameters(); if (!prm.encodings || !prm.encodings.length) prm.encodings = [{}];
        prm.encodings[0].maxBitrate = (+KM.settings.tvKbps || 4000) * 1000;
        prm.encodings[0].maxFramerate = +KM.settings.fps || 30;
        prm.degradationPreference = 'maintain-resolution';
        s.setParameters(prm).catch(() => {});
      } catch (e) {}
    }
  }

  // dulu Layar TV memakai SRT publish:klm → kini tidak perlu (SRT tetap bisa dipakai untuk tujuan lain)
  function migrate() {
    const c = KM.settings.srt;
    if (c && c.streamid === 'publish:klm' && c.autoStart) { c.autoStart = false; KM.saveSettings(); }
  }

  KM.on('change', (w) => { if (w === 'link' && KM.link && KM.link.connected) pushState(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', migrate); else setTimeout(migrate, 0);
})(window.KM);
