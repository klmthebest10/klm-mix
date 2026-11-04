/* KLM Mix - Skrip (JavaScript, pengganti VB.NET vMix), Trigger per input, dan Shortcut kustom */
'use strict';
(function (KM) {
  const S = KM.state;
  const SC = KM.script = { running: new Map() };

  /** "Input=2&Duration=500" atau {Input:2} → objek */
  function params(p) {
    if (!p) return {};
    if (typeof p === 'object') return p;
    const o = {}; new URLSearchParams(String(p)).forEach((v, k) => { o[k] = v; }); return o;
  }
  SC.params = params;

  SC.list = () => KM.settings.scripts || (KM.settings.scripts = []);
  SC.get = (key) => SC.list().find((s) => s.id === key || s.name.toLowerCase() === String(key).toLowerCase());

  const SAMPLE = `// Contoh skrip KLM Mix (JavaScript)
// API.Function(nama, parameter) — nama fungsi sama dengan vMix
// Sleep(ms) menunggu, Input(n) info input, Log(teks) catatan
API.Function("PreviewInput", "Input=1");
await Sleep(500);
API.Function("Fade", "Duration=800");
await Sleep(3000);
API.Function("OverlayInput1In", "Input=2");
await Sleep(5000);
API.Function("OverlayInput1Out");
Log("Selesai");`;
  SC.sample = SAMPLE;

  SC.run = function (key) {
    const s = SC.get(key);
    if (!s) { KM.toast('Skrip tidak ditemukan: ' + key, 'warn'); return false; }
    if (SC.running.has(s.id)) return true;
    const ctl = { stop: false };
    const Sleep = (ms) => new Promise((res, rej) => { const t = setTimeout(() => (ctl.stop ? rej(new Error('stop')) : res()), +ms || 0); ctl.t = t; });
    const API = {
      Function: (name, p) => { if (ctl.stop) throw new Error('stop'); return KM.api.exec(name, params(p)); },
      XML: () => KM.api.xml(),
      State: () => KM.link.snapState()
    };
    const Input = (k) => {
      const i = KM.getInput(k); if (!i) return null;
      const m = KM.inputs.media(i);
      return { id: i.id, number: KM.inputNum(i), title: i.title, type: i.type, playing: KM.inputs.isPlaying(i), position: m && m.currentTime ? m.currentTime * 1000 : 0, duration: m && isFinite(m.duration) ? m.duration * 1000 : 0, tally: KM.engine.tallyOf(i), fields: i.type === 'title' ? KM.titles.fields(i) : null };
    };
    const Log = (...a) => { s.log = ((s.log || '') + a.join(' ') + '\n').slice(-3000); KM.emit('script-log', s); };
    let fn;
    try { fn = new (Object.getPrototypeOf(async function () {}).constructor)('API', 'Sleep', 'Input', 'Log', 'Stopped', 'State', s.code); }
    catch (e) { KM.toast('Skrip "' + s.name + '" error: ' + e.message, 'err', 6000); return false; }
    SC.running.set(s.id, ctl); KM.changed('script');
    fn(API, Sleep, Input, Log, () => ctl.stop, S)
      .catch((e) => { if (e.message !== 'stop') { Log('ERROR: ' + e.message); KM.toast('Skrip "' + s.name + '": ' + e.message, 'err', 6000); } })
      .finally(() => { SC.running.delete(s.id); KM.changed('script'); });
    return true;
  };
  SC.stop = function (key) {
    const s = SC.get(key); if (!s) return false;
    const c = SC.running.get(s.id); if (c) { c.stop = true; clearTimeout(c.t); }
    return true;
  };
  SC.stopAll = () => { for (const [, c] of SC.running) { c.stop = true; clearTimeout(c.t); } };

  // ---------- Trigger per input ----------
  // inp.triggers = [{ on: 'TransitionIn'|'TransitionOut'|'Completion', fn: 'OverlayInput1In', params: 'Input=3' }]
  SC.EVENTS = { TransitionIn: 'Saat masuk Program', TransitionOut: 'Saat keluar Program', Completion: 'Saat video selesai', PreviewIn: 'Saat masuk Preview' };
  function fire(inp, ev) {
    (inp.triggers || []).forEach((t) => {
      if (t.on !== ev || !t.fn) return;
      setTimeout(() => KM.api.exec(t.fn, Object.assign({ Input: inp.id }, params(t.params))).catch((e) => KM.toast('Trigger: ' + e.message, 'warn')), +t.delay || 0);
    });
  }
  KM.on('input-live', ({ inp, live }) => fire(inp, live ? 'TransitionIn' : 'TransitionOut'));
  KM.on('input-ended', (inp) => fire(inp, 'Completion'));
  let lastPv = null;
  KM.on('change', (w) => { if (w === 'preview' || w === 'program') { if (S.previewId !== lastPv) { lastPv = S.previewId; const i = KM.getInput(lastPv); if (i) fire(i, 'PreviewIn'); } } });

  // ---------- Shortcut kustom ----------
  // KM.settings.shortcuts = [{ key: 'Ctrl+1', fn: 'OverlayInput1', params: 'Input=3' }]
  SC.combo = (e) => {
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    return (e.ctrlKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey && e.key.length > 1 ? 'Shift+' : '') + (k === ' ' ? 'Space' : k);
  };
  SC.handleKey = function (e) {
    const list = KM.settings.shortcuts || []; if (!list.length) return false;
    const c = SC.combo(e);
    const hit = list.filter((s) => s.key === c && s.fn); if (!hit.length) return false;
    e.preventDefault();
    hit.forEach((s) => KM.api.exec(s.fn, params(s.params)).catch((x) => KM.toast(x.message, 'warn')));
    return true;
  };
})(window.KM);
