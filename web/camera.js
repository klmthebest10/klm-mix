/* KLMCAM - kamera HP → KLM Mix lewat WebRTC (LAN, latensi rendah, H.264, tally) */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const video = $('local');
  const cfg = {
    slot: KMP.get('slot', 1), name: KMP.get('camname', KMP.deviceName()), facing: KMP.get('facing', 'environment'),
    quality: KMP.get('quality', '1080p30'), ns: KMP.get('ns', false), mirror: KMP.get('mirror', true), mic: true
  };
  let settings = parseQ(cfg.quality);
  let vTrack = null, aTrack = null, pc = null, conn = null, started = false, tally = 'off';
  let lastBytes = 0, lastT = 0, kbps = 0, battery = null, torchOn = false;

  function parseQ(q) { const m = /(\d+)p(\d+)/.exec(q || '1080p30') || [0, 1080, 30]; const hh = +m[1]; return { height: hh, width: Math.round(hh * 16 / 9), fps: +m[2], bitrate: hh >= 1080 ? 6000 : 4000, audio: true }; }

  // ---------- UI ----------
  function setStatus(s) {
    const el = $('status');
    const map = { open: ['Terhubung', 'ok'], connecting: ['Menyambung…', 'warn'], closed: ['Terputus', 'warn'], noserver: ['Isi IP PC', 'warn'], live: ['Streaming', 'ok'], nomixer: ['Mixer belum siap', 'warn'] };
    const [t, c] = map[s] || [s, ''];
    el.textContent = t; el.className = 'pill ' + c;
  }
  function labels() { $('slotLbl').textContent = 'CAM ' + cfg.slot; $('nameLbl').textContent = cfg.name; video.classList.toggle('mirror', cfg.facing === 'user' && cfg.mirror); }
  function setTally(t) {
    if (t === tally) return;
    tally = t; document.body.classList.remove('t-program', 't-preview');
    if (t === 'program') { document.body.classList.add('t-program'); try { navigator.vibrate && navigator.vibrate(150); } catch (e) {} }
    if (t === 'preview') document.body.classList.add('t-preview');
  }

  // ---------- media ----------
  async function openVideo() {
    const s = settings;
    const st = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: cfg.facing }, width: { ideal: s.width }, height: { ideal: s.height }, frameRate: { ideal: s.fps, max: s.fps } }, audio: false
    });
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
  function updateCaps() {
    let caps = {}; try { caps = vTrack.getCapabilities ? vTrack.getCapabilities() : {}; } catch (e) {}
    const z = $('zoom');
    if (caps.zoom) { z.min = caps.zoom.min; z.max = caps.zoom.max; z.step = caps.zoom.step || 0.1; z.disabled = false; } else { z.disabled = true; }
    $('torch').style.opacity = caps.torch ? 1 : 0.4;
  }
  async function applyZoom(v) {
    try { const caps = vTrack.getCapabilities(); if (!caps.zoom) return; v = Math.max(caps.zoom.min, Math.min(caps.zoom.max, v)); await vTrack.applyConstraints({ advanced: [{ zoom: v }] }); $('zoom').value = v; $('zoomV').textContent = (+v).toFixed(1) + '×'; } catch (e) {}
  }
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
      p.encodings[0].maxBitrate = (settings.bitrate || 6000) * 1000;
      p.encodings[0].maxFramerate = settings.fps;
      p.encodings[0].priority = 'high'; p.encodings[0].networkPriority = 'high';
      p.degradationPreference = 'maintain-framerate';
      await snd.setParameters(p);
    } catch (e) { console.warn(e); }
  }

  // ---------- WebRTC ----------
  async function startPeer() {
    if (pc) { try { pc.close(); } catch (e) {} }
    pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    const ms = new MediaStream([vTrack].concat(aTrack ? [aTrack] : []));
    const vt = pc.addTransceiver(vTrack, { direction: 'sendonly', streams: [ms] });
    try {
      const caps = RTCRtpSender.getCapabilities('video').codecs;
      const rank = (c) => (/H264/i.test(c.mimeType) ? (/42e01f|42001f/.test(c.sdpFmtpLine || '') ? 0 : 1) : /VP8/i.test(c.mimeType) ? 2 : /VP9/i.test(c.mimeType) ? 3 : 4);
      vt.setCodecPreferences(caps.slice().sort((a, b) => rank(a) - rank(b)));
    } catch (e) {}
    if (aTrack && settings.audio) pc.addTransceiver(aTrack, { direction: 'sendonly', streams: [ms] });
    pc.onicecandidate = (e) => { if (e.candidate) conn.send({ t: 'signal', data: { ice: e.candidate } }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') setStatus('live'); if (pc.connectionState === 'failed') setStatus('closed'); };
    await tuneSender();
    const offer = await pc.createOffer();
    // tambah bitrate awal agar gambar langsung tajam
    offer.sdp = offer.sdp.replace(/(a=fmtp:\d+ .*profile-level-id=[0-9a-fA-F]+.*)/g, '$1;x-google-start-bitrate=' + Math.round((settings.bitrate || 6000) * 0.7) + ';x-google-min-bitrate=1000');
    await pc.setLocalDescription(offer);
    conn.send({ t: 'signal', data: { sdp: pc.localDescription } });
  }

  async function onMsg(m) {
    switch (m.t) {
      case 'welcome': setStatus(m.mixer ? 'open' : 'nomixer'); break;
      case 'mixer-gone': setStatus('nomixer'); setTally('off'); if (pc) { pc.close(); pc = null; } break;
      case 'cam-start': if (!vTrack) await startMedia(); if (m.settings) await applySettings(m.settings); await startPeer(); break;
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

  function connect() {
    if (conn) { conn.closed = true; conn.reconnect(); }
    conn = KMP.connect('camera', () => ({ name: cfg.name, slot: +cfg.slot, meta: { ua: navigator.userAgent } }), { status: setStatus, message: onMsg });
  }

  // ---------- statistik ----------
  setInterval(async () => {
    if (!vTrack) return;
    const s = vTrack.getSettings ? vTrack.getSettings() : {};
    let fps = s.frameRate ? Math.round(s.frameRate) : settings.fps;
    if (pc) {
      try {
        const st = await pc.getStats();
        st.forEach((r) => {
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            const now = r.timestamp; if (lastT) kbps = Math.round((r.bytesSent - lastBytes) * 8 / (now - lastT));
            lastBytes = r.bytesSent; lastT = now; if (r.framesPerSecond) fps = Math.round(r.framesPerSecond);
          }
        });
      } catch (e) {}
    }
    $('stats').innerHTML = (s.width || '?') + '×' + (s.height || '?') + ' • ' + fps + 'fps<br>' + (pc ? kbps + ' kbps' : '') + (battery != null ? '<br>🔋 ' + battery + '%' : '');
    if (conn && conn.open) conn.send({ t: 'cam-info', info: { w: s.width, h: s.height, fps, kbps, battery } });
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
    $('srvBox').style.display = KMP.servedByPc ? 'none' : '';
    $('sSrv').value = KMP.get('server', ''); $('sName').value = cfg.name; slotSel.value = cfg.slot; $('sFacing').value = cfg.facing; $('sQual').value = cfg.quality;
    $('sNs').checked = !!cfg.ns; $('sMirror').checked = !!cfg.mirror;
    $('panel').classList.add('show');
  }
  $('openSet').onclick = openPanel; $('startSet').onclick = openPanel;
  $('sCancel').onclick = () => $('panel').classList.remove('show');
  $('sSave').onclick = async () => {
    if (!KMP.servedByPc) KMP.set('server', $('sSrv').value.trim());
    cfg.name = $('sName').value.trim() || KMP.deviceName(); cfg.slot = +slotSel.value; cfg.facing = $('sFacing').value; cfg.quality = $('sQual').value; cfg.ns = $('sNs').checked; cfg.mirror = $('sMirror').checked;
    KMP.set('camname', cfg.name); KMP.set('slot', cfg.slot); KMP.set('facing', cfg.facing); KMP.set('quality', cfg.quality); KMP.set('ns', cfg.ns); KMP.set('mirror', cfg.mirror);
    settings = parseQ(cfg.quality);
    $('panel').classList.remove('show');
    labels();
    if (started) { await startMedia(); connect(); }
  };

  $('startBtn').onclick = async () => {
    if (!KMP.servedByPc && !KMP.server().host) { openPanel(); KMP.toast('Isi IP PC dulu'); return; }
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
