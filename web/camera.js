/* KLMCAM - kamera HP → KLM lewat WebRTC (LAN, latensi rendah, H.264, tally) */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const video = $('local');
  const cfg = {
    slot: KMP.get('slot', 1), name: KMP.get('camname', KMP.deviceName()), facing: KMP.get('facing', 'environment'),
    quality: KMP.get('quality', '1080p30'), ns: KMP.get('ns', false), mirror: KMP.get('mirror', true), mic: true
  };
  // mode internet: kode ruang dari tautan (#r=KODE&s=slot) atau dari pengaturan
  const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (hp.get('r')) { KMP.set('room', hp.get('r').toUpperCase()); if (+hp.get('s')) { cfg.slot = +hp.get('s'); KMP.set('slot', cfg.slot); } }
  cfg.room = String(KMP.get('room', '') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const myId = KMP.get('camid', '') || (() => { const v = Math.random().toString(36).slice(2, 12); KMP.set('camid', v); return v; })();
  let iceCfg = [], netRate = 1, discT = 0;
  let settings = parseQ(cfg.quality);
  let vTrack = null, aTrack = null, pc = null, conn = null, started = false, tally = 'off';
  let lastBytes = 0, lastT = 0, kbps = 0, battery = null, torchOn = false;

  function parseQ(q) { const m = /(\d+)p(\d+)/.exec(q || '1080p30') || [0, 1080, 30]; const hh = +m[1]; return { height: hh, width: Math.round(hh * 16 / 9), fps: +m[2], bitrate: hh >= 1080 ? 6000 : 4000, audio: true }; }

  // ---------- UI ----------
  function setStatus(s) {
    const el = $('status');
    const map = { net: ['Internet • mencari PC…', 'warn'], netoff: ['Internet terputus', 'warn'], open: ['Terhubung', 'ok'], connecting: ['Menyambung…', 'warn'], closed: ['Terputus', 'warn'], noserver: ['Isi IP PC', 'warn'], live: ['Streaming', 'ok'], nomixer: ['Mixer belum siap', 'warn'] };
    const [t, c] = map[s] || [s, ''];
    el.textContent = t; el.className = 'pill ' + c;
  }
  function labels() { $('slotLbl').textContent = 'CAM ' + cfg.slot; $('nameLbl').textContent = cfg.name; video.classList.toggle('mirror', cfg.facing === 'user' && cfg.mirror); previewTransform(); }
  function setTally(t) {
    if (t === tally) return;
    tally = t; document.body.classList.remove('t-program', 't-preview');
    if (t === 'program') { document.body.classList.add('t-program'); try { navigator.vibrate && navigator.vibrate(150); } catch (e) {} }
    if (t === 'preview') document.body.classList.add('t-preview');
  }

  // ---------- media ----------
  async function openVideo() {
    const s = settings;
    const vc = { facingMode: { ideal: cfg.facing }, width: { ideal: s.width }, height: { ideal: s.height }, frameRate: { ideal: s.fps, max: s.fps } };
    // minta izin zoom optik/hardware (Chrome); di aplikasi Android (WebView) biasanya tidak tersedia → zoom digital di bawah
    let sup = {}; try { sup = navigator.mediaDevices.getSupportedConstraints() || {}; } catch (e) {}
    if (sup.zoom) vc.zoom = true;
    let st;
    try { st = await navigator.mediaDevices.getUserMedia({ video: vc, audio: false }); }
    catch (e) { if (!vc.zoom) throw e; delete vc.zoom; st = await navigator.mediaDevices.getUserMedia({ video: vc, audio: false }); }
    const t = st.getVideoTracks()[0];
    try { t.contentHint = 'motion'; } catch (e) {}
    return t;
  }
  async function openAudio() {
    if (!settings.audio) return null;
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: !!cfg.ns, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: 48000 }, video: false });
      return st.getAudioTracks()[0];
    } catch (e) { return null; }
  }
  async function startMedia() {
    if (vTrack) vTrack.stop(); if (aTrack) aTrack.stop();
    vTrack = await openVideo(); aTrack = await openAudio();
    if (aTrack) aTrack.enabled = cfg.mic;
    video.srcObject = new MediaStream([vTrack]);
    video.play().catch(() => {});
    updateCaps(); labels();
  }
  // ---------- zoom: hardware bila kamera/peramban mendukung, selain itu ZOOM DIGITAL ----------
  // Zoom digital: pratinjau di HP diperbesar, nilai dikirim ke PC dan PC memotong (crop) gambar KLMCAM — tanpa beban di HP.
  let zoomHW = false, dz = 1, dzSent = 0, dzT = 0;
  const DZ_MAX = 5;
  function zoomCaps() { try { const c = vTrack && vTrack.getCapabilities ? vTrack.getCapabilities() : {}; return c.zoom && c.zoom.max > c.zoom.min ? c.zoom : null; } catch (e) { return null; } }
  function updateCaps() {
    let caps = {}; try { caps = vTrack.getCapabilities ? vTrack.getCapabilities() : {}; } catch (e) {}
    const z = $('zoom'), zc = zoomCaps();
    zoomHW = !!zc;
    if (zc) { z.min = zc.min; z.max = zc.max; z.step = zc.step || 0.1; let cur = zc.min; try { cur = vTrack.getSettings().zoom || zc.min; } catch (e) {} z.value = cur; $('zoomV').textContent = (+cur).toFixed(1) + '×'; if (dz !== 1) setDigital(1); }
    else { z.min = 1; z.max = DZ_MAX; z.step = 0.1; z.value = dz; $('zoomV').textContent = dz.toFixed(1) + '×'; }
    z.disabled = false;
    $('torch').style.opacity = caps.torch ? 1 : 0.4;
    previewTransform();
  }
  function previewTransform() {
    const m = cfg.facing === 'user' && cfg.mirror;
    video.style.transform = (m ? 'scaleX(-1) ' : '') + (dz > 1.001 ? 'scale(' + dz + ')' : '');
  }
  function sendZoom(force) {
    if (!conn || !conn.open) return;
    if (!force && dz === dzSent) return;
    dzSent = dz; conn.send({ t: 'cam-zoom', z: +dz.toFixed(3) });
  }
  function setDigital(v) {
    dz = Math.max(1, Math.min(DZ_MAX, +v || 1));
    $('zoom').value = dz; $('zoomV').textContent = dz.toFixed(1) + '×';
    previewTransform();
    clearTimeout(dzT); dzT = setTimeout(() => sendZoom(), 30); // digabung bila slider/cubit digeser cepat
  }
  async function applyZoom(v) {
    const zc = zoomCaps();
    if (!zc) return setDigital(v);
    try { v = Math.max(zc.min, Math.min(zc.max, v)); await vTrack.applyConstraints({ advanced: [{ zoom: v }] }); $('zoom').value = v; $('zoomV').textContent = (+v).toFixed(1) + '×'; }
    catch (e) { setDigital(v); }
  }
  function currentZoom() { const zc = zoomCaps(); if (zc) { try { return vTrack.getSettings().zoom || zc.min; } catch (e) { return zc.min; } } return dz; }
  // cubit dua jari di layar untuk zoom
  (function pinch() {
    let d0 = 0, z0 = 1;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    document.addEventListener('touchstart', (e) => { if (e.touches.length === 2 && !$('panel').classList.contains('show')) { d0 = dist(e.touches); z0 = currentZoom(); } }, { passive: true });
    document.addEventListener('touchmove', (e) => { if (e.touches.length === 2 && d0) { const k = dist(e.touches) / d0; applyZoom(z0 * k); } }, { passive: true });
    document.addEventListener('touchend', (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  })();
  async function setTorch(on) { torchOn = on; try { await vTrack.applyConstraints({ advanced: [{ torch: on }] }); } catch (e) { KMP.toast('Senter tidak didukung'); } $('torch').classList.toggle('on', on); }
  async function focusAuto() { try { await vTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); KMP.toast('Fokus otomatis'); } catch (e) {} }
  async function flip() {
    cfg.facing = cfg.facing === 'user' ? 'environment' : 'user'; KMP.set('facing', cfg.facing);
    const old = vTrack; vTrack = await openVideo();
    if (!document.body.classList.contains('dim')) video.srcObject = new MediaStream([vTrack]);
    const snd = pc && pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (snd) await snd.replaceTrack(vTrack);
    if (old) old.stop();
    updateCaps(); labels();
  }
  async function applySettings(s) {
    const changed = !settings || s.width !== settings.width || s.height !== settings.height || s.fps !== settings.fps;
    settings = Object.assign({}, settings, s);
    if (changed && vTrack) {
      try { await vTrack.applyConstraints({ width: { ideal: s.width }, height: { ideal: s.height }, frameRate: { ideal: s.fps, max: s.fps } }); }
      catch (e) { const old = vTrack; vTrack = await openVideo(); video.srcObject = new MediaStream([vTrack]); const snd = pc && pc.getSenders().find((x) => x.track && x.track.kind === 'video'); if (snd) await snd.replaceTrack(vTrack); old.stop(); }
    }
    await tuneSender();
  }
  async function tuneSender() {
    if (!pc) return;
    const snd = pc.getSenders().find((s) => s.track && s.track.kind === 'video'); if (!snd) return;
    try {
      const p = snd.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = Math.round((settings.bitrate || 6000) * 1000 * netRate);
      p.encodings[0].maxFramerate = settings.fps;
      p.encodings[0].priority = 'high'; p.encodings[0].networkPriority = 'high';
      p.degradationPreference = 'maintain-framerate';
      await snd.setParameters(p);
    } catch (e) { console.warn(e); }
  }

  // ---------- WebRTC ----------
  async function startPeer() {
    if (pc) { try { pc.close(); } catch (e) {} }
    pc = new RTCPeerConnection({ iceServers: iceCfg, bundlePolicy: 'max-bundle', iceCandidatePoolSize: iceCfg.length ? 2 : 0 });
    const me = pc; netRate = 1; clearTimeout(discT);
    const ms = new MediaStream([vTrack].concat(aTrack ? [aTrack] : []));
    const vt = pc.addTransceiver(vTrack, { direction: 'sendonly', streams: [ms] });
    try {
      const caps = RTCRtpSender.getCapabilities('video').codecs;
      const rank = (c) => (/H264/i.test(c.mimeType) ? (/42e01f|42001f/.test(c.sdpFmtpLine || '') ? 0 : 1) : /VP8/i.test(c.mimeType) ? 2 : /VP9/i.test(c.mimeType) ? 3 : 4);
      vt.setCodecPreferences(caps.slice().sort((a, b) => rank(a) - rank(b)));
    } catch (e) {}
    if (aTrack && settings.audio) pc.addTransceiver(aTrack, { direction: 'sendonly', streams: [ms] });
    pc.onicecandidate = (e) => { if (e.candidate) conn.send({ t: 'signal', data: { ice: e.candidate } }); };
    pc.onconnectionstatechange = () => {
      if (pc !== me) return;
      clearTimeout(discT);
      if (me.connectionState === 'connected') setStatus('live');
      if (me.connectionState === 'failed') setStatus('closed');
      // sinyal sempat hilang: coba pulihkan jalur (ICE restart) tanpa menunggu PC
      if (me.connectionState === 'disconnected') discT = setTimeout(async () => { if (pc !== me || me.connectionState === 'connected') return; try { const o = await me.createOffer({ iceRestart: true }); await me.setLocalDescription(o); conn.send({ t: 'signal', data: { sdp: me.localDescription } }); } catch (e) {} }, 1800);
    };
    await tuneSender();
    const offer = await pc.createOffer();
    // tambah bitrate awal agar gambar langsung tajam
    offer.sdp = offer.sdp.replace(/(a=fmtp:\d+ .*profile-level-id=[0-9a-fA-F]+.*)/g, '$1;x-google-start-bitrate=' + Math.round((settings.bitrate || 6000) * 0.7) + ';x-google-min-bitrate=1000');
    await pc.setLocalDescription(offer);
    conn.send({ t: 'signal', data: { sdp: pc.localDescription } });
    if (!zoomHW) setTimeout(() => sendZoom(true), 500);
  }

  async function onMsg(m) {
    switch (m.t) {
      case 'locked': if (conn) conn.closed = true; setStatus('closed'); KMP.toast('🔒 ' + (m.msg || 'KLMCAM memerlukan lisensi KLM'), 15000); break;
      case 'welcome': setStatus(m.mixer ? 'open' : 'nomixer'); break;
      case 'mixer-gone': setStatus('nomixer'); setTally('off'); if (pc) { pc.close(); pc = null; } break;
      case 'cam-start': iceCfg = Array.isArray(m.ice) ? m.ice : []; if (!vTrack) await startMedia(); if (m.settings) await applySettings(m.settings); await startPeer(); break;
      case 'signal':
        if (!pc) return;
        try { if (m.data.sdp) await pc.setRemoteDescription(m.data.sdp); else if (m.data.ice) await pc.addIceCandidate(m.data.ice); } catch (e) { console.warn(e); }
        break;
      case 'cam-ctl':
        if (m.cmd === 'zoom') applyZoom(+m.value);
        else if (m.cmd === 'torch') setTorch(!!m.value);
        else if (m.cmd === 'switch') flip();
        else if (m.cmd === 'focus') focusAuto();
        else if (m.cmd === 'settings') applySettings(m.value);
        break;
      case 'tally': setTally(m.state); break;
    }
  }

  /** sambungan sinyal lewat internet (NetLink) dengan antarmuka yang sama seperti sambungan WiFi lokal */
  function netConnect() {
    const st = { open: false, closed: false, room: null, hello: 0, gotMixer: false };
    const info = () => ({ t: 'hello', role: 'camera', name: cfg.name, slot: +cfg.slot, meta: { ua: navigator.userAgent, net: true } });
    st.send = (o) => { if (st.room) st.room.publish('m', Object.assign({ id: myId }, o)); };
    st.reconnect = () => { clearInterval(st.hello); if (st.room) { try { st.room.publish('m', { id: myId, t: 'bye' }); } catch (e) {} const r = st.room; setTimeout(() => r.close(), 300); st.room = null; } };
    setStatus('connecting');
    KLMNet.join(cfg.room, ['c/' + myId], {
      status: (n) => { st.open = n > 0; if (!n) setStatus('netoff'); else if (!st.gotMixer) { setStatus('net'); st.send(info()); } },
      message: (m) => { if (st.closed) return; if (m.t === 'welcome') st.gotMixer = true; onMsg(m); }
    }).then((room) => { if (st.closed) return room.close(); st.room = room; st.send(info()); st.hello = setInterval(() => st.send(info()), 4000); })
      .catch((e) => { KMP.toast(e.message, 5000); setStatus('closed'); });
    window.addEventListener('pagehide', () => st.reconnect());
    return st;
  }
  function connect() {
    if (conn) { conn.closed = true; conn.reconnect(); }
    if (cfg.room && window.KLMNet) { conn = netConnect(); return; }
    conn = KMP.connect('camera', () => ({ name: cfg.name, slot: +cfg.slot, meta: { ua: navigator.userAgent } }), { status: setStatus, message: onMsg });
  }

  // ---------- statistik ----------
  setInterval(async () => {
    if (!vTrack) return;
    const s = vTrack.getSettings ? vTrack.getSettings() : {};
    let fps = s.frameRate ? Math.round(s.frameRate) : settings.fps, loss = 0, rtt = 0;
    if (pc) {
      try {
        const st = await pc.getStats();
        st.forEach((r) => {
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            const now = r.timestamp; if (lastT) kbps = Math.round((r.bytesSent - lastBytes) * 8 / (now - lastT));
            lastBytes = r.bytesSent; lastT = now; if (r.framesPerSecond) fps = Math.round(r.framesPerSecond);
          }
          if (r.type === 'remote-inbound-rtp' && r.kind === 'video') { loss = r.fractionLost || 0; rtt = Math.round((r.roundTripTime || 0) * 1000); }
        });
        // jaringan berat (paket hilang / jeda tinggi) → turunkan bitrate agar gerakan tetap mulus & latensi tidak menumpuk; pulih perlahan
        const before = netRate;
        if (loss > 0.08 || rtt > 450) netRate = Math.max(0.2, netRate * 0.7);
        else if (loss < 0.02 && rtt < 200) netRate = Math.min(1, netRate * 1.15);
        if (Math.abs(netRate - before) > 0.01) tuneSender();
      } catch (e) {}
    }
    $('stats').innerHTML = (s.width || '?') + '×' + (s.height || '?') + ' • ' + fps + 'fps<br>' + (pc ? kbps + ' kbps' + (rtt ? ' • ' + rtt + ' ms' : '') + (netRate < 0.99 ? ' • hemat ' + Math.round(netRate * 100) + '%' : '') : '') + (battery != null ? '<br>🔋 ' + battery + '%' : '');
    if (conn && conn.open) conn.send({ t: 'cam-info', info: { w: s.width, h: s.height, fps, kbps, battery, rtt, loss: Math.round(loss * 100), net: !!cfg.room } });
  }, 2000);
  if (navigator.getBattery) navigator.getBattery().then((b) => { const u = () => { battery = Math.round(b.level * 100); }; u(); b.addEventListener('levelchange', u); }).catch(() => {});

  // ---------- tombol ----------
  $('home').onclick = () => { location.href = KMP.page('hp'); };
  $('flip').onclick = flip;
  $('torch').onclick = () => setTorch(!torchOn);
  $('mic').onclick = () => { cfg.mic = !cfg.mic; if (aTrack) aTrack.enabled = cfg.mic; $('mic').textContent = cfg.mic ? '🎤' : '🔇'; KMP.toast(cfg.mic ? 'Mic aktif' : 'Mic dimatikan'); };
  $('focus').onclick = focusAuto;
  $('zoom').oninput = (e) => applyZoom(+e.target.value);
  $('full').onclick = async () => { try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch (e) {} };
  $('hideUi').onclick = (e) => { e.stopPropagation(); document.body.classList.add('hide'); KMP.toast('Ketuk layar untuk menampilkan tombol'); };
  video.addEventListener('click', () => document.body.classList.remove('hide'));
  // hemat baterai: berhenti menggambar preview lokal (encoder tetap jalan)
  $('dim').onclick = (e) => { e.stopPropagation(); document.body.classList.add('dim', 'hide'); video.srcObject = null; };
  $('dimMsg').onclick = () => { document.body.classList.remove('dim', 'hide'); if (vTrack) { video.srcObject = new MediaStream([vTrack]); video.play().catch(() => {}); } };

  // ---------- pengaturan ----------
  const slotSel = $('sSlot');
  for (let i = 1; i <= 10; i++) slotSel.appendChild(new Option('Slot ' + i, i));
  function openPanel() {
    $('srvBox').style.display = KMP.servedByPc || KMP.hosted ? 'none' : ''; $('sRoom').value = cfg.room || '';
    $('sSrv').value = KMP.get('server', ''); $('sName').value = cfg.name; slotSel.value = cfg.slot; $('sFacing').value = cfg.facing; $('sQual').value = cfg.quality;
    $('sNs').checked = !!cfg.ns; $('sMirror').checked = !!cfg.mirror;
    $('panel').classList.add('show');
  }
  $('openSet').onclick = openPanel; $('startSet').onclick = openPanel;
  $('sCancel').onclick = () => $('panel').classList.remove('show');
  $('sSave').onclick = async () => {
    if (!KMP.servedByPc) KMP.set('server', $('sSrv').value.trim());
    cfg.room = $('sRoom').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); KMP.set('room', cfg.room);
    cfg.name = $('sName').value.trim() || KMP.deviceName(); cfg.slot = +slotSel.value; cfg.facing = $('sFacing').value; cfg.quality = $('sQual').value; cfg.ns = $('sNs').checked; cfg.mirror = $('sMirror').checked;
    KMP.set('camname', cfg.name); KMP.set('slot', cfg.slot); KMP.set('facing', cfg.facing); KMP.set('quality', cfg.quality); KMP.set('ns', cfg.ns); KMP.set('mirror', cfg.mirror);
    settings = parseQ(cfg.quality);
    $('panel').classList.remove('show');
    labels();
    if (started) { await startMedia(); connect(); }
  };

  $('startBtn').onclick = async () => {
    if (!cfg.room && !KMP.servedByPc && !KMP.server().host) { openPanel(); KMP.toast(KMP.hosted ? 'Isi kode internet dari panel KLMCAM di PC' : 'Isi IP PC (satu WiFi) atau kode internet'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { KMP.toast('Kamera butuh HTTPS. Buka lewat alamat https://… atau pakai aplikasi APK.', 5000); return; }
    try { await startMedia(); } catch (e) { KMP.toast('Izin kamera ditolak: ' + e.name, 4000); return; }
    started = true; $('start').style.display = 'none';
    KMP.wakeLock();
    connect();
    try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch (e) {}
  };
  labels();
  if (KMP.get('autostart', false)) $('startBtn').click();
})();
