# KLM Mix

Studio produksi live all‑in‑one ala **vMix Pro** — switcher, transisi, overlay, title **UTC KLM Acara**, kamera HP **KLMCAM**, mixer audio, rekam, streaming multi‑platform, instant replay, playlist, multiview, dan API kompatibel vMix. Berjalan **100% offline** di jaringan lokal.

- **PC Windows (.exe)** — aplikasi utama (mixer). Tidak perlu Node.js.
- **HP Android (.apk)** — KLMCAM (kamera wireless), Remote Switcher, Title & Audio.

---

## Struktur proyek

```
klm-mix/
├── electron/                 # proses utama Windows (.exe)
│   ├── main.js               # jendela, dialog file, capture layar, output monitor-2, browser input
│   ├── preload.js            # jembatan aman renderer ↔ main
│   ├── server.js             # server lokal: HTTP/HTTPS/WebSocket/TCP + API vMix
│   ├── hub.js                # media hub: input stream (RTMP/SRT/RTSP/HLS/NDI), streaming keluar, deteksi GPU encoder
│   ├── ffmpeg-args.js        # perintah ffmpeg streaming (RTMP/RTMPS/SRT, multi-tujuan)
│   ├── ptz.js                # kontrol PTZ: VISCA over IP (Sony/PTZOptics/umum) & HTTP-CGI
│   └── ndi-worker.js         # NDI in/out (proses terpisah, butuh NDI Runtime gratis)
├── src/                      # aplikasi mixer (UI + mesin)
│   ├── index.html            # tampilan utama
│   ├── output.html           # jendela output eksternal / multiview
│   ├── css/app.css
│   ├── vendor/qr.js          # generator QR offline
│   └── js/
│       ├── core.js           # state, pengaturan, utilitas
│       ├── engine.js         # render Preview/Program, transisi, overlay 1-4, FTB, layer, multiview
│       ├── effects.js        # GPU: koreksi warna, chroma key, luma key
│       ├── inputs.js         # semua jenis input
│       ├── titles.js         # UTC KLM Acara (16 template, 8 tema)
│       ├── audio.js          # mixer audio (EQ, kompresor, gate, delay, bus M/A/B, solo, auto)
│       ├── record.js         # rekam, streaming, MultiCorder, snapshot
│       ├── replay.js         # instant replay + playlist
│       ├── link.js           # KLMCAM WebRTC, tally, remote HP
│       ├── api.js            # 206 fungsi API (nama sama dengan vMix)
│       ├── ptz.js            # panel PTZ fisik + PTZ virtual
│       ├── script.js         # skrip JavaScript, trigger per input, shortcut kustom
│       ├── designer.js       # Title Designer (desain title bebas) + impor CSV
│       ├── perf.js           # mode performa Hemat / Seimbang / Kualitas
│       ├── ui.js · dialogs.js · dock.js · app.js
├── web/                      # halaman HP (dipakai APK & browser HP)
│   ├── index.html            # menu HP (isi IP PC)
│   ├── camera.html/.js       # KLMCAM
│   ├── remote.html/.js       # Remote switcher, overlay, title, audio, replay (mode hemat data)
│   ├── call.html/.js         # KLM Call: tamu/narasumber jarak jauh
│   └── common.js · phone.css · manifest.json
├── mobile/                   # pembungkus Android (Capacitor) → .apk
├── build/                    # ikon & skrip installer (aturan firewall otomatis)
└── .github/workflows/        # build otomatis .exe & .apk di GitHub
```

---

## Cara mendapatkan file .exe dan .apk

File dibangun otomatis oleh **GitHub Actions** (gratis):

1. Buat repo baru di GitHub (mis. `klm-mix`), lalu unggah **seluruh isi folder ini** (termasuk folder `.github`).
2. Buka tab **Actions** → tunggu dua workflow selesai (±5–10 menit):
   - **Build Windows (.exe)** → artifact `KLM-Mix-Windows` berisi
     - `KLM-Mix-Setup-1.1.0.exe` (installer, otomatis membuka firewall untuk HP)
     - `KLM-Mix-Portable-1.1.0.exe` (tanpa instal)
   - **Build Android (.apk)** → artifact `KLM-Mix-Android` berisi `KLM-Mix-HP.apk`
3. Untuk rilis resmi: buat tag `v1.1.0` → file otomatis muncul di halaman **Releases**.

> Versi portable: saat pertama dibuka, Windows menanyakan izin jaringan → pilih **Allow / Izinkan** (centang Private & Public) agar HP bisa terhubung.

### Uji cepat tanpa build (mode web)
```bash
npm install
npm run web        # buka http://127.0.0.1:8620 di Chrome/Edge
```
Mode web mendukung semua fitur kecuali streaming RTMP, input Web Browser, dan simpan langsung ke folder (rekaman diunduh).

