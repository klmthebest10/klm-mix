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
  const hideSplash = (instant) => { const sp = document.getElementById('splash'); if (sp && !sp.classList.contains('done')) { if (instant) sp.classList.add('instant'); sp.classList.add('done'); setTimeout(() => sp.remove(), 600); } };
  setTimeout(hideSplash, 12000); // pengaman terakhir
  window.addEventListener('error', (e) => { if (KM.toast && e && e.message && !/ResizeObserver/.test(e.message)) console.warn('[KLM] ' + e.message); });
  // layar pembuka tergambar dulu (1 frame), baru modul dinyalakan → jendela langsung tampil, tidak terasa macet
  let booted = false;
  const afterPaint = (fn) => { const go = () => { if (!booted) { booted = true; fn(); } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 250); };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => afterPaint(boot));
  else afterPaint(boot); // bundle dimuat setelah layar pembuka tergambar (DOM sudah siap)
  // tahap penyiapan yang sebenarnya, ditampilkan di layar pembuka (jendela pembuka di PC, #splash di web/HP)
  const frame = () => new Promise((r) => { let d = false; const go = () => { if (!d) { d = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 60); });
  async function stage(pct, text, name, fn) {
    const st = document.getElementById('splashSt'), pb = document.getElementById('splashPb');
    if (st) st.textContent = text; if (pb) pb.style.width = pct + '%';
    if (KM.isElectron) { try { window.klm.invoke('app:boot', pct, text); } catch (e) {} }
    await frame();
    if (fn) { try { await fn(); } catch (e) { console.error('[boot] ' + name, e); KM.bootErrors.push(name + ': ' + (e && e.message || e)); } }
  }
  async function boot() {
    await stage(12, 'Menyiapkan mesin audio…', 'audio', () => KM.audio.init());
    await stage(30, 'Menyalakan mesin video…', 'engine', () => KM.engine.init(KM.$('#pgm'), KM.$('#pvw')));
    await stage(46, 'Menghubungkan grafis UTC…', 'utc', () => KM.utc.boot());
    if (KM.isElectron && KM.settings.srt && KM.settings.srt.autoStart) setTimeout(() => KM.rec.startSrt(), 2500);
    await stage(62, 'Menyusun ruang kendali…', 'ui', () => { KM.ui.init(); KM.ui.dockTab('audio'); fitCanvases(); KM.on('resized', fitCanvases); });
    await stage(78, 'Menghubungkan jaringan & perangkat…', 'link', async () => { KM.link.connect(); if (KM.settings.net && KM.settings.net.on) setTimeout(() => KM.link.netStart(), 2000); if (KM.isElectron) { try { KM._appInfo = await Promise.race([window.klm.invoke('app:info'), new Promise((r) => setTimeout(r, 1500))]); } catch (e) {} } });
    await stage(92, 'Merapikan tampilan…', 'font', async () => { try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 700))]); } catch (e) {} await frame(); await frame(); });
    await stage(100, 'Siap', 'siap');
    hideSplash(KM.isElectron);
    if (KM.isElectron) { try { window.klm.invoke('app:ready'); } catch (e) {} }
    if (KM.perf.autoPicked) { KM.saveSettings(); setTimeout(() => KM.toast('Perangkat ini terdeteksi ringan — KLM Mix memakai mode Hemat (720p 30fps). Bisa diubah di pojok kanan atas.', 'info', 8000), 1200); }
    const recovering = location.hash === '#pulih';
    if (recovering) { history.replaceState(null, '', location.pathname); setTimeout(async () => { await KM.ui.restoreAutosave('silent'); KM.toast('KLM Mix dipulihkan otomatis setelah gangguan — sesi terakhir dimuat kembali', 'warn', 8000); }, 400); }
    if (KM.bootErrors.length) setTimeout(() => KM.toast && KM.toast('Sebagian modul gagal dimuat: ' + KM.bootErrors.join(' • ') + ' — fitur lain tetap berjalan.', 'warn', 9000), 800);
    try {
      const p = JSON.parse(localStorage.getItem('klmmix.autosave') || 'null');
      if (p && p.inputs && p.inputs.length && !recovering) setTimeout(() => KM.ui.restoreAutosave(), 600);
    } catch (e) {}
    window.addEventListener('beforeunload', () => { try { KM.ui.autosave(); } catch (e) {} });
    KM.readyAt = performance.timeOrigin + performance.now();
    console.log('%cKLM Mix ' + KM.version + ' siap', 'color:#22c55e;font-weight:bold');
  }
})(window.KM);
