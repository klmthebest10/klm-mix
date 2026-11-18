#!/usr/bin/env node
/* KLM - buat salinan PRIBADI pembuat-lisensi.html dengan kunci privat penjual tertanam.
 * Hasilnya cukup diklik dua kali: tidak perlu memilih file kunci lagi.
 *
 *   node tools/license/buat-pembuat-pribadi.js [--key kunci-privat.pem|.jwk.json] [--out file.html]
 *
 * FILE HASILNYA SAMA RAHASIANYA DENGAN KUNCI PRIVAT: siapa pun yang memegangnya bisa membuat lisensi KLM.
 * Jangan dibagikan, jangan di-commit (.gitignore menolak *PRIBADI*).
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const die = (m) => { console.error('✗ ' + m); process.exit(1); };

const cands = [opt('key'), process.env.KLM_LICENSE_KEY,
  path.resolve('klm-mix-private-key.jwk.json'), path.resolve('klm-mix-private-key.pem'),
  path.join(os.homedir(), 'klm-license-keys', 'klm-mix-private-key.jwk.json'), path.join(os.homedir(), 'klm-license-keys', 'klm-mix-private-key.pem')].filter(Boolean);
const keyFile = cands.find((f) => fs.existsSync(f));
if (!keyFile) die('Kunci privat tidak ditemukan. Pakai --key <klm-mix-private-key.pem>');

const txt = fs.readFileSync(keyFile, 'utf8');
const priv = txt.trim().startsWith('{') ? crypto.createPrivateKey({ key: JSON.parse(txt), format: 'jwk' }) : crypto.createPrivateKey(txt);
const jwk = priv.export({ format: 'jwk' });
if (jwk.crv !== 'P-256' || !jwk.d) die('Bukan kunci privat P-256');

// pastikan cocok dengan kunci publik di aplikasi
const { PUBLIC_KEY } = require(path.join(__dirname, '..', '..', 'electron', 'license.js'));
const sig = crypto.sign('sha256', Buffer.from('klm-cek'), { key: priv, dsaEncoding: 'ieee-p1363' });
if (!crypto.verify('sha256', Buffer.from('klm-cek'), { key: PUBLIC_KEY, dsaEncoding: 'ieee-p1363' }, sig)) die('Kunci privat ini TIDAK cocok dengan kunci publik di electron/license.js');

const src = fs.readFileSync(path.join(__dirname, 'pembuat-lisensi.html'), 'utf8');
const MARK = 'const EMBED_JWK = null; /*__KLM_EMBED_JWK__*/';
if (!src.includes(MARK)) die('Penanda kunci tidak ditemukan di pembuat-lisensi.html');
const embed = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d };
const html = src.replace(MARK, 'const EMBED_JWK = ' + JSON.stringify(embed) + '; /* RAHASIA — jangan dibagikan */')
  .replace('<title>Pembuat Lisensi KLM</title>', '<title>Pembuat Lisensi KLM (PRIBADI)</title>');

const out = path.resolve(opt('out', 'KLM-Pembuat-Lisensi-PRIBADI.html'));
fs.writeFileSync(out, html, { mode: 0o600 });
console.log('✓ ' + out + '\n  Klik dua kali untuk membuka di Chrome/Edge. File ini RAHASIA (berisi kunci privat penjual).');
