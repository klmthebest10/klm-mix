// Salin halaman HP (../web) ke www/ untuk dibungkus Capacitor menjadi APK
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'web');
const dst = path.join(__dirname, 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('www siap:', fs.readdirSync(dst).join(', '));
