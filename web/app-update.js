/* KLM HP - pemberitahuan update aplikasi (APK).
 * Hanya aktif di aplikasi Android (Capacitor). Memeriksa rilis terbaru di GitHub; bila ada versi lebih baru muncul popup
 * "Update sekarang" / "Nanti". Update sekarang → APK diunduh di dalam aplikasi (ada progres) lalu penginstal Android terbuka.
 * Halaman HP yang dibuka dari browser (alamat PC) selalu versi terbaru dari PC, jadi tidak perlu diperiksa. */
(function () {
  'use strict';
  const REPO = '__RELEASE_REPO__'; // diisi mobile/prepare.js saat build APK
  const C = window.Capacitor;
  const native = !!(C && (C.isNativePlatform ? C.isNativePlatform() : C.platform === 'android'));
  const P = C && C.Plugins && C.Plugins.KlmUpdater;
  if (!native || !P || !/^[\w.-]+\/[\w.-]+$/.test(REPO)) return;

  const KEY_LAST = 'klmhp.update.last', EVERY = 6 * 3600e3;
  let busy = false, shownFor = '';
  // urutan versi: 1.18.0 > 1.18.0-beta.15 > 1.18.0-beta.14 > 1.17.1
  const cmp = (a, b) => {
    const p = (v) => { const [m, pre] = String(v).replace(/^v/, '').split('-'); return { n: m.split('.').map((n) => parseInt(n, 10) || 0), pre: pre || '', pn: parseInt((/(\d+)$/.exec(pre || '') || [])[1], 10) || 0 }; };
    const x = p(a), y = p(b);
    for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) > (y.n[i] || 0) ? 1 : -1;
    if (!x.pre !== !y.pre) return x.pre ? -1 : 1;
    return x.pn === y.pn ? 0 : x.pn > y.pn ? 1 : -1;
  };
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mb = (b) => (b / 1048576).toFixed(1) + ' MB';

  function css() {
    if (document.getElementById('klmupd-css')) return;
    const s = document.createElement('style'); s.id = 'klmupd-css';
    s.textContent = '.klmupd-bg{position:fixed;inset:0;background:rgba(3,8,12,.72);display:flex;align-items:flex-end;justify-content:center;z-index:9999;padding:16px}'
      + '.klmupd{width:100%;max-width:440px;background:#121722;border:1px solid #263042;border-radius:18px;padding:18px 16px 14px;color:#e9edf5;font:14px/1.5 system-ui,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.5)}'
      + '.klmupd h3{margin:0 0 4px;font-size:17px}.klmupd .v{font-size:15px;margin-bottom:8px}.klmupd .v b{color:#16e0c6}'
      + '.klmupd .n{white-space:pre-wrap;max-height:34vh;overflow:auto;background:#0b0f16;border:1px solid #222b3a;border-radius:10px;padding:9px 11px;font-size:13px;color:#c9d1de}'
      + '.klmupd .bar{height:8px;border-radius:6px;background:#1d2533;overflow:hidden;margin:12px 0 4px}.klmupd .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#d4ff3f,#16e0c6);transition:width .3s}'
      + '.klmupd .m{color:#9aa4b5;font-size:12.5px;min-height:18px;margin-top:6px}.klmupd .b{display:flex;gap:10px;margin-top:14px}'
      + '.klmupd button{flex:1;border:0;border-radius:12px;padding:12px;font:inherit;font-weight:800;background:#1e2635;color:#e9edf5}.klmupd button.p{background:linear-gradient(180deg,#22c7ad,#119d88);color:#fff}.klmupd button:disabled{opacity:.55}';
    document.head.appendChild(s);
  }

  function show(cur, rel) {
    if (document.querySelector('.klmupd-bg')) return;
    css(); shownFor = rel.version;
    const bg = document.createElement('div'); bg.className = 'klmupd-bg';
    bg.innerHTML = '<div class="klmupd"><h3>⬆ Update KLM HP tersedia</h3>'
      + '<div class="v">v' + esc(cur) + ' → <b>v' + esc(rel.version) + '</b></div>'
      + '<div class="n">' + esc(rel.notes || 'Perbaikan dan peningkatan terbaru.') + '</div>'
      + '<div class="bar" hidden><i></i></div><div class="m"></div>'
      + '<div class="b"><button class="later">Nanti</button><button class="p go">Update sekarang</button></div></div>';
    document.body.appendChild(bg);
    const $ = (s) => bg.querySelector(s), msg = (t) => { $('.m').textContent = t; };
    $('.later').onclick = () => { if (!busy) bg.remove(); };
    let path = '';
    $('.go').onclick = async () => {
      if (busy) return;
      const go = $('.go');
      // sudah terunduh → buka penginstal (lagi), mis. setelah memberi izin
      if (path) return install();
      busy = true; go.disabled = true; go.textContent = 'Mengunduh…'; $('.bar').hidden = false; $('.later').disabled = true;
      let h;
      try {
        h = await P.addListener('progress', (p) => { $('.bar i').style.width = (p.percent || 0) + '%'; msg('Mengunduh… ' + (p.percent || 0) + '%' + (p.total > 0 ? ' — ' + mb(p.done) + ' / ' + mb(p.total) : '')); });
        const r = await P.download({ url: rel.url, version: 'v' + rel.version });
        path = r.path; $('.bar i').style.width = '100%';
        await install();
      } catch (e) {
        msg('⚠ ' + ((e && e.message) || 'Gagal mengunduh') + ' — coba lagi, atau unduh lewat browser.');
        go.textContent = 'Coba lagi';
      } finally {
        busy = false; go.disabled = false; $('.later').disabled = false;
        try { h && h.remove(); } catch (x) {}
      }
    };
    async function install() {
      const go = $('.go');
      try {
        const r = await P.install();
        if (r && r.needPermission) { msg('Izinkan "Pasang aplikasi tak dikenal" untuk KLM HP di pengaturan yang terbuka, lalu kembali dan ketuk "Pasang".'); go.textContent = 'Pasang'; return; }
        msg('Ikuti penginstal Android. Pengaturan & data KLM HP tetap tersimpan.'); go.textContent = 'Pasang lagi';
      } catch (e) {
        msg('⚠ ' + ((e && e.message) || 'Tidak bisa membuka penginstal'));
        try { await P.openUrl({ url: rel.url }); } catch (x) {}
      }
    }
  }

  async function check(force) {
    try {
      const last = +localStorage.getItem(KEY_LAST) || 0;
      if (!force && Date.now() - last < EVERY) return;
      localStorage.setItem(KEY_LAST, String(Date.now()));
      const info = await P.info();
      const cur = info && info.version; if (!cur) return;
      // versi uji (beta) terpasang → versi uji terbaru juga ditawarkan; versi stabil hanya ditawari rilis stabil
      const beta = String(cur).includes('-');
      const r = await fetch('https://api.github.com/repos/' + REPO + '/releases' + (beta ? '?per_page=15' : '/latest'), { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!r.ok) return;
      let j = await r.json();
      if (beta) j = (Array.isArray(j) ? j : []).filter((x) => !x.draft && (x.assets || []).some((a) => /\.apk$/i.test(a.name))).sort((p, q) => cmp(q.tag_name, p.tag_name))[0] || {};
      const v = String(j.tag_name || '').replace(/^v/, '');
      const apk = (j.assets || []).find((a) => /\.apk$/i.test(a.name));
      if (!v || !apk || cmp(v, cur) <= 0 || v === shownFor) return;
      show(cur, { version: v, url: apk.browser_download_url, notes: String(j.body || '').replace(/\*\*/g, '').trim().slice(0, 3000) });
    } catch (e) { /* tanpa internet: diam saja */ }
  }

  // setelah aplikasi dibuka, dan saat aplikasi kembali dibuka dari latar belakang (paling sering tiap 6 jam)
  setTimeout(() => check(true), 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(false); });
  window.KLMHPUpdate = { check: () => check(true) };
})();
