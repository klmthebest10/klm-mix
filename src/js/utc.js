/* KLM Mix - UTC KLM Acara menyatu di KLM Mix
 * - Panel kontrol asli UTC KLM Acara (/utc) tampil di dalam KLM Mix (workspace penuh / jendela terpisah / HP)
 * - Overlay asli (/utc/overlay) dirender offscreen oleh Electron → tekstur WebGL → lapisan "UTC ON AIR"
 *   di atas Program (di bawah FTB): ikut rekam, stream, output eksternal, NDI, multiview.
 * - Bisa juga dipakai sebagai input "Grafis UTC KLM Acara" (untuk Overlay 1–4, layer, multiview).
 * - Suara video opening/closing masuk mixer audio KLM Mix (strip "UTC Opening/Closing").
 */
'use strict';
(function (KM) {
  const S = KM.state;
  const U = KM.utc = { avail: false, frames: 0, status: null, lastFrameAt: 0, err: '' };
  if (KM.settings.utcOnAir == null) KM.settings.utcOnAir = true;

  let cv = null, gl = null, tex = null, texW = 0, texH = 0, prog = null, has = false, idleUntil = 0;

  U.onAir = () => KM.settings.utcOnAir !== false;
  U.setOnAir = (on) => {
    KM.settings.utcOnAir = on == null ? !U.onAir() : !!on; KM.saveSettings();
    KM.toast(U.onAir() ? '● UTC ON AIR — grafis UTC tampil di Program' : 'UTC disembunyikan dari Program', U.onAir() ? 'ok' : 'warn');
    syncAudio(); KM.changed('utc');
  };
  U.canvas = () => cv;

  // ---------- WebGL: BGRA premultiplied → kanvas transparan ----------
  function initGL() {
    cv = document.createElement('canvas'); cv.width = KM.settings.width; cv.height = KM.settings.height;
    gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) { U.err = 'WebGL tidak tersedia'; return false; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision mediump float;varying vec2 v;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,v).bgra;}'));
    gl.linkProgram(prog); gl.useProgram(prog);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }
  /** terima potongan frame {x,y,w,h,W,H,buf} (BGRA premultiplied) */
  U.pushFrame = function (f) {
    if (!gl) return;
    if (f.W !== texW || f.H !== texH) {
      texW = f.W; texH = f.H; cv.width = texW; cv.height = texH;
      gl.viewport(0, 0, texW, texH);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    const b = f.buf instanceof Uint8Array ? f.buf : new Uint8Array(f.buf);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, f.x, f.y, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, b.byteLength === f.w * f.h * 4 ? b : b.subarray(0, f.w * f.h * 4));
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    has = true; U.frames++; U.lastFrameAt = KM.now(); idleUntil = KM.now() + 1500;
  };

  /** dipanggil engine setelah overlay 1–4, sebelum FTB */
  U.drawDSK = function (ctx, W, H) {
    if (!has || !U.onAir() || !anyVisible()) return;
    try { ctx.drawImage(cv, 0, 0, W, H); } catch (e) {}
  };
  // lewati drawImage bila overlay kosong (hemat GPU): ada grafis tampil, atau masih animasi keluar
  function anyVisible() {
    const st = U.status;
    if (!st) return true;
    if (st.oc || Object.values(st.visible || {}).some(Boolean)) return true;
    return KM.now() < idleUntil;
  }
  /** porsi piksel tidak transparan (untuk uji otomatis) */
  U.coverage = function () {
    if (!has) return 0;
    const c = document.createElement('canvas'); c.width = 192; c.height = 108;
    const x = c.getContext('2d'); x.drawImage(cv, 0, 0, 192, 108);
    const d = x.getImageData(0, 0, 192, 108).data; let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
    return n / (192 * 108);
  };

  // ---------- mulai render offscreen ----------
  U.start = function () {
    if (!KM.isElectron || !window.klm || !window.klm.send) { U.err = 'Lapisan UTC ON AIR hanya di versi PC (.exe). Di mode web, pakai alamat overlay di OBS/vMix.'; return; }
    if (!gl && !initGL()) return;
    U.avail = true;
    window.klm.send('utc:start', { w: KM.settings.width, h: KM.settings.height, fps: Math.min(60, KM.settings.fps || 30) });
  };
  if (KM.isElectron && window.klm && window.klm.on) {
    window.klm.on('utc:frame', (f) => { try { U.pushFrame(f); } catch (e) { console.warn('utc frame', e); } window.klm.send('utc:ack'); });
  }
  U.reload = () => { if (U.avail) window.klm.send('utc:reload'); };
  KM.on('resized', () => { if (U.avail) U.start(); });

  // ---------- input "Grafis UTC KLM Acara" ----------
  KM.inputTypes.utc = {
    label: 'Grafis UTC KLM Acara', icon: '🎬',
    create(inp) { inp.rt.ready = true; if (!inp.opts.note) inp.opts.note = 'Lower third, title, running text, logo, lokasi, sosmed, opening/closing'; },
    source(inp) {
      if (has) return { src: cv, w: cv.width, h: cv.height };
      return KM.placeholder(inp, '🎬 UTC KLM Acara', U.avail ? 'Menunggu grafis…' : (U.err || 'Memuat…'));
    }
  };
  U.addInput = () => {
    const ex = S.inputs.find((i) => i.type === 'utc');
    if (ex) { KM.engine.setPreview(ex.id); return ex; }
    return KM.inputs.create('utc', { title: 'Grafis UTC KLM Acara' });
  };

  // ---------- status dari server (setiap perubahan di panel UTC) ----------
  U.onStatus = function (st) {
    const was = U.status; U.status = st;
    if (was && st && was.eventType !== st.eventType) idleUntil = KM.now() + 2000;
    if (!st || !Object.values(st.visible || {}).some(Boolean)) idleUntil = Math.max(idleUntil, KM.now() + 2500); // beri waktu animasi keluar
    syncAudio();
    KM.changed('utc');
  };
  U.liveInfo = function () {
    if (!U.avail) return U.err || 'Memuat renderer…';
    const st = U.status; if (!st) return 'Menunggu panel…';
    const names = { lt: 'Lower Third', tt: 'Title', tk: 'Running Text', bug: 'Logo', loc: 'Lokasi', soc: 'Sosial Media' };
    const on = Object.keys(names).filter((k) => st.visible && st.visible[k]).map((k) => names[k]);
    if (st.oc) on.unshift(st.oc.kind === 'opening' ? 'OPENING' : 'CLOSING');
    return 'Acara: <b>' + KM.esc(st.eventName || st.eventType) + '</b> • Sedang tampil: <b>' + (on.length ? on.join(', ') : 'tidak ada') + '</b> • ' + U.frames + ' frame dirender';
  };
  U.cmd = (cmd, target, extra) => fetch('/utc/api/klm/cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ cmd, target }, extra || {})) }).then((r) => r.json()).catch((e) => ({ ok: false, msg: e.message }));

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
