// klm-engine — mesin video native KLM, Fase 1 (eksperimen)
//
// Monitor Preview & Program dirender Direct3D 11 langsung di GPU dan ditampilkan di dua jendela anak (swapchain
// flip-model) yang ditempel di atas jendela KLM, tepat di posisi kanvas Preview / Program. Antarmuka (tombol, menu)
// tetap Electron. KLM (renderer) mengirim keadaan lewat stdin, satu perintah per baris:
//
//   parent <hwnd>                         jendela induk (HWND desimal jendela utama KLM)
//   out <w> <h> <fps>                     resolusi & frame rate output
//   rect <pvw|pgm> <x> <y> <w> <h> <0|1>  posisi monitor (piksel fisik, relatif area klien induk) & tampil/sembunyi
//   src <id> colour <r> <g> <b> <r2> <g2> <b2> <grad>   grad: 0 polos, 1 linear, 2 radial
//   src <id> bars                         color bars
//   src <id> screen <x> <y> <w> <h>       tangkap layar (DXGI Desktop Duplication, zero-copy) — koordinat desktop fisik
//   del <id>                              hapus sumber
//   pvw <id|->  /  pgm <id|->             sumber di Preview / Program ("-" = hitam)
//   trans <ms> <fromId> <toId>            transisi fade di Program (akhir: Program = toId)
//   tbar <0..1000> <fromId> <toId>        posisi T-bar manual (fade);  "tbar off" = selesai
//   stats                                 minta statistik sekarang
//   quit
//
// Fase 2 — grafis UTC di Program (tekstur GPU bersama dari lapisan offscreen Chromium, tanpa salinan CPU):
//   utex <layer> <handle> <W> <H> <seq>   handle NT tekstur bersama (sudah diduplikasi ke proses ini oleh KLM) →
//                                         disalin GPU ke tekstur lapisan, handle ditutup, dibalas "uack <layer> <seq>"
//   ulay <id,id,..|->                     lapisan UTC yang tampil di atas Program (urutan bawah → atas)
//   uclear                                lupakan semua tekstur lapisan (KLM berhenti mengirim)
//   utk <layer> <id> <at> <vx> <vy> <vw> <vh> <w> <speed> <snap> <px0> <E0> <ntile>   running text native
//   ublob <layer> <id> <x> <w> <h> <n>    + n byte RGBA (potongan teks berjalan) langsung sesudah baris ini
//   utkgeo <layer> <id> <vx> <vy> <vw> <vh> | utklive <layer> <id|-> | ureset <layer>
//   probe <pvw|pgm> <fx> <fy>             baca 1 piksel monitor (uji) → "probe r g b"
//
// Fase 3 — kamera USB / capture card dibuka langsung lewat Windows Media Foundation (dekode & konversi warna di GPU):
//   camlist                               daftar kamera → "camdev <namaHex> <linkHex>" … "camdevend"
//   cam <id> <w> <h> <fps> <kueriHex|->   buka kamera (kueri = label Chromium, mis. "HD Webcam (0c45:6713)", UTF-8 hex)
//   camtest <id> <w> <h> <fps>            kamera uji (pola bergerak, untuk CI)
//   camoff <id>                           tutup kamera
//   camexp <id> <0|1>                     kirim frame ke KLM sebagai tekstur bersama (cincin 3 tekstur NT):
//                                         "cbuf <id> <gen> <slot> <handle> <w> <h>" saat cincin dibuat,
//                                         "cfr <id> <gen> <slot> <seq>" tiap frame;  KLM membalas  crel <id> <gen> <slot>
//   Kamera bisa ditampilkan di monitor native dengan id-nya (pvw <id> / pgm <id>).
//   Keluaran: camok <id> <w> <h> <fps> <namaHex> | camerr <id> <pesan>
//
// Fase 4a — KLMCAM: video H.264 dari HP (frame terenkode, diteruskan KLM dari WebRTC) didekode GPU (DXVA, Media
// Foundation) lalu dikonversi warna dengan D3D11 Video Processor → bisa tampil di monitor native & Program native:
//   kenc <id> <key 0|1> <ts> <n>          + n byte H.264 Annex-B (satu frame) langsung sesudah baris ini (khusus KLM)
//   kdecoff <id>                          hentikan dekoder
//   Keluaran: kok <id> <w> <h> <dxva 0|1> (frame pertama) | kerr <id> <pesan> | kneedkey <id> (minta frame kunci)
//
// Fase 4b — output native: Program mesin native dikodekan H.264 (encoder hardware NVENC/QuickSync/AMF lewat Media
// Foundation, tekstur GPU langsung) + AAC, tanpa kanvas Program JS:
//   ostart <oid> <file|ts> <w> <h> <fps> <vkbps> <akbps> <cbr 0|1> <pathHex|->
//          file → MP4 terfragmentasi di path (aman bila listrik/aplikasi mati); ts → MPEG-TS ke fd 3 (KLM → ffmpeg -c copy)
//   ostop <oid>                           tutup & finalisasi → "ostopped <oid> <frame>"
//   aud <n>                               + n byte PCM s16le stereo 48 kHz (audio Program dari KLM) langsung sesudah baris
//   Keluaran: ostarted <oid> <encoderHex> <hw 0|1> | oerr <oid> <pesan> | ostopped <oid> <frame>
//
// Fase 5 — file video & gambar:
//   src <id> image <pathHex>              gambar (PNG/JPG/BMP/TIFF/WebP… lewat WIC) → tekstur GPU
//   src <id> video <pathHex>              file video (MP4/MOV/MKV/AVI… lewat Media Foundation, dekode DXVA GPU)
//   vt <id> <detik> <main 0|1> <laju>     posisi putar dari elemen video KLM (audio tetap dari KLM) — mesin native
//                                         mengikuti jam ini (lompat bila posisi berbeda > 0,3 s)
//   Keluaran: vok <id> <w> <h> <durasi> (frame pertama) | srcerr <id> <pesan>
//
// Fase 6 — GIF bergerak, gambar hasil raster KLM (SVG / gambar internet), video dari URL & stream masuk, audio native:
//   src <id> image <pathHex>              GIF bergerak dianimasikan sendiri (komposisi frame + jeda dari metadata GIF)
//   srcimg <id> <w> <h> <n>               + n byte RGBA (gambar yang sudah dirender KLM: SVG, gambar dari internet)
//   src <id> video <urlHex>               path lokal ATAU URL http(s) (Media Foundation)
//   src <id> live <urlHex>                aliran langsung (Stream Masuk lewat hub KLM): frame ditampilkan begitu siap
//   naud <id> <0|1>                       audio sumber ini didekode / ditangkap mesin native → PCM ke KLM lewat fd 4
//                                         (bingkai: u32 panjang | u8 panjang id | id | u32 rate | u8 kanal | PCM s16le)
//   camaud <camId> <labelHex|->           tangkap audio perangkat (mis. HDMI capture card) untuk kamera native
//   avoff <ms>                            geser audio terhadap video di output native (+ = audio ditunda, − = video ditunda)
//
// Fase 7 — Web Browser / jendela, Title, Virtual Set & kotak PiP, overlay:
//   src <id> window <hwnd>                tangkap jendela (Windows.Graphics.Capture, tekstur GPU tanpa salinan CPU)
//   comp <id> <base|-> <baseFit> <redup> <fg|-> [lapisan…]   komposisi berlapis; lapisan = 25 nilai dipisah koma:
//        src,x,y,w,h,fit,zoom,px,py,cropL,cropR,cropT,cropB,flip,op,rad,bw,warnaBingkai,warnaLatar,bayangan,label,lx,ly,lw,lh
//        (posisi relatif kotak 0..1, fit 0=isi 1=muat 2=rentang, warna hex 6 digit atau "-", label = id gambar atau "-")
//   ovl [src,alpha,dx,dy,klip[,zoom] …]   overlay di atas Program (dx/dy relatif lebar/tinggi, klip = lebar sapuan 0..1, zoom di tengah)
// Fase 8 — rotasi, efek, latar AI, transisi, FTB:
//   comp … lapisan nilai ke-26 (opsional) = rotasi derajat; baseFit 3 = latar memakai posisi input (ipos); fit 3 = kotak ikut posisi input
//   ipos <id> <fit> <zoom> <x> <y> <cL> <cR> <cT> <cB> <rot°> | ipos <id> -   posisi input (= drawInputRect di engine.js)
//   fx <id> <cc> <bri> <con> <sat> <hue rad> <gam> <key> <warna> <sim> <smo> <spill> <luma> <lo> <hi> | fx <id> -   koreksi warna & chroma/luma key
//   seg <id> <mode> <feather> <blur> <warna> <bgId|-> <bgFit> <cx> <cy> <cw> <hide> | seg <id> -   latar AI (0 hapus 1 buram 2 warna 3 gambar)
//   segm <id> <w> <h> <n>                 + n byte mask orang 8-bit (dari model segmentasi KLM)
//   trans <ms> <from> <to> [jenis] / tbar <v> <from> <to> [jenis]   jenis: fade merge wipe wipeup slide slideup fly zoom crosszoom circle barn cube dip dipwhite blur
//   ftb <0..1>                            Fade To Black di atas semuanya (termasuk grafis UTC)
// Fase 9 — stinger, grid Preview, latar AI native:
//   trans <ms> <from> <to> stinger <sumber> <cut ms>   video stinger (sumber transparan) di atas, ganti sumber di titik cut
//   ptex <id> <handle NT> <w> <h> <seq>  sumber tekstur bersama ber-alpha premultiplied (halaman video stinger offscreen)
//   bsize <pvw|pgm> <w> <h>              ukuran gambar monitor (0 0 = output) — grid Preview memakai rasio panelnya
//   segmodel <path>                      muat model Latar AI (.tflite) → "segmodel ok <info>" / "segmodel err <alasan>"
//   seg … <nat> <edge> <inv> <follow> <fzoom> <hideEmpty>   nat 1 = mask dari model native (bingkai & sembunyikan dihitung mesin)
//   segnorm <skala> <geser>              rentang masukan model (bawaan 1 0 = 0..1)
// Fase 10 — KLMCAM mulus & kartu input native:
//   kenc … <ts> : cap waktu RTP (100 ns) → jadwal tayang (jitter buffer adaptif); frame_num diperiksa, frame hilang → tunggu frame kunci
//   szoom <id> <z>                       zoom digital sumber (KLMCAM dari HP)
//
// Keluaran stdout (satu baris per kejadian): ready <adapter> | shown <bus> | hidden <bus> | click <bus> <x> <y> <btn> <dbl>
//   | srcerr <id> <pesan> | srcok <id> <w> <h> | stats fps=.. ms=.. mem=.. utex=.. | err <pesan>
//   | uack <layer> <seq> | uready <layer> | uerr <layer> <pesan>
//
// --selftest : uji mandiri tanpa KLM (jendela tersembunyi, perangkat WARP bila tanpa GPU) — dipakai CI.
#include <windows.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <d3dcompiler.h>
#include <psapi.h>
#include <d3d11_4.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>
#include <wmcodecdsp.h>
#include <wincodec.h>
#include <propvarutil.h>
#include <codecapi.h>
#include <condition_variable>
#include <chrono>
#include <io.h>
#include <timeapi.h>
#include <wrl/client.h>
#ifdef GetCurrentTime
#undef GetCurrentTime
#endif
#include <winrt/base.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <atomic>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <map>
#include <functional>
#include <set>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

using Microsoft::WRL::ComPtr;

// ---------------------------------------------------------------- keluaran
static std::mutex g_outMx;
static void emit(const char* fmt, ...) {
  char b[2048];
  va_list a; va_start(a, fmt); vsnprintf(b, sizeof b, fmt, a); va_end(a);
  std::lock_guard<std::mutex> l(g_outMx);
  fputs(b, stdout); fputc('\n', stdout); fflush(stdout);
}
static std::string narrow(const wchar_t* w) {
  if (!w) return "";
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  std::string s(n > 0 ? n - 1 : 0, '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
  for (auto& c : s) if (c == '\n' || c == '\r') c = ' ';
  return s;
}
static double nowMs() {
  static LARGE_INTEGER f = [] { LARGE_INTEGER x; QueryPerformanceFrequency(&x); return x; }();
  LARGE_INTEGER c; QueryPerformanceCounter(&c);
  return (double)c.QuadPart * 1000.0 / (double)f.QuadPart;
}

// ---------------------------------------------------------------- perintah dari stdin
struct Cmd { std::string line; std::vector<uint8_t> data; double at = 0; }; // at = waktu tiba (ms, untuk jadwal tayang frame KLMCAM)
static double g_cmdAt = 0;
static std::mutex g_qMx;
static std::deque<Cmd> g_q;
static std::atomic<bool> g_quit{false};
static void stdinThread() {
  HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
  static char buf[65536]; DWORD n = 0; std::string line;
  Cmd blob; size_t need = 0; // "ublob ... <n>" → n byte biner berikutnya milik perintah itu
  while (!g_quit && ReadFile(h, buf, sizeof buf, &n, nullptr) && n) {
    for (DWORD i = 0; i < n; i++) {
      if (need) {
        size_t take = std::min<size_t>(need, n - i);
        blob.data.insert(blob.data.end(), buf + i, buf + i + take);
        need -= take; i += (DWORD)take - 1;
        if (!need) { blob.at = nowMs(); std::lock_guard<std::mutex> l(g_qMx); g_q.push_back(std::move(blob)); blob = Cmd(); }
        continue;
      }
      char c = buf[i];
      if (c == '\n') {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.compare(0, 6, "ublob ") == 0 || line.compare(0, 5, "kenc ") == 0 || line.compare(0, 4, "aud ") == 0 || line.compare(0, 7, "srcimg ") == 0 || line.compare(0, 5, "segm ") == 0) {
          size_t sp = line.find_last_of(' ');
          unsigned long long nb = strtoull(line.c_str() + sp + 1, nullptr, 10);
          if (nb > 0 && nb <= 64ull * 1024 * 1024) { blob.line = line; blob.data.clear(); blob.data.reserve((size_t)nb); need = (size_t)nb; }
        } else { std::lock_guard<std::mutex> l(g_qMx); g_q.push_back(Cmd{ line, {} }); }
        line.clear();
      } else if (line.size() < 8192) line += c;
    }
  }
  g_quit = true; // KLM tertutup / pipa putus → mesin ikut berhenti (tidak pernah tertinggal sendirian)
}

// ---------------------------------------------------------------- Direct3D
static ComPtr<ID3D11Device> g_dev;
static ComPtr<ID3D11DeviceContext> g_ctx;
static ComPtr<IDXGIFactory2> g_fac;
static ComPtr<IDXGIAdapter> g_adapter;
static ComPtr<ID3D11VertexShader> g_vs;
static ComPtr<ID3D11PixelShader> g_psTex, g_psDown, g_psSolid, g_psPM;
static ComPtr<ID3D11SamplerState> g_samp;
static ComPtr<ID3D11BlendState> g_blend, g_blendPM;
static ComPtr<ID3D11RasterizerState> g_rast, g_rastSc;
static ComPtr<ID3D11Query> g_query;
static ComPtr<ID3D11PixelShader> g_psOpaque, g_psLayer, g_psFill, g_psFx, g_psBlur;
static ComPtr<ID3D11Buffer> g_cb, g_cbFx;
static std::string g_adapterName;
static bool g_warp = false;

struct CB { float dst[4]; float uv[4]; float col[4]; float p2[4]; float p3[4]; float p4[4]; float p5[4]; float p6[4]; float p7[4]; float p8[4]; };
// efek per sumber (Fase 8): koreksi warna, chroma key, luma key, mask latar AI, buram
struct FxCB { float f0[4]; float f1[4]; float f2[4]; float f3[4]; float f4[4]; float f5[4]; };

static const char* kHlsl = R"(
cbuffer C : register(b0) { float4 dst; float4 uv; float4 col; float4 p2; float4 p3; float4 p4; float4 p5; float4 p6; float4 p7; float4 p8; };
// p4.w = rotasi kotak (radian, di sekitar pusatnya); p5/p6 = transformasi affine global (transisi, overlay zoom) dalam piksel;
// p7/p8.x = klip global layar (1 = persegi x0,y0,x1,y1; 2 = lingkaran cx,cy,r); p8.yz = ukuran target (0 = jalur lama tanpa transformasi)
cbuffer F : register(b1) { float4 f0; float4 f1; float4 f2; float4 f3; float4 f4; float4 f5; };
struct O { float4 p : SV_Position; float2 t : TEXCOORD0; float2 l : TEXCOORD1; };
O vs(uint id : SV_VertexID) {
  float2 q = float2(id & 1, id >> 1);
  float2 n = float2(lerp(dst.x, dst.z, q.x), lerp(dst.y, dst.w, q.y));
  O o; o.t = float2(lerp(uv.x, uv.z, q.x), lerp(uv.y, uv.w, q.y)); o.l = float2(0, 0);
  if (p8.y > 0) {
    float2 px = float2((n.x + 1) * 0.5 * p8.y, (1 - n.y) * 0.5 * p8.z);
    float2 c = float2((dst.x + dst.z + 2) * 0.25 * p8.y, (2 - dst.y - dst.w) * 0.25 * p8.z);
    float s = sin(p4.w), k = cos(p4.w); float2 d = px - c; px = c + float2(d.x * k - d.y * s, d.x * s + d.y * k);
    o.l = px;
    if (p5.w > 0.5) px = float2(p5.x * px.x + p5.y * px.y + p5.z, p6.x * px.x + p6.y * px.y + p6.z);
    n = float2(px.x / p8.y * 2 - 1, 1 - px.y / p8.z * 2);
  }
  o.p = float4(n, 0, 1); return o;
}
Texture2D tx : register(t0); Texture2D mk : register(t1); SamplerState sm : register(s0);
float4 ps(O i) : SV_Target { float4 c = tx.Sample(sm, i.t); return float4(c.rgb, c.a * col.a); }
float4 psSolid(O i) : SV_Target { return col; }
// alpha premultiplied (tekstur lapisan UTC dari Chromium): warna sudah dikali alpha
float4 psPM(O i) : SV_Target { return tx.Sample(sm, i.t) * col.a; }
// kamera (RGB32 / X8): kanal alpha dari dekoder tidak berarti → selalu buram
float4 psOpaque(O i) : SV_Target { return float4(tx.Sample(sm, i.t).rgb, col.a); }
// lapisan (Fase 7): klip persegi bersudut bulat (p3 = kotak piksel, p4.x = radius, p4.y = buram, p4.z = klip aktif)
float msk(float2 pos) {
  if (p4.z < 0.5) return 1;
  float2 c = (p3.xy + p3.zw) * 0.5, hs = max((p3.zw - p3.xy) * 0.5, 0.001); float r = min(p4.x, min(hs.x, hs.y));
  float2 q = abs(pos - c) - (hs - r); float d = length(max(q, 0)) + min(max(q.x, q.y), 0) - r;
  return saturate(0.5 - d);
}
float2 lp(O i) { return p8.y > 0 ? i.l : i.p.xy; } // posisi sebelum transformasi global (klip kotak ikut bergerak bersama isinya)
float gclip(float2 sp) {
  if (p8.x < 0.5) return 1;
  if (p8.x < 1.5) { float2 a = saturate(sp - p7.xy + 0.5) * saturate(p7.zw - sp + 0.5); return a.x * a.y; }
  return saturate(p7.z - length(sp - p7.xy) + 0.5);
}
float4 psLayer(O i) : SV_Target { float4 c = tx.Sample(sm, i.t); if (p2.w > 0.5) c.rgb /= max(c.a, 0.0001); return float4(c.rgb, (p4.y > 0.5 ? 1 : c.a) * col.a * msk(lp(i)) * gclip(i.p.xy)); }
float4 psFill(O i) : SV_Target { return float4(col.rgb, col.a * msk(lp(i)) * gclip(i.p.xy)); }
// efek (Fase 8) — rumus sama dengan effects.js (WebGL) agar hasil native = hasil mesin JS
float2 chroma(float3 c) { return float2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b); }
float3 hueRot(float3 c, float a) { const float3 k = float3(0.57735, 0.57735, 0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }
float4 srcSample(float2 t) {
  if (f5.x < 0.5) return tx.Sample(sm, t);
  int n = (int)f5.w; float4 s = 0; float ws = 0; // buram latar AI: grid gaussian ±2σ
  [loop] for (int y = -n; y <= n; y++) [loop] for (int x = -n; x <= n; x++) { float w = exp(-(x * x + y * y) * 2.0 / (n * n)); s += tx.SampleLevel(sm, t + float2(x, y) * f5.yz, 0) * w; ws += w; }
  return s / ws;
}
float4 psFx(O i) : SV_Target {
  float4 s = srcSample(i.t); if (p2.w > 0.5) s.rgb /= max(s.a, 0.0001); float3 c = s.rgb; float a = p4.y > 0.5 ? 1 : s.a;
  if (f4.x > 0.5) { float m = 0; [unroll] for (int y = -1; y <= 1; y++) [unroll] for (int x = -1; x <= 1; x++) m += mk.Sample(sm, i.t + float2(x, y) * f4.yz).r; a *= m / 9; }
  if (f1.y > 0.5) {
    float d = distance(chroma(c), chroma(f3.rgb)); a *= smoothstep(f1.z, f1.z + f1.w, d);
    float lum = dot(c, float3(0.2126, 0.7152, 0.0722)); c = lerp(float3(lum, lum, lum), c, pow(saturate(d / max(f2.x, 0.0001)), 1.5));
  }
  if (f2.y > 0.5) { float l = dot(c, float3(0.2126, 0.7152, 0.0722)); a *= smoothstep(f2.z, f2.w, l); }
  if (f4.w > 0.5) {
    c = c + f0.x; c = (c - 0.5) * f0.y + 0.5;
    float l2 = dot(c, float3(0.2126, 0.7152, 0.0722)); c = lerp(float3(l2, l2, l2), c, f0.z);
    if (f0.w != 0) c = hueRot(c, f0.w);
    c = pow(saturate(c), 1.0 / f1.x);
  }
  return float4(c, a * col.a * msk(lp(i)) * gclip(i.p.xy));
}
// buram terpisah (transisi blur): p2.xy = langkah uv, p2.z = langkah per sisi (σ = n/2 langkah)
float4 psBlur(O i) : SV_Target {
  int n = (int)p2.z; float4 s = 0; float ws = 0;
  [loop] for (int k = -n; k <= n; k++) { float w = exp(-k * k * 2.0 / (n * n)); s += tx.SampleLevel(sm, i.t + p2.xy * k, 0) * w; ws += w; }
  return float4((s / ws).rgb, 1);
}
// perkecil berkualitas tinggi: rata-rata n×n sampel bilinear di seluruh tapak piksel tujuan (tajam, tanpa gerigi / kedip)
float4 psDown(O i) : SV_Target {
  int n = (int)p2.z; float4 s = 0;
  [loop] for (int y = 0; y < n; y++) [loop] for (int x = 0; x < n; x++) {
    float2 o = (float2(x, y) + 0.5) / n - 0.5;
    s += tx.SampleLevel(sm, i.t + o * p2.xy, 0);
  }
  return float4((s / (n * n)).rgb, 1);
}
)";

static bool compile(const char* entry, const char* target, ComPtr<ID3DBlob>& out) {
  ComPtr<ID3DBlob> err;
  HRESULT hr = D3DCompile(kHlsl, strlen(kHlsl), "klm", nullptr, nullptr, entry, target, D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, &out, &err);
  if (FAILED(hr)) { emit("err shader %s: %s", entry, err ? (const char*)err->GetBufferPointer() : "?"); return false; }
  return true;
}

static bool initD3D(bool forceWarp) {
  D3D_FEATURE_LEVEL fls[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0 };
  UINT fl = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  HRESULT hr = E_FAIL;
  if (!forceWarp) {
    hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, fl, fls, 4, D3D11_SDK_VERSION, &g_dev, nullptr, &g_ctx);
    if (hr == E_INVALIDARG) hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, fl, fls + 1, 3, D3D11_SDK_VERSION, &g_dev, nullptr, &g_ctx);
  }
  if (FAILED(hr)) {
    hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, fl, fls + 1, 3, D3D11_SDK_VERSION, &g_dev, nullptr, &g_ctx);
    g_warp = true;
  }
  if (FAILED(hr)) { emit("err D3D11CreateDevice 0x%08lx", (unsigned long)hr); return false; }
  ComPtr<IDXGIDevice1> dd;
  if (SUCCEEDED(g_dev.As(&dd))) { dd->SetMaximumFrameLatency(1); dd->GetAdapter(&g_adapter); }
  if (!g_adapter) { emit("err tidak ada adapter DXGI"); return false; }
  DXGI_ADAPTER_DESC desc{}; g_adapter->GetDesc(&desc);
  g_adapterName = narrow(desc.Description) + (g_warp ? " (WARP)" : "");
  if (FAILED(g_adapter->GetParent(IID_PPV_ARGS(&g_fac)))) { emit("err IDXGIFactory2 tidak tersedia"); return false; }

  ComPtr<ID3DBlob> b;
  if (!compile("vs", "vs_4_0", b)) return false;
  g_dev->CreateVertexShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_vs);
  if (!compile("ps", "ps_4_0", b)) return false;
  g_dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_psTex);
  if (!compile("psDown", "ps_4_0", b)) return false;
  g_dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_psDown);
  if (!compile("psSolid", "ps_4_0", b)) return false;
  g_dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_psSolid);
  if (!compile("psPM", "ps_4_0", b)) return false;
  g_dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_psPM);
  if (!compile("psOpaque", "ps_4_0", b)) return false;
  g_dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_psOpaque);
  if (!compile("psLayer", "ps_4_0", b)) return false;
  g_dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_psLayer);
  if (!compile("psFill", "ps_4_0", b)) return false;
  g_dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_psFill);
  if (!compile("psFx", "ps_4_0", b)) return false;
  g_dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_psFx);
  if (!compile("psBlur", "ps_4_0", b)) return false;
  g_dev->CreatePixelShader(b->GetBufferPointer(), b->GetBufferSize(), nullptr, &g_psBlur);
  // Media Foundation (kamera) memakai device ini dari utasnya sendiri → konteks wajib dilindungi multithread
  { ComPtr<ID3D11Multithread> mt; if (SUCCEEDED(g_ctx.As(&mt))) mt->SetMultithreadProtected(TRUE); }

  D3D11_SAMPLER_DESC sd{}; sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
  sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP; sd.MaxLOD = D3D11_FLOAT32_MAX;
  g_dev->CreateSamplerState(&sd, &g_samp);
  D3D11_BLEND_DESC bd{}; auto& rt = bd.RenderTarget[0];
  rt.BlendEnable = TRUE; rt.SrcBlend = D3D11_BLEND_SRC_ALPHA; rt.DestBlend = D3D11_BLEND_INV_SRC_ALPHA; rt.BlendOp = D3D11_BLEND_OP_ADD;
  rt.SrcBlendAlpha = D3D11_BLEND_ONE; rt.DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA; rt.BlendOpAlpha = D3D11_BLEND_OP_ADD;
  rt.RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
  g_dev->CreateBlendState(&bd, &g_blend);
  rt.SrcBlend = D3D11_BLEND_ONE; // premultiplied
  g_dev->CreateBlendState(&bd, &g_blendPM);
  D3D11_RASTERIZER_DESC rd{}; rd.FillMode = D3D11_FILL_SOLID; rd.CullMode = D3D11_CULL_NONE; rd.DepthClipEnable = TRUE;
  g_dev->CreateRasterizerState(&rd, &g_rast);
  rd.ScissorEnable = TRUE;
  g_dev->CreateRasterizerState(&rd, &g_rastSc);
  D3D11_QUERY_DESC qd{ D3D11_QUERY_EVENT, 0 };
  g_dev->CreateQuery(&qd, &g_query);
  D3D11_BUFFER_DESC cbd{}; cbd.ByteWidth = sizeof(CB); cbd.Usage = D3D11_USAGE_DYNAMIC; cbd.BindFlags = D3D11_BIND_CONSTANT_BUFFER; cbd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
  if (FAILED(g_dev->CreateBuffer(&cbd, nullptr, &g_cb))) { emit("err constant buffer"); return false; }
  cbd.ByteWidth = sizeof(FxCB);
  if (FAILED(g_dev->CreateBuffer(&cbd, nullptr, &g_cbFx))) { emit("err constant buffer efek"); return false; }
  return true;
}

static bool makeTex(UINT w, UINT h, const void* px, ComPtr<ID3D11Texture2D>& tex, ComPtr<ID3D11ShaderResourceView>& srv, bool rtv = false) {
  D3D11_TEXTURE2D_DESC d{}; d.Width = w; d.Height = h; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  d.SampleDesc.Count = 1; d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE | (rtv ? D3D11_BIND_RENDER_TARGET : 0);
  D3D11_SUBRESOURCE_DATA sd{ px, w * 4, 0 };
  tex.Reset(); srv.Reset();
  if (FAILED(g_dev->CreateTexture2D(&d, px ? &sd : nullptr, &tex))) return false;
  return SUCCEEDED(g_dev->CreateShaderResourceView(tex.Get(), nullptr, &srv));
}

// ---------------------------------------------------------------- sumber
struct Source {
  std::string kind;
  ComPtr<ID3D11Texture2D> tex;
  ComPtr<ID3D11ShaderResourceView> srv;
  UINT w = 0, h = 0;
  // layar
  RECT want{};
  ComPtr<IDXGIOutputDuplication> dup;
  double retryAt = 0;
  bool got = false;
  // jendela (Windows.Graphics.Capture)
  winrt::Windows::Graphics::Capture::GraphicsCaptureItem wItem{ nullptr };
  winrt::Windows::Graphics::Capture::Direct3D11CaptureFramePool wPool{ nullptr };
  winrt::Windows::Graphics::Capture::GraphicsCaptureSession wSess{ nullptr };
  int wcw = 0, wch = 0;
  ~Source() { try { if (wSess) wSess.Close(); if (wPool) wPool.Close(); } catch (...) {} }
  // GIF bergerak
  std::vector<ComPtr<ID3D11ShaderResourceView>> frames; std::vector<double> delays; double animTotal = 0, animT0 = 0;
};
static std::map<std::string, std::unique_ptr<Source>> g_src;
// ---- PCM sumber native → KLM (fd 4), dipakai banyak utas
static HANDLE g_fd4 = INVALID_HANDLE_VALUE;
static std::mutex g_fd4Mx;
static std::atomic<unsigned long long> g_pcmBytes{ 0 };
static std::vector<uint8_t> g_testPcm; static bool g_testPcmCapture = false; // uji mandiri: tangkap bingkai di memori
static void pcmOut(const std::string& id, UINT rate, UINT ch, const int16_t* pcm, size_t frames) {
  if (!frames || id.size() > 255) return;
  const uint32_t body = (uint32_t)(1 + id.size() + 4 + 1 + frames * ch * 2);
  std::vector<uint8_t> b(4 + body); size_t k = 0;
  memcpy(&b[k], &body, 4); k += 4; b[k++] = (uint8_t)id.size(); memcpy(&b[k], id.data(), id.size()); k += id.size();
  memcpy(&b[k], &rate, 4); k += 4; b[k++] = (uint8_t)ch; memcpy(&b[k], pcm, frames * ch * 2);
  std::lock_guard<std::mutex> l(g_fd4Mx);
  g_pcmBytes += b.size();
  if (g_testPcmCapture) { g_testPcm.insert(g_testPcm.end(), b.begin(), b.end()); return; }
  if (g_fd4 == INVALID_HANDLE_VALUE) return;
  DWORD w = 0; size_t off = 0;
  while (off < b.size()) { if (!WriteFile(g_fd4, b.data() + off, (DWORD)(b.size() - off), &w, nullptr)) return; off += w; }
}
// float/s16 sampel apa pun → s16 stereo (dicampur turun bila > 2 kanal)
static void toS16Stereo(const BYTE* p, size_t bytes, bool isFloat, UINT bits, UINT ch, std::vector<int16_t>& out) {
  const size_t bps = bits / 8, n = ch && bps ? bytes / (bps * ch) : 0; out.resize(n * 2);
  auto smp = [&](size_t i, UINT c) -> float {
    const BYTE* q = p + (i * ch + c) * bps;
    if (isFloat && bits == 32) { float f; memcpy(&f, q, 4); return f; }
    if (bits == 16) { int16_t v; memcpy(&v, q, 2); return v / 32768.f; }
    if (bits == 24) { int32_t v = (q[0] << 8) | (q[1] << 16) | (q[2] << 24); return v / 2147483648.f; }
    if (bits == 32) { int32_t v; memcpy(&v, q, 4); return v / 2147483648.f; }
    return 0.f;
  };
  for (size_t i = 0; i < n; i++) {
    float L = smp(i, 0), R = ch > 1 ? smp(i, 1) : L;
    if (ch > 2) { for (UINT c = 2; c < ch; c++) { float x = smp(i, c) * 0.5f; L += x; R += x; } }
    auto cl = [](float v) { v = v > 1 ? 1 : v < -1 ? -1 : v; return (int16_t)std::lround(v * 32767); };
    out[i * 2] = cl(L); out[i * 2 + 1] = cl(R);
  }
}

