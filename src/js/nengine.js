/* KLM — pengendali mesin video native (klm-engine, Direct3D 11) — Fase 1–2, EKSPERIMEN.
 *
 * Bila aktif (Pengaturan → Performa → Mesin video native), monitor Preview / Program digambar oleh mesin native di GPU
 * pada jendela yang ditempel tepat di atas kanvas monitor. Mesin JS tetap menjadi acuan keadaan (input, transisi) dan
 * tetap merender Program untuk semua output (rekam, streaming, NDI, replay, multiview) — mesin native hanya mengambil
 * alih TAMPILAN monitor, sehingga kanvas monitor JS boleh berhenti dicat selama itu.
 *
 * Fase 1 mendukung sumber: Warna/Gradien, Color Bars, Tangkap Layar (DXGI Desktop Duplication, zero-copy GPU).
 * Fase 2: grafis UTC ON AIR (Acara & Scoreboard) di atas Program — tekstur GPU lapisan offscreen yang sama dikirim ke
 * mesin native (handle NT, tanpa salinan CPU), running text native digulir mesin native.
 * Fase 3: kamera USB / capture card dibuka mesin native lewat Media Foundation (dekode & konversi warna di GPU). Frame
 * kamera tampil langsung di monitor native dan dikirim ke mesin JS sebagai tekstur GPU bersama (VideoFrame) untuk
 * Program/rekam/streaming — perangkat hanya dibuka sekali, tanpa salinan CPU.
 * Fase 4a: KLMCAM — frame H.264 terenkode dari WebRTC disalin (RTCRtpScriptTransform, tanpa dekode ulang di JS) ke
 * mesin native → didekode GPU (DXVA) → tampil di monitor native. Jalur JS tetap berjalan seperti biasa (rekam dll).
 * Fase 5: file video (dekode DXVA, posisi mengikuti elemen video KLM — audio tetap dari KLM) & gambar (WIC).
 * Fase 8: posisi & rotasi input/kotak, koreksi warna, chroma/luma key, latar AI (mask dari model segmentasi KLM,
 * komposit di GPU native), semua transisi kecuali stinger, overlay zoom, FTB.
 * Fase 9: transisi stinger (video transparan diputar di halaman offscreen → tekstur GPU), grid Preview (komposisi
 * kotak + label + tally di ukuran panel Preview), latar AI dengan model segmentasi di mesin native.
 * Bila monitor menampilkan hal lain (sumber yang belum didukung) atau ada menu/dialog di
 * atas monitor, monitor itu otomatis kembali ke tampilan JS — tanpa kedip.
 */
