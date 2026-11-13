klm-airplay — penerima AirPlay Mirroring untuk KLM Mix
=======================================================

Program kecil terpisah yang membuat KLM Mix muncul di menu "Pencerminan Layar" (Screen Mirroring) iPhone, iPad dan Mac,
lalu meneruskan video H.264 ke KLM Mix lewat 127.0.0.1 (input "Mirroring HP / iPhone", mode AirPlay).

Lisensi: GNU GPL versi 3 (lihat COPYING-GPL3.txt).
Program ini memakai pustaka AirPlay dari proyek UxPlay (https://github.com/FDH2/UxPlay, GPL-3.0),
commit 05b0275cb1b726592700e47a6e0307544b3d3a52, beserta pustaka di dalamnya (playfair, llhttp, mdnsd).
Juga memakai libplist (LGPL-2.1, https://github.com/libimobiledevice/libplist) dan OpenSSL (Apache-2.0) sebagai DLL.

Kode sumber klm-airplay: native/airplay/klm-airplay.c di repositori KLM Mix.
Membangun:
  git clone https://github.com/FDH2/UxPlay.git && git -C UxPlay checkout 05b0275cb1b726592700e47a6e0307544b3d3a52
  cmake -S native/airplay -B native/airplay/build -G Ninja -DUXPLAY_DIR=UxPlay
  cmake --build native/airplay/build
(Windows: MSYS2 UCRT64 dengan paket gcc, cmake, ninja, pkgconf, openssl, libplist.)

klm-airplay hanya berkomunikasi dengan KLM Mix lewat proses terpisah (argumen baris perintah, stdout, TCP lokal);
bagian lain KLM Mix tidak memakai kode GPL ini.
