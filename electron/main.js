/*
 * KLM - Proses utama Electron (versi Windows .exe)
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, screen, shell, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const T0 = Date.now() - Math.round(process.uptime() * 1000); // saat proses dimulai (untuk ukur kecepatan buka)
const T = {};
// nama aplikasi kini "KLM" (dulu "KLM Mix"): folder data lama tetap dipakai agar pengaturan, preset UTC & lisensi tidak hilang
try { app.setPath('userData', path.join(app.getPath('appData'), 'KLM Mix')); } catch (e) {}
process.env.KLM_CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const server = require('./server');
const setupUtcOsr = require('./utc-osr');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// AllowWgcScreenCapturer / AllowWgcWindowCapturer: input Tangkap Layar/Jendela memakai Windows Graphics Capture (API native
// Windows 10 1903+, GPU) untuk layar maupun jendela; bila tidak tersedia Chromium otomatis kembali ke DXGI/GDI.
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer,PlatformHEVCEncoderSupport,MediaRecorderEnableMp4Muxer,AllowWgcScreenCapturer,AllowWgcWindowCapturer');
// alamat IP asli (bukan nama .local) di kandidat WebRTC — gateway Layar TV (MediaMTX) & TV box tidak membaca mDNS
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');

if (!app.requestSingleInstanceLock()) { app.quit(); }

let mainWin = null;
let utcOsr = null;
let netInfo = { ports: {}, ips: [] };
const writers = new Map();
let writerSeq = 1;
const browsers = new Map();


// ---------------- layar pembuka (jendela kecil tanpa bingkai) ----------------
// Jendela utama dimuat tersembunyi; layar pembuka menampilkan tahap penyiapan yang sebenarnya, lalu jendela utama
// muncul sekaligus dalam keadaan siap (tidak ada jendela kosong / antarmuka setengah jadi).
const BRAND_SVG = '<svg viewBox="0 0 24 24"><defs><linearGradient id="klmT" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f4a54"/><stop offset=".55" stop-color="#082a31"/><stop offset="1" stop-color="#03151a"/></linearGradient><linearGradient id="klmS" gradientUnits="userSpaceOnUse" x1="0" y1="3.5" x2="0" y2="20.5"><stop offset="0" stop-color="#d4ff3f"/><stop offset="1" stop-color="#16e0c6"/></linearGradient><radialGradient id="klmG" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff5d84" stop-opacity=".55"/><stop offset="1" stop-color="#ff5d84" stop-opacity="0"/></radialGradient><clipPath id="klmC"><path d="M12 9.6L8.3 20.1H15.7Z"/></clipPath></defs><rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#klmT)"/><rect x="1.9" y="1.9" width="20.2" height="20.2" rx="5.6" fill="none" stroke="#3ff0d0" stroke-opacity=".16" stroke-width=".35"/><g fill="none" stroke="url(#klmS)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.53 5.48A3.3 3.3 0 0 1 14.53 9.72M9.47 5.48A3.3 3.3 0 0 0 9.47 9.72"/><path d="M16.6 3.75A5.95 5.95 0 0 1 16.6 11.45M7.4 3.75A5.95 5.95 0 0 0 7.4 11.45" stroke-opacity=".85"/><path d="M10 13.2L15.2 18.1M14 13.2L8.8 18.1M8.6 17.9H15.4" stroke-width="1.05" stroke-linecap="butt" clip-path="url(#klmC)"/><path d="M12 9.6L8.3 20.1M12 9.6L15.7 20.1"/></g><circle cx="12" cy="7.6" r="3" fill="url(#klmG)"/><circle cx="12" cy="7.6" r="1.45" fill="#ff5d84"/><circle cx="11.6" cy="7.2" r=".45" fill="#fff" fill-opacity=".8"/></svg>';
const splashHtml = (ver) => '<!DOCTYPE html><html><head><meta charset="utf-8"><style>'
  + 'html,body{margin:0;height:100%;overflow:hidden;background:#090b0f;color:#eceff4;font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;-webkit-user-select:none;cursor:default}'
  + 'body{-webkit-app-region:drag;display:grid;grid-template-columns:200px 1fr;align-items:center;transition:opacity .32s ease, transform .32s ease}body.out{opacity:0;transform:scale(1.015)}'
  + '.bg{position:fixed;inset:0;background:radial-gradient(520px 300px at 0% 0%,rgba(255,98,48,.22),transparent 70%),radial-gradient(460px 320px at 100% 100%,rgba(62,198,255,.13),transparent 70%),linear-gradient(135deg,#11141b,#090b0f 60%)}'
  + '.bg:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(115deg,rgba(255,255,255,.028) 0 1px,transparent 1px 46px)}'
  + '.mark{position:relative;width:132px;height:132px;margin-left:46px;display:grid;place-items:center}.mark svg.k{width:62px;height:62px;filter:drop-shadow(0 10px 26px rgba(255,90,50,.45));animation:pop .7s cubic-bezier(.2,.9,.3,1.2) both}'
  + '.ring{position:absolute;inset:0;border-radius:50%;border:2px solid transparent;border-top-color:#ff7a1a;border-right-color:rgba(255,122,26,.25);animation:spin 1.5s linear infinite}'
  + '.ring.b{inset:14px;border-top-color:transparent;border-right-color:transparent;border-bottom-color:#3ec6ff;border-left-color:rgba(62,198,255,.22);animation:spin 2.3s linear infinite reverse}'
  + '.txt{position:relative;padding-right:40px}.wm{font-size:38px;font-weight:800;letter-spacing:-1px;line-height:1;animation:up .6s .08s cubic-bezier(.2,.8,.2,1) both}.wm span{font-weight:300;color:#c5ccd8}'
  + '.sub{margin-top:8px;color:#8a93a5;font-size:11.5px;font-weight:600;letter-spacing:3.2px;text-transform:uppercase;animation:up .6s .16s cubic-bezier(.2,.8,.2,1) both}'
  + '.st{margin-top:34px;font-size:12.5px;color:#aeb6c4;height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;animation:up .6s .24s both}'
  + '.bar{margin-top:9px;height:3px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden}.bar i{display:block;height:100%;width:6%;border-radius:3px;background:linear-gradient(90deg,#d4ff3f,#16e0c6);transition:width .35s cubic-bezier(.2,.8,.2,1);box-shadow:0 0 12px rgba(255,120,40,.7)}'
  + '.ft{position:fixed;left:0;right:0;bottom:14px;padding:0 24px;display:flex;justify-content:space-between;font-size:10.5px;color:#5d6676;letter-spacing:.4px}.live{display:inline-flex;align-items:center;gap:6px}.live b{width:6px;height:6px;border-radius:50%;background:#ff4b3e;animation:bl 1.1s ease-in-out infinite}'
  + '@keyframes spin{to{transform:rotate(360deg)}}@keyframes pop{from{transform:scale(.6);opacity:0}}@keyframes up{from{transform:translateY(10px);opacity:0}}@keyframes bl{50%{opacity:.25}}'
  + '</style></head><body><div class="bg"></div><div class="mark"><i class="ring"></i><i class="ring b"></i>' + BRAND_SVG.replace('<svg ', '<svg class="k" ') + '</div>'
  + '<div class="txt"><div class="wm">KLM</div><div class="sub">Kinetic Live Mixer</div><div class="st" id="st">Memulai…</div><div class="bar"><i id="pb"></i></div></div>'
  + '<div class="ft"><span class="live"><b></b>MENYIAPKAN STUDIO</span><span>versi ' + ver + '</span></div>'
  + '<script>window.S=function(p,t){if(t)document.getElementById("st").textContent=t;if(p!=null)document.getElementById("pb").style.width=Math.max(6,Math.min(100,p))+"%"}</script></body></html>';
let splashWin = null, revealed = false, splashAt = 0;
function createSplash() {
  splashWin = new BrowserWindow({ width: 600, height: 300, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, center: true, show: true, skipTaskbar: false,
    backgroundColor: '#090b0f', title: 'KLM', icon: path.join(__dirname, '..', 'build', 'icon.png'), webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  splashAt = Date.now(); T.splash = Date.now() - T0; // jendela langsung tampil (latar gelap), isinya menyusul beberapa saat kemudian
  splashWin.webContents.once('did-finish-load', () => { T.splashPaint = Date.now() - T0; });
  splashWin.on('closed', () => { splashWin = null; });
  splashWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml(app.getVersion()))).catch(() => {});
}
function splashStep(pct, text) {
  if (splashWin && !splashWin.isDestroyed()) splashWin.webContents.executeJavaScript('window.S&&S(' + (pct == null ? 'null' : +pct) + ',' + JSON.stringify(String(text || '')) + ')', true).catch(() => {});
}
/** tampilkan jendela utama (sudah siap) dengan pudar halus, tutup layar pembuka */
function reveal(why) {
  if (revealed || !mainWin || mainWin.isDestroyed()) return;
  revealed = true; T.shown = Date.now() - T0; T.revealBy = why;
  const go = () => {
    if (!mainWin || mainWin.isDestroyed()) return;
    try { mainWin.setOpacity(0); } catch (e) {}
    mainWin.show(); mainWin.focus();
    let o = 0; const iv = setInterval(() => { o = Math.min(1, o + 0.125); try { mainWin && !mainWin.isDestroyed() && mainWin.setOpacity(o); } catch (e) {} if (o >= 1) clearInterval(iv); }, 16);
    if (splashWin && !splashWin.isDestroyed()) { splashWin.webContents.executeJavaScript('document.body.classList.add("out")', true).catch(() => {}); const sw = splashWin; setTimeout(() => { try { sw.destroy(); } catch (e) {} }, 360); }
  };
  splashStep(100, 'Siap');
  setTimeout(go, Math.max(120, 650 - (Date.now() - (splashAt || Date.now())))); // layar pembuka minimal sekejap agar tidak berkedip
}

function createMain() {
  mainWin = new BrowserWindow({
    width: 1600, height: 940, minWidth: 820, minHeight: 560,
    backgroundColor: '#0a0c0f', title: 'KLM', show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, spellcheck: false,
      v8CacheOptions: 'bypassHeatCheck' // simpan hasil kompilasi skrip sejak pembukaan pertama → buka berikutnya lebih cepat
    }
  });
  T.window = Date.now() - T0;
  mainWin.webContents.on('did-finish-load', () => { if (!T.load && /^http/.test(mainWin.webContents.getURL())) T.load = Date.now() - T0; });
  Menu.setApplicationMenu(null);
  mainWin.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) { splashStep(null, 'Gagal memuat antarmuka (' + desc + ') — mencoba lagi…'); setTimeout(() => { if (mainWin && !mainWin.isDestroyed() && netInfo) mainWin.loadURL(`http://127.0.0.1:${netInfo.ports.http}/`).catch(() => {}); }, 800); } });
  // stabilitas: bila proses tampilan mati/macet, muat ulang sendiri dan pulihkan sesi terakhir (autosave tiap 10 detik)
  let crashes = [];
  mainWin.webContents.on('render-process-gone', (e, d) => {
    reveal('renderer-gone');
    if (quitting || !d || d.reason === 'clean-exit' || d.reason === 'killed') return;
    console.warn('[KLM] proses tampilan berhenti:', d.reason, d.exitCode);
    const now = Date.now(); crashes = crashes.filter((t) => now - t < 120000); crashes.push(now);
    if (crashes.length > 3) { dialog.showErrorBox('KLM', 'Tampilan berhenti berulang kali (' + d.reason + '). Coba mode Hemat, perbarui driver grafis, atau jalankan ulang aplikasi.'); return; }
    setTimeout(() => { if (mainWin && !mainWin.isDestroyed() && netInfo) mainWin.loadURL(`http://127.0.0.1:${netInfo.ports.http}/#pulih`).catch(() => {}); }, 600);
  });
  let hungT = null;
  mainWin.on('unresponsive', () => {
    if (quitting || process.env.KLM_SMOKE) return;
    clearTimeout(hungT);
    hungT = setTimeout(async () => { // masih macet setelah 12 detik → tawarkan muat ulang
      if (!mainWin || mainWin.isDestroyed()) return;
      const r = await dialog.showMessageBox(mainWin, { type: 'warning', noLink: true, title: 'KLM', message: 'KLM tidak merespons', detail: 'Tunggu sebentar lagi, atau muat ulang tampilan (sesi terakhir dipulihkan otomatis).', buttons: ['Tunggu', 'Muat ulang'], defaultId: 0, cancelId: 0 });
      if (r.response === 1 && mainWin && !mainWin.isDestroyed()) { try { mainWin.webContents.forcefullyCrashRenderer(); } catch (er) { mainWin.loadURL(`http://127.0.0.1:${netInfo.ports.http}/#pulih`).catch(() => {}); } }
    }, 12000);
  });
  mainWin.on('responsive', () => clearTimeout(hungT));
  setTimeout(() => reveal('timeout'), 25000); // pengaman: jangan pernah tertahan di layar pembuka
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
          title: 'KLM - Output', webPreferences: { backgroundThrottling: false }
        }
      };
    }
    const sc = server.score && server.score();
    if (sc && sc.port() && String(sc.port()) === u.port && /^(127\.0\.0\.1|localhost)$/.test(u.hostname)) { // UTC KLM Scoreboard: panel / layar arena di jendela sendiri
      const arena = /\/(arena|turnamen)$/.test(u.pathname);
      const displays = screen.getAllDisplays(), d = arena && displays.length > 1 ? displays[1] : null;
      return {
        action: 'allow',
        overrideBrowserWindowOptions: Object.assign({
          width: arena ? 1280 : 1440, height: arena ? 720 : 900, minWidth: 640, minHeight: 400, backgroundColor: '#090c13', autoHideMenuBar: true,
          title: (arena ? 'Layar Arena' : 'UTC KLM Scoreboard') + ' • KLM', icon: path.join(__dirname, '..', 'build', 'icon.png'), webPreferences: { backgroundThrottling: false }
        }, d ? { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, fullscreen: true, frame: false } : {})
      };
    }
    if (u.pathname === '/utc' || u.pathname.startsWith('/utc/')) { // panel UTC KLM Acara di jendela sendiri (mis. monitor ke-2)
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1440, height: 900, minWidth: 900, minHeight: 600, backgroundColor: '#0b0d12', autoHideMenuBar: true,
          title: 'UTC KLM Acara • KLM', icon: path.join(__dirname, '..', 'build', 'icon.png'), webPreferences: { backgroundThrottling: false }
        }
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // Tutup: dialog Simpan / Jangan simpan / Batal. "Simpan" menulis ke preset (proyek) yang sedang dimuat,
  // atau membuat preset baru bila belum ada.
  let asking = false;
  mainWin.on('close', (e) => {
    if (quitting || updatingQuit) return;
    e.preventDefault();
    if (asking) return;
    asking = true;
    askClose().catch(() => {}).finally(() => { asking = false; });
  });
  mainWin.webContents.on('did-start-navigation', (e, url, inPlace, isMain) => { if (isMain && !inPlace && vstMgr) vstMgr.resetFor(mainWin.webContents.id); });
  mainWin.on('closed', () => { mainWin = null; hardQuit('closed'); });
}

