# Update di dalam aplikasi — panduan merilis versi baru

Sejak v1.17.0, KLM (versi installer) memeriksa versi baru sendiri dari **GitHub Releases**.

- KLM memeriksa update 25 detik setelah dibuka, lalu tiap 6 jam selama aplikasi menyala.
- Bila ada versi baru, muncul popup **"Update KLM tersedia"** berisi catatan rilis dan dua tombol: **Update sekarang** dan **Nanti**.
- **Update sekarang**: installer baru diunduh di latar belakang (KLM tetap bisa dipakai). Setelah siap, tombol **Pasang & buka ulang** menutup KLM dengan aman (tawaran simpan preset, rekaman/streaming diakhiri dengan benar), memasang update tanpa jendela installer, lalu membuka KLM kembali.
- **Nanti**: popup tidak muncul lagi untuk versi itu sampai KLM dibuka ulang. Bisa juga dari **Bantuan → ⬆ Periksa update** atau **Pengaturan → Tentang**.
- Pemeriksaan otomatis bisa dimatikan di **Pengaturan → Tentang**.
- Versi **portable** tidak bisa memasang diri sendiri. Tombol "Update sekarang" membuka unduhan versi portable terbaru di browser.

> Pengguna yang masih memakai versi **sebelum v1.17.0** perlu memasang v1.17.0 secara manual **satu kali**. Sesudah itu semua update berikutnya lewat aplikasi.

## Cara merilis versi baru

1. Naikkan versi di `package.json` (`"version"`) dan `src/js/core.js` (`KM.version`), misalnya `1.17.1`.
2. Tulis catatan di `README.md` dengan judul **`### Baru di v1.17.1`**. Isi bagian ini otomatis menjadi catatan rilis yang tampil di popup update.
3. Commit ke `main` dengan pesan yang memuat **`[rilis]`**, lalu push:
   ```
   git commit -am "KLM v1.17.1 [rilis]"
   git push origin main
   ```
   (Cara lama tetap bisa: push tag `v1.17.1`.) Tag `v1.17.1` dibuat otomatis di repo rilis.
4. GitHub Actions membangun installer, menandatanganinya bila sertifikat sudah dipasang (lihat `docs/SIGNING.md`), lalu menerbitkan Release di `klm-releases` berisi `KLM-Setup-1.17.1.exe`, `KLM-Portable-1.17.1.exe`, `latest.yml`, dan `KLM-HP.apk`.
5. KLM di PC yang sedang menyala mendapat popup update dalam beberapa jam (atau saat dibuka). Aplikasi HP memeriksa saat dibuka.

### Aplikasi HP (APK)

KLM HP memeriksa rilis terbaru saat dibuka (paling sering tiap 6 jam). Bila ada APK lebih baru muncul popup **Update KLM HP tersedia** dengan **Update sekarang / Nanti**. *Update sekarang* mengunduh APK di dalam aplikasi (dengan progres) lalu membuka penginstal Android; Android meminta izin "Pasang aplikasi tak dikenal" sekali untuk KLM HP. Pemasangan tetap dikonfirmasi pengguna (aturan Android untuk aplikasi di luar Play Store).

Push ke `main` tanpa `[rilis]` di pesan commit hanya membangun installer uji (artifact Actions), **tidak** memicu update ke pengguna.

## Repo rilis publik: `klmthebest10/klm-releases`

Installer, `latest.yml`, dan APK diterbitkan ke repo publik terpisah **`klm-releases`** (hanya berisi file rilis, tanpa kode). Dengan begitu repo kode `klm-mix` boleh dijadikan privat tanpa memutus update pengguna. Alamat ini tertanam di `package.json` (`build.publish`) dan di APK.

Yang diperlukan sekali di repo kode (`klm-mix` → **Settings → Secrets and variables → Actions → Secrets**):

| Secret | Isi | Untuk |
|---|---|---|
| `RELEASE_TOKEN` | Personal Access Token (fine-grained), akses **hanya** ke `klm-releases`, izin **Contents: Read and write** | CI menerbitkan rilis ke `klm-releases` |
| `ANDROID_DEBUG_KEYSTORE` | isi file `klm-hp-signing.keystore.base64.txt` | APK selalu ditandatangani kunci yang sama → update APK bisa menimpa versi lama |

Simpan cadangan file `klm-hp-signing.keystore`. Bila hilang, APK berikutnya tidak bisa dipasang menimpa versi lama (pengguna harus uninstall dulu).

Untuk memindahkan rilis ke repo lain, buat variabel `RELEASE_REPO` (mis. `akun/repo-lain`) dan ubah `build.publish` di `package.json`.

## Catatan teknis

- Pemasangan memakai `electron-updater` (NSIS). Karena KLM dipasang untuk semua pengguna (Program Files), Windows menampilkan konfirmasi administrator (UAC) saat memasang.
- Bila installer ditandatangani, `latest.yml` diperbarui otomatis setelah penandatanganan (`build/release-tools.js fix-latest`) agar pemeriksaan sha512 di aplikasi cocok.
- Pengaturan, preset, dan lisensi tidak tersentuh saat update.
