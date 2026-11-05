/* UTC KLM ACARA — data bersama (dipakai panel kontrol & overlay) */
(function (G) {
  const K = {};

  K.LT_LAYOUTS = [
    { id: 'arabesque', n: 'Arabesque Islami' },
    { id: 'glass3d', n: 'Kaca 3D' },
    { id: 'luxe', n: 'Mewah Emas' },
    { id: 'neon', n: 'Neon Glow' },
    { id: 'ribbon', n: 'Pita 3D Miring' },
    { id: 'cube', n: 'Blok 3D Timbul' },
    { id: 'metal', n: 'Metalik Bevel' },
    { id: 'capsule', n: 'Kapsul Glossy' },
    { id: 'float', n: 'Kartu Melayang' },
    { id: 'line', n: 'Garis Cahaya Minimalis' },
    { id: 'prism', n: 'Prisma Kristal' },
    { id: 'stack', n: 'Lapisan 3D Bertumpuk' },
    { id: 'hex', n: 'Heksagon Futuristik' },
    { id: 'split', n: 'Dua Warna Diagonal' },
    { id: 'holo', n: 'Hologram' },
    { id: 'frost', n: 'Kaca Putih Frosted' },
    { id: 'tab', n: 'Tab Label Atas' },
    { id: 'fold', n: 'Pita Lipat 3D' },
    { id: 'pillar', n: 'Pilar Cahaya' },
    { id: 'orbit', n: 'Lingkaran Orbit' }
  ];
  K.TT_LAYOUTS = [
    { id: 'arch', n: 'Kubah / Lengkung Islami' },
    { id: 'frame', n: 'Bingkai Mewah' },
    { id: 'glass', n: 'Panel Kaca 3D' },
    { id: 'cinematic', n: 'Sinematik' },
    { id: 'neon', n: 'Neon Sign' },
    { id: 'ribbon', n: 'Spanduk Pita 3D' },
    { id: 'band', n: 'Pita Lebar Bawah' },
    { id: 'medallion', n: 'Medali Bundar' },
    { id: 'stage', n: 'Panggung Spotlight' },
    { id: 'prism', n: 'Prisma Kristal' },
    { id: 'stack', n: 'Lapisan 3D Bertumpuk' },
    { id: 'hex', n: 'Oktagon Bingkai Cahaya' },
    { id: 'split', n: 'Dua Panel Diagonal' },
    { id: 'holo', n: 'Hologram' },
    { id: 'curtain', n: 'Tirai Mewah' }
  ];
  K.TK_LAYOUTS = [
    { id: 'arabesque', n: 'Arabesque' },
    { id: 'glass', n: 'Kaca' },
    { id: 'luxe', n: 'Mewah Emas' },
    { id: 'neon', n: 'Neon' },
    { id: 'ribbon', n: 'Timbul 3D' },
    { id: 'capsule', n: 'Kapsul Glossy' },
    { id: 'prism', n: 'Prisma Kristal' },
    { id: 'stack', n: 'Lapisan 3D' },
    { id: 'split', n: 'Diagonal Dua Warna' },
    { id: 'holo', n: 'Hologram' },
    { id: 'frost', n: 'Kaca Putih' },
    { id: 'hex', n: 'Ujung Runcing' },
    { id: 'tab', n: 'Tab Label Atas' },
    { id: 'chrome', n: 'Krom Metalik' }
  ];
  K.LIGHTS = [
    { id: 'none', n: 'Tanpa cahaya' },
    { id: 'sweep', n: 'Kilau menyapu' },
    { id: 'edge', n: 'Cahaya keliling tepi' },
    { id: 'glow', n: 'Pendar berdenyut' },
    { id: 'shimmer', n: 'Teks berkilau' },
    { id: 'sparkle', n: 'Bintang berkelip' },
    { id: 'flare', n: 'Lens flare' },
    { id: 'beam', n: 'Sinar dari belakang' },
    { id: 'combo', n: 'Kombinasi (kilau+tepi+bintang)' }
  ];
  K.BUG_FX = [
    { id: 'none', n: 'Tanpa efek' },
    { id: 'glow', n: 'Pendar berdenyut' },
    { id: 'sweep', n: 'Kilau menyapu' },
    { id: 'spin3d', n: 'Putar 3D berkala' },
    { id: 'sparkle', n: 'Bintang berkelip' },
    { id: 'glowsweep', n: 'Pendar + kilau' }
  ];
  K.ANIMS = [
    { id: 'lightWipe', n: 'Sapuan cahaya' },
    { id: 'unfold', n: 'Garis cahaya membuka' },
    { id: 'flip3d', n: 'Flip 3D' },
    { id: 'swing3d', n: 'Ayun 3D' },
    { id: 'cubeTurn', n: 'Putar kubus 3D' },
    { id: 'zoomGlow', n: 'Zoom berpendar' },
    { id: 'slideLight', n: 'Geser + kilat' },
    { id: 'riseFlash', n: 'Naik + kilat' },
    { id: 'dropBounce', n: 'Jatuh memantul' },
    { id: 'lightBurst', n: 'Ledakan cahaya' },
    { id: 'fade', n: 'Pudar halus' }
  ];
  K.FONTS = ['Montserrat', 'Poppins', 'Oswald', 'Bebas Neue', 'Playfair Display', 'Cinzel', 'Lora', 'Great Vibes', 'Cairo', 'Amiri', 'Reem Kufi'];
  K.FONT_URL = '/utc/fonts/fonts.css';   // huruf lokal (100% offline)
  K.SEPS = ['◆', '•', '★', '✦', '❖', '۞', '|', '—'];

  // ---- TITLE LOKASI ----
  K.LOC_LAYOUTS = [
    { id: 'pin3d', n: 'Pin 3D Melayang' },
    { id: 'mapcard', n: 'Kartu Peta' },
    { id: 'beacon', n: 'Radar Berdenyut' },
    { id: 'signpost', n: 'Papan Penunjuk Jalan' },
    { id: 'tag', n: 'Label Gantung' },
    { id: 'compass', n: 'Kompas Berputar' },
    { id: 'live', n: 'Siaran Langsung (LIVE)' },
    { id: 'neon', n: 'Neon Pin' },
    { id: 'glass', n: 'Kapsul Kaca Putih' },
    { id: 'stack', n: 'Lapisan 3D' },
    { id: 'ribbon', n: 'Pita + Medali Pin' },
    { id: 'minimal', n: 'Garis Cahaya Minimalis' }
  ];
  K.LOC_POS = [['tl', '↖ Kiri atas'], ['tc', '↑ Tengah atas'], ['tr', '↗ Kanan atas'], ['bl', '↙ Kiri bawah'], ['bc', '↓ Tengah bawah'], ['br', '↘ Kanan bawah']];
  K.LOC_DEF = {
    pengajian: ['Masjid Agung Al-Ikhlas', 'Jl. Merdeka No. 10, Bandung'],
    pernikahan: ['Gedung Serbaguna Al-Hikmah', 'Jl. Melati No. 5, Jakarta Selatan'],
    khitanan: ['Kediaman Bapak Hendra', 'Perum Griya Asri Blok C-12, Bekasi'],
    aqiqah: ['Kediaman Bapak Fajar', 'Jl. Kenanga No. 7, Bogor'],
    tasyakuran: ['Kediaman Bapak H. Rahmat', 'Jl. Anggrek No. 3, Depok'],
    maulid: ['Masjid Jami\' Nurul Huda', 'Jl. Raya Pasar Minggu, Jakarta'],
    isra: ['Masjid Raya Baiturrahman', 'Kota Semarang'],
    halal: ['Aula Kantor Pusat', 'Jl. Sudirman Kav. 21, Jakarta'],
    tabligh: ['Lapangan Masjid Al-Azhar', 'Kebayoran Baru, Jakarta'],
    wisuda: ['Aula Pondok Pesantren Darul Ulum', 'Jombang, Jawa Timur'],
    seminar: ['Ballroom Hotel Grand Mercure', 'Jl. Gatot Subroto, Jakarta'],
    ultah: ['Kediaman Keluarga Putri', 'Jl. Mawar No. 9, Surabaya']
  };

  // ---- OPENING / CLOSING ----
  K.OC_LAYOUTS = [
    { id: 'center', n: 'Logo atas • tulisan bawah' },
    { id: 'side', n: 'Logo kiri • tulisan kanan' },
    { id: 'sideR', n: 'Tulisan kiri • logo kanan' },
    { id: 'textTop', n: 'Tulisan atas • logo bawah' },
    { id: 'frame', n: 'Dalam bingkai 3D' },
    { id: 'ring', n: 'Logo dalam cincin cahaya' },
    { id: 'logo', n: 'Logo saja' },
    { id: 'text', n: 'Tulisan saja' }
  ];
  K.OC_BGS = [
    { id: 'theme', n: 'Gradien tema + pola' },
    { id: 'radial', n: 'Sorot cahaya tengah' },
    { id: 'stars', n: 'Langit berbintang' },
    { id: 'black', n: 'Hitam polos' },
    { id: 'transparent', n: 'Transparan (video tetap terlihat)' }
  ];
  K.OC_LIGHTS = [
    { id: 'none', n: 'Tanpa cahaya' },
    { id: 'rays', n: 'Sinar berputar' },
    { id: 'glow', n: 'Pendar di belakang logo' },
    { id: 'shimmer', n: 'Tulisan berkilau' },
    { id: 'sparkle', n: 'Bintang berkelip' },
    { id: 'combo', n: 'Kombinasi semua' }
  ];
  K.OC_ANIMS = [
    { id: 'portal', n: 'Portal cahaya' },
    { id: 'doors', n: 'Pintu 3D terbuka' },
    { id: 'curtain', n: 'Tirai cahaya' },
    { id: 'lightSweep', n: 'Sapuan cahaya' },
    { id: 'spin3d', n: 'Putar 3D' },
    { id: 'flipIn', n: 'Flip 3D' },
    { id: 'cube', n: 'Kubus 3D' },
    { id: 'zoomTunnel', n: 'Terowongan zoom' },
    { id: 'drop3d', n: 'Jatuh memantul 3D' },
    { id: 'riseShine', n: 'Naik berkilau' },
    { id: 'typeGlow', n: 'Huruf demi huruf' },
    { id: 'blurReveal', n: 'Muncul dari kabur' },
    { id: 'fade', n: 'Pudar halus' }
  ];


  // ---- LOWER THIRD SOSIAL MEDIA ----
  // Ikon bawaan = ikon generik orisinal per jenis platform (bukan logo resmi merek).
  // Logo resmi platform bisa diupload di tab Logo lalu dipilih per akun.
  const SG = (inner) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">${inner}</svg>`;
  const SSTK = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  K.SOC_GLYPH = {
    people: SG('<circle cx="9" cy="8" r="3.6"/><path d="M2 20.5c0-4.1 3.1-6.8 7-6.8s7 2.7 7 6.8z"/><circle cx="17.2" cy="9" r="2.8"/><path d="M15.6 13.7c3.7-.4 6.4 1.9 6.4 5.6v1.2h-4.4c0-2.8-.7-5.1-2-6.8z"/>'),
    photo: SG('<path fill-rule="evenodd" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9.6l4.5-4.6 3.6 3.6 2.6-2.6 5.3 5.2V6zm12.5 1.4a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>'),
    play: SG('<path fill-rule="evenodd" d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-2.2 5.6v8.8l7-4.4z"/>'),
    note: SG('<circle cx="6.5" cy="18" r="3"/><circle cx="17.5" cy="16" r="3"/><path d="M8 18V5.5L20.5 3v13h-1.7V7.2L9.7 9V18z"/>'),
    hash: SG('<path fill-rule="evenodd" d="M9.6 3h2l-.8 5h4l.8-5h2l-.8 5H20v2h-3.5l-.6 4H19v2h-3.4l-.8 5h-2l.8-5h-4l-.8 5h-2l.8-5H4v-2h3.9l.6-4H5V8h3.8zm.9 7-.6 4h4l.6-4z"/>'),
    phone: SG('<path d="M6.7 2.4 9.4 2l1.7 4.7-2.1 1.7a12.4 12.4 0 0 0 6.7 6.7l1.7-2.1 4.7 1.7-.4 2.7c-.2 1.2-1.2 2.1-2.4 2.1C10.6 19.5 4.5 13.4 4.5 4.8c0-1.2.9-2.2 2.2-2.4z"/>'),
    chat: SG('<path d="M12 3c5.5 0 10 3.6 10 8.1s-4.5 8.1-10 8.1c-1.2 0-2.4-.2-3.5-.5L3.4 21l1.5-4.2C3.1 15.3 2 13.3 2 11.1 2 6.6 6.5 3 12 3z"/><g fill="rgba(0,0,0,.32)"><circle cx="7.8" cy="11.1" r="1.4"/><circle cx="12" cy="11.1" r="1.4"/><circle cx="16.2" cy="11.1" r="1.4"/></g>'),
    threads: SG('<path d="M3 3.5h11.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H8.2L4 17.2V14H3a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 3 3.5z"/><path opacity=".7" d="M18 8h2.5A1.5 1.5 0 0 1 22 9.5V17a1.5 1.5 0 0 1-1.5 1.5H20v3.3l-4.2-3.3h-5.3A1.5 1.5 0 0 1 9 17v-1h6a3 3 0 0 0 3-3z"/>'),
    briefcase: SG('<path fill-rule="evenodd" d="M9 3h6a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v4.3H2V8a2 2 0 0 1 2-2h3V5a2 2 0 0 1 2-2zm0 2v1h6V5zM2 13.8h8.2v1.6h3.6v-1.6H22V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/>'),
    globe: SG(`<circle cx="12" cy="12" r="9.5" ${SSTK}/><path ${SSTK} d="M2.5 12h19M12 2.5c2.8 2.8 4.3 6 4.3 9.5S14.8 18.7 12 21.5M12 2.5C9.2 5.3 7.7 8.5 7.7 12s1.5 6.7 4.3 9.5M4.2 7h15.6M4.2 17h15.6"/>`),
    mail: SG('<path fill-rule="evenodd" d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2.4V17h16V7.4l-8 5.3z"/>'),
    cart: SG(`<path ${SSTK} d="M2 3.5h3l2.5 11a1 1 0 0 0 1 .8h9.4a1 1 0 0 0 1-.7L21.5 7.5H6.2"/><circle cx="9.5" cy="19.6" r="1.9"/><circle cx="17.5" cy="19.6" r="1.9"/>`),
    live: SG(`<circle cx="12" cy="12" r="2.8"/><path ${SSTK} d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2"/>`),
    link: SG(`<path ${SSTK} stroke-width="2.3" d="M10 14a4.6 4.6 0 0 0 6.5 0l3.2-3.2a4.6 4.6 0 0 0-6.5-6.5L12 5.5M14 10a4.6 4.6 0 0 0-6.5 0l-3.2 3.2a4.6 4.6 0 0 0 6.5 6.5l1.2-1.2"/>`)
  };
  K.SOC_PLAT = {
    youtube:   { n: 'YouTube',      g: 'play',      h: '@NamaChannel',        x: 'Subscribe & aktifkan notifikasi' },
    instagram: { n: 'Instagram',    g: 'photo',     h: '@namaakun',           x: 'Follow untuk info kegiatan' },
    facebook:  { n: 'Facebook',     g: 'people',    h: 'Nama Halaman',        x: 'Ikuti halaman kami' },
    tiktok:    { n: 'TikTok',       g: 'note',      h: '@namaakun',           x: '' },
    x:         { n: 'X',            g: 'hash',      h: '@namaakun',           x: '' },
    threads:   { n: 'Threads',      g: 'threads',   h: '@namaakun',           x: '' },
    whatsapp:  { n: 'WhatsApp',     g: 'phone',     h: '0812-3456-7890',      x: 'Info & pendaftaran' },
    telegram:  { n: 'Telegram',     g: 'chat',      h: 't.me/namakanal',      x: '' },
    linkedin:  { n: 'LinkedIn',     g: 'briefcase', h: 'Nama Organisasi',     x: '' },
    website:   { n: 'Website',      g: 'globe',     h: 'www.namaacara.id',    x: '' },
    email:     { n: 'Email',        g: 'mail',      h: 'info@namaacara.id',   x: '' },
    shop:      { n: 'Toko Online',  g: 'cart',      h: 'Nama Toko',           x: '' },
    live:      { n: 'Live Streaming', g: 'live',    h: 'Nama Kanal Live',     x: 'Saksikan siaran langsungnya' },
    other:     { n: 'Lainnya',      g: 'link',      h: 'nama akun / tautan',  x: '' }
  };
  K.SOC_RAINBOW = ['#ff4d6d', '#7b5cff', '#1fb6ff', '#13ce66', '#ff9f1a', '#ff3fb4', '#00c2a8', '#ffcc00'];
  K.SOC_LAYOUTS = [
    { id: 'glass', n: 'Kapsul Kaca 3D' },
    { id: 'cube', n: 'Ikon Kubus 3D' },
    { id: 'fold', n: 'Kartu Lipat 3D' },
    { id: 'neon', n: 'Neon' },
    { id: 'pill', n: 'Pil Glossy' },
    { id: 'badge', n: 'Lencana Cincin Cahaya' },
    { id: 'tab', n: 'Tab Platform' },
    { id: 'stack', n: 'Lapisan 3D' },
    { id: 'float', n: 'Kartu Putih Melayang' },
    { id: 'split', n: 'Diagonal Dua Warna' },
    { id: 'bubble', n: 'Gelembung Chat' },
    { id: 'holo', n: 'Hologram' },
    { id: 'strip', n: 'Strip Ringkas' },
    { id: 'minimal', n: 'Garis Cahaya Minimalis' }
  ];
  K.makeSoc = function () {
    const mk = (plat) => { const P = K.SOC_PLAT[plat]; return { id: K.uid(), label: P.n, plat, cap: P.n, handle: P.h, extra: P.x, logoId: '', on: true }; };
    return {
      layout: 'glass', light: 'sweep', animIn: 'slideLight', animOut: 'slideLight', dur: 900,
      pos: 'br', x: 80, y: 120, scale: 1, mode: 'single', dir: 'row', cycle: 4, color: 'tema', iconPos: 'left',
      raise: true, upper: false, autoHide: 0,
      items: ['youtube', 'instagram', 'facebook', 'website'].map(mk), activeId: '', visible: false
    };
  };

  const SVG = (inner) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
  K.ORN = {
    none: { n: 'Tanpa ornamen', svg: '' },
    crescent: { n: 'Bulan sabit & bintang', svg: SVG('<path fill="currentColor" d="M33 6a26 26 0 1 0 20 43A21 21 0 0 1 33 6z"/><path fill="currentColor" d="M47 12l2.6 6.3 6.8.5-5.2 4.4 1.6 6.6-5.8-3.6-5.8 3.6 1.6-6.6-5.2-4.4 6.8-.5z"/>') },
    star8: { n: 'Bintang 8 (Rub el Hizb)', svg: SVG('<g fill="currentColor"><rect x="15" y="15" width="34" height="34"/><rect x="15" y="15" width="34" height="34" transform="rotate(45 32 32)"/></g><circle cx="32" cy="32" r="9" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="3"/>') },
    mosque: { n: 'Kubah masjid', svg: SVG('<g fill="currentColor"><path d="M32 10c-1.5 5-15 9-15 22h30c0-13-13.5-17-15-22z"/><rect x="17" y="33" width="30" height="21"/><rect x="7" y="22" width="5" height="32"/><rect x="52" y="22" width="5" height="32"/><path d="M9.5 14l3 8h-6zM54.5 14l3 8h-6z"/><rect x="31" y="3" width="2" height="7"/></g><path d="M28 54V44a4 4 0 0 1 8 0v10" fill="rgba(0,0,0,.35)"/>') },
    rings: { n: 'Cincin pernikahan', svg: SVG('<g fill="none" stroke="currentColor" stroke-width="4"><circle cx="24" cy="38" r="15"/><circle cx="40" cy="38" r="15"/></g><path fill="currentColor" d="M24 12l5 5-5 6-5-6z"/>') },
    heart: { n: 'Hati', svg: SVG('<path fill="currentColor" d="M32 56L9 33A13 13 0 0 1 32 15a13 13 0 0 1 23 18z"/>') },
    flower: { n: 'Bunga', svg: SVG('<g fill="currentColor"><circle cx="32" cy="16" r="10"/><circle cx="48" cy="28" r="10"/><circle cx="42" cy="46" r="10"/><circle cx="22" cy="46" r="10"/><circle cx="16" cy="28" r="10"/></g><circle cx="32" cy="32" r="7" fill="rgba(0,0,0,.3)"/>') },
    cap: { n: 'Toga wisuda', svg: SVG('<g fill="currentColor"><path d="M32 12l30 12-30 12L2 24z"/><path d="M16 31v11c0 7 32 7 32 0V31l-16 6z"/><rect x="55" y="24" width="2.5" height="18"/><circle cx="56.3" cy="44" r="3"/></g>') },
    mic: { n: 'Mikrofon', svg: SVG('<g fill="currentColor"><rect x="23" y="6" width="18" height="32" rx="9"/><path d="M15 30a17 17 0 0 0 34 0h-4a13 13 0 0 1-26 0z"/><rect x="30" y="46" width="4" height="10"/><rect x="21" y="55" width="22" height="4" rx="2"/></g>') },
    cake: { n: 'Kue ulang tahun', svg: SVG('<g fill="currentColor"><rect x="10" y="34" width="44" height="22" rx="3"/><rect x="16" y="24" width="32" height="12" rx="2"/><rect x="30.5" y="12" width="3" height="12"/><path d="M32 4c3 4 3 6 0 8-3-2-3-4 0-8z"/></g>') },
    quran: { n: 'Kitab / Al-Qur\'an', svg: SVG('<g fill="currentColor"><path d="M6 14c10-3 19-1 25 4v36c-6-5-15-7-25-4z"/><path d="M58 14c-10-3-19-1-25 4v36c6-5 15-7 25-4z"/></g>') }
  };

  const pal = (n, p, s, a, t, st) => ({ n, p, s, a, t: t || '#ffffff', st: st || '#f3ead2' });

  K.EVENTS = [
    {
      id: 'pengajian', n: 'Pengajian / Majelis Taklim', orn: 'crescent',
      pals: [pal('Hijau Emas', '#0f6b4f', '#06301f', '#f2c45a', '#ffffff', '#f7e7b4'), pal('Biru Malam Emas', '#17407c', '#081a36', '#f2c45a'), pal('Hitam Emas', '#2b2b2b', '#0a0a0a', '#d4af37'), pal('Toska Perak', '#0e7c86', '#05343a', '#c9f5ee', '#ffffff', '#dff7f3')],
      fonts: ['Montserrat', 'Poppins', 'Cinzel', 'Amiri'],
      lt: ['arabesque', 'sweep', 'lightWipe'], tt: ['arch', 'beam', 'unfold'], tk: ['arabesque', 'sweep', 'riseFlash'], badge: 'INFO',
      roles: ['Penceramah', "Qori'", 'Sari Tilawah', 'Pembawa Acara', 'Sambutan Ketua Panitia', 'Sambutan Tuan Rumah', 'Pembaca Doa', 'Pembaca Shalawat', 'Tim Hadrah'],
      lts: [['Ustadz Ahmad Fauzi, Lc.', 'Penceramah'], ["Qori' Muhammad Rizki", "Tilawah Al-Qur'an"], ['Bapak H. Sulaiman', 'Ketua Panitia'], ['Saudara Fikri Ramadhan', 'Pembawa Acara']],
      tts: [{ label: 'Judul Utama', ar: 'بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ', eb: 'Majelis Taklim', title: 'Pengajian Akbar', sub: 'Meraih Keberkahan Hidup', info: 'Ahad, 12 Oktober 2026 • Masjid Agung' }, { label: 'Sesi Tausiyah', ar: '', eb: 'Tausiyah', title: 'Hikmah & Keteladanan', sub: 'Bersama Ustadz Ahmad Fauzi, Lc.', info: '' }],
      tks: ['Selamat datang para jamaah pengajian akbar', 'Mohon nada dering HP diaktifkan mode senyap selama acara berlangsung', 'Infaq & sedekah dapat disalurkan melalui kotak amal yang tersedia']
    },
    {
      id: 'pernikahan', n: 'Pernikahan / Walimatul \'Ursy', orn: 'rings',
      pals: [pal('Maroon Emas', '#7a1630', '#2a0711', '#e8c27a', '#ffffff', '#f6dfc0'), pal('Rose Gold', '#b76e79', '#4a2329', '#f7d6c8', '#ffffff', '#fbe9e2'), pal('Navy Champagne', '#1d2b4f', '#0b1128', '#e6c88f'), pal('Sage Krem', '#5f7f63', '#223127', '#f1e3c6')],
      fonts: ['Playfair Display', 'Lora', 'Great Vibes', 'Amiri'],
      lt: ['luxe', 'shimmer', 'unfold'], tt: ['frame', 'sparkle', 'zoomGlow'], tk: ['luxe', 'sweep', 'riseFlash'], badge: 'WELCOME',
      roles: ['Mempelai Pria', 'Mempelai Wanita', 'Orang Tua Mempelai Pria', 'Orang Tua Mempelai Wanita', 'Wali Nikah', 'Penghulu', 'Saksi Nikah', 'Khutbah Nikah', 'Pembawa Acara', 'Pembaca Doa'],
      lts: [['Muhammad Rizky, S.T.', 'Mempelai Pria'], ['Aisyah Putri, S.Pd.', 'Mempelai Wanita'], ['Bpk. H. Abdullah & Ibu Hj. Fatimah', 'Orang Tua Mempelai Wanita'], ['KH. Mahmud Syafi\'i', 'Khutbah Nikah']],
      tts: [{ label: 'Judul Utama', ar: '', eb: 'The Wedding of', title: 'Rizky & Aisyah', sub: "Walimatul 'Ursy", info: 'Sabtu, 17 Oktober 2026 • Gedung Serbaguna' }, { label: 'Akad Nikah', ar: 'بَارَكَ اللّٰهُ لَكُمَا وَبَارَكَ عَلَيْكُمَا', eb: 'Akad Nikah', title: 'Rizky & Aisyah', sub: 'Sakinah, Mawaddah, wa Rahmah', info: '' }],
      tks: ['Selamat datang di acara pernikahan Rizky & Aisyah', 'Terima kasih atas doa restu dan kehadiran Bapak/Ibu/Saudara/i', 'Silakan menikmati hidangan yang telah disediakan']
    },
    {
      id: 'khitanan', n: 'Khitanan / Sunatan', orn: 'star8',
      pals: [pal('Biru Emas', '#1b5fa8', '#0a2448', '#ffd166'), pal('Hijau Segar', '#1f8a5b', '#0b3322', '#ffe08a'), pal('Ungu Emas', '#5b3fa0', '#1f1440', '#f7c948'), pal('Oranye Ceria', '#e0702a', '#5c2208', '#fff1c2')],
      fonts: ['Poppins', 'Poppins', 'Cinzel', 'Amiri'],
      lt: ['glass3d', 'edge', 'swing3d'], tt: ['glass', 'sparkle', 'flip3d'], tk: ['glass', 'sweep', 'riseFlash'], badge: 'INFO',
      roles: ['Putra yang Dikhitan', 'Orang Tua', 'Kakek & Nenek', 'Penceramah', "Qori'", 'Pembawa Acara', 'Sambutan Keluarga', 'Pembaca Doa'],
      lts: [['Ananda Muhammad Alfarizi', 'Putra yang Dikhitan'], ['Bapak Hendra & Ibu Siti', 'Orang Tua'], ['Ustadz Abdul Hakim', 'Penceramah'], ['Saudari Nabila', 'Pembawa Acara']],
      tts: [{ label: 'Judul Utama', ar: 'بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ', eb: 'Tasyakuran', title: 'Khitanan Ananda Alfarizi', sub: 'Putra dari Bapak Hendra & Ibu Siti', info: 'Minggu, 18 Oktober 2026' }],
      tks: ['Selamat datang di acara tasyakuran khitanan Ananda Alfarizi', 'Mohon doanya semoga menjadi anak yang sholeh dan berbakti', 'Terima kasih atas kehadiran Bapak/Ibu sekalian']
    },
    {
      id: 'aqiqah', n: 'Aqiqah', orn: 'crescent',
      pals: [pal('Toska Lembut', '#2a9d8f', '#0f3b36', '#ffe8a3'), pal('Pink Lembut', '#d46a8c', '#4c1a2c', '#ffe3ec'), pal('Biru Langit', '#3a86c8', '#0f2c4a', '#fff2b3')],
      fonts: ['Poppins', 'Poppins', 'Playfair Display', 'Amiri'],
      lt: ['capsule', 'glow', 'riseFlash'], tt: ['glass', 'sparkle', 'zoomGlow'], tk: ['capsule', 'sweep', 'riseFlash'], badge: 'INFO',
      roles: ['Putra / Putri', 'Ayah', 'Ibu', 'Penceramah', 'Pembawa Acara', 'Pembaca Doa', 'Tim Marhaban'],
      lts: [['Ananda Zahra Aulia', 'Putri dari Bapak Fajar & Ibu Rina'], ['Ustadz Hasan Basri', 'Penceramah'], ['Bapak Fajar Nugroho', 'Sambutan Tuan Rumah']],
      tts: [{ label: 'Judul Utama', ar: 'بِسْمِ اللّٰهِ الرَّحْمٰنِ الرَّحِيْمِ', eb: 'Tasyakuran Aqiqah', title: 'Ananda Zahra Aulia', sub: 'Semoga menjadi anak yang sholehah', info: '' }],
      tks: ['Selamat datang di acara aqiqah Ananda Zahra Aulia', 'Terima kasih atas doa dan kehadirannya']
    },
    {
      id: 'tasyakuran', n: 'Tasyakuran / Syukuran', orn: 'star8',
      pals: [pal('Hijau Emas', '#1f7a4d', '#0a2e1d', '#f2c45a'), pal('Coklat Emas', '#7a4b22', '#2e1a0a', '#f5d08a'), pal('Biru Emas', '#1b5fa8', '#0a2448', '#ffd166')],
      fonts: ['Montserrat', 'Poppins', 'Cinzel', 'Amiri'],
      lt: ['glass3d', 'sweep', 'lightWipe'], tt: ['glass', 'beam', 'unfold'], tk: ['glass', 'sweep', 'riseFlash'], badge: 'INFO',
      roles: ['Tuan Rumah', 'Penceramah', 'Pembawa Acara', 'Pembaca Doa', 'Sambutan'],
      lts: [['Bapak H. Rahmat', 'Tuan Rumah'], ['Ustadz Yusuf Mansur', 'Penceramah']],
      tts: [{ label: 'Judul Utama', ar: 'اَلْحَمْدُ لِلّٰهِ رَبِّ الْعَالَمِيْنَ', eb: 'Tasyakuran', title: 'Syukuran Rumah Baru', sub: 'Keluarga Bapak H. Rahmat', info: '' }],
      tks: ['Selamat datang dan terima kasih atas kehadirannya']
    },
    {
      id: 'maulid', n: 'Maulid Nabi ﷺ', orn: 'mosque',
      pals: [pal('Hijau Emas', '#0f6b4f', '#06301f', '#f2c45a'), pal('Ungu Malam', '#4b2a7a', '#170b2e', '#f5cf6b'), pal('Biru Malam', '#17407c', '#081a36', '#7fe0ff')],
      fonts: ['Montserrat', 'Poppins', 'Cinzel', 'Amiri'],
      lt: ['arabesque', 'beam', 'unfold'], tt: ['arch', 'beam', 'unfold'], tk: ['arabesque', 'sweep', 'riseFlash'], badge: 'MAULID',
      roles: ['Penceramah', 'Grup Hadrah / Sholawat', "Qori'", 'Pembawa Acara', 'Ketua Panitia', 'Pembaca Maulid'],
      lts: [['Habib Muhammad Al-Habsyi', 'Penceramah'], ['Majelis Sholawat Az-Zahir', 'Grup Hadrah']],
      tts: [{ label: 'Judul Utama', ar: 'اَللّٰهُمَّ صَلِّ عَلٰى سَيِّدِنَا مُحَمَّدٍ', eb: 'Peringatan', title: 'Maulid Nabi Muhammad ﷺ', sub: '1448 Hijriyah', info: '' }],
      tks: ['Selamat datang di peringatan Maulid Nabi Muhammad ﷺ', 'Perbanyak sholawat kepada Rasulullah ﷺ']
    },
    {
      id: 'isra', n: "Isra Mi'raj", orn: 'crescent',
      pals: [pal('Ungu Malam Emas', '#4b2a7a', '#170b2e', '#f5cf6b'), pal('Biru Malam', '#17407c', '#081a36', '#bfe9ff'), pal('Hitam Emas', '#2b2b2b', '#0a0a0a', '#d4af37')],
      fonts: ['Montserrat', 'Poppins', 'Cinzel', 'Amiri'],
      lt: ['arabesque', 'sparkle', 'lightWipe'], tt: ['arch', 'sparkle', 'unfold'], tk: ['arabesque', 'sweep', 'riseFlash'], badge: 'INFO',
      roles: ['Penceramah', "Qori'", 'Pembawa Acara', 'Ketua Panitia', 'Pembaca Doa'],
      lts: [['KH. Abdurrahman', 'Penceramah']],
      tts: [{ label: 'Judul Utama', ar: 'سُبْحَانَ الَّذِيْ أَسْرٰى بِعَبْدِهٖ', eb: 'Peringatan', title: "Isra Mi'raj Nabi Muhammad ﷺ", sub: '27 Rajab 1448 H', info: '' }],
      tks: ["Selamat datang di peringatan Isra Mi'raj Nabi Muhammad ﷺ"]
    },
    {
      id: 'halal', n: 'Halal Bihalal / Idul Fitri', orn: 'mosque',
      pals: [pal('Hijau Putih', '#11804f', '#063120', '#ffffff', '#ffffff', '#e9fff3'), pal('Emas Krem', '#a67c2d', '#3b2a0e', '#fff3d1'), pal('Hijau Emas', '#0f6b4f', '#06301f', '#f2c45a')],
      fonts: ['Montserrat', 'Poppins', 'Cinzel', 'Amiri'],
      lt: ['glass3d', 'sweep', 'lightWipe'], tt: ['arch', 'beam', 'unfold'], tk: ['glass', 'sweep', 'riseFlash'], badge: 'MOHON MAAF',
      roles: ['Penceramah', 'Ketua Panitia', 'Pembawa Acara', 'Sambutan Pimpinan', 'Pembaca Doa'],
      lts: [['Ustadz Abdul Somad', 'Penceramah'], ['Bapak Ir. Budi Santoso', 'Sambutan Pimpinan']],
      tts: [{ label: 'Judul Utama', ar: 'تَقَبَّلَ اللّٰهُ مِنَّا وَمِنْكُمْ', eb: 'Halal Bihalal', title: 'Idul Fitri 1448 H', sub: 'Mohon Maaf Lahir & Batin', info: '' }],
      tks: ['Selamat Hari Raya Idul Fitri, mohon maaf lahir dan batin']
    },
    {
      id: 'tabligh', n: 'Tabligh Akbar / Kajian', orn: 'quran',
      pals: [pal('Hijau Emas', '#0f6b4f', '#06301f', '#f2c45a'), pal('Hitam Emas', '#2b2b2b', '#0a0a0a', '#d4af37'), pal('Biru Malam', '#17407c', '#081a36', '#f2c45a')],
      fonts: ['Montserrat', 'Poppins', 'Cinzel', 'Amiri'],
      lt: ['neon', 'edge', 'swing3d'], tt: ['cinematic', 'beam', 'zoomGlow'], tk: ['neon', 'sweep', 'riseFlash'], badge: 'KAJIAN',
      roles: ['Narasumber', 'Moderator', "Qori'", 'Pembawa Acara', 'Ketua Panitia'],
      lts: [['Ustadz Adi Hidayat, Lc., M.A.', 'Narasumber'], ['Ustadz Fadli', 'Moderator']],
      tts: [{ label: 'Judul Utama', ar: '', eb: 'Tabligh Akbar', title: 'Bersatu dalam Ukhuwah', sub: 'Bersama Ustadz Adi Hidayat, Lc., M.A.', info: '' }],
      tks: ['Kajian terbuka untuk umum • Gratis', 'Mohon merapatkan shaf dan menjaga kebersihan']
    },
    {
      id: 'wisuda', n: 'Wisuda / Khataman / Pelepasan', orn: 'cap',
      pals: [pal('Navy Emas', '#1d2b5c', '#0a1029', '#f2c45a'), pal('Maroon Emas', '#7a1630', '#2a0711', '#e8c27a'), pal('Hijau Emas', '#0f6b4f', '#06301f', '#f2c45a')],
      fonts: ['Montserrat', 'Poppins', 'Cinzel', 'Amiri'],
      lt: ['cube', 'sweep', 'cubeTurn'], tt: ['glass', 'sparkle', 'flip3d'], tk: ['ribbon', 'sweep', 'riseFlash'], badge: 'SELAMAT',
      roles: ['Wisudawan', 'Wisudawati', 'Lulusan Terbaik', 'Kepala Sekolah', 'Ketua Yayasan', 'Pembawa Acara', 'Wali Murid'],
      lts: [['Ahmad Zaki Mubarok', 'Lulusan Terbaik'], ['Drs. H. Mulyono, M.Pd.', 'Kepala Sekolah']],
      tts: [{ label: 'Judul Utama', ar: '', eb: 'Wisuda & Pelepasan', title: 'Angkatan 2026', sub: 'Selamat & Sukses', info: '' }],
      tks: ['Selamat kepada seluruh wisudawan & wisudawati']
    },
    {
      id: 'seminar', n: 'Seminar / Rapat / Musyawarah', orn: 'mic',
      pals: [pal('Biru Korporat', '#1857c4', '#081d45', '#38d6ff'), pal('Hitam Cyan', '#1c2230', '#07090f', '#22e1ff'), pal('Merah Profesional', '#b3162f', '#3d0710', '#ffd166')],
      fonts: ['Montserrat', 'Poppins', 'Montserrat', 'Cairo'],
      lt: ['glass3d', 'edge', 'slideLight'], tt: ['glass', 'edge', 'flip3d'], tk: ['glass', 'sweep', 'riseFlash'], badge: 'LIVE',
      roles: ['Narasumber', 'Moderator', 'Keynote Speaker', 'Pembawa Acara', 'Sambutan', 'Peserta'],
      lts: [['Dr. Rina Kartika, M.Si.', 'Narasumber'], ['Andi Pratama', 'Moderator']],
      tts: [{ label: 'Judul Utama', ar: '', eb: 'Seminar Nasional', title: 'Transformasi Digital Umat', sub: 'Peluang & Tantangan', info: '' }],
      tks: ['Pertanyaan dapat dikirim melalui panitia', 'Sertifikat dibagikan setelah acara']
    },
    {
      id: 'ultah', n: 'Ulang Tahun / Milad', orn: 'cake',
      pals: [pal('Pink Ungu', '#c2408f', '#3b0f3a', '#ffe066'), pal('Biru Ceria', '#2d7de0', '#0b2550', '#ffe066'), pal('Hitam Emas', '#2b2b2b', '#0a0a0a', '#d4af37')],
      fonts: ['Poppins', 'Poppins', 'Great Vibes', 'Amiri'],
      lt: ['capsule', 'sparkle', 'dropBounce'], tt: ['neon', 'sparkle', 'dropBounce'], tk: ['capsule', 'sweep', 'riseFlash'], badge: 'HBD',
      roles: ['Yang Berulang Tahun', 'Orang Tua', 'Pembawa Acara', 'Sambutan'],
      lts: [['Nayla Putri', 'Yang Berulang Tahun ke-7']],
      tts: [{ label: 'Judul Utama', ar: '', eb: 'Happy Birthday', title: 'Nayla Putri', sub: 'Ke-7 Tahun', info: '' }],
      tks: ['Selamat ulang tahun, semoga panjang umur dan sehat selalu']
    },
    {
      id: 'lainnya', n: 'Acara Penting Lainnya', orn: 'star8',
      pals: [pal('Biru Cyan', '#1857c4', '#081d45', '#38d6ff'), pal('Hitam Emas', '#2b2b2b', '#0a0a0a', '#d4af37'), pal('Merah Putih', '#c8102e', '#5a0812', '#ffffff', '#ffffff', '#ffe5e8'), pal('Hijau Emas', '#0f6b4f', '#06301f', '#f2c45a')],
      fonts: ['Montserrat', 'Poppins', 'Montserrat', 'Amiri'],
      lt: ['metal', 'sweep', 'lightWipe'], tt: ['cinematic', 'beam', 'zoomGlow'], tk: ['glass', 'sweep', 'riseFlash'], badge: 'INFO',
      roles: ['Pembicara', 'Pembawa Acara', 'Ketua Panitia', 'Tamu Kehormatan', 'Sambutan'],
      lts: [['Nama Lengkap', 'Jabatan / Keterangan']],
      tts: [{ label: 'Judul Utama', ar: '', eb: 'Selamat Datang', title: 'Nama Acara', sub: 'Sub judul acara', info: 'Tanggal • Tempat' }],
      tks: ['Selamat datang di acara kami']
    }
  ];
  K.ev = id => K.EVENTS.find(e => e.id === id) || K.EVENTS[0];

  K.uid = () => Math.random().toString(36).slice(2, 9);

  K.makeLoc = function (id) {
    const d = K.LOC_DEF[id] || ['Nama Tempat', 'Alamat / Kota'];
    return {
      layout: 'pin3d', light: 'sweep', animIn: 'slideLight', animOut: 'slideLight', dur: 900,
      pos: 'tr', x: 60, y: 60, scale: 1, icon: 'pin', logoId: '', upper: false, autoHide: 0,
      items: [{ id: K.uid(), label: 'Lokasi acara', cap: 'LOKASI', place: d[0], addr: d[1] }], activeId: '', visible: false
    };
  };
  K.makeOC = function (id) {
    const E = K.ev(id), t = E.tts[0] || {};
    const base = { type: 'gfx', layout: 'center', logoId: '', logoSize: 260, fmt: {}, bg: 'theme', light: 'rays', inDur: 1600, hold: 4, outDur: 1000,
      scale: 1, y: 0, autoOff: true, video: null, sound: true, volume: 100, fit: 'cover' };
    return {
      active: null, run: '', done: false,
      opening: Object.assign({}, base, { id: 'opening', eb: t.eb || '', title: t.title || 'Selamat Datang', sub: t.sub || '', animIn: 'portal', animOut: 'zoomTunnel' }),
      closing: Object.assign({}, base, { id: 'closing', eb: t.title || '', title: 'Terima Kasih', sub: 'Atas kehadiran & doa restu Bapak/Ibu sekalian', animIn: 'blurReveal', animOut: 'curtain', light: 'sparkle', bg: 'radial', hold: 5, fmt: {} })
    };
  };
  // ---- lower third banyak sekaligus & logo pojok lebih dari satu ----
  // posisi awal tiap lower third saat mode "banyak sekaligus": kiri/kanan bergantian, bertingkat ke atas
  K.ltPos = function (i) { return { pos: i % 2 ? 'right' : 'left', side: 90, bottom: 120 + Math.floor(i / 2) * 170, x: 0, scale: 1 }; };
  K.BUG_CORNERS = ['tr', 'tl', 'br', 'bl'];
  K.makeBugItem = function (i, from) {
    const f = from || {};
    return { id: f.id || K.uid(), logoId: f.logoId || '', corner: f.corner || K.BUG_CORNERS[i % 4], size: f.size != null ? f.size : 150,
      x: f.x != null ? f.x : 60, y: f.y != null ? f.y : 50, opacity: f.opacity != null ? f.opacity : 1, fx: f.fx || 'glow', on: true };
  };
  // melengkapi data lama (sebelum ada Lokasi / Opening-Closing)
  K.upgradeEvent = function (id, ev) {
    if (!ev) return ev;
    if (!ev.loc) ev.loc = K.makeLoc(id);
    if (!ev.soc) ev.soc = K.makeSoc(id);
    if (ev.lt && ev.lt.multi === undefined) ev.lt.multi = 0;
    // logo pojok versi lama (satu logo) → jadi logo pertama di daftar; id tetap agar tidak beranimasi ulang
    if (ev.bug && !Array.isArray(ev.bug.items)) ev.bug.items = [K.makeBugItem(0, Object.assign({}, ev.bug, { id: 'bug1' }))];
    if (!ev.oc) ev.oc = K.makeOC(id);
    else { const b = K.makeOC(id); ['opening', 'closing'].forEach(k => { ev.oc[k] = Object.assign({}, b[k], ev.oc[k] || {}); }); }
    return ev;
  };
  // Lengkapi konfigurasi acara dari versi mana pun (preset lama, file impor, state lama) ke format terbaru:
  // semua kolom yang belum ada diisi nilai bawaan, kolom yang rusak/tipe salah diganti, isi milik pengguna dipertahankan.
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  function fill(dst, def) {
    for (const k in def) {
      const d = def[k], v = dst[k];
      if (v === undefined || v === null && d !== null) { dst[k] = d === undefined ? d : JSON.parse(JSON.stringify(d)); continue; }
      if (isObj(d)) { if (!isObj(v)) dst[k] = JSON.parse(JSON.stringify(d)); else fill(v, d); continue; }
      if (Array.isArray(d)) { if (!Array.isArray(v)) dst[k] = JSON.parse(JSON.stringify(d)); continue; }
      if (typeof d === 'number' && typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) dst[k] = +v;
      else if (typeof d === 'boolean' && typeof v !== 'boolean') dst[k] = v === 'true' || v === 1 || v === '1';
    }
    return dst;
  }
  function fillItems(arr, tpl) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(isObj).map(it => { fill(it, tpl || {}); if (!it.id) it.id = K.uid(); return it; });
  }
  K.normalizeEvent = function (id, ev) {
    if (!K.EVENTS.some(e => e.id === id)) id = K.EVENTS[0].id;
    if (!isObj(ev)) ev = {};
    K.upgradeEvent(id, ev);
    const base = K.makeEventConfig(id);
    // template butir: ambil bentuk butir bawaan tanpa isi teks/id agar teks milik pengguna tidak tertimpa
    const tpl = arr => { const t = Object.assign({}, (arr || [])[0] || {}); delete t.id; return t; };
    const itemTpl = {
      lt: Object.assign({ name: '', role: '', extra: '', label: '' }, tpl(base.lt.items)),
      tt: tpl(base.tt.items), tk: Object.assign({ text: '', on: true }, tpl(base.tk.items)),
      loc: tpl(base.loc.items), soc: tpl(base.soc.items), bug: tpl(base.bug.items)
    };
    for (const k of ['lt', 'tt', 'tk', 'loc', 'soc', 'bug']) {
      if (!isObj(ev[k])) ev[k] = base[k];
      const had = Array.isArray(ev[k].items) && ev[k].items.length;
      fill(ev[k], base[k]);
      ev[k].items = fillItems(had ? ev[k].items : base[k].items, itemTpl[k]);
      if (!ev[k].items.length && base[k].items.length) ev[k].items = base[k].items;
    }
    for (const k in base) if (!['lt', 'tt', 'tk', 'loc', 'soc', 'bug'].includes(k)) { if (!isObj(ev[k])) ev[k] = base[k]; else fill(ev[k], base[k]); }
    return { id, ev };
  };
  // Baca file preset dari versi mana pun → { eventType, config } atau null
  K.readPreset = function (p) {
    if (!isObj(p)) return null;
    let type = p.eventType, cfg = p.config;
    if (!isObj(cfg) && isObj(p.events)) { type = type || Object.keys(p.events)[0]; cfg = p.events[type]; }   // cadangan state penuh
    if (!isObj(cfg) && isObj(p.cfg)) cfg = p.cfg;
    if (!isObj(cfg) && (isObj(p.lt) || isObj(p.tt) || isObj(p.tk))) cfg = p;                               // config polos
    if (!isObj(cfg)) return null;
    const r = K.normalizeEvent(type || 'pengajian', cfg);
    return { eventType: r.id, config: r.ev };
  };
  K.makeEventConfig = function (id) {
    const E = K.ev(id), P = E.pals[0];
    return {
      theme: { pal: 0, p: P.p, s: P.s, a: P.a, t: P.t, st: P.st, fn: E.fonts[0], fr: E.fonts[1], ft: E.fonts[2], far: E.fonts[3], orn: E.orn },
      lt: {
        layout: E.lt[0], light: E.lt[1], animIn: E.lt[2], animOut: E.lt[2], dur: 900, pos: 'left', bottom: 120, side: 90, scale: 1,
        logo: 'left', logoId: '', orn: true, upper: false, raise: true, autoHide: 0, multi: 0,
        items: E.lts.map((x, i) => ({ id: K.uid(), label: x[1], name: x[0], role: x[1], extra: '' })), activeId: '', visible: false
      },
      tt: {
        layout: E.tt[0], light: E.tt[1], animIn: E.tt[2], animOut: E.tt[2], dur: 1100, pos: 'center', y: 0, scale: 1,
        logo: true, logoId: '', orn: true,
        items: E.tts.map(x => Object.assign({ id: K.uid() }, x)), activeId: '', visible: false
      },
      tk: {
        layout: E.tk[0], light: E.tk[1], animIn: E.tk[2], animOut: E.tk[2], dur: 800, pos: 'bottom', y: 30, margin: 40, height: 64, fsize: 30,
        badge: E.badge, logo: true, logoId: '', speed: 120, sep: '◆', clock: true,
        items: E.tks.map(t => ({ id: K.uid(), text: t, on: true })), visible: false
      },
      bug: { visible: false, logoId: '', corner: 'tr', size: 150, x: 60, y: 50, opacity: 1, fx: 'glow', animIn: 'zoomGlow', animOut: 'zoomGlow', dur: 800, items: [K.makeBugItem(0, { id: 'bug1' })] },
      loc: K.makeLoc(id),
      soc: K.makeSoc(id),
      oc: K.makeOC(id)
    };
  };
  K.defaultState = function () {
    const s = { v: 1, eventType: 'pengajian', events: {}, logos: [], defaultLogo: '' };
    s.events.pengajian = K.makeEventConfig('pengajian');
    return s;
  };

  // ---- warna ----
  K.hexRgb = function (h) {
    h = String(h || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  K.rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  K.shade = function (h, amt) { // amt -1..1
    const [r, g, b] = K.hexRgb(h);
    const t = amt < 0 ? 0 : 255, f = Math.abs(amt);
    return K.rgbHex(r + (t - r) * f, g + (t - g) * f, b + (t - b) * f);
  };
  K.onColor = function (h) {
    const [r, g, b] = K.hexRgb(h);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#141414' : '#ffffff';
  };
  K.themeVars = function (th) {
    const f = n => `'${n}', 'Segoe UI', Arial, sans-serif`;
    return {
      '--p': th.p, '--s': th.s, '--a': th.a, '--t': th.t, '--st': th.st,
      '--p-rgb': K.hexRgb(th.p).join(','), '--s-rgb': K.hexRgb(th.s).join(','), '--a-rgb': K.hexRgb(th.a).join(','),
      '--pd': K.shade(th.p, -0.45), '--pl': K.shade(th.p, 0.35), '--on-a': K.onColor(th.a), '--on-p': K.onColor(th.p),
      '--fn': f(th.fn), '--fr': f(th.fr), '--ft': f(th.ft), '--far': `'${th.far}', 'Traditional Arabic', serif`
    };
  };
  K.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  G.KLM = K;
})(typeof window !== 'undefined' ? window : globalThis);
