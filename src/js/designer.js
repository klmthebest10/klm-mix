/* KLM Mix - Title Designer (pengganti GT Designer): rancang title bebas — teks, kotak, lingkaran, gambar, garis,
   animasi per elemen, field bernama (bisa diganti via HP/API SetText), pustaka template sendiri. */
'use strict';
(function (KM) {
  const h = KM.h;
  const DS = KM.designer = {};
  const LIB_KEY = 'klmmix.designs';

  DS.library = () => { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch (e) { return []; } };
  DS.saveLibrary = (l) => { try { localStorage.setItem(LIB_KEY, JSON.stringify(l)); } catch (e) { KM.toast('Penyimpanan penuh (gambar terlalu besar?)', 'err'); } };

  DS.starter = () => ({
    elements: [
      { id: KM.uid(), type: 'rect', x: 100, y: 800, w: 900, h: 110, fill: '#0f7a4a', fill2: '#16a067', radius: 10, anim: 'wipe', delay: 0, shadow: true },
      { id: KM.uid(), type: 'rect', x: 100, y: 800, w: 14, h: 110, fill: '#d4af37', anim: 'fade', delay: 0 },
      { id: KM.uid(), type: 'text', name: 'Nama', text: 'Nama Narasumber', x: 140, y: 805, w: 840, h: 100, size: 60, weight: '800', color: '#ffffff', align: 'left', anim: 'fade', delay: 0.3 },
      { id: KM.uid(), type: 'rect', x: 114, y: 910, w: 640, h: 58, fill: '#062b1c', opacity: 0.92, anim: 'slide-left', delay: 0.2 },
      { id: KM.uid(), type: 'text', name: 'Jabatan', text: 'Keterangan / jabatan', x: 140, y: 910, w: 600, h: 58, size: 32, weight: '500', color: '#d9f5e6', align: 'left', anim: 'fade', delay: 0.45 }
    ]
  });

  const NEW = {
    text: () => ({ type: 'text', name: 'Teks' + Math.floor(Math.random() * 90 + 10), text: 'Teks baru', x: 660, y: 480, w: 600, h: 120, size: 64, weight: '700', color: '#ffffff', align: 'center', anim: 'fade', delay: 0, textShadow: true }),
    rect: () => ({ type: 'rect', x: 610, y: 440, w: 700, h: 200, fill: '#1d4ed8', radius: 12, anim: 'fade', delay: 0, opacity: 0.9 }),
    ellipse: () => ({ type: 'ellipse', x: 860, y: 440, w: 200, h: 200, fill: '#f59e0b', anim: 'zoom', delay: 0 }),
    line: () => ({ type: 'line', x: 560, y: 600, w: 800, h: 6, fill: '#d4af37', anim: 'wipe', delay: 0 }),
    image: () => ({ type: 'image', x: 1600, y: 60, w: 260, h: 140, src: '', anim: 'fade', delay: 0 })
  };
  const LABEL = { text: '🔤 Teks', rect: '▭ Kotak', ellipse: '◯ Lingkaran', line: '― Garis', image: '🖼 Gambar' };

  /** buka editor untuk input title (membuat input baru jika tidak ada) */
  DS.open = function (inp) {
    if (!inp) inp = KM.inputs.create('title', { title: 'Title: Desain', opts: { template: 'custom', design: DS.starter() } });
    if (inp.opts.template !== 'custom') { inp.opts.template = 'custom'; inp.opts.design = inp.opts.design || DS.starter(); }
    const d = inp.opts.design;
    const { sel, chk, row } = KM.dialogs.helpers;
    let selId = d.elements[0] ? d.elements[0].id : null;
    const cv = h('canvas', { width: 960, height: 540, style: { width: '100%', display: 'block', background: 'repeating-conic-gradient(#3a3f4b 0 25%, #2b2f38 0 50%) 0 0/24px 24px', borderRadius: '6px', cursor: 'move', touchAction: 'none' } });
    const cx = cv.getContext('2d');
    const props = h('div'), layers = h('div.list');
    const changed = () => { inp.rt.srcFrame = -1; KM.changed('title'); };
    const cur = () => d.elements.find((e) => e.id === selId);

    // ---- render kanvas editor ----
    let raf;
    const tmp = { opts: inp.opts, rt: { anim: { phase: 'shown' }, imgs: inp.rt.imgs || (inp.rt.imgs = {}) } };
    const draw = () => {
      cx.clearRect(0, 0, 960, 540);
      cx.save(); cx.scale(0.5, 0.5);
      try { KM.titles.TPL.custom.draw(cx, 1920, 1080, KM.titles.fields(inp), KM.titles.THEMES.emas, 1, KM.now(), 1, tmp); } catch (e) {}
      cx.restore();
      const e = cur();
      if (e) {
        cx.strokeStyle = '#3b82f6'; cx.lineWidth = 2; cx.setLineDash([6, 4]); cx.strokeRect(e.x / 2, e.y / 2, e.w / 2, e.h / 2); cx.setLineDash([]);
        cx.fillStyle = '#3b82f6'; cx.fillRect(e.x / 2 + e.w / 2 - 6, e.y / 2 + e.h / 2 - 6, 12, 12);
      }
      // garis bantu safe area
      cx.strokeStyle = '#ffffff22'; cx.strokeRect(48, 27, 864, 486);
      raf = requestAnimationFrame(draw);
    };
    draw();

    // ---- drag / resize ----
    let drag = null;
    const pt = (ev) => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * 1920, y: (ev.clientY - r.top) / r.height * 1080 }; };
    cv.addEventListener('pointerdown', (ev) => {
      const p = pt(ev), e = cur();
      if (e && Math.abs(p.x - (e.x + e.w)) < 24 && Math.abs(p.y - (e.y + e.h)) < 24) drag = { mode: 'resize', e, p0: p, o: { w: e.w, h: e.h } };
      else {
        const hit = d.elements.slice().reverse().find((x) => !x.hidden && !x.locked && p.x >= x.x && p.x <= x.x + x.w && p.y >= x.y && p.y <= x.y + x.h);
        if (hit) { selId = hit.id; drag = { mode: 'move', e: hit, p0: p, o: { x: hit.x, y: hit.y } }; renderSide(); }
      }
      if (drag) cv.setPointerCapture(ev.pointerId);
    });
    cv.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      const p = pt(ev), snap = (v) => (ev.altKey ? v : Math.round(v / 10) * 10);
      if (drag.mode === 'move') { drag.e.x = snap(drag.o.x + p.x - drag.p0.x); drag.e.y = snap(drag.o.y + p.y - drag.p0.y); }
      else { drag.e.w = Math.max(10, snap(drag.o.w + p.x - drag.p0.x)); drag.e.h = Math.max(4, snap(drag.o.h + p.y - drag.p0.y)); }
      changed();
    });
    cv.addEventListener('pointerup', () => { if (drag) { drag = null; renderProps(); } });

    // ---- panel ----
    function renderLayers() {
      layers.replaceChildren(...d.elements.slice().reverse().map((e) => h('div.li' + (e.id === selId ? '.on' : ''), { style: { cursor: 'pointer' }, onclick: () => { selId = e.id; renderSide(); } },
        h('span', LABEL[e.type].split(' ')[0]), h('span.grow', e.type === 'text' ? (e.name ? '[' + e.name + '] ' : '') + (e.text || '').slice(0, 24) : LABEL[e.type].split(' ').slice(1).join(' ')),
        h('button.cb', { title: 'Tampil/sembunyi', onclick: (x) => { x.stopPropagation(); e.hidden = !e.hidden; changed(); renderLayers(); } }, e.hidden ? '🚫' : '👁'))));
    }
    function num(label, k, min, max, step) {
      const e = cur();
      return [h('label', label), h('input', { type: 'number', value: e[k] == null ? '' : e[k], min, max, step: step || 1, oninput: (x) => { e[k] = x.target.value === '' ? null : +x.target.value; changed(); } }), h('span')];
    }
    function renderProps() {
      const e = cur();
      if (!e) { props.replaceChildren(h('p.muted', 'Pilih elemen di kanvas atau daftar layer.')); return; }
      const col = (label, k) => [h('label', label), h('input', { type: 'color', value: e[k] || '#ffffff', oninput: (x) => { e[k] = x.target.value; changed(); } }), h('button.cb', { title: 'Kosongkan', onclick: () => { e[k] = ''; changed(); } }, '∅')];
      const els = [];
      if (e.type === 'text') {
        const ta = h('textarea', { rows: 2, value: e.text || '', style: { width: '100%' }, oninput: (x) => { e.text = x.target.value; if (e.name) inp.opts.fields[e.name] = x.target.value; changed(); renderLayers(); } });
        els.push(h('div', { style: { gridColumn: '1/-1' } }, ta),
          h('label', 'Nama field'), h('input', { value: e.name || '', placeholder: '(opsional) mis. Nama', oninput: (x) => { e.name = x.target.value.trim(); changed(); } }), h('span'),
          h('label', 'Font'), sel([['sans', 'Sans (Segoe)'], ['serif', 'Serif (Georgia)'], ['script', 'Script (indah)'], ['arab', 'Arab'], ['mono', 'Monospace']], e.font || 'sans', (v) => { e.font = v; changed(); }), h('span'),
          ...num('Ukuran', 'size', 8, 400),
          h('label', 'Tebal'), sel([['300', 'Tipis'], ['500', 'Normal'], ['700', 'Tebal'], ['900', 'Sangat tebal']], e.weight || '700', (v) => { e.weight = v; changed(); }), h('span'),
          h('label', 'Rata'), sel([['left', 'Kiri'], ['center', 'Tengah'], ['right', 'Kanan']], e.align || 'left', (v) => { e.align = v; changed(); }), h('span'),
          ...col('Warna teks', 'color'), ...col('Latar teks', 'bg'), ...num('Padding', 'pad', 0, 200),
          ...num('Garis tepi', 'outline', 0, 30), ...col('Warna tepi', 'outlineColor'),
          h('label', 'Gaya'), h('div.row', chk('Miring', e.italic, (v) => { e.italic = v; changed(); }), chk('Bayangan', e.textShadow, (v) => { e.textShadow = v; changed(); }), chk('Pas otomatis', e.fit !== false, (v) => { e.fit = v; changed(); })), h('span'));
      } else if (e.type === 'image') {
        els.push(h('label', 'Gambar'), h('button.btn.sm', { onclick: async () => { const [f] = await KM.pickFiles('image/*'); if (!f) return; const rd = new FileReader(); rd.onload = () => { e.src = rd.result; changed(); }; rd.readAsDataURL(f.file); } }, 'Pilih gambar…'), h('span'));
      } else {
        els.push(...col('Warna', 'fill'));
        if (e.type !== 'line') els.push(...col('Gradien ke', 'fill2'), ...num('Sudut bulat', 'radius', 0, 500), ...col('Garis tepi', 'stroke'), ...num('Tebal tepi', 'strokeW', 0, 40));
      }
      els.push(...num('X', 'x', -2000, 4000), ...num('Y', 'y', -2000, 4000), ...num('Lebar', 'w', 1, 4000), ...num('Tinggi', 'h', 1, 4000), ...num('Rotasi °', 'rot', -180, 180),
        h('label', 'Transparansi'), h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: e.opacity == null ? 1 : e.opacity, oninput: (x) => { e.opacity = +x.target.value; changed(); } }), h('span'),
        h('label', 'Animasi'), sel([['fade', 'Fade'], ['slide-left', 'Geser dari kiri'], ['slide-right', 'Geser dari kanan'], ['slide-up', 'Naik dari bawah'], ['slide-down', 'Turun dari atas'], ['zoom', 'Zoom'], ['wipe', 'Wipe'], ['none', 'Tanpa animasi']], e.anim || 'fade', (v) => { e.anim = v; changed(); }), h('span'),
        h('label', 'Jeda animasi'), h('input', { type: 'range', min: 0, max: 0.8, step: 0.05, value: e.delay || 0, oninput: (x) => { e.delay = +x.target.value; changed(); } }), h('span'),
        h('label', 'Bayangan kotak'), chk('', e.shadow, (v) => { e.shadow = v; changed(); }), h('span'));
      props.replaceChildren(h('div.kv', { style: { gridTemplateColumns: '96px 1fr 30px' } }, ...els),
        h('div.row', { style: { marginTop: '8px' } },
          h('button.btn.sm', { onclick: () => move(1) }, '⬆ Depan'), h('button.btn.sm', { onclick: () => move(-1) }, '⬇ Belakang'),
          h('button.btn.sm', { onclick: () => { const c = Object.assign(KM.deepClone(e), { id: KM.uid(), x: e.x + 30, y: e.y + 30 }); if (c.name) c.name += '2'; d.elements.push(c); selId = c.id; changed(); renderSide(); } }, '⧉ Duplikat'),
          h('button.btn.sm.red', { onclick: () => { d.elements = d.elements.filter((x) => x !== e); inp.opts.design = d; selId = d.elements[0] && d.elements[0].id; changed(); renderSide(); } }, '🗑 Hapus')));
    }
    function move(dir) { const i = d.elements.indexOf(cur()), j = i + dir; if (j < 0 || j >= d.elements.length) return; [d.elements[i], d.elements[j]] = [d.elements[j], d.elements[i]]; changed(); renderLayers(); }
    function renderSide() { renderLayers(); renderProps(); }

    const addBar = h('div.row', Object.keys(NEW).map((t) => h('button.btn.sm', { onclick: () => { const e = Object.assign({ id: KM.uid() }, NEW[t]()); d.elements.push(e); selId = e.id; changed(); renderSide(); } }, '＋ ' + LABEL[t])));
    const libSel = () => sel([['', '📚 Muat dari pustaka…']].concat(DS.library().map((x, i) => [i, x.name])), '', (v) => {
      if (v === '') return; const it = DS.library()[+v]; if (!it) return;
      inp.opts.design = KM.deepClone(it.design); d.elements = inp.opts.design.elements; selId = d.elements[0] && d.elements[0].id; changed(); renderSide();
    });
    const m = KM.ui.modal('🎨 Title Designer — ' + inp.title, h('div',
      h('div.row', { style: { marginBottom: '8px' } }, addBar),
      h('div.split', { style: { gridTemplateColumns: '1fr 360px' } },
        h('div', cv, h('p.muted', 'Seret untuk memindah • seret kotak biru di pojok untuk ubah ukuran • Alt = tanpa snap • garis tipis = area aman. Teks dengan "Nama field" bisa diganti dari HP / tab Title / API SetText.'),
          h('div.sec', h('h4', 'Layer'), layers)),
        h('div', h('div.sec', h('h4', 'Properti'), props)))),
      [
        { label: '💾 Simpan ke pustaka', fn: async () => { const n = await KM.ui.prompt('Nama template', inp.title.replace(/^Title: /, '')); if (!n) return false; const l = DS.library().filter((x) => x.name !== n); l.push({ name: n, design: KM.deepClone(inp.opts.design) }); DS.saveLibrary(l); KM.toast('Template "' + n + '" disimpan', 'ok'); return false; } },
        { label: 'Selesai', cls: 'pri' }
      ], 'wide');
    m.foot.prepend(libSel());
    m.onclose = () => { cancelAnimationFrame(raf); KM.changed('inputs'); };
    renderSide();
    return inp;
  };

  /** buat input title dari template pustaka */
  DS.createFromLibrary = function (i) {
    const it = DS.library()[i]; if (!it) return null;
    return KM.inputs.create('title', { title: 'Title: ' + it.name, opts: { template: 'custom', design: KM.deepClone(it.design) } });
  };

  /** impor CSV / TSV → antrian data title */
  DS.importCsv = async function (inp) {
    const [f] = await KM.pickFiles('.csv,.tsv,.txt'); if (!f) return;
    const txt = await f.file.text();
    const sep = txt.includes('\t') ? '\t' : (txt.split(';').length > txt.split(',').length ? ';' : ',');
    const rows = txt.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < l.length; i++) { const c = l[i]; if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === sep && !q) { out.push(cur.trim()); cur = ''; } else cur += c; }
      out.push(cur.trim()); return out;
    });
    const defs = KM.titles.defs(inp).map((x) => x.k.toLowerCase());
    if (rows.length > 1 && rows[0].some((c) => defs.includes(c.toLowerCase()))) {
      const head = rows.shift().map((c) => c.toLowerCase());
      inp.opts.list = rows.map((r) => defs.map((k) => r[head.indexOf(k)] || ''));
    } else inp.opts.list = rows;
    inp.opts.listIdx = 0; KM.titles.applyList(inp, 0);
    KM.toast(inp.opts.list.length + ' baris data diimpor', 'ok');
    KM.changed('inputs');
  };
})(window.KM);
