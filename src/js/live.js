/* KLM Mix - Akun live streaming (YouTube, Facebook, TikTok, Instagram, RTMP lain) & live bersamaan.
 * Akun bisa lebih dari satu per platform; centang akun mana yang ikut live. Judul, deskripsi & thumbnail
 * dipasang otomatis lewat API (YouTube: judul+deskripsi+thumbnail+privasi; Facebook: judul+deskripsi);
 * TikTok & Instagram tidak punya API publik → server + stream key, judul disalin ke halaman live mereka. */
'use strict';
(function (KM) {
  const h = KM.h, S = KM.state;
  const L = KM.live = { auth: {}, session: null };
  const PLAT = {
    youtube: { name: 'YouTube', color: '#ff2a2a', icon: 'play', server: 'rtmp://a.rtmp.youtube.com/live2', api: true, studio: 'https://www.youtube.com/live_dashboard',
      keyNote: 'Stream key YouTube tetap (YouTube Studio → Siaran langsung → Kunci streaming).' },
    facebook: { name: 'Facebook', color: '#1877f2', icon: 'users', server: 'rtmps://live-api-s.facebook.com:443/rtmp/', api: true, studio: 'https://www.facebook.com/live/producer',
      keyNote: 'Pakai "kunci streaming permanen" di Live Producer agar tidak perlu diganti tiap live.' },
    tiktok: { name: 'TikTok', color: '#25f4ee', icon: 'music', server: '', session: true, studio: 'https://livecenter.tiktok.com/producer',
      keyNote: 'Server URL & stream key diambil di TikTok LIVE Producer (livecenter.tiktok.com/producer) — isi judul di sana. Butuh akun yang diizinkan live dari PC.' },
    instagram: { name: 'Instagram', color: '#e1306c', icon: 'camera', server: '', session: true, studio: 'https://www.instagram.com/',
      keyNote: 'Instagram (akun profesional) di PC: Buat → Video live → isi judul → salin Stream URL & key. Key BERUBAH setiap live.' },
    custom: { name: 'RTMP / SRT lain', color: '#8a93a5', icon: 'globe', server: 'rtmp://', studio: '', keyNote: 'Server lain: Twitch, Kick, Vimeo, Restream, server RTMP sendiri, SRT.' }
  };
  L.PLAT = PLAT;
  const uid = () => 'acc' + Math.random().toString(36).slice(2, 9);

  function cfg() {
    const st = KM.settings;
    if (!st.live || typeof st.live !== 'object') st.live = {};
    const c = st.live;
    c.meta = Object.assign({ title: '', desc: '', thumb: '', privacy: 'public' }, c.meta || {});
    if (!Array.isArray(c.accounts)) {
      // pindahkan tujuan lama (Pengaturan → Streaming) menjadi akun
      c.accounts = ((st.stream && st.stream.destinations) || []).filter((d) => (d.key || '').trim() || (d.url && d.url !== 'rtmp://' && d.name === 'Custom')).map((d) => {
        const u = String(d.url || '');
        const platform = /youtube/i.test(u) ? 'youtube' : /facebook|fbcdn/i.test(u) ? 'facebook' : /tiktok/i.test(u) ? 'tiktok' : 'custom';
        return { id: uid(), platform, name: d.name || PLAT[platform].name, url: u, key: d.key || '', on: !!d.enabled, mode: 'key' };
      });
      KM.saveSettings();
    }
    return c;
  }
  L.cfg = cfg;
  const save = () => KM.saveSettings();
  L.selected = () => cfg().accounts.filter((a) => a.on);
  L.apiReady = (a) => a.mode === 'api' && !!L.auth[a.id];
  L.refreshAuth = async () => { if (KM.isElectron) { try { L.auth = (await window.klm.invoke('live:auth-list')) || {}; } catch (e) {} } return L.auth; };

  function joinKey(url, key) {
    url = String(url || '').trim(); key = String(key || '').trim();
    if (!key) return url;
    if (/^srt:/i.test(url)) return url + (url.includes('?') ? '&' : '?') + 'streamid=' + encodeURIComponent(key);
    return url.replace(/\/+$/, '') + '/' + key;
  }
  L.joinKey = joinKey;
  const label = (a) => (a.name || PLAT[a.platform].name);

  /** dipanggil Mulai Streaming → {dests, order} atau null (batal) */
  L.prepare = async function () {
    const sel = L.selected();
    if (!sel.length) { KM.toast('Belum ada akun yang dipilih — centang akun di panel Live', 'warn', 5000); KM.ui && KM.ui.dockTab('live'); return null; }
    const meta = cfg().meta, api = sel.filter(L.apiReady), man = sel.filter((a) => !L.apiReady(a));
    const out = [], status = {}, watch = {}, refs = [], problems = [];
    for (const a of man) {
      if (a.mode === 'api') { problems.push(label(a) + ': belum terhubung API'); status[a.id] = 'error'; continue; }
      if (!String(a.url || '').trim() || (!String(a.key || '').trim() && !/^srt:/i.test(a.url))) { problems.push(label(a) + ': server / stream key kosong'); status[a.id] = 'error'; continue; }
      out.push({ acc: a, url: joinKey(a.url, a.key) });
    }
    if (api.length) {
      L.session = { preparing: true, status: Object.fromEntries(api.map((a) => [a.id, 'menyiapkan'])) }; KM.changed('live');
      KM.toast('Menyiapkan siaran di ' + api.map(label).join(', ') + '…', 'info', 3000);
      const res = await window.klm.invoke('live:prepare', api.map((a) => ({ accId: a.id, platform: a.platform })), { title: meta.title, desc: meta.desc, thumb: meta.thumb, privacy: meta.privacy });
      for (const r of res || []) {
        const a = api.find((x) => x.id === r.accId); if (!a) continue;
        if (r.ok) { out.push({ acc: a, url: r.url }); refs.push({ accId: a.id, ref: r.ref }); if (r.watch) watch[a.id] = r.watch; if (r.warn) problems.push(label(a) + ': ' + r.warn); }
        else { status[a.id] = 'error'; problems.push(label(a) + ': ' + r.error); }
      }
    }
    if (!out.length) {
      L.session = null; KM.changed('live');
      KM.toast('Live dibatalkan — ' + problems.join(' • '), 'err', 9000);
      return null;
    }
    if (problems.length) KM.toast(problems.join(' • '), 'warn', 9000);
    out.forEach((o) => { status[o.acc.id] = 'menyambung'; });
    L.session = { order: out.map((o) => o.acc.id), status, watch, refs, t0: Date.now(), errors: {} };
    KM.changed('live');
    return { dests: out.map((o) => ({ enabled: true, url: o.url })), order: L.session.order };
  };
  /** status per tujuan dari log ffmpeg (tee: "Slave muxer #N failed") */
  KM.on('stream-log', (msg) => {
    const s = L.session; if (!s || !s.order) return;
    const m = /Slave muxer #(\d+) failed:?\s*([^,\n]*)/.exec(msg);
    if (m && s.order[+m[1]]) { const id = s.order[+m[1]]; s.status[id] = 'error'; s.errors[id] = m[2] || 'terputus'; KM.toast('Live ke ' + label(cfg().accounts.find((a) => a.id === id) || {}) + ' gagal: ' + (m[2] || 'terputus') + ' — tujuan lain tetap jalan', 'err', 7000); KM.changed('live'); }
  });
  KM.on('stream-stats', () => { const s = L.session; if (!s || !s.order) return; let ch = false; s.order.forEach((id) => { if (s.status[id] === 'menyambung') { s.status[id] = 'live'; ch = true; } }); if (ch) KM.changed('live'); });
  L.finish = async function () {
    const s = L.session; L.session = null; KM.changed('live');
    if (s && s.refs && s.refs.length && KM.isElectron) { try { await window.klm.invoke('live:end', s.refs); } catch (e) {} }
  };

  // ---------------- thumbnail ----------------
  async function toThumb(src) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('gambar tidak bisa dibuka')); i.src = src; });
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    const g = c.getContext('2d'), sc = Math.max(1280 / img.width, 720 / img.height), w = img.width * sc, hh = img.height * sc;
    g.fillStyle = '#000'; g.fillRect(0, 0, 1280, 720); g.drawImage(img, (1280 - w) / 2, (720 - hh) / 2, w, hh);
    let q = 0.88, d = c.toDataURL('image/jpeg', q);
    while (d.length > 1.9e6 * 1.37 && q > 0.4) { q -= 0.1; d = c.toDataURL('image/jpeg', q); } // batas YouTube 2 MB
    return d;
  }
  L.pickThumb = () => new Promise((res) => {
    const f = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onchange: async () => {
      const file = f.files[0]; if (!file) return res(false);
      const url = URL.createObjectURL(file);
      try { cfg().meta.thumb = await toThumb(url); save(); res(true); } catch (e) { KM.toast(e.message, 'err'); res(false); } finally { URL.revokeObjectURL(url); }
    } });
    f.click();
  });
  L.thumbFromProgram = async () => {
    const b = await KM.engine.snapshot(); const url = URL.createObjectURL(b);
    try { cfg().meta.thumb = await toThumb(url); save(); KM.toast('Thumbnail diambil dari Program', 'ok'); } finally { URL.revokeObjectURL(url); }
  };
  const copy = async (txt, what) => { try { await navigator.clipboard.writeText(txt || ''); KM.toast(what + ' disalin', 'ok'); } catch (e) { KM.toast('Gagal menyalin', 'err'); } };
  const openUrl = (u) => { if (u) window.open(u, '_blank'); };

  // ---------------- dialog akun ----------------
  L.editAccount = function (acc, platform) {
    const c = cfg(), isNew = !acc;
    const a = acc ? Object.assign({}, acc) : { id: uid(), platform: platform || 'youtube', name: '', url: PLAT[platform || 'youtube'].server, key: '', on: true, mode: 'key' };
    const P = () => PLAT[a.platform];
    const body = h('div.liveacc');
    let authInfo = L.auth[a.id] || null;
    const draw = () => {
      const p = P();
      const keyIn = h('input.grow', { type: 'password', value: a.key || '', placeholder: 'Stream key', autocomplete: 'off', oninput: (e) => { a.key = e.target.value; } });
      const urlIn = h('input.grow', { value: a.url || '', placeholder: p.session ? 'Server URL dari halaman live ' + p.name : 'rtmp://server/app', oninput: (e) => { a.url = e.target.value; } });
      const paste = (inp, k) => h('button.btn.sm', { title: 'Tempel dari clipboard', onclick: async () => { try { inp.value = a[k] = (await navigator.clipboard.readText()).trim(); } catch (e) { KM.toast('Clipboard tidak bisa dibaca', 'warn'); } } }, KI.el('copy'), 'Tempel');
      const apiBox = [];
      if (p.api && a.mode === 'api') {
        if (a.platform === 'youtube') {
          const yc = c.ytApp = c.ytApp || { clientId: '', clientSecret: '' };
          const cid = h('input.grow', { value: yc.clientId, placeholder: 'xxxxx.apps.googleusercontent.com', oninput: (e) => { yc.clientId = e.target.value.trim(); } });
          const sec = h('input.grow', { type: 'password', value: yc.clientSecret, placeholder: 'Client secret', autocomplete: 'off', oninput: (e) => { yc.clientSecret = e.target.value.trim(); } });
          apiBox.push(
            h('div.krow', h('label', 'Client ID'), cid), h('div.krow', h('label', 'Client secret'), sec),
            h('div.row', authInfo ? h('span.pill.ok', 'Terhubung: ' + authInfo.name) : h('span.pill', 'belum terhubung'), h('span.grow'),
              h('button.btn.pri', { onclick: async (e) => {
                save(); e.target.disabled = true; e.target.textContent = 'Menunggu izin di browser…';
                const r = await window.klm.invoke('live:yt-connect', a.id, yc.clientId, yc.clientSecret);
                if (r.ok) { authInfo = { kind: 'yt', name: r.name }; L.auth[a.id] = authInfo; if (!a.name) a.name = r.name; KM.toast('YouTube terhubung: ' + r.name, 'ok'); } else KM.toast('Gagal: ' + r.error, 'err', 8000);
                draw();
              } }, KI.el('link'), authInfo ? 'Hubungkan ulang' : 'Masuk dengan Google')),
            h('details.guide', h('summary', 'Cara mendapatkan Client ID (sekali saja)'), h('ol',
              h('li', 'Buka console.cloud.google.com → buat project (mis. "KLM Mix").'),
              h('li', 'APIs & Services → Library → aktifkan "YouTube Data API v3".'),
              h('li', 'OAuth consent screen → External → isi nama aplikasi → tambahkan email Anda di "Test users".'),
              h('li', 'Credentials → Create credentials → OAuth client ID → jenis "Desktop app" → salin Client ID & Client secret ke sini.'),
              h('li', 'Klik "Masuk dengan Google", pilih akun/channel, izinkan. Satu Client ID bisa dipakai untuk banyak channel.'))));
        } else {
          const tok = h('input.grow', { type: 'password', placeholder: authInfo ? '(tersimpan — isi untuk mengganti)' : 'Page access token', autocomplete: 'off' });
          const tgt = h('input.grow', { value: a.fbTarget || '', placeholder: 'ID Halaman (kosong = profil sendiri)', oninput: (e) => { a.fbTarget = e.target.value.trim(); } });
          apiBox.push(
            h('div.krow', h('label', 'ID Halaman'), tgt), h('div.krow', h('label', 'Access token'), tok),
            h('div.row', authInfo ? h('span.pill.ok', 'Terhubung: ' + authInfo.name) : h('span.pill', 'belum terhubung'), h('span.grow'),
              h('button.btn.pri', { onclick: async (e) => {
                if (!tok.value.trim()) return KM.toast('Tempel access token dulu', 'warn');
                e.target.disabled = true;
                const r = await window.klm.invoke('live:fb-connect', a.id, tok.value, a.fbTarget || 'me');
                if (r.ok) { authInfo = { kind: 'fb', name: r.name }; L.auth[a.id] = authInfo; if (!a.name) a.name = r.name; KM.toast('Facebook terhubung: ' + r.name, 'ok'); } else KM.toast('Gagal: ' + r.error, 'err', 8000);
                draw();
              } }, KI.el('check'), 'Periksa & simpan')),
            h('details.guide', h('summary', 'Cara mendapatkan access token'), h('ol',
              h('li', 'developers.facebook.com → My Apps → buat aplikasi (jenis Business).'),
              h('li', 'Tools → Graph API Explorer → pilih aplikasi → "Get Page Access Token" → izinkan pages_manage_posts & pages_read_engagement (profil pribadi: publish_video).'),
              h('li', 'Pilih Halaman Anda, salin token (sebaiknya perpanjang di Access Token Debugger agar tahan lama) & ID Halaman ke sini.'),
              h('li', 'Syarat Meta: akun berumur ≥ 60 hari & Halaman ≥ 100 pengikut.'))));
        }
      }
      body.replaceChildren(
        h('div.krow', h('label', 'Platform'), h('div.platsel', Object.entries(PLAT).map(([k, v]) => h('button.btn.sm' + (a.platform === k ? '.on' : ''), { style: { '--pc': v.color }, onclick: () => {
          if (a.platform === k) return; const was = P(); a.platform = k; if (!a.url || a.url === was.server) a.url = PLAT[k].server; if (!PLAT[k].api) a.mode = 'key'; draw(); } }, h('i.pdot'), v.name)))),
        h('div.krow', h('label', 'Nama akun'), h('input.grow', { value: a.name || '', placeholder: 'mis. Channel Masjid / Halaman Acara', oninput: (e) => { a.name = e.target.value; } })),
        p.api ? h('div.krow', h('label', 'Cara terhubung'), h('div.seg',
          h('button.btn.sm' + (a.mode !== 'api' ? '.on' : ''), { onclick: () => { a.mode = 'key'; draw(); } }, 'Stream key'),
          h('button.btn.sm' + (a.mode === 'api' ? '.on' : ''), { onclick: () => { a.mode = 'api'; draw(); }, title: 'Judul, deskripsi' + (a.platform === 'youtube' ? ', thumbnail & privasi' : '') + ' dipasang otomatis tiap live' }, 'Otomatis (API) — judul dll.'))) : null,
        a.mode !== 'api' ? h('div.krow', h('label', 'Server URL'), urlIn, p.session ? paste(urlIn, 'url') : null) : null,
        a.mode !== 'api' ? h('div.krow', h('label', 'Stream key'), keyIn, h('button.btn.sm', { title: 'Lihat / sembunyikan', onclick: () => { keyIn.type = keyIn.type === 'password' ? 'text' : 'password'; } }, KI.el('eye')), p.session ? paste(keyIn, 'key') : null) : null,
        ...apiBox,
        h('p.muted.note', a.mode === 'api' ? (a.platform === 'youtube' ? 'Tiap kali live, KLM Mix membuat siaran baru di channel ini dengan judul, deskripsi, thumbnail & privasi dari panel Live, lalu mulai otomatis.' : 'Tiap kali live, KLM Mix membuat video live baru di Halaman ini dengan judul & deskripsi dari panel Live (thumbnail tidak didukung API Facebook).') : p.keyNote),
        p.studio ? h('div.row', h('button.btn.sm', { onclick: () => openUrl(p.studio) }, KI.el('external'), 'Buka halaman live ' + p.name)) : null);
    };
    draw();
    const btns = [];
    if (!isNew) btns.push({ label: 'Hapus akun', cls: 'red', fn: async () => {
      if (!(await KM.ui.confirm('Hapus akun "' + label(a) + '"?', 'Hapus'))) return false;
      c.accounts = c.accounts.filter((x) => x.id !== a.id); if (KM.isElectron) window.klm.invoke('live:forget', a.id); delete L.auth[a.id]; save(); KM.changed('live');
    } });
    btns.push({ label: 'Batal' }, { label: isNew ? 'Tambah akun' : 'Simpan', cls: 'pri', fn: () => {
      if (!a.name) a.name = P().name;
      const i = c.accounts.findIndex((x) => x.id === a.id);
      if (i >= 0) c.accounts[i] = a; else c.accounts.push(a);
      save(); KM.changed('live');
    } });
    KM.ui.modal((isNew ? 'Tambah akun live' : 'Akun live — ' + label(a)), body, btns);
  };

  // ---------------- panel samping "Live" ----------------
  const typing = (box) => { const x = document.activeElement; return x && box.contains(x) && /INPUT|TEXTAREA/.test(x.tagName) && x.type !== 'checkbox'; };
  let pend = false;
  function render() {
    const box = KM.$('#dock-live'); if (!box) return;
    if (typing(box)) { pend = true; return; }
    pend = false;
    const c = cfg(), m = c.meta, D = KM.dock.ui, live = S.streaming, ses = L.session, R = KM.rec;
    const sel = L.selected();
    const st = R.stats;
    const stTxt = (id) => { const v = ses && ses.status[id]; return v === 'live' ? ['.ok', 'LIVE'] : v === 'menyambung' || v === 'menyiapkan' ? ['.warn', v] : v === 'error' ? ['.red', 'gagal'] : null; };
    const head = D.phead('radio', 'Live Streaming', live ? 'LIVE ' + KM.fmtTime(R.streamTime()) + (st ? ' • ' + (st.bitrate || '') + (st.speed ? ' • ' + st.speed : '') : '') : sel.length ? sel.length + ' akun dipilih: ' + sel.map(label).join(', ') : 'Pilih akun yang akan live',
      h('button.btn.air' + (live ? '.on' : ''), { disabled: !KM.isElectron || (ses && ses.preparing), title: KM.isElectron ? '' : 'Streaming butuh versi PC (.exe)', onclick: () => R.toggleStreaming() }, KI.el(live ? 'stop' : 'radio'), live ? 'Akhiri live' : ses && ses.preparing ? 'Menyiapkan…' : 'Mulai live'));
    const thumb = h('div.lthumb', m.thumb ? h('img', { src: m.thumb, alt: 'thumbnail' }) : h('span.muted', 'Belum ada thumbnail (opsional)'));
    const tcount = h('span.muted.cnt', (m.title || '').length + '/100');
    const info = D.fold('lv-info', 'Judul, deskripsi & thumbnail', { wide: true, badge: m.title ? null : h('span.pill', 'opsional') },
      h('div.lmeta',
        h('label', 'Judul', tcount), h('input', { value: m.title, maxlength: 100, placeholder: 'mis. Pengajian Akbar Malam Jumat — Live', oninput: (e) => { m.title = e.target.value; tcount.textContent = m.title.length + '/100'; save(); } }),
        h('label', 'Deskripsi'), h('textarea', { rows: 4, value: m.desc, placeholder: 'Deskripsi siaran (opsional)', oninput: (e) => { m.desc = e.target.value; save(); } }),
        h('label', 'Thumbnail'), thumb,
        h('div.row', h('button.btn.sm', { onclick: async () => { if (await L.pickThumb()) render(); } }, KI.el('image'), 'Pilih gambar'),
          h('button.btn.sm', { onclick: async () => { await L.thumbFromProgram(); render(); } }, KI.el('camera'), 'Ambil dari Program'),
          m.thumb ? h('button.btn.sm', { onclick: () => { m.thumb = ''; save(); render(); } }, KI.el('x')) : null),
        h('label', 'Privasi YouTube'), h('select', { onchange: (e) => { m.privacy = e.target.value; save(); } }, [['public', 'Publik'], ['unlisted', 'Tidak publik (link saja)'], ['private', 'Pribadi']].map(([v, t]) => h('option', { value: v, selected: m.privacy === v }, t)))),
      h('div.row.lcopy', h('button.btn.sm', { onclick: () => copy(m.title, 'Judul') }, KI.el('copy'), 'Salin judul'), h('button.btn.sm', { onclick: () => copy(m.desc, 'Deskripsi') }, KI.el('copy'), 'Salin deskripsi'),
        m.thumb ? h('button.btn.sm', { onclick: () => { const x = h('a', { href: m.thumb, download: 'thumbnail-live.jpg' }); x.click(); } }, KI.el('download'), 'Simpan thumbnail') : null),
      h('p.muted.note', 'Otomatis dipasang untuk akun mode API (YouTube: judul, deskripsi, thumbnail, privasi • Facebook: judul & deskripsi). TikTok & Instagram: salin judul lalu tempel di halaman live mereka saat mengambil stream key.'));
    const card = (a) => {
      const p = PLAT[a.platform] || PLAT.custom, s = stTxt(a.id), ready = L.apiReady(a);
      const mode = a.mode === 'api' ? (ready ? h('span.pill.ok', 'API • ' + (L.auth[a.id].name || '')) : h('span.pill.red', 'API belum terhubung')) : h('span.pill', a.key ? 'key •••' + String(a.key).slice(-4) : 'key kosong');
      const quick = p.session && a.mode !== 'api' ? h('div.lsess',
        h('input', { value: a.url || '', placeholder: 'Server URL', disabled: live, oninput: (e) => { a.url = e.target.value.trim(); save(); } }),
        h('input', { type: 'password', value: a.key || '', placeholder: 'Stream key (baru tiap live)', disabled: live, autocomplete: 'off', oninput: (e) => { a.key = e.target.value.trim(); save(); } })) : null;
      return h('div.lacc' + (a.on ? '.on' : ''), { style: { '--pc': p.color } },
        h('div.row',
          h('input', { type: 'checkbox', checked: a.on, disabled: live, title: 'Ikut live', onchange: (e) => { a.on = e.target.checked; save(); render(); } }),
          h('i.pdot'), h('div.ln', h('b', label(a)), h('small', p.name)), h('span.grow'), s ? h('span.pill' + s[0], s[1]) : mode,
          ses && ses.watch && ses.watch[a.id] ? h('button.btn.sm', { title: 'Buka tayangan', onclick: () => openUrl(ses.watch[a.id]) }, KI.el('external')) : p.studio ? h('button.btn.sm', { title: 'Buka halaman live ' + p.name, onclick: () => openUrl(p.studio) }, KI.el('external')) : null,
          h('button.btn.sm', { title: 'Ubah akun', disabled: live, onclick: () => L.editAccount(cfg().accounts.find((x) => x.id === a.id)) }, KI.el('pencil'))),
        quick, ses && ses.errors && ses.errors[a.id] ? h('small.lerr', ses.errors[a.id]) : null);
    };
    const groups = Object.keys(PLAT).map((k) => {
      const list = c.accounts.filter((a) => a.platform === k);
      if (!list.length && k === 'custom') return null;
      const on = list.filter((a) => a.on).length;
      return D.fold('lv-' + k, PLAT[k].name, { wide: true, badge: on ? h('span.pill.ok', on + ' dipilih') : null,
        tools: [D.tool([KI.el('plus'), 'Akun'], 'Tambah akun ' + PLAT[k].name, () => L.editAccount(null, k))] },
        list.length ? h('div.laccs', list.map(card)) : h('p.muted.note', 'Belum ada akun ' + PLAT[k].name + '.'));
    });
    box.replaceChildren(h('div.sidep.liveq', head,
      !KM.isElectron ? h('div.sec.wide', h('p.muted', '⚠ Live streaming memakai ffmpeg bawaan versi PC (.exe). Di versi ini akun tetap bisa disiapkan.')) : null,
      info, ...groups,
      h('div.sec.wide', h('div.row', h('button.btn', { onclick: () => L.editAccount(null, 'custom') }, KI.el('plus'), 'Akun RTMP / SRT lain'), h('span.grow'),
        h('button.btn', { onclick: () => KM.ui.openSettings('stream') }, KI.el('settings'), 'Encoder & bitrate')),
        h('p.muted.note', 'Centang beberapa akun untuk live bersamaan (satu encode, dikirim ke semua). Bila satu tujuan gagal, tujuan lain tetap jalan. Internet upload minimal ≈ bitrate × jumlah akun.'))));
  }
  L.render = render;
  KM.on('change', (w) => { if ((w === 'live' || w === 'stream') && KM.dock && KM.dock.cur === 'live') { clearTimeout(render.t); render.t = setTimeout(render, 60); } });
  KM.on('stream-stats', () => { if (KM.dock && KM.dock.cur === 'live' && !typing(KM.$('#dock-live'))) { clearTimeout(render.s); render.s = setTimeout(render, 400); } });
  document.addEventListener('focusout', (e) => { if (pend && KM.$('#dock-live') && KM.$('#dock-live').contains(e.target)) setTimeout(() => { if (KM.dock.cur === 'live') render(); }, 150); });
  if (KM.dock && KM.dock.register) KM.dock.register('live', () => { L.refreshAuth().then(() => { if (KM.dock.cur === 'live') render(); }); render(); });
})(window.KM);
