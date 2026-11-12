/* KLM Mix — API platform live (YouTube Data API v3, Facebook Graph Live Video API).
 * Fungsi murni berbasis fetch; alamat server bisa diganti (uji dengan server tiruan).
 * TikTok & Instagram tidak menyediakan API publik untuk membuat siaran → cukup server + stream key. */
'use strict';
const http = require('http');
const crypto = require('crypto');

const BASE = {
  googleAuth: 'https://accounts.google.com/o/oauth2/v2/auth',
  googleToken: 'https://oauth2.googleapis.com/token',
  yt: 'https://www.googleapis.com/youtube/v3',
  ytUpload: 'https://www.googleapis.com/upload/youtube/v3',
  graph: 'https://graph.facebook.com/v26.0'
};
const YT_SCOPE = 'https://www.googleapis.com/auth/youtube';

function apiError(j, status) {
  const e = (j && j.error) || {};
  if (typeof e === 'string') return new Error(e === 'invalid_grant' ? 'Izin YouTube kadaluarsa atau dicabut — hubungkan ulang akun (' + (j.error_description || e) + ')' : (j.error_description || e));
  const msg = e.message || e.error_description || 'HTTP ' + status;
  const reason = e.errors && e.errors[0] && e.errors[0].reason;
  return new Error(msg + (reason ? ' (' + reason + ')' : ''));
}
async function req(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(20000) }, opts || {}));
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { raw: txt }; }
  if (!r.ok || (j && j.error)) throw apiError(j, r.status);
  return j;
}
const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]));

// ---------------- Google OAuth (aplikasi desktop, loopback + PKCE) ----------------
/** buka browser untuk izin YouTube; resolve {refresh_token, access_token, expires_in} */
function googleLogin({ clientId, clientSecret, open, base, timeoutMs }) {
  const B = Object.assign({}, BASE, base || {});
  return new Promise((resolve, reject) => {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(12).toString('hex');
    let done = false;
    const srv = http.createServer(async (rq, rs) => {
      const u = new URL(rq.url, 'http://127.0.0.1');
      if (u.pathname !== '/' || (!u.searchParams.get('code') && !u.searchParams.get('error'))) { rs.writeHead(404); return rs.end(); }
      const page = (ok, m) => { rs.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); rs.end('<!doctype html><meta charset="utf-8"><title>KLM Mix</title><body style="font:16px system-ui;background:#0b0d12;color:#eceff4;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>' + (ok ? '✅ Akun terhubung ke KLM Mix' : '⚠ Gagal menghubungkan') + '</h2><p>' + m + '</p><p style="color:#8a93a5">Jendela ini boleh ditutup.</p></div>'); };
      if (u.searchParams.get('state') !== state) { page(false, 'Permintaan tidak cocok (state).'); return; }
      if (u.searchParams.get('error')) { page(false, 'Izin ditolak: ' + u.searchParams.get('error')); finish(new Error('Izin Google ditolak (' + u.searchParams.get('error') + ')')); return; }
      try {
        const port = srv.address().port;
        const tok = await req(B.googleToken, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form({ code: u.searchParams.get('code'), client_id: clientId, client_secret: clientSecret, redirect_uri: 'http://127.0.0.1:' + port, grant_type: 'authorization_code', code_verifier: verifier }) });
        if (!tok.refresh_token) throw new Error('Google tidak memberi refresh token — cabut akses KLM Mix di myaccount.google.com/permissions lalu coba lagi');
        page(true, 'Kembali ke KLM Mix.');
        finish(null, tok);
      } catch (e) { page(false, e.message); finish(e); }
    });
    const tm = setTimeout(() => finish(new Error('Waktu habis menunggu izin Google (5 menit)')), timeoutMs || 300000);
    function finish(err, val) { if (done) return; done = true; clearTimeout(tm); setTimeout(() => srv.close(), 300); err ? reject(err) : resolve(val); }
    srv.on('error', (e) => finish(e));
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const url = B.googleAuth + '?' + form({ client_id: clientId, redirect_uri: 'http://127.0.0.1:' + port, response_type: 'code', scope: YT_SCOPE,
        access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state });
      Promise.resolve(open(url)).catch((e) => finish(e));
    });
  });
}
async function googleRefresh({ clientId, clientSecret, refresh, base }) {
  const B = Object.assign({}, BASE, base || {});
  const t = await req(B.googleToken, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }) });
  return t.access_token;
}

