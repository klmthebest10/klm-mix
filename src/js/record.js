/* KLM Mix - Rekam (MP4/WebM), Streaming (RTMP/RTMPS/SRT multi-tujuan via ffmpeg), MultiCorder, Snapshot */
'use strict';
(function (KM) {
  const S = KM.state;
  const R = KM.rec = { recT0: 0, streamT0: 0, stats: null, mc: [] };

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
  R.startRecording = async function () {
    if (S.recording) return true;
    const mime = pickMime(KM.settings.recFormat);
    if (!mime) { KM.toast('Browser tidak mendukung perekaman', 'err'); return false; }
    const name = 'KLM-Mix-' + KM.stamp() + '.' + ext(mime);
    const w = await makeWriter(name, 'rec');
    const mr = new MediaRecorder(mixStream(), { mimeType: mime, videoBitsPerSecond: KM.settings.recVideoKbps * 1000, audioBitsPerSecond: KM.settings.recAudioKbps * 1000 });
    mr.ondataavailable = (e) => { if (e.data && e.data.size) w.write(e.data); };
    mr.onstop = async () => { const p = await w.close(); KM.toast('Rekaman tersimpan: ' + p, 'ok', 5000); R.lastRecording = p; KM.changed('rec'); };
    mr.onerror = (e) => KM.toast('Error rekam: ' + (e.error && e.error.message), 'err');
    mr.start(1000);
    R.recorder = mr; R.recT0 = Date.now(); S.recording = true;
    KM.toast('● Merekam ke ' + name, 'rec');
    KM.changed('rec');
    return true;
  };
  R.stopRecording = function () {
    if (!S.recording) return true;
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
    const dests = sc.destinations.filter((d) => d.enabled && (d.url || '').trim()).map((d) => ({ enabled: true, url: joinKey(d.url.trim(), (d.key || '').trim()) }));
    if (!dests.length) { KM.toast('Isi URL & stream key dulu di Pengaturan Streaming', 'warn'); KM.ui && KM.ui.openSettings('stream'); return false; }
    const h264 = H264_WEBM.find((m) => MediaRecorder.isTypeSupported(m));
    const mime = h264 || 'video/webm;codecs=vp8,opus';
    let encoder = sc.encoder || 'auto';
    if (encoder === 'auto') encoder = h264 ? 'copy' : (await R.detectEncoders()).best;
    if (encoder === 'copy' && !h264) encoder = (await R.detectEncoders()).best;
    const copy = encoder === 'copy';
    const vbps = copy ? sc.videoBitrate * 1000 : Math.max(sc.videoBitrate * 2500, 8000000);
    const cfg = { encoder, preset: sc.preset, videoBitrate: sc.videoBitrate, audioBitrate: sc.audioBitrate, fps: KM.settings.fps, destinations: dests };
    const r = await openHubOut('stream', { cfg }, (m) => {
      if (m.t === 'stats') { R.stats = m; KM.emit('stream-stats', m); }
      else if (m.t === 'log') { R.log = ((R.log || '') + m.msg).slice(-6000); }
      else if ((m.t === 'ended' || m.t === 'closed') && S.streaming) {
        KM.toast('Streaming terputus. Cek internet / stream key (lihat log di Pengaturan > Streaming).', 'err', 7000);
        R.stopStreaming(true);
      }
    });
    if (!r.ok) { KM.toast('Gagal streaming: ' + r.msg, 'err', 6000); return false; }
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
    try { R.streamer.stop(); } catch (e) {}
    setTimeout(() => { try { R.streamWs && R.streamWs.close(); } catch (e) {} R.streamWs = null; }, 400);
    R.streamer = null; R.stats = null;
    if (silent !== true) KM.toast('Streaming dihentikan');
    KM.changed('stream');
    return true;
  };
  R.toggleStreaming = () => (S.streaming ? R.stopStreaming() : R.startStreaming());

  // ---------- OUTPUT NDI (juga = Virtual Camera lewat "NDI Webcam") ----------
  R.startNdi = async function (name) {
    if (S.ndiOut) return true;
    const w = Math.min(KM.settings.width, KM.settings.ndiWidth || 1280), hgt = Math.round(w * KM.settings.height / KM.settings.width);
    const r = await openHubOut('ndi', { opts: { name: name || KM.settings.ndiName || 'KLM Mix', width: w, height: hgt, fps: Math.min(30, KM.settings.fps) } }, (m) => {
      if (m.t === 'closed' && S.ndiOut) { S.ndiOut = false; KM.changed('ndi'); }
    });
    if (!r.ok) { KM.toast('NDI gagal: ' + r.msg, 'err', 7000); return false; }
    const h264 = H264_WEBM.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm;codecs=vp8,opus';
    R.ndiWs = r.ws;
    R.ndiRec = pipeRecorder(r.ws, KM.engine.programStream(), h264.replace(',opus', ''), 15e6, 50);
    S.ndiOut = true; KM.changed('ndi');
    KM.toast('NDI aktif: "' + (name || KM.settings.ndiName || 'KLM Mix') + '" — pakai NDI Webcam untuk virtual camera', 'ok', 5000);
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
