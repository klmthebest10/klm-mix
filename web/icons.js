/* KLM Mix - set ikon garis (SVG 24px, gaya seragam) dipakai di PC & HP.
 * KI.svg('play')      → string <svg>
 * KI.el('play')       → elemen <svg>
 * KI.img('play', c)   → <img> (untuk digambar di kanvas)
 * Simbol/emoji lama di teks antarmuka otomatis diganti ikon (KI.hydrate + MutationObserver),
 * sehingga tampilan konsisten di Windows/Android mana pun (tidak tergantung font emoji sistem).
 */
(function (W) {
  'use strict';
  const P = {
    play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none"/>',
    stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2.2" fill="currentColor" stroke="none"/>',
    rec: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
    dot: '<circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    'skip-back': '<path d="M18 5.5v13a.8.8 0 0 1-1.25.66L8 13V18H6V6h2v5l8.75-6.16A.8.8 0 0 1 18 5.5Z" fill="currentColor" stroke="none"/>',
    'skip-fwd': '<path d="M6 5.5v13a.8.8 0 0 0 1.25.66L16 13V18h2V6h-2v5L7.25 4.84A.8.8 0 0 0 6 5.5Z" fill="currentColor" stroke="none"/>',
    rewind: '<path d="M11 6.2v11.6a.7.7 0 0 1-1.1.57L2.6 12.57a.7.7 0 0 1 0-1.14L9.9 5.63A.7.7 0 0 1 11 6.2ZM21 6.2v11.6a.7.7 0 0 1-1.1.57l-7.3-5.8a.7.7 0 0 1 0-1.14l7.3-5.8A.7.7 0 0 1 21 6.2Z" fill="currentColor" stroke="none"/>',
    'play-back': '<path d="M17 4.5v15a1 1 0 0 1-1.5.86L3.1 12.86a1 1 0 0 1 0-1.72L15.5 3.64A1 1 0 0 1 17 4.5Z" fill="currentColor" stroke="none"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    clapper: '<path d="M4 11v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8H4Z"/><path d="m4 11-.88-2.87a2 2 0 0 1 1.33-2.5l11.48-3.5a2 2 0 0 1 2.5 1.32l.87 2.87L4 11.01Z"/><path d="m6.6 4.99 3.38 4.2M11.86 3.38l3.38 4.2"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    call: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1.2"/><circle cx="17.5" cy="10.5" r="1.2"/><circle cx="8.5" cy="7.5" r="1.2"/><circle cx="6.5" cy="12.5" r="1.2"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2Z"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3.5"/>',
    switcher: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M6.5 9.5h2M11 9.5h2M15.5 9.5h2M6.5 14.5h11"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1.5 14h5M9.5 8h5M17.5 16h5"/>',
    'volume-x': '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m23 9-6 6M17 9l6 6"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    title: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 8.5h8M12 8.5v8"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.36 6.36L3 16M3 12a9 9 0 0 1 15.36-6.36L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    'rotate-cw': '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
    'rotate-ccw': '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>',
    video: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.94a.5.5 0 0 0-.76-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
    'arrow-up': '<path d="M12 19V5M5 12l7-7 7 7"/>',
    'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.35-4.35"/>',
    flashlight: '<path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12Z"/><path d="M6 6h12M12 12v.01"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    gem: '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6M2 9h20"/>',
    help: '<circle cx="12" cy="12" r="9.5"/><path d="M9.1 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
    sparkles: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/>',
    battery: '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M6 10v4M10 10v4"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>',
    ban: '<circle cx="12" cy="12" r="9.5"/><path d="m5.3 5.3 13.4 13.4"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4.5a.5.5 0 0 0-.5.5V8a3 3 0 0 0 3 3M17 6h2.5a.5.5 0 0 1 .5.5V8a3 3 0 0 1-3 3"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    'chev-down': '<path d="m6 9 6 6 6-6"/>',
    'chev-right': '<path d="m9 18 6-6-6-6"/>',
    'chev-left': '<path d="m15 18-6-6 6-6"/>',
    'chev-up': '<path d="m18 15-6-6-6 6"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
    pointer: '<path d="m4 4 7.07 17 2.51-7.39L21 11.07Z"/><path d="m13.6 13.6 6 6"/>',
    film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
    headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    tv: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>',
    wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72ZM14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>',
    type: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    rect: '<rect x="3" y="6" width="18" height="12" rx="2"/>',
    library: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    bars: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7.5 4v11M12 4v11M16.5 4v11M3 15h18"/>',
    landmark: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l8 5H4Z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    cast: '<path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6M2 12a9 9 0 0 1 8 8M2 16a5 5 0 0 1 4 4M2 20h.01"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
    clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 1.5v2.5M15 1.5v2.5M9 20v2.5M15 20v2.5M20 9h2.5M20 15h2.5M1.5 9H4M1.5 15H4"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h6"/>',
    'file-plus': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v5h6M12 12v6M9 15h6"/>',
    'folder-open': '<path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5c0-1.1.9-2 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    more: '<circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    keyboard: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M18 13h.01M8 16h8M10 13h4"/>',
    hdd: '<path d="M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11ZM6 16h.01M10 16h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2"/>',
    move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2ZM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    timer: '<path d="M10 2h4M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
    star: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z"/>',
    flip: '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 20v2M12 14v2M12 8v2M12 2v2"/>',
    'zoom-in': '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.35-4.35M11 8v6M8 11h6"/>',
    'zoom-out': '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.35-4.35M8 11h6"/>',
    focus: '<circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>',
    signal: '<path d="M2 20h.01M7 20v-4M12 20v-8M17 20V8M22 4v16"/>',
    power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    logo: '<rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#kmg)" stroke="none"/><path d="M7.6 6.5h2.9v4.6l4.2-4.6h3.5l-4.95 5.25L18.4 17.5h-3.6l-4.3-4.75v4.75H7.6Z" fill="#fff" stroke="none"/>'
  };
  const SOLID = { play: 1, pause: 1, stop: 1, rec: 1, dot: 1, 'skip-back': 1, 'skip-fwd': 1, rewind: 1, 'play-back': 1, logo: 1 };
  // simbol/emoji lama → nama ikon
  const MAP = {
    '●': 'dot', '▶': 'play', '🎬': 'clapper', '🏆': 'trophy', '📱': 'phone', '⚙': 'settings', '✕': 'x', '✖': 'x', '■': 'stop', '📞': 'call',
    '⏮': 'skip-back', '⏭': 'skip-fwd', '⏸': 'pause', '⚠': 'alert', '🎨': 'palette', '⏪': 'rewind', '📷': 'camera', '🎛': 'switcher',
    '🔇': 'volume-x', '🎤': 'mic', '🖼': 'image', '🅃': 'title', '📸': 'camera', '⚡': 'zap', '📡': 'radio', '🌐': 'globe', '🔄': 'refresh',
    '🍃': 'leaf', '👁': 'eye', '🖥': 'monitor', '🔊': 'volume', '⧉': 'external', '📃': 'list', '◀': 'play-back', '🗑': 'trash', '🎥': 'video',
    '🎚': 'sliders', '⬅': 'arrow-left', '🔍': 'search', '🔦': 'flashlight', '🎯': 'target', '↻': 'rotate-cw', '⚖': 'gauge', '💎': 'gem',
    '❔': 'help', '✨': 'sparkles', '↺': 'rotate-ccw', '🔋': 'battery', '🌙': 'moon', '⛔': 'ban', '⟳': 'refresh', '🎵': 'music', '▾': 'chev-down',
    '📐': 'layout', '📂': 'folder-open', '🖱': 'pointer', '🎦': 'film', '🔁': 'repeat', '✎': 'pencil', '✂': 'scissors', '🎧': 'headphones',
    '📥': 'download', '📺': 'tv', '○': 'circle', '⌂': 'home', '🪄': 'wand', '🔤': 'type', '▭': 'rect', '◯': 'circle', '🚫': 'ban', '⬆': 'arrow-up',
    '⬇': 'arrow-down', '📚': 'library', '💾': 'save', '📊': 'bars', '🏛': 'landmark', '🔗': 'link', '⛶': 'maximize', '⏺': 'rec', '🧩': 'layers',
    '🟢': 'dot', '⚪': 'circle', '＋': 'plus', '🔒': 'lock', '⌨': 'keyboard', '💡': 'sun', '🖌': 'pencil', '📋': 'copy', '🔔': 'bell', '⏱': 'timer', '⭐': 'star'
  };
  const COLOR = { '🟢': '#22c55e', '⚪': '#9aa3b5' };
  const keys = Object.keys(MAP).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const RE = new RegExp('(' + keys.join('|') + ')\\uFE0F?[ \\u00A0]?', 'g');
  const TEST = new RegExp(keys.join('|'));

  function svg(name, size, extra) {
    const p = P[name] || P.circle;
    const s = size ? ' width="' + size + '" height="' + size + '"' : '';
    const defs = name === 'logo' ? '<defs><linearGradient id="kmg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4b3e"/><stop offset="1" stop-color="#ffb11f"/></linearGradient></defs>' : '';
    return '<svg class="ki ki-' + name + (extra ? ' ' + extra : '') + '" viewBox="0 0 24 24"' + s + ' fill="none" stroke="currentColor" stroke-width="' + (SOLID[name] ? 0 : 1.8) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + defs + p + '</svg>';
  }
  const tpl = document.createElement('template');
  function el(name, size, extra) { tpl.innerHTML = svg(name, size, extra); return tpl.content.firstChild; }
  const imgCache = {};
  function img(name, color, onload) {
    const k = name + color;
    if (!imgCache[k]) {
      const i = new Image();
      i.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg(name, 96).replace(/currentColor/g, color || '#fff').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
      imgCache[k] = i;
    }
    const i = imgCache[k];
    if (onload && !i.complete) i.addEventListener('load', onload, { once: true });
    return i;
  }
  const strip = (s) => String(s == null ? '' : s).replace(RE, '').replace(/^\s+/, '');
  function leading(s) { const m = new RegExp('^(' + keys.join('|') + ')').exec(String(s || '')); return m ? MAP[m[1]] : null; }

  // ---------- ganti simbol di teks antarmuka menjadi ikon ----------
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CANVAS: 1, svg: 1, CODE: 1, PRE: 1, TITLE: 1 };
  function hydrateText(node) {
    const t = node.nodeValue;
    if (!t || !TEST.test(t)) return;
    const par = node.parentNode; if (!par || SKIP[par.nodeName] || par.closest && par.closest('[data-noicon],code,pre')) return;
    if (par.nodeName === 'OPTION' || par.nodeName === 'OPTGROUP') { node.nodeValue = strip(t); return; }
    const frag = document.createDocumentFragment(); let last = 0; RE.lastIndex = 0; let m;
    while ((m = RE.exec(t))) {
      if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
      const name = MAP[m[1]];
      const e = el(name, null, (m[0].length > m[1].length && m.index + m[0].length < t.length) ? 'ki-gap' : '');
      if (COLOR[m[1]]) e.style.color = COLOR[m[1]];
      frag.appendChild(e); last = m.index + m[0].length;
    }
    if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
    par.replaceChild(frag, node);
  }
  function hydrateAttrs(e) {
    if (e.title && TEST.test(e.title)) e.title = strip(e.title);
    if (e.placeholder && TEST.test(e.placeholder)) e.placeholder = strip(e.placeholder);
  }
  function swapTag(i) { const e = el(i.getAttribute('data-ic'), null, i.className); i.replaceWith(e); }
  function hydrate(root) {
    if (!root) return;
    if (root.nodeType === 3) return hydrateText(root);
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    if (root.matches('i[data-ic]')) return swapTag(root);
    root.querySelectorAll('i[data-ic]').forEach(swapTag);
    hydrateAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    const texts = [];
    let n = tw.nextNode();
    while (n) { if (n.nodeType === 3) texts.push(n); else hydrateAttrs(n); n = tw.nextNode(); }
    texts.forEach(hydrateText);
  }
  let mo = null;
  function auto() {
    if (mo || !document.body) return;
    hydrate(document.body);
    if (TEST.test(document.title)) document.title = strip(document.title);
    mo = new MutationObserver((list) => {
      for (const r of list) {
        if (r.type === 'characterData') hydrateText(r.target);
        else if (r.type === 'attributes') hydrateAttrs(r.target);
        else r.addedNodes.forEach(hydrate);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder'] });
  }
  W.KI = { svg, el, img, strip, leading, hydrate, map: MAP, names: Object.keys(P) };
  if (document.body) auto(); else document.addEventListener('DOMContentLoaded', auto);
})(window);
