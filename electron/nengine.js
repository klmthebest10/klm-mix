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
// hanya perintah yang dikenal mesin, tanpa baris baru / karakter kendali
const OK = /^(parent|out|rect|src|del|pvw|pgm|trans|tbar|stats|quit)( [\w.\- ]{0,200})?$/;

function setup({ win, log = () => {} }) {
  let P = null, buf = '', st = { state: 'off' }, restarts = 0, want = false;
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
        if (s.startsWith('ready ')) { st = { state: 'ready', adapter: s.slice(6) }; restarts = 0; write('parent ' + hwnd()); log('[nengine] siap: ' + s.slice(6)); }
        else if (s.startsWith('err ')) log('[nengine] ' + s);
        toWin(s);
      }
    });
    p.stderr.on('data', (d) => log('[nengine] stderr ' + String(d).slice(0, 300)));
    p.on('error', (e) => { st = { state: 'error', msg: e.message }; toWin('exit error'); });
    p.on('exit', (code) => {
      if (P !== p) return; P = null;
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
  ipcMain.handle('nengine:status', () => Object.assign({ available: !!findExe() }, st));
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
  return { start, stop, status: () => st, available: () => !!findExe() };
}

module.exports = { setup, findExe };
