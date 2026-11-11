/* KLM Mix - argumen ffmpeg untuk streaming (WebM dari MediaRecorder → RTMP/RTMPS/SRT, multi-tujuan) */
'use strict';
function buildFfmpegArgs(cfg) {
  const fps = cfg.fps || 30;
  const vb = (cfg.videoBitrate || 4500) + 'k';
  const ab = (cfg.audioBitrate || 160) + 'k';
  const args = ['-hide_banner', '-loglevel', 'info', '-fflags', '+genpts+nobuffer', '-thread_queue_size', '1024', '-i', 'pipe:0'];
  const enc = cfg.encoder || 'x264';
  if (enc === 'copy') args.push('-c:v', 'copy');
  else {
    const map = { x264: 'libx264', nvenc: 'h264_nvenc', qsv: 'h264_qsv', amf: 'h264_amf' };
    args.push('-c:v', map[enc] || 'libx264');
    if (enc === 'x264') args.push('-preset', cfg.preset || 'veryfast', '-tune', 'zerolatency');
    if (enc === 'nvenc') args.push('-preset', 'p4', '-tune', 'll');
    args.push('-b:v', vb, '-maxrate', vb, '-bufsize', (parseInt(vb, 10) * 2) + 'k', '-g', String(fps * 2), '-keyint_min', String(fps * 2), '-pix_fmt', 'yuv420p', '-r', String(fps));
    if (cfg.width && cfg.height && cfg.scale) args.push('-vf', `scale=${cfg.width}:${cfg.height}`);
  }
  args.push('-c:a', 'aac', '-b:a', ab, '-ar', '48000', '-ac', '2');
  const outs = (cfg.destinations || []).filter((d) => d.enabled && d.url);
  const fmt = (u) => (/^srt:|^udp:/i.test(u) ? 'mpegts' : 'flv');
  if (outs.length === 1) {
    args.push('-f', fmt(outs[0].url), outs[0].url);
  } else {
    args.push('-flags', '+global_header', '-map', '0:v', '-map', '0:a', '-f', 'tee',
      outs.map((o) => `[f=${fmt(o.url)}:onfail=ignore]${o.url}`).join('|'));
  }
  return args;
}

module.exports = { buildFfmpegArgs };

/* ---------- SRT ke gateway / decoder TV ----------
 * MPEG-TS siaran: GOP tertutup & tetap, tanpa B-frame, CBR + muxrate (decoder hardware butuh timing stabil),
 * paket 1316 byte, latensi SRT bisa diatur, enkripsi AES (passphrase), stream ID (format Haivision/gateway).
 */
function srtUrl(c) {
  const mode = ['caller', 'listener', 'rendezvous'].includes(c.mode) ? c.mode : 'caller';
  const host = mode === 'listener' ? '0.0.0.0' : String(c.host || '').trim().replace(/^srt:\/\//i, '').replace(/[/?].*$/, '');
  const q = ['mode=' + mode, 'transtype=live', 'latency=' + Math.round((+c.latency || 200) * 1000), 'pkt_size=1316'];
  if (mode !== 'listener') q.push('connect_timeout=' + Math.round((+c.timeout || 5) * 1000));
  return 'srt://' + host + ':' + (+c.port || 9000) + '?' + q.join('&');
}
function buildSrtArgs(c) {
  const fps = c.fps || 30, gop = Math.max(1, Math.round(fps * (+c.gop || 1)));
  const vbk = +c.videoBitrate || 6000, abk = +c.audioBitrate || 192;
  const vb = vbk + 'k', ab = abk + 'k';
  const a = ['-hide_banner', '-loglevel', 'info', '-stats_period', '1', '-fflags', '+genpts+nobuffer', '-flags', 'low_delay', '-thread_queue_size', '1024', '-i', 'pipe:0'];
  const enc = c.encoder || 'x264';
  if (enc === 'copy') a.push('-c:v', 'copy');
  else {
    const map = { x264: 'libx264', nvenc: 'h264_nvenc', qsv: 'h264_qsv', amf: 'h264_amf' };
    a.push('-c:v', map[enc] || 'libx264');
    if (enc === 'x264') a.push('-preset', c.preset || 'veryfast', '-tune', 'zerolatency', '-profile:v', 'high', '-level:v', '4.1', '-x264-params', 'nal-hrd=cbr:force-cfr=1:scenecut=0:open-gop=0');
    if (enc === 'nvenc') a.push('-preset', 'p4', '-tune', 'll', '-rc', 'cbr', '-profile:v', 'high', '-forced-idr', '1');
    if (enc === 'qsv') a.push('-preset', 'veryfast', '-look_ahead', '0', '-profile:v', 'high');
    if (enc === 'amf') a.push('-usage', 'lowlatency', '-rc', 'cbr', '-quality', 'speed', '-profile:v', 'high');
    a.push('-bf', '0', '-g', String(gop), '-keyint_min', String(gop), '-b:v', vb, '-minrate', vb, '-maxrate', vb, '-bufsize', Math.round(vbk / 2) + 'k', '-pix_fmt', 'yuv420p', '-r', String(fps));
    if (c.width && c.height) a.push('-vf', `scale=${c.width}:${c.height}:flags=bicubic`);
  }
  if (c.audioCodec === 'mp2') a.push('-c:a', 'mp2', '-b:a', Math.max(192, abk) + 'k', '-ar', '48000', '-ac', '2');
  else a.push('-c:a', 'aac', '-b:a', ab, '-ar', '48000', '-ac', '2');
  a.push('-f', 'mpegts', '-mpegts_flags', '+resend_headers', '-pcr_period', '20', '-muxdelay', '0', '-muxpreload', '0', '-flush_packets', '1');
  if (enc !== 'copy' && c.cbr !== false) a.push('-muxrate', Math.round((vbk + Math.max(abk, c.audioCodec === 'mp2' ? 192 : 0)) * 1.18) + 'k');
  if (c.passphrase) a.push('-passphrase', String(c.passphrase), '-pbkeylen', String([16, 24, 32].includes(+c.pbkeylen) ? +c.pbkeylen : 16));
  if (c.streamid) a.push('-streamid', String(c.streamid));
  a.push(srtUrl(c));
  return a;
}

module.exports.buildSrtArgs = buildSrtArgs;
module.exports.srtUrl = srtUrl;
