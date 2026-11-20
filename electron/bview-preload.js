'use strict';
// Jembatan jendela "lihat & klik" untuk Web Browser offscreen (mesin video native): frame halaman diterima sebagai tekstur GPU
// bersama dari proses utama, input mouse/keyboard dikirim balik ke halaman offscreen.
const electron = require('electron');
const { contextBridge, ipcRenderer } = electron;
contextBridge.exposeInMainWorld('klmView', {
  onFrame: (cb) => {
    const st = electron.sharedTexture;
    if (!st || typeof st.setSharedTextureReceiver !== 'function') return false;
    st.setSharedTextureReceiver(async (data, id, meta) => {
      const imp = data && data.importedSharedTexture; if (!imp) return;
      try { await cb(imp, meta || {}); } catch (e) { try { imp.release(); } catch (x) {} }
    });
    return true;
  },
  onInfo: (cb) => ipcRenderer.on('bview:info', (e, d) => cb(d)),
  input: (ev) => ipcRenderer.send('bview:input', ev),
  nav: (cmd, url) => ipcRenderer.send('bview:nav', cmd, url || '')
});
