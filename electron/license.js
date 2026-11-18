/* KLM - lisensi per perangkat, seumur hidup (offline)
 *
 * - Device ID diturunkan dari ID PERANGKAT KERAS (UUID motherboard/SMBIOS), bukan dari instalasi Windows,
 *   sehingga tetap sama setelah install ulang Windows → kunci lisensi lama langsung bisa dipakai lagi.
 *   Format: "KLM-XXXX-XXXX-XXXX-XXXX".
 * - Kunci lisensi = "KLM1.<payload>.<tanda-tangan>", ditandatangani penjual dengan kunci privat ECDSA P-256.
 *   Aplikasi hanya menyimpan kunci PUBLIK, jadi lisensi tidak bisa dibuat dari aplikasi.
 * - Payload: { v:1, d:deviceId, n:nama pembeli, p:paket, i:tgl terbit (ms), e:kedaluwarsa (ms, 0 = selamanya), s:serial }
 * - Tanpa lisensi: KLM berjalan normal (tanpa watermark), tetapi UTC Acara, UTC Score, Mirroring HP & KLMCAM terkunci.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// kunci publik penjual (pasangan kunci privat disimpan penjual, TIDAK ada di repo / aplikasi)
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEwWDhCA9YZuiehW09+R5jx7Y9mXzT
G3okZuNedwp9Aps7GaHrfnbAxtMe3maHRzph7qjjaEB8s/ltEq630JVXjg==
-----END PUBLIC KEY-----`;
const PREFIX = 'KLM1';
const DAY = 86400000;
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: tanpa I L O U agar tidak tertukar saat diketik

function b32(buf, n) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) { val = (val << 8) | byte; bits += 8; while (bits >= 5 && out.length < n) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } if (out.length >= n) break; }
  return out;
}
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function run(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return ''; }
}
/** UUID / serial dari tabel SMBIOS yang disalin Windows ke registry (cepat, tanpa PowerShell/WMIC) */
const JUNK = /^(|0+|f+|none|default string|to be filled by o\.?e\.?m\.?|system serial number|base board serial number|not (applicable|specified)|o\.?e\.?m\.?|123456789|03000200-0400-0500-0006-000700080009)$/i;
function smbiosIds() {
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const out = run(path.join(sysRoot, 'System32', 'reg.exe'), ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\mssmbios\\Data', '/v', 'SMBiosData']);
  const m = out.match(/SMBiosData\s+REG_BINARY\s+([0-9A-F]+)/i);
  if (!m) return {};
  return parseSmbios(Buffer.from(m[1], 'hex'));
}
function parseSmbios(b) {
  const ids = {};
  let i = 8; // header RawSMBIOSData: 4 byte versi + 4 byte panjang
  while (i + 4 <= b.length) {
    const type = b[i], len = b[i + 1];
    if (len < 4 || i + len > b.length) break;
    // kumpulkan string sesudah area terformat (diakhiri 00 00)
    let j = i + len; const strs = []; let cur = '';
    while (j < b.length - 1 && !(b[j] === 0 && b[j + 1] === 0)) { if (b[j] === 0) { strs.push(cur); cur = ''; } else cur += String.fromCharCode(b[j]); j++; }
    if (cur) strs.push(cur);
    const str = (idx) => (idx > 0 && strs[idx - 1] ? strs[idx - 1].trim() : '');
    if (type === 1 && len >= 0x19) {
      const u = b.subarray(i + 8, i + 24);
      const hex = [...u].map((x) => x.toString(16).padStart(2, '0')).join('');
      // 4 field pertama little-endian (seperti tampilan Windows)
      const le = (s4) => s4.match(/../g).reverse().join('');
      ids.uuid = (le(hex.slice(0, 8)) + '-' + le(hex.slice(8, 12)) + '-' + le(hex.slice(12, 16)) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)).toLowerCase();
      ids.sysSerial = str(b[i + 7]);
    } else if (type === 2 && len >= 8) ids.boardSerial = str(b[i + 7]);
    else if (type === 127) break;
    i = j + 2;
  }
  return ids;
}
const good = (v) => !!v && !JUNK.test(String(v).trim()) && !/^(0|f|-)+$/i.test(String(v).replace(/-/g, ''));
/** ID mentah (tidak ditampilkan) — urutan: perangkat keras dulu, baru instalasi OS */
function machineRaw() {
  // untuk pengujian (CI / pengembangan) — diabaikan di aplikasi .exe yang sudah dipaketkan
  if (process.env.KLM_DEVICE_RAW && (!process.versions.electron || process.defaultApp)) return process.env.KLM_DEVICE_RAW;
  try {
    if (process.platform === 'win32') {
      const id = smbiosIds();
      if (good(id.uuid)) return 'hw:' + id.uuid;
      const ser = [id.boardSerial, id.sysSerial].filter(good);
      if (ser.length) return 'hws:' + ser.join('|').toLowerCase();
      // cadangan: UUID via CIM (PowerShell) bila registry SMBIOS tidak terbaca
      const ps = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_ComputerSystemProduct).UUID; (Get-CimInstance Win32_BaseBoard).SerialNumber']).split(/\r?\n/).map((x) => x.trim());
      if (good(ps[0])) return 'hw:' + ps[0].toLowerCase();
      if (good(ps[1])) return 'hws:' + ps[1].toLowerCase();
      const sysRoot = process.env.SystemRoot || 'C:\\Windows';
      const out = run(path.join(sysRoot, 'System32', 'reg.exe'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
      const g = out.match(/MachineGuid\s+REG_\w+\s+([0-9a-f-]{20,})/i);
      if (g) return 'win:' + g[1].toLowerCase(); // berubah bila Windows di-install ulang (hanya bila perangkat keras tidak punya ID)
    } else if (process.platform === 'darwin') {
      const m = run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return 'hw:' + m[1].toLowerCase();
    } else {
      for (const f of ['/sys/class/dmi/id/product_uuid', '/etc/machine-id', '/var/lib/dbus/machine-id']) { try { const v = fs.readFileSync(f, 'utf8').trim(); if (good(v)) return (f.includes('dmi') ? 'hw:' : 'lnx:') + v.toLowerCase(); } catch (e) {} }
    }
  } catch (e) {}
  // cadangan terakhir: nama komputer + MAC kartu jaringan fisik
  const macs = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (!a.internal && a.mac && a.mac !== '00:00:00:00:00:00') macs.push(a.mac);
  return 'fb:' + os.hostname() + '|' + [...new Set(macs)].sort().join(',');
}
let cachedId = '';
function deviceId() {
  if (cachedId) return cachedId;
  const h = crypto.createHash('sha256').update('klm-device-v2|' + machineRaw()).digest();
  const s = b32(h, 16);
  return (cachedId = 'KLM-' + s.match(/.{4}/g).join('-'));
}
const normId = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^KLM/, '');

