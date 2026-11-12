/* KLM Mix - host plugin VST asli (VST3 & VST2, versi PC).
 * Setiap plugin berjalan di proses helper terpisah (klm-vsthost.exe) — bila plugin crash, KLM Mix tetap jalan
 * dan suara asli diteruskan. Audio: AudioWorklet 'klm-vst' <-MessagePort-> broker <-pipe-> helper, latensi tetap
 * (blok 256 sampel × 4 ≈ 21 ms @48 kHz); suara kering ikut ditunda agar Mix tidak "comb". */
'use strict';
(function (KM) {
  const V = KM.vst = { ok: false, path: '', insts: new Map(), B: 256 };
  const FX = KM.afx;
  if (!FX) return;

  const CODE = `
  class KlmVst extends AudioWorkletProcessor {
    constructor(o) {
      super();
      const p = (o && o.processorOptions) || {};
      this.B = p.B || 256; this.L = Math.max(1, p.L || 4); this.D = this.B * this.L;
      this.acc = [new Float32Array(this.B), new Float32Array(this.B)]; this.accN = 0; this.seq = 0; this.T = 0;
      this.dry = new Map(); this.wet = new Map(); this.mix = p.mix != null ? p.mix : 1;
      this.link = null; this.under = 0; this.got = 0; this.lastRep = 0; this.warm = false; this.streak = 0; this.Lmax = p.Lmax || 12;
      this.port.onmessage = (e) => {
        const d = e.data || {};
        if (d.port) { if (this.link) try { this.link.close(); } catch (x) {} this.link = d.port; this.wet.clear(); this.warm = false; this.link.onmessage = (ev) => { const m = ev.data; if (m && m.t === 'a') { let w = m.data; if (!(w instanceof Float32Array)) w = ArrayBuffer.isView(w) ? new Float32Array(w.buffer.slice(w.byteOffset, w.byteOffset + w.byteLength)) : new Float32Array(w); this.wet.set(m.seq, w); this.got++; this.warm = true; } }; }
        if (d.mix != null) this.mix = d.mix;
        if (d.close) { if (this.link) try { this.link.close(); } catch (x) {} this.link = null; this.dead = true; }
      };
    }
    process(inputs, outputs) {
      const inp = inputs[0] || [], out = outputs[0], n = out[0].length, B = this.B;
      const i0 = inp[0], i1 = inp[1] || inp[0];
      if (i0) { this.acc[0].set(i0, this.accN); this.acc[1].set(i1, this.accN); } else { this.acc[0].fill(0, this.accN, this.accN + n); this.acc[1].fill(0, this.accN, this.accN + n); }
      const P = this.T - this.D;
      if (P < 0) { for (const o of out) o.fill(0); }
      else {
        const k = Math.floor(P / B), off = P - k * B, w = this.wet.get(k), dr = this.dry.get(k), m = this.mix, dm = 1 - m;
        for (let c = 0; c < out.length; c++) {
          const o = out[c], cc = c > 1 ? 1 : c;
          if (!dr) { o.fill(0); continue; }
          const db = cc * B + off;
          if (w && w.length >= 2 * B) { const wb = cc * B + off; for (let i = 0; i < n; i++) o[i] = w[wb + i] * m + dr[db + i] * dm; }
          else if (w && w.length >= B) { for (let i = 0; i < n; i++) o[i] = w[off + i] * m + dr[db + i] * dm; }
          else for (let i = 0; i < n; i++) o[i] = dr[db + i];
        }
        // latensi adaptif: bila blok olahan terlambat (PC sibuk), tambah tunda 1 blok (sekali tersendat, lalu stabil)
        if (!w && this.link && this.warm) { this.under++; if (++this.streak >= 2 && this.L < this.Lmax) { this.L++; this.D = B * this.L; this.streak = 0; } } else if (w) this.streak = 0;
        if (off + n >= B) { const old = k - 16; this.wet.delete(old); this.dry.delete(old); if (this.wet.size > 64 || this.dry.size > 64) { for (const key of this.wet.keys()) if (key < old) this.wet.delete(key); for (const key of this.dry.keys()) if (key < old) this.dry.delete(key); } }
      }
      this.accN += n; this.T += n;
      if (this.accN >= B) {
        const blk = new Float32Array(2 * B); blk.set(this.acc[0], 0); blk.set(this.acc[1], B);
        this.dry.set(this.seq, blk);
        if (this.link) try { this.link.postMessage({ t: 'p', seq: this.seq, n: B, ch: 2, data: blk }); } catch (x) {}
        this.seq++; this.accN = 0;
      }
      if (currentTime - this.lastRep > 2) { this.lastRep = currentTime; this.port.postMessage({ stat: { under: this.under, got: this.got, L: this.L } }); }
      return !this.dead;
    }
  }
  registerProcessor('klm-vst', KlmVst);`;

  // port dari proses utama (lewat preload) → AudioWorklet yang menunggu
  const waitingPorts = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.klmVstPort || !e.ports || !e.ports[0]) return;
    const inst = V.insts.get(e.data.klmVstPort);
    if (inst && inst.node) inst.node.port.postMessage({ port: e.ports[0] }, [e.ports[0]]);
    else waitingPorts.set(e.data.klmVstPort, e.ports[0]);
  });

  const inv = (ch, ...a) => window.klm.invoke(ch, ...a);
  const label = (it) => (it && it.params && it.params.name) || 'Plugin VST';
  const listeners = new Set();
  const notify = () => { listeners.forEach((f) => { try { f(); } catch (e) {} }); };
  V.onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

  function saveOwner(item) {
    // simpan ke tempat item berada (rak master → pengaturan; rak input → proyek/autosave)
    if ((KM.settings.masterFx || []).includes(item)) KM.saveSettings();
    KM.changed('audio');
  }
  async function pullState(inst) {
    if (!inst || inst.status !== 'ok') return;
    clearTimeout(inst.dirtyT); inst.dirtyT = 0;
    try { const b64 = await inv('vst:get-state', inst.id); if (typeof b64 === 'string' && b64.length) { inst.item.state = b64; saveOwner(inst.item); } } catch (e) {}
  }
  V.flush = async () => { await Promise.all([...V.insts.values()].filter((i) => i.dirtyT).map(pullState)); };

  function spawn(inst) {
    const it = inst.item;
    inst.id = it.id + '-' + KM.uid();
    inst.status = 'loading'; inst.error = ''; inst.editor = false; inst.info = null;
    V.insts.set(inst.id, inst);
    const wp = waitingPorts.get(inst.id); if (wp) { waitingPorts.delete(inst.id); inst.node.port.postMessage({ port: wp }, [wp]); }
    const id = inst.id;
    inv('vst:create', { id, path: it.params.path, format: it.params.format, sr: inst.ctx.sampleRate, block: V.B, title: label(it) + ' — KLM Mix' }).then(async (info) => {
      if (inst.id !== id) return;
      inst.info = info || { ok: false, error: 'tidak ada jawaban' };
      if (!inst.info.ok) { inst.status = 'error'; inst.error = inst.info.error || 'gagal'; KM.toast('Plugin "' + label(it) + '" gagal dimuat: ' + inst.error, 'warn', 6000); notify(); return; }
      if (it.state) { try { await inv('vst:set-state', id, it.state); } catch (e) { console.warn('vst state', e); } }
      if (inst.id !== id) return;
      if (!it.params.vendor && inst.info.vendor) it.params.vendor = inst.info.vendor;
      inst.status = 'ok'; notify();
      if (inst.openEditorWhenReady) { inst.openEditorWhenReady = false; V.editor(inst, 1); }
    }).catch((e) => { if (inst.id === id) { inst.status = 'error'; inst.error = e.message; notify(); } });
  }
  function kill(inst) {
    V.insts.delete(inst.id);
    clearTimeout(inst.dirtyT);
    if (V.ok) try { inv('vst:destroy', inst.id).catch(() => {}); } catch (e) {}
  }
  V.reload = (inst) => { if (!inst || !V.ok) return; kill(inst); spawn(inst); notify(); };
  V.editor = (inst, mode) => { if (!inst) return; if (inst.status === 'loading') { inst.openEditorWhenReady = true; return; } if (inst.status === 'ok') inv('vst:editor', inst.id, mode == null ? 2 : mode); };
  V.params = (inst) => (inst && inst.status === 'ok' ? inv('vst:params', inst.id) : Promise.resolve([]));
  V.setParam = (inst, pid, v) => { if (inst && inst.status === 'ok') { inv('vst:set-param', inst.id, pid, v); clearTimeout(inst.dirtyT); inst.dirtyT = setTimeout(() => pullState(inst), 700); } };
  V.find = (item) => [...V.insts.values()].find((i) => i.item === item || i.item.id === item.id) || null;

  if (window.klm && window.klm.on) {
    window.klm.on('vst:event', (ev) => {
      const inst = V.insts.get(ev.id); if (!inst) return;
      if (ev.type === 'dirty') { clearTimeout(inst.dirtyT); inst.dirtyT = setTimeout(() => pullState(inst), 700); }
      else if (ev.type === 'editor') { inst.editor = !!ev.open; if (!ev.open) pullState(inst); notify(); }
      else if (ev.type === 'exit') {
        V.insts.delete(inst.id);
        if (inst.status === 'ok' || inst.status === 'loading') {
          inst.status = 'crash'; inst.error = 'plugin berhenti' + (ev.code != null ? ' (kode ' + ev.code + ')' : '');
          KM.toast('Plugin "' + label(inst.item) + '" berhenti — suara asli diteruskan. Buka Efek audio → Muat ulang.', 'warn', 7000);
        }
        notify();
      }
    });
  }

  FX.defs.vst = {
    id: 'vst', name: 'Plugin VST (PC)', cat: 'Plugin PC', hidden: true, selfMix: true, native: true, params: [], desc: 'Plugin VST3/VST2 asli yang terpasang di PC',
    ensure: async (ctx) => { await V.ready(); return FX.addWorklet(ctx, CODE); },
    make(ctx, params, item) {
      const node = new AudioWorkletNode(ctx, 'klm-vst', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
        processorOptions: { B: V.B, L: KM.clamp((KM.settings.vstBlocks | 0) || 4, 2, 16), mix: item ? KM.clamp(+item.mix, 0, 1) : 1 } });
      const inst = { item: item || { id: KM.uid(), params: params || {} }, node, ctx, stat: null };
      node.port.onmessage = (e) => { if (e.data && e.data.stat) inst.stat = e.data.stat; };
      if (V.ok) spawn(inst); else { inst.status = 'error'; inst.error = 'Host VST tidak tersedia di instalasi ini'; }
      return {
        input: node, output: node, vst: inst,
        set() {}, setMix(m) { node.port.postMessage({ mix: m }); },
        setItem(x) { inst.item = x; },
        destroy() { kill(inst); try { node.port.postMessage({ close: true }); } catch (e) {} notify(); }
      };
    }
  };

  /** item rak baru dari hasil pindai PC */
  V.newItem = (pl) => ({ id: 'fx' + Math.random().toString(36).slice(2, 9), type: 'vst', on: true, mix: 1, params: { path: pl.path, name: pl.name, format: pl.format, vendor: pl.vendor || '' } });
  V.supports = (pl) => V.ok && (pl.format === 'VST3' || pl.format === 'VST2') && !pl.x86 && pl.cat !== 'Instrumen';

  let readyP = null;
  V.ready = V.init = () => readyP || (readyP = (async () => {
    if (!(KM.isElectron && window.klm && window.klm.invoke)) return false;
    try { const r = await inv('vst:available'); V.ok = !!r.ok; V.path = r.path || ''; } catch (e) { V.ok = false; }
    return V.ok;
  })());
  V.stats = () => [...V.insts.values()].map((i) => ({ name: label(i.item), status: i.status, editor: i.editor, under: i.stat && i.stat.under, got: i.stat && i.stat.got }));
})(window.KM);