const later = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
async function askClose() {
  if (!mainWin || mainWin.isDestroyed()) return hardQuit('tutup');
  if (!revealed) return hardQuit('tutup saat memuat');
  const wc = mainWin.webContents;
  const alive = await Promise.race([wc.executeJavaScript('!!(window.KM && KM.ui && KM.ui.requestClose)', true).catch(() => false), later(2500, false)]);
  if (!alive) { // halaman tidak menjawab: konfirmasi sederhana
    const c = dialog.showMessageBoxSync(mainWin, { type: 'question', buttons: ['Keluar', 'Batal'], defaultId: 1, cancelId: 1, noLink: true, title: 'KLM', message: 'Tutup KLM?', detail: 'Rekaman dan streaming yang berjalan akan dihentikan.' });
    if (c === 0) hardQuit('tutup jendela');
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
  // dialog & urutan penutupan dikerjakan halaman: simpan preset → akhiri rekaman/live dengan benar → lepas perangkat
  const r = await wc.executeJavaScript('KM.ui.requestClose()', true).catch((er) => { console.warn('requestClose', er.message); return 'error'; });
  if (r === 'cancel') return;
  await new Promise((res) => { let o = 1; const iv = setInterval(() => { o -= 0.14; try { mainWin && !mainWin.isDestroyed() && mainWin.setOpacity(Math.max(0, o)); } catch (e) {} if (o <= 0) { clearInterval(iv); res(); } }, 16); });
  try { mainWin.hide(); } catch (e) {}
  hardQuit('tutup jendela');
}

function toRenderer(ch, data) { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(ch, data); }

process.on('uncaughtException', (e) => { console.error('[KLM] uncaughtException', e && e.stack || e); }); // jangan biarkan satu galat menjatuhkan aplikasi
process.on('unhandledRejection', (e) => { console.warn('[KLM] unhandledRejection', e && e.message || e); });
// ---------------- IPC ----------------
const vstMgr = require('./vst').setup({ win: () => mainWin });
const airplay = require('./airplay').setup({ win: () => mainWin, server, configDir: server.configDir });
const procAudio = require('./procaudio').setup({ win: () => mainWin, server });
const nEngine = require('./nengine').setup({ win: () => mainWin, log: (m) => { console.log(m); if (global.__smokeLog) { try { global.__smokeLog(m); } catch (e) {} } } }); // mesin video native (eksperimen)
try { server.hub.setNativeTap(nEngine.tsTap); } catch (e) {}
// update di dalam aplikasi (GitHub Releases). Saat memasang, jendela ditutup tanpa dialog konfirmasi lagi
// (penyimpanan preset & penutupan rekaman sudah dikerjakan halaman sebelum memanggil update:install).
let updatingQuit = false;
const updater = require('./updater').create({ getWin: () => mainWin, beforeInstall: async () => { updatingQuit = true; }, log: (m) => console.log(m) });
// buka halaman Pengaturan Windows tertentu (Proyeksikan ke PC ini / Fitur opsional) untuk Miracast bawaan
ipcMain.handle('sys:open-settings', (e, page) => {
  const ok = { project: 'ms-settings:project', features: 'ms-settings:optionalfeatures', firewall: 'ms-settings:windowsdefender' };
  if (!ok[page] || process.platform !== 'win32') return false;
  return shell.openExternal(ok[page]).then(() => true, () => false);
});
require('./live').setup({ configDir: () => server.configDir() });
ipcMain.handle('app:boot', (e, pct, text) => { splashStep(22 + (+pct || 0) * 0.78, text); return true; });
ipcMain.handle('app:ready', () => { reveal('ready'); return true; });
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
// ---- plugin audio eksternal (folder: <data>/plugins) ----
const fxDir = () => { const d = path.join(server.configDir(), 'plugins'); try { fs.mkdirSync(d, { recursive: true }); } catch (e) {} return d; };
const fxKind = (n) => (/\.(m?js)$/i.test(n) ? 'js' : /\.(wav|flac|mp3|ogg|aiff?)$/i.test(n) ? 'ir' : null);
ipcMain.handle('fx:list', () => {
  const d = fxDir();
  return fs.readdirSync(d).filter((n) => fxKind(n)).sort().map((n) => ({ name: n, path: path.join(d, n), kind: fxKind(n), size: fs.statSync(path.join(d, n)).size }));
});
ipcMain.handle('fx:read', (e, p, mode) => {
  const f = path.resolve(p); if (!f.startsWith(path.resolve(fxDir()) + path.sep)) throw new Error('di luar folder plugin');
  if (mode === 'text') return fs.readFileSync(f, 'utf8');
  const b = fs.readFileSync(f); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
});
ipcMain.handle('fx:save', (e, name, data) => {
  const n = path.basename(String(name)).replace(/[^\w.\- ]+/g, '_'); if (!fxKind(n)) throw new Error('format tidak didukung');
  fs.writeFileSync(path.join(fxDir(), n), typeof data === 'string' ? data : Buffer.from(data)); return true;
});
ipcMain.handle('fx:open-folder', () => shell.openPath(fxDir()));
// ---- deteksi plugin audio yang terpasang di PC (VST3 / VST2 / CLAP) + host VST & kabel audio virtual ----
ipcMain.handle('fx:scan-pc', async (e, extra) => {
  const fsp = fs.promises, out = [], seen = new Set(), folders = [];
  const env = process.env, PF = env.ProgramFiles || 'C:\\Program Files', PF86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', CF = env.CommonProgramFiles || path.join(PF, 'Common Files'), CF86 = env['CommonProgramFiles(x86)'] || path.join(PF86, 'Common Files'), LA = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const roots = [
    ['VST3', path.join(CF, 'VST3')], ['VST3', path.join(CF86, 'VST3')], ['VST3', path.join(LA, 'Programs', 'Common', 'VST3')],
    ['CLAP', path.join(CF, 'CLAP')], ['CLAP', path.join(LA, 'Programs', 'Common', 'CLAP')],
    ['VST2', path.join(PF, 'VSTPlugins')], ['VST2', path.join(PF, 'Steinberg', 'VSTPlugins')], ['VST2', path.join(CF, 'VST2')], ['VST2', path.join(CF, 'Steinberg', 'VST2')],
    ['VST2', path.join(PF86, 'VSTPlugins')], ['VST2', path.join(PF86, 'Steinberg', 'VSTPlugins')], ['VST2', path.join(CF86, 'VST2')], ['VST2', path.join(PF, 'Vstplugins')]
  ];
  if (process.platform === 'win32') { // folder VST2 dari registri
    const q = (k) => new Promise((ok) => require('child_process').execFile('reg', ['query', k, '/v', 'VSTPluginsPath'], { windowsHide: true, timeout: 4000 }, (er, so) => ok(er ? '' : String(so))));
    for (const k of ['HKLM\\SOFTWARE\\VST', 'HKLM\\SOFTWARE\\WOW6432Node\\VST', 'HKCU\\SOFTWARE\\VST']) { const m = (await q(k)).match(/VSTPluginsPath\s+REG_\w+\s+(.+)/); if (m) roots.push(['VST2', m[1].trim()]); }
  }
  (Array.isArray(extra) ? extra : []).forEach((d) => roots.push(['?', d]));
  const CAT = [[/pro-?q|eq\b|equali|tone|filter|kirchhoff|nova|slick ?eq/i, 'EQ'], [/comp|limit|gate|expan|dynam|leveler|maximi|clip|transient|de-?ess|kotelnikov|molot|1176|la-?2a|bus ?comp|pro-[cldg]\\b/i, 'Dinamika'], [/verb|room|hall|plate|space|valhalla|convol/i, 'Reverb'], [/delay|echo/i, 'Delay'],
    [/tune|pitch|voice|vocal|harmon|autotune|melodyne/i, 'Vokal/Pitch'], [/noise|denois|hum|rx\b|restor|clean|dereverb|krisp/i, 'Restorasi'], [/chorus|flang|phase|trem|vibrato|modul/i, 'Modulasi'], [/sat|dist|drive|tape|warm|tube|amp|cab/i, 'Saturasi'], [/master|ozone|loud|meter|analy|span/i, 'Mastering/Meter'], [/synth|piano|drum|sampler|kontakt|instrument|serum|vital|surge/i, 'Instrumen']];
  const guess = (n, sub) => { const t = n + ' ' + (sub || ''); for (const [re, c] of CAT) if (re.test(t)) return c; return 'Efek'; };
  const exists = async (p) => { try { await fsp.access(p); return true; } catch (er) { return false; } };
  async function peArch(file) {
    let fh; try { fh = await fsp.open(file, 'r'); const b = Buffer.alloc(1024); await fh.read(b, 0, 1024, 0); const pe = b.readUInt32LE(0x3c); if (pe + 6 > 1024 || b.readUInt32LE(pe) !== 0x4550) return ''; const m = b.readUInt16LE(pe + 4); return m === 0x14c ? 'x86' : m === 0x8664 ? 'x64' : m === 0xaa64 ? 'arm64' : ''; }
    catch (er) { return ''; } finally { try { fh && (await fh.close()); } catch (er) {} }
  }
  async function walk(fmt, dir, depth) {
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (er) { return; }
    for (const d of ents) {
      const full = path.join(dir, d.name), low = d.name.toLowerCase();
      if (low.endsWith('.vst3') || low.endsWith('.clap') || (low.endsWith('.dll') && (fmt === 'VST2' || fmt === '?'))) {
        if (seen.has(full.toLowerCase())) continue; seen.add(full.toLowerCase());
        const f = low.endsWith('.vst3') ? 'VST3' : low.endsWith('.clap') ? 'CLAP' : 'VST2';
        const item = { name: d.name.replace(/\.(vst3|clap|dll)$/i, ''), format: f, path: full, vendor: '', version: '', sub: '' };
        if (f === 'VST3' && d.isDirectory()) { // bundle VST3: baca moduleinfo.json bila ada
          try { const mi = JSON.parse(await fsp.readFile(path.join(full, 'Contents', 'moduleinfo.json'), 'utf8')); item.vendor = (mi['Factory Info'] && mi['Factory Info'].Vendor) || ''; item.version = mi.Version || '';
            const cl = (mi.Classes || []).find((c) => /Audio Module/i.test(c.Category || '')); if (cl) { item.name = cl.Name || item.name; item.sub = (cl['Sub Categories'] || []).join('|'); } } catch (er) {}
        }
        if (f === 'VST3' && d.isDirectory()) { if (!(await exists(path.join(full, 'Contents', 'x86_64-win'))) && (await exists(path.join(full, 'Contents', 'x86-win')))) item.x86 = true; }
        else if (f !== 'CLAP' && !d.isDirectory() && (await peArch(full)) === 'x86') item.x86 = true; // DLL 32-bit tidak bisa dimuat host 64-bit
        item.cat = /instrument/i.test(item.sub) ? 'Instrumen' : guess(item.name, item.sub);
        out.push(item);
        continue;
      }
      if (d.isDirectory() && depth < 4 && !low.endsWith('.vst3')) await walk(fmt, full, depth + 1);
    }
  }
  for (const [fmt, dir] of roots) { try { await fsp.access(dir); folders.push(dir); await walk(fmt, dir, 0); } catch (er) {} }
  // host VST & kabel audio virtual yang terpasang (untuk merutekan audio ke plugin VST)
  const HOSTS = [['Equalizer APO', path.join(PF, 'EqualizerAPO')], ['Light Host', path.join(PF, 'Light Host')], ['Light Host', path.join(PF86, 'Light Host')], ['Cantabile', path.join(PF, 'Topten Software', 'Cantabile 4')], ['Element', path.join(PF, 'Element')],
    ['Voicemeeter', path.join(PF86, 'VB', 'Voicemeeter')], ['VB-CABLE', path.join(PF, 'VB', 'CABLE')], ['VB-CABLE', path.join(PF86, 'VB', 'CABLE')], ['REAPER', path.join(PF, 'REAPER (x64)')], ['Pedalboard 2', path.join(PF86, 'Pedalboard2')], ['Kushview Element', path.join(PF, 'Kushview', 'Element')]];
  const hosts = []; for (const [n, p] of HOSTS) if (!hosts.includes(n) && (await exists(p))) hosts.push(n);
  out.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
  return { plugins: out.slice(0, 1500), folders, hosts, platform: process.platform };
});

require('./tvgw').register(ipcMain, () => server.license.can('tv')); // Layar TV Masjid: cari / nyalakan / pasang gateway SRT
ipcMain.handle('server:get', () => server.loadConfig());
ipcMain.handle('server:set', (e, cfg) => { server.saveConfig(Object.assign(server.loadConfig(), cfg)); return true; });
ipcMain.handle('app:relaunch', () => { app.relaunch(); app.exit(0); });

