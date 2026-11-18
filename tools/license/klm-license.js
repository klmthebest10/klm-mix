#!/usr/bin/env node
/* KLM (Kinetic Live Mixer) - alat penjual: buat kunci lisensi per perangkat (TIDAK ikut dalam aplikasi yang dijual)
 *
 *   node klm-license.js keygen  [folder]                      → buat pasangan kunci baru (privat + publik)
 *   node klm-license.js issue   <DEVICE-ID> --name "Pembeli" [--plan Pro] [--key kunci-privat.pem] [--out file.klmlic]
 *   node klm-license.js verify  <KUNCI | file.klmlic> [--pub kunci-publik.pem]
 *
 * Kunci privat default dicari di:  KLM_LICENSE_KEY (env)  →  ./klm-mix-private-key.pem  →  ~/klm-license-keys/klm-mix-private-key.pem
 * JANGAN pernah membagikan / meng-commit kunci privat. Siapa pun yang memegangnya bisa membuat lisensi.
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : d; };
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

function findPrivate() {
  const c = [opt('key'), process.env.KLM_LICENSE_KEY, path.resolve('klm-mix-private-key.pem'), path.join(os.homedir(), 'klm-license-keys', 'klm-mix-private-key.pem')].filter(Boolean);
  for (const f of c) if (fs.existsSync(f)) return f;
  die('Kunci privat tidak ditemukan. Pakai --key <file.pem> atau jalankan "keygen" dulu.');
}
function normDevice(s) {
  const raw = String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^KLM/, '');
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(raw)) die('Device ID tidak valid: ' + s + ' (contoh: KLM-AB12-CD34-EF56-GH78)');
  return 'KLM-' + raw.match(/.{4}/g).join('-');
}

const cmd = args[0];
if (cmd === 'keygen') {
  const dir = path.resolve(args[1] && !args[1].startsWith('--') ? args[1] : '.');
  fs.mkdirSync(dir, { recursive: true });
  const priv = path.join(dir, 'klm-mix-private-key.pem');
  if (fs.existsSync(priv)) die('Sudah ada ' + priv + ' — hapus/pindahkan dulu agar tidak tertimpa.');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  fs.writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'klm-mix-private-key.jwk.json'), JSON.stringify(privateKey.export({ format: 'jwk' }), null, 1), { mode: 0o600 });
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  fs.writeFileSync(path.join(dir, 'klm-mix-public-key.pem'), pub);
  console.log('✓ Kunci dibuat di ' + dir + '\n  Simpan kunci privat baik-baik (cadangkan ke flashdisk).\n  Kunci publik (pasang di electron/license.js → PUBLIC_KEY, lalu build ulang):\n\n' + pub);
} else if (cmd === 'issue') {
  const dev = normDevice(args[1]);
  const name = opt('name', '');
  if (!name) die('Isi nama pembeli: --name "Nama Pembeli"');
  const days = +opt('days', 0);
  const now = Date.now();
  const payload = { v: 1, d: dev, n: name, p: opt('plan', 'Pro'), i: now, e: days > 0 ? now + days * 86400000 : 0, s: 'KM' + now.toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase() };
  const head = 'KLM1.' + b64u(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(head), { key: fs.readFileSync(findPrivate()), dsaEncoding: 'ieee-p1363' });
  const key = head + '.' + b64u(sig);
  const out = opt('out', 'lisensi-' + dev + '.klmlic');
  fs.writeFileSync(out, key + '\n');
  try { fs.appendFileSync('lisensi-terbit.csv', [new Date(now).toISOString(), payload.s, dev, JSON.stringify(name), payload.p, payload.e ? new Date(payload.e).toISOString().slice(0, 10) : 'seumur-hidup'].join(',') + '\n'); } catch (e) {}
  console.log('✓ Lisensi untuk ' + name + ' (' + dev + ')' + (payload.e ? ' berlaku sampai ' + new Date(payload.e).toLocaleDateString('id-ID') : ' — seumur hidup') + '\n  File: ' + out + '\n\n' + key);
} else if (cmd === 'verify') {
  let key = args[1] || '';
  if (fs.existsSync(key)) key = fs.readFileSync(key, 'utf8');
  key = key.replace(/\s+/g, '');
  const [pre, body, sig] = key.split('.');
  if (pre !== 'KLM1' || !body || !sig) die('Format kunci tidak dikenal');
  let pub = opt('pub');
  pub = pub ? fs.readFileSync(pub, 'utf8') : require(path.join(__dirname, '..', '..', 'electron', 'license.js')).PUBLIC_KEY;
  const ok = crypto.verify('sha256', Buffer.from(pre + '.' + body), { key: pub, dsaEncoding: 'ieee-p1363' }, unb64u(sig));
  console.log((ok ? '✓ Tanda tangan sah' : '✗ Tanda tangan TIDAK sah') + '\n' + JSON.stringify(JSON.parse(unb64u(body).toString()), null, 1));
  process.exit(ok ? 0 : 2);
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 9).join('\n'));
}
