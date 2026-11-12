/*
 * KLM Mix - Server lokal (100% offline)
 * - HTTP  : UI mixer, halaman HP (KLMCAM, Remote), API kompatibel vMix
 * - HTTPS : untuk kamera HP lewat browser biasa (butuh secure context)
 * - WS    : signaling WebRTC KLMCAM + remote + relay API
 * - TCP   : API teks gaya vMix (FUNCTION / XML / TALLY / SUBSCRIBE)
 * Bisa jalan di dalam Electron maupun `node electron/server.js` (mode web).
 */
'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const hub = require('./hub');
const createUtc = require('./utc');
const createScore = require('./score');

const ROOT = path.join(__dirname, '..');
const DEFAULTS = { httpPort: 8620, httpsPort: 8621, tcpPort: 8622 };

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.m4v': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

// ---------- konfigurasi ----------
function configDir() {
  const d = process.env.KLM_CONFIG_DIR || path.join(os.homedir(), '.klm-mix');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  return d;
}
function loadConfig() {
  try { return Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(path.join(configDir(), 'server.json'), 'utf8'))); }
  catch (e) { return Object.assign({}, DEFAULTS); }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(path.join(configDir(), 'server.json'), JSON.stringify(cfg, null, 2)); } catch (e) {}
}
function localIPs() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) for (const a of ifs[name] || []) {
    if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  return out;
}
function readCert() {
  const dir = configDir();
  try { return { key: fs.readFileSync(path.join(dir, 'cert-key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }; } catch (e) { return null; }
}
// Sertifikat dibuat sekali di proses terpisah (RSA 2048 di JS bisa memakan beberapa detik) → aplikasi tetap langsung terbuka.
function makeCert() {
  return new Promise((resolve) => {
    try {
      const { spawn } = require('child_process');
      const p = spawn(process.execPath, [path.join(__dirname, 'gencert.js'), configDir()], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }), stdio: 'ignore', windowsHide: true });
      const t = setTimeout(() => { try { p.kill(); } catch (e) {} resolve(null); }, 60000);
      p.on('exit', () => { clearTimeout(t); resolve(readCert()); });
      p.on('error', () => { clearTimeout(t); resolve(null); });
    } catch (e) { resolve(null); }
  });
}

// ---------- state relay ----------
let nextId = 1;
const clients = new Map(); // id -> {ws, role, name, slot}
let mixerId = null;
const pending = new Map(); // reqId -> {resolve, timer}
let reqSeq = 1;
let tallyStr = '';
let lastState = null;
const tcpSubs = new Set();
let utc = null; // UTC KLM Acara (menyatu)
let score = null; // UTC KLM Scoreboard olahraga (menyatu, port sendiri)
const scoreStatus = () => (score ? score.status() : { port: 0 });

function send(ws, obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) {} }
function mixer() { const c = mixerId && clients.get(mixerId); return c ? c.ws : null; }

function callMixer(msg, timeout = 4000) {
  return new Promise((resolve) => {
    const m = mixer();
    if (!m) return resolve({ ok: false, msg: 'Mixer belum siap' });
    const reqId = 'r' + (reqSeq++);
    const timer = setTimeout(() => { pending.delete(reqId); resolve({ ok: false, msg: 'Timeout' }); }, timeout);
    pending.set(reqId, { resolve, timer });
    send(m, Object.assign({}, msg, { reqId, from: 'server' }));
  });
}