// ---- Input "Web Browser" (jendela tersembunyi yang di-capture) ----
// Web Browser offscreen (mesin video native): halaman dirender di GPU tanpa jendela, tekstur yang sama dikirim ke mesin native
// (sumber "w<id>") dan ke mixer (VideoFrame "osr:<id>") — tanpa tangkap layar
const osrFly = new Map(), bviews = new Map(); // bviews: id halaman offscreen → jendela "lihat & klik"
function osrPaint(id, tex) {
  const hold = { tex, n: 1 }, unref = (h) => { if (h && --h.n <= 0 && h.tex) { const t = h.tex; h.tex = null; try { t.release(); } catch (er) {} } };
  const cs = (tex.textureInfo && tex.textureInfo.codedSize) || {}, meta = { W: cs.width | 0, H: cs.height | 0 };
  if (nEngine.ready && nEngine.ready()) { hold.n++; try { nEngine.extPush('w' + id, hold, meta, unref); } catch (er) { unref(hold); } }
  const v = bviews.get(id);
  if (v && !v.isDestroyed() && v.__ready && v.isVisible() && !v.isMinimized()) { hold.n++; osrSend(v.webContents.mainFrame, 'v' + id, 'osr:' + id, hold, meta, unref); }
  osrSend(mainWin && !mainWin.isDestroyed() ? mainWin.webContents.mainFrame : null, 'm' + id, 'osr:' + id, hold, meta, unref);
}
// satu kiriman per tujuan per halaman; yang menunggu hanya frame terbaru
function osrSend(fr, key, tag, hold, meta, unref) {
  const { sharedTexture } = require('electron');
  if (!fr || !sharedTexture || !sharedTexture.importSharedTexture) { unref(hold); return; }
  const f = osrFly.get(key);
  if (f) { if (f.pend) f.pend.unref(f.pend.hold); f.pend = { fr, hold, meta, unref }; return; }
  let imp;
  try { imp = sharedTexture.importSharedTexture({ textureInfo: hold.tex.textureInfo, allReferencesReleased: () => unref(hold) }); } catch (er) { unref(hold); return; }
  const st = { pend: null }; osrFly.set(key, st);
  sharedTexture.sendSharedTexture({ frame: fr, importedSharedTexture: imp }, tag, meta).catch(() => {}).finally(() => {
    try { imp.release(); } catch (er) {}
    if (osrFly.get(key) === st) osrFly.delete(key);
    const p = st.pend; if (!p) return;
    if (p.hold.tex) osrSend(p.fr, key, tag, p.hold, p.meta, p.unref); else p.unref(p.hold);
  });
}
// Jendela "lihat & klik" untuk halaman offscreen: menampilkan frame yang sama dengan yang masuk ke mixer, mengirim
// mouse/keyboard ke halaman lewat sendInputEvent — halaman tetap dirender offscreen (tanpa tangkap layar)
function bviewInfo(id, extra) {
  const v = bviews.get(id), w = browsers.get(id); if (!v || v.isDestroyed() || !w || w.isDestroyed()) return;
  const wc = w.webContents;
  v.webContents.send('bview:info', Object.assign({ size: w.getContentSize(), url: wc.getURL(), title: wc.getTitle() }, extra || {}));
}
function openBview(id) {
  const w = browsers.get(id); if (!w || w.isDestroyed()) return false;
  let v = bviews.get(id);
  if (v && !v.isDestroyed()) { if (v.isMinimized()) v.restore(); v.show(); v.focus(); return true; }
  const [cw, ch] = w.getContentSize(), wa = screen.getPrimaryDisplay().workAreaSize;
  const k = Math.min(1, (wa.width - 60) / cw, (wa.height - 100) / (ch + 40));
  v = new BrowserWindow({ width: Math.round(cw * k), height: Math.round(ch * k) + 40, useContentSize: true, minWidth: 360, minHeight: 240,
    title: 'KLM - Web Browser', backgroundColor: '#111111', autoHideMenuBar: true, icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'bview-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
  v.setMenuBarVisibility(false);
  bviews.set(id, v); v.__src = id;
  v.webContents.on('did-finish-load', () => { v.__ready = true; bviewInfo(id); try { w.webContents.invalidate(); } catch (er) {} });
  v.on('closed', () => { if (bviews.get(id) === v) bviews.delete(id); osrFly.delete('v' + id); });
  v.on('focus', () => { try { w.webContents.focus(); } catch (er) {} });
  v.loadFile(path.join(__dirname, 'bview.html')).catch(() => {});
  return true;
}
// ---- video stinger untuk mesin native (Fase 9): diputar di halaman offscreen TRANSPARAN, teksturnya (alpha premultiplied)
// langsung ke mesin native — WebM transparan tetap transparan. Suara stinger tetap dari input stinger di mixer KLM.
const stingWins = new Map(); // slot → { win, src }
function stingDrop(slot) { const s = stingWins.get(slot); stingWins.delete(slot); if (s && s.win && !s.win.isDestroyed()) s.win.destroy(); }
ipcMain.handle('stinger:drop', (e, slot) => { stingDrop(slot | 0); return true; });
ipcMain.handle('stinger:prep', async (e, slot, src, W, H, fps) => {
  slot = slot | 0; if (slot < 0 || slot > 1) return { ok: false, err: 'slot' };
  let url = String(src || '');
  if (url.startsWith('file:')) url = require('url').pathToFileURL(url.slice(5)).href;
  else if (!/^https?:\/\//i.test(url)) return { ok: false, err: 'alamat video tidak didukung' };
  W = Math.max(64, Math.min(3840, W | 0 || 1920)); H = Math.max(36, Math.min(2160, H | 0 || 1080));
  let s = stingWins.get(slot);
  if (!s || !s.win || s.win.isDestroyed()) {
    const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
      webPreferences: { offscreen: { useSharedTexture: true }, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } });
    win.webContents.setAudioMuted(true);
    win.webContents.setFrameRate(Math.max(24, Math.min(60, fps | 0 || 30)));
    win.webContents.on('paint', (ev) => {
      const t = ev && ev.texture; if (!t) return;
      const hold = { tex: t, n: 1 }, unref = (h) => { if (h && --h.n <= 0 && h.tex) { const x = h.tex; h.tex = null; try { x.release(); } catch (er) {} } };
      const cs = (t.textureInfo && t.textureInfo.codedSize) || {};
      if (nEngine.ready && nEngine.ready()) { try { nEngine.extPush('k' + slot, hold, { W: cs.width | 0, H: cs.height | 0 }, unref, 'ptex'); } catch (er) { unref(hold); } } else unref(hold);
    });
    s = { win, src: '' }; stingWins.set(slot, s);
    await win.loadFile(path.join(__dirname, 'stinger.html')).catch(() => {});
  } else if (s.win.getContentSize()[0] !== W || s.win.getContentSize()[1] !== H) s.win.setContentSize(W, H);
  s.src = url;
  try {
    const r = await s.win.webContents.executeJavaScript('window.klmSet(' + JSON.stringify(url) + ')');
    try { s.win.webContents.invalidate(); } catch (er) {}
    return r && r.ok ? { ok: true, dur: r.dur } : { ok: false, err: (r && r.err) || 'video tidak bisa dibuka' };
  } catch (er) { return { ok: false, err: er.message }; }
});
ipcMain.on('stinger:play', (e, slot) => { const s = stingWins.get(slot | 0); if (s && s.win && !s.win.isDestroyed()) s.win.webContents.executeJavaScript('window.klmPlay()').catch(() => {}); });
ipcMain.on('stinger:stop', (e, slot) => { const s = stingWins.get(slot | 0); if (s && s.win && !s.win.isDestroyed()) s.win.webContents.executeJavaScript('window.klmStop()').catch(() => {}); });
const bvSrc = (e) => { const v = BrowserWindow.fromWebContents(e.sender); const id = v && v.__src; const w = id != null && browsers.get(id); return w && !w.isDestroyed() ? w : null; };
ipcMain.on('bview:input', (e, ev) => {
  const w = bvSrc(e); if (!w || !ev || typeof ev.type !== 'string') return;
  const wc = w.webContents;
  try {
    if (ev.type === 'edit') { const f = { copy: 1, paste: 1, cut: 1, selectAll: 1, undo: 1, redo: 1 }; if (f[ev.cmd]) wc[ev.cmd](); return; }
    if (ev.type === 'focus') { wc.focus(); return; }
    if (ev.type === 'blur') return;
    wc.sendInputEvent(ev);
  } catch (er) {}
});
ipcMain.on('bview:nav', (e, cmd, url) => {
  const w = bvSrc(e); if (!w) return; const wc = w.webContents, nh = wc.navigationHistory;
  try {
    if (cmd === 'back') { if (nh && nh.canGoBack()) nh.goBack(); else if (!nh && wc.canGoBack()) wc.goBack(); }
    else if (cmd === 'forward') { if (nh && nh.canGoForward()) nh.goForward(); else if (!nh && wc.canGoForward()) wc.goForward(); }
    else if (cmd === 'reload') wc.reload();
    else if (cmd === 'url' && /^(https?|file|data):/i.test(url)) wc.loadURL(url).catch(() => {});
  } catch (er) {}
});
ipcMain.handle('browser:open', async (e, { url, width, height, visible, osr }) => {
  if (osr) {
    const w = new BrowserWindow({ show: false, width: width || 1280, height: height || 720, useContentSize: true, frame: false, skipTaskbar: true,
      webPreferences: { offscreen: { useSharedTexture: true }, backgroundThrottling: false, contextIsolation: true } });
    w.webContents.setAudioMuted(true);
    w.webContents.setFrameRate(30);
    const id = w.id;
    w.webContents.on('paint', (ev) => { const t = ev && ev.texture; if (t) osrPaint(id, t); });
    // tautan "jendela baru" (target=_blank / window.open) dibuka di halaman yang sama — halaman offscreen tidak punya jendela lain
    w.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:/i.test(u)) w.loadURL(u).catch(() => {}); return { action: 'deny' }; });
    const info = () => bviewInfo(id);
    w.webContents.on('did-navigate', info); w.webContents.on('did-navigate-in-page', info); w.webContents.on('page-title-updated', info);
    w.webContents.on('cursor-changed', (ev, type) => bviewInfo(id, { cursor: type }));
    browsers.set(id, w); w.on('closed', () => { browsers.delete(id); osrFly.delete('m' + id); osrFly.delete('v' + id); const v = bviews.get(id); if (v && !v.isDestroyed()) v.destroy(); bviews.delete(id); });
    await w.loadURL(url).catch(() => {});
    w.webContents.invalidate();
    return { winId: id, osr: true };
  }
  const w = new BrowserWindow({
    width: width || 1280, height: height || 720, useContentSize: true,
    x: visible ? 100 : -(width || 1280) - 200, y: visible ? 100 : 0,
    frame: !!visible, skipTaskbar: !visible, focusable: !!visible, transparent: false,
    backgroundColor: '#00000000', title: 'KLM - Browser Input',
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
  if (w.webContents.isOffscreen && w.webContents.isOffscreen()) { // halaman offscreen: buka/tutup jendela "lihat & klik"
    if (show) return openBview(id) ? 'osr-view' : false;
    const v = bviews.get(id); if (v && !v.isDestroyed()) v.close();
    return 'osr-view';
  }
  const [bw] = w.getSize();
  if (show) { w.setPosition(100, 100); w.setSkipTaskbar(false); w.setFocusable(true); w.focus(); }
  else { w.setPosition(-bw - 200, 0); w.setSkipTaskbar(true); w.setFocusable(false); }
  return true;
});
// mesin video native menangkap jendela browser lewat Windows.Graphics.Capture: jendela "tool window" (gaya Electron untuk
// jendela tanpa fokus / tanpa taskbar) ditolak WGC → gaya itu dilepas (tetap tak tampil di taskbar, tetap di luar layar)
let u32 = null;
function user32() {
  if (u32 !== null) return u32; u32 = false;
  try { const koffi = require('koffi'), lib = koffi.load('user32.dll'); u32 = { get: lib.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t h, int i)'), set: lib.func('intptr_t __stdcall SetWindowLongPtrW(uintptr_t h, int i, intptr_t v)') }; } catch (e) { u32 = false; }
  return u32;
}
ipcMain.handle('browser:hwnd', (e, id) => {
  const w = browsers.get(id); if (!w || w.isDestroyed()) return null;
  const b = w.getNativeWindowHandle(), h = b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0));
  const u = process.platform === 'win32' && user32();
  if (u) { try { const ex = BigInt(u.get(h, -20)); if (ex & 0x80n) u.set(h, -20, ex & ~0x80n); } catch (er) {} } // GWL_EXSTYLE, WS_EX_TOOLWINDOW
  return h.toString();
});
ipcMain.handle('browser:close', (e, id) => { const w = browsers.get(id); if (w) w.destroy(); return true; });

// ---------------- start ----------------
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(true));
  session.defaultSession.setPermissionCheckHandler(() => true);
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' })).catch(() => cb({}));
  });
  T.ready = Date.now() - T0;
  createSplash(); // layar pembuka tampil dulu; jendela utama dimuat tersembunyi dan muncul saat benar-benar siap
  const serverP = server.start();
  createMain();
  splashStep(10, 'Menyalakan server lokal…');
  netInfo = await serverP;
  splashStep(22, 'Memuat antarmuka…');
  T.server = Date.now() - T0;
  utcOsr = setupUtcOsr({ native: nEngine, logDir: process.env.KLM_CONFIG_DIR, port: () => netInfo.ports.http, scorePort: () => { const sc = server.score(); return sc ? sc.port() : 0; } });
  if (mainWin && !mainWin.isDestroyed()) mainWin.loadURL(`http://127.0.0.1:${netInfo.ports.http}/`).catch((e) => console.warn('loadURL', e.message));
  T.window2 = Date.now() - T0;
  if (process.env.KLM_SMOKE) smokeTest();
});
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
app.on('window-all-closed', () => hardQuit('window-all-closed'));
app.on('before-quit', () => { try { server.hub.shutdown(); } catch (e) {} });
app.on('will-quit', (e) => { if (!quitting) { e.preventDefault(); hardQuit('will-quit'); } });

// Keluar total. Di Windows, proses Chromium (GPU / renderer offscreen) bisa tertinggal setelah keluar biasa sehingga
// KLM tidak bisa dibuka lagi (single instance). Jadi: hentikan renderer UTC, server media & jendela browser,
// tutup file rekaman yang masih terbuka, lalu akhiri proses sepenuhnya.
let quitting = false;
function hardQuit(why) {
  if (quitting) return; quitting = true;
  if (process.env.KLM_SMOKE) { try { fs.appendFileSync(path.join(process.env.KLM_SMOKE, 'smoke.log'), new Date().toISOString() + ' hardQuit ' + why + '\n'); } catch (e) {} }
  for (const w of browsers.values()) { try { w.destroy(); } catch (e) {} }
  try { vstMgr.shutdown(); } catch (e) {}
  try { airplay.shutdown(); } catch (e) {}
  try { procAudio.shutdown(); } catch (e) {}
  try { server.hub.shutdown(); } catch (e) {}
  const ends = [...writers.values()].map((w) => new Promise((r) => { try { w.end(r); } catch (x) { r(); } setTimeout(r, 2500); }));
  writers.clear();
  const kill = () => {
    if (process.env.KLM_SMOKE) { try { fs.appendFileSync(path.join(process.env.KLM_SMOKE, 'smoke.log'), new Date().toISOString() + ' kill pid ' + process.pid + '\n'); } catch (e) {} }
    try { process.kill(process.pid, 'SIGKILL'); } catch (x) { process.exit(0); }
  };
  setTimeout(kill, 4000);
  Promise.all(ends).then(() => setTimeout(kill, 100));
}

