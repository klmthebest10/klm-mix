/* KLM Mix - panel samping: Mixer Audio, UTC Acara, UTC Score, KLMCAM, Title, Replay, Playlist, PTZ, Skrip
 * Tab UTC Acara / UTC Score / KLMCAM hanya muncul bila inputnya sudah ditambahkan. */
'use strict';
(function (KM) {
  const h = KM.h, S = KM.state;
  const DK = KM.dock = { titleId: null };
  const H = () => KM.dialogs.helpers;

  // =================== AUDIO MIXER ===================
  const vus = [];
  function strip(name, opts) {
    const vu = h('canvas.vu', { width: 14, height: 150 });
    const fader = h('input', { type: 'range', min: 0, max: 100, step: 1, value: opts.vol, title: 'Volume', oninput: () => { opts.onVol(+fader.value); val.textContent = fader.value; } });
    fader.addEventListener('dblclick', () => { fader.value = 100; fader.dispatchEvent(new Event('input')); });
    const val = h('span.vv', String(opts.vol));
    const el = h('div.strip' + (opts.master ? '.master' : '') + (opts.live ? '.live' : ''),
      h('div.sn', { title: name }, name),
      h('div.fz', vu, fader),
      val,
      h('div.sb', opts.buttons),
      opts.buses ? h('div.sb', opts.buses) : null,
      opts.gear || null);
    vus.push({ vu, meter: opts.meter, el, inp: opts.inp });
    return el;
  }
  const cb = (label, on, cls, title, fn) => h('button.cb.' + cls + (on ? '.on' : ''), { title, onclick: fn }, label);

  function renderAudio() {
    const box = KM.$('#dock-audio');
    vus.length = 0;
    const A = KM.audio; A.init();
    const mx = h('div.mixer');
    const busStrip = (b, label) => {
      const bus = A.busOf(b);
      return strip(label, {
        master: true, vol: bus.vol, meter: bus.meter, onVol: (v) => A.setBusVol(b, v),
        buttons: [cb('M', bus.muted, 'mute', 'Mute', () => { A.setBusMute(b); renderAudio(); }),
          b === 'M' ? cb('🎧', KM.settings.monitorAudio, 'solo', 'Monitor headphone', () => { A.setMonitor(!KM.settings.monitorAudio); KM.saveSettings(); renderAudio(); }) : h('span'),
          h('span')],
        gear: b === 'M' ? h('button.cb.fx' + ((KM.settings.masterFx || []).some((x) => x.on !== false) ? '.on' : ''), { style: { width: '100%' }, title: 'Rak efek Master (EQ, kompresor, limiter siaran…)', onclick: () => KM.afx.open('master') }, 'FX Master' + ((KM.settings.masterFx || []).length ? ' ' + KM.settings.masterFx.length : '')) : null
      });
    };
    mx.append(busStrip('M', 'MASTER'), busStrip('A', 'Bus A'), busStrip('B', 'Bus B'));
    S.inputs.forEach((inp) => {
      const st = A.strips.get(inp.id); if (!st) return;
      const a = inp.audio;
      const tog = (k, title) => cb(k, a[k], 'bus', title, () => { KM.audio.set(inp, k, !a[k]); renderAudio(); });
      mx.append(strip(KM.inputNum(inp) + '. ' + inp.title, {
        inp, vol: a.vol, meter: st.meter, live: KM.engine.isLive(inp), onVol: (v) => { a.vol = v; KM.audio.apply(inp); KM.changed('audio-vol'); },
        buttons: [cb('🔇', a.mute, 'mute', 'Mute', () => { KM.audio.set(inp, 'mute', null); renderAudio(); }),
          cb('S', a.solo, 'solo', 'Solo (dengar di headphone saja)', () => { KM.audio.set(inp, 'solo', !a.solo); renderAudio(); }),
          cb('A', a.auto, 'auto', 'Auto: audio ikut video (hanya bunyi saat di Program)', () => { KM.audio.set(inp, 'auto', !a.auto); renderAudio(); })],
        buses: [tog('M', 'Kirim ke Master'), tog('A', 'Kirim ke Bus A'), tog('B', 'Kirim ke Bus B')],
        gear: h('div.sb2', h('button.cb.fx' + ((a.fx || []).some((x) => x.on !== false) ? '.on' : ''), { title: 'Rak efek & plugin: ' + ((a.fx || []).map((x) => (KM.afx.defs[x.type] || {}).name).filter(Boolean).join(' → ') || 'kosong'), onclick: () => KM.afx.open(inp) }, 'FX' + ((a.fx || []).length ? ' ' + a.fx.length : '')),
          h('button.cb', { title: 'Pengaturan audio input (EQ dasar, gate, delay, routing)', onclick: () => KM.dialogs.inputSettings(inp, 'audio') }, KI.el('settings')))
      }));
    });
    const ua = KM.utc && KM.utc.audioStrip(), ust = ua && A.strips.get(ua.id);
    if (ust) mx.append(strip('🎬 UTC Opening/Closing', {
      vol: ua.audio.vol, meter: ust.meter, onVol: (v) => { ua.audio.vol = v; KM.audio.apply(ua); },
      buttons: [cb('🔇', ua.audio.mute, 'mute', 'Mute suara video opening/closing', () => { ua.audio.mute = !ua.audio.mute; KM.audio.apply(ua); renderAudio(); }), h('span'), h('span')]
    }));
    if (!A.strips.size) mx.append(h('div.muted', { style: { alignSelf: 'center', padding: '10px' } }, 'Tambahkan input video/kamera/mic/KLMCAM untuk memunculkan channel audio.'));
    box.replaceChildren(mx);
  }
  function drawVu(c, m) {
    const ctx = c.getContext('2d'), H2 = c.clientHeight || 150;
    if (c.height !== H2) c.height = H2;
    KM.audio.readMeter(m);
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, 14, H2);
    const lvl = (v) => KM.clamp((KM.audio.toDb(v) + 60) / 60, 0, 1);
    [[m.peakL, m.holdL, 0], [m.peakR, m.holdR, 7]].forEach(([p, hold, x]) => {
      const hh = lvl(p) * H2;
      const g = ctx.createLinearGradient(0, H2, 0, 0); g.addColorStop(0, '#16a34a'); g.addColorStop(0.7, '#22c55e'); g.addColorStop(0.85, '#facc15'); g.addColorStop(1, '#ef4444');
      ctx.fillStyle = g; ctx.fillRect(x, H2 - hh, 6, hh);
      ctx.fillStyle = '#fff'; ctx.fillRect(x, H2 - lvl(hold) * H2, 6, 2);
    });
    ctx.fillStyle = '#ffffff22'; [-6, -12, -20, -30, -40].forEach((db) => ctx.fillRect(0, H2 - (db + 60) / 60 * H2, 14, 1));
  }
  setInterval(() => {
    if (DK.cur !== 'audio' || document.hidden) return;
    vus.forEach((v) => { drawVu(v.vu, v.meter); if (v.inp) v.el.classList.toggle('live', KM.engine.isLive(v.inp)); });
  }, 40);

  // =================== TITLE UTC KLM ACARA ===================
  DK.selectTitle = (id) => { DK.titleId = id; if (DK.cur === 'title') renderTitle(); };
  DK.titleEditor = function (inp) {
    const o = inp.opts, T = KM.titles, { sel, row } = H();
    const tpl = T.TPL[o.template];
    const f = T.fields(inp);
    const wrap = h('div');
    const rebuild = () => wrap.replaceWith(DK.titleEditor(inp));
    wrap.append(
      row('Template', sel(Object.entries(T.TPL).map(([k, t]) => [k, t.group + ' • ' + t.name]), o.template, (v) => { o.template = v; if (/^Title: /.test(inp.title)) inp.title = 'Title: ' + T.TPL[v].name; KM.changed('inputs'); rebuild(); })),
      row('Tema', sel(Object.entries(T.THEMES).map(([k, t]) => [k, t.name]), o.theme, (v) => { o.theme = v; KM.changed('title'); })));
    T.defs(inp).forEach((fd) => {
      const el = fd.multi ? h('textarea.grow', { rows: 2, value: f[fd.k] }) : h('input.grow', { value: f[fd.k] });
      el.addEventListener('input', () => T.setField(inp, fd.k, el.value));
      if (fd.k === 'arab') { el.dir = 'rtl'; el.style.fontSize = '18px'; }
      wrap.append(row(fd.label, el));
    });
    if (o.template === 'logo') {
      wrap.append(row('Logo (PNG)', h('button.btn.sm', { onclick: async () => {
        const [file] = await KM.pickFiles('image/*'); if (!file) return;
        const rd = new FileReader(); rd.onload = () => { o.logo = rd.result; T.loadLogo(inp); KM.changed('title'); }; rd.readAsDataURL(file.file);
      } }, 'Pilih logo…'), o.logo ? h('button.btn.sm', { onclick: () => { o.logo = ''; T.loadLogo(inp); KM.changed('title'); } }, 'Hapus logo') : null));
    }
    if (o.template === 'custom') wrap.append(h('div.row', h('button.btn.pri', { onclick: () => KM.designer.open(inp) }, '🎨 Buka Title Designer')));
    if (o.template === 'countdown') {
      wrap.append(h('div.row', h('label', 'Hitung mundur'), h('button.btn.sm.green', { onclick: () => T.countdown(inp, 'start') }, '▶ Mulai'), h('button.btn.sm', { onclick: () => T.countdown(inp, 'pause') }, '⏸ Jeda'), h('button.btn.sm', { onclick: () => T.countdown(inp, 'reset') }, '↺ Reset')));
    }
    // daftar antrian (mis. daftar nama pembicara)
    const ta = h('textarea.grow', { rows: 4, placeholder: T.defs(inp).map((x) => x.label).join(' | ') + '\n(satu baris per item)', value: o.list.map((r) => r.join(' | ')).join('\n') });
    ta.addEventListener('change', () => { o.list = ta.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.split('|').map((s) => s.trim())); KM.changed('title'); });
    wrap.append(h('div.sec', { style: { marginTop: '8px', background: 'var(--bg2)' } }, h('h4', 'Antrian data (mis. daftar nama) ', h('span.pill', o.list.length ? (o.listIdx + 1) + '/' + o.list.length : 'kosong')),
      ta,
      h('div.row', h('button.btn.sm', { title: 'Impor CSV/Excel (Simpan sebagai CSV). Baris pertama boleh berisi nama field.', onclick: async () => { await KM.designer.importCsv(inp); rebuild(); } }, '📥 Impor CSV'),
        h('button.btn.sm', { onclick: () => { T.prev(inp); rebuild(); } }, '⏮ Sebelumnya'), h('button.btn.sm.pri', { onclick: () => { T.next(inp); rebuild(); } }, 'Berikutnya ⏭'),
        h('span.muted', 'Kolom dipisah "|" sesuai urutan field'))));
    return wrap;
  };

  function renderTitle() {
    const box = KM.$('#dock-title');
    const titles = S.inputs.filter((i) => i.type === 'title');
    const add = (tpl) => { const inp = KM.inputs.create('title', { opts: { template: tpl, theme: 'emas' } }); DK.titleId = inp.id; renderTitle(); };
    const quick = h('div.row', h('span.muted', 'Cepat:'), ...[['lt-klasik', 'Lower third'], ['running', 'Running text'], ['logo', 'Logo'], ['jam', 'Jam'], ['pengantin', 'Pengantin'], ['pengajian', 'Pengajian'], ['countdown', 'Countdown']].map(([k, l]) => h('button.btn.sm', { onclick: () => add(k) }, '＋ ' + l)),
      h('button.btn.sm', { onclick: () => { KM.designer.open(); } }, '🎨 Desain sendiri'),
      h('button.btn.sm.pri', { onclick: () => KM.dialogs.addInput('title') }, 'Semua template…'));
    if (!titles.length) { box.replaceChildren(h('div.sec', h('h4', 'Title Cepat (kanvas)'), h('p.muted', 'Grafis acara lengkap ada di tab 🎬 UTC Acara. Title cepat berbasis kanvas — tambahkan:'), quick)); return; }
    let inp = KM.getInput(DK.titleId); if (!inp || inp.type !== 'title') { inp = titles[0]; DK.titleId = inp.id; }
    const { sel } = H();
    const pv = h('canvas', { width: 384, height: 216, style: { width: '100%', background: 'repeating-conic-gradient(#333 0 25%, #222 0 50%) 0 0/20px 20px', borderRadius: '6px', display: 'block' } });
    DK.titlePv = { canvas: pv, inp };
    let ch = 0;
    const isOn = () => S.overlays.some((o) => o.inputId === inp.id && (o.phase === 'in' || o.phase === 'on'));
    box.replaceChildren(
      h('div.sec', h('div.row', sel(titles.map((t) => [t.id, KM.inputNum(t) + '. ' + t.title]), inp.id, (v) => { DK.titleId = v; renderTitle(); }),
        h('button.btn.sm', { onclick: () => KM.engine.setPreview(inp.id) }, '→ Preview'), h('button.btn.sm', { onclick: () => KM.dialogs.inputSettings(inp, 'posisi') }, 'Posisi')), quick),
      h('div.sec', pv,
        h('div.row', { style: { marginTop: '8px' } }, h('label', 'Overlay'), sel([[0, '1'], [1, '2'], [2, '3'], [3, '4']], ch, (v) => { ch = +v; }),
          h('button.btn.green', { onclick: () => KM.engine.overlay(ch, inp.id, 'in') }, '▶ TAMPIL (In)'),
          h('button.btn.red', { onclick: () => KM.engine.overlay(ch, null, 'out') }, '■ SEMBUNYI (Out)'),
          h('span.pill' + (isOn() ? '.red' : ''), isOn() ? 'ON AIR' : 'off'))),
      h('div.sec', DK.titleEditor(inp)));
  }
  setInterval(() => {
    if (DK.cur !== 'title' || !DK.titlePv) return;
    const { canvas, inp } = DK.titlePv; if (!inp.rt.canvas) return;
    const c = canvas.getContext('2d'); c.clearRect(0, 0, 384, 216);
    const hidden = inp.rt.anim.phase === 'hidden';
    if (hidden) { KM.titles.reset(inp); }
    KM.titles.render(inp, KM.now());
    c.drawImage(inp.rt.canvas, 0, 0, 384, 216);
    if (hidden) KM.titles.hideNow(inp);
    inp.rt.srcFrame = -1;
  }, 100);

  // =================== INSTANT REPLAY ===================
  function renderReplay() {
    const RP = KM.replay, rs = KM.settings.replay, { sel, row } = H();
    const box = KM.$('#dock-replay');
    box.replaceChildren(
      h('div.sec', h('h4', 'Buffer ', h('span.pill' + (RP.enabled ? '.red' : ''), RP.enabled ? '● MEREKAM ' + rs.seconds + ' dtk' : 'mati')),
        h('div.row', h('button.btn' + (RP.enabled ? '.red' : '.green'), { onclick: () => { RP.setEnabled(); renderReplay(); } }, RP.enabled ? '■ Matikan buffer' : '● Aktifkan buffer'),
          sel([['program', 'Sumber: Program']].concat(S.inputs.filter((i) => !KM.inputTypes[i.type].noVideo && i.type !== 'replay').map((i) => [i.id, 'Sumber: ' + KM.inputNum(i) + '. ' + i.title])), rs.source, (v) => { rs.source = v; KM.saveSettings(); })),
        h('div.row', h('label', 'Tandai event'), ...[5, 8, 12, 15].map((s) => h('button.btn.sm', { onclick: () => { RP.mark(s); renderReplay(); } }, s + ' dtk'))),
        h('div.row', h('label', 'Kecepatan'), ...[[0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, '100%']].map(([v, l]) => h('button.btn.sm' + (RP.speed === v ? '.on' : ''), { onclick: () => { RP.setSpeed(v); renderReplay(); } }, l))),
        h('div.row', h('button.btn.pri', { onclick: () => RP.playToProgram(null, true) }, '▶ Putar event terakhir ke Program (auto kembali)'),
          h('button.btn', { onclick: () => { RP.mark(8); RP.setSpeed(0.5); RP.playToProgram(null, true); renderReplay(); } }, '⚡ Tandai + putar slow-mo'))),
      h('div.sec', h('h4', 'Event (' + RP.events.length + ')'),
        RP.events.length ? h('div.list', RP.events.map((e) => h('div.li' + (RP.cur === e ? '.on' : ''), h('span.grow', e.name + ' • ' + e.sec.toFixed(1) + 's'),
          h('button.btn.sm', { title: 'Muat & putar di input replay', onclick: () => { RP.play(e.id); renderReplay(); } }, '▶'),
          h('button.btn.sm', { title: 'Putar ke Program', onclick: () => RP.playToProgram(e.id, true) }, '📺'),
          h('button.btn.sm', { onclick: () => { RP.remove(e.id); renderReplay(); } }, '✕')))) : h('p.muted', 'Aktifkan buffer, lalu tekan tombol "Tandai" (atau tombol M di keyboard) setelah momen penting.')),
      h('p.muted', 'Hotkey: M = tandai 8 detik. API: ReplayMark, ReplayPlayLastEventToOutput, ReplaySetSpeed.'));
  }

  // =================== KLMCAM & HP ===================
  // =================== KLMCAM (muncul bila ada input KLMCAM) ===================
  function renderPhone() {
    const box = KM.$('#dock-phone'), L = KM.link, urls = KM.dialogs.phoneUrls();
    const ae = document.activeElement; if (ae && box.contains(ae) && /INPUT|SELECT/.test(ae.tagName)) return; // sedang menggeser zoom / memilih
    const cams = S.inputs.filter((i) => i.type === 'klmcam');
    const u = urls[0] || {};
    const QS = [['720p30', '720p 30'], ['720p60', '720p 60'], ['1080p30', '1080p 30'], ['1080p60', '1080p 60']];
    const card = (inp) => {
      const peer = inp.rt.camId ? L.peers.get(inp.rt.camId) : null, tl = KM.engine.tallyOf(inp), o = inp.opts;
      const z = h('input', { type: 'range', min: 1, max: 10, step: 0.1, value: inp.rt.zoom || 1, title: 'Zoom', oninput: () => { inp.rt.zoom = +z.value; L.camControl(inp, 'zoom', +z.value); zv.textContent = (+z.value).toFixed(1) + '×'; } });
      const zv = h('span.muted', (inp.rt.zoom || 1).toFixed(1) + '×');
      const q = h('select', { title: 'Kualitas video HP', onchange: () => { o.quality = q.value; L.camControl(inp, 'quality', q.value); } }, QS.map(([v, l]) => h('option', { value: v, selected: v === o.quality }, l)));
      return h('div.sec.camq' + (tl === 'program' ? '.pgm' : tl === 'preview' ? '.pvw' : ''),
        h('div.row', h('b.grow', KM.inputNum(inp) + '. ' + inp.title),
          h('span.pill' + (peer ? '.ok' : '.warn'), peer ? 'Terhubung' : 'Menunggu HP slot ' + o.slot)),
        peer ? h('p.muted', { style: { margin: '4px 0 8px', fontSize: '11.5px' } }, (peer.name || peer.ip) + (peer.info ? ` • ${peer.info.w}×${peer.info.h} @${peer.info.fps}fps` : '') + (peer.info && peer.info.battery != null ? ' • 🔋 ' + peer.info.battery + '%' : '')) : null,
        h('div.row', { style: { gap: '4px', flexWrap: 'wrap' } },
          h('button.btn.sm' + (tl === 'preview' ? '.pri' : ''), { onclick: () => KM.engine.setPreview(inp.id), title: 'Ke Preview' }, 'PVW'),
          h('button.btn.sm' + (tl === 'program' ? '.red' : ''), { onclick: () => KM.engine.cut(inp.id), title: 'Cut ke Program' }, 'CUT'),
          h('button.btn.sm', { onclick: () => L.camControl(inp, 'switch', 1), title: 'Ganti kamera depan/belakang' }, '🔄 Balik'),
          h('button.btn.sm' + (inp.rt.torch ? '.pri' : ''), { onclick: () => { inp.rt.torch = !inp.rt.torch; L.camControl(inp, 'torch', inp.rt.torch); renderPhone(); }, title: 'Senter' }, '🔦'),
          h('button.btn.sm', { onclick: () => L.camControl(inp, 'focus', 'auto'), title: 'Fokus otomatis' }, '🎯 Fokus'),
          h('button.btn.sm', { onclick: () => L.restartCam(inp), title: 'Sambung ulang' }, '↻'),
          h('button.btn.sm', { onclick: () => KM.dialogs.inputSettings(inp), title: 'Pengaturan lengkap' }, '⚙')),
        h('div.row', { style: { marginTop: '6px', gap: '8px' } }, h('span.muted', 'Zoom'), z, zv, q));
    };
    box.replaceChildren(h('div.utcq',
      cams.length ? cams.map(card) : h('div.sec', h('p.muted', 'Belum ada input KLMCAM.')),
      h('div.sec', h('div.row', h('button.btn.pri', { style: { flex: 1 }, onclick: () => KM.dialogs.addInput('klmcam') }, KI.el('plus'), 'Tambah KLMCAM'))),
      h('details.sec', h('summary', '📱 Hubungkan HP — scan QR (Wi-Fi sama)'),
        h('div.row', { style: { alignItems: 'flex-start', marginTop: '8px' } }, KM.dialogs.qr(u.cam || u.hp || ''), h('div.grow',
          h('p', { style: { margin: '0 0 6px' } }, 'Kamera langsung (HTTPS):'), ...urls.map((x) => h('div.urlbox', x.cam)),
          h('p', { style: { margin: '8px 0 4px' } }, 'Menu HP:'), ...urls.map((x) => h('div.urlbox', x.hp)),
          h('p.muted', 'Atau aplikasi KLM Mix .apk → mode Kamera → IP: ' + urls.map((x) => x.ip).join(' / ') + ' • pilih slot yang sama.'))))));
  }

  // =================== PLAYLIST ===================
  function renderPlaylist() {
    const PL = KM.playlist, { sel } = H(), box = KM.$('#dock-playlist');
    const opts = S.inputs.map((i) => [i.id, KM.inputNum(i) + '. ' + i.title]);
    box.replaceChildren(
      h('div.sec', h('div.row',
        h('button.btn' + (PL.running ? '.red' : '.green'), { onclick: () => { PL.running ? PL.stop() : PL.start(); renderPlaylist(); } }, PL.running ? '■ Stop' : '▶ Mulai'),
        h('button.btn', { onclick: () => PL.prev() }, '⏮'), h('button.btn', { onclick: () => PL.next() }, '⏭'),
        sel(Object.entries(KM.engine.TRANSITIONS).filter(([k]) => !k.startsWith('stinger')), PL.type, (v) => { PL.type = v; }),
        h('input', { type: 'number', value: PL.dur, step: 100, style: { width: '70px' }, title: 'Durasi transisi (ms)', onchange: (e) => { PL.dur = +e.target.value; } }),
        H().chk('Ulang', PL.loop, (v) => { PL.loop = v; }))),
      h('div.sec', h('h4', 'Urutan (' + PL.items.length + ')'),
        h('div.list', PL.items.map((it, i) => h('div.li' + (i === PL.idx && PL.running ? '.on' : ''),
          h('b', String(i + 1)),
          sel(opts, it.inputId, (v) => { it.inputId = v; }),
          h('input', { type: 'number', value: it.dur, min: 0, style: { width: '62px' }, title: 'Durasi detik (0 = sampai video selesai)', onchange: (e) => { it.dur = +e.target.value; } }),
          h('span.muted', 'dtk'),
          h('button.btn.sm', { onclick: () => { if (i > 0) { [PL.items[i - 1], PL.items[i]] = [PL.items[i], PL.items[i - 1]]; renderPlaylist(); } } }, '↑'),
          h('button.btn.sm', { onclick: () => PL.goto(i) }, '▶'),
          h('button.btn.sm', { onclick: () => { PL.removeAt(i); renderPlaylist(); } }, '✕')))),
        h('div.row', { style: { marginTop: '8px' } }, h('button.btn.pri', { onclick: () => { if (S.previewId) { const pv = KM.getInput(S.previewId); PL.add(S.previewId, KM.inputs.isPlayable(pv) ? 0 : 10); renderPlaylist(); } } }, '＋ Tambah input preview'),
          h('span.muted', 'Durasi 0 = video diputar sampai habis.'))));
  }

  // =================== SKRIP ===================
  function renderScripts() {
    const box = KM.$('#dock-script'), SC = KM.script, list = SC.list();
    const save = () => KM.saveSettings();
    box.replaceChildren(
      h('div.sec', h('div.row', h('button.btn.pri', { onclick: () => { list.push({ id: KM.uid(), name: 'Skrip ' + (list.length + 1), code: SC.sample }); save(); renderScripts(); } }, '＋ Skrip baru'),
        h('button.btn.red', { onclick: () => SC.stopAll() }, '■ Stop semua'),
        h('span.muted', 'JavaScript. Jalankan via tombol, shortcut, trigger, Stream Deck (ScriptStart).'))),
      ...list.map((s) => {
        const run = SC.running.has(s.id);
        const ta = h('textarea', { rows: 8, value: s.code, spellcheck: false, style: { width: '100%', font: '12px Consolas, monospace' }, onchange: () => { s.code = ta.value; save(); } });
        return h('div.sec', h('div.row',
          h('input.grow', { value: s.name, onchange: (e) => { s.name = e.target.value; save(); } }),
          run ? h('button.btn.red', { onclick: () => SC.stop(s.id) }, '■ Stop') : h('button.btn.green', { onclick: () => { s.code = ta.value; save(); SC.run(s.id); } }, '▶ Jalankan'),
          h('button.btn.sm', { onclick: async () => { if (await KM.ui.confirm('Hapus skrip "' + s.name + '"?', 'Hapus')) { KM.settings.scripts = list.filter((x) => x !== s); save(); renderScripts(); } } }, '🗑')),
          ta, s.log ? h('pre', { style: { margin: '6px 0 0', maxHeight: '90px', overflow: 'auto', fontSize: '11px', color: 'var(--tx2)', userSelect: 'text' } }, s.log) : null);
      }));
  }
  KM.on('script-log', () => { if (DK.cur === 'script') renderScripts(); });

  // =================== UTC KLM ACARA (kontrol cepat) ===================
  let utcPresets = null;
  // =================== UTC ACARA (muncul bila ada input UTC Acara) ===================
  let tkDraft = null, acPending = false;
  const typingIn = (box) => { const a = document.activeElement; return a && box.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'range' && a.type !== 'checkbox'; };
  function renderAcara() {
    const box = KM.$('#dock-acara'), U = KM.utc, st = U.status || {}, vis = st.visible || {};
    let spv = null;
    if (typingIn(box)) { acPending = true; return; } // jangan ganggu yang sedang mengetik
    acPending = false;
    const run = async (cmd, target, extra) => { const r = await U.cmd(cmd, target, extra); if (!r.ok) KM.toast(r.msg || 'Gagal', 'warn'); return r; };
    const TI = { lt: 'rect', tt: 'title', tk: 'type', bug: 'image', loc: 'target', soc: 'share' };
    const tg = (k, label) => h('button.tg' + (vis[k] ? '.on' : ''), { title: (vis[k] ? 'Sembunyikan ' : 'Tampilkan ') + label, onclick: () => run('toggle', k) }, KI.el(TI[k]), label);
    const items = (k, list, actId, lbl, nameOf) => list && list.length ? h('div.sec', h('h4', lbl, vis[k] ? h('span.pill.ok', { style: { marginLeft: '6px' } }, 'TAMPIL') : null),
      h('div.row', h('button.btn.sm', { title: 'Sebelumnya', onclick: () => run('prev', k, { show: true }) }, KI.el('chev-left')), h('button.btn.sm', { title: 'Berikutnya', onclick: () => run('next', k, { show: true }) }, KI.el('chev-right')),
        h('button.btn.sm' + (vis[k] ? '.red' : ''), { onclick: () => run('toggle', k) }, vis[k] ? 'Sembunyikan' : 'Tampilkan'),
        h('span.grow'), h('span.muted', { style: { fontSize: '11px' } }, 'klik nama = pilih & tampilkan')),
      h('div.items', list.map((x, i) => h('button.btn.sm' + (x.id === actId ? '.act' : ''), { title: [x.label, nameOf(x)].filter(Boolean).join(' • '), onclick: () => run('select', k, { name: String(i + 1) }) }, (i + 1) + '. ' + (nameOf(x) || x.label || '—'))))) : null;
    const presetSel = h('select', { style: { flex: 1 } }, h('option', { value: '' }, utcPresets ? (utcPresets.length ? '— pilih preset —' : '(belum ada preset)') : 'memuat…'),
      (utcPresets || []).map((p) => h('option', { value: p.name }, p.name)));
    if (!utcPresets) fetch('/utc/api/presets').then((r) => r.json()).then((l) => { utcPresets = l; if (DK.cur === 'acara') renderAcara(); }).catch(() => { utcPresets = []; });
    const evSel = h('select', { style: { flex: 1 }, title: 'Jenis acara', onchange: () => run('event', '', { name: evSel.value }) }, (st.events || []).map((e) => h('option', { value: e.id, selected: e.id === st.eventType }, e.n)));
    // ---- running text: judul + banyak baris, edit & simpan dari sini ----
    if (st.tk && (!tkDraft || !tkDraft.dirty)) tkDraft = { dirty: false, badge: st.tk.badge, speed: st.tk.speed, items: st.tk.items.map((x) => Object.assign({}, x)) };
    const dirty = () => { if (tkDraft) { tkDraft.dirty = true; saveBar.classList.add('dirty'); } };
    const saveTk = async (show) => {
      const r = await run('tkset', '', { items: tkDraft.items, badge: tkDraft.badge, speed: tkDraft.speed, show: show ? true : undefined });
      if (r && r.ok) { tkDraft.dirty = false; KM.toast(show ? 'Running text disimpan & ditampilkan' : 'Running text disimpan', 'ok'); renderAcara(); }
    };
    const saveBar = h('div.row.tksave', { style: { marginTop: '8px' } },
      h('button.btn.pri', { onclick: () => saveTk(true), title: 'Simpan lalu tampilkan running text' }, KI.el('play'), 'Simpan & Tampilkan'),
      h('button.btn', { onclick: () => saveTk(false) }, KI.el('save'), 'Simpan'),
      h('button.btn', { title: 'Batalkan perubahan', onclick: () => { tkDraft = null; renderAcara(); } }, 'Batal'));
    const tkSec = tkDraft ? h('div.sec.tkq', h('h4', 'Running Text', vis.tk ? h('span.pill.ok', { style: { marginLeft: '6px' } }, 'TAMPIL') : null),
      h('div.row', h('label.muted', { style: { width: '74px' } }, 'Label kiri'), h('input', { style: { flex: 1 }, value: tkDraft.badge || '', placeholder: 'INFO', oninput: (e) => { tkDraft.badge = e.target.value; dirty(); } }),
        h('button.btn.sm' + (vis.tk ? '.red' : ''), { onclick: () => run('toggle', 'tk') }, vis.tk ? 'Sembunyikan' : 'Tampilkan')),
      h('div.tkl', tkDraft.items.map((it, i) => h('div.tki' + (it.on ? '' : '.off'),
        h('div.row', h('input', { type: 'checkbox', checked: it.on, title: 'Ikut berjalan', onchange: (e) => { it.on = e.target.checked; dirty(); e.target.closest('.tki').classList.toggle('off', !it.on); } }),
          h('input.ttl', { style: { flex: 1 }, value: it.title || '', placeholder: 'Judul pesan ' + (i + 1) + ' (opsional)', oninput: (e) => { it.title = e.target.value; dirty(); } }),
          h('button.btn.sm', { title: 'Naik', disabled: i === 0, onclick: () => { tkDraft.items.splice(i - 1, 0, tkDraft.items.splice(i, 1)[0]); dirty(); renderAcara(); } }, '↑'),
          h('button.btn.sm', { title: 'Hapus pesan', onclick: () => { tkDraft.items.splice(i, 1); dirty(); renderAcara(); } }, '✕')),
        h('textarea', { rows: Math.min(6, Math.max(2, String(it.text || '').split('\n').length)), value: it.text || '', placeholder: 'Isi teks — boleh banyak baris (Enter = baris baru, tiap baris berjalan berurutan)', oninput: (e) => { it.text = e.target.value; dirty(); } })))),
      h('div.row', { style: { marginTop: '6px' } }, h('button.btn.sm', { onclick: () => { tkDraft.items.push({ title: '', text: '', on: true }); dirty(); renderAcara(); } }, KI.el('plus'), 'Tambah pesan'), h('span.grow'),
        h('span.muted', 'Kecepatan'), h('input', { type: 'range', min: 30, max: 400, step: 5, value: tkDraft.speed || 120, style: { width: '110px' }, oninput: (e) => { tkDraft.speed = +e.target.value; dirty(); spv.textContent = e.target.value; } }), spv = h('span.muted', String(tkDraft.speed || 120))),
      saveBar) : null;
    if (tkDraft && tkDraft.dirty) saveBar.classList.add('dirty');
    box.replaceChildren(h('div.utcq',
      h('div.sec',
        h('button.btn.air' + (U.onAir() ? '.on' : ''), { onclick: () => U.setOnAir(), title: 'Tampilkan / sembunyikan grafis UTC Acara di atas Program' }, KI.el(U.onAir() ? 'radio' : 'eye'), U.onAir() ? 'UTC ACARA ON AIR' : 'UTC Acara tidak tayang — klik untuk tayang'),
        h('div.live', { innerHTML: U.liveInfo() }),
        h('div.row', evSel, h('button.btn.pri', { onclick: () => KM.ui.utcPanel(true, 'acara'), title: 'Panel lengkap: atur, edit, simpan, tambah & ubah (F9)' }, KI.el('clapper'), 'Panel lengkap'))),
      h('div.sec', h('h4', 'Tampilkan / sembunyikan'),
        h('div.grid', tg('lt', 'Lower Third'), tg('tt', 'Title'), tg('tk', 'Running Text'), tg('bug', 'Logo'), tg('loc', 'Lokasi'), tg('soc', 'Sosmed')),
        h('div.row', { style: { marginTop: '6px' } },
          h('button.btn.sm' + (st.oc && st.oc.kind === 'opening' ? '.pri' : ''), { onclick: () => run('opening') }, KI.el('play'), 'Opening'),
          h('button.btn.sm' + (st.oc && st.oc.kind === 'closing' ? '.pri' : ''), { onclick: () => run('closing') }, KI.el('moon'), 'Closing'),
          st.oc ? h('button.btn.sm', { onclick: () => run('ocoff') }, KI.el('x'), 'Hentikan') : null,
          h('span.grow'), h('button.btn.sm.red', { title: 'Sembunyikan semua grafis', onclick: () => run('hideall') }, KI.el('ban'), 'Semua OFF'))),
      items('lt', st.lists && st.lists.lt, st.activeId && st.activeId.lt, 'Lower Third', (x) => x.name),
      items('tt', st.lists && st.lists.tt, st.activeId && st.activeId.tt, 'Title', (x) => x.title),
      tkSec,
      items('loc', st.ll && st.ll.loc, st.activeId && st.activeId.loc, 'Lokasi', (x) => x.place),
      items('soc', st.ll && st.ll.soc, st.activeId && st.activeId.soc, 'Sosial Media', (x) => x.label + (x.handle ? ' • ' + x.handle : '')),
      h('div.sec', h('h4', 'Preset acara'),
        h('div.row', presetSel, h('button.btn', { onclick: async () => { if (!presetSel.value) return; await run('preset', '', { name: presetSel.value }); tkDraft = null; KM.toast('Preset dimuat: ' + presetSel.value, 'ok'); } }, KI.el('download'), 'Muat'),
          h('button.btn', { title: 'Muat ulang daftar', onclick: () => { utcPresets = null; renderAcara(); } }, KI.el('refresh'))),
        h('p.muted', { style: { fontSize: '11px', marginTop: '6px' } }, 'Tema, animasi, posisi, logo, video opening/closing & simpan preset ada di Panel lengkap. Dari HP: ' + (KM.link.ips[0] ? 'http://' + KM.link.ips[0].address + ':' + (KM.link.ports.http || 8620) + '/utc' : '/utc')))));
  }
  KM.$('#dock-acara') && KM.$('#dock-acara').addEventListener('focusout', () => setTimeout(() => { if (acPending && DK.cur === 'acara') renderAcara(); }, 120));

  // =================== UTC SCORE (muncul bila ada input UTC Score) ===================
  function renderScore() {
    const box = KM.$('#dock-score'), SC = KM.score, st = SC.status;
    const c = (cmd, label, title, cls) => h('button.btn.sm' + (cls || ''), { title: title || '', onclick: async () => { const r = await SC.cmd(cmd); if (!r.ok) KM.toast(/belum dibuka/.test(r.msg) ? 'Panel UTC Score sedang dimuat… coba lagi sebentar' : 'UTC Score: ' + r.msg, 'warn'); } }, label);
    const head = h('div.sec',
      h('button.btn.air' + (SC.onAir() ? '.on' : ''), { onclick: () => SC.setOnAir(), title: 'Tampilkan / sembunyikan scoreboard di atas Program' }, KI.el(SC.onAir() ? 'radio' : 'eye'), SC.onAir() ? 'UTC SCORE ON AIR' : 'UTC Score tidak tayang — klik untuk tayang'),
      h('div.row', { style: { marginTop: '8px' } },
        h('button.btn.pri', { style: { flex: 1 }, onclick: () => KM.ui.utcPanel(true, 'score'), title: 'Panel lengkap: tim, logo, warna, aturan, turnamen, preset (F9)' }, KI.el('trophy'), 'Panel lengkap'),
        h('button.btn', { title: 'Layar arena / videotron (monitor ke-2)', onclick: () => { if (SC.port) window.open(SC.url('/arena'), 'klm_score_arena'); } }, KI.el('monitor'), 'Arena')));
    if (!st || !st.port) { box.replaceChildren(h('div.utcq', head, h('div.sec', h('p.muted', 'Menyalakan UTC Score…')))); return; }
    const sp = st.sport || 'football', sc = st.score || [0, 0], fo = st.fouls || [0, 0], to = st.to || [0, 0], cd = st.cards || [{}, {}];
    const team = (i) => h('div.tm', h('i', { style: { background: (i ? st.awayColor : st.homeColor) || (i ? '#1D5FD1' : '#D62839') } }), h('b', i ? st.away : st.home));
    const SPN = { football: 'Sepak Bola', futsal: 'Futsal', volleyball: 'Bola Voli', basketball: 'Bola Basket', badminton: 'Bulu Tangkis' };
    const spSel = h('select', { title: 'Cabang olahraga', onchange: () => SC.cmd('sport-' + spSel.value) }, Object.entries(SPN).map(([k, n]) => h('option', { value: k, selected: k === sp }, n)));
    const rally = sp === 'volleyball' || sp === 'badminton';
    const side = (k, i) => h('div.col',
      c(k + '+1', '+1', 'Tambah skor ' + (i ? st.away : st.home), '.pri.big'),
      sp === 'basketball' ? h('div.row', c(k + '+2', '+2', 'Dua angka'), c(k + '+3', '+3', 'Tiga angka')) : null,
      c(k + '-1', '−1', 'Kurangi skor'));
    box.replaceChildren(h('div.utcq.scoreq', head,
      h('div.sec',
        h('div.sbx', team(0), h('div.scr', h('span.n', String(sc[0])), h('span.d', ':'), h('span.n', String(sc[1]))), team(1)),
        h('div.sbm', h('span', st.periodText || ('Babak ' + st.period)), st.clockText ? h('b' + (st.running ? '.run' : ''), st.clockText) : null, h('span.grow'), spSel),
        h('div.sides', side('home', 0), side('away', 1))),
      h('div.sec', h('h4', rally ? 'Set & servis' : 'Jam pertandingan'),
        h('div.row', { style: { flexWrap: 'wrap', gap: '4px' } },
          rally ? null : c('clock', st.running ? '⏸ Jeda jam' : '▶ Mulai jam', 'Mulai / hentikan jam', st.running ? '.red' : '.pri'),
          rally ? null : c('reset', 'Reset jam', 'Reset jam babak ini'),
          rally ? null : c('clock-1', '−1 dtk'), rally ? null : c('clock+1', '+1 dtk'),
          c('prev', rally ? 'Set −' : 'Babak −', 'Babak / set sebelumnya'), c('next', rally ? 'Set +' : 'Babak +', 'Babak / set berikutnya'),
          sp === 'football' ? c('added+1', '+1 mnt tambahan', 'Tambah waktu tambahan') : null,
          sp === 'basketball' ? c('shot24', 'Shot 24') : null, sp === 'basketball' ? c('shot14', 'Shot 14') : null, sp === 'basketball' ? c('poss', 'Possession ⇄') : null,
          rally ? c('serve-home', 'Servis ' + st.home) : null, rally ? c('serve-away', 'Servis ' + st.away) : null)),
      rally ? null : h('div.sec', h('h4', 'Foul, kartu & timeout'),
        h('div.ftab',
          h('span'), h('b', st.home), h('b', st.away),
          h('span.muted', 'Foul'), h('div.row', c('foul-home', '+' + ' (' + (fo[0] || 0) + ')'), c('foul-home-', '−')), h('div.row', c('foul-away', '+' + ' (' + (fo[1] || 0) + ')'), c('foul-away-', '−')),
          sp === 'football' || sp === 'futsal' ? [h('span.muted', 'Kuning'), h('div.row', c('yellow-home', '🟨 +' + ((cd[0] && cd[0].y) || 0))), h('div.row', c('yellow-away', '🟨 +' + ((cd[1] && cd[1].y) || 0)))] : null,
          sp === 'football' || sp === 'futsal' ? [h('span.muted', 'Merah'), h('div.row', c('red-home', '🟥 +' + ((cd[0] && cd[0].r) || 0))), h('div.row', c('red-away', '🟥 +' + ((cd[1] && cd[1].r) || 0)))] : null,
          sp !== 'football' ? [h('span.muted', 'Timeout'), h('div.row', c('to-home', '+ (' + (to[0] || 0) + ')')), h('div.row', c('to-away', '+ (' + (to[1] || 0) + ')'))] : null,
          sp === 'football' || sp === 'futsal' ? [h('span.muted', 'Ganti pemain'), h('div.row', c('sub-home', '⇄')), h('div.row', c('sub-away', '⇄'))] : null)),
      h('div.sec', h('h4', 'Tampilan'),
        h('div.row', { style: { flexWrap: 'wrap', gap: '4px' } },
          c('overlay', st.visible ? 'Sembunyikan papan skor' : 'Tampilkan papan skor', 'Papan skor di overlay', st.visible ? '.red' : '.pri'),
          c('lower', (st.lower ? '■ ' : '') + 'Lower', 'Lower third scoreboard'), c('ticker', (st.ticker ? '■ ' : '') + 'Ticker', 'Running text scoreboard'),
          rally ? null : c('goalpopup-home', 'GOL ' + st.home, 'Popup gol tuan rumah'), rally ? null : c('goalpopup-away', 'GOL ' + st.away, 'Popup gol tamu'),
          c('scorepopup', 'Popup skor'), c('clearpopup', 'Tutup popup'),
          c('swap', '⇄ Tukar sisi', 'Tukar posisi tim'), c('undo', '↶ Undo', 'Batalkan langkah terakhir'))),
      h('p.muted', { style: { fontSize: '11px', margin: '0 2px 8px' } }, 'Dari HP: http://' + ((KM.link.ips[0] && KM.link.ips[0].address) || location.hostname) + ':' + st.port + '/hp • data vMix/OBS: :' + st.port + '/data.json')));
  }
  KM.on('change', (w) => {
    if (w === 'utc' && DK.cur === 'acara') { clearTimeout(renderAcara.t); renderAcara.t = setTimeout(renderAcara, 60); }
    if (w === 'score' && DK.cur === 'score') { clearTimeout(renderScore.t); renderScore.t = setTimeout(renderScore, 80); }
    if ((w === 'inputs' || w === 'input' || w === 'tally' || w === 'preview' || w === 'program') && DK.cur === 'phone') { clearTimeout(renderPhone.t); renderPhone.t = setTimeout(renderPhone, 120); }
  });

  const R = { acara: renderAcara, score: renderScore, ptz: () => KM.ptz.render(KM.$('#dock-ptz')), script: renderScripts, audio: renderAudio, title: renderTitle, replay: renderReplay, phone: renderPhone, playlist: renderPlaylist };
  DK.render = function (tab) { DK.cur = tab; try { R[tab](); } catch (e) { console.error('dock', e); } };
  let t;
  KM.on('change', (w) => {
    if (w === 'tbar' || w === 'audio-vol') return;
    clearTimeout(t);
    t = setTimeout(() => {
      const c = DK.cur;
      if (c === 'audio' && (w === 'audio' || w === 'inputs' || w === 'input')) renderAudio();
      else if (c === 'title' && (w === 'inputs' || w === 'overlay')) renderTitle();
      else if (c === 'replay' && w === 'replay') renderReplay();
      else if (c === 'phone' && (w === 'peers' || w === 'link' || w === 'inputs')) renderPhone();
      else if (c === 'playlist' && (w === 'playlist' || w === 'inputs')) renderPlaylist();
      else if (c === 'ptz' && w === 'inputs') R.ptz();
      else if (c === 'script' && (w === 'script' || w === 'settings')) renderScripts();
    }, 120);
  });
})(window.KM);
