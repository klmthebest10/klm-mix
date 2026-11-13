/* KLM Mix — suara PC tanpa suara KLM Mix sendiri (helper klm-procaudio.exe, WASAPI process loopback, Windows 10 2004+).
 * Dipakai input Miracast (suara HP dari aplikasi Tampilan Nirkabel) & tangkap layar/jendela: tidak ada gema karena
 * keluaran KLM Mix (monitor, bus) dikecualikan. PCM dikirim ke port Mirroring dengan token input → renderer (AudioWorklet). */
'use strict';
const { app, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function findExe() {
  if (process.platform !== 'win32') return '';
  const c = [];
  if (app.isPackaged) c.push(path.join(process.resourcesPath, 'procaudio', 'klm-procaudio.exe'));
  const nat = path.join(__dirname, '..', 'native', 'procaudio', 'build');
  c.push(path.join(nat, 'Release', 'klm-procaudio.exe'), path.join(nat, 'klm-procaudio.exe'));
  return c.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || '';
}

function setup({ win, server }) {
  const P = new Map(); // token → { proc, st, want, restarts }
  const send = (token) => { const w = win(); const I = P.get(token); if (w && !w.isDestroyed()) w.webContents.send('procaudio:status', { token, st: I ? I.st : { ev: 'off' } }); };
  function start(token, name) {
    if (!/^[a-f0-9]{8,32}$/.test(token || '')) return { ev: 'error', msg: 'token tidak valid' };
    const exe = findExe();
    if (!exe) return { ev: 'error', msg: process.platform === 'win32' ? 'helper suara (klm-procaudio) tidak ada di instalasi ini' : 'khusus Windows' };
    const old = P.get(token); if (old && old.proc) return old.st;
    server.mirror.allow(token, name || 'Suara PC');
    const I = { proc: null, st: { ev: 'starting' }, want: true, restarts: 0, err: '' };
    P.set(token, I);
    const run = () => {
      if (!I.want || P.get(token) !== I) return;
      const p = spawn(exe, ['--port', String(server.mirror.port), '--token', token, '--exclude-pid', String(process.pid), '--name', String(name || 'Suara PC').slice(0, 60)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      I.proc = p;
      let line = '';
      p.stdout.on('data', (d) => { line += d; let i; while ((i = line.indexOf('\n')) >= 0) { const s = line.slice(0, i).trim(); line = line.slice(i + 1); try { I.st = JSON.parse(s); if (I.st.ev === 'ready') I.restarts = 0; send(token); } catch (e) {} } });
      p.stderr.on('data', (d) => { I.err = (I.err + d).slice(-1000); });
      p.on('error', (e) => { I.st = { ev: 'error', msg: e.message }; send(token); });
      p.on('exit', (code) => {
        if (I.proc !== p) return; I.proc = null;
        if (I.want && I.st.ev !== 'error' && I.restarts < 5) { I.restarts++; setTimeout(run, 1000 * I.restarts); }
        else if (I.want && I.st.ev !== 'error') { I.st = { ev: 'error', msg: 'helper suara berhenti (kode ' + code + ')' }; send(token); }
      });
    };
    run();
    return I.st;
  }
  function stop(token) { const I = P.get(token); if (!I) return; I.want = false; P.delete(token); if (I.proc) { try { I.proc.kill(); } catch (e) {} } }
  ipcMain.handle('procaudio:start', (e, o) => start(o && o.token, o && o.name));
  ipcMain.handle('procaudio:stop', (e, o) => { stop(o && o.token); return true; });
  ipcMain.handle('procaudio:available', () => !!findExe());
  return { start, stop, shutdown: () => [...P.keys()].forEach(stop), findExe };
}
module.exports = { setup, findExe };
