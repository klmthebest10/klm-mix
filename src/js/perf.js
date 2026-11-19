/* KLM - mode performa (Hemat / Seimbang / Kualitas) */
'use strict';
(function (KM) {
  const PRESET = {
    hemat: { previewScale: 0.33, previewEvery: 1, thumbEvery: 8, thumbsPer: 1, h: 720, fps: 30, replay: [640, 360, 10], label: '🍃 Hemat' },
    seimbang: { previewScale: 0.5, previewEvery: 1, thumbEvery: 4, thumbsPer: 2, h: 1080, fps: null, replay: [640, 360, 15], label: '⚖ Seimbang' },
    kualitas: { previewScale: 1, previewEvery: 1, thumbEvery: 2, thumbsPer: 3, h: null, fps: null, replay: [960, 540, 15], label: '💎 Kualitas' }
  };
  KM.perf = {
    PRESET,
    label: () => (PRESET[KM.settings.perf || 'seimbang'] || PRESET.seimbang).label,
    apply(mode) {
      const p = PRESET[mode]; if (!p) return;
      const st = KM.settings;
      st.perf = mode;
      Object.assign(st, { previewScale: p.previewScale, previewEvery: p.previewEvery, thumbEvery: p.thumbEvery, thumbsPer: p.thumbsPer });
      if (p.h) { // jaga rasio (horizontal / vertikal / persegi)
        const ar = st.width / st.height;
        if (ar >= 1) { st.height = p.h; st.width = Math.round(p.h * ar / 2) * 2; } else { st.width = p.h; st.height = Math.round(p.h / ar / 2) * 2; }
      }
      if (p.fps) st.fps = Math.min(st.fps, p.fps);
      st.replay = Object.assign({}, st.replay, { width: p.replay[0], height: p.replay[1], seconds: Math.min(st.replay.seconds || 15, p.replay[2]) });
      KM.saveSettings();
      KM.engine.resize();
      KM.toast('Mode performa: ' + p.label + ' (' + st.width + '×' + st.height + ' ' + st.fps + 'fps)', 'ok');
      KM.perf.level = 0; st.perfLite = mode === 'hemat'; syncLite();
      KM.changed('perf');
    },
    /** laptop/PC lemah? (inti CPU sedikit / RAM kecil) */
    weak: () => (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4,
    level: 0,
    cycle() { const k = Object.keys(PRESET), i = k.indexOf(KM.settings.perf || 'seimbang'); KM.perf.apply(k[(i + 1) % k.length]); }
  };
  const syncLite = () => document.body && document.body.classList.toggle('lite', !!KM.settings.perfLite || KM.settings.perf === 'hemat');
  // pertama kali dipakai di perangkat lemah → langsung mode Hemat (720p30, monitor & kartu ringan)
  if (KM.firstRun && KM.perf.weak()) {
    const st = KM.settings, p = PRESET.hemat;
    Object.assign(st, { perf: 'hemat', perfLite: true, previewScale: p.previewScale, previewEvery: p.previewEvery, thumbEvery: p.thumbEvery, thumbsPer: p.thumbsPer, width: 1280, height: 720, fps: 30 });
    st.replay = Object.assign({}, st.replay, { width: 640, height: 360, seconds: 10 });
    KM.perf.autoPicked = true;
  }
  // v1.14.3: Preview tidak lagi dijarangkan — hapus nilai lama (Hemat = 2, otomatis = 3) yang terlanjur tersimpan
  if ((KM.settings.previewEvery || 1) > 1) { KM.settings.previewEvery = 1; try { KM.saveSettings(); } catch (e) {} }
  document.addEventListener('DOMContentLoaded', syncLite); setTimeout(syncLite, 0);
  // ---------- performa otomatis: bila frame rate nyata tertinggal, beban diturunkan bertahap (tidak pernah naik sendiri) ----------
  let low = 0;
  KM.on('fps', (fps) => {
    const st = KM.settings, E = KM.engine;
    if (st.autoPerf === false || document.hidden || !E || E.quiet || KM.perf.level >= 4) { low = 0; return; }
    // 30 detik pertama (memuat antarmuka, cache GPU/shader dibangun ulang setelah update) dan tanpa input: fps rendah wajar,
    // bukan tanda PC berat → jangan menurunkan pengaturan (dulu: setelah update, output turun sendiri ke 540p 30 fps)
    if (performance.now() < 30000 || !KM.state.inputs.length) { low = 0; return; }
    if (fps >= st.fps * 0.8) { low = Math.max(0, low - 1); return; }
    if (++low < 4) return; // ±4 detik berturut-turut tertinggal
    low = 0;
    const busy = KM.state.recording || KM.state.streaming || KM.state.srt || KM.state.multicorder;
    const lv = ++KM.perf.level;
    // Preview TIDAK pernah dijarangkan (itu yang membuatnya patah-patah). Urutan: thumbnail → resolusi output (paling
    // besar dampaknya: piksel 1080p dibanding 720p ≈ 2,25×) → fps → output 540p bila masih berat.
    if (lv === 1) { st.perfLite = true; syncLite(); KM.ui && KM.ui.fitStage && KM.ui.fitStage(); KM.toast('Performa otomatis: thumbnail & efek tampilan diringankan agar tetap mulus', 'info', 4500); }
    else if (lv === 2) {
      if (st.height > 720 && !busy) { const ar = st.width / st.height; st.height = 720; st.width = Math.round(720 * ar / 2) * 2; E.resize(); KM.toast('Performa otomatis: output diturunkan ke ' + st.width + '×' + st.height + ' agar tetap lancar (ubah di Pengaturan → Video)', 'warn', 9000); }
      else if (busy) KM.perf.level = 1;
    }
    else if (lv === 3) { if (st.fps > 30 && !busy) { st.fps = 30; E.resize(); KM.toast('Performa otomatis: output diturunkan ke 30 fps', 'warn', 6000); } else KM.perf.level = busy ? 2 : 3, low = busy ? 0 : 5; }
    else if (lv === 4) {
      if (st.height > 540 && !busy) { const ar = st.width / st.height; st.height = 540; st.width = Math.round(540 * ar / 2) * 2; E.resize(); KM.toast('Performa otomatis: output diturunkan ke ' + st.width + '×' + st.height + ' karena perangkat masih berat (ubah di Pengaturan → Video)', 'warn', 9000); }
      else if (busy) { KM.perf.level = 3; }
    }
    KM.saveSettings(); KM.changed('perf');
  });
})(window.KM);
