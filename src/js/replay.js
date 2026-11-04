/* KLM Mix - Instant Replay (buffer berputar + event + slow motion) dan Playlist otomatis */
'use strict';
(function (KM) {
  const S = KM.state;

  // ================= INSTANT REPLAY =================
  const RP = KM.replay = {
    buf: [], events: [], enabled: false, cur: null, idx: 0, speed: 1, playing: false, lastT: 0, lastCap: 0, refs: new Map(), pending: 0
  };
  let cap, capCtx;
  const capFps = () => Math.min(30, KM.settings.fps);

  function ref(b, d) { const n = (RP.refs.get(b) || 0) + d; if (n <= 0) { RP.refs.delete(b); try { b.close(); } catch (e) {} } else RP.refs.set(b, n); }

  RP.setEnabled = function (on) {
    RP.enabled = on == null ? !RP.enabled : !!on;
    if (!RP.enabled) { RP.buf.forEach((f) => ref(f.bmp, -1)); RP.buf = []; }
    KM.toast(RP.enabled ? 'Buffer replay aktif (' + KM.settings.replay.seconds + ' detik)' : 'Buffer replay dimatikan');
    KM.changed('replay');
  };

  RP.capture = function () {
    const now = KM.now();
    // putar
    if (RP.playing && RP.cur) {
      const dt = (now - RP.lastT) / 1000; RP.lastT = now;
      RP.idx += dt * capFps() * RP.speed;
      if (RP.idx >= RP.cur.frames.length - 1) {
        RP.idx = RP.cur.frames.length - 1; RP.playing = false; KM.changed('replay');
        if (RP.returnTo) { const back = RP.returnTo; RP.returnTo = null; const t = KM.settings.transitions[0]; KM.engine.transition(t.type, t.dur, back); }
      }
    }
    if (!RP.enabled) return;
    if (now - RP.lastCap < 1000 / capFps() - 2 || RP.pending > 3) return;
    RP.lastCap = now;
    const rs = KM.settings.replay;
    if (!cap) { cap = document.createElement('canvas'); capCtx = cap.getContext('2d', { alpha: false }); }
    if (cap.width !== rs.width || cap.height !== rs.height) { cap.width = rs.width; cap.height = rs.height; }
    capCtx.fillStyle = '#000'; capCtx.fillRect(0, 0, cap.width, cap.height);
    if (rs.source === 'program' || !rs.source) capCtx.drawImage(KM.engine.prog, 0, 0, cap.width, cap.height);
    else { const inp = KM.getInput(rs.source); if (inp) KM.engine.drawInputRect(capCtx, inp, 0, 0, cap.width, cap.height, 0); }
    RP.pending++;
    createImageBitmap(cap).then((bmp) => {
      RP.pending--;
      RP.refs.set(bmp, 1);
      RP.buf.push({ bmp, t: Date.now() });
      const max = Math.round(rs.seconds * capFps());
      while (RP.buf.length > max) ref(RP.buf.shift().bmp, -1);
    }).catch(() => { RP.pending--; });
  };

  /** tandai event: N detik terakhir */
  RP.mark = function (seconds, name) {
    if (!RP.buf.length) { KM.toast('Buffer replay kosong — aktifkan dulu', 'warn'); return null; }
    const n = Math.min(RP.buf.length, Math.round((seconds || 8) * capFps()));
    const frames = RP.buf.slice(-n).map((f) => { ref(f.bmp, 1); return f.bmp; });
    const ev = { id: KM.uid(), name: name || ('Event ' + (RP.events.length + 1) + ' • ' + new Date().toLocaleTimeString('id-ID')), frames, sec: n / capFps() };
    RP.events.unshift(ev);
    while (RP.events.length > 20) { const old = RP.events.pop(); old.frames.forEach((b) => ref(b, -1)); }
    KM.changed('replay');
    KM.toast('Replay event disimpan (' + ev.sec.toFixed(1) + ' dtk)');
    return ev;
  };
  RP.remove = function (id) {
    const i = RP.events.findIndex((e) => e.id === id); if (i < 0) return;
    const ev = RP.events.splice(i, 1)[0]; if (RP.cur === ev) RP.cur = null;
    ev.frames.forEach((b) => ref(b, -1)); KM.changed('replay');
  };
  RP.load = function (id) {
    const ev = id ? RP.events.find((e) => e.id === id) : RP.events[0];
    if (!ev) return false; RP.cur = ev; RP.idx = 0; KM.changed('replay'); return true;
  };
  RP.play = function (id) {
    if (id || !RP.cur) if (!RP.load(id)) return false;
    if (RP.idx >= RP.cur.frames.length - 1) RP.idx = 0;
    RP.playing = true; RP.lastT = KM.now(); KM.changed('replay'); return true;
  };
  RP.pause = () => { RP.playing = false; KM.changed('replay'); };
  RP.restart = () => { RP.idx = 0; };
  RP.setSpeed = (s) => { RP.speed = KM.clamp(+s || 1, 0.05, 4); KM.changed('replay'); };
  /** putar event ke program lewat transisi, lalu otomatis kembali */
  RP.playToProgram = function (id, autoReturn) {
    let inp = S.inputs.find((i) => i.type === 'replay');
    if (!inp) inp = KM.inputs.create('replay', { title: 'Instant Replay' });
    if (!RP.load(id)) { KM.toast('Belum ada event replay', 'warn'); return false; }
    RP.returnTo = autoReturn !== false ? S.programId : null;
    const sg = KM.settings.stingers[0];
    if (sg && KM.getInput(sg.inputId)) KM.engine.transition('stinger1', 0, inp.id, { keepPreview: true });
    else { const t = KM.settings.transitions[0]; KM.engine.transition(t.type, t.dur, inp.id, { keepPreview: true }); }
    RP.idx = 0; RP.playing = true; RP.lastT = KM.now();
    return true;
  };
  RP.source = function () {
    if (!RP.cur || !RP.cur.frames.length) return null;
    const b = RP.cur.frames[Math.max(0, Math.min(RP.cur.frames.length - 1, Math.floor(RP.idx)))];
    return { src: b, w: b.width, h: b.height };
  };

  // ================= PLAYLIST =================
  const PL = KM.playlist = { items: [], idx: -1, running: false, t0: 0, type: 'fade', dur: 800, loop: true };
  PL.add = (inputId, dur) => { PL.items.push({ inputId, dur: dur == null ? 10 : dur }); KM.changed('playlist'); };
  PL.removeAt = (i) => { PL.items.splice(i, 1); KM.changed('playlist'); };
  PL.goto = function (i) {
    if (!PL.items.length) return;
    if (i >= PL.items.length) { if (!PL.loop) return PL.stop(); i = 0; }
    if (i < 0) i = PL.items.length - 1;
    PL.idx = i; PL.t0 = KM.now();
    const it = PL.items[i], inp = KM.getInput(it.inputId);
    if (!inp) return PL.goto(i + 1);
    if (inp.id === S.programId) { KM.inputs.restart(inp); KM.inputs.play(inp); }
    else KM.engine.transition(PL.type, PL.dur, inp.id, { keepPreview: true });
    KM.changed('playlist');
  };
  PL.start = function () { if (!PL.items.length) { KM.toast('Playlist kosong', 'warn'); return; } PL.running = true; PL.goto(PL.idx < 0 ? 0 : PL.idx); };
  PL.stop = function () { PL.running = false; KM.changed('playlist'); };
  PL.next = () => PL.goto(PL.idx + 1);
  PL.prev = () => PL.goto(PL.idx - 1);
  setInterval(() => {
    if (!PL.running || PL.idx < 0) return;
    const it = PL.items[PL.idx]; if (!it) return;
    if (it.dur > 0 && KM.now() - PL.t0 >= it.dur * 1000) PL.next();
  }, 200);
  KM.on('input-ended', (inp) => {
    if (!PL.running || PL.idx < 0) return;
    const it = PL.items[PL.idx];
    if (it && it.inputId === inp.id && !(it.dur > 0)) PL.next();
  });
})(window.KM);
