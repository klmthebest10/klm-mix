/* KLM Mix - PTZ: kamera fisik (VISCA over IP / HTTP-CGI lewat hub) + PTZ virtual (pan/zoom halus di input mana pun) */
'use strict';
(function (KM) {
  const P = KM.ptz = {};
  const post = (body) => fetch('/hub/ptz', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json()).catch((e) => ({ ok: false, msg: e.message }));

  P.cfg = (inp) => {
    if (!inp.ptz) inp.ptz = { on: false, proto: 'visca-tcp', host: '', port: '', speed: 8, zspeed: 4, presets: {} };
    return inp.ptz;
  };
  /** kirim perintah ke kamera PTZ fisik */
  P.cmd = async function (inp, cmd, extra) {
    inp = KM.getInput(inp); if (!inp) return false;
    const c = P.cfg(inp);
    if (!c.on || !c.host) { if (!/stop/.test(cmd)) KM.toast('Atur IP kamera PTZ dulu (tab 🎥 PTZ)', 'warn'); return false; }
    const r = await post(Object.assign({ proto: c.proto, host: c.host, port: c.port, speed: c.speed, tspeed: c.speed, zspeed: c.zspeed, cmd }, extra || {}));
    if (!r.ok && !/stop/.test(cmd)) KM.toast('PTZ gagal: ' + (r.msg || 'tidak ada jawaban'), 'warn');
    return r.ok;
  };

  // ---------- PTZ virtual ----------
  const anims = new Map();
  P.vcfg = (inp) => { if (!inp.vptz) inp.vptz = { presets: {}, dur: 1200 }; return inp.vptz; };
  P.vsave = (inp, n) => { const v = P.vcfg(inp); v.presets[n] = { x: inp.pos.x, y: inp.pos.y, zoom: inp.pos.zoom }; KM.changed('input'); KM.toast('Posisi virtual ' + n + ' disimpan'); };
  P.vgo = function (inp, n, dur) {
    inp = KM.getInput(inp); if (!inp) return false;
    const v = P.vcfg(inp), t = n === 'home' ? { x: 0, y: 0, zoom: 1 } : v.presets[n];
    if (!t) return false;
    const from = { x: inp.pos.x, y: inp.pos.y, zoom: inp.pos.zoom }, t0 = KM.now(), d = dur == null ? v.dur : dur;
    anims.set(inp.id, { from, to: t, t0, d });
    return true;
  };
  /** gerak kontinu virtual (joystick): vx, vy, vz per detik */
  P.vdrive = function (inp, vx, vy, vz) { inp = KM.getInput(inp); if (!inp) return; if (!vx && !vy && !vz) inp.rt.vdrive = null; else inp.rt.vdrive = { vx, vy, vz, t: KM.now() }; };
  KM.on('frame', () => {
    const now = KM.now();
    for (const [id, a] of anims) {
      const inp = KM.getInput(id); if (!inp) { anims.delete(id); continue; }
      const k = KM.ease(KM.clamp((now - a.t0) / a.d, 0, 1));
      inp.pos.x = KM.lerp(a.from.x, a.to.x, k); inp.pos.y = KM.lerp(a.from.y, a.to.y, k);
      // zoom secara logaritmik agar terasa natural
      inp.pos.zoom = Math.exp(KM.lerp(Math.log(a.from.zoom), Math.log(a.to.zoom), k));
      if (k >= 1) anims.delete(id);
    }
    for (const inp of KM.state.inputs) {
      const d = inp.rt.vdrive; if (!d) continue;
      const dt = Math.min(0.1, (now - d.t) / 1000); d.t = now;
      const z = inp.pos.zoom;
      inp.pos.x = KM.clamp(inp.pos.x - d.vx * dt / Math.max(1, z) , -3, 3);
      inp.pos.y = KM.clamp(inp.pos.y - d.vy * dt / Math.max(1, z), -3, 3);
      inp.pos.zoom = KM.clamp(z * Math.pow(1.8, d.vz * dt), 0.1, 8);
    }
  });

  // ---------- panel PTZ (dock) ----------
  const DIRS = [['upleft', '↖'], ['up', '↑'], ['upright', '↗'], ['left', '←'], ['home', '⌂'], ['right', '→'], ['downleft', '↙'], ['down', '↓'], ['downright', '↘']];
  const VEC = { upleft: [-1, -1], up: [0, -1], upright: [1, -1], left: [-1, 0], right: [1, 0], downleft: [-1, 1], down: [0, 1], downright: [1, 1] };
  P.selId = null;
  P.render = function (box) {
    const h = KM.h, S = KM.state, { sel, chk, row } = KM.dialogs.helpers;
    const vids = S.inputs.filter((i) => !KM.inputTypes[i.type].noVideo);
    if (!vids.length) { box.replaceChildren(h('p.muted', 'Tambahkan input kamera dulu.')); return; }
    let inp = KM.getInput(P.selId); if (!inp || !vids.includes(inp)) { inp = vids.find((i) => i.type === 'camera') || vids[0]; P.selId = inp.id; }
    const c = P.cfg(inp), v = P.vcfg(inp);
    let mode = P.mode || (c.on ? 'fisik' : 'virtual');
    const hold = (label, start, stop, cls) => {
      const b = h('button.btn' + (cls ? '.' + cls : ''), { style: { minWidth: '46px', minHeight: '40px', fontSize: '18px', touchAction: 'none' } }, label);
      const down = (e) => { e.preventDefault(); b.classList.add('on'); start(); };
      const up = () => { if (b.classList.contains('on')) { b.classList.remove('on'); stop && stop(); } };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      return b;
    };
    const pad = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 52px)', gap: '4px' } }, DIRS.map(([d, l]) => {
      if (d === 'home') return h('button.btn', { style: { minHeight: '40px' }, onclick: () => (mode === 'fisik' ? P.cmd(inp, 'home') : P.vgo(inp, 'home')) }, l);
      const [x, y] = VEC[d];
      return hold(l, () => (mode === 'fisik' ? P.cmd(inp, d) : P.vdrive(inp, x * 0.8, y * 0.8, 0)), () => (mode === 'fisik' ? P.cmd(inp, 'stop') : P.vdrive(inp, 0, 0, 0)));
    }));
    const zoom = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
      hold('Z＋', () => (mode === 'fisik' ? P.cmd(inp, 'zoomin') : P.vdrive(inp, 0, 0, 1)), () => (mode === 'fisik' ? P.cmd(inp, 'zoomstop') : P.vdrive(inp, 0, 0, 0))),
      hold('Z－', () => (mode === 'fisik' ? P.cmd(inp, 'zoomout') : P.vdrive(inp, 0, 0, -1)), () => (mode === 'fisik' ? P.cmd(inp, 'zoomstop') : P.vdrive(inp, 0, 0, 0))),
      mode === 'fisik' ? h('button.btn.sm', { onclick: () => P.cmd(inp, 'focusauto') }, 'AF') : null);
    const presets = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' } }, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
      const has = mode === 'fisik' ? true : !!v.presets[n];
      return h('button.btn' + (has && mode === 'virtual' ? '.on' : ''), {
        title: 'Klik: panggil • Shift+klik / tekan lama: simpan',
        onclick: (e) => { if (e.shiftKey) save(n); else if (mode === 'fisik') P.cmd(inp, 'preset', { preset: n }); else P.vgo(inp, n); },
        oncontextmenu: (e) => { e.preventDefault(); save(n); }
      }, (mode === 'fisik' ? (c.presets[n] || 'P' + n) : 'V' + n));
    }));
    function save(n) { if (mode === 'fisik') { P.cmd(inp, 'save', { preset: n }); KM.toast('Preset kamera ' + n + ' disimpan'); } else { P.vsave(inp, n); P.render(box); } }
    box.replaceChildren(
      h('div.sec', row('Input', sel(vids.map((i) => [i.id, KM.inputNum(i) + '. ' + i.title]), inp.id, (val) => { P.selId = val; P.render(box); })),
        h('div.row', h('button.btn' + (mode === 'virtual' ? '.on' : ''), { onclick: () => { P.mode = 'virtual'; P.render(box); } }, '🪄 PTZ Virtual'), h('button.btn' + (mode === 'fisik' ? '.on' : ''), { onclick: () => { P.mode = 'fisik'; P.render(box); } }, '🎥 Kamera PTZ fisik'))),
      mode === 'fisik' ? h('div.sec', h('h4', 'Koneksi kamera PTZ'),
        chk('Aktifkan kontrol PTZ untuk input ini', c.on, (x) => { c.on = x; }),
        row('Protokol', sel([['visca-tcp', 'VISCA TCP (PTZOptics/umum, 5678)'], ['visca-udp', 'VISCA UDP (1259)'], ['visca-sony', 'VISCA over IP Sony (52381)'], ['http', 'HTTP-CGI (PTZOptics/HuddleCam)']], c.proto, (x) => { c.proto = x; })),
        row('IP kamera', h('input.grow', { value: c.host, placeholder: '192.168.1.88', onchange: (e) => { c.host = e.target.value.trim(); c.on = true; } }), h('input', { value: c.port, placeholder: 'port', style: { width: '70px' }, onchange: (e) => { c.port = e.target.value; } })),
        h('div.kv', ...KM.dialogs.helpers.slider('Kecepatan', 1, 24, 1, () => c.speed, (x) => { c.speed = x; }, (x) => String(x)), ...KM.dialogs.helpers.slider('Kec. zoom', 1, 7, 1, () => c.zspeed, (x) => { c.zspeed = x; }, (x) => String(x))),
        h('p.muted', 'Video kamera PTZ masuk lewat input Kamera (USB/HDMI) atau Stream Masuk (RTSP: rtsp://IP/1).'))
        : h('div.sec', h('h4', 'PTZ Virtual'), h('p.muted', 'Gerakkan, zoom, lalu simpan posisi (Shift+klik / klik kanan). Panggil posisi = pergerakan kamera halus otomatis — cocok untuk 1 kamera 4K jadi banyak sudut.'),
          h('div.kv', ...KM.dialogs.helpers.slider('Durasi gerak', 200, 5000, 100, () => v.dur, (x) => { v.dur = x; }, (x) => (x / 1000).toFixed(1) + ' dtk'))),
      h('div.sec', h('div.row', { style: { alignItems: 'flex-start', gap: '14px' } }, pad, zoom, h('div.grow', h('h4', mode === 'fisik' ? 'Preset kamera' : 'Posisi virtual'), presets))));
  };
})(window.KM);
