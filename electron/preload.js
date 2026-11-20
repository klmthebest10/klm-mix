'use strict';
const electron = require('electron');
const { contextBridge, ipcRenderer, webUtils } = electron;

const INVOKE = ['app:info', 'desktop:sources', 'dialog:open', 'dialog:save', 'dialog:folder', 'file:read-text', 'file:write-text',
  'file:write-binary', 'file:exists', 'file:open-writer', 'file:close-writer', 'shell:show', 'shell:open', 'server:get', 'server:set',
  'app:relaunch', 'browser:open', 'browser:navigate', 'browser:reload', 'browser:show', 'browser:close',
  'fx:list', 'fx:read', 'fx:save', 'fx:open-folder', 'fx:scan-pc',
  'vst:available', 'vst:create', 'vst:editor', 'vst:bypass', 'vst:get-state', 'vst:set-state', 'vst:params', 'vst:set-param', 'vst:destroy', 'vst:stats',
  'app:boot', 'app:ready', 'live:auth-list', 'live:yt-connect', 'live:fb-connect', 'live:forget', 'live:prepare', 'live:end',
  'airplay:start', 'airplay:stop', 'airplay:status', 'airplay:firewall', 'airplay:hotspot', 'sys:open-settings',
  'procaudio:start', 'procaudio:stop', 'procaudio:available',
  'nengine:start', 'nengine:stop', 'nengine:status', 'nengine:screen-rect',
  'update:info', 'update:check', 'update:download', 'update:install'];
const SEND = ['file:write-chunk', 'utc:start', 'utc:stop', 'utc:ack', 'utc:reload', 'utc:full', 'utc:pause', 'utc:resume', 'utc:zc-ready', 'utc:zc-set', 'nengine:cmd', 'nengine:utc', 'nengine:kenc', 'nengine:aud'];
const ON = ['utc:frame', 'utc:tk', 'utc:zc', 'vst:event', 'airplay:status', 'procaudio:status', 'update:status', 'nengine:ev'];

// port audio plugin VST (MessagePort ke broker) diteruskan ke dunia halaman → AudioWorklet
ipcRenderer.on('vst:port', (e, d) => { window.postMessage({ klmVstPort: d && d.id }, '*', e.ports); });

contextBridge.exposeInMainWorld('klm', {
  isElectron: true,
  invoke: (ch, ...a) => (INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error('channel ' + ch))),
  send: (ch, ...a) => { if (SEND.includes(ch)) ipcRenderer.send(ch, ...a); },
  on: (ch, cb) => { if (ON.includes(ch)) ipcRenderer.on(ch, (e, d) => cb(d)); },
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  // zero-copy grafis UTC: tekstur GPU dari proses utama diterima di sini → callback halaman mendapat objek impor
  // (getVideoFrame / release). Mengembalikan false bila Electron ini belum punya sharedTexture.
  zcReceiver: (cb) => {
    const st = electron.sharedTexture;
    if (!st || typeof st.setSharedTextureReceiver !== 'function' || typeof cb !== 'function') return false;
    try {
      st.setSharedTextureReceiver(async (data, id, meta) => {
        const imp = data && data.importedSharedTexture;
        if (!imp) return;
        try { await cb(imp, id, meta); } catch (e) { try { imp.release(); } catch (x) {} }
      });
      return true;
    } catch (e) { return false; }
  }
});
