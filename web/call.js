/* KLM Call - tamu jarak jauh: kirim kamera+mic, terima program (return feed) + audio mix-minus */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const ret = $('ret'), self = $('self');
  let conn = null, pc = null, vTrack = null, aTrack = null, facing = 'user', q = 720;
  const cfg = { name: KMP.get('callname', ''), slot: KMP.get('callslot', 1) };
  const qs = new URLSearchParams(location.search);
  if (qs.get('slot')) cfg.slot = +qs.get('slot');
  if (qs.get('name')) cfg.name = qs.get('name');

  for (let i = 1; i <= 8; i++) $('jSlot').appendChild(new Option('Call ' + i, i));
  $('jSlot').value = cfg.slot; $('jName').value = cfg.name; $('jSrv').value = KMP.get('server', '');
  if (KMP.servedByPc) $('srvBox').style.display = 'none';

  function status(s) {
    const m = { open: ['Terhubung', 'ok'], connecting: ['Menyambung…', 'warn'], closed: ['Terputus', 'red'], live: ['Dalam siaran', 'ok'], noserver: ['Isi IP PC', 'warn'] }[s] || [s, ''];
    $('status').textContent = m[0]; $('status').className = 'pill ' + m[1];
  }
  async function media() {
    const st = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: Math.round(q * 16 / 9) }, height: { ideal: q }, frameRate: { ideal: 30, max: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    vTrack = st.getVideoTracks()[0]; aTrack = st.getAudioTracks()[0];
    try { vTrack.contentHint = 'motion'; aTrack.contentHint = 'speech'; } catch (e) {}
    self.srcObject = new MediaStream([vTrack]);
  }
  async function startPeer(settings) {
    if (pc) try { pc.close(); } catch (e) {}
    pc = new RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' });
    const ms = new MediaStream([vTrack, aTrack].filter(Boolean));
    if (vTrack) pc.addTransceiver(vTrack, { direction: 'sendrecv', streams: [ms] }); else pc.addTransceiver('video', { direction: 'recvonly' });
    if (aTrack) pc.addTransceiver(aTrack, { direction: 'sendrecv', streams: [ms] }); else pc.addTransceiver('audio', { direction: 'recvonly' });
    const back = new MediaStream();
    pc.ontrack = (e) => { back.addTrack(e.track); ret.srcObject = back; ret.play().catch(() => {}); try { e.receiver.playoutDelayHint = 0; } catch (x) {} };
    pc.onicecandidate = (e) => { if (e.candidate) conn.send({ t: 'signal', data: { ice: e.candidate } }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') status('live'); if (pc.connectionState === 'failed') status('closed'); };
    const snd = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (snd) { try { const p = snd.getParameters(); if (!p.encodings || !p.encodings.length) p.encodings = [{}]; p.encodings[0].maxBitrate = ((settings && settings.bitrate) || 2500) * 1000; p.degradationPreference = 'balanced'; await snd.setParameters(p); } catch (e) {} }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    conn.send({ t: 'signal', data: { sdp: pc.localDescription } });
  }
  async function onMsg(m) {
    if (m.t === 'welcome') status(m.mixer ? 'open' : 'connecting');
    else if (m.t === 'call-start') await startPeer(m.settings);
    else if (m.t === 'signal' && pc) { try { if (m.data.sdp) await pc.setRemoteDescription(m.data.sdp); else if (m.data.ice) await pc.addIceCandidate(m.data.ice); } catch (e) {} }
    else if (m.t === 'tally') { document.body.classList.remove('t-program', 't-preview'); if (m.state !== 'off') document.body.classList.add('t-' + m.state); }
    else if (m.t === 'mixer-gone') { status('closed'); if (pc) pc.close(); pc = null; }
    else if (m.t === 'cam-ctl' && m.cmd === 'switch') flip();
  }
  async function flip() {
    facing = facing === 'user' ? 'environment' : 'user';
    const st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, height: { ideal: q } } });
    const nt = st.getVideoTracks()[0];
    const snd = pc && pc.getSenders().find((s) => s.track && s.track.kind === 'video');
    if (snd) await snd.replaceTrack(nt);
    if (vTrack) vTrack.stop(); vTrack = nt; self.srcObject = new MediaStream([vTrack]);
    self.style.transform = facing === 'user' ? 'scaleX(-1)' : 'none';
  }
  $('jGo').onclick = async () => {
    if (!KMP.servedByPc) KMP.set('server', $('jSrv').value.trim());
    cfg.name = $('jName').value.trim() || KMP.deviceName(); cfg.slot = +$('jSlot').value; q = +$('jQ').value;
    KMP.set('callname', cfg.name); KMP.set('callslot', cfg.slot);
    if (!navigator.mediaDevices) { KMP.toast('Butuh HTTPS atau aplikasi APK untuk kamera', 5000); return; }
    try { await media(); } catch (e) { KMP.toast('Izin kamera/mic ditolak: ' + e.name, 4000); }
    $('join').style.display = 'none'; $('who').textContent = cfg.name + ' • Call ' + cfg.slot;
    KMP.wakeLock();
    conn = KMP.connect('guest', () => ({ name: cfg.name, slot: cfg.slot }), { status, message: onMsg });
  };
  $('bMic').onclick = () => { if (!aTrack) return; aTrack.enabled = !aTrack.enabled; $('bMic').classList.toggle('off', !aTrack.enabled); };
  $('bCam').onclick = () => { if (!vTrack) return; vTrack.enabled = !vTrack.enabled; $('bCam').classList.toggle('off', !vTrack.enabled); };
  $('bFlip').onclick = flip;
  $('bVol').onclick = () => { ret.muted = !ret.muted; $('bVol').classList.toggle('off', ret.muted); };
  $('bEnd').onclick = () => { if (pc) pc.close(); if (conn) { conn.closed = true; conn.reconnect(); } location.href = KMP.page('hp'); };
})();
