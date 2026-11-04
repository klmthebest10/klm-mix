// Tambal proyek Android hasil `npx cap add android`:
// izin kamera/mic/jaringan, cleartext ke IP PC, layar tetap menyala, ikon KLM Mix
const fs = require('fs');
const path = require('path');
const A = path.join(__dirname, 'android', 'app', 'src', 'main');

// 1) AndroidManifest
const mf = path.join(A, 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
const perms = ['CAMERA', 'RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE', 'CHANGE_WIFI_MULTICAST_STATE', 'WAKE_LOCK', 'VIBRATE'];
let add = '';
for (const p of perms) if (!x.includes('android.permission.' + p)) add += `    <uses-permission android:name="android.permission.${p}" />\n`;
add += '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n';
add += '    <uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />\n';
add += '    <uses-feature android:name="android.hardware.camera.flash" android:required="false" />\n';
x = x.replace(/<application/, add + '\n    <application');
if (!x.includes('usesCleartextTraffic')) x = x.replace(/<application/, '<application android:usesCleartextTraffic="true"');
fs.writeFileSync(mf, x);

// 2) MainActivity: layar tetap menyala saat dipakai kamera/remote
const actDir = path.join(A, 'java', 'com', 'klm', 'mix', 'hp');
fs.mkdirSync(actDir, { recursive: true });
fs.writeFileSync(path.join(actDir, 'MainActivity.java'), `package com.klm.mix.hp;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
`);

// 3) Ikon
const res = path.join(A, 'res');
fs.rmSync(path.join(res, 'mipmap-anydpi-v26'), { recursive: true, force: true });
const icons = path.join(__dirname, 'icons');
for (const d of fs.readdirSync(icons)) {
  const out = path.join(res, d); fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(path.join(icons, d))) fs.copyFileSync(path.join(icons, d, f), path.join(out, f));
}
console.log('Android dipatch: izin, cleartext, keep-screen-on, ikon.');
