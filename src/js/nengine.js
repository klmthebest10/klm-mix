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
 * Bila monitor menampilkan hal lain (KLMCAM, video, overlay, efek, transisi selain fade/cut,
 * mode grid) atau ada menu/dialog di atas monitor, monitor itu otomatis kembali ke tampilan JS — tanpa kedip.
 */
'use strict';
(function (KM) {
  const N = KM.nengine = { pvw: false, pgm: false, state: 'off', adapter: '', fps: 0, mem: 0, ms: 0, why: { pvw: '', pgm: '' }, available: false };
  const el = () => !!(window.klm && window.klm.isElectron && window.klm.send);
  if (KM.settings.nativeEngine == null) KM.settings.nativeEngine = false;
  if (KM.settings.nativeCam == null) KM.settings.nativeCam = true; // berlaku hanya bila mesin native menyala

  let running = false, ready = false, frameN = 0;
  const srcSent = new Map();   // id native → spesifikasi terakhir
  const srcErr = new Set();    // id native yang gagal di mesin (mis. layar di GPU lain) → selalu tampilan JS
  const scr = new Map();       // sourceId layar → {x,y,w,h} | null (sedang/ gagal dicari)
  const bus = {
    pvw: { want: false, shown: false, hideAt: -1, rect: '', id: null },
    pgm: { want: false, shown: false, hideAt: -1, rect: '', id: null }
  };
  let out = '', transKey = '', tbarSent = '';
  // Fase 2: grafis UTC
  let utcWant = false, ulaySent = null, utcErr = '';
  const uready = new Set();
  const cmd = (l) => { if (running) window.klm.send('nengine:cmd', l); };
  const nid = (inp) => 'i' + String(inp.id).replace(/[^\w.-]/g, '_').slice(0, 60);

  // ---------- sumber yang bisa dirender native ----------
  const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); if (!m) return null; const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const plainPos = (p) => !p || (!p.x && !p.y && (p.zoom == null || p.zoom === 1) && !p.cropL && !p.cropR && !p.cropT && !p.cropB && !p.rot && (p.fit || 'fit') === 'fit');
  function resolveScreen(id) {
    if (scr.has(id)) return; scr.set(id, null);
    window.klm.invoke('nengine:screen-rect', id).then((r) => { scr.set(id, r || false); }).catch(() => scr.set(id, false));
  }
  function spec(inp) {
    if (!inp) return null;
    if (srcErr.has(nid(inp))) return null;
    if (!plainPos(inp.pos) || (inp.layers && inp.layers.length)) return null;
    try { if (KM.fx && KM.fx.needs(inp)) return null; if (KM.seg && KM.seg.on(inp)) return null; } catch (e) { return null; }
    const o = inp.opts || {};
    if (inp.type === 'colour') {
      const a = hex(o.color), b = hex(o.color2 || '#000000'); if (!a || !b) return null;
      return 'colour ' + a.join(' ') + ' ' + b.join(' ') + ' ' + ({ linear: 1, radial: 2 }[o.grad] || 0);
    }
    if (inp.type === 'bars') return 'bars';
    if (inp.type === 'camera') { const c = inp.rt.ncam && cams.get(inp.rt.ncam); return c && c.frames > 0 ? 'cam' : null; }
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
  // tanpa memperhitungkan grafis UTC
  function pgmBaseWhy() {
    const S = KM.state;
    if (S.ftb && (S.ftb.on || S.ftb.v > 0)) return 'FTB';
    if ((S.overlays || []).some((ch) => ch.phase !== 'off' && ch.inputId)) return 'overlay aktif';
    if (S.trans) {
      if (S.trans.type !== 'fade' && S.trans.type !== 'cut') return 'transisi ' + S.trans.type;
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
  function pvwWhy() {
    const S = KM.state, E = KM.engine;
    if (E.gridActive && E.gridActive()) return 'mode grid';
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
    const eid = (i) => (i.type === 'camera' && i.rt.ncam ? i.rt.ncam : nid(i));
    const add = (id) => { const i = id && KM.getInput(id); const s = i && spec(i); if (s) need.set(eid(i), s); };
    add(S.previewId); add(S.programId); if (S.trans) { add(S.trans.fromId); add(S.trans.toId); }
    for (const [k, s] of need) if (s !== 'cam' && srcSent.get(k) !== s) { srcSent.set(k, s); cmd('src ' + k + ' ' + s); }
    for (const k of [...srcSent.keys()]) if (!need.has(k)) { srcSent.delete(k); cmd('del ' + k); }
    const idOf = (id) => { const i = id && KM.getInput(id); return i && need.has(eid(i)) ? eid(i) : '-'; };
    // transisi: fade otomatis dikirim sekali; T-bar manual dikirim posisinya
    const tr = S.trans;
    if (tr && tr.type === 'fade' && !tr.manual) {
      const k = tr.fromId + '>' + tr.toId + '@' + tr.t0;
      if (k !== transKey) { transKey = k; cmd('trans ' + Math.max(1, Math.round(tr.dur || 1)) + ' ' + idOf(tr.fromId) + ' ' + idOf(tr.toId)); }
    } else if (tr && tr.manual) {
      const v = Math.round(KM.clamp(tr.p || 0, 0, 1) * 1000) + ' ' + idOf(tr.fromId) + ' ' + idOf(tr.toId);
      if (v !== tbarSent) { tbarSent = v; cmd('tbar ' + v); }
    } else {
      if (tbarSent) { tbarSent = ''; cmd('tbar off'); }
      transKey = tr ? transKey : '';
    }
    // grafis UTC: tekstur lapisan diminta dari proses utama selama Program bisa ditampilkan native
    const base = pgmBaseWhy(), U = KM.utc;
    const uw = !base && !utcErr && !!(U && U.zc && U.zc.on && U.dskIds);
    if (uw !== utcWant) { utcWant = uw; window.klm.send('nengine:utc', uw); if (!uw) { uready.clear(); ulaySent = null; } }
    const ids = utcWant ? U.dskIds() : [];
    if (utcWant) { const l = ids.join(',') || '-'; if (l !== ulaySent) { ulaySent = l; cmd('ulay ' + l); } }
    const pgWhy = base || utcWhy(U && U.dskIds ? (utcWant ? ids : U.dskIds()) : []);
    const pg = idOf(S.programId), pv = idOf(S.previewId);
    if (!tr && pg !== bus.pgm.id) { bus.pgm.id = pg; cmd('pgm ' + pg); }
    if (pv !== bus.pvw.id) { bus.pvw.id = pv; cmd('pvw ' + pv); }
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
    if (t === 'ready') { ready = true; N.state = 'ready'; N.adapter = rest; resetSent(); KM.changed('nengine'); camReopen(); }
    else if (t === 'shown' && bus[rest]) { bus[rest].shown = true; N[rest] = bus[rest].want; }
    else if (t === 'hidden' && bus[rest]) { bus[rest].shown = false; N[rest] = false; }
    else if (t === 'srcerr') { const id = rest.split(' ')[0]; srcErr.add(id); srcSent.delete(id); KM.log && KM.log('mesin native: ' + rest); }
    else if (t === 'stats') { const m = /fps=(\d+) ms=([\d.]+) mem=(\d+)/.exec(rest); if (m) { N.fps = +m[1]; N.ms = +m[2]; N.mem = +m[3]; } const u = /utex=(\d+)/.exec(rest); if (u) N.utex = +u[1]; const cm = /cams=(\S+)/.exec(rest); N.camStat = cm ? cm[1] : '-'; }
    else if (t === 'probe') { const f = probeWait.shift(); if (f) f(rest.split(' ').map(Number)); }
    else if (t === 'click') clickFwd(rest.split(' '));
    else if (t === 'uready') uready.add(rest);
    else if (t === 'camok' || t === 'camerr') camEv(t, rest);
    else if (t === 'uerr') { utcErr = rest.replace(/^\S+ /, '').slice(0, 80); KM.log && KM.log('mesin native UTC: ' + rest); }
    else if (t === 'exit' || t === 'restart') { ready = false; N.pvw = N.pgm = false; N.state = t === 'exit' ? 'berhenti' : 'memulai ulang'; resetSent(); camLost(); KM.changed('nengine'); }
  }
  function resetSent() { srcSent.clear(); out = ''; transKey = ''; tbarSent = ''; uready.clear(); ulaySent = null; if (utcWant) { utcWant = false; if (el()) window.klm.send('nengine:utc', false); } for (const k in bus) Object.assign(bus[k], { want: false, shown: false, hideAt: -1, rect: '', id: null }); N.pvw = N.pgm = false; }
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
  N.camSrc = (id) => { const c = cams.get(id); return c && c.cur ? { src: c.cur.vf, w: c.cur.vf.displayWidth, h: c.cur.vf.displayHeight } : null; };
  N.camErr = (id) => { const c = cams.get(id); return c ? c.err : ''; };
  // mesin berhenti → kamera native hilang: input kamera dibuka ulang (jalur biasa sampai mesin siap lagi)
  function camLost() {
    for (const c of cams.values()) { camFree(c); c.wait.splice(0).forEach((w) => w.rej(new Error('mesin native berhenti'))); }
    const users = [...cams.values()].flatMap((c) => [...c.users]); cams.clear();
    for (const uid of users) { const inp = KM.getInput(uid); if (inp) { inp.rt.ncam = null; inp.rt.reopen && inp.rt.reopen(); } }
  }
  function camReopen() { if (!N.camUsable()) return; for (const inp of KM.state.inputs) if (inp.type === 'camera' && !inp.rt.ncam && inp.rt.reopen && !(inp.rt.nfail >= 3)) inp.rt.reopen(); }
  N.camReopenAll = () => { for (const inp of KM.state.inputs) if (inp.type === 'camera' && inp.rt.reopen) { inp.rt.nfail = 0; inp.rt.reopen(); } };

  N.start = async function () {
    if (!el() || running) return;
    running = true; ready = false; N.state = 'memulai';
    const r = await window.klm.invoke('nengine:start').catch((e) => ({ state: 'error', msg: e.message }));
    if (r && r.state === 'error') { running = false; N.state = 'gagal: ' + (r.msg || '?'); KM.toast('Mesin video native tidak bisa dimulai: ' + (r.msg || '?'), 'warn', 7000); }
    else if (r && r.state === 'ready') { ready = true; N.state = 'ready'; N.adapter = r.adapter || ''; resetSent(); camReopen(); }
    KM.changed('nengine');
  };
  N.stop = function () {
    if (!running) return;
    if (utcWant) { utcWant = false; window.klm.send('nengine:utc', false); } utcErr = '';
    N.pvw = N.pgm = false; // JS langsung menggambar monitor lagi
    for (const k in bus) cmd('rect ' + k + ' 0 0 0 0 0');
    running = false; ready = false; N.state = 'off';
    camLost(); // kamera kembali dibuka jalur biasa
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
    KM.on('frame', sync);
    window.addEventListener('resize', () => { for (const k in bus) bus[k].rect = bus[k].want ? '?' : ''; });
    const boot = () => { N.status().then((s) => { N.available = !!(s && s.available); if (KM.settings.nativeEngine && N.available) setTimeout(N.start, 3000); }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  }
})(window.KM);
