/* KLM Mix - Penyusun tata letak visual (layer / multiview) & Virtual Set multi kamera.
 * Editor: seret kotak, ubah ukuran dari sudut/sisi, roda mouse = zoom, mode "Isi" untuk menggeser/zoom/pangkas
 * gambar di dalam kotak tanpa mengubah input aslinya; input dasar (yang sedang diatur) juga bisa digeser/zoom/pangkas.
 * Virtual Set: latar (gaya bawaan / warna / gambar / video loop) + kotak kamera sebanyak yang diinginkan,
 * template 1–16 kamera, dan template buatan sendiri yang bisa disimpan/ekspor/impor. */
'use strict';
(function (KM) {
  const h = KM.h, S = KM.state, clamp = KM.clamp;
  const LE = KM.layoutEd = {};
  const VS = KM.vset = {};
  const AR = () => KM.settings.width / KM.settings.height;
  const VIDEO_T = ['camera', 'klmcam', 'stream', 'call', 'screen', 'video', 'urlvideo', 'list', 'browser', 'replay'];

  /** kotak baru dengan gaya bawaan */
  LE.newLayer = (o) => Object.assign({ on: true, inputId: '', x: 0.3, y: 0.3, w: 0.4, h: 0.4, fit: 'fill', zoom: 1, px: 0, py: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0, bw: 0, bc: '#ffffff', rad: 0, op: 1, sh: 0, label: '' }, o || {});
  const adopt = (l) => { if (!l.fit) { l.fit = 'fill'; l.zoom = l.zoom || 1; l.px = l.px || 0; l.py = l.py || 0; } }; // layer lama → punya framing sendiri

  // ---------------- template tata letak ----------------
  const ST = { rad: 0.06, bw: 3, bc: '#ffffff', sh: 1 };
  const B = (x, y, w, hh, extra) => LE.newLayer(Object.assign({ x, y, w, h: hh }, ST, extra || {}));
  /** grid n kotak 16:9 di tengah layar (baris terakhir dirata tengah) */
  function grid(cols, n, o) {
    o = o || {}; const m = o.m != null ? o.m : 0.035, g = o.g != null ? o.g : 0.018, rows = Math.ceil(n / cols), top = o.top || 0, bot = o.bot || 0;
    const c = Math.min((1 - 2 * m - (cols - 1) * g) / cols, (1 - top - bot - 2 * m - (rows - 1) * g) / rows);
    const totalH = rows * c + (rows - 1) * g, y0 = top + (1 - top - bot - totalH) / 2, out = [];
    for (let r = 0; r < rows; r++) {
      const k = Math.min(cols, n - r * cols), totalW = k * c + (k - 1) * g, x0 = (1 - totalW) / 2;
      for (let i = 0; i < k; i++) out.push(B(x0 + i * (c + g), y0 + r * (c + g), c, c));
    }
    return out;
  }
  LE.grid = grid;
  const T = (id, name, n, slots, bg) => ({ id, name, n, bg: bg || 'aurora', slots, builtin: true });
  VS.builtin = [
    T('solo', '1 Kamera — bingkai studio', 1, () => [B(0.11, 0.07, 0.78, 0.78)]),
    T('duo-sejajar', '2 Kamera — sejajar', 2, () => grid(2, 2)),
    T('duo-panel', '2 Kamera — panel tinggi', 2, () => [B(0.035, 0.07, 0.455, 0.80), B(0.51, 0.07, 0.455, 0.80)], 'malam'),
    T('duo-pip', '2 Kamera — besar + kecil', 2, () => [B(0, 0, 1, 1, { rad: 0, bw: 0, sh: 0 }), B(0.68, 0.64, 0.29, 0.29)], 'malam'),
    T('duo-wawancara', '2 Kamera — wawancara', 2, () => [B(0.03, 0.14, 0.60, 0.60), B(0.655, 0.14, 0.315, 0.60)], 'emas'),
    T('presenter-materi', 'Materi + presenter', 2, () => [B(0.03, 0.08, 0.68, 0.68, { label: 'Materi', fit: 'fit', bg: '#000000' }), B(0.735, 0.08, 0.235, 0.80, { label: 'Presenter' })], 'malam'),
    T('trio-utama', '3 Kamera — 1 utama + 2 samping', 3, () => [B(0.03, 0.13, 0.64, 0.64), B(0.69, 0.13, 0.28, 0.31), B(0.69, 0.46, 0.28, 0.31)]),
    T('trio-sejajar', '3 Kamera — sejajar', 3, () => grid(3, 3)),
    T('trio-panel', '3 Kamera — panel tinggi', 3, () => [B(0.03, 0.09, 0.30, 0.76), B(0.35, 0.09, 0.30, 0.76), B(0.67, 0.09, 0.30, 0.76)], 'magenta'),
    T('kuartet-grid', '4 Kamera — 2 × 2', 4, () => grid(2, 4)),
    T('kuartet-utama', '4 Kamera — 1 utama + 3 bawah', 4, () => [B(0.21, 0.035, 0.58, 0.58), B(0.035, 0.66, 0.30, 0.30), B(0.35, 0.66, 0.30, 0.30), B(0.665, 0.66, 0.30, 0.30)]),
    T('kuartet-samping', '4 Kamera — 1 utama + 3 samping', 4, () => [B(0.03, 0.10, 0.70, 0.70), B(0.75, 0.10, 0.22, 0.22), B(0.75, 0.34, 0.22, 0.22), B(0.75, 0.58, 0.22, 0.22)], 'zamrud'),
    T('lima', '5 Kamera — 1 utama + 4 bawah', 5, () => [B(0.22, 0.03, 0.56, 0.56), B(0.03, 0.63, 0.22, 0.22), B(0.27, 0.63, 0.22, 0.22), B(0.51, 0.63, 0.22, 0.22), B(0.75, 0.63, 0.22, 0.22)]),
    T('enam', '6 Kamera — 3 × 2', 6, () => grid(3, 6)),
    T('enam-utama', '6 Kamera — 1 utama + 5', 6, () => [B(0.03, 0.04, 0.62, 0.62), B(0.67, 0.04, 0.30, 0.30), B(0.67, 0.36, 0.30, 0.30), B(0.03, 0.68, 0.30, 0.30), B(0.35, 0.68, 0.30, 0.30), B(0.67, 0.68, 0.30, 0.30)], 'merah'),
    T('delapan', '8 Kamera — 4 × 2', 8, () => grid(4, 8)),
    T('sembilan', '9 Kamera — 3 × 3', 9, () => grid(3, 9, { m: 0.02, g: 0.012 })),
    T('duabelas', '12 Kamera — 4 × 3', 12, () => grid(4, 12, { m: 0.02, g: 0.012 })),
    T('enambelas', '16 Kamera — 4 × 4', 16, () => grid(4, 16, { m: 0.015, g: 0.01 })),
    T('potret', '3 HP berdiri (9:16)', 3, () => [B(0.10, 0.06, 0.25, 0.80), B(0.375, 0.06, 0.25, 0.80), B(0.65, 0.06, 0.25, 0.80)], 'magenta'),
    T('kosong', 'Kosong — susun sendiri', 0, () => [])
  ];
  VS.custom = () => (Array.isArray(KM.settings.vsets) ? KM.settings.vsets : (KM.settings.vsets = []));
  VS.all = () => VS.custom().concat(VS.builtin);
  VS.slotsOf = (t) => (typeof t.slots === 'function' ? t.slots() : KM.deepClone(t.slots || [])).map((l) => LE.newLayer(Object.assign(l, { inputId: '' })));
  VS.bgOf = (t) => (t.bgOpts ? KM.deepClone(t.bgOpts) : { bgKind: 'style', bg: t.bg || 'aurora' });
  /** miniatur template */
  VS.thumb = function (t, w) {
    const cv = h('canvas', { width: w || 240, height: Math.round((w || 240) * 9 / 16) }), c = cv.getContext('2d'), W = cv.width, H = cv.height;
    const bg = VS.bgOf(t);
    KM.virtualSets.paintTo(cv, bg.bgKind === 'colour' ? bg : { bgKind: 'style', bg: bg.bg || 'malam' });
    if (bg.bgKind === 'image' && bg.bgUrl) { const im = new Image(); im.onload = () => { c.drawImage(im, 0, 0, W, H); boxes(); }; im.src = bg.bgUrl; }
    const boxes = () => VS.slotsOf(t).forEach((l, i) => {
      const x = l.x * W, y = l.y * H, ww = l.w * W, hh = l.h * H, r = (l.rad || 0) * Math.min(ww, hh) / 2;
      c.beginPath(); c.roundRect ? c.roundRect(x, y, ww, hh, r) : c.rect(x, y, ww, hh);
      c.fillStyle = 'rgba(12,16,24,.82)'; c.fill(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke();
      c.fillStyle = '#fff'; c.font = '700 ' + Math.max(9, Math.min(hh * 0.42, 22)) + 'px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), x + ww / 2, y + hh / 2);
    });
    boxes();
    return cv;
  };
  const candidates = (self) => S.inputs.filter((i) => i !== self && VIDEO_T.includes(i.type));
  /** isi kotak kosong berurutan dengan kamera/sumber video yang ada */
  VS.autoFill = function (inp) {
    const used = new Set(inp.layers.map((l) => l.inputId).filter(Boolean));
    const free = candidates(inp).filter((i) => !used.has(i.id));
    inp.layers.forEach((l) => { if (!l.inputId && free.length) l.inputId = free.shift().id; });
    KM.changed('input');
  };
  /** buat input Virtual Set dari template */
  VS.create = function (t, o) {
    o = o || {};
    const opts = Object.assign(VS.bgOf(t), o.bg || {});
    const inp = KM.inputs.create('virtualset', { title: o.title || ('Virtual Set — ' + t.name.replace(/ — .*/, '')), opts, layers: VS.slotsOf(t) });
    if (o.fill !== false) VS.autoFill(inp);
    return inp;
  };
  /** simpan tata letak input ini sebagai template sendiri */
  VS.saveFrom = function (inp, name) {
    const o = inp.opts || {}, isVs = inp.type === 'virtualset';
    const t = { id: 'u' + KM.uid(), name, n: inp.layers.length, slots: inp.layers.map((l) => { const c = KM.deepClone(l); c.inputId = ''; return c; }),
      bgOpts: isVs ? { bgKind: o.bgKind, bg: o.bg, colour: o.colour, bgUrl: /^blob:/.test(o.bgUrl || '') ? '' : o.bgUrl, bgPath: o.bgPath, bgLoop: o.bgLoop, bgDim: o.bgDim, fgUrl: /^blob:/.test(o.fgUrl || '') ? '' : o.fgUrl, caption: o.caption } : { bgKind: 'style', bg: 'malam' } };
    VS.custom().unshift(t); KM.saveSettings();
    return t;
  };
  /** terapkan template ke input yang sudah ada (sumber tiap kotak dipertahankan sesuai urutan) */
  VS.applyTo = function (inp, t, withBg) {
    const ids = inp.layers.map((l) => l.inputId);
    inp.layers = VS.slotsOf(t).map((l, i) => { l.inputId = ids[i] || ''; return l; });
    if (withBg && inp.type === 'virtualset') { Object.assign(inp.opts, VS.bgOf(t)); KM.virtualSets.apply(inp); }
    KM.changed('input');
  };

  // ---------------- kontrol kecil ----------------
  const num = (v, d) => (Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
  function slider(label, min, max, step, get, set, fmt) {
    const out = h('output', fmt ? fmt(get()) : String(num(get(), 2)));
    const r = h('input', { type: 'range', min, max, step, value: get(), oninput: () => { set(+r.value); out.textContent = fmt ? fmt(+r.value) : String(num(+r.value, 2)); },
      ondblclick: () => {} });
    return [h('label', label), r, out];
  }
  const pct = (v) => Math.round(v * 100) + '%';
  const sel = (opts, val, fn, attrs) => h('select', Object.assign({ onchange: (e) => fn(e.target.value) }, attrs || {}), opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(val) }, t)));

  /** kontrol latar Virtual Set (dipakai editor & dialog tambah) */
  VS.bgControls = function (o, apply) {
    const wrap = h('div.vsbg');
    const pick = async (kind, key) => {
      const f = (await KM.pickFiles(kind === 'video' ? 'video/*' : 'image/*'))[0]; if (!f) return;
      if (key === 'fgUrl') { o.fgUrl = f.url; } else { o.bgKind = kind; o.bgUrl = f.url; o.bgPath = f.path || f.name; }
      apply(); build();
    };
    const build = () => wrap.replaceChildren(
      h('div.lrow', h('label', 'Latar'), sel([['style', 'Gaya bawaan'], ['colour', 'Warna polos'], ['image', 'Gambar'], ['video', 'Video (loop)'], ['none', 'Transparan']], o.bgKind, (v) => { o.bgKind = v; apply(); build(); })),
      o.bgKind === 'style' ? h('div.lrow', h('label', 'Gaya'), sel(Object.entries(KM.virtualSets.presets), o.bg, (v) => { o.bg = v; apply(); })) : null,
      o.bgKind === 'colour' ? h('div.lrow', h('label', 'Warna'), h('input', { type: 'color', value: o.colour || '#101820', oninput: (e) => { o.colour = e.target.value; apply(); } })) : null,
      o.bgKind === 'image' || o.bgKind === 'video' ? h('div.lrow', h('label', 'File'), h('button.btn.sm', { onclick: () => pick(o.bgKind) }, KI.el(o.bgKind === 'video' ? 'film' : 'image'), o.bgUrl ? 'Ganti…' : 'Pilih ' + (o.bgKind === 'video' ? 'video' : 'gambar') + '…'),
        h('span.muted.ell', { title: o.bgPath || '' }, o.bgUrl ? String(o.bgPath || 'terpasang').split(/[\\/]/).pop() : 'belum dipilih')) : null,
      o.bgKind === 'video' ? h('div.lrow', h('label', 'Putar'), h('label.chk', h('input', { type: 'checkbox', checked: o.bgLoop !== false, onchange: (e) => { o.bgLoop = e.target.checked; apply(); } }), 'Ulang terus (loop)'), h('span.muted', 'tanpa suara')) : null,
      o.bgKind === 'style' ? h('div.lrow', h('label', 'Teks'), h('input.grow', { value: o.caption || '', placeholder: 'Teks pada latar (opsional)', oninput: (e) => { o.caption = e.target.value; apply(); } })) : null,
      o.bgKind !== 'none' ? h('div.kv3', ...slider('Gelapkan', 0, 0.9, 0.01, () => o.bgDim || 0, (v) => { o.bgDim = v; KM.changed('input'); }, pct)) : null,
      h('div.lrow', h('label', 'Bingkai depan'), h('button.btn.sm', { title: 'Gambar PNG transparan yang ditaruh di atas semua kotak (mis. bingkai/ornamen/logo)', onclick: () => pick('image', 'fgUrl') }, KI.el('layers'), o.fgUrl ? 'Ganti PNG…' : 'Pasang PNG…'),
        o.fgUrl ? h('button.btn.sm', { onclick: () => { o.fgUrl = ''; apply(); build(); } }, KI.el('x')) : h('span.muted', 'opsional')));
    build();
    return wrap;
  };

  // ---------------- editor visual ----------------
  LE.build = function (inp) {
    const isVs = inp.type === 'virtualset';
    let sel_ = inp.layers.length ? 0 : -1, mode = 'box', snapOn = true, drag = null, guides = [], hover = -2, propT = 0;
    const CW = 1280, CH = Math.round(CW / AR());
    const cv = h('canvas.lstage', { width: CW, height: CH, tabIndex: 0 }), c = cv.getContext('2d');
    const props = h('div.lprops'), list = h('div.llist'), bar = h('div.lbar'), hint = h('div.lhint');
    const wrap = h('div.layouted', h('div.lmain', bar, h('div.lstagebox', cv), hint), h('div.lside', list, props));
    const ch = () => KM.changed('input');
    const L = () => inp.layers;
    const cur = () => (sel_ >= 0 ? L()[sel_] : null);
    const others = () => S.inputs.filter((i) => i !== inp && !(KM.inputTypes[i.type] || {}).noVideo);
    const nameOf = (l) => { const i = KM.getInput(l.inputId); return i ? KM.inputNum(i) + '. ' + i.title : 'kosong'; };

    // ----- gambar panggung -----
    const HS = 9; // setengah ukuran pegangan (px kanvas)
    const handles = (l) => { const x = l.x * CW, y = l.y * CH, w = l.w * CW, hh = l.h * CH; return { nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + hh / 2], se: [x + w, y + hh], s: [x + w / 2, y + hh], sw: [x, y + hh], w: [x, y + hh / 2] }; };
    function draw() {
      if (!wrap.isConnected) return;
      for (let y = 0; y < CH; y += 32) for (let x = 0; x < CW; x += 32) { c.fillStyle = ((x + y) / 32) % 2 ? '#14171d' : '#0e1014'; c.fillRect(x, y, 32, 32); }
      try { KM.engine.drawInputRect(c, inp, 0, 0, CW, CH, 0); } catch (e) {}
      L().forEach((l, i) => {
        const x = l.x * CW, y = l.y * CH, w = l.w * CW, hh = l.h * CH, on = i === sel_;
        const empty = !KM.getInput(l.inputId);
        if (empty || !l.on) { c.fillStyle = 'rgba(20,26,38,' + (l.on ? 0.72 : 0.4) + ')'; c.fillRect(x, y, w, hh); c.fillStyle = 'rgba(255,255,255,.75)'; c.font = '700 ' + Math.max(14, Math.min(hh * 0.16, 34)) + 'px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText((i + 1) + (l.on ? ' • kosong' : ' • mati'), x + w / 2, y + hh / 2, w - 12); }
        c.lineWidth = on ? 3 : 1.5; c.setLineDash(on ? [] : [8, 6]); c.strokeStyle = on ? (mode === 'content' ? '#3ec6ff' : '#ff7a1a') : i === hover ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.38)';
        c.strokeRect(x, y, w, hh); c.setLineDash([]);
        if (!empty && l.on) { c.fillStyle = on ? (mode === 'content' ? '#3ec6ff' : '#ff7a1a') : 'rgba(0,0,0,.6)'; const tag = String(i + 1); c.font = '700 18px sans-serif'; const tw = c.measureText(tag).width + 14; c.fillRect(x, y, tw, 26); c.fillStyle = '#fff'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(tag, x + 7, y + 14); }
      });
      const l = cur();
      if (l && mode === 'box') { c.fillStyle = '#fff'; c.strokeStyle = '#ff7a1a'; c.lineWidth = 3; Object.values(handles(l)).forEach(([x, y]) => { c.fillRect(x - HS, y - HS, HS * 2, HS * 2); c.strokeRect(x - HS, y - HS, HS * 2, HS * 2); }); }
      if (l && mode === 'content') { const x = (l.x + l.w / 2) * CW, y = (l.y + l.h / 2) * CH; c.strokeStyle = '#3ec6ff'; c.lineWidth = 2; c.beginPath(); c.moveTo(x - 18, y); c.lineTo(x + 18, y); c.moveTo(x, y - 18); c.lineTo(x, y + 18); c.stroke(); }
      if (sel_ < 0) { c.strokeStyle = '#3ec6ff'; c.lineWidth = 4; c.setLineDash([14, 8]); c.strokeRect(2, 2, CW - 4, CH - 4); c.setLineDash([]); }
      c.strokeStyle = '#22d3ee'; c.lineWidth = 1.5;
      guides.forEach((g) => { c.beginPath(); if (g.x != null) { c.moveTo(g.x * CW, 0); c.lineTo(g.x * CW, CH); } else { c.moveTo(0, g.y * CH); c.lineTo(CW, g.y * CH); } c.stroke(); });
      requestAnimationFrame(draw);
    }

    // ----- interaksi -----
    const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, k: CW / r.width }; };
    const hitLayer = (p) => { for (let i = L().length - 1; i >= 0; i--) { const l = L()[i]; if (p.x >= l.x && p.x <= l.x + l.w && p.y >= l.y && p.y <= l.y + l.h) return i; } return -1; };
    const hitHandle = (p) => { const l = cur(); if (!l || mode !== 'box') return null; const hs = handles(l), tol = (HS + 5) * p.k / 1; for (const k in hs) { if (Math.abs(p.x * CW - hs[k][0]) <= tol && Math.abs(p.y * CH - hs[k][1]) <= tol) return k; } return null; };
    function snap(l, moveEdges) {
      guides = [];
      if (!snapOn) return;
      const TH = 0.012, xs = [0, 0.5, 1], ys = [0, 0.5, 1];
      L().forEach((o) => { if (o !== l) { xs.push(o.x, o.x + o.w, o.x + o.w / 2); ys.push(o.y, o.y + o.h, o.y + o.h / 2); } });
      const tryAx = (ax, targets, size) => {
        const cand = moveEdges ? moveEdges[ax] : ['a', 'c', 'b'];
        let best = null;
        for (const e of cand) { const pos = e === 'a' ? l[ax] : e === 'b' ? l[ax] + l[size] : l[ax] + l[size] / 2; for (const t of targets) { const d = t - pos; if (Math.abs(d) < TH && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, t, e }; } }
        if (!best) return;
        if (!moveEdges) l[ax] += best.d;
        else if (best.e === 'a') { l[ax] += best.d; l[size] -= best.d; } else if (best.e === 'b') l[size] += best.d;
        guides.push(ax === 'x' ? { x: best.t } : { y: best.t });
      };
      tryAx('x', xs, 'w'); tryAx('y', ys, 'h');
    }
    function select(i, keepMode) { sel_ = i; if (!keepMode && i < 0) mode = 'box'; renderList(); renderProps(); renderBar(); }
    cv.addEventListener('pointerdown', (e) => {
      cv.focus(); const p = pt(e), hd = hitHandle(p);
      if (hd) { const l = cur(); drag = { t: 'resize', hd, p, s: Object.assign({}, l) }; }
      else {
        const i = hitLayer(p);
        if (i >= 0 && !(sel_ === -1 && e.ctrlKey)) { if (i !== sel_) select(i, true); const l = cur(); drag = { t: (mode === 'content' || e.altKey) ? 'pan' : 'move', p, s: Object.assign({}, l) }; if (drag.t === 'pan') adopt(l); }
        else { if (sel_ !== -1) select(-1); drag = { t: 'base', p, s: Object.assign({}, inp.pos) }; }
      }
      cv.setPointerCapture(e.pointerId); e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pt(e);
      if (!drag) { const hd = hitHandle(p); hover = hitLayer(p); cv.style.cursor = hd ? ({ n: 'ns', s: 'ns', e: 'ew', w: 'ew', nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw' }[hd] + '-resize') : hover >= 0 ? (mode === 'content' ? 'grab' : 'move') : 'default'; return; }
      const dx = p.x - drag.p.x, dy = p.y - drag.p.y, l = cur(), s = drag.s;
      if (drag.t === 'move') { l.x = s.x + dx; l.y = s.y + dy; snap(l); }
      else if (drag.t === 'pan') { l.px = clamp(s.px + dx / l.w * 2, -4, 4); l.py = clamp(s.py + dy / l.h * 2, -4, 4); }
      else if (drag.t === 'base') { inp.pos.x = clamp(s.x + dx * 2, -3, 3); inp.pos.y = clamp(s.y + dy * 2, -3, 3); }
      else if (drag.t === 'resize') {
        const hd = drag.hd; let x = s.x, y = s.y, w = s.w, hh = s.h;
        if (hd.includes('e')) w = s.w + dx; if (hd.includes('w')) { x = s.x + dx; w = s.w - dx; }
        if (hd.includes('s')) hh = s.h + dy; if (hd.includes('n')) { y = s.y + dy; hh = s.h - dy; }
        if (e.shiftKey && hd.length === 2) { const r = s.w / s.h; if (Math.abs(dx) > Math.abs(dy)) { const nh = w / r; if (hd.includes('n')) y = s.y + s.h - nh; hh = nh; } else { const nw = hh * r; if (hd.includes('w')) x = s.x + s.w - nw; w = nw; } }
        if (w < 0.02) { if (hd.includes('w')) x = s.x + s.w - 0.02; w = 0.02; } if (hh < 0.02) { if (hd.includes('n')) y = s.y + s.h - 0.02; hh = 0.02; }
        Object.assign(l, { x, y, w, h: hh });
        if (!e.shiftKey) snap(l, { x: hd.includes('w') ? ['a'] : hd.includes('e') ? ['b'] : [], y: hd.includes('n') ? ['a'] : hd.includes('s') ? ['b'] : [] });
      }
      ch(); liveReadout();
    });
    const endDrag = () => { if (!drag) return; drag = null; guides = []; renderProps(); renderList(); };
    cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('dblclick', (e) => { const i = hitLayer(pt(e)); if (i >= 0) { mode = mode === 'box' ? 'content' : 'box'; select(i, true); } });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault(); const f = Math.exp(-e.deltaY * 0.0012), l = cur();
      if (!l) inp.pos.zoom = clamp(inp.pos.zoom * f, 0.05, 8);
      else if (mode === 'content' || e.altKey) { adopt(l); l.zoom = clamp((l.zoom || 1) * f, 0.1, 10); }
      else { const cx = l.x + l.w / 2, cy = l.y + l.h / 2; l.w = clamp(l.w * f, 0.02, 4); l.h = clamp(l.h * f, 0.02, 4); l.x = cx - l.w / 2; l.y = cy - l.h / 2; }
      ch(); liveReadout(); clearTimeout(propT); propT = setTimeout(renderProps, 220);
    }, { passive: false });
    cv.addEventListener('keydown', (e) => {
      const l = cur(), st = e.shiftKey ? 0.02 : 0.004, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) { if (!l) { inp.pos.x += d[0] * st * 2; inp.pos.y += d[1] * st * 2; } else if (mode === 'content') { adopt(l); l.px += d[0] * st * 4; l.py += d[1] * st * 4; } else { l.x += d[0] * st; l.y += d[1] * st; } ch(); e.preventDefault(); e.stopPropagation(); clearTimeout(propT); propT = setTimeout(renderProps, 220); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && l) { removeAt(sel_); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Tab') { mode = mode === 'box' ? 'content' : 'box'; select(sel_, true); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Escape' && sel_ >= 0) { select(-1); e.stopPropagation(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && l) { dup(); e.preventDefault(); e.stopPropagation(); }
    });
    function liveReadout() {
      const l = cur();
      hint.textContent = l ? 'Kotak ' + (sel_ + 1) + ' — X ' + num(l.x * 100, 1) + '%  Y ' + num(l.y * 100, 1) + '%  L ' + num(l.w * 100, 1) + '%  T ' + num(l.h * 100, 1) + '%' + (l.fit ? '  •  isi: zoom ' + Math.round((l.zoom || 1) * 100) + '%, geser ' + num(l.px || 0, 2) + ' / ' + num(l.py || 0, 2) : '')
        : 'Input ini — zoom ' + Math.round(inp.pos.zoom * 100) + '%, geser ' + num(inp.pos.x, 2) + ' / ' + num(inp.pos.y, 2);
    }
    const HINT = () => (sel_ < 0 ? 'Input dasar terpilih: seret = geser, roda mouse = zoom. Klik kotak untuk mengaturnya.'
      : mode === 'box' ? 'Mode KOTAK: seret = pindah • pegangan = ubah ukuran (Shift = jaga rasio) • roda = besar/kecil • panah = geser halus • klik ganda / Tab = atur ISI'
        : 'Mode ISI: seret = geser gambar di dalam kotak • roda = zoom in/out • panah = geser halus • klik ganda / Tab = kembali ke KOTAK');

    // ----- operasi -----
    function add(o) { if (L().length >= 32) return KM.toast('Maksimal 32 kotak', 'warn'); const n = L().length, l = LE.newLayer(Object.assign({ x: 0.06 + (n % 5) * 0.04, y: 0.08 + (n % 5) * 0.05, w: 0.36, h: 0.36 }, isVs ? ST : {}, o || {})); const used = new Set(L().map((a) => a.inputId)); const f = candidates(inp).find((i) => !used.has(i.id)) || (isVs ? null : others().find((i) => !used.has(i.id))); if (f && !l.inputId) l.inputId = f.id; L().push(l); ch(); mode = 'box'; select(L().length - 1, true); }
    function removeAt(i) { L().splice(i, 1); ch(); select(Math.min(i, L().length - 1)); }
    function dup() { const l = cur(); if (!l) return; const c2 = KM.deepClone(l); c2.x += 0.03; c2.y += 0.04; L().splice(sel_ + 1, 0, c2); ch(); select(sel_ + 1, true); }
    function order(d) { const i = sel_, j = i + d; if (i < 0 || j < 0 || j >= L().length) return; const a = L(); [a[i], a[j]] = [a[j], a[i]]; ch(); select(j, true); }
    function arrange(cols) { const n = L().length; if (!n) return; const g = grid(cols || Math.ceil(Math.sqrt(n)), n); L().forEach((l, i) => { l.x = g[i].x; l.y = g[i].y; l.w = g[i].w; l.h = g[i].h; }); ch(); renderProps(); }
    function setAspect(r) { const l = cur(); if (!l) return; const cx = l.x + l.w / 2, cy = l.y + l.h / 2; let hh = l.w * AR() / r; if (hh > 1.2) { hh = Math.min(l.h, 1); l.w = hh * r / AR(); } l.h = hh; l.x = cx - l.w / 2; l.y = cy - l.h / 2; ch(); renderProps(); }
    function align(k) { const l = cur(); if (!l) return; if (k === 'l') l.x = 0; if (k === 'c') l.x = (1 - l.w) / 2; if (k === 'r') l.x = 1 - l.w; if (k === 't') l.y = 0; if (k === 'm') l.y = (1 - l.h) / 2; if (k === 'b') l.y = 1 - l.h; if (k === 'f') Object.assign(l, { x: 0, y: 0, w: 1, h: 1 }); ch(); renderProps(); }

    // ----- bilah alat -----
    function renderBar() {
      const tplSel = sel([['', 'Terapkan template…']].concat(VS.all().map((t) => [t.id, (t.builtin ? '' : '★ ') + t.name])), '', (v) => { const t = VS.all().find((x) => x.id === v); if (t) { VS.applyTo(inp, t, false); select(L().length ? 0 : -1); } }, { title: 'Ganti susunan kotak memakai template (sumber tiap kotak dipertahankan)' });
      bar.replaceChildren(
        h('button.btn.pri', { onclick: () => add(), title: 'Tambah kotak baru untuk satu input/kamera' }, KI.el('plus'), 'Kotak'),
        h('div.seg', h('button.btn' + (mode === 'box' ? '.on' : ''), { disabled: sel_ < 0, onclick: () => { mode = 'box'; select(sel_, true); }, title: 'Pindah & ubah ukuran kotak' }, KI.el('move'), 'Kotak'),
          h('button.btn' + (mode === 'content' ? '.on' : ''), { disabled: sel_ < 0, onclick: () => { mode = 'content'; select(sel_, true); }, title: 'Geser / zoom / pangkas gambar di dalam kotak' }, KI.el('crop'), 'Isi')),
        h('button.btn' + (sel_ < 0 ? '.on' : ''), { onclick: () => select(-1), title: 'Atur input ini sendiri (geser, zoom, pangkas)' }, KI.el('image'), 'Input dasar'),
        h('span.grow'),
        sel([['', 'Susun rapi…'], ['0', 'Otomatis'], ['1', '1 kolom'], ['2', '2 kolom'], ['3', '3 kolom'], ['4', '4 kolom'], ['5', '5 kolom']], '', (v) => { if (v !== '') arrange(+v); renderBar(); }, { title: 'Susun semua kotak menjadi grid rapi' }),
        tplSel,
        h('button.btn' + (snapOn ? '.on' : ''), { onclick: () => { snapOn = !snapOn; renderBar(); }, title: 'Magnet: menempel ke tepi layar, tengah, dan kotak lain' }, KI.el('target'), 'Magnet'),
        h('button.btn', { onclick: async () => { const name = await KM.ui.prompt('Nama template', (inp.title || 'Tata letak') + ' — ' + L().length + ' kotak'); if (!name) return; VS.saveFrom(inp, name); KM.toast('Template tersimpan — tersedia di Tambah Input → Virtual Set → Milik saya', 'ok', 5000); renderBar(); }, title: 'Simpan susunan ini (kotak, gaya, latar) sebagai template sendiri' }, KI.el('save'), 'Simpan template'));
      hint.textContent = HINT();
    }
    // ----- daftar kotak -----
    function renderList() {
      list.replaceChildren(
        h('div.lhead', h('b', 'Kotak (' + L().length + ')'), h('span.grow'), isVs ? h('button.btn.sm', { onclick: () => { VS.autoFill(inp); renderList(); renderProps(); }, title: 'Isi kotak kosong dengan kamera/sumber yang belum dipakai' }, KI.el('wand'), 'Isi otomatis') : null),
        h('button.litem' + (sel_ < 0 ? '.on' : ''), { onclick: () => select(-1) }, h('i.ln', '◼'), h('span.ell', 'Input dasar: ' + inp.title)),
        ...L().map((l, i) => h('button.litem' + (i === sel_ ? '.on' : '') + (l.on ? '' : '.off'), { onclick: () => select(i, true) },
          h('i.ln', String(i + 1)), h('span.ell', nameOf(l) + (l.label ? ' — “' + l.label + '”' : '')),
          h('span.lbtn', { title: l.on ? 'Sembunyikan' : 'Tampilkan', onclick: (e) => { e.stopPropagation(); l.on = !l.on; ch(); renderList(); } }, KI.el(l.on ? 'eye' : 'ban')))));
    }
    // ----- properti -----
    function renderProps() {
      const l = cur();
      if (!l) {
        const p = inp.pos, isBg = isVs;
        props.replaceChildren(
          h('div.psec', h('h5', 'Input dasar — ' + inp.title), h('p.muted', isBg ? 'Latar Virtual Set. Kotak kamera ditaruh di atasnya.' : 'Gambar input ini sendiri. Kotak (layer) ditaruh di atasnya.'),
            h('div.kv3', ...slider('Zoom', 0.05, 5, 0.01, () => p.zoom, (v) => { p.zoom = v; ch(); }, pct), ...slider('Geser X', -2, 2, 0.005, () => p.x, (v) => { p.x = v; ch(); }), ...slider('Geser Y', -2, 2, 0.005, () => p.y, (v) => { p.y = v; ch(); }),
              ...slider('Putar', -180, 180, 1, () => p.rot || 0, (v) => { p.rot = v; ch(); }, (v) => v + '°')),
            h('div.lrow', h('label', 'Mode isi'), sel([['fit', 'Pas (utuh)'], ['fill', 'Penuh (terpotong)'], ['stretch', 'Tarik']], p.fit, (v) => { p.fit = v; ch(); }),
              h('button.btn.sm', { onclick: () => { Object.assign(p, { x: 0, y: 0, zoom: 1, rot: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0 }); ch(); renderProps(); } }, KI.el('refresh'), 'Reset'))),
          h('div.psec', h('h5', 'Pangkas (crop)'), h('div.kv3', ...slider('Kiri', 0, 0.9, 0.005, () => p.cropL, (v) => { p.cropL = v; ch(); }, pct), ...slider('Kanan', 0, 0.9, 0.005, () => p.cropR, (v) => { p.cropR = v; ch(); }, pct),
            ...slider('Atas', 0, 0.9, 0.005, () => p.cropT, (v) => { p.cropT = v; ch(); }, pct), ...slider('Bawah', 0, 0.9, 0.005, () => p.cropB, (v) => { p.cropB = v; ch(); }, pct))),
          isVs ? h('div.psec', h('h5', 'Latar Virtual Set'), VS.bgControls(inp.opts, () => KM.virtualSets.apply(inp))) : null);
        return;
      }
      const nIn = (k, t) => h('input', { type: 'number', step: 0.5, value: num(l[k] * 100, 1), title: t, onchange: (e) => { l[k] = (+e.target.value || 0) / 100; if (k === 'w' || k === 'h') l[k] = Math.max(0.02, l[k]); ch(); } });
      const framing = !!l.fit;
      props.replaceChildren(
        h('div.psec', h('h5', 'Kotak ' + (sel_ + 1)),
          h('div.lrow', h('label', 'Sumber'), sel([['', '— kosong —']].concat(others().map((o) => [o.id, KM.inputNum(o) + '. ' + o.title])), l.inputId, (v) => { l.inputId = v; ch(); renderList(); }, { class: 'grow' })),
          h('div.lrow', h('label', 'Label'), h('input.grow', { value: l.label || '', placeholder: 'Nama di pojok kotak (opsional)', oninput: (e) => { l.label = e.target.value; ch(); } })),
          h('div.lrow.tools', h('button.btn.sm', { onclick: () => order(1), title: 'Naik ke depan' }, KI.el('arrow-up')), h('button.btn.sm', { onclick: () => order(-1), title: 'Turun ke belakang' }, KI.el('arrow-down')),
            h('button.btn.sm', { onclick: dup, title: 'Gandakan (Ctrl+D)' }, KI.el('copy'), 'Gandakan'), h('span.grow'), h('button.btn.sm.red', { onclick: () => removeAt(sel_), title: 'Hapus kotak (Delete)' }, KI.el('trash'), 'Hapus'))),
        h('div.psec', h('h5', 'Ukuran & posisi kotak (%)'),
          h('div.xywh', h('label', 'X'), nIn('x', 'Kiri'), h('label', 'Y'), nIn('y', 'Atas'), h('label', 'L'), nIn('w', 'Lebar'), h('label', 'T'), nIn('h', 'Tinggi')),
          h('div.lrow.tools', h('span.muted', 'Rasio'), ...[['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['9:16', 9 / 16]].map(([t, r]) => h('button.btn.sm', { onclick: () => setAspect(r) }, t))),
          h('div.lrow.tools', h('span.muted', 'Rata'), ...[['l', '⇤', 'Kiri'], ['c', '↔', 'Tengah'], ['r', '⇥', 'Kanan'], ['t', '⤒', 'Atas'], ['m', '↕', 'Tengah vertikal'], ['b', '⤓', 'Bawah']].map(([k, t, tt]) => h('button.btn.sm', { title: tt, onclick: () => align(k) }, t)), h('button.btn.sm', { onclick: () => align('f') }, 'Penuh'))),
        h('div.psec', h('h5', 'Isi kotak (zoom, geser, pangkas)'),
          h('div.lrow', h('label', 'Mode isi'), sel([['fill', 'Penuh (isi kotak, terpotong)'], ['fit', 'Pas (utuh)'], ['stretch', 'Tarik'], ['', 'Ikut posisi input sumber']], l.fit || '', (v) => { if (v) { adopt(l); l.fit = v; } else delete l.fit; ch(); renderProps(); }, { class: 'grow' })),
          framing ? h('div.kv3', ...slider('Zoom', 0.2, 6, 0.01, () => l.zoom || 1, (v) => { l.zoom = v; ch(); }, pct), ...slider('Geser X', -3, 3, 0.005, () => l.px || 0, (v) => { l.px = v; ch(); }), ...slider('Geser Y', -3, 3, 0.005, () => l.py || 0, (v) => { l.py = v; ch(); }),
            ...slider('Pangkas kiri', 0, 0.9, 0.005, () => l.cropL || 0, (v) => { l.cropL = v; ch(); }, pct), ...slider('Pangkas kanan', 0, 0.9, 0.005, () => l.cropR || 0, (v) => { l.cropR = v; ch(); }, pct),
            ...slider('Pangkas atas', 0, 0.9, 0.005, () => l.cropT || 0, (v) => { l.cropT = v; ch(); }, pct), ...slider('Pangkas bawah', 0, 0.9, 0.005, () => l.cropB || 0, (v) => { l.cropB = v; ch(); }, pct),
            ...slider('Putar', -180, 180, 1, () => l.rot || 0, (v) => { l.rot = v; ch(); }, (v) => v + '°')) : h('p.muted', 'Kotak ini mengikuti Posisi & Crop milik input sumbernya. Pilih mode lain untuk mengatur isi khusus di kotak ini.'),
          framing ? h('div.lrow.tools', h('label.chk', h('input', { type: 'checkbox', checked: !!l.flip, onchange: (e) => { l.flip = e.target.checked; ch(); } }), 'Cermin (balik kiri-kanan)'), h('span.grow'),
            h('button.btn.sm', { onclick: () => { Object.assign(l, { zoom: 1, px: 0, py: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0, rot: 0, flip: false }); ch(); renderProps(); } }, KI.el('refresh'), 'Reset isi')) : null),
        h('div.psec', h('h5', 'Gaya kotak'),
          h('div.kv3', ...slider('Bingkai', 0, 30, 1, () => l.bw || 0, (v) => { l.bw = v; ch(); }, (v) => v + ' px'), ...slider('Sudut bulat', 0, 1, 0.01, () => l.rad || 0, (v) => { l.rad = v; ch(); }, pct),
            ...slider('Bayangan', 0, 2, 0.05, () => l.sh || 0, (v) => { l.sh = v; ch(); }, pct), ...slider('Transparansi', 0.05, 1, 0.01, () => (l.op == null ? 1 : l.op), (v) => { l.op = v; ch(); }, pct)),
          h('div.lrow', h('label', 'Warna bingkai'), h('input', { type: 'color', value: l.bc || '#ffffff', oninput: (e) => { l.bc = e.target.value; ch(); } }),
            h('label.chk', h('input', { type: 'checkbox', checked: !!l.bg, onchange: (e) => { l.bg = e.target.checked ? '#000000' : ''; ch(); renderProps(); } }), 'Warna dasar'),
            l.bg ? h('input', { type: 'color', value: l.bg, oninput: (e) => { l.bg = e.target.value; ch(); } }) : null),
          h('div.lrow.tools', h('button.btn.sm', { title: 'Salin gaya kotak ini ke semua kotak', onclick: () => { L().forEach((o) => { if (o !== l) Object.assign(o, { bw: l.bw, bc: l.bc, rad: l.rad, sh: l.sh, op: l.op }); }); ch(); KM.toast('Gaya diterapkan ke semua kotak', 'ok'); } }, KI.el('copy'), 'Samakan gaya semua kotak'))));
    }
    renderBar(); renderList(); renderProps();
    requestAnimationFrame(draw);
    return wrap;
  };

  // ---------------- galeri template (dialog Tambah Input → Virtual Set) ----------------
  VS.gallery = function (form) {
    let pickId = 'duo-sejajar', filter = 'all', fill = true;
    const bg = { bgKind: '', bg: 'aurora', colour: '#101820', bgUrl: '', bgPath: '', bgLoop: true, caption: '' }; // bgKind '' = ikut template
    const cards = h('div.vsgrid'), chips = h('div.vschips'), bgBox = h('div');
    const match = (t) => (filter === 'all' ? true : filter === 'mine' ? !t.builtin : filter === '5' ? t.n >= 5 && t.builtin : t.n === +filter && t.builtin);
    const draw = () => {
      const nMine = VS.custom().length;
      chips.replaceChildren(...[['all', 'Semua'], ['1', '1'], ['2', '2 kamera'], ['3', '3 kamera'], ['4', '4 kamera'], ['5', '5+ kamera'], ['mine', '★ Milik saya (' + nMine + ')']].map(([k, t]) => h('button.btn.sm' + (filter === k ? '.on' : ''), { onclick: () => { filter = k; draw(); } }, t)),
        h('span.grow'),
        h('button.btn.sm', { title: 'Impor template (.json)', onclick: async () => { const f = (await KM.pickFiles('.json,application/json'))[0]; if (!f) return; try { const j = JSON.parse(await (await fetch(f.url)).text()); const arr = (Array.isArray(j) ? j : [j]).filter((t) => t && t.name && Array.isArray(t.slots)); if (!arr.length) throw 0; arr.forEach((t) => { t.id = 'u' + KM.uid(); delete t.builtin; VS.custom().unshift(t); }); KM.saveSettings(); filter = 'mine'; draw(); KM.toast(arr.length + ' template diimpor', 'ok'); } catch (e) { KM.toast('File template tidak valid', 'err'); } } }, KI.el('upload'), 'Impor'),
        nMine ? h('button.btn.sm', { title: 'Ekspor semua template milik saya', onclick: () => KM.downloadBlob(new Blob([JSON.stringify(VS.custom(), null, 1)], { type: 'application/json' }), 'template-virtual-set.json') }, KI.el('download'), 'Ekspor') : null);
      const list = VS.all().filter(match);
      cards.replaceChildren(...(list.length ? list.map((t) => h('button.vscard' + (t.id === pickId ? '.on' : ''), { onclick: () => { pickId = t.id; draw(); } }, VS.thumb(t, 240), h('span', (t.builtin ? '' : '★ ') + t.name),
        t.builtin ? null : h('i.del', { title: 'Hapus template ini', onclick: async (e) => { e.stopPropagation(); if (!(await KM.ui.confirm('Hapus template "' + t.name + '"?', 'Hapus'))) return; KM.settings.vsets = VS.custom().filter((x) => x.id !== t.id); KM.saveSettings(); draw(); } }, KI.el('trash')))) : [h('p.muted', filter === 'mine' ? 'Belum ada template sendiri. Buat Virtual Set, susun di tab Tata letak, lalu klik "Simpan template".' : 'Tidak ada template.')]));
    };
    const drawBg = () => bgBox.replaceChildren(
      h('div.lrow', h('label', 'Latar'), h('select', { onchange: (e) => { bg.bgKind = e.target.value; drawBg(); } }, [['', 'Ikut template'], ['style', 'Gaya bawaan'], ['colour', 'Warna polos'], ['image', 'Gambar sendiri'], ['video', 'Video sendiri (loop)'], ['none', 'Transparan']].map(([v, t]) => h('option', { value: v, selected: bg.bgKind === v }, t)))),
      bg.bgKind ? VS.bgControls(bg, () => {}) : null);
    draw(); drawBg();
    form.append(h('div.sec', h('h4', '🏛️ Virtual Set — pilih tata letak'),
      h('p.muted', 'Latar + kotak kamera sebanyak yang diinginkan. Setelah dibuat, semuanya bisa diubah bebas: tambah/hapus kotak, seret, ubah ukuran, zoom/geser/pangkas isi tiap kotak, ganti latar (gambar atau video loop), lalu simpan sebagai template sendiri.'),
      chips, cards),
      h('div.sec', h('h4', 'Latar & isi'), bgBox,
        h('label.chk', { style: { marginTop: '8px' } }, h('input', { type: 'checkbox', checked: fill, onchange: (e) => { fill = e.target.checked; } }), 'Isi kotak otomatis dengan kamera / sumber video yang sudah ada (urut nomor input)')));
    return () => {
      const t = VS.all().find((x) => x.id === pickId) || VS.builtin[0];
      const o = {}; if (bg.bgKind) { for (const k in bg) o[k] = bg[k]; }
      const inp = VS.create(t, { bg: bg.bgKind ? o : null, fill });
      setTimeout(() => KM.dialogs.inputSettings(inp, 'layer'), 150);
    };
  };
})(window.KM);
