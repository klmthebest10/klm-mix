/* KLM Mix - UI utama: kartu input, panel transisi, T-bar, bottom bar, status, shortcut, menu konteks, proyek */
'use strict';
(function (KM) {
  const h = KM.h, $ = KM.$, $$ = KM.$$, S = KM.state;
  const UI = KM.ui = {};
  // thumbnail yang tidak terlihat (daftar input digulir / workspace UTC terbuka) tidak digambar ulang → hemat GPU saat banyak input
  const thumbIO = window.IntersectionObserver ? new IntersectionObserver((es) => es.forEach((e) => { e.target._vis = e.isIntersecting; }), { rootMargin: '60px' }) : null;

  // ---------- modal ----------
  UI.modal = function (title, body, buttons, cls) {
    const bg = h('div.modal-bg');
    const close = () => { bg.remove(); document.removeEventListener('keydown', esc); m.onclose && m.onclose(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const foot = h('div.mf');
    const m = { close, el: null, foot };
    (buttons || [{ label: 'Tutup', cls: 'pri' }]).forEach((b) => foot.appendChild(h('button.btn' + (b.cls ? '.' + b.cls : ''), { onclick: async () => { if (b.fn) { const r = await b.fn(); if (r === false) return; } close(); } }, b.label)));
    const box = h('div.modal' + (cls ? '.' + cls : ''), h('div.mh', title, h('button.x', { onclick: close, title: 'Tutup (Esc)' }, KI.el('x'))), h('div.mb', body), foot);
    m.el = box;
    bg.appendChild(box);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    document.addEventListener('keydown', esc);
    $('#modal-root').appendChild(bg);
    return m;
  };
  UI.confirm = (msg, okLabel) => new Promise((res) => {
    let done = false;
    const m = UI.modal('Konfirmasi', h('div', { style: { fontSize: '14px' } }, msg), [
      { label: 'Batal', fn: () => { done = true; res(false); } },
      { label: okLabel || 'Ya', cls: 'pri', fn: () => { done = true; res(true); } }
    ], 'sm');
    m.onclose = () => { if (!done) res(false); };
  });
  UI.prompt = (msg, val) => new Promise((res) => {
    const inp = h('input', { value: val || '', style: { width: '100%' } });
    let done = false;
    const m = UI.modal(msg, inp, [{ label: 'Batal', fn: () => { done = true; res(null); } }, { label: 'OK', cls: 'pri', fn: () => { done = true; res(inp.value); } }], 'sm');
    m.onclose = () => { if (!done) res(null); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; res(inp.value); m.close(); } });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  });

  // ---------- menu konteks ----------
  UI.ctxMenu = function (x, y, items) {
    document.querySelectorAll('.ctx').forEach((c) => c.remove());
    const menu = h('div.ctx', items.filter(Boolean).map((it) => it === '-' ? h('hr') : h('button', { onclick: () => { menu.remove(); it.fn(); } }, it.label)));
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, innerWidth - r.width - 6) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
    setTimeout(() => document.addEventListener('mousedown', function off(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off); } }), 0);
  };

  // ---------- aksi ----------
  const ACT = UI.actions = {
    'add-input': () => KM.dialogs.addInput(),
    settings: () => KM.dialogs.settings(),
    'settings-stream': () => KM.dialogs.settings('stream'),
    phone: () => UI.dockTab('phone'),
    help: () => KM.dialogs.help(),
    'project-new': () => UI.newProject(),
    'project-open': () => UI.openProject(),
    'project-save': () => UI.saveProject(false),
    'project-saveas': () => UI.saveProject(true),
    'autosave-restore': () => UI.restoreAutosave(true),
    external: () => KM.dialogs.external('program'),
    multiview: () => KM.dialogs.external('multiview'),
    snapshot: () => KM.rec.snapshot(),
    'open-rec-folder': async () => { if (!KM.isElectron) return KM.toast('Rekaman di browser tersimpan ke folder Unduhan'); const f = await KM.defaultFolder('rec'); await window.klm.invoke('file:write-text', KM.joinPath(f, '.klm'), ''); window.klm.invoke('shell:open', f); },
    quickplay: () => KM.engine.quickPlay(S.previewId),
    cut: () => KM.engine.cut(),
    stinger1: () => KM.engine.transition('stinger1', 0),
    stinger2: () => KM.engine.transition('stinger2', 0),
    ftb: () => KM.engine.ftb(),
    record: () => KM.rec.toggleRecording(),
    stream: () => KM.rec.toggleStreaming(), srt: () => KM.rec.toggleSrt(), 'settings-srt': () => KM.dialogs.settings('srt'),
    multicorder: () => KM.rec.toggleMultiCorder(),
    playlist: () => { UI.dockTab('playlist'); KM.playlist.running ? KM.playlist.stop() : KM.playlist.start(); },
    'replay-toggle': () => { UI.dockTab('replay'); KM.replay.setEnabled(); },
    'ovl-off': () => KM.engine.overlayAllOff(),
    ndi: async () => { if (S.ndiOut) return KM.rec.stopNdi(); const r = await KM.rec.startNdi(); if (!r) KM.dialogs.settings('ndi'); },
    'utc-panel': () => UI.utcPanel(), 'utc-close': () => UI.utcPanel(false),
    'utc-air': () => KM.utc.setOnAir(), 'utc-hideall': () => KM.utc.cmd('hideall'), 'utc-reload': () => { KM.utc.reload(); KM.toast('Renderer grafis UTC dimuat ulang'); },
    'utc-window': () => {
      const sc = UI.utcMode() === 'score';
      if (sc && !KM.score.port) return KM.toast('Scoreboard belum siap', 'warn');
      UI.utcPanel(false);
      const w = window.open(sc ? KM.score.url('/') : '/utc', sc ? 'klm_score_panel' : 'klm_utc_panel'); if (!w) KM.toast('Jendela diblokir', 'warn');
    },
    'score-air': () => KM.score.setOnAir(),
    'score-arena': () => { if (!KM.score.port) return KM.toast('Scoreboard belum siap', 'warn'); const w = window.open(KM.score.url('/arena'), 'klm_score_arena'); if (!w) KM.toast('Jendela diblokir', 'warn'); }
  };

  // ---------- panel lengkap UTC Acara / UTC Score (aplikasi asli: setting, edit, simpan, tambah & ubah) ----------
  // Keduanya terpisah dan hadir lewat input: tanpa input UTC Acara / UTC Score, panelnya belum ada.
  UI.utcMode = () => (KM.settings.utcMode === 'score' ? 'score' : 'acara');
  const hasMode = (m) => (m === 'score' ? KM.score.has() : KM.utc.has());
  function utcFrame(ws, mode) {
    ws._frames = ws._frames || {};
    let f = ws._frames[mode];
    if (f) return f;
    const src = mode === 'score' ? KM.score.url('/') : '/utc';
    if (!src) return null;
    f = document.createElement('iframe'); f.id = mode === 'score' ? 'scoreFrame' : 'utcFrame'; f.src = src; f.hidden = true;
    f.allow = 'camera; microphone; display-capture; clipboard-write; fullscreen';
    f.addEventListener('load', () => {
      try { f.contentWindow.addEventListener('keydown', (e) => { if (e.key === 'F9') { e.preventDefault(); UI.utcPanel(false); } }); } catch (e) {}
    });
    ws.querySelector('.utc-body').appendChild(f); ws._frames[mode] = f; // dibiarkan hidup: state panel tidak hilang saat ditutup / ganti
    if (mode === 'acara') ws._frame = f;
    return f;
  }
  UI.utcFrameReady = (mode) => !!(($('#utcWs')._frames || {})[mode]);
  // panel scoreboard disiapkan diam-diam di belakang saat input UTC Score ada → tombol cepat langsung jalan
  UI.prepScorePanel = () => { if (KM.score.has() && KM.score.port) utcFrame($('#utcWs'), 'score'); };
  UI.utcPanel = function (show, mode) {
    const ws = $('#utcWs');
    if (!mode) {
      const pv = KM.getInput(S.previewId);
      mode = pv && pv.type === 'score' ? 'score' : pv && pv.type === 'utc' ? 'acara' : (hasMode(UI.utcMode()) ? UI.utcMode() : KM.utc.has() ? 'acara' : KM.score.has() ? 'score' : '');
    }
    show = show == null ? (ws.hidden || ws.dataset.mode !== mode) : !!show;
    if (show && (!mode || !hasMode(mode))) {
      ws.hidden = true; $('#app').classList.remove('utc-mode');
      KM.toast('Tambahkan input ' + (mode === 'score' ? 'UTC Score' : mode === 'acara' ? 'UTC Acara' : 'UTC Acara / UTC Score') + ' dulu (menu Input).', 'warn', 4500);
      KM.dialogs.addInput(mode === 'score' ? 'score' : mode === 'acara' ? 'utc' : undefined);
      return;
    }
    if (mode) { KM.settings.utcMode = mode; KM.saveSettings(); }
    const m = UI.utcMode();
    if (show) {
      const f = utcFrame(ws, m);
      if (!f && m === 'score') { KM.toast('UTC Score sedang dinyalakan… coba lagi sebentar', 'warn'); }
      Object.entries(ws._frames || {}).forEach(([k, el]) => { el.hidden = k !== m; });
    }
    ws.hidden = !show;
    ws.dataset.mode = m;
    $('#app').classList.toggle('utc-mode', show);
    if (show) {
      if (m === 'acara') KM.utc.ensure(); else KM.score.ensure();
      try { ws._frames[m].contentWindow.focus(); } catch (e) {}
    }
    updateUtc();
  };
  // ---------- panel samping: tab muncul hanya bila inputnya ada ----------
  const SIDE = { utc: 'acara', score: 'score', klmcam: 'phone' };
  UI.sideTab = (type) => SIDE[type];
  UI.openSide = (type) => { const t = SIDE[type]; if (t) { syncDockTabs(); UI.dockTab(t); } };
  function syncDockTabs() {
    const has = { acara: KM.utc.has(), score: KM.score.has(), phone: S.inputs.some((i) => i.type === 'klmcam') };
    $$('.dtabs button.dyn').forEach((b) => { b.hidden = !has[b.dataset.tab]; });
    const bu = $('#bb-utc'), bs = $('#bb-score');
    if (bu) bu.hidden = !has.acara;
    if (bs) bs.hidden = !has.score;
    if (has.score) setTimeout(() => UI.prepScorePanel(), Math.max(0, 6000 - performance.now())); // disiapkan setelah aplikasi selesai dibuka
    if (UI.currentTab && has[UI.currentTab] === false) UI.dockTab('audio');
    const ws = $('#utcWs');
    if (!ws.hidden && !hasMode(ws.dataset.mode)) UI.utcPanel(false);
  }
  UI.syncDockTabs = syncDockTabs;
  let lastPv = null;
  KM.on('change', (w) => {
    if (w === 'inputs' || w === 'input') syncDockTabs();
    if (w === 'preview' && S.previewId !== lastPv) { // input UTC/KLMCAM dipilih → panel sampingnya dibuka
      lastPv = S.previewId; const pv = KM.getInput(S.previewId);
      if (pv && SIDE[pv.type] && UI.currentTab !== SIDE[pv.type]) UI.dockTab(SIDE[pv.type]);
    }
  });
  function updateScore() {
    const on = KM.score.onAir();
    ['#bb-score', '#ws-score-air'].forEach((s) => { const b = $(s); if (b) b.classList.toggle('on', on); });
    const l = $('#scoreLive'), st = KM.score.status;
    if (l) {
      if (!st || !st.port) l.textContent = 'Menyalakan scoreboard…';
      else {
        const ip = (KM._appInfo && KM._appInfo.ips && KM._appInfo.ips[0]) || '';
        const c = st.clients || {};
        l.innerHTML = 'Port <b>' + st.port + '</b> • panel ' + (c.control ? '<b>siap</b>' : 'memuat…') + (c.overlay ? ' • overlay ' + c.overlay : '') + (c.hp ? ' • HP ' + c.hp : '') +
          (ip ? ' • HP: <b>http://' + KM.esc(typeof ip === 'string' ? ip : ip.address) + ':' + st.port + '/hp</b>' : '') + (st.migratedFrom ? ' • data lama dipindahkan' : '');
      }
    }
    if (st && st.port && KM.score.has()) setTimeout(() => UI.prepScorePanel(), Math.max(0, 6000 - performance.now()));
  }
  KM.on('change', (w) => { if (w === 'score') updateScore(); });
  function updateUtc() {
    const on = KM.utc.onAir();
    updateScore();
    ['#bb-utc', '#ws-utc-air'].forEach((s) => { const b = $(s); if (b) b.classList.toggle('on', on); });
    const l = $('#utcLive'); if (l) l.innerHTML = KM.utc.liveInfo();
    const ev = $('#utcEvent'), st = KM.utc.status;
    if (ev && st && st.events) {
      const sig = st.events.map((e) => e.id).join();
      if (ev._sig !== sig) { ev._sig = sig; ev.replaceChildren(...st.events.map((e) => h('option', { value: e.id }, e.n))); ev.onchange = () => KM.utc.cmd('event', '', { name: ev.value }); }
      if (document.activeElement !== ev) ev.value = st.eventType;
    }
  }
  KM.on('change', (w) => { if (w === 'utc') updateUtc(); });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b && ACT[b.dataset.act]) { e.preventDefault(); ACT[b.dataset.act](); b.closest('.dd') && b.closest('.dd').classList.remove('open'); }
    const ov = e.target.closest('[data-ov]');
    if (ov) {
      const n = +ov.dataset.ov, ch = S.overlays[n];
      KM.engine.overlay(n, (ch.phase === 'in' || ch.phase === 'on') ? null : S.previewId, (ch.phase === 'in' || ch.phase === 'on') ? 'out' : 'in');
    }
  });

  // ---------- slot transisi ----------
  function renderTransSlots() {
    const box = $('#tslots'); box.innerHTML = '';
    KM.settings.transitions.forEach((t, i) => {
      const sel = h('select', { title: 'Ganti efek transisi ' + (i + 1), onchange: () => { t.type = sel.value; KM.saveSettings(); renderTransSlots(); } },
        Object.entries(KM.engine.TRANSITIONS).filter(([k]) => k !== 'cut' && !k.startsWith('stinger')).map(([k, v]) => h('option', { value: k, selected: k === t.type }, v)));
      const dur = h('input', { type: 'number', value: t.dur, min: 50, max: 10000, step: 50, title: 'Durasi transisi (milidetik)', onchange: () => { t.dur = +dur.value || 500; KM.saveSettings(); } });
      box.appendChild(h('div.tslot',
        h('button.tb', { title: 'Transisi ' + (i + 1) + (i === 0 ? ' (Enter)' : ''), onclick: () => KM.engine.transition(t.type, t.dur) }, h('span', KM.engine.TRANSITIONS[t.type] || t.type), i === 0 ? h('span.k', '↵') : null),
        h('div.row', sel, dur)));
    });
  }
  UI.renderTransSlots = renderTransSlots;

  // ---------- kartu input ----------
  function typeIcon(inp) { const ic = KM.inputTypes[inp.type].icon, n = KI.leading(ic); return n ? KI.el(n) : ic; }
  function cardButtons(inp) {
    const n = KM.inputNum(inp);
    const btn = (lbl, title, fn, cls) => h('button.cb' + (cls ? '.' + cls.replace(/\s+/g, '.') : ''), { title, onclick: (e) => { e.stopPropagation(); fn(e); } }, typeof lbl === 'string' && KI.names.includes(lbl) ? KI.el(lbl) : lbl);
    const top = [
      btn('x', 'Hapus input', async () => { if (await UI.confirm('Hapus input ' + n + ' "' + inp.title + '"?', 'Hapus')) KM.inputs.remove(inp); }, 'del'),
      btn([KI.el('play'), 'Quick'], 'Quick Play ke Program (transisi tanpa menukar)', () => KM.engine.quickPlay(inp.id), 'grow'),
      btn('CUT', 'Cut langsung ke Program', () => KM.engine.cut(inp.id), 'grow red'),
      btn('settings', 'Pengaturan input', () => KM.dialogs.inputSettings(inp))
    ];
    const els = [];
    if (KM.inputs.isPlayable(inp)) {
      els.push(btn(KM.inputs.isPlaying(inp) ? 'pause' : 'play', 'Play / Pause', () => { KM.inputs.isPlaying(inp) ? KM.inputs.pause(inp) : KM.inputs.play(inp); UI.updateCards(); }, 'play'));
      els.push(btn('repeat', 'Loop', () => { KM.inputs.setLoop(inp, !inp.loop); UI.updateCards(); }, 'loop' + (inp.loop ? '.on' : '')));
    }
    for (let k = 0; k < 4; k++) {
      const ch = S.overlays[k];
      const on = ch.inputId === inp.id && ch.phase !== 'off';
      els.push(btn(String(k + 1), 'Overlay ' + (k + 1) + (on ? ' (aktif — klik untuk mematikan)' : ''), () => KM.engine.overlay(k, inp.id, 'toggle'), 'ov.o' + k + (on ? '.on' : '')));
    }
    if (KM.inputs.hasAudio(inp)) els.push(btn(inp.audio.mute ? 'volume-x' : 'volume', inp.audio.mute ? 'Audio mati (klik untuk nyalakan)' : 'Audio aktif (klik untuk mute)', () => KM.audio.set(inp, 'mute', null), 'aud' + (inp.audio.mute ? '' : '.on')));
    return [h('div.cbrow', top), h('div.cbrow', els)];
  }

  UI.renderCards = function () {
    const box = $('#inputs'); box.innerHTML = '';
    S.inputs.forEach((inp, idx) => {
      if (!inp.rt.thumb) { inp.rt.thumb = h('canvas'); inp.rt.thumb.width = 256; inp.rt.thumb.height = 144; thumbIO && thumbIO.observe(inp.rt.thumb); }
      const meter = h('i');
      const card = h('div.card', { draggable: true, 'data-id': inp.id },
        h('div.thumb', {
          onclick: (e) => { if (e.ctrlKey) KM.engine.cut(inp.id); else KM.engine.setPreview(inp.id); },
          ondblclick: () => (inp.type === 'utc' || inp.type === 'score' ? UI.utcPanel(true, inp.type === 'score' ? 'score' : 'acara') : KM.dialogs.inputSettings(inp)),
          title: 'Klik: ke Preview • Ctrl+Klik: Cut • Dobel klik: pengaturan'
        }, inp.rt.thumb, h('span.num', String(idx + 1)), h('span.tly'), h('span.typ', { title: KM.inputTypes[inp.type].label }, typeIcon(inp)), h('div.pbar'), KM.inputs.hasAudio(inp) ? h('div.ameter', meter) : null),
        h('div.ctitle', h('span', { title: inp.title, ondblclick: async () => { const v = await UI.prompt('Ganti nama input', inp.title); if (v) { inp.title = v; KM.changed('inputs'); } } }, inp.title)),
        h('div.cbtns', cardButtons(inp)));
      card._meter = meter; card._inp = inp;
      card.addEventListener('contextmenu', (e) => { e.preventDefault(); UI.inputMenu(inp, e.clientX, e.clientY); });
      card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/klm-input', inp.id); });
      card.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/klm-input')) { e.preventDefault(); card.classList.add('drag-over'); } });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (e) => {
        card.classList.remove('drag-over');
        const id = e.dataTransfer.getData('text/klm-input'); if (!id) return;
        e.preventDefault(); e.stopPropagation();
        const src = KM.getInput(id); if (!src || src === inp) return;
        const arr = S.inputs; arr.splice(arr.indexOf(src), 1); arr.splice(arr.indexOf(inp), 0, src); KM.changed('inputs');
      });
      box.appendChild(card);
    });
    UI.syncLiveThumbs();
    if (!S.inputs.length) box.appendChild(emptyState());
    else box.appendChild(h('div.card.add', { onclick: () => KM.dialogs.addInput(), title: 'Tambah input (Ctrl+I)' }, KI.el('plus'), 'Tambah Input'));
    const c = $('#inCount'); if (c) c.textContent = S.inputs.length;
    UI.updateCards();
  };

  function emptyState() {
    const q = (type, icon, name, sub) => h('button', { onclick: () => KM.dialogs.addInput(type) }, KI.el(icon), name, h('span', sub));
    return h('div.empty',
      KI.el('logo'), h('h2', 'Mulai produksi Anda'),
      h('p', 'Tambahkan sumber gambar: kamera, kamera HP (KLMCAM), video, foto, layar, atau grafis acara. Klik sumber di Preview, lalu CUT atau transisi ke Program.'),
      h('div.qadd',
        q('camera', 'camera', 'Kamera', 'Webcam / capture'),
        q('klmcam', 'phone', 'KLMCAM', 'Kamera HP'),
        q('video', 'film', 'Video', 'MP4, MOV, MKV'),
        q('image', 'image', 'Gambar', 'Foto / logo'),
        q('screen', 'monitor', 'Layar', 'Desktop / jendela'),
        q('utc', 'clapper', 'UTC Acara', 'Grafis acara'),
        q('score', 'trophy', 'UTC Score', 'Scoreboard olahraga')),
      h('div.row', { style: { marginTop: '14px', justifyContent: 'center' } },
        h('button.btn', { onclick: () => KM.dialogs.addInput() }, KI.el('grid'), 'Semua jenis input'),
        h('button.btn', { onclick: () => UI.openProject() }, KI.el('folder-open'), 'Buka proyek'),
        h('button.btn', { onclick: () => UI.restoreAutosave(true) }, KI.el('rotate-ccw'), 'Pulihkan sesi terakhir')));
  }

  // tampilan live mulus untuk kamera/KLMCAM/layar di kartu input (memakai stream yang sama, tanpa decode ulang)
  // thumbnail LIVE: kamera, KLMCAM, layar, dan video yang sedang diputar ditampilkan sebagai <video> kecil
  // yang digambar langsung oleh compositor GPU (frame rate asli, tidak ikut beban thread utama) → tidak patah-patah
  function syncLiveThumb(card) {
    const inp = card._inp; if (!inp) return;
    const th = card._th || (card._th = card.querySelector('.thumb')); if (!th) return;
    let v = th.querySelector('video.live');
    const st = KM.engine.liveStream(inp);
    const trk = st && st.getVideoTracks().find((t) => t.readyState === 'live');
    if (!trk) { if (v) { v.srcObject = null; v.remove(); } return; }
    if (!v) { v = document.createElement('video'); v.className = 'live'; v.muted = true; v.playsInline = true; v.autoplay = true; v.disablePictureInPicture = true; th.insertBefore(v, th.firstChild.nextSibling); }
    if (v._trk !== trk) { v._trk = trk; v.srcObject = new MediaStream([trk]); v.play().catch(() => {}); }
    const tf = inp.opts && inp.opts.mirror ? 'scaleX(-1)' : '';
    if (v.style.transform !== tf) v.style.transform = tf;
  }
  UI.syncLiveThumbs = () => KM.$$('#inputs .card[data-id]').forEach(syncLiveThumb);

  UI.updateCards = function () {
    KM.$$('#inputs .card[data-id]').forEach((card) => {
      const inp = card._inp; if (!inp) return;
      const tl = KM.engine.tallyOf(inp);
      card.classList.toggle('program', tl === 'program');
      card.classList.toggle('preview', tl === 'preview');
      card.classList.toggle('overlay', S.overlays.some((o) => o.inputId === inp.id && o.phase !== 'off'));
      // tombol hanya dibuat ulang bila statusnya berubah (bukan setiap ada perubahan apa pun)
      const sig = [KM.inputNum(inp), KM.inputs.isPlayable(inp) && KM.inputs.isPlaying(inp), inp.loop, KM.inputs.hasAudio(inp) && inp.audio.mute, S.overlays.map((o) => (o.inputId === inp.id && o.phase !== 'off' ? 1 : 0)).join('')].join('|');
      if (card._sig !== sig) { card._sig = sig; card.querySelector('.cbtns').replaceChildren(...cardButtons(inp)); }
      const t = card.querySelector('.ctitle span'); if (t.textContent !== inp.title) { t.textContent = inp.title; t.title = inp.title; }
    });
    const pv = KM.getInput(S.previewId), pg = KM.getInput(S.programId);
    const nm = (el, inp) => { const k = inp ? KM.inputNum(inp) + '|' + inp.title : '-'; if (el._k === k) return; el._k = k; el.replaceChildren(...(inp ? [h('span.n', String(KM.inputNum(inp))), inp.title] : [h('span.muted', 'Belum ada input')])); };
    nm($('#pvwName'), pv); nm($('#pgmName'), pg);
    if (KM.engine.gridActive()) { const n = KM.engine.gridIds().length; $('#pvwName').textContent = 'Grid ' + n + ' input' + (pv ? ' • terpilih: ' + KM.inputNum(pv) + '. ' + pv.title : ''); }
    $('#pvwBox').classList.toggle('nosig', !pv); $('#pgmBox').classList.toggle('nosig', !pg);
    renderPvwTools(pv);
  };

  function renderPvwTools(pv) {
    const box = $('#pvwTools'); box.innerHTML = '';
    if (!pv) return;
    if (KM.inputs.isPlayable(pv)) {
      box.appendChild(h('button.ic', { title: 'Mulai ulang', onclick: () => KM.inputs.restart(pv) }, KI.el('skip-back')));
      box.appendChild(h('button.ic', { title: 'Play / Pause', onclick: () => { KM.inputs.isPlaying(pv) ? KM.inputs.pause(pv) : KM.inputs.play(pv); UI.updateCards(); } }, KI.el(KM.inputs.isPlaying(pv) ? 'pause' : 'play')));
      if (pv.type === 'list') box.appendChild(h('button.ic', { title: 'Item berikutnya', onclick: () => KM.inputTypes.list.next(pv) }, KI.el('skip-fwd')));
    }
    if (pv.type === 'title') {
      box.appendChild(h('button.ic', { title: 'Animasi masuk', onclick: () => KM.titles.animIn(pv) }, 'In'));
      box.appendChild(h('button.ic', { title: 'Animasi keluar', onclick: () => KM.titles.animOut(pv) }, 'Out'));
    }
    box.appendChild(h('button.ic', { title: 'Pengaturan input', onclick: () => KM.dialogs.inputSettings(pv) }, KI.el('settings')));
  }

  // ---------- Preview grid ----------
  const grid = () => (KM.settings.pvGrid = KM.settings.pvGrid || { on: false, ids: [] });
  UI.gridAdd = (id, on) => { const g = grid(); const has = g.ids.includes(id); if (on == null ? !has : on) { if (!has) g.ids.push(id); } else g.ids = g.ids.filter((x) => x !== id); KM.saveSettings(); renderGridBar(); };
  UI.setGrid = (on) => { const g = grid(); g.on = on == null ? !g.on : !!on; if (g.on && !g.ids.length) g.ids = S.inputs.slice(0, 9).map((i) => i.id); KM.engine.pvZoom = null; KM.saveSettings(); renderGridBar(); KM.changed('preview'); };
  function gridPicker(btn) {
    const g = grid(), r = btn.getBoundingClientRect();
    UI.ctxMenu(r.left, r.bottom + 4, [
      ...S.inputs.map((inp) => ({ label: (g.ids.includes(inp.id) ? '☑ ' : '☐ ') + KM.inputNum(inp) + '. ' + inp.title, fn: () => { UI.gridAdd(inp.id); setTimeout(() => gridPicker(btn), 0); } })),
      '-',
      { label: '＋ Semua input', fn: () => { g.ids = S.inputs.map((i) => i.id); KM.saveSettings(); renderGridBar(); } },
      { label: '✕ Kosongkan grid', fn: () => { g.ids = []; KM.saveSettings(); renderGridBar(); } }
    ]);
  }
  function renderGridBar() {
    const box = $('#pvwGrid'); if (!box) return;
    const g = grid(), on = !!g.on, n = KM.engine.gridIds().length;
    box.replaceChildren(
      h('button.ic' + (on ? '.on' : ''), { title: on ? 'Matikan grid (kembali ke 1 input)' : 'Grid: tampilkan banyak input di Preview', onclick: () => UI.setGrid() }, KI.el('grid')),
      on ? h('button.ic.txt', { title: 'Pilih input yang tampil di grid', onclick: (e) => gridPicker(e.currentTarget) }, KI.el('plus'), 'Input' + (n ? ' (' + n + ')' : '')) : null);
    $('#pvzBack').hidden = !(on && KM.engine.pvZoom);
    $('#pvwBox').classList.toggle('gridmode', on && !KM.engine.pvZoom);
  }
  UI.renderGridBar = renderGridBar;
  function pvPos(e) { const cv = $('#pvw'), r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; }
  function initPvGrid() {
    const cv = $('#pvw');
    cv.addEventListener('click', (e) => {
      if (!KM.engine.gridActive()) return;
      const id = KM.engine.gridHit(...pvPos(e)); if (!id) return;
      if (e.ctrlKey) KM.engine.cut(id); else KM.engine.setPreview(id);
    });
    cv.addEventListener('dblclick', (e) => {
      const g = grid(); if (!g.on) return;
      if (KM.engine.pvZoom) { KM.engine.pvZoom = null; renderGridBar(); KM.changed('preview'); return; }
      const id = KM.engine.gridHit(...pvPos(e)); if (!id) return;
      KM.engine.setPreview(id); KM.engine.pvZoom = id; renderGridBar(); KM.changed('preview');
    });
    $('#pvzBack').addEventListener('click', () => { KM.engine.pvZoom = null; renderGridBar(); KM.changed('preview'); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && KM.engine.pvZoom && !document.querySelector('.modal')) { KM.engine.pvZoom = null; renderGridBar(); KM.changed('preview'); } });
    KM.on('change', (w) => { if (w === 'inputs') renderGridBar(); });
    renderGridBar();
  }
  UI.initPvGrid = initPvGrid;

  UI.inputMenu = function (inp, x, y) {
    UI.ctxMenu(x, y, [
      SIDE[inp.type] ? { label: '🎛 Panel samping (tombol cepat)', fn: () => UI.openSide(inp.type) } : null,
      inp.type === 'utc' || inp.type === 'score' ? { label: '🖥 Panel lengkap (atur, edit, simpan)', fn: () => UI.utcPanel(true, inp.type === 'score' ? 'score' : 'acara') } : null,
      { label: '⚙ Pengaturan…', fn: () => KM.dialogs.inputSettings(inp) },
      { label: '✎ Ganti nama…', fn: async () => { const v = await UI.prompt('Ganti nama input', inp.title); if (v) { inp.title = v; KM.changed('inputs'); } } },
      { label: '⧉ Duplikat', fn: () => KM.inputs.duplicate(inp) },
      '-',
      { label: '👁 Ke Preview', fn: () => KM.engine.setPreview(inp.id) },
      { label: (KM.engine.gridIds().includes(inp.id) ? '⊟ Keluarkan dari' : '⊞ Tambah ke') + ' grid Preview', fn: () => { UI.gridAdd(inp.id); if (!grid().on) UI.setGrid(true); } },
      { label: '✂ Cut ke Program', fn: () => KM.engine.cut(inp.id) },
      { label: '📃 Tambah ke Playlist', fn: () => { KM.playlist.add(inp.id, KM.inputs.isPlayable(inp) ? 0 : 10); KM.toast('Ditambahkan ke playlist'); } },
      { label: '✨ Jadikan Stinger 1', fn: () => { KM.settings.stingers[0].inputId = inp.id; KM.saveSettings(); KM.toast('Stinger 1 = ' + inp.title); } },
      { label: '✨ Jadikan Stinger 2', fn: () => { KM.settings.stingers[1].inputId = inp.id; KM.saveSettings(); KM.toast('Stinger 2 = ' + inp.title); } },
      { label: '📸 Snapshot input', fn: () => KM.rec.snapshot(inp.id) },
      '-',
      { label: '◀ Geser kiri', fn: () => KM.inputs.move(inp, -1) },
      { label: '▶ Geser kanan', fn: () => KM.inputs.move(inp, 1) },
      { label: '🗑 Hapus', fn: async () => { if (await UI.confirm('Hapus "' + inp.title + '"?', 'Hapus')) KM.inputs.remove(inp); } }
    ]);
  };

  // ---------- meter mini & progress di kartu (ringan) ----------
  function tickCards() {
    KM.$$('#inputs .card[data-id]').forEach((card) => {
      const inp = card._inp; if (!inp) return;
      const st = KM.audio.strips.get(inp.id);
      // transform saja (tanpa hitung ulang tata letak) → daftar input tetap mulus
      if (st && card._meter) { const m = KM.audio.readMeter(st.meter); const db = KM.audio.toDb(Math.max(m.peakL, m.peakR)); const v = Math.round(KM.clamp((db + 60) / 60, 0, 1) * 100) / 100; if (card._mv !== v) { card._mv = v; card._meter.style.transform = 'scaleY(' + v + ')'; } }
      const md = KM.inputs.media(inp), pb = card._pbar || (card._pbar = card.querySelector('.pbar'));
      if (pb && md && md.duration && isFinite(md.duration)) { const v = Math.round(md.currentTime / md.duration * 1000) / 1000; if (card._pv !== v) { card._pv = v; pb.style.transform = 'scaleX(' + v + ')'; } }
    });
  }

  // ---------- bottom bar & status ----------
  function updateBars() {
    $('#bb-rec').classList.toggle('on', S.recording);
    $('#bb-stream').classList.toggle('on', S.streaming);
    $('#bb-ext').classList.toggle('on', S.externalOn);
    $('#bb-mc').classList.toggle('on', S.multicorder);
    $('#bb-pl').classList.toggle('on', KM.playlist.running);
    $('#bb-rp').classList.toggle('on', KM.replay.enabled);
    S.overlays.forEach((o, i) => $('#bb-ov' + i).classList.toggle('on', o.phase !== 'off'));
    $('#ftbBtn').classList.toggle('on', S.ftb.on);
    $('#st-res').innerHTML = KI.svg('monitor') + KM.settings.width + '×' + KM.settings.height + '<b>' + KM.settings.fps + 'p</b>';
    $('#st-perf').textContent = KM.perf.label();
    $('#bb-ndi').classList.toggle('on', !!S.ndiOut);
    const bs = $('#bb-srt'); bs.classList.toggle('on', !!S.srt && KM.rec.srtStatus === 'live'); bs.classList.toggle('wait', !!S.srt && KM.rec.srtStatus !== 'live');
    updateUtc();
  }
  const setHTML = (el, v) => { if (el._v !== v) { el._v = v; el.innerHTML = v; } };
  function tickStatus() {
    const d = new Date();
    $('#st-clock').textContent = KM.pad(d.getHours()) + ':' + KM.pad(d.getMinutes()) + ':' + KM.pad(d.getSeconds());
    setHTML($('#st-fps'), KM.engine.quiet ? KI.svg('leaf') + '<b>' + KM.settings.fps + '</b> fps · diam' : KI.svg('activity') + '<b>' + KM.engine.fps + '</b> fps');
    $('#st-fps').title = KM.engine.quiet ? 'Adegan diam: render dihemat otomatis (kembali penuh begitu ada gerakan, rekam, atau streaming)' : 'Frame per detik mixer';
    const r = $('#st-rec'); r.hidden = !S.recording; if (S.recording) setHTML(r, KI.svg('rec') + 'REC ' + KM.fmtTime(KM.rec.recTime()));
    const sr = $('#st-srt'); sr.hidden = !S.srt;
    if (S.srt) { const live = KM.rec.srtStatus === 'live', s = KM.rec.srtStats; sr.classList.toggle('wait', !live); setHTML(sr, KI.svg('cast') + 'SRT ' + (live ? KM.fmtTime(KM.rec.srtTime()) + (s ? ' · ' + s.bitrate : '') : ({ ulang: 'menyambung ulang', menunggu: 'menunggu' }[KM.rec.srtStatus] || 'menyambung'))); sr.title = KM.rec.srtMsg || 'Output SRT ke gateway TV'; }
    const l = $('#st-live'); l.hidden = !S.streaming;
    if (S.streaming) { const s = KM.rec.stats; setHTML(l, KI.svg('radio') + 'LIVE ' + KM.fmtTime(KM.rec.streamTime()) + (s ? ' · ' + s.bitrate : '')); }
    let cams = 0, rems = 0; for (const p of KM.link.peers.values()) { if (p.role === 'camera') cams++; else if (p.role === 'remote') rems++; }
    setHTML($('#st-hp'), KI.svg('camera') + '<b>' + cams + '</b>' + KI.svg('phone') + '<b>' + rems + '</b>');
    $('#st-hp').title = cams + ' KLMCAM, ' + rems + ' remote HP terhubung';
    // tombol play di kartu (status play bisa berubah sendiri)
  }

  // ---------- T-bar ----------
  function initTbar() {
    const tb = $('#tbar');
    tb.addEventListener('input', () => KM.engine.setTbar(+tb.value / 1000));
    tb.addEventListener('change', () => { if (!S.trans) tb.value = 0; });
    KM.on('change', (w) => { if (w !== 'tbar') { if (!S.trans || !S.trans.manual) tb.value = 0; } });
  }

  // ---------- shortcut keyboard ----------
  function initShortcuts() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (document.querySelector('.modal-bg')) return;
      if (KM.script && KM.script.handleKey(e)) return;
      const k = e.key;
      if (e.ctrlKey && k.toLowerCase() === 's' && !e.shiftKey) { e.preventDefault(); return UI.saveProject(false); }
      if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 's') { e.preventDefault(); return KM.rec.snapshot(); }
      if (e.ctrlKey && k.toLowerCase() === 'o') { e.preventDefault(); return UI.openProject(); }
      if (e.ctrlKey && k.toLowerCase() === 'i') { e.preventDefault(); return KM.dialogs.addInput(); }
      if (e.ctrlKey && k.toLowerCase() === 'r') { e.preventDefault(); return KM.rec.toggleRecording(); }
      if (e.ctrlKey && k.toLowerCase() === 'l') { e.preventDefault(); return KM.rec.toggleStreaming(); }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (k === 'F9') { e.preventDefault(); const ws = $('#utcWs'); return ws.hidden ? UI.utcPanel(true) : UI.utcPanel(false); }
      if (k === 'Escape' && !$('#utcWs').hidden) return UI.utcPanel(false);
      if (/^F[1-4]$/.test(k)) { e.preventDefault(); const n = +k[1] - 1, ch = S.overlays[n]; const on = ch.phase === 'in' || ch.phase === 'on'; return KM.engine.overlay(n, on ? null : S.previewId, on ? 'out' : 'in'); }
      if (/^[0-9]$/.test(e.code.replace('Digit', '')) && e.code.startsWith('Digit')) {
        const n = e.code === 'Digit0' ? 10 : +e.code.slice(5);
        const inp = S.inputs[n - 1]; if (!inp) return;
        if (e.shiftKey) KM.engine.cut(inp.id); else KM.engine.setPreview(inp.id);
        return;
      }
      if (k === ' ') { e.preventDefault(); return KM.engine.cut(); }
      if (k === 'Enter') { e.preventDefault(); const t = KM.settings.transitions[0]; return KM.engine.transition(t.type, t.dur); }
      if (k === 'b' || k === 'B') return KM.engine.ftb();
      if (k === 'q' || k === 'Q') return KM.engine.quickPlay(S.previewId);
      if (k === 'p' || k === 'P') { const pv = KM.getInput(S.previewId); if (pv) KM.inputs.isPlaying(pv) ? KM.inputs.pause(pv) : KM.inputs.play(pv); return; }
      if (k === 'ArrowRight') return KM.api.exec('PreviewInputNext');
      if (k === 'ArrowLeft') return KM.api.exec('PreviewInputPrevious');
      if (k === 'm' || k === 'M') return KM.replay.mark(8);
      if (k === 'F11') { e.preventDefault(); document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
    });
  }

  // ---------- drop file ke panel input ----------
  function initDrop() {
    const panel = $('#inputsPanel');
    panel.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
    panel.addEventListener('drop', (e) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      Array.from(e.dataTransfer.files).forEach((f) => UI.addFileInput({ file: f, name: f.name, path: KM.isElectron ? window.klm.pathOf(f) : '' }));
    });
  }
  UI.fileKind = (name, mime) => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (/^image\//.test(mime || '') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
    if (/^audio\//.test(mime || '') || ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audiofile';
    return 'video';
  };
  UI.addFileInput = function (f) {
    if (!f.url) f.url = f.path ? KM.fileUrl(f.path) : URL.createObjectURL(f.file);
    const kind = UI.fileKind(f.name, f.file && f.file.type);
    return KM.inputs.create(kind, { title: f.name.replace(/\.[^.]+$/, ''), opts: { url: f.url, path: f.path || '' } });
  };

  // ---------- splitter & dock ----------
  function initSplitter() {
    const sp = $('#splitter'), low = $('#lower');
    try { const w = localStorage.getItem('klmmix.dockw'); if (w) low.style.setProperty('--dockw', w); } catch (e) {}
    sp.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const move = (ev) => { const w = KM.clamp(innerWidth - ev.clientX - 8, 300, innerWidth * 0.7) + 'px'; low.style.setProperty('--dockw', w); try { localStorage.setItem('klmmix.dockw', w); } catch (x) {} };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }
  UI.dockTab = function (name) {
    KM.$$('.dtabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    KM.$$('.dbody').forEach((d) => { d.hidden = d.id !== 'dock-' + name; });
    UI.currentTab = name;
    KM.dock && KM.dock.render(name);
  };

  // ---------- proyek ----------
  UI.projectData = function () {
    return {
      app: 'KLM Mix', version: KM.version, savedAt: new Date().toISOString(),
      output: { width: KM.settings.width, height: KM.settings.height, fps: KM.settings.fps },
      transitions: KM.settings.transitions, stingers: KM.settings.stingers, overlayFx: KM.settings.overlayFx,
      inputs: S.inputs.map(KM.inputs.serialize),
      scripts: KM.settings.scripts || [], shortcuts: KM.settings.shortcuts || [],
      previewId: S.previewId, programId: S.programId,
      overlays: S.overlays.map((o) => ({ inputId: o.inputId })),
      playlist: { items: KM.playlist.items, type: KM.playlist.type, dur: KM.playlist.dur, loop: KM.playlist.loop },
      audio: KM.audio.master ? { M: [KM.audio.master.vol, KM.audio.master.muted], A: [KM.audio.busA.vol, KM.audio.busA.muted], B: [KM.audio.busB.vol, KM.audio.busB.muted] } : null
    };
  };
  UI.loadProject = async function (p) {
    if (!p || p.app !== 'KLM Mix') { KM.toast('File proyek tidak valid', 'err'); return; }
    S.inputs.slice().forEach((i) => KM.inputs.remove(i));
    S.previewId = S.programId = null;
    if (p.output) { Object.assign(KM.settings, p.output); KM.saveSettings(); KM.engine.resize(); }
    if (p.transitions) KM.settings.transitions = p.transitions;
    if (p.stingers) KM.settings.stingers = p.stingers;
    if (p.overlayFx) KM.settings.overlayFx = p.overlayFx;
    if (p.scripts && p.scripts.length) KM.settings.scripts = p.scripts;
    if (p.shortcuts && p.shortcuts.length) KM.settings.shortcuts = p.shortcuts;
    KM.saveSettings();
    for (const d of p.inputs || []) { try { KM.inputs.create(d.type, d); } catch (e) { console.warn(e); } }
    S.previewId = p.previewId; S.programId = p.programId;
    (p.overlays || []).forEach((o, i) => { S.overlays[i].inputId = o.inputId; S.overlays[i].phase = 'off'; });
    if (p.playlist) Object.assign(KM.playlist, p.playlist, { running: false, idx: -1 });
    if (p.audio && KM.audio.master) ['M', 'A', 'B'].forEach((b) => { KM.audio.setBusVol(b, p.audio[b][0]); KM.audio.setBusMute(b, p.audio[b][1]); });
    renderTransSlots();
    KM.changed('inputs');
    KM.toast('Proyek dimuat: ' + (p.inputs || []).length + ' input', 'ok');
  };
  UI.saveProject = async function (asNew) {
    const json = JSON.stringify(UI.projectData(), null, 1);
    if (KM.isElectron) {
      let path = !asNew && UI.projectPath;
      if (!path) path = await window.klm.invoke('dialog:save', { title: 'Simpan Proyek KLM Mix', defaultPath: KM.joinPath(await KM.defaultFolder('doc'), 'Proyek-' + KM.stamp() + '.klmmix'), filters: [{ name: 'Proyek KLM Mix', extensions: ['klmmix'] }] });
      if (!path) return;
      await window.klm.invoke('file:write-text', path, json);
      UI.projectPath = path; KM.toast('Proyek tersimpan: ' + path, 'ok');
    } else KM.downloadBlob(new Blob([json], { type: 'application/json' }), 'Proyek-' + KM.stamp() + '.klmmix');
    return true;
  };
  UI.openProject = async function () {
    if (KM.isElectron) {
      const [p] = await window.klm.invoke('dialog:open', { title: 'Buka Proyek', filters: [{ name: 'Proyek KLM Mix', extensions: ['klmmix', 'json'] }] });
      if (!p) return;
      try { await UI.loadProject(JSON.parse(await window.klm.invoke('file:read-text', p))); UI.projectPath = p; } catch (e) { KM.toast('Gagal membuka: ' + e.message, 'err'); }
    } else {
      const [f] = await KM.pickFiles('.klmmix,.json');
      if (f) try { await UI.loadProject(JSON.parse(await f.file.text())); } catch (e) { KM.toast('Gagal membuka: ' + e.message, 'err'); }
    }
  };
  UI.newProject = async function () {
    if (S.inputs.length && !(await UI.confirm('Mulai proyek baru? Semua input akan ditutup.', 'Proyek baru'))) return;
    S.inputs.slice().forEach((i) => KM.inputs.remove(i));
    KM.playlist.items = []; UI.projectPath = null; KM.changed('inputs');
  };
  let lastAuto = '';
  UI.autosave = function () {
    if (!S.inputs.length) return;
    try { const j = JSON.stringify(UI.projectData()); if (j !== lastAuto) { localStorage.setItem('klmmix.autosave', j); lastAuto = j; } } catch (e) {}
  };
  UI.restoreAutosave = async function (ask) {
    let p; try { p = JSON.parse(localStorage.getItem('klmmix.autosave') || 'null'); } catch (e) {}
    if (!p || !p.inputs || !p.inputs.length) { if (ask) KM.toast('Tidak ada sesi tersimpan'); return; }
    if (ask !== 'silent' && !(await UI.confirm('Pulihkan sesi terakhir (' + p.inputs.length + ' input, ' + new Date(p.savedAt).toLocaleString('id-ID') + ')?', 'Pulihkan'))) return;
    UI.loadProject(p);
  };

  // ---------- init ----------
  UI.init = function () {
    $('#ver').textContent = 'v' + KM.version + (KM.isElectron ? '' : ' · web');
    const bl = $('#brandLogo'); if (bl) bl.replaceWith(KI.el('logo'));
    $('#bb-srt').addEventListener('contextmenu', (e) => { e.preventDefault(); KM.dialogs.settings('srt'); });
    $('#bb-score').addEventListener('contextmenu', (e) => { e.preventDefault(); UI.utcPanel(true, 'score'); });
    $('#bb-utc').addEventListener('contextmenu', (e) => { e.preventDefault(); UI.utcPanel(true, 'acara'); });
    syncDockTabs();
    renderTransSlots(); initTbar(); initShortcuts(); initDrop(); initSplitter();
    KM.$$('.dtabs button').forEach((b) => b.addEventListener('click', () => UI.dockTab(b.dataset.tab)));
    KM.$$('.dd > .mbtn').forEach((b) => b.addEventListener('click', () => b.parentElement.classList.toggle('open')));
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('.dd')) KM.$$('.dd.open').forEach((d) => d.classList.remove('open')); });
    UI.renderCards(); updateBars(); initPvGrid();
    // gabungkan banyak perubahan menjadi satu update per frame (UI lebih ringan)
    let pendRender = false, pendUpdate = false, raf = 0;
    const flush = () => { raf = 0; if (pendRender) UI.renderCards(); else if (pendUpdate) UI.updateCards(); pendRender = pendUpdate = false; updateBars(); };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(flush); if (document.hidden) setTimeout(() => { if (raf) { cancelAnimationFrame(raf); flush(); } }, 300); };
    KM.on('change', (w) => {
      if (w === 'tbar' || w === 'audio-vol') return;
      if (w === 'inputs') pendRender = true; else pendUpdate = true;
      schedule();
    });
    KM.on('tally', () => { pendUpdate = true; schedule(); });
    $('#st-perf').addEventListener('click', () => KM.perf.cycle());
    KM.on('settings', () => { updateBars(); });
    setInterval(tickStatus, 250);
    setInterval(() => { if (!document.hidden) tickCards(); }, 100);
    setInterval(UI.autosave, 10000);
    // tampilkan status play terbaru
    KM.on('change', (w) => { if (w === 'input') setTimeout(UI.syncLiveThumbs, 50); });
    setInterval(() => { if (document.hidden) return; KM.$$('#inputs .card[data-id]').forEach((c) => { syncLiveThumb(c); const b = c.querySelector('.cb.play'); if (b && c._inp) { const t = KM.inputs.isPlaying(c._inp) ? 'pause' : 'play'; if (b._t !== t) { b._t = t; b.replaceChildren(KI.el(t)); } } }); }, 300);
    ['play', 'playing', 'pause', 'seeked', 'emptied'].forEach((ev) => document.addEventListener(ev, () => { clearTimeout(UI._lt); UI._lt = setTimeout(UI.syncLiveThumbs, 30); }, true)); // video mulai/berhenti → thumbnail live langsung ikut
    // layar pembuka
    setTimeout(() => { const sp = $('#splash'); if (sp) { sp.classList.add('done'); setTimeout(() => sp.remove(), 600); } }, 450);
  };
})(window.KM);
