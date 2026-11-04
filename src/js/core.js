/* KLM Mix - inti: namespace, utilitas, state, pengaturan */
'use strict';
window.KM = window.KM || {};
(function (KM) {
  KM.version = '1.1.0';
  KM.isElectron = !!(window.klm && window.klm.isElectron);

  // ---------- event bus ----------
  const listeners = {};
  KM.on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
  KM.emit = (ev, data) => { (listeners[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(ev, e); } }); };

  // ---------- util ----------
  KM.uid = () => Math.random().toString(36).slice(2, 10);
  KM.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  KM.lerp = (a, b, t) => a + (b - a) * t;
  KM.ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  KM.easeOut = (t) => 1 - Math.pow(1 - t, 3);
  KM.now = () => performance.now();
  KM.pad = (n, l = 2) => String(n).padStart(l, '0');
  KM.fmtTime = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    return KM.pad(Math.floor(sec / 3600)) + ':' + KM.pad(Math.floor(sec / 60) % 60) + ':' + KM.pad(sec % 60);
  };
  KM.stamp = () => {
    const d = new Date();
    return d.getFullYear() + KM.pad(d.getMonth() + 1) + KM.pad(d.getDate()) + '-' + KM.pad(d.getHours()) + KM.pad(d.getMinutes()) + KM.pad(d.getSeconds());
  };
  KM.deepClone = (o) => JSON.parse(JSON.stringify(o));
  KM.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** h('div.cls#id', {attrs/on*}, children) */
  KM.h = function (sel, attrs, ...kids) {
    const m = sel.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i) || [];
    const el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, (_, t, n) => { if (t === '.') el.classList.add(n); else el.id = n; });
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && k !== 'list' && k !== 'type') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); };
    kids.forEach(add);
    return el;
  };
  KM.$ = (s, r) => (r || document).querySelector(s);
  KM.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ---------- pengaturan ----------
  const DEFAULT_SETTINGS = {
    width: 1920, height: 1080, fps: 30,
    previewScale: 0.5,
    autoAddCam: true,
    recFormat: 'mp4', recVideoKbps: 12000, recAudioKbps: 192, recFolder: '', recSource: 'master',
    snapFolder: '',
    stream: {
      encoder: 'auto', preset: 'veryfast', videoBitrate: 4500, audioBitrate: 160,
      destinations: [
        { enabled: true, name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2/', key: '' },
        { enabled: false, name: 'Facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', key: '' },
        { enabled: false, name: 'Custom', url: '', key: '' }
      ]
    },
    replay: { source: 'program', seconds: 15, width: 640, height: 360 },
    transitions: [
      { type: 'fade', dur: 500 }, { type: 'merge', dur: 800 }, { type: 'wipe', dur: 700 }, { type: 'zoom', dur: 600 }
    ],
    stingers: [{ inputId: '', cut: 500 }, { inputId: '', cut: 500 }],
    overlayFx: [
      { type: 'fade', dur: 400 }, { type: 'fade', dur: 400 }, { type: 'slide', dur: 500 }, { type: 'zoom', dur: 400 }
    ],
    monitorAudio: true, audioOutDevice: '',
    language: 'id'
  };
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('klmmix.settings') || '{}');
      const out = Object.assign(KM.deepClone(DEFAULT_SETTINGS), s);
      out.stream = Object.assign(KM.deepClone(DEFAULT_SETTINGS.stream), s.stream || {});
      out.replay = Object.assign(KM.deepClone(DEFAULT_SETTINGS.replay), s.replay || {});
      return out;
    } catch (e) { return KM.deepClone(DEFAULT_SETTINGS); }
  }
  KM.settings = loadSettings();
  KM.saveSettings = () => { try { localStorage.setItem('klmmix.settings', JSON.stringify(KM.settings)); } catch (e) {} KM.emit('settings'); };

  // ---------- state utama ----------
  KM.state = {
    inputs: [],            // daftar input (urutan = nomor input)
    previewId: null,
    programId: null,
    overlays: [0, 1, 2, 3].map(() => ({ inputId: null, phase: 'off', t0: 0 })),
    ftb: { on: false, t0: 0, v: 0 },
    trans: null,           // transisi aktif
    tbar: 0,
    recording: false, streaming: false, multicorder: false,
    externalOn: false
  };

  KM.getInput = (key) => {
    if (key == null || key === '') return null;
    const S = KM.state;
    if (typeof key === 'object') return key;
    const byId = S.inputs.find((i) => i.id === key);
    if (byId) return byId;
    const k = String(key).trim();
    if (/^\d+$/.test(k)) return S.inputs[parseInt(k, 10) - 1] || null;
    const lk = k.toLowerCase();
    return S.inputs.find((i) => (i.title || '').toLowerCase() === lk) || S.inputs.find((i) => (i.title || '').toLowerCase().startsWith(lk)) || null;
  };
  KM.inputNum = (inp) => KM.state.inputs.indexOf(inp) + 1;

  // perubahan state → UI & remote (debounce)
  let changeTimer = null;
  KM.changed = (what) => {
    KM.emit('change', what);
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => KM.emit('change-debounced', what), 60);
  };

  // ---------- toast / notifikasi ----------
  KM.toast = (msg, type = 'info', ms = 2600) => {
    let box = document.getElementById('toasts');
    if (!box) { box = KM.h('div#toasts'); document.body.appendChild(box); }
    const t = KM.h('div.toast.' + type, msg);
    box.appendChild(t);
    setTimeout(() => { t.classList.add('hide'); setTimeout(() => t.remove(), 400); }, ms);
  };

  // ---------- file helper (Electron / browser) ----------
  KM.fileUrl = (p) => '/localfile?p=' + encodeURIComponent(p);
  KM.pickFiles = (accept, multiple) => new Promise((resolve) => {
    const inp = KM.h('input', { type: 'file', accept: accept || '', multiple: !!multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => {
      const files = Array.from(inp.files || []).map((f) => ({ file: f, name: f.name, path: KM.isElectron ? window.klm.pathOf(f) : '', url: '' }));
      files.forEach((f) => { f.url = f.path ? KM.fileUrl(f.path) : URL.createObjectURL(f.file); });
      inp.remove(); resolve(files);
    });
    document.body.appendChild(inp); inp.click();
    setTimeout(() => { if (document.body.contains(inp)) { /* biarkan */ } }, 60000);
  });
  KM.downloadBlob = (blob, name) => {
    const a = KM.h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  };
  KM.defaultFolder = async (kind) => {
    if (!KM.isElectron) return '';
    if (!KM._appInfo) KM._appInfo = await window.klm.invoke('app:info');
    if (kind === 'rec') return KM.settings.recFolder || (KM._appInfo.videos + '\\KLM Mix');
    if (kind === 'snap') return KM.settings.snapFolder || (KM._appInfo.pictures + '\\KLM Mix');
    return KM._appInfo.documents + '\\KLM Mix';
  };
  KM.joinPath = (a, b) => (a.endsWith('\\') || a.endsWith('/') ? a + b : a + (a.includes('\\') ? '\\' : '/') + b);
})(window.KM);
