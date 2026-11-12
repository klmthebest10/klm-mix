/* KLM Mix - dialog: Tambah Input, Pengaturan Input, Pengaturan Aplikasi, Output Eksternal, Bantuan */
'use strict';
(function (KM) {
  const h = KM.h, S = KM.state, UI = KM.ui;
  const D = KM.dialogs = {};

  // ---------- helper form ----------
  function sel(options, value, onchange) {
    const s = h('select', { onchange: () => onchange && onchange(s.value) },
      options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
    return s;
  }
  function chk(label, value, onchange) {
    const c = h('input', { type: 'checkbox', checked: !!value, onchange: () => onchange(c.checked) });
    return h('label.row', { style: { color: 'var(--tx)', minWidth: 0, gap: '6px', cursor: 'pointer' } }, c, label);
  }
  function row(label, ...els) { return h('div.row', h('label', label), ...els); }
  function slider(label, min, max, step, get, set, fmt) {
    const out = h('output', fmt ? fmt(get()) : String(get()));
    const r = h('input', { type: 'range', min, max, step, value: get(), oninput: () => { set(+r.value); out.textContent = fmt ? fmt(+r.value) : r.value; } });
    r.addEventListener('dblclick', () => { const d = r.dataset.def; if (d != null) { r.value = d; r.dispatchEvent(new Event('input')); } });
    return [h('label', label), r, out];
  }
  const pct = (v) => Math.round(v * 100) + '%';
  D.helpers = { sel, chk, row, slider };

  async function listDevices(kind) {
    let d = await navigator.mediaDevices.enumerateDevices();
    if (kind !== 'audiooutput' && d.filter((x) => x.kind === kind).every((x) => !x.label)) {
      try { const st = await navigator.mediaDevices.getUserMedia(kind === 'videoinput' ? { video: true } : { audio: true }); st.getTracks().forEach((t) => t.stop()); d = await navigator.mediaDevices.enumerateDevices(); } catch (e) {}
    }
    return d.filter((x) => x.kind === kind);
  }
  D.listDevices = listDevices;

  function phoneUrls() {
    const L = KM.link, ips = L.ips && L.ips.length ? L.ips : [{ address: location.hostname }];
    const hp = L.ports.http || location.port, hs = L.ports.https;
    return ips.map((ip) => ({ ip: ip.address, name: ip.name, cam: hs ? `https://${ip.address}:${hs}/cam` : `http://${ip.address}:${hp}/cam`, remote: `http://${ip.address}:${hp}/remote`, hp: `http://${ip.address}:${hp}/hp` }));
  }
  D.phoneUrls = phoneUrls;
  D.qr = (text) => h('div.qr', { html: window.KMQR ? KMQR.svg(text, { border: 2 }) : '' });

  // =================== TAMBAH INPUT ===================
  const ORDER = ['video', 'image', 'list', 'camera', 'klmcam', 'utc', 'score', 'stream', 'call', 'screen', 'title', 'audio', 'audiofile', 'colour', 'bars', 'browser', 'virtualset', 'replay', 'urlvideo'];
  D.addInput = function (preset) {
    const form = h('div', { style: { marginTop: '12px' } });
    let current = null, creator = null;
    const tiles = h('div.tiles', ORDER.map((t) => {
      const T = KM.inputTypes[t];
      return h('button.tile', { 'data-t': t, onclick: () => pick(t) }, h('b', T.icon), h('span', T.label));
    }));
    function pick(t) {
      current = t;
      KM.$$('.tile', tiles).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      form.innerHTML = '';
      creator = (FORMS[t] || (() => () => KM.inputs.create(t)))(form);
    }
    const m = UI.modal('Tambah Input', h('div', tiles, form), [
      { label: 'Batal' },
      { label: 'Tambah', cls: 'pri', fn: async () => { if (!creator) { KM.toast('Pilih jenis input'); return false; } const r = await creator(); if (r === false) return false; } }
    ], 'wide');
    if (preset) pick(preset);
    return m;
  };

  const FORMS = {
    utc(form) {
      const o = { onAir: true };
      form.append(h('div.sec', h('h4', '🎬 UTC Acara'),
        h('p', 'Grafis siaran acara: lower third, title, running text (berjudul & banyak baris), logo, lokasi, sosial media, opening/closing — untuk pengajian, pernikahan, khitanan, seminar, dll.'),
        h('ul.muted', { style: { margin: '6px 0 10px 18px', lineHeight: 1.7 } },
          h('li', 'Setelah ditambahkan, tab ', h('b', 'UTC Acara'), ' muncul di panel samping berisi tombol cepat: tampil/sembunyi, ganti nama lower third, running text, opening/closing, preset.'),
          h('li', 'Atur, edit, simpan, tambah & ubah semuanya di ', h('b', 'Panel lengkap'), ' (klik ganda input / F9).'),
          h('li', 'Input bisa dipakai di Program, Overlay 1–4, layer & multiview.')),
        chk('Langsung tampil di atas Program (UTC ACARA ON AIR)', true, (v) => { o.onAir = v; })));
      return () => { if (KM.utc.has()) { KM.toast('UTC Acara sudah ada — dibuka di panel samping', 'info'); } KM.utc.addInput(o); UI.openSide('utc'); };
    },
    score(form) {
      const o = { onAir: true };
      form.append(h('div.sec', h('h4', '🏆 UTC Score'),
        h('p', 'Scoreboard olahraga siaran: sepak bola, futsal, basket, voli, bulu tangkis — skor, jam pertandingan, babak, foul, kartu, timeout, pergantian pemain, popup gol, data turnamen.'),
        h('ul.muted', { style: { margin: '6px 0 10px 18px', lineHeight: 1.7 } },
          h('li', 'Setelah ditambahkan, tab ', h('b', 'UTC Score'), ' muncul di panel samping: tombol skor ±, jam mulai/jeda, babak, foul, kartu, timeout, popup, tukar sisi.'),
          h('li', 'Atur tim, logo, warna, aturan & turnamen di ', h('b', 'Panel lengkap'), ' (klik ganda input / F9), atau dari HP.'),
          h('li', 'Alamat lama tetap jalan untuk OBS/vMix: http://IP:7171/overlay')),
        chk('Langsung tampil di atas Program (UTC SCORE ON AIR)', true, (v) => { o.onAir = v; })));
      return () => { if (KM.score.has()) { KM.toast('UTC Score sudah ada — dibuka di panel samping', 'info'); } KM.score.addInput(o); UI.openSide('score'); };
    },
    stream(form) {
      const o = { source: 'listen-rtmp', url: '', mode: 'copy', latency: 120, maxLag: 0.6, ndiName: '', ndiLow: false, key: 'klm' + Math.floor(Math.random() * 900 + 100) };
      const urls = phoneUrls(), ip = urls[0] ? urls[0].ip : '127.0.0.1';
      const box = h('div');
      const draw = () => {
        const urlIn = h('input.grow', { value: o.url, placeholder: 'rtsp://admin:pass@192.168.1.64:554/stream1', oninput: (e) => { o.url = e.target.value; } });
        let detail;
        if (o.source === 'listen-rtmp') detail = h('div.sec', h('h4', 'Kirim dari OBS / Larix / vMix / HP ke alamat ini'), h('div.urlbox', 'Server : rtmp://' + ip + ':1935/live'), h('div.urlbox', 'Key    : ' + o.key), h('p.muted', 'Bisa juga menerima dari aplikasi streaming HP (Larix Broadcaster, PRISM, dll).'));
        else if (o.source === 'listen-srt') detail = h('div.sec', h('h4', 'Kirim SRT (caller) ke'), h('div.urlbox', 'srt://' + ip + ':' + (o.srtPort || 9000)), row('Port', h('input', { type: 'number', value: o.srtPort || 9000, style: { width: '90px' }, onchange: (e) => { o.srtPort = +e.target.value; draw(); } })));
        else if (o.source === 'ndi') {
          const ndiSel = h('select.grow', h('option', { value: '' }, 'Klik "Cari" …'));
          detail = h('div.sec', h('h4', 'Sumber NDI di jaringan'), h('div.row', ndiSel, h('button.btn', { onclick: async () => {
            ndiSel.replaceChildren(h('option', 'Mencari…'));
            const r = await fetch('/hub/ndi/sources').then((x) => x.json()).catch(() => ({ ok: false, msg: 'Hub tidak tersedia' }));
            if (!r.ok) { ndiSel.replaceChildren(h('option', { value: '' }, '⚠ ' + r.msg)); return; }
            ndiSel.replaceChildren(...(r.sources.length ? r.sources.map((x) => h('option', { value: x.name }, x.name)) : [h('option', { value: '' }, 'Tidak ada sumber NDI')]));
            o.ndiName = ndiSel.value;
          } }, '🔍 Cari')), chk('Bandwidth rendah (preview, hemat jaringan/CPU)', o.ndiLow, (v) => { o.ndiLow = v; }),
          h('p.muted', 'Butuh NDI Tools / NDI Runtime (gratis, ndi.video) terinstal di PC ini.'));
          ndiSel.onchange = () => { o.ndiName = ndiSel.value; };
        } else detail = h('div', row('URL', urlIn), h('p.muted', 'Contoh: rtsp://… (CCTV/kamera IP/PTZ), rtmp://…, srt://host:port, https://…/live.m3u8, udp://@:1234'));
        box.replaceChildren(
          row('Sumber', sel([['listen-rtmp', 'Terima RTMP (dari OBS/HP/encoder)'], ['listen-srt', 'Terima SRT (listener)'], ['url', 'Tarik dari URL (RTSP/RTMP/SRT/HLS/UDP)'], ['ndi', 'NDI (jaringan)']], o.source, (v) => { o.source = v; draw(); })),
          detail,
          o.source !== 'ndi' ? row('Mode', sel([['copy', 'Copy H.264 — sangat ringan (disarankan)'], ['transcode', 'Transcode — untuk HEVC/kodek lain']], o.mode, (v) => { o.mode = v; })) : null,
          row('Target latensi', sel([[0.3, 'Sangat rendah (0.3 dtk)'], [0.6, 'Rendah (0.6 dtk)'], [1.2, 'Stabil (1.2 dtk)'], [2.5, 'Internet tidak stabil (2.5 dtk)']], o.maxLag, (v) => { o.maxLag = +v; })),
          h('p.muted', 'Fitur ini memakai ffmpeg bawaan (versi PC .exe / mode web dengan Node).'));
      };
      draw();
      form.append(box);
      return () => {
        const d = { mode: o.mode, maxLag: o.maxLag, latency: o.latency };
        if (o.source === 'listen-rtmp') Object.assign(d, { listen: true, url: 'rtmp://0.0.0.0:1935/live/' + o.key });
        else if (o.source === 'listen-srt') Object.assign(d, { listen: true, url: 'srt://0.0.0.0:' + (o.srtPort || 9000) });
        else if (o.source === 'ndi') { if (!o.ndiName) { KM.toast('Pilih sumber NDI'); return false; } Object.assign(d, { source: 'ndi', ndiName: o.ndiName, ndiLow: o.ndiLow }); }
        else { if (!o.url) { KM.toast('Isi URL'); return false; } d.url = o.url; }
        KM.inputs.create('stream', { title: o.source === 'ndi' ? 'NDI ' + o.ndiName : o.source === 'url' ? 'Stream ' + o.url.replace(/^\w+:\/\/([^@/]*@)?/, '').slice(0, 24) : (o.source === 'listen-srt' ? 'SRT masuk' : 'RTMP masuk'), opts: d });
      };
    },
    call(form) {
      const used = S.inputs.filter((i) => i.type === 'call').map((i) => +i.opts.slot);
      let slot = 1; while (used.includes(slot)) slot++;
      const o = { slot, quality: '720p30', bitrate: 2500 };
      const urls = phoneUrls();
      const link = (u) => (KM.link.ports.https ? 'https://' + u.ip + ':' + KM.link.ports.https : 'http://' + u.ip + ':' + KM.link.ports.http) + '/call?slot=' + o.slot;
      const box = h('div');
      const draw = () => box.replaceChildren(
        row('Nomor call', sel([1, 2, 3, 4, 5, 6, 7, 8], o.slot, (v) => { o.slot = +v; draw(); })),
        h('div.sec', h('h4', '📞 Kirim link ini ke tamu / narasumber'),
          h('div.row', D.qr(urls[0] ? link(urls[0]) : ''), h('div.grow', ...urls.map((u) => h('div.urlbox', link(u))),
            h('p.muted', 'Tamu melihat tayangan program (return feed) dan mendengar audio studio tanpa suaranya sendiri (mix-minus). Bisa juga lewat aplikasi APK → KLM Call. Untuk tamu di luar jaringan: pakai VPN (Tailscale/ZeroTier) ke PC ini.')))));
      draw(); form.append(box);
      return () => { KM.inputs.create('call', { title: 'Call ' + o.slot, opts: o }); };
    },
    video: fileForm('video', 'video/*,.mkv,.mov,.mp4,.webm,.m4v', true),
    image: fileForm('image', 'image/*', true),
    audiofile: fileForm('audiofile', 'audio/*', true),
    list(form) {
      const opts = { items: [], imgDur: 5, loopList: true, shuffle: false };
      const lst = h('div.list');
      const redraw = () => { lst.replaceChildren(...opts.items.map((it, i) => h('div.li', h('span', it.kind === 'image' ? '🖼️' : '🎬'), h('span.grow', it.name), h('button.btn.sm', { onclick: () => { opts.items.splice(i, 1); redraw(); } }, '✕')))); };
      form.append(
        h('div.row', h('button.btn.pri', { onclick: async () => { (await KM.pickFiles('video/*,image/*', true)).forEach((f) => opts.items.push({ name: f.name, url: f.url, path: f.path, kind: UI.fileKind(f.name, f.file.type) === 'image' ? 'image' : 'video' })); redraw(); } }, '＋ Pilih file video/foto…'),
          h('label', 'Durasi foto (dtk)'), h('input', { type: 'number', value: 5, min: 1, style: { width: '70px' }, onchange: (e) => { opts.imgDur = +e.target.value; } }),
          chk('Ulang (loop)', true, (v) => { opts.loopList = v; }), chk('Acak', false, (v) => { opts.shuffle = v; })),
        h('div', { style: { marginTop: '8px' } }, lst));
      return () => { if (!opts.items.length) { KM.toast('Tambahkan file dulu'); return false; } KM.inputs.create('list', { title: 'Daftar Putar', opts }); };
    },
    urlvideo(form) {
      const u = h('input.grow', { placeholder: 'https://contoh.com/video.mp4' });
      form.append(row('URL video', u), h('p.muted', 'Mendukung MP4/WebM langsung dari URL (offline: gunakan file lokal).'));
      return () => { if (!u.value) return false; KM.inputs.create('urlvideo', { title: 'Video URL', opts: { url: u.value } }); };
    },
    camera(form) {
      const dfps = KM.settings.fps >= 60 ? 60 : KM.settings.fps >= 50 ? 50 : KM.settings.fps === 25 ? 25 : 30; // ikuti frame rate output
      const o = { deviceId: '', width: 1920, height: 1080, fps: dfps, audioDeviceId: '' };
      const vs = h('select.grow'), as = h('select.grow');
      listDevices('videoinput').then((l) => { vs.replaceChildren(...l.map((d, i) => h('option', { value: d.deviceId }, d.label || 'Kamera ' + (i + 1)))); o.deviceId = vs.value; });
      listDevices('audioinput').then((l) => { as.replaceChildren(h('option', { value: '' }, '— Tanpa audio —'), ...l.map((d, i) => h('option', { value: d.deviceId }, d.label || 'Mic ' + (i + 1)))); });
      vs.onchange = () => { o.deviceId = vs.value; }; as.onchange = () => { o.audioDeviceId = as.value; };
      form.append(row('Kamera / capture', vs),
        row('Resolusi', sel([['1280x720', '1280×720 (HD)'], ['1920x1080', '1920×1080 (Full HD)'], ['2560x1440', '2560×1440'], ['3840x2160', '3840×2160 (4K)']], '1920x1080', (v) => { const [w, hh] = v.split('x'); o.width = +w; o.height = +hh; }),
          h('label', 'FPS'), sel([25, 30, 50, 60], dfps, (v) => { o.fps = +v; })),
        row('Audio (opsional)', as),
        h('p.muted', 'Mendukung webcam USB, capture card HDMI (Elgato, UGREEN, dll) dan OBS Virtual Camera.'));
      return () => { const n = vs.options[vs.selectedIndex]; KM.inputs.create('camera', { title: n ? n.textContent : 'Kamera', opts: Object.assign({}, o) }); };
    },
    audio(form) {
      const o = { deviceId: '', processing: false };
      const as = h('select.grow');
      listDevices('audioinput').then((l) => { as.replaceChildren(...l.map((d, i) => h('option', { value: d.deviceId }, d.label || 'Mic ' + (i + 1)))); o.deviceId = as.value; });
      as.onchange = () => { o.deviceId = as.value; };
      form.append(row('Perangkat audio', as), chk('Aktifkan noise suppression & echo cancel (untuk mic biasa)', false, (v) => { o.processing = v; }),
        h('p.muted', 'Gunakan untuk mixer audio/soundcard, mic wireless, atau line-in.'));
      return () => { const n = as.options[as.selectedIndex]; KM.inputs.create('audio', { title: n ? n.textContent : 'Mic', opts: Object.assign({}, o) }); };
    },
    screen(form) {
      const sfps = KM.settings.fps >= 50 ? 60 : 30;
      const o = { sourceId: '', sysAudio: false, fps: sfps };
      if (!KM.isElectron) {
        form.append(h('p', 'Browser akan menampilkan pilihan layar/jendela/tab saat ditambahkan.'), chk('Sertakan audio sistem/tab', false, (v) => { o.sysAudio = v; }));
        return () => { KM.inputs.create('screen', { title: 'Layar', opts: o }); };
      }
      const grid = h('div.src-grid', h('p.muted', 'Memuat daftar layar & jendela…'));
      let chosen = null;
      window.klm.invoke('desktop:sources').then((list) => {
        grid.replaceChildren(...list.map((s) => h('button.tile', { onclick: (e) => { o.sourceId = s.id; chosen = s.name; KM.$$('.tile', grid).forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); } }, h('img', { src: s.thumb }), h('span', s.name))));
      });
      form.append(row('FPS', sel([15, 25, 30, 60], sfps, (v) => { o.fps = +v; }), chk('Rekam audio sistem (khusus layar penuh)', false, (v) => { o.sysAudio = v; })), h('div', { style: { marginTop: '8px' } }, grid));
      return () => { if (!o.sourceId) { KM.toast('Pilih layar/jendela'); return false; } KM.inputs.create('screen', { title: chosen || 'Layar', opts: o }); };
    },
    klmcam(form) {
      const used = S.inputs.filter((i) => i.type === 'klmcam').map((i) => +i.opts.slot);
      let slot = 1; while (used.includes(slot)) slot++;
      const o = { slot, quality: '1080p30', bitrate: 6000, audio: true };
      const urls = phoneUrls();
      form.append(
        row('Slot kamera', sel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], slot, (v) => { o.slot = +v; })),
        row('Kualitas', sel([['720p30', '720p 30fps (ringan)'], ['720p60', '720p 60fps'], ['1080p30', '1080p 30fps'], ['1080p60', '1080p 60fps (HP kuat)']], o.quality, (v) => { o.quality = v; }),
          h('label', 'Bitrate'), sel([[2500, '2.5 Mbps'], [4000, '4 Mbps'], [6000, '6 Mbps'], [8000, '8 Mbps'], [12000, '12 Mbps']], o.bitrate, (v) => { o.bitrate = +v; })),
        chk('Kirim audio mic HP', true, (v) => { o.audio = v; }),
        h('div.sec', { style: { marginTop: '10px' } }, h('h4', '📱 Hubungkan HP (Wi-Fi yang sama)'),
          h('div.row', D.qr(urls[0] ? urls[0].cam : ''), h('div.grow',
            h('p', '1. Buka aplikasi ', h('b', 'KLM Mix (APK)'), ' → mode ', h('b', 'Kamera'), ' → isi IP PC: ', h('b.urlbox', urls.map((u) => u.ip).join(' / '))),
            h('p', '2. Atau scan QR / buka di Chrome HP:'), ...urls.map((u) => h('div.urlbox', u.cam)),
            h('p.muted', 'Di browser HP akan muncul peringatan sertifikat → pilih Lanjutkan/Advanced. Pilih slot yang sama di HP.')))));
      return () => { KM.inputs.create('klmcam', { title: 'KLMCAM ' + o.slot, opts: o }); UI.openSide('klmcam'); };
    },
    title(form) {
      const o = { template: 'lt-klasik', theme: 'emas' };
      const groups = {};
      Object.entries(KM.titles.TPL).forEach(([k, t]) => { (groups[t.group] = groups[t.group] || []).push([k, t]); });
      const grid = h('div');
      Object.entries(groups).forEach(([g, list]) => {
        grid.append(h('h4', { style: { margin: '10px 0 6px', color: 'var(--tx2)' } }, g),
          h('div.tiles', list.map(([k, t]) => h('button.tile' + (k === o.template ? '.on' : ''), { 'data-k': k, onclick: (e) => { o.template = k; KM.$$('.tile', grid).forEach((b) => b.classList.toggle('on', b.dataset.k === k)); } }, h('b', '🅃'), h('span', t.name)))));
      });
      const lib = KM.designer.library();
      grid.append(h('h4', { style: { margin: '10px 0 6px', color: 'var(--tx2)' } }, 'Desain sendiri'),
        h('div.tiles', h('button.tile', { onclick: (e) => { o.designNew = true; KM.$$('.tile', grid).forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); o.template = 'custom'; o.libIdx = null; } }, h('b', '🎨'), h('span', 'Desain baru (Title Designer)')),
          ...lib.map((it, i) => h('button.tile', { onclick: (e) => { KM.$$('.tile', grid).forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); o.template = 'custom'; o.libIdx = i; } }, h('b', '📐'), h('span', it.name)))));
      form.append(row('Tema warna', sel(Object.entries(KM.titles.THEMES).map(([k, t]) => [k, t.name]), o.theme, (v) => { o.theme = v; })),
        h('p.muted', 'Title dari UTC KLM Acara — bisa diedit langsung di tab "Title UTC", dikontrol dari HP, dan via API SetText.'), grid);
      return () => {
        let inp;
        if (o.template === 'custom') { inp = o.libIdx != null ? KM.designer.createFromLibrary(o.libIdx) : null; if (!inp) { setTimeout(() => KM.designer.open(), 50); return; } }
        else inp = KM.inputs.create('title', { opts: { template: o.template, theme: o.theme } });
        UI.dockTab('title'); KM.dock.selectTitle(inp.id);
      };
    },
    colour(form) {
      const o = { color: '#1e3a8a', color2: '#0f172a', grad: 'none' };
      form.append(row('Warna 1', h('input', { type: 'color', value: o.color, oninput: (e) => { o.color = e.target.value; } }), h('label', 'Warna 2'), h('input', { type: 'color', value: o.color2, oninput: (e) => { o.color2 = e.target.value; } })),
        row('Gaya', sel([['none', 'Solid'], ['linear', 'Gradien linear'], ['radial', 'Gradien radial']], 'none', (v) => { o.grad = v; })));
      return () => { KM.inputs.create('colour', { title: 'Warna', opts: o }); };
    },
    bars(form) {
      const o = { tone: false };
      form.append(chk('Tone audio 1 kHz (-20 dB) untuk cek level', false, (v) => { o.tone = v; }));
      return () => { KM.inputs.create('bars', { title: 'Color Bars', opts: o }); };
    },
    browser(form) {
      const o = { url: 'http://127.0.0.1:' + (KM.link.ports.http || location.port) + '/remote', width: 1280, height: 720 };
      const u = h('input.grow', { value: o.url, oninput: (e) => { o.url = e.target.value; } });
      form.append(row('URL', u), row('Ukuran', sel([['1280x720', '1280×720'], ['1920x1080', '1920×1080'], ['1080x1920', '1080×1920 (vertikal)']], '1280x720', (v) => { const [w, hh] = v.split('x'); o.width = +w; o.height = +hh; })),
        h('p.muted', KM.isElectron ? 'Cocok untuk overlay HTML lama (UTC KLM Scoreboard/Acara versi web, widget chat, dll).' : '⚠ Input browser hanya tersedia di versi PC (.exe).'));
      return () => { KM.inputs.create('browser', { title: '🌐 ' + o.url.replace(/^https?:\/\//, '').slice(0, 30), opts: o }); };
    },
    virtualset(form) {
      const cams = S.inputs.filter((i) => ['camera', 'klmcam', 'video'].includes(i.type));
      const o = { bg: 'studio-biru', camId: cams[0] ? cams[0].id : '', caption: 'KLM STUDIO' };
      form.append(row('Latar', sel(Object.entries(KM.virtualSets.presets), o.bg, (v) => { o.bg = v; })),
        row('Kamera (green screen)', sel([['', '— pilih —']].concat(cams.map((c) => [c.id, KM.inputNum(c) + '. ' + c.title])), o.camId, (v) => { o.camId = v; })),
        row('Teks layar', h('input.grow', { value: o.caption, oninput: (e) => { o.caption = e.target.value; } })),
        h('p.muted', 'Aktifkan Chroma Key pada input kamera (⚙ → Chroma Key) agar latar hijau terhapus.'));
      return () => { KM.inputs.create('virtualset', { title: 'Virtual Set', opts: o }); };
    },
    replay(form) {
      form.append(h('p', 'Input ini menampilkan event Instant Replay. Aktifkan buffer di tab ⏪ Replay, lalu tandai event (tombol M).'));
      return () => { KM.inputs.create('replay', { title: 'Instant Replay' }); };
    }
  };
  function fileForm(type, accept, multi) {
    return (form) => {
      let files = [];
      const lst = h('div.list');
      form.append(h('div.row', h('button.btn.pri', { onclick: async () => { files = await KM.pickFiles(accept, multi); lst.replaceChildren(...files.map((f) => h('div.li', h('span.grow', f.name)))); } }, '📂 Pilih file…'),
        h('span.muted', 'Bisa juga drag & drop file ke panel input.')), h('div', { style: { marginTop: '8px' } }, lst));
      return () => { if (!files.length) { KM.toast('Pilih file dulu'); return false; } files.forEach((f) => KM.inputs.create(type, { title: f.name.replace(/\.[^.]+$/, ''), opts: { url: f.url, path: f.path } })); };
    };
  }

  // =================== PENGATURAN INPUT ===================
  D.inputSettings = function (inp, tab) {
    const tabs = [['umum', 'Umum'], ['posisi', 'Posisi & Crop'], ['warna', 'Koreksi Warna'], ['key', 'Chroma Key'], ['layer', 'Layer / MultiView']];
    if (KM.inputs.hasAudio(inp)) tabs.push(['audio', 'Audio']);
    tabs.push(['trigger', 'Trigger']);
    const body = h('div');
    const tabBar = h('div.tabs', tabs.map(([k, l]) => h('button', { 'data-k': k, onclick: () => show(k) }, l)));
    const pv = h('canvas', { width: 640, height: 360, title: 'Klik untuk mengambil warna chroma key (di tab Chroma Key)' });
    const pvx = pv.getContext('2d');
    const content = h('div');
    body.append(tabBar, h('div.split', content, h('div', h('div.prevbox', pv), h('p.muted', { style: { marginTop: '6px' } }, KM.inputTypes[inp.type].icon + ' ' + KM.inputTypes[inp.type].label + ' • Input ' + KM.inputNum(inp)))));
    let cur = 'umum';
    function show(k) {
      cur = k;
      KM.$$('button', tabBar).forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      content.replaceChildren(TABS[k](inp));
    }
    let raf;
    const draw = () => {
      pvx.fillStyle = '#000'; pvx.fillRect(0, 0, 640, 360);
      // papan catur agar transparansi terlihat
      if (cur === 'key') for (let y = 0; y < 360; y += 20) for (let x = 0; x < 640; x += 20) { pvx.fillStyle = ((x + y) / 20) % 2 ? '#444' : '#2a2a2a'; pvx.fillRect(x, y, 20, 20); }
      try { KM.engine.drawInputRect(pvx, inp, 0, 0, 640, 360, 0); } catch (e) {}
      raf = requestAnimationFrame(draw);
    };
    draw();
    pv.addEventListener('click', (e) => {
      if (cur !== 'key') return;
      const r = pv.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      const s = KM.inputs.source(inp); if (!s) return;
      const c = document.createElement('canvas'); c.width = 64; c.height = 36; const cx = c.getContext('2d');
      cx.drawImage(s.src, 0, 0, 64, 36);
      const d = cx.getImageData(Math.floor(x * 64), Math.floor(y * 36), 1, 1).data;
      inp.key.color = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      inp.key.on = true; KM.changed('input'); show('key');
    });
    const m = UI.modal('⚙ ' + inp.title, body, [{ label: 'Tutup', cls: 'pri' }], 'wide');
    m.onclose = () => cancelAnimationFrame(raf);
    show(tab || 'umum');
  };

  const TABS = {
    umum(inp) {
      const box = h('div');
      box.append(h('div.sec', row('Nama', h('input.grow', { value: inp.title, oninput: (e) => { inp.title = e.target.value; KM.changed('input'); } }))));
      if (KM.inputs.isPlayable(inp)) {
        const m = KM.inputs.media(inp);
        box.append(h('div.sec', h('h4', 'Pemutaran'),
          h('div.row', chk('Auto Play saat ke Program', inp.autoPlay, (v) => { inp.autoPlay = v; }), chk('Auto Pause', inp.autoPause, (v) => { inp.autoPause = v; }), chk('Auto Restart', inp.autoRestart, (v) => { inp.autoRestart = v; }), chk('Loop', inp.loop, (v) => KM.inputs.setLoop(inp, v))),
          inp.type !== 'list' ? h('div.row', h('label', 'Kecepatan'), sel([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2], inp.opts.speed || 1, (v) => { inp.opts.speed = +v; if (m) m.playbackRate = +v; })) : null,
          inp.type === 'video' || inp.type === 'urlvideo' ? h('div.row', h('label', 'Mark In / Out'),
            h('input', { type: 'number', step: 0.1, min: 0, value: inp.opts.markIn || 0, style: { width: '80px' }, onchange: (e) => { inp.opts.markIn = +e.target.value; } }),
            h('input', { type: 'number', step: 0.1, min: 0, value: inp.opts.markOut || 0, style: { width: '80px' }, onchange: (e) => { inp.opts.markOut = +e.target.value; } }),
            h('button.btn.sm', { onclick: (e) => { if (m) { inp.opts.markIn = +m.currentTime.toFixed(1); show(); } } }, 'Set In = posisi'),
            h('button.btn.sm', { onclick: () => { if (m) { inp.opts.markOut = +m.currentTime.toFixed(1); show(); } } }, 'Set Out = posisi'),
            h('span.muted', '(detik, 0 = tidak dipakai)')) : null,
          m && m.duration ? h('div.row', h('label', 'Posisi'), (() => { const r = h('input.grow', { type: 'range', min: 0, max: m.duration, step: 0.1, value: m.currentTime, oninput: () => { m.currentTime = +r.value; } }); return r; })()) : null));
        function show() { const dlg = box.closest('.modal'); if (dlg) dlg.querySelector('.tabs button.on').click(); }
      }
      const extra = INPUT_EXTRA[inp.type]; if (extra) box.append(extra(inp));
      return box;
    },
    posisi(inp) {
      const p = inp.pos, ch = () => KM.changed('input');
      const presets = [['Penuh', { x: 0, y: 0, zoom: 1, cropL: 0, cropR: 0, cropT: 0, cropB: 0 }], ['PiP kanan atas', { x: 0.62, y: -0.62, zoom: 0.33 }], ['PiP kiri atas', { x: -0.62, y: -0.62, zoom: 0.33 }], ['PiP kanan bawah', { x: 0.62, y: 0.62, zoom: 0.33 }], ['PiP kiri bawah', { x: -0.62, y: 0.62, zoom: 0.33 }], ['Separuh kiri', { x: -0.5, y: 0, zoom: 0.5 }], ['Separuh kanan', { x: 0.5, y: 0, zoom: 0.5 }]];
      const wrap = h('div');
      const build = () => wrap.replaceChildren(h('div.sec', h('h4', 'Preset'), h('div.row', presets.map(([l, v]) => h('button.btn.sm', { onclick: () => { Object.assign(p, v); ch(); build(); } }, l)))),
        h('div.sec', h('h4', 'Posisi'), h('div.kv',
          ...slider('Geser X', -2, 2, 0.01, () => p.x, (v) => { p.x = v; ch(); }, (v) => v.toFixed(2)),
          ...slider('Geser Y', -2, 2, 0.01, () => p.y, (v) => { p.y = v; ch(); }, (v) => v.toFixed(2)),
          ...slider('Zoom', 0.05, 5, 0.01, () => p.zoom, (v) => { p.zoom = v; ch(); }, pct),
          ...slider('Rotasi', -180, 180, 1, () => p.rot, (v) => { p.rot = v; ch(); }, (v) => v + '°')),
          h('div.row', h('label', 'Mode isi'), sel([['fit', 'Fit (pas, ada bingkai)'], ['fill', 'Fill (penuh, terpotong)'], ['stretch', 'Stretch (tarik)']], p.fit, (v) => { p.fit = v; ch(); }))),
        h('div.sec', h('h4', 'Crop'), h('div.kv',
          ...slider('Kiri', 0, 0.9, 0.005, () => p.cropL, (v) => { p.cropL = v; ch(); }, pct),
          ...slider('Kanan', 0, 0.9, 0.005, () => p.cropR, (v) => { p.cropR = v; ch(); }, pct),
          ...slider('Atas', 0, 0.9, 0.005, () => p.cropT, (v) => { p.cropT = v; ch(); }, pct),
          ...slider('Bawah', 0, 0.9, 0.005, () => p.cropB, (v) => { p.cropB = v; ch(); }, pct))));
      build();
      return wrap;
    },
    warna(inp) {
      const c = inp.cc, ch = () => KM.changed('input');
      const wrap = h('div');
      const build = () => wrap.replaceChildren(h('div.sec', chk('Aktifkan koreksi warna', c.on, (v) => { c.on = v; ch(); }),
        h('div.kv', { style: { marginTop: '8px' } },
          ...slider('Kecerahan', -0.5, 0.5, 0.01, () => c.bri, (v) => { c.bri = v; c.on = true; ch(); }, (v) => v.toFixed(2)),
          ...slider('Kontras', 0.3, 2, 0.01, () => c.con, (v) => { c.con = v; c.on = true; ch(); }, pct),
          ...slider('Saturasi', 0, 2.5, 0.01, () => c.sat, (v) => { c.sat = v; c.on = true; ch(); }, pct),
          ...slider('Hue', -180, 180, 1, () => c.hue, (v) => { c.hue = v; c.on = true; ch(); }, (v) => v + '°'),
          ...slider('Gamma', 0.4, 2.5, 0.01, () => c.gam, (v) => { c.gam = v; c.on = true; ch(); }, (v) => v.toFixed(2))),
        h('div.row', { style: { marginTop: '8px' } }, h('button.btn', { onclick: () => { Object.assign(c, { on: false, bri: 0, con: 1, sat: 1, hue: 0, gam: 1 }); ch(); build(); } }, 'Reset'),
          h('button.btn', { onclick: () => { Object.assign(c, { on: true, bri: 0.03, con: 1.12, sat: 1.25, hue: 0, gam: 1 }); ch(); build(); } }, 'Preset: Cerah & Hidup'),
          h('button.btn', { onclick: () => { Object.assign(c, { on: true, bri: 0, con: 1.05, sat: 0, hue: 0, gam: 1 }); ch(); build(); } }, 'Hitam Putih'),
          h('button.btn', { onclick: () => { Object.assign(c, { on: true, bri: 0.02, con: 1.05, sat: 1.1, hue: -8, gam: 1.05 }); ch(); build(); } }, 'Hangat'))));
      build();
      return wrap;
    },
    key(inp) {
      const k = inp.key, ch = () => KM.changed('input');
      return h('div',
        h('div.sec', h('h4', 'Chroma Key (green / blue screen)'),
          chk('Aktifkan Chroma Key', k.on, (v) => { k.on = v; ch(); }),
          h('div.row', h('label', 'Warna kunci'), h('input', { type: 'color', value: k.color, oninput: (e) => { k.color = e.target.value; ch(); } }),
            h('button.btn.sm', { onclick: () => { k.color = '#00ff00'; ch(); } }, 'Hijau'), h('button.btn.sm', { onclick: () => { k.color = '#0047bb'; ch(); } }, 'Biru'),
            h('span.muted', 'atau klik pada preview untuk ambil warna')),
          h('div.kv', { style: { marginTop: '8px' } },
            ...slider('Kemiripan', 0.01, 1, 0.005, () => k.sim, (v) => { k.sim = v; ch(); }, (v) => v.toFixed(3)),
            ...slider('Kehalusan', 0.001, 0.4, 0.001, () => k.smooth, (v) => { k.smooth = v; ch(); }, (v) => v.toFixed(3)),
            ...slider('Spill', 0.001, 1, 0.005, () => k.spill, (v) => { k.spill = v; ch(); }, (v) => v.toFixed(3)))),
        h('div.sec', h('h4', 'Luma Key (hapus warna gelap)'),
          chk('Aktifkan Luma Key', k.lumaOn, (v) => { k.lumaOn = v; ch(); }),
          h('div.kv', { style: { marginTop: '8px' } },
            ...slider('Ambang bawah', 0, 1, 0.005, () => k.lumaLo, (v) => { k.lumaLo = v; ch(); }, (v) => v.toFixed(2)),
            ...slider('Ambang atas', 0, 1, 0.005, () => k.lumaHi, (v) => { k.lumaHi = v; ch(); }, (v) => v.toFixed(2)))));
    },
    layer(inp) {
      const wrap = h('div');
      const others = () => S.inputs.filter((i) => i !== inp);
      const PRE = { full: [0, 0, 1, 1], tl: [0.03, 0.04, 0.3, 0.3], tr: [0.67, 0.04, 0.3, 0.3], bl: [0.03, 0.66, 0.3, 0.3], br: [0.67, 0.66, 0.3, 0.3], left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], kiri2: [0.02, 0.2, 0.47, 0.47], kanan2: [0.51, 0.2, 0.47, 0.47] };
      const build = () => {
        const rows = inp.layers.map((l, idx) => {
          const n = (k) => h('input', { type: 'number', step: 0.01, value: l[k], title: k, onchange: (e) => { l[k] = +e.target.value; KM.changed('input'); } });
          return h('div.layer-row',
            h('input', { type: 'checkbox', checked: l.on, title: 'Aktif', onchange: (e) => { l.on = e.target.checked; KM.changed('input'); } }),
            sel([['', '— input —']].concat(others().map((o) => [o.id, KM.inputNum(o) + '. ' + o.title])), l.inputId, (v) => { l.inputId = v; KM.changed('input'); }),
            n('x'), n('y'), n('w'), n('h'),
            h('div.row', sel([['', 'Preset…'], ['full', 'Penuh'], ['tl', 'PiP ↖'], ['tr', 'PiP ↗'], ['bl', 'PiP ↙'], ['br', 'PiP ↘'], ['left', 'Kiri ½'], ['right', 'Kanan ½'], ['kiri2', 'Berdampingan kiri'], ['kanan2', 'Berdampingan kanan']], '', (v) => { if (PRE[v]) { [l.x, l.y, l.w, l.h] = PRE[v]; KM.changed('input'); build(); } }),
              h('input', { type: 'color', value: l.bc || '#ffffff', title: 'Warna bingkai', oninput: (e) => { l.bc = e.target.value; KM.changed('input'); } }),
              h('input', { type: 'number', value: l.bw || 0, min: 0, max: 30, style: { width: '46px' }, title: 'Tebal bingkai (px)', onchange: (e) => { l.bw = +e.target.value; KM.changed('input'); } }),
              h('button.btn.sm', { onclick: () => { inp.layers.splice(idx, 1); KM.changed('input'); build(); } }, '✕')));
        });
        wrap.replaceChildren(h('div.sec', h('h4', 'Layer (MultiView) — hingga 10 layer di atas input ini'),
          h('div.layer-row.muted', h('span'), h('span', 'Input'), h('span', 'X'), h('span', 'Y'), h('span', 'Lebar'), h('span', 'Tinggi'), h('span', 'Preset / bingkai')),
          ...rows,
          h('div.row', { style: { marginTop: '8px' } }, h('button.btn.pri', { disabled: inp.layers.length >= 10, onclick: () => { const o = others()[0]; inp.layers.push({ on: true, inputId: o ? o.id : '', x: 0.67, y: 0.04, w: 0.3, h: 0.3, bw: 0, bc: '#ffffff' }); KM.changed('input'); build(); } }, '＋ Tambah layer'),
            h('span.muted', 'Nilai 0–1 relatif terhadap layar. Layer ikut tampil di Program & bisa dinyalakan via API MultiViewOverlay.'))));
      };
      build();
      return wrap;
    },
    trigger(inp) {
      const list = inp.triggers || (inp.triggers = []);
      const wrap = h('div');
      const fnOpts = KM.api.list().map((f) => [f, f]);
      const build = () => wrap.replaceChildren(h('div.sec', h('h4', 'Trigger — jalankan fungsi otomatis'),
        ...list.map((t, i) => h('div.row', { style: { marginBottom: '6px' } },
          sel(Object.entries(KM.script.EVENTS), t.on, (v) => { t.on = v; }),
          sel(fnOpts, t.fn, (v) => { t.fn = v; }),
          h('input', { value: t.params || '', placeholder: 'Input=3&Duration=500', style: { width: '170px' }, onchange: (e) => { t.params = e.target.value; } }),
          h('input', { type: 'number', value: t.delay || 0, title: 'Jeda (ms)', style: { width: '74px' }, onchange: (e) => { t.delay = +e.target.value; } }),
          h('button.btn.sm', { onclick: () => { list.splice(i, 1); build(); } }, '✕'))),
        h('div.row', h('button.btn.pri', { onclick: () => { list.push({ on: 'TransitionIn', fn: 'OverlayInput1In', params: '', delay: 0 }); build(); } }, '＋ Tambah trigger'),
          h('span.muted', 'Contoh: saat video ini masuk Program → OverlayInput1In Input=3 (lower third muncul); saat selesai → Cut Input=1.'))));
      build();
      return wrap;
    },
    audio(inp) {
      const a = inp.audio, ap = () => KM.audio.apply(inp);
      const fxn = (a.fx || []).filter((x) => x.on !== false && KM.afx.defs[x.type]);
      return h('div',
        h('div.sec', h('h4', '🎚 Efek & plugin audio'),
          h('div.row', h('span.grow', fxn.length ? fxn.map((x) => KM.afx.defs[x.type].name).join(' → ') : h('span.muted', 'Belum ada efek — tambah EQ parametrik, kompresor, de-esser, reverb, AGC, peredam bising, plugin eksternal…')),
            h('button.btn.pri', { onclick: () => KM.afx.open(inp) }, '🎚 Buka rak efek'))),
        h('div.sec', h('h4', 'Level & routing'),
          h('div.kv', ...slider('Volume', 0, 100, 1, () => a.vol, (v) => { KM.audio.set(inp, 'vol', v); }, (v) => v + '%'),
            ...slider('Gain', -24, 24, 0.5, () => a.gain, (v) => { a.gain = v; ap(); }, (v) => v + ' dB'),
            ...slider('Balance', -1, 1, 0.01, () => a.pan, (v) => { a.pan = v; ap(); }, (v) => v.toFixed(2)),
            ...slider('Delay (sync)', 0, 1000, 5, () => a.delay, (v) => { a.delay = v; ap(); }, (v) => v + ' ms')),
          h('div.row', { style: { marginTop: '8px' } }, chk('Mute', a.mute, (v) => KM.audio.set(inp, 'mute', v)), chk('Audio ikut video (Auto)', a.auto, (v) => KM.audio.set(inp, 'auto', v)), chk('Solo (headphone)', a.solo, (v) => KM.audio.set(inp, 'solo', v))),
          h('div.row', h('label', 'Kirim ke bus'), chk('Master', a.M, (v) => KM.audio.set(inp, 'M', v)), chk('Bus A', a.A, (v) => KM.audio.set(inp, 'A', v)), chk('Bus B', a.B, (v) => KM.audio.set(inp, 'B', v)))),
        h('div.sec', h('h4', 'Equalizer 3-band'), chk('Aktifkan EQ', a.eq.on, (v) => { a.eq.on = v; ap(); }),
          h('div.kv', { style: { marginTop: '6px' } },
            ...slider('Low (120 Hz)', -15, 15, 0.5, () => a.eq.low, (v) => { a.eq.low = v; a.eq.on = true; ap(); }, (v) => v + ' dB'),
            ...slider('Mid (1.2 kHz)', -15, 15, 0.5, () => a.eq.mid, (v) => { a.eq.mid = v; a.eq.on = true; ap(); }, (v) => v + ' dB'),
            ...slider('High (7 kHz)', -15, 15, 0.5, () => a.eq.high, (v) => { a.eq.high = v; a.eq.on = true; ap(); }, (v) => v + ' dB'))),
        h('div.sec', h('h4', 'Pembersih & efek'),
          chk('High-pass filter (buang dengung/getar rendah)', a.hpf, (v) => { a.hpf = v; ap(); }),
          h('div.kv', { style: { marginTop: '6px' } }, ...slider('Frekuensi HPF', 40, 300, 5, () => a.hpfFreq || 90, (v) => { a.hpfFreq = v; ap(); }, (v) => v + ' Hz'),
            ...slider('Reverb', 0, 1, 0.01, () => a.rv || 0, (v) => { a.rv = v; ap(); }, pct)),
          h('div.row', chk('Pemicu ducking (mic)', a.duckTrigger, (v) => { a.duckTrigger = v; }), chk('Ikut di-ducking (musik)', a.ducked, (v) => { a.ducked = v; })),
          h('p.muted', 'Ducking: saat mic pemicu bersuara, input "musik" turun otomatis. Atur di Pengaturan → Audio.')),
        h('div.sec', h('h4', 'Dinamika'), chk('Kompresor', a.comp.on, (v) => { a.comp.on = v; ap(); }),
          h('div.kv', { style: { marginTop: '6px' } },
            ...slider('Threshold', -60, 0, 1, () => a.comp.thr, (v) => { a.comp.thr = v; ap(); }, (v) => v + ' dB'),
            ...slider('Ratio', 1, 20, 0.5, () => a.comp.ratio, (v) => { a.comp.ratio = v; ap(); }, (v) => v + ':1')),
          chk('Noise Gate', a.gate.on, (v) => { a.gate.on = v; ap(); }),
          h('div.kv', { style: { marginTop: '6px' } }, ...slider('Gate threshold', -80, -10, 1, () => a.gate.thr, (v) => { a.gate.thr = v; }, (v) => v + ' dB'))));
    }
  };

  const INPUT_EXTRA = {
    colour(inp) {
      const o = inp.opts, p = () => KM.inputTypes.colour.paint(inp);
      return h('div.sec', h('h4', 'Warna'), row('Warna 1', h('input', { type: 'color', value: o.color, oninput: (e) => { o.color = e.target.value; p(); } }), h('label', 'Warna 2'), h('input', { type: 'color', value: o.color2, oninput: (e) => { o.color2 = e.target.value; p(); } })),
        row('Gaya', sel([['none', 'Solid'], ['linear', 'Gradien linear'], ['radial', 'Gradien radial']], o.grad, (v) => { o.grad = v; p(); })));
    },
    image(inp) {
      return h('div.sec', h('h4', 'File'), h('div.urlbox', inp.opts.path || inp.opts.url), h('button.btn', { style: { marginTop: '6px' }, onclick: async () => { const [f] = await KM.pickFiles('image/*'); if (f) { inp.opts.url = f.url; inp.opts.path = f.path; inp.rt.el.src = f.url; } } }, 'Ganti gambar…'));
    },
    list(inp) {
      const o = inp.opts, L = KM.inputTypes.list;
      const lst = h('div.list');
      const redraw = () => lst.replaceChildren(...o.items.map((it, i) => h('div.li' + (i === inp.rt.idx ? '.on' : ''), h('span', it.kind === 'image' ? '🖼️' : '🎬'), h('span.grow', it.name),
        h('button.btn.sm', { onclick: () => { L.go(inp, i); redraw(); } }, '▶'),
        h('button.btn.sm', { onclick: () => { o.items.splice(i, 1); redraw(); } }, '✕'))));
      redraw();
      return h('div.sec', h('h4', 'Isi daftar putar'),
        h('div.row', h('button.btn', { onclick: async () => { (await KM.pickFiles('video/*,image/*', true)).forEach((f) => o.items.push({ name: f.name, url: f.url, path: f.path, kind: UI.fileKind(f.name, f.file.type) === 'image' ? 'image' : 'video' })); if (inp.rt.idx < 0) L.go(inp, 0); redraw(); } }, '＋ Tambah file'),
          h('button.btn', { onclick: () => { L.prev(inp); redraw(); } }, '⏮'), h('button.btn', { onclick: () => { L.next(inp); redraw(); } }, '⏭'),
          h('label', 'Durasi foto'), h('input', { type: 'number', value: o.imgDur, min: 1, style: { width: '64px' }, onchange: (e) => { o.imgDur = +e.target.value; } }),
          chk('Acak', o.shuffle, (v) => { o.shuffle = v; })),
        h('div', { style: { marginTop: '8px' } }, lst));
    },
    camera(inp) {
      const o = Object.assign({}, inp.opts);
      const vs = h('select.grow'), as = h('select.grow');
      listDevices('videoinput').then((l) => vs.replaceChildren(...l.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === o.deviceId }, d.label || 'Kamera ' + (i + 1)))));
      listDevices('audioinput').then((l) => as.replaceChildren(h('option', { value: '' }, '— Tanpa audio —'), ...l.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === o.audioDeviceId }, d.label || 'Mic ' + (i + 1)))));
      return h('div.sec', h('h4', 'Perangkat'), row('Kamera', vs), row('Resolusi', sel([['1280x720', '720p'], ['1920x1080', '1080p'], ['2560x1440', '1440p'], ['3840x2160', '4K']], o.width + 'x' + o.height, (v) => { const [w, hh] = v.split('x'); o.width = +w; o.height = +hh; }), h('label', 'FPS'), sel([25, 30, 50, 60], o.fps, (v) => { o.fps = +v; })),
        row('Audio', as),
        h('button.btn.pri', { onclick: () => { o.deviceId = vs.value; o.audioDeviceId = as.value; reinit(inp, o); } }, 'Terapkan'));
    },
    audio(inp) {
      const as = h('select.grow');
      listDevices('audioinput').then((l) => as.replaceChildren(...l.map((d, i) => h('option', { value: d.deviceId, selected: d.deviceId === inp.opts.deviceId }, d.label || 'Mic ' + (i + 1)))));
      return h('div.sec', h('h4', 'Perangkat'), row('Audio', as), h('button.btn.pri', { onclick: () => reinit(inp, Object.assign({}, inp.opts, { deviceId: as.value })) }, 'Terapkan'));
    },
    screen(inp) { return h('div.sec', h('button.btn', { onclick: () => { KM.inputs.remove(inp); D.addInput('screen'); } }, 'Pilih layar/jendela lain…')); },
    klmcam(inp) {
      const o = inp.opts, L = KM.link, peer = L.peers.get(inp.rt.camId);
      const z = h('input', { type: 'range', min: 1, max: 10, step: 0.1, value: inp.rt.zoom || 1, oninput: () => { inp.rt.zoom = +z.value; L.camControl(inp, 'zoom', +z.value); } });
      return h('div.sec', h('h4', '📱 KLMCAM ', peer ? h('span.pill.ok', 'Terhubung: ' + (peer.name || peer.ip)) : h('span.pill.warn', 'Menunggu HP slot ' + o.slot)),
        row('Slot', sel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], o.slot, (v) => { o.slot = +v; inp.rt.camId = null; KM.inputTypes.klmcam.setStream(inp, null); L.bindCams(); })),
        row('Kualitas', sel([['720p30', '720p 30'], ['720p60', '720p 60'], ['1080p30', '1080p 30'], ['1080p60', '1080p 60']], o.quality, (v) => L.camControl(inp, 'quality', v)),
          h('label', 'Bitrate'), sel([[2500, '2.5 Mbps'], [4000, '4 Mbps'], [6000, '6 Mbps'], [8000, '8 Mbps'], [12000, '12 Mbps']], o.bitrate, (v) => { o.bitrate = +v; L.camControl(inp, 'quality', o.quality); })),
        row('Zoom', z),
        h('div.row', h('button.btn', { onclick: () => L.camControl(inp, 'switch', 1) }, '🔄 Ganti kamera depan/belakang'),
          h('button.btn', { onclick: () => { inp.rt.torch = !inp.rt.torch; L.camControl(inp, 'torch', inp.rt.torch); } }, '🔦 Senter'),
          h('button.btn', { onclick: () => L.camControl(inp, 'focus', 'auto') }, '🎯 Fokus otomatis'),
          h('button.btn', { onclick: () => L.restartCam(inp) }, '↻ Sambung ulang')),
        peer && peer.info ? h('p.muted', `HP: ${peer.info.w}×${peer.info.h} @${peer.info.fps}fps • baterai ${peer.info.battery != null ? peer.info.battery + '%' : '?'}`) : null,
        h('p.muted', 'Tips latensi rendah: gunakan Wi-Fi 5 GHz / router dekat, 720p60 atau 1080p30, dan atur Delay audio jika perlu.'));
    },
    title(inp) { return h('div.sec', h('h4', 'Title Cepat (kanvas)'), KM.dock.titleEditor(inp)); },
    bars(inp) { return h('div.sec', h('p.muted', 'Color bars standar untuk kalibrasi monitor.')); },
    browser(inp) {
      const u = h('input.grow', { value: inp.opts.url });
      return h('div.sec', h('h4', 'Halaman web'), row('URL', u),
        h('div.row', h('button.btn.pri', { onclick: () => { inp.opts.url = u.value; KM.isElectron && window.klm.invoke('browser:navigate', inp.rt.winId, u.value); } }, 'Buka'),
          h('button.btn', { onclick: () => KM.isElectron && window.klm.invoke('browser:reload', inp.rt.winId) }, '↻ Muat ulang'),
          h('button.btn', { onclick: () => { inp.rt.shown = !inp.rt.shown; KM.isElectron && window.klm.invoke('browser:show', inp.rt.winId, inp.rt.shown); } }, '🖱 Tampilkan/sembunyikan jendela (untuk klik)')));
    },
    virtualset(inp) {
      const o = inp.opts, ch = () => { KM.virtualSets.paint(inp); KM.changed('input'); };
      const cams = S.inputs.filter((i) => i !== inp && !KM.inputTypes[i.type].noVideo);
      return h('div.sec', h('h4', 'Virtual Set'),
        row('Latar', sel(Object.entries(KM.virtualSets.presets), o.bg, (v) => { o.bg = v; ch(); })),
        row('Kamera', sel([['', '— pilih —']].concat(cams.map((c) => [c.id, KM.inputNum(c) + '. ' + c.title])), o.camId, (v) => { o.camId = v; ch(); })),
        row('Teks layar', h('input.grow', { value: o.caption, oninput: (e) => { o.caption = e.target.value; ch(); } })),
        h('div.kv', ...slider('Posisi X', 0, 1, 0.01, () => o.camX, (v) => { o.camX = v; }, (v) => v.toFixed(2)),
          ...slider('Posisi Y', 0, 1, 0.01, () => o.camY, (v) => { o.camY = v; }, (v) => v.toFixed(2)),
          ...slider('Skala', 0.2, 1.5, 0.01, () => o.camScale, (v) => { o.camScale = v; }, pct)));
    },
    replay() { return h('div.sec', h('p', 'Kontrol replay ada di tab ⏪ Replay pada panel kanan.')); }
  };
  INPUT_EXTRA.video = (inp) => h('div.sec', h('h4', 'File'), h('div.urlbox', inp.opts.path || inp.opts.url));
  INPUT_EXTRA.urlvideo = INPUT_EXTRA.video;
  INPUT_EXTRA.audiofile = INPUT_EXTRA.video;

  function reinit(inp, newOpts) {
    const rt = inp.rt;
    if (rt.stream) rt.stream.getTracks().forEach((t) => t.stop());
    KM.audio.detach(inp);
    inp.opts = newOpts; inp.rt = { thumb: rt.thumb };
    KM.inputTypes[inp.type].create(inp);
    KM.toast('Perangkat diterapkan');
  }

  // =================== PENGATURAN APLIKASI ===================
  D.settings = function (tab) {
    const st = KM.settings;
    const tabs = [['perf', 'Performa'], ['output', 'Output'], ['trans', 'Transisi & Overlay'], ['rec', 'Rekam'], ['stream', 'Streaming'], ['srt', 'SRT / TV'], ['ndi', 'NDI & VCam'], ['audio', 'Audio'], ['replay', 'Replay'], ['keys', 'Shortcut'], ['net', 'Jaringan & HP'], ['about', 'Tentang']];
    const content = h('div');
    const tabBar = h('div.tabs', tabs.map(([k, l]) => h('button', { 'data-k': k, onclick: () => show(k) }, l)));
    const save = () => KM.saveSettings();
    const P = {
      perf() {
        const cur = st.perf || 'seimbang';
        const card = (k, title, desc) => h('button.tile' + (cur === k ? '.on' : ''), { style: { alignItems: 'flex-start', textAlign: 'left' }, onclick: () => { KM.perf.apply(k); show('perf'); } }, h('b', { style: { fontSize: '15px', fontWeight: 700 } }, title), h('span', desc));
        return h('div', h('div.sec', h('h4', 'Mode performa'), h('div.tiles', { style: { gridTemplateColumns: 'repeat(3, 1fr)' } },
          card('hemat', '🍃 Hemat (PC kentang)', '720p 30fps, preview 33% & 15fps, thumbnail lambat, replay ringan. Paling ringan.'),
          card('seimbang', '⚖ Seimbang', '1080p, frame rate tetap (30/50/60 fps), preview 50%. Cocok untuk kebanyakan PC/laptop.'),
          card('kualitas', '💎 Kualitas', 'Resolusi & fps tetap (sampai 4K / 120 fps), preview penuh. Untuk PC dengan GPU kuat.'))),
          h('div.sec', h('h4', 'Penghemat otomatis'),
            chk('Jeda preview & thumbnail saat jendela diminimize (program tetap jalan)', st.pauseHidden !== false, (v) => { st.pauseHidden = v; save(); }),
            chk('Matikan multiview saat tidak ditampilkan', true, () => {}),
            h('p.muted', 'Streaming memakai encoder "Auto": H.264 langsung dari GPU tanpa encode ulang (paling ringan). Rekaman memakai encoder hardware bawaan Windows.')),
          h('div.sec', h('h4', 'Kinerja saat ini'), h('div.muted', 'Render: ' + KM.engine.fps + ' fps • Output ' + st.width + '×' + st.height + ' @' + st.fps)));
      },
      ndi() {
        return h('div', h('div.sec', h('h4', 'Output NDI'),
          row('Nama sumber', h('input', { value: st.ndiName || 'KLM Mix', onchange: (e) => { st.ndiName = e.target.value; save(); } })),
          row('Resolusi NDI', sel([[960, '960×540 (ringan)'], [1280, '1280×720'], [1920, '1920×1080']], st.ndiWidth || 1280, (v) => { st.ndiWidth = +v; save(); })),
          h('div.row', h('button.btn' + (S.ndiOut ? '.red' : '.green'), { onclick: async () => { await KM.rec.toggleNdi(); show('ndi'); } }, S.ndiOut ? '■ Matikan NDI' : '▶ Nyalakan NDI'),
            h('button.btn', { onclick: async () => { const r = await fetch('/hub/ndi/check').then((x) => x.json()).catch(() => ({ ok: false, msg: 'Hub tidak tersedia' })); KM.toast(r.ok ? 'NDI Runtime terdeteksi ✓' : '⚠ ' + r.msg, r.ok ? 'ok' : 'warn', 6000); } }, 'Cek NDI Runtime'))),
          h('div.sec', h('h4', '🎦 Virtual Camera (Zoom, Google Meet, Teams, OBS)'),
            h('ol', h('li', 'Instal NDI Tools (gratis) dari ndi.video.'), h('li', 'Nyalakan NDI di atas (tombol NDI / VCam di bar bawah).'), h('li', 'Buka aplikasi "NDI Webcam" → pilih sumber "' + (st.ndiName || 'KLM Mix') + '".'), h('li', 'Di Zoom/Meet/Teams pilih kamera "NDI Webcam Video 1".')),
            h('p.muted', 'Input NDI dari jaringan: Tambah Input → Stream Masuk → NDI.')));
      },
      keys() {
        const list = st.shortcuts || (st.shortcuts = []);
        const wrap = h('div');
        const all = KM.api.list();
        const COMMON = ['Cut', 'Fade', 'Merge', 'Wipe', 'Zoom', 'Transition1', 'Transition2', 'Transition3', 'Transition4', 'PreviewInput', 'ActiveInput', 'QuickPlay',
          'OverlayInput1', 'OverlayInput2', 'OverlayInput3', 'OverlayInput4', 'FadeToBlack', 'StartStopRecording', 'StartStopStreaming', 'Snapshot', 'UTCOnAir', 'ScoreOnAir', 'ScoreCmd', 'Play', 'Pause', 'Restart'].filter((f) => all.includes(f));
        // params "Input=..&Duration=..&Value=.." ⇄ kolom terpisah
        const parse = (str) => { const o = {}; String(str || '').split('&').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) o[kv.slice(0, i).trim()] = decodeURIComponent(kv.slice(i + 1).trim()); }); return o; };
        const compose = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
        const fnSelect = (val, on) => {
          const se = h('select', { style: { width: '190px' }, onchange: () => on(se.value) },
            h('optgroup', { label: 'Sering dipakai' }, COMMON.map((f) => h('option', { value: f, selected: f === val }, f))),
            h('optgroup', { label: 'Semua fungsi' }, all.filter((f) => !COMMON.includes(f)).map((f) => h('option', { value: f, selected: f === val }, f))));
          return se;
        };
        const inputSelect = (val, on) => {
          const se = h('select', { style: { width: '190px' }, title: 'Input yang dikenai shortcut', onchange: () => on(se.value) },
            h('option', { value: '' }, '— input Preview / tidak perlu —'),
            S.inputs.map((inp) => h('option', { value: inp.id, selected: inp.id === val || String(KM.inputNum(inp)) === String(val) || inp.title === val }, KM.inputNum(inp) + '. ' + inp.title)));
          if (val && !S.inputs.some((i) => i.id === val || String(KM.inputNum(i)) === String(val) || i.title === val)) se.append(h('option', { value: val, selected: true }, val + ' (tidak ada)'));
          return se;
        };
        const build = () => wrap.replaceChildren(h('div.sec', h('h4', 'Shortcut kustom (Stream Deck / keyboard / USB macro pad)'),
          list.length ? h('div.scrow.head', h('span', 'Tombol'), h('span', 'Fungsi'), h('span', 'Input'), h('span', 'Transisi (ms)'), h('span', 'Nilai'), h('span')) : null,
          ...list.map((s, i) => {
            const p = parse(s.params);
            const upd = () => { s.params = compose(p); save(); };
            const key = h('input', { value: s.key, readOnly: true, placeholder: 'tekan tombol…', style: { cursor: 'pointer' }, title: 'Klik lalu tekan kombinasi tombol' });
            key.addEventListener('keydown', (e) => { e.preventDefault(); if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; s.key = KM.script.combo(e); key.value = s.key; save(); });
            const dur = KM.api.usesDuration(s.fn), val = KM.api.usesValue(s.fn), inpOk = KM.api.usesInput(s.fn) || dur;
            const defMs = /^Transition([1-4])$/.test(s.fn) ? (KM.settings.transitions[+s.fn.slice(-1) - 1] || {}).dur : 500;
            return h('div.scrow', key,
              fnSelect(s.fn, (v) => { s.fn = v; save(); build(); }),
              inpOk ? inputSelect(p.Input || '', (v) => { p.Input = v; upd(); }) : h('span.muted', '—'),
              dur ? h('input', { type: 'number', min: 0, max: 10000, step: 50, value: p.Duration || '', placeholder: String(defMs || 500), title: 'Lama transisi dalam milidetik (kosong = bawaan)', onchange: (e) => { p.Duration = e.target.value; upd(); } }) : h('span.muted', '—'),
              val ? h('input', { value: p.Value || '', placeholder: 'nilai', onchange: (e) => { p.Value = e.target.value; upd(); } }) : h('span.muted', '—'),
              h('button.btn.sm', { title: 'Hapus shortcut', onclick: () => { list.splice(i, 1); save(); build(); } }, '✕'));
          }),
          h('div.row', { style: { marginTop: '8px' } }, h('button.btn.pri', { onclick: () => { list.push({ key: '', fn: 'Fade', params: '' }); save(); build(); } }, '＋ Tambah shortcut'),
            h('span.muted', 'Klik kotak Tombol lalu tekan kombinasi. Pilih input dari daftar & atur lama transisi (ms). Shortcut kustom menang atas bawaan.'))),
          h('div.sec', h('h4', 'Shortcut bawaan'), h('p.muted', 'Spasi=Cut • Enter=Transisi 1 • 1–0=Preview • Shift+angka=Cut • F1–F4=Overlay • B=FTB • Q=Quick Play • P=Play • M=Replay • Ctrl+R/L=Rekam/Live • F9=Panel lengkap UTC')));
        build();
        return wrap;
      },
      output() {
        const res = st.width + 'x' + st.height;
        return h('div', h('div.sec', h('h4', 'Resolusi & frame rate output'),
          row('Resolusi', sel([['1280x720', '1280×720 HD'], ['1920x1080', '1920×1080 Full HD'], ['2560x1440', '2560×1440 QHD'], ['3840x2160', '3840×2160 4K (berat)'], ['1080x1920', '1080×1920 Vertikal (TikTok/Reels)'], ['720x1280', '720×1280 Vertikal ringan'], ['1080x1080', '1080×1080 Persegi']], res, (v) => { const [w, hh] = v.split('x'); st.width = +w; st.height = +hh; save(); KM.engine.resize(); KM.toast('Output: ' + v); })),
          row('Frame rate', sel([[24, '24 fps (film)'], [25, '25 fps (PAL)'], [30, '30 fps'], [50, '50 fps (PAL halus)'], [60, '60 fps (halus)'], [90, '90 fps (monitor 90 Hz+)'], [120, '120 fps (monitor 120 Hz+)']], st.fps, (v) => { st.fps = +v; save(); KM.engine.resize(); if (st.fps > 60) KM.toast('Di atas 60 fps hanya tercapai bila monitor ' + st.fps + ' Hz atau lebih.', 'info', 5000); })),
          row('Skala preview', sel([[0.33, '33% (ringan)'], [0.5, '50%'], [0.75, '75%'], [1, '100%']], st.previewScale, (v) => { st.previewScale = +v; save(); KM.engine.resize(); })),
          chk('Tukar Preview ↔ Program setelah transisi (seperti vMix)', st.swapPreview !== false, (v) => { st.swapPreview = v; save(); })),
          h('p.muted', '50/60 fps membuat gerakan, running text & grafis jauh lebih halus di rekaman, stream, SRT & output. 1080p60 nyaman untuk PC menengah dengan GPU; 4K60 butuh GPU kuat. Bitrate rekaman otomatis dinaikkan untuk fps tinggi.'));
      },
      trans() {
        const inputs = [['', '— tidak ada —']].concat(S.inputs.filter((i) => KM.inputs.isPlayable(i)).map((i) => [i.id, KM.inputNum(i) + '. ' + i.title]));
        const types = Object.entries(KM.engine.TRANSITIONS).filter(([k]) => !k.startsWith('stinger'));
        return h('div',
          h('div.sec', h('h4', 'Tombol transisi 1–4'), ...st.transitions.map((t, i) => row('Transisi ' + (i + 1), sel(types, t.type, (v) => { t.type = v; save(); UI.renderTransSlots(); }), h('label', 'Durasi (ms)'), h('input', { type: 'number', value: t.dur, step: 50, min: 0, style: { width: '90px' }, onchange: (e) => { t.dur = +e.target.value; save(); UI.renderTransSlots(); } })))),
          h('div.sec', h('h4', 'Stinger (video transisi, mendukung WebM transparan)'), ...st.stingers.map((s, i) => row('Stinger ' + (i + 1), sel(inputs, s.inputId, (v) => { s.inputId = v; save(); }), h('label', 'Titik cut (ms)'), h('input', { type: 'number', value: s.cut, step: 50, style: { width: '90px' }, onchange: (e) => { s.cut = +e.target.value; save(); } }))),
            h('p.muted', 'Tambahkan video stinger sebagai input dulu, lalu pilih di sini. Titik cut = saat layar tertutup penuh oleh stinger.')),
          h('div.sec', h('h4', 'Efek overlay 1–4'), ...st.overlayFx.map((o, i) => row('Overlay ' + (i + 1), sel(Object.entries(KM.engine.OVERLAY_FX), o.type, (v) => { o.type = v; save(); }), h('label', 'Durasi (ms)'), h('input', { type: 'number', value: o.dur, step: 50, style: { width: '90px' }, onchange: (e) => { o.dur = +e.target.value; save(); } })))));
      },
      rec() {
        const folder = h('input.grow', { value: st.recFolder, placeholder: 'Default: Videos\\KLM Mix', onchange: (e) => { st.recFolder = e.target.value; save(); } });
        const mcSel = st.multicorder || [];
        return h('div', h('div.sec', h('h4', 'Perekaman program'),
          row('Format', sel([['mp4', 'MP4 (H.264 + AAC)'], ['webm', 'WebM']], st.recFormat, (v) => { st.recFormat = v; save(); }), h('span.muted', 'Codec dipakai: ' + (KM.rec.pickMime(st.recFormat) || 'tidak didukung'))),
          row('Bitrate video', sel([[6000, '6 Mbps'], [8000, '8 Mbps'], [12000, '12 Mbps'], [20000, '20 Mbps'], [40000, '40 Mbps']], st.recVideoKbps, (v) => { st.recVideoKbps = +v; save(); })),
          row('Bitrate audio', sel([[128, '128 kbps'], [192, '192 kbps'], [256, '256 kbps'], [320, '320 kbps']], st.recAudioKbps, (v) => { st.recAudioKbps = +v; save(); })),
          row('Sumber audio', sel([['master', 'Master'], ['A', 'Bus A'], ['B', 'Bus B']], st.recSource, (v) => { st.recSource = v; save(); })),
          row('Folder', folder, KM.isElectron ? h('button.btn', { onclick: async () => { const f = await window.klm.invoke('dialog:folder', {}); if (f) { folder.value = f; st.recFolder = f; save(); } } }, 'Pilih…') : h('span.muted', '(browser: folder Unduhan)'))),
          h('div.sec', h('h4', 'MultiCorder — input yang direkam terpisah'),
            ...S.inputs.filter((i) => i.rt.stream && i.rt.stream.getVideoTracks().length).map((i) => chk(KM.inputNum(i) + '. ' + i.title, mcSel.includes(i.id), (v) => { st.multicorder = (st.multicorder || []).filter((x) => x !== i.id).concat(v ? [i.id] : []); save(); })),
            h('p.muted', 'Jika tidak ada yang dicentang, semua kamera/KLMCAM/capture direkam.')));
      },
      stream() {
        const sc = st.stream;
        const PRESET = [['', 'Preset server…'], ['rtmp://a.rtmp.youtube.com/live2/', 'YouTube'], ['rtmps://live-api-s.facebook.com:443/rtmp/', 'Facebook'], ['rtmp://live.twitch.tv/app/', 'Twitch'], ['rtmp://', 'Custom RTMP'], ['srt://', 'SRT']];
        return h('div',
          !KM.isElectron ? h('div.sec', h('p', '⚠ Streaming RTMP memerlukan versi PC (.exe) karena memakai ffmpeg bawaan.')) : null,
          h('div.sec', h('h4', 'Encoder'),
            (() => { const info = h('span.muted', 'mendeteksi GPU…'); KM.rec.detectEncoders().then((e) => { info.textContent = 'Terdeteksi: ' + ['nvenc', 'qsv', 'amf'].filter((k) => e[k]).map((k) => ({ nvenc: 'NVIDIA', qsv: 'Intel', amf: 'AMD' }[k])).join(', ') || 'Terdeteksi: tidak ada GPU encoder (pakai Auto/x264)'; }); return info; })(),
            row('Encoder video', sel([['auto', 'Auto — paling ringan (disarankan)'], ['x264', 'x264 (CPU, paling kompatibel)'], ['nvenc', 'NVIDIA NVENC (GPU)'], ['qsv', 'Intel QuickSync (GPU)'], ['amf', 'AMD AMF (GPU)'], ['copy', 'Copy H.264 (paling ringan, eksperimental)']], sc.encoder, (v) => { sc.encoder = v; save(); })),
            row('Preset x264', sel(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'], sc.preset, (v) => { sc.preset = v; save(); })),
            row('Bitrate video', sel([[1500, '1.5 Mbps (480p)'], [2500, '2.5 Mbps (720p)'], [3500, '3.5 Mbps'], [4500, '4.5 Mbps (1080p30)'], [6000, '6 Mbps (1080p60)'], [9000, '9 Mbps'], [12000, '12 Mbps']], sc.videoBitrate, (v) => { sc.videoBitrate = +v; save(); }),
              h('label', 'Audio'), sel([[128, '128k'], [160, '160k'], [192, '192k'], [256, '256k']], sc.audioBitrate, (v) => { sc.audioBitrate = +v; save(); }))),
          (() => { // tujuan live = akun di panel Live (bisa banyak akun per platform)
            const L = KM.live, acc = L ? L.cfg().accounts : [];
            return h('div.sec', h('h4', 'Akun tujuan live'),
              acc.length ? h('div', acc.map((a) => h('div.row', { style: { gap: '8px', margin: '4px 0' } }, h('span.pill' + (a.on ? '.ok' : ''), a.on ? 'ikut live' : 'tidak'), h('b', a.name || L.PLAT[a.platform].name), h('span.muted', L.PLAT[a.platform].name + (a.mode === 'api' ? ' • otomatis (API)' : ''))))) : h('p.muted', 'Belum ada akun.'),
              h('div.row', { style: { marginTop: '8px' } }, h('button.btn.pri', { onclick: (e) => { const bg = e.target.closest('.modal-bg'); if (bg) bg.querySelector('.mh .x').click(); KM.ui.dockTab('live'); } }, KI.el('radio'), 'Kelola akun, judul & thumbnail di panel Live')));
          })(),
          h('p.muted', 'Bisa live ke banyak akun sekaligus (YouTube, Facebook, TikTok, Instagram, RTMP lain). Jika internet lemah, turunkan bitrate.'),
          KM.rec.log ? h('details', h('summary', 'Log ffmpeg'), h('pre', { style: { maxHeight: '200px', overflow: 'auto', fontSize: '11px', userSelect: 'text' } }, KM.rec.log)) : null);
      },
      srt() {
        const c = KM.rec.srtCfg(), R = KM.rec;
        const inp = (k, attrs, cast) => h('input', Object.assign({ value: c[k] == null ? '' : c[k], onchange: (e) => { c[k] = cast ? cast(e.target.value) : e.target.value; save(); upd(); } }, attrs || {}));
        const urlBox = h('div.urlbox');
        const stBox = h('div.row');
        const upd = () => {
          const host = c.mode === 'listener' ? '0.0.0.0' : (c.host || '…');
          urlBox.textContent = 'srt://' + host + ':' + c.port + '?mode=' + c.mode + '&latency=' + c.latency * 1000 + (c.streamid ? '&streamid=' + c.streamid : '') + (c.passphrase ? '  🔒 AES-' + (c.pbkeylen * 8) : '');
          const live = R.srtStatus === 'live', lbl = { off: 'Tidak aktif', menyambung: 'Menyambung…', menunggu: 'Menunggu gateway…', ulang: 'Menyambung ulang', live: 'TERSAMBUNG', error: 'Error' }[R.srtStatus] || R.srtStatus;
          const s = R.srtStats;
          stBox.replaceChildren(...[
            h('span.pill' + (live ? '.ok' : S.srt ? '.warn' : ''), lbl),
            S.srt && s ? h('span.muted', s.bitrate + ' • ' + s.fps + ' fps • ' + s.speed + ' • ' + KM.fmtTime(R.srtTime())) : null,
            R.srtMsg ? h('span.muted', R.srtMsg) : null, h('span.grow'),
            h('button.btn' + (S.srt ? '.red' : '.pri'), { onclick: async () => { await R.toggleSrt(); setTimeout(upd, 100); } }, S.srt ? '■ Hentikan SRT' : '▶ Mulai SRT')].filter(Boolean));
        };
        const tick = setInterval(() => { if (!document.body.contains(urlBox)) return clearInterval(tick); upd(); }, 1000);
        const encInfo = h('span.muted', '');
        KM.rec.detectEncoders().then((e) => { encInfo.textContent = 'GPU encoder: ' + (['nvenc', 'qsv', 'amf'].filter((k) => e[k]).map((k) => ({ nvenc: 'NVIDIA', qsv: 'Intel', amf: 'AMD' }[k])).join(', ') || 'tidak ada (pakai x264)'); });
        upd();
        return h('div',
          !KM.isElectron ? h('div.sec', h('p', '⚠ Output SRT memerlukan versi PC (.exe) — memakai ffmpeg bawaan.')) : null,
          h('div.sec', h('h4', '📡 Status SRT'), stBox, h('div', { style: { marginTop: '10px' } }, urlBox),
            h('p.muted', 'Program dikirim realtime ke gateway / decoder TV (Haivision, Kiloview, Magewell, Matrox, vMix, OBS, Wowza, dll). Berjalan terpisah dari tombol Stream — bisa bersamaan.')),
          h('div.sec', h('h4', 'Koneksi'),
            row('Mode', sel([['caller', 'Caller — KLM Mix menyambung ke gateway (umum)'], ['listener', 'Listener — gateway menyambung ke PC ini'], ['rendezvous', 'Rendezvous']], c.mode, (v) => { c.mode = v; save(); show('srt'); })),
            c.mode !== 'listener' ? row('IP / host gateway', inp('host', { placeholder: 'contoh: 192.168.1.50 atau gateway.tvku.id', class: 'grow' }), h('label', 'Port'), inp('port', { type: 'number', style: { width: '90px' } }, (v) => +v || 9000))
              : row('Port di PC ini', inp('port', { type: 'number', style: { width: '90px' } }, (v) => +v || 9000), h('span.muted', 'Gateway menyambung ke srt://' + ((KM.link.ips[0] || {}).address || 'IP-PC') + ':' + c.port)),
            row('Latensi', sel([[80, '80 ms (LAN)'], [120, '120 ms'], [200, '200 ms (disarankan)'], [500, '500 ms'], [1000, '1 detik (internet)'], [2000, '2 detik (jaringan buruk)']], c.latency, (v) => { c.latency = +v; save(); upd(); }), h('label', 'Stream ID'), inp('streamid', { placeholder: 'opsional, mis. #!::r=live/tv1,m=publish', class: 'grow' })),
            row('Passphrase', inp('passphrase', { type: 'password', placeholder: 'kosong = tanpa enkripsi (10–79 karakter)', class: 'grow', autocomplete: 'off' }), sel([[16, 'AES-128'], [24, 'AES-192'], [32, 'AES-256']], c.pbkeylen, (v) => { c.pbkeylen = +v; save(); upd(); }))),
          h('div.sec', h('h4', 'Video & audio siaran'), encInfo,
            row('Encoder', sel([['auto', 'Auto — GPU bila ada (disarankan)'], ['x264', 'x264 (CPU)'], ['nvenc', 'NVIDIA NVENC'], ['qsv', 'Intel QuickSync'], ['amf', 'AMD AMF'], ['copy', 'Copy H.264 (paling ringan, timing kurang stabil)']], c.encoder, (v) => { c.encoder = v; save(); })),
            row('Bitrate video', sel([[3000, '3 Mbps'], [4500, '4.5 Mbps'], [6000, '6 Mbps (1080p, disarankan)'], [8000, '8 Mbps'], [10000, '10 Mbps'], [15000, '15 Mbps (LAN)'], [20000, '20 Mbps (LAN)']], c.videoBitrate, (v) => { c.videoBitrate = +v; save(); }),
              h('label', 'Resolusi'), sel([['same', 'Sama dengan output'], ['1080', '1920×1080'], ['720', '1280×720'], ['576', '1024×576']], c.res, (v) => { c.res = v; save(); })),
            row('Audio', sel([['aac', 'AAC (umum)'], ['mp2', 'MPEG-1 Layer II (decoder siaran lama)']], c.audioCodec, (v) => { c.audioCodec = v; save(); }), sel([[128, '128 kbps'], [192, '192 kbps'], [256, '256 kbps'], [320, '320 kbps']], c.audioBitrate, (v) => { c.audioBitrate = +v; save(); }),
              h('label', 'GOP'), sel([[0.5, '0,5 dtk'], [1, '1 dtk (cepat pulih)'], [2, '2 dtk']], c.gop, (v) => { c.gop = +v; save(); })),
            chk('CBR + muxrate MPEG-TS tetap (wajib untuk banyak decoder hardware / modulator)', c.cbr !== false, (v) => { c.cbr = v; save(); }),
            chk('Mulai SRT otomatis saat KLM Mix dibuka', !!c.autoStart, (v) => { c.autoStart = v; save(); }),
            h('p.muted', 'Putus koneksi (gateway restart / jaringan) disambung ulang otomatis tanpa menghentikan mixer. Video dikirim dengan GOP tetap tanpa B-frame agar decoder TV cepat mengunci gambar.')),
          R.srtLog ? h('details', h('summary', 'Log ffmpeg SRT'), h('pre', { style: { maxHeight: '200px', overflow: 'auto', fontSize: '11px', userSelect: 'text' } }, R.srtLog)) : null);
      },
      audio() {
        const out = h('select.grow');
        listDevices('audiooutput').then((l) => out.replaceChildren(h('option', { value: '' }, 'Default sistem'), ...l.map((d) => h('option', { value: d.deviceId, selected: d.deviceId === st.audioOutDevice }, d.label || d.deviceId))));
        out.onchange = () => KM.audio.setOutputDevice(out.value);
        return h('div.sec', h('h4', 'Monitor (headphone/speaker)'),
          chk('Dengarkan audio master di PC', st.monitorAudio, (v) => { KM.audio.setMonitor(v); save(); }),
          row('Perangkat output', out),
          chk('Limiter master (cegah suara pecah)', st.masterLimiter !== false, (v) => { KM.audio.setLimiter(v); save(); }),
          h('div.row', h('button.btn', { onclick: () => KM.afx.open('master') }, '🎚 Rak efek Master'), KM.isElectron ? h('button.btn', { onclick: () => window.klm.invoke('fx:open-folder') }, '📂 Folder plugin audio') : null, h('span.muted', 'Efek per input: tombol FX di mixer.')),
          ...['A', 'B'].map((b) => { const s2 = h('select.grow'); listDevices('audiooutput').then((l) => s2.replaceChildren(h('option', { value: '' }, '— tidak dikirim —'), ...l.map((d) => h('option', { value: d.deviceId, selected: d.deviceId === (st.busDevice || {})[b] }, d.label || d.deviceId)))); s2.onchange = () => { KM.audio.setBusDevice(b, s2.value); save(); }; return row('Output Bus ' + b, s2); }),
          (() => { const dk = st.duck || (st.duck = { on: false, thr: -35, depth: -15, hold: 600 }); return h('div', { style: { marginTop: '10px' } }, chk('Auto-ducking (musik turun saat mic bicara)', dk.on, (v) => { dk.on = v; save(); }),
            h('div.kv', ...slider('Ambang mic', -60, -10, 1, () => dk.thr, (v) => { dk.thr = v; save(); }, (v) => v + ' dB'), ...slider('Turunkan', -40, -3, 1, () => dk.depth, (v) => { dk.depth = v; save(); }, (v) => v + ' dB'), ...slider('Tahan', 100, 3000, 50, () => dk.hold, (v) => { dk.hold = v; save(); }, (v) => v + ' ms')),
            h('p.muted', 'Tandai mic sebagai "Pemicu ducking" dan musik sebagai "Ikut di-ducking" di ⚙ input → Audio.')); })(),
          h('p.muted', 'Matikan monitor jika memakai mic di ruangan yang sama dengan speaker (cegah feedback). Gunakan Solo di mixer untuk cek satu input lewat headphone.'));
      },
      replay() {
        const rs = st.replay;
        return h('div.sec', h('h4', 'Instant Replay'),
          row('Durasi buffer', sel([[10, '10 detik'], [15, '15 detik'], [30, '30 detik'], [60, '60 detik']], rs.seconds, (v) => { rs.seconds = +v; save(); })),
          row('Resolusi buffer', sel([['640x360', '640×360 (hemat RAM)'], ['960x540', '960×540'], ['1280x720', '1280×720 (RAM besar)']], rs.width + 'x' + rs.height, (v) => { const [w, hh] = v.split('x'); rs.width = +w; rs.height = +hh; save(); })),
          row('Sumber', sel([['program', 'Program']].concat(S.inputs.filter((i) => !KM.inputTypes[i.type].noVideo && i.type !== 'replay').map((i) => [i.id, KM.inputNum(i) + '. ' + i.title])), rs.source, (v) => { rs.source = v; save(); })),
          h('p.muted', 'Perkiraan RAM: ' + Math.round(rs.width * rs.height * 4 * rs.seconds * 30 / 1048576) + ' MB.'));
      },
      net() {
        const urls = phoneUrls();
        const box = h('div',
          h('div.sec', h('h4', 'Alamat untuk HP (Wi-Fi/LAN yang sama, tanpa internet)'),
            ...urls.map((u) => h('div.row', D.qr(u.hp), h('div.grow', h('div', h('b', u.name || 'Jaringan') + ''), h('div.urlbox', '📱 Menu HP: ' + u.hp), h('div.urlbox', '📷 KLMCAM: ' + u.cam), h('div.urlbox', '🎛 Remote: ' + u.remote)))),
            chk('Otomatis tambah input saat KLMCAM terhubung', st.autoAddCam, (v) => { st.autoAddCam = v; save(); })),
          h('div.sec', h('h4', 'API (kompatibel vMix — Stream Deck / Bitfocus Companion / tally)'),
            h('div.urlbox', `HTTP : http://${urls[0] ? urls[0].ip : '127.0.0.1'}:${KM.link.ports.http}/api/?Function=Cut`),
            h('div.urlbox', `XML  : http://${urls[0] ? urls[0].ip : '127.0.0.1'}:${KM.link.ports.http}/api`),
            h('div.urlbox', `TCP  : port ${KM.link.ports.tcp} (FUNCTION, XML, TALLY, SUBSCRIBE TALLY)`)));
        if (KM.isElectron) {
          window.klm.invoke('server:get').then((c) => {
            const hp = h('input', { type: 'number', value: c.httpPort, style: { width: '90px' } }), hs = h('input', { type: 'number', value: c.httpsPort, style: { width: '90px' } }), tp = h('input', { type: 'number', value: c.tcpPort, style: { width: '90px' } });
            box.append(h('div.sec', h('h4', 'Port server (ubah jika bentrok dengan aplikasi lain)'),
              row('HTTP', hp, h('label', 'HTTPS'), hs, h('label', 'TCP'), tp),
              h('div.row', h('button.btn.pri', { onclick: async () => { await window.klm.invoke('server:set', { httpPort: +hp.value, httpsPort: +hs.value, tcpPort: +tp.value }); if (await UI.confirm('Port disimpan. Mulai ulang KLM Mix sekarang?', 'Mulai ulang')) window.klm.invoke('app:relaunch'); } }, 'Simpan port'),
                h('span.muted', 'Default 8620/8621/8622 — tidak bentrok dengan vMix (8088/8099), UTC KLM & KLMCAM lama.'))));
          });
        }
        return box;
      },
      about() {
        return h('div', h('div.sec', h('h4', 'KLM Mix ' + KM.version),
          h('p', 'Studio produksi live all-in-one: switcher, transisi, overlay, grafis UTC Acara, scoreboard UTC Score, kamera HP KLMCAM, mixer audio, rekam, streaming multi-platform, instant replay, playlist, multiview & API vMix.'),
          h('p.muted', 'Berjalan 100% offline. Versi PC (.exe) & aplikasi HP (.apk).')),
          h('div.sec', h('h4', 'Browser engine'), h('div.muted', navigator.userAgent)));
      }
    };
    function show(k) {
      KM.$$('button', tabBar).forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      content.replaceChildren(P[k]());
    }
    UI.modal('⚙ Pengaturan', h('div', tabBar, content), [{ label: 'Selesai', cls: 'pri' }], 'wide');
    show(tab || 'output');
  };
  UI.openSettings = D.settings;

  // =================== OUTPUT EKSTERNAL ===================
  D.external = async function (mode) {
    let displays = [{ index: 0, label: 'Jendela (dapat dipindah)' }];
    if (KM.isElectron) { const info = await window.klm.invoke('app:info'); displays = [{ index: 0, label: 'Jendela biasa (dapat dipindah)' }].concat(info.displays.filter((d) => d.index > 0).map((d) => ({ index: d.index, label: 'Layar penuh di ' + d.label }))); }
    let disp = displays[displays.length - 1].index, md = mode || 'program';
    UI.modal('🖥️ Output Eksternal', h('div',
      row('Konten', sel([['program', 'Program (output utama)'], ['multiview', 'Multiview (preview + program + 8 input)']], md, (v) => { md = v; })),
      row('Tampilkan di', sel(displays.map((d) => [d.index, d.label]), disp, (v) => { disp = +v; })),
      h('p.muted', 'Untuk proyektor/TV/LED: sambungkan sebagai monitor ke-2 (extend). Output juga bisa ditangkap OBS lewat Window Capture.'),
      S.externalOn ? h('button.btn.red', { onclick: () => KM.engine.closeOutputs() }, 'Tutup semua output') : null),
      [{ label: 'Batal' }, { label: 'Buka output', cls: 'pri', fn: () => KM.engine.openOutput(md, disp) }], 'sm');
  };

  // =================== BANTUAN ===================
  D.help = function () {
    const sc = [['Spasi', 'Cut'], ['Enter', 'Transisi 1 (Auto)'], ['Q', 'Quick Play preview'], ['1–9, 0', 'Pilih preview input 1–10'], ['Shift + 1–9', 'Cut langsung ke input'], ['F1–F4', 'Overlay 1–4 (dengan input preview)'], ['B', 'Fade To Black'], ['P', 'Play/Pause input preview'], ['← / →', 'Preview sebelum/berikutnya'], ['M', 'Tandai replay 8 detik'], ['Ctrl+R', 'Mulai/stop rekam'], ['Ctrl+L', 'Mulai/stop streaming'], ['Ctrl+I', 'Tambah input'], ['Ctrl+S / Ctrl+O', 'Simpan / buka proyek'], ['Ctrl+Shift+S', 'Snapshot'], ['F11', 'Layar penuh'], ['Ctrl + klik thumbnail', 'Cut ke input'], ['Dobel klik thumbnail', 'Pengaturan input']];
    UI.modal('❔ Bantuan KLM Mix', h('div',
      h('div.sec', h('h4', 'Shortcut keyboard'), h('div.help-grid', sc.map(([k, v]) => h('div', h('code', k), h('span', v))))),
      h('div.sec', h('h4', 'Alur kerja cepat'),
        h('ol', h('li', 'Tambah input (kamera, KLMCAM HP, video, gambar, title).'), h('li', 'Klik thumbnail → masuk Preview (hijau).'), h('li', 'Tekan Cut / transisi → masuk Program (merah).'), h('li', 'Pakai tombol 1–4 di kartu untuk overlay (lower third, logo, running text).'), h('li', 'Rekam / Stream dari bar bawah.'))),
      h('div.sec', h('h4', 'Fungsi API (' + KM.api.list().length + ')'), h('p.muted', 'Contoh: /api/?Function=SetText&Input=3&SelectedName=nama&Value=Ustadz%20Ahmad'), h('div.fnlist', KM.api.list().map((f) => h('div', f))))),
      [{ label: 'Tutup', cls: 'pri' }], 'wide');
  };
})(window.KM);
