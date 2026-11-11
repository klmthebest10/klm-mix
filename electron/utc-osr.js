/* KLM Mix - render grafis UTC secara offscreen (tanpa jendela, dengan alpha asli), BERLAPIS
 * Overlay asli (HTML/CSS/font/animasi/video persis seperti di OBS/vMix) dirender Chromium di belakang layar.
 * Agar tetap mulus walau banyak grafis tampil bersamaan, overlay dipecah menjadi beberapa lapisan,
 * masing-masing di renderer sendiri:
 *   main  : lower third, title, lokasi, sosmed, opening/closing      (UTC KLM Acara)
 *   tk    : running text (teks berjalan digulir native oleh mixer)  (UTC KLM Acara)
 *   logo  : logo pojok                                               (UTC KLM Acara)
 *   score : UTC KLM Scoreboard olahraga
 * Area yang berubah (dirty rect) per lapisan tidak saling menggabung → yang disalin hanya potongan kecil,
 * tidak lagi satu layar penuh setiap frame. Potongan diambil langsung (crop) sebelum disalin.
 * Kontrol aliran per lapisan: frame berikutnya dikirim setelah mixer membalas "ack" (tidak menumpuk).
 */
'use strict';
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

module.exports = function setupUtcOsr(o) {
  const layers = new Map(); // id → layer
  let target = null; // webContents mixer

  function urlFor(id, t) {
    const base = 'http://127.0.0.1:' + o.port() + '/utc/overlay?klm=1';
    if (id === 'main') return base + '&only=lt,title,loc,soc,oc';
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
    const win = new BrowserWindow({
      show: false, width: 1920, height: 1080, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000',
      skipTaskbar: true, focusable: false,
      webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, spellcheck: false, preload: path.join(__dirname, 'osr-preload.js') }
    });
    const wc = win.webContents;
    L.win = win; L.wc = wc;
    wc.setAudioMuted(true); // suara video opening/closing diputar oleh mixer audio KLM Mix (ikut rekam/stream)
    wc.on('paint', (e, dirty, image) => {
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
    wc.on('render-process-gone', () => { setTimeout(() => { if (L.t && !wc.isDestroyed()) { L.sentFull = false; tell(L, { k: 'reset' }); wc.loadURL(L.t.url).catch(() => {}); } }, 1000); });
    wc.on('did-fail-load', (e, code, desc, url) => { if (url === 'about:blank' || code === -3) return; setTimeout(() => { if (L.t && !wc.isDestroyed()) wc.loadURL(L.t.url).catch(() => {}); }, 1500); });
    wc.on('did-start-navigation', (e, url, inPage, isMain) => { const mf = e && e.isMainFrame != null ? e.isMainFrame : isMain, same = e && e.isSameDocument != null ? e.isSameDocument : inPage; if (mf && !same) tell(L, { k: 'reset' }); });
  }
  function layer(id) {
    let L = layers.get(id);
    if (!L) { L = { id, win: null, wc: null, t: null, last: null, pend: null, inflight: false, inflightAt: 0, sentFull: false, seq: 0, fixed: false, paused: false }; layers.set(id, L); }
    return L;
  }
  function tell(L, msg) { if (target && !target.isDestroyed()) target.send('utc:tk', Object.assign({ L: L.id }, msg)); }

  function start(id, t) {
    const url = urlFor(id, t);
    if (!url) return false;
    const L = layer(id);
    if (!L.win || L.win.isDestroyed() || !L.wc || L.wc.isDestroyed()) create(L);
    L.t = Object.assign({}, t, { url }); L.last = null; L.pend = null; L.inflight = false; L.sentFull = false; L.fixed = false; L.paused = false;
    L.win.setContentSize(t.w, t.h);
    L.wc.setFrameRate(Math.max(10, Math.min(60, t.fps || 30)));
    L.wc.startPainting();
    L.wc.loadURL(url).catch(() => {});
    return true;
  }
  function stop(id) {
    const list = id ? [layers.get(id)].filter(Boolean) : [...layers.values()];
    for (const L of list) {
      L.t = null; L.last = null; L.pend = null; L.inflight = false; L.sentFull = false;
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
    const ids = t.L ? [t.L] : (t.layers || ['main', 'tk', 'logo']);
    for (const id of ids) start(id, { w, h, fps: t.fps });
    if (!e.sender.__klmOsrHook) { e.sender.__klmOsrHook = true; e.sender.once('destroyed', () => { if (target === e.sender) { stop(); target = null; } }); }
  });
  ipcMain.on('utc:stop', (e, a) => stop(L_of(a)));
  ipcMain.on('utc:reload', (e, a) => { for (const L of layers.values()) if ((!L_of(a) || L.id === L_of(a)) && L.t && L.wc && !L.wc.isDestroyed()) { L.sentFull = false; tell(L, { k: 'reset' }); L.wc.reloadIgnoringCache(); } });
  ipcMain.on('utc:full', (e, a) => { for (const L of layers.values()) if ((!L_of(a) || L.id === L_of(a)) && L.wc && !L.wc.isDestroyed()) { L.sentFull = false; L.wc.invalidate(); } });
  ipcMain.on('utc:ack', (e, a) => { const L = layers.get(L_of(a) || 'main'); if (L) { L.inflight = false; pump(L); } });
  // jeda saat lapisan tidak menampilkan apa-apa (hemat CPU/GPU); halaman tetap dimuat sehingga lanjut seketika
  ipcMain.on('utc:pause', (e, a) => { for (const L of layers.values()) if ((!L_of(a) || L.id === L_of(a)) && L.wc && !L.wc.isDestroyed() && !L.paused) { L.paused = true; try { L.wc.stopPainting(); } catch (er) {} } });
  ipcMain.on('utc:resume', (e, a) => { for (const L of layers.values()) if ((!L_of(a) || L.id === L_of(a)) && L.wc && !L.wc.isDestroyed() && L.t && L.paused) { L.paused = false; L.sentFull = false; try { L.wc.startPainting(); L.wc.invalidate(); } catch (er) {} } });
  // pesan dari halaman overlay (running text native): teruskan ke mixer
  ipcMain.on('osr:msg', (e, msg) => {
    for (const L of layers.values()) if (L.wc && !L.wc.isDestroyed() && L.wc.id === e.sender.id) { if (L.t && msg && typeof msg === 'object') tell(L, msg); return; }
  });
  return { stop: () => stop(), active: () => [...layers.values()].some((L) => !!L.t) };
};
