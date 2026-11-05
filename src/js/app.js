/* KLM Mix - boot */
'use strict';
(function (KM) {
  function fitCanvases() {
    const ar = KM.settings.width + ' / ' + KM.settings.height;
    KM.$('#pgm').style.aspectRatio = ar; KM.$('#pvw').style.aspectRatio = ar;
  }
  window.addEventListener('DOMContentLoaded', async () => {
    KM.audio.init();
    KM.engine.init(KM.$('#pgm'), KM.$('#pvw'));
    KM.utc.start();
    KM.ui.init();
    KM.link.connect();
    KM.ui.dockTab('audio');
    fitCanvases();
    KM.on('resized', fitCanvases);
    if (KM.isElectron) { try { KM._appInfo = await window.klm.invoke('app:info'); } catch (e) {} }
    try {
      const p = JSON.parse(localStorage.getItem('klmmix.autosave') || 'null');
      if (p && p.inputs && p.inputs.length) setTimeout(() => KM.ui.restoreAutosave(), 600);
    } catch (e) {}
    window.addEventListener('beforeunload', () => KM.ui.autosave());
    console.log('%cKLM Mix ' + KM.version + ' siap', 'color:#22c55e;font-weight:bold');
  });
})(window.KM);