// ---------------- YouTube ----------------
function yt(base) {
  const B = Object.assign({}, BASE, base || {});
  const call = (tok, method, path, q, body) => req(B.yt + path + '?' + form(q), { method, headers: Object.assign({ Authorization: 'Bearer ' + tok }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
  return {
    async channel(tok) {
      const j = await call(tok, 'GET', '/channels', { part: 'snippet', mine: 'true' });
      const c = j.items && j.items[0];
      if (!c) throw new Error('Akun Google ini belum punya channel YouTube');
      return { id: c.id, title: c.snippet && c.snippet.title };
    },
    /** buat siaran baru (judul, deskripsi, privasi, thumbnail) yang otomatis mulai saat data masuk → {url, id, watch, warn} */
    async prepare(tok, meta, streamId) {
      let stream = null;
      if (streamId) { try { const j = await call(tok, 'GET', '/liveStreams', { part: 'id,cdn,status', id: streamId }); stream = j.items && j.items[0]; } catch (e) {} }
      if (!stream) stream = await call(tok, 'POST', '/liveStreams', { part: 'snippet,cdn,contentDetails,status' },
        { snippet: { title: 'KLM Mix' }, cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' }, contentDetails: { isReusable: true } });
      const title = String(meta.title || 'Live KLM Mix').slice(0, 100), description = String(meta.desc || '').slice(0, 5000);
      const b = await call(tok, 'POST', '/liveBroadcasts', { part: 'snippet,status,contentDetails' }, {
        snippet: { title, description, scheduledStartTime: new Date(Date.now() + 5000).toISOString() },
        status: { privacyStatus: ['public', 'unlisted', 'private'].includes(meta.privacy) ? meta.privacy : 'public', selfDeclaredMadeForKids: false },
        contentDetails: { enableAutoStart: true, enableAutoStop: true }
      });
      await call(tok, 'POST', '/liveBroadcasts/bind', { id: b.id, part: 'id,contentDetails', streamId: stream.id });
      let warn = '';
      if (meta.thumb) {
        try {
          const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(meta.thumb);
          if (m) await req(B.ytUpload + '/thumbnails/set?' + form({ videoId: b.id, uploadType: 'media' }), { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': m[1] }, body: Buffer.from(m[2], 'base64') });
        } catch (e) { warn = 'thumbnail tidak terpasang: ' + e.message + ' (channel perlu verifikasi telepon untuk thumbnail kustom)'; }
      }
      const ing = (stream.cdn && stream.cdn.ingestionInfo) || {};
      if (!ing.ingestionAddress || !ing.streamName) throw new Error('YouTube tidak memberi alamat stream');
      return { url: ing.ingestionAddress.replace(/\/+$/, '') + '/' + ing.streamName, id: b.id, streamId: stream.id, watch: 'https://youtu.be/' + b.id, warn };
    },
    async end(tok, id) { try { await call(tok, 'POST', '/liveBroadcasts/transition', { broadcastStatus: 'complete', id, part: 'status' }); } catch (e) { /* sudah selesai otomatis */ } }
  };
}

// ---------------- Facebook ----------------
function fb(base) {
  const B = Object.assign({}, BASE, base || {});
  return {
    async who(token, target) { const j = await req(B.graph + '/' + encodeURIComponent(target || 'me') + '?' + form({ fields: 'id,name', access_token: token })); return { id: j.id, name: j.name }; },
    /** buat video live (LIVE_NOW) dengan judul & deskripsi → {url, id, watch} */
    async prepare(token, target, meta) {
      const j = await req(B.graph + '/' + encodeURIComponent(target || 'me') + '/live_videos', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ status: 'LIVE_NOW', title: String(meta.title || '').slice(0, 250), description: String(meta.desc || ''), access_token: token }) });
      const url = j.secure_stream_url || j.stream_url;
      if (!url) throw new Error('Facebook tidak memberi alamat stream');
      let watch = '';
      try { const p = await req(B.graph + '/' + j.id + '?' + form({ fields: 'permalink_url', access_token: token })); watch = p.permalink_url ? (/^https?:/.test(p.permalink_url) ? p.permalink_url : 'https://www.facebook.com' + p.permalink_url) : ''; } catch (e) {}
      return { url, id: j.id, watch, warn: meta.thumb ? 'thumbnail tidak bisa dipasang lewat API Facebook' : '' };
    },
    async end(token, id) { try { await req(B.graph + '/' + id, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ end_live_video: 'true', access_token: token }) }); } catch (e) {} }
  };
}

module.exports = { BASE, googleLogin, googleRefresh, yt, fb };
