/* KLM Mix — penerima Mirroring HP.
 * HP (aplikasi KLM Mix .apk) merekam layarnya dengan encoder H.264 hardware lalu mengirim lewat TCP langsung ke PC (LAN,
 * tanpa internet). Server ini memeriksa token, lalu meneruskan paket apa adanya ke halaman mixer lewat WebSocket lokal
 * (/mirror-feed) untuk didekode dengan WebCodecs.
 * HP → PC : 'KLMM' u8 versi, u16 panjang, JSON {token,name,w,h,fps,model}; lalu paket: u8 tipe, u32 panjang, i64 ptsUs, data
 *            tipe 1 = konfigurasi (SPS/PPS Annex-B), 2 = frame kunci, 3 = frame biasa, 4 = info JSON (rotasi/ukuran)
 * Penerima AirPlay bawaan (klm-airplay, iPhone/iPad/Mac) memakai protokol yang sama dari 127.0.0.1 (JSON salam berisi airplay:true).
 * PC → HP : u8 perintah (1 = minta frame kunci, 2 = berhenti, 3 = bitrate u32 kbps) */
'use strict';
const net = require('net');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

function create() {
  const sessions = new Map(); // token → { sock, info, feeds:Set<ws>, config:Buffer|null, lastKey }
  const tokens = new Map();   // token → { name, at }
  const wss = new WebSocketServer({ noServer: true });
  const M = { port: 0 };

  M.newToken = (name) => { const t = crypto.randomBytes(6).toString('hex'); tokens.set(t, { name: name || '', at: Date.now() }); return t; };
  M.allow = (t, name) => { if (/^[a-f0-9]{8,32}$/.test(t || '')) tokens.set(t, { name: name || '', at: Date.now() }); };
  M.revoke = (t) => { tokens.delete(t); const s = sessions.get(t); if (s) { try { s.sock.destroy(); } catch (e) {} } };
  M.status = () => [...sessions.entries()].map(([t, s]) => ({ token: t, info: s.info, feeds: s.feeds.size, bytes: s.bytes, frames: s.frames }));

  const pkt = (type, pts, data) => { const h = Buffer.allocUnsafe(9); h[0] = type; h.writeDoubleLE(pts, 1); return data && data.length ? [h, data] : [h]; };
  const tell = (s, type, pts, data) => { for (const ws of s.feeds) { if (ws.readyState !== 1) continue; if (ws.bufferedAmount > 4e6 && type === 3) continue; ws.send(Buffer.concat(pkt(type, pts, data)), { binary: true }); } };
  const state = (token, o) => { for (const ws of wss.clients) if (ws.token === token && ws.readyState === 1) ws.send(JSON.stringify(o)); };

  function onSocket(sock) {
    sock.setNoDelay(true); sock.setKeepAlive(true, 3000);
    let buf = Buffer.alloc(0), ses = null, token = '';
    const fail = (why) => { try { sock.destroy(); } catch (e) {} if (!ses) console.warn('[mirror] ditolak:', why, sock.remoteAddress); };
    const timer = setTimeout(() => { if (!ses) fail('tidak ada salam'); }, 5000);
    sock.on('data', (d) => {
      buf = buf.length ? Buffer.concat([buf, d]) : d;
      if (!ses) {
        if (buf.length < 7) return;
        if (buf.toString('latin1', 0, 4) !== 'KLMM') return fail('bukan protokol KLM');
        const n = buf.readUInt16BE(5); if (buf.length < 7 + n) return;
        let info; try { info = JSON.parse(buf.toString('utf8', 7, 7 + n)); } catch (e) { return fail('salam rusak'); }
        buf = buf.subarray(7 + n);
        token = String(info.token || '');
        if (!tokens.has(token)) return fail('token tidak dikenal');
        const old = sessions.get(token); if (old) { try { old.sock.destroy(); } catch (e) {} }
        delete info.token; info.ip = (sock.remoteAddress || '').replace(/^::ffff:/, '');
        ses = { sock, info, feeds: old ? old.feeds : new Set(), config: null, bytes: 0, frames: 0 };
        sessions.set(token, ses); clearTimeout(timer);
        state(token, { t: 'hello', info });
      }
      for (;;) {
        if (buf.length < 13) return;
        const type = buf[0], len = buf.readUInt32BE(1);
        if (len > 8e6) return fail('paket terlalu besar');
        if (buf.length < 13 + len) return;
        const pts = Number(buf.readBigInt64BE(5)), data = buf.subarray(13, 13 + len);
        buf = buf.subarray(13 + len);
        ses.bytes += len;
        if (type === 1) ses.config = Buffer.from(data);
        if (type === 2 || type === 3) ses.frames++;
        // simpan frame sejak frame kunci terakhir: halaman yang baru menyambung langsung dapat gambar
        // (AirPlay hampir tidak pernah mengirim frame kunci baru, jadi tanpa ini layar bisa hitam sampai lama)
        if (type === 2) { ses.gop = [[pts, Buffer.from(data)]]; ses.gopBytes = len; ses.gopKey = 2; }
        else if (type === 3 && ses.gop) { if (ses.gopBytes + len > 24e6 || ses.gop.length > 900) ses.gop = null; else { ses.gop.push([pts, Buffer.from(data)]); ses.gopBytes += len; } }
        if (type === 4) { try { Object.assign(ses.info, JSON.parse(data.toString('utf8'))); state(token, { t: 'info', info: ses.info }); } catch (e) {} continue; }
        tell(ses, type, pts, data);
      }
    });
    const end = () => { clearTimeout(timer); if (ses && sessions.get(token) === ses) { sessions.delete(token); state(token, { t: 'bye' }); } };
    sock.on('close', end); sock.on('error', () => {});
  }
  M.server = net.createServer(onSocket);
  M.cmd = (token, c, arg) => { const s = sessions.get(token); if (!s) return false; const b = Buffer.alloc(c === 3 ? 5 : 1); b[0] = c; if (c === 3) b.writeUInt32BE(arg >>> 0, 1); try { s.sock.write(b); } catch (e) {} return true; };

  /** WebSocket lokal dari halaman mixer: /mirror-feed?t=TOKEN&n=NAMA */
  M.upgrade = (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => {
    const u = new URL(req.url, 'http://x'), token = u.searchParams.get('t') || '';
    M.allow(token, u.searchParams.get('n') || '');
    ws.token = token;
    if (!tokens.has(token)) return ws.close();
    const attach = () => { const s = sessions.get(token); if (!s) return false; s.feeds.add(ws); ws.send(JSON.stringify({ t: 'hello', info: s.info })); if (s.config) ws.send(Buffer.concat(pkt(1, 0, s.config)), { binary: true });
      if (s.config && s.gop) s.gop.forEach(([pts, d], i) => ws.send(Buffer.concat(pkt(i ? 3 : 2, pts, d)), { binary: true }));
      M.cmd(token, 1); return true; };
    attach();
    const iv = setInterval(() => { const s = sessions.get(token); if (s && !s.feeds.has(ws)) attach(); }, 500); // HP menyambung belakangan / menyambung ulang
    ws.on('message', (d, bin) => { if (bin) return; let m; try { m = JSON.parse(String(d)); } catch (e) { return; } if (m.t === 'key') M.cmd(token, 1); else if (m.t === 'stop') M.cmd(token, 2); else if (m.t === 'bitrate') M.cmd(token, 3, +m.kbps || 0); });
    ws.on('close', () => { clearInterval(iv); const s = sessions.get(token); if (s) s.feeds.delete(ws); });
    ws.on('error', () => {});
  });
  return M;
}
module.exports = { create };
