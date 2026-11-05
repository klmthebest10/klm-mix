/* KLM Mix - jenis-jenis input (video, gambar, kamera, KLMCAM, layar, title, browser, dll) */
'use strict';
(function (KM) {
  const h = KM.h;

  function placeholder(inp, line1, line2) {
    const rt = inp.rt;
    if (!rt.ph) { rt.ph = document.createElement('canvas'); rt.ph.width = 640; rt.ph.height = 360; }
    const key = line1 + '|' + line2;
    if (rt.phKey !== key) {
      rt.phKey = key;
      const c = rt.ph.getContext('2d');
      const g = c.createLinearGradient(0, 0, 640, 360); g.addColorStop(0, '#1d2230'); g.addColorStop(1, '#0d0f15');
      c.fillStyle = g; c.fillRect(0, 0, 640, 360);
      c.strokeStyle = '#2f3750'; c.lineWidth = 2; c.strokeRect(8, 8, 624, 344);
      c.fillStyle = '#e6e9f2'; c.font = '600 30px Segoe UI, Arial'; c.textAlign = 'center';
      c.fillText(line1, 320, 170);
      c.fillStyle = '#8b93a8'; c.font = '20px Segoe UI, Arial'; c.fillText(line2 || '', 320, 210);
    }
    return { src: rt.ph, w: 640, h: 360 };
  }
  KM.placeholder = placeholder;

  function videoEl() {
    const v = document.createElement('video');
    v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.disablePictureInPicture = true;
    return v;
  }
  function streamVideo(stream) {
    const v = videoEl(); v.muted = true; v.autoplay = true; v.srcObject = stream;
    v.play().catch(() => {});
    return v;
  }
  function vSrc(inp) {
    const v = inp.rt.el;
    if (!v || v.readyState < 2 || !v.videoWidth) return null;
    return { src: v, w: v.videoWidth, h: v.videoHeight };
  }

  // ---------- registri jenis input ----------
  const T = KM.inputTypes = {};

  T.colour = {
    label: 'Warna / Gradien', icon: '🎨',
    create(inp) {
      inp.opts = Object.assign({ color: '#1e3a8a', color2: '#0f172a', grad: 'none' }, inp.opts);
      inp.rt.canvas = document.createElement('canvas'); inp.rt.canvas.width = 640; inp.rt.canvas.height = 360;
      T.colour.paint(inp); inp.rt.ready = true;
    },
    paint(inp) {
      const c = inp.rt.canvas.getContext('2d'), o = inp.opts;
      let fill = o.color;
      if (o.grad === 'linear') { fill = c.createLinearGradient(0, 0, 640, 360); fill.addColorStop(0, o.color); fill.addColorStop(1, o.color2); }
      if (o.grad === 'radial') { fill = c.createRadialGradient(320, 180, 10, 320, 180, 380); fill.addColorStop(0, o.color); fill.addColorStop(1, o.color2); }
      c.fillStyle = fill; c.fillRect(0, 0, 640, 360);
    },
    source: (inp) => ({ src: inp.rt.canvas, w: 640, h: 360 })
  };

  T.bars = {
    label: 'Color Bars + Tone', icon: '📊',
    create(inp) {
      inp.opts = Object.assign({ tone: false }, inp.opts);
      const cv = document.createElement('canvas'); cv.width = 1280; cv.height = 720;
      const c = cv.getContext('2d');
      const top = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
      const mid = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
      const bw = 1280 / 7;
      top.forEach((col, i) => { c.fillStyle = col; c.fillRect(i * bw, 0, bw + 1, 480); });
      mid.forEach((col, i) => { c.fillStyle = col; c.fillRect(i * bw, 480, bw + 1, 60); });
      ['#00214c', '#ffffff', '#32006a', '#131313'].forEach((col, i) => { c.fillStyle = col; c.fillRect(i * 1280 / 6 * 1.25, 540, 1280 / 6 * 1.25 + 1, 180); });
      c.fillStyle = '#131313'; c.fillRect(1280 / 6 * 5, 540, 1280 / 6, 180);
      c.fillStyle = '#fff'; c.font = 'bold 28px Segoe UI, Arial'; c.fillText('KLM Mix', 1100, 700);
      inp.rt.canvas = cv; inp.rt.ready = true;
      if (inp.opts.tone) KM.audio && KM.audio.attachTone(inp);
    },
    source: (inp) => ({ src: inp.rt.canvas, w: 1280, h: 720 }),
    hasAudio: (inp) => !!inp.opts.tone
  };

  T.image = {
    label: 'Gambar / Foto / GIF', icon: '🖼️',
    create(inp) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { inp.rt.ready = true; KM.changed('input'); };
      img.onerror = () => { inp.rt.err = 'Gagal memuat gambar'; };
      img.src = inp.opts.url;
      inp.rt.el = img;
    },
    source(inp) { const i = inp.rt.el; return i && i.complete && i.naturalWidth ? { src: i, w: i.naturalWidth, h: i.naturalHeight } : placeholder(inp, inp.title, inp.rt.err || 'Memuat…'); }
  };

  T.video = {
    label: 'Video', icon: '🎬', playable: true,
    create(inp) {
      inp.audio.auto = inp.audio.auto !== false;
      const v = videoEl(); v.src = inp.opts.url; v.loop = !!inp.loop;
      v.playbackRate = inp.opts.speed || 1;
      v.addEventListener('loadeddata', () => { inp.rt.ready = true; KM.audio && KM.audio.attach(inp); if (inp.opts.markIn) v.currentTime = inp.opts.markIn; KM.changed('input'); });
      v.addEventListener('error', () => { inp.rt.err = 'Gagal memuat video'; KM.changed('input'); });
      v.addEventListener('timeupdate', () => {
        const mo = inp.opts.markOut;
        if (mo && v.currentTime >= mo) { if (inp.loop) v.currentTime = inp.opts.markIn || 0; else v.pause(); }
      });
      v.addEventListener('ended', () => KM.emit('input-ended', inp));
      inp.rt.el = v;
    },
    source: (inp) => vSrc(inp) || placeholder(inp, inp.title, inp.rt.err || 'Memuat video…'),
    hasAudio: () => true
  };

  T.audiofile = {
    label: 'File Audio (MP3/WAV)', icon: '🎵', playable: true,
    create(inp) {
      inp.audio.auto = false;
      const a = new Audio(); a.crossOrigin = 'anonymous'; a.src = inp.opts.url; a.loop = !!inp.loop; a.preload = 'auto';
      a.addEventListener('loadeddata', () => { inp.rt.ready = true; KM.audio && KM.audio.attach(inp); KM.changed('input'); });
      a.addEventListener('ended', () => KM.emit('input-ended', inp));
      inp.rt.el = a;
    },
    source: (inp) => placeholder(inp, '🎵 ' + inp.title, 'Audio'),
    noVideo: true, hasAudio: () => true
  };

  T.list = {
    label: 'Daftar Putar (Video/Foto)', icon: '📃', playable: true,
    create(inp) {
      inp.opts = Object.assign({ items: [], imgDur: 5, loopList: true, shuffle: false }, inp.opts);
      inp.audio.auto = inp.audio.auto !== false;
      const v = videoEl(); const img = new Image(); img.crossOrigin = 'anonymous';
      inp.rt.v = v; inp.rt.img = img; inp.rt.idx = -1; inp.rt.playing = false;
      v.addEventListener('ended', () => T.list.next(inp));
      v.addEventListener('loadeddata', () => { KM.audio && KM.audio.attach(inp); if (inp.rt.playing) v.play().catch(() => {}); });
      inp.rt.el = v;
      inp.rt.ready = true;
      T.list.go(inp, 0);
    },
    go(inp, i) {
      const items = inp.opts.items; if (!items.length) return;
      const rt = inp.rt;
      rt.idx = ((i % items.length) + items.length) % items.length;
      const it = items[rt.idx];
      rt.cur = it; rt.t0 = KM.now();
      if (it.kind === 'image') { rt.v.pause(); rt.img.src = it.url; }
      else { rt.v.src = it.url; rt.v.load(); if (rt.playing) rt.v.play().catch(() => {}); }
      KM.changed('input');
    },
    next(inp) {
      const rt = inp.rt, items = inp.opts.items;
      if (!items.length) return;
      if (inp.opts.shuffle) return T.list.go(inp, Math.floor(Math.random() * items.length));
      if (rt.idx + 1 >= items.length && !inp.opts.loopList) { rt.playing = false; return; }
      T.list.go(inp, rt.idx + 1);
    },
    prev(inp) { T.list.go(inp, inp.rt.idx - 1); },
    tick(inp) {
      const rt = inp.rt;
      if (rt.cur && rt.cur.kind === 'image' && rt.playing && KM.now() - rt.t0 > inp.opts.imgDur * 1000) T.list.next(inp);
    },
    source(inp) {
      const rt = inp.rt;
      if (!rt.cur) return placeholder(inp, inp.title, 'Daftar kosong — tambah file');
      if (rt.cur.kind === 'image') return rt.img.complete && rt.img.naturalWidth ? { src: rt.img, w: rt.img.naturalWidth, h: rt.img.naturalHeight } : null;
      return vSrc(inp);
    },
    hasAudio: () => true
  };

  T.camera = {
    label: 'Kamera / Capture Card', icon: '📷',
    async create(inp) {
      inp.opts = Object.assign({ deviceId: '', width: 1920, height: 1080, fps: 30, audioDeviceId: '' }, inp.opts);
      try {
        const st = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: inp.opts.deviceId ? { exact: inp.opts.deviceId } : undefined, width: { ideal: inp.opts.width }, height: { ideal: inp.opts.height }, frameRate: { ideal: inp.opts.fps } },
          audio: inp.opts.audioDeviceId ? { deviceId: { exact: inp.opts.audioDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false
        });
        inp.rt.stream = st; inp.rt.el = streamVideo(st); inp.rt.ready = true;
        if (st.getAudioTracks().length) KM.audio && KM.audio.attach(inp);
        KM.changed('input');
      } catch (e) { inp.rt.err = 'Kamera gagal: ' + e.name; KM.changed('input'); }
    },
    source: (inp) => vSrc(inp) || placeholder(inp, inp.title, inp.rt.err || 'Membuka kamera…'),
    hasAudio: (inp) => !!(inp.rt.stream && inp.rt.stream.getAudioTracks().length)
  };

  T.audio = {
    label: 'Mic / Audio Device', icon: '🎤',
    async create(inp) {
      inp.opts = Object.assign({ deviceId: '', processing: false }, inp.opts);
      try {
        const p = !!inp.opts.processing;
        const st = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: inp.opts.deviceId ? { exact: inp.opts.deviceId } : undefined, echoCancellation: p, noiseSuppression: p, autoGainControl: p, channelCount: 2 }, video: false });
        inp.rt.stream = st; inp.rt.ready = true; KM.audio && KM.audio.attach(inp); KM.changed('input');
      } catch (e) { inp.rt.err = 'Mic gagal: ' + e.name; KM.changed('input'); }
    },
    source: (inp) => placeholder(inp, '🎤 ' + inp.title, inp.rt.err || 'Input audio'),
    noVideo: true, hasAudio: () => true
  };

  T.screen = {
    label: 'Tangkap Layar / Jendela', icon: '🖥️',
    async create(inp) {
      inp.opts = Object.assign({ sourceId: '', sysAudio: false, fps: 30 }, inp.opts);
      try {
        let st;
        if (KM.isElectron && inp.opts.sourceId) {
          st = await navigator.mediaDevices.getUserMedia({
            audio: inp.opts.sysAudio && inp.opts.sourceId.startsWith('screen') ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
            video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: inp.opts.sourceId, maxWidth: 1920, maxHeight: 1080, maxFrameRate: inp.opts.fps } }
          });
        } else {
          st = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: inp.opts.fps }, audio: !!inp.opts.sysAudio });
        }
        inp.rt.stream = st; inp.rt.el = streamVideo(st); inp.rt.ready = true;
        if (st.getAudioTracks().length) KM.audio && KM.audio.attach(inp);
        KM.changed('input');
      } catch (e) { inp.rt.err = 'Capture gagal: ' + e.name; KM.changed('input'); }
    },
    source: (inp) => vSrc(inp) || placeholder(inp, inp.title, inp.rt.err || 'Memulai capture…'),
    hasAudio: (inp) => !!(inp.rt.stream && inp.rt.stream.getAudioTracks().length)
  };

  T.klmcam = {
    label: 'KLMCAM (Kamera HP)', icon: '📱',
    create(inp) {
      inp.opts = Object.assign({ slot: 1, quality: '1080p30', bitrate: 6000, audio: true }, inp.opts);
      inp.rt.ready = true;
      KM.link && KM.link.bindCams();
    },
    setStream(inp, stream) {
      if (inp.rt.el) { try { inp.rt.el.srcObject = null; } catch (e) {} }
      inp.rt.stream = stream;
      inp.rt.el = stream ? streamVideo(stream) : null;
      if (stream && stream.getAudioTracks().length) KM.audio && KM.audio.attach(inp, true);
      KM.changed('input');
    },
    source(inp) {
      return vSrc(inp) || placeholder(inp, '📱 KLMCAM #' + inp.opts.slot, inp.rt.camId ? 'Menyambung…' : 'Menunggu HP dengan slot ' + inp.opts.slot);
    },
    hasAudio: (inp) => !!(inp.rt.stream && inp.rt.stream.getAudioTracks().length)
  };

  T.call = {
    label: 'KLM Call (Tamu jarak jauh)', icon: '📞',
    create(inp) {
      inp.opts = Object.assign({ slot: 1, quality: '720p30', bitrate: 2500, audio: true }, inp.opts);
      inp.rt.ready = true;
      KM.link && KM.link.bindCams();
    },
    setStream(inp, stream) { KM.inputTypes.klmcam.setStream(inp, stream); },
    source(inp) { return vSrc(inp) || placeholder(inp, '📞 KLM Call #' + inp.opts.slot, inp.rt.camId ? 'Menyambung…' : 'Menunggu tamu (link /call)'); },
    hasAudio: (inp) => !!(inp.rt.stream && inp.rt.stream.getAudioTracks().length)
  };

  T.title = {
    label: 'Title Cepat (Kanvas)', icon: '🅃',
    create(inp) { KM.titles.init(inp); inp.rt.ready = true; },
    source: (inp) => ({ src: inp.rt.canvas, w: inp.rt.canvas.width, h: inp.rt.canvas.height }),
    tick: (inp, t) => KM.titles.render(inp, t)
  };

  T.browser = {
    label: 'Web Browser', icon: '🌐',
    async create(inp) {
      inp.opts = Object.assign({ url: 'https://www.google.com', width: 1280, height: 720 }, inp.opts);
      if (!KM.isElectron) { inp.rt.err = 'Hanya di versi PC (.exe)'; return; }
      try {
        const r = await window.klm.invoke('browser:open', { url: inp.opts.url, width: inp.opts.width, height: inp.opts.height });
        inp.rt.winId = r.winId;
        await new Promise((res) => setTimeout(res, 600));
        const st = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: r.sourceId, maxWidth: inp.opts.width, maxHeight: inp.opts.height, maxFrameRate: 30 } } });
        inp.rt.stream = st; inp.rt.el = streamVideo(st); inp.rt.ready = true; KM.changed('input');
      } catch (e) { inp.rt.err = 'Browser gagal: ' + e.message; KM.changed('input'); }
    },
    destroy(inp) { if (inp.rt.winId) window.klm.invoke('browser:close', inp.rt.winId); },
    source: (inp) => vSrc(inp) || placeholder(inp, '🌐 ' + inp.title, inp.rt.err || 'Memuat halaman…')
  };

  T.replay = {
    label: 'Instant Replay', icon: '⏪',
    create(inp) { inp.rt.ready = true; },
    source: (inp) => (KM.replay && KM.replay.source(inp)) || placeholder(inp, '⏪ Replay', 'Belum ada event replay')
  };

  T.virtualset = {
    label: 'Virtual Set', icon: '🏛️',
    create(inp) {
      inp.opts = Object.assign({ bg: 'studio-biru', camId: '', camX: 0.5, camY: 0.58, camScale: 0.8, caption: 'KLM STUDIO' }, inp.opts);
      inp.rt.canvas = document.createElement('canvas');
      inp.rt.canvas.width = 1920; inp.rt.canvas.height = 1080;
      KM.virtualSets.paint(inp); inp.rt.ready = true;
    },
    source: (inp) => ({ src: inp.rt.canvas, w: 1920, h: 1080 })
  };

  T.urlvideo = {
    label: 'Video dari URL', icon: '🔗', playable: true,
    create(inp) { T.video.create(inp); },
    source: (inp) => T.video.source(inp), hasAudio: () => true
  };

  // ---------- STREAM MASUK: RTMP / SRT / RTSP / HLS / UDP / NDI (via hub ffmpeg → fMP4 → MSE) ----------
  const post = (url, body) => fetch(url, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json()).catch((e) => ({ ok: false, msg: e.message }));
  T.stream = {
    label: 'Stream Masuk (RTMP/SRT/RTSP/NDI)', icon: '📡',
    create(inp) {
      inp.opts = Object.assign({ source: 'url', url: '', listen: false, mode: 'copy', latency: 120, maxLag: 0.6, ndiName: '', ndiLow: false }, inp.opts);
      inp.audio.auto = inp.audio.auto !== false;
      inp.autoPause = false;
      const v = videoEl(); v.autoplay = true; inp.rt.el = v;
      v.addEventListener('loadeddata', () => { inp.rt.ready = true; KM.audio && KM.audio.attach(inp); KM.changed('input'); });
      inp.rt.status = 'menyambung'; inp.rt.gen = 0;
      T.stream.start(inp);
    },
    async start(inp) {
      const o = inp.opts;
      const r = await post('/hub/in/start', { id: inp.id, url: o.url, listen: !!o.listen, mode: o.mode, latency: o.latency, source: o.source === 'ndi' ? 'ndi' : 'url', ndiName: o.ndiName, ndiLow: o.ndiLow });
      if (!r.ok) { inp.rt.err = r.msg || 'Hub media tidak tersedia'; KM.changed('input'); }
      T.stream.ensurePoll();
    },
    destroy(inp) { post('/hub/in/stop', { id: inp.id }); if (inp.rt.abort) inp.rt.abort.abort(); },
    restart(inp) { if (inp.rt.abort) inp.rt.abort.abort(); inp.rt.gen = 0; inp.rt.err = ''; T.stream.start(inp); },
    ensurePoll() {
      if (T.stream._poll) return;
      T.stream._poll = setInterval(async () => {
        const list = KM.state.inputs.filter((i) => i.type === 'stream');
        if (!list.length) { clearInterval(T.stream._poll); T.stream._poll = null; return; }
        let st; try { st = await (await fetch('/hub/in/status')).json(); } catch (e) { return; }
        for (const inp of list) {
          const s = st[inp.id]; if (!s) continue;
          if (inp.rt.status !== s.status) { inp.rt.status = s.status; KM.changed('input'); }
          inp.rt.log = s.log;
          if (s.codec && s.gen !== inp.rt.gen) T.stream.attach(inp, s.codec, s.gen);
        }
      }, 700);
    },
    attach(inp, codec, gen) {
      const rt = inp.rt, v = rt.el;
      rt.gen = gen;
      if (rt.abort) rt.abort.abort();
      const mime = 'video/mp4; codecs="' + codec + '"';
      if (!window.MediaSource || !MediaSource.isTypeSupported(mime)) { rt.err = 'Codec ' + codec + ' tidak didukung — pilih mode "Transcode"'; KM.changed('input'); return; }
      rt.err = '';
      const ms = new MediaSource();
      const ctrl = new AbortController(); rt.abort = ctrl;
      v.src = URL.createObjectURL(ms);
      ms.addEventListener('sourceopen', async () => {
        let sb;
        try { sb = ms.addSourceBuffer(mime); } catch (e) { rt.err = e.message; return; }
        const q = [];
        const pump = () => {
          if (sb.updating || !q.length || ms.readyState !== 'open') return;
          try { sb.appendBuffer(q.shift()); } catch (e) { if (e.name === 'QuotaExceededError') trim(true); }
        };
        const trim = (force) => {
          if (sb.updating || !v.buffered.length) return;
          const start = v.buffered.start(0), cur = v.currentTime;
          if (cur - start > (force ? 2 : 12)) { try { sb.remove(start, cur - 1); } catch (e) {} }
        };
        sb.addEventListener('updateend', () => { trim(false); pump(); });
        try {
          const res = await fetch('/hub/in/data/' + inp.id, { signal: ctrl.signal });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const reader = res.body.getReader();
          v.play().catch(() => {});
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            q.push(value); if (q.length > 200) q.splice(0, q.length - 50);
            pump();
          }
        } catch (e) { /* dibatalkan / terputus */ }
        if (rt.abort === ctrl) rt.gen = -1; // paksa sambung ulang pada poll berikut
      }, { once: true });
    },
    /** jaga latensi rendah: kejar ujung buffer */
    tick(inp) {
      const v = inp.rt.el; if (!v || !v.buffered || !v.buffered.length) return;
      const end = v.buffered.end(v.buffered.length - 1), lag = end - v.currentTime, max = inp.opts.maxLag || 0.6;
      if (lag > max + 1.2) { v.currentTime = Math.max(0, end - 0.15); v.playbackRate = 1; }
      else if (lag > max) { if (v.playbackRate !== 1.1) v.playbackRate = 1.1; }
      else if (v.playbackRate !== 1) v.playbackRate = 1;
      if (v.paused && v.readyState >= 2) v.play().catch(() => {});
    },
    source(inp) {
      return vSrc(inp) || placeholder(inp, '📡 ' + inp.title, inp.rt.err || ({ menunggu: 'Menunggu kiriman stream…', menyambung: 'Menyambung…', terputus: 'Terputus — mencoba lagi…', error: 'Error: ' + (inp.rt.log || '').split('\n').filter(Boolean).pop() }[inp.rt.status] || inp.rt.status || ''));
    },
    hasAudio: () => true
  };

  // ---------- Virtual set latar (digambar prosedural, offline) ----------
  KM.virtualSets = {
    presets: { 'studio-biru': 'Studio Berita Biru', 'studio-hijau': 'Studio Islami Hijau', 'panggung': 'Panggung Acara', 'talkshow': 'Talkshow Hangat' },
    paint(inp) {
      const c = inp.rt.canvas.getContext('2d'), W = 1920, H = 1080, o = inp.opts;
      const pal = {
        'studio-biru': ['#061a3a', '#0b3d91', '#38bdf8', '#e2e8f0'],
        'studio-hijau': ['#04241a', '#0f5132', '#d4af37', '#ecfdf5'],
        'panggung': ['#14041f', '#4c1d95', '#f472b6', '#fdf4ff'],
        'talkshow': ['#1f1208', '#7c2d12', '#fbbf24', '#fff7ed']
      }[o.bg] || ['#061a3a', '#0b3d91', '#38bdf8', '#fff'];
      let g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, pal[1]); g.addColorStop(1, pal[0]);
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // panel-panel dinding
      c.globalAlpha = 0.18; c.fillStyle = pal[2];
      for (let i = 0; i < 8; i++) c.fillRect(80 + i * 230, 120, 180, 520);
      c.globalAlpha = 1;
      // layar besar
      c.fillStyle = '#000'; c.fillRect(1240, 160, 560, 320);
      g = c.createLinearGradient(1240, 160, 1800, 480); g.addColorStop(0, pal[2]); g.addColorStop(1, pal[1]);
      c.fillStyle = g; c.globalAlpha = 0.85; c.fillRect(1250, 170, 540, 300); c.globalAlpha = 1;
      c.fillStyle = pal[3]; c.font = 'bold 54px Segoe UI, Arial'; c.textAlign = 'center';
      c.fillText(o.caption || 'KLM STUDIO', 1520, 340);
      // lantai
      g = c.createLinearGradient(0, 760, 0, H); g.addColorStop(0, pal[1]); g.addColorStop(1, '#000');
      c.fillStyle = g; c.fillRect(0, 760, W, H - 760);
      c.strokeStyle = pal[2]; c.globalAlpha = 0.35; c.lineWidth = 3;
      for (let i = -10; i < 20; i++) { c.beginPath(); c.moveTo(960 + i * 40, 760); c.lineTo(960 + i * 200, H); c.stroke(); }
      c.globalAlpha = 1;
      // meja
      c.fillStyle = pal[0]; c.beginPath(); c.moveTo(420, 820); c.lineTo(1500, 820); c.lineTo(1400, 1080); c.lineTo(520, 1080); c.closePath(); c.fill();
      c.fillStyle = pal[2]; c.fillRect(420, 812, 1080, 14);
      inp.rt.bgReady = true;
    }
  };

  // ---------- manajer input ----------
  function defaults(type) {
    return {
      id: KM.uid(), type, title: '', opts: {},
      pos: { x: 0, y: 0, zoom: 1, cropL: 0, cropR: 0, cropT: 0, cropB: 0, rot: 0, fit: 'fit' },
      cc: { on: false, bri: 0, con: 1, sat: 1, hue: 0, gam: 1 },
      key: { on: false, color: '#00ff00', sim: 0.4, smooth: 0.08, spill: 0.1, lumaOn: false, lumaLo: 0.05, lumaHi: 0.15 },
      layers: [],
      audio: { vol: 100, gain: 0, mute: false, pan: 0, M: true, A: false, B: false, auto: false, solo: false, delay: 0,
        eq: { on: false, low: 0, mid: 0, high: 0 }, comp: { on: false, thr: -24, ratio: 4 }, gate: { on: false, thr: -50 } },
      autoPlay: true, autoPause: true, autoRestart: false, loop: false,
      color: '', rt: {}
    };
  }

  KM.inputs = {
    defaults,
    create(type, data) {
      const t = T[type]; if (!t) throw new Error('Jenis input tidak dikenal: ' + type);
      const d = defaults(type);
      const inp = Object.assign(d, KM.deepClone(data || {}), { rt: {} });
      inp.pos = Object.assign(defaults(type).pos, (data && data.pos) || {});
      inp.audio = Object.assign(defaults(type).audio, (data && data.audio) || {});
      if (!inp.title) inp.title = t.label;
      KM.state.inputs.push(inp);
      try { const r = t.create(inp); if (r && r.catch) r.catch((e) => console.error(e)); } catch (e) { console.error(e); inp.rt.err = e.message; }
      if (!KM.state.previewId) KM.state.previewId = inp.id;
      if (!KM.state.programId && KM.state.inputs.length === 1) KM.state.programId = inp.id;
      KM.changed('inputs');
      return inp;
    },
    remove(inp) {
      const S = KM.state; inp = KM.getInput(inp); if (!inp) return;
      const t = T[inp.type];
      try { t.destroy && t.destroy(inp); } catch (e) {}
      const rt = inp.rt;
      if (rt.stream) rt.stream.getTracks().forEach((tr) => tr.stop());
      if (rt.el) { try { rt.el.pause && rt.el.pause(); rt.el.removeAttribute('src'); rt.el.srcObject = null; rt.el.load && rt.el.load(); } catch (e) {} }
      KM.audio && KM.audio.detach(inp);
      S.inputs.splice(S.inputs.indexOf(inp), 1);
      S.inputs.forEach((o) => { o.layers = o.layers.filter((l) => l.inputId !== inp.id); });
      if (S.previewId === inp.id) S.previewId = S.inputs[0] ? S.inputs[0].id : null;
      if (S.programId === inp.id) S.programId = null;
      S.overlays.forEach((o) => { if (o.inputId === inp.id) { o.inputId = null; o.phase = 'off'; } });
      KM.changed('inputs');
    },
    move(inp, dir) {
      const arr = KM.state.inputs, i = arr.indexOf(inp), j = i + dir;
      if (j < 0 || j >= arr.length) return;
      arr.splice(i, 1); arr.splice(j, 0, inp); KM.changed('inputs');
    },
    duplicate(inp) {
      const d = KM.inputs.serialize(inp); delete d.id; d.title = inp.title + ' (salin)';
      return KM.inputs.create(inp.type, d);
    },
    serialize(inp) {
      const o = {};
      for (const k in inp) if (k !== 'rt') o[k] = KM.deepClone(inp[k]);
      if (o.opts && o.opts.url && o.opts.url.startsWith('blob:')) o.opts.url = '';
      if (o.opts && o.opts.items) o.opts.items = o.opts.items.filter((i) => !i.url.startsWith('blob:'));
      return o;
    },
    source(inp) {
      const t = T[inp.type];
      try { return t.source(inp); } catch (e) { return null; }
    },
    hasAudio(inp) { const t = T[inp.type]; return !!(t.hasAudio && t.hasAudio(inp)); },
    isPlayable(inp) { return !!T[inp.type].playable; },
    media(inp) { return inp.type === 'list' ? inp.rt.v : inp.rt.el; },
    play(inp) {
      inp = KM.getInput(inp); if (!inp) return;
      if (inp.type === 'list') { inp.rt.playing = true; if (inp.rt.cur && inp.rt.cur.kind !== 'image') inp.rt.v.play().catch(() => {}); inp.rt.t0 = KM.now(); }
      else if (inp.type === 'replay') KM.replay && KM.replay.play();
      else { const m = KM.inputs.media(inp); if (m && m.play) m.play().catch(() => {}); }
      KM.changed('play');
    },
    pause(inp) {
      inp = KM.getInput(inp); if (!inp) return;
      if (inp.type === 'list') { inp.rt.playing = false; inp.rt.v.pause(); }
      else if (inp.type === 'replay') KM.replay && KM.replay.pause();
      else { const m = KM.inputs.media(inp); if (m && m.pause) m.pause(); }
      KM.changed('play');
    },
    isPlaying(inp) {
      if (inp.type === 'list') return !!inp.rt.playing;
      if (inp.type === 'replay') return !!(KM.replay && KM.replay.playing);
      const m = KM.inputs.media(inp); return !!(m && m.play && !m.paused);
    },
    restart(inp) {
      inp = KM.getInput(inp); if (!inp) return;
      if (inp.type === 'list') KM.inputTypes.list.go(inp, 0);
      else if (inp.type === 'replay') KM.replay && KM.replay.restart();
      else { const m = KM.inputs.media(inp); if (m && 'currentTime' in m) m.currentTime = inp.opts.markIn || 0; }
    },
    setLoop(inp, on) {
      inp.loop = on; const m = KM.inputs.media(inp);
      if (m && inp.type !== 'list') m.loop = on && !inp.opts.markOut;
      if (inp.type === 'list') inp.opts.loopList = on;
      KM.changed('input');
    },
    /** saat input masuk / keluar program (Auto Play / Auto Pause / Auto Restart) */
    onLive(inp, live) {
      if (!KM.inputs.isPlayable(inp) && inp.type !== 'replay') return;
      if (live) { if (inp.autoRestart) KM.inputs.restart(inp); if (inp.autoPlay) KM.inputs.play(inp); }
      else if (inp.autoPause) KM.inputs.pause(inp);
    }
  };
})(window.KM);
