'use strict';
// Layar TV Masjid (sayyidinabilal.com/tv): cari / nyalakan / pasang gateway MediaMTX supaya Program KLM tampil di TV.
// KLM mengirim SRT caller ke gateway port 8890 dengan Stream ID publish:klm; TV menariknya lewat WebRTC (8889) / internet.
const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SITE = 'https://sayyidinabilal.com';
const PATH = 'klm';
const gwDir = () => path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'LayarTV', 'gateway');
const installed = () => process.platform === 'win32' && fs.existsSync(path.join(gwDir(), 'jalan.vbs'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// POST SDP kosong ke WHEP gateway: 404 = siap tapi KLM belum mengirim, 400 = sedang tayang,
// 400 "path 'klm' is not configured" = gateway versi lama (belum menerima KLM), tanpa jawaban = gateway mati.
function probe(host, timeout = 1500) {
  return new Promise((resolve) => {
    let done = false; const fin = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.request({ host, port: 8889, path: '/' + PATH + '/whep', method: 'POST', timeout, headers: { 'Content-Type': 'application/sdp', 'Content-Length': 3 } }, (res) => {
      let body = ''; res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 2000) body += d; });
      res.on('end', () => {
        const c = res.statusCode;
        if (c === 404) return fin({ ok: true, host, klm: 'siap' });
        if (c === 400 && /not configured/i.test(body)) return fin({ ok: true, host, klm: 'lama' });
        if (c === 400 || c === 200 || c === 201) return fin({ ok: true, host, klm: 'tayang' });
        fin({ ok: false, host, code: c });
      });
    });
    req.on('timeout', () => { req.destroy(); fin({ ok: false, host }); });
    req.on('error', () => fin({ ok: false, host }));
    req.end('v=0');
  });
}

function tcpOpen(host, port, ms) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const fin = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(ms, () => fin(false)); s.once('connect', () => fin(true)); s.once('error', () => fin(false));
  });
}

// alamat jaringan lokal (Wi-Fi / LAN) PC ini → seluruh /24 dipindai port 8889
function lanHosts() {
  const own = new Set(), nets = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) {
    if (a.family !== 'IPv4' && a.family !== 4) continue;
    if (a.internal || /^169\.254\./.test(a.address)) continue;
    own.add(a.address);
    if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) continue;
    const pre = a.address.split('.').slice(0, 3).join('.');
    if (!nets.includes(pre)) nets.push(pre);
  }
  const out = [];
  for (const pre of nets.slice(0, 3)) for (let i = 1; i < 255; i++) { const h = pre + '.' + i; if (!own.has(h)) out.push(h); }
  return out;
}

async function scanLan() {
  const hosts = lanHosts(), open = [];
  let i = 0;
  const worker = async () => { while (i < hosts.length) { const h = hosts[i++]; if (await tcpOpen(h, 8889, 400)) open.push(h); } };
  await Promise.all(Array.from({ length: 96 }, worker));
  const found = (await Promise.all(open.map((h) => probe(h, 2000)))).filter((r) => r.ok);
  const rank = { tayang: 0, siap: 1, lama: 2 };
  return found.sort((a, b) => rank[a.klm] - rank[b.klm]);
}

// jalan.vbs dibuat oleh PASANG-GATEWAY-VMIX.bat: start = nyalakan sekarang, pengawas = pastikan pengawas berjalan
function runCmd(a) {
  if (!installed()) return false;
  try { spawn('wscript.exe', [path.join(gwDir(), 'jalan.vbs'), 'layartv://gateway/' + a], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); return true; } catch (e) { return false; }
}

async function waitLocal(sec, okFn) {
  for (let i = 0; i < sec; i++) { const r = await probe('127.0.0.1', 1200); if (r.ok && (!okFn || okFn(r))) return r; await wait(1000); }
  return probe('127.0.0.1', 1200);
}

async function find(o = {}) {
  const local = await probe('127.0.0.1');
  const res = { platform: process.platform, installed: installed(), local, lan: [] };
  if (o.lan !== false && !(local.ok && local.klm !== 'lama')) res.lan = await scanLan();
  return res;
}

async function start() {
  if (!runCmd('start')) return { ok: false, msg: 'Gateway belum terpasang di PC ini' };
  const r = await waitLocal(30);
  return r.ok ? r : { ok: false, msg: 'Gateway tidak menyala — buka pintasan desktop "Gateway vMix Layar TV" untuk melihat status' };
}

// unduh pemasang dari situs lalu jalankan (jendela pemasang tampil; sekali izin administrator untuk firewall)
async function install(onStep) {
  if (process.platform !== 'win32') return { ok: false, msg: 'Pemasangan gateway otomatis hanya di Windows' };
  const step = (t) => { try { onStep && onStep(t); } catch (e) {} };
  step('Mengunduh pemasang gateway…');
  const bat = path.join(os.tmpdir(), 'PASANG-GATEWAY-VMIX.bat');
  try {
    const { net: enet } = require('electron');
    const r = await enet.fetch(SITE + '/tv/PASANG-GATEWAY-VMIX.bat?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    fs.writeFileSync(bat, Buffer.from(await r.arrayBuffer()));
  } catch (e) { return { ok: false, msg: 'Gagal mengunduh pemasang (' + e.message + '). Periksa internet PC ini.' }; }
  step('Memasang gateway — setujui izin administrator bila muncul…');
  try { spawn('cmd.exe', ['/c', 'start', '"Pasang gateway Layar TV"', '"' + bat + '"'], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref(); } catch (e) { return { ok: false, msg: e.message }; }
  // pemasangan (salin berkas, unduh MediaMTX bila belum ada) ± 30 dtk – 3 mnt
  for (let i = 0; i < 240; i++) {
    await wait(1000);
    const r = await probe('127.0.0.1', 1200);
    if (r.ok && r.klm !== 'lama') return r;
    if (i % 10 === 9) step('Memasang gateway… (' + (i + 1) + ' dtk)');
  }
  return { ok: false, msg: 'Pemasangan belum selesai — lihat jendela pemasang, lalu tekan tombol Layar TV lagi' };
}

function register(ipcMain) {
  ipcMain.handle('tvgw:find', (e, o) => find(o || {}));
  ipcMain.handle('tvgw:start', () => start());
  ipcMain.handle('tvgw:install', (e) => install((t) => { try { e.sender.send('tvgw:step', t); } catch (x) {} }));
  ipcMain.handle('tvgw:ensure', () => runCmd('pengawas'));
}

module.exports = { register, probe, find, scanLan, lanHosts };