// ---------------------------------------------------------------- kamera (Fase 3, Media Foundation)
struct Cam {
  std::string id; std::mutex mx;
  ComPtr<ID3D11Texture2D> tex; ComPtr<ID3D11ShaderResourceView> srv; ComPtr<ID3D11RenderTargetView> rtv;
  UINT w = 0, h = 0, mw = 0, mh = 0; DXGI_FORMAT fmt = DXGI_FORMAT_UNKNOWN;
  std::atomic<bool> stop{ false }, fresh{ false }; std::atomic<int> frames{ 0 }; bool got = false, test = false;
  ComPtr<IMFMediaSource> src, asrc; std::shared_ptr<std::atomic<bool>> aStop; // audio perangkat (capture card)
  // ekspor ke KLM (cincin tekstur NT bersama)
  bool exp = false; int gen = 0; unsigned long long seq = 0; UINT rw = 0, rh = 0;
  struct Slot { ComPtr<ID3D11Texture2D> tex; ComPtr<ID3D11RenderTargetView> rtv; HANDLE h = nullptr; bool busy = false; } ring[3];
};
static std::map<std::string, std::shared_ptr<Cam>> g_cams;
static bool g_mf = false;
static ComPtr<IMFDXGIDeviceManager> g_mfMgr;
static UINT g_mfToken = 0;
static bool initMF() {
  if (g_mf) return true;
  if (FAILED(MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET))) { emit("err MFStartup gagal"); return false; }
  if (SUCCEEDED(MFCreateDXGIDeviceManager(&g_mfToken, &g_mfMgr))) { if (FAILED(g_mfMgr->ResetDevice(g_dev.Get(), g_mfToken))) g_mfMgr.Reset(); }
  g_mf = true; return true;
}
static std::string hexOf(const std::string& s) { static const char* H = "0123456789abcdef"; std::string o; for (unsigned char c : s) { o += H[c >> 4]; o += H[c & 15]; } return o.empty() ? "-" : o; }
static std::string unhex(const std::string& s) { std::string o; if (s == "-") return o; for (size_t i = 0; i + 1 < s.size(); i += 2) o += (char)strtol(s.substr(i, 2).c_str(), nullptr, 16); return o; }
static std::wstring widen(const std::string& s) { int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0); std::wstring w(n > 0 ? n - 1 : 0, L'\0'); if (n > 1) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &w[0], n); return w; }
static std::wstring lower(std::wstring s) { for (auto& c : s) c = (wchar_t)towlower(c); return s; }
struct CamDev { std::wstring name, link; };
static std::vector<CamDev> listCams() {
  std::vector<CamDev> v; if (!initMF()) return v;
  ComPtr<IMFAttributes> a; MFCreateAttributes(&a, 1);
  a->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
  IMFActivate** devs = nullptr; UINT32 n = 0;
  if (SUCCEEDED(MFEnumDeviceSources(a.Get(), &devs, &n))) {
    for (UINT32 i = 0; i < n; i++) {
      CamDev d; WCHAR* t = nullptr; UINT32 l = 0;
      if (SUCCEEDED(devs[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &t, &l))) { d.name = t; CoTaskMemFree(t); }
      if (SUCCEEDED(devs[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, &t, &l))) { d.link = t; CoTaskMemFree(t); }
      v.push_back(d); devs[i]->Release();
    }
    CoTaskMemFree(devs);
  }
  return v;
}
// label Chromium "Nama Kamera (046d:0825)" → nama + "vid_046d&pid_0825" untuk dicocokkan dengan perangkat Media Foundation
static int pickCam(const std::vector<CamDev>& v, const std::string& q8) {
  if (v.empty()) return -1;
  std::wstring q = lower(widen(q8)), base = q, vp;
  size_t lp = q.rfind(L" (");
  if (lp != std::wstring::npos && q.size() >= lp + 12 && q.back() == L')' && q[lp + 6] == L':') { vp = L"vid_" + q.substr(lp + 2, 4) + L"&pid_" + q.substr(lp + 7, 4); base = q.substr(0, lp); }
  if (q.empty()) return 0;
  for (size_t i = 0; i < v.size(); i++) if (!vp.empty() && lower(v[i].link).find(vp) != std::wstring::npos && lower(v[i].name) == base) return (int)i;
  for (size_t i = 0; i < v.size(); i++) if (lower(v[i].name) == base) return (int)i;
  for (size_t i = 0; i < v.size(); i++) if (!vp.empty() && lower(v[i].link).find(vp) != std::wstring::npos) return (int)i;
  for (size_t i = 0; i < v.size(); i++) if (!base.empty() && (lower(v[i].name).find(base) != std::wstring::npos || base.find(lower(v[i].name)) != std::wstring::npos)) return (int)i;
  return -1;
}
static bool camTex(Cam& c, UINT w, UINT h, DXGI_FORMAT f, bool rt) { // dipanggil dengan c.mx terkunci
  if (c.tex && c.w == w && c.h == h && c.fmt == f) return true;
  D3D11_TEXTURE2D_DESC d{}; d.Width = w; d.Height = h; d.MipLevels = 1; d.ArraySize = 1; d.Format = f; d.SampleDesc.Count = 1;
  d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE | (rt ? D3D11_BIND_RENDER_TARGET : 0);
  ComPtr<ID3D11Texture2D> t; ComPtr<ID3D11ShaderResourceView> v; ComPtr<ID3D11RenderTargetView> r;
  if (FAILED(g_dev->CreateTexture2D(&d, nullptr, &t)) || FAILED(g_dev->CreateShaderResourceView(t.Get(), nullptr, &v))) return false;
  if (rt) g_dev->CreateRenderTargetView(t.Get(), nullptr, &r);
  c.tex = t; c.srv = v; c.rtv = r; c.w = w; c.h = h; c.fmt = f;
  return true;
}
// salin satu sampel Media Foundation (tekstur DXGI atau memori RGB32) ke tekstur sumber
static bool sampleToCam(Cam& c, IMFSample* smp, UINT mw, UINT mh) {
  ComPtr<IMFMediaBuffer> mb; if (FAILED(smp->GetBufferByIndex(0, &mb))) return false;
  ComPtr<IMFDXGIBuffer> db;
  if (SUCCEEDED(mb.As(&db))) {
    ComPtr<ID3D11Texture2D> t; UINT sub = 0;
    if (FAILED(db->GetResource(IID_PPV_ARGS(&t))) || FAILED(db->GetSubresourceIndex(&sub))) return false;
    D3D11_TEXTURE2D_DESC d{}; t->GetDesc(&d);
    std::lock_guard<std::mutex> l(c.mx);
    if (!camTex(c, d.Width, d.Height, d.Format, false)) return false;
    g_ctx->CopySubresourceRegion(c.tex.Get(), 0, 0, 0, 0, t.Get(), sub, nullptr);
    c.got = true; return true;
  }
  if (!mw || !mh) return false;
  std::vector<uint8_t> tmp; const BYTE* src = nullptr; LONG pitch = 0; BYTE* p = nullptr; ComPtr<IMF2DBuffer> b2; bool l2 = false; DWORD mx = 0, cur = 0;
  if (SUCCEEDED(mb.As(&b2)) && SUCCEEDED(b2->Lock2D(&p, &pitch))) { l2 = true; src = p; }
  else if (SUCCEEDED(mb->Lock(&p, &mx, &cur))) { src = p; pitch = (LONG)mw * 4; if (cur < mw * mh * 4) { mb->Unlock(); return false; } }
  else return false;
  if (pitch < 0) { tmp.resize((size_t)mw * mh * 4); for (UINT y = 0; y < mh; y++) memcpy(&tmp[(size_t)y * mw * 4], src + (LONG)y * pitch, (size_t)mw * 4); src = tmp.data(); pitch = (LONG)mw * 4; }
  bool ok = false;
  { std::lock_guard<std::mutex> l(c.mx); if (camTex(c, mw, mh, DXGI_FORMAT_B8G8R8A8_UNORM, false)) { g_ctx->UpdateSubresource(c.tex.Get(), 0, nullptr, src, (UINT)pitch, 0); c.got = true; ok = true; } }
  if (l2) b2->Unlock2D(); else mb->Unlock();
  return ok;
}
// ---- file video (Fase 5): dekode GPU, posisi mengikuti elemen video KLM
struct VPlay {
  std::string id; std::wstring path; std::shared_ptr<Cam> cam; std::mutex mx; std::condition_variable cv; std::atomic<bool> stop{ false };
  double aT = 0, aWall = 0, rate = 1; bool playing = false; bool have = false;
  bool live = false; double livePts0 = -1, liveWall0 = 0; // aliran langsung: jam dari frame pertama + latensi
  std::atomic<bool> audOn{ false }, audRun{ false };
};
static std::map<std::string, std::shared_ptr<VPlay>> g_vplay;
static double vClock(VPlay& v) {
  if (v.live) return v.livePts0 < 0 ? -1 : v.livePts0 + (nowMs() - v.liveWall0) / 1000.0 - 0.15;
  return v.playing ? v.aT + (nowMs() - v.aWall) / 1000.0 * v.rate : v.aT;
}
// audio file video / aliran (Fase 6): dekode sendiri, dikirim mengikuti jam yang sama dengan gambar
static void vAudThread(std::shared_ptr<VPlay> v) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  v->audRun = true;
  while (!v->stop && v->audOn) {
    ComPtr<IMFSourceReader> rd;
    if (FAILED(MFCreateSourceReaderFromURL(v->path.c_str(), nullptr, &rd))) { emit("naerr %s audio tidak bisa dibuka", v->id.c_str()); break; }
    const DWORD AS = (DWORD)MF_SOURCE_READER_FIRST_AUDIO_STREAM;
    rd->SetStreamSelection((DWORD)MF_SOURCE_READER_ALL_STREAMS, FALSE);
    if (FAILED(rd->SetStreamSelection(AS, TRUE))) { emit("naerr %s file tanpa audio", v->id.c_str()); break; }
    ComPtr<IMFMediaType> out; MFCreateMediaType(&out); out->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio); out->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_Float);
    if (FAILED(rd->SetCurrentMediaType(AS, nullptr, out.Get()))) { out->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM); if (FAILED(rd->SetCurrentMediaType(AS, nullptr, out.Get()))) { emit("naerr %s codec audio tidak didukung", v->id.c_str()); break; } }
    ComPtr<IMFMediaType> cur; rd->GetCurrentMediaType(AS, &cur);
    UINT32 rate = 48000, ch = 2, bits = 32; GUID sub{};
    cur->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &rate); cur->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &ch); cur->GetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, &bits); cur->GetGUID(MF_MT_SUBTYPE, &sub);
    const bool isF = sub == MFAudioFormat_Float;
    emit("naok %s %u %u", v->id.c_str(), rate, ch);
    double lastPts = -1; bool eos = false; std::vector<int16_t> s16;
    while (!v->stop && v->audOn) {
      double M; bool play;
      { std::lock_guard<std::mutex> l(v->mx); M = vClock(*v); play = v->live ? v->livePts0 >= 0 : v->playing; }
      if (!play || M < 0) { std::unique_lock<std::mutex> l(v->mx); v->cv.wait_for(l, std::chrono::milliseconds(20)); continue; }
      if (!v->live && (lastPts < 0 || M < lastPts - 0.4 || M > lastPts + 1.5)) {
        PROPVARIANT pv; PropVariantInit(&pv); pv.vt = VT_I8; pv.hVal.QuadPart = (LONGLONG)(std::max(0.0, M) * 1e7); rd->SetCurrentPosition(GUID_NULL, pv); PropVariantClear(&pv);
        lastPts = M; eos = false;
      }
      if (eos) { std::unique_lock<std::mutex> l(v->mx); v->cv.wait_for(l, std::chrono::milliseconds(20)); continue; }
      DWORD si = 0, fl = 0; LONGLONG ts = 0; ComPtr<IMFSample> smp;
      if (FAILED(rd->ReadSample(AS, 0, &si, &fl, &ts, &smp)) || (fl & MF_SOURCE_READERF_ERROR)) break;
      if (fl & MF_SOURCE_READERF_ENDOFSTREAM) { eos = true; if (v->live) break; continue; }
      if (!smp) continue;
      double pts = ts / 1e7; lastPts = pts;
      if (pts < M - 0.25) continue; // tertinggal → buang
      // jangan lebih dari 120 ms di depan jam (penyangga KLM ±80 ms)
      while (!v->stop && v->audOn) { double now2; { std::lock_guard<std::mutex> l(v->mx); now2 = vClock(*v); } if (pts <= now2 + 0.12) break; std::unique_lock<std::mutex> l(v->mx); v->cv.wait_for(l, std::chrono::milliseconds((int)std::min(30.0, (pts - now2 - 0.12) * 1000 + 1))); }
      ComPtr<IMFMediaBuffer> mb; if (FAILED(smp->ConvertToContiguousBuffer(&mb))) continue;
      BYTE* p = nullptr; DWORD len = 0; if (FAILED(mb->Lock(&p, nullptr, &len))) continue;
      toS16Stereo(p, len, isF, bits, ch, s16); mb->Unlock();
      pcmOut(v->id, rate, 2, s16.data(), s16.size() / 2);
    }
    if (!v->live) break;
    std::this_thread::sleep_for(std::chrono::milliseconds(1500)); // aliran langsung putus → coba lagi
  }
  v->audRun = false;
  CoUninitialize();
}
static void vThread(std::shared_ptr<VPlay> v, std::wstring path) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
 for (int attempt = 0; !v->stop; attempt++) {
  if (attempt) { std::this_thread::sleep_for(std::chrono::milliseconds(2000)); if (v->stop) break; { std::lock_guard<std::mutex> l(v->mx); v->livePts0 = -1; } }
  ComPtr<IMFAttributes> a; MFCreateAttributes(&a, 3);
  ComPtr<ID3D11VideoDevice> vd; g_dev.As(&vd);
  if (g_mfMgr && vd) a->SetUnknown(MF_SOURCE_READER_D3D_MANAGER, g_mfMgr.Get());
  a->SetUINT32(MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, TRUE);
  a->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
  ComPtr<IMFSourceReader> rd;
  HRESULT hr = MFCreateSourceReaderFromURL(path.c_str(), a.Get(), &rd);
  if (FAILED(hr)) { if (v->live) continue; emit("srcerr %s file video tidak bisa dibuka (0x%08lx)", v->id.c_str(), (unsigned long)hr); break; }
  const DWORD ST = (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM;
  rd->SetStreamSelection((DWORD)MF_SOURCE_READER_ALL_STREAMS, FALSE); rd->SetStreamSelection(ST, TRUE);
  ComPtr<IMFMediaType> out; MFCreateMediaType(&out); out->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); out->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
  if (FAILED(hr = rd->SetCurrentMediaType(ST, nullptr, out.Get()))) { out->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32); hr = rd->SetCurrentMediaType(ST, nullptr, out.Get()); }
  if (FAILED(hr)) { emit("srcerr %s codec video tidak didukung Windows (0x%08lx)", v->id.c_str(), (unsigned long)hr); break; }
  UINT32 w = 0, h = 0; { ComPtr<IMFMediaType> cur; if (SUCCEEDED(rd->GetCurrentMediaType(ST, &cur))) MFGetAttributeSize(cur.Get(), MF_MT_FRAME_SIZE, &w, &h); }
  double dur = 0; { PROPVARIANT pv; PropVariantInit(&pv); if (SUCCEEDED(rd->GetPresentationAttribute((DWORD)MF_SOURCE_READER_MEDIASOURCE, MF_PD_DURATION, &pv)) && pv.vt == VT_UI8) dur = pv.uhVal.QuadPart / 1e7; PropVariantClear(&pv); }
  ComPtr<IMFSample> pend; double pendPts = 0, lastPts = -1, seekT = -1; bool eos = false, okSent = false;
  auto seek = [&](double t) {
    PROPVARIANT pv; PropVariantInit(&pv); pv.vt = VT_I8; pv.hVal.QuadPart = (LONGLONG)(std::max(0.0, t) * 1e7);
    rd->SetCurrentPosition(GUID_NULL, pv); PropVariantClear(&pv);
    pend.Reset(); eos = false; lastPts = std::max(0.0, t) - 0.001; seekT = t;
  };
  bool liveFail = false;
  while (!v->stop) {
    double M; bool playing;
    { std::lock_guard<std::mutex> l(v->mx); M = vClock(*v); playing = v->live ? true : v->playing; }
    if (v->live) {
      // aliran langsung: tidak ada seek; jam dimulai dari frame pertama, disetel ulang bila tertinggal / terlalu di depan
      if (!pend && !eos) {
        DWORD si = 0, fl = 0; LONGLONG ts = 0; ComPtr<IMFSample> smp;
        hr = rd->ReadSample(ST, 0, &si, &fl, &ts, &smp);
        if (FAILED(hr) || (fl & (MF_SOURCE_READERF_ERROR | MF_SOURCE_READERF_ENDOFSTREAM))) { liveFail = true; break; }
        if (!smp) continue;
        pend = smp; pendPts = ts / 1e7;
      }
      { std::lock_guard<std::mutex> l(v->mx);
        if (v->livePts0 < 0 || pendPts < vClock(*v) - 0.6 || pendPts > vClock(*v) + 2.0) { v->livePts0 = pendPts; v->liveWall0 = nowMs() - 150; }
        M = vClock(*v); }
      if (pendPts <= M + 0.008) {
        if (sampleToCam(*v->cam, pend.Get(), w, h)) { v->cam->fresh = true; v->cam->frames++; if (!okSent) { okSent = true; emit("vok %s %u %u 0", v->id.c_str(), w, h); } }
        pend.Reset(); continue;
      }
      std::unique_lock<std::mutex> l(v->mx); v->cv.wait_for(l, std::chrono::milliseconds((int)std::max(1.0, std::min(40.0, (pendPts - M) * 1000)))); continue;
    }
    if (dur > 0 && M > dur) M = dur;
    // posisi KLM melompat (seek / ulang / loop) → lompat juga; maju sedikit → kejar dengan dekode
    if (seekT < 0 || M < lastPts - 0.3 || M > lastPts + 2.0) { seek(M); continue; }
    if (!pend && !eos) {
      DWORD si = 0, fl = 0; LONGLONG ts = 0; ComPtr<IMFSample> smp;
      hr = rd->ReadSample(ST, 0, &si, &fl, &ts, &smp);
      if (FAILED(hr) || (fl & MF_SOURCE_READERF_ERROR)) { emit("srcerr %s dekode video gagal (0x%08lx)", v->id.c_str(), (unsigned long)hr); break; }
      if (fl & MF_SOURCE_READERF_ENDOFSTREAM) { eos = true; continue; }
      if (!smp) continue;
      pend = smp; pendPts = ts / 1e7;
    }
    if (pend) {
      if (pendPts < M - 0.06) { lastPts = pendPts; pend.Reset(); continue; } // tertinggal → buang (kejar posisi)
      if (pendPts <= M + 0.008) {
        if (sampleToCam(*v->cam, pend.Get(), w, h)) {
          v->cam->fresh = true; v->cam->frames++;
          if (!okSent) { okSent = true; emit("vok %s %u %u %.3f", v->id.c_str(), w, h, dur); }
        }
        lastPts = pendPts; pend.Reset(); continue;
      }
      // frame berikutnya belum waktunya → tunggu (atau sampai posisi diperbarui KLM)
      double waitMs = playing ? (pendPts - M) * 1000.0 / std::max(0.05, v->rate) : 40.0;
      std::unique_lock<std::mutex> l(v->mx);
      v->cv.wait_for(l, std::chrono::milliseconds((int)std::max(1.0, std::min(40.0, waitMs))));
      continue;
    }
    std::unique_lock<std::mutex> l(v->mx); v->cv.wait_for(l, std::chrono::milliseconds(20)); // akhir file: tahan frame terakhir
  }
  rd.Reset();
  if (!(v->live && liveFail)) break; // file selesai / ditutup; aliran langsung putus → sambung ulang
 }
  CoUninitialize();
}
static void vClose(const std::string& id) {
  auto it = g_vplay.find(id); if (it == g_vplay.end()) return;
  { std::lock_guard<std::mutex> l(it->second->mx); it->second->stop = true; } it->second->cv.notify_all();
  g_vplay.erase(it); g_cams.erase(id);
}
static void vOpen(const std::string& id, const std::string& path, bool live = false) {
  vClose(id);
  if (!initMF()) { emit("srcerr %s Media Foundation tidak tersedia", id.c_str()); return; }
  auto v = std::make_shared<VPlay>(); v->id = id; v->path = widen(path); v->live = live; v->cam = std::make_shared<Cam>(); v->cam->id = id; v->aWall = nowMs();
  g_vplay[id] = v; g_cams[id] = v->cam;
  std::thread(vThread, v, widen(path)).detach();
}
static void vAudio(const std::string& id, bool on) {
  auto it = g_vplay.find(id); if (it == g_vplay.end()) return;
  auto v = it->second; v->audOn = on; v->cv.notify_all();
  if (on && !v->audRun) std::thread(vAudThread, v).detach();
}
static void vTime(const std::string& id, double t, bool play, double rate) {
  auto it = g_vplay.find(id); if (it == g_vplay.end()) return;
  VPlay& v = *it->second;
  { std::lock_guard<std::mutex> l(v.mx); v.aT = t; v.aWall = nowMs(); v.playing = play; v.rate = rate > 0 ? rate : 1; v.have = true; }
  v.cv.notify_all();
}
// ---- gambar (Fase 5): WIC → BGRA, diperkecil bila > 4096 px
static bool loadImage(Source& s, const std::string& path, std::string& why) {
  ComPtr<IWICImagingFactory> f;
  if (FAILED(CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&f)))) { why = "WIC tidak tersedia"; return false; }
  ComPtr<IWICBitmapDecoder> dec; ComPtr<IWICBitmapFrameDecode> fr;
  if (FAILED(f->CreateDecoderFromFilename(widen(path).c_str(), nullptr, GENERIC_READ, WICDecodeMetadataCacheOnDemand, &dec)) || FAILED(dec->GetFrame(0, &fr))) { why = "format gambar tidak dikenali"; return false; }
  UINT w = 0, h = 0; fr->GetSize(&w, &h); if (!w || !h) { why = "ukuran gambar 0"; return false; }
  UINT nf = 0; dec->GetFrameCount(&nf);
  GUID cf{}; dec->GetContainerFormat(&cf);
  if (cf == GUID_ContainerFormatGif && nf > 1) { // GIF bergerak → komposisi semua frame (posisi, jeda, cara buang)
    auto u16 = [](IWICMetadataQueryReader* q, const wchar_t* n, UINT def) -> UINT { PROPVARIANT v; PropVariantInit(&v); UINT r = def; if (q && SUCCEEDED(q->GetMetadataByName(n, &v))) { if (v.vt == VT_UI2) r = v.uiVal; else if (v.vt == VT_UI1) r = v.bVal; } PropVariantClear(&v); return r; };
    ComPtr<IWICMetadataQueryReader> gq; dec->GetMetadataQueryReader(&gq);
    UINT W = u16(gq.Get(), L"/logscrdesc/Width", w), H = u16(gq.Get(), L"/logscrdesc/Height", h);
    if (!W || !H || W > 4096 || H > 4096) { W = w; H = h; }
    nf = std::min(nf, 600u);
    std::vector<uint8_t> canvas((size_t)W * H * 4, 0), prev;
    for (UINT i = 0; i < nf; i++) {
      ComPtr<IWICBitmapFrameDecode> f2; if (FAILED(dec->GetFrame(i, &f2))) break;
      ComPtr<IWICMetadataQueryReader> q; f2->GetMetadataQueryReader(&q);
      UINT L = u16(q.Get(), L"/imgdesc/Left", 0), T = u16(q.Get(), L"/imgdesc/Top", 0), fw = 0, fh = 0; f2->GetSize(&fw, &fh);
      UINT delay = u16(q.Get(), L"/grctlext/Delay", 10), disp = u16(q.Get(), L"/grctlext/Disposal", 0);
      if (disp == 3) prev = canvas;
      ComPtr<IWICFormatConverter> c2; std::vector<uint8_t> fp((size_t)fw * fh * 4);
      if (FAILED(f->CreateFormatConverter(&c2)) || FAILED(c2->Initialize(f2.Get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom)) || FAILED(c2->CopyPixels(nullptr, fw * 4, (UINT)fp.size(), fp.data()))) break;
      for (UINT y = 0; y < fh && T + y < H; y++) for (UINT x = 0; x < fw && L + x < W; x++) {
        const uint8_t* sp = &fp[((size_t)y * fw + x) * 4]; if (sp[3] < 128) continue; // GIF: transparan biner
        memcpy(&canvas[((size_t)(T + y) * W + L + x) * 4], sp, 4);
      }
      Source tmpS; if (!makeTex(W, H, canvas.data(), tmpS.tex, tmpS.srv)) { why = "tekstur GPU gagal"; return false; }
      s.frames.push_back(tmpS.srv); s.delays.push_back((delay < 2 ? 10 : delay) * 10.0); // < 20 ms dianggap 100 ms (seperti browser)
      if (disp == 2) for (UINT y = 0; y < fh && T + y < H; y++) memset(&canvas[((size_t)(T + y) * W + L) * 4], 0, (size_t)std::min(fw, W - L) * 4);
      else if (disp == 3 && !prev.empty()) canvas = prev;
    }
    if (!s.frames.empty()) {
      s.srv = s.frames[0]; s.w = W; s.h = H; s.animT0 = nowMs(); s.animTotal = 0; for (double d : s.delays) s.animTotal += d;
      return true;
    }
  }
  ComPtr<IWICBitmapSource> src = fr;
  if (w > 4096 || h > 4096) {
    double k = 4096.0 / std::max(w, h); UINT nw = std::max(1u, (UINT)(w * k)), nh = std::max(1u, (UINT)(h * k));
    ComPtr<IWICBitmapScaler> sc; if (SUCCEEDED(f->CreateBitmapScaler(&sc)) && SUCCEEDED(sc->Initialize(src.Get(), nw, nh, WICBitmapInterpolationModeHighQualityCubic))) { src = sc; w = nw; h = nh; }
  }
  ComPtr<IWICFormatConverter> cv;
  if (FAILED(f->CreateFormatConverter(&cv)) || FAILED(cv->Initialize(src.Get(), GUID_WICPixelFormat32bppBGRA, WICBitmapDitherTypeNone, nullptr, 0, WICBitmapPaletteTypeCustom))) { why = "konversi warna gagal"; return false; }
  std::vector<uint8_t> px((size_t)w * h * 4);
  if (FAILED(cv->CopyPixels(nullptr, w * 4, (UINT)px.size(), px.data()))) { why = "membaca piksel gagal"; return false; }
  if (!makeTex(w, h, px.data(), s.tex, s.srv)) { why = "tekstur GPU gagal"; return false; }
  s.w = w; s.h = h; return true;
}

static void camThread(std::shared_ptr<Cam> c, ComPtr<IMFSourceReader> rd) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  while (!c->stop) {
    DWORD si = 0, fl = 0; LONGLONG ts = 0; ComPtr<IMFSample> smp;
    HRESULT hr = rd->ReadSample((DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, &si, &fl, &ts, &smp);
    if (c->stop) break;
    if (FAILED(hr) || (fl & (MF_SOURCE_READERF_ERROR | MF_SOURCE_READERF_ENDOFSTREAM))) { emit("camerr %s kamera terputus (0x%08lx)", c->id.c_str(), (unsigned long)hr); break; }
    if (!smp) continue;
    ComPtr<IMFMediaBuffer> mb; if (FAILED(smp->GetBufferByIndex(0, &mb))) continue;
    ComPtr<IMFDXGIBuffer> db;
    if (SUCCEEDED(mb.As(&db))) { // jalur GPU: frame sudah berupa tekstur di device ini (tanpa salinan CPU)
      ComPtr<ID3D11Texture2D> t; UINT sub = 0;
      if (FAILED(db->GetResource(IID_PPV_ARGS(&t))) || FAILED(db->GetSubresourceIndex(&sub))) continue;
      D3D11_TEXTURE2D_DESC d{}; t->GetDesc(&d);
      std::lock_guard<std::mutex> l(c->mx);
      if (!camTex(*c, d.Width, d.Height, d.Format, false)) continue;
      g_ctx->CopySubresourceRegion(c->tex.Get(), 0, 0, 0, 0, t.Get(), sub, nullptr);
    } else { // jalur CPU (driver tanpa pemroses video GPU)
      UINT w = c->mw, h = c->mh; if (!w || !h) continue;
      std::vector<uint8_t> tmp; const BYTE* src = nullptr; LONG pitch = 0; BYTE* p = nullptr;
      ComPtr<IMF2DBuffer> b2; bool l2 = false; DWORD mx = 0, cur = 0;
      if (SUCCEEDED(mb.As(&b2)) && SUCCEEDED(b2->Lock2D(&p, &pitch))) { l2 = true; src = p; }
      else if (SUCCEEDED(mb->Lock(&p, &mx, &cur))) { src = p; pitch = (LONG)w * 4; if (cur < w * h * 4) { mb->Unlock(); continue; } }
      else continue;
      if (pitch < 0) { tmp.resize((size_t)w * h * 4); for (UINT y = 0; y < h; y++) memcpy(&tmp[(size_t)y * w * 4], src + (LONG)y * pitch, (size_t)w * 4); src = tmp.data(); pitch = (LONG)w * 4; }
      {
        std::lock_guard<std::mutex> l(c->mx);
        if (camTex(*c, w, h, DXGI_FORMAT_B8G8R8A8_UNORM, false)) g_ctx->UpdateSubresource(c->tex.Get(), 0, nullptr, src, (UINT)pitch, 0);
      }
      if (l2) b2->Unlock2D(); else mb->Unlock();
    }
    { std::lock_guard<std::mutex> l(c->mx); c->got = true; }
    c->fresh = true; c->frames++;
  }
  CoUninitialize();
}
static void camClose(const std::string& id) {
  auto it = g_cams.find(id); if (it == g_cams.end()) return;
  auto c = it->second; c->stop = true;
  if (c->aStop) *c->aStop = true;
  if (c->asrc) c->asrc->Shutdown();
  if (c->src) c->src->Shutdown(); // ReadSample di utas kamera langsung kembali → utas selesai sendiri
  for (auto& s : c->ring) { if (s.h) CloseHandle(s.h); s.h = nullptr; }
  g_cams.erase(it);
}
static void camOpen(const std::string& id, UINT W, UINT H, UINT F, const std::string& q) {
  camClose(id);
  auto c = std::make_shared<Cam>(); c->id = id;
  auto devs = listCams(); int i = pickCam(devs, q);
  if (i < 0) { emit("camerr %s kamera tidak ditemukan di Media Foundation", id.c_str()); return; }
  ComPtr<IMFAttributes> a; MFCreateAttributes(&a, 2);
  a->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
  a->SetString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK, devs[i].link.c_str());
  HRESULT hr = MFCreateDeviceSource(a.Get(), &c->src);
  if (FAILED(hr)) { emit("camerr %s kamera tidak bisa dibuka (dipakai aplikasi lain?) 0x%08lx", id.c_str(), (unsigned long)hr); return; }
  ComPtr<IMFAttributes> ra; MFCreateAttributes(&ra, 3);
  if (g_mfMgr) ra->SetUnknown(MF_SOURCE_READER_D3D_MANAGER, g_mfMgr.Get());
  ra->SetUINT32(MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, TRUE);
  ra->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
  ComPtr<IMFSourceReader> rd;
  hr = MFCreateSourceReaderFromMediaSource(c->src.Get(), ra.Get(), &rd);
  if (FAILED(hr)) { c->src->Shutdown(); emit("camerr %s SourceReader 0x%08lx", id.c_str(), (unsigned long)hr); return; }
  const DWORD ST = (DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM;
  // format asli terdekat: ukuran sama persis diutamakan, lalu fps ≥ permintaan, lalu ukuran terdekat
  ComPtr<IMFMediaType> best; double bestScore = -1e18; UINT32 bw = 0, bh = 0; double bf = 0;
  for (DWORD k = 0;; k++) {
    ComPtr<IMFMediaType> mt; if (FAILED(rd->GetNativeMediaType(ST, k, &mt))) break;
    UINT32 w = 0, h = 0, n = 0, d = 0; MFGetAttributeSize(mt.Get(), MF_MT_FRAME_SIZE, &w, &h); MFGetAttributeRatio(mt.Get(), MF_MT_FRAME_RATE, &n, &d);
    double f = d ? (double)n / d : 0;
    double sc = -std::fabs((double)w * h - (double)W * H) / 1000.0 - (f + 0.5 < F ? (F - f) * 400 : (f - F) * 2) + (w == W && h == H ? 5000 : 0);
    if (sc > bestScore) { bestScore = sc; best = mt; bw = w; bh = h; bf = f; }
  }
  if (best) rd->SetCurrentMediaType(ST, nullptr, best.Get());
  ComPtr<IMFMediaType> out; MFCreateMediaType(&out);
  out->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); out->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32);
  if (bw && bh) MFSetAttributeSize(out.Get(), MF_MT_FRAME_SIZE, bw, bh);
  hr = rd->SetCurrentMediaType(ST, nullptr, out.Get());
  if (FAILED(hr)) { out->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32); hr = rd->SetCurrentMediaType(ST, nullptr, out.Get()); }
  if (FAILED(hr)) { c->src->Shutdown(); emit("camerr %s konversi warna tidak didukung 0x%08lx", id.c_str(), (unsigned long)hr); return; }
  ComPtr<IMFMediaType> cur; if (SUCCEEDED(rd->GetCurrentMediaType(ST, &cur))) MFGetAttributeSize(cur.Get(), MF_MT_FRAME_SIZE, &bw, &bh);
  c->mw = bw; c->mh = bh;
  rd->SetStreamSelection((DWORD)MF_SOURCE_READER_ALL_STREAMS, FALSE); rd->SetStreamSelection(ST, TRUE);
  g_cams[id] = c;
  emit("camok %s %u %u %.2f %s %d", id.c_str(), bw, bh, bf, hexOf(narrow(devs[i].name.c_str())).c_str(), g_mfMgr ? 1 : 0);
  std::thread(camThread, c, rd).detach();
}
// audio perangkat (mis. HDMI capture card) untuk kamera native → PCM ke KLM, dicocokkan dari label Chromium
static void camAudio(const std::string& id, const std::string& q8) {
  auto it = g_cams.find(id); if (it == g_cams.end()) { emit("naerr %s kamera belum dibuka", id.c_str()); return; }
  auto c = it->second;
  if (c->aStop) *c->aStop = true; if (c->asrc) { c->asrc->Shutdown(); c->asrc.Reset(); }
  if (q8.empty()) return;
  ComPtr<IMFAttributes> a; MFCreateAttributes(&a, 1); a->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_AUDCAP_GUID);
  IMFActivate** devs = nullptr; UINT32 n = 0; std::wstring want = lower(widen(q8)), best;
  size_t lp = want.rfind(L" ("); if (lp != std::wstring::npos && want.back() == L')' && want.size() - lp == 12) want = want.substr(0, lp);
  if (want.compare(0, 10, L"default - ") == 0) want = want.substr(10);
  if (want.compare(0, 17, L"communications - ") == 0) want = want.substr(17);
  if (SUCCEEDED(MFEnumDeviceSources(a.Get(), &devs, &n))) {
    for (UINT32 i = 0; i < n; i++) {
      WCHAR* nm = nullptr; UINT32 l = 0; std::wstring name, eid;
      if (SUCCEEDED(devs[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME, &nm, &l))) { name = nm; CoTaskMemFree(nm); }
      if (SUCCEEDED(devs[i]->GetAllocatedString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_AUDCAP_ENDPOINT_ID, &nm, &l))) { eid = nm; CoTaskMemFree(nm); }
      if (best.empty() && (lower(name) == want || (!want.empty() && lower(name).find(want) != std::wstring::npos))) best = eid;
      devs[i]->Release();
    }
    CoTaskMemFree(devs);
  }
  if (best.empty()) { emit("naerr %s perangkat audio tidak ditemukan", id.c_str()); return; }
  ComPtr<IMFAttributes> b; MFCreateAttributes(&b, 2); b->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE, MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_AUDCAP_GUID);
  b->SetString(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_AUDCAP_ENDPOINT_ID, best.c_str());
  ComPtr<IMFMediaSource> src; ComPtr<IMFSourceReader> rd;
  if (FAILED(MFCreateDeviceSource(b.Get(), &src)) || FAILED(MFCreateSourceReaderFromMediaSource(src.Get(), nullptr, &rd))) { emit("naerr %s perangkat audio tidak bisa dibuka", id.c_str()); return; }
  ComPtr<IMFMediaType> out; MFCreateMediaType(&out); out->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio); out->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
  rd->SetCurrentMediaType((DWORD)MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, out.Get());
  ComPtr<IMFMediaType> cur; rd->GetCurrentMediaType((DWORD)MF_SOURCE_READER_FIRST_AUDIO_STREAM, &cur);
  UINT32 rate = 48000, ch = 2, bits = 16; GUID sub{};
  if (cur) { cur->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &rate); cur->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &ch); cur->GetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, &bits); cur->GetGUID(MF_MT_SUBTYPE, &sub); }
  c->asrc = src; auto stop = std::make_shared<std::atomic<bool>>(false); c->aStop = stop;
  emit("naok %s %u %u", id.c_str(), rate, ch);
  std::thread([rd, stop, id, rate, ch, bits, sub]() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED); std::vector<int16_t> s16;
    while (!*stop) {
      DWORD si = 0, fl = 0; LONGLONG ts = 0; ComPtr<IMFSample> smp;
      if (FAILED(rd->ReadSample((DWORD)MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, &si, &fl, &ts, &smp)) || (fl & (MF_SOURCE_READERF_ERROR | MF_SOURCE_READERF_ENDOFSTREAM))) { if (!*stop) emit("naerr %s audio perangkat terputus", id.c_str()); break; }
      if (!smp) continue;
      ComPtr<IMFMediaBuffer> mb; if (FAILED(smp->ConvertToContiguousBuffer(&mb))) continue;
      BYTE* p = nullptr; DWORD len = 0; if (FAILED(mb->Lock(&p, nullptr, &len))) continue;
      toS16Stereo(p, len, sub == MFAudioFormat_Float, bits, ch, s16); mb->Unlock();
      pcmOut(id, rate, 2, s16.data(), s16.size() / 2);
    }
    CoUninitialize();
  }).detach();
}
static void camTestOpen(const std::string& id, UINT W, UINT H) {
  camClose(id);
  auto c = std::make_shared<Cam>(); c->id = id; c->test = true; c->mw = W; c->mh = H;
  { std::lock_guard<std::mutex> l(c->mx); camTex(*c, W, H, DXGI_FORMAT_B8G8R8A8_UNORM, true); }
  g_cams[id] = c;
  emit("camok %s %u %u 0 %s 1", id.c_str(), W, H, hexOf("KLM pola uji").c_str());
}

