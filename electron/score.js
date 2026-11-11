/* KLM Mix — UTC KLM Scoreboard (olahraga) menyatu
 * Aplikasi scoreboard asli (src/score/index.html) dijalankan di port sendiri agar semua alamat
 * absolutnya (/api/*, /events, /overlay, /hp, /data.json …) tetap sama seperti aplikasi UTC KLM:
 *   http://127.0.0.1:7171/          panel kontrol      /overlay   grafis (dipakai KLM Mix & OBS/vMix)
 *   /arena  /turnamen  /hp           layar arena, turnamen, aplikasi HP
 * Port 7171 dicoba lebih dulu (alamat lama di OBS/vMix tetap jalan), lalu port berikutnya.
 * Data (skor, data turnamen, preset) disimpan di <config>/score dan dipindahkan otomatis
 * dari instalasi UTC KLM lama bila ada.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_PORT = 7171;
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.html': 'text/html; charset=utf-8' };
const VIEWS = new Set(['/', '/control', '/overlay', '/arena', '/turnamen', '/hp', '/index.html']);

function oldDataDirs() {
  const h = os.homedir(), la = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local');
  return [
    path.join(la, 'Programs', 'UTC KLM', 'data'), path.join(la, 'Programs', 'UTC-KLM', 'data'),
    path.join(h, 'Desktop', 'UTC-KLM', 'data'), path.join(h, 'Desktop', 'UTC KLM', 'data'),
    path.join(h, 'OneDrive', 'Desktop', 'UTC-KLM', 'data'), path.join(h, 'UTC-KLM', 'data'), path.join(h, 'Documents', 'UTC-KLM', 'data')
  ];
}

module.exports = function createScore(opts) {
  const DATA = opts.dataDir, PUB = opts.pubDir;
  const STATE_FILE = path.join(DATA, 'state.json'), LIB_FILE = path.join(DATA, 'library.json'), PRESET_FILE = path.join(DATA, 'presets.json');
  const APP_FILE = path.join(PUB, 'index.html');
  try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) {}

  // ---------- pindahkan data dari UTC KLM lama (sekali) ----------
  let migratedFrom = '';
  if (!fs.existsSync(STATE_FILE) && !fs.existsSync(LIB_FILE)) {
    let best = null, bestT = 0;
    for (const d of (opts.oldDirs || oldDataDirs())) {
      for (const f of ['state.json', 'library.json', 'presets.json']) {
        try { const t = fs.statSync(path.join(d, f)).mtimeMs; if (t > bestT) { bestT = t; best = d; } } catch (e) {}
      }
    }
    if (best) {
      for (const f of ['state.json', 'library.json', 'presets.json']) { try { fs.writeFileSync(path.join(DATA, f), fs.readFileSync(path.join(best, f))); } catch (e) {} }
      migratedFrom = best;
      console.log('[KLM] Scoreboard: data dipindahkan dari ' + best);
    }
  }

  let state = null, flat = {}, lastControl = null, LIB_CACHE;
  const clients = new Set();
  const listeners = new Set();
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { state = null; }
  const getLib = () => { if (LIB_CACHE === undefined) { try { LIB_CACHE = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')); } catch (e) { LIB_CACHE = null; } } return LIB_CACHE; };
  let saveTimer = null;
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { fs.writeFile(STATE_FILE + '.tmp', JSON.stringify(state), (e) => { if (!e) fs.rename(STATE_FILE + '.tmp', STATE_FILE, () => {}); }); }, 400); };
  const emit = () => { for (const f of listeners) { try { f(); } catch (e) {} } };

  const send = (res, code, body, type, extra) => {
    res.writeHead(code, Object.assign({ 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }, extra || {}));
    res.end(body);
  };
  const json = (res, obj, code) => send(res, code || 200, JSON.stringify(obj));
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  const sse = (res, ev, data) => { try { res.write('event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) {} };
  const broadcast = (ev, data, filter) => { for (const c of clients) if (!filter || filter(c)) sse(c.res, ev, data); };
  const xmlEsc = (s) => String(s == null ? '' : s).replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));
  let PORT = 0;
  const withHost = (obj, req) => {
    const host = 'http://' + (req.headers.host || ('127.0.0.1:' + PORT));
    const o = Object.assign({}, obj);
    for (const k of ['HomeLogo', 'AwayLogo']) if (o[k] && String(o[k]).startsWith('/')) o[k] = host + o[k];
    return o;
  };
  const lan = () => (opts.localIPs ? opts.localIPs().map((x) => x.address) : []);

  // perintah ke panel kontrol scoreboard (mis. "home+1", "clock", "swap")
  function cmd(c) {
    c = String(c || '').replace(/ /g, '+');
    if (!c) return { ok: false, error: 'perintah kosong' };
    let target = lastControl && clients.has(lastControl) ? lastControl : null;
    if (!target) for (const x of clients) if (x.role === 'control') target = x;
    if (!target) return { ok: false, error: 'Panel scoreboard belum dibuka' };
    sse(target.res, 'cmd', { c });
    return { ok: true, cmd: c };
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    let p; try { p = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/'; } catch (e) { return send(res, 400, 'bad', 'text/plain'); }
    if (req.headers['service-worker'] === 'script') {
      const kill = "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>{e.waitUntil((async()=>{try{const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)))}catch(_){}await self.registration.unregister()})())})";
      return send(res, 200, kill, 'text/javascript; charset=utf-8');
    }
    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', { 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    if (p === '/manifest.webmanifest') {
      return send(res, 200, JSON.stringify({ name: 'UTC KLM Scoreboard', short_name: 'UTC KLM', start_url: '/hp', scope: '/', display: 'standalone', orientation: 'portrait', background_color: '#090C13', theme_color: '#090C13',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] }), 'application/manifest+json; charset=utf-8');
    }
    if (p === '/icon-192.png' || p === '/icon-512.png' || p === '/favicon.ico') {
      return fs.readFile(path.join(PUB, p === '/icon-512.png' ? 'icon-512.png' : 'icon-192.png'), (e, b) => e ? send(res, 404, '', 'text/plain') : send(res, 200, b, 'image/png', { 'Cache-Control': 'public, max-age=604800' }));
    }
    if (VIEWS.has(p)) {
      return fs.readFile(APP_FILE, (err, buf) => err ? send(res, 500, 'index.html tidak ditemukan', 'text/plain') : send(res, 200, buf, 'text/html; charset=utf-8'));
    }
    if (p === '/fonts-builtin/builtin.css') return send(res, 200, '/* huruf ada di fonts/fonts.css */', 'text/css; charset=utf-8', { 'Cache-Control': 'public, max-age=86400' });
    if (p === '/api/ping') return json(res, { app: 'UTC KLM', host: 'KLM Mix', now: Date.now(), port: PORT, ips: lan(), nets: lan().map((ip) => ({ ip, name: '', virt: false })), clients: clients.size });
    if (p === '/api/state' && req.method === 'GET') return json(res, { state });
    if (p === '/api/state' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, 8 * 1024 * 1024));
        if (!body || !body.state) return json(res, { ok: false, error: 'state kosong' }, 400);
        state = body.state;
        if (body.flat) flat = body.flat;
        for (const c of clients) if (c.id === body.from && c.role === 'control') lastControl = c;
        broadcast('state', { from: body.from, state, now: Date.now() });
        saveSoon(); emit();
        return json(res, { ok: true });
      } catch (e) { return json(res, { ok: false, error: String(e.message || e) }, 400); }
    }
    if (p === '/api/lib' && req.method === 'GET') {
      return fs.readFile(LIB_FILE, 'utf8', (err, txt) => { let lib = null; if (!err) { try { lib = JSON.parse(txt); } catch (e) {} } json(res, { lib }); });
    }
    if (p === '/api/lib' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, 40 * 1024 * 1024));
        if (!body || !body.lib || !Array.isArray(body.lib.teams)) return json(res, { ok: false, error: 'data turnamen tidak valid' }, 400);
        fs.writeFileSync(LIB_FILE + '.tmp', JSON.stringify(body.lib)); fs.renameSync(LIB_FILE + '.tmp', LIB_FILE);
        LIB_CACHE = body.lib;
        broadcast('lib', { from: body.from || '' }, (c) => c.role === 'control' || c.role === 'turnamen' || c.role === 'hp');
        return json(res, { ok: true });
      } catch (e) { return json(res, { ok: false, error: String(e.message || e) }, 400); }
    }
    if (p === '/api/presets' && req.method === 'GET') {
      return fs.readFile(PRESET_FILE, 'utf8', (err, txt) => { let presets = []; if (!err) { try { presets = JSON.parse(txt); } catch (e) {} } json(res, { presets: Array.isArray(presets) ? presets : [] }); });
    }
    if (p === '/api/presets' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req, 200 * 1024 * 1024));
        if (!body || !Array.isArray(body.presets)) return json(res, { ok: false, error: 'data preset tidak valid' }, 400);
        fs.writeFileSync(PRESET_FILE + '.tmp', JSON.stringify(body.presets)); fs.renameSync(PRESET_FILE + '.tmp', PRESET_FILE);
        broadcast('presets', { from: body.from || '' }, (c) => c.role === 'control' || c.role === 'hp');
        return json(res, { ok: true });
      } catch (e) { return json(res, { ok: false, error: String(e.message || e) }, 400); }
    }
    if (p === '/api/flat' && req.method === 'POST') {
      try { const body = JSON.parse(await readBody(req, 256 * 1024)); if (body && body.flat) flat = body.flat; return json(res, { ok: true }); } catch (e) { return json(res, { ok: false }, 400); }
    }
    if (p.startsWith('/api/cmd')) {
      const r = cmd(url.searchParams.get('c') || p.slice('/api/cmd/'.length));
      return json(res, r, r.ok ? 200 : (r.error === 'perintah kosong' ? 400 : 409));
    }
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no' });
      res.write('retry: 1500\n\n');
      const client = { id: url.searchParams.get('id') || '', role: url.searchParams.get('role') || 'overlay', res };
      clients.add(client);
      if (client.role === 'control') lastControl = client;
      sse(res, 'time', { now: Date.now() });
      if (state) sse(res, 'state', { from: 'server', state, now: Date.now() });
      req.on('close', () => { clients.delete(client); if (lastControl === client) lastControl = null; emit(); });
      emit();
      return;
    }
    if (p === '/data.json') return json(res, [withHost(flat, req)]);
    if (p === '/data.xml') {
      const f = withHost(flat, req);
      let x = '<?xml version="1.0" encoding="UTF-8"?>\n<utcklm>\n  <scoreboard>\n';
      for (const k of Object.keys(f)) x += '    <' + k + '>' + xmlEsc(f[k]) + '</' + k + '>\n';
      return send(res, 200, x + '  </scoreboard>\n</utcklm>\n', 'application/xml; charset=utf-8');
    }
    if (p === '/data.csv') {
      const keys = Object.keys(flat), q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      return send(res, 200, keys.join(',') + '\n' + keys.map((k) => q(flat[k])).join(',') + '\n', 'text/csv; charset=utf-8');
    }
    const ll = p.match(/^\/lib\/logo\/([^/]+?)(?:\.png)?$/);
    if (ll) {
      const lib = getLib();
      const t = lib && Array.isArray(lib.teams) && lib.teams.find((x) => x.id === ll[1]);
      const m = t && t.logo && String(t.logo).match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      if (!m) return send(res, 404, 'Logo tidak ada', 'text/plain');
      return send(res, 200, Buffer.from(m[2], 'base64'), m[1], { 'Cache-Control': 'public, max-age=86400' });
    }
    const lm = p.match(/^\/logo\/(home|away)\.png$/);
    if (lm) {
      const t = state && state.teams && state.teams[lm[1] === 'home' ? 0 : 1];
      const m = t && t.logo && String(t.logo).match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      return m ? send(res, 200, Buffer.from(m[2], 'base64'), m[1]) : send(res, 200, PIXEL, 'image/png');
    }
    // file statis (huruf, logo sponsor) — dari folder aplikasi, lalu folder data
    for (const base of [PUB, DATA]) {
      const safe = path.normalize(path.join(base, p));
      if (!safe.startsWith(base + path.sep) || /\.json$/i.test(safe)) continue;
      let st; try { st = fs.statSync(safe); } catch (e) { continue; }
      if (!st.isFile()) continue;
      const ext = path.extname(safe).toLowerCase();
      return fs.readFile(safe, (e2, buf) => e2 ? send(res, 500, 'Gagal membaca file', 'text/plain') : send(res, 200, buf, TYPES[ext] || 'application/octet-stream', /\.woff2?$|\.ttf$/.test(ext) ? { 'Cache-Control': 'public, max-age=604800' } : null));
    }
    send(res, 404, 'Tidak ditemukan', 'text/plain; charset=utf-8');
  }

  const server = http.createServer((q, s) => handle(q, s).catch((e) => { try { send(s, 500, String(e), 'text/plain'); } catch (_) {} }));
  server.keepAliveTimeout = 65000;
  const timer = setInterval(() => broadcast('time', { now: Date.now() }), 10000);
  timer.unref && timer.unref();

  function tryListen(port, host) {
    return new Promise((resolve) => {
      const onErr = (e) => { server.removeListener('listening', onOk); resolve(e.code || 'ERR'); };
      const onOk = () => { server.removeListener('error', onErr); resolve('OK'); };
      server.once('error', onErr); server.once('listening', onOk);
      if (host === '::') server.listen({ port, host: '::', ipv6Only: false }); else server.listen(port, host);
    });
  }
  // setelah listen, pastikan 127.0.0.1 & ::1 memang sampai ke server ini (bukan UTC KLM lama / aplikasi lain)
  function probe(port, host) {
    return new Promise((resolve) => {
      const rq = http.get({ host, port, path: '/api/ping', timeout: 1200 }, (r) => {
        let b = ''; r.on('data', (c) => b += c);
        r.on('end', () => { try { resolve(JSON.parse(b).host === 'KLM Mix' ? 'ours' : 'other'); } catch (e) { resolve('other'); } });
      });
      rq.on('error', (e) => resolve(/ECONNREFUSED|EADDRNOTAVAIL|ENETUNREACH|EAFNOSUPPORT/.test(e.code || '') ? 'none' : 'other'));
      rq.on('timeout', () => { rq.destroy(); resolve('other'); });
    });
  }
  const closeS = () => new Promise((r) => server.close(() => r()));
  async function start(prefer) {
    const cands = [prefer || DEFAULT_PORT];
    for (let p = DEFAULT_PORT; p < DEFAULT_PORT + 30; p++) if (!cands.includes(p)) cands.push(p);
    for (const p of cands) {
      let r = await tryListen(p, '::');
      if (r === 'EAFNOSUPPORT' || r === 'EADDRNOTAVAIL') r = await tryListen(p, '0.0.0.0');
      if (r !== 'OK') continue;
      PORT = p;
      if ((await probe(p, '127.0.0.1')) === 'ours' && (await probe(p, '::1')) !== 'other') break;
      PORT = 0; await closeS();
    }
    if (PORT) console.log('[KLM Mix] Scoreboard :' + PORT);
    else console.warn('[KLM] Scoreboard: tidak ada port kosong');
    return PORT;
  }
  function status() {
    let roles = {};
    for (const c of clients) roles[c.role] = (roles[c.role] || 0) + 1;
    const st = state || {}, t = st.teams || [];
    return { port: PORT, migratedFrom, clients: roles, control: !!(lastControl && clients.has(lastControl)), hasState: !!state,
      visible: !!(st.ov && st.ov.visible), sport: st.sport || '', title: (st.match && st.match.title) || '',
      home: t[0] ? (t[0].short || t[0].name || 'HOME') : 'HOME', away: t[1] ? (t[1].short || t[1].name || 'AWAY') : 'AWAY',
      score: Array.isArray(st.score) ? st.score : [0, 0], period: st.period || 1, running: !!(st.clock && st.clock.running),
      extra: !!((st.lower && st.lower.on) || (st.ticker && st.ticker.on) || st.popup || st.gfx) };
  }
  return {
    start, cmd, status, port: () => PORT,
    onChange: (f) => listeners.add(f),
    flat: () => flat,
    shutdown() { clearInterval(timer); for (const c of clients) { try { c.res.end(); } catch (e) {} } try { server.close(); } catch (e) {} }
  };
};
