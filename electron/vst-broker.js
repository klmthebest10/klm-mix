// KLM Mix — broker host VST (berjalan di utilityProcess Electron, terpisah dari proses utama & renderer).
// Satu proses klm-vsthost per instance plugin. Audio mengalir langsung: AudioWorklet (renderer) <-MessagePort-> broker <-pipe-> helper.
'use strict';
const { spawn } = require('child_process');

const parent = process.parentPort;
const inst = new Map(); // id -> { child, port, pend:[], info }

const send = (m) => { try { parent.postMessage(m); } catch (e) {} };

function frame(type, payload) {
  const p = payload || Buffer.alloc(0);
  const b = Buffer.allocUnsafe(5 + p.length);
  b.writeUInt32LE(1 + p.length, 0); b[4] = type.charCodeAt(0); p.copy(b, 5);
  return b;
}

function create(m, port) {
  destroy(m.id);
  const args = ['--plugin', m.plugin, '--sr', String(m.sr | 0 || 48000), '--block', String(m.block | 0 || 256)];
  if (m.title) args.push('--title', m.title);
  if (m.format) args.push('--format', m.format);
  let child;
  // helper ber-subsistem GUI (tanpa konsol); windowsHide jangan dipakai karena ikut menyembunyikan jendela editor plugin
  try { child = spawn(m.exe, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false }); }
  catch (e) { send({ ev: 'info', id: m.id, info: { ok: false, error: 'Helper VST tidak bisa dijalankan: ' + e.message } }); return; }
  const I = { id: m.id, child, port, info: null, replies: [], buf: Buffer.alloc(0), alive: true, inflight: 0, dropped: 0 };
  inst.set(m.id, I);
  child.on('error', (e) => { if (!I.info) send({ ev: 'info', id: m.id, info: { ok: false, error: 'Helper VST gagal: ' + e.message } }); });
  child.stdin.on('error', () => {});
  child.stderr.on('data', (d) => { const s = String(d).trim(); if (s) send({ ev: 'log', id: m.id, text: s.slice(0, 2000) }); });
  child.on('exit', (code, sig) => {
    I.alive = false;
    if (!I.info) send({ ev: 'info', id: m.id, info: { ok: false, error: 'Plugin berhenti saat dimuat (kode ' + (code != null ? code : sig) + ')' } });
    for (const r of I.replies.splice(0)) send({ ev: 'reply', rid: r.rid, error: 'plugin berhenti' });
    if (inst.get(m.id) === I) { inst.delete(m.id); send({ ev: 'exit', id: m.id, code, signal: sig, crashed: !I.quitting }); }
    try { port && port.close(); } catch (e) {}
  });
  child.stdout.on('data', (d) => {
    I.buf = I.buf.length ? Buffer.concat([I.buf, d]) : d;
    while (I.buf.length >= 4) {
      const len = I.buf.readUInt32LE(0);
      if (I.buf.length < 4 + len) break;
      const t = String.fromCharCode(I.buf[4]), p = I.buf.subarray(5, 4 + len);
      I.buf = I.buf.subarray(4 + len);
      onFrame(I, t, p);
    }
  });
  if (port) {
    port.on('message', (e) => {
      const d = e.data;
      if (!d || !I.alive) return;
      if (d.t === 'p' && d.data) {
        // jangan menumpuk antrean bila plugin terlalu lambat: buang blok (worklet memakai suara asli sebagai cadangan)
        if (I.inflight > 12) { I.dropped++; return; }
        const x = d.data; // Float32Array (atau view/ArrayBuffer lain dengan byte yang sama)
        const raw = ArrayBuffer.isView(x) ? Buffer.from(x.buffer, x.byteOffset, x.byteLength) : x instanceof ArrayBuffer ? Buffer.from(x) : Buffer.from(Float32Array.from(x).buffer);
        if (raw.length < d.n * d.ch * 4) return;
        const hdr = Buffer.allocUnsafe(12);
        hdr.writeUInt32LE(d.seq >>> 0, 0); hdr.writeUInt32LE(d.n, 4); hdr.writeUInt32LE(d.ch, 8);
        const pay = Buffer.concat([hdr, raw.subarray(0, d.n * d.ch * 4)]);
        I.inflight++;
        child.stdin.write(frame('P', pay));
      }
    });
    port.start();
  }
}