static inline uint32_t bgra(int r, int g, int b) { return 0xFF000000u | ((uint32_t)r << 16) | ((uint32_t)g << 8) | (uint32_t)b; }
static inline int lerpi(int a, int b, double t) { return (int)std::lround(a + (b - a) * t); }

// sama dengan input "Warna / Gradien" di KLM (kanvas 640×360)
static void genColour(Source& s, int r, int g, int b, int r2, int g2, int b2, int grad) {
  const UINT W = 640, H = 360; std::vector<uint32_t> px(W * H);
  for (UINT y = 0; y < H; y++) for (UINT x = 0; x < W; x++) {
    double t = 0;
    if (grad == 1) t = ((x + 0.5) * 640.0 + (y + 0.5) * 360.0) / (640.0 * 640.0 + 360.0 * 360.0);
    else if (grad == 2) t = (std::hypot(x + 0.5 - 320.0, y + 0.5 - 180.0) - 10.0) / 370.0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    px[y * W + x] = grad ? bgra(lerpi(r, r2, t), lerpi(g, g2, t), lerpi(b, b2, t)) : bgra(r, g, b);
  }
  makeTex(W, H, px.data(), s.tex, s.srv); s.w = W; s.h = H;
}
static uint32_t hexc(const char* h) { unsigned v = 0; sscanf(h + 1, "%x", &v); return 0xFF000000u | v; }
// sama dengan input "Color Bars" di KLM (1280×720)
static void genBars(Source& s) {
  const UINT W = 1280, H = 720; std::vector<uint32_t> px(W * H, hexc("#131313"));
  auto fill = [&](double x0, double y0, double w, double h, uint32_t c) {
    int xa = (int)std::floor(x0), xb = (int)std::ceil(x0 + w), ya = (int)y0, yb = (int)(y0 + h);
    for (int y = ya; y < yb && y < (int)H; y++) for (int x = xa < 0 ? 0 : xa; x < xb && x < (int)W; x++) px[y * W + x] = c;
  };
  const char* top[] = { "#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0" };
  const char* mid[] = { "#0000c0", "#131313", "#c000c0", "#131313", "#00c0c0", "#131313", "#c0c0c0" };
  const double bw = 1280.0 / 7;
  for (int i = 0; i < 7; i++) fill(i * bw, 0, bw + 1, 480, hexc(top[i]));
  for (int i = 0; i < 7; i++) fill(i * bw, 480, bw + 1, 60, hexc(mid[i]));
  const char* bot[] = { "#00214c", "#ffffff", "#32006a", "#131313" };
  for (int i = 0; i < 4; i++) fill(i * 1280.0 / 6 * 1.25, 540, 1280.0 / 6 * 1.25 + 1, 180, hexc(bot[i]));
  fill(1280.0 / 6 * 5, 540, 1280.0 / 6, 180, hexc("#131313"));
  makeTex(W, H, px.data(), s.tex, s.srv); s.w = W; s.h = H;
}

static bool openDup(Source& s, const std::string& id) {
  s.dup.Reset();
  for (UINT i = 0;; i++) {
    ComPtr<IDXGIOutput> o;
    if (g_adapter->EnumOutputs(i, &o) == DXGI_ERROR_NOT_FOUND) break;
    DXGI_OUTPUT_DESC od{}; o->GetDesc(&od);
    const RECT& r = od.DesktopCoordinates;
    if (r.left != s.want.left || r.top != s.want.top) continue;
    ComPtr<IDXGIOutput1> o1;
    if (FAILED(o.As(&o1))) break;
    HRESULT hr = o1->DuplicateOutput(g_dev.Get(), &s.dup);
    if (FAILED(hr)) { emit("srcerr %s DuplicateOutput gagal 0x%08lx", id.c_str(), (unsigned long)hr); return false; }
    UINT w = (UINT)(r.right - r.left), h = (UINT)(r.bottom - r.top);
    DXGI_OUTDUPL_DESC dd{}; s.dup->GetDesc(&dd);
    if (dd.ModeDesc.Width && dd.ModeDesc.Height) { w = dd.ModeDesc.Width; h = dd.ModeDesc.Height; }
    if (!s.tex || s.w != w || s.h != h) { makeTex(w, h, nullptr, s.tex, s.srv); s.w = w; s.h = h; }
    emit("srcok %s %u %u", id.c_str(), w, h);
    return true;
  }
  emit("srcerr %s layar tidak ditemukan di GPU ini (laptop dua GPU?)", id.c_str());
  return false;
}
static void tickScreen(Source& s, const std::string& id, double now) {
  if (!s.dup) { if (now >= s.retryAt) { s.retryAt = now + 2000; openDup(s, id); } return; }
  DXGI_OUTDUPL_FRAME_INFO fi{}; ComPtr<IDXGIResource> res;
  HRESULT hr = s.dup->AcquireNextFrame(0, &fi, &res);
  if (hr == DXGI_ERROR_WAIT_TIMEOUT) return;
  if (hr == DXGI_ERROR_ACCESS_LOST || FAILED(hr)) { s.dup.Reset(); s.retryAt = now + 500; return; } // ganti mode / layar kunci / UAC
  if (fi.LastPresentTime.QuadPart || !s.got) {
    ComPtr<ID3D11Texture2D> t;
    if (SUCCEEDED(res.As(&t))) {
      D3D11_TEXTURE2D_DESC d{}; t->GetDesc(&d);
      if (d.Width == s.w && d.Height == s.h && d.Format == DXGI_FORMAT_B8G8R8A8_UNORM) { g_ctx->CopyResource(s.tex.Get(), t.Get()); s.got = true; }
      else if (d.Format == DXGI_FORMAT_B8G8R8A8_UNORM) { makeTex(d.Width, d.Height, nullptr, s.tex, s.srv); s.w = d.Width; s.h = d.Height; g_ctx->CopyResource(s.tex.Get(), t.Get()); s.got = true; }
    }
  }
  s.dup->ReleaseFrame();
}

// ---- tangkap jendela (Fase 7): Web Browser KLM / jendela aplikasi lain
static winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice g_wdev{ nullptr };
static bool openWin(Source& s, const std::string& id, HWND hwnd) {
  using namespace winrt::Windows::Graphics::Capture;
  const char* step = "mulai";
  try {
    if (!IsWindow(hwnd)) { emit("srcerr %s jendela tidak ada", id.c_str()); return false; }
    if (!GraphicsCaptureSession::IsSupported()) { emit("srcerr %s Windows ini belum mendukung Graphics Capture", id.c_str()); return false; }
    step = "perangkat D3D";
    if (!g_wdev) {
      ComPtr<IDXGIDevice> dx; g_dev.As(&dx); winrt::com_ptr<::IInspectable> insp;
      winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(dx.Get(), insp.put()));
      g_wdev = insp.as<winrt::Windows::Graphics::DirectX::Direct3D11::IDirect3DDevice>();
    }
    step = "item jendela";
    auto interop = winrt::get_activation_factory<GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
    winrt::check_hresult(interop->CreateForWindow(hwnd, winrt::guid_of<GraphicsCaptureItem>(), winrt::put_abi(s.wItem)));
    auto sz = s.wItem.Size(); s.wcw = sz.Width; s.wch = sz.Height;
    step = "kolam frame";
    s.wPool = Direct3D11CaptureFramePool::CreateFreeThreaded(g_wdev, winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, sz);
    step = "sesi";
    s.wSess = s.wPool.CreateCaptureSession(s.wItem);
    try { s.wSess.IsCursorCaptureEnabled(false); } catch (...) {}
    try { s.wSess.IsBorderRequired(false); } catch (...) {} // Windows 11: tanpa bingkai kuning
    step = "mulai tangkap";
    s.wSess.StartCapture();
    emit("srcok %s %d %d", id.c_str(), sz.Width, sz.Height);
    return true;
  } catch (winrt::hresult_error const& e) { emit("srcerr %s Graphics Capture gagal di langkah %s (0x%08x)", id.c_str(), step, (unsigned)e.code()); }
  catch (...) { emit("srcerr %s Graphics Capture gagal di langkah %s", id.c_str(), step); }
  return false;
}
static void tickWin(Source& s) {
  if (!s.wPool) return;
  try {
    auto f = s.wPool.TryGetNextFrame(); if (!f) return;
    auto cs = f.ContentSize();
    auto access = f.Surface().as<::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
    ComPtr<ID3D11Texture2D> t; if (FAILED(access->GetInterface(IID_PPV_ARGS(&t)))) return;
    if (cs.Width != s.wcw || cs.Height != s.wch) { // jendela berubah ukuran → kolam frame dibuat ulang
      s.wcw = cs.Width; s.wch = cs.Height;
      s.wPool.Recreate(g_wdev, winrt::Windows::Graphics::DirectX::DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, cs);
    }
    D3D11_TEXTURE2D_DESC d{}; t->GetDesc(&d);
    UINT w = std::min<UINT>(d.Width, (UINT)std::max(1, cs.Width)), h = std::min<UINT>(d.Height, (UINT)std::max(1, cs.Height));
    if (!s.tex || s.w != w || s.h != h) { makeTex(w, h, nullptr, s.tex, s.srv); s.w = w; s.h = h; }
    D3D11_BOX bx{ 0, 0, 0, w, h, 1 };
    g_ctx->CopySubresourceRegion(s.tex.Get(), 0, 0, 0, 0, t.Get(), 0, &bx);
    s.got = true;
  } catch (...) {}
}

// ---------------------------------------------------------------- monitor (bus)
struct Bus {
  const char* name;
  HWND hwnd = nullptr;
  ComPtr<IDXGISwapChain1> sc;
  ComPtr<ID3D11RenderTargetView> scRtv;
  UINT scW = 0, scH = 0;
  RECT r{}; bool want = false, shown = false; int presented = 0;
  ComPtr<ID3D11Texture2D> rt; ComPtr<ID3D11RenderTargetView> rtv; ComPtr<ID3D11ShaderResourceView> rtSrv;
  std::string id;
  UINT cw = 0, ch = 0; // ukuran khusus (mode grid Preview: rasio panel monitor, bukan rasio output); 0 = ukuran output
};
static Bus g_pvw{ "pvw" }, g_pgm{ "pgm" };
static HWND g_parent = nullptr;
static UINT g_W = 1920, g_H = 1080, g_fps = 30;
struct Trans { bool on = false, manual = false; double t0 = 0, dur = 0, k = 0; std::string from, to; int type = 0; std::string sid; double cut = 500; } g_tr;
// jenis transisi (= engine.js): 0 fade … 14 blur
static const char* kTrNames[] = { "fade", "merge", "wipe", "wipeup", "slide", "slideup", "fly", "zoom", "crosszoom", "circle", "barn", "cube", "dip", "dipwhite", "blur", "stinger" };
static int trType(const std::string& s) { for (int i = 0; i < 16; i++) if (s == kTrNames[i]) return i; return 0; }
static double g_ftb = 0; // Fade To Black (alpha hitam di atas semuanya)

static LRESULT CALLBACK monProc(HWND h, UINT m, WPARAM wp, LPARAM lp) {
  Bus* b = (Bus*)GetWindowLongPtrW(h, GWLP_USERDATA);
  switch (m) {
    case WM_MOUSEACTIVATE: return MA_NOACTIVATE; // jangan merebut fokus keyboard dari KLM
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: { PAINTSTRUCT ps; BeginPaint(h, &ps); EndPaint(h, &ps); return 0; }
    case WM_SETCURSOR: SetCursor(LoadCursor(nullptr, IDC_ARROW)); return TRUE;
    case WM_MOUSEWHEEL: if (b) emit("wheel %s %d", b->name, (int)(short)HIWORD(wp)); return 0; // daftar input tetap bisa digulir di atas kartu native
    case WM_LBUTTONDOWN: case WM_LBUTTONDBLCLK: case WM_RBUTTONUP: case WM_MBUTTONDOWN: {
      if (!b || !b->scW || !b->scH) break;
      int x = (short)LOWORD(lp), y = (short)HIWORD(lp);
      int btn = m == WM_RBUTTONUP ? 2 : m == WM_MBUTTONDOWN ? 1 : 0;
      emit("click %s %.4f %.4f %d %d %d", b->name, x / (double)b->scW, y / (double)b->scH, btn, m == WM_LBUTTONDBLCLK ? 1 : 0, (wp & MK_CONTROL) ? 1 : 0);
      return 0;
    }
  }
  return DefWindowProcW(h, m, wp, lp);
}

static void ensureRT(Bus& b) {
  if (b.rt) { D3D11_TEXTURE2D_DESC d{}; b.rt->GetDesc(&d); if (d.Width == g_W && d.Height == g_H) return; }
  b.rtv.Reset();
  if (makeTex(g_W, g_H, nullptr, b.rt, b.rtSrv, true)) g_dev->CreateRenderTargetView(b.rt.Get(), nullptr, &b.rtv);
}
static bool ensureWindow(Bus& b) {
  if (b.hwnd && IsWindow(b.hwnd)) return true;
  if (!g_parent || !IsWindow(g_parent)) return false;
  b.hwnd = CreateWindowExW(WS_EX_NOPARENTNOTIFY | WS_EX_NOACTIVATE, L"KLMEngineMon", L"", WS_CHILD | WS_CLIPSIBLINGS,
                           0, 0, 16, 16, g_parent, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!b.hwnd) { emit("err CreateWindow %s gagal (%lu)", b.name, GetLastError()); return false; }
  SetWindowLongPtrW(b.hwnd, GWLP_USERDATA, (LONG_PTR)&b);
  b.sc.Reset(); b.scRtv.Reset(); b.scW = b.scH = 0; b.shown = false; b.presented = 0;
  return true;
}
static bool ensureSwap(Bus& b, UINT w, UINT h) {
  w = w < 8 ? 8 : w; h = h < 8 ? 8 : h;
  if (b.sc && b.scW == w && b.scH == h) return true;
  if (b.sc) {
    b.scRtv.Reset(); g_ctx->OMSetRenderTargets(0, nullptr, nullptr);
    if (FAILED(b.sc->ResizeBuffers(0, w, h, DXGI_FORMAT_UNKNOWN, 0))) b.sc.Reset();
  }
  if (!b.sc) {
    DXGI_SWAP_CHAIN_DESC1 d{}; d.Width = w; d.Height = h; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1;
    d.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT; d.BufferCount = 2; d.SwapEffect = DXGI_SWAP_EFFECT_FLIP_DISCARD;
    d.Scaling = DXGI_SCALING_STRETCH; d.AlphaMode = DXGI_ALPHA_MODE_IGNORE;
    HRESULT hr = g_fac->CreateSwapChainForHwnd(g_dev.Get(), b.hwnd, &d, nullptr, nullptr, &b.sc);
    if (FAILED(hr)) { // Windows lama tanpa flip-discard
      d.SwapEffect = DXGI_SWAP_EFFECT_DISCARD; d.BufferCount = 1;
      hr = g_fac->CreateSwapChainForHwnd(g_dev.Get(), b.hwnd, &d, nullptr, nullptr, &b.sc);
    }
    if (FAILED(hr)) { emit("err swapchain %s 0x%08lx", b.name, (unsigned long)hr); return false; }
    g_fac->MakeWindowAssociation(b.hwnd, DXGI_MWA_NO_ALT_ENTER | DXGI_MWA_NO_WINDOW_CHANGES);
  }
  ComPtr<ID3D11Texture2D> bb;
  if (FAILED(b.sc->GetBuffer(0, IID_PPV_ARGS(&bb))) || FAILED(g_dev->CreateRenderTargetView(bb.Get(), nullptr, &b.scRtv))) { b.sc.Reset(); return false; }
  b.scW = w; b.scH = h;
  return true;
}