---

## Menghubungkan HP

PC dan HP harus di **Wi‑Fi/LAN yang sama** (tidak perlu internet).

| Cara | Langkah |
|---|---|
| **Aplikasi APK** (disarankan) | Instal `KLM-Mix-HP.apk` → isi IP PC (lihat menu **📱 HP & Jaringan** di PC) → pilih Kamera / Remote / Title / Audio |
| **Browser HP** | Scan QR di PC, atau buka `http://IP-PC:8620/hp`. Kamera via browser memakai `https://IP-PC:8621/cam` (terima peringatan sertifikat) |

**KLMCAM:** pilih slot yang sama dengan input KLMCAM di PC (atau biarkan otomatis — input dibuat saat HP terhubung). Tally merah/hijau tampil di layar HP. Dari PC bisa atur zoom, senter, ganti kamera, fokus, kualitas (720p/1080p, 30/60fps) & bitrate.

Tips latensi rendah: Wi‑Fi 5 GHz, HP dekat router, kualitas 720p60 atau 1080p30, colok charger. Bila suara HP sedikit telat, atur **Delay** audio di ⚙ → Audio.

---

## Fitur

### Switcher & output
- Preview / Program, **Cut**, **Quick Play**, **4 tombol transisi** (efek & durasi bisa diatur), **T‑Bar** manual
- 17 transisi: Fade, Merge, Wipe, Wipe↑, Slide, Slide↑, Fly, Zoom, Cross Zoom, Iris, Barn Door, Cube, Dip hitam/putih, Blur, **Stinger 1 & 2** (WebM transparan + titik cut)
- **Overlay 1–4** dengan efek masuk/keluar (Fade, Slide, Zoom, Wipe, Cut)
- **Fade To Black**
- **Layer / MultiView**: hingga 10 layer per input (PiP, side‑by‑side, bingkai berwarna)
- Posisi, zoom, rotasi, crop, mode Fit/Fill/Stretch, preset PiP
- **Koreksi warna** (kecerahan, kontras, saturasi, hue, gamma) & **Chroma Key / Luma Key** di GPU (ambil warna dengan klik)
- **Virtual Set** (4 latar studio) + kamera green screen
- Resolusi 720p / 1080p / 1440p / 4K / **vertikal 9:16** / persegi; 24–60 fps
- **Output eksternal** ke monitor/proyektor ke‑2 (layar penuh) & **Multiview** (preview + program + 8 input + jam + status REC/LIVE)

### Jenis input
Video (MP4/MOV/MKV/WebM), Gambar/GIF, **Daftar Putar** (video+foto), Kamera/capture card (hingga 4K), **KLMCAM** (HP), **Stream Masuk** (terima RTMP/SRT dari OBS/HP/encoder, tarik RTSP CCTV/kamera IP, HLS, UDP, **NDI**), **KLM Call** (tamu jarak jauh), Tangkap Layar/Jendela (+audio sistem), **Title UTC KLM Acara**, Mic/Audio device, File Audio, Warna/Gradien, Color Bars + tone, **Web Browser**, Virtual Set, Instant Replay, Video dari URL.

### Fitur pro tambahan (setara vMix Pro)
- **NDI** masuk & keluar (butuh NDI Tools/Runtime gratis) — sekaligus **Virtual Camera** untuk Zoom/Meet/Teams lewat aplikasi *NDI Webcam*
- **Stream masuk** RTMP/SRT listener (port 1935 / 9000), RTSP, HLS, UDP — mode *Copy* tanpa encode ulang (sangat ringan), latensi bisa diatur 0.3–2.5 dtk
- **KLM Call** (pengganti vMix Call): tamu bergabung lewat link, melihat *return feed* program dan mendengar audio **mix-minus** (tanpa gema suaranya sendiri), tally ON AIR
- **PTZ**: kontrol kamera PTZ fisik (VISCA over IP Sony 52381, VISCA TCP/UDP PTZOptics & umum, HTTP-CGI) — joystick, zoom, fokus, 8 preset; plus **PTZ Virtual** (pan/zoom halus otomatis dari 1 kamera)
- **Title Designer** (pengganti GT Designer): teks, kotak, lingkaran, garis, gambar; gradien, bayangan, outline; animasi per elemen + jeda; field bernama untuk SetText; pustaka template sendiri; **impor CSV** untuk daftar nama
- **Skrip JavaScript** (pengganti VB.NET): `API.Function("Cut")`, `Sleep()`, `Input()`, jalankan dari tombol/shortcut/trigger/Stream Deck
- **Trigger** per input (saat masuk/keluar Program, saat video selesai, saat masuk Preview) dan **shortcut kustom** untuk semua 206 fungsi
- **Efek audio bawaan** (pengganti VST): high-pass filter, reverb, **auto-ducking** (musik turun saat mic bicara), **limiter master**, output Bus A/B ke perangkat audio lain

