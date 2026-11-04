/* KLM QR - generator QR Code mandiri (byte mode, ECC L, versi 1-10). Offline, tanpa dependensi. */
(function (root) {
  'use strict';
  // [total codewords, jumlah blok, ecc per blok] untuk ECC level L
  const TBL = [null, [26, 1, 7], [44, 1, 10], [70, 1, 15], [100, 1, 20], [134, 1, 26], [172, 2, 18], [196, 2, 20], [242, 2, 24], [292, 2, 30], [346, 4, 18]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  function gmul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
  function rsDivisor(deg) {
    const r = []; for (let i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < r.length; j++) { r[j] = gmul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = gmul(root, 2);
    }
    return r;
  }
  function rsRem(data, div) {
    const r = div.map(() => 0);
    for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gmul(c, f); }); }
    return r;
  }
  function utf8(s) { return Array.from(new TextEncoder().encode(s)); }

  function make(text) {
    const bytes = utf8(text);
    let ver = 1;
    for (; ver <= 10; ver++) {
      const [tot, nb, ec] = TBL[ver];
      const cap = (tot - nb * ec) * 8;
      const need = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= cap) break;
    }
    if (ver > 10) throw new Error('Teks terlalu panjang untuk QR');
    const [tot, nb, ec] = TBL[ver];
    const dataCap = tot - nb * ec;
    // bit stream
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    put(0, Math.min(4, dataCap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; data.push(v); }
    for (let p = 0xEC; data.length < dataCap; p ^= 0xEC ^ 0x11) data.push(p);
    // ecc + interleave
    const shortN = nb - (tot % nb), shortLen = Math.floor(tot / nb);
    const div = rsDivisor(ec), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - ec + (i < shortN ? 0 : 1)); k += dat.length;
      const e = rsRem(dat, div);
      if (i < shortN) dat.push(0);
      blocks.push(dat.concat(e));
    }
    const cw = [];
    for (let i = 0; i < blocks[0].length; i++) for (let j = 0; j < blocks.length; j++) if (i !== shortLen - ec || j >= shortN) cw.push(blocks[j][i]);

    const size = ver * 4 + 17;
    const M = [], F = [];
    for (let y = 0; y < size; y++) { M.push(new Array(size).fill(false)); F.push(new Array(size).fill(false)); }
    const setF = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = ALIGN[ver], na = al.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = (mask) => {
      const d = (1 << 3) | mask; let r = d;
      for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      const b = ((d << 10) | r) ^ 0x5412, g = (i) => ((b >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) setF(8, i, g(i));
      setF(8, 7, g(6)); setF(8, 8, g(7)); setF(7, 8, g(8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, g(i));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let r = ver; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      const b = (ver << 12) | r;
      for (let i = 0; i < 18; i++) { const c = ((b >>> i) & 1) === 1, a = size - 11 + (i % 3), bb = Math.floor(i / 3); setF(a, bb, c); setF(bb, a, c); }
    }
    // data
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!F[y][x] && i < cw.length * 8) { M[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
    const maskFn = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
      (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0
    ];
    const applyMask = (m) => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && maskFn[m](x, y)) M[y][x] = !M[y][x]; };
    const penalty = () => {
      let p = 0, dark = 0;
      const line = (get) => {
        for (let a = 0; a < size; a++) {
          let run = 1, s = '';
          for (let b = 0; b < size; b++) {
            const c = get(a, b); s += c ? '1' : '0';
            if (b > 0) { if (c === get(a, b - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
          }
          let k = -1; while ((k = s.indexOf('1011101', k + 1)) >= 0) {
            if (s.substr(k - 4, 4) === '0000' || s.substr(k + 7, 4) === '0000') p += 40;
          }
        }
      };
      line((a, b) => M[a][b]); line((a, b) => M[b][a]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (M[y][x]) dark++;
      p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) { applyMask(m); drawFormat(m); const p = penalty(); if (p < bestP) { bestP = p; best = m; } applyMask(m); }
    applyMask(best); drawFormat(best);
    return { size, modules: M, version: ver };
  }

  function svg(text, opts) {
    opts = opts || {};
    const q = make(text), b = opts.border == null ? 3 : opts.border, n = q.size + b * 2;
    let d = '';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.modules[y][x]) d += `M${x + b},${y + b}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${opts.light || '#fff'}"/><path d="${d}" fill="${opts.dark || '#000'}"/></svg>`;
  }
  root.KMQR = { make, svg };
  if (typeof module !== 'undefined') module.exports = root.KMQR;
})(typeof window !== 'undefined' ? window : globalThis);
