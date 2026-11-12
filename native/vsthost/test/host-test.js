// Uji protokol klm-vsthost dengan plugin uji KLM Test Gain.
// node host-test.js <path klm-vsthost> <path KLMTestGain.vst3>
'use strict';
const { spawn } = require('child_process');
const [exe, plugin] = process.argv.slice(2);
if (!exe || !plugin) { console.error('pakai: node host-test.js <exe> <plugin.vst3>'); process.exit(2); }

const N = 256, CH = 2;
let fail = 0;
const ok = (c, m) => { console.log((c ? 'OK   ' : 'GAGAL') + ' ' + m); if (!c) fail++; };

function frame(type, payload) {
  const p = payload || Buffer.alloc(0);
  const b = Buffer.alloc(5 + p.length);
  b.writeUInt32LE(1 + p.length, 0); b[4] = type.charCodeAt(0); p.copy(b, 5);
  return b;
}
function block(seq, amp) {
  const b = Buffer.alloc(12 + N * CH * 4);
  b.writeUInt32LE(seq, 0); b.writeUInt32LE(N, 4); b.writeUInt32LE(CH, 8);
  for (let c = 0; c < CH; c++) for (let i = 0; i < N; i++) b.writeFloatLE(amp * Math.sin((seq * N + i) * 0.05 + c), 12 + (c * N + i) * 4);
  return b;
}
function peak(p) {
  let m = 0; const n = p.readUInt32LE(4), ch = p.readUInt32LE(8);
  for (let i = 0; i < n * ch; i++) m = Math.max(m, Math.abs(p.readFloatLE(12 + i * 4)));
  return m;
}

const child = spawn(exe, ['--plugin', plugin, '--sr', '48000', '--block', String(N), '--title', 'Uji'], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', d => process.stderr.write('  [stderr] ' + d));
let buf = Buffer.alloc(0); const waiters = [], queued = [];
child.stdout.on('data', d => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0); if (buf.length < 4 + len) break;
    const t = String.fromCharCode(buf[4]), p = buf.subarray(5, 4 + len); buf = buf.subarray(4 + len);
    if (t === 'X') { console.log('  [log] ' + p.toString()); continue; }
    const i = waiters.findIndex(w => w.t.includes(t));
    if (i >= 0) waiters.splice(i, 1)[0].res({ t, p }); else queued.push({ t, p });
  }
});
const next = (t, ms = 5000) => new Promise((res, rej) => { const q = queued.findIndex(x => t.includes(x.t)); if (q >= 0) return res(queued.splice(q, 1)[0]); const w = { t, res }; waiters.push(w); setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('timeout menunggu ' + t)); } }, ms); });
const send = (t, p) => child.stdin.write(frame(t, p));

(async () => {
  const t0 = Date.now();
  const info = JSON.parse((await next('I', 15000)).p.toString());
  console.log('  info', JSON.stringify(info), (Date.now() - t0) + 'ms');
  ok(info.ok && info.name === 'KLM Test Gain', 'plugin dimuat: ' + info.name);
  ok(info.format === 'VST3' && info.params >= 1, 'format VST3, params ' + info.params);

  send('P', block(1, 0.5)); let a = await next('A');
  ok(a.p.readUInt32LE(0) === 1 && Math.abs(peak(a.p) - 0.5) < 0.02, 'gain default unity, peak ' + peak(a.p).toFixed(3));

  let v = Buffer.alloc(12); v.writeUInt32LE(0, 0); v.writeDoubleLE(1.0, 4); send('V', v);
  await new Promise(r => setTimeout(r, 120));
  send('P', block(2, 0.5)); a = await next('A');
  ok(Math.abs(peak(a.p) - 1.0) < 0.03, 'setParam gain 1.0 -> x2, peak ' + peak(a.p).toFixed(3));

  send('p'); const pl = JSON.parse((await next('p')).p.toString());
  ok(Array.isArray(pl) && pl[0] && pl[0].name === 'Gain' && Math.abs(pl[0].v - 1) < 1e-6, 'daftar param: ' + JSON.stringify(pl[0]));

  send('G'); const st = (await next('S')).p;
  ok(st.length > 8 && st.subarray(0, 4).toString() === 'KV3S', 'getState ' + st.length + ' byte');

  v.writeDoubleLE(0.25, 4); send('V', v); await new Promise(r => setTimeout(r, 120));
  send('P', block(3, 0.5)); a = await next('A');
  ok(Math.abs(peak(a.p) - 0.25) < 0.02, 'gain 0.25 -> x0.5, peak ' + peak(a.p).toFixed(3));

  send('L', st); const k = JSON.parse((await next('K')).p.toString());
  ok(k.ok, 'setState diterima');
  send('P', block(4, 0.5)); a = await next('A');
  ok(Math.abs(peak(a.p) - 1.0) < 0.03, 'state dipulihkan (x2), peak ' + peak(a.p).toFixed(3));

  send('B', Buffer.from([1])); send('P', block(5, 0.5)); a = await next('A');
  ok(Math.abs(peak(a.p) - 0.5) < 0.02, 'bypass -> unity');
  send('B', Buffer.from([0]));

  // throughput: 2000 blok (~10,7 detik audio)
  const tp = Date.now(); let got = 0;
  for (let s = 10; s < 2010; s++) send('P', block(s, 0.3));
  while (got < 2000) { await next('A'); got++; }
  const dt = Date.now() - tp;
  ok(dt < 4000, `throughput 2000 blok dalam ${dt} ms (${(2000 * N / 48000 / (dt / 1000)).toFixed(0)}x realtime)`);

  send('E', Buffer.from([1])); const w = JSON.parse((await next('W')).p.toString());
  ok(w.open === false, 'editor: plugin tanpa GUI -> open=false');

  send('Q');
  const code = await new Promise(r => child.on('exit', c => r(c)));
  ok(code === 0, 'keluar bersih (kode ' + code + ')');

  // plugin rusak -> info error
  const bad = spawn(exe, ['--plugin', plugin + '.tidakada'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let bb = Buffer.alloc(0); bad.stdout.on('data', d => bb = Buffer.concat([bb, d]));
  const bc = await new Promise(r => bad.on('exit', c => r(c)));
  const bi = bb.length > 5 ? JSON.parse(bb.subarray(5, 4 + bb.readUInt32LE(0)).toString()) : {};
  ok(bc !== 0 && bi.ok === false && bi.error, 'plugin tidak ada -> error: ' + bi.error);

  console.log(fail ? `HASIL: ${fail} GAGAL` : 'HASIL: OK');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('GAGAL', e.message); try { child.kill(); } catch (_) {} process.exit(1); });
