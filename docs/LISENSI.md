# Lisensi per perangkat — panduan penjual KLM

KLM memakai **lisensi offline per komputer**. Pembeli tidak perlu internet untuk aktivasi.

## Cara kerja singkat

1. Setiap komputer punya **Device ID** unik, misalnya `KLM-8VCZ-GHXH-EV49-F6ZC`. Di Windows, ID ini diambil dari **UUID perangkat keras (motherboard / SMBIOS)**, bukan dari instalasi Windows. Karena itu Device ID **tetap sama setelah Windows di-install ulang**.
2. Penjual membuat **kunci lisensi seumur hidup** untuk Device ID itu dengan **kunci privat** miliknya.
3. KLM memeriksa tanda tangan kunci memakai **kunci publik** yang tertanam di aplikasi (`electron/license.js`). Kunci lisensi hanya sah di komputer dengan Device ID yang sama.
4. **Tanpa lisensi**, KLM berjalan normal tanpa watermark. Yang terkunci hanya fitur premium: **UTC Acara, UTC Score, Mirroring HP, dan KLMCAM**. Bila salah satunya diklik, dialog lisensi muncul.

## Aktivasi otomatis (lynk.id)

1. Pembeli membeli produk **"Lisensi KLM — Kinetic Live Mixer"** di lynk.id.
2. lynk.id mengirim webhook ke `https://fftmmdyvrxzrbrhdvucq.supabase.co/functions/v1/lynk-webhook`; pesanan disimpan di tabel `klm_orders` (Supabase proyek *bukukas*).
3. Di KLM, pembeli membuka **🔑 Lisensi**, mengetik email pembelian, lalu menekan **Aktifkan otomatis**. Fungsi `klm-activate` menandatangani kunci untuk Device ID itu dengan rahasia `KLM_PRIVATE_KEY`. Satu pembelian = satu komputer; komputer yang sama boleh mengaktifkan ulang (install ulang Windows).
4. Rahasia yang wajib diisi di Supabase → Edge Functions → Secrets: `KLM_PRIVATE_KEY` (isi file `klm-mix-private-key.pem`) dan `LYNK_MERCHANT_KEY` (merchant key dari lynk.id → Settings → Integrations → Webhook).

Ganti komputer: hapus baris di `klm_licenses` untuk pesanan itu, atau terbitkan lisensi manual seperti di bawah.

## Alur penjualan (manual)

1. Pembeli memasang KLM, lalu membuka **Bantuan → 🔑 Lisensi** (atau **Pengaturan → Lisensi**, tombol **🔒 Aktifkan** di bar atas, atau langsung mengklik fitur yang terkunci).
2. Pembeli menekan **Salin** dan mengirim Device ID ke Anda.
3. Anda membuat lisensi (lihat di bawah) lalu mengirim kunci atau file `.klmlic` ke pembeli.
4. Pembeli menempel kunci (atau menekan **Buka file .klmlic…**) lalu menekan **Aktifkan**. Fitur premium langsung terbuka.

## Membuat lisensi

### Cara mudah: halaman pembuat lisensi (3 langkah)

1. Buka **`KLM-Pembuat-Lisensi-PRIBADI.html`** (klik dua kali, terbuka di Chrome/Edge, offline).
2. **Tempel pesan WhatsApp pembeli apa adanya** (atau Device ID-nya saja). Device ID dan nama pembeli dikenali otomatis. Salah ketik huruf O/I/L dibetulkan sendiri.
3. Tekan **Buat lisensi** (atau Ctrl+Enter), lalu **Kirim lewat WhatsApp** atau **Salin pesan**. Pesan untuk pembeli sudah berisi kunci lisensi dan cara aktivasinya.

Hal lain yang otomatis:

- **Lisensi selalu seumur hidup.** Paket (default `Pro`) ada di "Lanjutan".
- **Device ID yang sudah pernah dibuatkan lisensi** langsung diberi tanda. Kunci lamanya bisa dikirim ulang, misalnya untuk pembeli yang install ulang Windows. Di tabel riwayat, tombol **Kirim ulang** tersedia di setiap baris dan ada kolom pencarian.
- **Setiap lisensi diperiksa** dengan kunci publik aplikasi sebelum ditampilkan, jadi kunci yang salah tidak akan terkirim.
- **Riwayat tersimpan di browser.** Pakai **Ekspor CSV** untuk arsip penjualan dan **Impor CSV** saat pindah komputer.

**Membuat salinan PRIBADI** (kunci privat tertanam, tidak perlu memilih file kunci):

```
node tools/license/buat-pembuat-pribadi.js --key D:\kunci\klm-mix-private-key.pem
```

