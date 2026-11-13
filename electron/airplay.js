/* KLM Mix — penerima AirPlay bawaan (iPhone / iPad / Mac → Pusat Kontrol → "Pencerminan Layar" → KLM Mix).
 * Menjalankan helper terpisah klm-airplay(.exe) (GPL-3.0, dari pustaka UxPlay) yang mengumumkan diri di jaringan lokal
 * (mDNS, tanpa Bonjour) lalu meneruskan video H.264 + suara PCM ke port Mirroring KLM Mix (127.0.0.1:8624) dengan token input.
 * Satu helper per jaringan (WiFi, LAN, Hotspot Seluler PC, …) sehingga iPhone di jaringan mana pun yang terhubung ke PC
 * melihat "KLM Mix" — termasuk saat WiFi memblokir antar-perangkat dan iPhone disambungkan ke hotspot PC.
 * Windows Firewall: aturan izin diperiksa; bila belum ada / diblokir, diminta sekali lewat UAC (versi portable juga). */
'use strict';
const { app, ipcMain, shell } = require('electron');
const { spawn, execFile } = require('child_process');
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

const SKIP_IF = /vethernet|wsl|virtualbox|vmware|hyper-v|docker|tailscale|zerotier|loopback|bluetooth|npcap|radmin|hamachi|vpn|tap-|tun/i;
/** jaringan IPv4 yang bisa dipakai iPhone: [{ip, name, hotspot}] */
function lanIfaces() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (SKIP_IF.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || /^169\.254\./.test(a.address)) continue;
      out.push({ ip: a.address, name, hotspot: /^192\.168\.137\./.test(a.address) });
    }
  }
  return out;
}

