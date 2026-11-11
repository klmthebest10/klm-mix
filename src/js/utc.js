/* KLM Mix - UTC KLM Acara & UTC KLM Scoreboard menyatu di KLM Mix
 * - Panel kontrol asli tampil di dalam KLM Mix (workspace penuh / jendela terpisah / HP)
 * - Overlay asli dirender offscreen oleh Electron, BERLAPIS (lihat electron/utc-osr.js):
 *     score → main (LT/title/lokasi/sosmed/opening-closing) → tk (running text) → logo
 *   tiap lapisan = tekstur WebGL sendiri, hanya bagian yang berubah yang diunggah, dan hanya kotak
 *   isinya yang digambar ke Program. Lapisan yang kosong dijeda otomatis.
 * - Running text digulir NATIVE oleh mixer: teksnya dikirim sekali sebagai gambar, lalu digeser setiap
 *   frame Program sesuai jam → gerak halus & stabil di 30/50/60 fps walau banyak grafis/input.
 * - Lapisan tampil di atas Program (di bawah FTB): ikut rekam, stream, SRT, output eksternal, NDI, multiview.
 * - Input "Grafis UTC KLM Acara" / "Scoreboard UTC KLM" untuk Overlay 1–4, layer, multiview.
 * - Suara video opening/closing masuk mixer audio KLM Mix (strip "UTC Opening/Closing").
 */
