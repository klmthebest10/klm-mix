/* Contoh plugin audio eksternal KLM Mix — "Bitcrusher / Lo-Fi"
 * Pasang: KLM Mix → mixer audio → FX → "Pasang plugin / IR…" → pilih file ini
 * (atau salin ke folder plugin lalu klik "Muat ulang").
 */
const WORKLET = `
class Crusher extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'bits', defaultValue: 8 }, { name: 'down', defaultValue: 4 }]; }
  constructor() { super(); this.hold = [0, 0]; this.n = 0; }
  process(ins, outs, p) {
    const i = ins[0], o = outs[0]; if (!i || !i.length) return true;
    const step = Math.pow(0.5, Math.max(1, p.bits[0])), down = Math.max(1, Math.round(p.down[0]));
    for (let s = 0; s < i[0].length; s++) {
      if (this.n++ % down === 0) for (let c = 0; c < 2; c++) { const x = (i[c] || i[0])[s]; this.hold[c] = step * Math.floor(x / step + 0.5); }
      for (let c = 0; c < o.length; c++) o[c][s] = this.hold[Math.min(c, 1)];
    }
    return true;
  }
}
registerProcessor('contoh-crusher', Crusher);`;

export default {
  id: 'contoh-bitcrusher',
  name: 'Bitcrusher / Lo-Fi',
  author: 'Contoh KLM Mix',
  desc: 'Suara retro 8-bit',
  worklet: WORKLET,               // opsional: kode AudioWorklet (didaftarkan otomatis sekali)
  params: [
    { k: 'bits', n: 'Bit', min: 1, max: 16, step: 1, def: 8 },
    { k: 'down', n: 'Downsample', min: 1, max: 32, step: 1, def: 4, unit: '×' },
    { k: 'tone', n: 'Nada', min: 500, max: 16000, step: 100, def: 8000, unit: 'Hz' }
  ],
  create(ctx, params, h) {
    const node = h.worklet('contoh-crusher');
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    node.connect(lp);
    return {
      input: node, output: lp,
      set(k, v) {
        if (k === 'tone') h.smooth(lp.frequency, v);
        else { const pr = node.parameters.get(k); if (pr) h.smooth(pr, v); }
      },
      destroy() { node.disconnect(); lp.disconnect(); }
    };
  }
};