// ---------------------------------------------------------------- menggambar
static void setCB6(const float dst[4], const float uv[4], const float col[4], const float p2[4], const float p3[4], const float p4[4], const float* p5 = nullptr, const float* p6 = nullptr, const float* p7 = nullptr, const float* p8 = nullptr) {
  static const float z[4] = { 0, 0, 0, 0 };
  D3D11_MAPPED_SUBRESOURCE m;
  if (FAILED(g_ctx->Map(g_cb.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) return;
  CB* c = (CB*)m.pData; memcpy(c->dst, dst, 16); memcpy(c->uv, uv, 16); memcpy(c->col, col, 16); memcpy(c->p2, p2, 16); memcpy(c->p3, p3, 16); memcpy(c->p4, p4, 16);
  memcpy(c->p5, p5 ? p5 : z, 16); memcpy(c->p6, p6 ? p6 : z, 16); memcpy(c->p7, p7 ? p7 : z, 16); memcpy(c->p8, p8 ? p8 : z, 16);
  g_ctx->Unmap(g_cb.Get(), 0);
}
static void setCB(const float dst[4], const float uv[4], const float col[4], const float p2[4]) { static const float z[4] = { 0, 0, 0, 0 }; setCB6(dst, uv, col, p2, z, z); }
static void pipeline() {
  g_ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP);
  g_ctx->IASetInputLayout(nullptr);
  g_ctx->VSSetShader(g_vs.Get(), nullptr, 0);
  g_ctx->VSSetConstantBuffers(0, 1, g_cb.GetAddressOf());
  ID3D11Buffer* cbs[2] = { g_cb.Get(), g_cbFx.Get() };
  g_ctx->PSSetConstantBuffers(0, 2, cbs);
  g_ctx->PSSetSamplers(0, 1, g_samp.GetAddressOf());
  g_ctx->RSSetState(g_rast.Get());
  float bf[4] = { 0, 0, 0, 0 };
  g_ctx->OMSetBlendState(g_blend.Get(), bf, 0xffffffff);
}
static void viewport(UINT w, UINT h) { D3D11_VIEWPORT v{ 0, 0, (float)w, (float)h, 0, 1 }; g_ctx->RSSetViewports(1, &v); }
// ---- transformasi global (Fase 8): transisi & overlay zoom menggerakkan / memutar / menskala seluruh gambar sumber
struct Aff { double a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0; bool on = false; };
static Aff affMul(const Aff& m, const Aff& n) { // m ∘ n (n dulu, lalu m) — sama dengan urutan ctx.translate/rotate/scale di kanvas
  Aff r; r.on = m.on || n.on;
  r.a = m.a * n.a + m.b * n.c; r.b = m.a * n.b + m.b * n.d; r.tx = m.a * n.tx + m.b * n.ty + m.tx;
  r.c = m.c * n.a + m.d * n.c; r.d = m.c * n.b + m.d * n.d; r.ty = m.c * n.tx + m.d * n.ty + m.ty;
  return r;
}
static Aff affT(double x, double y) { Aff r; r.tx = x; r.ty = y; r.on = true; return r; }
static Aff affS(double sx, double sy) { Aff r; r.a = sx; r.d = sy; r.on = true; return r; }
static Aff affR(double rad) { Aff r; r.a = std::cos(rad); r.b = -std::sin(rad); r.c = std::sin(rad); r.d = std::cos(rad); r.on = true; return r; }
static Aff affZoom(double z, double cx, double cy) { return affMul(affT(cx, cy), affMul(affS(z, z), affT(-cx, -cy))); } // = zoomTf di engine.js
static Aff g_G;                       // transformasi global saat ini
static int g_clipMode = 0; static float g_clipP[4] = { 0, 0, 0, 0 }; // klip global layar
static void setCBX(const float dst[4], const float uv[4], const float col[4], const float p3[4], const float p4[4], bool pm = false) {
  const float p2[4] = { 0, 0, 1, pm ? 1.f : 0.f };
  float p5[4] = { (float)g_G.a, (float)g_G.b, (float)g_G.tx, g_G.on ? 1.f : 0.f }, p6[4] = { (float)g_G.c, (float)g_G.d, (float)g_G.ty, 0 };
  float p8[4] = { (float)g_clipMode, (float)g_W, (float)g_H, 0 };
  setCB6(dst, uv, col, p2, p3, p4, p5, p6, g_clipP, p8);
}
// sumber "fit": rasio terjaga, di tengah (sama dengan posisi bawaan input KLM)
// ---- sumber → kotak mana pun (Fase 7): fit / fill / stretch, zoom, geser, pangkas, cermin, klip bersudut bulat
struct SrcView { ComPtr<ID3D11ShaderResourceView> srv; UINT w = 0, h = 0; bool opaque = false, pm = false; }; // pm = alpha premultiplied (video stinger transparan)
struct Rc { double x = 0, y = 0, w = 0, h = 0; };
struct Mask { bool on = false; Rc r; double rad = 0; };
static bool ulSrv(const std::string& id, SrcView& v); // tekstur bersama dari KLM (didefinisikan di bagian UTC)
static bool getSrv(const std::string& id, SrcView& v) {
  auto it = g_src.find(id);
  if (it != g_src.end()) {
    Source& s = *it->second; if (!s.srv || !s.w || !s.h) return false;
    if ((s.kind == "screen" || s.kind == "window") && !s.got) return false;
    v.srv = s.srv; v.w = s.w; v.h = s.h; v.opaque = s.kind == "screen" || s.kind == "window";
    if (s.frames.size() > 1 && s.animTotal > 0) { // GIF bergerak: frame menurut waktu
      double t = std::fmod(nowMs() - s.animT0, s.animTotal); size_t i = 0;
      while (i + 1 < s.frames.size() && t >= s.delays[i]) { t -= s.delays[i]; i++; }
      v.srv = s.frames[i];
    }
    return true;
  }
  auto ci = g_cams.find(id); if (ci == g_cams.end()) return ulSrv(id, v);
  Cam& c = *ci->second; std::lock_guard<std::mutex> l(c.mx); if (!c.got || !c.srv) return false;
  v.srv = c.srv; v.w = c.w; v.h = c.h; v.opaque = true; return true;
}
static void ndcOf(const Rc& d, float dst[4]) { dst[0] = (float)(d.x / g_W * 2 - 1); dst[1] = (float)(1 - d.y / g_H * 2); dst[2] = (float)((d.x + d.w) / g_W * 2 - 1); dst[3] = (float)(1 - (d.y + d.h) / g_H * 2); }
static void quadPx(const Rc& d, float u0, float v0, float u1, float v1, ID3D11ShaderResourceView* srv, float alpha, bool opaque, const Mask& m, double rot = 0, bool pm = false) {
  float dst[4]; ndcOf(d, dst);
  float uv[4] = { u0, v0, u1, v1 }, col[4] = { 1, 1, 1, alpha };
  float p3[4] = { (float)m.r.x, (float)m.r.y, (float)(m.r.x + m.r.w), (float)(m.r.y + m.r.h) }, p4[4] = { (float)m.rad, opaque ? 1.f : 0.f, m.on ? 1.f : 0.f, (float)rot };
  setCBX(dst, uv, col, p3, p4, pm);
  g_ctx->PSSetShader(g_psLayer.Get(), nullptr, 0);
  g_ctx->PSSetShaderResources(0, 1, &srv);
  g_ctx->Draw(4, 0);
}
static void fillPx(const Rc& d, float r, float g, float b, float a, const Mask& m, double rot = 0) {
  if (a <= 0 || d.w <= 0 || d.h <= 0) return;
  float dst[4]; ndcOf(d, dst);
  float uv[4] = { 0, 0, 1, 1 }, col[4] = { r, g, b, a };
  float p3[4] = { (float)m.r.x, (float)m.r.y, (float)(m.r.x + m.r.w), (float)(m.r.y + m.r.h) }, p4[4] = { (float)m.rad, 0, m.on ? 1.f : 0.f, (float)rot };
  setCBX(dst, uv, col, p3, p4);
  g_ctx->PSSetShader(g_psFill.Get(), nullptr, 0);
  g_ctx->Draw(4, 0);
}
static void fillPxC(double x, double y, double w, double h, float r, float g, float b, float a) { fillPx(Rc{ x, y, w, h }, r, g, b, a, Mask{}); }
// ---- efek per sumber (Fase 8)
struct FxN { float bri = 0, con = 1, sat = 1, hue = 0, gam = 1; bool cc = false, key = false, luma = false; float kc[3] = { 0, 1, 0 }; float sim = 0.4f, smo = 0.08f, spill = 0.1f, lo = 0.05f, hi = 0.15f; };
static std::map<std::string, FxN> g_fx;
#include "klm-seg.inl"
// latar AI: mask orang (dari model segmentasi native di GPU, atau dari KLM bila model native tidak tersedia) + mode latar
struct SegN { int mode = 0; double feather = 3, blur = 14, cx = 0, cy = 0, cw = 1; float col[3] = { 0, 0.69f, 0.25f }; std::string bg; int bgFit = 0; bool hide = false;
  ComPtr<ID3D11Texture2D> tex; ComPtr<ID3D11ShaderResourceView> srv; UINT mw = 0, mh = 0;
  // model native (Fase 9): parameter sama dengan segment.js, bingkai otomatis & deteksi orang dihitung di sini
  bool nat = false, inv = false, follow = false, hideEmpty = false, person = false; double edge = 0.5, fzoom = 1.6, lastInf = -1e9, box[4] = { 0, 0, 1, 1 }, F[3] = { 0, 0, 1 }; int infN = 0;
  ComPtr<ID3D11Texture2D> nTex; ComPtr<ID3D11ShaderResourceView> nSrv; ComPtr<ID3D11UnorderedAccessView> nUav;
  ComPtr<ID3D11Buffer> stB; ComPtr<ID3D11UnorderedAccessView> stU; ComPtr<ID3D11Texture2D> rb[2]; bool rbPend[2] = { false, false }; int rbK = 0; };
static std::map<std::string, SegN> g_seg;
// posisi input (Fase 8): fit / zoom / geser / pangkas / rotasi milik input — sama dengan drawInputRect di engine.js
struct PosN { int fit = 1; double zoom = 1, x = 0, y = 0, cl = 0, cr = 0, ct = 0, cb = 0, rot = 0; };
static std::map<std::string, PosN> g_pos;
static std::map<std::string, double> g_szoom; // zoom digital KLMCAM dari HP (potong tengah sumber, seperti digitalZoom di inputs.js)
static void setFx(const FxN* f, const SegN* sg, bool mask, bool blur, double blurPx, UINT sw, UINT sh) {
  D3D11_MAPPED_SUBRESOURCE m;
  if (FAILED(g_ctx->Map(g_cbFx.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) return;
  FxCB* c = (FxCB*)m.pData; memset(c, 0, sizeof(FxCB));
  FxN d; const FxN& x = f ? *f : d;
  c->f0[0] = x.bri; c->f0[1] = x.con; c->f0[2] = x.sat; c->f0[3] = x.hue;
  c->f1[0] = x.gam > 0.01f ? x.gam : 1; c->f1[1] = x.key ? 1.f : 0.f; c->f1[2] = x.sim; c->f1[3] = x.smo;
  c->f2[0] = x.spill; c->f2[1] = x.luma ? 1.f : 0.f; c->f2[2] = x.lo; c->f2[3] = x.hi;
  c->f3[0] = x.kc[0]; c->f3[1] = x.kc[1]; c->f3[2] = x.kc[2];
  c->f4[3] = f && x.cc ? 1.f : 0.f;
  if (mask && sg && sg->mw) { // feather: px pada lebar 1280 (= segment.js) → texel mask
    const double fr = std::max(0.35, sg->feather * sg->mw / 1280.0 * 1.4);
    c->f4[0] = 1; c->f4[1] = (float)(fr / sg->mw * sg->cw); c->f4[2] = (float)(fr / sg->mh * sg->cw);
  }
  if (blur && sw && sh) { const int n = 4; const double st = std::max(0.5, blurPx / 2); c->f5[0] = 1; c->f5[1] = (float)(st / sw); c->f5[2] = (float)(st / sh); c->f5[3] = (float)n; }
  g_ctx->Unmap(g_cbFx.Get(), 0);
}
static void quadFx(const Rc& d, float u0, float v0, float u1, float v1, ID3D11ShaderResourceView* srv, ID3D11ShaderResourceView* msk, float alpha, bool opaque, const Mask& m, double rot, bool pm = false) {
  float dst[4]; ndcOf(d, dst);
  float uv[4] = { u0, v0, u1, v1 }, col[4] = { 1, 1, 1, alpha };
  float p3[4] = { (float)m.r.x, (float)m.r.y, (float)(m.r.x + m.r.w), (float)(m.r.y + m.r.h) }, p4[4] = { (float)m.rad, opaque ? 1.f : 0.f, m.on ? 1.f : 0.f, (float)rot };
  setCBX(dst, uv, col, p3, p4, pm);
  g_ctx->PSSetShader(g_psFx.Get(), nullptr, 0);
  ID3D11ShaderResourceView* sr[2] = { srv, msk };
  g_ctx->PSSetShaderResources(0, 2, sr);
  g_ctx->Draw(4, 0);
  ID3D11ShaderResourceView* none[2] = { nullptr, nullptr }; g_ctx->PSSetShaderResources(0, 2, none);
}
static void drawView(const std::string& id, const Rc& box, int fit, double zoom, double px, double py, double cl, double cr, double ct, double cb, bool flip, float alpha, const Mask& m, int depth, double rot = 0);
// satu sumber ke satu kotak tujuan: lewat efek / latar AI bila ada (urutan sama dengan getSource: latar AI → chroma key & koreksi warna)
static void srcQuad(const std::string& id, const SrcView& v, const Rc& d, float u0, float v0, float u1, float v1, float alpha, const Mask& m, double rot, int depth) {
  { auto zi = g_szoom.find(id); if (zi != g_szoom.end() && zi->second > 1.001) { const float z = (float)zi->second; auto f = [z](float u) { return 0.5f + (u - 0.5f) / z; }; u0 = f(u0); u1 = f(u1); v0 = f(v0); v1 = f(v1); } }
  auto fi = g_fx.find(id); const FxN* fx = fi == g_fx.end() ? nullptr : &fi->second;
  auto si = g_seg.find(id); SegN* sg = si == g_seg.end() || !si->second.srv ? nullptr : &si->second;
  if (!fx && !sg) { quadPx(d, u0, v0, u1, v1, v.srv.Get(), alpha, v.opaque, m, rot, v.pm); return; }
  if (sg) {
    if (sg->hide) return; // "sembunyikan bila tidak ada orang"
    // bingkai otomatis mengikuti orang: sumber & mask dipotong bersama (kotak persegi relatif)
    auto rm = [&](float u, double o) { return (float)(o + u * sg->cw); };
    u0 = rm(u0, sg->cx); u1 = rm(u1, sg->cx); v0 = rm(v0, sg->cy); v1 = rm(v1, sg->cy);
    if (sg->mode == 1) { // buramkan latar: sumber yang sama, diburamkan & sedikit diperbesar (tepi tidak terlihat)
      const float iu = (u1 - u0) * 0.0283f, iv = (v1 - v0) * 0.0283f;
      setFx(fx, nullptr, false, true, sg->blur * v.w * sg->cw / 1280.0, v.w, v.h); // σ dalam piksel sumber (= segment.js)
      quadFx(d, u0 + iu, v0 + iv, u1 - iu, v1 - iv, v.srv.Get(), nullptr, alpha, true, m, rot);
    } else if (sg->mode == 2) fillPx(d, sg->col[0], sg->col[1], sg->col[2], alpha, m, rot);
    else if (sg->mode == 3 && !sg->bg.empty()) {
      SrcView b; if (getSrv(sg->bg, b)) {
        const double sc = (sg->bgFit == 1 ? std::min(d.w / b.w, d.h / b.h) : std::max(d.w / b.w, d.h / b.h)), bw = b.w * sc, bh = b.h * sc;
        if (sg->bgFit == 1) { quadPx(Rc{ d.x + (d.w - bw) / 2, d.y + (d.h - bh) / 2, bw, bh }, 0, 0, 1, 1, b.srv.Get(), alpha, b.opaque, m, rot); }
        else { const float fu = (float)(d.w / bw), fv = (float)(d.h / bh); quadPx(d, 0.5f - fu / 2, 0.5f - fv / 2, 0.5f + fu / 2, 0.5f + fv / 2, b.srv.Get(), alpha, b.opaque, m, rot); }
      } else fillPx(d, 0.063f, 0.094f, 0.125f, alpha, m, rot);
    }
  }
  setFx(fx, sg, sg != nullptr, false, 0, v.w, v.h);
  quadFx(d, u0, v0, u1, v1, v.srv.Get(), sg ? sg->srv.Get() : nullptr, alpha, v.opaque, m, rot, v.pm);
}
struct LayerN {
  std::string src, lab; double x = 0, y = 0, w = 1, h = 1, zoom = 1, px = 0, py = 0, cl = 0, cr = 0, ct = 0, cb = 0, op = 1, rad = 0, bw = 0, sh = 0, lx = 0, ly = 0, lw = 0, lh = 0, rot = 0;
  int fit = 0; bool flip = false, hasBc = false, hasBg = false; float bc[3] = { 1, 1, 1 }, bg[3] = { 0, 0, 0 };
};
struct CompN { std::string base, fg; int baseFit = 1; double dim = 0; std::vector<LayerN> L; };
static std::map<std::string, CompN> g_comp;
static void drawComp(const std::string& id, const Rc& box, float alpha, const Mask& m, int depth);
static void drawView(const std::string& id, const Rc& box, int fit, double zoom, double px, double py, double cl, double cr, double ct, double cb, bool flip, float alpha, const Mask& m, int depth, double rot) {
  if (id.empty() || id == "-" || alpha <= 0 || depth > 4) return;
  if (g_comp.count(id)) { drawComp(id, box, alpha, m, depth + 1); return; }
  SrcView v; if (!getSrv(id, v)) return;
  const double fw = std::max(0.02, 1 - cl - cr), fh = std::max(0.02, 1 - ct - cb), cw = v.w * fw, ch = v.h * fh;
  double sc = fit == 1 ? std::min(box.w / cw, box.h / ch) : std::max(box.w / cw, box.h / ch);
  double dw = cw * sc * zoom, dh = ch * sc * zoom;
  if (fit == 2) { dw = box.w * zoom; dh = box.h * zoom; }
  const double cx = box.x + box.w / 2 + px * box.w / 2, cy = box.y + box.h / 2 + py * box.h / 2;
  float u0 = (float)cl, u1 = (float)(1 - cr); if (flip) { std::swap(u0, u1); rot = -rot; } // cermin lalu putar (urutan kanvas)
  srcQuad(id, v, Rc{ cx - dw / 2, cy - dh / 2, dw, dh }, u0, (float)ct, u1, (float)(1 - cb), alpha, m, rot, depth);
}
// input dengan posisinya sendiri (drawInputRect): ukuran dari sumber utuh, pangkasan tetap di tempatnya, rotasi di sekitar titik pusat
static void drawInput(const std::string& id, const Rc& box, float alpha, const Mask& m, int depth) {
  if (id.empty() || id == "-" || alpha <= 0 || depth > 4) return;
  if (g_comp.count(id)) { drawComp(id, box, alpha, m, depth + 1); return; }
  auto pi = g_pos.find(id);
  if (pi == g_pos.end()) { drawView(id, box, 1, 1, 0, 0, 0, 0, 0, 0, false, alpha, m, depth); return; }
  const PosN& p = pi->second; SrcView v; if (!getSrv(id, v)) return;
  const double sc = p.fit == 0 ? std::max(box.w / v.w, box.h / v.h) : std::min(box.w / v.w, box.h / v.h);
  double dw = v.w * sc * p.zoom, dh = v.h * sc * p.zoom; if (p.fit == 2) { dw = box.w * p.zoom; dh = box.h * p.zoom; }
  const double cx = box.x + box.w / 2 + p.x * box.w / 2, cy = box.y + box.h / 2 + p.y * box.h / 2;
  const double fw = std::max(0.001, 1 - p.cl - p.cr), fh = std::max(0.001, 1 - p.ct - p.cb), rad = p.rot * 3.14159265358979 / 180;
  Rc d{ cx - dw / 2 + p.cl * dw, cy - dh / 2 + p.ct * dh, fw * dw, fh * dh };
  // rotasi kanvas berporos di (cx,cy), shader memutar di pusat kotak → geser pusat kotak mengikuti putaran
  if (rad != 0) { const double ox = d.x + d.w / 2 - cx, oy = d.y + d.h / 2 - cy, c = std::cos(rad), s = std::sin(rad); d.x = cx + ox * c - oy * s - d.w / 2; d.y = cy + ox * s + oy * c - d.h / 2; }
  srcQuad(id, v, d, (float)p.cl, (float)p.ct, (float)(1 - p.cr), (float)(1 - p.cb), alpha, m, rad, depth);
}
static void hexRgb(const std::string& h, float c[3]) { unsigned v = 0; sscanf(h.c_str(), "%x", &v); c[0] = ((v >> 16) & 255) / 255.f; c[1] = ((v >> 8) & 255) / 255.f; c[2] = (v & 255) / 255.f; }
// komposisi berlapis (Virtual Set, input dengan kotak PiP): latar → redup → kotak (bayangan, bingkai, isi, label) → latar depan
static void drawComp(const std::string& id, const Rc& box, float alpha, const Mask& m, int depth) {
  auto it = g_comp.find(id); if (it == g_comp.end() || depth > 4) return;
  const CompN& C = it->second;
  if (!C.base.empty()) { if (C.baseFit == 3) drawInput(C.base, box, alpha, m, depth); else drawView(C.base, box, C.baseFit, 1, 0, 0, 0, 0, 0, 0, false, alpha, m, depth); }
  if (C.dim > 0) fillPx(box, 0, 0, 0, (float)(std::min(0.9, C.dim) * alpha), m);
  const double k = box.w / 1920;
  for (const LayerN& l : C.L) {
    Rc r{ box.x + l.x * box.w, box.y + l.y * box.h, l.w * box.w, l.h * box.h }; if (r.w <= 0 || r.h <= 0) continue;
    const double rad = l.rad * std::min(r.w, r.h) / 2, b = l.bw * k; const float a = (float)(alpha * std::max(0.0, std::min(1.0, l.op)));
    if (l.sh > 0) { Rc s{ r.x - b, r.y - b + 14 * k * l.sh, r.w + 2 * b, r.h + 2 * b }; for (int q = 3; q >= 1; q--) { double e = q * 10 * k * l.sh; Rc s2{ s.x - e, s.y - e, s.w + 2 * e, s.h + 2 * e }; fillPx(s2, 0, 0, 0, a * 0.12f, Mask{ true, s2, rad + b + e }); } }
    if (b > 0) { Rc o{ r.x - b, r.y - b, r.w + 2 * b, r.h + 2 * b }; fillPx(o, l.bc[0], l.bc[1], l.bc[2], a, Mask{ true, o, rad + b }); }
    if (l.hasBg) fillPx(r, l.bg[0], l.bg[1], l.bg[2], a, Mask{ true, r, rad });
    if (l.fit == 3) drawInput(l.src, r, a, Mask{ true, r, rad }, depth + 1); // kotak lama: ikut posisi input sumber
    else drawView(l.src, r, l.fit, l.zoom, l.px, l.py, l.cl, l.cr, l.ct, l.cb, l.flip, a, Mask{ true, r, rad }, depth, l.rot * 3.14159265358979 / 180);
    if (!l.lab.empty() && l.lw > 0) drawView(l.lab, Rc{ box.x + l.lx * box.w, box.y + l.ly * box.h, l.lw * box.w, l.lh * box.h }, 2, 1, 0, 0, 0, 0, 0, 0, false, a, Mask{}, depth);
  }
  if (!C.fg.empty()) drawView(C.fg, box, 2, 1, 0, 0, 0, 0, 0, 0, false, alpha, m, depth);
}
static void drawSource(const std::string& id, float alpha) {
  if (id.empty() || id == "-" || alpha <= 0) return;
  drawInput(id, Rc{ 0, 0, (double)g_W, (double)g_H }, alpha, Mask{}, 0);
}
// sumber penuh dengan transformasi global (= full(ctx, inp, alpha, tf) di engine.js)
static void drawFull(const std::string& id, float alpha, const Aff& tf) { const Aff old = g_G; g_G = tf; drawSource(id, alpha); g_G = old; }
static void clipRect(double x0, double y0, double x1, double y1) { g_clipMode = 1; g_clipP[0] = (float)x0; g_clipP[1] = (float)y0; g_clipP[2] = (float)x1; g_clipP[3] = (float)y1; }
static void clipOff() { g_clipMode = 0; }
// overlay (Fase 7/8): input penuh di atas Program dengan transparansi / geser / sapuan / zoom
struct OvlN { std::string src; double a = 1, dx = 0, dy = 0, clip = 1, z = 1; };
static std::vector<OvlN> g_ovl;
static void drawOverlaysN() {
  for (auto& o : g_ovl) {
    if (o.clip < 0.999) clipRect(0, 0, o.clip * g_W, g_H);
    const Aff old = g_G; Aff tf = affT(o.dx * g_W, o.dy * g_H);
    if (std::fabs(o.z - 1) > 1e-4) tf = affMul(tf, affZoom(std::max(0.01, o.z), g_W / 2.0, g_H / 2.0));
    g_G = tf; drawSource(o.src, (float)o.a); g_G = old;
    clipOff();
  }
}
// ---------------------------------------------------------------- grafis UTC (Fase 2)
static double unixMs() { // = performance.timeOrigin + performance.now() di Chromium (jam dinding, ms)
  FILETIME ft; GetSystemTimePreciseAsFileTime(&ft);
  ULARGE_INTEGER u; u.LowPart = ft.dwLowDateTime; u.HighPart = ft.dwHighDateTime;
  return (double)(u.QuadPart - 116444736000000000ull) / 10000.0;
}
struct Tile { double x = 0; UINT w = 0, h = 0; ComPtr<ID3D11Texture2D> tex; ComPtr<ID3D11ShaderResourceView> srv; };
struct Ticker {
  bool valid = false; std::string id; double at = 0, vx = 0, vy = 0, vw = 0, vh = 0, w = 0, speed = 0, px0 = 0, E0 = 0;
  bool snap = false; int ntile = 0; std::vector<Tile> tiles; double cur = 0; long long f = -1; bool hasCur = false;
};
struct ULayer {
  ComPtr<ID3D11Texture2D> tex; ComPtr<ID3D11ShaderResourceView> srv; UINT w = 0, h = 0; DXGI_FORMAT fmt = DXGI_FORMAT_UNKNOWN;
  bool valid = false, readySent = false, opaque = false, pm = false;
  Ticker cur, next;
  HANDLE pend = nullptr; unsigned long long pendSeq = 0; UINT pW = 0, pH = 0; // handle terbaru yang menunggu disalin
};
static std::map<std::string, ULayer> g_ul;
static bool ulSrv(const std::string& id, SrcView& v) {
  auto it = g_ul.find(id); if (it == g_ul.end() || !it->second.valid || !it->second.srv) return false;
  v.srv = it->second.srv; v.w = it->second.w; v.h = it->second.h; v.opaque = it->second.opaque; v.pm = it->second.pm; return true;
}
static std::vector<std::string> g_ulay;
static long long g_frameNo = 0;
static unsigned long long g_utexN = 0;

static void ackHandle(const std::string& id, HANDLE h, unsigned long long seq) {
  if (h) CloseHandle(h);
  emit("uack %s %llu", id.c_str(), seq);
}
// salin semua tekstur yang menunggu (satu per lapisan), tunggu GPU selesai, baru balas → KLM boleh mengembalikan tekstur
static void flushUtex() {
  std::vector<std::pair<std::string, unsigned long long>> acks;
  ComPtr<ID3D11Device1> d1; g_dev.As(&d1);
  for (auto& kv : g_ul) {
    ULayer& L = kv.second; if (!L.pend) continue;
    HANDLE h = L.pend; unsigned long long seq = L.pendSeq; L.pend = nullptr;
    ComPtr<ID3D11Texture2D> st;
    HRESULT hr = d1 ? d1->OpenSharedResource1(h, IID_PPV_ARGS(&st)) : E_NOINTERFACE;
    CloseHandle(h);
    if (FAILED(hr) || !st) { emit("uerr %s OpenSharedResource1 0x%08lx", kv.first.c_str(), (unsigned long)hr); acks.push_back({ kv.first, seq }); continue; }
    D3D11_TEXTURE2D_DESC d{}; st->GetDesc(&d);
    if (!L.tex || L.w != d.Width || L.h != d.Height || L.fmt != d.Format) {
      D3D11_TEXTURE2D_DESC n{}; n.Width = d.Width; n.Height = d.Height; n.MipLevels = 1; n.ArraySize = 1; n.Format = d.Format;
      n.SampleDesc.Count = 1; n.Usage = D3D11_USAGE_DEFAULT; n.BindFlags = D3D11_BIND_SHADER_RESOURCE;
      L.tex.Reset(); L.srv.Reset();
      if (FAILED(g_dev->CreateTexture2D(&n, nullptr, &L.tex)) || FAILED(g_dev->CreateShaderResourceView(L.tex.Get(), nullptr, &L.srv))) {
        emit("uerr %s tekstur lapisan (format %d)", kv.first.c_str(), (int)d.Format); L.tex.Reset(); acks.push_back({ kv.first, seq }); continue;
      }
      L.w = d.Width; L.h = d.Height; L.fmt = d.Format;
    }
    ComPtr<IDXGIKeyedMutex> km; bool locked = false;
    if (SUCCEEDED(st.As(&km)) && km) locked = km->AcquireSync(0, 8) == S_OK;
    g_ctx->CopyResource(L.tex.Get(), st.Get());
    if (locked) km->ReleaseSync(0);
    L.valid = true; g_utexN++;
    if (!L.readySent) { L.readySent = true; emit("uready %s", kv.first.c_str()); }
    acks.push_back({ kv.first, seq });
  }
  if (acks.empty()) return;
  if (g_query) { // salinan GPU benar-benar selesai sebelum Chromium boleh memakai ulang teksturnya
    g_ctx->End(g_query.Get()); g_ctx->Flush();
    double t0 = nowMs();
    while (g_ctx->GetData(g_query.Get(), nullptr, 0, 0) == S_FALSE && nowMs() - t0 < 50) YieldProcessor();
  }
  for (auto& a : acks) emit("uack %s %llu", a.first.c_str(), a.second);
}
static void tileTex(Tile& t, const uint8_t* rgba) { // RGBA lurus (getImageData) → BGRA premultiplied
  std::vector<uint8_t> px((size_t)t.w * t.h * 4);
  for (size_t i = 0, n = (size_t)t.w * t.h; i < n; i++) {
    const uint8_t* s = rgba + i * 4; uint8_t* d = &px[i * 4]; unsigned a = s[3];
    d[0] = (uint8_t)((s[2] * a + 127) / 255); d[1] = (uint8_t)((s[1] * a + 127) / 255); d[2] = (uint8_t)((s[0] * a + 127) / 255); d[3] = (uint8_t)a;
  }
  makeTex(t.w, t.h, px.data(), t.tex, t.srv);
}
static double tkStep(Ticker& n, double t) { // = tkStep di utc.js: maju tepat satu langkah tiap frame, ikut jam bila meleset
  if (n.f == g_frameNo && n.hasCur) return n.cur;
  double step = n.speed / (g_fps ? g_fps : 30), ideal = n.px0 + (t - n.E0) * n.speed / 1000.0;
  if (!n.hasCur || std::fabs(ideal - (n.cur + step)) > std::max(0.6, step * 0.4)) n.cur = n.snap ? std::round(ideal) : ideal;
  else n.cur += n.snap ? std::round(step) : step;
  n.hasCur = true; n.f = g_frameNo;
  return n.cur;
}
static void quad(double x, double y, double w, double h, double sx, double sy, ID3D11ShaderResourceView* srv, float alpha) {
  float dst[4] = { (float)(x * sx / g_W * 2 - 1), (float)(1 - y * sy / g_H * 2), (float)((x + w) * sx / g_W * 2 - 1), (float)(1 - (y + h) * sy / g_H * 2) };
  float uv[4] = { 0, 0, 1, 1 }, col[4] = { 1, 1, 1, alpha }, p2[4] = { 0, 0, 1, 0 };
  setCB(dst, uv, col, p2);
  g_ctx->PSSetShaderResources(0, 1, &srv);
  g_ctx->Draw(4, 0);
}
static void drawUtc() {
  if (g_ulay.empty()) return;
  float bf[4] = { 0, 0, 0, 0 };
  g_ctx->OMSetBlendState(g_blendPM.Get(), bf, 0xffffffff);
  g_ctx->PSSetShader(g_psPM.Get(), nullptr, 0);
  double t = unixMs();
  for (auto& id : g_ulay) {
    auto it = g_ul.find(id); if (it == g_ul.end()) continue;
    ULayer& L = it->second; if (!L.valid || !L.w || !L.h) continue;
    double sx = (double)g_W / L.w, sy = (double)g_H / L.h;
    quad(0, 0, L.w, L.h, sx, sy, L.srv.Get(), 1);
    if (L.next.valid && t >= L.next.at) { L.cur = std::move(L.next); L.next = Ticker(); }
    Ticker& n = L.cur;
    if (!n.valid || t < n.at || n.w <= 0) continue;
    double off = std::fmod(tkStep(n, t), n.w); if (off < 0) off += n.w;
    D3D11_RECT sc{ (LONG)std::floor(n.vx * sx), (LONG)std::floor(n.vy * sy), (LONG)std::ceil((n.vx + n.vw) * sx), (LONG)std::ceil((n.vy + n.vh) * sy) };
    g_ctx->RSSetState(g_rastSc.Get()); g_ctx->RSSetScissorRects(1, &sc);
    for (double base = n.vx - off; base < n.vx + n.vw; base += n.w)
      for (auto& tl : n.tiles) {
        double x = base + tl.x;
        if (!tl.srv || x > n.vx + n.vw || x + tl.w < n.vx) continue;
        quad(x, n.vy, tl.w, tl.h, sx, sy, tl.srv.Get(), 1);
      }
    g_ctx->RSSetState(g_rast.Get());
  }
  g_ctx->OMSetBlendState(g_blend.Get(), bf, 0xffffffff);
}
// ---- kamera: pola uji + ekspor frame ke KLM (tekstur NT bersama, alpha dipaksa buram)
static void camTick() {
  ComPtr<ID3D11DeviceContext1> c1; g_ctx.As(&c1);
  for (auto& kv : g_cams) {
    Cam& c = *kv.second; if (!c.test) continue;
    std::lock_guard<std::mutex> l(c.mx); if (!c.rtv) continue;
    float bg[4] = { 32 / 255.f, 160 / 255.f, 224 / 255.f, 1 }; g_ctx->ClearRenderTargetView(c.rtv.Get(), bg);
    if (c1) { LONG x = (LONG)((g_frameNo * 8) % c.w); D3D11_RECT r{ x, 0, x + 40, (LONG)c.h }; float wh[4] = { 1, 1, 1, 1 }; c1->ClearView(c.rtv.Get(), wh, &r, 1); }
    c.got = true; c.fresh = true; c.frames++;
  }
  std::vector<std::string> evs;
  for (auto& kv : g_cams) {
    Cam& c = *kv.second; if (!c.exp || !c.fresh) continue;
    ComPtr<ID3D11ShaderResourceView> srv; UINT cw = 0, ch = 0;
    { std::lock_guard<std::mutex> l(c.mx); if (!c.got || !c.srv) continue; srv = c.srv; cw = c.w; ch = c.h; }
    c.fresh = false;
    if (c.rw != cw || c.rh != ch || !c.ring[0].tex) {
      for (auto& sl : c.ring) { if (sl.h) CloseHandle(sl.h); sl = Cam::Slot(); }
      c.gen++; c.rw = cw; c.rh = ch;
      for (int i = 0; i < 3; i++) {
        D3D11_TEXTURE2D_DESC d{}; d.Width = cw; d.Height = ch; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1;
        d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET; d.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
        auto& sl = c.ring[i]; ComPtr<IDXGIResource1> r1;
        if (FAILED(g_dev->CreateTexture2D(&d, nullptr, &sl.tex)) || FAILED(g_dev->CreateRenderTargetView(sl.tex.Get(), nullptr, &sl.rtv)) || FAILED(sl.tex.As(&r1)) ||
            FAILED(r1->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &sl.h))) {
          emit("camerr %s tekstur bersama tidak didukung GPU ini", kv.first.c_str()); c.exp = false; break;
        }
        emit("cbuf %s %d %d %llu %u %u", kv.first.c_str(), c.gen, i, (unsigned long long)(uintptr_t)sl.h, cw, ch);
      }
      if (!c.exp) continue;
    }
    int slot = -1; for (int i = 0; i < 3; i++) if (!c.ring[i].busy) { slot = i; break; }
    if (slot < 0) continue; // KLM masih memegang ketiganya → frame ini dilewati (tidak menumpuk)
    auto& sl = c.ring[slot];
    ID3D11ShaderResourceView* none = nullptr; g_ctx->PSSetShaderResources(0, 1, &none);
    g_ctx->OMSetRenderTargets(1, sl.rtv.GetAddressOf(), nullptr); viewport(cw, ch);
    float dst[4] = { -1, 1, 1, -1 }, uv[4] = { 0, 0, 1, 1 }, col[4] = { 1, 1, 1, 1 }, p2[4] = { 0, 0, 1, 0 };
    setCB(dst, uv, col, p2);
    g_ctx->PSSetShader(g_psOpaque.Get(), nullptr, 0);
    g_ctx->PSSetShaderResources(0, 1, srv.GetAddressOf());
    g_ctx->Draw(4, 0);
    sl.busy = true; c.seq++;
    char b[160]; snprintf(b, sizeof b, "cfr %s %d %d %llu", kv.first.c_str(), c.gen, slot, c.seq); evs.push_back(b);
  }
  if (evs.empty()) return;
  if (g_query) { g_ctx->End(g_query.Get()); g_ctx->Flush(); double t0 = nowMs(); while (g_ctx->GetData(g_query.Get(), nullptr, 0, 0) == S_FALSE && nowMs() - t0 < 50) YieldProcessor(); }
  for (auto& e : evs) emit("%s", e.c_str());
}
// ---- KLMCAM: dekoder H.264 (Fase 4a)
struct KDec {
  std::string id; std::shared_ptr<Cam> cam;
  struct QF { std::vector<uint8_t> d; LONGLONG ts = 0; double at = 0; };
  std::mutex qmx; std::condition_variable cv; std::deque<QF> q; std::atomic<bool> stop{ false };
  ComPtr<IMFTransform> mft; bool d3d = false, provides = false, started = false, okSent = false; DWORD cb = 0;
  UINT cw = 0, ch = 0, dw = 0, dh = 0; LONG stride = 0; bool hd = true;
  ComPtr<ID3D11VideoDevice> vdev; ComPtr<ID3D11VideoContext> vctx;
  ComPtr<ID3D11VideoProcessorEnumerator> ven; ComPtr<ID3D11VideoProcessor> vp; ComPtr<ID3D11VideoProcessorOutputView> ov;
  UINT vpInW = 0, vpInH = 0; ID3D11Texture2D* ovTex = nullptr;
  std::map<std::pair<ID3D11Texture2D*, UINT>, ComPtr<ID3D11VideoProcessorInputView>> iv;
  ComPtr<ID3D11Texture2D> nv12; // jalur CPU
  int errs = 0; bool waitKey = false;
  // urutan frame H.264 (frame_num) — frame hilang / terlambat → tunggu frame kunci, tidak pernah mendekode di atas referensi yang hilang (= bercak)
  int log2MaxFn = 0; bool sepColour = false; int prevRefFn = -1; int gaps = 0, drops = 0;
  // jadwal tayang (jitter buffer kecil): frame terdekode masuk cincin, ditayangkan menurut cap waktu RTP → gerakan rata
  struct Slot { ComPtr<ID3D11Texture2D> t; ComPtr<ID3D11VideoProcessorOutputView> ov; double due = 0; LONGLONG ts = 0; int st = 0; }; // st: 0 kosong, 1 siap
  std::mutex smx; Slot slot[6]; UINT slotW = 0, slotH = 0; std::map<LONGLONG, double> arr;
  double base = 1e18, jit = 8, lastArr = 0; LONGLONG lastTs = -1; double lastDue = 0, shownDue = 0; int late = 0;
};
static std::map<std::string, std::shared_ptr<KDec>> g_kdec;
static bool kSetOutput(KDec& k) {
  for (DWORD i = 0;; i++) {
    ComPtr<IMFMediaType> t; if (FAILED(k.mft->GetOutputAvailableType(0, i, &t))) return false;
    GUID sub{}; t->GetGUID(MF_MT_SUBTYPE, &sub);
    if (sub != MFVideoFormat_NV12) continue;
    if (FAILED(k.mft->SetOutputType(0, t.Get(), 0))) return false;
    UINT32 w = 0, h = 0; MFGetAttributeSize(t.Get(), MF_MT_FRAME_SIZE, &w, &h); k.cw = w; k.ch = h; k.dw = w; k.dh = h;
    MFVideoArea ap{}; UINT32 sz = 0;
    if (SUCCEEDED(t->GetBlob(MF_MT_MINIMUM_DISPLAY_APERTURE, (UINT8*)&ap, sizeof ap, &sz)) && ap.Area.cx > 0 && ap.Area.cy > 0) { k.dw = (UINT)ap.Area.cx; k.dh = (UINT)ap.Area.cy; }
    UINT32 st = 0; k.stride = SUCCEEDED(t->GetUINT32(MF_MT_DEFAULT_STRIDE, &st)) ? (LONG)st : (LONG)w;
    k.hd = k.dh >= 600;
    MFT_OUTPUT_STREAM_INFO si{}; k.mft->GetOutputStreamInfo(0, &si);
    k.provides = (si.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES) != 0; k.cb = si.cbSize;
    k.iv.clear(); k.nv12.Reset();
    return true;
  }
}
static bool kInit(KDec& k) {
  if (!initMF()) return false;
  HRESULT hr = CoCreateInstance(CLSID_CMSH264DecoderMFT, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&k.mft));
  if (FAILED(hr)) { emit("kerr %s dekoder H.264 Windows tidak ada (0x%08lx)", k.id.c_str(), (unsigned long)hr); return false; }
  ComPtr<IMFAttributes> a;
  if (SUCCEEDED(k.mft->GetAttributes(&a)) && a) { a->SetUINT32(CODECAPI_AVLowLatencyMode, TRUE); a->SetUINT32(MF_LOW_LATENCY, TRUE); }
  g_dev.As(&k.vdev); g_ctx.As(&k.vctx);
  if (!k.vdev || !k.vctx) { k.vdev.Reset(); k.vctx.Reset(); emit("kinfo %s GPU tanpa D3D11 Video Processor — konversi warna di CPU", k.id.c_str()); }
  if (g_mfMgr && k.vdev) k.d3d = SUCCEEDED(k.mft->ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, (ULONG_PTR)g_mfMgr.Get()));
  ComPtr<IMFMediaType> in; MFCreateMediaType(&in);
  in->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); in->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
  in->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  if (FAILED(hr = k.mft->SetInputType(0, in.Get(), 0))) { emit("kerr %s SetInputType 0x%08lx", k.id.c_str(), (unsigned long)hr); return false; }
  kSetOutput(k);
  k.mft->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0); k.mft->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
  k.started = true;
  return true;
}
// cincin frame terdekode (BGRA, ukuran tampilan) — ditulis thread dekoder, ditayangkan thread gambar (kPresent)
static bool kSlots(KDec& k) { // dipanggil dengan k.smx terkunci
  if (k.slotW == k.dw && k.slotH == k.dh && k.slot[0].t) return true;
  for (auto& s : k.slot) { s.t.Reset(); s.ov.Reset(); s.st = 0; }
  D3D11_TEXTURE2D_DESC d{}; d.Width = k.dw; d.Height = k.dh; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1;
  d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
  for (auto& s : k.slot) if (FAILED(g_dev->CreateTexture2D(&d, nullptr, &s.t))) return false;
  k.slotW = k.dw; k.slotH = k.dh; k.vp.Reset(); return true;
}
// pilih slot untuk frame baru: kosong, atau yang paling tua (frame itu dilewati)
static int kSlotFree(KDec& k) {
  int best = -1; LONGLONG bt = 0;
  for (int i = 0; i < 6; i++) { if (k.slot[i].st == 0) return i; if (best < 0 || k.slot[i].ts < bt) { best = i; bt = k.slot[i].ts; } }
  return best;
}
// jadwal tayang frame: waktu tiba vs cap waktu RTP → jeda adaptif sekecil mungkin yang tetap menyerap jitter jaringan
static double kSchedule(KDec& k, LONGLONG ts, double at) {
  const double m = ts / 10000.0, d = at - m;
  if (k.lastTs < 0 || ts < k.lastTs - 900000000LL || ts > k.lastTs + 900000000LL) { k.base = d; k.jit = 8; } // awal / lompatan cap waktu (HP menyambung ulang)
  if (d < k.base || d - k.base > 1000) k.base = d; else k.base += (d - k.base) * 0.002; // dasar = jalur tercepat, pelan-pelan mengikuti selisih jam (jeda >1 dtk = mulai ulang)
  k.jit = k.jit * 0.96 + (d - k.base) * 0.04;
  k.lastTs = ts;
  const double delay = std::min(120.0, std::max(12.0, k.jit * 2.2 + 6));
  return m + k.base + delay;
}
// NV12 (tekstur dekoder / tekstur CPU) → BGRA slot cincin, dengan D3D11 Video Processor (GPU)
static bool kBlit(KDec& k, ID3D11Texture2D* src, UINT sub, LONGLONG ts, double due) {
  std::lock_guard<std::mutex> l(k.smx);
  if (!kSlots(k)) return false;
  const int si = kSlotFree(k); KDec::Slot& S = k.slot[si];
  D3D11_TEXTURE2D_DESC sd{}; src->GetDesc(&sd);
  if (!k.vp || k.vpInW != sd.Width || k.vpInH != sd.Height) {
    k.vp.Reset(); k.ven.Reset(); k.iv.clear(); for (auto& s : k.slot) s.ov.Reset();
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC cd{}; cd.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
    cd.InputWidth = sd.Width; cd.InputHeight = sd.Height; cd.OutputWidth = k.dw; cd.OutputHeight = k.dh; cd.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
    cd.InputFrameRate = { 30, 1 }; cd.OutputFrameRate = { 30, 1 };
    if (FAILED(k.vdev->CreateVideoProcessorEnumerator(&cd, &k.ven)) || FAILED(k.vdev->CreateVideoProcessor(k.ven.Get(), 0, &k.vp))) { emit("kerr %s Video Processor tidak tersedia", k.id.c_str()); return false; }
    k.vpInW = sd.Width; k.vpInH = sd.Height;
    D3D11_VIDEO_PROCESSOR_COLOR_SPACE in{}; in.YCbCr_Matrix = k.hd ? 1 : 0; in.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235;
    D3D11_VIDEO_PROCESSOR_COLOR_SPACE out{}; out.RGB_Range = 0; out.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_0_255;
    k.vctx->VideoProcessorSetStreamColorSpace(k.vp.Get(), 0, &in);
    k.vctx->VideoProcessorSetOutputColorSpace(k.vp.Get(), &out);
    k.vctx->VideoProcessorSetStreamFrameFormat(k.vp.Get(), 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
    RECT sr{ 0, 0, (LONG)k.dw, (LONG)k.dh }; // buang bantalan (1080 dari 1088)
    k.vctx->VideoProcessorSetStreamSourceRect(k.vp.Get(), 0, TRUE, &sr);
    k.vctx->VideoProcessorSetStreamAutoProcessingMode(k.vp.Get(), 0, FALSE);
  }
  if (!S.ov) {
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC od{}; od.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
    if (FAILED(k.vdev->CreateVideoProcessorOutputView(S.t.Get(), k.ven.Get(), &od, &S.ov))) { emit("kerr %s output view", k.id.c_str()); return false; }
  }
  auto key = std::make_pair(src, sub);
  auto it = k.iv.find(key);
  if (it == k.iv.end()) {
    if (k.iv.size() > 64) k.iv.clear();
    D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC idd{}; idd.ViewDimension = D3D11_VPIV_DIMENSION_TEXTURE2D; idd.Texture2D.ArraySlice = sub;
    ComPtr<ID3D11VideoProcessorInputView> v;
    if (FAILED(k.vdev->CreateVideoProcessorInputView(src, k.ven.Get(), &idd, &v))) { emit("kerr %s input view", k.id.c_str()); return false; }
    it = k.iv.emplace(key, v).first;
  }
  D3D11_VIDEO_PROCESSOR_STREAM st{}; st.Enable = TRUE; st.pInputSurface = it->second.Get();
  if (FAILED(k.vctx->VideoProcessorBlt(k.vp.Get(), S.ov.Get(), 0, 1, &st))) return false;
  S.st = 1; S.ts = ts; S.due = due;
  return true;
}
static bool kPut(KDec& k, const void* px, UINT pitch, LONGLONG ts, double due) { // jalur CPU (tanpa Video Processor)
  std::lock_guard<std::mutex> l(k.smx);
  if (!kSlots(k)) return false;
  const int si = kSlotFree(k); KDec::Slot& S = k.slot[si];
  g_ctx->UpdateSubresource(S.t.Get(), 0, nullptr, px, pitch, 0);
  S.st = 1; S.ts = ts; S.due = due; return true;
}
static void kDeliver(KDec& k, IMFSample* smp) {
  ComPtr<IMFMediaBuffer> mb; if (FAILED(smp->GetBufferByIndex(0, &mb))) return;
  LONGLONG ts = 0; smp->GetSampleTime(&ts);
  double at = nowMs(); { auto ai = k.arr.find(ts); if (ai != k.arr.end()) { at = ai->second; k.arr.erase(k.arr.begin(), std::next(ai)); } }
  if (k.arr.size() > 64) k.arr.clear();
  const double due = kSchedule(k, ts, at);
  bool ok = false;
  ComPtr<IMFDXGIBuffer> db;
  if (SUCCEEDED(mb.As(&db))) {
    ComPtr<ID3D11Texture2D> t; UINT sub = 0;
    if (SUCCEEDED(db->GetResource(IID_PPV_ARGS(&t))) && SUCCEEDED(db->GetSubresourceIndex(&sub))) ok = kBlit(k, t.Get(), sub, ts, due);
  } else if (!k.vdev) { // GPU tanpa Video Processor (mis. WARP): konversi NV12 → BGRA di CPU (jalur darurat)
    BYTE* p = nullptr; LONG pitch = 0; DWORD mx = 0, cur = 0; ComPtr<IMF2DBuffer> b2; bool l2 = false;
    if (SUCCEEDED(mb.As(&b2)) && SUCCEEDED(b2->Lock2D(&p, &pitch))) l2 = true;
    else if (SUCCEEDED(mb->Lock(&p, &mx, &cur))) pitch = k.stride ? k.stride : (LONG)k.cw;
    else return;
    if (pitch > 0 && (l2 || cur >= (DWORD)(pitch * k.ch * 3 / 2))) {
      const UINT W = k.dw & ~1u, H = k.dh & ~1u; std::vector<uint32_t> px((size_t)k.dw * k.dh, 0xFF000000u);
      const BYTE* yp = p; const BYTE* uvp = p + (size_t)pitch * k.ch;
      const double kr = k.hd ? 0.2126 : 0.299, kb = k.hd ? 0.0722 : 0.114, kg = 1 - kr - kb;
      for (UINT y = 0; y < H; y++) for (UINT x = 0; x < W; x++) {
        double Y = (yp[(size_t)y * pitch + x] - 16) * (255.0 / 219), U = (uvp[(size_t)(y / 2) * pitch + (x & ~1u)] - 128) * (255.0 / 224), V = (uvp[(size_t)(y / 2) * pitch + (x & ~1u) + 1] - 128) * (255.0 / 224);
        double R = Y + 2 * (1 - kr) * V, B = Y + 2 * (1 - kb) * U, G = (Y - kr * R - kb * B) / kg;
        auto c8 = [](double v) { return (uint32_t)(v < 0 ? 0 : v > 255 ? 255 : std::lround(v)); };
        px[(size_t)y * k.dw + x] = 0xFF000000u | (c8(R) << 16) | (c8(G) << 8) | c8(B);
      }
      ok = kPut(k, px.data(), k.dw * 4, ts, due);
    }
    if (l2) b2->Unlock2D(); else mb->Unlock();
  } else { // dekoder perangkat lunak: NV12 di memori → tekstur NV12 → Video Processor
    BYTE* p = nullptr; LONG pitch = 0; DWORD mx = 0, cur = 0; ComPtr<IMF2DBuffer> b2; bool l2 = false;
    if (SUCCEEDED(mb.As(&b2)) && SUCCEEDED(b2->Lock2D(&p, &pitch))) l2 = true;
    else if (SUCCEEDED(mb->Lock(&p, &mx, &cur))) pitch = k.stride ? k.stride : (LONG)k.cw;
    else return;
    if (!k.nv12) {
      D3D11_TEXTURE2D_DESC d{}; d.Width = k.cw & ~1u; d.Height = k.ch & ~1u; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_NV12; d.SampleDesc.Count = 1;
      d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE;
      if (FAILED(g_dev->CreateTexture2D(&d, nullptr, &k.nv12))) { emit("kerr %s tekstur NV12 tidak didukung", k.id.c_str()); }
    }
    if (k.nv12 && pitch > 0) {
      // bidang Y lalu UV berurutan (tinggi buffer = tinggi kode)
      std::vector<uint8_t> tmp((size_t)pitch * k.ch * 3 / 2);
      memcpy(tmp.data(), p, std::min<size_t>(tmp.size(), l2 ? tmp.size() : (size_t)cur));
      g_ctx->UpdateSubresource(k.nv12.Get(), 0, nullptr, tmp.data(), (UINT)pitch, 0);
      ok = kBlit(k, k.nv12.Get(), 0, ts, due);
    }
    if (l2) b2->Unlock2D(); else mb->Unlock();
  }
  if (!ok) return;
  if (!k.okSent) { k.okSent = true; emit("kok %s %u %u %d", k.id.c_str(), k.dw, k.dh, k.d3d ? 1 : 0); }
}
// thread gambar, tiap frame: tayangkan frame terbaru yang sudah jatuh tempo (yang lebih tua dilewati, bukan menumpuk jeda)
static void kPresentAll(double now) {
  for (auto& kv : g_kdec) {
    KDec& k = *kv.second; if (k.stop || !k.cam) continue;
    std::lock_guard<std::mutex> l(k.smx);
    int pick = -1, ready = 0; double oldest = 1e18;
    for (int i = 0; i < 6; i++) if (k.slot[i].st == 1) { ready++; oldest = std::min(oldest, k.slot[i].due); if (k.slot[i].due <= now && (pick < 0 || k.slot[i].ts > k.slot[pick].ts)) pick = i; }
    // antrean menumpuk (jam HP/PC bergeser, atau tab sempat tertahan) → jangan menunggu lebih dari ±150 ms
    if (pick < 0 && ready >= 4 && now - oldest > -150) for (int i = 0; i < 6; i++) if (k.slot[i].st == 1 && (pick < 0 || k.slot[i].ts < k.slot[pick].ts)) pick = i;
    if (pick < 0) continue;
    const LONGLONG pts = k.slot[pick].ts;
    { Cam& c = *k.cam; std::lock_guard<std::mutex> lc(c.mx);
      if (camTex(c, k.slotW, k.slotH, DXGI_FORMAT_B8G8R8A8_UNORM, true)) { g_ctx->CopyResource(c.tex.Get(), k.slot[pick].t.Get()); c.got = true; } }
    for (int i = 0; i < 6; i++) if (k.slot[i].st == 1 && k.slot[i].ts <= pts) k.slot[i].st = 0;
    k.cam->fresh = true; k.cam->frames++;
  }
}
static void kDrain(KDec& k) {
  for (int guard = 0; guard < 16; guard++) {
    MFT_OUTPUT_DATA_BUFFER ob{}; ComPtr<IMFSample> own;
    if (!k.provides) {
      MFCreateSample(&own); ComPtr<IMFMediaBuffer> b;
      MFCreateMemoryBuffer(k.cb ? k.cb : (DWORD)(k.cw * k.ch * 3 / 2 + 4096), &b); own->AddBuffer(b.Get()); ob.pSample = own.Get();
    }
    DWORD st = 0; HRESULT hr = k.mft->ProcessOutput(0, 1, &ob, &st);
    if (ob.pEvents) ob.pEvents->Release();
    if (hr == MF_E_TRANSFORM_NEED_MORE_INPUT) break;
    if (hr == MF_E_TRANSFORM_STREAM_CHANGE) { kSetOutput(k); continue; }
    if (FAILED(hr)) { if (++k.errs < 4) emit("kerr %s ProcessOutput 0x%08lx", k.id.c_str(), (unsigned long)hr); break; }
    if (ob.pSample) kDeliver(k, ob.pSample);
    if (k.provides && ob.pSample) ob.pSample->Release();
  }
}
static void kThread(std::shared_ptr<KDec> k) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (!kInit(*k)) { k->stop = true; CoUninitialize(); return; }
  while (!k->stop) {
    KDec::QF f;
    {
      std::unique_lock<std::mutex> l(k->qmx);
      k->cv.wait(l, [&] { return k->stop || !k->q.empty(); });
      if (k->stop) break;
      // tertinggal (GPU sibuk): buang sampai frame kunci terakhir tidak bisa di sini (butuh urutan) → antrean dibatasi di pengirim
      f = std::move(k->q.front()); k->q.pop_front();
    }
    ComPtr<IMFSample> s; ComPtr<IMFMediaBuffer> b;
    if (FAILED(MFCreateSample(&s)) || FAILED(MFCreateMemoryBuffer((DWORD)f.d.size(), &b))) continue;
    BYTE* p = nullptr; b->Lock(&p, nullptr, nullptr); memcpy(p, f.d.data(), f.d.size()); b->Unlock(); b->SetCurrentLength((DWORD)f.d.size());
    s->AddBuffer(b.Get()); s->SetSampleTime(f.ts); s->SetSampleDuration(333333);
    k->arr[f.ts] = f.at;
    HRESULT hr = k->mft->ProcessInput(0, s.Get(), 0);
    if (hr == MF_E_NOTACCEPTING) { kDrain(*k); hr = k->mft->ProcessInput(0, s.Get(), 0); }
    kDrain(*k);
  }
  if (k->mft) { k->mft->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0); k->mft->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0); }
  k->iv.clear(); k->ov.Reset(); k->vp.Reset(); k->ven.Reset(); k->mft.Reset();
  { std::lock_guard<std::mutex> l(k->smx); for (auto& sl : k->slot) { sl.ov.Reset(); sl.t.Reset(); sl.st = 0; } }
  CoUninitialize();
}
static void kOff(const std::string& id) {
  auto it = g_kdec.find(id); if (it == g_kdec.end()) return;
  { std::lock_guard<std::mutex> l(it->second->qmx); it->second->stop = true; } it->second->cv.notify_all();
  g_kdec.erase(it); g_cams.erase(id);
}
static std::map<std::string, double> g_kneed;
static void kNeedKey(const std::string& id) { // minta HP mengirim frame kunci (lewat KLM → WebRTC), maksimal 1×/detik
  double t = nowMs(); double& last = g_kneed[id];
  if (t - last > 1000) { last = t; emit("kneedkey %s", id.c_str()); }
}
// ---- pembaca header H.264 (cukup untuk frame_num): urutan frame referensi dicek sebelum didekode
struct BitR { std::vector<uint8_t> b; size_t p = 0; bool bad = false;
  BitR(const uint8_t* d, size_t n) { b.reserve(std::min<size_t>(n, 96)); int z = 0; for (size_t i = 0; i < n && b.size() < 96; i++) { if (z >= 2 && d[i] == 3) { z = 0; continue; } z = d[i] == 0 ? z + 1 : 0; b.push_back(d[i]); } } // buang byte pencegah emulasi
  unsigned u(int n) { unsigned v = 0; while (n--) { if (p >= b.size() * 8) { bad = true; return v; } v = (v << 1) | ((b[p >> 3] >> (7 - (p & 7))) & 1); p++; } return v; }
  unsigned ue() { int z = 0; while (!u(1)) { if (++z > 31 || bad) { bad = true; return 0; } } return z ? ((1u << z) - 1 + u(z)) : 0; }
  int se() { unsigned v = ue(); return (v & 1) ? (int)((v + 1) / 2) : -(int)(v / 2); }
};
static void kParseSps(KDec& k, const uint8_t* d, size_t n) {
  BitR r(d, n); const unsigned prof = r.u(8); r.u(16); r.ue();
  if (prof == 100 || prof == 110 || prof == 122 || prof == 244 || prof == 44 || prof == 83 || prof == 86 || prof == 118 || prof == 128 || prof == 138 || prof == 139 || prof == 134 || prof == 135) {
    const unsigned cf = r.ue(); if (cf == 3) k.sepColour = r.u(1) != 0; r.ue(); r.ue(); r.u(1);
    if (r.u(1)) for (int i = 0; i < (cf != 3 ? 8 : 12); i++) if (r.u(1)) { int last = 8, next = 8; const int sz = i < 6 ? 16 : 64; for (int j = 0; j < sz; j++) { if (next) next = (last + r.se() + 256) % 256; last = next ? next : last; } }
  }
  const unsigned l = r.ue() + 4; if (!r.bad && l >= 4 && l <= 16) k.log2MaxFn = (int)l;
}
// isi satu frame (Annex B): frame_num & jenis slice pertama. kembali false bila tidak terbaca (pemeriksaan dilewati)
static bool kParseAU(KDec& k, const std::vector<uint8_t>& d, int& fn, bool& idr, bool& ref) {
  fn = -1; idr = false; ref = false; bool got = false;
  for (size_t i = 0; i + 3 < d.size(); ) {
    size_t sc = 0;
    if (d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 1) sc = 3; else if (i + 4 < d.size() && d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 0 && d[i + 3] == 1) sc = 4;
    if (!sc) { i++; continue; }
    const size_t s0 = i + sc; if (s0 >= d.size()) break;
    size_t e = s0 + 1; while (e + 2 < d.size() && !(d[e] == 0 && d[e + 1] == 0 && (d[e + 2] == 1 || (d[e + 2] == 0 && e + 3 < d.size() && d[e + 3] == 1)))) e++;
    if (e + 2 >= d.size()) e = d.size();
    const uint8_t h = d[s0]; const int t = h & 31;
    if (t == 7) kParseSps(k, d.data() + s0 + 1, e - s0 - 1);
    else if ((t == 1 || t == 5) && !got && k.log2MaxFn) {
      BitR r(d.data() + s0 + 1, std::min<size_t>(e - s0 - 1, 48)); r.ue(); r.ue(); r.ue(); if (k.sepColour) r.u(2);
      const unsigned f = r.u(k.log2MaxFn); if (!r.bad) { fn = (int)f; idr = t == 5; ref = ((h >> 5) & 3) != 0; got = true; }
    }
    i = e;
  }
  return got;
}
static void kFeed(const std::string& id, bool key, LONGLONG ts, std::vector<uint8_t>&& data) {
  const double at = g_cmdAt > 0 ? g_cmdAt : nowMs();
  auto it = g_kdec.find(id);
  if (it == g_kdec.end()) {
    if (!key) { kNeedKey(id); return; } // mulai dari frame kunci
    auto k = std::make_shared<KDec>(); k->id = id;
    k->cam = std::make_shared<Cam>(); k->cam->id = id;
    g_cams[id] = k->cam; g_kdec[id] = k;
    std::thread(kThread, k).detach();
    it = g_kdec.find(id);
  }
  KDec& k = *it->second;
  if (k.stop) { kOff(id); return; }
  // frame hilang di jaringan / tertinggal / datang terlambat → JANGAN didekode (itulah sumber bercak): tunggu frame kunci baru
  int fn = -1; bool idr = false, ref = false; const bool parsed = kParseAU(k, data, fn, idr, ref);
  if (parsed) {
    const int mx = 1 << k.log2MaxFn;
    if (idr || key) { k.prevRefFn = fn; if (k.waitKey) k.gaps++; k.waitKey = false; }
    else if (k.waitKey || k.prevRefFn < 0) { k.drops++; kNeedKey(id); return; }
    else if (fn != (k.prevRefFn + 1) % mx) { k.waitKey = true; k.gaps++; k.drops++; kNeedKey(id); return; }
    else if (ref) k.prevRefFn = fn;
  }
  std::lock_guard<std::mutex> l(k.qmx);
  if (k.q.size() > 12 || (!parsed && k.waitKey)) { // dekoder tertinggal jauh → buang antrean, lanjut dari frame kunci berikutnya
    if (!key) { k.waitKey = true; kNeedKey(id); return; }
    k.q.clear(); k.waitKey = false;
  }
  KDec::QF f; f.d = std::move(data); f.ts = ts; f.at = at;
  k.q.push_back(std::move(f));
  k.cv.notify_one();
}

