/* KLM Mix - input "Mirroring HP": layar HP (aplikasi KLM Mix .apk) dikirim H.264 lewat TCP di jaringan lokal,
 * didekode di sini dengan WebCodecs (dekoder hardware bila ada) dengan antrean sependek mungkin → latensi rendah.
 * Tanpa internet: HP & PC cukup satu WiFi / hotspot / USB tethering. */
'use strict';
(function (KM) {
  const h = KM.h;
  const MR = KM.mirror = {};
  const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, '0')).join('');
  MR.supported = () => typeof VideoDecoder === 'function';

  /** codec string dari SPS (Annex-B): avc1.PPCCLL */
  function codecOf(cfg) {
    for (let i = 0; i + 4 < cfg.length; i++) {
      if (cfg[i] === 0 && cfg[i + 1] === 0 && (cfg[i + 2] === 1 || (cfg[i + 2] === 0 && cfg[i + 3] === 1))) {
        const j = i + (cfg[i + 2] === 1 ? 3 : 4);
        if ((cfg[j] & 31) === 7) return 'avc1.' + [cfg[j + 1], cfg[j + 2], cfg[j + 3]].map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    }
    return 'avc1.640028';
  }
  MR.link = function (inp, ip) {
    const L = KM.link, ips = (L.ips && L.ips.length ? L.ips : [{ address: location.hostname }]).map((x) => x.address);
    const host = ip || ips[0], port = L.ports.http || location.port;
    return `http://${host}:${port}/mirror#h=${ips.join(',')}&p=${L.ports.mirror || 8624}&t=${inp.opts.token}&q=${inp.opts.size}&f=${inp.opts.fps}&b=${inp.opts.bitrate}`;
  };
  /** daftarkan token ke server sebelum input dibuat (HP boleh scan lebih dulu) */
  MR.allow = (token, name) => fetch('/api/mirror/allow?t=' + token + '&n=' + encodeURIComponent(name || '')).catch(() => {});

  MR.open = function (inp) {
    const rt = inp.rt, o = inp.opts;
    if (!MR.supported()) { rt.err = 'Mirroring butuh versi PC (WebCodecs tidak tersedia)'; return; }
    rt.mst = 'Menunggu HP — scan QR di pengaturan input'; rt.mfps = 0;
    let cfg = null, codec = '', dec = null, needKey = true, n = 0, tN = performance.now(), lastAsk = 0;
    const st = rt.mstat = { cfg: 0, key: 0, delta: 0, out: 0, drop: 0, err: '' };
    const cv = rt.canvas = rt.canvas || document.createElement('canvas'), c = cv.getContext('2d', { alpha: false, desynchronized: true });
    const ask = () => { const now = performance.now(); if (now - lastAsk > 600 && rt.mws && rt.mws.readyState === 1) { lastAsk = now; rt.mws.send('{"t":"key"}'); } };
    const mk = () => {
      if (dec && dec.state !== 'closed') { try { dec.close(); } catch (e) {} }
      dec = new VideoDecoder({
        output: (f) => {
          const w = f.displayWidth, hh = f.displayHeight;
          if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
          try { c.drawImage(f, 0, 0, w, hh); } catch (e) {}
          f.close(); rt.mw = w; rt.mh = hh; n++; st.out++;
          const now = performance.now(); if (now - tN >= 1000) { rt.mfps = Math.round(n * 1000 / (now - tN)); n = 0; tN = now; }
        },
        error: (e) => { console.warn('[mirror] dekoder', e.message); st.err = e.message; needKey = true; setTimeout(() => { if (!rt.gone && cfg) { mk(); ask(); } }, 100); }
      });
      try { dec.configure({ codec, optimizeForLatency: true, hardwareAcceleration: o.sw ? 'prefer-software' : 'no-preference' }); } catch (e) { rt.err = 'Format video HP tidak didukung (' + codec + ')'; }
      needKey = true;
    };
    const connect = () => {
      if (rt.gone) return;
      const ws = rt.mws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/mirror-feed?t=' + o.token + '&n=' + encodeURIComponent(inp.title || ''));
      ws.binaryType = 'arraybuffer';
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') {
          let m; try { m = JSON.parse(e.data); } catch (x) { return; }
          if (m.t === 'hello' || m.t === 'info') { rt.minfo = m.info; rt.mst = ''; rt.err = ''; KM.changed('input'); if (m.t === 'hello') KM.toast('Mirroring: ' + (m.info.name || m.info.model || 'HP') + ' tersambung', 'ok'); }
          if (m.t === 'bye') { rt.minfo = null; rt.mw = 0; rt.mst = 'HP terputus — buka lagi Mirroring di HP'; cfg = null; KM.changed('input'); }
          return;
        }
        const u = new Uint8Array(e.data), type = u[0], pts = new DataView(e.data).getFloat64(1, true), data = u.subarray(9);
        if (type === 1) { st.cfg++; cfg = data.slice(); const cs = codecOf(cfg); if (cs !== codec || !dec || dec.state !== 'configured') { codec = cs; mk(); } needKey = true; return; }
        if (!cfg || !dec || dec.state !== 'configured') return ask();
        if (type === 2) {
          const b = new Uint8Array(cfg.length + data.length); b.set(cfg, 0); b.set(data, cfg.length);
          try { dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: pts, data: b })); needKey = false; st.key++; } catch (x) { needKey = true; st.err = x.message; }
        } else if (type === 3) {
          if (needKey) return ask();
          if (dec.decodeQueueSize > 4) { needKey = true; st.drop++; return ask(); } // PC tertinggal: buang sampai frame kunci berikutnya, jangan menumpuk jeda
          try { dec.decode(new EncodedVideoChunk({ type: 'delta', timestamp: pts, data })); st.delta++; } catch (x) { needKey = true; st.err = x.message; ask(); }
        }
      };
      ws.onclose = () => { if (!rt.gone) setTimeout(connect, 1000); };
      ws.onerror = () => {};
    };
    connect();
  };
  MR.close = function (inp) {
    const rt = inp.rt; rt.gone = true;
    try { rt.mws && rt.mws.send('{"t":"stop"}'); } catch (e) {}
    try { rt.mws && rt.mws.close(); } catch (e) {}
  };

  KM.inputTypes.mirror = {
    label: 'Mirroring HP (layar)', icon: '📱',
    create(inp) {
      inp.opts = Object.assign({ token: '', size: 1280, fps: 60, bitrate: 8000 }, inp.opts);
      if (!/^[a-f0-9]{8,32}$/.test(inp.opts.token)) inp.opts.token = rnd();
      inp.rt.ready = true;
      MR.open(inp);
    },
    destroy(inp) { MR.close(inp); },
    source(inp) {
      const rt = inp.rt;
      if (rt.mw && rt.minfo) return { src: rt.canvas, w: rt.mw, h: rt.mh };
      return KM.placeholder(inp, '📱 Mirroring HP', rt.err || rt.mst || 'Menunggu HP…');
    }
  };

  /** blok QR + langkah (dialog tambah & pengaturan input) */
  MR.connectBox = function (inp) {
    const box = h('div');
    const draw = () => {
      const L = KM.link, ips = (L.ips && L.ips.length ? L.ips : [{ address: location.hostname }]);
      const info = inp.rt && inp.rt.minfo;
      box.replaceChildren(h('div.sec', h('h4', '📱 Sambungkan HP (scan QR)'),
        info ? h('p', h('span.pill.ok', 'Tersambung'), ' ', h('b', info.name || info.model || 'HP'), ' • ' + (info.w || '?') + '×' + (info.h || '?') + ' • ' + ((inp.rt && inp.rt.mfps) || 0) + ' fps') : null,
        h('div.row', KM.dialogs.qr(MR.link(inp, ips[0].address)), h('div.grow',
          h('p', '1. HP & PC di jaringan yang sama (WiFi / hotspot HP / USB tethering) — ', h('b', 'tanpa internet pun bisa'), '.'),
          h('p', '2. Buka aplikasi ', h('b', 'KLM Mix (.apk)'), ' di HP → ', h('b', 'Mirroring'), ' → ', h('b', 'Scan QR'), ' ini. Atau scan dengan kamera HP lalu pilih "Buka di aplikasi".'),
          h('p', '3. Izinkan "Mulai merekam/mentransmisikan layar" → layar HP langsung tampil di input ini.'),
          ips.length > 1 ? h('p.muted', 'PC punya beberapa alamat (' + ips.map((x) => x.address).join(', ') + ') — HP mencoba semuanya otomatis.') : null,
          h('p.muted', 'Khusus Android 8+ lewat aplikasi KLM Mix. iPhone tidak mengizinkan aplikasi biasa menyiarkan layar dengan cara ini.')))));
    };
    draw();
    const iv = setInterval(() => { if (!box.isConnected) return clearInterval(iv); draw(); }, 1500);
    return box;
  };
})(window.KM);
