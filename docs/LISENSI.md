# Lisensi per perangkat — panduan penjual KLM Mix

KLM Mix memakai **lisensi offline per komputer**. Pembeli tidak perlu internet untuk aktivasi.

## Cara kerja singkat

1. Setiap komputer punya **Device ID** unik, misalnya `KLM-8VCZ-GHXH-EV49-F6ZC` (di Windows diambil dari MachineGuid).
2. Penjual membuat **kunci lisensi** untuk Device ID itu dengan **kunci privat** miliknya.
3. KLM Mix memeriksa tanda tangan kunci memakai **kunci publik** yang tertanam di aplikasi (`electron/license.js`). Kunci lisensi hanya sah di komputer dengan Device ID yang sama.
4. Tanpa lisensi, KLM Mix berjalan dalam **mode DEMO**: semua fitur bisa dipakai, tetapi output Program (rekaman, streaming, SRT, NDI, layar eksternal) diberi watermark "KLM MIX • VERSI DEMO". Dialog lisensi muncul saat aplikasi dibuka.

## Alur penjualan

1. Pembeli memasang KLM Mix, lalu membuka **Bantuan → 🔑 Lisensi** (atau **Pengaturan → Lisensi**, atau klik tanda **DEMO** di bar atas).
2. Pembeli menekan **Salin** dan mengirim Device ID ke Anda.
3. Anda membuat lisensi (lihat di bawah) lalu mengirim kunci atau file `.klmlic` ke pembeli.
4. Pembeli menempel kunci (atau menekan **Buka file .klmlic…**) lalu menekan **Aktifkan**. Watermark langsung hilang.

## Membuat lisensi

### Cara mudah: halaman `tools/license/pembuat-lisensi.html`

Buka file itu di Chrome/Edge (offline, tidak perlu server):

1. Pilih file kunci privat `klm-mix-private-key.jwk.json` (atau `.pem`).
2. Isi Device ID, nama pembeli, paket, dan masa berlaku (selamanya / 30 hari / 1 tahun / kustom).
3. Tekan **Buat lisensi** → **Salin kunci** atau **Unduh file .klmlic**.
4. Riwayat lisensi tersimpan di browser itu dan bisa diekspor ke CSV (simpan sebagai arsip penjualan).

### Cara baris perintah (perlu Node.js)

```
node tools/license/klm-license.js issue KLM-8VCZ-GHXH-EV49-F6ZC --name "Masjid Agung" --plan Pro --key D:\kunci\klm-mix-private-key.pem
node tools/license/klm-license.js issue KLM-XXXX-XXXX-XXXX-XXXX --name "Uji Coba" --days 14 --key ...
node tools/license/klm-license.js verify lisensi-KLM-8VCZ-GHXH-EV49-F6ZC.klmlic
```

Setiap lisensi yang dibuat lewat CLI juga dicatat ke `lisensi-terbit.csv`.

## Menjaga kunci privat

- **Siapa pun yang memegang kunci privat bisa membuat lisensi KLM Mix.** Simpan di tempat aman dan buat cadangan (flashdisk, penyimpanan terenkripsi).
- Jangan pernah meng-commit kunci privat ke GitHub. `.gitignore` sudah menolak `*.pem`, `*private-key*`, dan `*.klmlic`.
- Bila kunci privat hilang, lisensi yang sudah terbit tetap berlaku, tetapi Anda tidak bisa membuat lisensi baru dengan kunci itu. Buat pasangan kunci baru (`node tools/license/klm-license.js keygen <folder>`), ganti `PUBLIC_KEY` di `electron/license.js`, lalu rilis versi baru. Lisensi lama tidak akan berlaku di versi baru itu, jadi lisensi pembeli perlu diterbitkan ulang.

## Kasus yang perlu diketahui

| Situasi | Akibat | Solusi |
|---|---|---|
| Pembeli install ulang Windows | MachineGuid berubah → Device ID baru → kembali ke mode DEMO | Terbitkan lisensi baru untuk Device ID baru (kebijakan penjual) |
| Ganti komputer | Device ID berbeda | Terbitkan lisensi baru; minta pembeli menekan "Hapus lisensi dari komputer ini" di komputer lama |
| Jam komputer dimundurkan > 2 hari | Lisensi ditolak sementara | Setel tanggal yang benar lalu buka ulang KLM Mix |
| Lisensi berjangka habis | Kembali ke mode DEMO | Terbitkan lisensi baru |
| Aktivasi dari perangkat lain di jaringan (browser HP/laptop lain) | Ditolak; hanya dari komputer KLM Mix itu sendiri | — |

## Batasan keamanan (jujur)

Ini perlindungan offline yang wajar untuk aplikasi Electron, bukan anti-bajakan mutlak. Kode JavaScript aplikasi bisa dibongkar dan diubah oleh orang yang paham. Selama **repo GitHub masih publik**, siapa pun bisa membangun versi tanpa pemeriksaan lisensi. Sebelum menjual, jadikan repo **privat**.
