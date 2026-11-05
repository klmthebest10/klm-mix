/* KLM Mix - switcher untuk panel UTC KLM Acara
 *   klm  : KLM Mix sendiri (input, preview, program, transisi KLM Mix) — bawaan
 *   obs  : OBS Studio lewat obs-websocket v5
 *   vmix : vMix lewat Web Controller (HTTP API port 8088)
 * Bentuk status sama dengan UTC KLM Acara 9.0 sehingga panel asli bekerja tanpa diubah.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const QW = { hemat: [480, 0.5, 45], normal: [854, 0.65, 60], tajam: [1280, 0.8, 80] }; // lebar, kualitas jpeg (0-1), kualitas obs (0-100)
const KLM_TRANS = [['Fade', 'fade'], ['Merge', 'merge'], ['Wipe', 'wipe'], ['Slide', 'slide'], ['Zoom', 'zoom'], ['CrossZoom', 'crosszoom'], ['Circle', 'circle'], ['BarnDoor', 'barn'], ['Cube', 'cube'], ['Dip', 'dip'], ['Blur', 'blur'], ['Stinger1', 'stinger1'], ['Stinger2', 'stinger2']];
const VMIX_TRANS = ['Fade', 'Merge', 'Wipe', 'Slide', 'Fly', 'CrossZoom', 'FlyRotate', 'Cube', 'CubeZoom', 'VerticalWipe', 'VerticalSlide', 'Zoom', 'Stinger1', 'Stinger2'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isLocalHost = (h) => /^(127\.|localhost$|::1$)/i.test(h || '') || Object.values(os.networkInterfaces()).some((l) => (l || []).some((a) => a.address === h));

module.exports = function createSwitch(o) {
  const cfgF = path.join(o.dataDir, 'switcher.json');
  let C = { type: 'klm', obs: { host: '127.0.0.1', port: 4455, password: '' }, vmix: { host: '127.0.0.1', port: 8088 }, quality: 'normal', fps: 12, trans: 'Fade', dur: 500 };
  try { const s = JSON.parse(fs.readFileSync(cfgF, 'utf8')); C = Object.assign(C, s, { obs: Object.assign(C.obs, s.obs), vmix: Object.assign(C.vmix, s.vmix) }); } catch (e) {}
  const saveC = () => { try { fs.writeFileSync(cfgF, JSON.stringify(C, null, 1)); } catch (e) {} };

  let S = blank();
  function blank() { return { type: C.type, connected: false, error: '', version: '', inputs: [], transitions: [], trans: C.trans, dur: C.dur, preview: '', program: '', snap: false, studio: false }; }
  let lastSent = '';
  function emit() {
    S.type = C.type; S.trans = C.trans; S.dur = C.dur;
    const j = JSON.stringify(S);
    if (j !== lastSent) { lastSent = j; o.onStatus(JSON.parse(j)); }
  }

  // ---------- driver ----------
  let drv = null;
  function start() {
    if (drv) { try { drv.stop(); } catch (e) {} drv = null; }
    S = blank(); frames = {}; thumbs = {};
    if (C.type === 'klm') drv = klmDriver();
    else if (C.type === 'obs') drv = obsDriver();
    else if (C.type === 'vmix') drv = vmixDriver();
    if (!drv) S.error = '';
    emit();
  }

  // ===== KLM Mix =====
  function klmDriver() {
    const d = {
      stop() {},
      sync() {
        const st = o.mixer.getState();
        const s = st && st.state;
        if (!o.mixer.connected() || !s) { S.connected = false; S.error = 'Jendela mixer KLM Mix belum terbuka'; S.inputs = []; return emit(); }
        S.connected = true; S.error = ''; S.version = 'KLM Mix ' + o.mixer.version; S.snap = true;
        S.inputs = (s.inputs || []).map((i) => ({ id: i.id, name: i.title, num: i.num }));
        S.preview = s.previewId || ''; S.program = s.programId || '';
        S.transitions = KLM_TRANS.map((t) => t[0]);
        if (!S.transitions.includes(C.trans)) C.trans = 'Fade';
        emit();
      },
      async cmd(c) {
        const fn = (f, params) => o.mixer.call({ t: 'fn', fn: f, params: params || {} }).then((r) => { if (!r.ok) throw new Error(r.msg || 'Gagal'); });
        switch (c.act) {
          case 'preview': return fn('PreviewInput', { Input: c.id });
          case 'program': return trans(c.id);
          case 'take': return trans();
          case 'cut': return fn('Cut');
          case 'ftb': return fn('FadeToBlack');
          default: throw new Error('Tidak didukung di KLM Mix');
        }
        function trans(id) {
          const t = KLM_TRANS.find((x) => x[0] === (c.trans || C.trans)) || KLM_TRANS[0];
          const p = { Duration: String(c.dur != null ? c.dur : C.dur) }; if (id) p.Input = id;
          return fn(t[0] === 'Dip' ? 'Dip' : t[0], p);
        }
      },
      async shot(ch, id) {
        const q = QW[C.quality] || QW.normal;
        const r = await o.mixer.call({ t: 'utc-shot', ch, id, w: id ? 320 : q[0], q: q[1] }, 3000);
        return r && r.ok && r.data ? { buf: Buffer.from(r.data, 'base64'), type: 'image/jpeg' } : null;
      }
    };
    setTimeout(() => d.sync(), 0);
    return d;
  }

  // ===== OBS Studio (obs-websocket v5) =====
  function obsDriver() {
    let WS; try { WS = require('ws'); } catch (e) { S.error = 'Modul ws tidak tersedia'; return null; }
    let ws = null, stopped = false, rid = 1, retry = null, ident = false;
    const waits = new Map();
    let scenes = [], pvwLocal = '';
    function req(type, data, timeout) {
      return new Promise((res, rej) => {
        if (!ws || ws.readyState !== 1 || !ident) return rej(new Error('OBS belum terhubung'));
        const id = 'k' + (rid++);
        const t = setTimeout(() => { waits.delete(id); rej(new Error('OBS tidak menjawab')); }, timeout || 4000);
        waits.set(id, { res, rej, t });
        ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
      });
    }
    async function refresh() {
      try {
        const [sl, sm, tl] = await Promise.all([req('GetSceneList'), req('GetStudioModeEnabled'), req('GetSceneTransitionList')]);
        scenes = (sl.scenes || []).slice().sort((a, b) => b.sceneIndex - a.sceneIndex);
        S.inputs = scenes.map((s, i) => ({ id: s.sceneName, name: s.sceneName, num: i + 1 }));
        S.studio = !!sm.studioModeEnabled;
        S.program = sl.currentProgramSceneName || '';
        if (S.studio) S.preview = sl.currentPreviewSceneName || '';
        else { if (!S.inputs.some((x) => x.id === pvwLocal)) pvwLocal = (S.inputs.find((x) => x.id !== S.program) || {}).id || ''; S.preview = pvwLocal; }
        S.transitions = (tl.transitions || []).map((t) => t.transitionName);
        if (!S.transitions.includes(C.trans)) C.trans = tl.currentSceneTransitionName || S.transitions[0] || 'Fade';
        emit();
      } catch (e) {}
    }
    function connect() {
      if (stopped) return;
      ident = false;
      const url = 'ws://' + (C.obs.host || '127.0.0.1') + ':' + (C.obs.port || 4455);
      try { ws = new WS(url); } catch (e) { S.error = e.message; emit(); return later(); }
      ws.on('message', async (raw) => {
        let m; try { m = JSON.parse(raw); } catch (e) { return; }
        if (m.op === 0) {
          const d = { rpcVersion: 1, eventSubscriptions: 1 | 4 | 16 | 1024 };
          const a = m.d && m.d.authentication;
          if (a) {
            if (!C.obs.password) { S.error = 'OBS meminta password WebSocket'; emit(); }
            const sec = crypto.createHash('sha256').update((C.obs.password || '') + a.salt).digest('base64');
            d.authentication = crypto.createHash('sha256').update(sec + a.challenge).digest('base64');
          }
          S.version = 'OBS ' + ((m.d && m.d.obsWebSocketVersion) ? 'WebSocket ' + m.d.obsWebSocketVersion : '');
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (m.op === 2) {
          ident = true; S.connected = true; S.error = ''; S.snap = true;
          try { const v = await req('GetVersion'); S.version = 'OBS ' + v.obsVersion; } catch (e) {}
          refresh();
        } else if (m.op === 7) {
          const w = waits.get(m.d.requestId); if (!w) return;
          waits.delete(m.d.requestId); clearTimeout(w.t);
          if (m.d.requestStatus && m.d.requestStatus.result) w.res(m.d.responseData || {});
          else w.rej(new Error((m.d.requestStatus && m.d.requestStatus.comment) || 'Perintah OBS gagal'));
        } else if (m.op === 5) {
          const e = m.d.eventType, ed = m.d.eventData || {};
          if (e === 'CurrentProgramSceneChanged') { S.program = ed.sceneName; if (!S.studio && pvwLocal === S.program) { /* biarkan */ } emit(); }
          else if (e === 'CurrentPreviewSceneChanged') { if (S.studio) { S.preview = ed.sceneName; emit(); } }
          else if (/^(SceneListChanged|SceneCreated|SceneRemoved|SceneNameChanged|StudioModeStateChanged|SceneTransitionCreated|SceneTransitionRemoved|SceneTransitionNameChanged)$/.test(e)) refresh();
          else if (e === 'ExitStarted') { S.connected = false; S.error = 'OBS ditutup'; emit(); }
        }
      });
      ws.on('close', (code, why) => {
        ident = false;
        for (const w of waits.values()) { clearTimeout(w.t); w.rej(new Error('OBS terputus')); } waits.clear();
        S.connected = false;
        if (code === 4009) S.error = 'Password OBS WebSocket salah';
        else if (!S.error || S.connected === false) S.error = S.error && /password/i.test(S.error) ? S.error : 'Tidak terhubung ke OBS (' + (C.obs.host || '127.0.0.1') + ':' + (C.obs.port || 4455) + ') — mencoba lagi…';
        emit(); later();
      });
      ws.on('error', () => {});
    }
    function later() { clearTimeout(retry); if (!stopped) retry = setTimeout(connect, 3000); }
    connect();
    return {
      stop() { stopped = true; clearTimeout(retry); try { ws && ws.close(); } catch (e) {} },
      sync() {},
      async cmd(c) {
        const setTr = async () => {
          const t = c.trans || C.trans;
          if (t) await req('SetCurrentSceneTransition', { transitionName: t }).catch(() => {});
          const dur = +(c.dur != null ? c.dur : C.dur);
          if (dur >= 50) await req('SetCurrentSceneTransitionDuration', { transitionDuration: dur }).catch(() => {});
        };
        switch (c.act) {
          case 'preview':
            if (S.studio) await req('SetCurrentPreviewScene', { sceneName: c.id });
            else { pvwLocal = c.id; S.preview = c.id; emit(); }
            return;
          case 'program':
            await setTr();
            if (S.studio) { await req('SetCurrentPreviewScene', { sceneName: c.id }); await req('TriggerStudioModeTransition'); }
            else { const old = S.program; await req('SetCurrentProgramScene', { sceneName: c.id }); if (pvwLocal === c.id) { pvwLocal = old; S.preview = old; emit(); } }
            return;
          case 'take': case 'cut': {
            if (c.act === 'cut') {
              const tr = S.transitions.find((x) => /^cut$/i.test(x)) || (S.transitions.includes('Potong') ? 'Potong' : '');
              if (tr) await req('SetCurrentSceneTransition', { transitionName: tr }).catch(() => {});
            } else await setTr();
            if (S.studio) await req('TriggerStudioModeTransition');
            else {
              if (!S.preview) throw new Error('Pilih scene Preview dulu');
              const old = S.program; await req('SetCurrentProgramScene', { sceneName: S.preview }); pvwLocal = old; S.preview = old; emit();
            }
            if (c.act === 'cut' && C.trans) setTimeout(() => req('SetCurrentSceneTransition', { transitionName: C.trans }).catch(() => {}), 400);
            return;
          }
          case 'studio': await req('SetStudioModeEnabled', { studioModeEnabled: !!c.on }); return;
          case 'ftb': throw new Error('OBS tidak punya Fade to Black bawaan');
        }
        throw new Error('Perintah tidak dikenal');
      },
      async shot(ch, id) {
        const q = QW[C.quality] || QW.normal;
        const name = id || (ch === 'pgm' ? S.program : S.preview); if (!name) return null;
        const r = await req('GetSourceScreenshot', { sourceName: name, imageFormat: 'jpg', imageWidth: id ? 320 : q[0], imageCompressionQuality: q[2] }, 5000);
        const m = /^data:image\/\w+;base64,(.+)$/.exec(r.imageData || '');
        return m ? { buf: Buffer.from(m[1], 'base64'), type: 'image/jpeg' } : null;
      }
    };
  }

  // ===== vMix (Web Controller) =====
  function vmixDriver() {
    let stopped = false, t = null, fails = 0;
    const host = () => C.vmix.host || '127.0.0.1', port = () => C.vmix.port || 8088;
    function get(q, timeout) {
      return new Promise((res, rej) => {
        const r = http.get({ host: host(), port: port(), path: '/api/' + (q || ''), timeout: timeout || 2500 }, (rs) => {
          const ch = []; rs.on('data', (c) => ch.push(c)); rs.on('end', () => (rs.statusCode < 400 ? res(Buffer.concat(ch).toString('utf8')) : rej(new Error('vMix: ' + rs.statusCode))));
        });
        r.on('timeout', () => r.destroy(new Error('vMix tidak menjawab'))); r.on('error', rej);
      });
    }
    const fn = (name, p) => get('?Function=' + encodeURIComponent(name) + Object.entries(p || {}).map(([k, v]) => '&' + k + '=' + encodeURIComponent(v)).join(''));
    const unx = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    async function poll() {
      if (stopped) return;
      try {
        const x = await get('');
        const inputs = []; const re = /<input\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/input>)/g; let m;
        while ((m = re.exec(x))) {
          const at = {}; m[1].replace(/(\w+)="([^"]*)"/g, (_, k, v) => { at[k] = unx(v); });
          if (at.key && at.number) inputs.push({ id: at.key, name: at.title || at.shortTitle || ('Input ' + at.number), num: +at.number });
        }
        const tag = (n) => { const r = new RegExp('<' + n + '>([^<]*)</' + n + '>').exec(x); return r ? unx(r[1]) : ''; };
        const byNum = (n) => (inputs.find((i) => i.num === +n) || {}).id || '';
        S.connected = true; S.error = ''; S.version = 'vMix ' + tag('version') + (tag('edition') ? ' ' + tag('edition') : '');
        S.inputs = inputs; S.program = byNum(tag('active')); S.preview = byNum(tag('preview'));
        S.transitions = VMIX_TRANS; if (!S.transitions.includes(C.trans)) C.trans = 'Fade';
        S.snap = isLocalHost(host());
        fails = 0;
      } catch (e) {
        fails++;
        S.connected = false; S.error = 'Tidak terhubung ke vMix (' + host() + ':' + port() + ') — aktifkan Settings → Web Controller';
      }
      emit();
      t = setTimeout(poll, S.connected ? 500 : Math.min(5000, 1000 * fails));
    }
    poll();
    const snapDir = path.join(os.tmpdir(), 'klm-utc-vmix'); try { fs.mkdirSync(snapDir, { recursive: true }); } catch (e) {}
    return {
      stop() { stopped = true; clearTimeout(t); },
      sync() {},
      async cmd(c) {
        const tr = c.trans || C.trans || 'Fade', dur = String(c.dur != null ? c.dur : C.dur);
        switch (c.act) {
          case 'preview': await fn('PreviewInput', { Input: c.id }); break;
          case 'program': await fn(tr, { Input: c.id, Duration: dur }); break;
          case 'take': await fn(tr, { Duration: dur }); break;
          case 'cut': await fn('Cut'); break;
          case 'ftb': await fn('FadeToBlack'); break;
          default: throw new Error('Perintah tidak dikenal');
        }
        clearTimeout(t); setTimeout(poll, 120);
      },
      async shot(ch, id) {
        if (!S.snap) return null;
        const key = id || (ch === 'pgm' ? S.program : S.preview); if (!key) return null;
        const f = path.join(snapDir, (id ? 't_' : ch + '_') + key.replace(/[^\w-]/g, '') + '.jpg');
        try { fs.unlinkSync(f); } catch (e) {}
        await fn('SnapshotInput', { Input: key, Value: f });
        for (let i = 0; i < 20; i++) { // vMix menulis file secara asinkron
          await sleep(60);
          try { const b = fs.readFileSync(f); if (b.length > 100 && b[b.length - 1] === 0xd9) return { buf: b, type: 'image/jpeg' }; } catch (e) {}
        }
        return null;
      }
    };
  }

  // ---------- gambar monitor (long-poll; hanya diambil saat ada yang menonton) ----------
  let frames = {}, thumbs = {};
  async function frame(ch, since) {
    if (!drv || !S.connected || !drv.shot || (ch !== 'pvw' && ch !== 'pgm')) { await sleep(800); return null; }
    let f = frames[ch] || (frames[ch] = { seq: 0, buf: null, at: 0, busy: null });
    if (f.buf && f.seq > since && Date.now() - f.at < 1500) return f;
    const gap = 1000 / Math.max(1, Math.min(C.type === 'vmix' ? 8 : 25, C.fps || 6));
    const wait = f.at + gap - Date.now(); if (wait > 0) await sleep(wait);
    if (f.buf && f.seq > since) return f;
    if (!f.busy) {
      f.busy = drv.shot(ch).then((r) => { if (r) { f.seq++; f.buf = r.buf; f.type = r.type; } f.at = Date.now(); }).catch(() => { f.at = Date.now(); }).finally(() => { f.busy = null; });
    }
    await f.busy;
    if (!f.buf || f.seq <= since) { await sleep(300); return null; }
    return f;
  }
  async function thumb(id) {
    if (!drv || !S.connected || !drv.shot || !id) return null;
    let t = thumbs[id];
    if (t && Date.now() - t.at < 2000) return t;
    try {
      const r = await drv.shot(null, id);
      if (!r) return t || null;
      const h = crypto.createHash('md5').update(r.buf).digest('hex').slice(0, 10);
      thumbs[id] = t = { v: h, buf: r.buf, type: r.type, at: Date.now() };
    } catch (e) {}
    return t || null;
  }

  function publicConfig() {
    return { type: C.type, obs: { host: C.obs.host, port: C.obs.port, hasPass: !!C.obs.password }, vmix: { host: C.vmix.host, port: C.vmix.port }, quality: C.quality, fps: C.fps, trans: C.trans, dur: C.dur };
  }
  function setConfig(b) {
    let restart = !!b.reconnect;
    if (b.type && b.type !== C.type && ['klm', 'obs', 'vmix', 'none'].includes(b.type)) { C.type = b.type; restart = true; }
    if (b.obs) { C.obs.host = b.obs.host || C.obs.host; C.obs.port = +b.obs.port || C.obs.port; if (b.obs.password) C.obs.password = b.obs.password; else if (b.obs.password === '' && b.obs.clearPass) C.obs.password = ''; }
    if (b.vmix) { C.vmix.host = b.vmix.host || C.vmix.host; C.vmix.port = +b.vmix.port || C.vmix.port; }
    if (b.quality && QW[b.quality]) C.quality = b.quality;
    if (b.fps) C.fps = Math.max(1, Math.min(25, +b.fps));
    if (b.trans) C.trans = String(b.trans);
    if (b.dur != null && !isNaN(+b.dur)) C.dur = Math.max(0, Math.min(20000, +b.dur));
    saveC();
    if (restart) start(); else emit();
    return publicConfig();
  }

  start();
  return {
    config: publicConfig, status: () => S, setConfig, frame, thumb,
    async command(c) {
      if (!drv) throw new Error('Switcher tidak dipakai');
      if (!S.connected) throw new Error(S.error || 'Switcher belum terhubung');
      if (c.trans) C.trans = String(c.trans);
      if (c.dur != null && !isNaN(+c.dur)) C.dur = +c.dur;
      await drv.cmd(c);
    },
    onMixerState() { if (drv && C.type === 'klm') drv.sync(); },
    onMixerMessage() {},
    shutdown() { if (drv) try { drv.stop(); } catch (e) {} }
  };
};