// ---- output native (Fase 4b) ----
struct HStream : public IStream { // IStream tulis-saja di atas HANDLE (pipa fd 3 / file) untuk sink MPEG-TS
  LONG ref = 1; HANDLE h; ULONGLONG pos = 0; bool own, errSent = false;
  HStream(HANDLE x, bool o) : h(x), own(o) {}
  virtual ~HStream() { if (own && h && h != INVALID_HANDLE_VALUE) CloseHandle(h); }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID r, void** p) override { if (r == IID_IUnknown || r == IID_IStream || r == IID_ISequentialStream) { *p = (IStream*)this; AddRef(); return S_OK; } *p = nullptr; return E_NOINTERFACE; }
  ULONG STDMETHODCALLTYPE AddRef() override { return (ULONG)InterlockedIncrement(&ref); }
  ULONG STDMETHODCALLTYPE Release() override { ULONG r = (ULONG)InterlockedDecrement(&ref); if (!r) delete this; return r; }
  HRESULT STDMETHODCALLTYPE Read(void*, ULONG, ULONG*) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE Write(const void* b, ULONG n, ULONG* w) override {
    DWORD k = 0; ULONG tot = 0; const char* c = (const char*)b;
    while (tot < n) {
      if (!WriteFile(h, c + tot, n - tot, &k, nullptr)) {
        DWORD e = GetLastError();
        if (e == ERROR_IO_PENDING) { DWORD k2 = 0; if (GetOverlappedResult(h, nullptr, &k2, TRUE)) { tot += k2; continue; } }
        if (!errSent) { errSent = true; emit("oerr - menulis aliran keluaran gagal (kode %lu)", e); }
        if (w) *w = tot; return STG_E_WRITEFAULT;
      }
      tot += k;
    }
    pos += n; if (w) *w = n; return S_OK;
  }
  HRESULT STDMETHODCALLTYPE Seek(LARGE_INTEGER m, DWORD o, ULARGE_INTEGER* np) override {
    ULONGLONG t = o == STREAM_SEEK_SET ? (ULONGLONG)m.QuadPart : o == STREAM_SEEK_CUR ? pos + m.QuadPart : pos;
    if (t != pos) return STG_E_INVALIDFUNCTION; if (np) np->QuadPart = pos; return S_OK;
  }
  HRESULT STDMETHODCALLTYPE SetSize(ULARGE_INTEGER) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE CopyTo(IStream*, ULARGE_INTEGER, ULARGE_INTEGER*, ULARGE_INTEGER*) override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE Commit(DWORD) override { return S_OK; }
  HRESULT STDMETHODCALLTYPE Revert() override { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE LockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override { return STG_E_INVALIDFUNCTION; }
  HRESULT STDMETHODCALLTYPE UnlockRegion(ULARGE_INTEGER, ULARGE_INTEGER, DWORD) override { return STG_E_INVALIDFUNCTION; }
  HRESULT STDMETHODCALLTYPE Stat(STATSTG* st, DWORD) override { memset(st, 0, sizeof *st); st->type = STGTY_STREAM; st->cbSize.QuadPart = pos; st->grfMode = STGM_WRITE; return S_OK; }
  HRESULT STDMETHODCALLTYPE Clone(IStream**) override { return E_NOTIMPL; }
};
struct Out {
  std::string id; bool ts = false, cpu = false, hw = false; std::string enc;
  ComPtr<IMFSinkWriter> sw; DWORD vs = 0, as = 0; UINT w = 0, h = 0, fps = 30;
  double t0 = 0; LONGLONG lastV = -1, aPos = 0; ULONGLONG frames = 0, skipped = 0;
  ComPtr<ID3D11Texture2D> ring[6]; ComPtr<ID3D11Texture2D> staging; int ri = 0; bool sizeWarned = false;
};
static std::map<std::string, std::unique_ptr<Out>> g_out;
static int g_avOff = 0; // ms: + audio ditunda, − video ditunda (penyelarasan suara & gambar output native)
static LONGLONG vOffT() { return g_avOff < 0 ? (LONGLONG)(-g_avOff) * 10000 : 0; }
static LONGLONG aOffT() { return g_avOff > 0 ? (LONGLONG)g_avOff * 10000 : 0; }
static HANDLE g_fd3 = INVALID_HANDLE_VALUE;
static void vSet(ICodecAPI* api, const GUID& g, ULONG v) { if (!api) return; VARIANT x; VariantInit(&x); x.vt = VT_UI4; x.ulVal = v; api->SetValue(&g, &x); }
static void vSetB(ICodecAPI* api, const GUID& g, bool v) { if (!api) return; VARIANT x; VariantInit(&x); x.vt = VT_BOOL; x.boolVal = v ? VARIANT_TRUE : VARIANT_FALSE; api->SetValue(&g, &x); }
static bool oStart(const std::string& id, bool ts, UINT W, UINT H, UINT F, UINT vk, UINT ak, bool cbr, const std::string& path, HANDLE tsHandle = INVALID_HANDLE_VALUE) {
  if (g_out.count(id)) return false;
  if (!initMF()) { emit("oerr %s Media Foundation tidak tersedia", id.c_str()); return false; }
  auto o = std::make_unique<Out>(); o->id = id; o->ts = ts; o->w = W & ~1u; o->h = H & ~1u; o->fps = F ? F : 30;
  ComPtr<ID3D11VideoDevice> vd; g_dev.As(&vd); o->cpu = !vd || !g_mfMgr; // GPU tanpa Video Processor → frame lewat memori
  ComPtr<IMFAttributes> a; MFCreateAttributes(&a, 6);
  a->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, TRUE);
  a->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE);
  if (ts) a->SetUINT32(MF_LOW_LATENCY, TRUE);
  if (!o->cpu) a->SetUnknown(MF_SINK_WRITER_D3D_MANAGER, g_mfMgr.Get());
  a->SetGUID(MF_TRANSCODE_CONTAINERTYPE, ts ? MFTranscodeContainerType_MPEG2 : MFTranscodeContainerType_FMPEG4);
  HRESULT hr;
  if (ts) {
    HANDLE h = tsHandle != INVALID_HANDLE_VALUE ? tsHandle : g_fd3;
    if (h == INVALID_HANDLE_VALUE || !h) { emit("oerr %s jalur keluaran (fd 3) tidak tersedia", id.c_str()); return false; }
    IStream* st = new HStream(h, tsHandle != INVALID_HANDLE_VALUE);
    ComPtr<IMFByteStream> bs; hr = MFCreateMFByteStreamOnStream(st, &bs); st->Release();
    if (FAILED(hr)) { emit("oerr %s byte stream 0x%08lx", id.c_str(), (unsigned long)hr); return false; }
    hr = MFCreateSinkWriterFromURL(L"klm.ts", bs.Get(), a.Get(), &o->sw);
    if (FAILED(hr)) hr = MFCreateSinkWriterFromURL(nullptr, bs.Get(), a.Get(), &o->sw);
  } else {
    std::wstring wp = widen(path); // folder rekaman belum ada (instalasi baru) → buat dulu
    for (size_t i = 3; i < wp.size(); i++) if (wp[i] == L'\\' || wp[i] == L'/') CreateDirectoryW(wp.substr(0, i).c_str(), nullptr);
    hr = MFCreateSinkWriterFromURL(wp.c_str(), nullptr, a.Get(), &o->sw);
  }
  if (FAILED(hr)) { emit("oerr %s tidak bisa membuat penulis (%s) 0x%08lx", id.c_str(), ts ? "TS" : "MP4", (unsigned long)hr); return false; }
  // video H.264
  ComPtr<IMFMediaType> vo; MFCreateMediaType(&vo);
  vo->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); vo->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264);
  vo->SetUINT32(MF_MT_AVG_BITRATE, vk * 1000); vo->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  MFSetAttributeSize(vo.Get(), MF_MT_FRAME_SIZE, o->w, o->h); MFSetAttributeRatio(vo.Get(), MF_MT_FRAME_RATE, o->fps, 1); MFSetAttributeRatio(vo.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
  vo->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High);
  if (FAILED(hr = o->sw->AddStream(vo.Get(), &o->vs))) { vo->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Main); hr = o->sw->AddStream(vo.Get(), &o->vs); }
  if (FAILED(hr)) { emit("oerr %s encoder H.264 tidak tersedia 0x%08lx", id.c_str(), (unsigned long)hr); return false; }
  ComPtr<IMFMediaType> vi; MFCreateMediaType(&vi);
  vi->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); vi->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_ARGB32);
  vi->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive); vi->SetUINT32(MF_MT_DEFAULT_STRIDE, o->w * 4);
  MFSetAttributeSize(vi.Get(), MF_MT_FRAME_SIZE, o->w, o->h); MFSetAttributeRatio(vi.Get(), MF_MT_FRAME_RATE, o->fps, 1); MFSetAttributeRatio(vi.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
  if (FAILED(hr = o->sw->SetInputMediaType(o->vs, vi.Get(), nullptr))) { vi->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32); hr = o->sw->SetInputMediaType(o->vs, vi.Get(), nullptr); }
  if (FAILED(hr)) { emit("oerr %s konversi warna ke encoder 0x%08lx", id.c_str(), (unsigned long)hr); return false; }
  { ComPtr<ICodecAPI> api; if (SUCCEEDED(o->sw->GetServiceForStream(o->vs, GUID_NULL, IID_PPV_ARGS(&api)))) {
      vSet(api.Get(), CODECAPI_AVEncCommonRateControlMode, cbr ? eAVEncCommonRateControlMode_CBR : eAVEncCommonRateControlMode_PeakConstrainedVBR);
      vSet(api.Get(), CODECAPI_AVEncCommonMeanBitRate, vk * 1000);
      if (!cbr) vSet(api.Get(), CODECAPI_AVEncCommonMaxBitRate, vk * 1500);
      vSet(api.Get(), CODECAPI_AVEncMPVGOPSize, o->fps * 2);
      if (ts) { vSetB(api.Get(), CODECAPI_AVLowLatencyMode, true); vSet(api.Get(), CODECAPI_AVEncMPVDefaultBPictureCount, 0); }
  } }
  // audio AAC
  static const UINT abps[] = { 12000, 16000, 20000, 24000 }; UINT ab = 24000; for (UINT v : abps) if (v * 8 >= ak * 1000) { ab = v; break; }
  ComPtr<IMFMediaType> ao; MFCreateMediaType(&ao);
  ao->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio); ao->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_AAC);
  ao->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, 48000); ao->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 2); ao->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
  ao->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, ab); ao->SetUINT32(MF_MT_AAC_PAYLOAD_TYPE, 0);
  if (FAILED(hr = o->sw->AddStream(ao.Get(), &o->as))) { emit("oerr %s encoder AAC 0x%08lx", id.c_str(), (unsigned long)hr); return false; }
  ComPtr<IMFMediaType> ai; MFCreateMediaType(&ai);
  ai->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio); ai->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
  ai->SetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, 48000); ai->SetUINT32(MF_MT_AUDIO_NUM_CHANNELS, 2); ai->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
  ai->SetUINT32(MF_MT_AUDIO_BLOCK_ALIGNMENT, 4); ai->SetUINT32(MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 192000);
  if (FAILED(hr = o->sw->SetInputMediaType(o->as, ai.Get(), nullptr))) { emit("oerr %s input audio 0x%08lx", id.c_str(), (unsigned long)hr); return false; }
  if (FAILED(hr = o->sw->BeginWriting())) { emit("oerr %s BeginWriting 0x%08lx", id.c_str(), (unsigned long)hr); return false; }
  // nama encoder yang benar-benar dipakai (NVENC / QuickSync / AMF / perangkat lunak)
  ComPtr<IMFSinkWriterEx> sx;
  if (SUCCEEDED(o->sw.As(&sx))) for (DWORD i = 0;; i++) {
    GUID cat{}; ComPtr<IMFTransform> t; if (FAILED(sx->GetTransformForStream(o->vs, i, &cat, &t))) break;
    if (cat != MFT_CATEGORY_VIDEO_ENCODER) continue;
    ComPtr<IMFAttributes> ta; if (SUCCEEDED(t->GetAttributes(&ta)) && ta) {
      WCHAR* nm = nullptr; UINT32 l = 0; if (SUCCEEDED(ta->GetAllocatedString(MFT_FRIENDLY_NAME_Attribute, &nm, &l))) { o->enc = narrow(nm); CoTaskMemFree(nm); }
      UINT32 dummy = 0; o->hw = SUCCEEDED(ta->GetStringLength(MFT_ENUM_HARDWARE_URL_Attribute, &dummy));
    }
    if (o->enc.empty()) o->enc = "H.264 Encoder MFT";
    break;
  }
  o->t0 = nowMs();
  emit("ostarted %s %s %d %d", id.c_str(), hexOf(o->enc).c_str(), o->hw ? 1 : 0, o->cpu ? 1 : 0);
  g_out[id] = std::move(o);
  return true;
}
static void oVideo(double now) {
  if (g_out.empty() || !g_pgm.rt) return;
  D3D11_TEXTURE2D_DESC pd{}; g_pgm.rt->GetDesc(&pd);
  for (auto it = g_out.begin(); it != g_out.end();) {
    Out& o = *it->second;
    if (pd.Width != o.w || pd.Height != o.h) { if (!o.sizeWarned) { o.sizeWarned = true; emit("oerr %s resolusi output berubah saat merekam — frame dilewati sampai kembali %ux%u", o.id.c_str(), o.w, o.h); } ++it; continue; }
    const LONGLONG dur = 10000000LL / o.fps, t = (LONGLONG)((now - o.t0) * 10000.0), tsv = (t / dur) * dur;
    if (tsv <= o.lastV) { ++it; continue; }
    if (o.lastV >= 0 && tsv - o.lastV > dur) o.skipped += (ULONGLONG)((tsv - o.lastV) / dur - 1);
    o.lastV = tsv;
    ComPtr<IMFMediaBuffer> b; HRESULT hr = E_FAIL;
    if (!o.cpu) {
      auto& tex = o.ring[o.ri++ % 6];
      if (!tex) { D3D11_TEXTURE2D_DESC d = pd; d.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET; d.MiscFlags = 0; d.CPUAccessFlags = 0; d.Usage = D3D11_USAGE_DEFAULT; g_dev->CreateTexture2D(&d, nullptr, &tex); }
      if (tex) {
        g_ctx->CopyResource(tex.Get(), g_pgm.rt.Get());
        hr = MFCreateDXGISurfaceBuffer(__uuidof(ID3D11Texture2D), tex.Get(), 0, FALSE, &b);
        ComPtr<IMF2DBuffer> b2; DWORD len = 0; if (SUCCEEDED(hr) && SUCCEEDED(b.As(&b2)) && SUCCEEDED(b2->GetContiguousLength(&len))) b->SetCurrentLength(len);
      }
    } else { // salin ke memori (GPU tanpa Video Processor)
      if (!o.staging) { D3D11_TEXTURE2D_DESC d = pd; d.Usage = D3D11_USAGE_STAGING; d.BindFlags = 0; d.CPUAccessFlags = D3D11_CPU_ACCESS_READ; d.MiscFlags = 0; g_dev->CreateTexture2D(&d, nullptr, &o.staging); }
      D3D11_MAPPED_SUBRESOURCE m;
      if (o.staging) { g_ctx->CopyResource(o.staging.Get(), g_pgm.rt.Get()); }
      if (o.staging && SUCCEEDED(g_ctx->Map(o.staging.Get(), 0, D3D11_MAP_READ, 0, &m))) {
        const DWORD n = o.w * o.h * 4;
        if (SUCCEEDED(hr = MFCreateMemoryBuffer(n, &b))) {
          BYTE* p = nullptr; b->Lock(&p, nullptr, nullptr);
          for (UINT y = 0; y < o.h; y++) memcpy(p + (size_t)y * o.w * 4, (const BYTE*)m.pData + (size_t)y * m.RowPitch, (size_t)o.w * 4);
          b->Unlock(); b->SetCurrentLength(n);
        }
        g_ctx->Unmap(o.staging.Get(), 0);
      }
    }
    if (SUCCEEDED(hr) && b) {
      ComPtr<IMFSample> sm; MFCreateSample(&sm); sm->AddBuffer(b.Get()); sm->SetSampleTime(tsv + vOffT()); sm->SetSampleDuration(dur);
      hr = o.sw->WriteSample(o.vs, sm.Get());
      if (FAILED(hr)) { emit("oerr %s menulis video 0x%08lx — output dihentikan", o.id.c_str(), (unsigned long)hr); emit("ostopped %s %llu", o.id.c_str(), o.frames); it = g_out.erase(it); continue; }
      o.frames++;
    }
    // audio sunyi bila KLM tidak mengirim audio (> 120 ms tertinggal dari jam) → aliran audio tidak pernah putus
    while (o.aPos < t - 1200000) {
      const UINT n = 960; ComPtr<IMFMediaBuffer> ab; MFCreateMemoryBuffer(n * 4, &ab); BYTE* p = nullptr; ab->Lock(&p, nullptr, nullptr); memset(p, 0, n * 4); ab->Unlock(); ab->SetCurrentLength(n * 4);
      ComPtr<IMFSample> as; MFCreateSample(&as); as->AddBuffer(ab.Get()); as->SetSampleTime(o.aPos + aOffT()); as->SetSampleDuration(200000);
      o.sw->WriteSample(o.as, as.Get()); o.aPos += 200000;
    }
    ++it;
  }
}
static void oAudio(const std::vector<uint8_t>& pcm) {
  if (g_out.empty() || pcm.size() < 4) return;
  const DWORD n = (DWORD)(pcm.size() & ~3u); const LONGLONG dur = (LONGLONG)(n / 4) * 10000000LL / 48000;
  double now = nowMs();
  for (auto& kv : g_out) {
    Out& o = *kv.second; LONGLONG t = (LONGLONG)((now - o.t0) * 10000.0);
    if (o.aPos > t + 2000000) continue;            // audio kelebihan (> 200 ms di depan jam) → buang potongan ini
    if (o.aPos < t - 2000000) o.aPos = t - 400000;  // tertinggal jauh → lompat (sisa celah diisi encoder)
    ComPtr<IMFMediaBuffer> b; if (FAILED(MFCreateMemoryBuffer(n, &b))) continue;
    BYTE* p = nullptr; b->Lock(&p, nullptr, nullptr); memcpy(p, pcm.data(), n); b->Unlock(); b->SetCurrentLength(n);
    ComPtr<IMFSample> s; MFCreateSample(&s); s->AddBuffer(b.Get()); s->SetSampleTime(o.aPos + aOffT()); s->SetSampleDuration(dur);
    o.sw->WriteSample(o.as, s.Get()); o.aPos += dur;
  }
}
static void oStop(const std::string& id) {
  auto it = g_out.find(id); if (it == g_out.end()) { emit("ostopped %s 0", id.c_str()); return; }
  Out& o = *it->second; HRESULT hr = o.sw->Finalize();
  if (FAILED(hr)) emit("oerr %s Finalize 0x%08lx", id.c_str(), (unsigned long)hr);
  emit("ostopped %s %llu %llu", id.c_str(), o.frames, o.skipped);
  g_out.erase(it);
}

