/* KLM - Rekam (MP4/WebM), Streaming (RTMP/RTMPS/SRT multi-tujuan via ffmpeg), MultiCorder, Snapshot */
'use strict';
(function (KM) {
  const S = KM.state;
  const R = KM.rec = { recT0: 0, streamT0: 0, stats: null, mc: [] };
  // fps tinggi butuh bitrate lebih besar agar gerakan tetap tajam (60 fps ≈ 1,5×, 120 fps = 2×)
  R.fpsScale = () => { const f = KM.settings.fps || 30; return f > 30 ? Math.min(2, 0.5 + f / 60) : 1; };

  function pickMime(pref) {
    // utamakan H.264 (kompatibel dengan editor video), lalu AAC bila tersedia
    const list = {
      mp4: ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus'],
      webm: ['video/webm;codecs=h264,opus', 'video/x-matroska;codecs=avc1,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    };
    const order = pref === 'webm' ? list.webm.concat(list.mp4, ['video/mp4']) : list.mp4.concat(list.webm.slice(0, 2), ['video/mp4'], list.webm.slice(2));
    return order.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
  }
  R.pickMime = pickMime;
  const ext = (mime) => (mime.startsWith('video/mp4') ? 'mp4' : mime.includes('matroska') ? 'mkv' : 'webm');

  function mixStream(audioBus) {
    const v = KM.engine.programStream().getVideoTracks();
    const bus = audioBus || ({ A: 'A', B: 'B' }[KM.settings.recSource] || 'M');
    const a = KM.audio.streamOf(bus).getAudioTracks();
    return new MediaStream([...v, ...a]);
  }

  /** penulis file: Electron → langsung ke disk; browser → kumpulkan lalu unduh */
  async function makeWriter(name, folderKind) {
    if (KM.isElectron) {
      const folder = await KM.defaultFolder(folderKind || 'rec');
      const path = KM.joinPath(folder, name);
      const id = await window.klm.invoke('file:open-writer', path);
      let q = Promise.resolve();
      return {
        path,
        write: (blob) => { q = q.then(async () => window.klm.send('file:write-chunk', id, await blob.arrayBuffer())); },
        close: async () => { await q; await window.klm.invoke('file:close-writer', id); return path; }
      };
    }
    const chunks = [];
    return { path: name, write: (b) => chunks.push(b), close: async () => { KM.downloadBlob(new Blob(chunks), name); return name; } };
  }

  // ---------- REKAM ----------
  // output native (mesin video native): Program dikodekan langsung di GPU, kanvas Program JS tidak perlu dicat
  const nativeOk = () => !!(KM.nengine && KM.nengine.outWhy && KM.isElectron && KM.nengine.outWhy() === '');
  R.startRecording = async function () {
    if (S.recording) return true;
    if (nativeOk()) {
      try {
        const name = 'KLM-' + KM.stamp() + '.mp4', folder = await KM.defaultFolder('rec'), path = KM.joinPath(folder, name);
        const x = await KM.nengine.outStart('file', { path, vk: KM.settings.recVideoKbps * R.fpsScale(), ak: KM.settings.recAudioKbps, bus: { A: 'A', B: 'B' }[KM.settings.recSource] || 'M' });
        x.path = path;
        x.onEnd = (y) => { if (R.recNative !== y.id) return; R.recNative = null; S.recording = false; KM.toast('Rekaman native berhenti' + (y.err ? ': ' + y.err : '') + ' — tersimpan: ' + path, y.err ? 'warn' : 'ok', 7000); R.lastRecording = path; KM.changed('rec'); };
        R.recNative = x.id; R.recT0 = Date.now(); S.recording = true;
        R.recDone = new Promise((r) => { R.recDoneRes = r; });
        KM.toast('● Merekam (mesin native, ' + (x.hw ? 'GPU ' : '') + (x.enc || 'H.264') + ') ke ' + name, 'rec');
        KM.changed('rec');
        return true;
      } catch (e) { R.nativeErr = e.message; KM.toast('Rekam native gagal (' + e.message + ') — memakai perekam biasa', 'warn', 6000); }
    }
    const mime = pickMime(KM.settings.recFormat);
    if (!mime) { KM.toast('Browser tidak mendukung perekaman', 'err'); return false; }
    const name = 'KLM-' + KM.stamp() + '.' + ext(mime);
    const w = await makeWriter(name, 'rec');
    const mr = new MediaRecorder(mixStream(), { mimeType: mime, videoBitsPerSecond: Math.round(KM.settings.recVideoKbps * 1000 * R.fpsScale()), audioBitsPerSecond: KM.settings.recAudioKbps * 1000 });
    mr.ondataavailable = (e) => { if (e.data && e.data.size) w.write(e.data); };
    let recRes; R.recDone = new Promise((r) => { recRes = r; }); // selesai = file sudah ditutup di disk
    mr.onstop = async () => { let p = ''; try { p = await w.close(); KM.toast('Rekaman tersimpan: ' + p, 'ok', 5000); R.lastRecording = p; KM.changed('rec'); } finally { recRes(p); } };
    mr.onerror = (e) => KM.toast('Error rekam: ' + (e.error && e.error.message), 'err');
    mr.start(1000);
    R.recorder = mr; R.recT0 = Date.now(); S.recording = true;
    KM.toast('● Merekam ke ' + name, 'rec');
    KM.changed('rec');
    return true;
  };
  R.stopRecording = function () {
    if (!S.recording) return true;
    if (R.recNative) {
      const id = R.recNative, x = KM.nengine.outs.get(id), path = x && x.path; R.recNative = null; S.recording = false; KM.changed('rec');
      KM.nengine.outStop(id).then((y) => { KM.toast('Rekaman tersimpan: ' + path + (y && y.frames ? ' (' + y.frames + ' frame' + (y.skipped ? ', ' + y.skipped + ' terlewat' : '') + ')' : ''), 'ok', 5000); R.lastRecording = path; KM.changed('rec'); if (R.recDoneRes) R.recDoneRes(path); });
      return true;
    }
    try { R.recorder.stop(); } catch (e) {}
    R.recorder = null; S.recording = false; KM.changed('rec');
    return true;
  };
  R.toggleRecording = () => (S.recording ? R.stopRecording() : R.startRecording());

  // ---------- ENCODER HARDWARE (dideteksi sekali) ----------
  R.encoders = null;
  R.detectEncoders = async function () {
    if (R.encoders) return R.encoders;
    try { R.encoders = await (await fetch('/hub/encoders')).json(); } catch (e) { R.encoders = { best: 'x264' }; }
    return R.encoders;
  };
  const H264_WEBM = ['video/webm;codecs=h264,opus', 'video/x-matroska;codecs=avc1,opus'];

  /** buka koneksi WebSocket ke hub + MediaRecorder program → ffmpeg */
  function openHubOut(kind, init, onMsg) {
    return new Promise((resolve) => {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/hub/out');
      ws.binaryType = 'arraybuffer';
      let done = false;
      ws.onopen = () => ws.send(JSON.stringify(Object.assign({ kind }, init)));
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (!done && (m.t === 'started' || m.t === 'error')) { done = true; resolve({ ws, ok: m.t === 'started', msg: m.msg }); }
        onMsg && onMsg(m);
      };
      ws.onerror = () => { if (!done) { done = true; resolve({ ok: false, msg: 'Hub media tidak tersedia (jalankan versi PC atau npm run web)' }); } };
      ws.onclose = () => onMsg && onMsg({ t: 'closed' });
    });
  }
  function pipeRecorder(ws, stream, mime, vbps, slice) {
    const opts = { mimeType: mime, videoBitsPerSecond: vbps, audioBitsPerSecond: 192000 };
    opts.videoKeyFrameIntervalDuration = 2000;
    const mr = new MediaRecorder(stream, opts);
    mr.ondataavailable = async (e) => {
      if (!e.data || !e.data.size || ws.readyState !== 1) return;
      if (ws.bufferedAmount > 16e6) { R.dropped = (R.dropped || 0) + 1; return; } // jaringan lambat: jangan menumpuk memori
      ws.send(await e.data.arrayBuffer());
    };
    mr.start(slice || 100);
    return mr;
  }

  // ---------- STREAMING ----------
  R.startStreaming = async function () {
    if (S.streaming) return true;
    const sc = KM.settings.stream;
    if (R.starting) return false;
    let dests;
    if (KM.live) { // akun live (panel Live): bisa banyak akun, judul/deskripsi/thumbnail via API
      R.starting = true;
      let p = null; try { p = await KM.live.prepare(); } finally { R.starting = false; }
      if (!p) return false;
      dests = p.dests;
    } else {
      dests = sc.destinations.filter((d) => d.enabled && (d.url || '').trim()).map((d) => ({ enabled: true, url: joinKey(d.url.trim(), (d.key || '').trim()) }));
      if (!dests.length) { KM.toast('Isi URL & stream key dulu di Pengaturan Streaming', 'warn'); KM.ui && KM.ui.openSettings('stream'); return false; }
    }
    if (nativeOk()) { // output native: MPEG-TS H.264+AAC dari mesin native → ffmpeg -c copy
      const cfgN = { encoder: 'copy', inputFormat: 'mpeg', videoBitrate: sc.videoBitrate, audioBitrate: sc.audioBitrate, fps: KM.settings.fps, destinations: dests };
      let rN = null, xN = null;
      try {
        rN = await openHubOut('stream', { cfg: cfgN, native: true }, (m) => {
          if (m.t === 'stats') { R.stats = m; KM.emit('stream-stats', m); }
          else if (m.t === 'log') { R.log = ((R.log || '') + m.msg).slice(-6000); KM.emit('stream-log', m.msg); }
          else if ((m.t === 'ended' || m.t === 'closed') && S.streaming && R.streamNative) { KM.toast('Streaming terputus. Cek internet / stream key (lihat log di Pengaturan > Streaming).', 'err', 7000); R.stopStreaming(true); }
        });
        if (!rN.ok) throw new Error(rN.msg || 'hub');
        xN = await KM.nengine.outStart('ts', { vk: sc.videoBitrate, ak: sc.audioBitrate, cbr: true, bus: 'M' });
        xN.onEnd = (y) => { if (R.streamNative === y.id && S.streaming) { KM.toast('Output native berhenti' + (y.err ? ': ' + y.err : ''), 'err', 7000); R.stopStreaming(true); } };
        S.streaming = true; R.streamWs = rN.ws; R.streamNative = xN.id; R.streamer = null;
        R.streamT0 = Date.now(); R.streamEncoder = 'native';
        KM.toast('● LIVE — streaming dimulai (mesin native, ' + (xN.hw ? 'GPU ' : '') + (xN.enc || 'H.264') + ')', 'rec', 4000);
        KM.changed('stream');
        return true;
      } catch (e) {
        try { rN && rN.ws && rN.ws.close(); } catch (x) {}
        R.nativeErr = e.message; KM.toast('Streaming native gagal (' + e.message + ') — memakai jalur biasa', 'warn', 6000);
      }
    }
    const h264 = H264_WEBM.find((m) => MediaRecorder.isTypeSupported(m));
    const mime = h264 || 'video/webm;codecs=vp8,opus';
    let encoder = sc.encoder || 'auto';
    if (encoder === 'auto') encoder = h264 ? 'copy' : (await R.detectEncoders()).best;
    if (encoder === 'copy' && !h264) encoder = (await R.detectEncoders()).best;
    const copy = encoder === 'copy';
    const vbps = copy ? sc.videoBitrate * 1000 : Math.round(Math.max(sc.videoBitrate * 2500, 8000000) * R.fpsScale());
    const cfg = { encoder, preset: sc.preset, videoBitrate: sc.videoBitrate, audioBitrate: sc.audioBitrate, fps: KM.settings.fps, destinations: dests };
    const r = await openHubOut('stream', { cfg }, (m) => {
      if (m.t === 'stats') { R.stats = m; KM.emit('stream-stats', m); }
      else if (m.t === 'log') { R.log = ((R.log || '') + m.msg).slice(-6000); KM.emit('stream-log', m.msg); }
      else if ((m.t === 'ended' || m.t === 'closed') && S.streaming) {
        KM.toast('Streaming terputus. Cek internet / stream key (lihat log di Pengaturan > Streaming).', 'err', 7000);
        R.stopStreaming(true);
      }
    });
    if (!r.ok) { KM.toast('Gagal streaming: ' + r.msg, 'err', 6000); if (KM.live) KM.live.finish(); return false; }
    S.streaming = true;
    R.streamWs = r.ws;
    R.streamer = pipeRecorder(r.ws, mixStream('M'), mime, vbps, 100);
    R.streamT0 = Date.now(); R.streamEncoder = encoder;
    KM.toast('● LIVE — streaming dimulai (encoder: ' + ({ copy: 'H.264 langsung / ringan', nvenc: 'NVIDIA', qsv: 'Intel QuickSync', amf: 'AMD', x264: 'x264 CPU' }[encoder] || encoder) + ')', 'rec', 4000);
    KM.changed('stream');
    return true;
  };
  function joinKey(url, key) {
    if (!key) return url;
    if (/^srt:/i.test(url)) return url + (url.includes('?') ? '&' : '?') + 'streamid=' + encodeURIComponent(key);
    return url.replace(/\/+$/, '') + '/' + key;
  }
  R.stopStreaming = async function (silent) {
    if (!S.streaming) return true;
    S.streaming = false;
    if (R.streamNative) { const id = R.streamNative; R.streamNative = null; KM.nengine.outStop(id); }
    try { R.streamer && R.streamer.stop(); } catch (e) {}
    setTimeout(() => { try { R.streamWs && R.streamWs.close(); } catch (e) {} R.streamWs = null; }, 400);
    R.streamer = null; R.stats = null;
    if (KM.live) R.liveEnd = KM.live.finish(); // akhiri siaran YouTube/Facebook yang dibuat lewat API
    if (silent !== true) KM.toast('Streaming dihentikan');
    KM.changed('stream');
    return true;
  };
  R.toggleStreaming = () => (S.streaming ? R.stopStreaming() : R.startStreaming());

  // ---------- SRT CALLER → GATEWAY / DECODER TV (realtime) ----------
  R.srtStatus = 'off'; R.srtMsg = ''; R.srtStats = null; R.srtLog = '';
  R.srtCfg = () => KM.settings.srt || (KM.settings.srt = {});
  R.startSrt = async function () {
    if (S.srt) return true;
    const c = R.srtCfg();
    if (c.mode !== 'listener' && !String(c.host || '').trim()) {
      if (KM.isElectron && !c.streamid) return R.tvConnect(); // belum diatur → langsung sambungkan ke Layar TV Masjid
      KM.toast('Isi IP / host gateway SRT dulu', 'warn'); KM.dialogs.settings('srt'); return false;
    }
    // gateway Layar TV di PC ini: pastikan pengawasnya berjalan (gateway menyala sendiri selama KLM terbuka)
    if (KM.isElectron && c.streamid === 'publish:klm' && /^(127\.0\.0\.1|localhost)$/.test(String(c.host).trim())) window.klm.invoke('tvgw:ensure').catch(() => {});
    if (c.passphrase && (c.passphrase.length < 10 || c.passphrase.length > 79)) { KM.toast('Passphrase SRT harus 10–79 karakter', 'warn'); KM.dialogs.settings('srt'); return false; }
    const h264 = H264_WEBM.find((m) => MediaRecorder.isTypeSupported(m));
    let encoder = c.encoder || 'auto';
    if (encoder === 'auto') { const e = await R.detectEncoders(); encoder = e.nvenc ? 'nvenc' : e.qsv ? 'qsv' : e.amf ? 'amf' : 'x264'; }
    if (encoder === 'copy' && !h264) encoder = 'x264';
    const RES = { same: null, '1080': [1920, 1080], '720': [1280, 720], '576': [1024, 576] };
    let wh = RES[c.res] || null;
    if (wh && KM.settings.height > KM.settings.width) wh = [wh[1], wh[0]];
    // x264 (tanpa GPU): preset menyesuaikan jumlah core agar tetap realtime
    const cores = navigator.hardwareConcurrency || 4;
    const preset = c.preset && c.preset !== 'auto' && c.encoder === 'x264' ? c.preset : (cores >= 12 ? 'veryfast' : cores >= 6 ? 'superfast' : 'ultrafast');
    const cfg = Object.assign({}, c, { encoder, preset, fps: KM.settings.fps, width: wh ? wh[0] : 0, height: wh ? wh[1] : 0 });
    R.srtSlow = 0; R.srtWarned = false;
    R.srtStatus = 'menyambung'; R.srtMsg = ''; R.srtStats = null; R.srtLog = '';
    const r = await openHubOut('srt', { cfg }, (m) => {
      if (m.t === 'status') { R.srtStatus = m.status; R.srtMsg = m.msg; if (m.status === 'live') KM.toast('● SRT tersambung ke gateway — Program tayang realtime', 'ok', 4000); KM.changed('srt'); }
      else if (m.t === 'stats') {
        R.srtStats = m; KM.emit('srt-stats', m);
        const sp = parseFloat(m.speed); R.srtSlow = sp && sp < 0.93 ? R.srtSlow + 1 : 0;
        if (R.srtSlow >= 8 && !R.srtWarned) { R.srtWarned = true; KM.toast('SRT: encoder tidak kuat realtime (' + m.speed + '). Turunkan resolusi ke 720p / bitrate, atau pakai encoder GPU di Pengaturan → SRT / TV.', 'warn', 9000); }
      }
      else if (m.t === 'log') { R.srtLog = (R.srtLog + m.msg).slice(-6000); }
      else if (m.t === 'closed' && S.srt) { R.stopSrt(true); KM.toast('Output SRT berhenti (hub media tertutup)', 'err', 6000); }
    });
    if (!r.ok) { R.srtStatus = 'off'; KM.toast('SRT gagal: ' + r.msg, 'err', 6000); KM.changed('srt'); return false; }
    const copy = encoder === 'copy';
    const vbps = copy ? c.videoBitrate * 1000 : Math.round(Math.max(c.videoBitrate * 2500, 10000000) * R.fpsScale());
    R.srtWs = r.ws;
    R.srtRec = pipeRecorder(r.ws, mixStream('M'), h264 || 'video/webm;codecs=vp8,opus', vbps, 50);
    S.srt = true; R.srtT0 = Date.now(); R.srtEncoder = encoder;
    KM.toast('SRT ' + (c.mode === 'listener' ? 'menunggu gateway di port ' + c.port : 'menyambung ke ' + c.host + ':' + c.port) + '…', 'rec', 3500);
    KM.changed('srt');
    return true;
  };
  R.stopSrt = function (silent) {
    if (!S.srt) return true;
    S.srt = false; R.srtStatus = 'off'; R.srtStats = null;
    try { R.srtRec.stop(); } catch (e) {}
    setTimeout(() => { try { R.srtWs && R.srtWs.close(); } catch (e) {} R.srtWs = null; }, 300);
    if (silent !== true) KM.toast('Output SRT dihentikan');
    KM.changed('srt');
    return true;
  };
  R.toggleSrt = () => (S.srt ? R.stopSrt() : R.startSrt());

  // ---------- LAYAR TV MASJID: satu tombol → cari / nyalakan / pasang gateway, isi SRT, mulai kirim ----------
  // Gateway (MediaMTX) di PC ini atau PC lain satu Wi-Fi menerima SRT publish:klm; TV memilih sumber KLM otomatis.
  let tvBusy = false;
  R.tvStep = '';
  R.tvConnect = async function () {
    if (!KM.isElectron) { KM.toast('Sambungan Layar TV hanya di KLM versi PC (Windows)', 'warn'); return false; }
    if (tvBusy) return false;
    tvBusy = true;
    const step = (t) => { R.tvStep = t; KM.changed('srt'); if (t) KM.toast('📺 ' + t, 'info', 6000); };
    try {
      step('Mencari gateway Layar TV Masjid…');
      let f = await window.klm.invoke('tvgw:find', { lan: true });
      let host = '', where = '';
      const upd = async () => {
        if (!(await UI().confirm('Gateway Layar TV di PC ini versi lama (belum menerima siaran KLM). Perbarui sekarang? Jendela pemasang akan terbuka sebentar.', 'Perbarui'))) return null;
        return window.klm.invoke('tvgw:install');
      };
      if (f.local.ok && f.local.klm !== 'lama') { host = '127.0.0.1'; where = 'gateway PC ini'; }
      else if (f.local.ok) { const r = await upd(); if (r && r.ok) { host = '127.0.0.1'; where = 'gateway PC ini (diperbarui)'; } else if (r) throw new Error(r.msg); }
      else if (f.installed) {
        step('Menyalakan gateway di PC ini…');
        const r = await window.klm.invoke('tvgw:start');
        if (r.ok && r.klm === 'lama') { const u = await upd(); if (u && u.ok) { host = '127.0.0.1'; where = 'gateway PC ini (diperbarui)'; } else if (u) throw new Error(u.msg); }
        else if (r.ok) { host = '127.0.0.1'; where = 'gateway PC ini'; }
      }
      if (!host && !f.local.ok) {
        const lan = (f.lan || []).find((g) => g.klm !== 'lama');
        if (lan) { host = lan.host; where = 'gateway di PC ' + lan.host; }
        else if (f.lan && f.lan.length) throw new Error('Gateway di PC ' + f.lan[0].host + ' versi lama — jalankan ulang PASANG-GATEWAY-VMIX.bat di PC itu (panel admin TV → Siaran vMix / KLM)');
        else if (f.platform === 'win32' && !f.installed) {
          if (!(await UI().confirm('Gateway Layar TV Masjid belum ada di PC ini maupun di jaringan. Pasang di PC ini sekarang? (sekali saja, ± 1 menit; setelah itu menyala sendiri setiap KLM dibuka)', 'Pasang'))) { step(''); return false; }
          const r = await window.klm.invoke('tvgw:install');
          if (!r.ok) throw new Error(r.msg);
          host = '127.0.0.1'; where = 'gateway PC ini (baru dipasang)';
        }
      }
      if (!host) throw new Error('Gateway Layar TV tidak ditemukan');
      const c = R.srtCfg();
      Object.assign(c, { mode: 'caller', host, port: 8890, latency: host === '127.0.0.1' ? 80 : 120, streamid: 'publish:klm', passphrase: '', autoStart: true });
      KM.saveSettings();
      if (S.srt) { R.stopSrt(true); await new Promise((r) => setTimeout(r, 600)); }
      R.tvStep = '';
      const ok = await R.startSrt();
      if (ok) KM.toast('📺 Program dikirim ke Layar TV Masjid — ' + where + '. Berikutnya tersambung sendiri saat KLM dibuka.', 'ok', 7000);
      return ok;
    } catch (e) {
      R.tvStep = ''; KM.toast('📺 ' + (e.message || e), 'err', 9000); return false;
    } finally { tvBusy = false; KM.changed('srt'); }
  };
  if (KM.isElectron && window.klm.on) window.klm.on('tvgw:step', (t) => { R.tvStep = t; KM.toast('📺 ' + t, 'info', 6000); KM.changed('srt'); });
  const UI = () => KM.ui;
  R.srtTime = () => (S.srt ? (Date.now() - R.srtT0) / 1000 : 0);

  // ---------- OUTPUT NDI (juga = Virtual Camera lewat "NDI Webcam") ----------
  R.startNdi = async function (name) {
    if (S.ndiOut) return true;
    const w = Math.min(KM.settings.width, KM.settings.ndiWidth || 1280), hgt = Math.round(w * KM.settings.height / KM.settings.width);
    const r = await openHubOut('ndi', { opts: { name: name || KM.settings.ndiName || 'KLM', width: w, height: hgt, fps: Math.min(30, KM.settings.fps) } }, (m) => {
      if (m.t === 'closed' && S.ndiOut) { S.ndiOut = false; KM.changed('ndi'); }
    });
    if (!r.ok) { KM.toast('NDI gagal: ' + r.msg, 'err', 7000); return false; }
    const h264 = H264_WEBM.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm;codecs=vp8,opus';
    R.ndiWs = r.ws;
    R.ndiRec = pipeRecorder(r.ws, KM.engine.programStream(), h264.replace(',opus', ''), 15e6, 50);
    S.ndiOut = true; KM.changed('ndi');
    KM.toast('NDI aktif: "' + (name || KM.settings.ndiName || 'KLM') + '" — pakai NDI Webcam untuk virtual camera', 'ok', 5000);
    return true;
  };
  R.stopNdi = function () {
    if (!S.ndiOut) return true;
    S.ndiOut = false;
    try { R.ndiRec.stop(); } catch (e) {}
    setTimeout(() => { try { R.ndiWs.close(); } catch (e) {} }, 200);
    KM.changed('ndi'); return true;
  };
  R.toggleNdi = () => (S.ndiOut ? R.stopNdi() : R.startNdi());

  // ---------- MULTICORDER (rekam tiap input terpisah) ----------
  R.startMultiCorder = async function (ids) {
    if (S.multicorder) return;
    const list = (ids || KM.settings.multicorder || []).map((id) => KM.getInput(id)).filter(Boolean);
    const targets = list.length ? list : S.inputs.filter((i) => i.rt.stream && i.rt.stream.getVideoTracks().length);
    if (!targets.length) { KM.toast('Tidak ada input kamera/capture untuk MultiCorder', 'warn'); return; }
    const mime = pickMime(KM.settings.recFormat);
    R.mc = [];
    for (const inp of targets) {
      let stream = inp.rt.stream;
      if (!stream) continue;
      const name = 'MC-' + KM.stamp() + '-' + (KM.inputNum(inp)) + '-' + inp.title.replace(/[^\w-]+/g, '_') + '.' + ext(mime);
      const w = await makeWriter(name, 'rec');
      const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: KM.settings.recVideoKbps * 1000 });
      mr.ondataavailable = (e) => { if (e.data.size) w.write(e.data); };
      mr.onstop = () => w.close();
      mr.start(1000);
      R.mc.push(mr);
    }
    S.multicorder = true; R.mcT0 = Date.now();
    KM.toast('MultiCorder merekam ' + R.mc.length + ' input', 'rec');
    KM.changed('mc');
  };
  R.stopMultiCorder = function () {
    R.mc.forEach((m) => { try { m.stop(); } catch (e) {} });
    R.mc = []; S.multicorder = false; KM.changed('mc');
    KM.toast('MultiCorder berhenti');
  };
  R.toggleMultiCorder = () => (S.multicorder ? R.stopMultiCorder() : R.startMultiCorder());

  // ---------- SNAPSHOT ----------
  R.snapshot = async function (inpKey) {
    let blob;
    if (inpKey) {
      const inp = KM.getInput(inpKey); if (!inp) return false;
      const c = document.createElement('canvas'); c.width = KM.settings.width; c.height = KM.settings.height;
      const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
      KM.engine.drawInputRect(x, inp, 0, 0, c.width, c.height, 0);
      blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    } else blob = await KM.engine.snapshot();
    const name = 'Snapshot-' + KM.stamp() + '.png';
    if (KM.isElectron) {
      const folder = await KM.defaultFolder('snap');
      const p = KM.joinPath(folder, name);
      await window.klm.invoke('file:write-binary', p, await blob.arrayBuffer());
      KM.toast('Snapshot: ' + p, 'ok', 4000);
    } else KM.downloadBlob(blob, name);
    return true;
  };

  R.recTime = () => (S.recording ? (Date.now() - R.recT0) / 1000 : 0);
  R.streamTime = () => (S.streaming ? (Date.now() - R.streamT0) / 1000 : 0);
})(window.KM);
