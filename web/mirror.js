/* KLM Mix HP — Mirroring layar: aplikasi (.apk) merekam layar dengan encoder H.264 hardware dan mengirim langsung ke PC lewat WiFi/USB lokal. */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const P = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.KlmMirror;
  const parse = (s) => { const q = new URLSearchParams(String(s || '').replace(/^.*#/, '')); const o = { h: (q.get('h') || '').split(',').map((x) => x.trim()).filter(Boolean), p: +q.get('p') || 8624, t: q.get('t') || '', q: +q.get('q') || 0, f: +q.get('f') || 0, b: +q.get('b') || 0 }; return o.h.length && o.t ? o : null; };
  const load = () => { try { return JSON.parse(localStorage.getItem('klm.mirror') || 'null'); } catch (e) { return null; } };
  const save = (o) => localStorage.setItem('klm.mirror', JSON.stringify(o));
  let cfg = load() || { h: [], p: 8624, t: '', q: 1280, f: 60, b: 8000 }, live = false;
  const fromUrl = parse(location.hash);
  if (fromUrl) { cfg = Object.assign({}, cfg, fromUrl, { q: fromUrl.q || cfg.q, f: fromUrl.f || cfg.f, b: fromUrl.b || cfg.b }); save(cfg); }

  function status(kind, t, s) { $('st').className = 'mst ' + (kind || ''); $('stT').textContent = t; $('stS').textContent = s || ''; }

  if (!P) { // dibuka di browser HP (mis. setelah scan QR dengan kamera bawaan) → serahkan ke aplikasi
    $('webUi').classList.remove('hide');
    const frag = location.hash.replace(/^#/, '');
    $('openApp').href = 'intent://mirror?' + frag + '#Intent;scheme=klmmix;package=com.klm.mix.hp;end';
    if (!fromUrl) $('openApp').classList.add('hide');
    status('', 'Buka lewat aplikasi KLM Mix', 'Mirroring tidak bisa dari browser');
    return;
  }
  $('appUi').classList.remove('hide');
  const ui = () => {
    $('q').value = String(cfg.q || 1280); $('f').value = String(cfg.f || 60); $('b').value = String(cfg.b || 8000); $('h').value = cfg.h.join(','); $('t').value = cfg.t || '';
    $('bStartS').textContent = cfg.h.length && cfg.t ? 'PC ' + cfg.h[0] : 'Scan QR dulu, atau isi alamat PC & kode';
    $('bStart').classList.toggle('hide', live); $('bStop').classList.toggle('hide', !live); $('bScan').classList.toggle('hide', live);
  };
  const read = () => { cfg.q = +$('q').value; cfg.f = +$('f').value; cfg.b = +$('b').value; cfg.h = $('h').value.split(',').map((x) => x.trim()).filter(Boolean); cfg.t = $('t').value.trim(); save(cfg); };
  ['q', 'f', 'b', 'h', 't'].forEach((k) => $(k).addEventListener('change', read));

  async function start() {
    read();
    if (!cfg.h.length || !cfg.t) return KMP.toast('Scan QR dulu, atau isi alamat PC & kode');
    status('wait', 'Meminta izin rekam layar…', 'Pilih "Mulai sekarang" / "Seluruh layar"');
    try { await P.start({ hosts: cfg.h, port: cfg.p, token: cfg.t, size: cfg.q, fps: cfg.f, bitrate: cfg.b, name: (window.KMP && KMP.get && KMP.get('name', '')) || '' }); }
    catch (e) { status('', 'Tidak jadi', String((e && e.message) || e)); }
  }
  P.addListener('state', (s) => {
    live = s.state === 'live' || s.state === 'connecting';
    if (s.state === 'live') status('live', 'Mirroring berjalan', (s.w || '?') + '×' + (s.h || '?') + ' • ' + (s.fps || cfg.f) + ' fps • ' + (s.host || '') + (s.kbps ? ' • ' + s.kbps + ' kbps' : ''));
    else if (s.state === 'connecting') status('wait', 'Menyambung ke PC…', s.host || '');
    else if (s.state === 'error') status('', 'Gagal', s.message || '');
    else status('', 'Mirroring berhenti', s.message || 'Tekan Mulai untuk menyambung lagi');
    ui();
  });
  P.addListener('link', (d) => { const o = parse('#' + (d.url || '').replace(/^.*\?/, '')); if (o) { cfg = Object.assign({}, cfg, o, { q: o.q || cfg.q, f: o.f || cfg.f, b: o.b || cfg.b }); save(cfg); ui(); start(); } });
  $('bStart').onclick = start;
  $('bStop').onclick = () => P.stop();

  // ---- scan QR di dalam aplikasi (BarcodeDetector); bila tidak tersedia, pakai kamera bawaan HP ----
  let stream = null, timer = 0;
  const stopScan = () => { clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; $('scan').style.display = 'none'; };
  $('scanX').onclick = stopScan;
  $('bScan').onclick = async () => {
    if (!('BarcodeDetector' in window)) return KMP.toast('Pemindai QR tidak tersedia di HP ini — scan QR dengan kamera bawaan HP, lalu pilih "Buka di aplikasi KLM Mix"', 7000);
    try {
      const det = new BarcodeDetector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
      $('sv').srcObject = stream; await $('sv').play(); $('scan').style.display = 'flex';
      timer = setInterval(async () => {
        try { const r = await det.detect($('sv')); for (const c of r) { const o = parse(c.rawValue); if (o) { stopScan(); cfg = Object.assign({}, cfg, o, { q: o.q || cfg.q, f: o.f || cfg.f, b: o.b || cfg.b }); save(cfg); ui(); start(); return; } if (c.rawValue) $('scanMsg').textContent = 'Bukan QR Mirroring KLM Mix'; } } catch (e) {}
      }, 220);
    } catch (e) { stopScan(); KMP.toast('Kamera tidak bisa dibuka: ' + e.message); }
  };

  ui();
  P.status().then((s) => { live = !!s.running; if (live) status('live', 'Mirroring berjalan', s.host || ''); ui(); }).catch(() => {});
  // aplikasi dibuka dari tautan klmmix:// (scan QR dengan kamera bawaan)
  P.getLaunchUrl({ consume: true }).then((d) => { const o = d && d.url ? parse('#' + d.url.replace(/^.*\?/, '')) : null; if (o) { cfg = Object.assign({}, cfg, o, { q: o.q || cfg.q, f: o.f || cfg.f, b: o.b || cfg.b }); save(cfg); ui(); start(); } else if (fromUrl) start(); }).catch(() => { if (fromUrl) start(); });
})();
