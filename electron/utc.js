/* KLM Mix - server UTC KLM Acara (menyatu di dalam KLM Mix)
 * API identik dengan UTC KLM Acara 9.0 (versi Go), hanya di bawah awalan /utc:
 *   /utc                 panel kontrol asli          /utc/overlay      overlay grafis (1920x1080, transparan)
 *   /utc/api/info|state|presets|upload|upload-video|oc/end|uploads/*  /utc/events (SSE)
 *   /utc/api/sw*         switcher: KLM Mix (bawaan) / OBS / vMix
 *   /utc/api/klm/cmd     perintah cepat dari KLM Mix (API, Stream Deck, remote HP, skrip)
 *   /utc/api/klm/import  impor preset/logo/video dari UTC KLM Acara lama
 *   /uploads/*           logo & video (alamat sama seperti versi lama → preset lama tetap jalan)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const createSwitch = require('./utc-switch');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.ogv': 'video/ogg', '.ogg': 'video/ogg'
};

module.exports = function createUtc(o) {
  const dataDir = o.dataDir, pubDir = o.pubDir;
  const preDir = path.join(dataDir, 'presets'), upDir = path.join(dataDir, 'uploads');
  [dataDir, preDir, upDir].forEach((d) => { try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} });

  // ---------- logika asli UTC (common.js) dijalankan di Node ----------
  let K = null;
  try {
    const ctx = { console, setTimeout, clearTimeout, Math, Date, JSON };
    ctx.window = ctx; ctx.self = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(pubDir, 'common.js'), 'utf8'), ctx, { filename: 'utc-common.js' });
    K = ctx.KLM;
  } catch (e) { console.warn('[UTC] common.js gagal dimuat:', e.message); }

  // ---------- state ----------
  let state = null, rev = 0, lastFrom = '';
  try { state = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8').replace(/^﻿/, '')); } catch (e) {}
  let saveT = null;
  function saveState() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const f = path.join(dataDir, 'state.json');
      try { fs.writeFileSync(f + '.tmp', JSON.stringify(state)); fs.renameSync(f + '.tmp', f); } catch (e) {}
    }, 250);
  }
  const stateMsg = (from) => 'data: ' + JSON.stringify({ rev, from, state }) + '\n\n';

  // ---------- SSE ----------
  function hub() {
    const set = new Set();
    return {
      add(res, first) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
        res.write('retry: 1500\n'); if (first) res.write(first);
        set.add(res);
        res.on('close', () => set.delete(res));
      },
      send(m) { for (const r of set) { try { r.write(m); } catch (e) {} } },
      get size() { return set.size; }
    };
  }
  const sse = hub(), swHub = hub();
  setInterval(() => { sse.send(': ka\n\n'); swHub.send(': ka\n\n'); }, 15000);
  const listeners = new Set();
  function changed(from) {
    rev++; lastFrom = from || 'server';
    saveState();
    sse.send(stateMsg(lastFrom));
    for (const fn of listeners) { try { fn(state); } catch (e) {} }
  }

  // ---------- util ----------
  function send(res, code, body) {
    const h = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
    if (typeof body === 'string') { h['Content-Type'] = 'text/plain; charset=utf-8'; res.writeHead(code, h); return res.end(body); }
    h['Content-Type'] = MIME['.json']; res.writeHead(code, h); res.end(JSON.stringify(body));
  }
  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = []; let n = 0;
      req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('Terlalu besar')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  async function readJSON(req, limit) {
    const b = (await readBody(req, limit)).toString('utf8').replace(/^﻿/, '').trim();
    return b ? JSON.parse(b) : {};
  }
  const safeName = (s) => String(s || '').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().slice(0, 60);
  const base36now = () => Date.now().toString(36);
  function baseName(name, def, max) {
    let b = path.basename(String(name || '').replace(/\\/g, '/'), path.extname(String(name || '')));
    b = safeName(b).replace(/ /g, '_') || def;
    return b.slice(0, max);
  }
  function serveFile(req, res, file) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Tidak ditemukan');
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' };
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (m) {
        let s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : st.size - 1;
        if (s >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
        e = Math.min(e, st.size - 1);
        h['Content-Range'] = `bytes ${s}-${e}/${st.size}`; h['Content-Length'] = e - s + 1;
        res.writeHead(206, h); fs.createReadStream(file, { start: s, end: e }).pipe(res);
      } else {
        h['Content-Length'] = st.size; res.writeHead(200, h);
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
      }
    });
  }
  function inside(root, rel) {
    const f = path.normalize(path.join(root, rel));
    return f.startsWith(path.normalize(root + path.sep)) ? f : null;
  }

  // ---------- event aktif ----------
  function ensureState() {
    if (!state || !state.events) state = K ? K.defaultState() : { v: 1, eventType: 'pengajian', events: {}, logos: [] };
    if (K && !K.EVENTS.some((e) => e.id === state.eventType)) state.eventType = 'pengajian';
    if (!state.events[state.eventType] && K) state.events[state.eventType] = K.makeEventConfig(state.eventType);
    if (K) { try { K.upgradeEvent(state.eventType, state.events[state.eventType]); K.normalizeEvent(state.eventType, state.events[state.eventType]); } catch (e) {} }
    return state.events[state.eventType];
  }

  // ---------- perintah cepat dari KLM Mix ----------
  const KEYS = { lt: 'lt', lowerthird: 'lt', title: 'tt', tt: 'tt', judul: 'tt', ticker: 'tk', tk: 'tk', runningtext: 'tk', running: 'tk', logo: 'bug', bug: 'bug', loc: 'loc', lokasi: 'loc', soc: 'soc', sosmed: 'soc', social: 'soc' };
  const ITEMS = ['lt', 'tt', 'loc', 'soc'];
  function klmCmd(c) {
    const ev = ensureState();
    const key = KEYS[String(c.target || c.Value || '').toLowerCase().replace(/[^a-z]/g, '')];
    const cmd = String(c.cmd || '').toLowerCase();
    const items = (k) => (ev[k] && ev[k].items) || [];
    const curIdx = (k) => { const it = items(k); const i = it.findIndex((x) => x.id === ev[k].activeId); return i < 0 ? 0 : i; };
    switch (cmd) {
      case 'show': case 'hide': case 'toggle': {
        if (!key) return { ok: false, msg: 'Elemen tidak dikenal (lt/title/ticker/logo/loc/soc)' };
        ev[key].visible = cmd === 'toggle' ? !ev[key].visible : cmd === 'show';
        if (ev[key].visible && ITEMS.includes(key) && !ev[key].activeId && items(key)[0]) ev[key].activeId = items(key)[0].id;
        break;
      }
      case 'next': case 'prev': case 'previous': {
        const k = key || 'lt'; const it = items(k); if (!it.length) return { ok: false, msg: 'Daftar kosong' };
        const i = (curIdx(k) + (cmd === 'next' ? 1 : -1) + it.length) % it.length;
        ev[k].activeId = it[i].id; if (c.show) ev[k].visible = true;
        break;
      }
      case 'select': {
        const k = key || 'lt'; const q = String(c.name || c.Name || '').toLowerCase().trim();
        const it = items(k).find((x, i) => String(i + 1) === q || [x.label, x.name, x.title, x.place, x.handle].some((v) => v && String(v).toLowerCase() === q))
          || items(k).find((x) => [x.label, x.name, x.title, x.place].some((v) => v && String(v).toLowerCase().includes(q)));
        if (!it) return { ok: false, msg: 'Item "' + q + '" tidak ditemukan' };
        ev[k].activeId = it.id; ev[k].visible = true;
        break;
      }
      case 'settext': { // ubah teks item aktif: field = name/role/title/sub/place/...
        const k = key || 'lt'; const it = items(k).find((x) => x.id === ev[k].activeId) || items(k)[0];
        if (!it) return { ok: false, msg: 'Daftar kosong' };
        const f = String(c.field || c.Name || 'name'); it[f] = String(c.text != null ? c.text : '');
        break;
      }
      case 'tkset': { // ganti pesan running text: items [{id?, title, text (boleh banyak baris), on}], badge, speed, show
        if (!ev.tk) return { ok: false, msg: 'Running text tidak tersedia' };
        if (Array.isArray(c.items)) {
          const old = new Map(items('tk').map((x) => [x.id, x]));
          ev.tk.items = c.items.slice(0, 100).map((x) => {
            const o = (x && old.get(x.id)) || {};
            return Object.assign({}, o, { id: o.id || (K ? K.uid() : 'tk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
              title: String((x && x.title) || '').slice(0, 80), text: String((x && x.text) || '').slice(0, 8000), on: !(x && x.on === false) });
          });
        }
        if (c.badge != null) ev.tk.badge = String(c.badge).slice(0, 40);
        if (c.speed != null && isFinite(+c.speed)) ev.tk.speed = Math.max(30, Math.min(400, +c.speed));
        if (c.show != null) ev.tk.visible = !!c.show;
        break;
      }
      case 'hideall':
        ['lt', 'tt', 'tk', 'bug', 'loc', 'soc'].forEach((k) => { if (ev[k]) ev[k].visible = false; });
        ev.oc.active = null; ev.oc.done = false;
        break;
      case 'opening': case 'closing':
        ev.oc.active = cmd; ev.oc.run = K ? K.uid() : String(Date.now()); ev.oc.done = false;
        break;
      case 'ocoff': ev.oc.active = null; ev.oc.done = false; break;
      case 'event': {
        const id = String(c.name || c.Name || c.Value || '').toLowerCase();
        if (K && !K.EVENTS.some((e) => e.id === id)) return { ok: false, msg: 'Jenis acara: ' + K.EVENTS.map((e) => e.id).join(', ') };
        state.eventType = id; ensureState();
        break;
      }
      case 'preset': {
        const name = safeName(c.name || c.Name || c.Value);
        let raw; try { raw = JSON.parse(fs.readFileSync(path.join(preDir, name + '.json'), 'utf8').replace(/^﻿/, '')); } catch (e) { return { ok: false, msg: 'Preset "' + name + '" tidak ditemukan' }; }
        const p = K ? K.readPreset(JSON.parse(JSON.stringify(raw))) : raw;
        if (!p || !p.config) return { ok: false, msg: 'Preset tidak valid' };
        for (const k of ['lt', 'tt', 'tk', 'bug', 'loc', 'soc']) if (p.config[k]) p.config[k].visible = false;
        if (p.config.oc) { p.config.oc.active = null; p.config.oc.done = false; }
        state.eventType = p.eventType; state.events[p.eventType] = p.config; ensureState();
        break;
      }
      case 'status': return { ok: true, status: status() };
      default: return { ok: false, msg: 'Perintah tidak dikenal: ' + cmd };
    }
    changed('klm');
    return { ok: true, status: status() };
  }
  function status() {
    if (!state || !state.events) return { eventType: '', visible: {} };
    const ev = state.events[state.eventType] || {};
    const act = (k) => { const x = ev[k] && (ev[k].items || []).find((i) => i.id === ev[k].activeId); return x ? (x.name || x.title || x.place || x.label || '') : ''; };
    const vis = {}; ['lt', 'tt', 'tk', 'bug', 'loc', 'soc'].forEach((k) => { vis[k] = !!(ev[k] && ev[k].visible); });
    const ocv = ev.oc || {};
    const oc = ocv.active && ocv[ocv.active] ? { kind: ocv.active, run: ocv.run, done: !!ocv.done, video: ocv[ocv.active].type === 'video' && ocv[ocv.active].video ? ocv[ocv.active].video.url : '', sound: ocv[ocv.active].sound !== false, volume: ocv[ocv.active].volume == null ? 100 : ocv[ocv.active].volume } : null;
    return {
      events: K ? K.EVENTS.map((e) => ({ id: e.id, n: e.n })) : [],
      eventType: state.eventType, eventName: K ? (K.EVENTS.find((e) => e.id === state.eventType) || {}).n || state.eventType : state.eventType,
      visible: vis, active: { lt: act('lt'), tt: act('tt'), loc: act('loc'), soc: act('soc') },
      lists: { lt: (ev.lt && ev.lt.items || []).map((x) => ({ id: x.id, label: x.label, name: x.name, role: x.role })), tt: (ev.tt && ev.tt.items || []).map((x) => ({ id: x.id, label: x.label, title: x.title })) },
      activeId: { lt: ev.lt && ev.lt.activeId, tt: ev.tt && ev.tt.activeId, loc: ev.loc && ev.loc.activeId, soc: ev.soc && ev.soc.activeId },
      tk: ev.tk ? { badge: ev.tk.badge || '', speed: ev.tk.speed || 120, items: (ev.tk.items || []).map((x) => ({ id: x.id, title: x.title || '', text: x.text || '', on: !!x.on })) } : null,
      ll: { loc: (ev.loc && ev.loc.items || []).map((x) => ({ id: x.id, label: x.label, place: x.place })), soc: (ev.soc && ev.soc.items || []).map((x) => ({ id: x.id, label: x.label, handle: x.handle })) },
      oc, rev
    };
  }

  // ---------- impor data UTC KLM Acara lama ----------
  function legacyDirs() {
    const out = [];
    const la = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    out.push(path.join(la, 'Programs', 'UTC KLM Acara', 'data'));
    for (const d of ['Desktop', 'Downloads', 'Documents']) {
      const base = path.join(os.homedir(), d);
      try { for (const n of fs.readdirSync(base)) if (/utc[-_ ]?klm[-_ ]?acara/i.test(n)) out.push(path.join(base, n, 'data')); } catch (e) {}
    }
    if (process.env.KLM_UTC_LEGACY) out.unshift(process.env.KLM_UTC_LEGACY);
    const isDir = (d) => { try { return fs.statSync(d).isDirectory(); } catch (e) { return false; } };
    // terima folder instalasi (berisi "data") maupun folder "data" itu sendiri
    return [...new Set(out.map((d) => (isDir(path.join(d, 'data')) && !isDir(path.join(d, 'presets')) ? path.join(d, 'data') : d)))].filter(isDir);
  }
  function importLegacy(force) {
    const markF = path.join(dataDir, 'imported.json');
    let mark = {}; try { mark = JSON.parse(fs.readFileSync(markF, 'utf8')); } catch (e) {}
    const res = { presets: 0, files: 0, state: false, from: [] };
    for (const src of legacyDirs()) {
      if (mark[src] && !force) continue;
      res.from.push(src);
      try {
        for (const f of fs.readdirSync(path.join(src, 'uploads'))) {
          const to = path.join(upDir, f);
          if (!fs.existsSync(to)) { try { fs.copyFileSync(path.join(src, 'uploads', f), to); res.files++; } catch (e) {} }
        }
      } catch (e) {}
      try {
        for (const f of fs.readdirSync(path.join(src, 'presets'))) {
          if (!/\.json$/i.test(f)) continue;
          const from = path.join(src, 'presets', f); let to = path.join(preDir, f);
          if (fs.existsSync(to)) {
            if (fs.readFileSync(to, 'utf8') === fs.readFileSync(from, 'utf8')) continue;
            to = path.join(preDir, f.replace(/\.json$/i, '') + ' lama.json'); if (fs.existsSync(to)) continue;
          }
          try { fs.copyFileSync(from, to); res.presets++; } catch (e) {}
        }
      } catch (e) {}
      // pengaturan OBS/vMix lama ikut dibawa (switcher tetap KLM Mix sebagai bawaan)
      const swF = path.join(dataDir, 'switcher.json');
      if (!fs.existsSync(swF)) {
        try {
          const sw = JSON.parse(fs.readFileSync(path.join(src, 'switcher.json'), 'utf8'));
          fs.writeFileSync(swF, JSON.stringify({ type: 'klm', obs: sw.obs, vmix: sw.vmix, quality: sw.quality, fps: sw.fps, trans: 'Fade', dur: sw.dur, legacyType: sw.type }, null, 1));
        } catch (e) {}
      }
      if (!state) {
        try {
          const st = JSON.parse(fs.readFileSync(path.join(src, 'state.json'), 'utf8').replace(/^﻿/, ''));
          if (st && st.events) {
            for (const id in st.events) { const ev = st.events[id]; ['lt', 'tt', 'tk', 'bug', 'loc', 'soc'].forEach((k) => { if (ev[k]) ev[k].visible = false; }); if (ev.oc) { ev.oc.active = null; ev.oc.done = false; } }
            state = st; res.state = true; saveState();
          }
        } catch (e) {}
      }
      mark[src] = Date.now();
    }
    try { fs.writeFileSync(markF, JSON.stringify(mark, null, 1)); } catch (e) {}
    if (res.from.length) console.log('[UTC] impor data lama:', JSON.stringify(res));
    return res;
  }
  try { importLegacy(false); } catch (e) { console.warn('[UTC] impor:', e.message); }
  const importedFrom = () => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(dataDir, 'imported.json'), 'utf8'))); } catch (e) { return []; } };

  // ---------- switcher ----------
  const SW = createSwitch({ dataDir, mixer: o.mixer, onStatus: (st) => swHub.send('data: ' + JSON.stringify(st) + '\n\n') });

  // ---------- router ----------
  const PUB = { '/utc': 'control.html', '/utc/': 'control.html', '/utc/overlay': 'overlay.html', '/utc/control': 'control.html' };
  async function handle(req, res, p, q) {
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
      if (p.startsWith('/uploads/')) { const f = inside(upDir, path.basename(p.slice(9))); return f ? serveFile(req, res, f) : send(res, 404, 'Tidak ditemukan'); }
      if (PUB[p]) return serveFile(req, res, path.join(pubDir, PUB[p]));
      if (!p.startsWith('/utc/api/') && p !== '/utc/events') {
        const f = inside(pubDir, p.slice(5));
        return f ? serveFile(req, res, f) : send(res, 404, 'Tidak ditemukan');
      }
      const a = p.slice(4); // '/api/...' atau '/events'
      const M = req.method;
      if (a === '/api/info') return send(res, 200, { app: 'UTC KLM Acara', host: 'KLM Mix', port: o.port(), ips: o.localIPs().map((x) => x.address), dataDir, imported: importedFrom(), klm: true });
      if (a === '/api/state' && M === 'GET') return send(res, 200, { rev, state });
      if (a === '/api/state' && M === 'POST') {
        const b = await readJSON(req, 25e6);
        if (!b.state || typeof b.state !== 'object') return send(res, 400, { error: 'state kosong' });
        state = b.state; changed(String(b.from || ''));
        return send(res, 200, { rev });
      }
      if (a === '/events') return sse.add(res, stateMsg(''));
      // ---- switcher ----
      if (a === '/api/sw' && M === 'GET') return send(res, 200, { config: SW.config(), status: SW.status() });
      if (a === '/api/sw/config' && M === 'POST') return send(res, 200, SW.setConfig(await readJSON(req, 1e6)));
      if (a === '/api/sw/cmd' && M === 'POST') {
        try { await SW.command(await readJSON(req, 1e6)); send(res, 200, { ok: true }); } catch (e) { send(res, 200, { ok: false, error: e.message }); }
        return;
      }
      if (a === '/api/sw/events') return swHub.add(res, 'data: ' + JSON.stringify(SW.status()) + '\n\n');
      if (a.startsWith('/api/sw/frame/')) {
        const r = await SW.frame(a.slice(14), +q.get('since') || 0);
        if (!r) { res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': r.type || 'image/jpeg', 'Cache-Control': 'no-store', 'X-Seq': String(r.seq), 'Access-Control-Expose-Headers': 'X-Seq' });
        return res.end(r.buf);
      }
      if (a === '/api/sw/thumb') {
        const r = await SW.thumb(q.get('id'));
        if (!r || String(r.v) === q.get('v')) { res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
        res.writeHead(200, { 'Content-Type': r.type || 'image/jpeg', 'Cache-Control': 'no-store', 'X-V': String(r.v), 'Access-Control-Expose-Headers': 'X-V' });
        return res.end(r.buf);
      }
      // ---- preset ----
      if (a === '/api/presets' && M === 'GET') {
        const list = [];
        for (const f of fs.readdirSync(preDir)) {
          if (!/\.json$/i.test(f)) continue;
          const fp = path.join(preDir, f); let ev = '';
          try { ev = JSON.parse(fs.readFileSync(fp, 'utf8').replace(/^﻿/, '')).eventType || ''; } catch (e) {}
          let mt = 0; try { mt = fs.statSync(fp).mtimeMs; } catch (e) {}
          list.push({ name: f.replace(/\.json$/i, ''), eventType: ev, mtime: mt });
        }
        list.sort((x, y) => y.mtime - x.mtime);
        return send(res, 200, list);
      }
      if (a.startsWith('/api/presets/')) {
        const name = safeName(decodeURIComponent(a.slice(13)));
        if (!name) return send(res, 400, { error: 'nama tidak valid' });
        const fp = path.join(preDir, name + '.json');
        if (M === 'GET') { try { res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(fp)); } catch (e) { return send(res, 404, { error: 'tidak ada' }); } }
        if (M === 'POST') { const b = await readJSON(req, 25e6); fs.writeFileSync(fp, JSON.stringify(b)); return send(res, 200, { ok: true, name }); }
        if (M === 'DELETE') { try { fs.unlinkSync(fp); } catch (e) {} return send(res, 200, { ok: true }); }
      }
      // ---- upload logo (base64) ----
      if (a === '/api/upload' && M === 'POST') {
        const b = await readJSON(req, 25e6);
        const m = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,(.+)$/.exec(String(b.data || ''));
        if (!m) return send(res, 400, { error: 'Format gambar tidak didukung (PNG/JPG/WEBP/GIF/SVG)' });
        const ext = m[1] === 'svg+xml' ? 'svg' : m[1].replace('jpeg', 'jpg');
        const file = baseName(b.name || 'logo', 'logo', 30) + '_' + base36now() + '.' + ext;
        fs.writeFileSync(path.join(upDir, file), Buffer.from(m[2], 'base64'));
        return send(res, 200, { url: '/uploads/' + file, file });
      }
      // ---- upload video (dialirkan langsung ke disk) ----
      if (a === '/api/upload-video' && M === 'POST') {
        const orig = q.get('name') || 'video.mp4', ext = path.extname(orig).toLowerCase();
        if (!['.mp4', '.m4v', '.webm', '.mov', '.ogv', '.ogg'].includes(ext)) { req.resume(); return send(res, 400, { error: 'Format video harus MP4 / WEBM / MOV' }); }
        const file = baseName(orig, 'video', 40) + '_' + base36now() + ext, fp = path.join(upDir, file);
        const ws = fs.createWriteStream(fp); let n = 0, over = false;
        req.on('data', (c) => { n += c.length; if (n > 4e9 && !over) { over = true; req.unpipe(ws); ws.destroy(); fs.unlink(fp, () => {}); send(res, 413, { error: 'Video terlalu besar (maks 4 GB)' }); } });
        req.pipe(ws);
        ws.on('finish', () => { if (!over) send(res, 200, { url: '/uploads/' + file, file, size: n }); });
        ws.on('error', (e) => { if (!over) send(res, 500, { error: e.message }); });
        return;
      }
      // ---- opening/closing selesai (dilaporkan overlay) ----
      if (a === '/api/oc/end' && M === 'POST') {
        const b = await readJSON(req, 1e6);
        const ev = state && state.events && state.events[String(b.ev || '')];
        const oc = ev && ev.oc;
        if (oc && b.kind && oc.active === b.kind && String(oc.run) === String(b.run) && !oc.done) {
          oc.done = true;
          if (b.kind === 'opening' && !(oc.opening && oc.opening.autoOff === false)) oc.active = null; // otomatis OFF → grafis lain tampil lagi
          changed('server');
        }
        return send(res, 200, { ok: true });
      }
      if (a.startsWith('/api/uploads/') && M === 'DELETE') {
        const f = inside(upDir, path.basename(decodeURIComponent(a.slice(13))));
        if (f) try { fs.unlinkSync(f); } catch (e) {}
        return send(res, 200, { ok: true });
      }
      // ---- khusus KLM Mix ----
      if (a === '/api/klm/cmd' && M === 'POST') return send(res, 200, klmCmd(await readJSON(req, 1e6)));
      if (a === '/api/klm/status') return send(res, 200, status());
      if (a === '/api/klm/import' && M === 'POST') {
        const r = importLegacy(true);
        if (r.state) changed('server');
        return send(res, 200, { ok: true, msg: r.from.length ? `Diimpor: ${r.presets} preset, ${r.files} file logo/video` : 'Folder UTC KLM Acara lama tidak ditemukan di PC ini', result: r });
      }
      return send(res, 404, { error: 'Tidak ditemukan' });
    } catch (e) {
      try { send(res, 500, { error: e.message }); } catch (_) {}
    }
  }

  return {
    handle, status, klmCmd, onMixerMessage: (m) => SW.onMixerMessage(m), onMixerState: () => SW.onMixerState(),
    onState: (fn) => listeners.add(fn), getState: () => state, shutdown: () => SW.shutdown()
  };
};