function onWsConnection(ws, req) {
  const id = 'c' + (nextId++);
  const info = { ws, role: 'unknown', name: '', slot: 0, ip: (req.socket.remoteAddress || '').replace('::ffff:', '') };
  clients.set(id, info);
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (msg.t === 'hello') {
      info.role = msg.role; info.name = msg.name || ''; info.slot = msg.slot || 0; info.meta = msg.meta || {};
      if (msg.role === 'mixer') {
        mixerId = id;
        if (utc) setTimeout(() => { utc.onMixerState(); send(ws, { t: 'utc-status', status: utc.status() }); }, 50);
        setTimeout(() => send(ws, { t: 'score-status', status: scoreStatus() }), 60);
        // beri tahu mixer semua klien yang sudah ada
        for (const [cid, c] of clients) if (cid !== id && c.role !== 'unknown')
          send(ws, { t: 'peer-join', id: cid, role: c.role, name: c.name, slot: c.slot, ip: c.ip, meta: c.meta });
      } else {
        const m = mixer();
        if (m) send(m, { t: 'peer-join', id, role: info.role, name: info.name, slot: info.slot, ip: info.ip, meta: info.meta });
        if (lastState && info.role === 'remote') send(ws, lastState);
      }
      send(ws, { t: 'welcome', id, mixer: !!mixer(), ips: localIPs() });
      return;
    }
    if (id === mixerId) {
      // pesan dari mixer
      if (msg.t === 'fn-res' || msg.t === 'xml-res' || msg.t === 'utc-res') {
        if (msg.to && msg.to !== 'server') { const c = clients.get(msg.to); if (c) send(c.ws, msg); return; }
        const p = pending.get(msg.reqId);
        if (p) { clearTimeout(p.timer); pending.delete(msg.reqId); p.resolve(msg); }
        return;
      }
      if (msg.t === 'tally-str') {
        if (msg.str !== tallyStr) { tallyStr = msg.str; for (const s of tcpSubs) s.write('TALLY OK ' + tallyStr + '\r\n'); }
        return;
      }
      if (msg.t === 'state') { lastState = msg; if (utc) utc.onMixerState(); }
      if (msg.t === 'score-cmd') { const r = score ? score.cmd(msg.c) : { ok: false, error: 'Scoreboard tidak aktif' }; if (msg.reqId) send(ws, { t: 'score-cmd-res', reqId: msg.reqId, res: r }); return; }
      if (msg.t === 'utc-cmd' && utc) { const r = utc.klmCmd(msg.cmd || {}); if (msg.reqId) send(ws, { t: 'utc-cmd-res', reqId: msg.reqId, res: r }); return; }
      if (msg.to) { const c = clients.get(msg.to); if (c) send(c.ws, msg); return; }
      if (msg.bcast) { for (const [cid, c] of clients) if (cid !== id && (msg.bcast === 'all' || c.role === msg.bcast)) send(c.ws, msg); return; }
      return;
    }
    // pesan dari klien lain → mixer
    const m = mixer();
    if (!m) { if (msg.reqId) send(ws, { t: 'fn-res', reqId: msg.reqId, ok: false, msg: 'Mixer belum siap' }); return; }
    msg.from = id;
    send(m, msg);
  });
  ws.on('close', () => {
    clients.delete(id);
    if (id === mixerId) {
      mixerId = null; lastState = null;
      if (utc) utc.onMixerState();
      for (const c of clients.values()) send(c.ws, { t: 'mixer-gone' });
    } else { const m = mixer(); if (m) send(m, { t: 'peer-leave', id }); }
  });
}

// ---------- HTTP ----------
function serveFile(req, res, file, extraHeaders) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 Tidak ditemukan'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    // validator → buka berikutnya cukup "304 tidak berubah" & hasil kompilasi skrip (code cache) dipakai ulang
    const etag = '"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
    const headers = Object.assign({ 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'ETag': etag, 'Last-Modified': new Date(st.mtimeMs).toUTCString(), 'Access-Control-Allow-Origin': '*' }, extraHeaders || {});
    const range = req.headers.range;
    if (!range && req.headers['if-none-match'] === etag) { res.writeHead(304, { 'ETag': etag, 'Cache-Control': headers['Cache-Control'], 'Access-Control-Allow-Origin': '*' }); return res.end(); }
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (isNaN(start) || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      end = Math.min(end, st.size - 1);
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
      headers['Content-Length'] = end - start + 1;
      res.writeHead(206, headers);
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      headers['Content-Length'] = st.size;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    }
  });
}