File `KLM-Pembuat-Lisensi-PRIBADI.html` sama rahasianya dengan kunci privat. Simpan hanya di komputer Anda sendiri dan jangan dibagikan. `.gitignore` sudah menolak `*PRIBADI*`.

Tanpa salinan pribadi, buka `tools/license/pembuat-lisensi.html` lalu pilih file kunci privat **sekali saja**. Browser itu akan mengingatnya sebagai kunci yang hanya bisa dipakai untuk menandatangani dan tidak bisa disalin keluar. Kunci dihapus dari browser lewat **Lupakan kunci**.

### Cara baris perintah (perlu Node.js)

```
node tools/license/klm-license.js issue KLM-8VCZ-GHXH-EV49-F6ZC --name "Masjid Agung" --plan Pro --key D:\kunci\klm-mix-private-key.pem
node tools/license/klm-license.js verify lisensi-KLM-8VCZ-GHXH-EV49-F6ZC.klmlic
```

Setiap lisensi yang dibuat lewat CLI juga dicatat ke `lisensi-terbit.csv`.

## Lisensi khusus (fitur tertentu untuk perangkat tertentu)

Fitur khusus — saat ini **📺 Layar TV Masjid** — tidak ikut di lisensi biasa (termasuk aktivasi otomatis lynk.id).
Untuk memberikannya ke perangkat / pengguna tertentu, buat lisensi khusus untuk Device ID-nya:

- **Halaman pembuat lisensi:** centang **"📺 Fitur khusus: Layar TV Masjid"** sebelum menekan *Buat lisensi*. Pesan untuk pembeli
  otomatis menyebut fiturnya, dan riwayat menandai lisensi itu dengan label **📺 TV** (ikut di ekspor/impor CSV, kolom `fitur`).
- **Baris perintah:** `node tools/license/klm-license.js issue KLM-XXXX-XXXX-XXXX-XXXX --name "Masjid Al-Ikhlas" --fitur tv`

Pengguna yang sudah punya lisensi biasa cukup memasukkan kunci khusus yang baru (menggantikan yang lama) di 🔑 Lisensi.
Dialog lisensi di KLM lalu menampilkan "Fitur khusus: 📺 Layar TV Masjid" dan bagian itu muncul di Pengaturan › SRT / TV.
Fitur tersimpan di dalam kunci yang ditandatangani & terikat Device ID, jadi tidak bisa ditambahkan sendiri oleh pengguna.
Lisensi berpaket **Pemilik** otomatis mendapat semua fitur khusus. Perlu KLM v1.18.6 atau lebih baru.

## Menjaga kunci privat

- **Siapa pun yang memegang kunci privat bisa membuat lisensi KLM.** Simpan di tempat aman dan buat cadangan (flashdisk, penyimpanan terenkripsi).
- Jangan pernah meng-commit kunci privat ke GitHub. `.gitignore` sudah menolak `*.pem`, `*private-key*`, dan `*.klmlic`.
- Bila kunci privat hilang, lisensi yang sudah terbit tetap berlaku, tetapi Anda tidak bisa membuat lisensi baru dengan kunci itu. Buat pasangan kunci baru (`node tools/license/klm-license.js keygen <folder>`), ganti `PUBLIC_KEY` di `electron/license.js`, lalu rilis versi baru. Lisensi lama tidak akan berlaku di versi baru itu, jadi lisensi pembeli perlu diterbitkan ulang.

## Kasus yang perlu diketahui

| Situasi | Akibat | Solusi |
|---|---|---|
| Pembeli install ulang Windows | Device ID tetap sama | Pembeli cukup memasukkan **kunci lisensi yang sama** lagi (simpan file `.klmlic`) |
| Ganti motherboard / komputer baru | Device ID berbeda | Kebijakan penjual: terbitkan lisensi baru untuk Device ID baru |
| Motherboard tanpa UUID yang valid (jarang, motherboard rakitan murah) | KLM memakai serial board; bila tidak ada juga, memakai ID Windows (berubah saat install ulang) | Terbitkan ulang bila perlu |
| Aktivasi dari perangkat lain di jaringan (browser HP/laptop lain) | Ditolak; hanya dari komputer KLM itu sendiri | — |
| Membuka halaman UTC / Score / KLMCAM / Mirroring langsung dari browser atau HP tanpa lisensi | Muncul halaman "memerlukan lisensi" | Aktifkan lisensi di komputer KLM |

## Batasan keamanan (jujur)

Ini perlindungan offline yang wajar untuk aplikasi Electron, bukan anti-bajakan mutlak. Kode JavaScript aplikasi bisa dibongkar dan diubah oleh orang yang paham. Selama **repo GitHub masih publik**, siapa pun bisa membangun versi tanpa pemeriksaan lisensi. Sebelum menjual, jadikan repo **privat**.
