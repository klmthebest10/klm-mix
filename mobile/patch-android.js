// Tambal proyek Android hasil `npx cap add android`:
// izin kamera/mic/jaringan, cleartext ke IP PC, layar tetap menyala, ikon KLM Mix
const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, 'android', 'app', 'src', 'main');

// 1) AndroidManifest
const mf = path.join(A, 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
const perms = ['CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE', 'CHANGE_WIFI_MULTICAST_STATE', 'WAKE_LOCK', 'VIBRATE', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MEDIA_PROJECTION', 'POST_NOTIFICATIONS'];
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

// 3) Ikon
const res = path.join(A, 'res');
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
const icons = path.join(__dirname, 'icons');
for (const d of fs.readdirSync(icons)) {
  const out = path.join(res, d); fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(path.join(icons, d))) fs.copyFileSync(path.join(icons, d, f), path.join(out, f));
}
console.log('Android dipatch: izin, cleartext, keep-screen-on, mirroring layar, ikon.');
console.log(fs.readFileSync(mf, 'utf8'));
