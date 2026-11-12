// KLM Mix — manajer host VST di proses utama: menjalankan broker (utilityProcess), menghubungkan MessagePort
// AudioWorklet <-> broker per instance plugin, dan meneruskan perintah/event lewat IPC.
'use strict';
const { app, ipcMain, utilityProcess, MessageChannelMain } = require('electron');
const path = require('path');
const fs = require('fs');

let broker = null, getWin = () => null, rid = 1;
const pending = new Map(); // rid -> {res, rej, t}
const owners = new Map();  // id plugin -> webContents id
const lastInfo = new Map();

function helperPath() {
  const exe = process.platform === 'win32' ? 'klm-vsthost.exe' : 'klm-vsthost';
  const cands = [];
  if (process.env.KLM_VSTHOST) cands.push(process.env.KLM_VSTHOST);
  if (app.isPackaged) cands.push(path.join(process.resourcesPath, 'vsthost', exe));
  const nat = path.join(__dirname, '..', 'native', 'vsthost');
  cands.push(path.join(nat, 'build', 'bin', 'Release', exe), path.join(nat, 'build', 'bin', exe), path.join(nat, 'build', 'Release', exe), path.join(nat, 'build', exe));
  return cands.find((p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } }) || '';
}

function ensureBroker() {
  if (broker) return broker;
  broker = utilityProcess.fork(path.join(__dirname, 'vst-broker.js'), [], { serviceName: 'KLM Mix VST Host', stdio: 'pipe' });
  broker.stdout && broker.stdout.on('data', (d) => console.log('[vst-broker]', String(d).trim()));
  broker.stderr && broker.stderr.on('data', (d) => console.warn('[vst-broker]', String(d).trim()));
  broker.on('message', onBroker);
  broker.on('exit', (code) => {
    broker = null;
    for (const [, p] of pending) { clearTimeout(p.t); p.rej(new Error('host VST berhenti')); }
    pending.clear();
    for (const id of owners.keys()) emit(id, { type: 'exit', id, crashed: true, code });
    owners.clear();
  });
  return broker;
}

function emit(id, ev) {
  const w = getWin();
  if (w && !w.isDestroyed()) w.webContents.send('vst:event', ev);
}

function onBroker(m) {
  if (!m) return;
  if (m.ev === 'reply') {
    const p = pending.get(m.rid);
    if (!p) return;
    pending.delete(m.rid); clearTimeout(p.t);
    m.error ? p.rej(new Error(m.error)) : p.res(m.data);
    return;
  }
  if (m.ev === 'info') {
    lastInfo.set(m.id, m.info);
    const p = pending.get('info:' + m.id);
    if (p) { pending.delete('info:' + m.id); clearTimeout(p.t); p.res(m.info); }
    emit(m.id, { type: 'info', id: m.id, info: m.info });
    return;
  }
  if (m.ev === 'exit') { owners.delete(m.id); emit(m.id, { type: 'exit', id: m.id, crashed: m.crashed, code: m.code }); return; }
  if (m.ev === 'dirty') return emit(m.id, { type: 'dirty', id: m.id });
  if (m.ev === 'editor') return emit(m.id, { type: 'editor', id: m.id, open: m.open });
  if (m.ev === 'log') { if (process.env.KLM_SMOKE || !app.isPackaged) console.log('[vst ' + m.id + ']', m.text); }
}

function ask(msg, ms) {
  const b = ensureBroker();
  return new Promise((res, rej) => {
    const r = rid++;
    const t = setTimeout(() => { pending.delete(r); rej(new Error('host VST tidak menjawab')); }, ms || 8000);
    pending.set(r, { res, rej, t });
    b.postMessage(Object.assign({ rid: r }, msg));
  });
}

function setup(opts) {
  getWin = opts.win;
  ipcMain.handle('vst:available', () => {
    const p = helperPath();
    return { ok: !!p && (process.platform === 'win32' || !!process.env.KLM_VSTHOST || !app.isPackaged), path: p, platform: process.platform };
  });
  // buat instance: port MessageChannel dikirim ke broker & renderer (renderer meneruskannya ke AudioWorklet)
  ipcMain.handle('vst:create', (e, o) => {
    const exe = helperPath();
    if (!exe) return { ok: false, error: 'Helper VST (klm-vsthost) tidak ditemukan di instalasi ini' };
    if (!o || !o.id || !o.path) return { ok: false, error: 'argumen tidak lengkap' };
    const b = ensureBroker();
    const { port1, port2 } = new MessageChannelMain();
    owners.set(o.id, e.sender.id);
    const done = new Promise((res) => {
      const t = setTimeout(() => { pending.delete('info:' + o.id); res({ ok: false, error: 'Plugin terlalu lama dimuat (lebih dari 30 detik)' }); }, 30000);
      pending.set('info:' + o.id, { res, rej: res, t });
    });
    b.postMessage({ cmd: 'create', id: o.id, exe, plugin: o.path, format: o.format === 'VST2' ? 'vst2' : o.format === 'VST3' ? 'vst3' : '', sr: o.sr, block: o.block, title: o.title }, [port1]);
    e.sender.postMessage('vst:port', { id: o.id }, [port2]);
    return done;
  });
  ipcMain.handle('vst:editor', (e, id, mode) => { if (broker) broker.postMessage({ cmd: 'editor', id, mode: mode == null ? 2 : mode | 0 }); return true; });
  ipcMain.handle('vst:bypass', (e, id, on) => { if (broker) broker.postMessage({ cmd: 'bypass', id, on: !!on }); return true; });
  ipcMain.handle('vst:get-state', (e, id) => ask({ cmd: 'getState', id }));
  ipcMain.handle('vst:set-state', (e, id, b64) => ask({ cmd: 'setState', id, data: b64 }));
  ipcMain.handle('vst:params', (e, id) => ask({ cmd: 'params', id }));
  ipcMain.handle('vst:set-param', (e, id, pid, v) => { if (broker) broker.postMessage({ cmd: 'setParam', id, pid, v }); return true; });
  ipcMain.handle('vst:destroy', (e, id) => { owners.delete(id); lastInfo.delete(id); if (broker) broker.postMessage({ cmd: 'destroy', id }); return true; });
  ipcMain.handle('vst:stats', () => (broker ? ask({ cmd: 'stats' }, 3000) : []));
  // halaman dimuat ulang: plugin milik halaman lama dimatikan
  return {
    resetFor(wcId) { for (const [id, o] of owners) if (o === wcId) { owners.delete(id); if (broker) broker.postMessage({ cmd: 'destroy', id }); } },
    shutdown() { if (broker) { try { broker.postMessage({ cmd: 'destroyAll' }); } catch (e) {} setTimeout(() => { try { broker && broker.kill(); } catch (e) {} }, 800); } },
    helperPath
  };
}

module.exports = { setup, helperPath };