/** periksa tanda tangan & isi kunci; tidak memeriksa perangkat */
function parse(key) {
  const k = String(key || '').replace(/\s+/g, '');
  const parts = k.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'Format kunci lisensi tidak dikenal' };
  let payload;
  try { payload = JSON.parse(unb64u(parts[1]).toString('utf8')); } catch (e) { return { ok: false, reason: 'Kunci lisensi rusak' }; }
  let valid = false;
  try { valid = crypto.verify('sha256', Buffer.from(parts[0] + '.' + parts[1]), { key: PUBLIC_KEY, dsaEncoding: 'ieee-p1363' }, unb64u(parts[2])); } catch (e) {}
  if (!valid) return { ok: false, reason: 'Kunci lisensi tidak sah (tanda tangan tidak cocok)' };
  if (!payload || payload.v !== 1 || !payload.d) return { ok: false, reason: 'Versi kunci lisensi tidak didukung' };
  return { ok: true, key: k, payload };
}

function create({ configDir }) {
  const file = () => path.join(configDir(), 'license.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { return null; } };
  const write = (o) => { try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(o, null, 1)); return true; } catch (e) { return false; } };

  function check(key, now = Date.now(), seen = 0) {
    const r = parse(key);
    if (!r.ok) return r;
    const p = r.payload;
    if (normId(p.d) !== normId(deviceId())) return { ok: false, reason: 'Lisensi ini untuk perangkat lain (' + p.d + ')', payload: p };
    if (p.e && seen && now < seen - 2 * DAY) return { ok: false, reason: 'Jam / tanggal komputer mundur. Setel tanggal yang benar lalu buka ulang KLM.', payload: p };
    if (p.e && now > p.e) return { ok: false, reason: 'Lisensi sudah kedaluwarsa (' + new Date(p.e).toLocaleDateString('id-ID') + ')', payload: p, expired: true };
    return { ok: true, payload: p };
  }

  let cache = null, cacheAt = 0;
  function status() {
    if (cache && Date.now() - cacheAt < 10000) return cache;
    cache = computeStatus(); cacheAt = Date.now();
    return cache;
  }
  const licensed = () => !!status().licensed;
  function computeStatus() {
    const st = { licensed: false, demo: true, deviceId: deviceId(), name: '', plan: '', issued: 0, expires: 0, serial: '', reason: '' };
    const saved = read();
    if (!saved || !saved.key) { st.reason = 'Belum diaktifkan'; return st; }
    const now = Date.now();
    const r = check(saved.key, now, saved.seen || 0);
    if (r.payload) Object.assign(st, { name: r.payload.n || '', plan: r.payload.p || '', issued: r.payload.i || 0, expires: r.payload.e || 0, serial: r.payload.s || '' });
    if (!r.ok) { st.reason = r.reason; return st; }
    if (!saved.seen || now > saved.seen) write(Object.assign(saved, { seen: now })); // pengaman jam mundur
    st.licensed = true; st.demo = false; st.reason = '';
    return st;
  }

  function activate(key) {
    cache = null;
    const r = check(key);
    if (!r.ok) return { ok: false, reason: r.reason, status: status() };
    const prev = read() || {};
    const ok = write({ key: parse(key).key, activatedAt: Date.now(), seen: Math.max(Date.now(), prev.seen || 0) });
    cache = null;
    if (!ok) return { ok: false, reason: 'Gagal menyimpan lisensi', status: status() };
    return { ok: true, status: status() };
  }
  function remove() { try { fs.unlinkSync(file()); } catch (e) {} cache = null; return { ok: true, status: status() }; }

  return { status, licensed, activate, remove, deviceId, parse };
}