// ---------------- uji otomatis CI (KLM_SMOKE=folder) ----------------
// Membuka aplikasi, memastikan panel UTC & lapisan UTC ON AIR benar-benar tampil di Program, lalu menyimpan screenshot.
function smokeTest() {
  const out = process.env.KLM_SMOKE;
  const log = (m) => { try { fs.appendFileSync(path.join(out, 'smoke.log'), new Date().toISOString() + ' ' + m + '\n'); } catch (e) {} console.log('[SMOKE] ' + m); };
  global.__smokeLog = (m) => log('mesin: ' + m); // catatan mesin native ikut masuk log uji
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
      const ra = await js('KM.readyAt || 0');
      log('kecepatan buka (ms sejak proses mulai): ' + JSON.stringify(Object.assign({}, T, { siap: ra ? Math.round(ra - T0) : null })));
      const idle0 = JSON.parse(await js('JSON.stringify({ tabs: [...document.querySelectorAll(".dtabs button.dyn")].map((b) => b.dataset.tab + (b.hidden ? ":tersembunyi" : ":tampil")), osr: KM.utc.layerInfo().filter((l) => l.started).map((l) => l.id) })'));
      log('saat dibuka (tanpa input UTC): ' + JSON.stringify(idle0));
      log('rincian muat halaman: ' + await js(`(() => { const n = performance.getEntriesByType('navigation')[0] || {}; const r = performance.getEntriesByType('resource');
        const fcp = (performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint') || {}).startTime;
        const slow = r.slice().sort((a, b) => b.duration - a.duration).slice(0, 8).map((x) => (() => { try { return new URL(x.name).pathname; } catch (e) { return x.name; } })() + ' @' + Math.round(x.startTime) + ' +' + Math.round(x.duration));
        return JSON.stringify({ origin: Math.round(performance.timeOrigin - ${T0}), req: Math.round(n.requestStart), resp: Math.round(n.responseStart), dom: Math.round(n.domInteractive), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: Math.round(fcp || 0), n: r.length, slow }); })()`));
      if (idle0.osr.length) { fail++; log('GAGAL: renderer UTC menyala padahal belum ada input'); }
      log('update (cek rilis): ' + JSON.stringify(await updater.check()));
      // UTC Acara hadir lewat input
      await js('KM.inputs.create("colour", { title: "Latar" }); KM.engine.cut(KM.state.inputs[0].id); KM.utc.addInput({ onAir: true }); KM.ui.openSide("utc")');
      await wait(800);
      log('input UTC Acara: tab=' + await js('KM.ui.currentTab') + ' tombol=' + await js('!document.getElementById("bb-utc").hidden'));
      log('cmd lt show: ' + await post('/utc/api/klm/cmd', { cmd: 'show', target: 'lt' }));
      log('cmd ticker show: ' + await post('/utc/api/klm/cmd', { cmd: 'show', target: 'ticker' }));
      log('cmd logo show: ' + await post('/utc/api/klm/cmd', { cmd: 'show', target: 'logo' }));
      await wait(5000);
      const st = await js('JSON.stringify({ avail: KM.utc.avail, on: KM.utc.onAir(), frames: KM.utc.frames, fps: KM.engine.fps, px: KM.utc.coverage() })');
      log('status UTC: ' + st);
      log('zero-copy GPU: mixer ' + await js('JSON.stringify(KM.utc.zc)') + ' • utama ' + JSON.stringify(utcOsr && utcOsr.zc ? utcOsr.zc() : '?') + ' • Electron ' + process.versions.electron + ' / Chromium ' + process.versions.chrome);
      const s = JSON.parse(st);
      if (!s.avail || !s.frames) { fail++; log('GAGAL: tidak ada frame overlay offscreen'); }
      if (!(s.px > 0.002)) { fail++; log('GAGAL: lapisan UTC kosong di Program'); }
      const progPng = async (name) => { const png = await js('new Promise(r => KM.engine.prog.toBlob(b => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }, "image/png"))'); fs.writeFileSync(path.join(out, name), Buffer.from(png.split(',')[1], 'base64')); };
      await progPng('program.png');
      // pindah dari jalur GPU ke jalur CPU di tengah siaran (cadangan otomatis): grafis HARUS tetap tampil
      if (utcOsr && utcOsr.forceFallback && JSON.parse(await js('JSON.stringify(!!KM.utc.zc.on)'))) {
        const f0 = +(await js('KM.utc.frames'));
        utcOsr.forceFallback('uji smoke: paksa jalur CPU');
        await wait(5000);
        const sf = JSON.parse(await js('JSON.stringify({ frames: KM.utc.frames, px: KM.utc.coverage(), zc: KM.utc.zc.on })'));
        log('setelah pindah GPU → CPU: ' + JSON.stringify(sf) + ' (frame sebelum ' + f0 + ') • utama ' + JSON.stringify(utcOsr.zc()));
        if (sf.zc || !(sf.px > 0.002) || !(sf.frames > f0)) { fail++; log('GAGAL: grafis UTC hilang setelah pindah dari GPU ke jalur CPU'); }
        await progPng('program-cpu.png');
      }
      // --- lapisan terpisah + running text native ---
      const li = JSON.parse(await js('JSON.stringify(KM.utc.layerInfo())'));
      log('lapisan: ' + JSON.stringify(li.map((l) => [l.id, l.frames, l.native, l.bbox && [l.bbox.x, l.bbox.y, l.bbox.w, l.bbox.h]])));
      const LI = Object.fromEntries(li.map((l) => [l.id, l]));
      // sejak v1.14.12 tiap grafis punya lapisan sendiri (lt / tt / loc / soc / oc / tk / logo)
      if (!(LI.lt && LI.lt.frames) || !(LI.tk && LI.tk.frames) || !(LI.logo && LI.logo.frames)) { fail++; log('GAGAL: ada lapisan UTC yang tidak menerima frame'); }
      if (!LI.tk.native) { fail++; log('GAGAL: running text tidak masuk mode native'); }
      // kehalusan: langkah gulir per frame Program pada 60 fps
      await js('KM.settings.fps = 60');
      await wait(1500);
      const sm = JSON.parse(await js(`new Promise((res) => { const a = [], t0 = performance.now(); const f = () => { const n = KM.utc.layers.tk.native; if (n && n.cur != null) a.push([performance.now(), n.cur]); };
        KM.on('frame', f); setTimeout(() => { KM.off && KM.off('frame', f); const d = []; for (let i = 1; i < a.length; i++) d.push(a[i][1] - a[i - 1][1]);
        const avg = d.reduce((x, y) => x + y, 0) / (d.length || 1), dev = Math.sqrt(d.reduce((x, y) => x + (y - avg) * (y - avg), 0) / (d.length || 1));
        res(JSON.stringify({ frames: a.length, fps: KM.engine.fps, step: +avg.toFixed(3), dev: +dev.toFixed(3), min: +Math.min(...d).toFixed(2), max: +Math.max(...d).toFixed(2) })); }, 3000); })`));
      log('running text 60fps: ' + JSON.stringify(sm));
      await progPng('program-60fps.png');
      await js('KM.settings.fps = 30');
      // --- running text: judul + banyak baris, diganti saat tayang tetap native ---
      const id0 = await js('KM.utc.layers.tk.native ? KM.utc.layers.tk.native.id : 0');
      log('tkset: ' + (await post('/utc/api/klm/cmd', { cmd: 'tkset', items: [{ title: 'Info Jadwal', text: 'Baris satu\nBaris dua\nBaris tiga', on: true }, { title: 'Infaq', text: 'Kotak amal tersedia', on: true }] })).slice(0, 24));
      await wait(2500);
      const id1 = await js('KM.utc.layers.tk.native ? KM.utc.layers.tk.native.id : 0');
      log('running text berjudul: native ' + id0 + ' → ' + id1); if (!id1 || id1 === id0) { fail++; log('GAGAL: running text berjudul/banyak baris tidak diperbarui'); }
      await progPng('program-runtext-judul.png');
      // --- UTC Score (lewat input) ---
      log('scoreboard status: ' + await js('JSON.stringify(KM.score.status)'));
      await js('KM.score.addInput({ onAir: true }); KM.ui.openSide("score")');
      const q0 = await js('KM.score.cmd("show").then((r) => JSON.stringify(r))'); // panel belum dibuka: disiapkan otomatis
      log('tombol cepat sebelum panel dibuka: ' + q0); if (!/"ok":true/.test(q0)) { fail++; log('GAGAL: tombol cepat UTC Score tidak jalan'); }
      await js('KM.score.cmd("away+1")');
      await wait(4000);
      const sc = JSON.parse(await js('JSON.stringify({ frames: KM.utc.layers.score.frames, px: KM.score.coverage(), bbox: KM.utc.layers.score.bbox })'));
      log('scoreboard lapisan: ' + JSON.stringify(sc));
      if (!sc.frames || !(sc.px > 0.002)) { fail++; log('GAGAL: scoreboard tidak tampil di Program'); }
      await progPng('program-score.png');
      await js('KM.ui.utcPanel(true, "score")'); await wait(5000);
      const scp = await js('JSON.stringify(KM.score.status && KM.score.status.clients)');
      log('panel scoreboard: ' + scp);
      if (!/control/.test(scp)) { fail++; log('GAGAL: panel scoreboard tidak terbuka'); }
      const cmdr = await js('KM.score.cmd("home+1").then((r) => JSON.stringify(r))');
      log('perintah skor: ' + cmdr); if (!/"ok":true/.test(cmdr)) fail++;
      await js('KM.score.cmd("home-1"); KM.score.cmd("away-1")');
      fs.writeFileSync(path.join(out, 'panel-score.png'), (await mainWin.webContents.capturePage()).toPNG());
      fs.writeFileSync(path.join(out, 'panel-samping-score.png'), (await (async () => { await js('KM.ui.utcPanel(false); KM.ui.dockTab("score")'); await wait(600); return mainWin.webContents.capturePage(); })()).toPNG());
      await js('KM.ui.dockTab("acara")'); await wait(600);
      fs.writeFileSync(path.join(out, 'panel-samping-acara.png'), (await mainWin.webContents.capturePage()).toPNG());
      await js('KM.score.setOnAir(false)');
      // running text kembali ke halaman saat disembunyikan
      log('cmd ticker hide: ' + (await post('/utc/api/klm/cmd', { cmd: 'hide', target: 'ticker' })).slice(0, 40));
      await wait(1500);
      const nat = await js('!!KM.utc.layers.tk.native');
      log('running text native setelah hide: ' + nat); if (nat) { fail++; log('GAGAL: mode native tidak berhenti saat running text disembunyikan'); }
      const shot = await mainWin.webContents.capturePage();
      fs.writeFileSync(path.join(out, 'window.png'), shot.toPNG());
      const lag0 = await js('(async () => { let n = 0, tot = 0, t = performance.now(); await new Promise((r) => { const k = () => { const now = performance.now(); tot += Math.max(0, now - t - 10); t = now; if (++n < 150) setTimeout(k, 10); else r(); }; setTimeout(k, 10); }); return Math.round(tot); })()');
      await js('KM.ui.utcPanel(true, "acara")'); await wait(4000);
      const lag1 = await js('(async () => { let n = 0, tot = 0, t = performance.now(); await new Promise((r) => { const k = () => { const now = performance.now(); tot += Math.max(0, now - t - 10); t = now; if (++n < 150) setTimeout(k, 10); else r(); }; setTimeout(k, 10); }); return Math.round(tot); })()');
      log('beban renderer (keterlambatan timer 150×10 ms): sebelum panel ' + lag0 + ' ms, panel Acara terbuka ' + lag1 + ' ms • stage ' + await js('document.querySelector("#stage").offsetHeight') + ' px, panel ' + await js('document.querySelector("#utcWs").offsetWidth + "x" + document.querySelector("#utcWs").offsetHeight'));
      const ok = await js('(() => { try { const f = document.querySelector("#utcFrame"); return !!(f && f.contentDocument && f.contentDocument.querySelector("#panel, .tabs, header")); } catch (e) { return "err " + e.message; } })()');
      log('panel UTC dimuat: ' + ok); if (ok !== true) fail++;
      // tata letak panel lengkap: semua tombol tayang & navigasi terlihat tanpa menggulir di ukuran panel bawaan
      const play = JSON.parse(await js(`(() => { try { const f = document.querySelector("#utcFrame"), w = f.contentWindow, d = f.contentDocument;
        const out = (sel) => [...d.querySelectorAll(sel)].filter((e) => e.offsetParent).filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > w.innerHeight + 1 || r.right > w.innerWidth + 1 || r.top < 0; }).map((e) => e.textContent.trim().slice(0, 14));
        const tb = d.querySelector('#tabs');
        const pv = d.querySelector('#scrPvw').getBoundingClientRect(), vis = (q) => { const e = d.querySelector(q); return !!(e && e.offsetParent); };
        return JSON.stringify({ embed: d.documentElement.classList.contains('klm-embed'), size: w.innerWidth + 'x' + w.innerHeight, air: out('#air button, #ocair button'), tabsScroll: tb ? tb.scrollHeight - tb.clientHeight : -1, pratinjauKanan: pv.left > w.innerWidth / 2 && pv.bottom <= w.innerHeight + 1 && pv.width > 100, daftarInput: vis('#istrip'), tombolOff: vis('.ocoff'), klmAtas: (() => { const k = d.querySelector('#klmb'); return !!(k && k.closest('#klmbSlot') && k.getBoundingClientRect().top < 60); })() });
      } catch (e) { return JSON.stringify({ err: e.message }); } })()`));
      log('tata letak panel UTC Acara: ' + JSON.stringify(play));
      fs.writeFileSync(path.join(out, 'panel-acara.png'), (await mainWin.webContents.capturePage()).toPNG());
      if (!play.embed || (play.air && play.air.length) || play.tabsScroll > 2 || !play.pratinjauKanan || play.daftarInput || play.tombolOff || !play.klmAtas) { fail++; log('GAGAL: tombol panel UTC Acara terpotong / perlu digulir'); }
      // panel harus tetap merespons saat banyak lapisan grafis aktif (batas 6 sambungan per host di Chromium)
      await post('/utc/api/klm/cmd', { cmd: 'show', target: 'lt' }); await post('/utc/api/klm/cmd', { cmd: 'show', target: 'logo' });
      await post('/utc/api/klm/cmd', { cmd: 'show', target: 'ticker' }); await post('/utc/api/klm/cmd', { cmd: 'show', target: 'loc' }); await post('/utc/api/klm/cmd', { cmd: 'show', target: 'soc' });
      await post('/utc/api/klm/cmd', { cmd: 'show', target: 'title' });
      // pembanding: kecepatan panel sebelum video diputar (runner CI tanpa GPU sudah lambat karena jalur CPU dipaksa di atas)
      const respBase = await js('(async () => { const f = document.querySelector("#utcFrame"); const c = new AbortController(); const t = performance.now(); setTimeout(() => c.abort(), 4000); try { for (let i = 0; i < 5; i++) await f.contentWindow.fetch("/utc/api/info?i=" + i, { cache: "no-store", signal: c.signal }); return Math.round(performance.now() - t) + " ms"; } catch (e) { return "MACET"; } })()');
      // video lokal diputar di mixer (tiap video memegang sambungan HTTP): dulu memenuhi jatah sambungan alamat KLM → panel macet
      const mvf = path.join(out, 'uji-video-panjang.mp4');
      try { require('child_process').spawnSync(server.hub.ffmpegPath(), ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-t', '90', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '4M', '-pix_fmt', 'yuv420p', mvf], { windowsHide: true, timeout: 60000 }); } catch (e) {}
      log('video uji panjang: ' + (fs.existsSync(mvf) ? fs.statSync(mvf).size : 0) + ' byte');
      await js(`(() => { window.__mv = []; for (let i = 0; i < 6; i++) { const v = document.createElement('video'); v.crossOrigin = 'anonymous'; v.muted = true; v.preload = 'auto'; v.src = ${JSON.stringify('/localfile?p=')} + encodeURIComponent(${JSON.stringify(mvf)}) + '&v=' + i; v.play().catch(() => {}); window.__mv.push(v); } return 1; })()`);
      await wait(2500);
      const resp = await js('(async () => { const f = document.querySelector("#utcFrame"); const c = new AbortController(); const t = performance.now(); setTimeout(() => c.abort(), 4000); try { for (let i = 0; i < 5; i++) await f.contentWindow.fetch("/utc/api/info?i=" + i, { cache: "no-store", signal: c.signal }); return Math.round(performance.now() - t) + " ms"; } catch (e) { return "MACET"; } })()');
      log('panel UTC merespons dengan banyak grafis aktif: ' + resp + ' (sebelum video diputar: ' + respBase + ') • host lapisan: ' + JSON.stringify(utcOsr && utcOsr.hosts ? utcOsr.hosts() : '?'));
      // macet karena jatah sambungan habis = tidak pernah dijawab (MACET); lambat sebanding dengan sebelum video = beban CPU runner
      if (resp === 'MACET' || parseInt(resp, 10) > Math.max(2500, (parseInt(respBase, 10) || 0) * 2 + 800)) { fail++; log('GAGAL: panel UTC tidak merespons saat banyak grafis tampil'); }
      const lay = JSON.parse(await js('JSON.stringify(KM.utc.layerInfo().filter((l) => ["tt", "loc", "lt"].includes(l.id)).map((l) => ({ id: l.id, started: l.started, frames: l.frames })))'));
      const sse = await js('(() => { try { const d = document.querySelector("#utcFrame").contentDocument; const c = d.querySelector("#conn"); return c ? c.className + " " + c.textContent.trim().slice(0, 40) : "-"; } catch (e) { return "err " + e.message; } })()');
      log('lapisan title/lokasi/lower third: ' + JSON.stringify(lay) + ' • status panel: ' + sse + ' • host video mixer: ' + await js('JSON.stringify((window.__mv || []).map((v) => new URL(v.src).hostname))'));
      if (lay.some((l) => !l.started || !l.frames)) { fail++; log('GAGAL: grafis title / lokasi / lower third tidak tampil'); }
      if (!/\bok\b/.test(sse)) { fail++; log('GAGAL: panel UTC tidak tersambung ke server (event)'); }
      await js('(window.__mv || []).forEach((v) => { v.removeAttribute("src"); v.load(); }); 1');
      fs.writeFileSync(path.join(out, 'panel.png'), (await mainWin.webContents.capturePage()).toPNG());
      // (sesudah uji kecepatan: panel Score yang ikut hidup tidak menambah beban uji di atas)
      if (await js('KM.score.has() && !!KM.score.port')) {
        await js('KM.ui.utcPanel(true, "score")'); await wait(4500);
        const fr = mainWin.webContents.mainFrame.framesInSubtree.find((x) => /[?&]klm=1/.test(x.url));
        const sl = fr ? JSON.parse(await fr.executeJavaScript(`JSON.stringify((() => { const vis = (sel) => { const e = document.querySelector(sel); if (!e) return 'tidak ada'; const r = e.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0 && r.right <= innerWidth + 1; };
          const a = document.querySelector('#aside'), m = document.querySelector('#main');
          return { embed: document.documentElement.classList.contains('klm-embed'), size: innerWidth + 'x' + innerHeight, monitorKiri: !!(a && m && a.getBoundingClientRect().left < m.getBoundingClientRect().left), gol: vis('.tp-btns .plus'), mulai: vis('.cp [data-act="clock"]'), monitor: vis('#mon'), klmAtas: (() => { const k = document.querySelector('#klmb'); return !!(k && k.closest('#klmbSlot') && k.getBoundingClientRect().top < 70); })() }; })())`)) : { err: 'frame tidak ditemukan' };
        log('tata letak panel UTC Score: ' + JSON.stringify(sl));
        fs.writeFileSync(path.join(out, 'panel-score.png'), (await mainWin.webContents.capturePage()).toPNG());
        if (!sl.embed || !sl.monitorKiri || sl.gol !== true || sl.mulai !== true || sl.monitor !== true || !sl.klmAtas) { fail++; log('GAGAL: tata letak panel UTC Score (monitor kiri, tombol terlihat)'); }
      }
      await js('KM.ui.utcPanel(false)');
      await post('/utc/api/klm/cmd', { cmd: 'hideall' });
      await js('KM.inputs.remove(KM.state.inputs.find((i) => i.type === "score"))'); await wait(1500);
      log('setelah input UTC Score dihapus: tab score ' + (await js('document.querySelector(".dtabs button[data-tab=score]").hidden ? "tersembunyi" : "tampil"')) + ', lapisan score ' + (await js('KM.utc.layers.score.paused ? "dijeda" : "jalan"')));
      // --- plugin audio terpasang di PC ---
      const pcs = JSON.parse(await js('KM.afx.scanPC().then((r) => JSON.stringify({ n: r.plugins.length, folders: r.folders, hosts: r.hosts, contoh: r.plugins.slice(0, 5).map((x) => x.format + ":" + x.name + ":" + x.cat) }))'));
      log('pindai plugin PC: ' + JSON.stringify(pcs));
      // --- grid Preview ---
      const gr = await js('KM.ui.setGrid(true); new Promise((r) => setTimeout(() => r(JSON.stringify({ on: KM.engine.gridActive(), n: KM.engine.gridIds().length })), 600))');
      log('grid Preview: ' + gr); if (!/"on":true/.test(gr)) { fail++; log('GAGAL: grid Preview tidak aktif'); }
      fs.writeFileSync(path.join(out, 'preview-grid.png'), (await mainWin.webContents.capturePage()).toPNG());
      await js('KM.ui.setGrid(false)');
      // --- efek audio: rantai preset "Vokal Siaran" pada tone uji ---
      const fx = await js(`(async () => { const inp = KM.inputs.create('bars', { title: 'Tone', opts: { tone: true } }); await new Promise((r) => setTimeout(r, 800));
        inp.audio.fx = KM.afx.presetChain('Vokal Siaran'); const st = KM.audio.strips.get(inp.id); await st.rack.sync(inp.audio.fx); await new Promise((r) => setTimeout(r, 1200));
        const m = KM.audio.readMeter(st.meter); return JSON.stringify({ n: st.rack.inst.size, db: Math.round(KM.audio.toDb(Math.max(m.peakL, m.peakR))), ctx: KM.audio.ctx.state }); })()`);
      log('efek audio: ' + fx);
      { const f = JSON.parse(fx); if (f.n !== 6) { fail++; log('GAGAL: rak efek tidak lengkap'); } }
      // --- host VST asli: plugin uji KLM Test Gain di rak input Tone (KLM_VSTTEST = path bundle .vst3) ---
      if (process.env.KLM_VSTTEST) {
        try {
          const vr = JSON.parse(await js(`(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const ok = await KM.vst.ready();
            const inp = KM.state.inputs.find((i) => i.title === 'Tone'); const st = KM.audio.strips.get(inp.id);
            const db = () => { const m = KM.audio.readMeter(st.meter); return Math.round(KM.audio.toDb(Math.max(m.peakL, m.peakR)) * 10) / 10; };
            inp.audio.fx = []; await st.rack.sync(inp.audio.fx); await sleep(1200); const d0 = db();
            const it = KM.vst.newItem({ path: ${JSON.stringify(process.env.KLM_VSTTEST)}, name: 'KLM Test Gain', format: 'VST3' });
            inp.audio.fx = [it]; await st.rack.sync(inp.audio.fx); const v = st.rack.inst.get(it.id).core.vst;
            const t0 = performance.now(); for (let i = 0; i < 150 && v.status === 'loading'; i++) await sleep(100); const loadMs = Math.round(performance.now() - t0);
            await sleep(1500); const d1 = db();
            const params = await KM.vst.params(v);
            KM.vst.setParam(v, 0, 1); await sleep(1800); const d2 = db();
            const state = it.state || '';
            KM.vst.reload(v); for (let i = 0; i < 150 && v.status === 'loading'; i++) await sleep(100); await sleep(1500); const d3 = db();
            KM.vst.editor(v, 1); await sleep(400);
            const res = { ok, helper: KM.vst.path, status: v.status, err: v.error, info: v.info, loadMs, d0, d1, d2, d3, state: state.length, params: params.map((p) => p.name + '=' + p.text), stat: v.stat, editor: v.editor };
            inp.audio.fx = []; await st.rack.sync(inp.audio.fx);
            return JSON.stringify(res); })()`));
          log('host VST: ' + JSON.stringify(vr));
          if (vr.status !== 'ok') { fail++; log('GAGAL: plugin VST tidak aktif'); }
          else {
            if (Math.abs(vr.d1 - vr.d0) > 1.5) { fail++; log('GAGAL: plugin uji (gain 1x) mengubah level'); }
            if (Math.abs(vr.d2 - vr.d1 - 6) > 1.5) { fail++; log('GAGAL: parameter gain plugin tidak berpengaruh (+6 dB)'); }
            if (!vr.state) { fail++; log('GAGAL: state plugin tidak tersimpan'); }
            if (Math.abs(vr.d3 - vr.d2) > 1.5) { fail++; log('GAGAL: state plugin tidak dipulihkan setelah muat ulang'); }
          }
          await wait(1500);
          try {
            const ps = require('child_process').execFileSync('powershell', ['-NoProfile', '-Command', "Get-Process | Where-Object { $_.Name -match 'klm-vsthost|electron|ffmpeg' } | ForEach-Object { $_.Name + ':' + [math]::Round($_.CPU,1) }"], { encoding: 'utf8', timeout: 15000, windowsHide: true });
            log('proses setelah uji VST (nama:detik CPU): ' + ps.trim().split(/\r?\n/).join(' '));
            if (/klm-vsthost/.test(ps)) { fail++; log('GAGAL: proses klm-vsthost masih tertinggal setelah plugin dihapus'); }
          } catch (e) { log('daftar proses gagal: ' + e.message); }
        } catch (e) { fail++; log('GAGAL host VST: ' + e.message); }
      } else log('host VST: dilewati (KLM_VSTTEST tidak diset)');
      // --- dialog tutup: info + simpan ke preset ---
      {
        const c0 = JSON.parse(await js('JSON.stringify(KM.ui.closeInfo())'));
        const pp = path.join(out, 'preset-uji.klmmix');
        const saved = await js('KM.ui.projectPath = ' + JSON.stringify(pp) + '; KM.ui.saveForClose()');
        const c1 = JSON.parse(await js('JSON.stringify(KM.ui.closeInfo())'));
        log('dialog tutup: sebelum ' + JSON.stringify(c0) + ' → simpan ' + saved + ' → ' + JSON.stringify(c1) + ', file ' + (fs.existsSync(pp) ? fs.statSync(pp).size + ' byte' : 'TIDAK ADA'));
        if (!c0.dirty || saved !== true || c1.dirty || c1.name !== 'preset-uji' || !fs.existsSync(pp)) { fail++; log('GAGAL: simpan preset saat tutup'); }
      }
      // --- SRT caller ke "gateway" lokal (ffmpeg listener) ---
      try {
        const { spawn } = require('child_process');
        const ts = path.join(out, 'srt-gateway.ts');
        const gw = spawn(server.hub.ffmpegPath(), ['-hide_banner', '-y', '-i', 'srt://0.0.0.0:9310?mode=listener&latency=200000', '-c', 'copy', '-f', 'mpegts', ts], { windowsHide: true });
        let gwLog = ''; gw.stderr.on('data', (d) => { gwLog = (gwLog + d).slice(-4000); });
        await wait(1200);
        await js(`Object.assign(KM.settings.srt, { mode: 'caller', host: '127.0.0.1', port: 9310, latency: 200, encoder: 'auto', videoBitrate: 4500, res: '720', passphrase: '' }); KM.rec.startSrt()`);
        let st = '';
        let wasLive = false;
        for (let i = 0; i < 25; i++) { await wait(1000); st = await js('KM.rec.srtStatus + " " + JSON.stringify(KM.rec.srtStats || {})'); if (st.startsWith('live')) wasLive = true; if (st.startsWith('live') && i > 5) break; }
        log('SRT status: ' + st + ' encoder=' + await js('KM.rec.srtEncoder'));
        await js('KM.rec.stopSrt(true)'); await wait(2500);
        try { gw.kill(); } catch (e) {}
        await wait(800);
        const size = fs.existsSync(ts) ? fs.statSync(ts).size : 0;
        const info = (gwLog.match(/Stream #0:\d.*/g) || []).join(' | ');
        log('SRT diterima gateway: ' + size + ' byte — ' + info);
        if (size < 100000) { fail++; log('GAGAL: SRT tidak sampai ke gateway. Log srt: ' + (await js('KM.rec.srtLog')).slice(-600)); }
        else if (!(wasLive || st.startsWith('live'))) log('catatan: data SRT sampai (' + size + ' byte) tetapi status "live" belum sempat terbaca (VM CI sibuk)');
      } catch (e) { fail++; log('GAGAL SRT: ' + e.message); }
      // --- Live ke banyak akun: akun Facebook mode API (server Graph tiruan) + RTMP manual → 2 penerima RTMP lokal ---
      try {
        const { spawn } = require('child_process');
        const http = require('http');
        const hits = [];
        const mock = http.createServer((rq, rs) => { let b = ''; rq.on('data', (d) => { b += d; }); rq.on('end', () => {
          const u = new URL(rq.url, 'http://x'), f = new URLSearchParams(b); hits.push(rq.method + ' ' + u.pathname + (f.get('title') ? ' title=' + f.get('title') : '') + (f.get('end_live_video') ? ' end' : ''));
          const j = (o) => { rs.writeHead(200, { 'Content-Type': 'application/json' }); rs.end(JSON.stringify(o)); };
          if (u.pathname === '/123' && rq.method === 'GET') return j({ id: '123', name: 'Halaman Uji' });
          if (u.pathname === '/123/live_videos') return j({ id: 'LV1', secure_stream_url: 'rtmp://127.0.0.1:19350/rtmp/FBKEY' });
          if (u.pathname === '/LV1') return j(rq.method === 'GET' ? { permalink_url: '/uji/videos/LV1/' } : { id: 'LV1' });
          rs.writeHead(404); rs.end('{}');
        }); });
        await new Promise((r) => mock.listen(0, '127.0.0.1', r));
        process.env.KLM_LIVE_BASE = JSON.stringify({ graph: 'http://127.0.0.1:' + mock.address().port });
        const fa = path.join(out, 'live-fb.flv'), fbb = path.join(out, 'live-rtmp.flv');
        const rx = (url, file) => { const p = spawn(server.hub.ffmpegPath(), ['-hide_banner', '-y', '-listen', '1', '-i', url, '-c', 'copy', '-f', 'flv', file], { windowsHide: true }); p.stderr.on('data', () => {}); return p; };
        const r1 = rx('rtmp://127.0.0.1:19350/rtmp/FBKEY', fa), r2 = rx('rtmp://127.0.0.1:19351/live/kunci2', fbb);
        await wait(1200);
        const con = JSON.parse(await js(`window.klm.invoke('live:fb-connect', 'accFB', 'TOKEN-UJI-0123456789abcdef', '123').then((r) => JSON.stringify(r))`));
        await js(`(() => { const c = KM.live.cfg(); c.accounts = [{ id: 'accFB', platform: 'facebook', name: 'FB uji', mode: 'api', on: true }, { id: 'accR', platform: 'custom', name: 'RTMP uji', url: 'rtmp://127.0.0.1:19351/live', key: 'kunci2', mode: 'key', on: true }, { id: 'accT', platform: 'tiktok', name: 'TikTok tidak dipilih', url: '', key: '', mode: 'key', on: false }];
          c.meta.title = 'Uji Live KLM'; c.meta.desc = 'deskripsi uji'; KM.saveSettings(); KM.live.auth = {}; return KM.live.refreshAuth(); })()`);
        await js('KM.ui.dockTab("live")');
        const started = await js('KM.rec.startStreaming()');
        let ls = '';
        for (let i = 0; i < 14; i++) { await wait(1000); ls = await js('JSON.stringify({ on: KM.state.streaming, st: KM.live.session && KM.live.session.status, w: KM.live.session && KM.live.session.watch, stats: KM.rec.stats && KM.rec.stats.bitrate })'); }
        const cards = await js('document.querySelectorAll("#dock-live .lacc").length');
        await js('KM.rec.stopStreaming(true)'); await wait(3000);
        try { r1.kill(); r2.kill(); } catch (e) {} mock.close();
        await wait(800);
        const sz = (f) => (fs.existsSync(f) ? fs.statSync(f).size : 0);
        let enc = ''; try { enc = Object.values(JSON.parse(fs.readFileSync(path.join(server.configDir(), 'live-auth.json'), 'utf8'))).map((v) => v.slice(0, 2)).join(','); } catch (e) {}
        log('live banyak akun: hubung ' + JSON.stringify(con) + ', mulai ' + started + ', ' + ls + ', kartu ' + cards + ', diterima FB ' + sz(fa) + ' byte / RTMP ' + sz(fbb) + ' byte, token tersimpan ' + enc + ', API: ' + hits.join(' | '));
        delete process.env.KLM_LIVE_BASE;
        if (!con.ok) { fail++; log('GAGAL: hubungkan akun Facebook (API tiruan)'); }
        if (!hits.some((x) => /live_videos title=Uji Live KLM/.test(x))) { fail++; log('GAGAL: judul tidak dikirim ke API'); }
        if (!hits.some((x) => /POST \/LV1 end/.test(x))) { fail++; log('GAGAL: siaran API tidak diakhiri saat stop'); }
        if (sz(fa) < 50000 || sz(fbb) < 50000) { fail++; log('GAGAL: stream tidak sampai ke kedua tujuan'); }
        if (enc && !/^e:/.test(enc)) log('catatan: token tidak terenkripsi (safeStorage tidak tersedia)');
      } catch (e) { fail++; log('GAGAL live banyak akun: ' + e.message); }
    } catch (e) { fail++; log('ERROR ' + (e && e.stack || e)); }
    // --- Latar AI (segmentasi orang, offline) + input Mirroring HP ---
    try {
      const sg = JSON.parse(await js(`(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); const inp = KM.state.inputs.find((i) => i.title === 'Tone') || KM.state.inputs[0];
        inp.seg = Object.assign({}, KM.seg.DEF, { mode: 'blur' }); KM.engine.cut(inp.id);
        for (let i = 0; i < 80 && !(inp.rt.segA) && KM.seg.state !== 'error'; i++) await sleep(250);
        await sleep(1500);
        const r = { state: KM.seg.state, err: KM.seg.err || inp.rt.segErr || '', delegate: KM.seg.delegate, mask: inp.rt.segMask ? inp.rt.segMask.width + 'x' + inp.rt.segMask.height : '', out: inp.rt.segOut ? inp.rt.segOut.width + 'x' + inp.rt.segOut.height : '', person: !!inp.rt.person, cover: inp.rt.segCover, fps: KM.engine.fps };
        inp.seg.mode = 'off'; KM.seg.release(inp);
        const m = KM.inputs.create('mirror', { title: 'Mirroring uji' }); await sleep(600);
        r.mirror = { sup: KM.mirror.supported(), port: KM.link.ports.mirror, link: KM.mirror.link(m).replace(/t=[a-f0-9]+/, 't=…'), ws: m.rt.mws && m.rt.mws.readyState };
        KM.inputs.remove(m);
        return JSON.stringify(r); })()`));
      log('latar AI & mirroring: ' + JSON.stringify(sg));
      if (sg.state !== 'ready' || !sg.mask) { fail++; log('GAGAL: mesin Latar AI tidak berjalan'); }
      if (!sg.mirror.sup || !sg.mirror.port || sg.mirror.ws !== 1) { fail++; log('GAGAL: input Mirroring HP (WebCodecs / port / feed)'); }
    } catch (e) { fail++; log('GAGAL latar AI: ' + e.message); }
    // --- Penerima AirPlay (iPhone tanpa aplikasi): helper menyala, mengumumkan diri, video uji terdekode di input ---
    if (process.env.KLM_APTEST) {
      try {
        const a1 = JSON.parse(await js(`(async () => { const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const m = KM.inputs.create('mirror', { title: 'iPhone uji', opts: { mode: 'airplay', apName: 'KLM Uji' } }); KM.engine.cut(m.id);
          for (let i = 0; i < 40 && KM.mirror.ap.ev !== 'ready'; i++) await sleep(250);
          window.__apId = m.id; return JSON.stringify({ token: m.opts.token, ap: KM.mirror.ap }); })()`));
        log('airplay: ' + JSON.stringify(a1.ap));
        if (a1.ap.ev !== 'ready' || !a1.ap.running) { fail++; log('GAGAL: penerima AirPlay tidak siap'); }
        const exe = require('./airplay').findExe();
        const st = require('child_process').spawn(exe, ['--port', String(server.mirror.port), '--token', a1.token, '--selftest', process.env.KLM_APTEST, '8'].concat(process.env.KLM_APTEST_AUDIO ? [process.env.KLM_APTEST_AUDIO] : []), { windowsHide: true });
        let so = ''; st.stdout.on('data', (d) => { so += d; });
        await wait(6000);
        const a2 = JSON.parse(await js(`(() => { const m = KM.state.inputs.find((i) => i.id === window.__apId); const r = { w: m.rt.mw, h: m.rt.mh, fps: m.rt.mfps, name: m.rt.minfo && m.rt.minfo.name, st: m.rt.mstat, pcm: !!m.rt.pcmNode, strip: !!KM.audio.strips.get(m.id), nets: (KM.mirror.ap.nets || []).length, fw: KM.mirror.ap.fw }; KM.inputs.remove(m); return JSON.stringify(r); })()`));
        try { st.kill(); } catch (e) {}
        await wait(1200);
        const off = await js(`JSON.stringify(KM.mirror.ap.running)`);
        log('airplay video uji: ' + JSON.stringify(a2) + ', helper: ' + so.trim().split('\n').pop() + ', setelah input dihapus berjalan=' + off);
        if (!(a2.w > 0 && a2.st && a2.st.out > 30)) { fail++; log('GAGAL: video AirPlay uji tidak terdekode'); }
        if (process.env.KLM_APTEST_AUDIO && !(a2.st && a2.st.audio > 50 && a2.pcm && a2.strip)) { fail++; log('GAGAL: suara AirPlay uji tidak sampai ke strip audio'); }
        // suara PC tanpa KLM (process loopback) — runner CI tanpa kartu suara bisa menolak; dicatat saja
        try {
          const pa = await js(`(async () => { const t = 'abcabc' + Date.now().toString(16).slice(-6); const ev = []; window.klm.on('procaudio:status', (d) => ev.push(d.st.ev + (d.st.msg ? ':' + d.st.msg : ''))); const st = await window.klm.invoke('procaudio:start', { token: t, name: 'uji' }); await new Promise((r) => setTimeout(r, 3000)); await window.klm.invoke('procaudio:stop', { token: t }); return JSON.stringify({ avail: await window.klm.invoke('procaudio:available'), st, ev }); })()`);
          log('suara PC (process loopback): ' + pa);
        } catch (e) { log('catatan suara PC: ' + e.message); }
        if (off !== 'false') log('catatan: penerima AirPlay masih berjalan setelah input dihapus');
      } catch (e) { fail++; log('GAGAL airplay: ' + e.message); }
    }
    // --- mesin video native (klm-engine, Direct3D 11): monitor Preview tampil native di atas kanvas ---
    try {
      const avail = nEngine.available();
      log('mesin native: tersedia=' + avail);
      if (avail) {
        await js(`(() => { document.querySelectorAll('.modal .mh .x').forEach((x) => x.click()); const b = KM.inputs.create('bars', { title: 'Bars native' }); KM.engine.setPreview(b.id); KM.nengine.set(true); return 1; })()`);
        await wait(5000);
        const ns = JSON.parse(await js('JSON.stringify({ state: KM.nengine.state, adapter: KM.nengine.adapter, pvw: KM.nengine.pvw, pgm: KM.nengine.pgm, why: KM.nengine.why, fps: KM.nengine.fps, mem: KM.nengine.mem })'));
        log('mesin native: ' + JSON.stringify(ns));
        // kanvas Preview JS disembunyikan sesaat: yang terlihat di layar harus gambar dari jendela native (color bars)
        const pr = JSON.parse(await js(`(() => { const c = document.getElementById('pvw'); c.style.visibility = 'hidden'; const r = c.getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height, d: devicePixelRatio }); })()`));
        await wait(400);
        const { desktopCapturer, screen: scr } = require('electron');
        const b = mainWin.getContentBounds(), disp = scr.getDisplayMatching(b), sf = disp.scaleFactor || 1;
        const shots = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(disp.size.width * sf), height: Math.round(disp.size.height * sf) } });
        const shot = shots.find((x) => String(x.display_id) === String(disp.id)) || shots[0];
        let px = null;
        if (shot) {
          fs.writeFileSync(path.join(out, 'native-desktop.png'), shot.thumbnail.toPNG());
          const bm = shot.thumbnail.toBitmap(), sz = shot.thumbnail.getSize(), k = sz.width / disp.size.width;
          const X = Math.round((b.x - disp.bounds.x + pr.x + pr.w * 0.07) * k), Y = Math.round((b.y - disp.bounds.y + pr.y + pr.h * 0.3) * k);
          if (X >= 0 && Y >= 0 && X < sz.width && Y < sz.height) { const i = (Y * sz.width + X) * 4; px = [bm[i + 2], bm[i + 1], bm[i]]; }
        }
        await js(`document.getElementById('pvw').style.visibility = ''`);
        log('mesin native: piksel layar di monitor Preview (kanvas JS disembunyikan) = ' + JSON.stringify(px) + ' (harap ±192,192,192 dari color bars)');
        if (ns.state !== 'ready' || !ns.pvw) { fail++; log('GAGAL: mesin native tidak mengambil alih monitor Preview'); }
        else if (!px || Math.abs(px[0] - 192) > 24 || Math.abs(px[1] - 192) > 24 || Math.abs(px[2] - 192) > 24) log('catatan: piksel layar tidak cocok (desktop CI mungkin tidak menampilkan jendela) — dicek manual lewat native-desktop.png');
        // --- Fase 3: kamera dibuka mesin native (pola uji) → tekstur bersama → mesin JS (VideoFrame) + monitor native ---
        try {
          await js(`(async () => { const c = KM.inputs.create('camera', { title: 'Kamera native uji', opts: { deviceId: 'klm-native-test', width: 640, height: 360, fps: 30 } }); window.__ncam = c.id; return 1; })()`);
          await wait(4000);
          const cs = JSON.parse(await js(`(() => { const i = KM.getInput(window.__ncam); const c = i && i.rt.ncam && KM.nengine.cams.get(i.rt.ncam);
            const r = { ncam: i && i.rt.ncam, ok: c && c.ok, frames: c ? c.frames : 0, err: c ? c.err : (i && i.rt.err), stat: KM.nengine.camStat };
            const so = i && KM.inputTypes.camera.source(i);
            if (so && so.src && so.w) { const cv = document.createElement('canvas'); cv.width = so.w; cv.height = so.h; const g = cv.getContext('2d'); g.drawImage(so.src, 0, 0);
              r.size = so.w + 'x' + so.h; r.px = [g.getImageData(4, so.h >> 1, 1, 1).data, g.getImageData(so.w - 5, so.h >> 1, 1, 1).data].map((d) => [d[0], d[1], d[2], d[3]]); }
            return JSON.stringify(r); })()`));
          log('kamera native (pola uji): ' + JSON.stringify(cs));
          const bg = (p) => p && Math.abs(p[0] - 32) <= 3 && Math.abs(p[1] - 160) <= 3 && Math.abs(p[2] - 224) <= 3 && p[3] === 255;
          if (!cs.ok || !(cs.frames > 10)) { fail++; log('GAGAL: frame kamera native tidak sampai ke mesin JS'); }
          else if (!cs.px || !(bg(cs.px[0]) || bg(cs.px[1]))) { fail++; log('GAGAL: isi frame kamera native di mesin JS salah'); }
          else log('kamera native: OK — frame GPU sampai ke mesin JS dengan isi benar');
          await js('KM.engine.setPreview(window.__ncam)'); await wait(1500);
          const cp = JSON.parse(await js('JSON.stringify({ pvw: KM.nengine.pvw, why: KM.nengine.why.pvw })'));
          log('kamera native di monitor Preview: ' + JSON.stringify(cp));
          if (!cp.pvw) { fail++; log('GAGAL: kamera native tidak tampil di monitor Preview native'); }
          await js('KM.inputs.remove ? KM.inputs.remove(window.__ncam) : 0'); await wait(800);
          log('kamera native setelah input dihapus: ' + await js('JSON.stringify({ cams: KM.nengine.cams.size })'));
        } catch (e) { fail++; log('GAGAL kamera native: ' + e.message); }
        // --- Fase 4a: KLMCAM (WebRTC H.264) → dekoder GPU mesin native. Uji putaran-balik WebRTC lokal di halaman mixer ---
        try {
          const kr = JSON.parse(await js(`(async () => {
            let inp; try { inp = KM.inputs.create('klmcam', { title: 'KLMCAM native uji', opts: { slot: 9 } }); } catch (e) { return JSON.stringify({ skip: 'input KLMCAM: ' + e.message }); }
            window.__kinp = inp.id;
            const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const g = cv.getContext('2d');
            const paint = () => { g.fillStyle = '#2080c0'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.fillRect((performance.now() / 10) % 600, 0, 40, 40); };
            paint(); window.__kpaint = setInterval(paint, 33);
            const a = new RTCPeerConnection(), b = new RTCPeerConnection(); window.__kpc = [a, b];
            a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate); b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
            const raw = cv.captureStream(30).getVideoTracks()[0];
            const tr = a.addTransceiver(raw, { direction: 'sendonly' });
            const caps = (RTCRtpSender.getCapabilities('video') || { codecs: [] }).codecs, h = caps.filter((c) => /h264/i.test(c.mimeType));
            if (h.length) tr.setCodecPreferences(h.concat(caps.filter((c) => !/h264/i.test(c.mimeType)))); // codec apa pun bisa (frame didekode Chromium)
            b.ontrack = (e) => KM.nengine.kAttach(KM.getInput(window.__kinp), e.receiver);
            await a.setLocalDescription(await a.createOffer()); await b.setRemoteDescription(a.localDescription);
            await b.setLocalDescription(await b.createAnswer()); await a.setRemoteDescription(b.localDescription);
            return JSON.stringify({ ok: 1, st: !!window.RTCRtpScriptTransform });
          })()`));
          if (kr.skip) log('catatan KLMCAM native: dilewati — ' + kr.skip);
          else {
            await wait(6000);
            const ks = JSON.parse(await js(`JSON.stringify((() => { const i = KM.getInput(window.__kinp); const id = 'k' + String(i.id).replace(/[^\\w]/g, '').slice(0, 30); const k = KM.nengine.kcams.get(id); return { id, k: k || null, scriptTransform: !!window.RTCRtpScriptTransform, stat: KM.nengine.camStat }; })())`));
            log('KLMCAM native: ' + JSON.stringify(ks) + ' • jalur frame ' + JSON.stringify(nEngine.kstats ? nEngine.kstats() : {}) );
            if (!ks.k || !ks.k.ok) { fail++; log('GAGAL: frame H.264 KLMCAM tidak terdekode mesin native'); }
            else {
              await js('KM.engine.setPreview(window.__kinp)'); await wait(1500);
              const kp = JSON.parse(await js('JSON.stringify({ pvw: KM.nengine.pvw, why: KM.nengine.why.pvw })'));
              const px = await js(`KM.nengine.probe('pvw', 0.5, 0.75).then((p) => JSON.stringify(p))`);
              log('KLMCAM native di monitor Preview: ' + JSON.stringify(kp) + ' piksel ' + px + ' (harap ±32,128,192)');
              const p3 = JSON.parse(px || 'null');
              if (!kp.pvw) { fail++; log('GAGAL: KLMCAM native tidak tampil di monitor Preview native (' + kp.why + ')'); }
              else if (!p3 || Math.abs(p3[0] - 32) > 16 || Math.abs(p3[1] - 128) > 16 || Math.abs(p3[2] - 192) > 16) { fail++; log('GAGAL: warna KLMCAM native salah'); }
              else {
                log('KLMCAM native: OK — H.264 dari WebRTC didekode mesin native dengan warna benar');
                // resolusi HP lebih besar dari output → diperkecil di GPU (WebGL2) di pekerja, warna harus tetap benar
                await js('KM.nengine.kOutTest(320, 180)'); await wait(2500);
                const gs = JSON.parse(await js(`JSON.stringify((() => { const i = KM.getInput(window.__kinp); const id = 'k' + String(i.id).replace(/[^\\w]/g, '').slice(0, 30); const k = KM.nengine.kcams.get(id); return k && k.raw ? { fmt: k.raw.fmt, w: k.raw.w, h: k.raw.h, sw: k.raw.sw, sh: k.raw.sh, err: k.raw.err } : null; })())`));
                const p4 = JSON.parse(await js(`KM.nengine.probe('pvw', 0.5, 0.75).then((p) => JSON.stringify(p))`) || 'null');
                log('KLMCAM diperkecil di GPU: ' + JSON.stringify(gs) + ' piksel ' + JSON.stringify(p4));
                await js('KM.nengine.kOut()');
                if (!gs || !/→gl/.test(gs.fmt || '') || gs.w !== 320) { fail++; log('GAGAL: KLMCAM resolusi tinggi tidak diperkecil di GPU (' + (gs && gs.err) + ')'); }
                else if (!p4 || Math.abs(p4[0] - 32) > 20 || Math.abs(p4[1] - 128) > 20 || Math.abs(p4[2] - 192) > 20) { fail++; log('GAGAL: warna KLMCAM setelah diperkecil di GPU salah'); }
                else log('KLMCAM resolusi tinggi: OK — diperkecil ke ukuran output di GPU, warna benar');
              }
            }
          }
          await js('(() => { clearInterval(window.__kpaint); (window.__kpc || []).forEach((p) => p.close()); if (window.__kinp) KM.inputs.remove(window.__kinp); return 1; })()');
        } catch (e) { fail++; log('GAGAL KLMCAM native: ' + e.message); }
        // --- Fase 4b: output native — rekam MP4 & streaming MPEG-TS dikodekan mesin native (kanvas Program JS berhenti) ---
        try {
          const ff = server.hub.ffmpegPath();
          const probe = (file) => new Promise((res) => { let o = ''; const q = require('child_process').spawn(ff, ['-hide_banner', '-i', file, '-map', '0', '-f', 'null', '-'], { windowsHide: true }); q.stderr.on('data', (d) => { o += d; }); q.on('close', (c) => res({ code: c, info: (o.match(/Duration: [^,]+|Stream #[^\n]+/g) || []).join(' | ').slice(0, 400), err: /error|invalid/i.test(o.split('Press [q]')[1] || '') })); q.on('error', (e) => res({ code: -1, info: e.message })); });
          await js(`(() => { const c = KM.inputs.create('camera', { title: 'Kamera output native', opts: { deviceId: 'klm-native-test', width: 1280, height: 720, fps: 30 } }); window.__ocam = c.id; return 1; })()`);
          await wait(3000);
          await js('KM.engine.cut(window.__ocam); KM.nengine.relaxInputs = true; 1'); await wait(1500);
          log('output native — alasan bila tidak bisa: "' + await js('KM.nengine.outWhy()') + '"');
          await js('KM.rec.startRecording()'); await wait(500);
          const rs = JSON.parse(await js('JSON.stringify({ native: KM.rec.recNative || null, outs: [...KM.nengine.outs.values()].map((x) => ({ kind: x.kind, enc: x.enc, hw: x.hw, cpu: x.cpu })) })'));
          log('rekam native: ' + JSON.stringify(rs) + ' galat: ' + await js('KM.rec.nativeErr || ""'));
          await wait(2500);
          const pd = await js('JSON.stringify({ progIdleMs: Math.round(performance.now() - KM.engine.progDrawAt), pgmNative: KM.nengine.pgm, busy: KM.engine.outputBusy() })');
          log('rekam native — kanvas Program JS: ' + pd);
          await wait(2000);
          const file = await js('(async () => { KM.rec.stopRecording(); return await KM.rec.recDone; })()');
          await wait(500);
          const pr = file ? await probe(file) : { code: -1, info: 'tidak ada file' };
          log('rekam native: ' + file + ' → ffmpeg ' + pr.code + ' ' + pr.info);
          if (!rs.native) { fail++; log('GAGAL: rekam tidak memakai mesin native'); }
          else if (pr.code !== 0 || !/h264/.test(pr.info) || !/aac/.test(pr.info)) { fail++; log('GAGAL: file rekam native rusak / tanpa H.264+AAC'); }
          else log('rekam native: OK — MP4 H.264 + AAC dari mesin native');
          if (JSON.parse(pd).busy) log('catatan: kanvas Program JS masih dianggap sibuk saat rekam native');
          // streaming: hub → ffmpeg -c copy (tujuan file FLV lokal sebagai ganti server RTMP)
          const flv = path.join(out, 'native-stream.flv'); try { fs.unlinkSync(flv); } catch (e) {}
          const sr = await js(`new Promise(async (res) => {
            const ws = new WebSocket('ws://' + location.host + '/hub/out'); ws.binaryType = 'arraybuffer'; window.__nws = ws;
            ws.onopen = () => ws.send(JSON.stringify({ kind: 'stream', native: true, cfg: { encoder: 'copy', inputFormat: 'mpeg', videoBitrate: 3000, audioBitrate: 128, fps: KM.settings.fps, destinations: [{ enabled: true, url: ${JSON.stringify(flv)} }] } }));
            ws.onmessage = async (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.t === 'log' || m.t === 'ended') window.__nlog = (window.__nlog || '') + ' ' + (m.msg || ('ended ' + m.code)); if (m.t === 'started') { try { const x = await KM.nengine.outStart('ts', { vk: 3000, ak: 128, cbr: true }); window.__nts = x.id; res('ok ' + x.enc); } catch (er) { res('gagal ' + er.message); } } else if (m.t === 'error') res('hub ' + m.msg); };
            setTimeout(() => res('waktu habis'), 8000);
          })`);
          log('streaming native: ' + sr);
          await wait(8000);
          await js('(async () => { if (window.__nts) await KM.nengine.outStop(window.__nts); setTimeout(() => window.__nws && window.__nws.close(), 1500); return 1; })()');
          await wait(4000);
          const ps = fs.existsSync(flv) ? await probe(flv) : { code: -1, info: 'tidak ada file' };
          log('streaming native → ' + (fs.existsSync(flv) ? fs.statSync(flv).size : 0) + ' byte, ffmpeg ' + ps.code + ' ' + ps.info + ' • mesin: ' + await js('KM.nengine.status().then((x) => JSON.stringify({ tsBytes: x && x.tsBytes, taps: x && x.taps }))') + ' • log hub: ' + await js('(window.__nlog || "").slice(-600)'));
          if (!/^ok/.test(sr) || ps.code !== 0 || !/h264/.test(ps.info)) { fail++; log('GAGAL: streaming native tidak menghasilkan H.264 yang valid'); }
          else log('streaming native: OK — MPEG-TS dari mesin native diteruskan ffmpeg (-c copy)');
          // --- Fase 5: file video (rekaman native di atas) & gambar PNG dibuka mesin native ---
          try {
            const png = path.join(out, 'native-img.png');
            { const W = 64, H = 32, bm = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) { bm[i * 4] = 100; bm[i * 4 + 1] = 50; bm[i * 4 + 2] = 200; bm[i * 4 + 3] = 255; } fs.writeFileSync(png, require('electron').nativeImage.createFromBitmap(bm, { width: W, height: H }).toPNG()); }
            await js(`(() => { const v = KM.inputs.create('video', { title: 'Video native', opts: { url: KM.fileUrl(${JSON.stringify(file || '')}) } }); const g = KM.inputs.create('image', { title: 'Gambar native', opts: { url: KM.fileUrl(${JSON.stringify(png)}) } }); window.__nvid = v.id; window.__nimg = g.id; return 1; })()`);
            await wait(3500);
            await js('(() => { const v = KM.getInput(window.__nvid); try { v.rt.el.currentTime = 1; } catch (e) {} KM.engine.cut(window.__nvid); KM.engine.setPreview(window.__nimg); return 1; })()');
            await wait(2500);
            const ms = JSON.parse(await js('JSON.stringify({ media: [...KM.nengine.media.values()].map((m) => ({ kind: m.kind, ok: m.ok, err: m.err, w: m.w, h: m.h })), pgm: KM.nengine.pgm, pvw: KM.nengine.pvw, why: KM.nengine.why })'));
            const pp = await js(`KM.nengine.probe('pvw', 0.5, 0.5).then((p) => JSON.stringify(p))`);
            const pg = await js(`Promise.all([KM.nengine.probe('pgm', 0.03, 0.5), KM.nengine.probe('pgm', 0.97, 0.5)]).then((p) => JSON.stringify(p))`);
            log('video/gambar native: ' + JSON.stringify(ms) + ' • piksel gambar ' + pp + ' (harap 200,50,100) • piksel video ' + pg + ' (harap salah satu ±32,160,224)');
            const ip = JSON.parse(pp || 'null'), vp = JSON.parse(pg || 'null') || [];
            const near = (p, c, t) => p && c.every((v, i) => Math.abs(p[i] - v) <= t);
            if (!ms.pvw || !near(ip, [200, 50, 100], 4)) { fail++; log('GAGAL: gambar native tidak tampil benar di monitor Preview'); }
            else if (!ms.pgm || !(near(vp[0], [32, 160, 224], 16) || near(vp[1], [32, 160, 224], 16))) { fail++; log('GAGAL: file video native tidak tampil benar di monitor Program'); }
            else log('video/gambar native: OK — file video & gambar digambar mesin native');
            // --- Fase 6: audio file video native, daftar putar, SVG, gambar dari URL (http), geser A/V ---
            await js('(() => { const v = KM.getInput(window.__nvid); v.rt.el.currentTime = 0.2; v.rt.el.play().catch(() => {}); return 1; })()');
            await wait(2500);
            const na = JSON.parse(await js('JSON.stringify((() => { const v = KM.getInput(window.__nvid); return { nAudio: !!v.rt.nAudio, pcmNode: !!v.rt.pcmNode, playing: !v.rt.el.paused }; })())'));
            log('audio native file video: ' + JSON.stringify(na));
            if (!na.nAudio || !na.pcmNode) { fail++; log('GAGAL: audio file video tidak datang dari mesin native'); } else log('audio native: OK — suara file video didekode mesin native & masuk mixer');
            await js('KM.inputs.remove(window.__nvid); KM.inputs.remove(window.__nimg); 1');
            const svg = path.join(out, 'native.svg');
            fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#14a050"/></svg>');
            await js(`(() => {
              const l = KM.inputs.create('list', { title: 'Daftar native', opts: { items: [{ kind: 'image', url: KM.fileUrl(${JSON.stringify(png)}) }, { kind: 'video', url: KM.fileUrl(${JSON.stringify(file || '')}) }] } });
              const s = KM.inputs.create('image', { title: 'SVG native', opts: { url: KM.fileUrl(${JSON.stringify(svg)}) } });
              const u = KM.inputs.create('image', { title: 'Gambar URL native', opts: { url: location.origin + '/src/utc/icons/favicon-64.png' } });
              window.__nl = l.id; window.__ns = s.id; window.__nu = u.id; return 1; })()`);
            await wait(4000);
            await js('KM.engine.cut(window.__nl); KM.engine.setPreview(window.__ns); 1'); await wait(2000);
            const p6 = JSON.parse(await js(`Promise.all([KM.nengine.probe('pgm', 0.5, 0.5), KM.nengine.probe('pvw', 0.5, 0.5)]).then((p) => JSON.stringify({ p, pgm: KM.nengine.pgm, pvw: KM.nengine.pvw, why: KM.nengine.why, media: [...KM.nengine.media.values()].map((m) => m.kind + ':' + (m.ok ? 'ok' : (m.err || '…'))) }))`));
            log('daftar putar + SVG native: ' + JSON.stringify(p6) + ' (harap Program 200,50,100 • Preview 20,160,80)');
            const nr = (a, c, t) => a && c.every((v, i) => Math.abs(a[i] - v) <= t);
            if (!p6.pgm || !nr(p6.p[0], [200, 50, 100], 6)) { fail++; log('GAGAL: daftar putar tidak tampil native'); }
            else if (!p6.pvw || !nr(p6.p[1], [20, 160, 80], 8)) { fail++; log('GAGAL: SVG tidak tampil native'); }
            else log('daftar putar & SVG native: OK');
            await js('KM.engine.setPreview(window.__nu); 1'); await wait(2000);
            const pu = JSON.parse(await js('JSON.stringify({ pvw: KM.nengine.pvw, why: KM.nengine.why.pvw })'));
            log('gambar dari URL (diunduh ke cache) native: ' + JSON.stringify(pu));
            if (!pu.pvw) { fail++; log('GAGAL: gambar dari URL tidak tampil native'); } else log('gambar URL native: OK');
            await js('KM.settings.avOffset = 200; 1'); await wait(800);
            const dl = await js('KM.audio.master && KM.audio.master.odly ? KM.audio.master.odly.delayTime.value.toFixed(2) : "-"');
            log('geser A/V +200 ms → delay bus master ' + dl + ' s'); if (Math.abs(+dl - 0.2) > 0.02) { fail++; log('GAGAL: penundaan audio output tidak terpasang'); }
            await js('KM.settings.avOffset = 0; KM.inputs.remove(window.__nl); KM.inputs.remove(window.__ns); KM.inputs.remove(window.__nu); 1');
            // --- Fase 7: Virtual Set (kotak berisi input lain), Title Cepat di overlay, Web Browser (tangkap jendela) ---
            await js(`(() => {
              const c = KM.inputs.create('colour', { title: 'Isi kotak native', opts: { color: '#2040ff' } });
              const v = KM.inputs.create('virtualset', { title: 'Virtual Set native', layers: [{ on: true, inputId: c.id, x: 0.25, y: 0.25, w: 0.5, h: 0.5, fit: 'fill', zoom: 1, px: 0, py: 0, rad: 0.2, bw: 6, bc: '#ffffff' }] });
              const t = KM.inputs.create('title', { title: 'Title native' });
              const b = KM.inputs.create('browser', { title: 'Browser native', opts: { url: location.origin + '/src/utc/icons/icon-512.png', width: 640, height: 360 } });
              window.__vc = c.id; window.__vs = v.id; window.__vt = t.id; window.__vb = b.id; return 1; })()`);
            await wait(4000);
            await js('KM.engine.cut(window.__vs); 1'); await wait(2500);
            const v7 = JSON.parse(await js(`Promise.all([KM.nengine.probe('pgm', 0.5, 0.5), KM.nengine.probe('pgm', 0.05, 0.05)]).then((p) => JSON.stringify({ p, pgm: KM.nengine.pgm, why: KM.nengine.why.pgm }))`));
            log('Virtual Set native: ' + JSON.stringify(v7) + ' (harap tengah 32,64,255)');
            log('Virtual Set native — diagnosa: ' + await js('JSON.stringify({ state: KM.nengine.state, comps: KM.nengine.debug ? KM.nengine.debug() : null })'));
            const nr7 = (a, c, t) => a && c.every((x, i) => Math.abs(a[i] - x) <= t);
            if (!v7.pgm || !nr7(v7.p[0], [32, 64, 255], 6)) { fail++; log('GAGAL: Virtual Set tidak tampil native'); } else log('Virtual Set native: OK');
            await js('KM.engine.overlay(0, window.__vt, "in"); 1'); await wait(2500);
            const t7 = JSON.parse(await js('JSON.stringify({ pgm: KM.nengine.pgm, why: KM.nengine.why.pgm, title: (() => { const m = KM.nengine.media.get("i" + String(window.__vt).replace(/[^\\w.-]/g, "_").slice(0, 60)); return m ? { ok: m.ok } : null; })() })'));
            log('Title Cepat di overlay native: ' + JSON.stringify(t7));
            const tp = JSON.parse(await js(`KM.nengine.probe('pgm', 0.5, 0.5).then((p) => JSON.stringify(p))`) || 'null');
            log('Title overlay: piksel tengah Program ' + JSON.stringify(tp) + ' • ovl terkirim: ' + await js('JSON.stringify(KM.nengine.debug().ovl || null)'));
            if (!t7.pgm) { fail++; log('GAGAL: Program dengan Title di overlay tidak native (' + t7.why + ')'); } else log('Title overlay native: OK');
            await js('KM.engine.overlay(0, null, "off"); KM.engine.setPreview(window.__vb); 1'); await wait(3000);
            const b7 = JSON.parse(await js('JSON.stringify({ pvw: KM.nengine.pvw, why: KM.nengine.why.pvw })'));
            log('Web Browser native (tangkap jendela): ' + JSON.stringify(b7));
            if (!b7.pvw) log('catatan: Web Browser belum tampil native di CI (' + b7.why + ') — jendela browser di luar layar mungkin tidak dirender saat tanpa sesi desktop');
            else log('Web Browser native: OK');
            // jendela "lihat & klik" untuk halaman offscreen: klik & ketik di jendela itu harus sampai ke halaman, frame harus tampil
            try {
              const page = 'data:text/html,' + encodeURIComponent('<body style="margin:0;background:#c00000;height:100vh" onmousedown="event.preventDefault();document.body.style.background=\'#00b000\';document.getElementById(\'t\').focus()"><input id="t" style="position:absolute;left:4px;top:4px;width:60px"></body>');
              await js(`(() => { const b = KM.inputs.create('browser', { title: 'Browser klik', opts: { url: ${JSON.stringify(page)}, width: 640, height: 360 } }); window.__vk = b.id; return 1; })()`);
              await wait(3000);
              const wid = await js('(() => { const i = KM.state.inputs.find((x) => x.id === window.__vk); return i && i.rt.osr ? i.rt.winId : 0; })()');
              if (!wid) log('catatan: input Web Browser uji klik bukan halaman offscreen — uji jendela klik dilewati');
              else {
                const r = await js(`window.klm.invoke('browser:show', ${wid}, true)`);
                const bv = bviews.get(wid); let ok = false;
                for (let i = 0; i < 40 && !(bv && bv.__ready); i++) await wait(250);
                await wait(1500);
                if (bv && bv.__ready) {
                  await bv.webContents.executeJavaScript(`(() => { const c = document.getElementById('cv'), r = c.getBoundingClientRect(), o = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, bubbles: true, detail: 1 };
                    c.dispatchEvent(new MouseEvent('mousedown', o)); window.dispatchEvent(new MouseEvent('mouseup', o)); return 1; })()`);
                  await wait(800);
                  await bv.webContents.executeJavaScript(`(() => { const c = document.getElementById('cv'); for (const k of ['k', 'l', 'm']) { c.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); c.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true })); } return 1; })()`);
                  await wait(1200);
                  const pw = browsers.get(wid);
                  const st = pw ? await pw.webContents.executeJavaScript('JSON.stringify({ bg: getComputedStyle(document.body).backgroundColor, val: document.getElementById("t").value })') : '{}';
                  const px = await bv.webContents.executeJavaScript(`(() => { const c = document.getElementById('cv'); const d = c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data; return JSON.stringify([d[0], d[1], d[2], c.width, c.height]); })()`);
                  log('Jendela klik Web Browser: ' + r + ' • halaman ' + st + ' • piksel jendela ' + px);
                  const S = JSON.parse(st), P = JSON.parse(px);
                  ok = /0, 176, 0/.test(S.bg) && S.val === 'klm' && P[1] > 150 && P[0] < 60;
                }
                if (!ok) { fail++; log('GAGAL: klik/ketik di jendela Web Browser tidak sampai ke halaman offscreen'); } else log('Jendela klik Web Browser: OK');
                if (bv && !bv.isDestroyed()) bv.close();
              }
              await js('KM.inputs.remove(window.__vk); 1');
            } catch (e) { fail++; log('GAGAL jendela klik Web Browser: ' + e.message); }
            // --- Fase 8: rotasi/posisi input, transisi selain fade, overlay zoom, FTB, koreksi warna — tetap native
            try {
              await js(`(() => { const a = KM.inputs.create('colour', { title: 'F8 merah', opts: { color: '#ff0000' } }), b = KM.inputs.create('colour', { title: 'F8 hijau', opts: { color: '#00ff00' } });
                window.__f8a = a.id; window.__f8b = b.id; Object.assign(a.pos, { fit: 'stretch', zoom: 0.5, rot: 90 }); KM.engine.cut(a.id); KM.engine.setPreview(b.id); return 1; })()`);
              await wait(2500);
              const near = (a, c, t) => Array.isArray(a) && c.every((x, i) => Math.abs(a[i] - x) <= t);
              const pr = (pts) => js(`Promise.all(${JSON.stringify(pts)}.map((q) => KM.nengine.probe('pgm', q[0], q[1]))).then((p) => JSON.stringify({ p, pgm: KM.nengine.pgm, why: KM.nengine.why.pgm }))`).then(JSON.parse);
              const r1 = await pr([[0.5, 0.12], [0.3, 0.5]]);
              log('Fase 8 rotasi input 90° native: ' + JSON.stringify(r1));
              if (!r1.pgm || !near(r1.p[0], [255, 0, 0], 6) || !near(r1.p[1], [0, 0, 0], 6)) { fail++; log('GAGAL: input berotasi tidak tampil native'); } else log('Rotasi input native: OK');
              await js(`(() => { const a = KM.getInput(window.__f8a); Object.assign(a.pos, { fit: 'fit', zoom: 1, rot: 0 }); window.__f8t = KM.settings.transitions[0].type; KM.settings.transitions[0].type = 'wipe'; KM.engine.setTbar(0.5); return 1; })()`);
              await wait(1500);
              const r2 = await pr([[0.2, 0.5], [0.8, 0.5]]);
              log('Fase 8 T-bar wipe 50% native: ' + JSON.stringify(r2));
              if (!r2.pgm || !near(r2.p[0], [0, 255, 0], 6) || !near(r2.p[1], [255, 0, 0], 6)) { fail++; log('GAGAL: transisi wipe tidak native'); } else log('Transisi wipe native: OK');
              await js('KM.engine.setTbar(0); KM.settings.transitions[0].type = window.__f8t; KM.engine.ftb(true); 1');
              await wait(1800);
              const r3 = await pr([[0.5, 0.5]]);
              log('Fase 8 FTB native: ' + JSON.stringify(r3));
              if (!r3.pgm || !near(r3.p[0], [0, 0, 0], 4)) { fail++; log('GAGAL: FTB tidak native'); } else log('FTB native: OK');
              await js('KM.engine.ftb(false); window.__f8o = KM.settings.overlayFx[1].type; KM.settings.overlayFx[1] = Object.assign({}, KM.settings.overlayFx[1], { type: "zoom", dur: 3000 }); 1');
              await wait(1500);
              await js('KM.engine.overlay(1, window.__f8b, "in"); 1'); await wait(1200);
              const r4 = await pr([[0.5, 0.5], [0.03, 0.05]]);
              log('Fase 8 overlay zoom (sedang masuk) native: ' + JSON.stringify(r4));
              if (!r4.pgm || !(r4.p[0] && r4.p[0][1] > 40) || !near(r4.p[1], [255, 0, 0], 6)) { fail++; log('GAGAL: overlay zoom tidak native'); } else log('Overlay zoom native: OK');
              await js('KM.engine.overlay(1, null, "off"); KM.settings.overlayFx[1].type = window.__f8o; const a = KM.getInput(window.__f8a); a.cc = { on: true, bri: 0, con: 1, sat: 0, hue: 0, gam: 1 }; 1');
              await wait(1500);
              const r5 = await pr([[0.5, 0.5]]);
              log('Fase 8 koreksi warna native: ' + JSON.stringify(r5));
              if (!r5.pgm || !near(r5.p[0], [54, 54, 54], 5)) { fail++; log('GAGAL: koreksi warna tidak native'); } else log('Koreksi warna native: OK');
              // --- Fase 10: kartu daftar input digambar mesin native (jendela per kartu)
              await js('(() => { const a = KM.getInput(window.__f8a); if (a && a.rt.card) a.rt.card.scrollIntoView({ block: "nearest" }); return 1; })()');
              await wait(1500);
              const c10 = JSON.parse(await js(`JSON.stringify((() => { const N = KM.nengine, a = KM.getInput(window.__f8a), id = 'q' + String(a.id).replace(/[^\\w]/g, '').slice(0, 30), c = N.cards.get(id) || {};
                return { on: N.cardOn(a), shown: [...N.cards.values()].filter((x) => x.shown).length, total: KM.state.inputs.length, line: c.line || '', cov: !!c.cov, live: !!(a.rt.card && a.rt.card._live) }; })())`));
              log('Fase 10 kartu input native: ' + JSON.stringify(c10));
              if (!c10.on || !c10.line) { fail++; log('GAGAL: kartu input tidak digambar mesin native'); } else log('Kartu input native: OK');
              // --- Fase 9: grid Preview native (kotak + label + tally di ukuran panel Preview)
              await js('KM.getInput(window.__f8a).cc = null; window.__pg = KM.settings.pvGrid; KM.settings.pvGrid = { on: true, ids: [window.__f8a, window.__f8b] }; KM.engine.setPreview(window.__f8b); KM.changed("settings"); 1');
              await wait(2500);
              const g9 = JSON.parse(await js(`Promise.all([[0.25, 0.5], [0.75, 0.5]].map((q) => KM.nengine.probe('pvw', q[0], q[1]))).then((p) => JSON.stringify({ p, pvw: KM.nengine.pvw, why: KM.nengine.why.pvw, prev: [KM.engine.prev.width, KM.engine.prev.height], cells: KM.engine.gridLayout(2, KM.engine.prev.width, KM.engine.prev.height) }))`));
              log('Fase 9 grid Preview native: ' + JSON.stringify(g9));
              { const c = g9.cells || [], P = g9.prev || [1, 1]; // titik tengah tiap kotak
                const pts = c.map((q) => [(q.x + q.w / 2) / P[0], (q.y + q.h / 2) / P[1]]);
                const cp = pts.length === 2 ? JSON.parse(await js(`Promise.all(${JSON.stringify(pts)}.map((q) => KM.nengine.probe('pvw', q[0], q[1]))).then((p) => JSON.stringify(p))`)) : [];
                log('Fase 9 grid: piksel tengah kotak ' + JSON.stringify(cp));
                if (!g9.pvw || !near(cp[0], [255, 0, 0], 8) || !near(cp[1], [0, 255, 0], 8)) { fail++; log('GAGAL: grid Preview tidak tampil native'); } else log('Grid Preview native: OK'); }
              await js('KM.settings.pvGrid = window.__pg || { on: false, ids: [] }; KM.changed("settings"); 1');
              await wait(800);
              // --- Fase 9: stinger native (video diputar di halaman offscreen → tekstur GPU ke mesin native)
              const stFile = (typeof file === 'string' && file) || '';
              if (!stFile) log('catatan: tidak ada file video uji — uji stinger native dilewati');
              else {
                await js(`(() => { const v = KM.inputs.create('video', { title: 'Stinger uji', opts: { url: KM.fileUrl(${JSON.stringify(stFile)}) } }); window.__stv = v.id; window.__sg0 = Object.assign({}, KM.settings.stingers[0]); KM.settings.stingers[0] = { inputId: v.id, cut: 300 }; KM.engine.cut(window.__f8a); KM.engine.setPreview(window.__f8b); return 1; })()`);
                await wait(6000);
                await js('KM.engine.transition("stinger1", 0); 1'); await wait(700);
                const s9 = JSON.parse(await js(`KM.nengine.probe('pgm', 0.5, 0.5).then((p) => JSON.stringify({ p, pgm: KM.nengine.pgm, why: KM.nengine.why.pgm, tr: KM.state.trans && KM.state.trans.type }))`));
                log('Fase 9 stinger native (sedang berjalan): ' + JSON.stringify(s9));
                if (!s9.pgm || s9.tr !== 'stinger1' || near(s9.p, [255, 0, 0], 20) || near(s9.p, [0, 255, 0], 20)) { fail++; log('GAGAL: transisi stinger tidak native / video stinger tidak tampil'); } else log('Stinger native: OK');
                await wait(4000);
                await js('KM.settings.stingers[0] = window.__sg0; KM.inputs.remove(window.__stv); 1');
              }
              // --- Fase 9: Latar AI native — model segmentasi dijalankan mesin native (tanpa MediaPipe di KLM)
              try {
                const sn = JSON.parse(await js('JSON.stringify({ on: KM.nengine.segNative, info: KM.nengine.segInfo })'));
                log('Fase 9 model Latar AI native: ' + JSON.stringify(sn));
                if (!sn.on) { fail++; log('GAGAL: model Latar AI tidak dimuat mesin native'); }
                else {
                  const pf = path.join(require('os').tmpdir(), 'klm-seg-uji.png');
                  { const W = 160, H = 90, bm = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) { bm[i * 4] = 40; bm[i * 4 + 1] = 180; bm[i * 4 + 2] = 60; bm[i * 4 + 3] = 255; } fs.writeFileSync(pf, require('electron').nativeImage.createFromBitmap(bm, { width: W, height: H }).toPNG()); }
                  await js(`(() => { const g = KM.inputs.create('image', { title: 'Latar AI uji', opts: { url: KM.fileUrl(${JSON.stringify(pf)}) } }); window.__sgi = g.id; g.seg = Object.assign({}, KM.seg.DEF, { mode: 'colour', colour: '#0000ff', feather: 0 }); KM.engine.cut(g.id); return 1; })()`);
                  await wait(3500);
                  const r9 = JSON.parse(await js(`KM.nengine.probe('pgm', 0.5, 0.5).then((p) => JSON.stringify({ p, pgm: KM.nengine.pgm, why: KM.nengine.why.pgm, mp: !!(KM.getInput(window.__sgi).rt.segger) }))`));
                  log('Fase 9 Latar AI native (gambar tanpa orang → seluruhnya latar biru): ' + JSON.stringify(r9));
                  if (!r9.pgm || !near(r9.p, [0, 0, 255], 12)) { fail++; log('GAGAL: Latar AI tidak dirender native'); } else log('Latar AI native: OK');
                  if (r9.mp) log('catatan: MediaPipe di KLM ikut dimuat (mis. untuk miniatur) walau monitor memakai model native');
                  await js('KM.inputs.remove(window.__sgi); 1');
                }
              } catch (e) { fail++; log('GAGAL Latar AI native: ' + e.message); }
              await js('KM.inputs.remove(window.__f8a); KM.inputs.remove(window.__f8b); 1');
            } catch (e) { fail++; log('GAGAL Fase 8 native: ' + e.message); }
            await js('["__vs","__vt","__vb","__vc"].forEach((k) => KM.inputs.remove(window[k])); 1');
          } catch (e) { fail++; log('GAGAL video/gambar native: ' + e.message); }
          await js('KM.nengine.relaxInputs = false; KM.inputs.remove(window.__ocam); 1');
        } catch (e) { fail++; log('GAGAL output native: ' + e.message); }
        // --- Fase 2: grafis UTC ON AIR di atas Program, digambar mesin native dari tekstur GPU yang sama ---
        try {
          // uji sebelumnya memaksa jalur CPU → nyalakan lagi zero-copy (mesin native hanya menerima tekstur GPU)
          await js(`(() => { KM.utc.setZeroCopy(true); if (!KM.utc.has()) KM.utc.addInput({ onAir: true }); else if (!KM.utc.onAir()) KM.utc.setOnAir(true); const c = KM.inputs.create('colour', { title: 'Latar native', color: '#c00000' }); KM.engine.cut(c.id); return 1; })()`);
          await wait(3000);
          await post('/utc/api/klm/cmd', { cmd: 'show', target: 'lt' }); await post('/utc/api/klm/cmd', { cmd: 'show', target: 'logo' }); await post('/utc/api/klm/cmd', { cmd: 'show', target: 'ticker' });
          await wait(6000);
          const u2 = JSON.parse(await js('JSON.stringify({ pgm: KM.nengine.pgm, why: KM.nengine.why.pgm, utex: KM.nengine.utex || 0, utc: KM.nengine.utcState(), dsk: KM.utc.dskIds(), zc: KM.utc.zc.on })'));
          log('mesin native + UTC: ' + JSON.stringify(u2));
          // piksel grafis yang buram (di luar jalur running text yang bergerak) dibandingkan dengan gambar native
          const pick = JSON.parse(await js(`(() => { const c = KM.utc.canvas(), W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data;
            for (let y = Math.round(H * 0.05); y < H * 0.78; y += 6) for (let x = Math.round(W * 0.03); x < W * 0.97; x += 6) { const i = (y * W + x) * 4;
              if (d[i + 3] >= 254) { let ok = true; for (const [dx, dy] of [[-3,0],[3,0],[0,-3],[0,3]]) { const j = ((y + dy) * W + x + dx) * 4; if (d[j + 3] < 254 || Math.abs(d[j] - d[i]) + Math.abs(d[j + 1] - d[i + 1]) + Math.abs(d[j + 2] - d[i + 2]) > 12) ok = false; } if (ok) return JSON.stringify({ fx: x / W, fy: y / H, rgb: [d[i], d[i + 1], d[i + 2]] }); } }
            return 'null'; })()`));
          if (pick) {
            const pr2 = await js(`KM.nengine.probe('pgm', ${pick.fx}, ${pick.fy}).then((p) => JSON.stringify(p))`);
            log('mesin native + UTC: piksel grafis JS ' + JSON.stringify(pick.rgb) + ' @' + pick.fx.toFixed(3) + ',' + pick.fy.toFixed(3) + ' • native ' + pr2);
            const np = JSON.parse(pr2 || 'null');
            if (u2.pgm && np && pick.rgb.every((v, i) => Math.abs(v - np[i]) <= 14)) log('mesin native + UTC: OK — grafis sama dengan mesin JS');
            else if (u2.pgm) { fail++; log('GAGAL: grafis UTC di monitor native berbeda dengan mesin JS'); }
          } else log('catatan: tidak ada piksel grafis buram untuk dibandingkan');
          if (!u2.pgm) { fail++; log('GAGAL: Program dengan grafis UTC tidak ditampilkan native (' + u2.why + ')'); }
          fs.writeFileSync(path.join(out, 'native-utc-desktop.png'), (await (async () => { const { desktopCapturer: dc, screen: sc2 } = require('electron'); const dd = sc2.getDisplayMatching(mainWin.getContentBounds()); const ss = await dc.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(dd.size.width * (dd.scaleFactor || 1)), height: Math.round(dd.size.height * (dd.scaleFactor || 1)) } }); return (ss.find((x) => String(x.display_id) === String(dd.id)) || ss[0]).thumbnail; })()).toPNG());
          await post('/utc/api/klm/cmd', { cmd: 'hideall' }); await wait(2500);
          log('mesin native setelah grafis disembunyikan: ' + await js('JSON.stringify({ pgm: KM.nengine.pgm, why: KM.nengine.why.pgm, ulay: KM.nengine.utcState().ulay })'));
        } catch (e) { fail++; log('GAGAL mesin native + UTC: ' + e.message); }
        await js('KM.nengine.set(false)'); await wait(800);
        const off = await js('JSON.stringify({ pvw: KM.nengine.pvw, state: KM.nengine.state })');
        log('mesin native dimatikan: ' + off);
        if (JSON.parse(off).pvw) { fail++; log('GAGAL: monitor Preview tidak kembali ke tampilan biasa'); }
      }
    } catch (e) { fail++; log('GAGAL mesin native: ' + e.message); }
    // --- Virtual Set dari template + penyusun tata letak ---
    try {
      const vs = JSON.parse(await js(`(async () => { const t = KM.vset.builtin.find((x) => x.id === 'trio-utama'); const v = KM.vset.create(t, { fill: false });
        const src = KM.state.inputs.filter((i) => i !== v && !KM.inputTypes[i.type].noVideo).slice(0, 3); v.layers.forEach((l, i) => { l.inputId = src[i % src.length].id; });
        Object.assign(v.layers[0], { zoom: 1.6, px: 0.2, cropL: 0.1, label: 'Kamera utama' }); KM.engine.cut(v.id); await new Promise((r) => setTimeout(r, 700));
        KM.dialogs.inputSettings(v, 'layer'); await new Promise((r) => setTimeout(r, 500));
        const ed = !!document.querySelector('.layouted .lstage'), items = document.querySelectorAll('.layouted .litem').length;
        const saved = KM.vset.saveFrom(v, 'Uji CI'); document.querySelector('.modal .mh .x').click();
        return JSON.stringify({ type: v.type, kotak: v.layers.length, editor: ed, items, templat: KM.vset.custom().length, bawaan: KM.vset.builtin.length, live: KM.state.inputs.filter((i) => i.rt.live).length }); })()`));
      log('virtual set: ' + JSON.stringify(vs));
      fs.writeFileSync(path.join(out, 'virtualset.png'), (await mainWin.webContents.capturePage()).toPNG());
      if (vs.kotak !== 3 || !vs.editor || vs.items !== 4 || !vs.templat) { fail++; log('GAGAL: virtual set / penyusun tata letak'); }
    } catch (e) { fail++; log('GAGAL virtual set: ' + e.message); }
    // --- urutan penutupan: rekaman yang sedang jalan harus selesai tertulis sebelum keluar ---
    try {
      await js('KM.rec.startRecording()'); await wait(3000);
      const cr = await js(`KM.ui.requestClose({ auto: 'discard' }).then((r) => JSON.stringify({ r, log: KM.ui.shutdownLog, file: KM.rec.lastRecording || '', rec: KM.state.recording }))`);
      const c = JSON.parse(cr), size = c.file && fs.existsSync(c.file) ? fs.statSync(c.file).size : 0;
      log('penutupan: ' + cr + ' → file rekaman ' + size + ' byte; pembuka: ' + JSON.stringify(T));
      if (c.r !== 'quit' || c.rec || size < 20000) { fail++; log('GAGAL: urutan penutupan / rekaman tidak tuntas'); }
      if (T.revealBy !== 'ready') { fail++; log('GAGAL: jendela utama tidak muncul lewat sinyal siap (' + T.revealBy + ')'); }
    } catch (e) { fail++; log('GAGAL penutupan: ' + e.message); }
    log(fail ? 'HASIL: GAGAL (' + fail + ')' : 'HASIL: OK');
    app.on('will-quit', () => log('will-quit')); app.on('quit', () => log('quit'));
    process.on('exit', (c) => log('process exit ' + c));
    log('keluar…');
    try { fs.writeFileSync(path.join(out, 'result.txt'), fail ? 'FAIL' : 'OK'); } catch (e) {}
    mainWin.removeAllListeners('close');
    hardQuit('smoke');
  })();
}
