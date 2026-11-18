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
3. Commit, lalu buat dan kirim tag:
   ```
   git tag v1.17.1
   git push origin v1.17.1
   ```
4. GitHub Actions membangun installer, menandatanganinya bila sertifikat sudah dipasang (lihat `docs/SIGNING.md`), lalu menerbitkan Release berisi `KLM-Setup-1.17.1.exe`, `KLM-Portable-1.17.1.exe`, `latest.yml`, dan APK HP.
5. Dalam beberapa jam, semua KLM yang sedang menyala mendapat popup update.

Push ke `main` tanpa tag hanya membangun installer uji (artifact Actions), **tidak** memicu update ke pengguna.

## Bila repo kode dijadikan privat (disarankan sebelum menjual)

Aplikasi pengguna tidak bisa membaca Release dari repo privat tanpa token, dan token tidak boleh ditanam di aplikasi. Solusinya: **repo khusus rilis yang publik** (hanya berisi installer, tanpa kode).

1. Buat repo publik baru yang kosong, misalnya `klmthebest10/klm-releases`.
2. Buat **Personal Access Token** (fine-grained) dengan izin **Contents: Read and write** hanya untuk repo `klm-releases`.
3. Di repo kode (`klm-mix`) → **Settings → Secrets and variables → Actions**:
   - tab **Variables**: buat `RELEASE_REPO` = `klmthebest10/klm-releases`
   - tab **Secrets**: buat `RELEASE_TOKEN` = token tadi
4. Rilis berikutnya otomatis diterbitkan ke `klm-releases`, dan aplikasi yang dibangun sejak itu memeriksa update ke sana.

Aplikasi yang sudah terpasang sebelum langkah ini masih memeriksa repo lama. Jadi lakukan langkah ini **sebelum** repo kode dijadikan privat, lalu terbitkan satu rilis lagi selagi repo lama masih publik agar semua pengguna pindah ke sumber baru.

## Catatan teknis

- Pemasangan memakai `electron-updater` (NSIS). Karena KLM dipasang untuk semua pengguna (Program Files), Windows menampilkan konfirmasi administrator (UAC) saat memasang.
- Bila installer ditandatangani, `latest.yml` diperbarui otomatis setelah penandatanganan (`build/release-tools.js fix-latest`) agar pemeriksaan sha512 di aplikasi cocok.
- Pengaturan, preset, dan lisensi tidak tersentuh saat update.
