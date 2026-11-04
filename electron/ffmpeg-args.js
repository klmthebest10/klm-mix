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
