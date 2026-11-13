/* KLM Mix - Latar AI: deteksi orang, hapus / ganti / buramkan latar secara realtime, dan bingkai otomatis mengikuti orang.
 * Berjalan sepenuhnya di PC tanpa internet (model segmentasi & mesin WASM/GPU ikut terpasang bersama aplikasi).
 * Chroma key tetap tersedia dan bisa dipakai bersamaan (diproses setelah tahap ini). */
'use strict';
(function (KM) {
  const SG = KM.seg = { state: 'idle', err: '', delegate: '' };
  let lib = null, fileset = null, loading = null;
  const MODEL = '/selfie_segmenter.tflite', BASE = '/vendor/mp';
  const DEF = { mode: 'off', feather: 3, edge: 0.5, blur: 14, colour: '#00b140', bgUrl: '', bgPath: '', bgFit: 'fill', invert: false, follow: false, followZoom: 1.6, hideEmpty: false };
  SG.DEF = DEF;
  /** pengaturan latar AI milik input (dibuat saat pertama dipakai) */
  SG.cfg = (inp) => (inp.seg || (inp.seg = Object.assign({}, DEF)));
  SG.on = (inp) => !!(inp.seg && inp.seg.mode && inp.seg.mode !== 'off');

  SG.load = function () {
    if (loading) return loading;
    SG.state = 'loading';
    loading = (async () => {
      try {
        const head = await fetch(MODEL, { method: 'HEAD' });
        if (!head.ok) throw new Error('model segmentasi tidak ada di instalasi ini');
        lib = await import(BASE + '/vision_bundle.mjs');
        fileset = await lib.FilesetResolver.forVisionTasks(BASE + '/wasm');
        SG.state = 'ready'; KM.changed('seg');
        return true;
      } catch (e) { SG.state = 'error'; SG.err = e.message; console.warn('[seg]', e); KM.changed('seg'); return false; }
    })();
    return loading;
  };
  async function make(delegate) {
    return lib.ImageSegmenter.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true });
  }
  async function attach(inp) {
    const rt = inp.rt; if (rt.segBusy || rt.segger) return;
    rt.segBusy = true;
    try {
      if (!(await SG.load())) return;
      try { rt.segger = await make(KM.settings.segCpu ? 'CPU' : 'GPU'); SG.delegate = KM.settings.segCpu ? 'CPU' : 'GPU'; }
      catch (e) { rt.segger = await make('CPU'); SG.delegate = 'CPU'; }
      KM.changed('seg');
    } catch (e) { rt.segErr = e.message; SG.err = e.message; console.warn('[seg] attach', e); }
    finally { rt.segBusy = false; }
  }
  SG.release = function (inp) {
    const rt = inp.rt;
    if (rt.segger) { try { rt.segger.close(); } catch (e) {} rt.segger = null; }
    rt.segOut = rt.segMask = rt.segA = null; rt.bgImg = rt.segBg = null;
  };

  const smooth = (a, b, t) => a + (b - a) * t;
  /** proses satu frame → canvas beralfa (atau null bila belum siap: sumber asli dipakai) */
  SG.process = function (inp, s) {
    const rt = inp.rt, o = inp.seg;
    if (!rt.segger) { attach(inp); return null; }
    const now = performance.now(), lite = KM.settings.perfLite || KM.settings.perf === 'hemat';
    const every = lite ? 66 : 33; // 15 / 30 kali per detik
    const W = Math.min(s.w, lite ? 960 : 1280), H = Math.round(W * s.h / s.w);
    if (!rt.segOut) { rt.segOut = document.createElement('canvas'); rt.segMask = document.createElement('canvas'); rt.segTmp = document.createElement('canvas'); }
    const out = rt.segOut; if (out.width !== W || out.height !== H) { out.width = W; out.height = H; }
    if (now - (rt.segAt || 0) >= every) {
      rt.segAt = now;
      try {
        rt.segger.segmentForVideo(s.src, Math.round(now), (res) => {
          const masks = res.confidenceMasks; if (!masks || !masks.length) return;
          const m = masks[masks.length - 1], mw = m.width, mh = m.height, f = m.getAsFloat32Array();
          const mc = rt.segMask; if (mc.width !== mw || mc.height !== mh) { mc.width = mw; mc.height = mh; rt.segA = null; }
          const n = mw * mh; if (!rt.segA) { rt.segA = new Float32Array(n); rt.segImg = new ImageData(mw, mh); }
          const A = rt.segA, px = rt.segImg.data, lo = Math.max(0.02, o.edge - 0.22), hi = Math.min(0.98, o.edge + 0.22), inv = !!o.invert;
          let cnt = 0, x0 = mw, y0 = mh, x1 = 0, y1 = 0;
          for (let i = 0; i < n; i++) {
            let v = f[i]; if (inv) v = 1 - v;
            v = v <= lo ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo); v = v * v * (3 - 2 * v);
            v = A[i] = A[i] * 0.35 + v * 0.65; // redam kedip antar frame
            px[i * 4 + 3] = v * 255;
            if (v > 0.5) { cnt++; const x = i % mw, y = (i / mw) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
          mc.getContext('2d').putImageData(rt.segImg, 0, 0);
          const cover = cnt / n; rt.segCover = cover;
          const had = rt.person; rt.person = cover > 0.015; // orang terdeteksi bila ≥1,5% gambar
          if (rt.person) rt.segBox = { x: x0 / mw, y: y0 / mh, w: (x1 - x0 + 1) / mw, h: (y1 - y0 + 1) / mh };
          if (had !== rt.person) KM.changed('seg');
          masks.forEach((k) => { try { k.close(); } catch (e) {} });
        });
      } catch (e) { rt.segErr = e.message; }
    }
    if (!rt.segA) return null;
    // bingkai otomatis: potong sumber mengikuti kotak orang (dihaluskan)
    let cx = 0, cy = 0, cw = 1, chh = 1;
    if (o.follow) {
      const b = rt.person && rt.segBox ? rt.segBox : { x: 0, y: 0, w: 1, h: 1 }, z = Math.max(1, o.followZoom || 1.6);
      let tw = Math.min(1, Math.max(1 / z, Math.max(b.w * 1.5, b.h * 1.25))), tx = b.x + b.w / 2 - tw / 2, ty = b.y + b.h * 0.45 - tw / 2;
      if (!rt.person) { tw = 1; tx = 0; ty = 0; }
      tx = Math.max(0, Math.min(1 - tw, tx)); ty = Math.max(0, Math.min(1 - tw, ty));
      const F = rt.segF || (rt.segF = { x: 0, y: 0, w: 1 }), k = 0.07;
      F.x = smooth(F.x, tx, k); F.y = smooth(F.y, ty, k); F.w = smooth(F.w, tw, k);
      cx = F.x; cy = F.y; cw = chh = F.w;
    }
    const c = out.getContext('2d'), mc = rt.segMask;
    c.globalCompositeOperation = 'copy'; c.filter = o.feather > 0 ? 'blur(' + (o.feather * W / 1280).toFixed(1) + 'px)' : 'none';
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(mc, cx * mc.width, cy * mc.height, cw * mc.width, chh * mc.height, 0, 0, W, H);
    c.filter = 'none'; c.globalCompositeOperation = 'source-in';
    try { c.drawImage(s.src, cx * s.w, cy * s.h, cw * s.w, chh * s.h, 0, 0, W, H); } catch (e) {}
    c.globalCompositeOperation = 'destination-over';
    if (o.hideEmpty && !rt.person) { c.globalCompositeOperation = 'copy'; c.fillStyle = 'rgba(0,0,0,0)'; c.fillRect(0, 0, W, H); c.globalCompositeOperation = 'source-over'; return out; }
    if (o.mode === 'blur') { c.filter = 'blur(' + (o.blur * W / 1280).toFixed(1) + 'px)'; try { c.drawImage(s.src, cx * s.w, cy * s.h, cw * s.w, chh * s.h, -W * 0.03, -H * 0.03, W * 1.06, H * 1.06); } catch (e) {} c.filter = 'none'; }
    else if (o.mode === 'colour') { c.fillStyle = o.colour || '#00b140'; c.fillRect(0, 0, W, H); }
    else if (o.mode === 'image') {
      if (o.bgUrl && (!rt.bgImg || rt.bgSrc !== o.bgUrl)) { rt.bgSrc = o.bgUrl; const im = new Image(); im.crossOrigin = 'anonymous'; im.src = o.bgUrl; rt.bgImg = im; }
      const im = rt.bgImg;
      if (im && im.complete && im.naturalWidth) { const sc = (o.bgFit === 'fit' ? Math.min : Math.max)(W / im.naturalWidth, H / im.naturalHeight), dw = im.naturalWidth * sc, dh = im.naturalHeight * sc; c.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh); }
      else { c.fillStyle = '#101820'; c.fillRect(0, 0, W, H); }
    }
    c.globalCompositeOperation = 'source-over';
    return out;
  };
})(window.KM);
