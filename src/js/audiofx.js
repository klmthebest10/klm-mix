/* KLM Mix - Efek & plugin audio
 * Rak efek (insert) di setiap input dan di Master: urutan bebas, bypass, mix wet/dry, preset rantai.
 * 18 plugin bawaan (Web Audio + AudioWorklet DSP) + plugin eksternal:
 *   - file .js (format plugin KLM, boleh memakai AudioWorklet sendiri)
 *   - file impulse response .wav/.flac/.mp3 (reverb ruangan asli, hall, plate, kabinet speaker)
 * Semua berjalan real-time di mesin audio KLM Mix → ikut monitor, rekam, stream, SRT, NDI.
 */
'use strict';
(function (KM) {
  const FX = KM.afx = { defs: {}, external: [], irs: {}, ready: null };
  const dbToGain = (db) => Math.pow(10, db / 20);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (param, v, ctx, tc) => { try { param.setTargetAtTime(v, ctx.currentTime, tc || 0.02); } catch (e) { param.value = v; } };

  // ---------------- DSP AudioWorklet bawaan ----------------
  const WORKLET = `
  const dB = (g) => 20 * Math.log10(Math.max(g, 1e-9));
  const g = (db) => Math.pow(10, db / 20);
  class Gate extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [
      { name: 'thr', defaultValue: -45 }, { name: 'range', defaultValue: -80 }, { name: 'ratio', defaultValue: 100 },
      { name: 'attack', defaultValue: 2 }, { name: 'hold', defaultValue: 80 }, { name: 'release', defaultValue: 150 }]; }
    constructor() { super(); this.env = 0; this.gain = 1; this.holdN = 0; }
    process(ins, outs, p) {
      const i = ins[0], o = outs[0]; if (!i || !i.length) return true;
      const n = i[0].length, sr = sampleRate;
      const thr = p.thr[0], range = p.range[0], ratio = Math.max(1, p.ratio[0]);
      const aC = Math.exp(-1 / (Math.max(0.1, p.attack[0]) * sr / 1000)), rC = Math.exp(-1 / (Math.max(1, p.release[0]) * sr / 1000));
      const holdS = p.hold[0] * sr / 1000, envC = Math.exp(-1 / (0.005 * sr));
      for (let s = 0; s < n; s++) {
        let pk = 0; for (let c = 0; c < i.length; c++) { const v = Math.abs(i[c][s]); if (v > pk) pk = v; }
        this.env = pk > this.env ? pk : this.env * envC + pk * (1 - envC);
        const lv = dB(this.env);
        let target;
        if (lv >= thr) { target = 1; this.holdN = holdS; }
        else if (this.holdN > 0) { this.holdN--; target = 1; }
        else target = g(Math.max(range, (lv - thr) * (ratio - 1)));
        this.gain = target > this.gain ? target + (this.gain - target) * aC : target + (this.gain - target) * rC;
        for (let c = 0; c < o.length; c++) o[c][s] = (i[c] || i[0])[s] * this.gain;
      }
      return true;
    }
  }
  registerProcessor('klm-gate', Gate);
  class DeEsser extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [{ name: 'freq', defaultValue: 6500 }, { name: 'thr', defaultValue: -30 }, { name: 'amount', defaultValue: -10 }]; }
    constructor() { super(); this.lp = [0, 0]; this.env = 0; this.gr = 1; }
    process(ins, outs, p) {
      const i = ins[0], o = outs[0]; if (!i || !i.length) return true;
      const n = i[0].length, a = Math.exp(-2 * Math.PI * p.freq[0] / sampleRate), thr = p.thr[0], maxCut = g(p.amount[0]);
      const envC = Math.exp(-1 / (0.003 * sampleRate)), relC = Math.exp(-1 / (0.06 * sampleRate));
      for (let s = 0; s < n; s++) {
        let hiPk = 0;
        for (let c = 0; c < Math.min(2, i.length); c++) { const x = i[c][s]; this.lp[c] = x * (1 - a) + this.lp[c] * a; const hv = Math.abs(x - this.lp[c]); if (hv > hiPk) hiPk = hv; }
        this.env = hiPk > this.env ? hiPk + (this.env - hiPk) * envC : hiPk + (this.env - hiPk) * relC;
        const over = dB(this.env) - thr;
        const target = over > 0 ? Math.max(maxCut, g(-over)) : 1;
        this.gr = target < this.gr ? target + (this.gr - target) * 0.5 : target + (this.gr - target) * 0.995;
        for (let c = 0; c < o.length; c++) { const ci = Math.min(c, i.length - 1), x = i[ci][s], lo = this.lp[Math.min(ci, 1)]; o[c][s] = lo + (x - lo) * this.gr; }
      }
      return true;
    }
  }
  registerProcessor('klm-deesser', DeEsser);
  class AGC extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [{ name: 'target', defaultValue: -18 }, { name: 'maxGain', defaultValue: 18 }, { name: 'speed', defaultValue: 1 }, { name: 'gateDb', defaultValue: -55 }]; }
    constructor() { super(); this.rms = 1e-4; this.gain = 1; }
    process(ins, outs, p) {
      const i = ins[0], o = outs[0]; if (!i || !i.length) return true;
      const n = i[0].length, sr = sampleRate, sp = Math.max(0.1, p.speed[0]);
      const rC = Math.exp(-1 / (0.3 * sr)), up = Math.exp(-1 / (2.5 / sp * sr)), down = Math.exp(-1 / (0.4 / sp * sr));
      const tgt = p.target[0], maxG = g(p.maxGain[0]), gate = p.gateDb[0];
      for (let s = 0; s < n; s++) {
        let e = 0; for (let c = 0; c < i.length; c++) e += i[c][s] * i[c][s];
        this.rms = this.rms * rC + (e / i.length) * (1 - rC);
        const lv = 10 * Math.log10(Math.max(this.rms, 1e-12));
        let want = lv > gate ? Math.min(maxG, g(tgt - lv)) : this.gain; // diam: jangan naikkan bising
        want = Math.max(0.05, want);
        this.gain = want > this.gain ? want + (this.gain - want) * up : want + (this.gain - want) * down;
        for (let c = 0; c < o.length; c++) { let v = (i[c] || i[0])[s] * this.gain; o[c][s] = v > 1 ? 1 : v < -1 ? -1 : v; }
      }
      return true;
    }
  }
  registerProcessor('klm-agc', AGC);
  class Pitch extends AudioWorkletProcessor {
    static get parameterDescriptors() { return [{ name: 'semi', defaultValue: 0 }]; }
    constructor() { super(); this.N = 4096; this.buf = [new Float32Array(this.N), new Float32Array(this.N)]; this.w = 0; this.ph = 0; this.win = 2048; }
    process(ins, outs, p) {
      const i = ins[0], o = outs[0]; if (!i || !i.length) return true;
      const n = i[0].length, N = this.N, W = this.win, ratio = Math.pow(2, p.semi[0] / 12);
      for (let s = 0; s < n; s++) {
        for (let c = 0; c < 2; c++) this.buf[c][this.w] = (i[c] || i[0])[s];
        this.ph = (this.ph + (1 - ratio) + W) % W;
        const d1 = this.ph, d2 = (this.ph + W / 2) % W;
        const f1 = Math.sin(Math.PI * d1 / W), f2 = Math.sin(Math.PI * d2 / W);
        for (let c = 0; c < o.length; c++) {
          const b = this.buf[Math.min(c, 1)];
          const r = (k) => { const x = (this.w - k + N) % N, x0 = Math.floor(x), fr = x - x0; return b[x0] * (1 - fr) + b[(x0 + 1) % N] * fr; };
          o[c][s] = r(d1) * f1 * f1 + r(d2) * f2 * f2;
        }
        this.w = (this.w + 1) % N;
      }
      return true;
    }
  }
  registerProcessor('klm-pitch', Pitch);
  `;
  const workletDone = new WeakMap();
  FX.addWorklet = function (ctx, code) {
    const key = code || WORKLET;
    let m = workletDone.get(ctx); if (!m) { m = new Map(); workletDone.set(ctx, m); }
    if (!m.has(key)) m.set(key, ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([key], { type: 'text/javascript' }))));
    return m.get(key);
  };
  const W = (ctx, name, params) => { const n = new AudioWorkletNode(ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', parameterData: params || {} }); return n; };
  const wp = (node, k, v, ctx) => { const p = node.parameters.get(k); if (p) smooth(p, v, ctx, 0.01); };

  // ---------------- impulse response sintetis ----------------
  function synthIR(ctx, sec, decay, damp) {
    const sr = ctx.sampleRate, len = Math.max(1, Math.round(sr * sec)), b = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0; const a = Math.exp(-2 * Math.PI * damp / sr);
      for (let i = 0; i < len; i++) { const x = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); lp = x * (1 - a) + lp * a; d[i] = lp; }
    }
    return b;
  }

  // ---------------- katalog plugin bawaan ----------------
  const P = (k, n, min, max, def, step, unit, extra) => Object.assign({ k, n, min, max, def, step: step || 1, unit: unit || '' }, extra || {});
  const def = (d) => { FX.defs[d.id] = d; };

  def({ id: 'eq5', name: 'EQ Parametrik 5-Band', cat: 'EQ & Filter', desc: 'Low shelf, 3 band peaking, high shelf',
    params: [P('lg', 'Low', -15, 15, 0, 0.5, 'dB'), P('lf', 'Low Hz', 40, 400, 100, 5, 'Hz'),
      P('m1g', 'Mid 1', -15, 15, 0, 0.5, 'dB'), P('m1f', 'Mid 1 Hz', 150, 1500, 400, 10, 'Hz'), P('m1q', 'Mid 1 Q', 0.3, 6, 1, 0.1),
      P('m2g', 'Mid 2', -15, 15, 0, 0.5, 'dB'), P('m2f', 'Mid 2 Hz', 800, 6000, 2500, 50, 'Hz'), P('m2q', 'Mid 2 Q', 0.3, 6, 1, 0.1),
      P('m3g', 'Presence', -15, 15, 0, 0.5, 'dB'), P('m3f', 'Presence Hz', 2000, 10000, 5000, 100, 'Hz'),
      P('hg', 'High', -15, 15, 0, 0.5, 'dB'), P('hf', 'High Hz', 4000, 16000, 10000, 100, 'Hz')],
    make(ctx) {
      const b = (t) => { const f = ctx.createBiquadFilter(); f.type = t; return f; };
      const lo = b('lowshelf'), m1 = b('peaking'), m2 = b('peaking'), m3 = b('peaking'), hi = b('highshelf');
      lo.connect(m1); m1.connect(m2); m2.connect(m3); m3.connect(hi);
      m3.Q.value = 0.9;
      const map = { lg: [lo, 'gain'], lf: [lo, 'frequency'], m1g: [m1, 'gain'], m1f: [m1, 'frequency'], m1q: [m1, 'Q'], m2g: [m2, 'gain'], m2f: [m2, 'frequency'], m2q: [m2, 'Q'], m3g: [m3, 'gain'], m3f: [m3, 'frequency'], hg: [hi, 'gain'], hf: [hi, 'frequency'] };
      return { input: lo, output: hi, set(k, v) { const m = map[k]; if (m) smooth(m[0][m[1]], v, ctx); } };
    } });
  def({ id: 'filter', name: 'Filter (HPF/LPF/Band/Notch)', cat: 'EQ & Filter', desc: 'Potong rumble atau desis',
    params: [P('type', 'Jenis', 0, 0, 'highpass', 1, '', { options: [['highpass', 'High-pass (buang dengung bawah)'], ['lowpass', 'Low-pass (buang desis atas)'], ['bandpass', 'Band-pass'], ['notch', 'Notch'], ['allpass', 'All-pass']] }),
      P('freq', 'Frekuensi', 20, 20000, 90, 1, 'Hz', { log: true }), P('q', 'Q / Resonansi', 0.1, 18, 0.7, 0.1), P('slope', 'Kemiringan', 0, 0, '12', 1, '', { options: [['12', '12 dB/oktaf'], ['24', '24 dB/oktaf']] })],
    make(ctx) {
      const a = ctx.createBiquadFilter(), b2 = ctx.createBiquadFilter(), out = ctx.createGain();
      a.connect(b2); b2.connect(out);
      let slope = '12';
      const upd = () => { b2.type = slope === '24' ? a.type : 'allpass'; if (slope !== '24') b2.frequency.value = 1000; };
      return { input: a, output: out, set(k, v) {
        if (k === 'type') { a.type = v; upd(); } else if (k === 'freq') { smooth(a.frequency, v, ctx); if (slope === '24') smooth(b2.frequency, v, ctx); }
        else if (k === 'q') { smooth(a.Q, v, ctx); if (slope === '24') smooth(b2.Q, v, ctx); } else if (k === 'slope') { slope = v; upd(); if (v === '24') { b2.frequency.value = a.frequency.value; b2.Q.value = a.Q.value; } }
      } };
    } });
  def({ id: 'hum', name: 'Penghilang Dengung Listrik', cat: 'EQ & Filter', desc: 'Notch 50/60 Hz + harmonik (dengung kabel/ground)',
    params: [P('base', 'Frekuensi listrik', 0, 0, '50', 1, '', { options: [['50', '50 Hz (Indonesia/PLN)'], ['60', '60 Hz']] }), P('q', 'Ketajaman', 5, 60, 25, 1), P('harm', 'Harmonik', 1, 5, 4, 1)],
    make(ctx) {
      const n = [1, 2, 3, 4, 5].map(() => { const f = ctx.createBiquadFilter(); f.type = 'notch'; return f; });
      for (let i = 0; i < 4; i++) n[i].connect(n[i + 1]);
      let base = 50, harm = 4, q = 25;
      const upd = () => n.forEach((f, i) => { f.frequency.value = i < harm ? base * (i + 1) : 22000; f.Q.value = q; f.type = i < harm ? 'notch' : 'allpass'; });
      upd();
      return { input: n[0], output: n[4], set(k, v) { if (k === 'base') base = +v; if (k === 'q') q = +v; if (k === 'harm') harm = +v; upd(); } };
    } });
  def({ id: 'comp', name: 'Kompresor', cat: 'Dinamika', desc: 'Ratakan volume vokal/musik',
    params: [P('thr', 'Threshold', -60, 0, -20, 0.5, 'dB'), P('ratio', 'Ratio', 1, 20, 4, 0.1, ':1'), P('knee', 'Knee', 0, 30, 6, 1, 'dB'), P('attack', 'Attack', 0.5, 200, 8, 0.5, 'ms'), P('release', 'Release', 20, 1500, 180, 5, 'ms'), P('makeup', 'Makeup', -12, 24, 0, 0.5, 'dB')],
    make(ctx) {
      const c = ctx.createDynamicsCompressor(), mk = ctx.createGain(); c.connect(mk);
      return { input: c, output: mk, set(k, v) {
        if (k === 'thr') smooth(c.threshold, v, ctx); else if (k === 'ratio') smooth(c.ratio, v, ctx); else if (k === 'knee') smooth(c.knee, v, ctx);
        else if (k === 'attack') smooth(c.attack, v / 1000, ctx); else if (k === 'release') smooth(c.release, v / 1000, ctx); else if (k === 'makeup') smooth(mk.gain, dbToGain(v), ctx);
      }, meter: () => c.reduction };
    } });
  def({ id: 'limiter', name: 'Limiter', cat: 'Dinamika', desc: 'Batasi puncak, cegah suara pecah',
    params: [P('drive', 'Input', -6, 18, 0, 0.5, 'dB'), P('ceil', 'Ceiling', -12, 0, -1, 0.1, 'dB'), P('release', 'Release', 10, 1000, 80, 5, 'ms')],
    make(ctx) {
      const pre = ctx.createGain(), c = ctx.createDynamicsCompressor(), post = ctx.createGain();
      c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.001; pre.connect(c); c.connect(post);
      return { input: pre, output: post, set(k, v) { if (k === 'drive') smooth(pre.gain, dbToGain(v), ctx); else if (k === 'ceil') { smooth(c.threshold, v, ctx); } else if (k === 'release') smooth(c.release, v / 1000, ctx); }, meter: () => c.reduction };
    } });
  def({ id: 'gate', name: 'Noise Gate', cat: 'Dinamika', worklet: true, desc: 'Tutup mic saat tidak bicara',
    params: [P('thr', 'Threshold', -80, 0, -45, 0.5, 'dB'), P('range', 'Range', -90, 0, -80, 1, 'dB'), P('attack', 'Attack', 0.1, 50, 2, 0.1, 'ms'), P('hold', 'Hold', 0, 1000, 80, 5, 'ms'), P('release', 'Release', 5, 2000, 150, 5, 'ms')],
    make(ctx) { const n = W(ctx, 'klm-gate'); return { input: n, output: n, set(k, v) { wp(n, k, +v, ctx); } }; } });
  def({ id: 'denoise', name: 'Peredam Bising (Expander)', cat: 'Dinamika', worklet: true, desc: 'Redam bising latar (AC, kipas, keramaian) saat sela bicara',
    params: [P('thr', 'Ambang', -80, -10, -48, 0.5, 'dB'), P('ratio', 'Kekuatan', 1.2, 6, 2.5, 0.1, ':1'), P('range', 'Redam maks', -40, 0, -18, 1, 'dB'), P('hpf', 'Potong bawah', 20, 300, 80, 5, 'Hz'), P('lpf', 'Potong desis', 6000, 20000, 15000, 100, 'Hz')],
    make(ctx) {
      const h = ctx.createBiquadFilter(); h.type = 'highpass'; const l = ctx.createBiquadFilter(); l.type = 'lowpass';
      const n = W(ctx, 'klm-gate', { attack: 5, hold: 120, release: 220 }); h.connect(l); l.connect(n);
      return { input: h, output: n, set(k, v) { if (k === 'hpf') smooth(h.frequency, v, ctx); else if (k === 'lpf') smooth(l.frequency, v, ctx); else wp(n, k, +v, ctx); } };
    } });
  def({ id: 'deesser', name: 'De-esser', cat: 'Dinamika', worklet: true, desc: 'Jinakkan bunyi "sss" yang tajam',
    params: [P('freq', 'Frekuensi', 3000, 10000, 6500, 50, 'Hz'), P('thr', 'Threshold', -60, 0, -30, 0.5, 'dB'), P('amount', 'Redam maks', -24, 0, -10, 0.5, 'dB')],
    make(ctx) { const n = W(ctx, 'klm-deesser'); return { input: n, output: n, set(k, v) { wp(n, k, +v, ctx); } }; } });
  def({ id: 'agc', name: 'Penyeimbang Volume (AGC)', cat: 'Dinamika', worklet: true, desc: 'Suara pelan dinaikkan, keras diturunkan otomatis (ceramah, tamu)',
    params: [P('target', 'Target', -30, -6, -18, 0.5, 'dB'), P('maxGain', 'Penguatan maks', 0, 30, 15, 1, 'dB'), P('speed', 'Kecepatan', 0.2, 4, 1, 0.1, '×'), P('gateDb', 'Abaikan di bawah', -80, -30, -55, 1, 'dB')],
    make(ctx) { const n = W(ctx, 'klm-agc'); return { input: n, output: n, set(k, v) { wp(n, k, +v, ctx); } }; } });
  def({ id: 'reverb', name: 'Reverb', cat: 'Ruang & Waktu', parallel: true, mix: 0.25, desc: 'Gema ruangan / hall / masjid — atau impulse response eksternal',
    params: [P('ir', 'Ruang', 0, 0, 'hall', 1, '', { options: () => [['room', 'Ruang kecil'], ['hall', 'Hall'], ['masjid', 'Masjid / aula besar'], ['plate', 'Plate (vokal)'], ['cathedral', 'Katedral']].concat(Object.keys(FX.irs).map((n) => ['ir:' + n, '📂 ' + n])) }),
      P('decay', 'Panjang', 0.3, 8, 2.2, 0.1, 'dtk'), P('pre', 'Pre-delay', 0, 200, 20, 1, 'ms'), P('damp', 'Redaman tinggi', 1500, 16000, 7000, 100, 'Hz'), P('lowcut', 'Potong bawah', 20, 600, 150, 5, 'Hz')],
    make(ctx) {
      const pre = ctx.createDelay(0.5), lc = ctx.createBiquadFilter(), conv = ctx.createConvolver(), damp = ctx.createBiquadFilter(), out = ctx.createGain();
      lc.type = 'highpass'; damp.type = 'lowpass'; pre.connect(lc); lc.connect(conv); conv.connect(damp); damp.connect(out);
      const S = { ir: 'hall', decay: 2.2 }; let t = null;
      const SHAPE = { room: [0.8, 3.5], hall: [1, 2.6], masjid: [1.6, 2.2], plate: [0.9, 1.8], cathedral: [2.4, 1.9] };
      const build = () => { clearTimeout(t); t = setTimeout(() => {
        if (String(S.ir).startsWith('ir:')) { const b = FX.irs[S.ir.slice(3)]; if (b) conv.buffer = b; return; }
        const sh = SHAPE[S.ir] || SHAPE.hall; conv.buffer = synthIR(ctx, S.decay * sh[0], sh[1], 9000);
      }, 60); };
      build();
      return { input: pre, output: out, set(k, v) {
        if (k === 'ir' || k === 'decay') { S[k] = v; build(); } else if (k === 'pre') smooth(pre.delayTime, v / 1000, ctx); else if (k === 'damp') smooth(damp.frequency, v, ctx); else if (k === 'lowcut') smooth(lc.frequency, v, ctx);
      } };
    } });
  def({ id: 'delay', name: 'Delay / Echo', cat: 'Ruang & Waktu', parallel: true, mix: 0.25, desc: 'Gema berulang, slapback, ping-pong',
    params: [P('time', 'Waktu', 20, 1500, 320, 5, 'ms'), P('fb', 'Feedback', 0, 92, 35, 1, '%'), P('tone', 'Nada', 800, 16000, 5000, 100, 'Hz'), P('pp', 'Ping-pong', 0, 0, '0', 1, '', { options: [['0', 'Mati'], ['1', 'Kiri ↔ Kanan']] })],
    make(ctx) {
      const inp = ctx.createGain(), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2);
      const dL = ctx.createDelay(2), dR = ctx.createDelay(2), fbL = ctx.createGain(), fbR = ctx.createGain(), tL = ctx.createBiquadFilter(), tR = ctx.createBiquadFilter(), out = ctx.createGain();
      tL.type = tR.type = 'lowpass';
      inp.connect(sp); sp.connect(dL, 0); sp.connect(dR, 1);
      dL.connect(tL); dR.connect(tR); tL.connect(mg, 0, 0); tR.connect(mg, 0, 1); mg.connect(out);
      tL.connect(fbL); tR.connect(fbR);
      let pp = false;
      const route = () => { try { fbL.disconnect(); fbR.disconnect(); } catch (e) {} if (pp) { fbL.connect(dR); fbR.connect(dL); } else { fbL.connect(dL); fbR.connect(dR); } };
      route();
      return { input: inp, output: out, set(k, v) {
        if (k === 'time') { smooth(dL.delayTime, v / 1000, ctx, 0.05); smooth(dR.delayTime, v / 1000, ctx, 0.05); }
        else if (k === 'fb') { smooth(fbL.gain, v / 100, ctx); smooth(fbR.gain, v / 100, ctx); } else if (k === 'tone') { smooth(tL.frequency, v, ctx); smooth(tR.frequency, v, ctx); }
        else if (k === 'pp') { pp = v === '1'; route(); }
      } };
    } });
  function modDelay(ctx, base, fbOn) {
    const inp = ctx.createGain(), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), out = ctx.createGain();
    const lfo = ctx.createOscillator(), lfo2 = ctx.createOscillator(), dep = ctx.createGain(), dep2 = ctx.createGain();
    const dL = ctx.createDelay(0.1), dR = ctx.createDelay(0.1), fb = ctx.createGain(), fb2 = ctx.createGain();
    dL.delayTime.value = dR.delayTime.value = base;
    inp.connect(sp); sp.connect(dL, 0); sp.connect(dR, 1); dL.connect(mg, 0, 0); dR.connect(mg, 0, 1); mg.connect(out);
    lfo.connect(dep); dep.connect(dL.delayTime); lfo2.connect(dep2); dep2.connect(dR.delayTime);
    if (fbOn) { dL.connect(fb); fb.connect(dL); dR.connect(fb2); fb2.connect(dR); }
    lfo.start(); lfo2.start(ctx.currentTime + 0.25);
    return { input: inp, output: out, lfo, lfo2, dep, dep2, fb, fb2, dL, dR, destroy() { try { lfo.stop(); lfo2.stop(); } catch (e) {} } };
  }
  def({ id: 'chorus', name: 'Chorus', cat: 'Modulasi', parallel: true, mix: 0.5, desc: 'Suara lebih tebal & lebar',
    params: [P('rate', 'Kecepatan', 0.05, 5, 0.8, 0.05, 'Hz'), P('depth', 'Kedalaman', 0, 10, 3, 0.1, 'ms'), P('delay', 'Delay dasar', 5, 40, 18, 0.5, 'ms')],
    make(ctx) { const m = modDelay(ctx, 0.018, false); return Object.assign(m, { set(k, v) {
      if (k === 'rate') { smooth(m.lfo.frequency, v, ctx); smooth(m.lfo2.frequency, v * 1.07, ctx); } else if (k === 'depth') { smooth(m.dep.gain, v / 1000, ctx); smooth(m.dep2.gain, v / 1000, ctx); }
      else if (k === 'delay') { smooth(m.dL.delayTime, v / 1000, ctx); smooth(m.dR.delayTime, v / 1000, ctx); } } }); } });
  def({ id: 'flanger', name: 'Flanger', cat: 'Modulasi', parallel: true, mix: 0.5, desc: 'Efek "jet" berayun',
    params: [P('rate', 'Kecepatan', 0.05, 3, 0.25, 0.05, 'Hz'), P('depth', 'Kedalaman', 0, 4, 1.5, 0.1, 'ms'), P('fb', 'Feedback', 0, 90, 50, 1, '%')],
    make(ctx) { const m = modDelay(ctx, 0.003, true); return Object.assign(m, { set(k, v) {
      if (k === 'rate') { smooth(m.lfo.frequency, v, ctx); smooth(m.lfo2.frequency, v, ctx); } else if (k === 'depth') { smooth(m.dep.gain, v / 1000, ctx); smooth(m.dep2.gain, v / 1000, ctx); }
      else if (k === 'fb') { smooth(m.fb.gain, v / 100, ctx); smooth(m.fb2.gain, v / 100, ctx); } } }); } });
  def({ id: 'tremolo', name: 'Tremolo / Auto-pan', cat: 'Modulasi', desc: 'Volume atau posisi berayun',
    params: [P('rate', 'Kecepatan', 0.1, 15, 4, 0.1, 'Hz'), P('depth', 'Kedalaman', 0, 100, 50, 1, '%'), P('mode', 'Mode', 0, 0, 'vol', 1, '', { options: [['vol', 'Tremolo (volume)'], ['pan', 'Auto-pan (kiri-kanan)']] })],
    make(ctx) {
      const inp = ctx.createGain(), g = ctx.createGain(), pan = ctx.createStereoPanner(), lfo = ctx.createOscillator(), d = ctx.createGain();
      inp.connect(g); g.connect(pan); lfo.connect(d); lfo.start();
      let mode = 'vol', depth = 0.5;
      const route = () => { try { d.disconnect(); } catch (e) {} if (mode === 'vol') { g.gain.value = 1 - depth / 2; d.gain.value = depth / 2; d.connect(g.gain); pan.pan.value = 0; } else { g.gain.value = 1; d.gain.value = depth; d.connect(pan.pan); } };
      route();
      return { input: inp, output: pan, set(k, v) { if (k === 'rate') smooth(lfo.frequency, v, ctx); else if (k === 'depth') { depth = v / 100; route(); } else if (k === 'mode') { mode = v; route(); } }, destroy() { try { lfo.stop(); } catch (e) {} } };
    } });
  def({ id: 'saturate', name: 'Saturasi / Warm', cat: 'Warna', desc: 'Kehangatan analog, drive hingga distorsi',
    params: [P('drive', 'Drive', 0, 30, 6, 0.5, 'dB'), P('tone', 'Nada', 1000, 18000, 12000, 100, 'Hz'), P('out', 'Output', -24, 6, -3, 0.5, 'dB')],
    make(ctx) {
      const pre = ctx.createGain(), ws = ctx.createWaveShaper(), tone = ctx.createBiquadFilter(), out = ctx.createGain();
      ws.oversample = '4x'; tone.type = 'lowpass'; pre.connect(ws); ws.connect(tone); tone.connect(out);
      const curve = (k) => { const n = 2048, c = new Float32Array(n), d = Math.max(1, k); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * d) / Math.tanh(d); } return c; };
      return { input: pre, output: out, set(k, v) { if (k === 'drive') { ws.curve = curve(dbToGain(v)); } else if (k === 'tone') smooth(tone.frequency, v, ctx); else if (k === 'out') smooth(out.gain, dbToGain(v), ctx); } };
    } });
  def({ id: 'pitch', name: 'Pitch Shift', cat: 'Warna', worklet: true, desc: 'Naik/turunkan nada (efek suara, samaran narasumber)',
    params: [P('semi', 'Nada', -12, 12, 0, 0.5, 'semiton')],
    make(ctx) { const n = W(ctx, 'klm-pitch'); return { input: n, output: n, set(k, v) { wp(n, k, +v, ctx); } }; } });
  def({ id: 'width', name: 'Stereo Width / Mono', cat: 'Utilitas', desc: '0% = mono, 100% = normal, >100% = lebar',
    params: [P('w', 'Lebar', 0, 200, 100, 1, '%'), P('bal', 'Balance', -100, 100, 0, 1, '')],
    make(ctx) {
      const inp = ctx.createGain(), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), pan = ctx.createStereoPanner();
      const LL = ctx.createGain(), LR = ctx.createGain(), RL = ctx.createGain(), RR = ctx.createGain();
      inp.channelCount = 2; inp.channelCountMode = 'explicit'; inp.connect(sp);
      sp.connect(LL, 0); sp.connect(LR, 0); sp.connect(RL, 1); sp.connect(RR, 1);
      LL.connect(mg, 0, 0); RL.connect(mg, 0, 0); RR.connect(mg, 0, 1); LR.connect(mg, 0, 1); mg.connect(pan);
      const upd = (w) => { const a = (1 + w) / 2, b = (1 - w) / 2; smooth(LL.gain, a, ctx); smooth(RR.gain, a, ctx); smooth(RL.gain, b, ctx); smooth(LR.gain, b, ctx); };
      upd(1);
      return { input: inp, output: pan, set(k, v) { if (k === 'w') upd(v / 100); else if (k === 'bal') smooth(pan.pan, v / 100, ctx); } };
    } });
  def({ id: 'gain', name: 'Gain / Phase', cat: 'Utilitas', desc: 'Penguatan & balik fase',
    params: [P('db', 'Gain', -30, 30, 0, 0.5, 'dB'), P('inv', 'Fase', 0, 0, '0', 1, '', { options: [['0', 'Normal'], ['1', 'Dibalik (Ø)']] })],
    make(ctx) { const g = ctx.createGain(); let db = 0, inv = false; const upd = () => smooth(g.gain, dbToGain(db) * (inv ? -1 : 1), ctx); return { input: g, output: g, set(k, v) { if (k === 'db') db = +v; if (k === 'inv') inv = v === '1'; upd(); } }; } });

  // ---------------- preset rantai ----------------
  FX.PRESETS = {
    'Vokal Siaran': [['filter', { type: 'highpass', freq: 85 }], ['denoise', { thr: -50 }], ['eq5', { lg: -2, m1g: -2, m1f: 350, m3g: 3, m3f: 4500, hg: 2 }], ['deesser', {}], ['comp', { thr: -22, ratio: 3.5, makeup: 4 }], ['limiter', { ceil: -1.5 }]],
    'Ceramah / Pengajian': [['filter', { type: 'highpass', freq: 95 }], ['hum', {}], ['denoise', { thr: -46, ratio: 2 }], ['agc', { target: -18 }], ['eq5', { m1g: -2, m1f: 300, m3g: 2.5 }], ['reverb', { ir: 'masjid', decay: 1.6 }, 0.12]],
    'Podcast / Talkshow': [['filter', { type: 'highpass', freq: 80 }], ['gate', { thr: -50 }], ['eq5', { lg: 1.5, m1g: -3, m1f: 400, m3g: 2 }], ['comp', { thr: -24, ratio: 4, makeup: 5 }], ['deesser', {}]],
    'Musik Latar': [['eq5', { m2g: -3, m2f: 2500, m2q: 0.8 }], ['width', { w: 120 }], ['comp', { thr: -18, ratio: 2, makeup: 1 }]],
    'Suara Telepon / Radio': [['filter', { type: 'bandpass', freq: 1500, q: 0.9 }], ['saturate', { drive: 10, tone: 3800 }], ['comp', { thr: -26, ratio: 6, makeup: 6 }]],
    'Qiraah / Adzan (reverb masjid)': [['filter', { type: 'highpass', freq: 70 }], ['comp', { thr: -20, ratio: 2.5, makeup: 3 }], ['eq5', { m3g: 2, hg: 1.5 }], ['reverb', { ir: 'masjid', decay: 3.2, pre: 35 }, 0.3], ['limiter', { ceil: -1 }]],
    'Master Siaran (keras & aman)': [['eq5', { lg: 1, hg: 1 }], ['comp', { thr: -16, ratio: 2, attack: 25, release: 250, makeup: 2 }], ['limiter', { drive: 2, ceil: -1 }]]
  };
  FX.presetNames = () => Object.keys(FX.PRESETS).concat(Object.keys(KM.settings.fxPresets || {}).map((n) => '★ ' + n));
  FX.presetChain = function (name) {
    if (name.startsWith('★ ')) return KM.deepClone((KM.settings.fxPresets || {})[name.slice(2)] || []);
    return (FX.PRESETS[name] || []).map(([type, params, mix]) => FX.newItem(type, params, mix));
  };
  FX.newItem = function (type, params, mix) {
    const d = FX.defs[type]; if (!d) return null;
    const p = {}; d.params.forEach((x) => { p[x.k] = x.def; });
    return { id: 'fx' + Math.random().toString(36).slice(2, 9), type, on: true, mix: mix != null ? mix : (d.mix != null ? d.mix : 1), params: Object.assign(p, params || {}) };
  };

  // ---------------- rak efek (dipasang di strip / master) ----------------
  FX.rack = function (ctx) {
    const input = ctx.createGain(), output = ctx.createGain();
    input.connect(output);
    const R = { input, output, inst: new Map(), order: [], ctx };
    function wrap(item) {
      const d = FX.defs[item.type]; if (!d) return null;
      let core; try { core = d.make(ctx, item.params, item); } catch (e) { console.warn('fx', item.type, e); return null; }
      const win = ctx.createGain(), wet = ctx.createGain(), dry = ctx.createGain(), out = ctx.createGain();
      win.connect(core.input); core.output.connect(wet); wet.connect(out); win.connect(dry); dry.connect(out);
      const w = { item, d, core, input: win, output: out, wet, dry };
      w.mix = () => { const it = w.item, on = it.on !== false, m = clamp(+it.mix, 0, 1);
        if (d.selfMix) { core.setMix && core.setMix(m); smooth(wet.gain, on ? 1 : 0, ctx, 0.015); smooth(dry.gain, on ? 0 : 1, ctx, 0.015); return; } // plugin mencampur sendiri (suara kering ikut ditunda)
        smooth(wet.gain, on ? (d.parallel ? m : m) : 0, ctx, 0.015); smooth(dry.gain, on ? (d.parallel ? 1 : 1 - m) : 1, ctx, 0.015); };
      Object.keys(item.params || {}).forEach((k) => { try { core.set(k, item.params[k]); } catch (e) {} });
      w.mix();
      return w;
    }
    function relink() {
      try { input.disconnect(); } catch (e) {}
      let prev = input;
      for (const id of R.order) { const w = R.inst.get(id); if (!w) continue; try { w.output.disconnect(); } catch (e) {} prev.connect(w.input); prev = w.output; }
      prev.connect(output);
    }
    /** samakan rak dengan daftar item (hanya yang berubah yang dibuat ulang) */
    R.sync = async function (list) {
      list = (list || []).filter((x) => x && FX.defs[x.type]);
      if (list.some((x) => FX.defs[x.type].worklet || FX.defs[x.type].external)) { try { await FX.addWorklet(ctx); } catch (e) { console.warn('worklet', e); } }
      for (const x of list) { const d = FX.defs[x.type]; if (d.ensure) { try { await d.ensure(ctx); } catch (e) { console.warn('fx ensure', e); } } }
      const keep = new Set(list.map((x) => x.id));
      for (const [id, w] of R.inst) if (!keep.has(id) || w.item.type !== (list.find((x) => x.id === id) || {}).type) { try { w.output.disconnect(); w.input.disconnect(); w.core.destroy && w.core.destroy(); } catch (e) {} R.inst.delete(id); }
      for (const x of list) {
        let w = R.inst.get(x.id);
        if (!w) { w = wrap(x); if (w) R.inst.set(x.id, w); }
        else { w.item = x; if (w.core.setItem) w.core.setItem(x); Object.keys(x.params || {}).forEach((k) => { try { w.core.set(k, x.params[k]); } catch (e) {} }); w.mix(); }
      }
      R.order = list.map((x) => x.id);
      relink();
    };
    R.set = (item, k, v) => { const w = R.inst.get(item.id); item.params[k] = v; if (w) { try { w.core.set(k, v); } catch (e) {} } };
    R.mix = (item) => { const w = R.inst.get(item.id); if (w) { w.item = item; w.mix(); } };
    R.meter = (item) => { const w = R.inst.get(item.id); return w && w.core.meter ? w.core.meter() : null; };
    return R;
  };

  // ---------------- plugin eksternal ----------------
  async function decodeIR(name, buf) {
    const ctx = KM.audio.ctx || (KM.audio.init(), KM.audio.ctx);
    const ab = await ctx.decodeAudioData(buf.slice ? buf.slice(0) : buf);
    FX.irs[name] = ab; return ab;
  }
  async function loadJsPlugin(name, code) {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const mod = await import(url);
    const p = mod.default || mod.plugin;
    if (!p || !p.id || typeof p.create !== 'function') throw new Error('Bukan plugin KLM (butuh export default { id, name, params, create })');
    const id = 'ext:' + p.id;
    FX.defs[id] = {
      id, name: p.name || p.id, cat: 'Plugin Eksternal', external: true, desc: (p.desc || '') + (p.author ? ' — ' + p.author : ''), file: name,
      parallel: !!p.parallel, mix: p.mix,
      params: (p.params || []).map((x) => Object.assign({ step: 1, unit: '' }, x, { def: x.def != null ? x.def : x.default })),
      ensure: p.worklet ? (ctx) => FX.addWorklet(ctx, p.worklet) : null,
      make(ctx, params) {
        const helpers = { dbToGain, smooth: (pr, v) => smooth(pr, v, ctx), worklet: (n, opt) => new AudioWorkletNode(ctx, n, Object.assign({ outputChannelCount: [2] }, opt || {})), irs: FX.irs };
        const r = p.create(ctx, params, helpers);
        if (!r || !r.input || !r.output) throw new Error('create() harus mengembalikan { input, output, set }');
        if (!r.set) r.set = () => {};
        return r;
      }
    };
    return FX.defs[id];
  }
  /** muat semua plugin dari folder plugin (PC) — dipanggil saat aplikasi dibuka */
  FX.loadAll = async function () {
    FX.external = [];
    if (!(KM.isElectron && window.klm && window.klm.invoke)) return FX.external;
    let files = [];
    try { files = await window.klm.invoke('fx:list'); } catch (e) { return FX.external; }
    for (const f of files) {
      try {
        if (f.kind === 'ir') { const buf = await window.klm.invoke('fx:read', f.path, 'bin'); await decodeIR(f.name.replace(/\.[^.]+$/, ''), buf); FX.external.push({ name: f.name, kind: 'ir', ok: true }); }
        else if (f.kind === 'js') { const code = await window.klm.invoke('fx:read', f.path, 'text'); const d = await loadJsPlugin(f.name, code); FX.external.push({ name: f.name, kind: 'js', ok: true, title: d.name }); }
      } catch (e) { FX.external.push({ name: f.name, kind: f.kind, ok: false, err: e.message }); console.warn('plugin', f.name, e); }
    }
    KM.changed('fx');
    return FX.external;
  };
  // ---------------- plugin audio yang terpasang di PC (VST3 / VST2 / CLAP) ----------------
  FX.pc = null; // hasil pindai terakhir
  FX.scanPC = async function () {
    if (!(KM.isElectron && window.klm && window.klm.invoke)) throw new Error('Pindai plugin hanya di versi PC (.exe)');
    FX.pc = await window.klm.invoke('fx:scan-pc', KM.settings.vstFolders || []);
    return FX.pc;
  };
  // padanan efek bawaan untuk plugin yang terdeteksi (berdasarkan kategori & nama)
  FX.equivalent = function (pl) {
    const n = (pl.name + ' ' + (pl.sub || '')).toLowerCase();
    const by = [[/de-?ess/, 'deesser'], [/gate/, 'gate'], [/limit|maximi|clip|loud|master/, 'limiter'], [/hum/, 'hum'], [/noise|denois|restor|clean/, 'denoise'], [/flang/, 'flanger'], [/trem|pan/, 'tremolo'], [/chorus|phase|modul/, 'chorus'],
      [/pitch|tune|harmon|voice|vocal/, 'pitch'], [/delay|echo/, 'delay'], [/verb|room|hall|plate|space|convol/, 'reverb'], [/eq|equali|filter|tone/, 'eq5'], [/comp|dynam|level|kotelnikov|1176|la-?2a|pro-c/, 'comp'], [/sat|dist|drive|tape|warm|tube/, 'saturate'], [/width|stereo|imag/, 'width']];
    for (const [re, id] of by) if (re.test(n) && FX.defs[id]) return id;
    return { EQ: 'eq5', Dinamika: 'comp', Reverb: 'reverb', Delay: 'delay', 'Vokal/Pitch': 'pitch', Restorasi: 'denoise', Modulasi: 'chorus', Saturasi: 'saturate', 'Mastering/Meter': 'limiter' }[pl.cat] || null;
  };

  /** pasang plugin dari file yang dipilih pengguna (.js plugin / .wav IR) */
  FX.importFiles = async function (files) {
    const out = [];
    for (const file of files) {
      const isIR = /\.(wav|flac|mp3|ogg|aiff?)$/i.test(file.name), isJS = /\.m?js$/i.test(file.name);
      if (!isIR && !isJS) { out.push(file.name + ': format tidak didukung'); continue; }
      try {
        if (isIR) await decodeIR(file.name.replace(/\.[^.]+$/, ''), await file.arrayBuffer());
        else await loadJsPlugin(file.name, await file.text());
        if (KM.isElectron && window.klm) await window.klm.invoke('fx:save', file.name, isIR ? await file.arrayBuffer() : await file.text());
        FX.external.push({ name: file.name, kind: isIR ? 'ir' : 'js', ok: true });
        out.push('✓ ' + file.name);
      } catch (e) { out.push(file.name + ': ' + e.message); }
    }
    KM.changed('fx');
    return out;
  };

  // ---------------- editor rak (dialog) ----------------
  FX.open = function (target) {
    const h = KM.h, UI = KM.ui;
    const isMaster = target === 'master';
    const inp = isMaster ? null : target;
    const list = () => (isMaster ? (KM.settings.masterFx || (KM.settings.masterFx = [])) : (inp.audio.fx || (inp.audio.fx = [])));
    const rack = () => (isMaster ? KM.audio.masterRack : (KM.audio.strips.get(inp.id) || {}).rack);
    const commit = async () => { const r = rack(); if (r) await r.sync(list()); if (isMaster) KM.saveSettings(); KM.changed('audio'); };
    const body = h('div');
    const open = new Set();
    const fmt = (p, v) => (p.options ? '' : (Math.abs(v) >= 100 || p.step >= 1 ? Math.round(v) : (+v).toFixed(p.step < 0.1 ? 2 : 1)) + (p.unit ? ' ' + p.unit : ''));
    function paramRow(item, p) {
      const v = item.params[p.k] != null ? item.params[p.k] : p.def;
      if (p.options) {
        const opts = typeof p.options === 'function' ? p.options() : p.options;
        return [h('label', p.n), h('select', { onchange: (e) => { rack() && rack().set(item, p.k, e.target.value); item.params[p.k] = e.target.value; save(); } }, opts.map(([k, l]) => h('option', { value: k, selected: String(k) === String(v) }, l))), h('span')];
      }
      const out = h('output', fmt(p, v));
      const toR = (x) => (p.log ? Math.log(x / p.min) / Math.log(p.max / p.min) * 1000 : x);
      const fromR = (r) => (p.log ? Math.round(p.min * Math.pow(p.max / p.min, r / 1000)) : +r);
      const rng = h('input', { type: 'range', min: p.log ? 0 : p.min, max: p.log ? 1000 : p.max, step: p.log ? 1 : p.step, value: toR(v),
        oninput: (e) => { const x = fromR(e.target.value); rack() ? rack().set(item, p.k, x) : (item.params[p.k] = x); item.params[p.k] = x; out.textContent = fmt(p, x); },
        onchange: save, ondblclick: () => { rack() && rack().set(item, p.k, p.def); item.params[p.k] = p.def; rng.value = toR(p.def); out.textContent = fmt(p, p.def); save(); }, title: 'Dobel klik: kembali ke ' + p.def });
      return [h('label', p.n), rng, out];
    }
    // ---- panel plugin VST asli: info, editor, parameter generik ----
    const vparams = new Map(); // item.id -> daftar parameter terakhir
    function vstPanel(item, vi) {
      const ok = vi && vi.status === 'ok', inf = ok ? vi.info : null;
      const lat = inf ? Math.round(((inf.latency || 0) + KM.vst.B * ((KM.settings.vstBlocks | 0) || 4)) / (vi.ctx.sampleRate / 1000)) : 0;
      const line = !vi ? 'Rak ini belum aktif (input belum punya jalur audio).' : ok ? [inf.name, inf.vendor, inf.format, inf.params + ' parameter', 'latensi ±' + lat + ' ms'].filter(Boolean).join(' • ')
        : vi.status === 'loading' ? 'Memuat plugin…' : 'Gagal: ' + vi.error;
      const plist = vparams.get(item.id);
      const loadParams = async () => { try { vparams.set(item.id, (await KM.vst.params(vi)) || []); } catch (e) { vparams.set(item.id, []); } draw(); };
      let refreshT = 0;
      const rows = plist ? plist.slice(0, 160).map((p) => {
        const out = h('output', p.text ? p.text + (p.unit ? ' ' + p.unit : '') : (+p.v).toFixed(2));
        const rng = h('input', { type: 'range', min: 0, max: 1000, step: p.steps > 0 ? 1000 / p.steps : 1, value: Math.round(p.v * 1000),
          oninput: (e) => { p.v = e.target.value / 1000; out.textContent = p.v.toFixed(2); KM.vst.setParam(vi, p.id, p.v); clearTimeout(refreshT); refreshT = setTimeout(async () => { const l = await KM.vst.params(vi).catch(() => null); const q = l && l.find((x) => x.id === p.id); if (q && q.text) out.textContent = q.text + (q.unit ? ' ' + q.unit : ''); }, 180); },
          ondblclick: () => { if (p.def == null) return; p.v = p.def; rng.value = Math.round(p.def * 1000); KM.vst.setParam(vi, p.id, p.def); }, title: 'Dobel klik: nilai bawaan' });
        return [h('label', { title: p.name }, p.name), rng, out];
      }) : [];
      return h('div.fxp.vstp',
        h('p.muted', line),
        h('div.row',
          h('button.btn.sm', { disabled: !ok || !inf.editor, onclick: () => KM.vst.editor(vi, 1) }, KI.el('sliders'), 'Buka editor plugin'),
          h('button.btn.sm', { disabled: !ok, onclick: loadParams }, KI.el('list'), plist ? 'Segarkan parameter' : 'Tampilkan parameter'),
          h('button.btn.sm', { disabled: !vi, onclick: () => KM.vst.reload(vi), title: 'Matikan lalu jalankan ulang plugin (state tersimpan dipulihkan)' }, KI.el('refresh'), 'Muat ulang'),
          item.state ? h('span.muted', { style: { fontSize: '11px' } }, 'state tersimpan ' + Math.round(item.state.length * 0.75 / 1024 * 10) / 10 + ' KB') : null),
        plist ? (rows.length ? h('div.kv.vstpar', ...rows.flat()) : h('p.muted', 'Plugin tidak membuka parameter otomasi.')) : null,
        plist && plist.length > 160 ? h('p.muted', 'Menampilkan 160 dari ' + plist.length + ' parameter — selebihnya lewat editor plugin.') : null,
        h('p.muted', { style: { fontSize: '11px', wordBreak: 'break-all' } }, item.params.path));
    }
    if (KM.vst && KM.vst.onChange) { const off = KM.vst.onChange(() => { if (!body.isConnected) return off(); draw(); }); }
    let saveT = null;
    const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { if (isMaster) KM.saveSettings(); KM.changed('audio'); }, 300); };
    function draw() {
      const L = list();
      const items = L.map((item, i) => {
        const d = FX.defs[item.type];
        if (!d) return h('div.fxi.miss', h('div.fxh', h('b', '⚠ ' + item.type), h('span.muted', 'Plugin tidak terpasang'), h('span.grow'), h('button.cb.del', { onclick: () => { L.splice(i, 1); commit(); draw(); } }, KI.el('x'))));
        const expanded = open.has(item.id);
        const mixOut = h('output', Math.round(item.mix * 100) + '%');
        const isV = item.type === 'vst', rw = isV && rack() && rack().inst.get(item.id), vi = rw && rw.core.vst;
        const vStat = isV ? (!vi ? ['', 'tidak aktif'] : vi.status === 'ok' ? ['.ok', 'aktif'] : vi.status === 'loading' ? ['', 'memuat…'] : ['.red', vi.status === 'crash' ? 'berhenti' : 'gagal']) : null;
        return h('div.fxi' + (item.on === false ? '.off' : ''),
          h('div.fxh',
            h('input', { type: 'checkbox', checked: item.on !== false, title: 'Aktif / bypass', onchange: (e) => { item.on = e.target.checked; rack() && rack().mix(item); save(); draw(); } }),
            h('button.fxn', { onclick: () => { expanded ? open.delete(item.id) : open.add(item.id); draw(); }, title: isV ? item.params.path : d.desc || '' }, KI.el(expanded ? 'chev-down' : 'chev-right'), h('b', isV ? item.params.name : d.name), item.alias ? h('span.pill', { title: 'Padanan bawaan untuk plugin PC ' + item.alias }, '≈ ' + item.alias) : null,
              isV ? h('span.pill.fmt', item.params.format) : null, isV ? h('span.pill' + vStat[0], { title: (vi && vi.error) || '' }, vStat[1]) : h('span.muted', d.cat)),
            h('span.grow'),
            isV ? h('button.btn.sm' + (vi && vi.editor ? '.on' : ''), { disabled: !vi || vi.status === 'error' || vi.status === 'crash' || (vi.info && vi.info.ok && !vi.info.editor), title: vi && vi.info && vi.info.ok && !vi.info.editor ? 'Plugin ini tidak punya tampilan editor — pakai daftar parameter' : 'Buka/tutup tampilan plugin', onclick: () => KM.vst.editor(vi, 2) }, KI.el('sliders'), 'Editor') : null,
            isV && vi && (vi.status === 'crash' || vi.status === 'error') ? h('button.btn.sm', { title: 'Jalankan ulang plugin', onclick: () => KM.vst.reload(vi) }, KI.el('refresh'), 'Muat ulang') : null,
            h('span.fxmix', 'Mix', h('input', { type: 'range', min: 0, max: 100, value: Math.round(item.mix * 100), oninput: (e) => { item.mix = e.target.value / 100; mixOut.textContent = e.target.value + '%'; rack() && rack().mix(item); }, onchange: save }), mixOut),
            h('button.cb', { title: 'Naik', disabled: i === 0, onclick: () => { L.splice(i - 1, 0, L.splice(i, 1)[0]); commit(); draw(); } }, KI.el('chev-up')),
            h('button.cb', { title: 'Turun', disabled: i === L.length - 1, onclick: () => { L.splice(i + 1, 0, L.splice(i, 1)[0]); commit(); draw(); } }, KI.el('chev-down')),
            h('button.cb.del', { title: 'Hapus efek', onclick: () => { L.splice(i, 1); open.delete(item.id); commit(); draw(); } }, KI.el('trash'))),
          expanded ? (isV ? vstPanel(item, vi) : h('div.kv.fxp', ...d.params.flatMap((p) => paramRow(item, p)))) : null);
      });
      const cats = {};
      Object.values(FX.defs).forEach((d) => { if (!d.hidden) (cats[d.cat] = cats[d.cat] || []).push(d); });
      const addSel = h('select', { style: { flex: 1 } }, h('option', { value: '' }, '＋ Tambah efek / plugin…'),
        Object.keys(cats).map((c) => h('optgroup', { label: c }, cats[c].map((d) => h('option', { value: d.id }, d.name)))));
      addSel.onchange = async () => { if (!addSel.value) return; const it = FX.newItem(addSel.value); L.push(it); open.add(it.id); await commit(); draw(); };
      const preSel = h('select', { style: { width: '220px' } }, h('option', { value: '' }, 'Preset rantai…'), FX.presetNames().map((n) => h('option', { value: n }, n)));
      preSel.onchange = async () => { if (!preSel.value) return; if (L.length && !(await UI.confirm('Ganti rantai efek dengan preset "' + preSel.value + '"?', 'Ganti'))) { preSel.value = ''; return; } L.splice(0, L.length, ...FX.presetChain(preSel.value)); await commit(); draw(); };
      body.replaceChildren(
        h('div.row', addSel, preSel,
          h('button.btn', { title: 'Simpan rantai ini sebagai preset sendiri', onclick: async () => { const n = await UI.prompt('Nama preset', ''); if (!n) return; KM.settings.fxPresets = Object.assign({}, KM.settings.fxPresets, { [n]: KM.deepClone(L) }); KM.saveSettings(); draw(); KM.toast('Preset efek disimpan: ' + n, 'ok'); } }, KI.el('save'), 'Simpan preset'),
          h('button.btn', { title: 'Matikan semua efek (bypass)', onclick: () => { const on = !L.every((x) => x.on === false); L.forEach((x) => { x.on = !on; rack() && rack().mix(x); }); save(); draw(); } }, KI.el('power'), 'Bypass semua')),
        h('div.fxlist', items.length ? items : h('div.fxempty', KI.el('sliders'), h('b', 'Belum ada efek'), h('span', 'Pilih efek di atas atau pakai preset rantai — mis. "Vokal Siaran" atau "Ceramah / Pengajian".'))),
        h('div.sec', { style: { marginTop: '12px' } }, h('h4', KI.el('download'), 'Plugin eksternal'),
          h('div.row',
            h('button.btn', { onclick: () => { const f = h('input', { type: 'file', multiple: true, accept: '.js,.mjs,.wav,.flac,.mp3,.ogg,.aif,.aiff' }); f.onchange = async () => { const r = await FX.importFiles([...f.files]); KM.toast(r.join(' • '), 'ok', 6000); draw(); }; f.click(); } }, KI.el('upload'), 'Pasang plugin / IR…'),
            KM.isElectron ? h('button.btn', { onclick: () => window.klm.invoke('fx:open-folder') }, KI.el('folder-open'), 'Folder plugin') : null,
            KM.isElectron ? h('button.btn', { onclick: async () => { await FX.loadAll(); draw(); KM.toast('Plugin dimuat ulang: ' + FX.external.filter((x) => x.ok).length + ' berhasil', 'ok'); } }, KI.el('refresh'), 'Muat ulang') : null),
          h('p.muted', 'Format: plugin KLM (.js — Web Audio/AudioWorklet, lihat docs/PLUGIN-AUDIO.md) dan impulse response (.wav) untuk reverb ruangan asli, hall, plate, atau kabinet speaker. Plugin VST3/VST2 yang terpasang di PC dipasang dari bagian di bawah.'),
          FX.external.length ? h('div.list', FX.external.map((x) => h('div.li', KI.el(x.kind === 'ir' ? 'activity' : 'zap'), h('span.grow', (x.title || x.name) + (x.kind === 'ir' ? ' (impulse response)' : '')), h('span.pill' + (x.ok ? '.ok' : '.red'), x.ok ? 'terpasang' : 'gagal: ' + x.err)))) : null),
        pcSection());
    }
    // ---- plugin VST/CLAP yang terpasang di PC ----
    let pcFilter = '', scanning = false;
    function pcSection() {
      const pc = FX.pc;
      const head = h('div.row',
        h('button.btn' + (pc ? '' : '.pri'), { disabled: scanning || !KM.isElectron, onclick: async () => { scanning = true; draw(); try { await FX.scanPC(); } catch (e) { KM.toast(e.message, 'warn'); } scanning = false; draw(); } }, KI.el('search'), scanning ? 'Memindai…' : pc ? 'Pindai ulang' : 'Pindai PC'),
        h('button.btn', { title: 'Tambah folder plugin lain untuk dipindai', disabled: !KM.isElectron, onclick: async () => { const d = await window.klm.invoke('dialog:folder'); if (d) { KM.settings.vstFolders = [...new Set([...(KM.settings.vstFolders || []), d])]; KM.saveSettings(); scanning = true; draw(); try { await FX.scanPC(); } catch (e) {} scanning = false; draw(); } } }, KI.el('folder-open'), 'Folder lain…'),
        pc && pc.plugins.length ? h('input', { placeholder: 'Cari plugin…', value: pcFilter, style: { flex: 1, minWidth: '120px' }, oninput: (e) => { pcFilter = e.target.value.toLowerCase(); const l = body.querySelector('.pclist'); if (l) l.replaceWith(pcList()); } }) : null);
      const info = !KM.isElectron ? h('p.muted', 'Pindai plugin PC hanya di versi PC (.exe).')
        : !pc ? h('p.muted', 'Cari plugin audio VST3, VST2 & CLAP yang sudah terpasang di PC (folder standar Windows + folder tambahan).')
        : h('p.muted', pc.plugins.length + ' plugin ditemukan di ' + pc.folders.length + ' folder' + (pc.hosts.length ? ' • terpasang: ' + pc.hosts.join(', ') : '') + '.');
      function pcList() {
        const L = list();
        const rows = (pc ? pc.plugins : []).filter((x) => !pcFilter || (x.name + ' ' + x.vendor + ' ' + x.cat + ' ' + x.format).toLowerCase().includes(pcFilter));
        return h('div.pclist', rows.slice(0, 400).map((x) => {
          const eq = FX.equivalent(x), d = eq && FX.defs[eq];
          const can = KM.vst && KM.vst.supports(x);
          const inst = can ? h('button.btn.sm.pri', { title: 'Pasang plugin ' + x.format + ' asli ke rak ini (tampilan plugin langsung dibuka)', onclick: async () => {
            const it = KM.vst.newItem(x); L.push(it); open.add(it.id); await commit(); draw();
            const w = rack() && rack().inst.get(it.id); if (w && w.core.vst) KM.vst.editor(w.core.vst, 1);
            KM.toast('Plugin dipasang: ' + x.name, 'ok'); } }, KI.el('plus'), 'Pasang') : null;
          const why = !can && KM.vst && KM.vst.ok ? (x.format === 'CLAP' ? 'CLAP belum didukung' : x.x86 ? '32-bit (tidak didukung)' : x.cat === 'Instrumen' ? 'instrumen (butuh MIDI)' : '') : '';
          return h('div.pcr', h('span.pill.fmt', x.format), h('div.pcn', h('b', x.name), h('small', [x.vendor, x.version, x.cat, why].filter(Boolean).join(' • '))), inst,
            d ? h('button.btn.sm', { title: 'Tambahkan efek bawaan yang setara ke rak ini (' + d.name + ')', onclick: async () => { const it = FX.newItem(eq); it.alias = x.name; L.push(it); open.add(it.id); await commit(); draw(); KM.toast('Ditambahkan: ' + d.name + ' (padanan ' + x.name + ')', 'ok'); } }, KI.el('plus'), d.name.split(' (')[0])
              : can ? null : h('span.muted', x.cat === 'Instrumen' ? 'instrumen' : '—'));
        }));
      }
      return h('div.sec', { style: { marginTop: '12px' } }, h('h4', KI.el('search'), 'Plugin terpasang di PC (VST3 / VST2 / CLAP)'), head, info,
        pc && pc.plugins.length ? pcList() : null,
        pc ? h('p.muted', { style: { fontSize: '11.5px' } }, KM.vst && KM.vst.ok
          ? '"Pasang" menjalankan plugin VST3/VST2 aslinya di dalam KLM Mix (proses terpisah — bila plugin crash, suara asli tetap mengalir; pengaturan plugin ikut tersimpan di preset). Tombol nama efek memasang padanan bawaan KLM Mix (tanda ≈).'
          : 'Tombol ＋ memasang efek bawaan KLM Mix yang setara (diberi tanda ≈ nama plugin). Host VST asli hanya tersedia di versi PC (.exe) Windows.') : null);
    }
    if (KM.vst && KM.isElectron && !KM.vst.ok) KM.vst.ready().then((ok) => { if (ok && body.isConnected) draw(); });
    if (KM.isElectron && !FX.pc && !FX._autoScan) { FX._autoScan = true; FX.scanPC().then(() => draw()).catch(() => {}); }
    draw();
    UI.modal('🎚 Efek audio — ' + (isMaster ? 'Master' : (KM.inputNum(inp) + '. ' + inp.title)), body, [{ label: 'Selesai', cls: 'pri' }], 'wide');
  };
})(window.KM);
