/* KLM Mix - buat sertifikat HTTPS lokal di proses terpisah (agar pembukaan pertama tidak tertahan) */
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
try {
  const selfsigned = require('selfsigned');
  const pems = selfsigned.generate([{ name: 'commonName', value: 'KLM Mix' }], { days: 3650, keySize: 2048, algorithm: 'sha256' });
  fs.writeFileSync(path.join(dir, 'cert-key.pem.tmp'), pems.private); fs.writeFileSync(path.join(dir, 'cert.pem.tmp'), pems.cert);
  fs.renameSync(path.join(dir, 'cert-key.pem.tmp'), path.join(dir, 'cert-key.pem')); fs.renameSync(path.join(dir, 'cert.pem.tmp'), path.join(dir, 'cert.pem'));
  process.exit(0);
} catch (e) { console.error(e.message); process.exit(1); }
