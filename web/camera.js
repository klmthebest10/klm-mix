/* KLMCAM - kamera HP → KLM lewat WebRTC (LAN, latensi rendah, H.264, tally) */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const video = $('local');
  const cfg = {
    slot: KMP.get('slot', 1), name: KMP.get('camname', KMP.deviceName()), facing: KMP.get('facing', 'environment'),
    quality: KMP.get('quality', '1080p30'), ns: KMP.get('ns', false), mirror: KMP.get('mirror', true), mic: true, fpsLock: KMP.get('fpsLock', true),
    shutter: String(KMP.get('shutter', 'auto')), hz: String(KMP.get('hz', hzDefault())), bright: +KMP.get('bright', 0) || 0,
    auto: KMP.get('autoLite', true) !== false, boost: KMP.get('wifiBoost', true) !== false
  };
  const QUALS = ['720p30', '720p60', '1080p30', '1080p60', '1440p30', '2160p30'];
  if (!QUALS.includes(cfg.quality)) cfg.quality = '1080p30';
  const SHUTTERS = ['auto', 'cam', '50', '60', '100', '120', '250', '500', '1000'];
  if (!SHUTTERS.includes(cfg.shutter)) cfg.shutter = 'auto';
  // frekuensi listrik (kedip lampu) dari zona waktu: 60 Hz di Korea, Amerika (kecuali sebagian selatan), Taiwan, Filipina, Arab Saudi
  function hzDefault() { let z = ''; try { z = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {} return /^(America\/(?!Argentina|Santiago|Montevideo|Asuncion|La_Paz|Punta_Arenas)|Asia\/(Seoul|Taipei|Manila|Riyadh)|Pacific\/(Honolulu|Guam|Saipan))/.test(z) ? '60' : '50'; }
  // mode internet: kode ruang dari tautan (#r=KODE&s=slot) atau dari pengaturan
  const hp = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (hp.get('r')) { KMP.set('room', hp.get('r').toUpperCase()); if (+hp.get('s')) { cfg.slot = +hp.get('s'); KMP.set('slot', cfg.slot); } }
  cfg.room = String(KMP.get('room', '') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const myId = KMP.get('camid', '') || (() => { const v = Math.random().toString(36).slice(2, 12); KMP.set('camid', v); return v; })();
  let iceCfg = [], netRate = 1, discT = 0;
  let settings = parseQ(cfg.quality);
  let vTrack = null, aTrack = null, pc = null, conn = null, started = false, tally = 'off', qPending = false;
  let lastBytes = 0, lastT = 0, kbps = 0, battery = null, torchOn = false, availCap = 0;

  // bitrate per kualitas (H.264 encoder hardware HP). 2160p = "maks kamera HP": kamera memberi resolusi terdekat yang ia sanggup
  function parseQ(q) { const m = /(\d+)p(\d+)/.exec(q || '1080p30') || [0, 1080, 30]; const hh = +m[1], f = +m[2]; return { height: hh, width: Math.round(hh * 16 / 9), fps: f, bitrate: hh >= 2160 ? 20000 : hh >= 1440 ? 12000 : hh >= 1080 ? (f >= 50 ? 9000 : 6000) : (f >= 50 ? 6000 : 4000), audio: true }; }

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
  // kamera depan/belakang dikenali dari label perangkat (dipakai bila facingMode tidak dipatuhi HP)
  const FRONT = /front|user|selfie|depan|face|前|전면/i, BACK = /back|rear|environment|belakang|world|后|후면/i;
  async function camByFacing(facing) {
    try {
      const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.label);
      const want = facing === 'user' ? FRONT : BACK, not = facing === 'user' ? BACK : FRONT;
      return (ds.find((d) => want.test(d.label) && !not.test(d.label)) || {}).deviceId || '';
    } catch (e) { return ''; }
  }
  function facingOf(t) {
    try { const f = t.getSettings().facingMode; if (f === 'user' || f === 'environment') return f; } catch (e) {}
    const l = (t && t.label) || ''; return FRONT.test(l) ? 'user' : BACK.test(l) ? 'environment' : '';
  }
  // FPS: format kamera dipilih yang SANGGUP fps pilihan (min = 90% target) — dulu hanya "ideal", HP sering memilih format
  // 30 fps (atau lebih rendah) walau 60 dipilih. Bila HP tidak punya format itu, dibuka ulang tanpa syarat minimum.
  async function openVideo(facing) {
    try { return await openVideoWith(facing, true); } catch (e) { if (e && e.name === 'NotAllowedError') throw e; return openVideoWith(facing, false); }
  }
  async function openVideoWith(facing, needFps) {
    facing = facing || cfg.facing;
    const s = settings;
    const base = { width: { ideal: s.width }, height: { ideal: s.height }, frameRate: needFps ? { ideal: s.fps, max: s.fps, min: Math.round(s.fps * 0.9) } : { ideal: s.fps, max: s.fps } };
    // minta izin zoom optik/hardware (Chrome); di aplikasi Android (WebView) biasanya tidak tersedia → zoom digital di bawah
    let sup = {}; try { sup = navigator.mediaDevices.getSupportedConstraints() || {}; } catch (e) {}
    const gum = async (vc) => {
      if (sup.zoom) { try { return await navigator.mediaDevices.getUserMedia({ video: Object.assign({ zoom: true }, vc), audio: false }); } catch (e) { if (e && e.name === 'NotAllowedError') throw e; } }
      return navigator.mediaDevices.getUserMedia({ video: vc, audio: false });
    };
    // 1) facingMode wajib (exact) → 2) kamera dipilih dari daftar perangkat → 3) facingMode "ideal" (laptop/peramban lama)
    let st = null, err = null;
    try { st = await gum(Object.assign({ facingMode: { exact: facing } }, base)); } catch (e) { err = e; if (e && e.name === 'NotAllowedError') throw e; }
    if (st && facingOf(st.getVideoTracks()[0]) && facingOf(st.getVideoTracks()[0]) !== facing) { st.getTracks().forEach((t) => t.stop()); st = null; }
    if (!st) { const id = await camByFacing(facing); if (id) { try { st = await gum(Object.assign({ deviceId: { exact: id } }, base)); } catch (e) { err = e; } } }
    if (!st) { try { st = await gum(Object.assign({ facingMode: { ideal: facing } }, base)); } catch (e) { throw err || e; } }
    const t = st.getVideoTracks()[0];
    try { t.contentHint = 'motion'; } catch (e) {}
    exReset(); fpsGuardReset();
    return t;
  }
  /** ganti trek kamera (depan/belakang atau resolusi baru) tanpa memutus sambungan ke PC.
   *  Kamera lama DILEPAS dulu: banyak HP Android tidak bisa membuka kamera kedua selagi yang pertama menyala. */
  let reopening = null;
  function reopenVideo(facing) {
    if (reopening) return reopening;
    reopening = (async () => {
      const prevFacing = cfg.facing, want = facing || cfg.facing;
      const old = vTrack;
      if (old) { try { old.stop(); } catch (e) {} }
      torchOn = false; $('torch').classList.remove('on');
      let t = null;
      try { t = await openVideo(want); cfg.facing = want; }
      catch (e) {
        try { t = await openVideo(prevFacing); cfg.facing = prevFacing; } catch (e2) {}
        KMP.toast(want !== prevFacing ? 'Kamera ' + (want === 'user' ? 'depan' : 'belakang') + ' tidak bisa dibuka (' + (e.name || e.message) + ')' : 'Kamera gagal dibuka ulang: ' + (e.name || e.message), 4000);
        if (!t) throw e;
      }
      KMP.set('facing', cfg.facing);
      vTrack = t;
      await useOut(wrapTrack(vTrack));
      hwVal = null; updateCaps(); labels(); sendInfo(); sendZoom(true);
      exApply();
    })().finally(() => { reopening = null; });
    return reopening;
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
    outTrack = wrapTrack(vTrack);
    video.srcObject = new MediaStream([outTrack]);
    video.play().catch(() => {});
    updateCaps(); labels();
    exWatch(); exApply();
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
    if (zc) { z.min = zc.min; z.max = zc.max; z.step = zc.step || 0.1; let cur = zc.min; try { cur = vTrack.getSettings().zoom || zc.min; } catch (e) {} hwVal = cur; z.value = cur; $('zoomV').textContent = (+cur).toFixed(1) + '×'; if (dz !== 1) setDigital(1); }
    else { z.min = 1; z.max = DZ_MAX; z.step = 0.1; z.value = dz; $('zoomV').textContent = dz.toFixed(1) + '×'; }
    z.disabled = false;
    $('torch').style.opacity = caps.torch ? 1 : 0.4;
    previewTransform();
  }
  function previewTransform() {
    const m = cfg.facing === 'user' && cfg.mirror;
    // zoom digital memakai properti `scale` tersendiri dengan transisi singkat → cubit/slider terlihat meluncur halus;
    // cermin tetap lewat transform (tanpa animasi). Peramban lama tanpa `scale`: kembali ke transform.
    if ('scale' in video.style) {
      video.style.transition = 'scale 90ms linear';
      video.style.transform = m ? 'scaleX(-1)' : '';
      video.style.scale = dz > 1.001 ? String(dz) : '';
    } else video.style.transform = (m ? 'scaleX(-1) ' : '') + (dz > 1.001 ? 'scale(' + dz + ')' : '');
  }
  // nilai zoom (hardware atau digital) dikirim ke PC → slider zoom di KLM selalu sama dengan HP; digital juga dipotong di PC
  function sendZoom(force) {
    if (!conn || !conn.open) return;
    const z = currentZoom();
    if (!force && z === dzSent) return;
    dzSent = z; const zc = zoomCaps();
    conn.send({ t: 'cam-zoom', z: +(+z).toFixed(3), hw: !!zc, min: zc ? zc.min : 1, max: zc ? zc.max : DZ_MAX });
  }
  function setDigital(v) {
    dz = Math.max(1, Math.min(DZ_MAX, +v || 1));
    $('zoom').value = dz; $('zoomV').textContent = dz.toFixed(1) + '×';
    previewTransform();
    clearTimeout(dzT); dzT = setTimeout(() => sendZoom(), 30); // digabung bila slider/cubit digeser cepat
  }
  // zoom hardware: perintah beruntun (slider / cubit / dari PC) DIGABUNG — hanya satu applyConstraints berjalan.
  // Dulu tiap geseran memanggil applyConstraints bersamaan → HP menolak (error) lalu malah jatuh ke zoom digital.
  // Sekarang lensa MELUNCUR ke target: langkah kecil di ruang log ±30 langkah/detik (maks ±9% per langkah), jadi zoom dari
  // slider PC (dikirim tiap 40 ms) atau cubit terlihat halus seperti tuas zoom kamera, bukan meloncat-loncat.
  let hwBusy = false, hwTgt = null, hwVal = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function hwSet(x) {
    try { await vTrack.applyConstraints({ advanced: [{ zoom: x }] }); hwVal = x; return true; }
    catch (e) { try { await vTrack.applyConstraints({ zoom: x }); hwVal = x; return true; } catch (e2) { console.warn('zoom', e2); return false; } }
  }
  async function applyZoom(v) {
    const zc = zoomCaps();
    if (!zc) return setDigital(v);
    v = Math.max(zc.min, Math.min(zc.max, +v || zc.min));
    $('zoom').value = v; $('zoomV').textContent = (+v).toFixed(1) + '×';
    hwTgt = v; if (hwBusy) return;
    hwBusy = true;
    const track = vTrack;
    try {
      let fails = 0;
      for (;;) {
        if (track !== vTrack || track.readyState === 'ended') break;
        const z = zoomCaps(); if (!z) break;
        const t = Math.max(z.min, Math.min(z.max, hwTgt)), cur = Math.max(1e-3, hwVal != null ? hwVal : t);
        const d = Math.log(t) - Math.log(cur);
        if (Math.abs(d) < 0.003) { if (cur !== t && !(await hwSet(t))) hwVal = t; if (Math.abs(Math.log(Math.max(z.min, Math.min(z.max, hwTgt))) - Math.log(t)) < 0.003) break; continue; }
        const s = Math.abs(d) < 0.02 ? d : Math.sign(d) * Math.min(Math.abs(d) * 0.3 + 0.01, 0.09);
        const x = Math.max(z.min, Math.min(z.max, Math.exp(Math.log(cur) + s)));
        const t0 = performance.now();
        if (!(await hwSet(x))) { if (++fails > 2) { hwVal = t; break; } await sleep(60); continue; }
        fails = 0;
        const w = 33 - (performance.now() - t0); if (w > 2) await sleep(w);
      }
    } finally { hwBusy = false; }
    clearTimeout(dzT); dzT = setTimeout(() => sendZoom(), 60);
  }
  function currentZoom() { const zc = zoomCaps(); if (zc) { if (hwVal != null) return hwVal; try { return vTrack.getSettings().zoom || zc.min; } catch (e) { return zc.min; } } return dz; }
  // cubit dua jari di layar untuk zoom
  (function pinch() {
    let d0 = 0, z0 = 1;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    document.addEventListener('touchstart', (e) => { if (e.touches.length === 2 && !$('panel').classList.contains('show')) { d0 = dist(e.touches); z0 = zoomHW && hwTgt != null ? hwTgt : currentZoom(); } }, { passive: true });
    document.addEventListener('touchmove', (e) => { if (e.touches.length === 2 && d0) { const k = dist(e.touches) / d0; applyZoom(z0 * k); } }, { passive: true });
    document.addEventListener('touchend', (e) => { if (e.touches.length < 2) d0 = 0; }, { passive: true });
  })();
  async function setTorch(on) { torchOn = on; try { await vTrack.applyConstraints({ advanced: [{ torch: on }] }); } catch (e) { KMP.toast('Senter tidak didukung'); } $('torch').classList.toggle('on', on); }
  async function focusAuto() { try { await vTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); KMP.toast('Fokus otomatis'); } catch (e) {} }
  async function flip(to) {
    if (reopening) return reopening; // ketukan beruntun diabaikan sampai kamera siap
    const want = to === 'user' || to === 'environment' ? to : (cfg.facing === 'user' ? 'environment' : 'user');
    if (!vTrack) { cfg.facing = want; KMP.set('facing', want); labels(); return; }
    $('flip').disabled = true;
    try { await reopenVideo(want); } catch (e) {} finally { $('flip').disabled = false; }
  }
  // kualitas dari PC → disimpan juga sebagai pengaturan HP (pengaturan HP & PC selalu sama)
  const qName = (s) => (s && s.height ? s.height + 'p' + (s.fps || 30) : '');
  function adoptSettings(s) {
    const changed = !settings || s.width !== settings.width || s.height !== settings.height || s.fps !== settings.fps;
    settings = Object.assign({}, settings, s);
    const q = qName(settings);
    if (QUALS.includes(q) && q !== cfg.quality) { cfg.quality = q; KMP.set('quality', q); }
    if ($('panel').classList.contains('show')) $('sQual').value = cfg.quality;
    return changed;
  }
  async function applySettings(s) {
    // resolusi/fps baru: kamera dibuka ulang (applyConstraints sering diabaikan HP Android → kualitas tidak berubah)
    if (adoptSettings(s) && vTrack) { try { await reopenVideo(); } catch (e) {} }
    else await tuneSender();
    sendInfo();
  }
  async function tuneSender() {
    if (!pc) return;
    const snd = pc.getSenders().find((s) => s.track && s.track.kind === 'video'); if (!snd) return;
    try {
      const p = snd.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      let kb = Math.round((settings.bitrate || 6000) * netRate); if (availCap > 0) kb = Math.max(800, Math.min(kb, availCap));
      p.encodings[0].maxBitrate = kb * 1000;
      p.encodings[0].maxFramerate = settings.fps;
      p.encodings[0].priority = 'high'; p.encodings[0].networkPriority = 'high';
      p.degradationPreference = 'maintain-framerate';
      await snd.setParameters(p);
    } catch (e) { console.warn(e); }
  }

  // ---------- RINGAN OTOMATIS (HP kentang) ----------
  // Bila encoder/kamera HP tidak sanggup (encoder dibatasi CPU, atau fps yang terkirim jauh di bawah target padahal kamera
  // memberi cukup) selama ±8 detik → kualitas turun satu tingkat (fps dipertahankan, resolusi diturunkan) & PC ikut diberi tahu.
  // Kamera dibuka ulang di resolusi lebih kecil → HP benar-benar lebih ringan (bukan hanya encodernya).
  const LITE = { '2160p30': '1440p30', '1440p30': '1080p30', '1080p60': '720p60', '1080p30': '720p30', '720p60': '720p30' };
  const AL = { bad: 0, at: 0 };
  function autoLite(limit, encFps, capFps) {
    if (!cfg.auto || !pc || reopening || performance.now() - AL.at < 15000) { AL.bad = 0; return; }
    const want = settings.fps || 30, camOk = !capFps || capFps >= want * 0.85;
    const bad = limit === 'cpu' || (encFps && camOk && encFps < want * 0.8);
    AL.bad = bad ? AL.bad + 1 : 0;
    if (AL.bad < 4) return;
    AL.bad = 0; AL.at = performance.now();
    const next = LITE[cfg.quality]; if (!next) return;
    KMP.toast('HP tidak sanggup ' + cfg.quality.replace('p', 'p ') + ' fps — diturunkan ke ' + next.replace('p', 'p ') + ' agar tetap mulus tanpa lag', 5000);
    cfg.quality = next; KMP.set('quality', next); settings = Object.assign({}, settings, parseQ(next));
    reopenVideo().catch(() => {}).then(() => { if (conn && conn.open) conn.send({ t: 'cam-quality', quality: next }); sendInfo(); });
  }

  // ---------- PENGUAT KONEKSI Wi-Fi ----------
  // Aplikasi APK: Wi-Fi HP dikunci mode LATENSI RENDAH (WifiLock LOW_LATENCY / HIGH_PERF → hemat daya Wi-Fi mati, paket tidak
  // ditahan-tahan radio) selama kamera mengirim, plus info sinyal (dBm, 2,4/5 GHz, kecepatan link). Semua versi: bitrate dibatasi
  // kemampuan jalur yang terukur (lihat statistik) & prioritas paket tinggi (DSCP) → real-time, tidak menumpuk antrean.
  const WF = { P: window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.KlmWifi, lock: false, info: null, at: 0, warned: false };
  async function wifiBoost() {
    if (!WF.P) return;
    try {
      if (cfg.boost && started) { const r = await WF.P.start(); WF.lock = !!(r && r.locked); }
      else { await WF.P.stop(); WF.lock = false; }
    } catch (e) { WF.lock = false; }
  }
  async function wifiPoll() {
    if (!WF.P || performance.now() - WF.at < 3500) return; WF.at = performance.now();
    try { WF.info = await WF.P.info(); } catch (e) { WF.info = null; return; }
    const w = WF.info; if (!w || !w.rssi || WF.warned) return;
    const heavy = (settings.height || 1080) >= 1440 || (settings.fps || 30) >= 50;
    if (w.rssi < -72 || (heavy && w.freq && w.freq < 4900)) {
      WF.warned = true;
      KMP.toast(w.rssi < -72 ? 'Sinyal Wi-Fi lemah (' + w.rssi + ' dBm) — dekatkan HP ke router agar video real-time & tidak patah' : 'HP memakai Wi-Fi 2,4 GHz — untuk ' + cfg.quality + ' pakai Wi-Fi 5 GHz agar mulus', 6000);
    }
  }
  window.addEventListener('pagehide', () => { if (WF.P && WF.lock) { try { WF.P.stop(); } catch (e) {} } });

  // ---------- shutter speed, kecerahan & kunci FPS ----------
  // Shutter "tepat" untuk video: ±1/(2×fps) (aturan 180°: blur gerak alami, gerakan tidak patah-patah/strobo) dan kelipatan
  // periode kedip lampu listrik (50 Hz → 1/50, 1/100; 60 Hz → 1/60, 1/120) agar tidak ada garis/kedip dari lampu.
  // Shutter tidak pernah lebih lambat dari 1/fps → kamera tidak bisa lagi memperlambat diri di ruangan redup (fps terjaga).
  // Kecerahan dijaga di sini dengan ISO (AE perangkat lunak, titik tengah lebih berbobot); di tempat sangat terang pada mode
  // otomatis shutter dipercepat. "Bawaan HP": AE kamera sendiri + kunci FPS bila fps turun karena redup (seperti sebelumnya).
  const EX = { manual: false, kind: '', u: 0, uT: 0, iso: 0, t: 0, dark: 0, busy: false, unsup: false, told: false, cv: null, img: null, gen: 0, lastApply: 0, hiccup: 0, slow: false, noManual: false };
  function camCaps() { try { return (vTrack && vTrack.getCapabilities) ? vTrack.getCapabilities() || {} : {}; } catch (e) { return {}; } }
  function expCaps() { const c = camCaps(); return (c.exposureMode || []).includes('manual') && c.exposureTime && c.iso ? c : null; }
  function evCaps() { const c = camCaps(); return c.exposureCompensation && c.exposureCompensation.min < 0 ? c.exposureCompensation : null; }
  const flick = () => 1 / (2 * (+cfg.hz || 50));
  function shutterSec(kind) {
    const fps = settings.fps || 30, max = 0.95 / fps, p = flick();
    if (kind === 'lock') { const n = Math.floor(max / p + 1e-6); return n >= 1 ? n * p : max; }
    if (kind === 'auto') { let n = Math.max(1, Math.round(1 / (2 * fps) / p)); while (n > 1 && n * p > max + 1e-6) n--; return Math.min(n * p, max); }
    const N = +cfg.shutter; return N > 0 ? Math.min(1 / N, max) : max;
  }
  const shutterTxt = (u) => (u ? '1/' + Math.round(10000 / u) : '');
  function exStop() { clearInterval(EX.t); EX.t = 0; EX.img = null; }
  function exReset() { exStop(); EX.gen++; EX.manual = false; EX.kind = ''; EX.u = EX.uT = EX.iso = 0; EX.dark = 0; EX.unsup = false; }
  async function exManual(kind) {
    const c = EX.noManual ? null : expCaps(); if (!c) return false;
    const u = Math.round(Math.max(c.exposureTime.min, Math.min(c.exposureTime.max, shutterSec(kind) * 10000))); // satuan 100 µs
    let iso;
    if (EX.manual && EX.iso && EX.u) iso = EX.iso * EX.u / u; // ganti shutter: kecerahan tetap
    else { let s = {}; try { s = vTrack.getSettings() || {}; } catch (e) {} iso = s.iso && s.exposureTime ? s.iso * s.exposureTime / u : (s.iso || 400); }
    iso = Math.round(Math.max(c.iso.min, Math.min(c.iso.max, iso)));
    try { await vTrack.applyConstraints({ advanced: [{ exposureMode: 'manual', exposureTime: u, iso }] }); } catch (e) { return false; }
    EX.manual = true; EX.kind = kind; EX.u = EX.uT = u; EX.iso = iso; EX.dark = 0; EX.lastApply = performance.now();
    exStop(); EX.t = setInterval(exMeter, 700); exWatch();
    return true;
  }
  async function exAuto() {
    exStop(); const was = EX.manual; EX.manual = false; EX.kind = '';
    const c = Object.assign(was ? { exposureMode: 'continuous' } : {}, evCaps() ? { exposureCompensation: camEv() } : {});
    if (Object.keys(c).length) { try { await vTrack.applyConstraints({ advanced: [c] }); } catch (e) {} }
  }
  // kompensasi EV untuk AE kamera (mode "Bawaan HP"): pilihan kecerahan + penurunan dari kunci FPS cara kedua
  function camEv() { const ev = evCaps(); if (!ev) return 0; return Math.max(ev.min, Math.min(ev.max, (+cfg.bright || 0) + (FG.ev || 0))); }
  /** pilihan shutter diterapkan ke kamera yang sedang menyala (setelah kamera dibuka / pengaturan berubah) */
  async function exApply() {
    if (!vTrack) return;
    const g = ++EX.gen;
    fpsGuardReset(); EX.unsup = false;
    if (cfg.shutter === 'cam') { await exAuto(); sendInfo(); return; }
    if (!EX.manual) await new Promise((r) => setTimeout(r, 700)); // AE kamera menyesuaikan dulu → ISO awal dihitung dari nilai kamera
    if (g !== EX.gen || !vTrack) return;
    if (!(await exManual(cfg.shutter === 'auto' ? 'auto' : 'fixed'))) {
      EX.unsup = true; await exAuto();
      if (!EX.told) { EX.told = true; KMP.toast('Shutter speed tidak bisa diatur di HP ini (kamera/aplikasi tidak mengizinkan) — memakai otomatis HP', 6000); }
    }
    sendInfo();
  }
  async function exLuma() {
    let src = null;
    if (video.srcObject && video.readyState >= 2) src = video;
    else { if (!EX.img && window.ImageCapture) EX.img = new ImageCapture(vTrack); if (EX.img) src = await EX.img.grabFrame(); }
    if (!src) return -1;
    const cv = EX.cv || (EX.cv = document.createElement('canvas')); cv.width = 32; cv.height = 18;
    const g = cv.getContext('2d', { willReadFrequently: true });
    // perkecil di GPU dulu (createImageBitmap) → yang dibaca CPU hanya 32×18 piksel, bukan frame penuh
    let small = null; try { small = await createImageBitmap(src, { resizeWidth: 32, resizeHeight: 18, resizeQuality: 'low' }); } catch (e) {}
    g.drawImage(small || src, 0, 0, 32, 18); if (small) small.close(); if (src.close) src.close();
    const d = g.getImageData(0, 0, 32, 18).data; let s = 0, w = 0;
    for (let i = 0, p = 0; p < d.length; i++, p += 4) { const x = i % 32, y = (i / 32) | 0, k = x > 7 && x < 24 && y > 4 && y < 13 ? 3 : 1; s += (d[p] * 0.2126 + d[p + 1] * 0.7152 + d[p + 2] * 0.0722) * k; w += k; }
    return s / w / 255;
  }
  async function exMeter() {
    if (!EX.manual || EX.busy || !vTrack || vTrack.readyState !== 'live') return;
    EX.busy = true;
    try {
      const luma = await exLuma(); if (!(luma >= 0)) return;
      const c = expCaps(); if (!c || !EX.manual) return;
      const T = 0.42 * Math.pow(2, (+cfg.bright || 0) / 2.2); // sasaran kecerahan rata-rata (sRGB)
      const q = Math.max(0.8, Math.min(1.25, Math.pow(T / Math.max(0.01, luma), 2.2))); // cahaya (linear) yang dibutuhkan, dibatasi per langkah
      if (luma < 0.06 && EX.iso >= c.iso.max * 0.98) { if (++EX.dark === 10) KMP.toast('Ruangan sangat gelap — gambar akan gelap/berbintik. Tambah cahaya agar lebih jelas', 5000); } else EX.dark = 0;
      // tiap perubahan ISO/shutter = permintaan baru ke kamera; di sebagian HP itu membuat gambar tersendat sesaat →
      // diubah hanya bila selisih kecerahan berarti, dan tidak lebih sering dari 1,5 dtk (6 dtk bila HP terbukti tersendat)
      if (Math.abs(Math.log(q)) < (EX.slow ? 0.25 : 0.12) || performance.now() - EX.lastApply < (EX.slow ? 6000 : 1500)) return;
      const E = EX.u * EX.iso * q; let u = EX.u, iso = E / u;
      if (EX.kind === 'auto') {
        if (iso < c.iso.min) { iso = c.iso.min; u = Math.max(c.exposureTime.min, E / iso); } // sangat terang (luar ruangan): shutter dipercepat
        else if (q > 1 && u < EX.uT) { u = Math.min(EX.uT, E / EX.iso); iso = E / u; } // meredup lagi: shutter kembali ke nilai tepat dulu
      }
      iso = Math.round(Math.max(c.iso.min, Math.min(c.iso.max, iso))); u = Math.round(u);
      if (Math.abs(iso - EX.iso) / EX.iso < 0.03 && u === EX.u) return;
      EX.iso = iso; EX.u = u;
      await exSet({ exposureMode: 'manual', exposureTime: u, iso });
    } catch (e) {} finally { EX.busy = false; }
  }
  // ---- penjaga kelancaran: ukur jeda antar-frame kamera; bila mengubah exposure membuat kamera tersendat → kurangi / hentikan ----
  const FM = { last: 0, gap: 0, on: false, hitch: [] };
  function exWatch() {
    if (FM.on || !video.requestVideoFrameCallback) return; FM.on = true;
    const cb = (now) => {
      if (FM.last) { const g = now - FM.last; if (g < 3000) { if (g > FM.gap) FM.gap = g; if (g > Math.max(200, 4000 / (settings.fps || 30))) FM.hitch.push(now); } } // >3 dtk = pratinjau sempat dimatikan
      FM.last = now; video.requestVideoFrameCallback(cb);
    };
    video.requestVideoFrameCallback(cb);
  }
  const frameGap = () => FM.gap;
  async function exSet(c) {
    EX.lastApply = performance.now(); FM.gap = 0;
    await vTrack.applyConstraints({ advanced: [c] }).catch(() => {});
    const g0 = EX.gen;
    setTimeout(() => {
      if (g0 !== EX.gen || !EX.manual) return;
      const lim = Math.max(250, 6000 / (settings.fps || 30)); // ±6 frame tanpa gambar
      if (frameGap() <= lim) return;
      EX.hiccup++;
      if (EX.hiccup === 2) EX.slow = true;
      if (EX.hiccup >= 4 && !EX.noManual) {
        EX.noManual = true; EX.told = true; FG.noManual = true; EX.unsup = true; exAuto();
        KMP.toast('Kamera HP ini tersendat setiap shutter/ISO diubah — dikembalikan ke otomatis HP agar video tetap mulus', 6000);
        sendInfo();
      }
    }, 1300);
  }

  // Kunci FPS (mode "Bawaan HP" / HP tanpa shutter manual): Chrome/Android memilih rentang AE kamera dengan batas bawah serendah
  // mungkin (mis. 8–30 fps) → di ruangan redup kamera memperlambat diri. Bila fps kamera terukur jauh di bawah pilihan:
  // 1) shutter dikunci (kelipatan kedip lampu, ≤ 1/fps) + ISO otomatis; 2) bila HP mengabaikannya: EV diturunkan bertahap.
  const FG = { low: 0, on: false, mode: '', capFps: 0, after: 0, ev: 0, warned: false, noManual: false };
  function fpsGuardReset() { FG.low = 0; FG.on = false; FG.mode = ''; FG.after = 0; FG.ev = 0; FG.noManual = false; }
  async function fpsGuardCheck(capFps) {
    FG.capFps = capFps;
    if (!cfg.fpsLock || !vTrack || !capFps) return;
    if (EX.manual && EX.kind !== 'lock') return; // shutter diatur (≤ 1/fps): kamera tidak bisa memperlambat diri
    if (cfg.shutter !== 'cam' && !EX.unsup) return;
    const target = settings.fps || 30, low = capFps < target * 0.85;
    if (FG.on && FG.mode === 'manual') {
      // shutter sudah ≤ 1/fps tetapi fps kamera tetap rendah ±8 detik → HP mengabaikannya: pakai cara kedua (EV)
      FG.after = low ? FG.after + 1 : 0;
      if (FG.after >= 4) { await fpsGuardOff(''); FG.low = 0; FG.noManual = true; }
      return;
    }
    FG.low = low ? FG.low + 1 : 0;
    if (FG.low < 2) return; // 2 pengukuran berturut-turut (±4 detik)
    FG.low = 0;
    if (!FG.noManual && !FG.on) {
      if (await exManual('lock')) {
        FG.on = true; FG.mode = 'manual'; FG.after = 0;
        KMP.toast('Cahaya redup: FPS dikunci ' + target + ' (shutter ' + shutterTxt(EX.u) + ') — kecerahan diatur otomatis', 3500);
        sendInfo(); return;
      }
      FG.noManual = true;
    }
    // cara kedua: turunkan target kecerahan AE (EV) sedikit demi sedikit → AE memilih ISO lebih tinggi, bukan memperlambat kamera
    const ev = evCaps();
    if (ev) {
      const step = Math.max(ev.step || 0.5, 0.5), next = Math.max(-2, Math.round((FG.ev - step) * 100) / 100);
      if (next < FG.ev - 0.01 && (+cfg.bright || 0) + next >= ev.min - 0.01) {
        const was = FG.ev; FG.ev = next;
        try {
          await vTrack.applyConstraints({ advanced: [{ exposureMode: 'continuous', exposureCompensation: camEv() }] });
          FG.on = true; FG.mode = 'ev';
          KMP.toast('Cahaya redup: kecerahan diturunkan (EV ' + next + ') agar FPS ' + target + ' tetap terjaga', 3000);
          sendInfo(); return;
        } catch (e) { FG.ev = was; }
      }
    }
    if (!FG.warned) { FG.warned = true; KMP.toast('FPS turun karena cahaya kurang. HP ini tidak mengizinkan exposure diatur dari aplikasi — tambah cahaya agar ' + target + ' fps tercapai', 6000); }
    if (!FG.on) FG.low = -1000;
  }
  async function fpsGuardOff(why) {
    const was = FG.mode; FG.on = false; FG.mode = ''; FG.low = -1000; FG.ev = 0;
    if (was === 'manual' && EX.kind === 'lock') await exAuto();
    else if (was === 'ev') { try { await vTrack.applyConstraints({ advanced: [{ exposureMode: 'continuous', exposureCompensation: camEv() }] }); } catch (e) {} }
    if (why) KMP.toast('Kunci FPS dilepas: ' + why, 3500);
    sendInfo();
  }

  // kamera → trek keluaran (yang dikirim ke PC & tampil di pratinjau HP). Stabilisasi digital (EIS) dihapus: langsung trek kamera
  // (paling ringan & tanpa jeda tambahan; OIS lensa HP tetap bekerja sendiri).
  let outTrack = null;
  const wrapTrack = (t) => t;
  async function useOut(t) {
    outTrack = t;
    if (!document.body.classList.contains('dim')) { video.srcObject = new MediaStream([outTrack]); video.play().catch(() => {}); }
    const snd = pc && pc.getTransceivers().map((x) => x.sender).find((s) => s.track ? s.track.kind === 'video' : false);
    if (snd) { try { await snd.replaceTrack(outTrack); } catch (e) { console.warn(e); } }
    await tuneSender();
  }
  /** pilihan shutter / listrik / kecerahan / ringan otomatis / penguat Wi-Fi (dari pengaturan HP atau panel KLMCAM di PC) */
  async function setCamOpt(o) {
    if (!o || typeof o !== 'object') return;
    const before = { shutter: cfg.shutter, hz: cfg.hz, bright: cfg.bright };
    if (typeof o.auto === 'boolean') { cfg.auto = o.auto; KMP.set('autoLite', cfg.auto); }
    if (typeof o.boost === 'boolean') { cfg.boost = o.boost; KMP.set('wifiBoost', cfg.boost); wifiBoost(); }
    if (o.shutter != null && SHUTTERS.includes(String(o.shutter))) cfg.shutter = String(o.shutter);
    if (o.hz != null && ['50', '60'].includes(String(o.hz))) cfg.hz = String(o.hz);
    if (o.bright != null && isFinite(+o.bright)) cfg.bright = Math.max(-2, Math.min(2, +o.bright));
    KMP.set('shutter', cfg.shutter); KMP.set('hz', cfg.hz); KMP.set('bright', cfg.bright);
    if (vTrack) {
      if (cfg.shutter !== before.shutter || cfg.hz !== before.hz) await exApply();
      else if (cfg.bright !== before.bright && !EX.manual && evCaps()) { try { await vTrack.applyConstraints({ advanced: [{ exposureCompensation: camEv() }] }); } catch (e) {} }
    }
    sendInfo();
  }

  // ---------- WebRTC ----------
  async function startPeer() {
    if (pc) { try { pc.close(); } catch (e) {} }
    pc = new RTCPeerConnection({ iceServers: iceCfg, bundlePolicy: 'max-bundle', iceCandidatePoolSize: iceCfg.length ? 2 : 0 });
    const me = pc; netRate = 1; clearTimeout(discT);
    const ms = new MediaStream([outTrack || vTrack].concat(aTrack ? [aTrack] : []));
    const vt = pc.addTransceiver(outTrack || vTrack, { direction: 'sendonly', streams: [ms] });
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
    setTimeout(() => sendZoom(true), 500); // PC langsung tahu jenis & rentang zoom HP ini
  }

  async function onMsg(m) {
    switch (m.t) {
      case 'locked': if (conn) conn.closed = true; setStatus('closed'); KMP.toast('🔒 ' + (m.msg || 'KLMCAM memerlukan lisensi KLM'), 15000); break;
      case 'welcome': setStatus(m.mixer ? 'open' : 'nomixer'); break;
      case 'mixer-gone': setStatus('nomixer'); setTally('off'); if (pc) { pc.close(); pc = null; } break;
      case 'cam-start': {
        iceCfg = Array.isArray(m.ice) ? m.ice : [];
        const ch = m.settings ? adoptSettings(m.settings) : false;
        if (!vTrack) await startMedia(); else if (ch) { try { await reopenVideo(); } catch (e) {} }
        await startPeer(); qPending = false; break;
      }
      case 'signal':
        if (!pc) return;
        try {
          if (m.data.sdp) {
            let d = m.data.sdp;
            // batas bitrate awal/minimum dibaca pengirim dari jawaban PC (bukan dari offer sendiri) → gambar langsung tajam & lancar
            if (d.type === 'answer' && d.sdp) {
              const kb = Math.round((settings.bitrate || 6000) * netRate);
              d = { type: 'answer', sdp: d.sdp.replace(/(a=fmtp:\d+ [^\r\n]*profile-level-id=[0-9a-fA-F]+[^\r\n]*)/g, (l) => /x-google-start-bitrate/.test(l) ? l : l + ';x-google-start-bitrate=' + Math.round(kb * 0.75) + ';x-google-min-bitrate=' + Math.min(2500, Math.round(kb * 0.3)) + ';x-google-max-bitrate=' + kb) };
            }
            await pc.setRemoteDescription(d);
          } else if (m.data.ice) await pc.addIceCandidate(m.data.ice);
        } catch (e) { console.warn(e); }
        break;
      case 'cam-ctl':
        if (m.cmd === 'zoom') applyZoom(+m.value);
        else if (m.cmd === 'torch') setTorch(!!m.value);
        else if (m.cmd === 'switch') flip(m.value);
        else if (m.cmd === 'focus') focusAuto();
        else if (m.cmd === 'settings') applySettings(m.value);
        else if (m.cmd === 'camopt') setCamOpt(m.value);
        break;
      case 'tally': setTally(m.state); break;
    }
  }

  /** sambungan sinyal lewat internet (NetLink) dengan antarmuka yang sama seperti sambungan WiFi lokal */
  function netConnect() {
    const st = { open: false, closed: false, room: null, hello: 0, gotMixer: false };
    const info = () => ({ t: 'hello', role: 'camera', name: cfg.name, slot: +cfg.slot, meta: { ua: navigator.userAgent, net: true, quality: qPending ? cfg.quality : '' } });
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
    conn = KMP.connect('camera', () => ({ name: cfg.name, slot: +cfg.slot, meta: { ua: navigator.userAgent, quality: qPending ? cfg.quality : '' } }), { status: setStatus, message: onMsg });
  }

  // ---------- statistik ----------
  setInterval(async () => {
    if (!vTrack) return;
    const s = vTrack.getSettings ? vTrack.getSettings() : {};
    let fps = s.frameRate ? Math.round(s.frameRate) : settings.fps, loss = 0, rtt = 0, capFps = 0, limit = '', avail = 0, encFps = 0;
    if (pc) {
      try {
        const st = await pc.getStats();
        st.forEach((r) => {
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            const now = r.timestamp; if (lastT) kbps = Math.round((r.bytesSent - lastBytes) * 8 / (now - lastT));
            lastBytes = r.bytesSent; lastT = now; if (r.framesPerSecond) { fps = Math.round(r.framesPerSecond); encFps = fps; }
            if (r.qualityLimitationReason && r.qualityLimitationReason !== 'none') limit = r.qualityLimitationReason;
          }
          if (r.type === 'media-source' && r.kind === 'video' && r.framesPerSecond) capFps = Math.round(r.framesPerSecond); // fps kamera sebenarnya
          if (r.type === 'remote-inbound-rtp' && r.kind === 'video') { loss = r.fractionLost || 0; rtt = Math.round((r.roundTripTime || 0) * 1000); }
          if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.availableOutgoingBitrate) avail = Math.round(r.availableOutgoingBitrate / 1000);
        });
        // jaringan berat (paket hilang / jeda tinggi) → turunkan bitrate agar gerakan tetap mulus & latensi tidak menumpuk; pulih perlahan
        const before = netRate, beforeCap = availCap;
        if (loss > 0.08 || rtt > 450) netRate = Math.max(0.2, netRate * 0.7);
        else if (loss < 0.02 && rtt < 200) netRate = Math.min(1, netRate * 1.15);
        // PENGUAT KONEKSI: bitrate tidak melebihi ±85% kemampuan jalur Wi-Fi yang terukur → paket tidak mengantre di router/HP
        // (antrean = gambar telat & patah). Batas ikut naik lagi saat jaringan membaik.
        availCap = cfg.boost && avail > 300 ? Math.round(avail * 0.85) : 0;
        if (Math.abs(netRate - before) > 0.01 || Math.abs(availCap - beforeCap) > Math.max(300, beforeCap * 0.1)) tuneSender();
      } catch (e) {}
    }
    fpsGuardCheck(capFps || fps);
    autoLite(limit, encFps, capFps);
    const hitch = (FM.hitch = FM.hitch.filter((t) => performance.now() - t < 60000)).length;
    const exTxt = EX.manual ? shutterTxt(EX.u) + ' ISO ' + EX.iso : '';
    if (cfg.boost) await wifiPoll();
    const wf = WF.info, wTxt = wf && wf.rssi ? '📶 ' + wf.rssi + ' dBm' + (wf.freq ? ' • ' + (wf.freq >= 4900 ? '5 GHz' : '2,4 GHz') : '') + (wf.link ? ' • ' + wf.link + ' Mbps' : '') + (WF.lock ? ' • ⚡ penguat aktif' : '') : (cfg.boost && WF.lock ? '⚡ penguat Wi-Fi aktif' : '');
    $('stats').innerHTML = (s.width || '?') + '×' + (s.height || '?') + ' • ' + fps + '/' + settings.fps + ' fps' + (FG.on ? ' 🔒' : '') + (limit ? ' (' + (limit === 'cpu' ? 'HP berat' : limit === 'bandwidth' ? 'WiFi' : limit) + ')' : '')
      + (exTxt || hitch ? '<br>' + [exTxt, hitch ? '⚠ tersendat ' + hitch + '×/mnt' : ''].filter(Boolean).join(' • ') : '')
      + '<br>' + (pc ? kbps + ' kbps' + (rtt ? ' • ' + rtt + ' ms' : '') + (netRate < 0.99 ? ' • hemat ' + Math.round(netRate * 100) + '%' : '') : '') + (wTxt ? '<br>' + wTxt : '') + (battery != null ? '<br>🔋 ' + battery + '%' : '');
    lastInfo = { w: s.width, h: s.height, fps, capFps: capFps || 0, want: settings.fps, limit, fpsLock: FG.on || EX.manual, kbps, battery, rtt, loss: Math.round(loss * 100), net: !!cfg.room,
      shutter: EX.manual ? shutterTxt(EX.u) : '', iso: EX.manual ? EX.iso : 0, hitch, avail,
      wifi: wf ? { rssi: wf.rssi || 0, freq: wf.freq || 0, link: wf.link || 0, lock: !!WF.lock } : (WF.lock ? { lock: true } : null),
      opt: { shutter: cfg.shutter, hz: cfg.hz, bright: cfg.bright, shutterOk: !EX.unsup && !!expCaps(), auto: cfg.auto, boost: cfg.boost, boostNative: !!WF.P } };
    sendInfo();
  }, 2000);
  let lastInfo = {};
  function sendInfo() {
    if (!conn || !conn.open) return; const zc = zoomCaps();
    conn.send({ t: 'cam-info', info: Object.assign({}, lastInfo, { facing: cfg.facing, quality: cfg.quality, zoom: { hw: !!zc, min: zc ? zc.min : 1, max: zc ? zc.max : DZ_MAX, v: +(+currentZoom()).toFixed(2) } }) });
  }
  if (navigator.getBattery) navigator.getBattery().then((b) => { const u = () => { battery = Math.round(b.level * 100); }; u(); b.addEventListener('levelchange', u); }).catch(() => {});

  // ---------- tombol ----------
  $('home').onclick = () => { location.href = KMP.page('hp'); };
  $('flip').onclick = () => flip();
  $('torch').onclick = () => setTorch(!torchOn);
  $('mic').onclick = () => { cfg.mic = !cfg.mic; if (aTrack) aTrack.enabled = cfg.mic; $('mic').textContent = cfg.mic ? '🎤' : '🔇'; KMP.toast(cfg.mic ? 'Mic aktif' : 'Mic dimatikan'); };
  $('focus').onclick = focusAuto;
  $('zoom').oninput = (e) => applyZoom(+e.target.value);
  $('full').onclick = async () => { try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch (e) {} };
  $('hideUi').onclick = (e) => { e.stopPropagation(); document.body.classList.add('hide'); KMP.toast('Ketuk layar untuk menampilkan tombol'); };
  video.addEventListener('click', () => document.body.classList.remove('hide'));
  // hemat baterai: berhenti menggambar preview lokal (encoder tetap jalan)
  $('dim').onclick = (e) => { e.stopPropagation(); document.body.classList.add('dim', 'hide'); video.srcObject = null; };
  $('dimMsg').onclick = () => { document.body.classList.remove('dim', 'hide'); if (outTrack || vTrack) { video.srcObject = new MediaStream([outTrack || vTrack]); video.play().catch(() => {}); } };

  // ---------- pengaturan ----------
  const slotSel = $('sSlot');
  for (let i = 1; i <= 10; i++) slotSel.appendChild(new Option('Slot ' + i, i));
  function openPanel() {
    $('srvBox').style.display = KMP.servedByPc || KMP.hosted ? 'none' : ''; $('sRoom').value = cfg.room || '';
    $('sSrv').value = KMP.get('server', ''); $('sName').value = cfg.name; slotSel.value = cfg.slot; $('sFacing').value = cfg.facing; $('sQual').value = cfg.quality;
    $('sNs').checked = !!cfg.ns; $('sMirror').checked = !!cfg.mirror; $('sFpsLock').checked = !!cfg.fpsLock;
    $('sAuto').checked = !!cfg.auto; $('sBoost').checked = !!cfg.boost; $('sShutter').value = cfg.shutter; $('sHz').value = cfg.hz; $('sBright').value = String(cfg.bright); shutNote();
    $('panel').classList.add('show');
  }
  // keterangan shutter yang akan dipakai untuk fps & listrik yang dipilih di panel
  function shutNote() {
    const fps = (parseQ($('sQual').value) || settings).fps || 30, sh = $('sShutter').value, hz = +$('sHz').value || 50;
    const old = { s: cfg.shutter, h: cfg.hz, f: settings.fps }; cfg.shutter = sh; cfg.hz = String(hz); settings.fps = fps;
    const sec = sh === 'cam' ? shutterSec('lock') : shutterSec(sh === 'auto' ? 'auto' : 'fixed'); cfg.shutter = old.s; cfg.hz = old.h; settings.fps = old.f;
    const t = '1/' + Math.round(1 / sec);
    $('sShutNote').textContent = sh !== 'cam' && EX.unsup ? 'HP/aplikasi ini tidak mengizinkan shutter diatur — kamera memakai otomatis HP (kunci FPS tetap bekerja bila didukung).' : sh === 'cam' ? 'Kamera mengatur sendiri. Bila fps turun karena redup, shutter dikunci ' + t + ' (pilihan "Kunci FPS").'
      : sh === 'auto' ? 'Untuk ' + fps + ' fps & listrik ' + hz + ' Hz: shutter ' + t + ' — gerak natural, tanpa kedip lampu. ISO diatur otomatis.'
      : (Math.abs(1 / sec - +sh) > 1 ? 'Shutter 1/' + sh + ' lebih lambat dari 1/' + fps + ' (batas ' + fps + ' fps) → dipakai ' + t + '. ' : 'Shutter ' + t + '. ') + (!(Math.round(2 * hz * sec) >= 1 && Math.abs(2 * hz * sec - Math.round(2 * hz * sec)) < 0.03) ? 'Di bawah lampu listrik ' + hz + ' Hz bisa muncul garis/kedip — pilih ' + (hz === 50 ? '1/50 atau 1/100' : '1/60 atau 1/120') + ' bila terjadi. ' : '') + 'ISO diatur otomatis.';
  }
  ['sShutter', 'sHz', 'sQual'].forEach((id) => { $(id).addEventListener('change', shutNote); });
  $('openSet').onclick = openPanel; $('startSet').onclick = openPanel;
  $('sCancel').onclick = () => $('panel').classList.remove('show');
  $('sSave').onclick = async () => {
    const before = { srv: KMP.get('server', ''), room: cfg.room, name: cfg.name, slot: cfg.slot, facing: cfg.facing, quality: cfg.quality, ns: cfg.ns };
    if (!KMP.servedByPc) KMP.set('server', $('sSrv').value.trim());
    cfg.room = $('sRoom').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); KMP.set('room', cfg.room);
    cfg.name = $('sName').value.trim() || KMP.deviceName(); cfg.slot = +slotSel.value; cfg.ns = $('sNs').checked; cfg.mirror = $('sMirror').checked;
    const facing = $('sFacing').value, quality = $('sQual').value;
    KMP.set('camname', cfg.name); KMP.set('slot', cfg.slot); KMP.set('ns', cfg.ns); KMP.set('mirror', cfg.mirror);
    const fl = $('sFpsLock').checked; if (fl !== cfg.fpsLock) { cfg.fpsLock = fl; KMP.set('fpsLock', fl); if (!fl && FG.on) fpsGuardOff(''); else if (fl) FG.low = 0; }
    setCamOpt({ auto: $('sAuto').checked, boost: $('sBoost').checked, shutter: $('sShutter').value, hz: $('sHz').value, bright: +$('sBright').value });
    $('panel').classList.remove('show');
    const qChanged = quality !== before.quality;
    if (qChanged) { cfg.quality = quality; KMP.set('quality', quality); settings = Object.assign({}, settings, parseQ(quality)); qPending = true; }
    labels();
    if (!started) { if (facing !== cfg.facing) { cfg.facing = facing; KMP.set('facing', facing); labels(); } return; }
    const reconnect = KMP.get('server', '') !== before.srv || cfg.room !== before.room || cfg.name !== before.name || cfg.slot !== before.slot;
    try {
      if (cfg.ns !== before.ns) { if (aTrack) aTrack.stop(); aTrack = await openAudio(); if (aTrack) aTrack.enabled = cfg.mic; const as = pc && pc.getSenders().find((x) => x.track && x.track.kind === 'audio'); if (as && aTrack) await as.replaceTrack(aTrack); }
      if (facing !== cfg.facing || qChanged) await reopenVideo(facing);
    } catch (e) {}
    // kualitas dipilih di HP → PC ikut (input KLMCAM di PC diperbarui, PC membalas dengan bitrate miliknya)
    if (qChanged && conn && conn.open && !reconnect) conn.send({ t: 'cam-quality', quality });
    if (reconnect) connect();
  };

  $('startBtn').onclick = async () => {
    if (!cfg.room && !KMP.servedByPc && !KMP.server().host) { openPanel(); KMP.toast(KMP.hosted ? 'Isi kode internet dari panel KLMCAM di PC' : 'Isi IP PC (satu WiFi) atau kode internet'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { KMP.toast('Kamera butuh HTTPS. Buka lewat alamat https://… atau pakai aplikasi APK.', 5000); return; }
    try { await startMedia(); } catch (e) { KMP.toast('Izin kamera ditolak: ' + e.name, 4000); return; }
    started = true; $('start').style.display = 'none';
    KMP.wakeLock(); wifiBoost();
    if ((settings.height || 0) >= 1440 && ((navigator.deviceMemory && navigator.deviceMemory <= 3) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4))) KMP.toast('HP ini mungkin berat untuk ' + cfg.quality + ' — bila tersendat, kualitas diturunkan otomatis', 5000);
    connect();
    try { await document.documentElement.requestFullscreen(); await screen.orientation.lock('landscape'); } catch (e) {}
  };
  labels();
  if (KMP.get('autostart', false)) $('startBtn').click();
})();
