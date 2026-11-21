/* KLM - berkas aplikasi (halaman, skrip, huruf UTC / Score / HP) dilayani dari MEMORI.
 *
 * Pernah terjadi: panel UTC kosong karena permintaan /utc/common.js, /utc/overlay.html & /utc/fonts/fonts.css tidak pernah
 * dijawab — HEAD (stat) langsung dijawab, tetapi pembacaan isi berkas (fs.createReadStream dari arsip aplikasi) tertahan,
 * persis untuk berkas yang juga sedang dimuat 7 jendela lapisan grafis UTC sekaligus. Berkas aplikasi tidak pernah berubah
 * selama berjalan, jadi semuanya dibaca SEKALI saat mulai (sinkron, sebelum ada lalu lintas) lalu dilayani dari memori:
 * tidak ada lagi aliran berkas / antrean thread untuk halaman panel, tidak bisa tertahan. Berkas pengguna (video unggahan dll.)
 * tidak lewat sini. */
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_FILE = 16 * 1024 * 1024;
const cache = new Map(); // path absolut → Buffer
const roots = [];

function walk(dir, depth) {
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const d of list) {
    const f = path.join(dir, d.name);
    if (d.isDirectory()) { if (depth < 6 && d.name !== 'node_modules') walk(f, depth + 1); continue; }
    try { const st = fs.statSync(f); if (st.isFile() && st.size <= MAX_FILE) cache.set(path.resolve(f), fs.readFileSync(f)); } catch (e) {}
  }
}
/** baca semua berkas di bawah folder aplikasi ini ke memori (dipanggil sekali saat server dibuat) */
function preload(dir) {
  const d = path.resolve(dir); if (roots.includes(d)) return; roots.push(d);
  walk(d, 0);
}
const covered = (file) => { const f = path.resolve(file); return roots.some((r) => f === r || f.startsWith(r + path.sep)); };
/** isi berkas aplikasi dari memori; null bila tidak ada / bukan berkas aplikasi */
function get(file) {
  const f = path.resolve(file);
  if (cache.has(f)) return cache.get(f);
  if (!covered(f)) return null;
  try { const st = fs.statSync(f); if (!st.isFile() || st.size > MAX_FILE) return null; const b = fs.readFileSync(f); cache.set(f, b); return b; } catch (e) { return null; }
}
/** layani Buffer dengan dukungan HEAD, Range & ETag. headers: Content-Type dll. */
function serve(req, res, buf, headers) {
  const etag = '"m' + buf.length.toString(36) + '-' + (buf.length ? (buf[0] * 31 + buf[buf.length - 1] + buf[buf.length >> 1] * 7).toString(36) : '0') + '"';
  const h = Object.assign({ 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'ETag': etag, 'Access-Control-Allow-Origin': '*' }, headers || {});
  const range = req.headers.range;
  if (!range && req.headers['if-none-match'] === etag) { res.writeHead(304, { 'ETag': etag, 'Cache-Control': h['Cache-Control'], 'Access-Control-Allow-Origin': '*' }); return res.end(); }
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let s = m && m[1] ? parseInt(m[1], 10) : 0, e = m && m[2] ? parseInt(m[2], 10) : buf.length - 1;
    if (m && !m[1] && m[2]) { s = Math.max(0, buf.length - parseInt(m[2], 10)); e = buf.length - 1; } // bytes=-N
    if (isNaN(s) || s >= buf.length) { res.writeHead(416, { 'Content-Range': 'bytes */' + buf.length }); return res.end(); }
    e = Math.min(isNaN(e) ? buf.length - 1 : e, buf.length - 1);
    h['Content-Range'] = 'bytes ' + s + '-' + e + '/' + buf.length; h['Content-Length'] = e - s + 1;
    res.writeHead(206, h); return req.method === 'HEAD' ? res.end() : res.end(buf.subarray(s, e + 1));
  }
  h['Content-Length'] = buf.length; res.writeHead(200, h);
  return req.method === 'HEAD' ? res.end() : res.end(buf);
}

module.exports = { preload, get, serve, covered, size: () => cache.size };