// ---------- kerangka aplikasi cepat ----------
// index.html disajikan dengan CSS di-inline dan semua skrip (defer) digabung menjadi satu bundle yang diunduh
// paralel (preload) tapi baru dijalankan setelah layar pembuka tergambar: 1 permintaan (bukan ±25), jendela tidak
// lagi kosong/gelap saat skrip dikompilasi. KLM_NOBUNDLE=1 mematikan.
const shell = { key: '', html: null, js: null, etag: '' };
function appShell() {
  if (process.env.KLM_NOBUNDLE) return null;
  const idx = path.join(ROOT, 'src', 'index.html'), cssF = path.join(ROOT, 'src', 'css', 'app.css');
  let html; try { html = fs.readFileSync(idx, 'utf8'); } catch (e) { return null; }
  const srcs = []; html.replace(/<script src="([^"]+)" defer><\/script>/g, (m, x) => { srcs.push(x); return m; });
  const fileOf = (x) => (x.startsWith('/src/') ? path.join(ROOT, x) : path.join(ROOT, 'web', x.slice(1)));
  const files = [idx, cssF].concat(srcs.map(fileOf));
  let key = '';
  for (const f of files) { try { const st = fs.statSync(f); key += st.size + ':' + st.mtimeMs + '|'; } catch (e) { return null; } }
  if (key === shell.key && shell.html) return shell;
  try {
    let js = "'use strict';\n";
    for (const x of srcs) js += '\n// ==== ' + x + ' ====\ntry {\n' + fs.readFileSync(fileOf(x), 'utf8') + "\n} catch (e) { console.error('[KLM] modul " + x + " gagal', e); }\n";
    const etag = require('crypto').createHash('sha1').update(js).digest('hex').slice(0, 16);
    const css = fs.readFileSync(cssF, 'utf8');
    let first = true;
    html = html.replace(/<script src="[^"]+" defer><\/script>\n?/g, () => { if (!first) return ''; first = false; return '<script>(function () { var done = false, go = function () { if (done) return; done = true; var s = document.createElement("script"); s.src = "/app.bundle.js?v=' + etag + '"; document.body.appendChild(s); }; requestAnimationFrame(function () { setTimeout(go, 0); }); setTimeout(go, 120); })();</script>\n'; })
      .replace('<link rel="stylesheet" href="/src/css/app.css">', () => '<link rel="preload" href="/app.bundle.js?v=' + etag + '" as="script">\n<link rel="preload" href="/jakarta.woff" as="font" type="font/woff" crossorigin>\n<style>\n' + css + '\n</style>');
    Object.assign(shell, { key, html: Buffer.from(html), js: Buffer.from(js), etag });
    return shell;
  } catch (e) { console.warn('[KLM] bundle gagal', e.message); return null; }
}
function sendShell(req, res, buf, type, etag) {
  const h = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'ETag': '"' + etag + '"' };
  if (req.headers['if-none-match'] === h.ETag) { res.writeHead(304, h); return res.end(); }
  h['Content-Length'] = buf.length; res.writeHead(200, h); res.end(req.method === 'HEAD' ? undefined : buf);
}

function isLoopback(req) {
  const a = (req.socket.remoteAddress || '').replace('::ffff:', '');
  return a === '127.0.0.1' || a === '::1';
}