static void camCommand(const std::string& c, std::istringstream& is) {
  if (c == "camlist") {
    for (auto& d : listCams()) emit("camdev %s %s", hexOf(narrow(d.name.c_str())).c_str(), hexOf(narrow(d.link.c_str())).c_str());
    emit("camdevend"); return;
  }
  std::string id; is >> id; if (id.empty() || id.size() > 64) return;
  if (c == "cam") { UINT w = 0, h = 0, f = 0; std::string q; is >> w >> h >> f >> q; camOpen(id, w ? w : 1920, h ? h : 1080, f ? f : 30, unhex(q)); }
  else if (c == "camtest") { UINT w = 0, h = 0, f = 0; is >> w >> h >> f; camTestOpen(id, w >= 16 ? w : 1280, h >= 16 ? h : 720); }
  else if (c == "camoff") camClose(id);
  else if (c == "camexp") { int v = 0; is >> v; auto it = g_cams.find(id); if (it != g_cams.end()) { it->second->exp = v != 0; if (v) it->second->fresh = true; } }
  else if (c == "crel") {
    int gen = 0, slot = -1; is >> gen >> slot; auto it = g_cams.find(id);
    if (it != g_cams.end() && it->second->gen == gen && slot >= 0 && slot < 3) it->second->ring[slot].busy = false;
  }
}

static void utcCommand(const std::string& c, std::istringstream& is, const std::vector<uint8_t>& data) {
  std::string lid; is >> lid;
  if (c == "ulay") {
    g_ulay.clear();
    if (lid != "-") { std::stringstream ss(lid); std::string x; while (std::getline(ss, x, ',')) if (!x.empty()) g_ulay.push_back(x); }
    return;
  }
  if (c == "uclear") { for (auto& kv : g_ul) { if (kv.second.pend) ackHandle(kv.first, kv.second.pend, kv.second.pendSeq); kv.second.pend = nullptr; kv.second.valid = false; kv.second.readySent = false; } return; }
  if (lid.empty() || lid.size() > 16) return;
  ULayer& L = g_ul[lid];
  if (c == "utex" || c == "stex" || c == "ptex") { // stex = sumber biasa (Web Browser offscreen): buram; ptex = sumber transparan premultiplied (video stinger)
    unsigned long long hv = 0, seq = 0; UINT W = 0, H = 0; is >> hv >> W >> H >> seq;
    if (c == "stex") L.opaque = true;
    if (c == "ptex") { L.opaque = false; L.pm = true; }
    if (L.pend) ackHandle(lid, L.pend, L.pendSeq); // frame lama yang belum sempat disalin: lewati, kembalikan
    L.pend = (HANDLE)(uintptr_t)hv; L.pendSeq = seq; L.pW = W; L.pH = H;
  } else if (c == "ureset") {
    L.cur = Ticker(); L.next = Ticker(); L.valid = false; L.readySent = false;
  } else if (c == "utk") {
    Ticker n; int snap = 0; is >> n.id >> n.at >> n.vx >> n.vy >> n.vw >> n.vh >> n.w >> n.speed >> snap >> n.px0 >> n.E0 >> n.ntile;
    n.snap = snap != 0; n.tiles.reserve(n.ntile > 0 && n.ntile < 256 ? n.ntile : 0);
    if (n.ntile <= 0 || n.ntile > 256 || n.w <= 0) return;
    L.next = std::move(n); L.next.valid = false; // valid setelah semua potongan diterima
  } else if (c == "ublob") {
    std::string id; Tile t; size_t nb = 0; is >> id >> t.x >> t.w >> t.h >> nb;
    if (id != L.next.id || L.next.valid || !t.w || !t.h || data.size() < (size_t)t.w * t.h * 4) return;
    tileTex(t, data.data());
    L.next.tiles.push_back(std::move(t));
    if ((int)L.next.tiles.size() >= L.next.ntile) L.next.valid = true;
  } else if (c == "utkgeo") {
    std::string id; double vx, vy, vw, vh; is >> id >> vx >> vy >> vw >> vh;
    for (Ticker* n : { &L.cur, &L.next }) if (n->id == id) { n->vx = vx; n->vy = vy; n->vw = vw; n->vh = vh; }
  } else if (c == "utklive") {
    std::string id; is >> id;
    if (id == "-" || L.cur.id == id || L.next.id == id) { L.cur = Ticker(); L.next = Ticker(); }
  }
}

static float ease(float p) { p = p < 0 ? 0 : p > 1 ? 1 : p; return p < 0.5f ? 4 * p * p * p : 1 - std::pow(-2 * p + 2, 3.0f) / 2; } // = KM.ease
// ---- Latar AI native (Fase 9): model dijalankan untuk sumber yang sedang dipakai, ±30×/detik (sama dengan segment.js)
static bool segEnsure(SegN& g) {
  const UINT w = (UINT)segm::M.OW, h = (UINT)segm::M.OH;
  if (g.nTex && g.mw == w && g.mh == h) return true;
  g.nTex.Reset(); g.nSrv.Reset(); g.nUav.Reset(); g.stB.Reset(); g.stU.Reset(); g.rb[0].Reset(); g.rb[1].Reset(); g.rbPend[0] = g.rbPend[1] = false;
  D3D11_TEXTURE2D_DESC d{}; d.Width = w; d.Height = h; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_R8_UNORM; d.SampleDesc.Count = 1;
  d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_UNORDERED_ACCESS;
  if (FAILED(g_dev->CreateTexture2D(&d, nullptr, &g.nTex)) || FAILED(g_dev->CreateShaderResourceView(g.nTex.Get(), nullptr, &g.nSrv)) || FAILED(g_dev->CreateUnorderedAccessView(g.nTex.Get(), nullptr, &g.nUav))) return false;
  D3D11_TEXTURE2D_DESC r = d; r.Usage = D3D11_USAGE_STAGING; r.BindFlags = 0; r.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  for (auto& t : g.rb) if (FAILED(g_dev->CreateTexture2D(&r, nullptr, &t))) return false;
  std::vector<float> z((size_t)w * h, 0.f);
  D3D11_BUFFER_DESC bd{}; bd.ByteWidth = w * h * 4; bd.Usage = D3D11_USAGE_DEFAULT; bd.BindFlags = D3D11_BIND_UNORDERED_ACCESS; bd.MiscFlags = D3D11_RESOURCE_MISC_BUFFER_STRUCTURED; bd.StructureByteStride = 4;
  D3D11_SUBRESOURCE_DATA sd{ z.data(), 0, 0 };
  if (FAILED(g_dev->CreateBuffer(&bd, &sd, &g.stB))) return false;
  D3D11_UNORDERED_ACCESS_VIEW_DESC uv{}; uv.Format = DXGI_FORMAT_UNKNOWN; uv.ViewDimension = D3D11_UAV_DIMENSION_BUFFER; uv.Buffer.NumElements = w * h;
  if (FAILED(g_dev->CreateUnorderedAccessView(g.stB.Get(), &uv, &g.stU))) return false;
  g.mw = w; g.mh = h; return true;
}
static void segInfer(const std::string& id, SegN& g) {
  SrcView v; if (!getSrv(id, v) || !segEnsure(g)) return;
  const float lo = (float)std::max(0.02, g.edge - 0.22), hi = (float)std::min(0.98, g.edge + 0.22);
  segm::feed(v.srv.Get()); segm::runOps(); segm::post(g.stU.Get(), g.nUav.Get(), g.inv, lo, hi);
  g.srv = g.nSrv; g.infN++;
  // deteksi orang & kotaknya (untuk bingkai otomatis / sembunyikan): baca balik mask sebelumnya (tidak menunggu GPU)
  const int k = g.rbK, o = 1 - k;
  if (g.rbPend[o]) {
    D3D11_MAPPED_SUBRESOURCE m;
    if (SUCCEEDED(g_ctx->Map(g.rb[o].Get(), 0, D3D11_MAP_READ, 0, &m))) {
      const UINT w = g.mw, h = g.mh; size_t cnt = 0; UINT x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (UINT y = 0; y < h; y++) { const uint8_t* r = (const uint8_t*)m.pData + (size_t)y * m.RowPitch; for (UINT x = 0; x < w; x++) if (r[x] > 127) { cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      g_ctx->Unmap(g.rb[o].Get(), 0);
      g.person = cnt > (size_t)(0.015 * w * h); // orang terdeteksi bila ≥1,5% gambar (= segment.js)
      if (g.person) { g.box[0] = (double)x0 / w; g.box[1] = (double)y0 / h; g.box[2] = (double)(x1 - x0 + 1) / w; g.box[3] = (double)(y1 - y0 + 1) / h; }
    }
    g.rbPend[o] = false;
  }
  g_ctx->CopyResource(g.rb[k].Get(), g.nTex.Get()); g.rbPend[k] = true; g.rbK = o;
}
static void segTick(double now, const std::set<std::string>& used) {
  if (!segm::M.ok) return;
  for (auto& kv : g_seg) {
    SegN& g = kv.second; if (!g.nat) continue;
    if (used.count(kv.first) && now - g.lastInf >= 33) { g.lastInf = now; segInfer(kv.first, g); }
    // bingkai otomatis mengikuti orang (dihaluskan tiap frame) — rumus sama dengan segment.js
    double tx = 0, ty = 0, tw = 1;
    if (g.follow && g.person) {
      const double* b = g.box; const double z = std::max(1.0, g.fzoom);
      tw = std::min(1.0, std::max(1 / z, std::max(b[2] * 1.5, b[3] * 1.25))); tx = b[0] + b[2] / 2 - tw / 2; ty = b[1] + b[3] * 0.45 - tw / 2;
      tx = std::max(0.0, std::min(1 - tw, tx)); ty = std::max(0.0, std::min(1 - tw, ty));
    }
    if (g.follow) { const double k = 0.07; g.F[0] += (tx - g.F[0]) * k; g.F[1] += (ty - g.F[1]) * k; g.F[2] += (tw - g.F[2]) * k; }
    else { g.F[0] = 0; g.F[1] = 0; g.F[2] = 1; }
    g.cx = g.F[0]; g.cy = g.F[1]; g.cw = g.F[2]; g.hide = g.hideEmpty && !g.person && g.infN > 1;
  }
}
// ---- transisi (Fase 8): semua jenis transisi mesin JS kecuali stinger, rumus sama dengan drawTransition di engine.js
struct TmpRT { ComPtr<ID3D11Texture2D> t; ComPtr<ID3D11ShaderResourceView> srv; ComPtr<ID3D11RenderTargetView> rtv; };
static TmpRT g_tmp[2];
static bool ensureTmp(TmpRT& r) {
  if (r.t) { D3D11_TEXTURE2D_DESC d{}; r.t->GetDesc(&d); if (d.Width == g_W && d.Height == g_H) return true; }
  r.rtv.Reset(); if (!makeTex(g_W, g_H, nullptr, r.t, r.srv, true)) return false;
  return SUCCEEDED(g_dev->CreateRenderTargetView(r.t.Get(), nullptr, &r.rtv));
}
static void blurPass(ID3D11ShaderResourceView* src, ID3D11RenderTargetView* dst, float du, float dv) {
  ID3D11ShaderResourceView* none = nullptr; g_ctx->PSSetShaderResources(0, 1, &none);
  g_ctx->OMSetRenderTargets(1, &dst, nullptr);
  float d[4] = { -1, 1, 1, -1 }, uv[4] = { 0, 0, 1, 1 }, col[4] = { 1, 1, 1, 1 }, p2[4] = { du, dv, 12, 0 };
  setCB(d, uv, col, p2);
  g_ctx->PSSetShader(g_psBlur.Get(), nullptr, 0);
  g_ctx->PSSetShaderResources(0, 1, &src);
  float bf[4] = { 0, 0, 0, 0 }; g_ctx->OMSetBlendState(nullptr, bf, 0xffffffff);
  g_ctx->Draw(4, 0);
  g_ctx->OMSetBlendState(g_blend.Get(), bf, 0xffffffff);
  g_ctx->PSSetShaderResources(0, 1, &none);
}
static void drawTrans(Bus& b, float p) {
  const std::string &A = g_tr.from, &B = g_tr.to; const double W = g_W, H = g_H; const Aff I; const Rc full{ 0, 0, W, H };
  switch (g_tr.type) {
    case 1: drawFull(A, 1 - p * 0.3f, affZoom(1 + p * 0.06, W / 2, H / 2)); drawFull(B, p, affZoom(1.08 - 0.08 * p, W / 2, H / 2)); break; // merge
    case 2: drawSource(A, 1); clipRect(0, 0, W * p, H); drawSource(B, 1); clipOff(); break; // wipe
    case 3: drawSource(A, 1); clipRect(0, H * (1 - p), W, H); drawSource(B, 1); clipOff(); break; // wipeup
    case 4: drawFull(A, 1, affT(-W * p, 0)); drawFull(B, 1, affT(W * (1 - p), 0)); break; // slide
    case 5: drawFull(A, 1, affT(0, -H * p)); drawFull(B, 1, affT(0, H * (1 - p))); break; // slideup
    case 6: drawSource(A, 1); drawFull(B, std::min(1.f, p * 1.5f), affMul(affT(W / 2 - (1 - p) * W * 0.4, H / 2 - (1 - p) * H * 0.4), affMul(affR(-(1 - p) * 0.5), affMul(affS(p, p), affT(-W / 2, -H / 2))))); break; // fly
    case 7: drawFull(A, 1 - p, affZoom(1 + p * 0.8, W / 2, H / 2)); drawFull(B, p, affZoom(0.7 + 0.3 * p, W / 2, H / 2)); break; // zoom
    case 8: // crosszoom
      if (p < 0.5f) drawFull(A, 1, affZoom(1 + p * 4, W / 2, H / 2)); else drawFull(B, 1, affZoom(1 + (1 - p) * 4, W / 2, H / 2));
      fillPx(full, 1, 1, 1, (0.5f - std::fabs(p - 0.5f)) * 0.8f, Mask{}); break;
    case 9: drawSource(A, 1); g_clipMode = 2; g_clipP[0] = (float)(W / 2); g_clipP[1] = (float)(H / 2); g_clipP[2] = (float)(std::hypot(W, H) / 2 * p); drawSource(B, 1); clipOff(); break; // circle
    case 10: drawSource(A, 1); clipRect(W / 2 * (1 - p), 0, W / 2 * (1 - p) + W * p, H); drawSource(B, 1); clipOff(); break; // barn
    case 11: // cube
      drawFull(A, 1, affS(std::max(0.001, 1.0 - p), 1)); fillPx(Rc{ 0, 0, W * (1 - p), H }, 0, 0, 0, p * 0.6f, Mask{});
      drawFull(B, 1, affMul(affT(W * (1 - p), 0), affS(std::max(0.001f, p), 1))); fillPx(Rc{ W * (1 - p), 0, W * p, H }, 0, 0, 0, (1 - p) * 0.6f, Mask{}); break;
    case 12: case 13: { const float c = g_tr.type == 12 ? 0.f : 1.f; // dip / dipwhite
      if (p < 0.5f) { drawSource(A, 1); fillPx(full, c, c, c, p * 2, Mask{}); } else { drawSource(B, 1); fillPx(full, c, c, c, (1 - p) * 2, Mask{}); } break; }
    case 14: { // blur: gambar ke tekstur sementara lalu buram gaussian dua arah (σ = blur kanvas dalam piksel output)
      const double bl = std::round(std::sin(p * 3.14159265358979) * 24);
      if (bl < 0.5 || !ensureTmp(g_tmp[0]) || !ensureTmp(g_tmp[1])) { drawSource(A, 1); drawSource(B, p); break; }
      float black[4] = { 0, 0, 0, 1 };
      g_ctx->OMSetRenderTargets(1, g_tmp[0].rtv.GetAddressOf(), nullptr); g_ctx->ClearRenderTargetView(g_tmp[0].rtv.Get(), black);
      drawSource(A, 1); drawSource(B, p);
      const float st = (float)(bl / 6);
      blurPass(g_tmp[0].srv.Get(), g_tmp[1].rtv.Get(), st / (float)W, 0);
      blurPass(g_tmp[1].srv.Get(), b.rtv.Get(), 0, st / (float)H);
      break; }
    case 15: { // stinger: sumber lama sampai titik cut, lalu sumber baru; video stinger (transparan) di atasnya
      const double el = g_tr.manual ? g_tr.k * g_tr.dur : nowMs() - g_tr.t0;
      drawSource(el < g_tr.cut ? A : B, 1); drawSource(g_tr.sid, 1); break; }
    default: drawSource(A, 1); drawSource(B, p); // fade
  }
  (void)I;
}
static void compose(Bus& b, bool program) {
  const UINT oW = g_W, oH = g_H;
  if (!program && b.cw && b.ch) { g_W = b.cw; g_H = b.ch; } // gambar ke ukuran khusus monitor ini (semua rumus memakai g_W/g_H)
  struct Rst { UINT w, h; ~Rst() { g_W = w; g_H = h; } } rst{ oW, oH };
  ensureRT(b); if (!b.rtv) return;
  ID3D11ShaderResourceView* none = nullptr; g_ctx->PSSetShaderResources(0, 1, &none);
  g_ctx->OMSetRenderTargets(1, b.rtv.GetAddressOf(), nullptr);
  viewport(g_W, g_H);
  float black[4] = { 0, 0, 0, 1 }; g_ctx->ClearRenderTargetView(b.rtv.Get(), black);
  g_G = Aff(); clipOff();
  if (program && g_tr.on) drawTrans(b, ease((float)g_tr.k));
  else drawSource(b.id, 1);
  if (program) {
    drawOverlaysN(); drawUtc(); // overlay lalu grafis UTC ON AIR di atas Program (urutan sama dengan mesin JS)
    if (g_ftb > 0.0005) { pipeline(); viewport(g_W, g_H); g_ctx->OMSetRenderTargets(1, b.rtv.GetAddressOf(), nullptr); fillPx(Rc{ 0, 0, (double)g_W, (double)g_H }, 0, 0, 0, (float)g_ftb, Mask{}); } // FTB paling atas
  }
}
static void present(Bus& b) {
  if (!b.want || !b.hwnd) return;
  UINT w = (UINT)std::max<LONG>(8, b.r.right - b.r.left), h = (UINT)std::max<LONG>(8, b.r.bottom - b.r.top);
  if (!ensureSwap(b, w, h)) return;
  ID3D11ShaderResourceView* none = nullptr; g_ctx->PSSetShaderResources(0, 1, &none);
  g_ctx->OMSetRenderTargets(1, b.scRtv.GetAddressOf(), nullptr);
  viewport(b.scW, b.scH);
  float black[4] = { 0, 0, 0, 1 }; g_ctx->ClearRenderTargetView(b.scRtv.Get(), black);
  // monitor = rasio output: isi penuh (bila sedikit berbeda karena pembulatan, tetap direntangkan ±1 px)
  float dst[4] = { -1, 1, 1, -1 }, uv[4] = { 0, 0, 1, 1 }, col[4] = { 1, 1, 1, 1 };
  D3D11_TEXTURE2D_DESC bd{}; if (b.rt) b.rt->GetDesc(&bd); const UINT bw = bd.Width ? bd.Width : g_W, bh = bd.Height ? bd.Height : g_H;
  double scale = std::max((double)bw / b.scW, (double)bh / b.scH);
  int n = (int)std::ceil(scale); n = n < 1 ? 1 : n > 6 ? 6 : n;
  float p2[4] = { 1.0f / b.scW, 1.0f / b.scH, (float)n, 0 };
  setCB(dst, uv, col, p2);
  g_ctx->PSSetShader(n > 1 ? g_psDown.Get() : g_psTex.Get(), nullptr, 0);
  g_ctx->PSSetShaderResources(0, 1, b.rtSrv.GetAddressOf());
  g_ctx->Draw(4, 0);
  HRESULT hr = b.sc->Present(0, 0);
  if (FAILED(hr)) { b.sc.Reset(); b.scRtv.Reset(); b.scW = b.scH = 0; return; }
  if (++b.presented >= 2 && !b.shown) { // tampilkan jendela setelah frame nyata siap → tidak ada kedip hitam
    SetWindowPos(b.hwnd, HWND_TOP, b.r.left, b.r.top, (int)w, (int)h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    b.shown = true; emit("shown %s", b.name);
  }
}
static void hideBus(Bus& b) {
  if (b.hwnd && b.shown) { ShowWindow(b.hwnd, SW_HIDE); b.shown = false; emit("hidden %s", b.name); }
  b.presented = 0;
}
// ---- kartu daftar input native (Fase 10): tiap kartu = jendela anak kecil di atas thumbnail kartu, digambar mesin native
// tiap frame (semulus Preview/Program). Lencana kartu (nomor, LIVE/PVW, ikon jenis) datang sebagai gambar raster dari KLM;
// meter audio & progres video digambar di sini.
struct CardN { Bus b{ nullptr }; std::string name, src, ovl; int x = 0, y = 0, w = 0, h = 0; RECT clip{}; double meter = -1, prog = -1, dpr = 1; bool want = false; };
static std::map<std::string, std::unique_ptr<CardN>> g_cards;
static void drawInput(const std::string& id, const Rc& box, float alpha, const struct Mask& m, int depth);
static void drawView(const std::string& id, const Rc& box, int fit, double zoom, double px, double py, double cl, double cr, double ct, double cb, bool flip, float alpha, const struct Mask& m, int depth, double rot);
static void fillPxC(double x, double y, double w, double h, float r, float g, float b, float a);
static void cardsRender() {
  for (auto& kv : g_cards) {
    CardN& c = *kv.second; Bus& b = c.b;
    const int cw = c.clip.right - c.clip.left, ch = c.clip.bottom - c.clip.top;
    if (!c.want || cw < 4 || ch < 4 || c.w < 8 || c.h < 8) { hideBus(b); continue; }
    if (!ensureWindow(b) || !ensureSwap(b, (UINT)cw, (UINT)ch)) continue;
    ID3D11ShaderResourceView* none = nullptr; g_ctx->PSSetShaderResources(0, 1, &none);
    g_ctx->OMSetRenderTargets(1, b.scRtv.GetAddressOf(), nullptr);
    float black[4] = { 0, 0, 0, 1 }; g_ctx->ClearRenderTargetView(b.scRtv.Get(), black);
    D3D11_VIEWPORT v{ (float)(c.x - c.clip.left), (float)(c.y - c.clip.top), (float)c.w, (float)c.h, 0, 1 }; g_ctx->RSSetViewports(1, &v); // kartu sebagian tergulir: hanya bagian terlihat yang punya jendela
    const UINT oW = g_W, oH = g_H; g_W = (UINT)c.w; g_H = (UINT)c.h; g_G = Aff(); clipOff();
    const Rc full{ 0, 0, (double)c.w, (double)c.h };
    drawInput(c.src, full, 1, Mask{}, 0);
    if (!c.ovl.empty()) drawView(c.ovl, full, 2, 1, 0, 0, 0, 0, 0, 0, false, 1, Mask{}, 0, 0);
    const double k = c.dpr;
    if (c.meter >= 0) { // meter audio: kanan, top 32px, bawah 6px, lebar 5px (sama dengan .ameter)
      const double mx = c.w - 11 * k, my = 32 * k, mh = c.h - 38 * k, mw = 5 * k;
      if (mh > 4) { fillPxC(mx, my, mw, mh, 0, 0, 0, 0.55f); const double lv = std::min(1.0, c.meter), lh = mh * lv;
        const float r = lv > 0.85 ? 0.94f : lv > 0.7 ? 0.98f : 0.13f, g = lv > 0.85 ? 0.27f : lv > 0.7 ? 0.8f : 0.77f, bl = lv > 0.85 ? 0.27f : lv > 0.7 ? 0.08f : 0.37f;
        if (lh > 0.5) fillPxC(mx, my + mh - lh, mw, lh, r, g, bl, 1); }
    }
    if (c.prog >= 0) fillPxC(0, c.h - 3 * k, c.w * std::min(1.0, c.prog), 3 * k, 0.416f, 0.651f, 1.0f, 1); // progres video (.pbar)
    g_W = oW; g_H = oH;
    if (FAILED(b.sc->Present(0, 0))) { b.sc.Reset(); b.scRtv.Reset(); b.scW = b.scH = 0; continue; }
    if (!b.shown) { if (++b.presented >= 2) { SetWindowPos(b.hwnd, HWND_TOP, c.clip.left, c.clip.top, cw, ch, SWP_NOACTIVATE | SWP_SHOWWINDOW); b.shown = true; b.r = c.clip; emit("shown %s", b.name); } }
    else if (memcmp(&b.r, &c.clip, sizeof(RECT))) { b.r = c.clip; SetWindowPos(b.hwnd, HWND_TOP, c.clip.left, c.clip.top, cw, ch, SWP_NOACTIVATE); }
  }
}

// ---------------------------------------------------------------- perintah
static int g_frames = 0; static double g_msAcc = 0;
static void sendStats(int fps, double ms) {
  PROCESS_MEMORY_COUNTERS pm{}; pm.cb = sizeof pm; GetProcessMemoryInfo(GetCurrentProcess(), &pm, sizeof pm);
  std::string outs; for (auto& kv : g_out) outs += (outs.empty() ? "" : ",") + kv.first + ":" + std::to_string(kv.second->frames) + ":" + std::to_string(kv.second->skipped);
  std::string cams; for (auto& kv : g_cams) cams += (cams.empty() ? "" : ",") + kv.first + ":" + std::to_string(kv.second->frames.load());
  emit("stats fps=%d ms=%.2f mem=%llu warp=%d utex=%llu cams=%s outs=%s", fps, ms, (unsigned long long)(pm.WorkingSetSize / (1024 * 1024)), g_warp ? 1 : 0, g_utexN, cams.empty() ? "-" : cams.c_str(), outs.empty() ? "-" : outs.c_str());
}
static void applyRect(Bus& b, int x, int y, int w, int h, bool vis) {
  b.want = vis && w >= 8 && h >= 8;
  RECT nr{ x, y, x + w, y + h };
  bool moved = memcmp(&nr, &b.r, sizeof nr) != 0;
  b.r = nr;
  if (!b.want) { hideBus(b); return; }
  if (!ensureWindow(b)) return;
  if (moved && b.shown) SetWindowPos(b.hwnd, HWND_TOP, x, y, w, h, SWP_NOACTIVATE);
}
static bool readPixel(Bus& b, UINT x, UINT y, int rgb[3]);
static void command(const std::string& line, const std::vector<uint8_t>& data = {}) {
  std::istringstream is(line); std::string c; is >> c;
  if (c == "utex" || c == "stex" || c == "ptex" || c == "ulay" || c == "uclear" || c == "ureset" || c == "utk" || c == "ublob" || c == "utkgeo" || c == "utklive") { utcCommand(c, is, data); return; }
  if (c == "cam" || c == "camtest" || c == "camoff" || c == "camexp" || c == "crel" || c == "camlist") { camCommand(c, is); return; }
  if (c == "kenc") {
    std::string id; int key = 0; long long ts = 0; size_t n = 0; is >> id >> key >> ts >> n;
    if (!id.empty() && id.size() <= 64 && !data.empty()) kFeed(id, key != 0, (LONGLONG)ts, std::vector<uint8_t>(data.begin(), data.end()));
    return;
  }
  if (c == "kdecoff") { std::string id; is >> id; kOff(id); return; }
  if (c == "aud") { oAudio(data); return; }
  if (c == "ostart") {
    std::string id, kind, ph; UINT w = 0, h = 0, f = 0, vk = 0, ak = 0; int cbr = 0;
    is >> id >> kind >> w >> h >> f >> vk >> ak >> cbr >> ph;
    if (id.empty() || id.size() > 32) return;
    oStart(id, kind == "ts", w ? w : g_W, h ? h : g_H, f ? f : g_fps, vk ? vk : 6000, ak ? ak : 160, cbr != 0, unhex(ph));
    return;
  }
  if (c == "ostop") { std::string id; is >> id; oStop(id); return; }
  if (c == "probe") {
    std::string bn; double fx = 0, fy = 0; is >> bn >> fx >> fy; int px[3] = { -1, -1, -1 };
    Bus& b = bn == "pvw" ? g_pvw : g_pgm;
    D3D11_TEXTURE2D_DESC bd{}; if (b.rt) b.rt->GetDesc(&bd); const double bw = bd.Width ? bd.Width : g_W, bh = bd.Height ? bd.Height : g_H;
    readPixel(b, (UINT)std::min<double>(bw - 1, std::max(0.0, fx * bw)), (UINT)std::min<double>(bh - 1, std::max(0.0, fy * bh)), px);
    emit("probe %d %d %d", px[0], px[1], px[2]);
    return;
  }
  if (c == "parent") {
    unsigned long long v = 0; is >> v; HWND p = (HWND)(uintptr_t)v;
    if (!IsWindow(p)) { emit("err jendela induk tidak valid"); return; }
    if (p != g_parent) {
      for (Bus* b : { &g_pvw, &g_pgm }) { if (b->hwnd) DestroyWindow(b->hwnd); b->hwnd = nullptr; b->sc.Reset(); b->scRtv.Reset(); b->scW = b->scH = 0; b->shown = false; }
      for (auto& kv : g_cards) { Bus* b = &kv.second->b; if (b->hwnd) DestroyWindow(b->hwnd); b->hwnd = nullptr; b->sc.Reset(); b->scRtv.Reset(); b->scW = b->scH = 0; b->shown = false; }
      g_parent = p;
    }
  } else if (c == "out") {
    UINT w = 0, h = 0, f = 0; is >> w >> h >> f;
    if (w >= 16 && h >= 16 && w <= 7680 && h <= 4320) { g_W = w; g_H = h; }
    if (f >= 1 && f <= 240) g_fps = f;
  } else if (c == "card") { // card <id> <src|-> <x> <y> <w> <h> <cx> <cy> <cw> <ch> <ovl|-> <meter|-1> <prog|-1> <dpr>
    std::string id, src, ovl; int x = 0, y = 0, w = 0, h = 0, cx = 0, cy = 0, cw = 0, ch = 0; double me = -1, pr = -1, dpr = 1;
    is >> id >> src >> x >> y >> w >> h >> cx >> cy >> cw >> ch >> ovl >> me >> pr >> dpr; if (id.empty() || id.size() > 48) return;
    auto& u = g_cards[id]; if (!u) { u = std::make_unique<CardN>(); u->name = "c:" + id; u->b.name = u->name.c_str(); }
    CardN& cd = *u; cd.src = src == "-" ? "" : src; cd.ovl = ovl == "-" ? "" : ovl; cd.x = x; cd.y = y; cd.w = w; cd.h = h; cd.clip = RECT{ cx, cy, cx + cw, cy + ch };
    cd.meter = me; cd.prog = pr; cd.dpr = dpr > 0.25 && dpr < 8 ? dpr : 1; cd.want = !cd.src.empty() && cw > 3 && ch > 3; cd.b.want = cd.want;
  } else if (c == "cardoff") { // cardoff <id> | cardoff *  — hapus jendela kartu
    std::string id; is >> id;
    for (auto it = g_cards.begin(); it != g_cards.end();) {
      if (id == "*" || it->first == id) { if (it->second->b.hwnd) DestroyWindow(it->second->b.hwnd); it = g_cards.erase(it); } else ++it;
    }
  } else if (c == "rect") {
    std::string bn; int x = 0, y = 0, w = 0, h = 0, v = 0; is >> bn >> x >> y >> w >> h >> v;
    applyRect(bn == "pvw" ? g_pvw : g_pgm, x, y, w, h, v != 0);
  } else if (c == "src") {
    std::string id, kind; is >> id >> kind;
    if (id.empty() || id.size() > 64) return;
    auto s = std::make_unique<Source>(); s->kind = kind;
    if (kind == "colour") { int r = 0, g = 0, b = 0, r2 = 0, g2 = 0, b2 = 0, gr = 0; is >> r >> g >> b >> r2 >> g2 >> b2 >> gr; genColour(*s, r & 255, g & 255, b & 255, r2 & 255, g2 & 255, b2 & 255, gr); emit("srcok %s %u %u", id.c_str(), s->w, s->h); }
    else if (kind == "bars") { genBars(*s); emit("srcok %s %u %u", id.c_str(), s->w, s->h); }
    else if (kind == "screen") {
      int x = 0, y = 0, w = 0, h = 0; is >> x >> y >> w >> h; s->want = RECT{ x, y, x + w, y + h };
      auto old = g_src.find(id); // layar yang sama: pertahankan duplikasi yang sudah berjalan
      if (old != g_src.end() && old->second->kind == "screen" && !memcmp(&old->second->want, &s->want, sizeof(RECT))) return;
      openDup(*s, id);
    } else if (kind == "image") {
      std::string ph, why; is >> ph;
      if (!loadImage(*s, unhex(ph), why)) { emit("srcerr %s %s", id.c_str(), why.c_str()); return; }
      emit("srcok %s %u %u", id.c_str(), s->w, s->h);
    } else if (kind == "window") {
      unsigned long long hv = 0; is >> hv;
      auto old = g_src.find(id);
      if (old != g_src.end() && old->second->kind == "window" && old->second->wItem) return; // sudah berjalan
      if (!openWin(*s, id, (HWND)(uintptr_t)hv)) return;
    } else if (kind == "video" || kind == "live") {
      std::string ph; is >> ph; vOpen(id, unhex(ph), kind == "live"); return; // ditampilkan lewat jalur kamera (tekstur dekoder)
    } else { emit("srcerr %s jenis tidak didukung", id.c_str()); return; }
    g_src[id] = std::move(s);
  } else if (c == "del") {
    std::string id; is >> id; g_src.erase(id); vClose(id); g_comp.erase(id);
  } else if (c == "srcimg") { // gambar yang sudah dirender KLM (RGBA lurus) → BGRA
    std::string id; UINT w = 0, h = 0; size_t n = 0; is >> id >> w >> h >> n;
    if (id.empty() || id.size() > 64 || !w || !h || w > 8192 || h > 8192 || data.size() < (size_t)w * h * 4) return;
    std::vector<uint8_t> px(data.begin(), data.begin() + (size_t)w * h * 4);
    for (size_t i = 0; i < px.size(); i += 4) std::swap(px[i], px[i + 2]);
    auto sp = std::make_unique<Source>(); sp->kind = "image";
    if (!makeTex(w, h, px.data(), sp->tex, sp->srv)) { emit("srcerr %s tekstur GPU gagal", id.c_str()); return; }
    sp->w = w; sp->h = h; g_src[id] = std::move(sp); emit("srcok %s %u %u", id.c_str(), w, h);
  } else if (c == "comp") {
    std::string id, base, fg; CompN C; double dim = 0; is >> id >> base >> C.baseFit >> dim >> fg;
    if (id.empty() || id.size() > 64) return;
    C.base = base == "-" ? "" : base; C.fg = fg == "-" ? "" : fg; C.dim = dim;
    std::string tok;
    while (is >> tok && C.L.size() < 32) {
      std::vector<std::string> f; std::stringstream ss(tok); std::string x; while (std::getline(ss, x, ',')) f.push_back(x);
      if (f.size() < 25) continue;
      LayerN l; auto d = [&](int i) { return atof(f[i].c_str()); };
      l.src = f[0] == "-" ? "" : f[0]; l.x = d(1); l.y = d(2); l.w = d(3); l.h = d(4); l.fit = atoi(f[5].c_str()); l.zoom = d(6) > 0 ? d(6) : 1;
      l.px = d(7); l.py = d(8); l.cl = d(9); l.cr = d(10); l.ct = d(11); l.cb = d(12); l.flip = f[13] == "1"; l.op = d(14); l.rad = d(15); l.bw = d(16);
      if (f[17] != "-") { l.hasBc = true; hexRgb(f[17], l.bc); } if (f[18] != "-") { l.hasBg = true; hexRgb(f[18], l.bg); }
      l.sh = d(19); l.lab = f[20] == "-" ? "" : f[20]; l.lx = d(21); l.ly = d(22); l.lw = d(23); l.lh = d(24);
      if (f.size() > 25) l.rot = d(25);
      C.L.push_back(l);
    }
    g_comp[id] = std::move(C);
  } else if (c == "ovl") {
    g_ovl.clear(); std::string tok;
    while (is >> tok && g_ovl.size() < 8) {
      std::vector<std::string> f; std::stringstream ss(tok); std::string x; while (std::getline(ss, x, ',')) f.push_back(x);
      if (f.size() < 5) continue;
      OvlN o; o.src = f[0]; o.a = atof(f[1].c_str()); o.dx = atof(f[2].c_str()); o.dy = atof(f[3].c_str()); o.clip = atof(f[4].c_str());
      if (f.size() > 5) o.z = atof(f[5].c_str());
      g_ovl.push_back(o);
    }
  } else if (c == "naud") {
    std::string id; int on = 0; is >> id >> on; vAudio(id, on != 0);
  } else if (c == "camaud") {
    std::string id, q; is >> id >> q; camAudio(id, unhex(q));
  } else if (c == "avoff") {
    int ms = 0; is >> ms; g_avOff = std::max(-2000, std::min(2000, ms));
  } else if (c == "vt") {
    std::string id; double t = 0, rate = 1; int play = 0; is >> id >> t >> play >> rate; vTime(id, t, play != 0, rate);
  } else if (c == "pvw" || c == "pgm") {
    std::string id; is >> id; (c == "pvw" ? g_pvw : g_pgm).id = id == "-" ? "" : id;
    // KLM menetapkan Program = transisi otomatis sudah selesai / dibatalkan di KLM (mis. stinger berakhir lebih cepat, cut baru) → hentikan di sini juga
    if (c == "pgm" && g_tr.on && !g_tr.manual) g_tr.on = false;
  } else if (c == "trans") {
    double ms = 0; std::string a, b, ty; is >> ms >> a >> b >> ty;
    g_tr = Trans(); g_tr.on = true; g_tr.t0 = nowMs(); g_tr.dur = std::max(1.0, ms); g_tr.from = a == "-" ? "" : a; g_tr.to = b == "-" ? "" : b; g_tr.type = trType(ty);
    if (g_tr.type == 15) { is >> g_tr.sid >> g_tr.cut; if (g_tr.sid == "-") g_tr.sid.clear(); } // trans <ms> a b stinger <sumber> <cut ms>
  } else if (c == "tbar") {
    std::string v; is >> v;
    if (v == "off") { g_tr.on = false; return; }
    std::string a, b, ty; is >> a >> b >> ty;
    g_tr.on = true; g_tr.manual = true; g_tr.k = std::atoi(v.c_str()) / 1000.0; g_tr.from = a == "-" ? "" : a; g_tr.to = b == "-" ? "" : b; g_tr.type = trType(ty);
  } else if (c == "szoom") { // szoom <id> <zoom ≥1>: zoom digital sumber (potong tengah)
    std::string id; double z = 1; is >> id >> z; if (id.empty() || id.size() > 64) return;
    if (z > 1.001 && z <= 16) g_szoom[id] = z; else g_szoom.erase(id);
  } else if (c == "segmodel") { // segmodel <path .tflite>: muat model Latar AI ke GPU
    std::string path; std::getline(is, path); while (!path.empty() && (path[0] == ' ')) path.erase(0, 1);
    std::wstring wp; { int n = MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, nullptr, 0); wp.resize(n > 0 ? n - 1 : 0); if (n > 1) MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, &wp[0], n); }
    std::string info; if (segm::load(wp, info)) emit("segmodel ok %s", info.c_str()); else emit("segmodel err %s", segm::M.err.c_str());
  } else if (c == "segnorm") { double sc = 1, off = 0; is >> sc >> off; segm::g_inScale = (float)sc; segm::g_inOff = (float)off;
  } else if (c == "bsize") { // bsize <pvw|pgm> <w> <h>: ukuran gambar monitor (0 0 = ukuran output). Mode grid Preview memakai rasio panelnya
    std::string n; int w = 0, h = 0; is >> n >> w >> h; Bus* b = n == "pvw" ? &g_pvw : n == "pgm" ? &g_pgm : nullptr; if (!b) return;
    if (w < 16 || h < 16 || w > 7680 || h > 4320) { b->cw = b->ch = 0; } else { b->cw = (UINT)w; b->ch = (UINT)h; }
  } else if (c == "ftb") {
    double a = 0; is >> a; g_ftb = std::max(0.0, std::min(1.0, a));
  } else if (c == "ipos") { // ipos <id> <fit 0/1/2> <zoom> <x> <y> <cl> <cr> <ct> <cb> <rot°>  |  ipos <id> -
    std::string id, f; is >> id >> f; if (id.empty() || id.size() > 64) return;
    if (f == "-" || f.empty()) { g_pos.erase(id); return; }
    PosN p; p.fit = atoi(f.c_str()); is >> p.zoom >> p.x >> p.y >> p.cl >> p.cr >> p.ct >> p.cb >> p.rot; if (!(p.zoom > 0)) p.zoom = 1; g_pos[id] = p;
  } else if (c == "fx") { // fx <id> <cc 0/1> <bri> <con> <sat> <hue rad> <gam> <key 0/1> <rrggbb> <sim> <smo> <spill> <luma 0/1> <lo> <hi>  |  fx <id> -
    std::string id, cc; is >> id >> cc; if (id.empty() || id.size() > 64) return;
    if (cc == "-" || cc.empty()) { g_fx.erase(id); return; }
    FxN f; int key = 0, luma = 0; std::string kc; f.cc = cc == "1";
    is >> f.bri >> f.con >> f.sat >> f.hue >> f.gam >> key >> kc >> f.sim >> f.smo >> f.spill >> luma >> f.lo >> f.hi;
    f.key = key != 0; f.luma = luma != 0; hexRgb(kc, f.kc); g_fx[id] = f;
  } else if (c == "seg") { // seg <id> <mode 0 hapus|1 buram|2 warna|3 gambar> <feather> <blur> <rrggbb> <bgId|-> <bgFit 0 fill|1 fit> <cx> <cy> <cw> <hide 0/1>  |  seg <id> -
    std::string id, md; is >> id >> md; if (id.empty() || id.size() > 64) return;
    if (md == "-" || md.empty()) { g_seg.erase(id); return; }
    SegN& g = g_seg[id]; std::string col, bg; int hide = 0; g.mode = atoi(md.c_str());
    is >> g.feather >> g.blur >> col >> bg >> g.bgFit >> g.cx >> g.cy >> g.cw >> hide;
    hexRgb(col, g.col); g.bg = bg == "-" ? "" : bg; g.hide = hide != 0; if (!(g.cw > 0.01) || g.cw > 1) { g.cx = g.cy = 0; g.cw = 1; }
    int nat = 0, inv = 0, fol = 0, he = 0; double edge = 0.5, fz = 1.6;
    if (is >> nat >> edge >> inv >> fol >> fz >> he) { // model native: bingkai & sembunyikan dihitung mesin sendiri
      const bool was = g.nat; g.nat = nat != 0 && segm::M.ok; g.edge = edge; g.inv = inv != 0; g.follow = fol != 0; g.fzoom = fz; g.hideEmpty = he != 0;
      if (g.nat && !was) { g.srv.Reset(); g.mw = g.mh = 0; g.lastInf = -1e9; }
      if (g.nat) { g.cx = g.F[0]; g.cy = g.F[1]; g.cw = g.F[2]; g.hide = g.hideEmpty && !g.person; }
    } else g.nat = false;
  } else if (c == "segm") { // mask latar AI: <id> <w> <h> <n> + n byte (8-bit, 1 = orang)
    std::string id; UINT w = 0, h = 0; size_t n = 0; is >> id >> w >> h >> n;
    auto it = g_seg.find(id); if (it == g_seg.end() || !w || !h || w > 2048 || h > 2048 || data.size() < (size_t)w * h) return;
    SegN& g = it->second; if (g.nat) return; // model native sudah menghasilkan mask sendiri
    if (!g.tex || g.mw != w || g.mh != h) {
      D3D11_TEXTURE2D_DESC d{}; d.Width = w; d.Height = h; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_R8_UNORM; d.SampleDesc.Count = 1;
      d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE;
      D3D11_SUBRESOURCE_DATA sd{ data.data(), w, 0 }; g.tex.Reset(); g.srv.Reset();
      if (FAILED(g_dev->CreateTexture2D(&d, &sd, &g.tex)) || FAILED(g_dev->CreateShaderResourceView(g.tex.Get(), nullptr, &g.srv))) { g.tex.Reset(); g.srv.Reset(); g.mw = g.mh = 0; return; }
      g.mw = w; g.mh = h;
    } else g_ctx->UpdateSubresource(g.tex.Get(), 0, nullptr, data.data(), w, 0);
  } else if (c == "stats") {
    sendStats(0, 0);
  } else if (c == "quit") {
    g_quit = true;
  }
}

static void frame(double now) {
  std::deque<Cmd> q;
  { std::lock_guard<std::mutex> l(g_qMx); q.swap(g_q); }
  for (auto& l : q) { g_cmdAt = l.at; command(l.line, l.data); g_cmdAt = 0; }
  g_frameNo++;
  flushUtex();
  if (g_tr.on && !g_tr.manual) {
    g_tr.k = (now - g_tr.t0) / g_tr.dur;
    if (g_tr.k >= 1) { g_tr.on = false; g_pgm.id = g_tr.to; }
  }
  for (auto& kv : g_src) if (kv.second->kind == "window") tickWin(*kv.second); // jendela: ambil frame terbaru (murah)
  { // sumber yang sedang dipakai (langsung, lewat komposisi / grid Preview, transisi, overlay): layar ditangkap & Latar AI native dijalankan hanya untuk ini
    std::set<std::string> used;
    std::function<void(const std::string&, int)> ref = [&](const std::string& id, int d) {
      if (id.empty() || d > 5 || !used.insert(id).second) return;
      auto ci = g_comp.find(id); if (ci == g_comp.end()) return;
      ref(ci->second.base, d + 1); for (auto& l : ci->second.L) ref(l.src, d + 1);
    };
    ref(g_pvw.id, 0); ref(g_pgm.id, 0); if (g_tr.on) { ref(g_tr.from, 0); ref(g_tr.to, 0); } for (auto& o : g_ovl) ref(o.src, 0);
    for (auto& kv : g_cards) if (kv.second->want) ref(kv.second->src, 0); // kartu daftar input native
    for (auto& kv : g_src) if (kv.second->kind == "screen" && used.count(kv.first)) tickScreen(*kv.second, kv.first, now);
    segTick(now, used);
  }
  pipeline();
  kPresentAll(now); // KLMCAM: frame yang jatuh tempo ke tekstur kamera (jitter buffer)
  camTick();
  if (g_pgm.want || !g_parent || !g_out.empty()) compose(g_pgm, true);
  oVideo(now);
  if (g_pvw.want || !g_parent) compose(g_pvw, false);
  present(g_pgm);
  present(g_pvw);
  if (!g_cards.empty()) { pipeline(); cardsRender(); }
  // pastikan monitor tetap di atas kanvas Chromium (Chromium bisa membuat ulang jendela anaknya saat ukuran berubah)
  static double zAt = 0;
  if (now - zAt > 1000) {
    zAt = now;
    for (Bus* b : { &g_pgm, &g_pvw }) if (b->shown && GetWindow(b->hwnd, GW_HWNDPREV)) SetWindowPos(b->hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    for (auto& kv : g_cards) { Bus* b = &kv.second->b; if (b->shown && GetWindow(b->hwnd, GW_HWNDPREV)) SetWindowPos(b->hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE); }
  }
}

static void registerClass() {
  WNDCLASSEXW wc{ sizeof wc }; wc.style = CS_DBLCLKS; wc.lpfnWndProc = monProc; wc.hInstance = GetModuleHandleW(nullptr);
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW); wc.lpszClassName = L"KLMEngineMon"; wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
  RegisterClassExW(&wc);
}
static void pump() { MSG m; while (PeekMessageW(&m, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&m); DispatchMessageW(&m); } }

// ---------------------------------------------------------------- uji mandiri (CI)
static bool readPixel(Bus& b, UINT x, UINT y, int rgb[3]) {
  if (!b.rt) return false;
  D3D11_TEXTURE2D_DESC d{}; b.rt->GetDesc(&d);
  d.Usage = D3D11_USAGE_STAGING; d.BindFlags = 0; d.CPUAccessFlags = D3D11_CPU_ACCESS_READ; d.MiscFlags = 0;
  ComPtr<ID3D11Texture2D> st; if (FAILED(g_dev->CreateTexture2D(&d, nullptr, &st))) return false;
  g_ctx->CopyResource(st.Get(), b.rt.Get());
  D3D11_MAPPED_SUBRESOURCE m; if (FAILED(g_ctx->Map(st.Get(), 0, D3D11_MAP_READ, 0, &m))) return false;
  const uint8_t* p = (const uint8_t*)m.pData + y * m.RowPitch + x * 4;
  rgb[0] = p[2]; rgb[1] = p[1]; rgb[2] = p[0];
  g_ctx->Unmap(st.Get(), 0);
  return true;
}
// uji: GIF89a kecil dengan frame warna polos (LZW 3 bit, kode CLEAR tiap piksel → valid tanpa kamus)
static std::vector<uint8_t> makeGif(int W, int H, const std::vector<int>& idx, const uint8_t pal[12], int delayCs) {
  std::vector<uint8_t> g = { 'G','I','F','8','9','a', (uint8_t)W, 0, (uint8_t)H, 0, 0xF1, 0, 0 }; // GCT 4 warna
  g.insert(g.end(), pal, pal + 12);
  const uint8_t loop[] = { 0x21, 0xFF, 0x0B, 'N','E','T','S','C','A','P','E','2','.','0', 3, 1, 0, 0, 0 }; g.insert(g.end(), loop, loop + sizeof loop);
  for (int c : idx) {
    const uint8_t gce[] = { 0x21, 0xF9, 4, 0, (uint8_t)delayCs, 0, 0, 0 }; g.insert(g.end(), gce, gce + 8);
    const uint8_t id[] = { 0x2C, 0, 0, 0, 0, (uint8_t)W, 0, (uint8_t)H, 0, 0 }; g.insert(g.end(), id, id + 10);
    g.push_back(2); // ukuran kode minimum
    std::vector<uint8_t> data; uint32_t acc = 0; int nb = 0;
    auto put = [&](int code) { acc |= (uint32_t)code << nb; nb += 3; while (nb >= 8) { data.push_back(acc & 255); acc >>= 8; nb -= 8; } };
    put(4); for (int i = 0; i < W * H; i++) { put(c); put(4); } put(5); if (nb) data.push_back(acc & 255);
    for (size_t o = 0; o < data.size(); o += 255) { size_t n = std::min<size_t>(255, data.size() - o); g.push_back((uint8_t)n); g.insert(g.end(), data.begin() + o, data.begin() + o + n); }
    g.push_back(0);
  }
  g.push_back(0x3B);
  return g;
}
// uji: buat potongan H.264 (encoder perangkat lunak Windows) dari warna NV12 polos
static bool hasSps(const std::vector<uint8_t>& b) { for (size_t i = 0; i + 3 < b.size(); i++) if (b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 1 && (b[i + 3] & 0x1f) == 7) return true; return false; }
static bool encTest(UINT W, UINT H, int n, uint8_t Y, uint8_t U, uint8_t V, std::vector<std::vector<uint8_t>>& out, std::string& why) {
  ComPtr<IMFTransform> e;
  HRESULT hr = CoCreateInstance(CLSID_CMSH264EncoderMFT, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&e));
  if (FAILED(hr)) { why = "encoder H.264 tidak ada"; return false; }
  ComPtr<IMFMediaType> ot; MFCreateMediaType(&ot);
  ot->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); ot->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_H264); ot->SetUINT32(MF_MT_AVG_BITRATE, 2000000);
  MFSetAttributeSize(ot.Get(), MF_MT_FRAME_SIZE, W, H); MFSetAttributeRatio(ot.Get(), MF_MT_FRAME_RATE, 30, 1);
  ot->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive); ot->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Base);
  if (FAILED(hr = e->SetOutputType(0, ot.Get(), 0))) { why = "SetOutputType"; return false; }
  ComPtr<IMFMediaType> it; MFCreateMediaType(&it);
  it->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video); it->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_NV12);
  MFSetAttributeSize(it.Get(), MF_MT_FRAME_SIZE, W, H); MFSetAttributeRatio(it.Get(), MF_MT_FRAME_RATE, 30, 1); it->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
  if (FAILED(hr = e->SetInputType(0, it.Get(), 0))) { why = "SetInputType"; return false; }
  std::vector<uint8_t> seq;
  { ComPtr<IMFMediaType> cur; UINT32 sz = 0; if (SUCCEEDED(e->GetOutputCurrentType(0, &cur)) && SUCCEEDED(cur->GetBlobSize(MF_MT_MPEG_SEQUENCE_HEADER, &sz)) && sz) { seq.resize(sz); cur->GetBlob(MF_MT_MPEG_SEQUENCE_HEADER, seq.data(), sz, nullptr); } }
  e->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0); e->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
  std::vector<uint8_t> fr((size_t)W * H * 3 / 2, Y);
  for (size_t i = (size_t)W * H; i + 1 < fr.size(); i += 2) { fr[i] = U; fr[i + 1] = V; }
  MFT_OUTPUT_STREAM_INFO si{}; e->GetOutputStreamInfo(0, &si);
  auto drain = [&]() {
    for (;;) {
      ComPtr<IMFSample> os; ComPtr<IMFMediaBuffer> ob; MFCreateSample(&os); MFCreateMemoryBuffer(si.cbSize ? si.cbSize : W * H * 2, &ob); os->AddBuffer(ob.Get());
      MFT_OUTPUT_DATA_BUFFER d{}; d.pSample = os.Get(); DWORD st = 0;
      HRESULT h2 = e->ProcessOutput(0, 1, &d, &st); if (d.pEvents) d.pEvents->Release();
      if (FAILED(h2)) break;
      BYTE* p = nullptr; DWORD len = 0; ob->Lock(&p, nullptr, &len);
      std::vector<uint8_t> v(p, p + len); ob->Unlock();
      if (out.empty() && !seq.empty() && !hasSps(v)) v.insert(v.begin(), seq.begin(), seq.end());
      if (!v.empty()) out.push_back(std::move(v));
    }
  };
  for (int i = 0; i < n; i++) {
    ComPtr<IMFSample> sm; ComPtr<IMFMediaBuffer> b; MFCreateSample(&sm); MFCreateMemoryBuffer((DWORD)fr.size(), &b);
    BYTE* p = nullptr; b->Lock(&p, nullptr, nullptr); memcpy(p, fr.data(), fr.size()); b->Unlock(); b->SetCurrentLength((DWORD)fr.size());
    sm->AddBuffer(b.Get()); sm->SetSampleTime((LONGLONG)i * 333333); sm->SetSampleDuration(333333);
    if (FAILED(e->ProcessInput(0, sm.Get(), 0))) { drain(); e->ProcessInput(0, sm.Get(), 0); }
    drain();
  }
  e->ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0); drain();
  if (out.empty()) { why = "encoder tidak menghasilkan frame"; return false; }
  return true;
}

