/* KLM Mix Remote - kontrol switcher dari HP */
'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let S = null, thumbs = {}, mode = 'pvw', tab = 'input', seq = 1, titleId = KMP.get('rtitle', null), titleCh = 0;
  const TR = { fade: 'Fade', merge: 'Merge', wipe: 'Wipe', wipeup: 'Wipe ↑', slide: 'Slide', slideup: 'Slide ↑', fly: 'Fly', zoom: 'Zoom', crosszoom: 'XZoom', circle: 'Iris', barn: 'Barn', cube: 'Cube', dip: 'Dip', dipwhite: 'Dip Putih', blur: 'Blur' };

  function fn(name, params) { conn.send({ t: 'fn', fn: name, params: params || {}, reqId: 'm' + (seq++) }); }

  const conn = KMP.connect('remote', () => ({ name: KMP.deviceName() }), {
    status(s) {
      const el = $('status');
      const m = { open: ['Terhubung', 'ok'], connecting: ['Menyambung…', 'warn'], closed: ['Terputus', 'red'], noserver: ['Isi IP PC', 'warn'] }[s] || [s, ''];
      el.textContent = m[0]; el.className = 'pill st ' + m[1];
      if (s === 'noserver') location.href = KMP.page('hp');
      if (s === 'open') { conn.send({ t: 'get-state' }); sub(); }
    },
    message(m) {
      if (m.t === 'state') { S = m.state; render(); }
      else if (m.t === 'thumbs') { $('pvwImg').src = m.preview; $('pgmImg').src = m.program; }
      else if (m.t === 'input-thumbs') { Object.assign(thumbs, m.thumbs); updateThumbs(); }
      else if (m.t === 'fn-res' && !m.ok) KMP.toast('⚠ ' + (m.msg || 'Gagal'));
      else if (m.t === 'mixer-gone') KMP.toast('Mixer di PC ditutup');
    }
  });

  // ---------- tombol umum ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fn]');
    if (b) { const v = b.dataset.val; fn(b.dataset.fn, v != null ? { Value: v } : {}); try { navigator.vibrate && navigator.vibrate(15); } catch (x) {} }
    const t = e.target.closest('nav button');
    if (t) setTab(t.dataset.tab);
  });
  // beri tahu PC gambar apa yang dibutuhkan (hemat data & baterai)
  let saver = KMP.get('saver', false);
  function sub() {
    if (!conn || !conn.open) return;
    const vis = document.visibilityState === 'visible';
    conn.send({ t: 'sub', mon: vis && !saver, inputs: vis && !saver && tab === 'input', rate: saver ? 1500 : 400 });
  }
  document.addEventListener('visibilitychange', sub);
  function setTab(n) {
    tab = n; setTimeout(sub, 0);
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === n));
    document.querySelectorAll('.sec').forEach((s) => s.classList.toggle('show', s.id === 's-' + n));
    render(true);
  }
  $('home').onclick = () => { location.href = KMP.page('hp'); };
  const sv = $('saver'); sv.classList.toggle('on', saver);
  sv.onclick = () => { saver = !saver; KMP.set('saver', saver); sv.classList.toggle('on', saver); sub(); KMP.toast(saver ? 'Hemat data ON — gambar preview dimatikan' : 'Hemat data OFF'); };
  const modes = { mPvw: 'pvw', mCut: 'cut', mQp: 'qp' };
  Object.keys(modes).forEach((id) => { $(id).onclick = () => { mode = modes[id]; Object.keys(modes).forEach((x) => $(x).classList.toggle('on', x === id)); }; });
  const tb = $('tbar');
  tb.addEventListener('input', () => fn('SetFader', { Value: tb.value }));
  tb.addEventListener('change', () => { setTimeout(() => { tb.value = 0; }, 300); });

  // ---------- render ----------
  function render(force) {
    if (!S) return;
    const tr = S.transitions || [];
    ['t1', 't2', 't3', 't4'].forEach((id, i) => { if ($(id) && tr[i]) $(id).textContent = TR[tr[i].type] || tr[i].type; });
    $('ftb').classList.toggle('red', !!S.ftb);
    if (tab === 'input') renderInputs();
    if (tab === 'overlay') renderOverlays();
    if (tab === 'title') { renderUtc(); renderTitle(force); }
    if (tab === 'audio') renderAudio(force);
    if (tab === 'more') renderMore();
  }
  function renderInputs() {
    const box = $('inputs');
    const sig = S.inputs.map((i) => i.id + i.title + i.tally + i.playing).join('|') + S.previewId + S.programId;
    if (box._sig === sig) return; box._sig = sig;
    box.innerHTML = S.inputs.map((i) => `<button class="inp ${i.tally}" data-id="${i.id}"><div class="th" style="background-image:url('${thumbs[i.id] || ''}')"><span class="n">${i.num}</span></div><div class="t">${esc(i.title)}${i.playable ? (i.playing ? ' ▶' : ' ⏸') : ''}${i.cam ? (i.cam.online ? ' 🟢' : ' ⚪') : ''}</div></button>`).join('');
    box.querySelectorAll('.inp').forEach((b) => {
      b.onclick = () => { const id = b.dataset.id; fn(mode === 'cut' ? 'CutDirect' : mode === 'qp' ? 'QuickPlay' : 'PreviewInput', { Input: id }); try { navigator.vibrate && navigator.vibrate(15); } catch (x) {} };
      let t; b.addEventListener('touchstart', () => { t = setTimeout(() => { const i = S.inputs.find((x) => x.id === b.dataset.id); if (i && i.playable) { fn('PlayPause', { Input: i.id }); KMP.toast('Play/Pause ' + i.title); } }, 650); }, { passive: true });
      b.addEventListener('touchend', () => clearTimeout(t));
    });
  }
  function updateThumbs() { document.querySelectorAll('.inp').forEach((b) => { const th = thumbs[b.dataset.id]; if (th) b.querySelector('.th').style.backgroundImage = `url('${th}')`; }); }
  function renderOverlays() {
    const box = $('ovls');
    const opts = (sel) => '<option value="">— pilih input —</option>' + S.inputs.map((i) => `<option value="${i.id}" ${i.id === sel ? 'selected' : ''}>${i.num}. ${esc(i.title)}</option>`).join('');
    box.innerHTML = S.overlays.map((o, n) => `<div class="ovr"><b>${n + 1}</b><select data-n="${n}">${opts(o.inputId || S.previewId)}</select><button class="${o.on ? 'on' : ''}" data-ovb="${n}">${o.on ? 'ON' : 'OFF'}</button></div>`).join('');
    box.querySelectorAll('[data-ovb]').forEach((b) => b.onclick = () => {
      const n = +b.dataset.ovb, o = S.overlays[n], sel = box.querySelector(`select[data-n="${n}"]`).value;
      if (o.on) fn('OverlayInput' + (n + 1) + 'Out'); else if (sel) fn('OverlayInput' + (n + 1) + 'In', { Input: sel }); else KMP.toast('Pilih input');
    });
  }
  // ---------- UTC KLM Acara (grafis acara asli) ----------
  function renderUtc() {
    const box = $('utcBox'), u = S.utc;
    const sig = JSON.stringify(u);
    if (box._sig === sig) return; box._sig = sig;
    const vis = (u && u.visible) || {};
    const names = [['lt', 'Lower Third'], ['tt', 'Title'], ['tk', 'Running Text'], ['bug', 'Logo'], ['loc', 'Lokasi'], ['soc', 'Sosmed']];
    const url = KMP.page('utc');
    box.innerHTML = `<div class="card"><div class="row" style="align-items:center"><b style="flex:1">🎬 UTC KLM Acara</b><span class="pill ${u && u.onAir ? 'ok' : 'warn'}" style="flex:none">${u && u.onAir ? 'ON AIR' : 'OFF'}</span></div>
      <p class="muted" style="margin:6px 0 8px">${u ? esc(u.eventName || '') : 'Menunggu PC…'}</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">${names.map(([k, l]) => `<button data-utc="${k}" style="padding:8px 4px;font-size:13px;${vis[k] ? 'background:linear-gradient(180deg,#5a2e09,#3f2007);border-color:var(--utc);color:#fff' : ''}">${l}</button>`).join('')}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:6px"><button data-uf="UTCPrevious">◀ LT</button><button data-uf="UTCNext">LT ▶</button><button data-uf="UTCHideAll" class="red">⛔ OFF</button><button data-uf="UTCOpening" style="grid-column:span 1">Opening</button><button data-uf="UTCClosing">🌙 Closing</button><button data-uf="UTCOpeningClosingOff">✕ Stop</button></div>
      <a href="${url}" style="display:block;margin-top:10px"><button class="pri" style="width:100%">Buka Panel Lengkap UTC KLM Acara</button></a></div>`;
    box.querySelectorAll('[data-utc]').forEach((b) => { b.onclick = () => fn('UTCToggle', { Value: b.dataset.utc }); });
    box.querySelectorAll('[data-uf]').forEach((b) => { b.onclick = () => fn(b.dataset.uf, { Value: 'lt' }); });
  }
  function renderTitle(force) {
    const box = $('titleBox');
    const titles = S.inputs.filter((i) => i.title_);
    if (!titles.length) { box.innerHTML = '<div class="card"><p class="muted">Title Cepat (kanvas): belum ada.</p><button id="addT" style="width:100%">＋ Tambah Title Cepat</button></div>'; $('addT').onclick = () => fn('AddInput', { Value: 'title|lt-klasik' }); return; }
    let t = titles.find((x) => x.id === titleId) || titles[0]; titleId = t.id;
    const active = document.activeElement && box.contains(document.activeElement) && document.activeElement.dataset.k;
    const sig = t.id + t.title_.template + titles.length;
    if (!force && box._sig === sig && active) { // jangan ganggu yang sedang mengetik
      box.querySelectorAll('[data-k]').forEach((el) => { if (el !== document.activeElement) el.value = t.title_.fields[el.dataset.k] || ''; });
      updOnAir(t); return;
    }
    box._sig = sig;
    const ov = S.overlays.findIndex((o) => o.on && o.inputId === t.id);
    box.innerHTML = `<label>Title</label><select id="tSel">${titles.map((x) => `<option value="${x.id}" ${x.id === t.id ? 'selected' : ''}>${x.num}. ${esc(x.title)}</option>`).join('')}</select>
      <div class="card"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><select id="tCh" style="grid-column:1/-1">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${n === titleCh ? 'selected' : ''}>Overlay ${n + 1}</option>`).join('')}</select>
      <button class="green" id="tIn">▶ TAMPIL</button><button class="red" id="tOut">■ SEMBUNYI</button></div>
      <p style="margin:8px 0 0">Status: <span class="pill" id="tAir"></span></p></div>
      <div class="card">${t.title_.defs.map((d) => `<label>${esc(d.label)}</label>${d.multi ? `<textarea rows="2" data-k="${d.k}" ${d.k === 'arab' ? 'dir="rtl"' : ''}>${esc(t.title_.fields[d.k])}</textarea>` : `<input data-k="${d.k}" value="${esc(t.title_.fields[d.k])}">`}`).join('')}
      ${t.title_.template === 'countdown' ? '<div class="row" style="margin-top:10px"><button data-cd="StartCountdown">▶ Mulai</button><button data-cd="PauseCountdown">⏸</button><button data-cd="StopCountdown">↺</button></div>' : ''}</div>
      ${t.title_.listLen ? `<div class="card"><p class="muted" style="margin:0 0 8px">Antrian: ${t.title_.listIdx + 1} / ${t.title_.listLen}</p><div class="row"><button id="tPrev">⏮ Sebelumnya</button><button class="pri" id="tNext">Berikutnya ⏭</button></div></div>` : ''}`;
    $('tSel').onchange = (e) => { titleId = e.target.value; KMP.set('rtitle', titleId); renderTitle(true); };
    $('tCh').onchange = (e) => { titleCh = +e.target.value; };
    $('tIn').onclick = () => fn('OverlayInput' + (titleCh + 1) + 'In', { Input: t.id });
    $('tOut').onclick = () => { const o = S.overlays.findIndex((x) => x.on && x.inputId === t.id); fn('OverlayInput' + ((o >= 0 ? o : titleCh) + 1) + 'Out'); };
    if ($('tNext')) { $('tNext').onclick = () => fn('TitleNext', { Input: t.id }); $('tPrev').onclick = () => fn('TitlePrevious', { Input: t.id }); }
    box.querySelectorAll('[data-cd]').forEach((b) => b.onclick = () => fn(b.dataset.cd, { Input: t.id }));
    box.querySelectorAll('[data-k]').forEach((el) => {
      let tm; el.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => fn('SetText', { Input: t.id, SelectedName: el.dataset.k, Value: el.value }), 250); });
    });
    if (ov >= 0) titleCh = ov;
    updOnAir(t);
  }
  function updOnAir(t) {
    const el = $('tAir'); if (!el) return;
    const on = S.overlays.some((o) => o.on && o.inputId === t.id);
    el.textContent = on ? '● ON AIR' : 'tidak tampil'; el.className = 'pill ' + (on ? 'red' : '');
  }
  function renderAudio(force) {
    const box = $('audioBox');
    const list = S.inputs.filter((i) => i.audio);
    const sig = list.map((i) => i.id + i.audio.mute + i.audio.auto).join('|') + (S.master && S.master.mute);
    if (!force && box._sig === sig) return; box._sig = sig;
    const row = (name, vol, mute, fv, fm, extra) => `<div class="fader"><div><div class="nm">${esc(name)}</div><input type="range" min="0" max="100" value="${vol}" data-vol="${fv}"></div><button class="${mute ? 'on' : ''}" data-mute="${fm}">${mute ? '🔇' : '🔊'}</button>${extra || ''}</div>`;
    let html = S.master ? row('MASTER', S.master.vol, S.master.mute, 'master', 'master') : '';
    html += list.map((i) => row(i.num + '. ' + i.title + (i.audio.auto ? ' (Auto)' : ''), i.audio.vol, i.audio.mute, i.id, i.id)).join('');
    box.innerHTML = html || '<p class="muted">Tidak ada input audio.</p>';
    box.querySelectorAll('[data-vol]').forEach((r) => {
      let tm; r.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { const k = r.dataset.vol; k === 'master' ? fn('SetMasterVolume', { Value: r.value }) : fn('SetVolume', { Input: k, Value: r.value }); }, 60); });
    });
    box.querySelectorAll('[data-mute]').forEach((b) => b.onclick = () => { const k = b.dataset.mute; k === 'master' ? fn('MasterAudio') : fn('Audio', { Input: k }); });
  }
  function renderMore() {
    $('aRec').classList.toggle('live', !!S.rec); $('aRec').textContent = S.rec ? '■ Stop Rekam' : '● Rekam';
    $('aStream').classList.toggle('live', !!S.stream); $('aStream').textContent = S.stream ? '■ Stop Live' : '📡 Mulai Live';
    if ($('aSrt')) { $('aSrt').classList.toggle('live', S.srt === 'live'); $('aSrt').textContent = S.srt ? (S.srt === 'live' ? '■ Stop SRT' : '⟳ SRT menyambung…') : '📺 SRT ke TV'; }
    $('aMc').classList.toggle('live', !!S.mc);
    const rb = $('aRpBuf'); rb.dataset.fn = S.replay.enabled ? 'ReplayStopRecording' : 'ReplayStartRecording'; rb.textContent = S.replay.enabled ? '■ Buffer OFF' : '● Buffer ON'; rb.classList.toggle('live', S.replay.enabled);
    $('aPl').classList.toggle('live', S.playlist.running);
  }
  if (location.hash) setTab(location.hash.slice(1));
  KMP.wakeLock();
})();
