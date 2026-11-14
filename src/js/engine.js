/* KLM Mix - mesin render: preview, program, transisi, overlay 1-4, FTB, layer (MultiView), multiview, output */
'use strict';
(function (KM) {
  const S = KM.state;
  const E = KM.engine = {
    frame: 0, fps: 0, W: 1920, H: 1080, live: new Set(), lastRender: 0,
    TRANSITIONS: {
      cut: 'Cut', fade: 'Fade', merge: 'Merge', wipe: 'Wipe (kiri→kanan)', wipeup: 'Wipe (bawah→atas)', slide: 'Slide',
      slideup: 'Slide Atas', fly: 'Fly', zoom: 'Zoom', crosszoom: 'Cross Zoom', circle: 'Lingkaran (Iris)', barn: 'Barn Door',
      cube: 'Cube', dip: 'Dip ke Hitam', dipwhite: 'Dip ke Putih', blur: 'Blur', stinger1: 'Stinger 1', stinger2: 'Stinger 2'
    },
    OVERLAY_FX: { cut: 'Cut', fade: 'Fade', slide: 'Slide kanan', slideup: 'Slide bawah', zoom: 'Zoom', wipe: 'Wipe' }
  };

  E.init = function (progCanvas, prevCanvas) {
    E.prog = progCanvas; E.prev = prevCanvas;
    E.pctx = progCanvas.getContext('2d', { alpha: false, desynchronized: false });
    E.vctx = prevCanvas.getContext('2d', { alpha: false });
    E.resize();
    E.mv = document.createElement('canvas'); E.mv.width = 1920; E.mv.height = 1080; E.mvctx = E.mv.getContext('2d', { alpha: false });
    E.loop();
  };

  E.resize = function () {
    E.W = KM.settings.width; E.H = KM.settings.height;
    E.prog.width = E.W; E.prog.height = E.H;
    const ps = KM.settings.previewScale || 0.5;
    E.prev.width = Math.round(E.W * ps); E.prev.height = Math.round(E.H * ps);
    KM.fx && KM.fx.resize();
    if (E.stream) { E.stream.getTracks().forEach((t) => t.stop()); E.stream = null; }
    KM.emit('resized');
  };

  /** atur resolusi kanvas Preview (dipanggil UI). w/h kosong = kembali ke rasio output × skala preview */
  E.setPreviewSize = function (w, h) {
    if (!E.prev || !E.W) return; // mesin belum menyala
    const ps = KM.settings.previewScale || 0.5;
    w = Math.round(w || E.W * ps); h = Math.round(h || E.H * ps);
    if (E.prev.width !== w || E.prev.height !== h) { E.prev.width = w; E.prev.height = h; E.prevAt = 0; }
  };
  /** gambar src ke kotak dengan rasio terjaga (Preview mode grid bisa tidak 16:9) */
  E.drawContain = function (c, src, x, y, w, hh) {
    const sw = src.width || src.videoWidth, sh = src.height || src.videoHeight; if (!sw || !sh) return;
    const sc = Math.min(w / sw, hh / sh), dw = sw * sc, dh = sh * sc;
    if (Math.abs(dw - w) > 1 || Math.abs(dh - hh) > 1) { c.fillStyle = '#000'; c.fillRect(x, y, w, hh); }
    c.drawImage(src, x + (w - dw) / 2, y + (hh - dh) / 2, dw, dh);
  };

  E.programStream = function () {
    if (!E.stream || E.stream.getVideoTracks()[0].readyState === 'ended') E.stream = E.prog.captureStream(KM.settings.fps);
    return E.stream;
  };
  E.multiviewStream = function () {
    E.mvOn = true;
    if (!E.mvStream) E.mvStream = E.mv.captureStream(25);
    return E.mvStream;
  };

  // ---------- sumber per frame (dengan efek) ----------
  function getSource(inp) {
    const rt = inp.rt;
    if (rt.srcFrame === E.frame) return rt.srcCache;
    const t = KM.inputTypes[inp.type];
    if (t.tick) t.tick(inp, KM.now());
    let s = KM.inputs.source(inp);
    if (s && s.w && KM.seg && KM.seg.on(inp)) { // latar AI (hapus/ganti/buram latar) sebelum chroma key & koreksi warna
      const c = s.src === rt.ph ? null : KM.seg.process(inp, s);
      if (c) s = { src: c, w: c.width, h: c.height };
    }
    if (s && KM.fx.needs(inp)) {
      const c = KM.fx.process(inp, s.src, s.w, s.h);
      if (c) s = { src: c, w: c.width, h: c.height };
    }
    rt.srcFrame = E.frame; rt.srcCache = s;
    return s;
  }
  E.getSource = getSource;

  /** gambar input ke persegi (rx,ry,rw,rh) — dengan posisi/zoom/crop/rotasi & layer */
  function drawInputRect(ctx, inp, rx, ry, rw, rh, depth) {
    depth = depth || 0;
    if (!inp || depth > 4) return;
    const t = KM.inputTypes[inp.type];
    if (!t || t.noVideo) return;
    const s = getSource(inp);
    if (s && s.w && s.h) {
      const p = inp.pos;
      let sc;
      if (p.fit === 'fill') sc = Math.max(rw / s.w, rh / s.h);
      else sc = Math.min(rw / s.w, rh / s.h);
      let dw = s.w * sc * p.zoom, dh = s.h * sc * p.zoom;
      if (p.fit === 'stretch') { dw = rw * p.zoom; dh = rh * p.zoom; }
      const cx = rx + rw / 2 + p.x * rw / 2, cy = ry + rh / 2 + p.y * rh / 2;
      const cl = p.cropL || 0, cr = p.cropR || 0, ct = p.cropT || 0, cb = p.cropB || 0;
      const fw = Math.max(0.001, 1 - cl - cr), fh = Math.max(0.001, 1 - ct - cb);
      ctx.save();
      if (depth > 0) { ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip(); }
      ctx.translate(cx, cy);
      if (p.rot) ctx.rotate(p.rot * Math.PI / 180);
      try {
        ctx.drawImage(s.src, cl * s.w, ct * s.h, fw * s.w, fh * s.h, -dw / 2 + cl * dw, -dh / 2 + ct * dh, fw * dw, fh * dh);
      } catch (e) {}
      ctx.restore();
    }
    if (inp.type === 'virtualset' && inp.opts.bgDim > 0) { ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.9, inp.opts.bgDim) + ')'; ctx.fillRect(rx, ry, rw, rh); }
    for (const l of inp.layers) {
      if (!l.on) continue;
      const li = KM.getInput(l.inputId);
      if (li === inp) continue;
      drawLayer(ctx, l, li, rx + l.x * rw, ry + l.y * rh, l.w * rw, l.h * rh, depth, rw / 1920);
    }
    if (inp.type === 'virtualset' && inp.rt.fg && inp.rt.fg.complete && inp.rt.fg.naturalWidth) { try { ctx.drawImage(inp.rt.fg, rx, ry, rw, rh); } catch (e) {} }
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); if (r > 0.5 && ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); else ctx.rect(x, y, w, h); }
  /** satu layer/kotak: bingkai, sudut bulat, bayangan, transparansi, isi (zoom/geser/pangkas sendiri), label */
  function drawLayer(ctx, l, li, x, y, w, h, depth, k) {
    if (w <= 0 || h <= 0) return;
    const r = (l.rad || 0) * Math.min(w, h) / 2, b = (l.bw || 0) * k;
    ctx.save();
    if (l.op != null && l.op < 1) ctx.globalAlpha *= Math.max(0, l.op);
    if (l.sh && (li || l.bg || b)) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 40 * k * l.sh; ctx.shadowOffsetY = 14 * k * l.sh; ctx.fillStyle = '#000'; rrect(ctx, x - b, y - b, w + 2 * b, h + 2 * b, r + b); ctx.fill(); ctx.restore(); }
    if (b) { ctx.fillStyle = l.bc || '#ffffff'; rrect(ctx, x - b, y - b, w + 2 * b, h + 2 * b, r + b); ctx.fill(); }
    if (l.bg) { ctx.fillStyle = l.bg; rrect(ctx, x, y, w, h, r); ctx.fill(); }
    if (li) {
      ctx.save();
      if (l.fit) { rrect(ctx, x, y, w, h, r); ctx.clip(); drawView(ctx, l, li, x, y, w, h, depth); }
      else { if (r) { rrect(ctx, x, y, w, h, r); ctx.clip(); } drawInputRect(ctx, li, x, y, w, h, depth + 1); } // layer lama: ikut posisi input sumber
      ctx.restore();
    }
    if (l.label) {
      const fs = Math.max(11 * k, Math.min(h * 0.085, 34 * k)), pad = fs * 0.55;
      ctx.font = '700 ' + fs + 'px "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const tw = Math.min(ctx.measureText(l.label).width, w - pad * 4), bx = x + pad, bh = fs * 1.75, by = y + h - bh - pad;
      ctx.fillStyle = 'rgba(8,10,14,.78)'; rrect(ctx, bx, by, tw + pad * 2.4, bh, bh * 0.22); ctx.fill();
      ctx.fillStyle = l.bc && l.bw ? l.bc : '#ff7a1a'; ctx.fillRect(bx, by, Math.max(2, fs * 0.16), bh);
      ctx.fillStyle = '#fff'; ctx.fillText(l.label, bx + pad * 1.2, by + bh / 2 + fs * 0.04, tw);
    }
    ctx.restore();
  }
  /** isi kotak dengan framing milik layer: pangkas → fit/fill → zoom → geser (tidak mengubah input aslinya) */
  function drawView(ctx, l, li, x, y, w, h, depth) {
    if (depth > 3) return;
    const t = KM.inputTypes[li.type]; if (!t || t.noVideo) return;
    const comp = li.type === 'virtualset' || li.layers.some((a) => a.on && a.inputId);
    let s = null, sw = E.W, sh = E.H;
    if (!comp) { s = getSource(li); if (!s || !s.w || !s.h) return; sw = s.w; sh = s.h; }
    const cl = l.cropL || 0, cr = l.cropR || 0, ct = l.cropT || 0, cb = l.cropB || 0;
    const fw = Math.max(0.02, 1 - cl - cr), fh = Math.max(0.02, 1 - ct - cb), cw = sw * fw, chh = sh * fh;
    const sc = l.fit === 'fit' ? Math.min(w / cw, h / chh) : Math.max(w / cw, h / chh);
    let dw = cw * sc, dh = chh * sc;
    if (l.fit === 'stretch') { dw = w; dh = h; }
    const z = l.zoom || 1; dw *= z; dh *= z;
    const cx = x + w / 2 + (l.px || 0) * w / 2, cy = y + h / 2 + (l.py || 0) * h / 2;
    if (l.flip) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
    if (l.rot) { ctx.translate(cx, cy); ctx.rotate(l.rot * Math.PI / 180); ctx.translate(-cx, -cy); }
    if (!comp) { try { ctx.drawImage(s.src, cl * sw, ct * sh, cw, chh, cx - dw / 2, cy - dh / 2, dw, dh); } catch (e) {} }
    else {
      const FW = dw / fw, FH = dh / fh;
      ctx.beginPath(); ctx.rect(cx - dw / 2, cy - dh / 2, dw, dh); ctx.clip();
      drawInputRect(ctx, li, cx - dw / 2 - cl * FW, cy - dh / 2 - ct * FH, FW, FH, depth + 1);
    }
  }
  E.drawInputRect = drawInputRect;

  function full(ctx, inp, alpha, tf) {
    if (!inp || alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    if (tf) tf(ctx);
    drawInputRect(ctx, inp, 0, 0, E.W, E.H, 0);
    ctx.restore();
  }
  function zoomTf(z, cx, cy) { return (c) => { c.translate(cx, cy); c.scale(z, z); c.translate(-cx, -cy); }; }

  // ---------- transisi ----------
  function drawTransition(ctx, tr) {
    const W = E.W, H = E.H;
    const A = KM.getInput(tr.fromId), B = KM.getInput(tr.toId);
    const p = tr.type === 'cut' ? 1 : KM.ease(KM.clamp(tr.p, 0, 1));
    switch (tr.type) {
      case 'fade': full(ctx, A, 1); full(ctx, B, p); break;
      case 'merge': full(ctx, A, 1 - p * 0.3, zoomTf(1 + p * 0.06, W / 2, H / 2)); full(ctx, B, p, zoomTf(1.08 - 0.08 * p, W / 2, H / 2)); break;
      case 'wipe': full(ctx, A, 1); ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W * p, H); ctx.clip(); full(ctx, B, 1); ctx.restore(); break;
      case 'wipeup': full(ctx, A, 1); ctx.save(); ctx.beginPath(); ctx.rect(0, H * (1 - p), W, H * p); ctx.clip(); full(ctx, B, 1); ctx.restore(); break;
      case 'slide': full(ctx, A, 1, (c) => c.translate(-W * p, 0)); full(ctx, B, 1, (c) => c.translate(W * (1 - p), 0)); break;
      case 'slideup': full(ctx, A, 1, (c) => c.translate(0, -H * p)); full(ctx, B, 1, (c) => c.translate(0, H * (1 - p))); break;
      case 'fly': full(ctx, A, 1); full(ctx, B, Math.min(1, p * 1.5), (c) => { c.translate(W / 2 - (1 - p) * W * 0.4, H / 2 - (1 - p) * H * 0.4); c.rotate(-(1 - p) * 0.5); c.scale(p, p); c.translate(-W / 2, -H / 2); }); break;
      case 'zoom': full(ctx, A, 1 - p, zoomTf(1 + p * 0.8, W / 2, H / 2)); full(ctx, B, p, zoomTf(0.7 + 0.3 * p, W / 2, H / 2)); break;
      case 'crosszoom':
        if (p < 0.5) full(ctx, A, 1, zoomTf(1 + p * 4, W / 2, H / 2));
        else full(ctx, B, 1, zoomTf(1 + (1 - p) * 4, W / 2, H / 2));
        ctx.fillStyle = 'rgba(255,255,255,' + (0.5 - Math.abs(p - 0.5)) * 0.8 + ')'; ctx.fillRect(0, 0, W, H);
        break;
      case 'circle': full(ctx, A, 1); ctx.save(); ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * p, 0, Math.PI * 2); ctx.clip(); full(ctx, B, 1); ctx.restore(); break;
      case 'barn': full(ctx, A, 1); ctx.save(); ctx.beginPath(); ctx.rect(W / 2 * (1 - p), 0, W * p, H); ctx.clip(); full(ctx, B, 1); ctx.restore(); break;
      case 'cube':
        full(ctx, A, 1, (c) => { c.translate(-0, 0); c.scale(Math.max(0.001, 1 - p), 1); });
        ctx.fillStyle = 'rgba(0,0,0,' + p * 0.6 + ')'; ctx.fillRect(0, 0, W * (1 - p), H);
        full(ctx, B, 1, (c) => { c.translate(W * (1 - p), 0); c.scale(Math.max(0.001, p), 1); });
        ctx.fillStyle = 'rgba(0,0,0,' + (1 - p) * 0.6 + ')'; ctx.fillRect(W * (1 - p), 0, W * p, H);
        break;
      case 'dip': case 'dipwhite': {
        const col = tr.type === 'dip' ? '0,0,0' : '255,255,255';
        if (p < 0.5) { full(ctx, A, 1); ctx.fillStyle = `rgba(${col},${p * 2})`; }
        else { full(ctx, B, 1); ctx.fillStyle = `rgba(${col},${(1 - p) * 2})`; }
        ctx.fillRect(0, 0, W, H); break;
      }
      case 'blur': {
        const b = Math.round(Math.sin(p * Math.PI) * 24);
        ctx.save(); ctx.filter = 'blur(' + b + 'px)'; full(ctx, A, 1); full(ctx, B, p); ctx.restore(); break;
      }
      case 'stinger1': case 'stinger2': {
        const el = KM.now() - tr.t0;
        full(ctx, el < tr.cut ? A : B, 1);
        const st = KM.getInput(tr.stingerId);
        if (st) full(ctx, st, 1);
        break;
      }
      default: full(ctx, B, 1);
    }
  }

  function finishTransition() {
    const tr = S.trans; if (!tr) return;
    const old = S.programId;
    S.programId = tr.toId;
    if (!tr.keepPreview && KM.settings.swapPreview !== false) S.previewId = old || S.previewId;
    if (tr.stingerId) { const st = KM.getInput(tr.stingerId); if (st) KM.inputs.pause(st); }
    S.trans = null; S.tbar = 0;
    KM.changed('program');
  }

  /** Mulai transisi ke input (default: preview) */
  E.transition = function (type, dur, toKey, opts) {
    opts = opts || {};
    if (S.trans && !S.trans.manual) finishTransition();
    const to = toKey != null ? KM.getInput(toKey) : KM.getInput(S.previewId);
    if (!to) return false;
    if (to.id === S.programId && !opts.force) { if (!opts.keepPreview) { /* tetap */ } return false; }
    type = type || 'fade';
    const tr = { type, dur: Math.max(1, dur == null ? 500 : +dur), t0: KM.now(), fromId: S.programId, toId: to.id, p: 0, keepPreview: !!opts.keepPreview, manual: false };
    if (type === 'stinger1' || type === 'stinger2') {
      const sg = KM.settings.stingers[type === 'stinger1' ? 0 : 1];
      const st = KM.getInput(sg.inputId);
      if (!st) { KM.toast('Stinger belum diatur — pilih video stinger di Pengaturan > Transisi', 'warn'); type = tr.type = 'fade'; }
      else {
        tr.stingerId = st.id; tr.cut = sg.cut || 500;
        const m = KM.inputs.media(st);
        tr.dur = m && m.duration && isFinite(m.duration) ? m.duration * 1000 : Math.max(tr.cut * 2, 1000);
        KM.inputs.restart(st); KM.inputs.play(st);
      }
    }
    if (type === 'cut') { S.trans = tr; finishTransition(); return true; }
    S.trans = tr;
    KM.changed('trans');
    return true;
  };
  E.cut = (toKey) => E.transition('cut', 0, toKey);
  E.quickPlay = (key) => { const t = KM.settings.transitions[0]; return E.transition(t.type, t.dur, key, { keepPreview: true }); };

  /** T-Bar manual 0..1 */
  E.setTbar = function (v) {
    v = KM.clamp(v, 0, 1);
    if (!S.trans) {
      if (v <= 0.001) return;
      const to = KM.getInput(S.previewId); if (!to || to.id === S.programId) return;
      const t = KM.settings.transitions[0];
      S.trans = { type: t.type.startsWith('stinger') ? 'fade' : t.type, dur: 1, t0: 0, fromId: S.programId, toId: to.id, p: 0, manual: true };
    }
    S.trans.manual = true; S.trans.p = v; S.tbar = v;
    if (v >= 0.999) finishTransition();
    else if (v <= 0.001) { S.trans = null; S.tbar = 0; }
    KM.changed('tbar');
  };

  E.setPreview = function (key) {
    const i = KM.getInput(key); if (!i) return false;
    S.previewId = i.id; KM.changed('preview'); return true;
  };

  // ---------- overlay 1-4 ----------
  E.overlay = function (n, key, mode) {
    const ch = S.overlays[n]; if (!ch) return false;
    const inp = key != null && key !== '' ? KM.getInput(key) : KM.getInput(ch.inputId);
    mode = mode || 'toggle';
    const isOn = ch.phase === 'in' || ch.phase === 'on';
    if (mode === 'toggle') mode = (isOn && (!inp || inp.id === ch.inputId)) ? 'out' : 'in';
    if (mode === 'in') {
      if (!inp) return false;
      if (isOn && ch.inputId !== inp.id) { // ganti isi overlay
        const old = KM.getInput(ch.inputId); if (old && old.type === 'title') KM.titles.hideNow(old);
      }
      ch.inputId = inp.id; ch.phase = 'in'; ch.t0 = KM.now();
      if (inp.type === 'title') KM.titles.animIn(inp);
    } else if (mode === 'out') {
      if (!ch.inputId || ch.phase === 'off') return true;
      ch.phase = 'out'; ch.t0 = KM.now();
      const ti = KM.getInput(ch.inputId); if (ti && ti.type === 'title') KM.titles.animOut(ti);
    } else if (mode === 'off') { ch.phase = 'off'; }
    KM.changed('overlay');
    return true;
  };
  E.overlayAllOff = () => S.overlays.forEach((o, i) => E.overlay(i, null, 'out'));

  function drawOverlays(ctx) {
    const now = KM.now();
    S.overlays.forEach((ch, n) => {
      if (ch.phase === 'off' || !ch.inputId) return;
      const inp = KM.getInput(ch.inputId); if (!inp) { ch.phase = 'off'; return; }
      const fx = KM.settings.overlayFx[n] || { type: 'fade', dur: 400 };
      const isTitle = inp.type === 'title';
      const dur = fx.type === 'cut' || isTitle ? 0 : fx.dur;
      let p = 1;
      if (ch.phase === 'in') { p = dur ? (now - ch.t0) / dur : 1; if (p >= 1) { p = 1; ch.phase = 'on'; KM.changed('overlay'); } }
      else if (ch.phase === 'out') {
        if (isTitle) { if (KM.titles.isHidden(inp)) { ch.phase = 'off'; KM.titles.reset(inp); KM.changed('overlay'); return; } p = 1; }
        else { p = dur ? 1 - (now - ch.t0) / dur : 0; if (p <= 0) { ch.phase = 'off'; KM.changed('overlay'); return; } }
      }
      const e = KM.ease(KM.clamp(p, 0, 1)), W = E.W, H = E.H;
      const type = isTitle ? 'cut' : fx.type;
      if (type === 'fade') full(ctx, inp, e);
      else if (type === 'slide') full(ctx, inp, 1, (c) => c.translate(W * (1 - e), 0));
      else if (type === 'slideup') full(ctx, inp, 1, (c) => c.translate(0, H * (1 - e)));
      else if (type === 'zoom') full(ctx, inp, e, zoomTf(Math.max(0.01, e), W / 2, H / 2));
      else if (type === 'wipe') { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W * e, H); ctx.clip(); full(ctx, inp, 1); ctx.restore(); }
      else full(ctx, inp, 1);
    });
  }

  // ---------- Fade To Black ----------
  E.ftb = function (on) {
    S.ftb.on = on == null ? !S.ftb.on : !!on;
    S.ftb.t0 = KM.now(); S.ftb.from = S.ftb.v;
    KM.changed('ftb');
  };

  // ---------- input yang sedang "live" ----------
  function collectLive(set, inp, depth) {
    if (!inp || depth > 4 || set.has(inp.id)) return;
    set.add(inp.id);
    inp.layers.forEach((l) => { if (l.on) collectLive(set, KM.getInput(l.inputId), depth + 1); });
  }
  function updateLive() {
    const set = new Set();
    collectLive(set, KM.getInput(S.programId), 0);
    if (S.trans) { collectLive(set, KM.getInput(S.trans.toId), 0); if (S.trans.stingerId) set.add(S.trans.stingerId); }
    S.overlays.forEach((o) => { if (o.phase !== 'off' && o.inputId) collectLive(set, KM.getInput(o.inputId), 0); });
    let changed = set.size !== E.live.size;
    if (!changed) for (const id of set) if (!E.live.has(id)) { changed = true; break; }
    if (changed) {
      const prev = E.live; E.live = set;
      for (const id of set) if (!prev.has(id)) { const i = KM.getInput(id); if (i && (!S.trans || id !== S.trans.stingerId)) { KM.inputs.onLive(i, true); KM.emit('input-live', { inp: i, live: true }); } }
      for (const id of prev) if (!set.has(id)) { const i = KM.getInput(id); if (i) { KM.inputs.onLive(i, false); KM.emit('input-live', { inp: i, live: false }); } }
      KM.emit('tally');
    }
  }
  E.isLive = (inp) => E.live.has(inp.id);
  E.tallyOf = (inp) => (E.live.has(inp.id) ? 'program' : (inp.id === S.previewId ? 'preview' : 'off'));

  // ---------- multiview ----------
  function drawMultiview() {
    const c = E.mvctx, W = 1920, H = 1080;
    c.fillStyle = '#0b0c10'; c.fillRect(0, 0, W, H);
    const box = (x, y, w, hgt, label, color, src) => {
      if (src) { try { E.drawContain(c, src, x, y, w, hgt); } catch (e) {} }
      c.strokeStyle = color; c.lineWidth = color === '#333' ? 2 : 6; c.strokeRect(x + 2, y + 2, w - 4, hgt - 4);
      c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(x + 6, y + hgt - 40, Math.min(w - 12, 20 + label.length * 15), 34);
      c.fillStyle = '#fff'; c.font = '600 22px Segoe UI, Arial'; c.textAlign = 'left'; c.fillText(label, x + 14, y + hgt - 15);
    };
    const pv = KM.getInput(S.previewId);
    box(0, 0, 960, 540, 'PREVIEW ' + (pv ? KM.inputNum(pv) + ' ' + pv.title : ''), '#22c55e', E.prev);
    box(960, 0, 960, 540, 'PROGRAM', '#ef4444', E.prog);
    const ins = S.inputs.slice(0, 8);
    ins.forEach((inp, i) => {
      const x = (i % 4) * 480, y = 540 + Math.floor(i / 4) * 270;
      c.save(); c.beginPath(); c.rect(x, y, 480, 270); c.clip();
      c.fillStyle = '#000'; c.fillRect(x, y, 480, 270);
      drawInputRect(c, inp, x, y, 480, 270, 0);
      c.restore();
      const tl = E.tallyOf(inp);
      box(x, y, 480, 270, (i + 1) + '  ' + inp.title, tl === 'program' ? '#ef4444' : tl === 'preview' ? '#22c55e' : '#333', null);
    });
    const d = new Date();
    c.fillStyle = '#fff'; c.font = 'bold 30px Consolas, monospace'; c.textAlign = 'right';
    c.fillText(d.toLocaleTimeString('id-ID'), W - 20, 44);
    if (S.recording) { c.fillStyle = '#ef4444'; c.fillText('● REC', W - 20, 84); }
    if (S.streaming) { c.fillStyle = '#ef4444'; c.fillText('● LIVE', W - 20, 124); }
  }

  // ---------- thumbnail ----------
  // Sumber live (kamera, KLMCAM, layar, tamu) tampil langsung dari stream-nya di kartu (mulus, nyaris tanpa beban).
  // Sisanya digambar ulang berdasarkan waktu: media yang sedang diputar sering, gambar diam jarang. Dibatasi anggaran waktu per frame.
  // sumber video langsung untuk thumbnail: stream kamera/KLMCAM/layar, atau video yang sedang diputar (captureStream)
  E.liveStream = (inp) => {
    if (KM.inputTypes[inp.type].noVideo) return null;
    const rt = inp.rt;
    if (KM.seg && KM.seg.on(inp)) return null; // kartu menampilkan hasil olahan, bukan video mentah
    if (rt.stream && rt.stream.getVideoTracks().some((t) => t.readyState === 'live')) return rt.stream;
    const md = KM.inputs.media(inp);
    if (!md || md.tagName !== 'VIDEO' || md.paused || md.readyState < 2 || !md.captureStream || rt.capFail) return null;
    if (!rt.cap || rt.capEl !== md) {
      try { rt.cap = md.captureStream(); rt.capEl = md; } catch (e) { rt.capFail = true; return null; }
    }
    return rt.cap.getVideoTracks().some((t) => t.readyState === 'live') ? rt.cap : null;
  };
  E.liveThumb = (inp) => !!E.liveStream(inp);
  E.updateThumbs = (now) => updateThumbs(now);
  /** input gabungan (layer / virtual set) yang isinya bergerak: kamera, KLMCAM, video diputar, latar video… */
  function compMoving(inp, depth) {
    if ((depth || 0) > 3) return false;
    if (inp.type === 'virtualset' && inp.rt.bgVid && !inp.rt.bgVid.paused) return true;
    for (const l of inp.layers) {
      if (!l.on || !l.inputId) continue;
      const li = KM.getInput(l.inputId); if (!li || li === inp) continue;
      if (E.liveStream(li) || KM.inputs.isPlaying(li) || li.rt.anim || !STATIC_T[li.type] || compMoving(li, (depth || 0) + 1)) return true;
    }
    return false;
  }
  E.animThumbs = 0; // jumlah kartu yang harus digambar terus (input gabungan berisi sumber bergerak)
  /** Program bersih = hanya input itu (tanpa transisi, overlay, grafis UTC, FTB) → kartunya cukup menyalin kanvas Program */
  function progClean() {
    if (S.trans || S.ftb.v > 0) return false;
    if ((S.overlays || []).some((o) => o && o.phase !== 'off')) return false;
    if (KM.utc && KM.utc.onAir && KM.utc.onAir()) return false;
    return true;
  }
  function drawThumb(inp, cv, now) {
    inp.rt.thumbAt = now;
    const c = cv.getContext('2d');
    try {
      if (KM.inputTypes[inp.type].noVideo) { const s = KM.inputs.source(inp); c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height); if (s) c.drawImage(s.src, 0, 0, cv.width, cv.height); return; }
      // input yang sedang di Preview / Program sudah digambar mesin frame ini → salin saja (1 drawImage, sama persis)
      if (inp.id === S.previewId && !E.gridActive() && E.prevAt && now - E.prevAt < 120) { c.drawImage(E.prev, 0, 0, cv.width, cv.height); return; }
      if (inp.id === S.programId && progClean() && E.progAt && now - E.progAt < 120) { c.drawImage(E.prog, 0, 0, cv.width, cv.height); return; }
      c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
      drawInputRect(c, inp, 0, 0, cv.width, cv.height, 0);
    } catch (e) {}
  }
  let thumbCursor = 0;
  function updateThumbs(now) {
    const n = S.inputs.length; if (!n) return;
    const mode = KM.settings.perfLite ? 'hemat' : KM.settings.perf || 'seimbang';
    // kartu gabungan berisi sumber bergerak (kamera, video, KLMCAM…) digambar DULUAN dengan jadwal tetap (30 fps, hemat 16 fps)
    // tanpa dipotong anggaran waktu → gerakannya rata, tidak patah-patah
    const compIv = mode === 'hemat' ? 62 : 33;
    let anim = 0;
    for (let k = 0; k < n; k++) {
      const inp = S.inputs[k];
      const cv = inp.rt.thumb; if (!cv || !cv.isConnected || E.liveThumb(inp)) continue;
      if (now - (inp.rt.compAt || 0) > 500) { inp.rt.compAt = now; inp.rt.comp = compMoving(inp); } // dicek 2×/detik, bukan tiap frame
      if (!inp.rt.comp || cv._vis === false) continue;
      anim++;
      if (now - (inp.rt.thumbAt || 0) >= compIv - 4) drawThumb(inp, cv, now);
    }
    E.animThumbs = anim;
    // sisanya: sumber kanvas (title, slide, grafis UTC…) sering, gambar diam jarang — dibatasi anggaran waktu, bergiliran
    const fast = 1000 / (mode === 'hemat' ? 10 : 30), slow = mode === 'hemat' ? 2000 : 900;
    const budget = mode === 'hemat' ? 3 : 6, t0 = performance.now();
    for (let k = 0; k < n; k++) {
      const inp = S.inputs[(thumbCursor + k) % n];
      const cv = inp.rt.thumb; if (!cv || !cv.isConnected || inp.rt.comp || E.liveThumb(inp)) continue;
      const moving = KM.inputs.isPlaying(inp) || inp.type === 'list' || inp.type === 'browser' || inp.type === 'utc' || inp.type === 'score' || inp.type === 'title' || inp.type === 'mirror' || inp.rt.anim;
      if (now - (inp.rt.thumbAt || 0) < (cv._vis === false ? 3000 : moving ? fast : slow)) continue;
      drawThumb(inp, cv, now);
      if (performance.now() - t0 > budget) { thumbCursor = (thumbCursor + k + 1) % n; return; }
    }
    thumbCursor = (thumbCursor + 1) % n;
  }

  // ---------- loop render ----------
  let fpsCount = 0, fpsT = KM.now(), mvTick = 0;
  E.render = function () {
    const now = KM.now();
    E.frame++;
    // transisi
    if (S.trans && !S.trans.manual) {
      S.trans.p = (now - S.trans.t0) / S.trans.dur;
      if (S.trans.stingerId) { const m = KM.inputs.media(KM.getInput(S.trans.stingerId) || {}); if (m && m.ended) S.trans.p = 1; }
      if (S.trans.p >= 1) finishTransition();
    }
    // FTB
    const f = S.ftb, target = f.on ? 1 : 0;
    if (f.v !== target) { const k = KM.clamp((now - f.t0) / 1000, 0, 1); f.v = KM.lerp(f.from || 0, target, k); if (k >= 1) f.v = target; }
    // tick list (gambar)
    for (const inp of S.inputs) if (inp.type === 'list') KM.inputTypes.list.tick(inp);
    updateLive();

    // PROGRAM
    const c = E.pctx;
    c.globalAlpha = 1; c.fillStyle = '#000'; c.fillRect(0, 0, E.W, E.H);
    if (S.trans) drawTransition(c, S.trans);
    else full(c, KM.getInput(S.programId), 1);
    drawOverlays(c);
    if (KM.utc) KM.utc.drawDSK(c, E.W, E.H); // lapisan UTC ON AIR (grafis UTC KLM Acara asli)
    if (f.v > 0) { c.fillStyle = 'rgba(0,0,0,' + f.v + ')'; c.fillRect(0, 0, E.W, E.H); }
    E.progAt = now;

    // PREVIEW (dilewati saat jendela diminimize / mode hemat)
    const idle = document.hidden && KM.settings.pauseHidden !== false;
    // monitor Preview cukup ±30 fps saat output 50/60 fps (kecuali mode Kualitas) → beban render turun ±1/3
    const pvEvery = Math.max(KM.settings.previewEvery || 1, KM.settings.fps > 30 && KM.settings.perf !== 'kualitas' ? Math.round(KM.settings.fps / 30) : 1);
    if (!idle && E.frame % pvEvery === 0) {
      const v = E.vctx, pw = E.prev.width, ph = E.prev.height;
      v.globalAlpha = 1; v.fillStyle = '#000'; v.fillRect(0, 0, pw, ph);
      if (E.gridActive()) drawPvGrid(v, pw, ph);
      else { const pv = KM.getInput(S.previewId); if (pv) drawInputRect(v, pv, 0, 0, pw, ph, 0); }
      E.prevAt = now;
    }

    if (!idle) updateThumbs(now);
    if (E.mvOn && (++mvTick % 2 === 0)) drawMultiview();
    KM.replay && KM.replay.capture();
    KM.emit('frame', E.frame);

    fpsCount++;
    if (now - fpsT >= 1000) { E.fps = Math.round(fpsCount * 1000 / (now - fpsT)); fpsCount = 0; fpsT = now; KM.emit('fps', E.fps); }
  };

  // ---------- Preview grid: banyak input sekaligus di monitor Preview (dipilih manual) ----------
  // klik 1× = pilih ke Preview, klik 2× = pilih + zoom satu layar penuh (klik 2× lagi / Esc = kembali ke grid)
  E.pvZoom = null;
  E.gridIds = () => { const g = KM.settings.pvGrid; return g && g.ids ? g.ids.filter((id) => KM.getInput(id)) : []; };
  E.gridActive = () => !!(KM.settings.pvGrid && KM.settings.pvGrid.on && !E.pvZoom);
  /** tata letak grid Preview: panel dibagi rata kolom × baris memenuhi SELURUH lebar & tinggi Preview.
   *  Jumlah kolom dipilih agar gambar (rasio output) di tiap kotak sebesar mungkin; bila hampir sama (±10%),
   *  dipilih yang lebih banyak kolom (memanfaatkan lebar). Baris terakhir yang tidak penuh diletakkan di tengah. */
  E.gridLayout = (n, pw, ph) => {
    const ar = (KM.settings.width || 16) / (KM.settings.height || 9);
    const gap = Math.max(2, Math.round(Math.min(pw, ph * ar) * 0.006));
    const opts = [];
    for (let cols = 1; cols <= Math.max(1, n); cols++) {
      const rows = Math.ceil(n / cols);
      if (cols > 1 && (cols - 1) * rows >= n) continue; // kolom kosong percuma
      const cw = (pw - gap * (cols + 1)) / cols, ch = (ph - gap * (rows + 1)) / rows;
      if (cw <= 0 || ch <= 0) continue;
      const w = Math.min(cw, ch * ar);
      opts.push({ cols, rows, cw, ch, area: w * (w / ar) });
    }
    if (!opts.length) opts.push({ cols: 1, rows: n, cw: pw, ch: ph / n, area: 1 });
    const max = Math.max(...opts.map((o) => o.area));
    const best = opts.filter((o) => o.area >= max * 0.9).sort((a, b) => b.cols - a.cols)[0];
    const { cols, rows, cw, ch } = best;
    const cells = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols, r = Math.floor(i / cols);
      const inRow = r === rows - 1 ? n - r * cols : cols, ox = (cols - inRow) * (cw + gap) / 2;
      cells.push({ x: gap + ox + c * (cw + gap), y: gap + r * (ch + gap), w: cw, h: ch });
    }
    return cells;
  };
  function drawPvGrid(v, pw, ph) {
    const ids = E.gridIds();
    if (!ids.length) {
      v.fillStyle = '#7d8696'; v.font = '600 ' + Math.round(ph * 0.04) + 'px Plus Jakarta Sans, sans-serif'; v.textAlign = 'center'; v.textBaseline = 'middle';
      v.fillText('Grid Preview kosong — klik "+ Input" di atas untuk menambah input', pw / 2, ph / 2); v.textAlign = 'left'; v.textBaseline = 'alphabetic';
      return;
    }
    v.fillStyle = '#15181e'; v.fillRect(0, 0, pw, ph); // garis antar kotak terlihat
    const cells = E.gridLayout(ids.length, pw, ph), arG = (KM.settings.width || 16) / (KM.settings.height || 9), fs = Math.max(10, Math.round(Math.min(cells[0].h, cells[0].w / arG) * 0.09));
    ids.forEach((id, i) => {
      const inp = KM.getInput(id), c = cells[i];
      v.save(); v.beginPath(); v.rect(c.x, c.y, c.w, c.h); v.clip();
      v.fillStyle = '#000'; v.fillRect(c.x, c.y, c.w, c.h);
      try { drawInputRect(v, inp, c.x, c.y, c.w, c.h, 0); } catch (e) {}
      // label
      const lbl = KM.inputNum(inp) + '  ' + inp.title;
      v.font = '700 ' + fs + 'px Plus Jakarta Sans, sans-serif';
      const tw = Math.min(c.w - 8, v.measureText(lbl).width + fs);
      v.fillStyle = 'rgba(0,0,0,.62)'; v.fillRect(c.x, c.y + c.h - fs * 1.6, tw, fs * 1.6);
      v.fillStyle = '#fff'; v.fillText(lbl, c.x + fs * 0.5, c.y + c.h - fs * 0.5, c.w - fs);
      v.restore();
      const tl = id === S.previewId ? '#22c55e' : E.live.has(id) ? '#ef4444' : null;
      if (tl) { const lw = Math.max(2, Math.round(Math.min(c.h, c.w / arG) * 0.025)); v.strokeStyle = tl; v.lineWidth = lw; v.strokeRect(c.x + lw / 2, c.y + lw / 2, c.w - lw, c.h - lw); }
    });
  }
  E.gridHit = (fx, fy) => { // fx,fy = posisi relatif 0..1 di kanvas Preview
    const ids = E.gridIds(); if (!ids.length) return null;
    const pw = E.prev.width, ph = E.prev.height, x = fx * pw, y = fy * ph;
    const cells = E.gridLayout(ids.length, pw, ph);
    const i = cells.findIndex((c) => x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
    return i >= 0 ? ids[i] : null;
  };

  // ---------- mode diam: adegan statis tanpa output aktif → render 6 fps (hemat CPU/GPU/baterai) ----------
  const STATIC_T = { colour: 1, image: 1, bars: 1, audio: 1 };
  E.dirtyAt = 0;
  KM.on('change', () => { E.dirtyAt = KM.now(); });
  function movingInput(inp) {
    if (!inp) return false;
    if (!STATIC_T[inp.type] || (inp.layers && inp.layers.some((l) => l && l.on && l.inputId))) return true;
    return inp.type === 'image' && /\.gif($|\?)/i.test(inp.opts && inp.opts.path || '');
  }
  E.sceneMoving = function () {
    const now = KM.now();
    if (KM.settings.idleSave === false) return true;
    if (S.recording || S.streaming || S.ndiOut || S.multicorder || S.srt || (KM.replay && KM.replay.enabled) || E.mvOn) return true;
    if (S.trans || S.ftb.v !== (S.ftb.on ? 1 : 0) || now - E.dirtyAt < 1500) return true;
    if (KM.utc && (now - (KM.utc.lastFrameAt || 0) < 800 || KM.utc.animating())) return true;
    if (KM.playlist && KM.playlist.running) return true;
    if (S.inputs.some((i) => KM.inputTypes[i.type].playable && KM.inputs.isPlaying(i))) return true; // video yang diputar (juga untuk thumbnail-nya)
    if (movingInput(KM.getInput(S.programId)) || movingInput(KM.getInput(S.previewId))) return true;
    if (E.gridActive() && E.gridIds().some((id) => movingInput(KM.getInput(id)))) return true;
    if ((S.overlays || []).some((o) => o && o.phase !== 'off' && (o.phase !== 'on' || movingInput(KM.getInput(o.inputId))))) return true;
    return false;
  };
  E.loop = function () {
    let mv = true, mvAt = 0, nextAt = 0, vs = 16.7, lastTick = 0, thAt = 0;
    // jadwal frame presisi (akumulator): 60 fps tetap 60 fps di monitor 60/75/120/144 Hz, 50 fps tetap 50 fps.
    const tick = () => {
      const now = KM.now();
      if (lastTick) { const d = now - lastTick; if (d > 2 && d < 40) vs = vs * 0.95 + d * 0.05; } // perkiraan periode vsync
      lastTick = now;
      if (now - mvAt > 250) { mvAt = now; mv = E.sceneMoving(); }
      E.quiet = !mv;
      const interval = mv ? 1000 / KM.settings.fps : 1000 / 6;
      // mesin sedang hemat (Program/Preview diam) tetapi ada kartu gabungan berisi kamera/video: gambar kartunya saja ±25 fps
      if (!mv && E.animThumbs && !document.hidden && now - thAt >= 30) { thAt = now; E.frame++; try { updateThumbs(now); } catch (e) {} }
      if (now >= nextAt - Math.min(vs * 0.5, interval * 0.5)) {
        try { E.render(); } catch (e) { console.error('render', e); }
        E.lastRender = now;
        nextAt = (now - nextAt > interval || nextAt - now > interval) ? now + interval : nextAt + interval;
      }
    };
    const raf = () => { tick(); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    // cadangan bila jendela diminimize (rAF berhenti)
    setInterval(() => { if (KM.now() - E.lastRender > 1000 / KM.settings.fps + 30) tick(); }, 1000 / KM.settings.fps);
  };

  // ---------- output eksternal (monitor ke-2 / multiview) ----------
  E.outputs = [];
  E.openOutput = function (mode, display) {
    const name = 'klmout_' + mode + '_' + display;
    const w = window.open('/output?mode=' + mode + '&display=' + (display || 0), name, 'width=960,height=540');
    if (!w) { KM.toast('Jendela output diblokir', 'warn'); return; }
    const attach = () => {
      try {
        const vid = w.document.getElementById('out');
        if (!vid) return setTimeout(attach, 150);
        vid.srcObject = mode === 'multiview' ? E.multiviewStream() : E.programStream();
        vid.play().catch(() => {});
        w.document.title = 'KLM Mix - ' + (mode === 'multiview' ? 'Multiview' : 'Output');
      } catch (e) { setTimeout(attach, 200); }
    };
    setTimeout(attach, 300);
    E.outputs.push(w);
    S.externalOn = true; KM.changed('external');
    const iv = setInterval(() => { if (w.closed) { clearInterval(iv); E.outputs = E.outputs.filter((x) => x !== w); S.externalOn = E.outputs.length > 0; if (mode === 'multiview' && !E.outputs.length) E.mvOn = false; KM.changed('external'); } }, 1000);
  };
  E.closeOutputs = function () { E.outputs.forEach((w) => { try { w.close(); } catch (e) {} }); E.outputs = []; S.externalOn = false; KM.changed('external'); };

  E.snapshot = function () {
    return new Promise((res) => E.prog.toBlob(res, 'image/png'));
  };
})(window.KM);
