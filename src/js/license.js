/* KLM Mix - lisensi per perangkat: status, aktivasi, mode DEMO (watermark di Program) */
'use strict';
(function (KM) {
  const h = KM.h, UI = KM.ui;
  const L = KM.license = { status: null, demo: true, checked: false };
  const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

  L.set = function (st) {
    L.status = st || null;
    L.demo = !(st && st.licensed);
    L.checked = true;
    wm = null; // gambar ulang watermark
    if (KM.engine) KM.engine.dirtyAt = KM.now();
    badge();
    KM.changed && KM.changed('license');
  };
  L.refresh = async function () {
    try { const r = await fetch('/api/license', { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); L.set(await r.json()); }
    catch (e) { L.set({ licensed: false, demo: true, deviceId: '', reason: 'Server lisensi tidak tersedia (jalankan versi PC KLM Mix)' }); }
    return L.status;
  };
  async function post(path, body) {
    try { const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); return await r.json(); }
    catch (e) { return { ok: false, reason: 'Tidak bisa menghubungi KLM Mix: ' + e.message }; }
  }
  L.activate = async function (key) {
    const r = await post('/api/license/activate', { key: String(key || '').trim() });
    if (r.status) L.set(r.status);
    return r;
  };
  L.remove = async function () { const r = await post('/api/license/remove'); if (r.status) L.set(r.status); return r; };

  // ---------- watermark DEMO (digambar engine di atas Program → ikut rekaman, streaming, SRT, NDI, output eksternal) ----------
  let wm = null;
  function buildWm(W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d'), u = Math.min(W, H) / 1080;
    // label pojok kanan bawah
    const fs = Math.round(34 * u), pad = Math.round(18 * u), text = 'KLM MIX • VERSI DEMO';
    x.font = '800 ' + fs + 'px "Plus Jakarta Sans","Segoe UI",Arial,sans-serif';
    const tw = x.measureText(text).width, bw = tw + pad * 2, bh = fs + pad * 1.3;
    const bx = W - bw - Math.round(36 * u), by = H - bh - Math.round(36 * u);
    x.fillStyle = 'rgba(0,0,0,.55)'; x.beginPath(); (x.roundRect ? x.roundRect(bx, by, bw, bh, 10 * u) : x.rect(bx, by, bw, bh)); x.fill();
    x.fillStyle = 'rgba(255,255,255,.92)'; x.textBaseline = 'middle'; x.fillText(text, bx + pad, by + bh / 2 + 1);
    // teks samar di tengah
    x.save(); x.translate(W / 2, H / 2); x.rotate(-0.18);
    x.font = '800 ' + Math.round(96 * u) + 'px "Plus Jakarta Sans","Segoe UI",Arial,sans-serif'; x.textAlign = 'center';
    x.fillStyle = 'rgba(255,255,255,.10)'; x.fillText('KLM MIX DEMO', 0, 0);
    x.font = '700 ' + Math.round(30 * u) + 'px "Plus Jakarta Sans","Segoe UI",Arial,sans-serif'; x.fillText('Aktifkan lisensi untuk menghapus watermark', 0, 60 * u);
    x.restore();
    return c;
  }
  L.watermark = function (ctx, W, H) {
    if (!L.demo) return;
    if (!wm || wm.width !== W || wm.height !== H) wm = buildWm(W, H);
    ctx.drawImage(wm, 0, 0);
  };

  // ---------- tanda DEMO di bar atas ----------
  function badge() {
    const bar = document.querySelector('#topbar .status') || document.querySelector('#topbar');
    if (!bar) return;
    let b = document.getElementById('licBadge');
    if (!L.demo) { if (b) b.remove(); return; }
    if (!b) {
      b = h('button#licBadge.st', { title: 'KLM Mix belum diaktifkan — klik untuk memasukkan kunci lisensi', onclick: () => L.dialog() }, 'DEMO');
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
      if (r.ok) { msg.style.color = '#2ecc71'; msg.textContent = '✓ Lisensi aktif. Terima kasih!'; KM.toast('Lisensi KLM Mix aktif — watermark dihapus', 'ok', 5000); setTimeout(() => render(), 600); }
      else { msg.style.color = '#ff6b6b'; msg.textContent = r.reason || 'Aktivasi gagal'; }
    };
    function render() {
      const s = L.status || {};
      const head = s.licensed
        ? h('div.sec', h('h4', '✓ Lisensi aktif'),
            h('div', 'Pemilik: ', h('b', s.name || '—')), s.plan ? h('div', 'Paket: ', h('b', s.plan)) : null,
            h('div', 'Terbit: ', fmtDate(s.issued)), h('div', 'Berlaku: ', h('b', s.expires ? 'sampai ' + fmtDate(s.expires) : 'selamanya')),
            s.serial ? h('div.muted', 'Nomor lisensi: ' + s.serial) : null)
        : h('div.sec', h('h4', 'KLM Mix belum diaktifkan (mode DEMO)'),
            h('p', 'Semua fitur bisa dicoba, tetapi output Program (rekaman, streaming, SRT, NDI, layar eksternal) diberi watermark "VERSI DEMO".'),
            s.reason && s.reason !== 'Belum diaktifkan' ? h('p', { style: { color: '#ff9f43', fontWeight: '700' } }, s.reason) : null);
      box.replaceChildren(head,
        h('div.sec', h('h4', 'Device ID komputer ini'), idBox,
          h('p.muted', 'Kirim Device ID ini ke penjual untuk mendapatkan kunci lisensi. Satu lisensi hanya berlaku untuk satu komputer.')),
        s.licensed
          ? h('div.sec', h('button.btn', { onclick: async () => { if (confirm('Hapus lisensi dari komputer ini? KLM Mix akan kembali ke mode DEMO.')) { await L.remove(); render(); } } }, 'Hapus lisensi dari komputer ini'))
          : h('div.sec', h('h4', 'Masukkan kunci lisensi'), keyIn, fileIn,
              h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' } },
                h('button.btn.pri', { onclick: doActivate }, 'Aktifkan'),
                h('button.btn', { onclick: () => fileIn.click() }, 'Buka file .klmlic…'), msg)));
    }
    render();
    L._render = render;
    return box;
  };
  L.dialog = async function () {
    await L.refresh();
    UI.modal('🔑 Lisensi KLM Mix', L.panel(), [{ label: L.demo ? 'Lanjut mode demo' : 'Tutup', cls: L.demo ? '' : 'pri' }]);
  };

  // cek saat aplikasi dibuka; tanpa lisensi → dialog muncul sekali (setelah antarmuka siap)
  async function boot() {
    await L.refresh();
    if (L.demo && !/[?&]nolicprompt/.test(location.search)) setTimeout(() => { if (!document.querySelector('.modal')) L.dialog(); }, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else setTimeout(boot, 0);
})(window.KM);
