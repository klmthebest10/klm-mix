'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const INVOKE = ['app:info', 'desktop:sources', 'dialog:open', 'dialog:save', 'dialog:folder', 'file:read-text', 'file:write-text',
  'file:write-binary', 'file:exists', 'file:open-writer', 'file:close-writer', 'shell:show', 'shell:open', 'server:get', 'server:set',
  'app:relaunch', 'browser:open', 'browser:navigate', 'browser:reload', 'browser:show', 'browser:close',
  'fx:list', 'fx:read', 'fx:save', 'fx:open-folder', 'fx:scan-pc'];
const SEND = ['file:write-chunk', 'utc:start', 'utc:stop', 'utc:ack', 'utc:reload', 'utc:full', 'utc:pause', 'utc:resume'];
const ON = ['utc:frame', 'utc:tk'];

contextBridge.exposeInMainWorld('klm', {
  isElectron: true,
  invoke: (ch, ...a) => (INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error('channel ' + ch))),
  send: (ch, ...a) => { if (SEND.includes(ch)) ipcRenderer.send(ch, ...a); },
  on: (ch, cb) => { if (ON.includes(ch)) ipcRenderer.on(ch, (e, d) => cb(d)); },
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } }
});