/** halaman pengganti untuk fitur yang terkunci (dibuka dari browser / HP) */
function lockedHtml(feature) {
  const f = String(feature || 'Fitur ini').replace(/[<>&"]/g, '');
  return '<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + f + ' terkunci — KLM</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d16;color:#e9ecf5;font:15px/1.6 "Segoe UI",system-ui,sans-serif;padding:20px;box-sizing:border-box}' +
    '.b{max-width:440px;text-align:center;background:#141827;border:1px solid #262c44;border-radius:16px;padding:28px 24px}.i{font-size:42px}h1{font-size:20px;margin:6px 0 10px}p{color:#a3abc4;margin:6px 0}b{color:#fff}</style></head>' +
    '<body><div class="b"><div class="i">🔒</div><h1>' + f + ' memerlukan lisensi KLM</h1><p>Aktifkan lisensi di komputer KLM: <b>Bantuan → 🔑 Lisensi</b>.</p><p>Lisensi dibeli sekali dan berlaku seumur hidup untuk komputer tersebut.</p></div></body></html>';
}

/** sumber Device ID (hw = perangkat keras, hws = serial board, win = instalasi Windows, fb = cadangan) — untuk diagnosa */
const deviceSource = () => String(machineRaw()).split(':')[0];

module.exports = { smbiosIds, deviceSource, lockedHtml, create, deviceId, parse, PUBLIC_KEY, normId, parseSmbios };
