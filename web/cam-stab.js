/* KLMCAM - stabilisasi gambar digital (EIS) di HP
 *
 * OIS (stabilisasi optik) adalah lensa yang bergerak di dalam modul kamera: bila HP punya OIS, kamera menyalakannya sendiri
 * dan aplikasi web/WebView tidak bisa mengaturnya. EIS di sini bekerja SETELAH kamera: tiap frame sedikit diperbesar
 * (cadangan tepi 6–16 %) lalu digeser/diputar berlawanan arah goyangan sehingga gerakan kamera menjadi halus.
 *
 * Gerakan kamera diukur dengan dua cara:
 *  1. gambar  — pergeseran isi frame terhadap frame kunci (pencocokan blok pada gambar kecil 96×54, dua belahan
 *               kiri/kanan → geser X/Y + putar). Langsung bekerja di semua HP.
 *  2. giroskop — sensor putaran HP (devicemotion). Lebih halus & tidak tertipu orang yang bergerak di depan kamera.
 *               Arah/sumbu/skala/jeda giroskop terhadap gambar DIPELAJARI otomatis dari cara 1 (regresi kuadrat terkecil),
 *               jadi tidak bergantung pada arah layar, kamera depan/belakang, atau sudut pandang lensa HP tertentu.
 *
 * Kinerja (agar tidak tersendat/freeze):
 *  - semua pengolahan frame berjalan di Web Worker tersendiri (aliran frame dipindahkan ke worker) — tidak terganggu
 *    pekerjaan halaman (UI, statistik WebRTC, pengatur kecerahan). Bila worker tidak didukung: berjalan di halaman.
 *  - gambar kecil untuk analisis diperkecil di GPU (createImageBitmap) — dulu frame penuh dibaca balik ke CPU tiap frame.
 *  - waktu olah per frame & jeda antar-frame kamera dilaporkan → halaman menurunkan tingkat EIS bila HP kewalahan. */
