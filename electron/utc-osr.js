/* KLM Mix - render overlay UTC KLM Acara secara offscreen (tanpa jendela, dengan alpha asli)
 * Overlay asli (/utc/overlay: HTML/CSS/font/animasi/video persis seperti di OBS/vMix) dirender
 * Chromium di belakang layar, lalu HANYA bagian yang berubah (dirty rect) dikirim ke mixer
 * sebagai piksel BGRA premultiplied → diunggah ke tekstur WebGL → lapisan "UTC ON AIR".
 * Kontrol aliran: frame berikutnya baru dikirim setelah mixer membalas "ack" (tidak menumpuk).
 */
'use strict';
const { BrowserWindow, ipcMain } = require('electron');

module.exports = function setupUtcOsr(o) {
  let win = null, wc = null, target = null; // { wc, w, h, fps, url }
  let last = null, pend = null, inflight = false, inflightAt = 0, sentFull = false, seq = 0;

  function stop() {
    if (win && !win.isDestroyed()) { try { win.destroy(); } catch (e) {} }
    win = null; wc = null; last = null; pend = null; inflight = false; sentFull = false;
  }
  function union(a, b) {
    if (!a) return b;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
  }
  function start(t) {
    stop();
    target = t;
    win = new BrowserWindow({
      show: false, width: t.w, height: t.h, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000',
      skipTaskbar: true, focusable: false,
      webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, spellcheck: false }
    });
    wc = win.webContents;
    wc.setAudioMuted(true); // suara video opening/closing diputar oleh mixer audio KLM Mix (ikut rekam/stream)
    wc.setFrameRate(Math.max(10, Math.min(60, t.fps || 30)));
    let fixed = false;
    wc.on('paint', (e, dirty, image) => {
      const sz = image.getSize();
      if (!sz.width || !sz.height) return;
      // layar DPI tinggi: samakan ukuran piksel dengan resolusi output
      if (!fixed) {
        fixed = true;
        const [cw, ch] = win.getContentSize();
        const k = sz.width / cw;
        if (Math.abs(sz.width - t.w) > 1 && k > 0) { win.setContentSize(Math.round(t.w / k), Math.round(t.h / k)); }
      }
      const k = sz.width / (win.getContentSize()[0] || sz.width);
      let r = { x: Math.floor(dirty.x * k), y: Math.floor(dirty.y * k), width: Math.ceil(dirty.width * k) + 2, height: Math.ceil(dirty.height * k) + 2 };
      if (!sentFull || !last || last.W !== sz.width || last.H !== sz.height) { r = { x: 0, y: 0, width: sz.width, height: sz.height }; sentFull = true; }
      last = { image, W: sz.width, H: sz.height };
      pend = union(pend, r);
      pump();
    });
    wc.on('render-process-gone', () => { setTimeout(() => { if (target === t) start(t); }, 1000); });
    wc.on('did-fail-load', () => { setTimeout(() => { if (target === t && wc && !wc.isDestroyed()) wc.loadURL(t.url).catch(() => {}); }, 1500); });
    wc.loadURL(t.url).catch(() => {});
  }
  function pump() {
    if (!last || !pend || !target || !target.wc || target.wc.isDestroyed()) return;
    if (inflight && Date.now() - inflightAt < 1000) return;
    const W = last.W, H = last.H;
    const x = Math.max(0, pend.x), y = Math.max(0, pend.y);
    const w = Math.min(W - x, pend.width - (x - pend.x)), h = Math.min(H - y, pend.height - (y - pend.y));
    pend = null;
    if (w <= 0 || h <= 0) return;
    const bmp = last.image.toBitmap(); // BGRA premultiplied, baris demi baris
    const stride = W * 4;
    let buf;
    if (x === 0 && w === W) buf = bmp.subarray(y * stride, (y + h) * stride);
    else {
      buf = Buffer.allocUnsafe(w * h * 4);
      for (let row = 0; row < h; row++) bmp.copy(buf, row * w * 4, (y + row) * stride + x * 4, (y + row) * stride + (x + w) * 4);
    }
    inflight = true; inflightAt = Date.now();
    target.wc.send('utc:frame', { seq: ++seq, x, y, w, h, W, H, buf });
  }

  ipcMain.on('utc:start', (e, t) => {
    const url = 'http://127.0.0.1:' + o.port() + '/utc/overlay?klm=1';
    start({ wc: e.sender, w: Math.max(320, Math.min(3840, t.w | 0 || 1920)), h: Math.max(180, Math.min(2160, t.h | 0 || 1080)), fps: t.fps, url });
    e.sender.once('destroyed', () => { if (target && target.wc === e.sender) { target = null; stop(); } });
  });
  ipcMain.on('utc:stop', () => { target = null; stop(); });
  ipcMain.on('utc:reload', () => { if (wc && !wc.isDestroyed()) { sentFull = false; wc.reloadIgnoringCache(); } });
  ipcMain.on('utc:full', () => { sentFull = false; if (wc && !wc.isDestroyed()) wc.invalidate(); });
  ipcMain.on('utc:ack', () => { inflight = false; pump(); });
  return { stop, active: () => !!win };
};