function onFrame(I, t, p) {
  switch (t) {
    case 'A': {
      I.inflight = Math.max(0, I.inflight - 1);
      if (!I.port) return;
      const seq = p.readUInt32LE(0), n = p.readUInt32LE(4), ch = p.readUInt32LE(8);
      const f = new Float32Array(n * ch);
      new Uint8Array(f.buffer).set(p.subarray(12, 12 + n * ch * 4));
      try { I.port.postMessage({ t: 'a', seq, n, ch, data: f }); } catch (e) {}
      break;
    }
    case 'I': {
      let info; try { info = JSON.parse(p.toString('utf8')); } catch (e) { info = { ok: false, error: 'info rusak' }; }
      I.info = info;
      send({ ev: 'info', id: I.id, info });
      if (I.port) try { I.port.postMessage({ t: 'info', info }); } catch (e) {}
      break;
    }
    case 'D': send({ ev: 'dirty', id: I.id }); break;
    case 'W': { let w = {}; try { w = JSON.parse(p.toString()); } catch (e) {} send({ ev: 'editor', id: I.id, open: !!w.open }); break; }
    case 'X': send({ ev: 'log', id: I.id, text: p.toString('utf8') }); break;
    case 'S': case 'K': case 'p': {
      const i = I.replies.findIndex((r) => r.want === t);
      if (i < 0) break;
      const r = I.replies.splice(i, 1)[0];
      if (t === 'S') send({ ev: 'reply', rid: r.rid, data: p.toString('base64') });
      else { let v = null; try { v = JSON.parse(p.toString('utf8')); } catch (e) {} send({ ev: 'reply', rid: r.rid, data: v }); }
      break;
    }
  }
}

function request(m, type, payload, want) {
  const I = inst.get(m.id);
  if (!I || !I.alive) { send({ ev: 'reply', rid: m.rid, error: 'plugin tidak aktif' }); return; }
  I.replies.push({ rid: m.rid, want });
  I.child.stdin.write(frame(type, payload));
}
function cmd(m, type, payload) {
  const I = inst.get(m.id);
  if (I && I.alive) I.child.stdin.write(frame(type, payload));
}
function destroy(id) {
  const I = inst.get(id);
  if (!I) return;
  inst.delete(id);
  I.quitting = true;
  try { I.child.stdin.write(frame('Q')); } catch (e) {}
  const t = setTimeout(() => { try { I.child.kill(); } catch (e) {} }, 1500);
  I.child.once('exit', () => clearTimeout(t));
  try { I.port && I.port.close(); } catch (e) {}
}

parent.on('message', (e) => {
  const m = e.data || {};
  switch (m.cmd) {
    case 'create': create(m, e.ports && e.ports[0]); break;
    case 'editor': cmd(m, 'E', Buffer.from([m.mode | 0])); break;
    case 'bypass': cmd(m, 'B', Buffer.from([m.on ? 1 : 0])); break;
    case 'setParam': { const b = Buffer.alloc(12); b.writeUInt32LE(m.pid >>> 0, 0); b.writeDoubleLE(+m.v || 0, 4); cmd(m, 'V', b); break; }
    case 'getState': request(m, 'G', null, 'S'); break;
    case 'setState': request(m, 'L', Buffer.from(m.data || '', 'base64'), 'K'); break;
    case 'params': request(m, 'p', null, 'p'); break;
    case 'destroy': destroy(m.id); break;
    case 'destroyAll': for (const id of [...inst.keys()]) destroy(id); break;
    case 'stats': send({ ev: 'reply', rid: m.rid, data: [...inst.values()].map((I) => ({ id: I.id, name: I.info && I.info.name, inflight: I.inflight, dropped: I.dropped })) }); break;
  }
});
