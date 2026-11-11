/* KLM Mix - boot
 * Setiap modul dinyalakan terpisah: bila satu bagian gagal (mis. perangkat audio bermasalah),
 * bagian lain tetap jalan, error dicatat & ditampilkan, dan layar pembuka selalu ditutup.
 */
'use strict';
(function (KM) {
  function fitCanvases() {
    const ar = KM.settings.width + ' / ' + KM.settings.height;
    KM.$('#pgm').style.aspectRatio = ar; KM.$('#pvw').style.aspectRatio = ar;
  }
  KM.bootErrors = [];
  const step = (name, fn) => { try { return fn(); } catch (e) { console.error('[boot] ' + name, e); KM.bootErrors.push(name + ': ' + (e && e.message || e)); } };
  const hideSplash = () => { const sp = document.getElementById('splash'); if (sp && !sp.classList.contains('done')) { sp.classList.add('done'); setTimeout(() => sp.remove(), 600); } };
  setTimeout(hideSplash, 8000); // pengaman terakhir
  window.addEventListener('error', (e) => { if (KM.toast && e && e.message && !/ResizeObserver/.test(e.message)) console.warn('[KLM] ' + e.message); });
  // layar pembuka tergambar dulu (1 frame), baru modul dinyalakan → jendela langsung tampil, tidak terasa macet
  let booted = false;
  const afterPaint = (fn) => { const go = () => { if (!booted) { booted = true; fn(); } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 250); };
  window.addEventListener('DOMContentLoaded', () => afterPaint(boot));
  async function boot() {
    step('audio', () => KM.audio.init());
    step('engine', () => KM.engine.init(KM.$('#pgm'), KM.$('#pvw')));
    step('utc', () => KM.utc.boot());
    if (KM.isElectron && KM.settings.srt && KM.settings.srt.autoStart) setTimeout(() => KM.rec.startSrt(), 2500);
    step('ui', () => KM.ui.init());
    step('link', () => KM.link.connect());
    step('dock', () => KM.ui.dockTab('audio'));
    step('canvas', () => { fitCanvases(); KM.on('resized', fitCanvases); });
    hideSplash();
    if (KM.bootErrors.length) setTimeout(() => KM.toast && KM.toast('Sebagian modul gagal dimuat: ' + KM.bootErrors.join(' • ') + ' — fitur lain tetap berjalan.', 'warn', 9000), 800);
    if (KM.isElectron) { try { KM._appInfo = await window.klm.invoke('app:info'); } catch (e) {} }
    try {
      const p = JSON.parse(localStorage.getItem('klmmix.autosave') || 'null');
      if (p && p.inputs && p.inputs.length) setTimeout(() => KM.ui.restoreAutosave(), 600);
    } catch (e) {}
    window.addEventListener('beforeunload', () => { try { KM.ui.autosave(); } catch (e) {} });
    KM.readyAt = performance.timeOrigin + performance.now();
    console.log('%cKLM Mix ' + KM.version + ' siap', 'color:#22c55e;font-weight:bold');
  }
})(window.KM);