static int selftest(bool warp) {
  if (!initD3D(warp)) return 2;
  registerClass();
  emit("ready %s", g_adapterName.c_str());
  HWND top = CreateWindowExW(0, L"KLMEngineMon", L"klm-engine selftest", WS_OVERLAPPEDWINDOW, 0, 0, 900, 400, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!top) { emit("SELFTEST GAGAL: jendela induk"); return 3; }
  char buf[64]; snprintf(buf, sizeof buf, "parent %llu", (unsigned long long)(uintptr_t)top);
  const char* cmds[] = { buf, "out 1280 720 60", "src a colour 255 0 0 0 0 0 0", "src b bars", "src g colour 0 0 255 255 255 0 1",
                         "pvw b", "pgm a", "rect pgm 0 0 400 225 1", "rect pvw 420 0 400 225 1" };
  for (auto c : cmds) command(c);
  int ok = 1, px[3];
  auto run = [&](int n) { for (int i = 0; i < n; i++) { pump(); frame(nowMs()); Sleep(5); } g_ctx->Flush(); };
  double t0 = nowMs(); run(60); double fps = 60 * 1000.0 / (nowMs() - t0);
  auto chk = [&](Bus& b, UINT x, UINT y, int r, int g, int bl, int tol, const char* what) {
    bool r1 = readPixel(b, x, y, px) && std::abs(px[0] - r) <= tol && std::abs(px[1] - g) <= tol && std::abs(px[2] - bl) <= tol;
    emit("  %s %s: (%d,%d,%d) harap (%d,%d,%d)", r1 ? "OK " : "GAGAL", what, px[0], px[1], px[2], r, g, bl);
    if (!r1) ok = 0;
  };
  chk(g_pgm, 640, 360, 255, 0, 0, 2, "Program = warna merah");
  chk(g_pvw, 90, 240, 192, 192, 192, 2, "Preview = color bars (abu)");
  chk(g_pvw, 1250, 240, 0, 0, 192, 2, "Preview = color bars (biru)");
  emit("  %s jendela tampil (pgm=%d pvw=%d)", g_pgm.shown && g_pvw.shown ? "OK " : "GAGAL", g_pgm.shown, g_pvw.shown);
  if (!g_pgm.shown || !g_pvw.shown) ok = 0;
  command("tbar 500 a b"); run(3);
  chk(g_pgm, 90, 240, 224, 96, 96, 4, "T-bar 50% merah→abu");
  command("tbar off"); command("trans 150 a b"); run(2);
  Sleep(200); run(3);
  chk(g_pgm, 90, 240, 192, 192, 192, 2, "Fade selesai: Program = color bars");
  emit("  %s Program id setelah transisi = %s", g_pgm.id == "b" ? "OK " : "GAGAL", g_pgm.id.c_str()); if (g_pgm.id != "b") ok = 0;
  command("pgm g"); run(3);
  chk(g_pgm, 2, 2, 0, 0, 255, 6, "Gradien linear (pojok kiri atas biru)");
  command("out 1920 1080 30"); run(3);
  chk(g_pgm, 1917, 1077, 255, 255, 0, 6, "Ganti resolusi 1080p (pojok kanan bawah kuning)");
  command("rect pgm 0 0 640 360 1"); run(3);
  emit("  %s ubah ukuran monitor (swapchain %ux%u)", g_pgm.scW == 640 ? "OK " : "GAGAL", g_pgm.scW, g_pgm.scH); if (g_pgm.scW != 640) ok = 0;
  // ---- Fase 2: grafis UTC dari tekstur NT bersama (seperti lapisan offscreen Chromium) + running text native
  command("pgm a"); run(2);
  {
    const UINT W = 1920, H = 1080; std::vector<uint32_t> px(W * H, 0);
    for (UINT i = 0; i < W * (H / 2); i++) px[i] = 0x80808080u; // separuh atas: putih 50% (premultiplied)
    D3D11_TEXTURE2D_DESC d{}; d.Width = W; d.Height = H; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    d.SampleDesc.Count = 1; d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET;
    d.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
    D3D11_SUBRESOURCE_DATA sd{ px.data(), W * 4, 0 };
    ComPtr<ID3D11Texture2D> sh; ComPtr<IDXGIResource1> r1; HANDLE hs = nullptr;
    bool okTex = SUCCEEDED(g_dev->CreateTexture2D(&d, &sd, &sh)) && SUCCEEDED(sh.As(&r1)) &&
                 SUCCEEDED(r1->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &hs));
    if (!okTex) emit("  (info) tekstur NT bersama tidak didukung perangkat ini — uji UTC dilewati");
    else {
      char c1[128]; snprintf(c1, sizeof c1, "utex lt %llu %u %u 7", (unsigned long long)(uintptr_t)hs, W, H);
      command(c1); command("ulay lt"); run(3);
      emit("  %s tekstur UTC diterima (utex=%llu, siap=%d)", g_utexN >= 1 ? "OK " : "GAGAL", g_utexN, g_ul["lt"].valid ? 1 : 0); if (g_utexN < 1) ok = 0;
      chk(g_pgm, 100, 100, 255, 128, 128, 3, "UTC putih 50% di atas merah");
      chk(g_pgm, 100, 900, 255, 0, 0, 2, "UTC transparan: Program tetap merah");
      char c2[256]; double t = unixMs();
      snprintf(c2, sizeof c2, "utk lt T1 %.3f 0 200 1920 100 400 0 0 0 %.3f 1", t - 1000, t);
      command(c2);
      std::vector<uint8_t> tile(400 * 100 * 4);
      for (size_t i = 0; i < 400 * 100; i++) { tile[i * 4] = 0; tile[i * 4 + 1] = 255; tile[i * 4 + 2] = 0; tile[i * 4 + 3] = 255; }
      command("ublob lt T1 0 400 100 160000", tile); run(3);
      chk(g_pgm, 50, 250, 0, 255, 0, 2, "Running text native (potongan hijau)");
      chk(g_pgm, 450, 250, 0, 255, 0, 2, "Running text berulang sepanjang lebar");
      chk(g_pgm, 50, 350, 255, 128, 128, 3, "Di luar jalur running text");
      command("utklive lt -"); run(2);
      chk(g_pgm, 50, 250, 255, 128, 128, 3, "Running text dilepas (kembali ke halaman)");
      command("ulay -"); run(2);
      chk(g_pgm, 100, 100, 255, 0, 0, 2, "UTC disembunyikan");
      { // tekstur bersama sebagai SUMBER biasa (Web Browser offscreen): alpha diabaikan → abu buram
        HANDLE h2 = nullptr; ComPtr<IDXGIResource1> r2; if (SUCCEEDED(sh.As(&r2))) r2->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &h2);
        char c3[128]; snprintf(c3, sizeof c3, "stex wb %llu %u %u 9", (unsigned long long)(uintptr_t)h2, W, H); command(c3); command("pgm wb"); run(3);
        chk(g_pgm, 100, 100, 128, 128, 128, 3, "Tekstur bersama sebagai sumber (Web Browser offscreen)");
        command("pgm a"); run(1);
      }
    }
  }
  // ---- Fase 3: kamera (pola uji) → monitor native + ekspor tekstur bersama ke KLM
  {
    command("camtest c1 640 360 30"); command("camexp c1 1"); command("pgm c1"); run(4);
    auto it = g_cams.find("c1"); bool have = it != g_cams.end();
    int busy = 0; unsigned long long sq = 0; if (have) { for (auto& sl : it->second->ring) busy += sl.busy ? 1 : 0; sq = it->second->seq; }
    emit("  %s kamera uji: frame=%d, ekspor seq=%llu, slot dipegang=%d", have && it->second->frames > 2 && sq >= 1 ? "OK " : "GAGAL", have ? it->second->frames.load() : 0, sq, busy);
    if (!have || sq < 1) ok = 0;
    emit("  %s cincin penuh → frame dilewati, tidak menumpuk (dipegang=%d)", busy == 3 ? "OK " : "GAGAL", busy); if (busy != 3) ok = 0;
    command("crel c1 1 0"); command("crel c1 1 1"); run(2);
    int p1[3], p2[3]; bool a = readPixel(g_pgm, 30, 540, p1), b = readPixel(g_pgm, 1890, 540, p2);
    auto isBg = [](int* q) { return std::abs(q[0] - 32) <= 2 && std::abs(q[1] - 160) <= 2 && std::abs(q[2] - 224) <= 2; };
    bool okc = a && b && (isBg(p1) || isBg(p2));
    emit("  %s kamera di monitor Program: (%d,%d,%d) / (%d,%d,%d) harap latar (32,160,224)", okc ? "OK " : "GAGAL", p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]); if (!okc) ok = 0;
    command("camoff c1"); command("pgm a"); run(2);
    emit("  %s kamera ditutup", g_cams.empty() ? "OK " : "GAGAL"); if (!g_cams.empty()) ok = 0;
    auto devs = listCams();
    emit("  (info) Media Foundation: %s, %d kamera, pengelola DXGI %s", g_mf ? "aktif" : "gagal", (int)devs.size(), g_mfMgr ? "ada" : "tidak ada");
    command("cam c2 1280 720 30 -"); run(1);
    if (g_cams.count("c2")) { Sleep(1500); run(3); emit("  (info) kamera nyata pertama: frame=%d", g_cams["c2"]->frames.load()); command("camoff c2"); }
  }
  // ---- Fase 4a: KLMCAM — frame H.264 terenkode → dekoder Media Foundation → Video Processor → monitor native
  {
    std::vector<std::vector<uint8_t>> h264; std::string why;
    if (!initMF() || !encTest(640, 360, 20, 150, 128, 128, h264, why)) emit("  (info) uji dekoder KLMCAM dilewati: %s", why.c_str());
    else {
      size_t tot = 0; for (auto& f : h264) tot += f.size();
      emit("  (info) potongan H.264 uji: %d frame, %zu byte, SPS di frame pertama=%d", (int)h264.size(), tot, hasSps(h264[0]) ? 1 : 0);
      // dikirim berirama seperti dari jaringan (±30 fps, sedikit jitter) → jadwal tayang menayangkan frame satu per satu
      for (size_t i = 0; i < h264.size(); i++) { char b[96]; snprintf(b, sizeof b, "kenc kt %d %lld %zu", i == 0 ? 1 : 0, (long long)i * 333333, h264[i].size()); command(b, h264[i]); run(1); Sleep(i % 3 == 0 ? 20 : 30); }
      double t0 = nowMs(); while (nowMs() - t0 < 4000 && !(g_cams.count("kt") && g_cams["kt"]->frames > 5)) { run(1); Sleep(20); }
      int fr = g_cams.count("kt") ? g_cams["kt"]->frames.load() : 0;
      bool d3d = g_kdec.count("kt") && g_kdec["kt"]->d3d;
      emit("  %s dekoder KLMCAM: %d frame terdekode (%s)", fr > 5 ? "OK " : "GAGAL", fr, d3d ? "DXVA GPU" : "perangkat lunak"); if (fr <= 5) ok = 0;
      command("pgm kt"); run(3);
      chk(g_pgm, 960, 540, 156, 156, 156, 8, "KLMCAM terdekode di Program (abu Y=150)");
      command("kdecoff kt"); command("pgm a"); run(2);
      emit("  %s dekoder KLMCAM dihentikan", !g_kdec.count("kt") ? "OK " : "GAGAL"); if (g_kdec.count("kt")) ok = 0;
      { // frame hilang di tengah (paket jaringan hilang) → frame sesudahnya TIDAK didekode (tanpa bercak), mesin minta frame kunci
        for (size_t i = 0; i < h264.size(); i++) { if (i == 6) continue; char b[96]; snprintf(b, sizeof b, "kenc kg %d %lld %zu", i == 0 ? 1 : 0, (long long)i * 333333, h264[i].size()); command(b, h264[i]); }
        for (int r = 0; r < 20; r++) { run(1); Sleep(15); }
        const bool has = g_kdec.count("kg") > 0; const int lg = has ? g_kdec["kg"]->log2MaxFn : 0, gp = has ? g_kdec["kg"]->gaps + (g_kdec["kg"]->waitKey ? 1 : 0) : 0, dr = has ? g_kdec["kg"]->drops : 0;
        const bool pass = has && lg > 0 && gp > 0 && dr == (int)h264.size() - 7;
        emit("  %s KLMCAM frame hilang terdeteksi (frame_num, log2 %d): %d frame sesudahnya tidak didekode, menunggu frame kunci", pass ? "OK " : "GAGAL", lg, dr); if (!pass) ok = 0;
        command("kdecoff kg"); run(1);
      }
    }
  }
  // ---- Fase 4b: output native — rekam MP4 terfragmentasi & MPEG-TS dari Program mesin native (H.264 + AAC)
  if (initMF()) {
    command("out 640 360 30"); command("camtest c9 640 360 30"); command("pgm c9"); run(2);
    wchar_t tmp[MAX_PATH]; GetTempPathW(MAX_PATH, tmp);
    std::wstring mp4 = std::wstring(tmp) + L"klm-selftest.mp4", tsf = std::wstring(tmp) + L"klm-selftest.ts";
    DeleteFileW(mp4.c_str()); DeleteFileW(tsf.c_str());
    std::vector<uint8_t> pcm(960 * 4); double ph = 0;
    auto sine = [&]() { for (int i = 0; i < 960; i++) { short v = (short)(std::sin(ph) * 8000); ph += 2 * 3.14159265 * 440 / 48000; memcpy(&pcm[i * 4], &v, 2); memcpy(&pcm[i * 4 + 2], &v, 2); } };
    auto realtime = [&](int n) { for (int i = 0; i < n; i++) { pump(); frame(nowMs()); sine(); oAudio(pcm); Sleep(33); } };
    auto verify = [&](const std::wstring& f, const char* what, int minFrames) {
      ComPtr<IMFSourceReader> rd; HRESULT h2 = MFCreateSourceReaderFromURL(f.c_str(), nullptr, &rd);
      if (FAILED(h2)) { emit("  GAGAL %s tidak bisa dibuka lagi (0x%08lx)", what, (unsigned long)h2); ok = 0; return; }
      PROPVARIANT pv; PropVariantInit(&pv); double durS = 0;
      if (SUCCEEDED(rd->GetPresentationAttribute((DWORD)MF_SOURCE_READER_MEDIASOURCE, MF_PD_DURATION, &pv)) && pv.vt == VT_UI8) durS = pv.uhVal.QuadPart / 1e7;
      PropVariantClear(&pv);
      ComPtr<IMFMediaType> at; bool aud = SUCCEEDED(rd->GetCurrentMediaType((DWORD)MF_SOURCE_READER_FIRST_AUDIO_STREAM, &at));
      int vf = 0; for (int i = 0; i < 1000; i++) { DWORD si = 0, fl = 0; LONGLONG t2 = 0; ComPtr<IMFSample> sm; if (FAILED(rd->ReadSample((DWORD)MF_SOURCE_READER_FIRST_VIDEO_STREAM, 0, &si, &fl, &t2, &sm)) || (fl & MF_SOURCE_READERF_ENDOFSTREAM)) break; if (sm) vf++; }
      WIN32_FILE_ATTRIBUTE_DATA fa{}; GetFileAttributesExW(f.c_str(), GetFileExInfoStandard, &fa);
      bool good = vf >= minFrames && aud;
      emit("  %s %s: %d frame video, audio=%d, durasi=%.2f s, %lu KB", good ? "OK " : "GAGAL", what, vf, aud ? 1 : 0, durS, fa.nFileSizeLow / 1024);
      if (!good) ok = 0;
    };
    command(("ostart o1 file 640 360 30 2000 128 0 " + hexOf(narrow(mp4.c_str()))).c_str());
    if (!g_out.count("o1")) { emit("  GAGAL output MP4 tidak mulai"); ok = 0; }
    else {
      emit("  (info) encoder: %s (%s, frame lewat %s)", g_out["o1"]->enc.c_str(), g_out["o1"]->hw ? "hardware" : "perangkat lunak", g_out["o1"]->cpu ? "memori" : "GPU");
      realtime(90); command("ostop o1");
      verify(mp4, "rekam MP4 native", 60);
    }
    HANDLE th = CreateFileW(tsf.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (th == INVALID_HANDLE_VALUE || !oStart("o2", true, 640, 360, 30, 2000, 128, true, "", th)) { emit("  GAGAL output MPEG-TS tidak mulai"); ok = 0; }
    else {
      realtime(60); oStop("o2");
      unsigned char b5[8] = { 0 }; HANDLE rh = CreateFileW(tsf.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr); DWORD rd2 = 0;
      if (rh != INVALID_HANDLE_VALUE) { ReadFile(rh, b5, 8, &rd2, nullptr); CloseHandle(rh); }
      // TS 188 byte, M2TS 192 byte (4 byte kode waktu di depan), atau MPEG-2 Program Stream (00 00 01 BA) — semua dibaca ffmpeg
      const char* kind = b5[0] == 0x47 ? "TS 188" : b5[4] == 0x47 ? "M2TS 192" : (b5[0] == 0 && b5[1] == 0 && b5[2] == 1 && b5[3] == 0xBA) ? "MPEG-2 PS" : nullptr;
      emit("  %s wadah aliran: %s (%02x %02x %02x %02x %02x %02x %02x %02x)", kind ? "OK " : "GAGAL", kind ? kind : "tidak dikenal", b5[0], b5[1], b5[2], b5[3], b5[4], b5[5], b5[6], b5[7]); if (!kind) ok = 0;
      verify(tsf, "streaming MPEG-TS native", 30);
    }
    // ---- Fase 5: file video (MP4 hasil rekam di atas) & gambar BMP
    {
      command(("src v1 video " + hexOf(narrow(mp4.c_str()))).c_str()); command("vt v1 1.0 0 1"); command("pgm v1");
      double t0 = nowMs(); while (nowMs() - t0 < 4000 && !(g_cams.count("v1") && g_cams["v1"]->frames > 0)) { run(1); Sleep(15); }
      run(3);
      int q1[3], q2[3]; bool a1 = readPixel(g_pgm, 20, 180, q1), a2 = readPixel(g_pgm, 620, 180, q2);
      auto nearBg = [](int* q) { return std::abs(q[0] - 32) <= 14 && std::abs(q[1] - 160) <= 14 && std::abs(q[2] - 224) <= 14; };
      bool okv = a1 && a2 && (nearBg(q1) || nearBg(q2));
      emit("  %s file video (diam di 1,0 s): (%d,%d,%d) / (%d,%d,%d) harap latar ±(32,160,224)", okv ? "OK " : "GAGAL", q1[0], q1[1], q1[2], q2[0], q2[1], q2[2]); if (!okv) ok = 0;
      int f0 = g_cams.count("v1") ? g_cams["v1"]->frames.load() : 0;
      command("vt v1 0.2 1 1"); double t1 = nowMs(); while (nowMs() - t1 < 1200) { run(1); Sleep(15); }
      int f1 = g_cams.count("v1") ? g_cams["v1"]->frames.load() : 0;
      emit("  %s file video diputar: %d frame dalam 1,2 s", f1 - f0 >= 15 ? "OK " : "GAGAL", f1 - f0); if (f1 - f0 < 15) ok = 0;
      command("vt v1 0.5 0 1"); run(5);
      command("del v1"); run(1);
      emit("  %s file video ditutup", !g_vplay.count("v1") ? "OK " : "GAGAL"); if (g_vplay.count("v1")) ok = 0;
      // gambar: BMP 64×32 warna (200,50,100)
      std::wstring bmp = std::wstring(tmp) + L"klm-selftest.bmp";
      { const int W = 64, H = 32; std::vector<uint8_t> f(54 + W * H * 3, 0); f[0] = 'B'; f[1] = 'M'; uint32_t sz = (uint32_t)f.size(), off = 54, hs = 40;
        memcpy(&f[2], &sz, 4); memcpy(&f[10], &off, 4); memcpy(&f[14], &hs, 4); int32_t w = W, h = H; memcpy(&f[18], &w, 4); memcpy(&f[22], &h, 4); f[26] = 1; f[28] = 24;
        for (int i = 0; i < W * H; i++) { f[54 + i * 3] = 100; f[54 + i * 3 + 1] = 50; f[54 + i * 3 + 2] = 200; }
        HANDLE fh = CreateFileW(bmp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr); DWORD wr = 0; if (fh != INVALID_HANDLE_VALUE) { WriteFile(fh, f.data(), (DWORD)f.size(), &wr, nullptr); CloseHandle(fh); } }
      command(("src i1 image " + hexOf(narrow(bmp.c_str()))).c_str()); command("pgm i1"); run(2);
      chk(g_pgm, 320, 180, 200, 50, 100, 2, "Gambar (BMP lewat WIC) di Program");
      command("del i1");
      // ---- Fase 6: GIF bergerak, gambar raster dari KLM, aliran langsung, audio native, geser A/V
      const uint8_t pal[12] = { 255, 0, 0, 0, 0, 255, 0, 255, 0, 255, 255, 255 };
      auto gif = makeGif(8, 4, { 0, 1 }, pal, 20);
      std::wstring gf = std::wstring(tmp) + L"klm-selftest.gif";
      { HANDLE fh = CreateFileW(gf.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr); DWORD wr = 0; if (fh != INVALID_HANDLE_VALUE) { WriteFile(fh, gif.data(), (DWORD)gif.size(), &wr, nullptr); CloseHandle(fh); } }
      command(("src g1 image " + hexOf(narrow(gf.c_str()))).c_str()); command("pgm g1"); run(1);
      size_t nfr = g_src.count("g1") ? g_src["g1"]->frames.size() : 0;
      emit("  %s GIF bergerak: %d frame, total %.0f ms", nfr == 2 ? "OK " : "GAGAL", (int)nfr, g_src.count("g1") ? g_src["g1"]->animTotal : 0); if (nfr != 2) ok = 0;
      { bool sawR = false, sawB = false; double t0g = nowMs(); int px[3];
        while (nowMs() - t0g < 700) { run(1); if (readPixel(g_pgm, 320, 180, px)) { if (px[0] > 200 && px[2] < 50) sawR = true; if (px[2] > 200 && px[0] < 50) sawB = true; } Sleep(30); }
        emit("  %s GIF dianimasikan (merah=%d biru=%d)", sawR && sawB ? "OK " : "GAGAL", sawR, sawB); if (!(sawR && sawB)) ok = 0; }
      command("del g1");
      std::vector<uint8_t> rgba(16 * 16 * 4); for (size_t i = 0; i < 256; i++) { rgba[i * 4] = 10; rgba[i * 4 + 1] = 220; rgba[i * 4 + 2] = 30; rgba[i * 4 + 3] = 255; }
      command("srcimg r1 16 16 1024", rgba); command("pgm r1"); run(2);
      chk(g_pgm, 320, 180, 10, 220, 30, 2, "Gambar raster dari KLM (SVG / internet)");
      command("del r1");
      command(("src l1 live " + hexOf(narrow(mp4.c_str()))).c_str()); command("pgm l1");
      { double tl = nowMs(); while (nowMs() - tl < 2500) { run(1); Sleep(15); } }
      int lf = g_cams.count("l1") ? g_cams["l1"]->frames.load() : 0;
      emit("  %s aliran langsung (mode live): %d frame dalam 2,5 s", lf >= 30 ? "OK " : "GAGAL", lf); if (lf < 30) ok = 0;
      command("del l1");
      { std::lock_guard<std::mutex> l(g_fd4Mx); g_testPcmCapture = true; g_testPcm.clear(); }
      command(("src v2 video " + hexOf(narrow(mp4.c_str()))).c_str()); command("vt v2 0.3 1 1"); command("naud v2 1");
      { double ta = nowMs(); while (nowMs() - ta < 1500) { run(1); Sleep(15); } }
      command("naud v2 0"); command("del v2"); run(2);
      size_t pb; uint32_t rate0 = 0; std::string id0;
      { std::lock_guard<std::mutex> l(g_fd4Mx); g_testPcmCapture = false; pb = g_testPcm.size();
        if (pb > 10) { uint8_t il = g_testPcm[4]; id0.assign((const char*)&g_testPcm[5], il); memcpy(&rate0, &g_testPcm[5 + il], 4); } }
      emit("  %s audio file video native: %zu byte PCM (id=%s, %u Hz)", pb > 48000 && id0 == "v2" ? "OK " : "GAGAL", pb, id0.c_str(), rate0); if (!(pb > 48000 && id0 == "v2")) ok = 0;
      command("avoff 120"); emit("  %s geser A/V output native = %d ms", g_avOff == 120 ? "OK " : "GAGAL", g_avOff); if (g_avOff != 120) ok = 0; command("avoff 0");
      // ---- Fase 7: komposisi berlapis (Virtual Set / PiP), overlay, tangkap jendela (Web Browser)
      command("src a colour 255 0 0 0 0 0 0"); command("src b bars"); command("src gg colour 0 255 0 0 0 0 0");
      command("comp c1 a 1 0 - b,0.25,0.25,0.5,0.5,0,1,0,0,0,0,0,0,0,1,0.4,10,ffffff,-,0,-,0,0,0,0"); command("pgm c1"); run(3);
      chk(g_pgm, 320, 180, 0, 192, 0, 3, "Virtual Set: isi kotak (color bars hijau di tengah)");
      chk(g_pgm, 162, 92, 255, 0, 0, 3, "Virtual Set: sudut bulat (latar terlihat di sudut kotak)");
      chk(g_pgm, 158, 180, 255, 255, 255, 3, "Virtual Set: bingkai putih");
      chk(g_pgm, 50, 50, 255, 0, 0, 3, "Virtual Set: latar di luar kotak");
      command("pgm a"); command("ovl gg,0.5,0,0,1"); run(2);
      chk(g_pgm, 320, 180, 128, 128, 0, 3, "Overlay fade 50% di atas Program");
      command("ovl gg,1,0.5,0,1"); run(2);
      chk(g_pgm, 100, 180, 255, 0, 0, 2, "Overlay geser: kiri masih Program");
      chk(g_pgm, 500, 180, 0, 255, 0, 2, "Overlay geser: kanan overlay");
      command("ovl"); command("del c1"); run(1);
      // ---- Fase 8: rotasi, efek, latar AI, transisi, overlay zoom, FTB
      command("ovl gg,1,0,0,1,0.5"); run(2);
      chk(g_pgm, 320, 180, 0, 255, 0, 2, "Overlay zoom 50%: tengah overlay");
      chk(g_pgm, 20, 20, 255, 0, 0, 2, "Overlay zoom 50%: pojok tetap Program");
      command("ovl"); command("ftb 0.5"); run(2);
      chk(g_pgm, 320, 180, 128, 0, 0, 3, "FTB 50% di atas Program");
      command("ftb 0"); run(1);
      struct TrT { const char* cmd; UINT x, y; int r, g, b; const char* what; };
      const TrT trs[] = {
        { "tbar 500 a gg wipe", 100, 180, 0, 255, 0, "Transisi wipe 50%: kiri sumber baru" }, { "tbar 500 a gg wipe", 540, 180, 255, 0, 0, "Transisi wipe 50%: kanan sumber lama" },
        { "tbar 500 a gg slide", 100, 180, 255, 0, 0, "Transisi slide 50%: kiri sumber lama" }, { "tbar 500 a gg slide", 540, 180, 0, 255, 0, "Transisi slide 50%: kanan sumber baru" },
        { "tbar 500 a gg circle", 320, 180, 0, 255, 0, "Transisi circle 50%: tengah sumber baru" }, { "tbar 500 a gg circle", 10, 10, 255, 0, 0, "Transisi circle 50%: pojok sumber lama" },
        { "tbar 500 a gg zoom", 320, 180, 64, 128, 0, "Transisi zoom 50%" }, { "tbar 500 a gg blur", 320, 180, 128, 128, 0, "Transisi blur 50% (buram gaussian)" },
        { "tbar 250 a gg dip", 320, 180, 223, 0, 0, "Transisi dip ke hitam 25%" }, { "tbar 500 a gg barn", 320, 180, 0, 255, 0, "Transisi barn door 50%: tengah" },
        { "tbar 500 a gg barn", 20, 180, 255, 0, 0, "Transisi barn door 50%: tepi" }, { "tbar 500 a gg cube", 100, 180, 179, 0, 0, "Transisi cube 50%: sisi lama digelapkan" } };
      for (auto& t : trs) { command(t.cmd); run(2); chk(g_pgm, t.x, t.y, t.r, t.g, t.b, 4, t.what); }
      command("tbar off"); command("pgm a"); run(1);
      command("comp c2 a 1 0 - gg,0.25,0.25,0.5,0.5,2,1,0,0,0,0,0,0,0,1,0,0,-,-,0,-,0,0,0,0,45"); command("pgm c2"); run(2);
      chk(g_pgm, 320, 180, 0, 255, 0, 2, "Rotasi kotak 45°: tengah");
      chk(g_pgm, 320, 96, 0, 255, 0, 2, "Rotasi kotak 45°: tepi atas kotak tertutup");
      chk(g_pgm, 166, 96, 255, 0, 0, 2, "Rotasi kotak 45°: sudut kotak (klip tetap tegak)");
      command("del c2"); command("ipos gg 2 0.5 0 0 0 0 0 0 90"); command("pgm gg"); run(2);
      chk(g_pgm, 320, 40, 0, 255, 0, 2, "Rotasi input 90°: atas (tegak)");
      chk(g_pgm, 200, 180, 0, 0, 0, 2, "Rotasi input 90°: samping kosong");
      command("ipos gg -"); command("fx a 1 0 1 0 0 1 0 00ff00 0.4 0.08 0.1 0 0.05 0.15"); command("pgm a"); run(2);
      chk(g_pgm, 320, 180, 54, 54, 54, 3, "Koreksi warna native (saturasi 0)");
      command("fx a -"); command("fx gg 0 0 1 1 0 1 1 00ff00 0.4 0.08 0.1 0 0.05 0.15"); command("ovl gg,1,0,0,1"); run(2);
      chk(g_pgm, 320, 180, 255, 0, 0, 2, "Chroma key native (overlay hijau dihapus)");
      command("ovl"); command("fx gg -"); command("seg gg 2 3 14 0000ff - 0 0 0 1 0");
      { std::vector<uint8_t> m(16); for (int i = 0; i < 16; i++) m[i] = (i % 4) < 2 ? 255 : 0; command("segm gg 4 4 16", m); }
      command("pgm gg"); run(2);
      chk(g_pgm, 80, 180, 0, 255, 0, 3, "Latar AI native: orang (mask) tetap");
      chk(g_pgm, 560, 180, 0, 0, 255, 3, "Latar AI native: latar diganti warna");
      command("seg gg -"); command("pgm a"); run(1);
      // ---- Fase 10: zoom digital (potong tengah) — comp kiri merah / kanan hijau? pakai bars: zoom 4× → tengah bars saja
      command("pgm b"); run(1);
      { SrcView bv; getSrv("b", bv); command("szoom b 8"); run(2);
        D3D11_TEXTURE2D_DESC d{}; g_pgm.rt->GetDesc(&d); int l[3] = { 0 }, l1[3] = { 0 }; readPixel(g_pgm, 2, d.Height / 2, l);
        command("szoom b 1"); run(2); readPixel(g_pgm, 2, d.Height / 2, l1);
        const bool pass = (l[0] != l1[0] || l[1] != l1[1] || l[2] != l1[2]);
        emit("  %s zoom digital KLMCAM (szoom 8×): tepi kiri %d,%d,%d (tanpa zoom %d,%d,%d)", pass ? "OK " : "GAGAL", l[0], l[1], l[2], l1[0], l1[1], l1[2]); if (!pass) ok = 0; (void)bv; }
      command("pgm a"); run(1);
      // ---- Fase 10: kartu daftar input native — jendela anak per kartu, terpotong bila kartu tergulir sebagian
      command("card t1 b 20 30 256 144 20 60 256 114 - 0.6 0.4 1"); for (int r = 0; r < 4; r++) run(1);
      { auto it = g_cards.find("t1"); RECT wr{}; bool vis = false; if (it != g_cards.end() && it->second->b.hwnd) { vis = (GetWindowLongW(it->second->b.hwnd, GWL_STYLE) & WS_VISIBLE) != 0; // induk uji bisa tersembunyi GetWindowRect(it->second->b.hwnd, &wr); MapWindowPoints(HWND_DESKTOP, g_parent, (POINT*)&wr, 2); }
        const bool pass = it != g_cards.end() && it->second->b.shown && vis && wr.left == 20 && wr.top == 60 && wr.right - wr.left == 256 && wr.bottom - wr.top == 114;
        emit("  %s kartu input native: jendela %ld,%ld %ldx%ld (harap 20,60 256x114 — bagian atas tergulir)", pass ? "OK " : "GAGAL", wr.left, wr.top, wr.right - wr.left, wr.bottom - wr.top); if (!pass) ok = 0; }
      command("card t1 - 0 0 0 0 0 0 0 0 - -1 -1 1"); run(2);
      { auto it = g_cards.find("t1"); const bool hid = it != g_cards.end() && !it->second->b.shown; emit("  %s kartu input native disembunyikan", hid ? "OK " : "GAGAL"); if (!hid) ok = 0; }
      command("cardoff *"); run(1);
      // ---- Fase 9: grid Preview (ukuran monitor khusus) & stinger transparan
      command("comp Gt - 1 0 - -,0,0,1,1,0,1,0,0,0,0,0,0,0,1,0,0,-,15181e,0,-,0,0,0,0 a,0.02,0.02,0.46,0.96,3,1,0,0,0,0,0,0,0,1,0,0,-,000000,0,-,0,0,0,0 gg,0.52,0.02,0.46,0.96,3,1,0,0,0,0,0,0,0,1,0,0,-,000000,0,-,0,0,0,0");
      command("bsize pvw 400 600"); command("pvw Gt"); run(2);
      { D3D11_TEXTURE2D_DESC bd{}; if (g_pvw.rt) g_pvw.rt->GetDesc(&bd); const bool okSz = bd.Width == 400 && bd.Height == 600;
        emit("  %s grid Preview: ukuran monitor khusus %ux%u", okSz ? "OK " : "GAGAL", bd.Width, bd.Height); if (!okSz) ok = 0; }
      chk(g_pvw, 100, 300, 255, 0, 0, 2, "Grid Preview: kotak 1 (fit, tidak gepeng)");
      chk(g_pvw, 300, 300, 0, 255, 0, 2, "Grid Preview: kotak 2");
      chk(g_pvw, 100, 30, 0, 0, 0, 2, "Grid Preview: latar hitam kotak (sumber 16:9 di kotak tegak)");
      chk(g_pvw, 200, 300, 21, 24, 30, 2, "Grid Preview: garis antar kotak");
      command("bsize pvw 0 0"); command("del Gt"); command("pvw b"); run(1);
      { // stinger: tekstur premultiplied setengah transparan (biru 50%) + cut 200 ms
        D3D11_TEXTURE2D_DESC d{}; d.Width = 64; d.Height = 36; d.MipLevels = 1; d.ArraySize = 1; d.Format = DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count = 1;
        d.Usage = D3D11_USAGE_DEFAULT; d.BindFlags = D3D11_BIND_SHADER_RESOURCE | D3D11_BIND_RENDER_TARGET; d.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
        std::vector<uint32_t> px(64 * 36, (0x80u << 24) | 0x80u); // BGRA premultiplied: biru 50% (B = 128, A = 128)
        D3D11_SUBRESOURCE_DATA sd{ px.data(), 64 * 4, 0 };
        ComPtr<ID3D11Texture2D> t; ComPtr<IDXGIResource1> r; HANDLE h2 = nullptr;
        if (SUCCEEDED(g_dev->CreateTexture2D(&d, &sd, &t)) && SUCCEEDED(t.As(&r)) && SUCCEEDED(r->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ | DXGI_SHARED_RESOURCE_WRITE, nullptr, &h2))) {
          char c3[128]; snprintf(c3, sizeof c3, "ptex stg %llu 64 36 1", (unsigned long long)(uintptr_t)h2); command(c3); run(2);
          command("pgm a"); command("trans 100000 a gg stinger stg 300"); run(2);
          chk(g_pgm, 320, 180, 128, 0, 128, 3, "Stinger: sumber lama + video transparan premultiplied sebelum cut");
          Sleep(350); run(2);
          chk(g_pgm, 320, 180, 0, 128, 128, 3, "Stinger: sumber baru setelah titik cut");
          command("tbar off"); g_tr.on = false; command("pgm a"); run(1);
        } else { emit("  GAGAL membuat tekstur uji stinger"); ok = 0; }
      }
      { // ---- Fase 9: Latar AI native — model segmentasi .tflite dijalankan interpreter GPU sendiri, dibandingkan dengan TensorFlow Lite resmi
        wchar_t mp[MAX_PATH] = L"", rp[MAX_PATH] = L"";
        if (!GetEnvironmentVariableW(L"KLM_SEG_MODEL", mp, MAX_PATH)) emit("  (info) KLM_SEG_MODEL tidak diisi — uji Latar AI native dilewati");
        else {
          std::string info; const double t0 = nowMs(); const bool l = segm::load(mp, info);
          emit("  %s Latar AI native: model dimuat %.0f ms — %s", l ? "OK " : "GAGAL", nowMs() - t0, l ? info.c_str() : segm::M.err.c_str()); if (!l) ok = 0;
          if (l && GetEnvironmentVariableW(L"KLM_SEG_REF", rp, MAX_PATH)) {
            auto rdf = [](const std::wstring& f, std::vector<float>& v) { FILE* fp = _wfopen(f.c_str(), L"rb"); if (!fp) return false; fseek(fp, 0, SEEK_END); long n = ftell(fp); fseek(fp, 0, SEEK_SET); v.resize(n / 4); size_t r = fread(v.data(), 4, v.size(), fp); fclose(fp); return r == v.size() && !v.empty(); };
            std::vector<float> in, ref, got; const std::wstring dir = rp;
            if (!rdf(dir + L"\\in.bin", in) || !rdf(dir + L"\\out.bin", ref)) { emit("  GAGAL membaca referensi Latar AI"); ok = 0; }
            else {
              segm::upload(segm::M.input, in); segm::runOps(); g_ctx->Flush();
              const double t1 = nowMs(); for (int r = 0; r < 3; r++) segm::runOps(); segm::readBack(segm::M.output, got); const double per = (nowMs() - t1) / 3;
              double mx = 0, mean = 0; size_t inter = 0, uni = 0; const size_t n = std::min(got.size(), ref.size());
              for (size_t i = 0; i < n; i++) { const double dd = std::fabs(got[i] - ref[i]); mx = std::max(mx, dd); mean += dd; const bool a = got[i] > 0.5f, b = ref[i] > 0.5f; inter += a && b; uni += a || b; }
              mean /= std::max<size_t>(1, n); const double iou = uni ? (double)inter / uni : 1.0;
              const bool pass = n == ref.size() && mean < 0.01 && iou > 0.97;
              emit("  %s Latar AI native = TensorFlow Lite: selisih rata-rata %.5f, maks %.4f, IoU orang %.4f (%zu nilai, %.1f ms/inferensi di %s)", pass ? "OK " : "GAGAL", mean, mx, iou, n, per, g_warp ? "WARP" : "GPU");
              if (!pass) ok = 0;
              // ujung ke ujung: foto uji sebagai sumber → normalisasi dari metadata → mask native → latar diganti warna biru di Program
              const int H = segm::M.IH, W = segm::M.IW; std::vector<float> img; if (!rdf(dir + L"\\img.bin", img) || img.size() < (size_t)W * H * 3) img = in;
              std::vector<uint8_t> rgba((size_t)W * H * 4);
              for (int i = 0; i < W * H; i++) { for (int c = 0; c < 3; c++) rgba[i * 4 + c] = (uint8_t)std::lround(std::min(1.f, std::max(0.f, img[i * 3 + c])) * 255); rgba[i * 4 + 3] = 255; }
              char cmdl[96]; snprintf(cmdl, sizeof cmdl, "srcimg sgimg %d %d %zu", W, H, rgba.size()); command(cmdl, rgba);
              command("seg sgimg 2 0 14 0000ff - 0 0 0 1 0 1 0.5 0 0 1.6 0"); command("pgm sgimg"); for (int r = 0; r < 14; r++) { run(1); Sleep(35); }
              const SegN& sgn = g_seg["sgimg"];
              emit("  %s Latar AI native berjalan di frame: %d inferensi, orang=%d, kotak %.2f,%.2f %.2fx%.2f", sgn.infN > 0 ? "OK " : "GAGAL", sgn.infN, sgn.person ? 1 : 0, sgn.box[0], sgn.box[1], sgn.box[2], sgn.box[3]); if (sgn.infN <= 0) ok = 0;
              const UINT side = std::min(g_W, g_H), ox = (g_W - side) / 2; // gambar persegi di tengah (fit)
              int px = -1, py = -1, bx = -1, by = -1; // titik orang yakin (≥0,97) & latar yakin (≤0,02) menurut TensorFlow Lite
              for (int y = H / 8; y < H - H / 8 && px < 0; y += 4) for (int x = W / 8; x < W - W / 8; x += 4) if (ref[(size_t)y * W + x] >= 0.97f && ref[(size_t)(y + 3) * W + x] >= 0.97f && ref[(size_t)y * W + x + 3] >= 0.97f) { px = x; py = y; break; }
              for (int k = 0; k < 4 && bx < 0; k++) { const int x = k & 1 ? W - 10 : 9, y = k & 2 ? H - 10 : 9; if (ref[(size_t)y * W + x] <= 0.02f) { bx = x; by = y; } }
              auto sx = [&](int x) { return ox + (UINT)((x + 0.5) * side / W); }; auto sy = [&](int y) { return (UINT)((y + 0.5) * side / H); };
              if (px >= 0) {
                int mv = -1; // nilai mask native di titik itu (baca balik tekstur mask)
                if (sgn.nTex) { D3D11_TEXTURE2D_DESC md{}; sgn.nTex->GetDesc(&md); md.Usage = D3D11_USAGE_STAGING; md.BindFlags = 0; md.CPUAccessFlags = D3D11_CPU_ACCESS_READ; ComPtr<ID3D11Texture2D> st;
                  if (SUCCEEDED(g_dev->CreateTexture2D(&md, nullptr, &st))) { g_ctx->CopyResource(st.Get(), sgn.nTex.Get()); D3D11_MAPPED_SUBRESOURCE m; if (SUCCEEDED(g_ctx->Map(st.Get(), 0, D3D11_MAP_READ, 0, &m))) { mv = ((const uint8_t*)m.pData)[(size_t)py * m.RowPitch + px]; g_ctx->Unmap(st.Get(), 0); } } }
                emit("  %s Latar AI native: mask di titik orang = %d/255 (TensorFlow %.3f)", mv >= 230 ? "OK " : "GAGAL", mv, ref[(size_t)py * W + px]); if (mv < 230) ok = 0;
                const size_t q = ((size_t)py * W + px) * 3; chk(g_pgm, sx(px), sy(py), (int)std::lround(img[q] * 255), (int)std::lround(img[q + 1] * 255), (int)std::lround(img[q + 2] * 255), 28, "Latar AI native: orang tetap (titik yakin menurut TensorFlow)");
              }
              else emit("  (info) referensi tidak menemukan titik orang yakin — cek piksel orang dilewati");
              if (bx >= 0) chk(g_pgm, sx(bx), sy(by), 0, 0, 255, 12, "Latar AI native: latar diganti warna");
              command("seg sgimg -"); command("del sgimg"); command("pgm a"); run(1);
            }
          }
        }
      }
      { // jendela uji berwarna, ditangkap lewat Windows.Graphics.Capture
        WNDCLASSEXW wc{ sizeof wc }; wc.lpfnWndProc = DefWindowProcW; wc.hInstance = GetModuleHandleW(nullptr); wc.lpszClassName = L"KLMWgcTest"; wc.hbrBackground = CreateSolidBrush(RGB(30, 200, 90));
        RegisterClassExW(&wc);
        HWND tw = CreateWindowExW(0, L"KLMWgcTest", L"klm wgc", WS_OVERLAPPEDWINDOW | WS_VISIBLE, 60, 60, 260, 200, nullptr, nullptr, wc.hInstance, nullptr);
        UpdateWindow(tw); for (int i = 0; i < 20; i++) { pump(); Sleep(10); }
        char cw[96]; snprintf(cw, sizeof cw, "src w1 window %llu", (unsigned long long)(uintptr_t)tw); command(cw); command("pgm w1");
        double tw0 = nowMs(); while (nowMs() - tw0 < 2500 && !(g_src.count("w1") && g_src["w1"]->got)) { run(1); Sleep(20); }
        if (!g_src.count("w1")) emit("  (info) tangkap jendela tidak tersedia di mesin ini — dilewati");
        else if (!g_src["w1"]->got) emit("  (info) tangkap jendela belum menerima frame di mesin CI (tanpa sesi desktop aktif?) — dilewati");
        else { run(2); chk(g_pgm, 320, 180, 30, 200, 90, 6, "Tangkap jendela (Web Browser) di Program"); }
        command("del w1"); command("pgm a"); DestroyWindow(tw); run(1);
      }
    }
    command("camoff c9"); command("pgm a"); command("out 1920 1080 30"); run(2);
  }
  command("src s screen 0 0 1024 768"); run(10);
  emit("  (info) tangkap layar DXGI: %s", g_src.count("s") && g_src["s"]->dup ? "tersedia" : "tidak tersedia di mesin ini (wajar di CI tanpa sesi desktop)");
  command("rect pvw 0 0 0 0 0"); run(2);
  emit("  %s sembunyikan Preview", !g_pvw.shown ? "OK " : "GAGAL"); if (g_pvw.shown) ok = 0;
  sendStats((int)std::lround(fps), 0);
  emit(ok ? "SELFTEST OK (%.0f fps, %s)" : "SELFTEST GAGAL (%.0f fps, %s)", fps, g_adapterName.c_str());
  DestroyWindow(top);
  return ok ? 0 : 1;
}

