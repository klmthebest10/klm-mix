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
    if (inp.type === 'virtualset' && inp.opts.camId) {
      const cam = KM.getInput(inp.opts.camId);
      if (cam && cam !== inp) {
        const o = inp.opts, cw = rw * o.camScale, ch = rh * o.camScale;
        drawInputRect(ctx, cam, rx + o.camX * rw - cw / 2, ry + o.camY * rh - ch / 2, cw, ch, depth + 1);
      }
    }
    for (const l of inp.layers) {
      if (!l.on) continue;
      const li = KM.getInput(l.inputId); if (!li || li === inp) continue;
      const lx = rx + l.x * rw, ly = ry + l.y * rh, lw = l.w * rw, lh = l.h * rh;
      if (l.bw) { ctx.fillStyle = l.bc || '#ffffff'; const b = l.bw * rw / 1920; ctx.fillRect(lx - b, ly - b, lw + 2 * b, lh + 2 * b); }
      drawInputRect(ctx, li, lx, ly, lw, lh, depth + 1);
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
    if (inp.type === 'virtualset' && inp.opts.camId) collectLive(set, KM.getInput(inp.opts.camId), depth + 1);
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
      if (src) { try { c.drawImage(src, x, y, w, hgt); } catch (e) {} }
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
  let thumbCursor = 0;
  function updateThumbs() {
    const n = S.inputs.length; if (!n) return;
    const per = Math.min(n, KM.settings.thumbsPer || 2);
    for (let k = 0; k < per; k++) {
      const inp = S.inputs[(thumbCursor++) % n];
      const cv = inp.rt.thumb; if (!cv) continue;
      const c = cv.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
      if (KM.inputTypes[inp.type].noVideo) {
        const s = KM.inputs.source(inp); if (s) c.drawImage(s.src, 0, 0, cv.width, cv.height);
      } else drawInputRect(c, inp, 0, 0, cv.width, cv.height, 0);
    }
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
    if (f.v > 0) { c.fillStyle = 'rgba(0,0,0,' + f.v + ')'; c.fillRect(0, 0, E.W, E.H); }

    // PREVIEW (dilewati saat jendela diminimize / mode hemat)
    const idle = document.hidden && KM.settings.pauseHidden !== false;
    if (!idle && E.frame % (KM.settings.previewEvery || 1) === 0) {
      const v = E.vctx, pw = E.prev.width, ph = E.prev.height;
      v.globalAlpha = 1; v.fillStyle = '#000'; v.fillRect(0, 0, pw, ph);
      const pv = KM.getInput(S.previewId);
      if (pv) drawInputRect(v, pv, 0, 0, pw, ph, 0);
    }

    if (!idle && E.frame % (KM.settings.thumbEvery || 4) === 0) updateThumbs();
    if (E.mvOn && (++mvTick % 2 === 0)) drawMultiview();
    KM.replay && KM.replay.capture();
    KM.emit('frame', E.frame);

    fpsCount++;
    if (now - fpsT >= 1000) { E.fps = Math.round(fpsCount * 1000 / (now - fpsT)); fpsCount = 0; fpsT = now; KM.emit('fps', E.fps); }
  };

  E.loop = function () {
    const tick = () => {
      const now = KM.now(), interval = 1000 / KM.settings.fps;
      if (now - E.lastRender >= interval - 3) {
        try { E.render(); } catch (e) { console.error('render', e); }
        E.lastRender = now;
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