'use strict';
(function (KM) {
  const S = KM.state;
  const U = KM.utc = { avail: false, frames: 0, status: null, lastFrameAt: 0, err: '' };
  const SC = KM.score = { status: null, port: 0 };
  if (KM.settings.utcOnAir == null) KM.settings.utcOnAir = true;
  if (KM.settings.scoreOnAir == null) KM.settings.scoreOnAir = false;
  const EPOCH = () => performance.timeOrigin + performance.now();

  U.onAir = () => KM.settings.utcOnAir !== false;
  U.setOnAir = (on) => {
    KM.settings.utcOnAir = on == null ? !U.onAir() : !!on; KM.saveSettings();
    KM.toast(U.onAir() ? '● UTC ON AIR — grafis UTC tampil di Program' : 'UTC disembunyikan dari Program', U.onAir() ? 'ok' : 'warn');
    syncAudio(); KM.changed('utc');
  };

  // ---------- lapisan ----------
  const ACARA = ['main', 'tk', 'logo'];
  const ORDER = ['score', 'main', 'tk', 'logo'];
  const KEYS = { main: ['lt', 'tt', 'loc', 'soc'], tk: ['tk'], logo: ['bug'] };
  const LY = {};
  ORDER.forEach((id) => { LY[id] = { id, cv: null, gl: null, texW: 0, texH: 0, has: false, bbox: null, idleUntil: 0, started: false, paused: false, usedAt: 0, frames: 0, native: null, nextNative: null }; });
  U.layers = LY;

  function initGL(L) {
    const cv = document.createElement('canvas'); cv.width = KM.settings.width; cv.height = KM.settings.height;
    const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) { U.err = 'WebGL tidak tersedia'; return false; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,v).bgra;}'));
    gl.linkProgram(prog); gl.useProgram(prog);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.SCISSOR_TEST);
    L.cv = cv; L.gl = gl;
    return true;
  }
  // kotak berisi piksel (untuk frame penuh): hanya kotak ini yang nanti digambar ke Program
  function alphaBox(b, w, h) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y += 2) {
      let row = y * w * 4 + 3, any = false;
      for (let x = 0; x < w; x += 2) { if (b[row + x * 4] > 2) { any = true; if (x < x0) x0 = x; if (x > x1) x1 = x; } }
      if (any) { if (y < y0) y0 = y; y1 = y; }
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4);
    return { x: x0, y: y0, w: Math.min(w, x1 + 6) - x0, h: Math.min(h, y1 + 6) - y0 };
  }
  const boxUnion = (a, b) => { if (!a) return b; if (!b) return a; const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

  /** terima potongan frame {L,x,y,w,h,W,H,buf} (BGRA premultiplied) */
  U.pushFrame = function (f) {
    const L = LY[f.L || 'main']; if (!L) return;
    if (!L.gl && !initGL(L)) return;
    const gl = L.gl, cv = L.cv;
    if (f.W !== L.texW || f.H !== L.texH) {
      L.texW = f.W; L.texH = f.H; cv.width = f.W; cv.height = f.H; L.bbox = null;
      gl.viewport(0, 0, f.W, f.H);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, f.W, f.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const n = f.w * f.h * 4;
    const b = f.buf instanceof Uint8Array ? f.buf : new Uint8Array(f.buf);
    const px = b.byteLength === n ? b : b.subarray(0, n);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, f.x, f.y, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.scissor(f.x, f.H - f.y - f.h, f.w, f.h); // gambar ulang hanya bagian yang berubah
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (f.w === f.W && f.h === f.H) L.bbox = alphaBox(px, f.w, f.h);
    else L.bbox = boxUnion(L.bbox, { x: f.x, y: f.y, w: f.w, h: f.h });
    L.has = true; L.frames++; U.frames++;
    const now = KM.now();
    U.lastFrameAt = now; L.idleUntil = now + 1500;
  };

  // ---------- running text native ----------
  function onTk(m) {
    const L = LY[m.L]; if (!L) return;
    if (m.k === 'reset') { L.native = L.nextNative = null; return; }
    if (m.k === 'live') { if (!m.id || (L.native && L.native.id === m.id) || (L.nextNative && L.nextNative.id === m.id)) { L.native = L.nextNative = null; } return; }
    if (m.k === 'geo') { for (const n of [L.native, L.nextNative]) if (n && n.id === m.id) n.vp = m.vp; return; }
    if (m.k === 'strip') {
      const tiles = [];
      for (const t of m.tiles || []) {
        const c = document.createElement('canvas'); c.width = t.w; c.height = t.h;
        const b = t.buf instanceof Uint8Array ? t.buf : new Uint8Array(t.buf);
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(b.buffer, b.byteOffset, t.w * t.h * 4), t.w, t.h), 0, 0);
        tiles.push({ x: t.x, w: t.w, h: t.h, c });
      }
      if (!tiles.length || !(m.w > 0)) return;
      L.nextNative = { id: m.id, at: m.at, vp: m.vp, w: m.w, speed: m.speed, snap: !!m.snap, px0: m.px0, E0: m.E0, tiles, cur: null, f: -1 };
      U.lastFrameAt = KM.now();
    }
  }
  const tkOff = (n, t) => n.px0 + (t - n.E0) * n.speed / 1000;
  // posisi gulir per frame Program: maju tepat satu langkah tiap frame (gerak rata, getaran jadwal frame diredam);
  // bila frame benar-benar terlewat / jadwal berbeda, posisi mengikuti jam → tetap sinkron dengan waktu & halaman overlay.
  function tkStep(n, t) {
    const f = KM.engine ? KM.engine.frame : 0;
    if (n.f === f && n.cur != null) return n.cur;
    const step = n.speed / (KM.settings.fps || 30), ideal = tkOff(n, t);
    if (n.cur == null || Math.abs(ideal - (n.cur + step)) > Math.max(0.6, step * 0.4)) n.cur = n.snap ? Math.round(ideal) : ideal;
    else n.cur += n.snap ? Math.round(step) : step;
    n.f = f;
    return n.cur;
  }
  function drawNative(ctx, L, sx, sy) {
    const t = EPOCH();
    if (L.nextNative && t >= L.nextNative.at) { L.native = L.nextNative; L.nextNative = null; }
    const n = L.native; if (!n || t < n.at) return;
    let off = tkStep(n, t) % n.w; if (off < 0) off += n.w;
    const vx = n.vp.x, vy = n.vp.y, vw = n.vp.w, vh = n.vp.h;
    ctx.save();
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.beginPath(); ctx.rect(vx, vy, vw, vh); ctx.clip();
    for (let base = vx - off; base < vx + vw; base += n.w) {
      for (const tl of n.tiles) {
        const x = base + tl.x;
        if (x > vx + vw || x + tl.w < vx) continue;
        ctx.drawImage(tl.c, x, vy);
      }
    }
    ctx.restore();
  }

  // ---------- gambar lapisan ----------
  function anyKey(id) {
    const st = U.status;
    if (!st) return true;
    if (id === 'main' && st.oc) return true;
    return (KEYS[id] || []).some((k) => st.visible && st.visible[k]);
  }
  function layerVisible(L) {
    if (!L.has) return false;
    if (L.id === 'score') return true;
    return anyKey(L.id) || KM.now() < L.idleUntil;
  }
  function drawLayer(ctx, L, W, H) {
    const sx = W / L.texW, sy = H / L.texH, b = L.bbox;
    if (b && b.w > 0 && b.h > 0) { try { ctx.drawImage(L.cv, b.x, b.y, b.w, b.h, b.x * sx, b.y * sy, b.w * sx, b.h * sy); } catch (e) {} }
    if (L.native || L.nextNative) drawNative(ctx, L, sx, sy);
  }
  /** dipanggil engine setelah overlay 1–4, sebelum FTB */
  U.drawDSK = function (ctx, W, H) {
    const acara = U.onAir(), score = KM.settings.scoreOnAir;
    for (const id of ORDER) {
      const L = LY[id];
      if (id === 'score' ? !score : !acara) continue;
      if (!layerVisible(L)) continue;
      drawLayer(ctx, L, W, H);
    }
  };
  U.animating = () => ACARA.some((id) => LY[id].native) || (KM.settings.scoreOnAir && LY.score.has);
  U.canvas = () => composite(ACARA);
  let compCv = null;
  function composite(ids) {
    if (!compCv) compCv = document.createElement('canvas');
    if (compCv.width !== KM.settings.width || compCv.height !== KM.settings.height) { compCv.width = KM.settings.width; compCv.height = KM.settings.height; }
    const c = compCv.getContext('2d');
    c.clearRect(0, 0, compCv.width, compCv.height);
    for (const id of ORDER) if (ids.includes(id) && layerVisible(LY[id])) drawLayer(c, LY[id], compCv.width, compCv.height);
    return compCv;
  }
  /** porsi piksel tidak transparan semua lapisan Acara (untuk uji otomatis) */
  U.coverage = function (ids) {
    const src = composite(ids || ACARA);
    const c = document.createElement('canvas'); c.width = 192; c.height = 108;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0, 192, 108);
    const d = x.getImageData(0, 0, 192, 108).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n / (192 * 108);
  };
  U.layerInfo = () => ORDER.map((id) => { const L = LY[id]; return { id, started: L.started, paused: L.paused, frames: L.frames, has: L.has, bbox: L.bbox, native: !!L.native }; });

  // ---------- mulai render offscreen ----------
  // Renderer offscreen baru dinyalakan saat grafis benar-benar dipakai; tiap lapisan dijeda sendiri-sendiri
  // bila beberapa detik tidak menampilkan apa-apa → ringan walau banyak input & resolusi tinggi.
  const isEl = () => KM.isElectron && window.klm && window.klm.send;
  const fpsOsr = () => Math.min(60, KM.settings.fps || 30);
  function startLayer(id) {
    const L = LY[id];
    if (!L.gl && !initGL(L)) return;
    L.started = true; L.paused = false; L.usedAt = KM.now(); L.native = L.nextNative = null; L.has = false; L.bbox = null;
    window.klm.send('utc:start', { L: id, w: KM.settings.width, h: KM.settings.height, fps: fpsOsr() });
  }
  function pauseLayer(id) { const L = LY[id]; if (L.started && !L.paused) { L.paused = true; L.native = L.nextNative = null; window.klm.send('utc:pause', { L: id }); } }
  function resumeLayer(id) { const L = LY[id]; L.usedAt = KM.now(); if (!L.started) startLayer(id); else if (L.paused) { L.paused = false; window.klm.send('utc:resume', { L: id }); } }
  U.started = false; U.paused = false;
  U.start = function () {
    if (!isEl()) { U.err = 'Lapisan UTC ON AIR hanya di versi PC (.exe). Di mode web, pakai alamat overlay di OBS/vMix.'; return; }
    U.avail = true; U.started = true; U.paused = false;
    ACARA.forEach(startLayer);
  };
  U.boot = function () { // dipanggil saat aplikasi dibuka: hanya menyiapkan, belum merender
    if (!isEl()) { U.err = 'Lapisan UTC ON AIR hanya di versi PC (.exe). Di mode web, pakai alamat overlay di OBS/vMix.'; return; }
    U.avail = true;
    if (S.inputs.some((i) => i.type === 'utc')) U.ensure();
    if (KM.settings.scoreOnAir || S.inputs.some((i) => i.type === 'score')) SC.ensure();
  };
  U.ensure = function () {
    if (!U.avail) return;
    if (!U.started) U.start();
    else { U.paused = false; ACARA.forEach((id) => { if (anyKey(id) || needAll()) resumeLayer(id); }); }
    U.usedAt = KM.now();
  };
  const needAll = () => S.inputs.some((i) => i.type === 'utc') || (document.getElementById('utcWs') && !document.getElementById('utcWs').hidden);
  setInterval(() => {
    if (!U.avail) return;
    const now = KM.now(), all = needAll();
    if (U.started) for (const id of ACARA) {
      const L = LY[id];
      if (anyKey(id) || all) { L.usedAt = now; if (L.paused) resumeLayer(id); continue; }
      if (!L.paused && now - L.usedAt > 6000) pauseLayer(id);
    }
    U.paused = U.started && ACARA.every((id) => LY[id].paused);
    const L = LY.score, want = KM.settings.scoreOnAir || S.inputs.some((i) => i.type === 'score');
    if (want) { if (!L.started || L.paused) SC.ensure(); L.usedAt = now; } else if (L.started && !L.paused && now - L.usedAt > 4000) pauseLayer('score');
  }, 1000);
  if (isEl() && window.klm.on) {
    window.klm.on('utc:frame', (f) => { try { U.pushFrame(f); } catch (e) { console.warn('utc frame', e); } window.klm.send('utc:ack', { L: f.L || 'main' }); });
    window.klm.on('utc:tk', (m) => { try { onTk(m); } catch (e) { console.warn('utc tk', e); } });
  }
  U.reload = () => { if (U.avail) { ORDER.forEach((id) => { LY[id].native = LY[id].nextNative = null; }); window.klm.send('utc:reload'); } };
  let lastSig = KM.settings.width + 'x' + KM.settings.height + '@' + fpsOsr();
  function restartAll() {
    const sig = KM.settings.width + 'x' + KM.settings.height + '@' + fpsOsr();
    if (sig === lastSig) return; lastSig = sig;
    for (const id of ORDER) if (LY[id].started) startLayer(id);
  }
  KM.on('resized', restartAll);
  KM.on('settings', () => setTimeout(restartAll, 50));

  // ---------- input "Grafis UTC KLM Acara" ----------
  KM.inputTypes.utc = {
    label: 'Grafis UTC KLM Acara', icon: '🎬',
    create(inp) { inp.rt.ready = true; setTimeout(() => U.ensure(), 0); if (!inp.opts.note) inp.opts.note = 'Lower third, title, running text, logo, lokasi, sosmed, opening/closing'; },
    source(inp) {
      if (ACARA.some((id) => LY[id].has)) { const c = composite(ACARA); return { src: c, w: c.width, h: c.height }; }
      return KM.placeholder(inp, '🎬 UTC KLM Acara', U.avail ? 'Menunggu grafis…' : (U.err || 'Memuat…'));
    }
  };
  U.addInput = () => {
    const ex = S.inputs.find((i) => i.type === 'utc');
    U.ensure();
    if (ex) { KM.engine.setPreview(ex.id); return ex; }
    return KM.inputs.create('utc', { title: 'Grafis UTC KLM Acara' });
  };

  // ---------- status dari server (setiap perubahan di panel UTC) ----------
  U.onStatus = function (st) {
    const was = U.status; U.status = st;
    if (U.avail && st) {
      if (!U.started && (st.oc || Object.values(st.visible || {}).some(Boolean))) U.start();
      else if (U.started) for (const id of ACARA) if (anyKey(id)) resumeLayer(id);
    }
    const now = KM.now();
    for (const id of ACARA) {
      const L = LY[id];
      const on = anyKey(id), wasOn = was ? (id === 'main' && was.oc) || (KEYS[id] || []).some((k) => was.visible && was.visible[k]) : false;
      if (wasOn && !on) L.idleUntil = Math.max(L.idleUntil, now + 2500); // beri waktu animasi keluar
    }
    if (was && st && was.eventType !== st.eventType) ACARA.forEach((id) => { LY[id].idleUntil = now + 2000; });
    syncAudio();
    KM.changed('utc');
  };
  U.liveInfo = function () {
    if (!U.avail) return U.err || 'Memuat renderer…';
    if (!U.started) return 'Renderer siap — menyala otomatis saat grafis ditampilkan';
    const st = U.status; if (!st) return 'Menunggu panel…';
    const names = { lt: 'Lower Third', tt: 'Title', tk: 'Running Text', bug: 'Logo', loc: 'Lokasi', soc: 'Sosial Media' };
    const on = Object.keys(names).filter((k) => st.visible && st.visible[k]).map((k) => names[k]);
    if (st.oc) on.unshift(st.oc.kind === 'opening' ? 'OPENING' : 'CLOSING');
    return 'Acara: <b>' + KM.esc(st.eventName || st.eventType) + '</b> • Sedang tampil: <b>' + (on.length ? on.join(', ') : 'tidak ada') + '</b>' + (LY.tk.native ? ' • running text native ' + (KM.settings.fps || 30) + ' fps' : '') + ' • ' + U.frames + ' frame';
  };
  U.cmd = (cmd, target, extra) => fetch('/utc/api/klm/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ cmd, target }, extra || {})) }).then((r) => r.json()).catch((e) => ({ ok: false, msg: e.message }));

  // ---------- UTC KLM Scoreboard ----------
  SC.onStatus = (st) => { SC.status = st; SC.port = (st && st.port) || 0; KM.changed('score'); };
  SC.url = (p) => SC.port ? 'http://' + location.hostname + ':' + SC.port + (p || '/') : '';
  SC.onAir = () => !!KM.settings.scoreOnAir;
  SC.ensure = () => { if (!U.avail) return; if (!SC.port) { setTimeout(() => { if (SC.port && (KM.settings.scoreOnAir || S.inputs.some((i) => i.type === 'score'))) SC.ensure(); }, 1500); return; } resumeLayer('score'); };
  SC.setOnAir = (on) => {
    KM.settings.scoreOnAir = on == null ? !SC.onAir() : !!on; KM.saveSettings();
    if (KM.settings.scoreOnAir) SC.ensure();
    KM.toast(SC.onAir() ? '● SCOREBOARD ON AIR — tampil di Program' : 'Scoreboard disembunyikan dari Program', SC.onAir() ? 'ok' : 'warn');
    KM.changed('score');
  };
  SC.cmd = (c) => fetch('/api/?Function=ScoreCmd&Value=' + encodeURIComponent(c)).then((r) => r.text()).then((t) => ({ ok: /successfully/.test(t), msg: t })).catch((e) => ({ ok: false, msg: e.message }));
  SC.reload = () => { if (U.avail && LY.score.started) window.klm.send('utc:reload', { L: 'score' }); };
  SC.coverage = () => U.coverage(['score']);
  KM.inputTypes.score = {
    label: 'Scoreboard UTC KLM', icon: '🏆',
    create(inp) { inp.rt.ready = true; setTimeout(() => SC.ensure(), 0); if (!inp.opts.note) inp.opts.note = 'Scoreboard olahraga (UTC KLM Scoreboard)'; },
    source(inp) {
      if (LY.score.has) { const c = composite(['score']); return { src: c, w: c.width, h: c.height }; }
      return KM.placeholder(inp, '🏆 Scoreboard UTC KLM', U.avail ? 'Menunggu scoreboard…' : (U.err || 'Memuat…'));
    }
  };
  SC.addInput = () => {
    const ex = S.inputs.find((i) => i.type === 'score');
    SC.ensure();
    if (ex) { KM.engine.setPreview(ex.id); return ex; }
    return KM.inputs.create('score', { title: 'Scoreboard UTC KLM' });
  };

  // ---------- audio video opening/closing → mixer audio ----------
  let aInp = null, aRun = '';
  function audioInput() {
    if (aInp) return aInp;
    const el = document.createElement('video');
    el.playsInline = true; el.preload = 'auto'; el.crossOrigin = 'anonymous'; el.style.display = 'none';
    aInp = KM.inputs.defaults('video');
    aInp.id = 'utc-oc-audio'; aInp.title = 'UTC Opening/Closing'; aInp.rt = { el, ready: true }; aInp.opts = {};
    return aInp;
  }
  function syncAudio() {
    const st = U.status, oc = st && st.oc;
    const want = U.avail && U.onAir() && oc && oc.video && oc.sound && !oc.done;
    if (!want) {
      if (aInp && !aInp.rt.el.paused) aInp.rt.el.pause();
      if (!oc) aRun = '';
      return;
    }
    const a = audioInput(), el = a.rt.el;
    a.audio.vol = Math.max(0, Math.min(100, +oc.volume || 0));
    if (aRun !== oc.run) {
      aRun = oc.run;
      if (el.getAttribute('src') !== oc.video) el.src = oc.video;
      try { el.currentTime = 0; } catch (e) {}
      KM.audio.attach(a); KM.audio.apply(a);
      el.play().catch(() => {});
    } else KM.audio.apply(a);
  }
  U.audioStrip = () => aInp;
})(window.KM);
