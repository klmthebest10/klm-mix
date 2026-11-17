/* KLM Mix — jembatan untuk panel UTC Acara & UTC Score
 * Menampilkan fitur KLM Mix langsung di dalam aplikasi UTC (di KLM Mix, jendela terpisah, atau HP):
 *   status Program / Preview, ON AIR grafis ini di Program, CUT / AUTO, REC / LIVE / SRT,
 *   monitor Program mini (di jendela terpisah / HP), tambah input bila belum ada.
 * Dipasang oleh: src/utc/control.html (UTC Acara) & electron/score.js (UTC Score, port sendiri).
 */
(function () {
  'use strict';
  if (window.__klmBridge) return; window.__klmBridge = true;
  const CFG = window.KLM_MIX || {};
  const APP = CFG.app === 'score' ? 'score' : 'acara';
  const BASE = CFG.port && String(CFG.port) !== location.port ? (location.protocol === 'https:' ? 'https:' : 'http:') + '//' + location.hostname + ':' + (location.protocol === 'https:' && CFG.httpsPort ? CFG.httpsPort : CFG.port) : '';
  let embedded = false;
  try { embedded = window.parent !== window; } catch (e) { embedded = true; }
  const NAME = APP === 'score' ? 'UTC Score' : 'UTC Acara';
  const KEY = 'klmbridge.open.' + APP;
  let open = false; try { open = localStorage.getItem(KEY) === '1'; } catch (e) {}
  let st = null, ok = false, busy = false, timer = 0, frameT = 0;

  const css = `
  #klmb{position:fixed;right:14px;bottom:14px;z-index:2147483000;font:600 12.5px/1.35 'Plus Jakarta Sans','Segoe UI',system-ui,sans-serif;color:#eceff4;-webkit-font-smoothing:antialiased}
  #klmb *{box-sizing:border-box}
  #klmb .pill{display:flex;align-items:center;gap:8px;height:34px;padding:0 12px 0 10px;border-radius:999px;background:rgba(15,17,21,.94);border:1px solid #323946;box-shadow:0 8px 28px rgba(0,0,0,.45);cursor:pointer;user-select:none;backdrop-filter:blur(8px)}
  #klmb .pill:hover{border-color:#4a5466}
  #klmb .lg{width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,#ff4b3e,#ffb11f);display:grid;place-items:center;font-size:10px;font-weight:900;color:#fff;flex:none}
  #klmb .dot{width:8px;height:8px;border-radius:50%;background:#59606d;flex:none}
  #klmb .dot.on{background:#f2453d;box-shadow:0 0 8px #f2453d}
  #klmb .dot.ok{background:#1ec26b}
  #klmb .card{position:absolute;right:0;bottom:44px;width:min(340px,calc(100vw - 28px));background:rgba(20,23,28,.97);border:1px solid #2f3541;border-radius:12px;box-shadow:0 14px 44px rgba(0,0,0,.55);padding:12px;display:none}
  #klmb.open .card{display:block}
  #klmb h5{margin:0 0 8px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:#8790a0;display:flex;align-items:center;gap:6px}
  #klmb .mon{position:relative;aspect-ratio:16/9;background:#000;border-radius:8px;overflow:hidden;margin-bottom:8px;border:1px solid #2a303a}
  #klmb .mon img{width:100%;height:100%;object-fit:contain;display:block}
  #klmb .mon span{position:absolute;left:6px;top:6px;background:#d93a33;color:#fff;font-size:10px;font-weight:800;padding:2px 6px;border-radius:4px;letter-spacing:.8px}
  #klmb .kv{display:grid;grid-template-columns:62px 1fr;gap:3px 8px;margin-bottom:10px;font-size:12px}
  #klmb .kv b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #klmb .kv .p{color:#ff9f99}#klmb .kv .v{color:#7ce8ab}
  #klmb .row{display:flex;gap:6px;margin-top:6px}
  #klmb button{flex:1;height:34px;border-radius:8px;border:1px solid #323946;background:#20252d;color:#eceff4;font:inherit;font-weight:800;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 8px;white-space:nowrap}
  #klmb button:hover{background:#2a303a;border-color:#4a5466}
  #klmb button.air.on{background:linear-gradient(180deg,#e07a17,#b85f0d);border-color:#f59e3a;color:#fff}
  #klmb button.cut{background:#3a1517;border-color:#7a2a2a;color:#ffd6d3}
  #klmb button.auto{background:#13341f;border-color:#1f6b3e;color:#c9f7da}
  #klmb button.on.rec,#klmb button.on.live{background:#d93a33;border-color:#ff6a62;color:#fff}
  #klmb button:disabled{opacity:.45;cursor:default}
  #klmb .tags{display:flex;gap:5px;flex-wrap:wrap}
  #klmb .tag{font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:5px;background:#20252d;color:#a7afbd;border:1px solid #2f3541}
  #klmb .tag.on{background:#d93a33;color:#fff;border-color:#ff6a62}
  #klmb .muted{color:#8790a0;font-size:11.5px;margin:6px 0 0}
  @media (max-width:520px){#klmb{right:8px;bottom:8px}}`;
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const k in attrs || {}) { if (k === 'class') n.className = attrs[k]; else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]); else n.setAttribute(k, attrs[k]); }
    kids.flat().forEach((c) => c != null && n.append(c.nodeType ? c : document.createTextNode(String(c))));
    return n;
  };
  function mount() {
    if (document.getElementById('klmb')) return;
    document.head.append(el('style', {}, css));
    const root = el('div', { id: 'klmb', class: open ? 'open' : '' });
    root.append(el('div', { class: 'card' }), el('div', { class: 'pill', title: 'Fitur KLM Mix untuk ' + NAME, onclick: () => { open = !open; root.classList.toggle('open', open); try { localStorage.setItem(KEY, open ? '1' : '0'); } catch (e) {} draw(); poll(); } },
      el('span', { class: 'lg' }, 'K'), el('span', { class: 'dot', id: 'klmbDot' }), el('span', { id: 'klmbTxt' }, 'KLM Mix')));
    document.body.append(root);
    draw(); poll();
  }
  const api = (fn, v) => fetch(BASE + '/api/?Function=' + encodeURIComponent(fn) + (v != null ? '&Value=' + encodeURIComponent(v) : ''), { mode: 'cors' }).then((r) => r.text()).catch(() => '');
  async function act(fn, v) { if (busy) return; busy = true; try { await api(fn, v); } finally { busy = false; setTimeout(poll, 150); } }
  function poll() {
    clearTimeout(timer);
    fetch(BASE + '/api/state', { mode: 'cors', cache: 'no-store' }).then((r) => r.json()).then((j) => { st = j && j.state ? j.state : (j && j.inputs ? j : null); ok = !!st; draw(); })
      .catch(() => { ok = false; draw(); })
      .finally(() => { timer = setTimeout(poll, open ? 1000 : 3000); });
  }
  const nameOf = (id) => { const i = st && st.inputs && st.inputs.find((x) => x.id === id); return i ? i.num + '. ' + i.title : '—'; };
  function draw() {
    const root = document.getElementById('klmb'); if (!root) return;
    const me = st ? (APP === 'score' ? st.score : st.utc) : null;
    const has = !!(me && me.has), onAir = !!(me && me.onAir);
    const dot = document.getElementById('klmbDot'), txt = document.getElementById('klmbTxt');
    dot.className = 'dot' + (!ok ? '' : has && onAir ? ' on' : ' ok');
    txt.textContent = !ok ? 'KLM Mix — tidak terhubung' : !has ? 'KLM Mix — ' + NAME + ' belum jadi input' : 'KLM Mix — ' + (onAir ? 'ON AIR' : 'tidak tayang') + (st.rec ? ' • REC' : '') + (st.stream ? ' • LIVE' : '');
    const card = root.querySelector('.card');
    if (!open) { card.replaceChildren(); stopFrame(); return; }
    if (!ok) { card.replaceChildren(el('h5', {}, 'KLM Mix'), el('p', { class: 'muted' }, 'Tidak terhubung ke KLM Mix. Pastikan aplikasi KLM Mix terbuka di PC.')); stopFrame(); return; }
    const kids = [el('h5', {}, 'KLM Mix', el('span', { style: 'margin-left:auto' }, (st.res || '') + (st.fps ? ' • ' + st.fps + ' fps' : '')))];
    if (!embedded) { kids.push(el('div', { class: 'mon' }, el('img', { id: 'klmbImg', alt: '' }), el('span', {}, 'PROGRAM'))); }
    kids.push(el('div', { class: 'kv' }, el('span', {}, 'Program'), el('b', { class: 'p' }, nameOf(st.programId)), el('span', {}, 'Preview'), el('b', { class: 'v' }, nameOf(st.previewId))));
    if (has) kids.push(el('div', { class: 'row' }, el('button', { class: 'air' + (onAir ? ' on' : ''), title: 'Tampilkan / sembunyikan ' + NAME + ' di atas Program KLM Mix', onclick: () => act(APP === 'score' ? 'ScoreOnAir' : 'UTCOnAir') }, (onAir ? '● ' : '○ ') + NAME + (onAir ? ' ON AIR' : ' — tayangkan'))));
    else kids.push(el('div', { class: 'row' }, el('button', { class: 'air', onclick: () => act(APP === 'score' ? 'ScoreAddInput' : 'UTCAddInput') }, '+ Jadikan input KLM Mix')), el('p', { class: 'muted' }, NAME + ' baru tayang di KLM Mix setelah ditambahkan sebagai input.'));
    kids.push(el('div', { class: 'row' },
      el('button', { class: 'cut', title: 'Cut Preview ↔ Program', onclick: () => act('Cut') }, 'CUT'),
      el('button', { class: 'auto', title: 'Transisi 1 (AUTO)', onclick: () => act('Transition1') }, 'AUTO'),
      el('button', { title: 'Fade To Black', onclick: () => act('FadeToBlack') }, 'FTB')));
    kids.push(el('div', { class: 'row' },
      el('button', { class: 'rec' + (st.rec ? ' on' : ''), onclick: () => act('StartStopRecording') }, st.rec ? '■ Stop rekam' : '● Rekam'),
      el('button', { class: 'live' + (st.stream ? ' on' : ''), onclick: () => act('StartStopStreaming') }, st.stream ? '■ Stop live' : '● Live')));
    const tags = el('div', { class: 'tags', style: 'margin-top:8px' });
    (st.overlays || []).forEach((o, i) => tags.append(el('span', { class: 'tag' + (o.on ? ' on' : '') }, 'OVL ' + (i + 1))));
    if (st.srt) tags.append(el('span', { class: 'tag on' }, 'SRT'));
    if (st.ftb) tags.append(el('span', { class: 'tag on' }, 'FTB'));
    kids.push(tags);
    card.replaceChildren(...kids);
    if (!embedded) startFrame();
  }
  function startFrame() {
    if (frameT) return;
    const tick = () => {
      const img = document.getElementById('klmbImg');
      if (!img || !open || document.hidden) { frameT = 0; return; }
      const n = new Image();
      n.onload = () => { const i = document.getElementById('klmbImg'); if (i) i.src = n.src; frameT = setTimeout(tick, 500); };
      n.onerror = () => { frameT = setTimeout(tick, 1500); };
      n.src = BASE + '/utc/api/sw/frame/pgm?since=0&t=' + Date.now();
    };
    frameT = setTimeout(tick, 50);
  }
  function stopFrame() { clearTimeout(frameT); frameT = 0; }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && open) { draw(); poll(); } });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
