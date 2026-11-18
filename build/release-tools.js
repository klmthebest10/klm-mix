#!/usr/bin/env node
/* KLM - alat rilis untuk CI
 *   node build/release-tools.js fix-latest     → setelah installer ditandatangani: perbarui sha512 & ukuran di dist/latest.yml
 *                                               (tanda tangan mengubah isi file; tanpa ini update di aplikasi ditolak)
 *   node build/release-tools.js notes <versi>  → tulis catatan rilis (bagian "Baru di v<versi>" README) ke dist/release-notes.md
 *   node build/release-tools.js repo <owner/repo> → ganti sumber update di package.json (repo rilis publik terpisah)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'fix-latest') {
  const yml = path.join(ROOT, 'dist', 'latest.yml');
  if (!fs.existsSync(yml)) { console.log('dist/latest.yml tidak ada — lewati'); process.exit(0); }
  let t = fs.readFileSync(yml, 'utf8');
  const name = (t.match(/^path:\s*(.+)$/m) || [])[1];
  const file = name && path.join(ROOT, 'dist', name.trim().replace(/^['"]|['"]$/g, ''));
  if (!file || !fs.existsSync(file)) { console.log('installer di latest.yml tidak ditemukan: ' + name); process.exit(1); }
  const buf = fs.readFileSync(file);
  const sha = crypto.createHash('sha512').update(buf).digest('base64');
  const old = (t.match(/^sha512:\s*(.+)$/m) || [])[1];
  if (old && old.trim() === sha) { console.log('latest.yml sudah cocok'); process.exit(0); }
  // semua kemunculan sha512 & size untuk file itu (blok files: dan baris tingkat atas)
  t = t.replace(/(sha512:\s*).+/g, '$1' + sha).replace(/(size:\s*)\d+/g, '$1' + buf.length);
  fs.writeFileSync(yml, t);
  // blockmap lama tidak lagi sesuai dengan file bertanda tangan → hapus (aplikasi mengunduh penuh, tetap aman)
  const bm = file + '.blockmap';
  if (fs.existsSync(bm)) fs.unlinkSync(bm);
  console.log('latest.yml diperbarui untuk ' + path.basename(file) + ' (' + buf.length + ' byte)');
} else if (cmd === 'notes') {
  const v = String(arg || require('../package.json').version).replace(/^v/, '');
  const md = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const i = md.indexOf('### Baru di v' + v + '\n');
  let body = 'KLM v' + v;
  if (i >= 0) { const rest = md.slice(i + ('### Baru di v' + v + '\n').length); const j = rest.search(/\n### /); body = (j >= 0 ? rest.slice(0, j) : rest).trim(); }
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'dist', 'release-notes.md'), body + '\n');
  console.log(body);
} else if (cmd === 'repo') {
  const m = String(arg || '').match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) { console.log('repo kosong — sumber update tetap'); process.exit(0); }
  const p = path.join(ROOT, 'package.json'), pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  pkg.build.publish = [{ provider: 'github', owner: m[1], repo: m[2], releaseType: 'release' }];
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
  console.log('sumber update: ' + m[1] + '/' + m[2]);
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 7).join('\n'));
}