### Title UTC KLM Acara (16 template × 8 tema)
Lower Third Klasik / Modern / Elegan, Judul Tengah, Running Text, Logo/Bug + LIVE, Jam & Tanggal + Hijriah, Hitung Mundur, **Pernikahan**, **Khitanan**, **Ayat/Hadits** (Arab + terjemahan), **Info Kajian/Pengajian**, Breaking/Pengumuman, Ucapan Selamat Datang, Credit Roll, Skor Lomba.
Tema: Emas Elegan, Hijau Islami, Biru Profesional, Merah Breaking, Putih Minimal, Pink Pengantin, Ungu Royal, Hitam Modern.
Animasi masuk/keluar otomatis, **antrian data** (daftar nama → Next/Prev), edit langsung dari HP, API `SetText`.

### Audio
Strip per input: fader, VU stereo, mute, **Solo**, **Auto** (audio ikut video), kirim ke **Master / Bus A / Bus B**, gain, balance, **delay sync**, **EQ 3‑band**, **kompresor**, **noise gate**. Monitor headphone + pilih perangkat output.

### Produksi
- **Rekam** MP4 (H.264) / WebM, bitrate & sumber audio bisa diatur
- **Streaming** RTMP/RTMPS/SRT ke **3 tujuan sekaligus** (YouTube, Facebook, Twitch, custom) — encoder x264 / NVENC / QuickSync / AMF / copy
- **MultiCorder** (rekam tiap kamera terpisah) · **Snapshot**
- **Instant Replay**: buffer 10–60 dtk, tandai event, slow‑motion 25–100%, putar ke program & kembali otomatis
- **Playlist** otomatis dengan transisi & durasi per item
- Simpan/buka **proyek** (`.klmmix`) + pemulihan sesi otomatis

### Kontrol
- **Shortcut keyboard** (Spasi = Cut, Enter = Transisi, 1–0 = Preview, F1–F4 = Overlay, B = FTB, Ctrl+R/L = Rekam/Live, M = Replay …)
- **Remote HP**: input, cut/transisi/T‑bar, overlay, title, audio, rekam/stream, replay, playlist
- **API kompatibel vMix** — Stream Deck / Bitfocus Companion / aplikasi tally:
  - HTTP: `http://IP:8620/api/?Function=Cut&Input=2`  · status XML: `http://IP:8620/api`
  - TCP port `8622`: `FUNCTION`, `XML`, `TALLY`, `SUBSCRIBE TALLY`

### Ringan di PC & HP
- **Mode performa** (klik label di bar atas): 🍃 Hemat (720p, preview 15fps & 33%) • ⚖ Seimbang • 💎 Kualitas
- Preview & thumbnail berhenti otomatis saat jendela diminimize (program, rekam & streaming tetap jalan)
- Streaming encoder **Auto**: H.264 dari GPU dikirim langsung tanpa encode ulang; deteksi otomatis NVIDIA NVENC / Intel QuickSync / AMD AMF
- Input stream mode *Copy* (tanpa decode-encode), UI digabung per frame, VU meter berhenti saat tidak terlihat
- HP Remote hanya menerima gambar yang sedang ditampilkan + tombol 🍃 **hemat data**; KLMCAM punya mode 🌙 **hemat baterai** (layar gelap, kamera tetap mengirim)

### Port (tidak bentrok dengan vMix 8088/8099, UTC KLM, KLMCAM lama)
| Layanan | Port |
|---|---|
| HTTP (mixer, HP, API, WebSocket) | 8620 |
| HTTPS (kamera & KLM Call di browser HP) | 8621 |
| TCP API | 8622 |
| Terima RTMP (Stream Masuk) | 1935 |
| Terima SRT (Stream Masuk) | 9000 (bisa diubah) |

Bisa diubah di **Pengaturan → Jaringan & HP**. Jika port terpakai, KLM Mix otomatis mencoba port lain.

---

## Catatan
- **NDI** & **Virtual Camera** butuh *NDI Tools* (gratis, ndi.video) terinstal. NDI berjalan di proses terpisah, jadi bila bermasalah aplikasi utama tetap aman. Saat ini NDI membawa video saja (audio lewat mixer/stream).
- **KLM Call** dari luar jaringan lokal butuh VPN (Tailscale/ZeroTier) atau port-forward ke PC studio.
- Plugin **VST** asli (DLL) tidak bisa dimuat; diganti efek audio bawaan di atas. Skrip memakai **JavaScript**, bukan VB.NET.
- Performa 4K/60 sangat bergantung GPU — pakai mode Seimbang/Hemat di PC biasa.

---
KLM Mix 1.1.0
