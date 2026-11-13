/* KLM Mix - input "Mirroring HP": layar HP dikirim H.264 lewat TCP di jaringan lokal, didekode di sini dengan WebCodecs
 * (dekoder hardware bila ada) dengan antrean sependek mungkin → latensi rendah. Tanpa internet: cukup satu WiFi / hotspot.
 * Dua sumber: (1) Android lewat aplikasi KLM Mix (.apk), (2) iPhone / iPad / Mac tanpa aplikasi lewat penerima AirPlay
 * bawaan (helper klm-airplay, mode opts.mode = 'airplay'). Android tanpa aplikasi memakai Miracast bawaan Windows +
 * tangkapan jendela (lihat dialog). */
'use strict';
(function (KM) {
  const h = KM.h;
  const MR = KM.mirror = {};
  const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(6))).map((b) => b.toString(16).padStart(2, '0')).join('');
  MR.supported = () => typeof VideoDecoder === 'function';
  /** status penerima AirPlay dari proses utama: {available, running, ev, name, model, w, h, msg} */
  MR.ap = { available: false, ev: 'off' };
  const isAp = (inp) => inp && inp.opts && inp.opts.mode === 'airplay';
  const apInputs = () => (KM.state.inputs || []).filter((i) => i.type === 'mirror' && isAp(i));
  if (window.klm && window.klm.on) {
    window.klm.on('airplay:status', (st) => { const prev = MR.ap.ev; MR.ap = st || MR.ap; if (st && st.ev === 'client' && prev !== 'client') KM.toast('AirPlay: ' + (st.name || st.model || 'perangkat Apple') + ' menyambung…', 'ok'); apInputs().forEach((i) => { i.rt.mst = MR.apText(); }); KM.changed('input'); });
    window.klm.invoke('airplay:status').then((st) => { if (st) MR.ap = st; }).catch(() => {});
  }
  MR.apText = () => {
    const a = MR.ap || {};
    if (a.ev === 'error') return '⚠ ' + (a.msg || 'penerima AirPlay bermasalah');
    if (a.fw === 'need') return '⚠ ' + (a.fwMsg || 'Windows Firewall belum mengizinkan penerima AirPlay');
    if (!a.running && a.ev !== 'starting') return a.available === false ? 'Penerima AirPlay tidak tersedia di instalasi ini' : 'Penerima AirPlay mati';
    if (a.ev === 'starting') return 'Menyalakan penerima AirPlay…';
    if (a.ev === 'client' || a.ev === 'mirror') return (a.name || 'Perangkat Apple') + ' menyambung…';
    return 'Siap — di iPhone: Pusat Kontrol → Pencerminan Layar → "' + (a.rname || 'KLM Mix') + '"';
  };
  MR.apStart = (inp) => {
    if (!window.klm || !window.klm.invoke) { inp.rt.err = 'AirPlay hanya tersedia di versi PC (.exe)'; return; }
    window.klm.invoke('airplay:start', { token: inp.opts.token, name: inp.opts.apName || 'KLM Mix' }).then((st) => { if (st) MR.ap = st; inp.rt.mst = MR.apText(); KM.changed('input'); }).catch((e) => { inp.rt.err = e.message; });
  };

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
  // ---------- suara Mirroring: PCM s16 stereo 44,1 kHz → AudioWorklet (penyangga kecil, resample ke rate mixer) ----------
  const PCM_WORKLET = `class KlmPcm extends AudioWorkletProcessor {
    constructor(o) { super(); const p = (o && o.processorOptions) || {}; this.inRate = p.rate || 44100; this.cap = this.inRate * 2;
      this.L = new Float32Array(this.cap); this.R = new Float32Array(this.cap); this.w = 0; this.r = 0; this.n = 0; this.pos = 0; this.wait = true;
      this.target = Math.round(this.inRate * (p.target || 0.08)); this.max = Math.round(this.inRate * 0.3); this.under = 0;
      this.port.onmessage = (e) => { const d = new Int16Array(e.data); const k = d.length >> 1;
        for (let i = 0; i < k; i++) { this.L[this.w] = d[2 * i] / 32768; this.R[this.w] = d[2 * i + 1] / 32768; this.w = (this.w + 1) % this.cap; }
        this.n = Math.min(this.cap, this.n + k);
        if (this.n > this.max) { const drop = this.n - this.target; this.r = (this.r + drop) % this.cap; this.n -= drop; this.pos = 0; } }; }
    process(_, outs) { const o = outs[0], L = o[0], R = o[1] || o[0], m = L.length, step = this.inRate / sampleRate;
      if (this.wait) { if (this.n < this.target) { L.fill(0); R.fill(0); return true; } this.wait = false; }
      for (let i = 0; i < m; i++) {
        if (this.n < 2) { L.fill(0, i); R.fill(0, i); this.wait = true; this.under++; break; }
        const a = this.r, b = (a + 1) % this.cap, f = this.pos;
        L[i] = this.L[a] + (this.L[b] - this.L[a]) * f; R[i] = this.R[a] + (this.R[b] - this.R[a]) * f;
        this.pos += step; while (this.pos >= 1) { this.pos -= 1; this.r = (this.r + 1) % this.cap; this.n--; } }
      return true; } }
  registerProcessor('klm-pcm', KlmPcm);`;
  let pcmMod = null;
  async function pcmNode(inp, rate) {
    const A = KM.audio; A.init(); const ctx = A.ctx;
    if (!pcmMod) pcmMod = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([PCM_WORKLET], { type: 'text/javascript' })));
    await pcmMod;
    const node = new AudioWorkletNode(ctx, 'klm-pcm', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { rate: rate || 44100, target: 0.08 } });
    inp.rt.pcmNode = node; A.attach(inp, true); KM.changed('audio');
    return node;
  }

  /** dorong PCM s16 stereo ke strip audio input (membuat AudioWorklet saat paket pertama) */
  function feedPcm(inp, data, rate) {
    const rt = inp.rt;
    if (rt.pcmNode) { rt.pcmNode.port.postMessage(data.slice().buffer, []); return; }
    if (rt.pcmWait) return;
    rt.pcmWait = true; pcmNode(inp, rate || 44100).catch((x) => { rt.pcmWait = false; console.warn('[mirror] suara', x); });
  }
  /** suara PC tanpa suara KLM Mix (helper klm-procaudio, Windows): dipakai input tangkap layar / Miracast */
  MR.pcAudioStart = function (inp) {
    const rt = inp.rt, o = inp.opts;
    if (!window.klm || !window.klm.invoke) return;
    if (!/^[a-f0-9]{8,32}$/.test(o.audioToken || '')) o.audioToken = rnd();
    MR.allow(o.audioToken, inp.title).then(() => window.klm.invoke('procaudio:start', { token: o.audioToken, name: inp.title })).then((st) => { rt.pcSt = st; if (st && st.ev === 'error') { rt.pcErr = st.msg; KM.toast('Suara PC: ' + st.msg, 'warn'); } KM.changed('input'); }).catch(() => {});
    let rate = 48000;
    const connect = () => {
      if (rt.gone || rt.pcStop) return;
      const ws = rt.aws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/mirror-feed?t=' + o.audioToken + '&n=' + encodeURIComponent(inp.title || ''));
      ws.binaryType = 'arraybuffer';
      ws.onmessage = (e) => {
        if (typeof e.data === 'string') { try { const m = JSON.parse(e.data); if (m.info && m.info.audio) rate = m.info.audio; } catch (x) {} return; }
        const u = new Uint8Array(e.data); if (u[0] !== 5) return;
        rt.pcPkts = (rt.pcPkts || 0) + 1; feedPcm(inp, u.subarray(9), rate);
      };
      ws.onclose = () => { if (!rt.gone && !rt.pcStop) setTimeout(connect, 1000); };
      ws.onerror = () => {};
    };
    connect();
  };
  MR.pcAudioStop = function (inp) {
    const rt = inp.rt; rt.pcStop = true;
    try { rt.aws && rt.aws.close(); } catch (e) {}
    if (rt.pcmNode) { try { rt.pcmNode.port.close(); rt.pcmNode.disconnect(); } catch (e) {} rt.pcmNode = null; rt.pcmWait = false; }
    if (inp.opts.audioToken && window.klm && window.klm.invoke) window.klm.invoke('procaudio:stop', { token: inp.opts.audioToken }).catch(() => {});
  };

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
    const ap = isAp(inp);
    rt.mst = ap ? MR.apText() : 'Menunggu HP — scan QR di pengaturan input'; rt.mfps = 0;
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
        error: (e) => {
          console.warn('[mirror] dekoder', e.message); st.err = e.message; needKey = true;
          // AirPlay tidak bisa diminta frame kunci → sambung ulang feed: server mengulang dari frame kunci terakhir
          if (ap) { setTimeout(() => { if (!rt.gone) { mk(); try { rt.mws && rt.mws.close(); } catch (x) {} } }, 100); return; }
          setTimeout(() => { if (!rt.gone && cfg) { mk(); ask(); } }, 100);
        }
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
          if (m.t === 'bye') { rt.minfo = null; rt.mw = 0; rt.mst = ap ? MR.apText() : 'HP terputus — buka lagi Mirroring di HP'; cfg = null; KM.changed('input'); }
          return;
        }
        const u = new Uint8Array(e.data), type = u[0], pts = new DataView(e.data).getFloat64(1, true), data = u.subarray(9);
        if (type === 5) { // suara
          st.audio = (st.audio || 0) + 1;
          feedPcm(inp, data, (rt.minfo && rt.minfo.audio) || 44100);
          return;
        }
        if (type === 1) { st.cfg++; cfg = data.slice(); const cs = codecOf(cfg); if (cs !== codec || !dec || dec.state !== 'configured') { codec = cs; mk(); } needKey = true; return; }
        if (!cfg || !dec || dec.state !== 'configured') return ask();
        if (type === 2) {
          const b = new Uint8Array(cfg.length + data.length); b.set(cfg, 0); b.set(data, cfg.length);
          try { dec.decode(new EncodedVideoChunk({ type: 'key', timestamp: pts, data: b })); needKey = false; st.key++; } catch (x) { needKey = true; st.err = x.message; }
        } else if (type === 3) {
          if (needKey) return ask();
          // PC tertinggal: buang sampai frame kunci berikutnya, jangan menumpuk jeda (HP Android segera mengirim frame kunci baru).
          // AirPlay tidak bisa diminta frame kunci → jangan dibuang; dekoder mengejar sendiri.
          if (!ap && dec.decodeQueueSize > 4) { needKey = true; st.drop++; return ask(); }
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
    if (isAp(inp) && window.klm && window.klm.invoke) setTimeout(() => { if (!apInputs().some((i) => i !== inp && !i.rt.gone)) window.klm.invoke('airplay:stop').catch(() => {}); }, 300);
    try { rt.mws && rt.mws.send('{"t":"stop"}'); } catch (e) {}
    try { rt.mws && rt.mws.close(); } catch (e) {}
    if (rt.pcmNode) { try { rt.pcmNode.port.close(); rt.pcmNode.disconnect(); } catch (e) {} rt.pcmNode = null; }
  };

  KM.inputTypes.mirror = {
    label: 'Mirroring HP / iPhone', icon: '📱',
    create(inp) {
      inp.opts = Object.assign({ mode: 'app', token: '', size: 1280, fps: 60, bitrate: 8000, apName: 'KLM Mix' }, inp.opts);
      if (!/^[a-f0-9]{8,32}$/.test(inp.opts.token)) inp.opts.token = rnd();
      inp.rt.ready = true;
      if (isAp(inp)) {
        // hanya satu penerima AirPlay: input AirPlay lain ikut memakai token yang sama
        const other = apInputs().find((i) => i !== inp && !i.rt.gone);
        if (other) inp.opts.token = other.opts.token;
        MR.allow(inp.opts.token, 'AirPlay').then(() => MR.apStart(inp));
      }
      MR.open(inp);
    },
    destroy(inp) { MR.close(inp); },
    hasAudio: (inp) => !!inp.rt.pcmNode || isAp(inp),
    source(inp) {
      const rt = inp.rt;
      if (rt.mw && rt.minfo) return { src: rt.canvas, w: rt.mw, h: rt.mh };
      if (isAp(inp)) return KM.placeholder(inp, '📲 AirPlay (iPhone / iPad / Mac)', rt.err || MR.apText());
      return KM.placeholder(inp, '📱 Mirroring HP', rt.err || rt.mst || 'Menunggu HP…');
    }
  };

  /** blok QR + langkah (dialog tambah & pengaturan input) */
  MR.connectBox = function (inp) {
    if (isAp(inp)) return MR.airplayBox(inp);
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
          h('p.muted', 'Khusus Android 8+ lewat aplikasi KLM Mix. Untuk iPhone/iPad pilih mode AirPlay (tanpa aplikasi); Android tanpa aplikasi bisa lewat Miracast.')))));
    };
    draw();
    const iv = setInterval(() => { if (!box.isConnected) return clearInterval(iv); draw(); }, 1500);
    return box;
  };

  /** petunjuk + status penerima AirPlay (dialog tambah & pengaturan input) */
  MR.airplayBox = function (inp) {
    const box = h('div');
    let detOpen = false;
    const inv = (ch) => window.klm && window.klm.invoke ? window.klm.invoke(ch).catch(() => {}) : Promise.resolve();
    const draw = () => {
      const a = MR.ap || {}, info = inp.rt && inp.rt.minfo, nm = (inp.opts && inp.opts.apName) || a.rname || 'KLM Mix';
      const pill = info ? h('span.pill.ok', 'Tersambung') : a.ev === 'error' ? h('span.pill.red', 'Masalah') : a.running ? h('span.pill.ok', 'Siap menerima') : h('span.pill', inp.rt && inp.rt.ready ? 'Mati' : 'Belum dibuat');
      const nets = (a.nets || []).filter((n) => n.ip);
      const hot = nets.find((n) => n.hotspot);
      box.replaceChildren(h('div.sec', h('h4', '📲 Pencerminan layar iPhone / iPad / Mac — tanpa aplikasi'),
        h('p', pill, ' ', info ? h('span', h('b', info.name || info.model || 'Perangkat Apple'), ' • ' + (inp.rt.mw || info.w || '?') + '×' + (inp.rt.mh || info.h || '?') + ' • ' + (inp.rt.mfps || 0) + ' fps' + (inp.rt.mstat && inp.rt.mstat.audio ? ' • 🔊 suara masuk' : '')) : h('span.muted', MR.apText())),
        a.fw === 'need' ? h('p', h('span.pill.warn', 'Firewall'), ' ' + (a.fwMsg || 'Windows Firewall belum mengizinkan penerima AirPlay') + ' ', h('button.btn', { type: 'button', onclick: () => inv('airplay:firewall') }, '🛡 Izinkan di firewall')) : null,
        h('p', '1. iPhone & PC di ', h('b', 'jaringan yang sama'), ' — satu WiFi, PC tersambung ke hotspot iPhone, atau iPhone tersambung ke ', h('b', 'Hotspot Seluler PC'), '. Tanpa internet pun bisa.'),
        h('p', '2. Di iPhone buka ', h('b', 'Pusat Kontrol'), ' → ', h('b', 'Pencerminan Layar'), ' (Screen Mirroring) → pilih ', h('b', '"' + nm + '"'), '. Layar & ', h('b', 'suara'), ' iPhone langsung masuk.'),
        nets.length ? h('p.muted', 'Diumumkan di: ' + nets.map((n) => n.ip + (n.hotspot ? ' (hotspot PC)' : '')).join(', ')) : null,
        h('details', { ontoggle: (e) => { detOpen = e.currentTarget.open; } }, h('summary', '"' + nm + '" tidak muncul di iPhone? (WiFi tamu / kantor / sekolah sering memblokir)'),
          h('p', 'WiFi seperti itu memisahkan perangkat satu sama lain. Pakai jaringan sendiri, salah satu:'),
          h('p', 'A. ', h('b', 'Hotspot Seluler PC'), ': ', h('button.btn', { type: 'button', onclick: () => inv('airplay:hotspot') }, '📶 Buka Hotspot Seluler Windows'), ' → nyalakan → di iPhone sambungkan WiFi ke nama hotspot PC → "' + nm + '" muncul otomatis' + (hot ? ' (hotspot PC sudah aktif: ' + hot.ip + ')' : '') + '.'),
          h('p', 'B. ', h('b', 'Hotspot Pribadi iPhone'), ': nyalakan di iPhone (Pengaturan → Hotspot Pribadi), sambungkan WiFi PC ke iPhone.'),
          h('p.muted', 'Lalu matikan-nyalakan WiFi iPhone bila perlu. KLM Mix mengumumkan diri di semua jaringan PC sekaligus dan mengikuti bila jaringan berubah.')),
        null,
        h('p.muted', 'Atur suara di strip audio input ini (A/V sync tersedia). Video ber-DRM (Netflix, Disney+, dll.) memang tidak boleh dicerminkan oleh iPhone — itu aturan Apple untuk semua penerima, bukan dari KLM Mix.')));
    };
    const draw2 = () => { draw(); const d = box.querySelector('details'); if (d) d.open = detOpen; };
    draw2();
    const iv = setInterval(() => { if (!box.isConnected) return clearInterval(iv); draw2(); }, 1500);
    return box;
  };
})(window.KM);
