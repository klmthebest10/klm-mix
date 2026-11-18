/* KLM Mix - lisensi per perangkat (offline)
 *
 * - Device ID diturunkan dari ID mesin (Windows: MachineGuid) → "KLM-XXXX-XXXX-XXXX-XXXX".
 * - Kunci lisensi = "KLM1.<payload>.<tanda-tangan>", ditandatangani penjual dengan kunci privat ECDSA P-256.
 *   Aplikasi hanya menyimpan kunci PUBLIK, jadi lisensi tidak bisa dibuat dari aplikasi.
 * - Payload: { v:1, d:deviceId, n:nama pembeli, p:paket, i:tgl terbit (ms), e:kedaluwarsa (ms, 0 = selamanya), s:serial }
 * - Tanpa lisensi yang cocok → mode DEMO (semua fitur jalan, Program diberi watermark).
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
/** ID mesin mentah (tidak ditampilkan) */
function machineRaw() {
  if (process.env.KLM_DEVICE_RAW) return process.env.KLM_DEVICE_RAW; // untuk pengujian
  try {
    if (process.platform === 'win32') {
      const sysRoot = process.env.SystemRoot || 'C:\\Windows';
      const out = run(path.join(sysRoot, 'System32', 'reg.exe'), ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
      const m = out.match(/MachineGuid\s+REG_\w+\s+([0-9a-f-]{20,})/i);
      if (m) return 'win:' + m[1].toLowerCase();
    } else if (process.platform === 'darwin') {
      const m = run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (m) return 'mac:' + m[1].toLowerCase();
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) { try { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return 'lnx:' + v; } catch (e) {} }
    }
  } catch (e) {}
  // cadangan: nama komputer + MAC kartu jaringan fisik
  const macs = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (!a.internal && a.mac && a.mac !== '00:00:00:00:00:00') macs.push(a.mac);
  return 'fb:' + os.hostname() + '|' + [...new Set(macs)].sort().join(',');
}
let cachedId = '';
function deviceId() {
  if (cachedId) return cachedId;
  const h = crypto.createHash('sha256').update('klm-mix-device-v1|' + machineRaw()).digest();
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
    if (seen && now < seen - 2 * DAY) return { ok: false, reason: 'Jam / tanggal komputer mundur. Setel tanggal yang benar lalu buka ulang KLM Mix.', payload: p };
    if (p.e && now > p.e) return { ok: false, reason: 'Lisensi sudah kedaluwarsa (' + new Date(p.e).toLocaleDateString('id-ID') + ')', payload: p, expired: true };
    return { ok: true, payload: p };
  }

  function status() {
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
    const r = check(key);
    if (!r.ok) return { ok: false, reason: r.reason, status: status() };
    const prev = read() || {};
    if (!write({ key: parse(key).key, activatedAt: Date.now(), seen: Math.max(Date.now(), prev.seen || 0) })) return { ok: false, reason: 'Gagal menyimpan lisensi', status: status() };
    return { ok: true, status: status() };
  }
  function remove() { try { fs.unlinkSync(file()); } catch (e) {} return { ok: true, status: status() }; }

  return { status, activate, remove, deviceId, parse };
}

module.exports = { create, deviceId, parse, PUBLIC_KEY, normId };
