/* KLM Mix - Media Hub (proses Node): semua pekerjaan ffmpeg & perangkat jaringan
 *  - Input stream masuk: RTMP/RTMPS, SRT, RTSP (CCTV/kamera IP), HLS/HTTP, UDP — mode tarik atau menerima (listener)
 *    → ffmpeg (copy H.264 = sangat ringan, atau transcode) → fragmented MP4 → mixer lewat MSE
 *  - Output streaming (RTMP/SRT multi-tujuan) & output NDI lewat WebSocket /hub/out
 *  - Deteksi encoder hardware (NVENC / QuickSync / AMF), kontrol PTZ, NDI (proses terpisah)
 * Hanya bisa diakses dari PC sendiri (loopback).
 */
'use strict';
const { spawn, fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { buildFfmpegArgs, buildSrtArgs, srtUrl } = require('./ffmpeg-args');
const ptz = require('./ptz');

let cfgFn = () => ({});
function ffmpegPath() {
  const c = cfgFn() || {};
  if (c.ffmpegPath && fs.existsSync(c.ffmpegPath)) return c.ffmpegPath;
  try { const p = require('ffmpeg-static'); if (p) return p.replace('app.asar', 'app.asar.unpacked'); } catch (e) {}
  return 'ffmpeg';
}

// ====================== MP4 box parser ======================
function codecFromInit(init) {
  let v = '';
  const i = init.indexOf('avcC');
  if (i > 0) v = 'avc1.' + [init[i + 5], init[i + 6], init[i + 7]].map((x) => x.toString(16).padStart(2, '0')).join('');
  else if (init.indexOf('hvcC') > 0) v = 'hvc1.1.6.L120.90';
  const a = init.indexOf('mp4a') > 0 ? 'mp4a.40.2' : '';
  return [v, a].filter(Boolean).join(', ');
}

// ====================== INPUT STREAM ======================
const ins = new Map(); // id -> state
function inState(id) {
  let s = ins.get(id);
  if (!s) { s = { id, subs: new Set(), init: null, codec: '', status: 'idle', log: '', buf: Buffer.alloc(0), gen: 0, lastKey: null }; ins.set(id, s); }
  return s;
}
/** potong aliran fMP4 menjadi kotak (ftyp/moov = init, moof+mdat = fragmen) */
function feed(s, chunk) {
  s.buf = s.buf.length ? Buffer.concat([s.buf, chunk]) : chunk;
  for (;;) {
    if (s.buf.length < 8) return;
    let size = s.buf.readUInt32BE(0);
    const type = s.buf.toString('latin1', 4, 8);
    if (size === 1 && s.buf.length >= 16) size = Number(s.buf.readBigUInt64BE(8));
    if (size < 8 || size > 200e6) { s.buf = Buffer.alloc(0); return; }
    if (s.buf.length < size) return;
    const box = s.buf.subarray(0, size); s.buf = s.buf.subarray(size);
    if (type === 'ftyp') { s.init = Buffer.from(box); s.gen++; }
    else if (type === 'moov') {
      s.init = Buffer.concat([s.init || Buffer.alloc(0), box]);
      s.codec = codecFromInit(s.init); s.status = 'live';
      for (const r of s.subs) { try { r.end(); } catch (e) {} } s.subs.clear(); // klien sambung ulang dengan init baru
    } else if (type === 'moof') s.pending = Buffer.from(box);
    else if (type === 'mdat' && s.pending) {
      const frag = Buffer.concat([s.pending, box]); s.pending = null;
      for (const r of s.subs) { if (r.writableLength < 8e6) r.write(frag); }
    }
  }
}

function inArgs(o) {
  let url = String(o.url || '').trim();
  const a = ['-hide_banner', '-loglevel', 'warning', '-fflags', 'nobuffer+genpts+discardcorrupt', '-flags', 'low_delay', '-probesize', '500000', '-analyzeduration', '1000000'];
  if (o.listen) {
    if (/^rtmp/i.test(url) || !url) { a.push('-listen', '1', '-timeout', '-1'); if (!url) url = 'rtmp://0.0.0.0:1935/live/klm'; }
    if (/^srt/i.test(url) && !/mode=listener/.test(url)) url += (url.includes('?') ? '&' : '?') + 'mode=listener';
  }
  if (/^rtsp/i.test(url)) a.push('-rtsp_transport', o.udp ? 'udp' : 'tcp');
  if (/^srt/i.test(url) && !/latency=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'latency=' + ((o.latency || 120) * 1000);
  if (/^https?:.*\.m3u8/i.test(url)) a.push('-live_start_index', '-1');
  else if (!o.listen && /^(https?:|file:|[a-zA-Z]:[\\/]|\/)/.test(url)) a.push('-re', '-stream_loop', '-1'); // file biasa: putar real-time & ulang
  a.push('-i', url);
  if (o.mode === 'transcode') {
    a.push('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', '30', '-pix_fmt', 'yuv420p', '-vf', 'scale=-2:\'min(ih,1080)\'');
  } else a.push('-c:v', 'copy');
  a.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2');
  a.push('-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', String((o.frag || 100) * 1000), 'pipe:1');
  return a;
}
function inStart(o) {
  const s = inState(o.id);
  inStop(o.id, true);
  s.opts = o; s.stopped = false; s.status = o.listen ? 'menunggu' : 'menyambung'; s.init = null; s.codec = '';
  const run = () => {
    if (s.stopped) return;
    let p;
    try { p = spawn(ffmpegPath(), inArgs(o), { windowsHide: true }); } catch (e) { s.status = 'error'; s.log = e.message; return; }
    s.proc = p; s.buf = Buffer.alloc(0);
    p.stdout.on('data', (c) => feed(s, c));
    p.stderr.on('data', (d) => { s.log = (s.log + d.toString()).slice(-3000); });
    p.on('error', (e) => { s.log += '\n' + e.message; });
    const t0 = Date.now();
    p.on('close', () => {
      s.proc = null;
      if (s.stopped) return;
      const quick = Date.now() - t0 < 3000;
      s.fails = quick ? (s.fails || 0) + 1 : 0;
      if (/address already in use|bind failed|Cannot assign/i.test(s.log)) s.status = 'error';
      else s.status = o.listen ? 'menunggu' : 'terputus';
      // sambung ulang otomatis, makin lama bila gagal terus (hemat CPU)
      setTimeout(run, Math.min(10000, (o.listen ? 300 : 1500) * Math.pow(2, Math.min(s.fails, 5))));
    });
  };
  if (o.source === 'ndi') { s.status = 'menyambung'; ndi.call({ cmd: 'recv', id: o.id, source: o.ndiName, opts: { low: o.ndiLow } }).then((r) => { if (!r.ok) { s.status = 'error'; s.log = r.msg; } }); }
  else run();
  return { ok: true };
}
function inStop(id, keep) {
  const s = ins.get(id); if (!s) return { ok: true };
  s.stopped = true;
  if (s.proc) { try { s.proc.kill('SIGKILL'); } catch (e) {} s.proc = null; }
  if (s.opts && s.opts.source === 'ndi') ndi.call({ cmd: 'recv-stop', id });
  for (const r of s.subs) { try { r.end(); } catch (e) {} } s.subs.clear();
  s.status = 'idle';
  if (!keep) ins.delete(id);
  return { ok: true };
}

// ====================== ENCODER HARDWARE ======================
let encCache = null;
function detectEncoders() {
  if (encCache) return encCache;
  const test = (enc) => new Promise((res) => {
    let p; try { p = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x144:r=30', '-frames:v', '10', '-c:v', enc, '-f', 'null', '-'], { windowsHide: true }); } catch (e) { return res(false); }
    const t = setTimeout(() => { try { p.kill(); } catch (e) {} res(false); }, 8000);
    p.on('close', (c) => { clearTimeout(t); res(c === 0); }); p.on('error', () => { clearTimeout(t); res(false); });
  });
  encCache = (async () => {
    const out = { ffmpeg: ffmpegPath(), x264: await test('libx264') };
    for (const [k, e] of [['nvenc', 'h264_nvenc'], ['qsv', 'h264_qsv'], ['amf', 'h264_amf']]) out[k] = await test(e);
    out.best = out.nvenc ? 'nvenc' : out.qsv ? 'qsv' : out.amf ? 'amf' : 'x264';
    return out;
  })();
  return encCache;
}

// ====================== NDI (proses terpisah) ======================
const ndi = {
  w: null, rid: 1, wait: new Map(),
  ensure() {
    if (this.w) return this.w;
    const env = Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', KLM_FFMPEG: ffmpegPath() });
    this.w = fork(path.join(__dirname, 'ndi-worker.js'), [], { env, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    this.w.stderr && this.w.stderr.on('data', (d) => { ndi.log = ((ndi.log || '') + d).slice(-3000); });
    this.w.on('message', (m) => {
      if (m.t === 'res') { const f = this.wait.get(m.rid); if (f) { this.wait.delete(m.rid); f(m.r); } }
      else if (m.t === 'chunk') { const s = ins.get(m.id); if (s && !s.stopped) feed(s, Buffer.from(m.buf)); }
      else if (m.t === 'restart') { const s = ins.get(m.id); if (s) { s.buf = Buffer.alloc(0); s.init = null; } }
      else if (m.t === 'log') ndi.log = ((ndi.log || '') + '\n' + m.msg).slice(-3000);
    });
    this.w.on('exit', () => { this.w = null; for (const f of this.wait.values()) f({ ok: false, msg: 'Proses NDI berhenti' }); this.wait.clear(); });
    return this.w;
  },
  call(m) {
    return new Promise((res) => {
      const rid = this.rid++; this.wait.set(rid, res);
      try { this.ensure().send(Object.assign({ rid }, m)); } catch (e) { this.wait.delete(rid); res({ ok: false, msg: e.message }); }
      setTimeout(() => { if (this.wait.has(rid)) { this.wait.delete(rid); res({ ok: false, msg: 'NDI tidak merespons' }); } }, 15000);
    });
  },
  data(buf) { if (this.w) try { this.w.send({ cmd: 'send-data', buf }); } catch (e) {} }
};

// ====================== SRT → gateway / decoder TV ======================
// MediaRecorder (WebM) → ffmpeg → MPEG-TS SRT. Bila koneksi putus (gateway restart / jaringan), ffmpeg dijalankan ulang
// otomatis: header WebM disimpan lalu disambung lagi mulai Cluster berikutnya (≤ 1 GOP), tanpa menghentikan mixer.
const CLUSTER = Buffer.from([0x1f, 0x43, 0xb6, 0x75]);
function srtSession(cfg, tell) {
  const S = { header: null, pre: [], preLen: 0, proc: null, needSync: false, stopped: false, fails: 0, status: 'menyambung', t0: 0, log: '', live: false, bytes: 0 };
  const setStatus = (st, msg) => { if (S.status !== st || msg) { S.status = st; tell({ t: 'status', status: st, msg: msg || '' }); } };
  function reason() {
    const L = S.log;
    if (/Connection setup failure: connection timed out|timed out/i.test(L)) return 'Gateway tidak menjawab (cek IP/port/firewall)';
    if (/rejected|REJ_/i.test(L)) return 'Ditolak gateway (cek passphrase / stream ID)';
    if (/passphrase|BADSECRET|decrypt/i.test(L)) return 'Passphrase tidak cocok';
    if (/address already in use|bind/i.test(L)) return 'Port sudah dipakai aplikasi lain';
    if (/Connection refused|refused/i.test(L)) return 'Koneksi ditolak (gateway belum siap)';
    if (/Protocol not found|srt.*not/i.test(L)) return 'ffmpeg ini tidak mendukung SRT';
    return 'Koneksi terputus';
  }
  function run() {
    if (S.stopped) return;
    let p; try { p = spawn(ffmpegPath(), buildSrtArgs(cfg), { windowsHide: true }); } catch (e) { setStatus('error', e.message); return; }
    S.proc = p; S.t0 = Date.now(); S.live = false; S.log = ''; S.needSync = !!S.header;
    if (S.fails) setStatus('ulang', S.lastMsg); else setStatus(cfg.mode === 'listener' ? 'menunggu' : 'menyambung');
    p.stdin.on('error', () => {});
    p.stderr.on('data', (d) => {
      const t = d.toString(); S.log = (S.log + t).slice(-4000);
      const x = /frame=\s*(\d+).*?fps=\s*([\d.]+).*?size=\s*(\S+).*?bitrate=\s*([\d.]+\w+\/s).*?speed=\s*([\d.]+x)/.exec(t);
      if (x) { if (!S.live) { S.live = true; S.fails = 0; setStatus('live'); } tell({ t: 'stats', frame: +x[1], fps: +x[2], size: x[3], bitrate: x[4], speed: x[5] }); }
      else tell({ t: 'log', msg: t.slice(0, 400) });
    });
    p.on('error', (e) => { S.log += '\n' + e.message; });
    p.on('close', () => {
      S.proc = null;
      if (S.stopped) return;
      S.fails++;
      const wait = Math.min(5000, 700 * S.fails);
      S.lastMsg = reason() + ' — menyambung ulang otomatis';
      setStatus('ulang', S.lastMsg);
      setTimeout(run, wait);
    });
  }
  function write(buf) { if (S.proc && S.proc.stdin.writable && S.proc.stdin.writableLength < 32e6) S.proc.stdin.write(buf); }
  run();
  tell({ t: 'started', url: srtUrl(cfg) });
  return {
    data(buf) {
      S.bytes += buf.length;
      if (!S.header) { // kumpulkan header WebM (EBML + Segment + Tracks) sampai Cluster pertama
        S.pre.push(buf); S.preLen += buf.length;
        const all = Buffer.concat(S.pre); const i = all.indexOf(CLUSTER);
        if (i > 0) { S.header = all.subarray(0, i); S.pre = []; write(all); }
        else if (S.preLen > 4e6) { S.header = Buffer.alloc(0); write(all); S.pre = []; }
        return;
      }
      if (S.needSync) { // ffmpeg baru: kirim header lalu mulai dari Cluster berikutnya
        const i = buf.indexOf(CLUSTER); if (i < 0) return;
        S.needSync = false; write(S.header); write(buf.subarray(i)); return;
      }
      write(buf);
    },
    stop() {
      S.stopped = true;
      const p = S.proc; if (p) { try { p.stdin.end(); } catch (e) {} setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 2500); }
    }
  };
}

// ====================== OUTPUT via WebSocket ======================
const wssOut = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
wssOut.on('connection', (ws) => {
  let proc = null, kind = null, srt = null;
  const tell = (o) => { try { ws.send(JSON.stringify(o)); } catch (e) {} };
  ws.on('message', async (data, isBinary) => {
    if (!isBinary) {
      let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
      kind = m.kind;
      if (kind === 'stream') {
        const args = buildFfmpegArgs(m.cfg);
        try { proc = spawn(ffmpegPath(), args, { windowsHide: true }); } catch (e) { return tell({ t: 'error', msg: e.message }); }
        proc.stdin.on('error', () => {});
        proc.stderr.on('data', (d) => {
          const s = d.toString();
          const x = /frame=\s*(\d+).*?fps=\s*([\d.]+).*?bitrate=\s*([\d.]+\w+\/s).*?speed=\s*([\d.]+x)/.exec(s);
          tell(x ? { t: 'stats', frame: +x[1], fps: +x[2], bitrate: x[3], speed: x[4] } : { t: 'log', msg: s.slice(0, 400) });
        });
        proc.on('close', (code) => { tell({ t: 'ended', code }); proc = null; });
        proc.on('error', (e) => tell({ t: 'error', msg: 'ffmpeg: ' + e.message }));
        tell({ t: 'started', args: args.join(' ').replace(/(rtmps?:\/\/[^\s|]*\/)[^\s|]+/g, '$1••••') });
      } else if (kind === 'srt') {
        srt = srtSession(m.cfg || {}, tell);
      } else if (kind === 'ndi') {
        const r = await ndi.call({ cmd: 'send', opts: m.opts });
        tell(r.ok ? { t: 'started' } : { t: 'error', msg: r.msg });
      }
      return;
    }
    if (kind === 'stream' && proc && proc.stdin.writable) proc.stdin.write(data);
    else if (kind === 'srt' && srt) srt.data(data);
    else if (kind === 'ndi') ndi.data(data);
  });
  ws.on('close', () => {
    if (proc) { try { proc.stdin.end(); } catch (e) {} const p = proc; setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) {} }, 4000); }
    if (kind === 'ndi') ndi.call({ cmd: 'send-stop' });
    if (srt) srt.stop();
  });
});

// ====================== HTTP /hub/* ======================
function readJson(req) {
  return new Promise((res) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch (e) { res({}); } }); });
}
function json(res, o, code) { res.writeHead(code || 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); }