'use strict';
(function (KM) {
  const N = KM.nengine = { pvw: false, pgm: false, state: 'off', adapter: '', fps: 0, mem: 0, ms: 0, why: { pvw: '', pgm: '' }, available: false };
  const el = () => !!(window.klm && window.klm.isElectron && window.klm.send);
  if (KM.settings.nativeEngine == null) KM.settings.nativeEngine = false;
  if (KM.settings.nativeCam == null) KM.settings.nativeCam = true; // berlaku hanya bila mesin native menyala
  if (KM.settings.nativeKlmcam == null) KM.settings.nativeKlmcam = true;
  if (KM.settings.nativeOut == null) KM.settings.nativeOut = true; // rekam/streaming lewat mesin native bila semua sumber didukung

  let running = false, ready = false, frameN = 0;
  const srcSent = new Map();   // id native → spesifikasi terakhir
  const srcErr = new Set();    // id native yang gagal di mesin (mis. layar di GPU lain) → selalu tampilan JS
  const scr = new Map();       // sourceId layar → {x,y,w,h} | null (sedang/ gagal dicari)
  const bus = {
    pvw: { want: false, shown: false, hideAt: -1, rect: '', id: null },
    pgm: { want: false, shown: false, hideAt: -1, rect: '', id: null }
  };
  let out = '', transKey = '', tbarSent = '', ftbSent = '', bsizeSent = '', stPlaying = -1;
  const sting = [{ src: '', ok: false, wait: false }, { src: '', ok: false, wait: false }]; // halaman video stinger offscreen per slot
  const attrSent = new Map(); // id mesin → { pos, fx, seg, segN } terakhir yang dikirim (Fase 8)
  // Fase 2: grafis UTC
  let utcWant = false, ulaySent = null, utcErr = '';
  const uready = new Set();
  const wready = new Set(); // sumber tekstur offscreen (Web Browser) yang sudah sampai di mesin native
  const cmd = (l) => { if (running) window.klm.send('nengine:cmd', l); };
  const nid = (inp) => 'i' + String(inp.id).replace(/[^\w.-]/g, '_').slice(0, 60);

  // ---------- sumber yang bisa dirender native ----------
  const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return null; const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const plainPos = (p) => !p || (!p.x && !p.y && (p.zoom == null || p.zoom === 1) && !p.cropL && !p.cropR && !p.cropT && !p.cropB && !p.rot && (p.fit || 'fit') === 'fit');
  function resolveScreen(id) {
    if (scr.has(id)) return; scr.set(id, null);
    window.klm.invoke('nengine:screen-rect', id).then((r) => { scr.set(id, r || false); }).catch(() => scr.set(id, false));
  }
  // ---- Fase 8: posisi input, efek, latar AI — dikirim per sumber yang dipakai
  const SEG_MODE = { remove: 0, blur: 1, colour: 2, image: 3 };
  const segBgId = (inp) => hashId('sg', inp.id + '|' + ((inp.seg || {}).bgUrl || ''));
  // latar AI: model segmentasi KLM tetap berjalan (hanya mask, tanpa komposit kanvas) — komposit di GPU native
  function segTick(inp) {
    const rt = inp.rt; if (rt.segTickF === KM.engine.frame) return rt.segCrop;
    rt.segTickF = KM.engine.frame; rt.segCrop = null;
    const s = KM.inputs.source(inp); if (!s || !s.w || !s.h || s.src === rt.ph) return null;
    try { rt.segCrop = KM.seg.process(inp, s, true) || null; } catch (e) { rt.segCrop = null; }
    return rt.segCrop;
  }
  function segReady(inp) {
    const c = segTick(inp); if (!c || !inp.rt.segA) return false;
    if (inp.seg.mode === 'image' && inp.seg.bgUrl) { const m = media.get(segBgId(inp)); return !!(m && m.ok); }
    return true;
  }
  function segEntries(inp) { // gambar latar AI → mesin native
    const o = inp.seg; if (!o || o.mode !== 'image' || !o.bgUrl || !(KM.seg && KM.seg.on(inp))) return [];
    const rt = inp.rt;
    if (!rt.bgImg || rt.bgSrc !== o.bgUrl) { rt.bgSrc = o.bgUrl; const im = new Image(); im.crossOrigin = 'anonymous'; im.src = o.bgUrl; rt.bgImg = im; }
    const e = imageEntry(o.bgUrl, rt.bgImg); return e ? [Object.assign(e, { id: segBgId(inp) })] : [];
  }
  function attrSync(inp) {
    const k = rawEid(inp); if (!k) return;
    let a = attrSent.get(k); if (!a) { a = { pos: '', fx: '', seg: '', segN: -1 }; attrSent.set(k, a); }
    const p = inp.pos || {};
    const pos = plainPos(p) ? '-' : [p.fit === 'fill' ? 0 : p.fit === 'stretch' ? 2 : 1, num(p.zoom == null ? 1 : p.zoom), num(p.x || 0), num(p.y || 0), num(p.cropL || 0), num(p.cropR || 0), num(p.cropT || 0), num(p.cropB || 0), num(p.rot || 0, 2)].join(' ');
    if (pos !== a.pos) { a.pos = pos; cmd('ipos ' + k + ' ' + pos); }
    let fx = '-';
    if (KM.fx && KM.fx.needs(inp)) {
      const c = inp.cc || {}, y = inp.key || {}, on = !!c.on, d = (v, def) => (v == null ? def : v);
      fx = [on ? 1 : 0, num(on ? d(c.bri, 0) : 0), num(on ? d(c.con, 1) : 1), num(on ? d(c.sat, 1) : 1), num(on ? (c.hue || 0) * Math.PI / 180 : 0), num(on ? c.gam || 1 : 1),
        y.on ? 1 : 0, hex6(y.color || '#00ff00') === '-' ? '00ff00' : hex6(y.color || '#00ff00'), num(d(y.sim, 0.4)), num(d(y.smooth, 0.08)), num(d(y.spill, 0.1)), y.lumaOn ? 1 : 0, num(d(y.lumaLo, 0.05)), num(d(y.lumaHi, 0.15))].join(' ');
    }
    if (fx !== a.fx) { a.fx = fx; cmd('fx ' + k + ' ' + fx); }
    let sg = '-';
    if (KM.seg && KM.seg.on(inp) && inp.rt.segA) {
      const o = inp.seg, c = inp.rt.segCrop || { cx: 0, cy: 0, cw: 1 }, col = hex6(o.colour || '#00b140');
      const bg = o.mode === 'image' && o.bgUrl && media.get(segBgId(inp)) && media.get(segBgId(inp)).ok ? segBgId(inp) : '-';
      sg = [SEG_MODE[o.mode] == null ? 0 : SEG_MODE[o.mode], num(o.feather || 0, 2), num(o.blur || 0, 2), col === '-' ? '00b140' : col, bg, o.bgFit === 'fit' ? 1 : 0, num(c.cx), num(c.cy), num(c.cw), o.hideEmpty && !inp.rt.person ? 1 : 0].join(' ');
    }
    if (sg !== a.seg) { a.seg = sg; cmd('seg ' + k + ' ' + sg); if (sg === '-') a.segN = -1; }
    if (sg !== '-' && inp.rt.segN !== a.segN) { // mask baru dari model → 8-bit ke mesin native
      const A = inp.rt.segA, mc = inp.rt.segMask; if (!A || !mc || A.length !== mc.width * mc.height) return;
      a.segN = inp.rt.segN; const b = new Uint8Array(A.length); for (let i = 0; i < A.length; i++) b[i] = A[i] * 255;
      window.klm.send('nengine:segm', k, mc.width, mc.height, b.buffer);
    }
  }
  // input yang sedang dipakai Preview / Program / transisi / overlay, termasuk isi kotak komposisi
  function usedInputs() {
    const S = KM.state, set = new Set();
    const walk = (i, d) => { if (!i || d > 4 || set.has(i)) return; set.add(i); for (const l of i.layers || []) if (l && l.on && l.inputId) walk(KM.getInput(l.inputId), d + 1); };
    for (const id of [S.previewId, S.programId, S.trans && S.trans.fromId, S.trans && S.trans.toId]) if (id) walk(KM.getInput(id), 0);
    for (const ch of S.overlays || []) if (ch && ch.phase !== 'off' && ch.inputId) walk(KM.getInput(ch.inputId), 0);
    if (KM.engine.gridActive && KM.engine.gridActive()) for (const id of KM.engine.gridIds()) walk(KM.getInput(id), 0);
    return set;
  }
  const hasLayers = (inp) => inp.type === 'virtualset' || (inp.layers || []).some((l) => l && l.on && l.inputId);
  function spec(inp) {
    if (!inp) return null;
    if (hasLayers(inp)) { const c = compOf(inp, 0); return c && c.ok ? 'comp' : null; }
    return rawSpec(inp);
  }
  function rawSpec(inp, allowFit) {
    if (!inp) return null;
    if (srcErr.has(nid(inp))) return null;
    // Fase 8: posisi/rotasi (ipos) & efek (fx) dirender native; latar AI menunggu mask pertama dari model segmentasi
    try { if (KM.seg && KM.seg.on(inp) && !segReady(inp)) return null; } catch (e) { return null; }
    const o = inp.opts || {};
    if (inp.type === 'colour') {
      const a = hex(o.color), b = hex(o.color2 || '#000000'); if (!a || !b) return null;
      return 'colour ' + a.join(' ') + ' ' + b.join(' ') + ' ' + ({ linear: 1, radial: 2 }[o.grad] || 0);
    }
    if (inp.type === 'bars') return 'bars';
    if (inp.type === 'camera') { const c = inp.rt.ncam && cams.get(inp.rt.ncam); return c && c.frames > 0 ? 'cam' : null; }
    if (MEDIA_TYPES.has(inp.type)) { const id = mediaIdOf(inp), m = id && media.get(id); return m && m.ok ? 'media' : null; }
    if (inp.type === 'browser' && inp.rt.osr) return inp.rt.winId && wready.has('w' + inp.rt.winId) ? 'media' : null; // offscreen: tekstur GPU langsung
    if (inp.type === 'browser' || inp.type === 'title') { const m = media.get(nid(inp)); return m && m.ok ? 'media' : null; }
    if (inp.type === 'screen' && /^window:\d+/.test((inp.opts || {}).sourceId || '')) { const m = media.get(nid(inp)); return m && m.ok ? 'media' : null; }
    if (inp.type === 'klmcam') { const k = kcams.get(kidOf(inp)); return k && k.ok && !k.err && Date.now() - k.last < 3000 ? 'cam' : null; }
    if (inp.type === 'screen') {
      if (!o.sourceId || !/^screen:/.test(o.sourceId) || !inp.rt || !inp.rt.ready) return null;
      if (!scr.has(o.sourceId)) { resolveScreen(o.sourceId); return null; }
      const r = scr.get(o.sourceId); if (!r) return null;
      return 'screen ' + r.x + ' ' + r.y + ' ' + r.w + ' ' + r.h;
    }
    return null;
  }
  const label = (inp) => (inp ? (KM.inputTypes[inp.type] && KM.inputTypes[inp.type].label) || inp.type : '');

  // ---------- apakah monitor bisa ditampilkan native sekarang ----------
  const rawEid = (i) => (i.type === 'browser' && i.rt.osr ? 'w' + i.rt.winId : i.type === 'camera' && i.rt.ncam ? i.rt.ncam : i.type === 'klmcam' ? kidOf(i) : MEDIA_TYPES.has(i.type) ? (mediaIdOf(i) || nid(i)) : nid(i));
  const eidOf = (i) => (hasLayers(i) ? 'C' + nid(i) : rawEid(i));
  // ---- komposisi berlapis (Fase 7): Virtual Set & input dengan kotak PiP
  const comps = new Map(); // id komposisi → string perintah terakhir
  const num = (v, d) => (Number.isFinite(+v) ? (+v).toFixed(d == null ? 4 : d).replace(/\.?0+$/, '') || '0' : '0');
  const hex6 = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); return m ? m[1].toLowerCase() : '-'; };
  function compOf(inp, depth) {
    if (depth > 3) return null;
    const o = inp.opts || {}, rt = inp.rt, W = KM.settings.width, H = KM.settings.height;
    let base = '-', baseFit = 1, fg = '-', dim = 0;
    if (inp.type === 'virtualset') {
      baseFit = 0; dim = Math.min(0.9, +o.bgDim || 0);
      if (o.bgKind === 'image') { const m = media.get(hashId('b', inp.id + '|' + o.bgUrl)); if (!m || !m.ok) return null; base = hashId('b', inp.id + '|' + o.bgUrl); }
      else if (o.bgKind === 'video') { const m = media.get(hashId('b', inp.id + '|' + o.bgUrl)); if (!m || !m.ok) return null; base = hashId('b', inp.id + '|' + o.bgUrl); }
      else if (o.bgKind !== 'none') { const id = vsBgId(inp), m = media.get(id); if (!m || !m.ok) return null; base = id; }
      if (o.fgUrl) { const id = hashId('f', inp.id + '|' + o.fgUrl), m = media.get(id); if (!m || !m.ok) return null; fg = id; }
    } else {
      if (!rawSpec(inp, true)) return null;
      base = rawEid(inp); baseFit = 3; // latar = input itu sendiri dengan posisinya (ipos)
    }
    const toks = [];
    for (const l of inp.layers || []) {
      if (!l || !l.on || !l.inputId) continue;
      const li = KM.getInput(l.inputId); if (!li || li === inp) continue;
      let src;
      if (hasLayers(li)) { const c = compOf(li, depth + 1); if (!c || !c.ok) return null; src = 'C' + nid(li); }
      else { if (!(l.fit ? rawSpec(li, true) : rawSpec(li))) return null; src = rawEid(li); }
      const fit = l.fit === 'fit' ? 1 : l.fit === 'stretch' ? 2 : l.fit ? 0 : 3; // 3 = kotak lama: ikut posisi input sumber
      let lab = '-', lx = 0, ly = 0, lw = 0, lh = 0;
      if (l.label) { const L = labelImg(l, l.w * W, l.h * H, W / 1920); if (!L) return null; lab = L.id; lx = l.x + L.x / W; ly = l.y + L.y / H; lw = L.w / W; lh = L.h / H; }
      toks.push([src, num(l.x), num(l.y), num(l.w), num(l.h), fit, num(l.zoom || 1), num(l.px || 0), num(l.py || 0), num(l.cropL || 0), num(l.cropR || 0), num(l.cropT || 0), num(l.cropB || 0), l.flip ? 1 : 0,
        num(l.op == null ? 1 : l.op), num(l.rad || 0), num(l.bw || 0, 2), (l.bw ? hex6(l.bc || '#ffffff') : '-'), hex6(l.bg), num(l.sh || 0, 2), lab, num(lx), num(ly), num(lw), num(lh), num(l.rot || 0, 2)].join(','));
    }
    const line = ['comp', 'C' + nid(inp), base, baseFit, num(dim, 3), fg].concat(toks).join(' ');
    const id = 'C' + nid(inp);
    if (comps.get(id) !== line && running && ready) { comps.set(id, line); cmd(line); }
    return { ok: true, id };
  }
  // label kotak: dirender sekali (teks, warna, ukuran) → gambar kecil di mesin native
  const labels = new Map();
  function labelImg(l, w, h, k) {
    const fs = Math.max(11 * k, Math.min(h * 0.085, 34 * k)), pad = fs * 0.55;
    const key = l.label + '|' + (l.bc && l.bw ? l.bc : '#ff7a1a') + '|' + Math.round(fs * 10) + '|' + Math.round(w);
    const id = hashId('lb', key); let L = labels.get(id);
    if (L) return L.ok ? L : null;
    const c = document.createElement('canvas'), g = c.getContext('2d');
    g.font = '700 ' + fs + 'px "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif';
    const tw = Math.min(g.measureText(l.label).width, w - pad * 4), bw = Math.ceil(tw + pad * 2.4), bh = Math.ceil(fs * 1.75);
    c.width = Math.max(2, bw); c.height = Math.max(2, bh);
    g.font = '700 ' + fs + 'px "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillStyle = 'rgba(8,10,14,.78)'; g.beginPath(); if (g.roundRect) g.roundRect(0, 0, bw, bh, bh * 0.22); else g.rect(0, 0, bw, bh); g.fill();
    g.fillStyle = l.bc && l.bw ? l.bc : '#ff7a1a'; g.fillRect(0, 0, Math.max(2, fs * 0.16), bh);
    g.fillStyle = '#fff'; g.fillText(l.label, pad * 1.2, bh / 2 + fs * 0.04, tw);
    L = { id, ok: false, x: pad, y: h - bh - pad, w: bw, h: bh }; labels.set(id, L);
    try { const d = g.getImageData(0, 0, c.width, c.height); window.klm.send('nengine:raster', id, c.width, c.height, d.data.buffer); media.set(id, { sig: 'label', kind: 'raster', owner: '', ok: false, err: '', keep: true, onok: () => { L.ok = true; } }); } catch (e) {}
    return null;
  }
  N.debug = () => ({ comps: [...comps.values()], media: [...media.entries()].map(([k, m]) => k + ':' + m.kind + ':' + (m.ok ? 'ok' : m.err || '…')), pgm: bus.pgm.id, ovl: ovlSent, restarts: N.restarts || 0 });
  const vsSig = (o) => JSON.stringify([o.bgKind, o.bg, o.colour, o.caption]);
  const vsBgId = (inp) => hashId('vs', inp.id + '|' + vsSig(inp.opts || {}));
  // ---- overlay (Fase 7): sama dengan drawOverlays mesin JS, tanpa mengubah keadaan saluran
  let ovlSent = '';
  function ovlState() {
    const S = KM.state, now = KM.now(), W = 1, out = [];
    for (let n = 0; n < (S.overlays || []).length; n++) {
      const ch = S.overlays[n]; if (!ch || ch.phase === 'off' || !ch.inputId) continue;
      const inp = KM.getInput(ch.inputId); if (!inp) continue;
      if (!spec(inp)) return { why: 'overlay ' + label(inp) };
      const fx = KM.settings.overlayFx[n] || { type: 'fade', dur: 400 }, isTitle = inp.type === 'title';
      const dur = fx.type === 'cut' || isTitle ? 0 : fx.dur;
      let p = 1;
      if (ch.phase === 'in') p = dur ? Math.min(1, (now - ch.t0) / dur) : 1;
      else if (ch.phase === 'out') p = isTitle ? 1 : (dur ? Math.max(0, 1 - (now - ch.t0) / dur) : 0);
      const e = KM.ease(KM.clamp(p, 0, 1)), type = isTitle ? 'cut' : fx.type;
      let a = 1, dx = 0, dy = 0, clip = 1, z = 1;
      if (type === 'fade') a = e; else if (type === 'slide') dx = 1 - e; else if (type === 'slideup') dy = 1 - e; else if (type === 'wipe') clip = e;
      else if (type === 'zoom') { a = e; z = Math.max(0.01, e); }
      if (a > 0.001 && clip > 0.001) out.push([eidOf(inp), num(a, 3), num(dx, 4), num(dy, 4), num(clip, 4)].concat(z !== 1 ? [num(z, 4)] : []).join(','));
    }
    return { line: 'ovl' + (out.length ? ' ' + out.join(' ') : '') };
  }
  const TR_NATIVE = new Set(['fade', 'cut', 'merge', 'wipe', 'wipeup', 'slide', 'slideup', 'fly', 'zoom', 'crosszoom', 'circle', 'barn', 'cube', 'dip', 'dipwhite', 'blur']);
  // ---- Fase 9: stinger — video diputar di halaman offscreen transparan (proses utama), teksturnya masuk mesin native
  const STING_TYPES = new Set(['video', 'urlvideo']);
  const stSlot = (tr) => (tr && tr.type === 'stinger1' ? 0 : tr && tr.type === 'stinger2' ? 1 : -1);
  function stingerSrc(slot) {
    const sg = (KM.settings.stingers || [])[slot], inp = sg && KM.getInput(sg.inputId);
    if (!inp || !STING_TYPES.has(inp.type)) return '';
    const u = (inp.opts || {}).url || '', lp = localPath(u);
    return lp ? 'file:' + lp : isHttp(u) ? u : '';
  }
  function stingerSync() {
    for (let i = 0; i < 2; i++) {
      const src = stingerSrc(i), st = sting[i];
      if (src === st.src) continue;
      st.src = src; st.ok = false;
      if (!src) { window.klm.invoke('stinger:drop', i).catch(() => {}); continue; }
      st.wait = true;
      window.klm.invoke('stinger:prep', i, src, KM.settings.width, KM.settings.height, KM.settings.fps || 30)
        .then((r) => { if (st.src === src) { st.ok = !!(r && r.ok); st.wait = false; if (!st.ok && r && r.err) console.warn('[nengine] stinger', i, r.err); } })
        .catch(() => { if (st.src === src) { st.ok = false; st.wait = false; } });
    }
  }
  function stingerReady(tr) {
    const i = stSlot(tr); if (i < 0 || !tr.stingerId) return false;
    const st = sting[i]; return st.ok && st.src && st.src === stingerSrc(i) && uready.has('k' + i);
  }
  // tanpa memperhitungkan grafis UTC
  function pgmBaseWhy() {
    const S = KM.state;
    const ov = ovlState(); if (ov.why) return ov.why;
    if (S.trans) {
      if (!TR_NATIVE.has(S.trans.type) && !stingerReady(S.trans)) return 'transisi ' + S.trans.type;
      for (const id of [S.trans.fromId, S.trans.toId]) { const i = KM.getInput(id); if (id && !spec(i)) return 'sumber ' + label(i); }
    }
    if (!S.programId) return '';
    const inp = KM.getInput(S.programId);
    return spec(inp) ? '' : 'sumber ' + label(inp);
  }
  function utcWhy(ids) {
    if (!ids.length) return '';
    if (utcErr) return 'grafis UTC: ' + utcErr;
    if (!utcWant) return 'grafis UTC ON AIR';
    for (const id of ids) {
      if (!KM.utc.layerGpu(id)) return 'grafis UTC jalur CPU (zero-copy mati)';
      if (!uready.has(id)) return 'menunggu grafis UTC';
    }
    return '';
  }
  // ---- Fase 9: grid Preview = komposisi kotak (sumber + label + tally) di ukuran kanvas Preview (rasio panel)
  let gridSent = '';
  const gridLabels = new Map();
  function gridLabel(text, fs, maxW) {
    const g0 = document.createElement('canvas').getContext('2d'); g0.font = '700 ' + fs + 'px Plus Jakarta Sans, sans-serif';
    const tw = Math.max(4, Math.round(Math.min(maxW - 8, g0.measureText(text).width + fs))), th = Math.max(4, Math.round(fs * 1.6));
    const id = hashId('gl', text + '|' + fs + '|' + tw); let L = gridLabels.get(id);
    if (L) return L.ok ? L : null;
    L = { id, ok: false, w: tw, h: th }; gridLabels.set(id, L);
    const c = document.createElement('canvas'); c.width = tw; c.height = th; const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,.62)'; g.fillRect(0, 0, tw, th);
    g.font = '700 ' + fs + 'px Plus Jakarta Sans, sans-serif'; g.fillStyle = '#fff'; g.fillText(text, fs * 0.5, th - fs * 0.5, Math.max(1, maxW - fs));
    try { const d = g.getImageData(0, 0, tw, th); window.klm.send('nengine:raster', id, tw, th, d.data.buffer); media.set(id, { sig: 'label', kind: 'raster', owner: '', ok: false, err: '', keep: true, onok: () => { L.ok = true; } }); } catch (e) {}
    return null;
  }
  const fillTok = (x, y, w, h, col) => ['-', num(x), num(y), num(w), num(h), 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, '-', col, 0, '-', 0, 0, 0, 0].join(',');
  function gridComp() {
    const E = KM.engine, S = KM.state, ids = E.gridIds();
    if (!ids.length) return 'grid Preview kosong';
    const pw = E.prev.width, ph = E.prev.height; if (pw < 16 || ph < 16) return 'grid belum siap';
    const cells = E.gridLayout(ids.length, pw, ph), arG = (KM.settings.width || 16) / (KM.settings.height || 9);
    const fs = Math.max(10, Math.round(Math.min(cells[0].h, cells[0].w / arG) * 0.09));
    const toks = [fillTok(0, 0, 1, 1, '15181e')];
    for (let i = 0; i < ids.length; i++) {
      const inp = KM.getInput(ids[i]), c = cells[i];
      if (!spec(inp)) return 'grid: sumber ' + label(inp);
      const L = gridLabel(KM.inputNum(inp) + '  ' + inp.title, fs, c.w); if (!L) return 'menyiapkan label grid';
      toks.push([eidOf(inp), num(c.x / pw), num(c.y / ph), num(c.w / pw), num(c.h / ph), 3, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, '-', '000000', 0,
        L.id, num(c.x / pw), num((c.y + c.h - L.h) / ph), num(L.w / pw), num(L.h / ph)].join(','));
      const tl = ids[i] === S.previewId ? '22c55e' : E.live.has(ids[i]) ? 'ef4444' : null;
      if (tl) {
        const lw = Math.max(2, Math.round(Math.min(c.h, c.w / arG) * 0.025)), X = c.x / pw, Y = c.y / ph, Wc = c.w / pw, Hc = c.h / ph, lx = lw / pw, ly = lw / ph;
        toks.push(fillTok(X, Y, Wc, ly, tl), fillTok(X, Y + Hc - ly, Wc, ly, tl), fillTok(X, Y, lx, Hc, tl), fillTok(X + Wc - lx, Y, lx, Hc, tl));
      }
    }
    const line = ['comp', 'Gpv', '-', 1, 0, '-'].concat(toks).join(' ');
    if (line !== gridSent) { gridSent = line; cmd(line); }
    const bs = Math.round(pw) + ' ' + Math.round(ph);
    if (bs !== bsizeSent) { bsizeSent = bs; cmd('bsize pvw ' + bs); }
    return '';
  }
  function pvwWhy() {
    const S = KM.state, E = KM.engine;
    if (E.gridActive && E.gridActive()) return gridComp();
    if (!S.previewId) return '';
    const inp = KM.getInput(S.previewId);
    return spec(inp) ? '' : 'sumber ' + label(inp);
  }
  // menu, dialog, dropdown, toast besar di atas monitor → monitor native disembunyikan (jendela native selalu paling atas)
  function covered(cv) {
    const r = cv.getBoundingClientRect(); if (r.width < 8 || r.height < 8) return true;
    for (const fx of [0.04, 0.5, 0.96]) for (const fy of [0.04, 0.5, 0.96]) {
      const t = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (!t || (t !== cv && !(t.closest && t.closest('.cwrap') === cv.parentElement))) return true;
    }
    return false;
  }
  function rectOf(cv) {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const x = Math.round(r.left * d), y = Math.round(r.top * d), w = Math.round(r.right * d) - x, h = Math.round(r.bottom * d) - y;
    return x + ' ' + y + ' ' + w + ' ' + h;
  }

  // ---------- sinkron tiap frame mesin JS ----------
  function sync() {
    if (!running || !ready) return;
    frameN++;
    const S = KM.state, st = KM.settings;
    const o = st.width + ' ' + st.height + ' ' + st.fps;
    if (o !== out) { out = o; cmd('out ' + o); }
    // sumber yang dipakai Preview / Program / transisi
    const need = new Map();
    // kamera native: id mesin = id kamera (sudah dibuka lewat camOpen, tidak dikirim sebagai "src")
    const eid = (i) => (hasLayers(i) ? 'C' + nid(i) : rawEid(i));
    const add = (id) => { const i = id && KM.getInput(id); const s = i && spec(i); if (s) need.set(eid(i), s); };
    add(S.previewId); add(S.programId); if (S.trans) { add(S.trans.fromId); add(S.trans.toId); }
    for (const [k, s] of need) if (s !== 'cam' && s !== 'media' && s !== 'comp' && srcSent.get(k) !== s) { srcSent.set(k, s); cmd('src ' + k + ' ' + s); }
    // overlay & sumbernya
    { const ov = ovlState(); if (ov.line) { for (const ch of S.overlays || []) { const i = ch && ch.phase !== 'off' && KM.getInput(ch.inputId); if (i && !hasLayers(i)) { const sp = rawSpec(i); if (sp && sp !== 'cam' && sp !== 'media' && srcSent.get(rawEid(i)) !== sp) { srcSent.set(rawEid(i), sp); cmd('src ' + rawEid(i) + ' ' + sp); } need.set(rawEid(i), sp || 'x'); } } if (ov.line !== ovlSent) { ovlSent = ov.line; cmd(ov.line); } } }
    // sumber di dalam kotak komposisi (Virtual Set / PiP) juga harus terbuka
    for (const id of [S.previewId, S.programId]) { const i = id && KM.getInput(id); if (i && hasLayers(i)) addCompSrcs(i, need, 0); }
    mediaSync();
    for (const k of [...srcSent.keys()]) if (!need.has(k)) { srcSent.delete(k); cmd('del ' + k); }
    const idOf = (id) => { const i = id && KM.getInput(id); return i && (need.has(eid(i)) || (hasLayers(i) && spec(i))) ? eid(i) : '-'; };
    // posisi / efek / latar AI tiap input yang dipakai (Fase 8)
    for (const i of usedInputs()) if (!hasLayers(i) || i.type !== 'virtualset') attrSync(i);
    // transisi: otomatis dikirim sekali (mesin native menghitung waktunya sendiri); T-bar manual dikirim posisinya
    stingerSync();
    const tr = S.trans, ttype = tr && TR_NATIVE.has(tr.type) && tr.type !== 'cut' ? tr.type : 'fade', sl = stSlot(tr);
    if (tr && !tr.manual && sl >= 0 && stingerReady(tr)) {
      const k = tr.fromId + '>' + tr.toId + '@' + tr.t0;
      if (k !== transKey) { // video stinger mulai diputar bersamaan dengan transisi (suara tetap dari input stinger di mixer)
        transKey = k; stPlaying = sl; window.klm.send('stinger:play', sl);
        cmd('trans ' + Math.max(1, Math.round(tr.dur || 1)) + ' ' + idOf(tr.fromId) + ' ' + idOf(tr.toId) + ' stinger k' + sl + ' ' + Math.max(0, Math.round(tr.cut || 500)));
      }
    } else if (tr && !tr.manual && TR_NATIVE.has(tr.type)) {
      const k = tr.fromId + '>' + tr.toId + '@' + tr.t0;
      if (k !== transKey) { transKey = k; cmd('trans ' + Math.max(1, Math.round(tr.type === 'cut' ? 1 : tr.dur || 1)) + ' ' + idOf(tr.fromId) + ' ' + idOf(tr.toId) + ' ' + ttype); }
    } else if (tr && tr.manual) {
      const v = Math.round(KM.clamp(tr.p || 0, 0, 1) * 1000) + ' ' + idOf(tr.fromId) + ' ' + idOf(tr.toId) + ' ' + ttype;
      if (v !== tbarSent) { tbarSent = v; cmd('tbar ' + v); }
    } else {
      if (tbarSent) { tbarSent = ''; cmd('tbar off'); }
      if (stPlaying >= 0 && !tr) { window.klm.send('stinger:stop', stPlaying); stPlaying = -1; }
      transKey = tr ? transKey : '';
    }
    // Fade To Black: alpha hitam paling atas (di atas grafis UTC, sama dengan mesin JS)
    { const f = S.ftb, v = f ? num(KM.clamp(f.v || 0, 0, 1), 3) : '0'; if (v !== ftbSent) { ftbSent = v; cmd('ftb ' + v); } }
    // grafis UTC: tekstur lapisan diminta dari proses utama selama Program bisa ditampilkan native
    const base = pgmBaseWhy(), U = KM.utc;
    const uw = !base && !utcErr && !!(U && U.zc && U.zc.on && U.dskIds);
    if (uw !== utcWant) { utcWant = uw; window.klm.send('nengine:utc', uw); if (!uw) { uready.clear(); ulaySent = null; } }
    const ids = utcWant ? U.dskIds() : [];
    if (utcWant) { const l = ids.join(',') || '-'; if (l !== ulaySent) { ulaySent = l; cmd('ulay ' + l); } }
    const pgWhy = base || utcWhy(U && U.dskIds ? (utcWant ? ids : U.dskIds()) : []);
    if (outs.size) { const w = base || utcWhy(ids); if (w && w !== 'menunggu grafis UTC' && w !== warnedWhy) { warnedWhy = w; KM.toast('⚠ Output native: ' + w + ' — bagian itu tidak ikut terekam/tersiar', 'warn', 8000); } if (!w) warnedWhy = ''; }
    const pg = idOf(S.programId), pv = idOf(S.previewId);
    if (!tr && pg !== bus.pgm.id) { bus.pgm.id = pg; cmd('pgm ' + pg); }
    const grid = KM.engine.gridActive && KM.engine.gridActive();
    if (!grid && bsizeSent !== '0 0' && bsizeSent !== '') { bsizeSent = '0 0'; cmd('bsize pvw 0 0'); }
    const pvId = grid ? 'Gpv' : pv;
    if (pvId !== bus.pvw.id) { bus.pvw.id = pvId; cmd('pvw ' + pvId); }
    // tampil / sembunyi + posisi (posisi & tutupan dicek tiap 3 frame; alasan tiap frame)
    const geo = frameN % 3 === 0;
    for (const k of ['pvw', 'pgm']) {
      const b = bus[k], cv = document.getElementById(k);
      const why = !cv ? 'tidak ada kanvas' : document.hidden ? 'jendela tersembunyi' : (k === 'pgm' ? pgWhy : pvwWhy());
      let want = !why;
      if (want && geo) b.cov = covered(cv);
      if (want && b.cov) want = false;
      N.why[k] = why || (b.cov ? 'tertutup menu/dialog' : '');
      if (want) {
        b.hideAt = -1;
        const r = geo || !b.want ? rectOf(cv) : b.rect;
        if (!b.want || r !== b.rect) { b.rect = r; cmd('rect ' + k + ' ' + r + ' 1'); }
        b.want = true;
        if (b.shown) N[k] = true; // jendela native masih tampil (batal disembunyikan) → JS boleh berhenti lagi
      } else if (b.want) {
        // JS kembali menggambar dulu (flag mati sekarang), jendela native baru disembunyikan 2 frame kemudian
        b.want = false; N[k] = false; b.hideAt = frameN + 2;
      }
      if (b.hideAt >= 0 && frameN >= b.hideAt) { b.hideAt = -1; b.rect = ''; cmd('rect ' + k + ' 0 0 0 0 0'); }
    }
  }

  function onEv(s) {
    const sp = s.indexOf(' '), t = sp < 0 ? s : s.slice(0, sp), rest = sp < 0 ? '' : s.slice(sp + 1);
    if (t === 'ready') { ready = true; N.state = 'ready'; N.adapter = rest; resetSent(); KM.changed('nengine'); camReopen(); for (const k of kcams.values()) k.ok = false; kSync(); }
    else if (t === 'shown' && bus[rest]) { bus[rest].shown = true; N[rest] = bus[rest].want; }
    else if (t === 'hidden' && bus[rest]) { bus[rest].shown = false; N[rest] = false; }
    else if (t === 'srcerr') { const id = rest.split(' ')[0]; const m = media.get(id); if (m) { m.ok = false; m.err = rest.slice(id.length + 1); } else { srcErr.add(id); srcSent.delete(id); } KM.log && KM.log('mesin native: ' + rest); }
    else if (t === 'stats') { const m = /fps=(\d+) ms=([\d.]+) mem=(\d+)/.exec(rest); if (m) { N.fps = +m[1]; N.ms = +m[2]; N.mem = +m[3]; } const u = /utex=(\d+)/.exec(rest); if (u) N.utex = +u[1]; const cm = /cams=(\S+)/.exec(rest); N.camStat = cm ? cm[1] : '-';
      // dekoder KLMCAM masih menghasilkan frame? (jumlah frame per id dari statistik mesin)
      if (cm) for (const part of cm[1].split(',')) { const [id, f] = part.split(':'); const k = kcams.get(id); if (k) { if (+f !== k.n) k.last = Date.now(); k.n = +f; } } }
    else if (t === 'probe') { const f = probeWait.shift(); if (f) f(rest.split(' ').map(Number)); }
    else if (t === 'click') clickFwd(rest.split(' '));
    else if (t === 'uready') { uready.add(rest); if (rest[0] === 'w') wready.add(rest); }
    else if (t === 'camok' || t === 'camerr') camEv(t, rest);
    else if (t === 'kok' || t === 'kerr' || t === 'kneedkey') kEv(t, rest);
    else if (t === 'ostarted' || t === 'oerr' || t === 'ostopped') oEv(t, rest);
    else if (t === 'vok' || t === 'srcok') { const a = rest.split(' '), m = media.get(a[0]); if (m) { m.ok = true; m.w = +a[1]; m.h = +a[2]; m.err = ''; if (m.onok) m.onok(); } }
    else if (t === 'naok' || t === 'naerr') naEv(t, rest);
    else if (t === 'uerr') { utcErr = rest.replace(/^\S+ /, '').slice(0, 80); KM.log && KM.log('mesin native UTC: ' + rest); }
    else if (t === 'exit' || t === 'restart') { if (t === 'exit') N.restarts = (N.restarts || 0) + 1; for (const x of outs.values()) { x.err = 'mesin native berhenti'; if (x.wait) x.wait.rej(new Error(x.err)); if (x.stopWait) x.stopWait(); else if (x.onEnd) x.onEnd(x); } outs.clear(); audStop(); ready = false; N.pvw = N.pgm = false; N.state = t === 'exit' ? 'berhenti' : 'memulai ulang'; resetSent(); camLost(); KM.changed('nengine'); }
  }
  function resetSent() { wready.clear(); comps.clear(); labels.clear(); ovlSent = ''; for (const [id, m] of media) if (m.aud) pcmStop(m.owner, id); media.clear(); avSent = null; srcSent.clear(); out = ''; transKey = ''; tbarSent = ''; ftbSent = ''; bsizeSent = ''; gridSent = ''; gridLabels.clear(); stPlaying = -1; for (const st of sting) { st.src = ''; st.ok = false; } attrSent.clear(); uready.clear(); ulaySent = null; if (utcWant) { utcWant = false; if (el()) window.klm.send('nengine:utc', false); } for (const k in bus) Object.assign(bus[k], { want: false, shown: false, hideAt: -1, rect: '', id: null }); N.pvw = N.pgm = false; }
  // klik di jendela native diteruskan ke kanvas di bawahnya (pilih kotak grid, klik kanan menu monitor, dll.)
  function clickFwd(a) {
    const cv = document.getElementById(a[0]); if (!cv) return;
    const r = cv.getBoundingClientRect(), x = r.left + (+a[1]) * r.width, y = r.top + (+a[2]) * r.height;
    const btn = +a[3], dbl = a[4] === '1', ctrl = a[5] === '1';
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: btn, ctrlKey: ctrl, view: window };
    if (btn === 2) { cv.dispatchEvent(new MouseEvent('contextmenu', o)); return; }
    cv.dispatchEvent(new MouseEvent('mousedown', o)); cv.dispatchEvent(new MouseEvent('mouseup', o)); cv.dispatchEvent(new MouseEvent('click', o));
    if (dbl) cv.dispatchEvent(new MouseEvent('dblclick', o));
  }

  // ---------- file video, gambar, daftar putar, GIF, SVG, sumber internet, stream masuk (Fase 5–6) ----------
  // dibuka di mesin native sejak awal (siap saat dipotong ke Program); audio sumber bisa ikut didekode native
  const MEDIA_TYPES = new Set(['image', 'video', 'urlvideo', 'list', 'stream']);
  const media = new Map(); // id mesin → { kind, src, owner, ok, err, vt, aud }
  N.media = media;
  if (KM.settings.nativeAudio == null) KM.settings.nativeAudio = true;
  if (KM.settings.avOffset == null) KM.settings.avOffset = 0;
  const hashId = (pre, str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return pre + (h >>> 0).toString(36); };
  const localPath = (u) => { u = String(u || ''); if (!u.startsWith('/localfile?p=')) return ''; try { return decodeURIComponent(u.slice(13)); } catch (e) { return ''; } };
  const isHttp = (u) => /^https?:\/\//i.test(String(u || ''));
  const dlCache = new Map(); // url → path | false (gagal) | null (sedang)
  function download(url) {
    if (dlCache.has(url)) return dlCache.get(url);
    dlCache.set(url, null);
    window.klm.invoke('nengine:download', url).then((p) => dlCache.set(url, p || false)).catch(() => dlCache.set(url, false));
    return null;
  }
  // gambar → { kind:'image', src:path } | { kind:'raster', el } (SVG / gambar internet yang tak bisa diunduh) | null
  function imageEntry(url, el) {
    const lp = localPath(url);
    const svg = /\.svg(?:[?#]|$)/i.test(lp || url);
    if (lp && !svg) return { kind: 'image', src: lp };
    if (isHttp(url) && !svg) { const p = download(url); if (p) return { kind: 'image', src: p }; if (p === null) return null; }
    if ((lp || isHttp(url) || /^(data|blob):/i.test(url)) && el && el.complete && el.naturalWidth) return { kind: 'raster', src: url, el };
    return null;
  }
  function videoEntry(url) { const lp = localPath(url); if (lp) return { kind: 'video', src: lp }; if (isHttp(url)) return { kind: 'video', src: url }; return null; }
  // input → daftar entri yang diinginkan; entri pertama = yang tampil sekarang
  function entriesOf(inp) {
    const o = inp.opts || {}, rt = inp.rt;
    if (inp.type === 'image') { const e = imageEntry(o.url, rt.el); return e ? [Object.assign(e, { id: nid(inp) })] : []; }
    if (inp.type === 'video' || inp.type === 'urlvideo') { const e = videoEntry(o.url); return e ? [Object.assign(e, { id: nid(inp), vEl: rt.el, aud: true })] : []; }
    if (inp.type === 'stream') { if (rt.status !== 'live') return []; return [{ id: nid(inp), kind: 'live', src: location.origin + '/hub/in/data/' + inp.id, aud: true }]; }
    if (inp.type === 'list') { // item sekarang + item berikutnya (disiapkan lebih dulu agar pergantian mulus)
      const items = o.items || []; if (!items.length || rt.idx < 0) return [];
      const out = [];
      for (const k of [0, 1]) {
        const it = items[(rt.idx + k) % items.length]; if (!it) continue;
        const e = it.kind === 'image' ? imageEntry(it.url, k === 0 ? rt.img : null) : videoEntry(it.url);
        if (!e) { if (k === 0) return []; continue; }
        e.id = hashId('l', inp.id + '|' + it.url);
        if (k === 0 && it.kind !== 'image') { e.vEl = rt.v; e.aud = true; }
        if (!out.some((x) => x.id === e.id)) out.push(e);
      }
      return out;
    }
    return [];
  }
  function addCompSrcs(inp, need, depth) {
    if (depth > 3) return;
    const list = [inp].concat((inp.layers || []).filter((l) => l && l.on && l.inputId).map((l) => KM.getInput(l.inputId)).filter(Boolean));
    for (const i of list) {
      if (i !== inp && hasLayers(i)) { addCompSrcs(i, need, depth + 1); continue; }
      if (i.type === 'virtualset') continue;
      const sp = rawSpec(i, true); if (!sp || sp === 'cam' || sp === 'media') continue;
      const k = rawEid(i); need.set(k, sp);
      if (srcSent.get(k) !== sp) { srcSent.set(k, sp); cmd('src ' + k + ' ' + sp); }
    }
  }
  const hwnds = new Map(); // winId browser → hwnd
  function extraEntries(inp) { // Web Browser, jendela, Title, latar/depan Virtual Set
    const o = inp.opts || {}, rt = inp.rt;
    if (inp.type === 'browser') {
      if (!rt.winId || rt.osr) return [];
      if (!hwnds.has(rt.winId)) { hwnds.set(rt.winId, null); window.klm.invoke('browser:hwnd', rt.winId).then((h) => hwnds.set(rt.winId, h || false)).catch(() => hwnds.set(rt.winId, false)); }
      const h = hwnds.get(rt.winId); return h ? [{ id: nid(inp), kind: 'window', src: String(h) }] : [];
    }
    if (inp.type === 'screen') { const m = /^window:(\d+)/.exec(o.sourceId || ''); return m ? [{ id: nid(inp), kind: 'window', src: m[1] }] : []; }
    if (inp.type === 'title') return rt.canvas ? [{ id: nid(inp), kind: 'live-raster', el: rt.canvas, inp }] : [];
    if (inp.type === 'virtualset') {
      const out = [];
      if (o.bgKind === 'image' && o.bgUrl) { const e = imageEntry(o.bgUrl, rt.bgImg); if (e) out.push(Object.assign(e, { id: hashId('b', inp.id + '|' + o.bgUrl) })); }
      else if (o.bgKind === 'video' && o.bgUrl) { const e = videoEntry(o.bgUrl); if (e) out.push(Object.assign(e, { id: hashId('b', inp.id + '|' + o.bgUrl), vEl: rt.bgVid })); }
      else if (o.bgKind !== 'none' && rt.canvas) out.push({ id: vsBgId(inp), kind: 'raster', src: 'vs|' + vsSig(o), el: rt.canvas });
      if (o.fgUrl) { const e = imageEntry(o.fgUrl, rt.fg); if (e) out.push(Object.assign(e, { id: hashId('f', inp.id + '|' + o.fgUrl) })); }
      return out;
    }
    return [];
  }
  // Title Cepat: kanvas dirender ulang saat berubah (deteksi lewat miniatur) → dikirim lagi, maks ±20×/detik
  const thumbC = document.createElement('canvas'); thumbC.width = 32; thumbC.height = 18;
  function canvasSig(el) { try { const g = thumbC.getContext('2d', { willReadFrequently: true }); g.clearRect(0, 0, 32, 18); g.drawImage(el, 0, 0, 32, 18); const d = g.getImageData(0, 0, 32, 18).data; let h = 2166136261; for (let i = 0; i < d.length; i += 3) { h ^= d[i]; h = Math.imul(h, 16777619); } return h >>> 0; } catch (e) { return 0; } }
  const curId = new Map(); // inp.id → id mesin yang sedang tampil
  function mediaIdOf(inp) { return curId.get(inp.id) || ''; }
  function rasterize(id, el) { // SVG / gambar internet: dirender KLM sesuai resolusi output, dikirim sekali
    try {
      const W = KM.settings.width, H = KM.settings.height, nw = el.naturalWidth || el.width, nh = el.naturalHeight || el.height; // <img> atau <canvas>
      const k = Math.min(W / nw, H / nh, 4096 / Math.max(nw, nh)), w = Math.max(1, Math.round(nw * k)), h = Math.max(1, Math.round(nh * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(el, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h);
      window.klm.send('nengine:raster', id, w, h, d.data.buffer);
      return true;
    } catch (e) { return false; } // kanvas "tercemar" (gambar internet tanpa CORS) → tetap jalur biasa
  }
  function rawRaster(id, el) { // kanvas apa adanya (ukuran asli) → mesin native
    try { const g = el.getContext('2d', { willReadFrequently: true }); const d = g.getImageData(0, 0, el.width, el.height); window.klm.send('nengine:raster', id, el.width, el.height, d.data.buffer); return true; } catch (e) { return false; }
  }
  const audioWanted = () => KM.settings.nativeAudio !== false;
  function mediaSync() {
    const want = new Map(), now = performance.now();
    curId.clear();
    for (const inp of KM.state.inputs) {
      if (MEDIA_TYPES.has(inp.type)) {
        const es = entriesOf(inp);
        if (es.length) curId.set(inp.id, es[0].id);
        for (const e of es) { e.owner = inp.id; e.cur = e === es[0]; want.set(e.id, e); }
      } else for (const e of extraEntries(inp)) { e.owner = inp.id; e.cur = false; want.set(e.id, e); }
      for (const e of segEntries(inp)) { e.owner = inp.id; e.cur = false; want.set(e.id, e); }
    }
    for (const [id, m] of media) if (m.keep) want.set(id, { id, kind: 'raster', src: m.sig, keep: true });
    for (const [id, e] of want) {
      if (e.keep) continue; // label kotak: dikirim sekali, dikelola labelImg
      let m = media.get(id); const sig = e.kind + '|' + e.src;
      if (!m || m.sig !== sig) {
        if (m) cmd('del ' + id);
        m = { sig, kind: e.kind, owner: e.owner, ok: false, err: '', vt: null, aud: false, failed: false };
        media.set(id, m);
        if (e.kind === 'raster') { if (!rasterize(id, e.el)) { m.err = 'gambar internet tanpa izin CORS'; m.failed = true; } }
        else if (e.kind === 'live-raster') { m.liveAt = 0; m.liveSig = -1; }
        else if (e.kind === 'window') cmd('src ' + id + ' window ' + e.src);
        else cmd('src ' + id + ' ' + e.kind + ' ' + hexStr(e.src));
      }
      m.owner = e.owner;
      if (e.kind === 'live-raster' && e.el && e.el.width) { // Title: render & kirim ulang bila isinya berubah
        try { const t = KM.inputTypes[e.inp.type]; if (t.tick) t.tick(e.inp, KM.now()); } catch (x) {}
        if (now - (m.liveAt || 0) > 50) { const sg = canvasSig(e.el); if (sg !== m.liveSig || now - m.liveAt > 3000) { m.liveSig = sg; m.liveAt = now; rawRaster(id, e.el); } }
      }
      // audio sumber native: hanya entri yang sedang tampil, berhenti saat jeda
      const aOn = !!(e.aud && e.cur && audioWanted() && !m.noAudio);
      if (aOn !== m.aud) { m.aud = aOn; cmd('naud ' + id + ' ' + (aOn ? 1 : 0)); if (!aOn) pcmStop(e.owner, id); }
      if (e.vEl) { // posisi putar elemen video KLM → mesin native
        const v = e.vEl; if (!v || v.readyState < 1) continue;
        const t = v.currentTime || 0, play = !v.paused && !v.ended, rate = v.playbackRate || 1, o = m.vt;
        const pred = o ? (o.play ? o.t + (now - o.at) / 1000 * o.rate : o.t) : -1;
        if (!o || o.play !== play || o.rate !== rate || Math.abs(pred - t) > 0.25 || now - o.at > 1000) {
          m.vt = { t, play, rate, at: now }; cmd('vt ' + id + ' ' + t.toFixed(3) + ' ' + (play ? 1 : 0) + ' ' + rate.toFixed(3));
        }
      }
    }
    for (const id of [...media.keys()]) if (!want.has(id) && !(media.get(id) || {}).keep) { const m = media.get(id); media.delete(id); cmd('del ' + id); if (m && m.aud) pcmStop(m.owner, id); }
    // geser A/V output: + → audio ditunda (DelayNode bus, berlaku semua output); − → video ditunda (khusus output native)
    const off = Math.round(+KM.settings.avOffset || 0);
    if (off !== avSent) { avSent = off; cmd('avoff ' + Math.min(0, off)); if (KM.audio && KM.audio.setOutDelay) KM.audio.setOutDelay(Math.max(0, off)); }
  }
  let avSent = null;
  // ---- PCM audio sumber native → strip mixer KLM (fader, EQ, mute, meter tetap berlaku)
  const pcmOwner = (id) => { const m = media.get(id); if (m) return [m.owner]; const c = cams.get(id); return c ? [...c.users] : []; };
  function pcmStop(owner, id) {
    const inp = KM.getInput(owner); if (!inp || !inp.rt.nAudio || (id && inp.rt.nAudioId && inp.rt.nAudioId !== id)) return;
    inp.rt.nAudio = false; inp.rt.nAudioId = null;
    if (inp.rt.pcmNode) { try { inp.rt.pcmNode.port.close(); inp.rt.pcmNode.disconnect(); } catch (e) {} inp.rt.pcmNode = null; inp.rt.pcmWait = false; }
    if (KM.audio) KM.audio.attach(inp, true); // kembali ke suara elemen / stream biasa
  }
  N.pcmIn = function (d) {
    if (!d || !d.pcm) return;
    for (const uid of pcmOwner(d.id)) {
      const inp = KM.getInput(uid); if (!inp || !KM.pcmFeed) continue;
      if (!inp.rt.nAudio || inp.rt.nAudioId !== d.id || inp.rt.nAudioRate !== d.rate) {
        if (inp.rt.pcmNode) { try { inp.rt.pcmNode.port.close(); inp.rt.pcmNode.disconnect(); } catch (e) {} inp.rt.pcmNode = null; inp.rt.pcmWait = false; }
        inp.rt.nAudio = true; inp.rt.nAudioId = d.id; inp.rt.nAudioRate = d.rate;
      }
      KM.pcmFeed(inp, d.pcm, d.rate);
    }
  };
  function naEv(t, rest) {
    const a = rest.split(' '), m = media.get(a[0]);
    if (t === 'naerr') { if (m) { m.noAudio = true; m.aud = false; } const c = cams.get(a[0]); if (c && c.audWait) { c.audWait.rej(new Error(rest.slice(a[0].length + 1))); c.audWait = null; } }
    else if (t === 'naok') { const c = cams.get(a[0]); if (c && c.audWait) { c.audWait.res(); c.audWait = null; } }
  }
  // audio kamera native (capture card HDMI / mic perangkat) lewat Media Foundation
  N.camAudio = function (inp, label) {
    const c = inp.rt.ncam && cams.get(inp.rt.ncam); if (!c) return Promise.reject(new Error('kamera native belum dibuka'));
    cmd('camaud ' + c.id + ' ' + hexStr(label));
    return new Promise((res, rej) => { const t = setTimeout(() => { c.audWait = null; rej(new Error('tidak ada jawaban')); }, 5000); c.audWait = { res: () => { clearTimeout(t); res(); }, rej: (e) => { clearTimeout(t); rej(e); } }; });
  };
  N.audioWanted = audioWanted;

  // ---------- output native (Fase 4b): rekam & streaming dikodekan mesin native dari Program native ----------
  const outs = new Map(); // oid → { kind, enc, hw, wait, stopWait, err, frames }
  N.outs = outs;
  let oSeq = 0, warnedWhy = '';
  N.outWhy = function () {
    if (!el() || !running || !ready) return 'mesin native mati';
    if (KM.settings.nativeOut === false) return 'dimatikan di pengaturan';
    const base = pgmBaseWhy(); if (base) return base;
    for (const i of KM.state.inputs) {
      if (N.relaxInputs && i.id !== KM.state.programId && i.id !== KM.state.previewId) continue; // (uji otomatis)
      const t = KM.inputTypes[i.type]; if (!t || t.noVideo) continue;
      if (KM.utc && ((KM.utc.input && KM.utc.input() === i) || (KM.utc.score && KM.utc.score.input && KM.utc.score.input() === i)) && i.id !== KM.state.programId) continue; // grafis UTC → lapisan DSK
      if (!spec(i)) return 'input "' + i.title + '" (' + label(i) + ') belum didukung mesin native';
    }
    const U = KM.utc, ids = U && U.dskIds ? U.dskIds() : [];
    const uw = utcWhy(ids); if (uw && uw !== 'menunggu grafis UTC') return uw;
    return '';
  };
  N.outStart = function (kind, o) {
    const id = 'o' + (++oSeq);
    const st = KM.settings, W = st.width, H = st.height, F = st.fps;
    const hx = o.path ? hexStr(o.path) : '-';
    const x = { id, kind, err: '', frames: 0, bus: o.bus || 'M' };
    outs.set(id, x);
    cmd(['ostart', id, kind, W, H, F, Math.round(o.vk || 6000), Math.round(o.ak || 160), o.cbr ? 1 : 0, hx].join(' '));
    return new Promise((res, rej) => {
      const t = setTimeout(() => { outs.delete(id); rej(new Error('mesin native tidak menjawab')); }, 10000);
      x.wait = { res: () => { clearTimeout(t); audStart(); res(x); }, rej: (e) => { clearTimeout(t); outs.delete(id); rej(e); } };
    });
  };
  N.outStop = function (id) {
    const x = outs.get(id); if (!x) return Promise.resolve(null);
    cmd('ostop ' + id);
    return new Promise((res) => { const t = setTimeout(() => { outs.delete(id); audCheck(); res(x); }, 20000); x.stopWait = () => { clearTimeout(t); res(x); }; });
  };
  function oEv(t, rest) {
    const a = rest.split(' '), x = outs.get(a[0]); if (!x) return;
    if (t === 'ostarted') { x.enc = a[1] === '-' ? '' : new TextDecoder().decode(new Uint8Array((a[1].match(/../g) || []).map((h) => parseInt(h, 16)))); x.hw = a[2] === '1'; x.cpu = a[3] === '1'; if (x.wait) x.wait.res(); x.wait = null; }
    else if (t === 'oerr') { x.err = rest.slice(a[0].length + 1); if (x.wait) { x.wait.rej(new Error(x.err)); x.wait = null; } else KM.toast('Output native: ' + x.err, 'warn', 7000); }
    else if (t === 'ostopped') { x.frames = +a[1] || 0; x.skipped = +a[2] || 0; outs.delete(a[0]); audCheck(); if (x.stopWait) x.stopWait(); else if (x.onEnd) x.onEnd(x); }
  }
  // audio Program → PCM s16le stereo 48 kHz → mesin native
  let actx = null, anode = null, asrc = null, abuf = [], alen = 0, abus = '';
  const AW = `class P extends AudioWorkletProcessor { process(inp) { const c = inp[0]; if (c && c.length) { const l = c[0], r = c[1] || c[0], o = new Int16Array(l.length * 2);
    for (let i = 0; i < l.length; i++) { const a = Math.max(-1, Math.min(1, l[i])), b = Math.max(-1, Math.min(1, r[i])); o[i * 2] = a * 32767; o[i * 2 + 1] = b * 32767; }
    this.port.postMessage(o, [o.buffer]); } return true; } } registerProcessor('klm-pcm', P);`;
  async function audStart() {
    const bus = [...outs.values()][0].bus || 'M';
    if (actx && abus === bus) return;
    audStop(); abus = bus;
    try {
      actx = new AudioContext({ sampleRate: 48000 });
      await actx.audioWorklet.addModule(URL.createObjectURL(new Blob([AW], { type: 'text/javascript' })));
      asrc = actx.createMediaStreamSource(KM.audio.streamOf(bus));
      anode = new AudioWorkletNode(actx, 'klm-pcm', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
      const g = actx.createGain(); g.gain.value = 0;
      asrc.connect(anode); anode.connect(g); g.connect(actx.destination);
      anode.port.onmessage = (e) => {
        abuf.push(e.data); alen += e.data.length;
        if (alen >= 1920) { const o = new Int16Array(alen); let k = 0; for (const b of abuf) { o.set(b, k); k += b.length; } abuf = []; alen = 0; if (outs.size) window.klm.send('nengine:aud', o.buffer); }
      };
      if (actx.state !== 'running') actx.resume().catch(() => {});
    } catch (e) { console.warn('audio output native', e); KM.toast('Audio output native gagal: ' + e.message + ' — rekaman tanpa suara', 'warn', 7000); }
  }
  function audStop() { try { asrc && asrc.disconnect(); anode && anode.disconnect(); } catch (e) {} try { actx && actx.close(); } catch (e) {} actx = anode = asrc = null; abuf = []; alen = 0; }
  function audCheck() { if (!outs.size) audStop(); }

  // ---------- KLMCAM native (Fase 4a): frame H.264 terenkode → dekoder GPU mesin native ----------
  const kcams = new Map(); // id dekoder → { ok, err, w, h, dxva, last, codec, n }
  N.kcams = kcams;
  const kidOf = (inp) => 'k' + String(inp.id).replace(/[^\w]/g, '').slice(0, 30);
  N.kWant = () => el() && running && ready && KM.settings.nativeEngine === true && KM.settings.nativeKlmcam !== false && !!window.RTCRtpScriptTransform;
  let kWorker = null;
  const KW = `const fwd = new Set(), tf = new Map();
onmessage = (e) => { const m = e.data || {}; if (m.fwd) fwd.add(m.fwd); if (m.unfwd) fwd.delete(m.unfwd);
  if (m.kf) { const t = tf.get(m.kf); if (t && t.sendKeyFrameRequest) t.sendKeyFrameRequest().catch(() => {}); } };
onrtctransform = (ev) => {
  const t = ev.transformer, id = t.options && t.options.id; if (id) tf.set(id, t);
  const r = t.readable.getReader(), w = t.writable.getWriter(); let n = 0;
  (async () => { for (;;) {
    const x = await r.read(); if (x.done) break; const f = x.value;
    if (id && fwd.has(id) && tf.get(id) === t) { try { const md = f.getMetadata ? f.getMetadata() : {}; const buf = f.data.slice(0); postMessage({ id, key: f.type === 'key', n: n++, mime: md.mimeType || '', buf }, [buf]); } catch (e) {} }
    try { await w.write(f); } catch (e) {}
  } })();
};`;
  function kw() {
    if (kWorker) return kWorker;
    kWorker = new Worker(URL.createObjectURL(new Blob([KW], { type: 'text/javascript' })));
    kWorker.onmessage = (e) => {
      const m = e.data, k = kcams.get(m.id); if (!k) return;
      if (m.mime && !/h264/i.test(m.mime)) { if (k.codec !== m.mime) { k.codec = m.mime; k.err = 'codec ' + m.mime.replace(/^video\//, '') + ' (butuh H.264)'; kWorker.postMessage({ unfwd: m.id }); } return; }
      if (!N.kWant()) return;
      window.klm.send('nengine:kenc', m.id, m.key, m.n, m.buf);
    };
    return kWorker;
  }
  // dipanggil link.js untuk tiap penerima video KLMCAM (juga saat menyambung ulang)
  N.kAttach = function (inp, receiver) {
    if (!el() || !window.RTCRtpScriptTransform || !receiver || KM.settings.nativeEngine !== true || KM.settings.nativeKlmcam === false) return;
    const id = kidOf(inp);
    try { receiver.transform = new RTCRtpScriptTransform(kw(), { id }); receiver.__klmK = id; } catch (e) { console.warn('KLMCAM transform', e); return; }
    let k = kcams.get(id); if (!k) { k = { ok: false, err: '', last: 0, n: 0 }; kcams.set(id, k); }
    k.err = ''; k.codec = '';
    if (N.kWant()) { kw().postMessage({ fwd: id }); setTimeout(() => kw().postMessage({ kf: id }), 300); }
  };
  function kSync() { // nyalakan / matikan penerusan sesuai keadaan mesin
    if (!kWorker) return;
    for (const [id, k] of kcams) {
      const inp = KM.state.inputs.find((i) => i.type === 'klmcam' && kidOf(i) === id);
      if (!inp) { kWorker.postMessage({ unfwd: id }); cmd('kdecoff ' + id); kcams.delete(id); continue; }
      if (N.kWant() && !k.codec) { kWorker.postMessage({ fwd: id }); kWorker.postMessage({ kf: id }); } else kWorker.postMessage({ unfwd: id });
    }
  }
  N.kSync = kSync;
  function kEv(t, rest) {
    const a = rest.split(' '), k = kcams.get(a[0]); if (!k) return;
    if (t === 'kok') { k.ok = true; k.w = +a[1]; k.h = +a[2]; k.dxva = a[3] === '1'; k.last = Date.now(); }
    else if (t === 'kerr') { k.err = rest.slice(a[0].length + 1); }
    else if (t === 'kneedkey' && kWorker) kWorker.postMessage({ kf: a[0] });
  }

  // ---------- kamera native (Fase 3) ----------
  const cams = new Map(); // id kamera → { users:Set, key, w, h, fps, ok, err, frames, cur:{imp,vf}, wait:[] }
  N.cams = cams;
  const hexStr = (s) => { if (!s) return '-'; return [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join(''); };
  const camIdOf = (key) => { let h = 2166136261; for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); } return 'c' + (h >>> 0).toString(36); };
  N.camUsable = () => el() && running && ready && KM.settings.nativeEngine === true && KM.settings.nativeCam !== false;
  N.camOpen = function (inp, label, o) {
    const test = o.deviceId === 'klm-native-test';
    const key = test ? 'test' : (label || 'default') + '@' + o.width + 'x' + o.height + '@' + o.fps;
    const id = camIdOf(key);
    if (inp.rt.ncam && inp.rt.ncam !== id) N.camClose(inp);
    let c = cams.get(id);
    if (!c) {
      c = { id, users: new Set(), key, ok: false, err: '', frames: 0, cur: null, wait: [] };
      cams.set(id, c);
      if (test) cmd('camtest ' + id + ' ' + (o.width | 0) + ' ' + (o.height | 0) + ' ' + (o.fps | 0));
      else cmd('cam ' + id + ' ' + (o.width | 0) + ' ' + (o.height | 0) + ' ' + (o.fps | 0) + ' ' + hexStr(label));
      cmd('camexp ' + id + ' 1');
    }
    c.users.add(inp.id); inp.rt.ncam = id;
    if (c.ok) return Promise.resolve(c);
    return new Promise((res, rej) => {
      const t = setTimeout(() => { c.wait = c.wait.filter((x) => x.res !== res); rej(new Error('mesin native tidak menjawab')); }, 9000);
      c.wait.push({ res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    });
  };
  function camFree(c) { if (c.cur) { try { c.cur.vf.close(); } catch (e) {} try { c.cur.imp.release(); } catch (e) {} c.cur = null; } }
  N.camClose = function (inp) {
    const id = inp.rt.ncam; inp.rt.ncam = null; if (!id) return;
    const c = cams.get(id); if (!c) return;
    c.users.delete(inp.id);
    if (!c.users.size) { cmd('camoff ' + id); camFree(c); cams.delete(id); }
  };
  function camEv(t, rest) {
    const sp = rest.indexOf(' '), id = sp < 0 ? rest : rest.slice(0, sp), c = cams.get(id); if (!c) return;
    if (t === 'camok') { const a = rest.split(' '); c.ok = true; c.w = +a[1]; c.h = +a[2]; c.fps = +a[3]; c.err = ''; c.wait.splice(0).forEach((w) => w.res(c)); }
    else {
      c.err = rest.slice(sp + 1); const was = c.ok; c.ok = false;
      c.wait.splice(0).forEach((w) => w.rej(new Error(c.err)));
      // kamera putus / gagal saat berjalan → input membuka ulang (lewat mesin native lagi, atau jalur biasa bila gagal terus)
      if (was) for (const uid of [...c.users]) { const inp = KM.getInput(uid); if (inp && inp.rt.reopen) { inp.rt.nfail = (inp.rt.nfail || 0) + 1; inp.rt.reopen(); } }
    }
  }
  N.camFrame = function (imp, id, meta) {
    const c = cams.get(id);
    if (!c) { try { imp.release(); } catch (e) {} return; }
    let vf; try { vf = imp.getVideoFrame(); } catch (e) { try { imp.release(); } catch (x) {} return; }
    camFree(c); c.cur = { imp, vf }; c.frames++;
    if (c.frames === 1) KM.changed('input');
  };
  // Web Browser offscreen: frame GPU untuk mixer (mesin native menerima tekstur yang sama langsung dari proses utama)
  N.osrWanted = () => el() && KM.settings.nativeEngine === true;
  N.osrFrame = function (imp, id, meta) {
    const inp = KM.state.inputs.find((i) => i.type === 'browser' && i.rt.osr && String(i.rt.winId) === String(id));
    if (!inp) { try { imp.release(); } catch (e) {} return; }
    let vf; try { vf = imp.getVideoFrame(); } catch (e) { try { imp.release(); } catch (x) {} return; }
    const old = inp.rt.osrF; inp.rt.osrF = { imp, vf };
    if (old) { try { old.vf.close(); } catch (e) {} try { old.imp.release(); } catch (e) {} }
    if (!old) KM.changed('input');
  };
  N.camSrc = (id) => { const c = cams.get(id); return c && c.cur ? { src: c.cur.vf, w: c.cur.vf.displayWidth, h: c.cur.vf.displayHeight } : null; };
  N.camErr = (id) => { const c = cams.get(id); return c ? c.err : ''; };
  // mesin berhenti → kamera native hilang: input kamera dibuka ulang (jalur biasa sampai mesin siap lagi)
  function camLost() {
    for (const c of cams.values()) { camFree(c); c.wait.splice(0).forEach((w) => w.rej(new Error('mesin native berhenti'))); }
    const users = [...cams.values()].flatMap((c) => [...c.users]);
    for (const c of cams.values()) for (const uid of c.users) pcmStop(uid, c.id);
    cams.clear();
    for (const uid of users) { const inp = KM.getInput(uid); if (inp) { inp.rt.ncam = null; inp.rt.reopen && inp.rt.reopen(); } }
  }
  function camReopen() { if (!N.camUsable()) return; for (const inp of KM.state.inputs) if (inp.type === 'camera' && !inp.rt.ncam && inp.rt.reopen && !(inp.rt.nfail >= 3)) inp.rt.reopen(); }
  N.camReopenAll = () => { for (const inp of KM.state.inputs) if (inp.type === 'camera' && inp.rt.reopen) { inp.rt.nfail = 0; inp.rt.reopen(); } };

  // mesin dinyalakan saat KLMCAM sudah tersambung → pasang penerus di penerima yang sudah ada (tanpa menyambung ulang HP)
  function kAttachAll() {
    if (!KM.link || !KM.link.peers) return;
    for (const p of KM.link.peers.values()) {
      const inp = p.inputId && KM.getInput(p.inputId);
      if (!inp || inp.type !== 'klmcam' || !p.pc) continue;
      for (const r of p.pc.getReceivers()) if (r.track && r.track.kind === 'video' && r.__klmK !== kidOf(inp)) N.kAttach(inp, r);
    }
  }

  N.start = async function () {
    if (!el() || running) return;
    running = true; ready = false; N.state = 'memulai';
    const r = await window.klm.invoke('nengine:start').catch((e) => ({ state: 'error', msg: e.message }));
    if (r && r.state === 'error') { running = false; N.state = 'gagal: ' + (r.msg || '?'); KM.toast('Mesin video native tidak bisa dimulai: ' + (r.msg || '?'), 'warn', 7000); }
    else if (r && r.state === 'ready') { ready = true; N.state = 'ready'; N.adapter = r.adapter || ''; resetSent(); camReopen(); kAttachAll(); kSync(); }
    KM.changed('nengine');
  };
  N.stop = function () {
    if (!running) return;
    if (utcWant) { utcWant = false; window.klm.send('nengine:utc', false); } utcErr = '';
    N.pvw = N.pgm = false; // JS langsung menggambar monitor lagi
    for (const k in bus) cmd('rect ' + k + ' 0 0 0 0 0');
    running = false; ready = false; N.state = 'off';
    camLost(); // kamera kembali dibuka jalur biasa
    for (const x of outs.values()) { if (x.stopWait) x.stopWait(); else if (x.onEnd) x.onEnd(x); } outs.clear(); audStop();
    for (const k of kcams.values()) k.ok = false; kSync();
    window.klm.invoke('nengine:stop').catch(() => {});
    KM.changed('nengine');
  };
  // uji: baca 1 piksel monitor native (koordinat 0..1)
  const probeWait = [];
  N.probe = (bus, fx, fy) => new Promise((res) => { if (!running) return res(null); probeWait.push(res); cmd('probe ' + bus + ' ' + (+fx).toFixed(4) + ' ' + (+fy).toFixed(4)); setTimeout(() => { const i = probeWait.indexOf(res); if (i >= 0) { probeWait.splice(i, 1); res(null); } }, 2000); });
  N.utcState = () => ({ want: utcWant, err: utcErr, ready: [...uready], ulay: ulaySent });
  N.set = (on) => { KM.settings.nativeEngine = !!on; KM.saveSettings(); if (on) N.start(); else N.stop(); };
  N.status = () => (el() ? window.klm.invoke('nengine:status').catch(() => null) : Promise.resolve(null));

  if (el()) {
    window.klm.on('nengine:ev', onEv);
    window.klm.on('nengine:pcm', (d) => { try { N.pcmIn(d); } catch (e) {} });
    KM.on('frame', sync);
    window.addEventListener('resize', () => { for (const k in bus) bus[k].rect = bus[k].want ? '?' : ''; });
    const boot = () => { N.status().then((s) => { N.available = !!(s && s.available); if (KM.settings.nativeEngine && N.available) setTimeout(N.start, 3000); }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(window.KM);
