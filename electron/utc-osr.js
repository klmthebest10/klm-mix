/* KLM - render grafis UTC secara offscreen (tanpa jendela, dengan alpha asli), BERLAPIS
 * Overlay asli (HTML/CSS/font/animasi/video persis seperti di OBS) dirender Chromium di belakang layar.
 * Agar tetap mulus walau banyak grafis tampil bersamaan, overlay dipecah menjadi beberapa lapisan,
 * masing-masing di renderer sendiri:
 *   main  : lower third, title, lokasi, sosmed, opening/closing      (UTC KLM Acara)
 *   tk    : running text (teks berjalan digulir native oleh mixer)  (UTC KLM Acara)
 *   logo  : logo pojok                                               (UTC KLM Acara)
 *   score : UTC KLM Scoreboard olahraga
 * Area yang berubah (dirty rect) per lapisan tidak saling menggabung → yang disalin hanya potongan kecil,
 * tidak lagi satu layar penuh setiap frame. Potongan diambil langsung (crop) sebelum disalin.
 * Kontrol aliran per lapisan: frame berikutnya dikirim setelah mixer membalas "ack" (tidak menumpuk).
 *
 * ZERO-COPY (Windows, Electron ≥ 40): lapisan dirender langsung ke tekstur GPU bersama (D3D11, offscreen.useSharedTexture).
 * Tekstur itu diimpor (sharedTexture.importSharedTexture) dan dikirim ke mixer (sendSharedTexture) TANPA disalin ke CPU;
 * mixer menerimanya sebagai VideoFrame dan menggambarnya langsung ke Program. Bila tekstur GPU tidak tersedia / gagal,
 * semua lapisan otomatis kembali ke jalur salinan CPU di bawah (grafis tidak pernah hilang).
 */
'use strict';
const path = require('path');
const electron = require('electron');
const { BrowserWindow, ipcMain } = electron;
const sharedTexture = electron.sharedTexture; // Electron ≥ 40 (eksperimental)
const fs = require('fs');