async function handle(req, res, p) {
  if (p.startsWith('/hub/in/data/')) {
    const s = ins.get(p.slice(13));
    if (!s || !s.init) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'X-Codec': s.codec });
    res.write(s.init);
    s.subs.add(res);
    req.on('close', () => s.subs.delete(res));
    return;
  }
  if (p === '/hub/in/status') {
    const out = {};
    for (const [id, s] of ins) out[id] = { status: s.status, codec: s.codec, gen: s.gen, log: s.log.slice(-500) };
    return json(res, out);
  }
  if (p === '/hub/in/start') return json(res, inStart(await readJson(req)));
  if (p === '/hub/in/stop') return json(res, inStop((await readJson(req)).id));
  if (p === '/hub/encoders') return json(res, await detectEncoders());
  if (p === '/hub/ptz') return json(res, await ptz.command(await readJson(req)));
  if (p === '/hub/ndi/sources') return json(res, await ndi.call({ cmd: 'sources' }));
  if (p === '/hub/ndi/check') return json(res, await ndi.call({ cmd: 'check' }));
  res.writeHead(404); res.end();
}

function shutdown() {
  for (const id of [...ins.keys()]) inStop(id);
  if (ndi.w) try { ndi.w.kill(); } catch (e) {}
}

module.exports = { handle, wssOut, ffmpegPath, setConfig: (fn) => { cfgFn = fn; }, shutdown };
