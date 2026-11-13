/*
 * KLM Mix - Proses utama Electron (versi Windows .exe)
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, desktopCapturer, session, screen, shell, Menu } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const T0 = Date.now() - Math.round(process.uptime() * 1000); // saat proses dimulai (untuk ukur kecepatan buka)
const T = {};
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
let utcOsr = null;
let netInfo = { ports: {}, ips: [] };
const writers = new Map();
let writerSeq = 1;
const browsers = new Map();


// ---------------- layar pembuka (jendela kecil tanpa bingkai) ----------------
// Jendela utama dimuat tersembunyi; layar pembuka menampilkan tahap penyiapan yang sebenarnya, lalu jendela utama
// muncul sekaligus dalam keadaan siap (tidak ada jendela kosong / antarmuka setengah jadi).
const BRAND_SVG = '<svg viewBox="0 0 24 24"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4b3e"/><stop offset="1" stop-color="#ffb11f"/></linearGradient></defs><rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="url(#g)"/><path d="M7.6 6.5h2.9v4.6l4.2-4.6h3.5l-4.95 5.25L18.4 17.5h-3.6l-4.3-4.75v4.75H7.6Z" fill="#fff"/></svg>';
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
  + '.bar{margin-top:9px;height:3px;border-radius:3px;background:rgba(255,255,255,.09);overflow:hidden}.bar i{display:block;height:100%;width:6%;border-radius:3px;background:linear-gradient(90deg,#ff4b3e,#ffb11f);transition:width .35s cubic-bezier(.2,.8,.2,1);box-shadow:0 0 12px rgba(255,120,40,.7)}'
  + '.ft{position:fixed;left:0;right:0;bottom:14px;padding:0 24px;display:flex;justify-content:space-between;font-size:10.5px;color:#5d6676;letter-spacing:.4px}.live{display:inline-flex;align-items:center;gap:6px}.live b{width:6px;height:6px;border-radius:50%;background:#ff4b3e;animation:bl 1.1s ease-in-out infinite}'
  + '@keyframes spin{to{transform:rotate(360deg)}}@keyframes pop{from{transform:scale(.6);opacity:0}}@keyframes up{from{transform:translateY(10px);opacity:0}}@keyframes bl{50%{opacity:.25}}'
  + '</style></head><body><div class="bg"></div><div class="mark"><i class="ring"></i><i class="ring b"></i>' + BRAND_SVG.replace('<svg ', '<svg class="k" ') + '</div>'
  + '<div class="txt"><div class="wm">KLM <span>Mix</span></div><div class="sub">Studio Produksi Live</div><div class="st" id="st">Memulai…</div><div class="bar"><i id="pb"></i></div></div>'
  + '<div class="ft"><span class="live"><b></b>MENYIAPKAN STUDIO</span><span>versi ' + ver + '</span></div>'
  + '<script>window.S=function(p,t){if(t)document.getElementById("st").textContent=t;if(p!=null)document.getElementById("pb").style.width=Math.max(6,Math.min(100,p))+"%"}</script></body></html>';
let splashWin = null, revealed = false, splashAt = 0;
function createSplash() {
  splashWin = new BrowserWindow({ width: 600, height: 300, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, center: true, show: true, skipTaskbar: false,
    backgroundColor: '#090b0f', title: 'KLM Mix', icon: path.join(__dirname, '..', 'build', 'icon.png'), webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
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
    width: 1600, height: 940, minWidth: 1180, minHeight: 700,
    backgroundColor: '#0a0c0f', title: 'KLM Mix', show: false,
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
  mainWin.webContents.on('render-process-gone', () => reveal('renderer-gone'));
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
          title: 'KLM Mix - Output', webPreferences: { backgroundThrottling: false }
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
          title: (arena ? 'Layar Arena' : 'UTC KLM Scoreboard') + ' • KLM Mix', icon: path.join(__dirname, '..', 'build', 'icon.png'), webPreferences: { backgroundThrottling: false }
        }, d ? { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, fullscreen: true, frame: false } : {})
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
  // Tutup: dialog Simpan / Jangan simpan / Batal. "Simpan" menulis ke preset (proyek) yang sedang dimuat,
  // atau membuat preset baru bila belum ada.
  let asking = false;
  mainWin.on('close', (e) => {
    if (quitting) return;
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
    const c = dialog.showMessageBoxSync(mainWin, { type: 'question', buttons: ['Keluar', 'Batal'], defaultId: 1, cancelId: 1, noLink: true, title: 'KLM Mix', message: 'Tutup KLM Mix?', detail: 'Rekaman dan streaming yang berjalan akan dihentikan.' });
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

// ---------------- IPC ----------------
const vstMgr = require('./vst').setup({ win: () => mainWin });
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
  T.ready = Date.now() - T0;
  createSplash(); // layar pembuka tampil dulu; jendela utama dimuat tersembunyi dan muncul saat benar-benar siap
  const serverP = server.start();
  createMain();
  splashStep(10, 'Menyalakan server lokal…');
  netInfo = await serverP;
  splashStep(22, 'Memuat antarmuka…');
  T.server = Date.now() - T0;
  utcOsr = setupUtcOsr({ port: () => netInfo.ports.http, scorePort: () => { const sc = server.score(); return sc ? sc.port() : 0; } });
  if (mainWin && !mainWin.isDestroyed()) mainWin.loadURL(`http://127.0.0.1:${netInfo.ports.http}/`).catch((e) => console.warn('loadURL', e.message));
  T.window2 = Date.now() - T0;
  if (process.env.KLM_SMOKE) smokeTest();
});
app.on('second-instance', () => { if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); } });
app.on('window-all-closed', () => hardQuit('window-all-closed'));
app.on('before-quit', () => { try { server.hub.shutdown(); } catch (e) {} });
app.on('will-quit', (e) => { if (!quitting) { e.preventDefault(); hardQuit('will-quit'); } });

// Keluar total. Di Windows, proses Chromium (GPU / renderer offscreen) bisa tertinggal setelah keluar biasa sehingga
// KLM Mix tidak bisa dibuka lagi (single instance). Jadi: hentikan renderer UTC, server media & jendela browser,
// tutup file rekaman yang masih terbuka, lalu akhiri proses sepenuhnya.
let quitting = false;
function hardQuit(why) {
  if (quitting) return; quitting = true;
  if (process.env.KLM_SMOKE) { try { fs.appendFileSync(path.join(process.env.KLM_SMOKE, 'smoke.log'), new Date().toISOString() + ' hardQuit ' + why + '\n'); } catch (e) {} }
  for (const w of browsers.values()) { try { w.destroy(); } catch (e) {} }
  try { vstMgr.shutdown(); } catch (e) {}
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
      const s = JSON.parse(st);
      if (!s.avail || !s.frames) { fail++; log('GAGAL: tidak ada frame overlay offscreen'); }
      if (!(s.px > 0.002)) { fail++; log('GAGAL: lapisan UTC kosong di Program'); }
      const progPng = async (name) => { const png = await js('new Promise(r => KM.engine.prog.toBlob(b => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }, "image/png"))'); fs.writeFileSync(path.join(out, name), Buffer.from(png.split(',')[1], 'base64')); };
      await progPng('program.png');
      // --- lapisan terpisah + running text native ---
      const li = JSON.parse(await js('JSON.stringify(KM.utc.layerInfo())'));
      log('lapisan: ' + JSON.stringify(li.map((l) => [l.id, l.frames, l.native, l.bbox && [l.bbox.x, l.bbox.y, l.bbox.w, l.bbox.h]])));
      const LI = Object.fromEntries(li.map((l) => [l.id, l]));
      if (!LI.main.frames || !LI.tk.frames || !LI.logo.frames) { fail++; log('GAGAL: ada lapisan UTC yang tidak menerima frame'); }
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
      await js('KM.ui.utcPanel(true, "acara")'); await wait(4000);
      const ok = await js('(() => { try { const f = document.querySelector("#utcFrame"); return !!(f && f.contentDocument && f.contentDocument.querySelector("#panel, .tabs, header")); } catch (e) { return "err " + e.message; } })()');
      log('panel UTC dimuat: ' + ok); if (ok !== true) fail++;
      fs.writeFileSync(path.join(out, 'panel.png'), (await mainWin.webContents.capturePage()).toPNG());
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