'use strict';
(function () {
  const IS_WORKER = typeof window === 'undefined';
  const AW = 96, AH = 54, R = 6, HALF = AW / 2, SZ = 2 * R + 1;
  const LEVELS = { low: { z: 1.06, tau: 0.35 }, mid: { z: 1.10, tau: 0.8 }, high: { z: 1.16, tau: 1.6 } };
  const LAGS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];

  // ---------- giroskop: sudut terintegrasi (rad) per waktu ----------
  function Gyro() {
    const g = { buf: [], a: 0, b: 0, c: 0, t: 0, n: 0 };
    g.add = (t, beta, gamma, alpha) => {
      if (g.t) { const dt = Math.min(0.1, (t - g.t) / 1000); if (dt > 0) { const k = dt * Math.PI / 180; g.a += (beta || 0) * k; g.b += (gamma || 0) * k; g.c += (alpha || 0) * k; } }
      g.t = t; g.n++;
      g.buf.push([t, g.a, g.b, g.c]); if (g.buf.length > 600) g.buf.splice(0, 200);
    };
    g.at = (t) => {
      const b = g.buf, n = b.length; if (n < 2 || t < b[0][0]) return null;
      if (t >= b[n - 1][0]) return t - b[n - 1][0] < 80 ? b[n - 1] : null;
      let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m][0] <= t) lo = m; else hi = m; }
      const p = b[lo], q = b[hi], k = (t - p[0]) / Math.max(1e-6, q[0] - p[0]);
      return [t, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k, p[3] + (q[3] - p[3]) * k];
    };
    return g;
  }

  // ---------- pengukuran gerak dari gambar: pencocokan blok (SSD) ----------
  const memo = new Float32Array(SZ * SZ);
  function match(prev, cur, x0, x1) {
    let mc = 0, mp = 0, np = 0;
    for (let y = R; y < AH - R; y++) for (let x = x0; x < x1; x++) { mc += cur[y * AW + x]; mp += prev[y * AW + x]; np++; }
    const dm = (mc - mp) / np; // kecerahan berubah (ISO/AE) tidak dianggap gerak
    memo.fill(-1);
    const at = (sx, sy) => {
      const i = (sy + R) * SZ + sx + R; let v = memo[i]; if (v >= 0) return v; v = 0;
      for (let y = R; y < AH - R; y++) { const rc = y * AW, rp = (y - sy) * AW - sx; for (let x = x0; x < x1; x++) { const d = cur[rc + x] - prev[rp + x] - dm; v += d * d; } }
      memo[i] = v; return v;
    };
    // pencarian penuh ±6 (169 posisi): permukaan SSD gambar kecil bergerigi, pencarian kasar bisa meleset (di worker murah)
    let best = Infinity, bx = 0, by = 0, sum = 0, cnt = 0;
    for (let sy = -R; sy <= R; sy++) for (let sx = -R; sx <= R; sx++) { const v = at(sx, sy); sum += v; cnt++; if (v < best) { best = v; bx = sx; by = sy; } }
    const mean = sum / cnt;
    if (!(best < mean * 0.65 && mean / np > 4 && Math.abs(bx) < R && Math.abs(by) < R)) return null;
    const sub = (m, c, p) => { const d = m - 2 * c + p; return d > 1e-6 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * d))) : 0; };
    return { x: bx + sub(at(bx - 1, by), best, at(bx + 1, by)), y: by + sub(at(bx, by - 1), best, at(bx, by + 1)) };
  }

  /** inti EIS: membaca frame dari `readable`, menulis frame stabil ke `writable`. report(st) dipanggil ±2×/detik */
  function Core(readable, writable, level, gyro, report) {
    const reader = readable.getReader(), writer = writable.getWriter();
    const st = { level: LEVELS[level] ? level : 'mid', stopped: false, mode: 'img', r2: 0, lag: 40, ms: 0, frames: 0, luma: -1, gyro: false, cx: 0, cy: 0, cr: 0, err: '', fpsIn: 0, gap: 0, hitch: [], gpuScale: true };
    let oc = null, ctx = null, W = 0, H = 0;
    const ac = new OffscreenCanvas(AW, AH), actx = ac.getContext('2d', { willReadFrequently: true, alpha: false });
    // pembanding = frame kunci (bukan frame sebelumnya): galat sub-piksel tidak menumpuk tiap frame
    let ref = new Float32Array(AW * AH), cur = new Float32Array(AW * AH), havePrev = false, refAge = 0;
    const Q = { x: 0, y: 0, r: 0 }, refQ = { x: 0, y: 0, r: 0 };
    let off = null, tcPrev = 0, lastTs = 0, gapMax = 0, fpsN = 0, fpsT = 0;
    const P = { x: 0, y: 0, r: 0 }, S = { x: 0, y: 0, r: 0 };
    const acc = LAGS.map(() => ({ aa: 0, ab: 0, bb: 0, xa: 0, xb: 0, ya: 0, yb: 0, xx: 0, yy: 0, cc: 0, rc: 0, rr: 0, n: 0 }));
    let fit = null;
    function resetFit() { acc.forEach((a) => { for (const k in a) a[k] = 0; }); fit = null; st.mode = 'img'; st.r2 = 0; }

    function solve(a) {
      const rg = 2e-6; // ridge ke nol: sumbu yang belum pernah bergerak tidak dikoreksi giroskop
      const gaa = a.aa + rg, gbb = a.bb + rg, gab = a.ab, det = gaa * gbb - gab * gab; if (det <= 0) return null;
      const mx = [(gbb * a.xa - gab * a.xb) / det, (gaa * a.xb - gab * a.xa) / det];
      const my = [(gbb * a.ya - gab * a.yb) / det, (gaa * a.yb - gab * a.ya) / det];
      const q = (m) => m[0] * m[0] * a.aa + 2 * m[0] * m[1] * a.ab + m[1] * m[1] * a.bb;
      const rx = a.xx - 2 * (mx[0] * a.xa + mx[1] * a.xb) + q(mx), ry = a.yy - 2 * (my[0] * a.ya + my[1] * a.yb) + q(my);
      const tot = a.xx + a.yy; if (tot <= 0) return null;
      const kr = a.rc / (a.cc + 1e-6), rr2 = a.rr > 0 ? 1 - (a.rr - 2 * kr * a.rc + kr * kr * a.cc) / a.rr : 0;
      return { mx, my, kr, rollOk: rr2 > 0.3 && a.cc > 4e-4, r2: 1 - (rx + ry) / tot, n: a.n, exc: Math.min(a.aa, a.bb) };
    }

    async function analyse(f) {
      // perkecil di GPU lalu baca 96×54 piksel saja (bukan frame penuh)
      let drawn = false;
      if (st.gpuScale && typeof createImageBitmap === 'function') {
        try { const bmp = await createImageBitmap(f, { resizeWidth: AW, resizeHeight: AH, resizeQuality: 'medium' }); actx.drawImage(bmp, 0, 0); bmp.close(); drawn = true; } catch (e) { st.gpuScale = false; }
      }
      if (!drawn) actx.drawImage(f, 0, 0, AW, AH);
      const d = actx.getImageData(0, 0, AW, AH).data;
      let lw = 0, ls = 0;
      for (let i = 0, p = 0; i < cur.length; i++, p += 4) {
        const g = (d[p] + 2 * d[p + 1] + d[p + 2]) * 0.25; cur[i] = g;
        const x = i % AW, y = (i / AW) | 0, w = (x > AW * 0.25 && x < AW * 0.75 && y > AH * 0.25 && y < AH * 0.75) ? 3 : 1; // titik tengah lebih berbobot
        lw += w; ls += g * w;
      }
      st.luma = ls / lw / 255;
      const keyNow = () => { const t = ref; ref = cur; cur = t; refQ.x = Q.x; refQ.y = Q.y; refQ.r = Q.r; refAge = 0; };
      if (!havePrev) { keyNow(); return null; }
      const l = match(ref, cur, R, HALF), r = match(ref, cur, HALF, AW - R);
      if (!l && !r) { keyNow(); return null; }
      const m = l && r ? { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, r: (r.y - l.y) / HALF } : Object.assign({ r: 0 }, l || r);
      if (Math.abs(m.x) < 0.1) m.x = 0; if (Math.abs(m.y) < 0.1) m.y = 0; if (Math.abs(m.r) < 0.003) m.r = 0; // diam di tripod: derau kecil bukan gerak
      const nq = { x: refQ.x + m.x, y: refQ.y + m.y, r: refQ.r + m.r }, inc = { x: nq.x - Q.x, y: nq.y - Q.y, r: nq.r - Q.r };
      Q.x = nq.x; Q.y = nq.y; Q.r = nq.r;
      if (Math.abs(m.x) > 3 || Math.abs(m.y) > 3 || ++refAge > 45) keyNow(); // isi sudah bergeser jauh / gambar berubah
      return inc;
    }

    function learn(meas, tc) {
      if (!gyro.buf.length || performance.now() - gyro.t > 300) { st.gyro = false; return; }
      st.gyro = true;
      LAGS.forEach((L, i) => {
        const g1 = gyro.at(tcPrev - L), g2 = gyro.at(tc - L); if (!g1 || !g2) return;
        const ga = g2[1] - g1[1], gb = g2[2] - g1[2], gc = g2[3] - g1[3];
        if (Math.abs(ga) + Math.abs(gb) < 0.0012 && Math.abs(meas.x) + Math.abs(meas.y) < 0.3) return; // tidak ada gerak: tidak informatif
        const a = acc[i], k = 0.995;
        for (const key in a) a[key] *= k;
        a.aa += ga * ga; a.ab += ga * gb; a.bb += gb * gb; a.xa += meas.x * ga; a.xb += meas.x * gb; a.ya += meas.y * ga; a.yb += meas.y * gb;
        a.xx += meas.x * meas.x; a.yy += meas.y * meas.y; a.cc += gc * gc; a.rc += meas.r * gc; a.rr += meas.r * meas.r; a.n += 1;
      });
      let bestI = -1, bestR = -1;
      LAGS.forEach((L, i) => { if (acc[i].n < 30) return; const s = solve(acc[i]); if (s && s.r2 > bestR) { bestR = s.r2; bestI = i; } });
      if (bestI < 0) return;
      const s = solve(acc[bestI]); if (!s) return; s.lag = LAGS[bestI];
      const was = fit && st.mode === 'gyro' && fit.lag !== s.lag ? solve(acc[LAGS.indexOf(fit.lag)]) : null;
      if (was && bestR < was.r2 + 0.03) { was.lag = fit.lag; fit = was; st.r2 = +was.r2.toFixed(2); return; } // jeda tidak berganti-ganti
      fit = s; st.r2 = +s.r2.toFixed(2); st.lag = s.lag;
      // giroskop dipakai hanya bila kecocokannya jelas (HP sibuk → waktu frame berantakan → kalibrasi meragukan → tetap pakai gambar)
      if (st.mode !== 'gyro' && s.r2 > 0.7 && s.n > 50 && s.exc > 2e-4) st.mode = 'gyro';
      else if (st.mode === 'gyro' && s.r2 < 0.5) st.mode = 'img';
    }

    async function step(f) {
      const t0 = performance.now();
      const fw = f.displayWidth, fh = f.displayHeight;
      if (fw !== W || fh !== H || !ctx) { W = fw; H = fh; oc = new OffscreenCanvas(W, H); ctx = oc.getContext('2d', { alpha: false, desynchronized: true }); P.x = P.y = P.r = S.x = S.y = S.r = 0; havePrev = false; resetFit(); }
      // waktu tangkap frame (jam performance.now): selisih minimum arrival−timestamp = jeda pipa kamera terpendek
      const ts = f.timestamp / 1000;
      if (f.timestamp) { const d = t0 - ts; if (off == null || Math.abs(d - off) > 500) off = d; else off = Math.min(off + 0.02, d); }
      const tc = f.timestamp ? ts + off : t0;
      // jeda antar-frame kamera (tersendat di HP sendiri, sebelum dikirim)
      if (lastTs && f.timestamp) { const g = (f.timestamp - lastTs) / 1000; if (g > gapMax) gapMax = g; if (st.fpsIn && g > Math.max(200, 4000 / st.fpsIn)) st.hitch.push(t0); }
      lastTs = f.timestamp || 0;
      fpsN++; if (t0 - fpsT >= 1000) { st.fpsIn = Math.round(fpsN * 1000 / (t0 - fpsT || 1)); fpsN = 0; fpsT = t0; }
      const meas = await analyse(f);
      const sx = W / AW, sy = H / AH;
      let inc = null;
      if (havePrev && tcPrev) {
        if (meas) learn(meas, tc);
        if (st.mode === 'gyro' && fit) {
          const g1 = gyro.at(tcPrev - fit.lag), g2 = gyro.at(tc - fit.lag);
          if (g1 && g2) { const ga = g2[1] - g1[1], gb = g2[2] - g1[2]; inc = { x: (fit.mx[0] * ga + fit.mx[1] * gb) * sx, y: (fit.my[0] * ga + fit.my[1] * gb) * sy, r: fit.rollOk ? fit.kr * (g2[3] - g1[3]) : 0 }; }
        }
        if (!inc && meas) inc = { x: meas.x * sx, y: meas.y * sy, r: 0 };
      }
      if (inc) { P.x += inc.x; P.y += inc.y; P.r += inc.r; }
      // jalur halus (kamera virtual) mengikuti jalur asli; makin dekat batas cadangan tepi, makin cepat mengikuti (panning tetap jalan)
      const lv = LEVELS[st.level] || LEVELS.mid, z = lv.z, dt = Math.max(0.005, Math.min(0.1, tcPrev ? (tc - tcPrev) / 1000 : 1 / 30));
      const mx0 = W / 2 * (1 - 1 / z), my0 = H / 2 * (1 - 1 / z), rmax = Math.min(0.035, 0.6 * (1 - 1 / z) * H / W);
      const follow = (k, lim) => { const e = Math.min(1, Math.abs(S[k] - P[k]) / Math.max(1e-6, lim)); const tau = lv.tau * Math.max(0.08, 1 - e * e); S[k] += (P[k] - S[k]) * (1 - Math.exp(-dt / tau)); };
      follow('x', mx0); follow('y', my0); follow('r', rmax);
      const cr = Math.max(-rmax, Math.min(rmax, S.r - P.r));
      const mx = Math.max(0, mx0 - Math.abs(cr) * H / 2), my = Math.max(0, my0 - Math.abs(cr) * W / 2);
      const cx = Math.max(-mx, Math.min(mx, S.x - P.x)), cy = Math.max(-my, Math.min(my, S.y - P.y));
      S.x = P.x + cx; S.y = P.y + cy; S.r = P.r + cr;
      st.cx = cx; st.cy = cy; st.cr = cr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.rotate(cr); ctx.translate(-W / 2 + cx, -H / 2 + cy);
      ctx.drawImage(f, 0, 0, W, H);
      const out = new VideoFrame(oc, { timestamp: f.timestamp, duration: f.duration || undefined });
      havePrev = true; tcPrev = tc;
      st.ms = st.ms ? st.ms * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0; st.frames++;
      return out;
    }

    const snap = () => {
      const now = performance.now(); st.hitch = st.hitch.filter((t) => now - t < 60000);
      const s = { level: st.level, mode: st.mode, gyro: st.gyro, r2: st.r2, lag: st.lag, ms: +st.ms.toFixed(1), frames: st.frames, err: st.err, luma: st.luma, fpsIn: st.fpsIn,
        gap: Math.round(gapMax), hitch: st.hitch.length, c: [Math.round(st.cx), Math.round(st.cy), +(st.cr * 180 / Math.PI).toFixed(2)] };
      gapMax = 0; return s;
    };
    const rt = setInterval(() => { if (!st.stopped) report(snap()); }, 500);

    (async () => {
      while (!st.stopped) {
        let r; try { r = await reader.read(); } catch (e) { break; }
        if (r.done) break;
        const f = r.value; let out = null;
        try { out = await step(f); f.close(); } catch (e) { st.err = String(e && e.message || e); out = f; } // gagal: frame asli diteruskan (tidak membeku)
        try { await writer.write(out); } catch (e) { try { out.close(); } catch (e2) {} if (st.stopped) break; }
      }
      clearInterval(rt);
    })();

    return {
      setLevel: (l) => { if (LEVELS[l]) st.level = l; },
      reset: () => { resetFit(); P.x = P.y = P.r = S.x = S.y = S.r = 0; },
      stop: () => { if (st.stopped) return; st.stopped = true; clearInterval(rt); try { reader.cancel(); } catch (e) {} try { writer.close().catch(() => {}); } catch (e) {} }
    };
  }

  // ================= di dalam Web Worker =================
  if (IS_WORKER) {
    let core = null, off = 0; const gy = Gyro();
    self.onmessage = (e) => {
      const m = e.data || {};
      if (m.t === 'init') {
        off = (m.origin || 0) - performance.timeOrigin; // jam halaman → jam worker
        try { core = Core(m.readable, m.writable, m.level, gy, (s) => self.postMessage({ t: 'st', s })); self.postMessage({ t: 'ok' }); }
        catch (er) { self.postMessage({ t: 'fail', err: String(er && er.message || er) }); }
      } else if (m.t === 'g') gy.add(m.s[0] + off, m.s[1], m.s[2], m.s[3]);
      else if (m.t === 'lvl') { if (core) core.setLevel(m.v); }
      else if (m.t === 'reset') { if (core) core.reset(); }
      else if (m.t === 'stop') { if (core) core.stop(); setTimeout(() => self.close(), 50); }
    };
    return;
  }

  // ================= di halaman =================
  const SRC = (document.currentScript && document.currentScript.src) || 'cam-stab.js';
  const supported = () => typeof window.MediaStreamTrackProcessor === 'function' && typeof window.MediaStreamTrackGenerator === 'function' && typeof window.VideoFrame === 'function' && typeof window.OffscreenCanvas === 'function';

  function create(track, opts) {
    if (!supported()) return null;
    const level = LEVELS[opts && opts.level] ? opts.level : 'mid';
    const proc = new window.MediaStreamTrackProcessor({ track, maxBufferSize: 2 });
    const gen = new window.MediaStreamTrackGenerator({ kind: 'video' });
    try { gen.contentHint = 'motion'; } catch (e) {}
    let st = { level, mode: 'img', ms: 0, frames: 0, luma: -1, gap: 0, hitch: 0, fpsIn: 0 }, worker = null, core = null, gy = null, stopped = false;
    const onState = (s) => { st = s; };
    // 1) Web Worker (aliran frame dipindahkan); 2) bila tidak bisa: di halaman ini
    try {
      worker = new Worker(SRC);
      worker.onmessage = (e) => { const m = e.data || {}; if (m.t === 'st') onState(m.s); else if (m.t === 'fail') console.warn('EIS worker', m.err); };
      worker.onerror = (e) => console.warn('EIS worker', e.message);
      worker.postMessage({ t: 'init', readable: proc.readable, writable: gen.writable, level, origin: performance.timeOrigin }, [proc.readable, gen.writable]);
    } catch (e) {
      try { if (worker) worker.terminate(); } catch (e2) {} worker = null;
      gy = Gyro(); core = Core(proc.readable, gen.writable, level, gy, onState);
    }
    const onMotion = (e) => {
      const r = e.rotationRate; if (!r || (r.alpha == null && r.beta == null && r.gamma == null)) return;
      const t = e.timeStamp || performance.now();
      if (worker) worker.postMessage({ t: 'g', s: [t, r.beta || 0, r.gamma || 0, r.alpha || 0] }); else gy.add(t, r.beta, r.gamma, r.alpha);
    };
    const reset = () => { if (worker) worker.postMessage({ t: 'reset' }); else if (core) core.reset(); };
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('orientationchange', reset);
    try { screen.orientation && screen.orientation.addEventListener('change', reset); } catch (e) {}
    return {
      track: gen,
      worker: !!worker,
      info: () => Object.assign({ worker: !!worker }, st),
      luma: () => (st && st.luma != null ? st.luma : -1),
      setLevel: (l) => { if (!LEVELS[l]) return; if (worker) worker.postMessage({ t: 'lvl', v: l }); else core.setLevel(l); },
      reset,
      stop: () => {
        if (stopped) return; stopped = true;
        window.removeEventListener('devicemotion', onMotion); window.removeEventListener('orientationchange', reset);
        try { screen.orientation && screen.orientation.removeEventListener('change', reset); } catch (e) {}
        if (worker) { try { worker.postMessage({ t: 'stop' }); } catch (e) {} setTimeout(() => { try { worker.terminate(); } catch (e) {} }, 300); } else if (core) core.stop();
        try { gen.stop(); } catch (e) {}
      }
    };
  }

  window.KLMStab = { supported, create, LEVELS };
})();
