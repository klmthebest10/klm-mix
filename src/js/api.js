/* KLM Mix - API fungsi (nama kompatibel vMix) untuk HTTP /api, TCP, remote HP, shortcut & Stream Deck/Companion */
'use strict';
(function (KM) {
  const S = KM.state;
  const E = () => KM.engine;

  const num = (v, d) => (v == null || v === '' || isNaN(+v) ? d : +v);
  function rel(cur, v, min, max) {
    v = String(v == null ? '' : v).trim();
    let out = cur;
    if (v.startsWith('+=')) out = cur + num(v.slice(2), 0);
    else if (v.startsWith('-=')) out = cur - num(v.slice(2), 0);
    else out = num(v, cur);
    return KM.clamp(out, min, max);
  }
  function inp(p, fallbackPreview) {
    const key = p.Input != null ? p.Input : (p.input != null ? p.input : null);
    if (key == null || key === '') return fallbackPreview === 'program' ? KM.getInput(S.programId) : fallbackPreview ? KM.getInput(S.previewId) : null;
    return KM.getInput(key);
  }
  const need = (i) => { if (!i) throw new Error('Input tidak ditemukan'); return i; };
  const bool = (v) => /^(1|true|on|ya|yes)$/i.test(String(v));

  const trFn = (type) => (p) => E().transition(type, num(p.Duration, defDur(type)), p.Input || undefined);
  function defDur(type) { const t = KM.settings.transitions.find((x) => x.type === type); return t ? t.dur : 500; }

  const F = {
    // ---- transisi ----
    Cut: (p) => E().cut(p.Input || undefined),
    CutDirect: (p) => E().cut(need(inp(p)).id),
    ActiveInput: (p) => E().cut(need(inp(p)).id),
    Fade: trFn('fade'), Merge: trFn('merge'), Wipe: trFn('wipe'), Slide: trFn('slide'), Fly: trFn('fly'), Zoom: trFn('zoom'),
    CrossZoom: trFn('crosszoom'), Circle: trFn('circle'), BarnDoor: trFn('barn'), CubeZoom: trFn('cube'), Cube: trFn('cube'),
    FadeToBlackTransition: trFn('dip'), Dip: trFn('dip'), Blur: trFn('blur'), VerticalWipe: trFn('wipeup'), VerticalSlide: trFn('slideup'),
    Stinger1: (p) => E().transition('stinger1', 0, p.Input || undefined),
    Stinger2: (p) => E().transition('stinger2', 0, p.Input || undefined),
    Transition1: (p) => slot(0, p), Transition2: (p) => slot(1, p), Transition3: (p) => slot(2, p), Transition4: (p) => slot(3, p),
    QuickPlay: (p) => E().quickPlay(need(inp(p)).id),
    SetFader: (p) => { E().setTbar(num(p.Value, 0) / 255); return true; },
    SetTransitionEffect1: (p) => setTr(0, 'type', p.Value), SetTransitionEffect2: (p) => setTr(1, 'type', p.Value),
    SetTransitionEffect3: (p) => setTr(2, 'type', p.Value), SetTransitionEffect4: (p) => setTr(3, 'type', p.Value),
    SetTransitionDuration1: (p) => setTr(0, 'dur', +p.Value), SetTransitionDuration2: (p) => setTr(1, 'dur', +p.Value),
    SetTransitionDuration3: (p) => setTr(2, 'dur', +p.Value), SetTransitionDuration4: (p) => setTr(3, 'dur', +p.Value),
    FadeToBlack: () => { E().ftb(); return true; },
    FadeToBlackOn: () => { E().ftb(true); return true; }, FadeToBlackOff: () => { E().ftb(false); return true; },

    // ---- preview ----
    PreviewInput: (p) => E().setPreview(need(inp(p)).id),
    PreviewInputNext: () => { const i = S.inputs.findIndex((x) => x.id === S.previewId); const n = S.inputs[(i + 1) % S.inputs.length]; return n && E().setPreview(n.id); },
    PreviewInputPrevious: () => { const i = S.inputs.findIndex((x) => x.id === S.previewId); const n = S.inputs[(i - 1 + S.inputs.length) % S.inputs.length]; return n && E().setPreview(n.id); },

    // ---- overlay ----
    OverlayInputAllOff: () => { E().overlayAllOff(); return true; },

    // ---- playback ----
    Play: (p) => { KM.inputs.play(need(inp(p, true))); return true; },
    Pause: (p) => { KM.inputs.pause(need(inp(p, true))); return true; },
    PlayPause: (p) => { const i = need(inp(p, true)); KM.inputs.isPlaying(i) ? KM.inputs.pause(i) : KM.inputs.play(i); return true; },
    Restart: (p) => { KM.inputs.restart(need(inp(p, true))); return true; },
    Loop: (p) => { const i = need(inp(p, true)); KM.inputs.setLoop(i, !i.loop); return true; },
    LoopOn: (p) => { KM.inputs.setLoop(need(inp(p, true)), true); return true; },
    LoopOff: (p) => { KM.inputs.setLoop(need(inp(p, true)), false); return true; },
    SetPosition: (p) => { const m = KM.inputs.media(need(inp(p, true))); if (m) m.currentTime = num(p.Value, 0) / 1000; return true; },
    SetRate: (p) => { const i = need(inp(p, true)); i.opts.speed = num(p.Value, 1); const m = KM.inputs.media(i); if (m) m.playbackRate = i.opts.speed; return true; },
    NextItem: (p) => { const i = need(inp(p, true)); if (i.type === 'list') KM.inputTypes.list.next(i); return true; },
    PreviousItem: (p) => { const i = need(inp(p, true)); if (i.type === 'list') KM.inputTypes.list.prev(i); return true; },

    // ---- title UTC Acara ----
    SetText: (p) => { const i = need(inp(p)); if (i.type !== 'title') throw new Error('Bukan input title'); KM.titles.setField(i, p.SelectedName != null ? p.SelectedName : (p.SelectedIndex != null ? p.SelectedIndex : 0), p.Value || ''); return true; },
    TitleBeginAnimation: (p) => { const i = need(inp(p)); /out/i.test(p.Value) ? KM.titles.animOut(i) : KM.titles.animIn(i); return true; },
    TitleIn: (p) => { const i = need(inp(p)); KM.titles.animIn(i); return true; },
    TitleOut: (p) => { const i = need(inp(p)); KM.titles.animOut(i); return true; },
    TitleNext: (p) => { KM.titles.next(need(inp(p))); return true; },
    TitlePrevious: (p) => { KM.titles.prev(need(inp(p))); return true; },
    SelectTitlePreset: (p) => { KM.titles.applyList(need(inp(p)), num(p.Value, 0)); return true; },
    SetTitleTheme: (p) => { const i = need(inp(p)); if (KM.titles.THEMES[p.Value]) i.opts.theme = p.Value; KM.changed('title'); return true; },
    SetTitleTemplate: (p) => { const i = need(inp(p)); if (KM.titles.TPL[p.Value]) i.opts.template = p.Value; KM.changed('title'); return true; },
    StartCountdown: (p) => { KM.titles.countdown(need(inp(p)), 'start'); return true; },
    PauseCountdown: (p) => { KM.titles.countdown(need(inp(p)), 'pause'); return true; },
    StopCountdown: (p) => { KM.titles.countdown(need(inp(p)), 'reset'); return true; },

    // ---- audio ----
    SetVolume: (p) => KM.audio.set(need(inp(p, 'program')), 'vol', rel(need(inp(p, 'program')).audio.vol, p.Value, 0, 100)),
    SetGain: (p) => KM.audio.set(need(inp(p)), 'gain', rel(need(inp(p)).audio.gain, p.Value, -24, 24)),
    SetBalance: (p) => KM.audio.set(need(inp(p)), 'pan', num(p.Value, 0)),
    SetAudioDelay: (p) => KM.audio.set(need(inp(p)), 'delay', num(p.Value, 0)),
    AudioOn: (p) => KM.audio.set(need(inp(p, 'program')), 'mute', false),
    AudioOff: (p) => KM.audio.set(need(inp(p, 'program')), 'mute', true),
    Audio: (p) => KM.audio.set(need(inp(p, 'program')), 'mute', null),
    AudioAuto: (p) => { const i = need(inp(p)); return KM.audio.set(i, 'auto', !i.audio.auto); },
    AudioAutoOn: (p) => KM.audio.set(need(inp(p)), 'auto', true),
    AudioAutoOff: (p) => KM.audio.set(need(inp(p)), 'auto', false),
    Solo: (p) => { const i = need(inp(p)); return KM.audio.set(i, 'solo', !i.audio.solo); },
    SoloOn: (p) => KM.audio.set(need(inp(p)), 'solo', true), SoloOff: (p) => KM.audio.set(need(inp(p)), 'solo', false),
    AudioBus: (p) => { const i = need(inp(p)); const b = String(p.Value || 'M').toUpperCase(); return KM.audio.set(i, b, !i.audio[b]); },
    AudioBusOn: (p) => KM.audio.set(need(inp(p)), String(p.Value || 'M').toUpperCase(), true),
    AudioBusOff: (p) => KM.audio.set(need(inp(p)), String(p.Value || 'M').toUpperCase(), false),
    SetMasterVolume: (p) => { KM.audio.setBusVol('M', rel(KM.audio.master.vol, p.Value, 0, 100)); return true; },
    MasterAudio: () => { KM.audio.setBusMute('M'); return true; },
    MasterAudioON: () => { KM.audio.setBusMute('M', false); return true; },
    MasterAudioOFF: () => { KM.audio.setBusMute('M', true); return true; },
    SetBusAVolume: (p) => { KM.audio.setBusVol('A', rel(KM.audio.busA.vol, p.Value, 0, 100)); return true; },
    SetBusBVolume: (p) => { KM.audio.setBusVol('B', rel(KM.audio.busB.vol, p.Value, 0, 100)); return true; },
    BusAAudio: () => { KM.audio.setBusMute('A'); return true; },
    BusBAudio: () => { KM.audio.setBusMute('B'); return true; },

    // ---- posisi / zoom / crop ----
    SetZoom: (p) => setPos(p, 'zoom', 0, 10),
    SetPanX: (p) => setPos(p, 'x', -4, 4),
    SetPanY: (p) => setPos(p, 'y', -4, 4),
    SetRotation: (p) => setPos(p, 'rot', -360, 360),
    SetCropX1: (p) => setPos(p, 'cropL', 0, 1), SetCropX2: (p) => { const i = need(inp(p)); i.pos.cropR = KM.clamp(1 - num(p.Value, 1), 0, 1); KM.changed('input'); return true; },
    SetCropY1: (p) => setPos(p, 'cropT', 0, 1), SetCropY2: (p) => { const i = need(inp(p)); i.pos.cropB = KM.clamp(1 - num(p.Value, 1), 0, 1); KM.changed('input'); return true; },
    ResetPosition: (p) => { const i = need(inp(p)); Object.assign(i.pos, { x: 0, y: 0, zoom: 1, rot: 0, cropL: 0, cropR: 0, cropT: 0, cropB: 0 }); KM.changed('input'); return true; },
    SetColourCorrection: (p) => { const i = need(inp(p)); i.cc.on = bool(p.Value); KM.changed('input'); return true; },
    KeyOn: (p) => { const i = need(inp(p)); i.key.on = true; KM.changed('input'); return true; },
    KeyOff: (p) => { const i = need(inp(p)); i.key.on = false; KM.changed('input'); return true; },

    // ---- layer (MultiView) ----
    MultiViewOverlayOn: (p) => layer(p, true), MultiViewOverlayOff: (p) => layer(p, false), MultiViewOverlay: (p) => layer(p, null),
    SetMultiViewOverlay: (p) => { const i = need(inp(p)); const [idx, k] = String(p.Value).split(','); const l = i.layers[num(idx, 1) - 1]; const li = KM.getInput(k); if (l && li) { l.inputId = li.id; KM.changed('input'); } return true; },

    // ---- rekam / stream / output ----
    StartRecording: () => KM.rec.startRecording(), StopRecording: () => KM.rec.stopRecording(), StartStopRecording: () => KM.rec.toggleRecording(),
    StartSRT: () => KM.rec.startSrt(), StopSRT: () => KM.rec.stopSrt(), StartStopSRT: () => KM.rec.toggleSrt(),
    StartStreaming: () => KM.rec.startStreaming(), StopStreaming: () => KM.rec.stopStreaming(), StartStopStreaming: () => KM.rec.toggleStreaming(),
    StartMultiCorder: () => KM.rec.startMultiCorder(), StopMultiCorder: () => KM.rec.stopMultiCorder(), StartStopMultiCorder: () => KM.rec.toggleMultiCorder(),
    Snapshot: () => KM.rec.snapshot(), SnapshotInput: (p) => KM.rec.snapshot(need(inp(p)).id),
    StartExternal: (p) => { E().openOutput('program', num(p.Value, 1)); return true; },
    StopExternal: () => { E().closeOutputs(); return true; },
    StartStopExternal: (p) => { S.externalOn ? E().closeOutputs() : E().openOutput('program', num(p.Value, 1)); return true; },
    Fullscreen: (p) => { E().openOutput('program', num(p.Value, 1)); return true; },
    MultiviewOutput: (p) => { E().openOutput('multiview', num(p.Value, 1)); return true; },

    // ---- replay ----
    ReplayStartRecording: () => { KM.replay.setEnabled(true); return true; },
    ReplayStopRecording: () => { KM.replay.setEnabled(false); return true; },
    ReplayMark: (p) => !!KM.replay.mark(num(p.Value, 8)),
    ReplayPlay: (p) => KM.replay.play(p.Value || undefined),
    ReplayPause: () => { KM.replay.pause(); return true; },
    ReplaySetSpeed: (p) => { KM.replay.setSpeed(num(p.Value, 1)); return true; },
    ReplayPlayLastEventToOutput: () => KM.replay.playToProgram(),
    ReplayMarkAndPlay: (p) => { if (!KM.replay.mark(num(p.Value, 8))) return false; KM.replay.setSpeed(0.5); return KM.replay.playToProgram(); },

    // ---- playlist ----
    StartPlayList: () => { KM.playlist.start(); return true; }, StopPlayList: () => { KM.playlist.stop(); return true; },
    NextPlayListEntry: () => { KM.playlist.next(); return true; }, PreviousPlayListEntry: () => { KM.playlist.prev(); return true; },

    // ---- KLMCAM ----
    CamZoom: (p) => KM.link.camControl(need(inp(p)), 'zoom', num(p.Value, 1)),
    CamTorch: (p) => KM.link.camControl(need(inp(p)), 'torch', bool(p.Value)),
    CamSwitch: (p) => KM.link.camControl(need(inp(p)), 'switch', 1),
    CamFocus: (p) => KM.link.camControl(need(inp(p)), 'focus', p.Value || 'auto'),
    CamQuality: (p) => KM.link.camControl(need(inp(p)), 'quality', p.Value || '1080p30'),
    CamReconnect: (p) => { KM.link.restartCam(need(inp(p))); return true; },

    // ---- kelola input ----
    SetInputName: (p) => { const i = need(inp(p)); i.title = String(p.Value || i.title); KM.changed('inputs'); return true; },
    RemoveInput: (p) => { KM.inputs.remove(need(inp(p))); return true; },
    SetColour: (p) => { const i = need(inp(p)); if (i.type === 'colour') { i.opts.color = p.Value; KM.inputTypes.colour.paint(i); } return true; },
    AddInput: (p) => { const [type, val] = String(p.Value || '').split('|'); const t = String(type).toLowerCase(); if (t === 'colour' || t === 'color') KM.inputs.create('colour', { opts: { color: val || '#000000' } }); else if (t === 'title') KM.inputs.create('title', { opts: { template: val || 'lt-klasik' } }); else return false; return true; },
    SaveProject: () => KM.ui && KM.ui.saveProject(),

    // ---- skrip ----
    ScriptStart: (p) => KM.script.run(p.Value || p.Input),
    ScriptStop: (p) => KM.script.stop(p.Value || p.Input),
    ScriptStopAll: () => { KM.script.stopAll(); return true; },

    // ---- PTZ fisik (VISCA/HTTP) ----
    PTZMoveUp: (p) => KM.ptz.cmd(need(inp(p, true)), 'up', ptzSpd(p)), PTZMoveDown: (p) => KM.ptz.cmd(need(inp(p, true)), 'down', ptzSpd(p)),
    PTZMoveLeft: (p) => KM.ptz.cmd(need(inp(p, true)), 'left', ptzSpd(p)), PTZMoveRight: (p) => KM.ptz.cmd(need(inp(p, true)), 'right', ptzSpd(p)),
    PTZMoveUpLeft: (p) => KM.ptz.cmd(need(inp(p, true)), 'upleft', ptzSpd(p)), PTZMoveUpRight: (p) => KM.ptz.cmd(need(inp(p, true)), 'upright', ptzSpd(p)),
    PTZMoveDownLeft: (p) => KM.ptz.cmd(need(inp(p, true)), 'downleft', ptzSpd(p)), PTZMoveDownRight: (p) => KM.ptz.cmd(need(inp(p, true)), 'downright', ptzSpd(p)),
    PTZMoveStop: (p) => KM.ptz.cmd(need(inp(p, true)), 'stop'),
    PTZZoomIn: (p) => KM.ptz.cmd(need(inp(p, true)), 'zoomin'), PTZZoomOut: (p) => KM.ptz.cmd(need(inp(p, true)), 'zoomout'), PTZZoomStop: (p) => KM.ptz.cmd(need(inp(p, true)), 'zoomstop'),
    PTZFocusAuto: (p) => KM.ptz.cmd(need(inp(p, true)), 'focusauto'), PTZFocusManual: (p) => KM.ptz.cmd(need(inp(p, true)), 'focusmanual'),
    PTZFocusNear: (p) => KM.ptz.cmd(need(inp(p, true)), 'focusnear'), PTZFocusFar: (p) => KM.ptz.cmd(need(inp(p, true)), 'focusfar'), PTZFocusStop: (p) => KM.ptz.cmd(need(inp(p, true)), 'focusstop'),
    PTZHome: (p) => KM.ptz.cmd(need(inp(p, true)), 'home'),
    PTZPreset: (p) => KM.ptz.cmd(need(inp(p, true)), 'preset', { preset: num(p.Value, 1) }),
    PTZSavePreset: (p) => KM.ptz.cmd(need(inp(p, true)), 'save', { preset: num(p.Value, 1) }),
    // ---- PTZ virtual ----
    VirtualPTZPreset: (p) => KM.ptz.vgo(need(inp(p, true)), String(num(p.Value, 1)), p.Duration != null ? num(p.Duration, 1000) : undefined),
    VirtualPTZSave: (p) => { KM.ptz.vsave(need(inp(p, true)), String(num(p.Value, 1))); return true; },
    VirtualPTZHome: (p) => KM.ptz.vgo(need(inp(p, true)), 'home'),

    // ---- NDI / virtual camera ----
    StartNDI: () => KM.rec.startNdi(), StopNDI: () => KM.rec.stopNdi(), StartStopNDI: () => KM.rec.toggleNdi(),
    StartVirtualCamera: () => KM.rec.startNdi(), StopVirtualCamera: () => KM.rec.stopNdi(),

    // ---- stream masuk & call ----
    StreamInputRestart: (p) => { const i = need(inp(p)); if (i.type !== 'stream') throw new Error('Bukan input stream'); KM.inputTypes.stream.restart(i); return true; },
    CallMuteGuest: (p) => KM.audio.set(need(inp(p)), 'mute', true), CallUnmuteGuest: (p) => KM.audio.set(need(inp(p)), 'mute', false),

    // ---- performa & audio lanjutan ----
    SetPerformanceMode: (p) => { KM.perf.apply(String(p.Value || 'seimbang').toLowerCase()); return true; },
    DuckingOn: () => { (KM.settings.duck = KM.settings.duck || {}).on = true; KM.saveSettings(); return true; },
    DuckingOff: () => { (KM.settings.duck = KM.settings.duck || {}).on = false; KM.saveSettings(); return true; },
    SetReverb: (p) => KM.audio.set(need(inp(p)), 'rv', KM.clamp(num(p.Value, 0) / 100, 0, 1)),

    // ---- UTC KLM Acara (grafis acara asli: lower third, title, running text, logo, lokasi, sosmed, opening/closing) ----
    // Value = lt | title | ticker | logo | loc | soc
    UTCShow: (p) => utc('show', p.Value), UTCHide: (p) => utc('hide', p.Value), UTCToggle: (p) => utc('toggle', p.Value),
    UTCNext: (p) => utc('next', p.Value || 'lt', { show: bool(p.Show == null ? 'true' : p.Show) }),
    UTCPrevious: (p) => utc('prev', p.Value || 'lt', { show: bool(p.Show == null ? 'true' : p.Show) }),
    UTCSelect: (p) => utc('select', p.Value || 'lt', { name: p.Name != null ? p.Name : p.SelectedIndex }),   // Name = nomor urut / nama / label
    UTCSetText: (p) => utc('settext', p.Target || p.Input || 'lt', { field: p.SelectedName || 'name', text: p.Value || '' }),
    UTCHideAll: () => utc('hideall'), UTCOpening: () => utc('opening'), UTCClosing: () => utc('closing'), UTCOpeningClosingOff: () => utc('ocoff'),
    UTCEvent: (p) => utc('event', '', { name: p.Value }), UTCPreset: (p) => utc('preset', '', { name: p.Value }),
    UTCOnAir: () => { KM.utc.setOnAir(); return true; }, UTCOnAirOn: () => { KM.utc.setOnAir(true); return true; }, UTCOnAirOff: () => { KM.utc.setOnAir(false); return true; },
    UTCReload: () => { KM.utc.reload(); return true; },
    UTCAddInput: () => { KM.utc.addInput(); return true; },
    // ---- UTC Score ----
    ScoreOnAir: () => { KM.score.setOnAir(); return true; }, ScoreOnAirOn: () => { KM.score.setOnAir(true); return true; }, ScoreOnAirOff: () => { KM.score.setOnAir(false); return true; },
    ScoreAddInput: () => { KM.score.addInput(); return true; }
  };
  async function utc(cmd, target, extra) {
    const r = await KM.utc.cmd(cmd, target, extra);
    if (!r || !r.ok) throw new Error((r && r.msg) || 'Perintah UTC gagal');
    return true;
  }
  function ptzSpd(p) { return p.Value != null ? { speed: num(p.Value, 8) } : {}; }
  // OverlayInput1..4 (+In/Out/Off)
  for (let n = 1; n <= 4; n++) {
    F['OverlayInput' + n] = (p) => E().overlay(n - 1, p.Input != null ? need(inp(p)).id : null, 'toggle');
    F['OverlayInput' + n + 'In'] = (p) => E().overlay(n - 1, need(inp(p)).id, 'in');
    F['OverlayInput' + n + 'Out'] = () => E().overlay(n - 1, null, 'out');
    F['OverlayInput' + n + 'Off'] = () => E().overlay(n - 1, null, 'off');
    F['OverlayInput' + n + 'Zoom'] = (p) => E().overlay(n - 1, p.Input ? need(inp(p)).id : null, 'toggle');
    F['PreviewOverlayInput' + n] = (p) => E().overlay(n - 1, need(inp(p)).id, 'in');
  }

  function slot(i, p) { const t = KM.settings.transitions[i]; return E().transition(t.type, num(p.Duration, t.dur), p.Input || undefined); }
  function setTr(i, k, v) { if (k === 'type') { const m = Object.keys(KM.engine.TRANSITIONS).find((x) => x.toLowerCase() === String(v).toLowerCase()); if (!m) return false; v = m; } KM.settings.transitions[i][k] = v; KM.saveSettings(); KM.changed('trans-cfg'); return true; }
  function setPos(p, k, min, max) { const i = need(inp(p)); i.pos[k] = rel(i.pos[k], p.Value, min, max); KM.changed('input'); return true; }
  function layer(p, on) {
    const i = need(inp(p)); const l = i.layers[num(p.Value, 1) - 1]; if (!l) return false;
    l.on = on == null ? !l.on : on; KM.changed('input'); return true;
  }

  const lookup = {};
  Object.keys(F).forEach((k) => { lookup[k.toLowerCase()] = F[k]; });

  KM.api = {
    functions: F,
    list: () => Object.keys(F).sort(),
    // fungsi yang memakai durasi transisi (ms) — untuk editor shortcut
    usesDuration: (fn) => /^(Fade|Merge|Wipe|Slide|Fly|Zoom|CrossZoom|Circle|BarnDoor|CubeZoom|Cube|FadeToBlackTransition|Dip|Blur|VerticalWipe|VerticalSlide|Transition[1-4]|VirtualPTZPreset)$/.test(fn) || String(F[fn] || '').includes('p.Duration'),
    usesValue: (fn) => String(F[fn] || '').includes('p.Value'),
    usesInput: (fn) => /inp\(p|p\.Input/.test(String(F[fn] || '')),
    async exec(fn, params) {
      const f = lookup[String(fn || '').toLowerCase()];
      if (!f) throw new Error('Fungsi tidak dikenal: ' + fn);
      const r = await f(params || {});
      return r;
    },
    xml() {
      const x = (s) => KM.esc(s);
      const TN = { utc: 'Browser', video: 'Video', image: 'Image', colour: 'Colour', camera: 'Capture', klmcam: 'Capture', screen: 'DesktopCapture', title: 'GT', audio: 'AudioFile', audiofile: 'AudioFile', list: 'VideoList', browser: 'Browser', replay: 'Replay', virtualset: 'VirtualSet', bars: 'Colour', urlvideo: 'Video', stream: 'Stream', call: 'VideoCall' };
      let s = '<vmix><version>27.0.0.0</version><edition>KLM Mix ' + KM.version + '</edition><preset></preset><inputs>';
      S.inputs.forEach((i, n) => {
        const m = KM.inputs.media(i);
        const st = KM.audio.strips.get(i.id); let mf = '';
        if (st) { const mm = KM.audio.readMeter(st.meter); mf = ` meterF1="${mm.peakL.toFixed(4)}" meterF2="${mm.peakR.toFixed(4)}"`; }
        s += `<input key="${i.id}" number="${n + 1}" type="${TN[i.type] || 'Video'}" title="${x(i.title)}" shortTitle="${x(i.title)}" state="${KM.inputs.isPlaying(i) ? 'Running' : 'Paused'}" position="${m && m.currentTime ? Math.round(m.currentTime * 1000) : 0}" duration="${m && isFinite(m.duration) ? Math.round(m.duration * 1000) : 0}" loop="${i.loop ? 'True' : 'False'}"`;
        if (KM.inputs.hasAudio(i)) s += ` muted="${i.audio.mute ? 'True' : 'False'}" volume="${i.audio.vol}" balance="${i.audio.pan * 100}" solo="${i.audio.solo ? 'True' : 'False'}" audiobusses="${['M', 'A', 'B'].filter((b) => i.audio[b]).join(',')}"${mf}`;
        s += '>' + x(i.title);
        if (i.type === 'title') KM.titles.defs(i).forEach((fd, k) => { s += `<text index="${k}" name="${fd.k}">${x(KM.titles.fields(i)[fd.k])}</text>`; });
        s += '</input>';
      });
      s += '</inputs><overlays>';
      S.overlays.forEach((o, k) => { const ii = KM.getInput(o.inputId); s += `<overlay number="${k + 1}">${o.phase !== 'off' && ii ? KM.inputNum(ii) : ''}</overlay>`; });
      const pv = KM.getInput(S.previewId), pg = KM.getInput(S.programId);
      s += `</overlays><preview>${pv ? KM.inputNum(pv) : 0}</preview><active>${pg ? KM.inputNum(pg) : 0}</active><fadeToBlack>${S.ftb.on ? 'True' : 'False'}</fadeToBlack><transitions>`;
      KM.settings.transitions.forEach((t, k) => { s += `<transition number="${k + 1}" effect="${x(KM.engine.TRANSITIONS[t.type] || t.type)}" duration="${t.dur}"/>`; });
      const b = (v) => (v ? 'True' : 'False');
      s += `</transitions><recording>${b(S.recording)}</recording><external>${b(S.externalOn)}</external><streaming>${b(S.streaming)}</streaming><playList>${b(KM.playlist.running)}</playList><multiCorder>${b(S.multicorder)}</multiCorder><fullscreen>${b(S.externalOn)}</fullscreen>`;
      const A = KM.audio;
      if (A.master) s += `<audio><master volume="${A.master.vol}" muted="${b(A.master.muted)}" headphonesVolume="100"/><busA volume="${A.busA.vol}" muted="${b(A.busA.muted)}"/><busB volume="${A.busB.vol}" muted="${b(A.busB.muted)}"/></audio>`;
      return s + '</vmix>';
    }
  };
})(window.KM);
