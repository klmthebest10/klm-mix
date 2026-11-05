/*
 * KLM Mix - Proses utama Electron (versi Windows .exe)
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, screen, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

process.env.KLM_CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const server = require('./server');
const setupUtcOsr = require('./utc-osr');

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
    if (u.pathname === '/utc' || u.pathname.startsWith('/utc/')) { // panel UTC KLM Acara di jendela sendiri (mis. monitor ke-2)
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#0b0d12', autoHideMenuBar: true,
          title: 'UTC KLM Acara • KLM Mix', icon: path.join(__dirname, '..', 'build', 'icon.png'), webPreferences: { backgroundThrottling: false }
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
  setupUtcOsr({ port: () => netInfo.ports.http });
  createMain();
  if (process.env.KLM_SMOKE) smokeTest();
});
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { server.hub.shutdown(); } catch (e) {} });

// ---------------- uji otomatis CI (KLM_SMOKE=folder) ----------------
// Membuka aplikasi, memastikan panel UTC & lapisan UTC ON AIR benar-benar tampil di Program, lalu menyimpan screenshot.
function smokeTest() {
  const out = process.env.KLM_SMOKE;
  const log = (m) => { try { fs.appendFileSync(path.join(out, 'smoke.log'), new Date().toISOString() + ' ' + m + '\n'); } catch (e) {} console.log('[SMOKE] ' + m); };
  try { fs.mkdirSync(out, { recursive: true }); } catch (e) {}
  const http = require('http');
  const post = (p, body) => new Promise((res) => {
    const d = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: netInfo.ports.http, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } }, (rs) => { let b = ''; rs.on('data', (c) => { b += c; }); rs.on('end', () => res(b)); });
    r.on('error', (e) => res('ERR ' + e.message)); r.end(d);
  });
  const js = (code) => mainWin.webContents.executeJavaScript(code, true);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    let fail = 0;
    try {
      await wait(6000);
      log('versi ' + app.getVersion() + ', port ' + JSON.stringify(netInfo.ports));
      log('cmd lt show: ' + await post('/utc/api/klm/cmd', { cmd: 'show', target: 'lt' }));
      log('cmd ticker show: ' + await post('/utc/api/klm/cmd', { cmd: 'show', target: 'ticker' }));
      log('cmd logo show: ' + await post('/utc/api/klm/cmd', { cmd: 'show', target: 'logo' }));
      await wait(5000);
      const st = await js('JSON.stringify({ avail: KM.utc.avail, on: KM.utc.onAir(), frames: KM.utc.frames, fps: KM.engine.fps, px: KM.utc.coverage() })');
      log('status UTC: ' + st);
      const s = JSON.parse(st);
      if (!s.avail || !s.frames) { fail++; log('GAGAL: tidak ada frame overlay offscreen'); }
      if (!(s.px > 0.002)) { fail++; log('GAGAL: lapisan UTC kosong di Program'); }
      const png = await js('new Promise(r => KM.engine.prog.toBlob(b => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }, "image/png"))');
      fs.writeFileSync(path.join(out, 'program.png'), Buffer.from(png.split(',')[1], 'base64'));
      const shot = await mainWin.webContents.capturePage();
      fs.writeFileSync(path.join(out, 'window.png'), shot.toPNG());
      await js('KM.ui.utcPanel(true)'); await wait(4000);
      const ok = await js('(() => { try { const f = document.querySelector("#utcFrame"); return !!(f && f.contentDocument && f.contentDocument.querySelector("#panel, .tabs, header")); } catch (e) { return "err " + e.message; } })()');
      log('panel UTC dimuat: ' + ok); if (ok !== true) fail++;
      fs.writeFileSync(path.join(out, 'panel.png'), (await mainWin.webContents.capturePage()).toPNG());
    } catch (e) { fail++; log('ERROR ' + (e && e.stack || e)); }
    log(fail ? 'HASIL: GAGAL (' + fail + ')' : 'HASIL: OK');
    try { fs.writeFileSync(path.join(out, 'result.txt'), fail ? 'FAIL' : 'OK'); } catch (e) {}
    mainWin.removeAllListeners('close');
    app.exit(fail ? 1 : 0);
  })();
}