function esc(s) { return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

const ROUTES = {
  '/': 'src/index.html', '/index.html': 'src/index.html', '/output': 'src/output.html',
  '/hp': 'web/index.html', '/call': 'web/call.html', '/favicon.ico': 'build/icon-256.png', '/cam': 'web/camera.html', '/camera': 'web/camera.html', '/remote': 'web/remote.html'
};

async function handleHttp(req, res, ports) {
  const u = new URL(req.url, 'http://x');
  let p = decodeURIComponent(u.pathname);

  if (p === '/api' || p === '/api/') {
    const fn = u.searchParams.get('Function') || u.searchParams.get('function');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!fn) {
      const r = await callMixer({ t: 'xml' });
      res.writeHead(r.ok === false ? 503 : 200, { 'Content-Type': 'text/xml; charset=utf-8' });
      return res.end(r.xml || '<vmix><error>' + esc(r.msg || 'Mixer belum siap') + '</error></vmix>');
    }
    if (/^score(cmd)?$/i.test(fn)) {
      const r = score ? score.cmd(u.searchParams.get('Value') || u.searchParams.get('value') || '') : { ok: false, error: 'Scoreboard tidak aktif' };
      res.writeHead(r.ok ? 200 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(r.ok ? 'Function completed successfully.' : ('Error: ' + r.error));
    }
    const params = {};
    for (const [k, v] of u.searchParams) if (k.toLowerCase() !== 'function') params[k] = v;
    const r = await callMixer({ t: 'fn', fn, params });
    res.writeHead(r.ok ? 200 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(r.ok ? 'Function completed successfully.' : ('Error: ' + (r.msg || 'gagal')));
  }
  if (p === '/api/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(lastState || {}));
  }
  if (p === '/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ app: 'KLM Mix', version: require('../package.json').version, ips: localIPs(), ports: Object.assign({ score: score ? score.port() : 0 }, ports), mixer: !!mixer() }));
  }
  if (utc && (p === '/utc' || p.startsWith('/utc/') || p.startsWith('/uploads/'))) return utc.handle(req, res, p, u.searchParams);
  if (p.startsWith('/hub/')) {
    if (!isLoopback(req)) { res.writeHead(403); return res.end('Forbidden'); }
    return hub.handle(req, res, p);
  }
  if (p === '/localfile') {
    if (!isLoopback(req)) { res.writeHead(403); return res.end('Forbidden'); }
    const f = u.searchParams.get('p');
    if (!f) { res.writeHead(400); return res.end(); }
    return serveFile(req, res, path.normalize(f));
  }
  if (p === '/' || p === '/index.html') { const sh = appShell(); if (sh) return sendShell(req, res, sh.html, 'text/html; charset=utf-8', 'h' + sh.etag); }
  if (p === '/app.bundle.js') { const sh = appShell(); if (sh) return sendShell(req, res, sh.js, 'text/javascript; charset=utf-8', sh.etag); }
  if (ROUTES[p]) return serveFile(req, res, path.join(ROOT, ROUTES[p]));
  if (p.startsWith('/src/') || p.startsWith('/web/') || p.startsWith('/build/')) {
    const full = path.normalize(path.join(ROOT, p));
    if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    return serveFile(req, res, full);
  }
  // aset halaman HP (phone.css, common.js, camera.html, ...) dari folder web/
  if (/^\/[\w.-]+$/.test(p)) {
    const f = path.join(ROOT, 'web', p.slice(1));
    if (fs.existsSync(f)) return serveFile(req, res, f);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('404');
}

// ---------- TCP API (gaya vMix) ----------
function handleTcp(sock) {
  let buf = '';
  sock.setNoDelay(true);
  sock.on('data', async (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '').trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const [cmd, ...rest] = line.split(' ');
      const C = cmd.toUpperCase();
      if (C === 'FUNCTION') {
        const fn = rest[0];
        const params = {};
        new URLSearchParams(rest.slice(1).join(' ')).forEach((v, k) => { params[k] = v; });
        const r = await callMixer({ t: 'fn', fn, params });
        sock.write(r.ok ? 'FUNCTION OK Completed\r\n' : ('FUNCTION ER ' + (r.msg || 'Error') + '\r\n'));
      } else if (C === 'XML') {
        const r = await callMixer({ t: 'xml' });
        const xml = r.xml || '<vmix></vmix>';
        sock.write('XML ' + Buffer.byteLength(xml) + '\r\n' + xml);
      } else if (C === 'TALLY') {
        sock.write('TALLY OK ' + tallyStr + '\r\n');
      } else if (C === 'SUBSCRIBE') {
        tcpSubs.add(sock); sock.write('SUBSCRIBE OK ' + (rest[0] || 'TALLY') + '\r\n');
        sock.write('TALLY OK ' + tallyStr + '\r\n');
      } else if (C === 'UNSUBSCRIBE') {
        tcpSubs.delete(sock); sock.write('UNSUBSCRIBE OK ' + (rest[0] || 'TALLY') + '\r\n');
      } else if (C === 'VERSION') {
        sock.write('VERSION OK KLM-Mix ' + require('../package.json').version + '\r\n');
      } else if (C === 'QUIT') {
        sock.end();
      } else sock.write(C + ' ER Perintah tidak dikenal\r\n');
    }
  });
  sock.on('close', () => tcpSubs.delete(sock));
  sock.on('error', () => tcpSubs.delete(sock));
}

function listen(server, port, tries = 6) {
  return new Promise((resolve) => {
    const attempt = (p, n) => {
      const onErr = (e) => {
        server.removeListener('listening', onOk);
        if (e.code === 'EADDRINUSE' && n > 0) attempt(p + 10, n - 1);
        else { console.warn('[KLM] gagal listen', p, e.message); resolve(0); }
      };
      const onOk = () => { server.removeListener('error', onErr); resolve(p); };
      server.once('error', onErr);
      server.once('listening', onOk);
      server.listen(p, '0.0.0.0');
    };
    attempt(port, tries);
  });
}

async function start(opts) {
  const cfg = Object.assign(loadConfig(), opts || {});
  hub.setConfig(loadConfig);
  const ports = { http: 0, https: 0, tcp: 0 };
  if (!utc) {
    try {
      utc = createUtc({
        dataDir: path.join(configDir(), 'utc'), pubDir: path.join(ROOT, 'src', 'utc'), localIPs, port: () => ports.http,
        mixer: { call: callMixer, getState: () => lastState, connected: () => !!mixer(), version: require('../package.json').version }
      });
    } catch (e) { console.warn('[KLM] UTC KLM Acara gagal dimuat:', e); }
    if (utc) utc.onState(() => { const m = mixer(); if (m) send(m, { t: 'utc-status', status: utc.status() }); });
  }
  if (!score && !process.env.KLM_NO_SCORE) {
    try {
      score = createScore({ dataDir: path.join(configDir(), 'score'), pubDir: path.join(ROOT, 'src', 'score'), localIPs, mixPort: () => ports.http, bridgeFile: path.join(ROOT, 'web', 'klm-bridge.js') });
      let t = null;
      score.onChange(() => { clearTimeout(t); t = setTimeout(() => { const m = mixer(); if (m) send(m, { t: 'score-status', status: score.status() }); }, 300); });
      score.start(cfg.scorePort).then(() => { const m = mixer(); if (m) send(m, { t: 'score-status', status: score.status() }); });
    } catch (e) { console.warn('[KLM] Scoreboard gagal dimuat:', e); score = null; }
  }
  const wssA = new WebSocketServer({ noServer: true });
  wssA.on('connection', onWsConnection);
  const upgrade = (req, socket, head) => {
    if (req.url.startsWith('/hub/out')) {
      if (!isLoopback(req)) return socket.destroy();
      return hub.wssOut.handleUpgrade(req, socket, head, (ws) => hub.wssOut.emit('connection', ws, req));
    }
    if (!req.url.startsWith('/ws')) return socket.destroy();
    wssA.handleUpgrade(req, socket, head, (ws) => wssA.emit('connection', ws, req));
  };

  const httpServer = http.createServer((q, s) => handleHttp(q, s, ports).catch((e) => { try { s.writeHead(500); s.end(String(e)); } catch (_) {} }));
  httpServer.on('upgrade', upgrade);
  ports.http = await listen(httpServer, cfg.httpPort);

  const startHttps = async (cert) => {
    if (!cert) return console.warn('[KLM] HTTPS dinonaktifkan (sertifikat gagal dibuat)');
    const httpsServer = https.createServer(cert, (q, s) => handleHttp(q, s, ports).catch(() => {}));
    httpsServer.on('upgrade', upgrade);
    ports.https = await listen(httpsServer, cfg.httpsPort);
  };
  const cert = readCert();
  if (cert) await startHttps(cert);
  else makeCert().then(startHttps).then(() => { if (ports.https) console.log('[KLM Mix] HTTPS :' + ports.https + ' siap'); });
  const tcpServer = net.createServer(handleTcp);
  ports.tcp = await listen(tcpServer, cfg.tcpPort);

  console.log(`[KLM Mix] HTTP :${ports.http}  HTTPS :${ports.https}  TCP :${ports.tcp}`);
  for (const ip of localIPs()) console.log(`   Mixer   : http://${ip.address}:${ports.http}/\n   Menu HP : http://${ip.address}:${ports.http}/hp\n   KLMCAM  : ${ports.https ? `https://${ip.address}:${ports.https}` : `http://${ip.address}:${ports.http}`}/cam\n   Remote  : http://${ip.address}:${ports.http}/remote\n   UTC     : http://${ip.address}:${ports.http}/utc${score && score.port() ? `\n   Score   : http://${ip.address}:${score.port()}/  (HP: /hp)` : ''}`);
  return { ports, ips: localIPs() };
}

module.exports = { start, localIPs, loadConfig, saveConfig, configDir, hub, utc: () => utc, score: () => score };

function cleanup() { try { hub.shutdown(); } catch (e) {} try { if (utc) utc.shutdown(); } catch (e) {} try { if (score) score.shutdown(); } catch (e) {} }
process.on('exit', cleanup);
['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => { cleanup(); process.exit(0); }));

if (require.main === module) {
  start().then(({ ports }) => console.log(`Buka http://127.0.0.1:${ports.http}/ di Chrome/Edge (mode web).`));
}