// ---------------------------------------------------------------- utama
int wmain(int argc, wchar_t** argv) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  CoInitializeEx(nullptr, COINIT_MULTITHREADED); // Media Foundation (kamera)
  _set_invalid_parameter_handler([](const wchar_t*, const wchar_t*, const wchar_t*, unsigned, uintptr_t) {}); // fd 3 tidak ada → jangan berhenti
  { intptr_t h3 = _get_osfhandle(3); if (h3 != -1 && h3 != -2) g_fd3 = (HANDLE)h3; } // pipa keluaran MPEG-TS dari KLM (libuv)
  { intptr_t h4 = _get_osfhandle(4); if (h4 != -1 && h4 != -2) g_fd4 = (HANDLE)h4; } // pipa PCM sumber native → KLM
  bool warp = false, test = false;
  for (int i = 1; i < argc; i++) { if (!wcscmp(argv[i], L"--selftest")) test = true; if (!wcscmp(argv[i], L"--warp")) warp = true; }
  if (test) return selftest(warp);
  if (!initD3D(warp)) return 2;
  registerClass();
  timeBeginPeriod(1);
  std::thread(stdinThread).detach();
  emit("ready %s", g_adapterName.c_str());
  HANDLE tm = CreateWaitableTimerExW(nullptr, nullptr, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
  if (!tm) tm = CreateWaitableTimerW(nullptr, FALSE, nullptr);
  double next = nowMs(), statAt = next + 1000; int cnt = 0; double busy = 0;
  while (!g_quit) {
    pump();
    double t = nowMs();
    if (t >= next) {
      double a = nowMs(); frame(t); busy += nowMs() - a; cnt++;
      next += 1000.0 / g_fps; if (next < t) next = t + 1000.0 / g_fps; // tertinggal jauh → jangan mengejar beruntun
    }
    if (t >= statAt) { sendStats(cnt, cnt ? busy / cnt : 0); cnt = 0; busy = 0; statAt = t + 1000; }
    double wait = next - nowMs();
    if (wait > 0.5) {
      LARGE_INTEGER due; due.QuadPart = -(LONGLONG)(wait * 10000.0);
      SetWaitableTimer(tm, &due, 0, nullptr, nullptr, FALSE);
      MsgWaitForMultipleObjects(1, &tm, FALSE, (DWORD)(wait + 2), QS_ALLINPUT);
    }
  }
  while (!g_out.empty()) oStop(g_out.begin()->first); // KLM tertutup saat merekam → file tetap difinalisasi
  for (Bus* b : { &g_pvw, &g_pgm }) if (b->hwnd) DestroyWindow(b->hwnd);
  timeEndPeriod(1);
  return 0;
}
