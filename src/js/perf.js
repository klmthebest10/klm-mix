/* KLM Mix - mode performa (Hemat / Seimbang / Kualitas) */
'use strict';
(function (KM) {
  const PRESET = {
    hemat: { previewScale: 0.33, previewEvery: 2, thumbEvery: 8, thumbsPer: 1, h: 720, fps: 30, replay: [640, 360, 10], label: '🍃 Hemat' },
    seimbang: { previewScale: 0.5, previewEvery: 1, thumbEvery: 4, thumbsPer: 2, h: 1080, fps: 30, replay: [640, 360, 15], label: '⚖ Seimbang' },
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
      KM.changed('perf');
    },
    cycle() { const k = Object.keys(PRESET), i = k.indexOf(KM.settings.perf || 'seimbang'); KM.perf.apply(k[(i + 1) % k.length]); }
  };
})(window.KM);
