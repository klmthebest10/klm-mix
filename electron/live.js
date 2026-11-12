/* KLM Mix — akun live streaming: kredensial API (YouTube OAuth, token Facebook) disimpan terenkripsi
 * (safeStorage Windows/DPAPI) di folder konfigurasi, tidak pernah dikirim ke halaman. */
'use strict';
const { ipcMain, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const API = require('./live-api');

function setup(opts) {
  const file = () => path.join(opts.configDir(), 'live-auth.json');
  let db = null;
  const enc = (o) => { const s = JSON.stringify(o); return safeStorage.isEncryptionAvailable() ? 'e:' + safeStorage.encryptString(s).toString('base64') : 'p:' + Buffer.from(s).toString('base64'); };
  const dec = (v) => { try { return JSON.parse(v.startsWith('e:') ? safeStorage.decryptString(Buffer.from(v.slice(2), 'base64')) : Buffer.from(v.slice(2), 'base64').toString()); } catch (e) { return null; } };
  function load() {
    if (db) return db;
    db = {};
    try { const raw = JSON.parse(fs.readFileSync(file(), 'utf8')); for (const [k, v] of Object.entries(raw)) { const o = dec(v); if (o) db[k] = o; } } catch (e) {}
    return db;
  }
  function save() {
    const out = {}; for (const [k, v] of Object.entries(db || {})) out[k] = enc(v);
    try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(out, null, 1)); } catch (e) { console.warn('live-auth', e.message); }
  }
  const pub = (r) => (r ? { kind: r.kind, name: r.name || '', id: r.target || r.channelId || '' } : null);
  const base = () => (process.env.KLM_LIVE_BASE ? JSON.parse(process.env.KLM_LIVE_BASE) : undefined); // uji dengan server tiruan
  const tokens = new Map(); // akses token YouTube sementara
  async function ytTok(id, r) {
    const c = tokens.get(id);
    if (c && c.exp > Date.now()) return c.tok;
    const tok = await API.googleRefresh({ clientId: r.clientId, clientSecret: r.clientSecret, refresh: r.refresh, base: base() });
    tokens.set(id, { tok, exp: Date.now() + 50 * 60000 });
    return tok;
  }

  ipcMain.handle('live:auth-list', () => { const d = load(), o = {}; for (const k of Object.keys(d)) o[k] = pub(d[k]); return o; });
  ipcMain.handle('live:yt-connect', async (e, accId, clientId, clientSecret) => {
    try {
      clientId = String(clientId || '').trim(); clientSecret = String(clientSecret || '').trim();
      if (!/\.apps\.googleusercontent\.com$/.test(clientId)) return { ok: false, error: 'Client ID harus berakhiran .apps.googleusercontent.com' };
      if (!clientSecret) return { ok: false, error: 'Client secret kosong' };
      const t = await API.googleLogin({ clientId, clientSecret, open: (u) => shell.openExternal(u), base: base() });
      const ch = await API.yt(base()).channel(t.access_token);
      load()[accId] = { kind: 'yt', clientId, clientSecret, refresh: t.refresh_token, channelId: ch.id, name: ch.title };
      tokens.set(accId, { tok: t.access_token, exp: Date.now() + Math.max(60, (t.expires_in || 3600) - 300) * 1000 });
      save();
      return { ok: true, name: ch.title };
    } catch (er) { return { ok: false, error: er.message }; }
  });
  ipcMain.handle('live:fb-connect', async (e, accId, token, target) => {
    try {
      token = String(token || '').trim(); target = String(target || '').trim() || 'me';
      if (token.length < 20) return { ok: false, error: 'Access token tidak valid' };
      const w = await API.fb(base()).who(token, target);
      load()[accId] = { kind: 'fb', token, target: w.id, name: w.name };
      save();
      return { ok: true, name: w.name };
    } catch (er) { return { ok: false, error: er.message }; }
  });
  ipcMain.handle('live:forget', (e, accId) => { load(); delete db[accId]; tokens.delete(accId); save(); return true; });
  /** siapkan siaran untuk akun ber-API → [{accId, ok, url, ref, watch, warn, error}] */
  ipcMain.handle('live:prepare', async (e, list, meta) => {
    const d = load();
    return Promise.all((list || []).map(async (a) => {
      const r = d[a.accId];
      if (!r) return { accId: a.accId, ok: false, error: 'akun belum terhubung API' };
      try {
        if (r.kind === 'yt') {
          const tok = await ytTok(a.accId, r);
          const p = await API.yt(base()).prepare(tok, meta || {}, r.streamId);
          if (p.streamId !== r.streamId) { r.streamId = p.streamId; save(); }
          return { accId: a.accId, ok: true, url: p.url, ref: { kind: 'yt', id: p.id }, watch: p.watch, warn: p.warn };
        }
        if (r.kind === 'fb') {
          const p = await API.fb(base()).prepare(r.token, r.target, meta || {});
          return { accId: a.accId, ok: true, url: p.url, ref: { kind: 'fb', id: p.id }, watch: p.watch, warn: p.warn };
        }
        return { accId: a.accId, ok: false, error: 'jenis akun tidak dikenal' };
      } catch (er) { return { accId: a.accId, ok: false, error: er.message }; }
    }));
  });
  ipcMain.handle('live:end', async (e, refs) => {
    const d = load();
    await Promise.all((refs || []).map(async (x) => {
      const r = d[x.accId]; if (!r || !x.ref) return;
      try {
        if (x.ref.kind === 'yt') await API.yt(base()).end(await ytTok(x.accId, r), x.ref.id);
        else if (x.ref.kind === 'fb') await API.fb(base()).end(r.token, x.ref.id);
      } catch (er) {}
    }));
    return true;
  });
}

module.exports = { setup };
