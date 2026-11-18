# Tanda tangan kode (code signing) installer KLM

Installer yang ditandatangani menampilkan nama penerbit Anda (bukan "Unknown publisher") dan mengurangi peringatan Windows SmartScreen. Pipeline GitHub Actions (`.github/workflows/build-windows.yml`) **sudah siap**. Yang Anda perlukan hanya **sertifikat code signing**, lalu memasukkan datanya sebagai *secret* di GitHub. Tanpa secret, build tetap jalan seperti biasa tanpa tanda tangan.

Yang ditandatangani: `KLM.exe` beserta helper (`klm-vsthost.exe`, `klm-procaudio.exe`, `klm-airplay.exe`; khusus jalur .pfx), lalu installer `KLM-Setup-x.y.z.exe` dan `KLM-Portable-x.y.z.exe`.

## Pilihan sertifikat

| Pilihan | Cocok untuk | Catatan |
|---|---|---|
| **SSL.com eSigner** (OV atau EV, kunci di cloud) | Disarankan untuk Indonesia | Tersambung langsung ke GitHub Actions. Ada kuota tanda tangan per bulan, jadi pipeline hanya menandatangani saat rilis tag `v*`. |
| **Sertifikat .pfx** (kunci bisa diekspor) | Sertifikat lama/internal, atau uji coba self-signed | Sejak 2023, sertifikat OV/EV baru dari CA wajib disimpan di token/HSM sehingga umumnya **tidak** bisa diekspor ke .pfx. Self-signed **tidak** menghilangkan peringatan SmartScreen. |
| Azure Trusted Signing (Artifact Signing) | — | Saat ini hanya menerima organisasi di AS dan Kanada; belum tersedia untuk Indonesia. |

OV dan EV sama-sama menghilangkan "Unknown publisher". Reputasi SmartScreen tetap dibangun seiring jumlah unduhan, jadi peringatan bisa masih muncul di awal untuk sertifikat baru.

## A. SSL.com eSigner

1. Beli sertifikat **Code Signing (OV atau EV)** di SSL.com dan selesaikan verifikasi identitas.
2. Aktifkan **eSigner** untuk sertifikat itu, lalu catat **Credential ID** dan **TOTP secret** (kode QR saat pendaftaran eSigner; simpan teks secret-nya).
3. Di GitHub: **Settings → Secrets and variables → Actions → New repository secret**, buat:
   - `ES_USERNAME` = username akun SSL.com
   - `ES_PASSWORD` = password akun SSL.com
   - `ES_CREDENTIAL_ID` = Credential ID
   - `ES_TOTP_SECRET` = TOTP secret
4. Rilis versi dengan tag, misalnya `git tag v1.16.0 && git push origin v1.16.0`. Installer di halaman Release akan ditandatangani.

## B. Sertifikat .pfx

1. Ubah file .pfx ke base64 (PowerShell):
   `[Convert]::ToBase64String([IO.File]::ReadAllBytes("sertifikat.pfx")) | Set-Clipboard`
2. Buat secret `WIN_CSC_LINK` (isi base64 tadi) dan `WIN_CSC_KEY_PASSWORD` (password .pfx).
3. Setiap build (push ke `main` maupun tag) akan menandatangani dengan `signtool` + timestamp DigiCert.

## Memeriksa hasil

Langkah **Status tanda tangan** di log GitHub Actions menampilkan status tiap file (`Valid` = sudah ditandatangani). Di Windows: klik kanan installer → **Properties → Digital Signatures**.