module.exports = function setupUtcOsr(o) {
  const layers = new Map(); // id → layer
  let target = null; // webContents mixer
  const zc = {
    on: !!(sharedTexture && sharedTexture.importSharedTexture && sharedTexture.sendSharedTexture) && process.platform === 'win32' && !process.env.KLM_NO_ZC,
    ready: false, why: '', sent: 0, fails: 0, frames: 0,
  };
  if (!zc.on) zc.why = !sharedTexture ? 'Electron tanpa sharedTexture' : process.platform !== 'win32' ? 'hanya Windows' : 'dimatikan (KLM_NO_ZC)';
  const graveyard = []; // jendela offscreen lama: tidak di-destroy (lihat catatan di create)
  // log diagnosis kecil (config/klm-utc.log, maks ±256 KB) untuk melacak masalah grafis di PC pengguna
  const logPath = o.logDir ? path.join(o.logDir, 'klm-utc.log') : '';
  function dlog(m) {
    if (!logPath) return;
    try {
      const st = fs.existsSync(logPath) ? fs.statSync(logPath) : null;
      if (st && st.size > 256 * 1024) fs.renameSync(logPath, logPath + '.1');
      fs.appendFileSync(logPath, new Date().toISOString() + ' ' + m + '\n');
    } catch (e) {}
  }
  dlog('mulai: Electron ' + process.versions.electron + ', zero-copy ' + (zc.on ? 'tersedia' : 'tidak (' + zc.why + ')'));

  // Tiap lapisan dimuat dari nama host SENDIRI (klm-lt.localhost, klm-tt.localhost, …; *.localhost selalu = komputer ini).
  // Chromium hanya membuka 6 sambungan HTTP sekaligus per host; tiap lapisan memegang 1 sambungan event (SSE). Dulu semua
  // lapisan memakai 127.0.0.1 sehingga saat ±5 grafis tampil, permintaan panel UTC (klik, simpan) mengantre selamanya
  // → panel kosong / tidak merespons.
  const HOST_N = { lt: 'lt', tt: 'tt', loc: 'loc', soc: 'soc', oc: 'oc', tk: 'tk', logo: 'logo', main: 'main', all: 'main' };
  // Cadangan bila nama *.localhost benar-benar tidak bisa di-resolve: alamat loopback BERBEDA per lapisan (127.0.0.2 …; server
  // mendengar di 0.0.0.0) — JANGAN 127.0.0.1: itu host panel UTC. Dulu kegagalan muat APA PUN (server sempat sibuk, batas waktu)
  // memindahkan SEMUA lapisan ke 127.0.0.1 untuk selamanya → 7 sambungan SSE di host panel → batas 6 sambungan Chromium habis →
  // berkas panel (common.js, fonts.css) mengantre selamanya → "Panel lengkap UTC kosong / error" kambuh.
  const HOST_IP = { lt: 2, tt: 3, loc: 4, soc: 5, oc: 6, tk: 7, logo: 8, main: 9, all: 9 };
  let altHosts = true;
  const hostFor = (id) => (HOST_N[id] ? (altHosts ? 'klm-' + HOST_N[id] + '.localhost' : '127.0.0.' + HOST_IP[id]) : '127.0.0.1');
  function urlFor(id, t) {
    const base = 'http://' + hostFor(id) + ':' + o.port() + '/utc/overlay?klm=1';
    if (id === 'main') return base + '&only=lt,title,loc,soc,oc';   // (lama, gabungan)
    if (id === 'lt' || id === 'loc' || id === 'soc' || id === 'oc') return base + '&only=' + id;
    if (id === 'tt') return base + '&only=title';
    if (id === 'logo') return base + '&only=logo';
    if (id === 'tk') return base + '&only=ticker&tkn=1&fps=' + (t.fps || 30);
    if (id === 'score') { const p = o.scorePort && o.scorePort(); return p ? 'http://127.0.0.1:' + p + '/overlay?klm=1' : ''; }
    if (id === 'all') return base;
    return '';
  }
  function union(a, b) {
    if (!a) return b;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
  }

  // Catatan: jendela offscreen TIDAK pernah di-destroy (di Windows destroy OSR bisa membekukan proses utama).
  // Jendela dipakai ulang; "stop" cukup menghentikan painting & mengosongkan halaman.
  function create(L) {
    const gpu = zc.on;
    const win = new BrowserWindow({
      show: false, width: 1920, height: 1080, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000',
      skipTaskbar: true, focusable: false,
      webPreferences: { offscreen: gpu ? { useSharedTexture: true, deviceScaleFactor: 1 } : true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, spellcheck: false, preload: path.join(__dirname, 'osr-preload.js') }
    });
    const wc = win.webContents;
    L.win = win; L.wc = wc; L.gpu = gpu; L.zFly = false; L.zPend = null;
    wc.setAudioMuted(true); // suara video opening/closing diputar oleh mixer audio KLM (ikut rekam/stream)
    wc.on('paint', (e, dirty, image) => {
      if (L.gpu) { if (L.wc === wc) paintGpu(L, e, dirty); else if (e && e.texture) { try { e.texture.release(); } catch (er) {} } return; }
      if (L.wc !== wc) return;
      const t = L.t; if (!t || L.paused) return;
      const sz = image.getSize();
      if (!sz.width || !sz.height) return;
      // layar DPI tinggi: samakan ukuran piksel dengan resolusi output
      if (!L.fixed) {
        L.fixed = true;
        const cw = win.getContentSize()[0], k = sz.width / cw;
        if (Math.abs(sz.width - t.w) > 1 && k > 0) { win.setContentSize(Math.round(t.w / k), Math.round(t.h / k)); }
      }
      const k = sz.width / (win.getContentSize()[0] || sz.width);
      let r = { x: Math.floor(dirty.x * k) - 1, y: Math.floor(dirty.y * k) - 1, width: Math.ceil(dirty.width * k) + 3, height: Math.ceil(dirty.height * k) + 3 };
      if (!L.sentFull || !L.last || L.last.W !== sz.width || L.last.H !== sz.height) { r = { x: 0, y: 0, width: sz.width, height: sz.height }; L.sentFull = true; }
      L.last = { image, W: sz.width, H: sz.height };
      L.pend = union(L.pend, r);
      pump(L);
    });
    wc.on('render-process-gone', () => { setTimeout(() => { if (L.t && L.wc === wc && !wc.isDestroyed()) { L.sentFull = false; tell(L, { k: 'reset' }); wc.loadURL(L.t.url).catch(() => {}); } }, 1000); });
    wc.on('did-fail-load', (e, code, desc, url) => {
      if (url === 'about:blank' || code === -3 || L.wc !== wc) return;
      // hanya bila NAMA host yang gagal (resolusi nama) → pindah ke alamat loopback cadangan per lapisan. Galat lain (batas waktu,
      // server sibuk, sambungan putus) cukup dimuat ulang di host yang sama.
      const nameErr = code === -105 || code === -137 || code === -300 || code === -800;
      if (altHosts && nameErr && /^http:\/\/klm-[a-z]+\.localhost:/.test(url)) { altHosts = false; dlog('host klm-*.localhost gagal (' + code + ' ' + desc + '), pindah ke 127.0.0.x per lapisan'); }
      else if (!/^http:\/\/klm-[a-z]+\.localhost:/.test(url) || !nameErr) dlog('muat ulang lapisan ' + L.id + ' (' + code + ' ' + desc + ')');
      setTimeout(() => { if (L.t && !wc.isDestroyed()) { const u2 = urlFor(L.id, L.t); if (u2) L.t.url = u2; wc.loadURL(L.t.url).catch(() => {}); } }, altHosts ? 1500 : 300);
    });
    wc.on('did-start-navigation', (e, url, inPage, isMain) => { const mf = e && e.isMainFrame != null ? e.isMainFrame : isMain, same = e && e.isSameDocument != null ? e.isSameDocument : inPage; if (mf && !same && L.wc === wc) tell(L, { k: 'reset' }); });
  }
  // ---------- zero-copy: tekstur GPU → mixer (dan → mesin video native, Fase 2) ----------
  // penampung ber-refcount: tekstur dikembalikan ke kolam Chromium setelah SEMUA pemakai (mixer, mesin native) selesai
  const hold = (tex) => ({ tex, n: 1 });
  function unref(h) { if (h && --h.n <= 0 && h.tex) { const t = h.tex; h.tex = null; try { t.release(); } catch (e) {} } }
  function relTex(x) { if (x && x.h) unref(x.h); }
  const nat = o.native || null;
  if (nat && nat.onUtcWant) nat.onUtcWant(() => { retryGpu('mesin native butuh grafis UTC'); for (const L of layers.values()) if (L.t && L.gpu && !L.paused && L.wc && !L.wc.isDestroyed()) { try { L.wc.invalidate(); } catch (e) {} } });
  function paintGpu(L, e, dirty) {
    const tex = e && e.texture;
    // gambar tanpa tekstur GPU bisa muncul SESAAT (saat dilanjutkan dari jeda, ganti ukuran, memuat halaman).
    // Baru pindah ke jalur CPU bila terus-menerus: ≥ 30 gambar berturut-turut tanpa tekstur & > 3 dtk sejak mulai/lanjut.
    if (!tex) {
      if (!L.t || L.paused) return;
      L.zNull = (L.zNull || 0) + 1;
      if (L.zNull === 1) dlog(L.id + ': gambar tanpa tekstur GPU');
      if (L.zNull >= 30 && Date.now() - (L.zSince || 0) > 3000) fallback(L.id + ': Electron tidak memberi tekstur GPU (akselerasi GPU mati?)');
      return;
    }
    L.zNull = 0;
    const h = hold(tex);
    const ti = tex.textureInfo || {}, cs = ti.codedSize || {};
    const meta = { W: cs.width | 0, H: cs.height | 0, seq: ++L.seq };
    if (!meta.W || !meta.H || !L.t || L.paused) { unref(h); return; }
    // mesin video native menampilkan grafis UTC di monitor Program → tekstur yang sama juga dikirim ke sana (tanpa salinan CPU)
    if (nat && nat.utcWants()) { h.n++; try { nat.utcPush(L.id, h, meta, unref); } catch (er) { unref(h); } }
    if (!zc.ready || !target || target.isDestroyed() || (zc.rendHold && Date.now() < zc.rendHold)) { unref(h); return; }
    // kontrol aliran: satu kiriman per lapisan; yang menunggu hanya frame TERBARU (frame lama langsung dikembalikan ke kolam)
    if (L.zFly) { relTex(L.zPend); L.zPend = { h, meta }; return; }
    sendGpu(L, h, meta);
  }
  function sendGpu(L, h, meta) {
    let imp;
    try {
      imp = sharedTexture.importSharedTexture({ textureInfo: h.tex.textureInfo, allReferencesReleased: () => unref(h) });
    } catch (err) { unref(h); failGpu('impor tekstur: ' + (err && err.message)); return; }
    L.zFly = true;
    const done = () => {
      try { imp.release(); } catch (e) {}
      L.zFly = false;
      const p = L.zPend; L.zPend = null;
      if (p) { if (L.gpu && L.t && !L.paused && zc.ready && target && !target.isDestroyed() && p.h.tex) sendGpu(L, p.h, p.meta); else relTex(p); }
    };
    let fr = null; try { fr = target.mainFrame; } catch (e) {}
    if (!fr) { done(); return; }
    sharedTexture.sendSharedTexture({ frame: fr, importedSharedTexture: imp }, L.id, meta)
      .then(() => { zc.sent++; zc.fails = 0; })
      .catch((err) => failGpu('kirim tekstur: ' + (err && err.message)))
      .finally(done);
  }
  // Kiriman ke jendela KLM (renderer) bisa habis waktu bila jendela itu sedang sibuk sesaat ("transfer shared texture timed out").
  // Dulu 5× gagal → SEMUA lapisan pindah ke jalur CPU selamanya — padahal jalur CPU tidak bisa mengirim ke mesin video native,
  // jadi UTC Acara & UTC Score HILANG dari Program/output sampai KLM dibuka ulang. Sekarang:
  //  • selama mesin native memakai grafis UTC (tekstur dikirim langsung ke mesin, tidak lewat renderer), gagal kirim ke renderer
  //    hanya membuat kiriman ke renderer diistirahatkan 3 detik — jalur GPU TIDAK dimatikan;
  //  • bila tetap pindah ke CPU karena kiriman habis waktu, jalur GPU dicoba lagi otomatis (20 dtk / saat mesin native butuh UTC).
  const isSendFail = (why) => /^kirim tekstur/.test(String(why || ''));
  function failGpu(why) {
    zc.fails++; dlog('gagal (' + zc.fails + '): ' + why);
    if (isSendFail(why)) { zc.rendHold = Date.now() + 3000; if (nat && nat.utcWants()) { zc.fails = Math.min(zc.fails, 4); return; } }
    if (zc.fails >= 5) fallback(why);
  }
  /** jalur GPU tidak bisa dipakai di PC ini → semua lapisan dibuat ulang dengan jalur salinan CPU */
  function fallback(why) {
    if (!zc.on) return; zc.on = false; zc.why = why; console.warn('[UTC] zero-copy dimatikan: ' + why); dlog('PINDAH KE JALUR CPU: ' + why); rebuild();
    if (isSendFail(why) && (zc.retries = (zc.retries || 0) + 1) <= 20) { clearTimeout(zc.retryT); zc.retryT = setTimeout(() => retryGpu('20 dtk berlalu'), 20000); }
  }
  function retryGpu(why) {
    if (zc.on || !isSendFail(zc.why) || !sharedTexture || !sharedTexture.importSharedTexture || process.platform !== 'win32') return;
    clearTimeout(zc.retryT); zc.on = true; zc.why = ''; zc.fails = 0; zc.rendHold = 0; dlog('coba lagi jalur GPU (' + why + ')'); rebuild();
  }
  function rebuild() {
    if (target && !target.isDestroyed()) target.send('utc:zc', { on: zc.on, why: zc.why });
    for (const L of layers.values()) {
      if (!L.win || L.gpu === zc.on) continue;
      const t = L.t;
      relTex(L.zPend); L.zPend = null; L.zFly = false;
      try { L.wc.stopPainting(); L.wc.loadURL('about:blank').catch(() => {}); } catch (e) {}
      graveyard.push(L.win); L.win = null; L.wc = null;
      if (t) start(L.id, { w: t.w, h: t.h, fps: t.fps });
    }
  }

  function layer(id) {
    let L = layers.get(id);
    if (!L) { L = { id, win: null, wc: null, t: null, last: null, pend: null, inflight: false, inflightAt: 0, sentFull: false, seq: 0, fixed: false, paused: false }; layers.set(id, L); }
    return L;
  }
  function tell(L, msg) {
    if (target && !target.isDestroyed()) target.send('utc:tk', Object.assign({ L: L.id }, msg));
    if (nat) { try { nat.utcTk(L.id, msg); } catch (e) {} } // running text native juga digulir mesin video native
  }

  function start(id, t) {
    const url = urlFor(id, t);
    if (!url) return false;
    const L = layer(id);
    if (!L.win || L.win.isDestroyed() || !L.wc || L.wc.isDestroyed()) create(L);
    L.t = Object.assign({}, t, { url }); L.last = null; L.pend = null; L.inflight = false; L.sentFull = false; L.fixed = false; L.paused = false; L.zSince = Date.now(); L.zNull = 0;
    L.win.setContentSize(t.w, t.h);
    L.wc.setFrameRate(Math.max(10, Math.min(60, t.fps || 30)));
    L.wc.startPainting();
    L.wc.loadURL(url).catch(() => {});
    return true;
  }
  function stop(id) {
    const list = id ? [layers.get(id)].filter(Boolean) : [...layers.values()];
    for (const L of list) {
      L.t = null; L.last = null; L.pend = null; L.inflight = false; L.sentFull = false; relTex(L.zPend); L.zPend = null;
      if (L.wc && !L.wc.isDestroyed()) { try { L.wc.stopPainting(); L.wc.loadURL('about:blank').catch(() => {}); } catch (e) {} }
    }
  }
  function pump(L) {
    if (!L.last || !L.pend || !L.t || !target || target.isDestroyed()) return;
    if (L.inflight && Date.now() - L.inflightAt < 1000) return;
    const W = L.last.W, H = L.last.H;
    const x = Math.max(0, L.pend.x), y = Math.max(0, L.pend.y);
    const w = Math.min(W - x, L.pend.width - (x - L.pend.x)), h = Math.min(H - y, L.pend.height - (y - L.pend.y));
    L.pend = null;
    if (w <= 0 || h <= 0) return;
    let buf = null;
    // ambil potongan langsung (tanpa menyalin seluruh layar dulu)
    if (w < W || h < H) {
      try {
        const c = L.last.image.crop({ x, y, width: w, height: h });
        const cs = c.getSize();
        if (cs.width === w && cs.height === h) buf = c.toBitmap();
      } catch (e) { buf = null; }
    }
    if (!buf || buf.length < w * h * 4) {
      const bmp = L.last.image.toBitmap(); // BGRA premultiplied, baris demi baris
      const stride = W * 4;
      if (x === 0 && w === W) buf = bmp.subarray(y * stride, (y + h) * stride);
      else {
        buf = Buffer.allocUnsafe(w * h * 4);
        for (let row = 0; row < h; row++) bmp.copy(buf, row * w * 4, (y + row) * stride + x * 4, (y + row) * stride + (x + w) * 4);
      }
    }
    L.inflight = true; L.inflightAt = Date.now();
    target.send('utc:frame', { L: L.id, seq: ++L.seq, x, y, w, h, W, H, buf });
  }
  const L_of = (a) => (a && typeof a === 'object' && a.L) || (typeof a === 'string' ? a : null);

  ipcMain.on('utc:start', (e, t) => {
    target = e.sender;
    const w = Math.max(320, Math.min(3840, t.w | 0 || 1920)), h = Math.max(180, Math.min(2160, t.h | 0 || 1080));
    const ids = t.L ? [t.L] : (t.layers || ['lt', 'tt', 'loc', 'soc', 'oc', 'tk', 'logo']);
    for (const id of ids) start(id, { w, h, fps: t.fps });
    if (!e.sender.__klmOsrHook) { e.sender.__klmOsrHook = true; e.sender.once('destroyed', () => { if (target === e.sender) { stop(); target = null; } }); }
  });
  ipcMain.on('utc:stop', (e, a) => stop(L_of(a)));
  // mixer sudah memasang penerima tekstur GPU (zero-copy) / pengguna menyalakan-mematikan zero-copy
  ipcMain.on('utc:zc-ready', (e) => { target = e.sender; zc.ready = true; e.sender.send('utc:zc', { on: zc.on, why: zc.why }); });
  ipcMain.on('utc:zc-set', (e, a) => {
    const want = !!(a && a.on);
    if (!want && zc.on) { zc.on = false; zc.why = 'dimatikan di Pengaturan'; rebuild(); }
    else if (want && !zc.on && sharedTexture && sharedTexture.importSharedTexture && process.platform === 'win32') { zc.on = true; zc.why = ''; zc.fails = 0; rebuild(); }
    else e.sender.send('utc:zc', { on: zc.on, why: zc.why });
  });
  ipcMain.on('utc:reload', (e, a) => { for (const L of layers.values()) if ((!L_of(a) || L.id === L_of(a)) && L.t && L.wc && !L.wc.isDestroyed()) { L.sentFull = false; tell(L, { k: 'reset' }); L.wc.reloadIgnoringCache(); } });
  ipcMain.on('utc:full', (e, a) => { for (const L of layers.values()) if ((!L_of(a) || L.id === L_of(a)) && L.wc && !L.wc.isDestroyed()) { L.sentFull = false; L.wc.invalidate(); } });
  ipcMain.on('utc:ack', (e, a) => { const L = layers.get(L_of(a) || 'main'); if (L) { L.inflight = false; pump(L); } });
  // jeda saat lapisan tidak menampilkan apa-apa (hemat CPU/GPU); halaman tetap dimuat sehingga lanjut seketika
  ipcMain.on('utc:pause', (e, a) => { for (const L of layers.values()) if ((!L_of(a) || L.id === L_of(a)) && L.wc && !L.wc.isDestroyed() && !L.paused) { L.paused = true; try { L.wc.stopPainting(); } catch (er) {} } });
  // lanjut: selalu minta gambar baru (juga bila proses utama tidak sedang menjeda, mis. setelah pindah jalur)
  ipcMain.on('utc:resume', (e, a) => { for (const L of layers.values()) if ((!L_of(a) || L.id === L_of(a)) && L.wc && !L.wc.isDestroyed() && L.t) { if (L.paused) { L.paused = false; L.zSince = Date.now(); L.zNull = 0; try { L.wc.startPainting(); } catch (er) {} } L.sentFull = false; try { L.wc.invalidate(); } catch (er) {} } });
  // pesan dari halaman overlay (running text native): teruskan ke mixer
  ipcMain.on('osr:msg', (e, msg) => {
    for (const L of layers.values()) if (L.wc && !L.wc.isDestroyed() && L.wc.id === e.sender.id) { if (L.t && msg && typeof msg === 'object') tell(L, msg); return; }
  });
  return { stop: () => stop(), forceFallback: (why) => fallback(why || 'uji'), simSendFail: () => failGpu('kirim tekstur: uji (simulasi habis waktu)'), retryGpu: () => retryGpu('uji'), zc: () => Object.assign({}, zc, { layers: [...layers.values()].filter((L) => L.t).map((L) => L.id + (L.gpu ? ':gpu' : ':cpu')) }), active: () => [...layers.values()].some((L) => !!L.t), hosts: () => [...layers.values()].filter((L) => L.t).map((L) => L.id + '@' + (String(L.t.url).match(/\/\/([^/:]+)/) || [])[1]) };
};
