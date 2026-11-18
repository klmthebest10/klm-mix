/* KLM - update di dalam aplikasi
 *
 * Versi installer (NSIS): electron-updater memeriksa GitHub Releases (latest.yml), mengunduh installer baru di latar
 * belakang (diferensial bila bisa), lalu memasangnya diam-diam dan membuka KLM kembali — pengguna tidak perlu
 * mengunduh / menjalankan installer sendiri.
 * Versi portable / bila electron-updater tidak tersedia: hanya memeriksa rilis terbaru dan membuka halaman unduhan.
 *
 * Status dikirim ke halaman lewat 'update:status' { state, version, current, notes, date, percent, ... }.
 */
'use strict';
const { app, ipcMain, shell, net } = require('electron');

function create({ getWin, beforeInstall, log = () => {} }) {
  const pkg = require('../package.json');
  const pub = [].concat((pkg.build && pkg.build.publish) || [])[0] || {};
  const repo = pub.owner && pub.repo ? pub.owner + '/' + pub.repo : '';
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  const current = app.getVersion();
  let au = null;
  if (app.isPackaged && process.platform === 'win32' && !portable) {
    try { au = require('electron-updater').autoUpdater; } catch (e) { log('electron-updater tidak tersedia: ' + e.message); }
  }
  const mode = au ? 'auto' : repo ? 'manual' : 'off'; // auto = unduh & pasang di dalam aplikasi; manual = buka halaman unduhan
  let last = { state: 'idle', current, mode };
  const emit = (o) => {
    last = Object.assign({ current, mode }, o);
    const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('update:status', last);
    return last;
  };
  const notesText = (n) => (Array.isArray(n) ? n.map((x) => (x && x.note) || '').join('\n') : String(n || '')).replace(/<[^>]+>/g, '').trim().slice(0, 4000);

  if (au) {
    au.autoDownload = false;          // unduh hanya setelah pengguna memilih "Update sekarang"
    au.autoInstallOnAppQuit = false;  // KLM keluar dengan menghentikan proses → pemasangan dipicu langsung (lihat install)
    au.allowPrerelease = false;
    au.allowDowngrade = false;
    au.logger = { info: (m) => log('[update] ' + m), warn: (m) => log('[update] ⚠ ' + m), error: (m) => log('[update] ✗ ' + m), debug: () => {} };
    au.on('checking-for-update', () => emit({ state: 'checking' }));
    au.on('update-available', (i) => emit({ state: 'available', version: i.version, notes: notesText(i.releaseNotes), date: i.releaseDate || '' }));
    au.on('update-not-available', () => emit({ state: 'latest' }));
    au.on('download-progress', (p) => emit({ state: 'downloading', version: last.version, notes: last.notes, percent: Math.round(p.percent || 0), bps: Math.round(p.bytesPerSecond || 0), total: p.total || 0, transferred: p.transferred || 0 }));
    au.on('update-downloaded', (i) => emit({ state: 'downloaded', version: i.version, notes: last.notes || notesText(i.releaseNotes) }));
    au.on('error', (e) => emit({ state: 'error', version: last.version, message: friendly(e) }));
  }

  function friendly(e) {
    const m = String((e && e.message) || e || '');
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::ERR_/i.test(m)) return 'Tidak ada koneksi internet / server update tidak terjangkau';
    if (/latest\.yml|404|Cannot find channel/i.test(m)) return 'Belum ada rilis update yang bisa dipasang';
    if (/sha512|checksum/i.test(m)) return 'File update rusak saat diunduh — coba lagi';
    if (/signature|not signed|publisher/i.test(m)) return 'Tanda tangan file update tidak cocok — update dibatalkan demi keamanan';
    return m.split('\n')[0].slice(0, 200) || 'Gagal memeriksa update';
  }
  const cmp = (a, b) => { const x = String(a).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0), y = String(b).replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1; } return 0; };

  // portable / tanpa electron-updater: cek rilis terbaru lewat API GitHub
  async function checkManual() {
    emit({ state: 'checking' });
    try {
      const r = await net.fetch('https://api.github.com/repos/' + repo + '/releases/latest', { headers: { 'User-Agent': 'KLM/' + current, Accept: 'application/vnd.github+json' } });
      if (r.status === 404) return emit({ state: 'latest' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const v = String(j.tag_name || '').replace(/^v/, '');
      if (!v || cmp(v, current) <= 0) return emit({ state: 'latest' });
      const asset = (j.assets || []).find((a) => (portable ? /portable/i : /setup/i).test(a.name) && /\.exe$/i.test(a.name));
      return emit({ state: 'available', version: v, notes: notesText(j.body), date: j.published_at || '', url: (asset && asset.browser_download_url) || j.html_url });
    } catch (e) { return emit({ state: 'error', message: friendly(e) }); }
  }

  async function check() {
    if (mode === 'off') return emit({ state: 'unsupported', message: 'Update otomatis hanya tersedia di versi PC yang dipasang dengan installer' });
    if (mode === 'manual') return checkManual();
    if (['downloading', 'downloaded'].includes(last.state)) return last;
    try { await au.checkForUpdates(); } catch (e) { emit({ state: 'error', message: friendly(e) }); }
    return last;
  }
  async function download() {
    if (mode === 'manual') { if (last.url) shell.openExternal(last.url); return emit(Object.assign({}, last, { state: 'opened' })); }
    if (mode !== 'auto') return last;
    if (last.state === 'downloaded') return last;
    emit({ state: 'downloading', version: last.version, notes: last.notes, percent: 0 });
    try { await au.downloadUpdate(); } catch (e) { emit({ state: 'error', version: last.version, message: friendly(e) }); }
    return last;
  }
  async function install() {
    if (mode !== 'auto' || last.state !== 'downloaded') return { ok: false, reason: 'Update belum selesai diunduh' };
    log('[update] memasang v' + last.version);
    try { await beforeInstall(); } catch (e) {}
    // quitAndInstall menjalankan installer (diam-diam, lalu membuka KLM lagi) SEBELUM app.quit()
    setImmediate(() => { try { au.quitAndInstall(true, true); } catch (e) { emit({ state: 'error', message: friendly(e) }); } });
    return { ok: true };
  }

  ipcMain.handle('update:info', () => last);
  ipcMain.handle('update:check', () => check());
  ipcMain.handle('update:download', () => download());
  ipcMain.handle('update:install', () => install());
  return { check, download, install, info: () => last, mode };
}

module.exports = { create };
