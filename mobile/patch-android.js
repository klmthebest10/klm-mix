// Tambal proyek Android hasil `npx cap add android`:
// izin kamera/mic/jaringan, cleartext ke IP PC, layar tetap menyala, ikon KLM
const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, 'android', 'app', 'src', 'main');

// 1) AndroidManifest
const mf = path.join(A, 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
const perms = ['REQUEST_INSTALL_PACKAGES', 'CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE', 'CHANGE_WIFI_MULTICAST_STATE', 'WAKE_LOCK', 'VIBRATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PROJECTION', 'POST_NOTIFICATIONS'];
let add = '';
for (const p of perms) if (!x.includes('android.permission.' + p)) add += `    <uses-permission android:name="android.permission.${p}" />\n`;
add += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n';
add += '    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />\n';
add += '    <uses-feature android:name="android.hardware.camera.flash" android:required="false" />\n';
x = x.replace(/<application/, add + '\n    <application');
if (!x.includes('usesCleartextTraffic')) x = x.replace(/<application/, '<application android:usesCleartextTraffic="true"');
fs.writeFileSync(mf, x);

// 2) Kode native: MainActivity (layar tetap menyala, tautan klmmix://), plugin & layanan Mirroring layar
const actDir = path.join(A, 'java', 'com', 'klm', 'mix', 'hp');
fs.mkdirSync(actDir, { recursive: true });
const nat = path.join(__dirname, 'native');
for (const f of fs.readdirSync(nat)) if (f.endsWith('.java')) fs.copyFileSync(path.join(nat, f), path.join(actDir, f));
x = fs.readFileSync(mf, 'utf8');
if (!x.includes('MirrorService')) {
  x = x.replace(/<\/application>/, '    <service android:name=".MirrorService" android:exported="false" android:foregroundServiceType="mediaProjection" />\n    </application>');
  // QR Mirroring → klmmix://mirror?... membuka aplikasi ini
  x = x.replace(/<\/activity>/, '    <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="klmmix" />\n            </intent-filter>\n        </activity>');
  fs.writeFileSync(mf, x);
}

// 2b) Update dari dalam aplikasi: FileProvider untuk APK hasil unduhan (folder Download milik aplikasi)
const xmlDir = path.join(A, 'res', 'xml'); fs.mkdirSync(xmlDir, { recursive: true });
const fp = path.join(xmlDir, 'file_paths.xml');
let fpx = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n</paths>\n';
if (!fpx.includes('klm_updates')) fpx = fpx.replace('</paths>', '    <external-files-path name="klm_updates" path="Download/" />\n    <cache-path name="klm_updates_cache" path="." />\n</paths>');
fs.writeFileSync(fp, fpx);
x = fs.readFileSync(mf, 'utf8');
if (!x.includes('androidx.core.content.FileProvider')) {
  x = x.replace(/<\/application>/, '    <provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.fileprovider" android:exported="false" android:grantUriPermissions="true">\n            <meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths" />\n        </provider>\n    </application>');
  fs.writeFileSync(mf, x);
}

// 2c) Versi APK mengikuti versi KLM (versionCode harus naik agar update bisa menimpa versi lama)
const gradle = path.join(__dirname, 'android', 'app', 'build.gradle');
const ver = require('../package.json').version;
const [vM, vm, vp] = ver.split('.').map((n) => parseInt(n, 10) || 0);
const code = vM * 10000 + vm * 100 + vp;
let g = fs.readFileSync(gradle, 'utf8');
g = g.replace(/versionCode\s+\d+/, 'versionCode ' + code).replace(/versionName\s+"[^"]*"/, 'versionName "' + ver + '"');
fs.writeFileSync(gradle, g);
console.log('Versi APK: ' + ver + ' (' + code + ')');

// 3) Ikon
const res = path.join(A, 'res');
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
const icons = path.join(__dirname, 'icons');
for (const d of fs.readdirSync(icons)) {
  const out = path.join(res, d); fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(path.join(icons, d))) fs.copyFileSync(path.join(icons, d, f), path.join(out, f));
}
console.log('Android dipatch: izin, cleartext, keep-screen-on, mirroring layar, update dalam aplikasi, versi, ikon.');
console.log(fs.readFileSync(mf, 'utf8'));
