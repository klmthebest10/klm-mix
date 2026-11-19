/* KLM - update di dalam aplikasi: popup "Update tersedia" (Update sekarang / Nanti), progres unduhan, pasang & buka ulang */
'use strict';
(function (KM) {
  const h = KM.h, UI = KM.ui, S = KM.state;
  const isEl = () => !!(window.klm && window.klm.isElectron && window.klm.invoke);
  const U = KM.update = { status: { state: 'idle' }, dismissed: '' };
  const fmtMB = (b) => (b / 1048576).toFixed(b > 104857600 ? 0 : 1) + ' MB';
  let dlg = null, auto = false, timer = 0;

  const call = (ch, ...a) => window.klm.invoke(ch, ...a).catch((e) => ({ state: 'error', message: e.message }));
  U.supported = isEl;
  U.check = async function (manual) {
    if (!isEl()) { if (manual) KM.toast('Update otomatis hanya ada di versi PC (.exe)', 'info'); return null; }
    auto = !manual;
    if (manual) KM.toast('Memeriksa update…', 'info', 2000);
    const s = await call('update:check', { beta: KM.settings.updateBeta === true || /-/.test(KM.version) }); // versi uji terpasang → tetap menerima versi uji berikutnya
    if (manual && s) {
      if (s.state === 'latest') KM.toast('✓ KLM sudah versi terbaru (v' + KM.version + ')', 'ok', 4000);
      else if (s.state === 'error' || s.state === 'unsupported') KM.toast(s.message || 'Gagal memeriksa update', 'warn', 6000);
    }
    return s;
  };

  function onStatus(s) {
    U.status = s || {};
    if (U._render) U._render();
    const st = U.status.state;
    if (st === 'available') {
      if (auto && U.dismissed === U.status.version) return; // "Nanti" → tidak ditanya lagi sampai KLM dibuka ulang
      show();
    } else if (st === 'downloaded' && !dlg) show(); // disembunyikan saat mengunduh → muncul lagi saat siap dipasang
    else if (dlg && ['downloading', 'downloaded', 'error'].includes(st)) paint();
    if (st === 'downloaded' && U._installWhenReady) { U._installWhenReady = false; install(); }
  }

  // ---------- popup ----------
  function show() {
    if (dlg && document.body.contains(dlg.box)) return paint();
    const box = h('div.upd');
    const m = UI.modal('⬆ Update KLM tersedia', box, [
      { label: 'Nanti', fn: () => { U.dismissed = U.status.version || ''; dlg = null; } },
      { label: 'Update sekarang', cls: 'pri', fn: () => { start(); return false; } }
    ]);
    dlg = { box, foot: m.foot, m };
    m.onclose = () => { if (dlg && dlg.m === m) dlg = null; if (U.status.state === 'available') U.dismissed = U.status.version || ''; };
    paint();
  }
  function paint() {
    if (!dlg) return;
    const s = U.status, st = s.state;
    const head = h('div.upd-head',
      h('div.upd-ver', h('span.muted', 'v' + (s.current || KM.version)), ' → ', h('b', 'v' + (s.version || '?'))),
      s.date ? h('div.muted', 'Dirilis ' + new Date(s.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })) : null);
    const notes = s.notes ? h('div.upd-notes', s.notes) : h('div.upd-notes.muted', 'Perbaikan dan peningkatan terbaru.');
    let body;
    if (st === 'downloading') {
      body = h('div.upd-prog', h('div.upd-bar', h('i', { style: { width: (s.percent || 0) + '%' } })),
        h('div.muted', 'Mengunduh… ' + (s.percent || 0) + '%' + (s.total ? ' — ' + fmtMB(s.transferred || 0) + ' / ' + fmtMB(s.total) : '') + (s.bps ? ' • ' + fmtMB(s.bps) + '/dtk' : '')),
        h('div.muted', 'KLM tetap bisa dipakai selama mengunduh.'));
    } else if (st === 'downloaded') {
      body = h('div.upd-prog', h('div.upd-bar.done', h('i', { style: { width: '100%' } })), h('div', h('b', '✓ Update siap dipasang. '), 'KLM akan ditutup dengan aman, dipasang, lalu dibuka kembali otomatis.'));
    } else if (st === 'error') {
      body = h('div.upd-err', '⚠ ' + (s.message || 'Gagal'));
    } else if (st === 'opened') {
      body = h('div.muted', 'Halaman unduhan dibuka di browser. Jalankan file yang terunduh untuk memperbarui.');
    } else {
      body = h('div.muted', s.mode === 'manual' ? 'Versi portable: file versi baru akan diunduh lewat browser.' : 'Update diunduh di latar belakang lalu dipasang otomatis — tidak perlu mengunduh installer sendiri.');
    }
    dlg.box.replaceChildren(head, notes, body);
    // tombol menyesuaikan tahap
    const btns = dlg.foot ? [...dlg.foot.querySelectorAll('button')] : [];
    const later = btns.find((b) => /Nanti|Tutup|Sembunyikan/.test(b.textContent)), go = btns.find((b) => b.classList.contains('pri'));
    if (go) {
      go.disabled = st === 'downloading';
      go.textContent = st === 'downloading' ? 'Mengunduh…' : st === 'downloaded' ? 'Pasang & buka ulang' : st === 'error' ? 'Coba lagi' : st === 'opened' ? 'Buka lagi' : 'Update sekarang';
    }
    if (later) later.textContent = st === 'downloading' ? 'Sembunyikan' : 'Nanti';
  }

  async function start() {
    const s = U.status;
    if (s.state === 'downloaded') return install();
    if (s.state === 'downloading') return;
    if (s.mode === 'manual') { await call('update:download'); return; }
    U._installWhenReady = false;
    const r = await call('update:download');
    if (r && r.state === 'downloaded') paint();
  }
  async function install() {
    const busy = [S.recording && 'rekaman', S.streaming && 'streaming', S.srt && 'SRT', S.multicorder && 'MultiCorder'].filter(Boolean);
    if (busy.length && !(await UI.confirm('Sedang berjalan: ' + busy.join(', ') + '. Untuk memasang update, KLM akan menghentikannya dengan aman (file rekaman tetap tersimpan). Lanjutkan?', 'Pasang update'))) return;
    // urutan penutupan normal: tawarkan simpan preset → akhiri rekaman/live dengan benar → lepas perangkat
    let r = 'ok';
    try { if (KM.ui.requestClose) r = await KM.ui.requestClose(); } catch (e) {}
    if (r === 'cancel') { KM.toast('Pemasangan update dibatalkan — bisa dipasang nanti dari Bantuan → Periksa update', 'info', 6000); return; }
    const x = await call('update:install');
    if (x && x.ok === false) KM.toast(x.reason || 'Gagal memasang update', 'warn');
  }

  // ---------- panel di Pengaturan → Tentang & dialog Bantuan ----------
  U.panel = function () {
    const box = h('div.sec');
    const render = () => {
      const s = U.status, st = s.state;
      const line = !isEl() ? 'Update otomatis hanya tersedia di versi PC (.exe).'
        : st === 'checking' ? 'Memeriksa…' : st === 'latest' ? '✓ Sudah versi terbaru' : st === 'available' ? 'Versi baru tersedia: v' + s.version
        : st === 'downloading' ? 'Mengunduh v' + s.version + '… ' + (s.percent || 0) + '%' : st === 'downloaded' ? 'v' + s.version + ' siap dipasang'
        : st === 'error' || st === 'unsupported' ? '⚠ ' + (s.message || 'Gagal') : 'Belum diperiksa';
      box.replaceChildren(h('h4', 'Update aplikasi'),
        h('div', 'Versi terpasang: ', h('b', 'v' + KM.version), ' — ', h('span.muted', line)),
        isEl() ? h('div.row', { style: { marginTop: '8px', gap: '8px', display: 'flex', alignItems: 'center', flexWrap: 'wrap' } },
          h('button.btn.pri', { onclick: () => (['available', 'downloading', 'downloaded'].includes(U.status.state) ? show() : U.check(true)) }, ['available', 'downloaded'].includes(st) ? 'Lihat update' : 'Periksa update'),
          h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: KM.settings.autoUpdate !== false, onchange: (e) => { KM.settings.autoUpdate = e.target.checked; KM.saveSettings(); schedule(); } }), 'Periksa update otomatis saat KLM dibuka'),
          h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' }, title: 'Versi uji berisi fitur terbaru yang belum dirilis untuk semua pengguna. Bisa kurang stabil.' }, h('input', { type: 'checkbox', checked: KM.settings.updateBeta === true, onchange: (e) => { KM.settings.updateBeta = e.target.checked; KM.saveSettings(); } }), 'Ikut versi uji (beta)')) : null);
    };
    U._render = render; render();
    return box;
  };

  // ---------- jadwal pemeriksaan otomatis ----------
  function schedule() {
    clearInterval(timer);
    if (!isEl() || KM.settings.autoUpdate === false) return;
    timer = setInterval(() => U.check(false), 6 * 3600e3); // KLM sering dibiarkan menyala lama saat acara
  }
  function boot() {
    if (!isEl()) return;
    window.klm.on('update:status', onStatus);
    call('update:info').then((s) => { if (s && s.state && s.state !== 'idle') onStatus(s); });
    if (KM.settings.autoUpdate !== false) setTimeout(() => U.check(false), 25000); // setelah aplikasi selesai dibuka
    schedule();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
})(window.KM);
