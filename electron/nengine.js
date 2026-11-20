/* KLM — jembatan mesin video native (klm-engine.exe, Direct3D 11), Fase 1 (eksperimen).
 * Monitor Preview / Program dirender native di jendela anak yang ditempel di atas jendela utama KLM.
 * Renderer mengirim perintah teks (lihat native/engine/klm-engine.cpp), kejadian dari mesin diteruskan ke renderer. */
'use strict';
const { app, ipcMain, screen, desktopCapturer } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function findExe() {
  if (process.platform !== 'win32') return '';
  const c = [];
  if (app.isPackaged) c.push(path.join(process.resourcesPath, 'engine', 'klm-engine.exe'));
  const nat = path.join(__dirname, '..', 'native', 'engine', 'build');
  c.push(path.join(nat, 'Release', 'klm-engine.exe'), path.join(nat, 'klm-engine.exe'));
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || '';
}
// hanya perintah yang dikenal mesin, tanpa baris baru / karakter kendali (perintah utex/utk/ublob hanya dari proses utama)
const OK = /^(parent|out|rect|src|del|pvw|pgm|trans|tbar|stats|quit|ulay|probe|cam|camtest|camoff|camexp|camlist|kdecoff)( [\w.,\- ]{0,600})?$/;

// DuplicateHandle (kernel32) lewat koffi: handle NT tekstur lapisan UTC → disalin ke proses klm-engine
let K = null;
function k32() {
  if (K !== null) return K;
  K = false;
  if (process.platform !== 'win32') return K;
  try {
    const koffi = require('koffi'), lib = koffi.load('kernel32.dll');
    K = {
      OpenProcess: lib.func('uintptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
      GetCurrentProcess: lib.func('uintptr_t __stdcall GetCurrentProcess()'),
      DuplicateHandle: lib.func('int __stdcall DuplicateHandle(uintptr_t sp, uintptr_t sh, uintptr_t tp, _Out_ uintptr_t *th, uint32_t access, int inherit, uint32_t opt)'),
      CloseHandle: lib.func('int __stdcall CloseHandle(uintptr_t h)')
    };
  } catch (e) { K = false; }
  return K;
}
const ntHandleOf = (ti) => { const b = (ti && ti.handle && ti.handle.ntHandle) || (ti && ti.sharedTextureHandle); return b && b.length >= 8 ? b.readBigUInt64LE(0) : b && b.length >= 4 ? BigInt(b.readUInt32LE(0)) : 0n; };

function setup({ win, log = () => {} }) {
  // ---- Fase 3: kamera native → tekstur bersama → mixer (VideoFrame, tanpa salinan CPU) ----
  const sharedTexture = require('electron').sharedTexture;
  const camBuf = new Map(); // "id/gen/slot" → { h (handle di proses ini), buf, w, h }
  function camDropAll() { const k = k32(); for (const b of camBuf.values()) { if (k) try { k.CloseHandle(b.handle); } catch (e) {} } camBuf.clear(); }
  function onCbuf(a) { // cbuf id gen slot handle w h
    const k = k32(); const key = a[1] + '/' + a[2] + '/' + a[3];
    // cincin lama (generasi sebelumnya) kamera ini dilepas
    for (const [kk, b] of camBuf) if (kk.startsWith(a[1] + '/') && !kk.startsWith(a[1] + '/' + a[2] + '/')) { if (k) try { k.CloseHandle(b.handle); } catch (e) {} camBuf.delete(kk); }
    if (!k || !hProc) return;
    const out = [0];
    if (!k.DuplicateHandle(hProc, BigInt(a[4]), k.GetCurrentProcess(), out, 0, 0, 2) || !out[0]) { toWin('camerr ' + a[1] + ' DuplicateHandle gagal'); return; }
    const buf = Buffer.alloc(8); buf.writeBigUInt64LE(BigInt(out[0]));
    camBuf.set(key, { handle: out[0], buf, w: +a[5], h: +a[6] });
  }
  function onCfr(a) { // cfr id gen slot seq
    const key = a[1] + '/' + a[2] + '/' + a[3], b = camBuf.get(key);
    const rel = () => write('crel ' + a[1] + ' ' + a[2] + ' ' + a[3]);
    const w = win(); let fr = null; try { fr = w && !w.isDestroyed() ? w.webContents.mainFrame : null; } catch (e) {}
    if (!b || !fr || !sharedTexture || !sharedTexture.importSharedTexture) { rel(); return; }
    let imp;
    try {
      imp = sharedTexture.importSharedTexture({
        textureInfo: { pixelFormat: 'bgra', codedSize: { width: b.w, height: b.h }, visibleRect: { x: 0, y: 0, width: b.w, height: b.h }, timestamp: 0, handle: { ntHandle: b.buf } },
        allReferencesReleased: rel // mixer selesai memakai frame ini → slot cincin boleh dipakai lagi
      });
    } catch (e) { rel(); camFail = camFail || ('impor tekstur: ' + e.message); toWin('camerr ' + a[1] + ' ' + camFail); return; }
    sharedTexture.sendSharedTexture({ frame: fr, importedSharedTexture: imp }, 'cam:' + a[1], { W: b.w, H: b.h, seq: +a[4] })
      .catch((e) => { if (!camFail) { camFail = 'kirim tekstur: ' + (e && e.message); toWin('camerr ' + a[1] + ' ' + camFail); } })
      .finally(() => { try { imp.release(); } catch (e) {} });
  }
  let camFail = '';
  let P = null, buf = '', st = { state: 'off' }, restarts = 0, want = false;
  // ---- Fase 2: grafis UTC ----
  let hProc = 0, utcOn = false, utcErr = '', onUtcWant = null;
  const ul = new Map();       // lapisan → { fly: {seq, h, t}, pend: {h, meta}, seq }
  const tkCache = new Map();  // lapisan → { strip, geo } (dikirim ulang saat mesin / UTC native dinyalakan)
  const lay = (id) => { let x = ul.get(id); if (!x) { x = { fly: null, pend: null, seq: 0 }; ul.set(id, x); } return x; };
  function dropUtc() { for (const x of ul.values()) { if (x.fly) { x.fly.unref(x.fly.h); x.fly = null; } if (x.pend) { x.pend.unref(x.pend.h); x.pend = null; } } }
  function sendTex(id, x, h, meta, unref) {
    const k = k32(), src = ntHandleOf(h.tex && h.tex.textureInfo);
    if (!k || !hProc || !src || !P) { unref(h); return; }
    const out = [0];
    if (!k.DuplicateHandle(k.GetCurrentProcess(), src, hProc, out, 0, 0, 2 /* DUPLICATE_SAME_ACCESS */) || !out[0]) {
      unref(h); if (!utcErr) { utcErr = 'DuplicateHandle gagal'; toWin('uerr - DuplicateHandle gagal'); } return;
    }
    const seq = ++x.seq;
    x.fly = { seq, h, unref, t: Date.now() };
    write('utex ' + id + ' ' + String(out[0]) + ' ' + (meta.W | 0) + ' ' + (meta.H | 0) + ' ' + seq);
  }
  // dipanggil utc-osr.js untuk tiap gambar lapisan GPU; h = penampung tekstur ber-refcount, unref(h) wajib dipanggil
  function utcPush(id, h, meta, unref) {
    if (!utcOn || !P || st.state !== 'ready') { unref(h); return; }
    const x = lay(id);
    if (x.fly && Date.now() - x.fly.t > 1000) { x.fly.unref(x.fly.h); x.fly = null; } // mesin tidak membalas → jangan macet
    if (x.fly) { if (x.pend) x.pend.unref(x.pend.h); x.pend = { h, meta, unref }; return; }
    sendTex(id, x, h, meta, unref);
  }
  function onAck(id, seq) {
    const x = ul.get(id); if (!x || !x.fly || x.fly.seq !== seq) return;
    x.fly.unref(x.fly.h); x.fly = null;
    const p = x.pend; x.pend = null;
    if (p) { if (utcOn && P) sendTex(id, x, p.h, p.meta, p.unref); else p.unref(p.h); }
  }
  // running text native: pesan dari halaman overlay ({k:'strip'|'geo'|'live'|'reset'})
  const num = (v) => (Number.isFinite(+v) ? +(+v).toFixed(3) : 0);
  function tkSend(id, m) {
    if (!P || st.state !== 'ready' || !utcOn) return;
    if (m.k === 'reset') write('ureset ' + id);
    else if (m.k === 'live') write('utklive ' + id + ' ' + (m.id ? String(m.id).replace(/\W/g, '') || '-' : '-'));
    else if (m.k === 'geo' && m.vp) write('utkgeo ' + id + ' ' + String(m.id).replace(/\W/g, '') + ' ' + [m.vp.x, m.vp.y, m.vp.w, m.vp.h].map(num).join(' '));
    else if (m.k === 'strip' && m.vp && Array.isArray(m.tiles) && m.tiles.length) {
      const sid = String(m.id).replace(/\W/g, '') || 't';
      write('utk ' + id + ' ' + sid + ' ' + [m.at, m.vp.x, m.vp.y, m.vp.w, m.vp.h, m.w, m.speed, m.snap ? 1 : 0, m.px0, m.E0].map(num).join(' ') + ' ' + m.tiles.length);
      for (const t of m.tiles) {
        const b = Buffer.from(t.buf.buffer ? t.buf.buffer : t.buf, t.buf.byteOffset || 0, t.buf.byteLength || t.buf.length);
        const n = (t.w | 0) * (t.h | 0) * 4;
        if (b.length < n) continue;
        if (P && P.stdin.writable) { P.stdin.write('ublob ' + id + ' ' + sid + ' ' + num(t.x) + ' ' + (t.w | 0) + ' ' + (t.h | 0) + ' ' + n + '\n'); P.stdin.write(b.subarray(0, n)); }
      }
    }
  }
  function utcTk(id, m) {
    if (!m || typeof m !== 'object') return;
    let c = tkCache.get(id); if (!c) { c = {}; tkCache.set(id, c); }
    if (m.k === 'strip') { c.strip = m; c.geo = null; }
    else if (m.k === 'geo') { if (c.strip && c.strip.id === m.id) c.geo = m; }
    else if (m.k === 'live' || m.k === 'reset') { if (!m.id || !c.strip || c.strip.id === m.id || m.k === 'reset') { c.strip = null; c.geo = null; } }
    tkSend(id, m);
  }
  function resendTk() { for (const [id, c] of tkCache) { if (c.strip) tkSend(id, c.strip); if (c.geo) tkSend(id, c.geo); } }
  function setUtc(on) {
    on = !!on && !!k32();
    if (on === utcOn) return;
    utcOn = on; utcErr = '';
    if (!on) { dropUtc(); write('uclear'); write('ulay -'); }
    else { resendTk(); if (onUtcWant) onUtcWant(); } // utc-osr meminta gambar baru semua lapisan (grafis diam tidak menggambar ulang sendiri)
  }
  const toWin = (m) => { const w = win(); if (w && !w.isDestroyed()) w.webContents.send('nengine:ev', m); };
  const write = (l) => { if (P && P.stdin.writable) { try { P.stdin.write(l + '\n'); } catch (e) {} } };
  function hwnd() {
    const w = win(); if (!w || w.isDestroyed()) return '';
    const b = w.getNativeWindowHandle();
    return b.length >= 8 ? b.readBigUInt64LE(0).toString() : String(b.readUInt32LE(0));
  }
  function start() {
    want = true;
    if (P) return st;
    const exe = findExe();
    if (!exe) { st = { state: 'error', msg: process.platform === 'win32' ? 'klm-engine.exe tidak ada di instalasi ini' : 'khusus Windows' }; return st; }
    st = { state: 'starting' };
    const p = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    P = p; buf = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d) => {
      buf += d; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const s = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!s) continue;
        if (s.startsWith('uack ')) { const a = s.split(' '); onAck(a[1], +a[2]); continue; } // tidak diteruskan (sering)
        if (s.startsWith('cfr ')) { onCfr(s.split(' ')); continue; }
        if (s.startsWith('cbuf ')) { onCbuf(s.split(' ')); continue; }
        if (s.startsWith('ready ')) {
          st = { state: 'ready', adapter: s.slice(6) }; restarts = 0; write('parent ' + hwnd()); log('[nengine] siap: ' + s.slice(6));
          const k = k32(); hProc = k ? k.OpenProcess(0x40 /* PROCESS_DUP_HANDLE */, 0, p.pid) : 0;
          if (utcOn) { resendTk(); if (onUtcWant) onUtcWant(); }
        }
        else if (s.startsWith('err ') || s.startsWith('uerr ')) log('[nengine] ' + s);
        toWin(s);
      }
    });
    p.stderr.on('data', (d) => log('[nengine] stderr ' + String(d).slice(0, 300)));
    p.on('error', (e) => { st = { state: 'error', msg: e.message }; toWin('exit error'); });
    p.on('exit', (code) => {
      if (P !== p) return; P = null;
      dropUtc(); camDropAll(); if (hProc && k32()) { try { k32().CloseHandle(hProc); } catch (e) {} } hProc = 0;
      toWin('exit ' + code);
      if (want && restarts < 3) { restarts++; st = { state: 'restarting' }; setTimeout(() => { if (want) { start(); toWin('restart'); } }, 800 * restarts); }
      else if (want) st = { state: 'error', msg: 'mesin native berhenti (kode ' + code + ')' };
      else st = { state: 'off' };
    });
    return st;
  }
  function stop() { want = false; if (P) { write('quit'); const p = P; setTimeout(() => { try { p.kill(); } catch (e) {} }, 800); } }

  ipcMain.handle('nengine:start', () => start());
  ipcMain.handle('nengine:stop', () => { stop(); return true; });
  ipcMain.handle('nengine:status', () => Object.assign({ available: !!findExe(), utc: utcOn, utcErr, koffi: !!k32() }, st));
  ipcMain.on('nengine:utc', (e, on) => setUtc(on));
  // Fase 4a: frame H.264 KLMCAM (dari WebRTC di mixer) → dekoder GPU mesin native
  ipcMain.on('nengine:kenc', (e, id, key, n, data) => {
    if (!P || st.state !== 'ready' || !P.stdin.writable || !/^\w{1,40}$/.test(String(id))) return;
    const b = Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : null;
    if (!b || !b.length || b.length > 8 * 1024 * 1024) return;
    if (P.stdin.writableLength > 32 * 1024 * 1024) return; // mesin tertinggal → jangan menumpuk memori (dekoder minta frame kunci sendiri)
    P.stdin.write('kenc ' + id + ' ' + (key ? 1 : 0) + ' ' + Math.round((+n || 0) * 333333) + ' ' + b.length + '\n');
    P.stdin.write(b);
  });
  ipcMain.on('nengine:cmd', (e, lines) => {
    for (const l of [].concat(lines || [])) if (typeof l === 'string' && OK.test(l)) write(l);
  });
  // id sumber tangkap layar ("screen:<id>:0") → koordinat desktop fisik layar tsb (untuk DXGI Desktop Duplication)
  ipcMain.handle('nengine:screen-rect', async (e, sourceId) => {
    try {
      if (!/^screen:/.test(sourceId || '')) return null;
      const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })).find((s) => s.id === sourceId);
      const ds = screen.getAllDisplays();
      const d = (src && ds.find((x) => String(x.id) === String(src.display_id))) || (ds.length === 1 ? ds[0] : null);
      if (!d) return null;
      const r = screen.dipToScreenRect(null, d.bounds);
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    } catch (err) { return null; }
  });
  app.on('before-quit', () => stop());
  return {
    start, stop, status: () => st, available: () => !!findExe(),
    // dipakai utc-osr.js
    utcWants: () => utcOn && !!P && st.state === 'ready', utcPush, utcTk, onUtcWant: (fn) => { onUtcWant = fn; }
  };
}

module.exports = { setup, findExe };
