/* KLM - lisensi per perangkat (seumur hidup).
 * Tanpa lisensi KLM berjalan normal tanpa watermark; fitur premium (UTC Acara, UTC Score, Mirroring HP, KLMCAM)
 * terkunci — bila diklik, dialog lisensi muncul. */
'use strict';
(function (KM) {
  const h = KM.h, UI = KM.ui;
  const pre = window.KLM_LIC || null; // disisipkan server ke halaman → status sudah benar sejak awal
  const L = KM.license = { status: pre, demo: !(pre && pre.licensed), checked: !!pre };
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

  /** lisensi pemilik KLM (fitur khusus pemilik, mis. Layar TV Masjid) — ditentukan server dari lisensi bertanda tangan */
  L.owner = () => !!(L.status && L.status.licensed && L.status.owner);
  L.set = function (st) {
    const wasDemo = L.demo;
    L.status = st || null;
    L.demo = !(st && st.licensed);
    L.checked = true;
    badge();
    document.body && document.body.classList.toggle('lic-locked', L.demo);
    try { if (KM.state && !KM.state.inputs.length && KM.changed) KM.changed('inputs'); } catch (e) {}
    KM.changed && KM.changed('license');
    // status berubah → muat ulang panel UTC DAN renderer grafis UTC di Program (sebelumnya masih menampilkan halaman "terkunci")
    if (wasDemo !== L.demo) setTimeout(() => {
      try { KM.ui && KM.ui.reloadUtcFrames && KM.ui.reloadUtcFrames(); } catch (e) {}
      try { KM.utc && KM.utc.reload && KM.utc.reload(); } catch (e) {}
      try { KM.score && KM.score.reload && KM.score.reload(); } catch (e) {}
    }, 300);
  };
  L.refresh = async function () {
    try { const r = await fetch('/api/license', { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); L.set(await r.json()); }
    catch (e) { // gangguan sesaat tidak mengunci fitur yang sudah berlisensi
      if (!(L.status && L.status.licensed)) L.set({ licensed: false, demo: true, deviceId: '', reason: 'Server lisensi tidak tersedia (jalankan versi PC KLM)' });
    }
    return L.status;
  };
  async function post(path, body) {
    try { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return await r.json(); }
    catch (e) { return { ok: false, reason: 'Tidak bisa menghubungi KLM: ' + e.message }; }
  }
  L.activate = async function (key) {
    const r = await post('/api/license/activate', { key: String(key || '').trim() });
    if (r.status) L.set(r.status);
    return r;
  };
  L.online = async function (email) {
    const r = await post('/api/license/online', { email: String(email || '').trim() });
    if (r.status) L.set(r.status);
    return r;
  };
  L.BUY_URL = 'https://lynk.id/kholillini';
  L.remove = async function () { const r = await post('/api/license/remove'); if (r.status) L.set(r.status); return r; };

  // ---------- fitur premium yang terkunci tanpa lisensi ----------
  const FEAT = {
    utc: 'UTC Acara', score: 'UTC Score', mirror: 'Mirroring HP', klmcam: 'KLMCAM'
  };
  L.FEAT = FEAT;
  /** true bila fitur (jenis input) terkunci karena belum ada lisensi */
  L.locked = (f) => !!FEAT[f] && L.demo;
  /** dipanggil saat fitur terkunci diklik: tampilkan dialog lisensi. Mengembalikan true bila terkunci. */
  L.require = function (f) {
    if (!L.locked(f)) return false;
    KM.toast('🔒 ' + (FEAT[f] || 'Fitur ini') + ' memerlukan lisensi KLM', 'warn', 4000);
    L.dialog(FEAT[f]);
    return true;
  };

  // ---------- tanda DEMO di bar atas ----------
  function badge() {
    const bar = document.querySelector('#topbar .status') || document.querySelector('#topbar');
    if (!bar) return;
    let b = document.getElementById('licBadge');
    if (!L.demo) { if (b) b.remove(); return; }
    if (!b) {
      b = h('button#licBadge.st', { title: 'KLM belum diaktifkan — UTC Acara, UTC Score, Mirroring HP & KLMCAM terkunci. Klik untuk memasukkan kunci lisensi', onclick: () => L.dialog() }, '🔒 Aktifkan');
      Object.assign(b.style, { background: 'linear-gradient(180deg,#e07a17,#b85f0d)', color: '#fff', border: '0', fontWeight: '800', cursor: 'pointer', borderRadius: '7px', padding: '0 10px', height: '28px', flex: 'none', whiteSpace: 'nowrap', letterSpacing: '1px' });
      bar.insertBefore(b, bar.firstChild);
    }
  }

  // ---------- dialog lisensi ----------
  function copy(text) {
    const done = () => KM.toast('Device ID disalin', 'ok');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
    else fallback();
    function fallback() { const t = h('textarea', { value: text }); document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) {} t.remove(); }
  }
  L.panel = function () {
    const st = L.status || {};
    const box = h('div');
    const idBox = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      h('code', { style: { fontSize: '17px', fontWeight: '800', letterSpacing: '1px', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: '8px', userSelect: 'all' } }, st.deviceId || '—'),
      st.deviceId ? h('button.btn', { onclick: () => copy(st.deviceId) }, 'Salin') : null);
    const keyIn = h('textarea', { rows: 4, placeholder: 'Tempel kunci lisensi di sini (diawali KLM1.)', style: { width: '100%', fontFamily: 'var(--mono)', fontSize: '12px' } });
    const fileIn = h('input', { type: 'file', accept: '.klmlic,.txt', style: { display: 'none' }, onchange: async () => { const f = fileIn.files[0]; if (f) keyIn.value = (await f.text()).trim(); } });
    const msg = h('div', { style: { minHeight: '20px', fontWeight: '700' } });
    const doActivate = async () => {
      msg.style.color = 'var(--tx2)'; msg.textContent = 'Memeriksa…';
      const r = await L.activate(keyIn.value);
      if (r.ok) { msg.style.color = '#2ecc71'; msg.textContent = '✓ Lisensi aktif. Terima kasih!'; KM.toast('Lisensi KLM aktif — semua fitur terbuka', 'ok', 5000); setTimeout(() => render(), 600); }
      else { msg.style.color = '#ff6b6b'; msg.textContent = r.reason || 'Aktivasi gagal'; }
    };
    const mailIn = h('input', { type: 'email', placeholder: 'Email yang dipakai saat membeli di lynk.id', style: { flex: '1', minWidth: '220px' } });
    const msg2 = h('div', { style: { minHeight: '20px', fontWeight: '700', marginTop: '6px' } });
    const doOnline = async () => {
      msg2.style.color = 'var(--tx2)'; msg2.textContent = 'Menghubungi server lisensi…';
      const r = await L.online(mailIn.value);
      if (r.ok) { msg2.style.color = '#2ecc71'; msg2.textContent = '✓ Lisensi aktif. Terima kasih!'; KM.toast('Lisensi KLM aktif — semua fitur terbuka', 'ok', 5000); setTimeout(() => render(), 600); }
      else { msg2.style.color = '#ff6b6b'; msg2.textContent = r.reason || 'Aktivasi gagal'; }
    };
    const openBuy = () => window.open(L.BUY_URL, '_blank'); // Electron membukanya di browser bawaan
    function render() {
      const s = L.status || {};
      const head = s.licensed
        ? h('div.sec', h('h4', '✓ Lisensi aktif'),
            h('div', 'Pemilik: ', h('b', s.name || '—')), s.plan ? h('div', 'Paket: ', h('b', s.plan)) : null,
            h('div', 'Terbit: ', fmtDate(s.issued)), h('div', 'Berlaku: ', h('b', s.expires ? 'sampai ' + fmtDate(s.expires) : 'seumur hidup')),
            s.serial ? h('div.muted', 'Nomor lisensi: ' + s.serial) : null)
        : h('div.sec', h('h4', (L._want ? '🔒 ' + L._want + ' memerlukan lisensi' : 'KLM belum diaktifkan')),
            h('p', 'KLM tetap bisa dipakai seperti biasa tanpa watermark. Fitur premium berikut terbuka setelah lisensi diaktifkan:'),
            h('ul', { style: { margin: '4px 0 8px 18px' } }, Object.values(FEAT).map((t) => h('li', h('b', t)))),
            h('p.muted', 'Lisensi dibeli sekali, berlaku seumur hidup untuk komputer ini — termasuk setelah install ulang Windows (cukup masukkan kunci yang sama lagi).'),
            s.reason && s.reason !== 'Belum diaktifkan' ? h('p', { style: { color: '#ff9f43', fontWeight: '700' } }, s.reason) : null);
      box.replaceChildren(head,
        h('div.sec', h('h4', 'Device ID komputer ini'), idBox,
          h('p.muted', 'Satu lisensi berlaku untuk satu komputer. Aktivasi otomatis memakai Device ID ini; bila perlu bantuan, kirim Device ID ke penjual.')),
        s.licensed
          ? h('div.sec', h('button.btn', { onclick: async () => { if (confirm('Hapus lisensi dari komputer ini? UTC Acara, UTC Score, Mirroring HP & KLMCAM akan terkunci lagi.')) { await L.remove(); render(); } } }, 'Hapus lisensi dari komputer ini'))
          : h('div', h('div.sec', h('h4', '⚡ Aktivasi otomatis (sudah membeli)'),
              h('p.muted', 'Masukkan email yang Anda pakai saat membeli lisensi di lynk.id. Perlu internet sekali ini saja; setelah aktif KLM berjalan offline.'),
              h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
                mailIn, h('button.btn.pri', { onclick: doOnline }, 'Aktifkan otomatis'),
                h('button.btn', { onclick: openBuy }, '🛒 Beli lisensi (Rp100.000)')), msg2),
            h('div.sec', h('h4', 'Atau masukkan kunci lisensi'), keyIn, fileIn,
              h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' } },
                h('button.btn.pri', { onclick: doActivate }, 'Aktifkan'),
                h('button.btn', { onclick: () => fileIn.click() }, 'Buka file .klmlic…'), msg))));
    }
    render();
    L._render = render;
    return box;
  };
  L.dialog = async function (want) {
    L._want = want || '';
    await L.refresh();
    document.querySelectorAll('.modal-bg.lic-dlg').forEach((m) => m.remove());
    const m = UI.modal('🔑 Lisensi KLM', L.panel(), [{ label: 'Tutup', cls: L.demo ? '' : 'pri' }]);
    try { (m && m.closest ? m.closest('.modal-bg') : document.querySelector('.modal-bg:last-of-type')).classList.add('lic-dlg'); } catch (e) {}
    L._want = '';
  };

  // cek status saat aplikasi dibuka (tanpa memunculkan dialog: KLM tetap bisa dipakai normal)
  async function boot() { await L.refresh(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
})(window.KM);