function setup({ win, server, configDir }) {
  const A = { insts: new Map(), token: '', name: '', want: null, fw: 'unknown', fwMsg: '', last: {} };
  const dir = configDir();
  const cfgFile = path.join(dir, 'airplay.json');
  const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile, 'utf8')) || {}; } catch (e) { return {}; } };
  const writeCfg = (o) => { try { fs.writeFileSync(cfgFile, JSON.stringify(Object.assign(readCfg(), o))); } catch (e) {} };
  let sendT = 0;
  const send = () => { clearTimeout(sendT); sendT = setTimeout(() => { const w = win(); if (w && !w.isDestroyed()) w.webContents.send('airplay:status', A.status()); }, 30); };

  /** status gabungan semua helper (satu per jaringan) */
  A.status = () => {
    const list = [...A.insts.values()];
    const rank = { video: 6, mirror: 5, client: 4, ready: 3, idle: 3, starting: 2, stopped: 3, 'mirror-off': 3, lost: 1, error: 0 };
    const best = list.slice().sort((a, b) => (rank[b.st.ev] || 0) - (rank[a.st.ev] || 0))[0];
    const st = best ? Object.assign({}, best.st) : Object.assign({ ev: A.want ? 'error' : 'off' }, A.want ? { msg: A.last.msg || 'penerima belum berjalan' } : {});
    return Object.assign({ available: !!findExe(), running: list.some((i) => i.proc) }, st, {
      rname: A.name, fw: A.fw, fwMsg: A.fwMsg,
      nets: list.map((i) => ({ ip: i.ip, name: i.ifname, hotspot: i.hotspot, ev: i.st.ev }))
    });
  };

  /** alamat MAC tetap untuk PC ini (dipakai perangkat Apple untuk mengenali penerima); dibuat sekali, disimpan */
  function mac() {
    const j = readCfg(); if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(j.mac || '')) return j.mac;
    const b = crypto.randomBytes(6); b[0] = (b[0] & 0xfc) | 0x02; // alamat lokal (bukan milik vendor)
    const m = [...b].map((x) => x.toString(16).padStart(2, '0')).join(':');
    writeCfg({ mac: m }); return m;
  }
  const cleanName = (n) => String(n || '').replace(/[^\p{L}\p{N} ._'()-]/gu, '').trim().slice(0, 40) || ('KLM Mix ' + os.hostname()).slice(0, 40);

  function spawnInst(key, iface) {
    const exe = findExe();
    const I = { key, ip: iface ? iface.ip : '', ifname: iface ? iface.name : '', hotspot: !!(iface && iface.hotspot), proc: null, st: { ev: 'starting' }, restarts: 0, err: '' };
    A.insts.set(key, I);
    const run = () => {
      if (!A.want || A.insts.get(key) !== I) return;
      const args = ['--name', A.name, '--port', String(server.mirror.port), '--token', A.token, '--mac', mac(), '--keyfile', path.join(dir, 'airplay.key'), '--fps', '60'];
      if (process.env.KLM_AIRPLAY_DEBUG) args.push('--debug');
      const env = Object.assign({}, process.env); if (I.ip) env.KLM_MDNS_IFACE = I.ip;
      let p;
      try { p = spawn(exe, args, { cwd: path.dirname(exe), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { I.st = { ev: 'error', msg: e.message }; send(); return; }
      I.proc = p; I.st = { ev: 'starting' }; send();
      let line = '';
      p.stdout.on('data', (d) => {
        line += d.toString('utf8'); let i;
        while ((i = line.indexOf('\n')) >= 0) {
          const s = line.slice(0, i).trim(); line = line.slice(i + 1); if (!s) continue;
          try { const o = JSON.parse(s); I.st = Object.assign({}, I.st, o); if (o.ev === 'ready' || o.ev === 'video') I.restarts = 0; if (o.ev === 'ready') checkFirewall(); send(); } catch (e) {}
        }
      });
      p.stderr.on('data', (d) => { I.err = (I.err + d.toString('utf8')).slice(-2000); if (process.env.KLM_AIRPLAY_DEBUG) process.stderr.write(d); });
      p.on('error', (e) => { I.st = { ev: 'error', msg: e.message }; send(); });
      p.on('exit', (code) => {
        if (I.proc !== p) return;
        I.proc = null;
        const tail = I.err.split('\n').filter(Boolean).pop() || '';
        if (code === 3221225781) { I.st = { ev: 'error', msg: 'file pendukung penerima AirPlay (DLL) hilang — pasang ulang KLM Mix' }; A.last.msg = I.st.msg; send(); return; }
        if (A.want && A.insts.get(key) === I && I.restarts < 6) { // keluar tak terduga → nyalakan lagi
          I.restarts++; I.st = { ev: 'error', msg: 'penerima berhenti (kode ' + code + '), menyalakan ulang… ' + tail }; send();
          setTimeout(run, 1500 * I.restarts);
        } else if (A.want) { I.st = { ev: 'error', msg: 'penerima AirPlay gagal berjalan: ' + (tail || 'kode ' + code) }; A.last.msg = I.st.msg; send(); }
      });
    };
    run();
  }
  function killInst(I) { A.insts.delete(I.key); const p = I.proc; I.proc = null; if (p) { try { p.kill(); } catch (e) {} setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 1500); } }

  /** samakan daftar helper dengan jaringan yang aktif (dipanggil berkala: hotspot dinyalakan, WiFi ganti, kabel LAN dicolok) */
  function sync() {
    if (!A.want) return;
    const nets = lanIfaces();
    const want = new Map(nets.map((n) => [n.ip, n]));
    if (!want.size) want.set('', null); // belum ada jaringan: satu helper rute bawaan (menunggu)
    for (const I of [...A.insts.values()]) if (!want.has(I.key)) killInst(I);
    // kunci perangkat dibuat oleh helper pertama; helper lain menyusul setelah file kunci ada (semua memakai kunci yang sama)
    const keyReady = fs.existsSync(path.join(dir, 'airplay.key'));
    for (const [k, n] of want) { if (A.insts.has(k)) continue; if (!keyReady && A.insts.size) break; spawnInst(k, n); if (!keyReady) break; }
    if (!keyReady) setTimeout(sync, 1500);
    send();
  }
  let syncIv = 0;
  function start(token, name) {
    stopAll(true);
    if (!findExe()) { A.want = null; A.last.msg = 'Penerima AirPlay (klm-airplay) tidak ada di instalasi ini'; send(); return A.status(); }
    if (!server.mirror.port) { A.last.msg = 'Port Mirroring belum terbuka'; send(); return A.status(); }
    A.token = token; A.name = cleanName(name); A.want = { token, name };
    server.mirror.allow(token, 'AirPlay');
    sync();
    clearInterval(syncIv); syncIv = setInterval(sync, 6000);
    return A.status();
  }
  function stopAll(keepWant) {
    if (!keepWant) { A.want = null; clearInterval(syncIv); }
    for (const I of [...A.insts.values()]) killInst(I);
    if (!keepWant) send();
  }

  // ---------- Windows Firewall ----------
  const ps = (cmd, timeout) => new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true, timeout: timeout || 20000 }, (e, out) => res(e ? null : String(out || ''))));
  const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  let fwChecking = false;
  /** aturan untuk klm-airplay.exe: 'ok' (diizinkan), 'need' (tidak ada / diblokir), 'unknown' */
  async function checkFirewall(autoFix) {
    if (process.platform !== 'win32' || fwChecking) return A.fw;
    fwChecking = true;
    try {
      const exe = findExe();
      const out = await ps(`$a = @(Get-NetFirewallApplicationFilter -Program ${psq(exe)} -ErrorAction SilentlyContinue | Get-NetFirewallRule -ErrorAction SilentlyContinue | Where-Object { $_.Direction -eq 'Inbound' -and $_.Enabled -eq 'True' } | ForEach-Object { $_.Action.ToString() }); 'R:' + ($a -join ',')`);
      if (out == null || !/R:/.test(out)) { A.fw = 'unknown'; return A.fw; }
      const acts = out.split('R:')[1].trim().split(',').filter(Boolean);
      const prev = A.fw;
      A.fw = acts.includes('Block') || !acts.includes('Allow') ? 'need' : 'ok';
      A.fwMsg = A.fw === 'ok' ? '' : acts.includes('Block') ? 'Windows Firewall memblokir penerima AirPlay' : 'Windows Firewall belum mengizinkan penerima AirPlay';
      if (A.fw !== prev) send();
      // minta izin otomatis sekali per lokasi program (tanpa menunggu pengguna menemukan masalahnya sendiri)
      if (A.fw === 'need' && (autoFix !== false) && !process.env.KLM_SMOKE && readCfg().fwAsked !== exe) { writeCfg({ fwAsked: exe }); fixFirewall(); }
      return A.fw;
    } finally { fwChecking = false; }
  }
  /** hapus aturan blokir untuk klm-airplay.exe lalu tambah aturan izin (jendela UAC muncul sekali) */
  async function fixFirewall() {
    if (process.platform !== 'win32') return { ok: false };
    const exe = findExe();
    const cmdArgs = `/c netsh advfirewall firewall delete rule name=all program="${exe}" & netsh advfirewall firewall add rule name="KLM Mix AirPlay" dir=in action=allow program="${exe}" enable=yes profile=any`;
    A.fwMsg = 'Menunggu izin administrator (jendela UAC)…'; send();
    const r = await ps(`try { Start-Process -FilePath cmd.exe -ArgumentList ${psq(cmdArgs)} -Verb RunAs -WindowStyle Hidden -Wait; 'OK' } catch { 'BATAL' }`, 120000);
    await checkFirewall(false);
    if (A.fw !== 'ok') { A.fwMsg = /BATAL/.test(r || '') ? 'Izin firewall dibatalkan — tekan "Izinkan di firewall" untuk mencoba lagi' : (A.fwMsg || 'Firewall belum diizinkan'); send(); }
    return { ok: A.fw === 'ok' };
  }

  A.start = start; A.stop = () => stopAll(false); A.shutdown = () => stopAll(false);
  A.lanIfaces = lanIfaces;
  ipcMain.handle('airplay:start', (e, o) => { o = o || {}; if (!/^[a-f0-9]{8,32}$/.test(o.token || '')) return { ev: 'error', msg: 'token tidak valid' }; if (A.want && A.token === o.token && A.name === cleanName(o.name) && A.insts.size) return A.status(); return start(o.token, o.name); });
  ipcMain.handle('airplay:stop', () => { stopAll(false); return A.status(); });
  ipcMain.handle('airplay:status', () => A.status());
  ipcMain.handle('airplay:firewall', () => fixFirewall());
  ipcMain.handle('airplay:hotspot', () => (process.platform === 'win32' ? shell.openExternal('ms-settings:network-mobilehotspot').then(() => true, () => false) : false));
  return A;
}
module.exports = { setup, findExe, lanIfaces };
