/* KLM Mix - panel kanan: Mixer Audio, Title UTC KLM Acara, Instant Replay, KLMCAM & HP, Playlist */
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
  function renderPhone() {
    const box = KM.$('#dock-phone'), L = KM.link, urls = KM.dialogs.phoneUrls();
    const cams = [...L.peers.values()].filter((p) => p.role === 'camera');
    const rems = [...L.peers.values()].filter((p) => p.role === 'remote');
    const u = urls[0] || {};
    box.replaceChildren(
      h('div.sec', h('h4', '📱 Hubungkan HP — scan QR (Wi-Fi sama)'),
        h('div.row', { style: { alignItems: 'flex-start' } }, KM.dialogs.qr(u.hp || ''), h('div.grow',
          h('p', { style: { margin: '0 0 6px' } }, 'Menu HP (pilih Kamera / Remote / Title):'), ...urls.map((x) => h('div.urlbox', x.hp)),
          h('p', { style: { margin: '8px 0 4px' } }, 'Langsung kamera (HTTPS):'), ...urls.map((x) => h('div.urlbox', x.cam)),
          h('p.muted', 'Atau pakai aplikasi KLM Mix .apk → masukkan IP: ' + urls.map((x) => x.ip).join(' / '))))),
      h('div.sec', h('h4', 'Kamera KLMCAM (' + cams.length + ')'),
        cams.length ? h('div.list', cams.map((p) => {
          const inp = S.inputs.find((i) => i.rt.camId === p.id);
          const tl = inp ? KM.engine.tallyOf(inp) : 'off';
          return h('div.li' + (tl === 'program' ? '.on' : ''),
            h('span', '📱'), h('span.grow', 'Slot ' + p.slot + ' • ' + (p.name || p.ip) + (p.info ? ` • ${p.info.w}×${p.info.h}@${p.info.fps}` : '') + (p.info && p.info.battery != null ? ' • 🔋' + p.info.battery + '%' : '')),
            h('span.pill' + (p.state === 'connected' ? '.ok' : '.warn'), p.state || 'menunggu'),
            inp ? h('button.btn.sm', { title: 'Ke preview', onclick: () => KM.engine.setPreview(inp.id) }, 'PVW') : h('button.btn.sm', { onclick: () => KM.inputs.create('klmcam', { title: 'KLMCAM ' + p.slot, opts: { slot: p.slot } }) }, '＋ Input'),
            inp ? h('button.btn.sm', { title: 'Kontrol kamera', onclick: () => KM.dialogs.inputSettings(inp) }, '⚙') : null);
        })) : h('p.muted', 'Belum ada HP kamera terhubung.')),
      h('div.sec', h('h4', 'Remote / kontrol HP (' + rems.length + ')'),
        rems.length ? h('div.list', rems.map((p) => h('div.li', h('span', '🎛'), h('span.grow', (p.name || 'Remote') + ' • ' + p.ip)))) : h('p.muted', 'Buka ' + (u.remote || '/remote') + ' di HP untuk mengontrol switcher, overlay, title & audio dari HP.')));
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
  function renderUtc() {
    const box = KM.$('#dock-utc'), U = KM.utc, st = U.status || {}, vis = st.visible || {};
    const run = async (cmd, target, extra) => { const r = await U.cmd(cmd, target, extra); if (!r.ok) KM.toast(r.msg || 'Gagal', 'warn'); };
    const TI = { lt: 'rect', tt: 'title', tk: 'type', bug: 'image', loc: 'target', soc: 'share' };
    const tg = (k, label) => h('button.tg' + (vis[k] ? '.on' : ''), { title: (vis[k] ? 'Sembunyikan ' : 'Tampilkan ') + label, onclick: () => run('toggle', k) }, KI.el(TI[k]), label);
    const items = (k, list, actId, lbl) => list && list.length ? h('div.sec', h('h4', lbl),
      h('div.row', h('button.btn.sm', { title: 'Sebelumnya', onclick: () => run('prev', k, { show: true }) }, KI.el('chev-left'), 'Sebelumnya'), h('button.btn.sm', { title: 'Berikutnya', onclick: () => run('next', k, { show: true }) }, 'Berikutnya', KI.el('chev-right')),
        h('span.grow'), h('span.muted', { style: { fontSize: '11px' } }, 'klik = pilih & tampilkan')),
      h('div.items', list.map((x, i) => h('button.btn.sm' + (x.id === actId ? '.act' : ''), { title: [x.label, x.name || x.title, x.role].filter(Boolean).join(' • '), onclick: () => run('select', k, { name: String(i + 1) }) }, (i + 1) + '. ' + (x.name || x.title || x.label || '—'))))) : null;
    const presetSel = h('select', { style: { flex: 1 } }, h('option', { value: '' }, utcPresets ? (utcPresets.length ? '— pilih preset —' : '(belum ada preset)') : 'memuat…'),
      (utcPresets || []).map((p) => h('option', { value: p.name }, p.name)));
    if (!utcPresets) fetch('/utc/api/presets').then((r) => r.json()).then((l) => { utcPresets = l; if (DK.cur === 'utc') renderUtc(); }).catch(() => { utcPresets = []; });
    box.replaceChildren(h('div.utcq',
      h('div.sec',
        h('button.btn.air' + (U.onAir() ? '.on' : ''), { onclick: () => U.setOnAir(), title: 'Tampilkan / sembunyikan semua grafis UTC dari Program' }, KI.el(U.onAir() ? 'radio' : 'eye'), U.onAir() ? 'UTC ON AIR di Program' : 'UTC tidak tayang — klik untuk menayangkan'),
        h('div.live', { innerHTML: U.liveInfo() }),
        h('div.row', h('button.btn.pri', { style: { flex: 1 }, onclick: () => KM.ui.utcPanel(true) }, KI.el('clapper'), 'Buka Panel Lengkap', h('kbd', { style: { marginLeft: '4px', color: '#cfe2ff', borderColor: 'rgba(255,255,255,.3)', background: 'transparent' } }, 'F9')),
          h('button.btn', { title: 'Jadikan input KLM Mix (Overlay 1–4, layer, multiview)', onclick: () => { U.addInput(); KM.toast('Input "Grafis UTC KLM Acara" siap', 'ok'); } }, KI.el('plus'), 'Input'))),
      h('div.sec', h('h4', 'Tampilkan / sembunyikan'),
        h('div.grid', tg('lt', 'Lower Third'), tg('tt', 'Title'), tg('tk', 'Running Text'), tg('bug', 'Logo'), tg('loc', 'Lokasi'), tg('soc', 'Sosmed')),
        h('div.row', { style: { marginTop: '6px' } },
          h('button.btn.sm' + (st.oc && st.oc.kind === 'opening' ? '.pri' : ''), { onclick: () => run('opening') }, KI.el('play'), 'Opening'),
          h('button.btn.sm' + (st.oc && st.oc.kind === 'closing' ? '.pri' : ''), { onclick: () => run('closing') }, KI.el('moon'), 'Closing'),
          st.oc ? h('button.btn.sm', { onclick: () => run('ocoff') }, KI.el('x'), 'Hentikan') : null,
          h('span.grow'), h('button.btn.sm.red', { title: 'Sembunyikan semua grafis', onclick: () => run('hideall') }, KI.el('ban'), 'Semua OFF'))),
      items('lt', st.lists && st.lists.lt, st.activeId && st.activeId.lt, 'Lower Third'),
      items('tt', st.lists && st.lists.tt, st.activeId && st.activeId.tt, 'Title'),
      h('div.sec', h('h4', 'Preset acara'),
        h('div.row', presetSel, h('button.btn', { onclick: async () => { if (!presetSel.value) return; await run('preset', '', { name: presetSel.value }); KM.toast('Preset dimuat: ' + presetSel.value, 'ok'); } }, KI.el('download'), 'Muat'),
          h('button.btn', { title: 'Muat ulang daftar', onclick: () => { utcPresets = null; renderUtc(); } }, KI.el('refresh'))),
        h('p.muted', { style: { fontSize: '11px', marginTop: '6px' } }, 'Ubah teks, tema, animasi, posisi, logo, video opening/closing & simpan preset di Panel Lengkap. Bisa juga dari HP: ' + (KM.link.ips[0] ? 'http://' + KM.link.ips[0].address + ':' + (KM.link.ports.http || 8620) + '/utc' : '/utc'))))
    );
  }
  KM.on('change', (w) => { if (w === 'utc' && DK.cur === 'utc') { clearTimeout(renderUtc.t); renderUtc.t = setTimeout(renderUtc, 60); } });

  const R = { utc: renderUtc, ptz: () => KM.ptz.render(KM.$('#dock-ptz')), script: renderScripts, audio: renderAudio, title: renderTitle, replay: renderReplay, phone: renderPhone, playlist: renderPlaylist };
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
