/* KLM Mix - kontrol kamera PTZ fisik
 * Protokol: VISCA over IP (Sony UDP 52381), VISCA UDP mentah (1259), VISCA TCP (5678, PTZOptics/kebanyakan PTZ China),
 *           HTTP-CGI (PTZOptics/HuddleCam/Minrray: /cgi-bin/ptzctrl.cgi)
 */
'use strict';
const dgram = require('dgram');
const net = require('net');
const http = require('http');

const DEF_PORT = { 'visca-sony': 52381, 'visca-udp': 1259, 'visca-tcp': 5678, http: 80 };
const tcpConns = new Map();
let udp = null;
const seq = new Map();

const h = (n) => Math.max(0, Math.min(255, n | 0));
function viscaCmd(cmd, a) {
  const ps = h(Math.max(1, Math.min(0x18, a.speed || 8)));        // kecepatan pan 1-24
  const ts = h(Math.max(1, Math.min(0x14, a.tspeed || a.speed || 8))); // kecepatan tilt 1-20
  const zs = Math.max(0, Math.min(7, a.zspeed == null ? 4 : a.zspeed));
  const pp = Math.max(0, Math.min(127, (a.preset | 0)));
  const dir = { up: [3, 1], down: [3, 2], left: [1, 3], right: [2, 3], upleft: [1, 1], upright: [2, 1], downleft: [1, 2], downright: [2, 2], stop: [3, 3] };
  if (dir[cmd]) return [0x81, 0x01, 0x06, 0x01, ps, ts, dir[cmd][0], dir[cmd][1], 0xFF];
  switch (cmd) {
    case 'zoomin': return [0x81, 0x01, 0x04, 0x07, 0x20 | zs, 0xFF];
    case 'zoomout': return [0x81, 0x01, 0x04, 0x07, 0x30 | zs, 0xFF];
    case 'zoomstop': return [0x81, 0x01, 0x04, 0x07, 0x00, 0xFF];
    case 'focusauto': return [0x81, 0x01, 0x04, 0x38, 0x02, 0xFF];
    case 'focusmanual': return [0x81, 0x01, 0x04, 0x38, 0x03, 0xFF];
    case 'focusnear': return [0x81, 0x01, 0x04, 0x08, 0x30 | zs, 0xFF];
    case 'focusfar': return [0x81, 0x01, 0x04, 0x08, 0x20 | zs, 0xFF];
    case 'focusstop': return [0x81, 0x01, 0x04, 0x08, 0x00, 0xFF];
    case 'onepushaf': return [0x81, 0x01, 0x04, 0x18, 0x01, 0xFF];
    case 'home': return [0x81, 0x01, 0x06, 0x04, 0xFF];
    case 'preset': return [0x81, 0x01, 0x04, 0x3F, 0x02, pp, 0xFF];
    case 'save': return [0x81, 0x01, 0x04, 0x3F, 0x01, pp, 0xFF];
    case 'poweron': return [0x81, 0x01, 0x04, 0x00, 0x02, 0xFF];
    case 'poweroff': return [0x81, 0x01, 0x04, 0x00, 0x03, 0xFF];
    case 'wbauto': return [0x81, 0x01, 0x04, 0x35, 0x00, 0xFF];
    case 'backlighton': return [0x81, 0x01, 0x04, 0x33, 0x02, 0xFF];
    case 'backlightoff': return [0x81, 0x01, 0x04, 0x33, 0x03, 0xFF];
    default: return null;
  }
}

function cgiPath(cmd, a) {
  const s = Math.max(1, Math.min(24, a.speed || 8)), z = Math.max(1, Math.min(7, a.zspeed || 4));
  const m = {
    up: `up&${s}&${s}`, down: `down&${s}&${s}`, left: `left&${s}&${s}`, right: `right&${s}&${s}`,
    upleft: `leftup&${s}&${s}`, upright: `rightup&${s}&${s}`, downleft: `leftdown&${s}&${s}`, downright: `rightdown&${s}&${s}`,
    stop: 'ptzstop', zoomin: `zoomin&${z}`, zoomout: `zoomout&${z}`, zoomstop: 'zoomstop',
    focusnear: `focusin&${z}`, focusfar: `focusout&${z}`, focusstop: 'focusstop', home: 'home',
    preset: `poscall&${a.preset | 0}`, save: `posset&${a.preset | 0}`
  }[cmd];
  return m ? '/cgi-bin/ptzctrl.cgi?ptzcmd&' + m : null;
}

function sendUdp(host, port, buf) {
  return new Promise((res) => {
    if (!udp) { udp = dgram.createSocket('udp4'); udp.on('error', () => {}); }
    udp.send(buf, port, host, (e) => res(!e));
  });
}
function sendTcp(host, port, buf) {
  return new Promise((res) => {
    const key = host + ':' + port;
    let s = tcpConns.get(key);
    const write = () => s.write(buf, () => res(true));
    if (s && !s.destroyed) return write();
    s = net.createConnection({ host, port, timeout: 3000 });
    s.on('connect', write);
    s.on('error', () => { tcpConns.delete(key); res(false); });
    s.on('timeout', () => s.setTimeout(0));
    s.on('data', () => {});
    s.on('close', () => tcpConns.delete(key));
    tcpConns.set(key, s);
  });
}

/** kirim perintah PTZ. a = {proto, host, port, cmd, speed, tspeed, zspeed, preset, user, pass} */
async function command(a) {
  const proto = a.proto || 'visca-tcp';
  const host = String(a.host || '').trim();
  if (!host) return { ok: false, msg: 'IP kamera kosong' };
  const port = +a.port || DEF_PORT[proto] || 5678;
  if (proto === 'http') {
    const pth = cgiPath(a.cmd, a);
    if (!pth) return { ok: false, msg: 'Perintah tidak didukung' };
    return new Promise((res) => {
      const rq = http.get({ host, port, path: pth, timeout: 3000, auth: a.user ? a.user + ':' + (a.pass || '') : undefined }, (r) => { r.resume(); res({ ok: r.statusCode < 400 }); });
      rq.on('error', (e) => res({ ok: false, msg: e.message })); rq.on('timeout', () => { rq.destroy(); res({ ok: false, msg: 'timeout' }); });
    });
  }
  const bytes = viscaCmd(a.cmd, a);
  if (!bytes) return { ok: false, msg: 'Perintah tidak didukung' };
  const payload = Buffer.from(bytes);
  if (proto === 'visca-sony') {
    const key = host + ':' + port;
    if (!seq.has(key)) { seq.set(key, 0); await sendUdp(host, port, Buffer.from([0x02, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0x01])); }
    const n = (seq.get(key) + 1) >>> 0; seq.set(key, n);
    const hdr = Buffer.alloc(8);
    hdr.writeUInt16BE(0x0100, 0); hdr.writeUInt16BE(payload.length, 2); hdr.writeUInt32BE(n, 4);
    return { ok: await sendUdp(host, port, Buffer.concat([hdr, payload])) };
  }
  if (proto === 'visca-udp') return { ok: await sendUdp(host, port, payload) };
  return { ok: await sendTcp(host, port, payload) };
}

module.exports = { command, viscaCmd, DEF_PORT };
