/* KLM Mix - proses NDI terpisah (aman: jika NDI bermasalah, aplikasi utama tetap jalan)
 * Butuh NDI Runtime / NDI Tools (gratis dari ndi.video). Memakai koffi (FFI) untuk memanggil Processing.NDI.Lib.
 * - Terima (input NDI)  : NDI BGRA → ffmpeg (H.264 ultrafast) → fMP4 → mixer (MSE)
 * - Kirim (output NDI)  : program WebM → ffmpeg decode BGRA → NDI (bisa dipakai NDI Webcam = virtual camera)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const FF = process.env.KLM_FFMPEG || 'ffmpeg';
let koffi = null, N = null, T = null, loadErr = '';

function send(m) { try { process.send(m); } catch (e) {} }

function load() {
  if (N) return true;
  try { koffi = require('koffi'); } catch (e) { loadErr = 'Modul koffi tidak ada: ' + e.message; return false; }
  const name = process.platform === 'win32' ? 'Processing.NDI.Lib.x64.dll' : process.platform === 'darwin' ? 'libndi.dylib' : 'libndi.so.6';
  const dirs = [process.env.NDI_RUNTIME_DIR_V6, process.env.NDI_RUNTIME_DIR_V5, process.env.NDI_RUNTIME_DIR_V4,
    'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6', 'C:\\Program Files\\NDI\\NDI 5 Runtime\\v5',
    'C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime', 'C:\\Program Files\\NDI\\NDI 5 Tools\\Runtime',
    '/usr/local/lib', '/usr/lib', '/Library/NDI SDK for Apple/lib/macOS'].filter(Boolean);
  let lib = null;
  for (const d of dirs) { const p = path.join(d, name); if (fs.existsSync(p)) { try { lib = koffi.load(p); break; } catch (e) { loadErr = e.message; } } }
  if (!lib) { try { lib = koffi.load(name); } catch (e) { loadErr = 'NDI Runtime tidak ditemukan. Instal "NDI Tools" atau "NDI Runtime" dari ndi.video'; return false; } }
  try {
    const Source = koffi.struct('NDIlib_source_t', { p_ndi_name: 'const char *', p_url_address: 'const char *' });
    koffi.struct('NDIlib_find_create_t', { show_local_sources: 'bool', p_groups: 'const char *', p_extra_ips: 'const char *' });
    koffi.struct('NDIlib_recv_create_v3_t', { source_to_connect_to: Source, color_format: 'int', bandwidth: 'int', allow_video_fields: 'bool', p_ndi_recv_name: 'const char *' });
    koffi.struct('NDIlib_send_create_t', { p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool' });
    const Video = koffi.struct('NDIlib_video_frame_v2_t', {
      xres: 'int', yres: 'int', FourCC: 'uint32_t', frame_rate_N: 'int', frame_rate_D: 'int', picture_aspect_ratio: 'float',
      frame_format_type: 'int', timecode: 'int64_t', p_data: 'void *', line_stride_in_bytes: 'int', p_metadata: 'const char *', timestamp: 'int64_t'
    });
    T = { Source, Video };
    N = {
      initialize: lib.func('bool NDIlib_initialize()'),
      find_create: lib.func('void * NDIlib_find_create_v2(const NDIlib_find_create_t *p)'),
      find_wait: lib.func('bool NDIlib_find_wait_for_sources(void *f, uint32_t timeout)'),
      find_sources: lib.func('void * NDIlib_find_get_current_sources(void *f, _Out_ uint32_t *n)'),
      recv_create: lib.func('void * NDIlib_recv_create_v3(const NDIlib_recv_create_v3_t *p)'),
      recv_capture: lib.func('int NDIlib_recv_capture_v2(void *r, _Out_ NDIlib_video_frame_v2_t *v, void *a, void *m, uint32_t timeout)'),
      recv_free: lib.func('void NDIlib_recv_free_video_v2(void *r, const NDIlib_video_frame_v2_t *v)'),
      recv_destroy: lib.func('void NDIlib_recv_destroy(void *r)'),
      send_create: lib.func('void * NDIlib_send_create(const NDIlib_send_create_t *p)'),
      send_video: lib.func('void NDIlib_send_send_video_v2(void *s, const NDIlib_video_frame_v2_t *v)'),
      send_destroy: lib.func('void NDIlib_send_destroy(void *s)')
    };
    if (!N.initialize()) { loadErr = 'CPU tidak didukung NDI'; N = null; return false; }
    return true;
  } catch (e) { loadErr = 'Gagal memuat fungsi NDI: ' + e.message; N = null; return false; }
}

function copyOut(ptr, size) {
  if (koffi.view) return Buffer.from(new Uint8Array(koffi.view(ptr, size)));
  return Buffer.from(koffi.decode(ptr, koffi.array('uint8_t', size)));
}

// ---------- cari sumber ----------
let finder = null;
async function sources() {
  if (!load()) return { ok: false, msg: loadErr };
  if (!finder) finder = N.find_create({ show_local_sources: true, p_groups: null, p_extra_ips: null });
  N.find_wait(finder, 1500);
  const n = [0];
  const ptr = N.find_sources(finder, n);
  const list = n[0] && ptr ? koffi.decode(ptr, koffi.array(T.Source, n[0])) : [];
  return { ok: true, sources: list.map((s) => ({ name: s.p_ndi_name, url: s.p_url_address })) };
}

// ---------- terima ----------
const recvs = new Map();
function recvStart(id, srcName, opts) {
  if (!load()) return { ok: false, msg: loadErr };
  recvStop(id);
  const r = N.recv_create({ source_to_connect_to: { p_ndi_name: srcName, p_url_address: null }, color_format: 0, bandwidth: opts && opts.low ? 10 : 100, allow_video_fields: false, p_ndi_recv_name: 'KLM Mix' });
  if (!r) return { ok: false, msg: 'Gagal membuat penerima NDI' };
  const st = { r, ff: null, w: 0, h: 0, alive: true, fps: (opts && opts.fps) || 30 };
  recvs.set(id, st);
  const startFF = (w, h) => {
    if (st.ff) { try { st.ff.stdin.end(); st.ff.kill(); } catch (e) {} }
    st.w = w; st.h = h;
    st.ff = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', w + 'x' + h, '-r', String(st.fps), '-i', 'pipe:0',
      '-vf', h > 1080 ? 'scale=-2:1080' : 'null', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', String(st.fps), '-pix_fmt', 'yuv420p',
      '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '100000', 'pipe:1'], { windowsHide: true });
    st.ff.stdin.on('error', () => {});
    st.ff.stdout.on('data', (b) => send({ t: 'chunk', id, buf: b }));
    send({ t: 'restart', id });
  };
  const loop = () => {
    if (!st.alive) return;
    const frame = {};
    N.recv_capture.async(r, frame, null, null, 200, (err, type) => {
      if (!st.alive) return;
      if (!err && type === 1 && frame.p_data) {
        const w = frame.xres, hh = frame.yres, stride = frame.line_stride_in_bytes || w * 4;
        try {
          let buf = copyOut(frame.p_data, stride * hh);
          if (stride !== w * 4) { const o = Buffer.alloc(w * 4 * hh); for (let y = 0; y < hh; y++) buf.copy(o, y * w * 4, y * stride, y * stride + w * 4); buf = o; }
          if (w !== st.w || hh !== st.h) startFF(w, hh);
          if (st.ff && st.ff.stdin.writable && st.ff.stdin.writableLength < w * hh * 8) st.ff.stdin.write(buf);
        } catch (e) { send({ t: 'log', msg: 'recv: ' + e.message }); }
        try { N.recv_free(r, frame); } catch (e) {}
      }
      setImmediate(loop);
    });
  };
  loop();
  return { ok: true };
}
function recvStop(id) {
  const st = recvs.get(id); if (!st) return;
  st.alive = false; recvs.delete(id);
  try { st.ff && st.ff.kill(); } catch (e) {}
  setTimeout(() => { try { N.recv_destroy(st.r); } catch (e) {} }, 400);
}

// ---------- kirim (output) ----------
let sender = null;
function sendStart(o) {
  if (!load()) return { ok: false, msg: loadErr };
  sendStop();
  const w = o.width || 1280, hh = o.height || 720, fps = o.fps || 30, size = w * hh * 4;
  const s = N.send_create({ p_ndi_name: o.name || 'KLM Mix', p_groups: null, clock_video: false, clock_audio: false });
  if (!s) return { ok: false, msg: 'Gagal membuat pengirim NDI' };
  const mem = koffi.alloc('uint8_t', size);
  const view = koffi.view ? new Uint8Array(koffi.view(mem, size)) : null;
  const ff = spawn(FF, ['-hide_banner', '-loglevel', 'error', '-fflags', 'nobuffer', '-i', 'pipe:0', '-an', '-vf', `scale=${w}:${hh},fps=${fps}`, '-pix_fmt', 'bgra', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
  ff.stdin.on('error', () => {});
  let acc = Buffer.alloc(0);
  ff.stdout.on('data', (b) => {
    acc = acc.length ? Buffer.concat([acc, b]) : b;
    while (acc.length >= size) {
      const fr = acc.subarray(0, size); acc = acc.subarray(size);
      if (acc.length > size * 3) acc = acc.subarray(acc.length - (acc.length % size)); // buang antrian bila tertinggal
      try {
        if (view) view.set(fr); else koffi.encode(mem, koffi.array('uint8_t', size), fr);
        N.send_video(s, { xres: w, yres: hh, FourCC: 0x41524742, frame_rate_N: fps * 1000, frame_rate_D: 1000, picture_aspect_ratio: w / hh, frame_format_type: 1, timecode: -1, p_data: mem, line_stride_in_bytes: w * 4, p_metadata: null, timestamp: 0 });
      } catch (e) { send({ t: 'log', msg: 'send: ' + e.message }); }
    }
  });
  sender = { s, ff, mem };
  return { ok: true };
}
function sendData(buf) { if (sender && sender.ff.stdin.writable) sender.ff.stdin.write(Buffer.from(buf)); }
function sendStop() {
  if (!sender) return;
  const sd = sender; sender = null;
  try { sd.ff.stdin.end(); sd.ff.kill(); } catch (e) {}
  setTimeout(() => { try { N.send_destroy(sd.s); koffi.free(sd.mem); } catch (e) {} }, 300);
}

process.on('message', async (m) => {
  let r;
  try {
    if (m.cmd === 'sources') r = await sources();
    else if (m.cmd === 'recv') r = recvStart(m.id, m.source, m.opts);
    else if (m.cmd === 'recv-stop') { recvStop(m.id); r = { ok: true }; }
    else if (m.cmd === 'send') r = sendStart(m.opts || {});
    else if (m.cmd === 'send-data') { sendData(m.buf); return; }
    else if (m.cmd === 'send-stop') { sendStop(); r = { ok: true }; }
    else if (m.cmd === 'check') r = load() ? { ok: true } : { ok: false, msg: loadErr };
  } catch (e) { r = { ok: false, msg: e.message }; }
  if (m.rid) send({ t: 'res', rid: m.rid, r });
});
process.on('uncaughtException', (e) => send({ t: 'log', msg: 'NDI worker: ' + e.message }));
