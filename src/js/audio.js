/* KLM Mix - mixer audio: per-input gain, EQ 3-band, kompresor, noise gate, delay, pan, fader, mute, solo,
   bus Master / A / B, audio-follow-video (Auto), VU meter stereo, monitor headphone */
'use strict';
(function (KM) {
  const A = KM.audio = { strips: new Map(), ready: false };
  let ctx;

  function dbToGain(db) { return Math.pow(10, db / 20); }
  A.volToGain = (v) => (v <= 0 ? 0 : Math.pow(v / 100, 2));

  function meterNodes(src) {
    const sp = ctx.createChannelSplitter(2);
    const L = ctx.createAnalyser(), R = ctx.createAnalyser();
    L.fftSize = R.fftSize = 1024;
    src.connect(sp); sp.connect(L, 0); sp.connect(R, 1);
    return { L, R, bufL: new Float32Array(1024), bufR: new Float32Array(1024), peakL: 0, peakR: 0, holdL: 0, holdR: 0 };
  }
  function readMeter(m) {
    m.L.getFloatTimeDomainData(m.bufL); m.R.getFloatTimeDomainData(m.bufR);
    let pl = 0, pr = 0;
    for (let i = 0; i < 1024; i++) { const a = Math.abs(m.bufL[i]), b = Math.abs(m.bufR[i]); if (a > pl) pl = a; if (b > pr) pr = b; }
    m.peakL = Math.max(pl, m.peakL * 0.85); m.peakR = Math.max(pr, m.peakR * 0.85);
    m.holdL = Math.max(pl, m.holdL - 0.005); m.holdR = Math.max(pr, m.holdR - 0.005);
    return m;
  }
  A.readMeter = readMeter;
  A.toDb = (v) => (v <= 0.00001 ? -100 : 20 * Math.log10(v));

  A.init = function () {
    if (ctx) return;
    ctx = A.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive', sampleRate: 48000 });
    const bus = (name) => {
      const g = ctx.createGain(); const mute = ctx.createGain();
      if (name === 'M') { // rak efek master → limiter master (cegah suara pecah/clipping)
        const rack = A.masterRack = KM.afx.rack(ctx); g.connect(rack.input);
        const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.08;
        const wet = ctx.createGain(), dry = ctx.createGain();
        rack.output.connect(lim); lim.connect(wet); wet.connect(mute); rack.output.connect(dry); dry.connect(mute);
        A.limiter = { wet, dry };
      } else g.connect(mute);
      const dest = ctx.createMediaStreamDestination(); dest.channelCount = 2;
      mute.connect(dest);
      return { name, gain: g, mute, dest, meter: meterNodes(mute), vol: 100, muted: false };
    };
    A.master = bus('M'); A.busA = bus('A'); A.busB = bus('B');
    A.soloBus = ctx.createGain();
    A.mmBus = ctx.createGain(); // jumlah semua input ke Master (untuk mix-minus KLM Call)
    A.setLimiter(KM.settings.masterLimiter !== false);
    // reverb bersama (send/return)
    A.reverb = ctx.createConvolver(); A.reverb.buffer = impulse(2.2, 2.5);
    A.reverbRet = ctx.createGain(); A.reverbRet.gain.value = 0.9;
    A.reverb.connect(A.reverbRet); A.reverbRet.connect(A.master.gain);
    ['A', 'B'].forEach((b) => { const d = (KM.settings.busDevice || {})[b]; if (d) A.setBusDevice(b, d); });
    A.monitor = ctx.createGain(); A.monitor.connect(ctx.destination);
    A.master.mute.connect(A.monitorSrc = ctx.createGain()); A.monitorSrc.connect(A.monitor);
    A.soloBus.connect(A.monitor);
    A.setMonitor(KM.settings.monitorAudio);
    if (KM.settings.audioOutDevice && ctx.setSinkId) ctx.setSinkId(KM.settings.audioOutDevice).catch(() => {});
    const resume = () => { if (ctx.state !== 'running') ctx.resume(); };
    ['click', 'keydown', 'pointerdown'].forEach((e) => window.addEventListener(e, resume, { capture: true }));
    A.ready = true;
    setInterval(A.updateAuto, 40);
    // plugin eksternal dulu, lalu rantai efek master
    KM.afx.ready = KM.afx.loadAll().catch(() => {}).then(() => A.masterRack.sync(KM.settings.masterFx || []));
  };

  function impulse(sec, decay) {
    const len = Math.round(ctx.sampleRate * sec), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return buf;
  }
  A.setLimiter = (on) => { KM.settings.masterLimiter = !!on; if (A.limiter) { A.limiter.wet.gain.value = on ? 1 : 0; A.limiter.dry.gain.value = on ? 0 : 1; } };
  /** kirim bus A / B ke perangkat output lain (mis. speaker ruangan, in-ear, perekam terpisah) */
  A.busOutEls = {};
  A.setBusDevice = async (b, deviceId) => {
    KM.settings.busDevice = Object.assign({}, KM.settings.busDevice, { [b]: deviceId });
    let el = A.busOutEls[b];
    if (!deviceId) { if (el) { el.pause(); el.srcObject = null; } return; }
    if (!el) { el = A.busOutEls[b] = new Audio(); }
    el.srcObject = A.busOf(b).dest.stream;
    try { if (el.setSinkId) await el.setSinkId(deviceId); await el.play(); } catch (e) { KM.toast('Gagal output bus ' + b + ': ' + e.message, 'warn'); }
  };
  A.busOf = (n) => (n === 'A' ? A.busA : n === 'B' ? A.busB : A.master);
  A.setBusVol = (n, v) => { const b = A.busOf(n); b.vol = KM.clamp(v, 0, 100); b.gain.gain.setTargetAtTime(A.volToGain(b.vol), ctx.currentTime, 0.02); KM.changed('audio'); };
  A.setBusMute = (n, m) => { const b = A.busOf(n); b.muted = m == null ? !b.muted : !!m; b.mute.gain.setTargetAtTime(b.muted ? 0 : 1, ctx.currentTime, 0.01); KM.changed('audio'); };
  A.setMonitor = (on) => { KM.settings.monitorAudio = !!on; if (A.monitor) A.monitor.gain.value = on ? 1 : 0; };
  A.setOutputDevice = async (id) => { KM.settings.audioOutDevice = id; KM.saveSettings(); if (ctx && ctx.setSinkId) try { await ctx.setSinkId(id || ''); } catch (e) { KM.toast('Gagal ganti output audio', 'warn'); } };

  /** sambungkan audio input ke rantai strip */
  A.attach = function (inp, force) {
    A.init();
    let st = A.strips.get(inp.id);
    if (st && !force) return st;
    if (st && force) { try { st.src.disconnect(); } catch (e) {} }
    let src = null;
    try {
      if (inp.type === 'video' || inp.type === 'audiofile' || inp.type === 'urlvideo' || inp.type === 'stream') {
        const el = inp.rt.el;
        if (!el._klmSrc) el._klmSrc = ctx.createMediaElementSource(el);
        src = el._klmSrc;
      } else if (inp.type === 'list') {
        const el = inp.rt.v;
        if (!el._klmSrc) el._klmSrc = ctx.createMediaElementSource(el);
        src = el._klmSrc;
      } else if (inp.rt.stream && inp.rt.stream.getAudioTracks().length) {
        src = ctx.createMediaStreamSource(inp.rt.stream);
        if (inp.type === 'klmcam' || inp.type === 'call') { // Chrome: track audio WebRTC perlu "dikonsumsi" elemen agar mengalir
          if (!inp.rt.sink) { inp.rt.sink = new Audio(); inp.rt.sink.muted = true; }
          inp.rt.sink.srcObject = inp.rt.stream; inp.rt.sink.play().catch(() => {});
        }
      } else if (inp.rt.pcmNode) src = inp.rt.pcmNode; // suara Mirroring (AirPlay) dari AudioWorklet
      else if (inp.rt.toneSrc) src = inp.rt.toneSrc;
    } catch (e) { console.warn('audio attach', e); }
    if (!src) return null;
    if (st && force) { st.src = src; src.connect(st.trim); return st; }

    const trim = ctx.createGain();
    const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 10; hpf.Q.value = 0.7;
    const duck = ctx.createGain(), toRv = ctx.createGain(); toRv.gain.value = 0;
    const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 120;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1200; mid.Q.value = 0.8;
    const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 7000;
    const comp = ctx.createDynamicsCompressor();
    const compBypass = ctx.createGain();
    const gate = ctx.createGain();
    const delay = ctx.createDelay(2.0);
    const pan = ctx.createStereoPanner();
    const fader = ctx.createGain();
    const live = ctx.createGain();
    const mute = ctx.createGain();
    const out = ctx.createGain();
    const toM = ctx.createGain(), toA = ctx.createGain(), toB = ctx.createGain(), toSolo = ctx.createGain();
    // rantai
    src.connect(trim); trim.connect(hpf); hpf.connect(lo); lo.connect(mid); mid.connect(hi);
    const compWet = ctx.createGain();
    hi.connect(comp); comp.connect(compWet); hi.connect(compBypass);
    const gatePre = ctx.createGain(); compWet.connect(gatePre); compBypass.connect(gatePre);
    const gateMeter = ctx.createAnalyser(); gateMeter.fftSize = 512; gatePre.connect(gateMeter);
    const rack = KM.afx.rack(ctx);
    gatePre.connect(gate); gate.connect(rack.input); rack.output.connect(delay); delay.connect(pan); pan.connect(fader); fader.connect(live); live.connect(duck); duck.connect(mute); mute.connect(out);
    out.connect(toRv); toRv.connect(A.reverb);
    out.connect(toM); out.connect(toA); out.connect(toB); out.connect(toSolo);
    toM.connect(A.master.gain); toM.connect(A.mmBus); toA.connect(A.busA.gain); toB.connect(A.busB.gain); toSolo.connect(A.soloBus);
    st = { inp, src, rack, trim, hpf, duck, toRv, duckVal: 1, lo, mid, hi, comp, compWet, compBypass, gate, gateMeter, gateBuf: new Float32Array(512), delay, pan, fader, live, mute, out, toM, toA, toB, toSolo, meter: meterNodes(out), liveVal: 1 };
    A.strips.set(inp.id, st);
    A.apply(inp);
    if (inp.audio.fx && inp.audio.fx.length) Promise.resolve(KM.afx.ready).then(() => rack.sync(inp.audio.fx));
    if (inp.rt.mm && !inp.rt.mm.linked) linkMM(inp);
    KM.changed('audio');
    return st;
  };

  A.attachTone = function (inp) {
    A.init();
    const osc = ctx.createOscillator(); osc.frequency.value = 1000;
    const g = ctx.createGain(); g.gain.value = dbToGain(-20);
    osc.connect(g); osc.start();
    inp.rt.toneSrc = g;
    A.attach(inp);
  };

  A.detach = function (inp) {
    const st = A.strips.get(inp.id); if (!st) return;
    try { st.src.disconnect(); st.out.disconnect(); } catch (e) {}
    A.strips.delete(inp.id); KM.changed('audio');
  };

  /** terapkan parameter audio input ke node */
  A.apply = function (inp) {
    const st = A.strips.get(inp.id); if (!st) return;
    const a = inp.audio, t = ctx.currentTime;
    st.trim.gain.setTargetAtTime(dbToGain(a.gain || 0), t, 0.02);
    const eqOn = a.eq && a.eq.on;
    st.lo.gain.value = eqOn ? a.eq.low : 0; st.mid.gain.value = eqOn ? a.eq.mid : 0; st.hi.gain.value = eqOn ? a.eq.high : 0;
    const cOn = a.comp && a.comp.on;
    st.comp.threshold.value = a.comp ? a.comp.thr : -24; st.comp.ratio.value = a.comp ? a.comp.ratio : 4;
    st.comp.attack.value = 0.005; st.comp.release.value = 0.15;
    st.compWet.gain.value = cOn ? 1 : 0;
    st.compBypass.gain.value = cOn ? 0 : 1;
    st.delay.delayTime.setTargetAtTime(KM.clamp((a.delay || 0) / 1000, 0, 2), t, 0.01);
    st.pan.pan.setTargetAtTime(KM.clamp(a.pan || 0, -1, 1), t, 0.02);
    st.fader.gain.setTargetAtTime(A.volToGain(a.vol), t, 0.02);
    st.mute.gain.setTargetAtTime(a.mute ? 0 : 1, t, 0.01);
    st.toM.gain.value = a.M ? 1 : 0; st.toA.gain.value = a.A ? 1 : 0; st.toB.gain.value = a.B ? 1 : 0;
    st.toSolo.gain.value = a.solo ? 1 : 0;
    st.hpf.frequency.setTargetAtTime(a.hpf ? (a.hpfFreq || 90) : 10, t, 0.02);
    st.toRv.gain.setTargetAtTime(KM.clamp(a.rv || 0, 0, 1), t, 0.02);
    A.updateSolo();
  };

  A.updateSolo = function () {
    if (!A.monitorSrc) return;
    let any = false; for (const st of A.strips.values()) if (st.inp.audio.solo) any = true;
    A.monitorSrc.gain.value = any ? 0 : 1;
  };

  /** Audio-follow-video (Auto) + noise gate, dijalankan berkala */
  A.updateAuto = function () {
    if (!ctx) return;
    const t = ctx.currentTime;
    // auto-ducking: musik turun otomatis saat mic (pemicu) bersuara
    const dk = KM.settings.duck || {};
    let talk = false;
    if (dk.on) for (const st of A.strips.values()) {
      if (!st.inp.audio.duckTrigger || st.inp.audio.mute) continue;
      const m = A.readMeter(st.meter);
      if (A.toDb(Math.max(m.peakL, m.peakR)) > (dk.thr == null ? -35 : dk.thr)) { talk = true; break; }
    }
    if (talk) A.lastTalk = Date.now();
    const ducking = dk.on && Date.now() - (A.lastTalk || 0) < (dk.hold || 600);
    for (const st of A.strips.values()) {
      const target = ducking && st.inp.audio.ducked ? dbToGain(dk.depth == null ? -15 : dk.depth) : 1;
      if (target !== st.duckVal) { st.duckVal = target; st.duck.gain.setTargetAtTime(target, t, target < 1 ? 0.05 : 0.3); }
    }
    for (const st of A.strips.values()) {
      const inp = st.inp, a = inp.audio;
      let target = 1;
      if (a.auto) target = KM.engine.isLive(inp) ? 1 : 0;
      if (target !== st.liveVal) { st.liveVal = target; st.live.gain.setTargetAtTime(target, t, 0.06); }
      if (a.gate && a.gate.on) {
        st.gateMeter.getFloatTimeDomainData(st.gateBuf);
        let pk = 0; for (let i = 0; i < 512; i++) { const v = Math.abs(st.gateBuf[i]); if (v > pk) pk = v; }
        const open = A.toDb(pk) > a.gate.thr;
        st.gate.gain.setTargetAtTime(open ? 1 : 0, t, open ? 0.005 : 0.08);
      } else if (st.gate.gain.value !== 1) st.gate.gain.value = 1;
    }
  };

  A.set = function (inp, key, val) {
    inp = KM.getInput(inp); if (!inp) return false;
    if (key === 'vol') inp.audio.vol = KM.clamp(+val, 0, 100);
    else if (key === 'mute') inp.audio.mute = val == null ? !inp.audio.mute : !!val;
    else inp.audio[key] = val;
    A.apply(inp); KM.changed('audio');
    return true;
  };

  /** Mix-minus untuk tamu KLM Call: semua audio Master KECUALI suara tamu itu sendiri (tanpa gema) */
  function linkMM(inp) {
    const st = A.strips.get(inp.id), mm = inp.rt.mm;
    if (!st || !mm) return;
    const neg = ctx.createGain(); neg.gain.value = -1;
    st.toM.connect(neg); neg.connect(mm.dest); mm.linked = true;
  }
  A.mixMinus = function (inp) {
    A.init();
    if (!inp.rt.mm) {
      const dest = ctx.createMediaStreamDestination(); dest.channelCount = 2;
      A.mmBus.connect(dest);
      inp.rt.mm = { dest, linked: false };
      linkMM(inp);
    }
    return inp.rt.mm.dest.stream;
  };

  /** stream audio master/bus untuk rekam & streaming */
  A.streamOf = function (bus) { A.init(); return A.busOf(bus || 'M').dest.stream; };
})(window.KM);
