// Salin halaman HP (../web) ke www/ untuk dibungkus Capacitor menjadi APK
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'web');
const dst = path.join(__dirname, 'www');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
// sumber update APK: variabel CI RELEASE_REPO, atau repo rilis di package.json utama
const pub = [].concat((require('../package.json').build || {}).publish || [])[0] || {};
const relRepo = process.env.RELEASE_REPO || (pub.owner && pub.repo ? pub.owner + '/' + pub.repo : '');
const au = path.join(dst, 'app-update.js');
if (fs.existsSync(au)) fs.writeFileSync(au, fs.readFileSync(au, 'utf8').replace('__RELEASE_REPO__', relRepo));
console.log('sumber update APK:', relRepo || '(tidak ada)');
console.log('www siap:', fs.readdirSync(dst).join(', '));
