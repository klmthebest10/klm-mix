/* KLM Mix — penerima AirPlay bawaan (iPhone / iPad / Mac → Pusat Kontrol → "Pencerminan Layar" → KLM Mix).
 * Menjalankan helper terpisah klm-airplay(.exe) (GPL-3.0, dari pustaka UxPlay) yang mengumumkan diri di jaringan lokal
 * (mDNS, tanpa Bonjour) lalu meneruskan video H.264 ke port Mirroring KLM Mix (127.0.0.1:8624) dengan token input.
 * Satu penerima untuk satu input AirPlay; dinyalakan hanya saat input AirPlay ada. */
'use strict';
const { app, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

function findExe() {
  const exe = process.platform === 'win32' ? 'klm-airplay.exe' : 'klm-airplay';
  const c = [];
  if (process.env.KLM_AIRPLAY_EXE) c.push(process.env.KLM_AIRPLAY_EXE);
  if (app.isPackaged) c.push(path.join(process.resourcesPath, 'airplay', exe));
  const nat = path.join(__dirname, '..', 'native', 'airplay');
  c.push(path.join(nat, 'dist', exe), path.join(nat, 'build', exe), path.join(nat, 'build', 'Release', exe)); // dist = exe + DLL
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || '';
}

function setup({ win, server, configDir }) {
  const A = { proc: null, token: '', name: '', st: { ev: 'off' }, want: null, restarts: 0 };
  const dir = configDir();
  const send = () => { const w = win(); if (w && !w.isDestroyed()) w.webContents.send('airplay:status', A.status()); };
  A.status = () => Object.assign({ available: !!findExe(), running: !!A.proc }, A.st, { rname: A.name }); // name = perangkat Apple, rname = nama penerima

  /** alamat MAC tetap untuk PC ini (dipakai perangkat Apple untuk mengenali penerima); dibuat sekali, disimpan */
  function mac() {
    const f = path.join(dir, 'airplay.json');
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(j.mac)) return j.mac; } catch (e) {}
    const b = crypto.randomBytes(6); b[0] = (b[0] & 0xfc) | 0x02; // alamat lokal (bukan milik vendor)
    const m = [...b].map((x) => x.toString(16).padStart(2, '0')).join(':');
    try { fs.writeFileSync(f, JSON.stringify({ mac: m })); } catch (e) {}
    return m;
  }
  const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} ._'()-]/gu, '').trim().slice(0, 40) || ('KLM Mix ' + os.hostname()).slice(0, 40);

  function start(token, name) {
    stop(true);
    const exe = findExe();
    if (!exe) { A.st = { ev: 'error', msg: 'Penerima AirPlay (klm-airplay) tidak ada di instalasi ini' }; send(); return A.status(); }
    if (!server.mirror.port) { A.st = { ev: 'error', msg: 'Port Mirroring belum terbuka' }; send(); return A.status(); }
    A.token = token; A.name = cleanName(name); A.want = { token, name };
    server.mirror.allow(token, 'AirPlay');
    const args = ['--name', A.name, '--port', String(server.mirror.port), '--token', token, '--mac', mac(), '--keyfile', path.join(dir, 'airplay.key'), '--fps', '60'];
    if (process.env.KLM_AIRPLAY_DEBUG) args.push('--debug');
    let p;
    try { p = spawn(exe, args, { cwd: path.dirname(exe), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { A.st = { ev: 'error', msg: e.message }; send(); return A.status(); }
    A.proc = p; A.st = { ev: 'starting' }; send();
    let line = '';
    p.stdout.on('data', (d) => {
      line += d.toString('utf8');
      let i;
      while ((i = line.indexOf('\n')) >= 0) {
        const s = line.slice(0, i).trim(); line = line.slice(i + 1);
        if (!s) continue;
        try { const o = JSON.parse(s); A.st = Object.assign({}, A.st, o); if (o.ev === 'ready' || o.ev === 'video') A.restarts = 0; send(); } catch (e) {}
      }
    });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d.toString('utf8')).slice(-2000); if (process.env.KLM_AIRPLAY_DEBUG) process.stderr.write(d); });
    p.on('error', (e) => { A.st = { ev: 'error', msg: e.message }; send(); });
    p.on('exit', (code) => {
      if (A.proc !== p) return;
      A.proc = null;
      if (A.want && A.restarts < 5 && code !== 3221225781) { // keluar tak terduga → nyalakan lagi
        A.restarts++;
        A.st = { ev: 'error', msg: 'penerima berhenti (kode ' + code + '), menyalakan ulang… ' + (err.split('\n').filter(Boolean).pop() || '') };
        send();
        setTimeout(() => { if (A.want && !A.proc) start(A.want.token, A.want.name); }, 1500 * A.restarts);
      } else if (code === 3221225781) { A.st = { ev: 'error', msg: 'file pendukung penerima AirPlay (DLL) hilang — pasang ulang KLM Mix' }; send();
      } else { if (A.want) A.st = { ev: 'error', msg: 'penerima AirPlay gagal berjalan: ' + (err.split('\n').filter(Boolean).pop() || 'kode ' + code) }; else A.st = { ev: 'off' }; send(); }
    });
    return A.status();
  }
  function stop(keepWant) {
    if (!keepWant) A.want = null;
    const p = A.proc; A.proc = null;
    if (p) { try { p.kill(); } catch (e) {} setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 1500); }
    if (!keepWant) { A.st = { ev: 'off' }; send(); }
  }
  A.start = start; A.stop = () => stop(false); A.shutdown = () => stop(false);

  ipcMain.handle('airplay:start', (e, o) => { o = o || {}; if (!/^[a-f0-9]{8,32}$/.test(o.token || '')) return { ev: 'error', msg: 'token tidak valid' }; if (A.proc && A.token === o.token && A.name === cleanName(o.name)) return A.status(); return start(o.token, o.name); });
  ipcMain.handle('airplay:stop', () => { stop(false); return A.status(); });
  ipcMain.handle('airplay:status', () => A.status());
  return A;
}
module.exports = { setup, findExe };
