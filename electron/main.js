/*
 * KLM Mix - Proses utama Electron (versi Windows .exe)
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, screen, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

process.env.KLM_CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const server = require('./server');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer,PlatformHEVCEncoderSupport,MediaRecorderEnableMp4Muxer');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let mainWin = null;
let netInfo = { ports: {}, ips: [] };
const writers = new Map();
let writerSeq = 1;
const browsers = new Map();


function createMain() {
  mainWin = new BrowserWindow({
    width: 1600, height: 940, minWidth: 1180, minHeight: 700,
    backgroundColor: '#15171c', title: 'KLM Mix',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, spellcheck: false
    }
  });
  Menu.setApplicationMenu(null);
  mainWin.loadURL(`http://127.0.0.1:${netInfo.ports.http}/`);
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    const u = new URL(url);
    if (u.pathname.startsWith('/output')) {
      const di = parseInt(u.searchParams.get('display') || '0', 10);
      const displays = screen.getAllDisplays();
      const d = displays[di] || displays[0];
      const full = di > 0 && displays.length > 1;
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          x: d.bounds.x + (full ? 0 : 80), y: d.bounds.y + (full ? 0 : 80),
          width: full ? d.bounds.width : 960, height: full ? d.bounds.height : 540,
          frame: !full, fullscreen: full, backgroundColor: '#000000', autoHideMenuBar: true,
          title: 'KLM Mix - Output', webPreferences: { backgroundThrottling: false }
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.on('close', (e) => {
    const choice = dialog.showMessageBoxSync(mainWin, {
      type: 'question', buttons: ['Keluar', 'Batal'], defaultId: 1, cancelId: 1,
      title: 'KLM Mix', message: 'Tutup KLM Mix?', detail: 'Rekaman dan streaming yang berjalan akan dihentikan.'
    });
    if (choice === 1) e.preventDefault();
  });
  mainWin.on('closed', () => { mainWin = null; for (const w of browsers.values()) { try { w.destroy(); } catch (e) {} } app.quit(); });
}

function toRenderer(ch, data) { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, data); }

// ---------------- IPC ----------------
ipcMain.handle('app:info', () => ({
  version: app.getVersion(), ports: netInfo.ports, ips: server.localIPs(),
  videos: app.getPath('videos'), pictures: app.getPath('pictures'), documents: app.getPath('documents'),
  displays: screen.getAllDisplays().map((d, i) => ({ index: i, label: `Monitor ${i + 1} (${d.size.width}x${d.size.height})`, primary: d.id === screen.getPrimaryDisplay().id }))
}));

ipcMain.handle('desktop:sources', async () => {
  const src = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
  return src.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
});

ipcMain.handle('dialog:open', async (e, opts) => {
  const r = await dialog.showOpenDialog(mainWin, Object.assign({ properties: ['openFile'] }, opts || {}));
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:save', async (e, opts) => {
  const r = await dialog.showSaveDialog(mainWin, opts || {});
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dialog:folder', async (e, opts) => {
  const r = await dialog.showOpenDialog(mainWin, Object.assign({ properties: ['openDirectory', 'createDirectory'] }, opts || {}));
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('file:read-text', (e, p) => fs.readFileSync(p, 'utf8'));
ipcMain.handle('file:write-text', (e, p, txt) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); return true; });
ipcMain.handle('file:write-binary', (e, p, ab) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(ab)); return true; });
ipcMain.handle('file:exists', (e, p) => fs.existsSync(p));
ipcMain.handle('file:open-writer', (e, p) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const id = writerSeq++;
  writers.set(id, fs.createWriteStream(p));
  return id;
});
ipcMain.on('file:write-chunk', (e, id, ab) => { const w = writers.get(id); if (w) w.write(Buffer.from(ab)); });
ipcMain.handle('file:close-writer', (e, id) => new Promise((res) => {
  const w = writers.get(id); if (!w) return res(false);
  writers.delete(id); w.end(() => res(true));
}));
ipcMain.handle('shell:show', (e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('shell:open', (e, p) => shell.openPath(p));

ipcMain.handle('server:get', () => server.loadConfig());
ipcMain.handle('server:set', (e, cfg) => { server.saveConfig(Object.assign(server.loadConfig(), cfg)); return true; });
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });

// ---- Input "Web Browser" (jendela tersembunyi yang di-capture) ----
ipcMain.handle('browser:open', async (e, { url, width, height, visible }) => {
  const w = new BrowserWindow({
    width: width || 1280, height: height || 720, useContentSize: true,
    x: visible ? 100 : -(width || 1280) - 200, y: visible ? 100 : 0,
    frame: !!visible, skipTaskbar: !visible, focusable: !!visible, transparent: false,
    backgroundColor: '#00000000', title: 'KLM Mix - Browser Input',
    webPreferences: { backgroundThrottling: false, contextIsolation: true }
  });
  w.webContents.setAudioMuted(true);
  await w.loadURL(url).catch(() => {});
  const id = w.id;
  browsers.set(id, w);
  w.on('closed', () => browsers.delete(id));
  return { winId: id, sourceId: w.getMediaSourceId() };
});
ipcMain.handle('browser:navigate', async (e, id, url) => { const w = browsers.get(id); if (w) await w.loadURL(url).catch(() => {}); return !!w; });
ipcMain.handle('browser:reload', (e, id) => { const w = browsers.get(id); if (w) w.reload(); return !!w; });
ipcMain.handle('browser:show', (e, id, show) => {
  const w = browsers.get(id); if (!w) return false;
  const [bw] = w.getSize();
  if (show) { w.setPosition(100, 100); w.setSkipTaskbar(false); w.setFocusable(true); w.focus(); }
  else { w.setPosition(-bw - 200, 0); w.setSkipTaskbar(true); w.setFocusable(false); }
  return true;
});
ipcMain.handle('browser:close', (e, id) => { const w = browsers.get(id); if (w) w.destroy(); return true; });

// ---------------- start ----------------
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' })).catch(() => cb({}));
  });
  netInfo = await server.start();
  createMain();
});
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { server.hub.shutdown(); } catch (e) {} });
