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
#include <codecapi.h>
#include <condition_variable>
#include <io.h>
#include <timeapi.h>
#include <wrl/client.h>
#include <atomic>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <map>
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
struct Cmd { std::string line; std::vector<uint8_t> data; };
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
        if (!need) { std::lock_guard<std::mutex> l(g_qMx); g_q.push_back(std::move(blob)); blob = Cmd(); }
        continue;
      }
      char c = buf[i];
      if (c == '\n') {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.compare(0, 6, "ublob ") == 0 || line.compare(0, 5, "kenc ") == 0 || line.compare(0, 4, "aud ") == 0) {
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
static ComPtr<ID3D11PixelShader> g_psOpaque;
static ComPtr<ID3D11Buffer> g_cb;
static std::string g_adapterName;
static bool g_warp = false;

struct CB { float dst[4]; float uv[4]; float col[4]; float p2[4]; };

static const char* kHlsl = R"(
cbuffer C : register(b0) { float4 dst; float4 uv; float4 col; float4 p2; };
struct O { float4 p : SV_Position; float2 t : TEXCOORD0; };
O vs(uint id : SV_VertexID) {
  float2 q = float2(id & 1, id >> 1);
  O o; o.p = float4(lerp(dst.x, dst.z, q.x), lerp(dst.y, dst.w, q.y), 0, 1);
  o.t = float2(lerp(uv.x, uv.z, q.x), lerp(uv.y, uv.w, q.y)); return o;
}
Texture2D tx : register(t0); SamplerState sm : register(s0);
float4 ps(O i) : SV_Target { float4 c = tx.Sample(sm, i.t); return float4(c.rgb, c.a * col.a); }
float4 psSolid(O i) : SV_Target { return col; }
// alpha premultiplied (tekstur lapisan UTC dari Chromium): warna sudah dikali alpha
float4 psPM(O i) : SV_Target { return tx.Sample(sm, i.t) * col.a; }
// kamera (RGB32 / X8): kanal alpha dari dekoder tidak berarti → selalu buram
float4 psOpaque(O i) : SV_Target { return float4(tx.Sample(sm, i.t).rgb, col.a); }
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
};
static std::map<std::string, std::unique_ptr<Source>> g_src;

// ---------------------------------------------------------------- kamera (Fase 3, Media Foundation)
struct Cam {
  std::string id; std::mutex mx;
  ComPtr<ID3D11Texture2D> tex; ComPtr<ID3D11ShaderResourceView> srv; ComPtr<ID3D11RenderTargetView> rtv;
  UINT w = 0, h = 0, mw = 0, mh = 0; DXGI_FORMAT fmt = DXGI_FORMAT_UNKNOWN;
  std::atomic<bool> stop{ false }, fresh{ false }; std::atomic<int> frames{ 0 }; bool got = false, test = false;
  ComPtr<IMFMediaSource> src;
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
};
static Bus g_pvw{ "pvw" }, g_pgm{ "pgm" };
static HWND g_parent = nullptr;
static UINT g_W = 1920, g_H = 1080, g_fps = 30;
struct Trans { bool on = false, manual = false; double t0 = 0, dur = 0, k = 0; std::string from, to; } g_tr;

static LRESULT CALLBACK monProc(HWND h, UINT m, WPARAM wp, LPARAM lp) {
  Bus* b = (Bus*)GetWindowLongPtrW(h, GWLP_USERDATA);
  switch (m) {
    case WM_MOUSEACTIVATE: return MA_NOACTIVATE; // jangan merebut fokus keyboard dari KLM
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: { PAINTSTRUCT ps; BeginPaint(h, &ps); EndPaint(h, &ps); return 0; }
    case WM_SETCURSOR: SetCursor(LoadCursor(nullptr, IDC_ARROW)); return TRUE;
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
static void setCB(const float dst[4], const float uv[4], const float col[4], const float p2[4]) {
  D3D11_MAPPED_SUBRESOURCE m;
  if (FAILED(g_ctx->Map(g_cb.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) return;
  CB* c = (CB*)m.pData; memcpy(c->dst, dst, 16); memcpy(c->uv, uv, 16); memcpy(c->col, col, 16); memcpy(c->p2, p2, 16);
  g_ctx->Unmap(g_cb.Get(), 0);
}
static void pipeline() {
  g_ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP);
  g_ctx->IASetInputLayout(nullptr);
  g_ctx->VSSetShader(g_vs.Get(), nullptr, 0);
  g_ctx->VSSetConstantBuffers(0, 1, g_cb.GetAddressOf());
  g_ctx->PSSetConstantBuffers(0, 1, g_cb.GetAddressOf());
  g_ctx->PSSetSamplers(0, 1, g_samp.GetAddressOf());
  g_ctx->RSSetState(g_rast.Get());
  float bf[4] = { 0, 0, 0, 0 };
  g_ctx->OMSetBlendState(g_blend.Get(), bf, 0xffffffff);
}
static void viewport(UINT w, UINT h) { D3D11_VIEWPORT v{ 0, 0, (float)w, (float)h, 0, 1 }; g_ctx->RSSetViewports(1, &v); }
// sumber "fit": rasio terjaga, di tengah (sama dengan posisi bawaan input KLM)
static void drawSource(const std::string& id, float alpha) {
  if (id.empty() || id == "-" || alpha <= 0) return;
  auto it = g_src.find(id);
  if (it == g_src.end()) { // kamera Media Foundation
    auto ci = g_cams.find(id); if (ci == g_cams.end()) return;
    Cam& c = *ci->second; ComPtr<ID3D11ShaderResourceView> srv; UINT cw, ch;
    { std::lock_guard<std::mutex> l(c.mx); if (!c.got || !c.srv) return; srv = c.srv; cw = c.w; ch = c.h; }
    double sc = std::min((double)g_W / cw, (double)g_H / ch), dw = cw * sc, dh = ch * sc, x0 = (g_W - dw) / 2, y0 = (g_H - dh) / 2;
    float dst[4] = { (float)(x0 / g_W * 2 - 1), (float)(1 - y0 / g_H * 2), (float)((x0 + dw) / g_W * 2 - 1), (float)(1 - (y0 + dh) / g_H * 2) };
    float uv[4] = { 0, 0, 1, 1 }, col[4] = { 1, 1, 1, alpha }, p2[4] = { 0, 0, 1, 0 };
    setCB(dst, uv, col, p2);
    g_ctx->PSSetShader(g_psOpaque.Get(), nullptr, 0);
    g_ctx->PSSetShaderResources(0, 1, srv.GetAddressOf());
    g_ctx->Draw(4, 0);
    return;
  }
  Source& s = *it->second; if (!s.srv || !s.w || !s.h) return;
  if (s.kind == "screen" && !s.got) return;
  double sc = std::min((double)g_W / s.w, (double)g_H / s.h), dw = s.w * sc, dh = s.h * sc;
  double x0 = (g_W - dw) / 2, y0 = (g_H - dh) / 2;
  float dst[4] = { (float)(x0 / g_W * 2 - 1), (float)(1 - y0 / g_H * 2), (float)((x0 + dw) / g_W * 2 - 1), (float)(1 - (y0 + dh) / g_H * 2) };
  float uv[4] = { 0, 0, 1, 1 }, col[4] = { 1, 1, 1, alpha }, p2[4] = { 0, 0, 1, 0 };
  setCB(dst, uv, col, p2);
  g_ctx->PSSetShader(g_psTex.Get(), nullptr, 0);
  g_ctx->PSSetShaderResources(0, 1, s.srv.GetAddressOf());
  g_ctx->Draw(4, 0);
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
  bool valid = false, readySent = false;
  Ticker cur, next;
  HANDLE pend = nullptr; unsigned long long pendSeq = 0; UINT pW = 0, pH = 0; // handle terbaru yang menunggu disalin
};
static std::map<std::string, ULayer> g_ul;
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
  std::mutex qmx; std::condition_variable cv; std::deque<std::pair<std::vector<uint8_t>, LONGLONG>> q; std::atomic<bool> stop{ false };
  ComPtr<IMFTransform> mft; bool d3d = false, provides = false, started = false, okSent = false; DWORD cb = 0;
  UINT cw = 0, ch = 0, dw = 0, dh = 0; LONG stride = 0; bool hd = true;
  ComPtr<ID3D11VideoDevice> vdev; ComPtr<ID3D11VideoContext> vctx;
  ComPtr<ID3D11VideoProcessorEnumerator> ven; ComPtr<ID3D11VideoProcessor> vp; ComPtr<ID3D11VideoProcessorOutputView> ov;
  UINT vpInW = 0, vpInH = 0; ID3D11Texture2D* ovTex = nullptr;
  std::map<std::pair<ID3D11Texture2D*, UINT>, ComPtr<ID3D11VideoProcessorInputView>> iv;
  ComPtr<ID3D11Texture2D> nv12; // jalur CPU
  int errs = 0; bool waitKey = false;
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
// NV12 (tekstur dekoder / tekstur CPU) → BGRA tekstur kamera, dengan D3D11 Video Processor (GPU)
static bool kBlit(KDec& k, ID3D11Texture2D* src, UINT sub) {
  Cam& c = *k.cam;
  std::lock_guard<std::mutex> l(c.mx);
  if (!camTex(c, k.dw, k.dh, DXGI_FORMAT_B8G8R8A8_UNORM, true)) return false;
  D3D11_TEXTURE2D_DESC sd{}; src->GetDesc(&sd);
  if (!k.vp || k.vpInW != sd.Width || k.vpInH != sd.Height || k.ovTex != c.tex.Get()) {
    k.vp.Reset(); k.ven.Reset(); k.ov.Reset(); k.iv.clear();
    D3D11_VIDEO_PROCESSOR_CONTENT_DESC cd{}; cd.InputFrameFormat = D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE;
    cd.InputWidth = sd.Width; cd.InputHeight = sd.Height; cd.OutputWidth = k.dw; cd.OutputHeight = k.dh; cd.Usage = D3D11_VIDEO_USAGE_PLAYBACK_NORMAL;
    cd.InputFrameRate = { 30, 1 }; cd.OutputFrameRate = { 30, 1 };
    if (FAILED(k.vdev->CreateVideoProcessorEnumerator(&cd, &k.ven)) || FAILED(k.vdev->CreateVideoProcessor(k.ven.Get(), 0, &k.vp))) { emit("kerr %s Video Processor tidak tersedia", k.id.c_str()); return false; }
    D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC od{}; od.ViewDimension = D3D11_VPOV_DIMENSION_TEXTURE2D;
    if (FAILED(k.vdev->CreateVideoProcessorOutputView(c.tex.Get(), k.ven.Get(), &od, &k.ov))) { emit("kerr %s output view", k.id.c_str()); k.vp.Reset(); return false; }
    k.vpInW = sd.Width; k.vpInH = sd.Height; k.ovTex = c.tex.Get();
    D3D11_VIDEO_PROCESSOR_COLOR_SPACE in{}; in.YCbCr_Matrix = k.hd ? 1 : 0; in.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_16_235;
    D3D11_VIDEO_PROCESSOR_COLOR_SPACE out{}; out.RGB_Range = 0; out.Nominal_Range = D3D11_VIDEO_PROCESSOR_NOMINAL_RANGE_0_255;
    k.vctx->VideoProcessorSetStreamColorSpace(k.vp.Get(), 0, &in);
    k.vctx->VideoProcessorSetOutputColorSpace(k.vp.Get(), &out);
    k.vctx->VideoProcessorSetStreamFrameFormat(k.vp.Get(), 0, D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE);
    RECT sr{ 0, 0, (LONG)k.dw, (LONG)k.dh }; // buang bantalan (1080 dari 1088)
    k.vctx->VideoProcessorSetStreamSourceRect(k.vp.Get(), 0, TRUE, &sr);
    k.vctx->VideoProcessorSetStreamAutoProcessingMode(k.vp.Get(), 0, FALSE);
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
  if (FAILED(k.vctx->VideoProcessorBlt(k.vp.Get(), k.ov.Get(), 0, 1, &st))) return false;
  c.got = true;
  return true;
}
static void kDeliver(KDec& k, IMFSample* smp) {
  ComPtr<IMFMediaBuffer> mb; if (FAILED(smp->GetBufferByIndex(0, &mb))) return;
  bool ok = false;
  ComPtr<IMFDXGIBuffer> db;
  if (SUCCEEDED(mb.As(&db))) {
    ComPtr<ID3D11Texture2D> t; UINT sub = 0;
    if (SUCCEEDED(db->GetResource(IID_PPV_ARGS(&t))) && SUCCEEDED(db->GetSubresourceIndex(&sub))) ok = kBlit(k, t.Get(), sub);
  } else if (!k.vdev) { // GPU tanpa Video Processor (mis. WARP): konversi NV12 → BGRA di CPU (jalur darurat)
    BYTE* p = nullptr; LONG pitch = 0; DWORD mx = 0, cur = 0; ComPtr<IMF2DBuffer> b2; bool l2 = false;
    if (SUCCEEDED(mb.As(&b2)) && SUCCEEDED(b2->Lock2D(&p, &pitch))) l2 = true;
    else if (SUCCEEDED(mb->Lock(&p, &mx, &cur))) pitch = k.stride ? k.stride : (LONG)k.cw;
    else return;
    if (pitch > 0 && (l2 || cur >= (DWORD)(pitch * k.ch * 3 / 2))) {
      const UINT W = k.dw & ~1u, H = k.dh & ~1u; std::vector<uint32_t> px((size_t)W * H);
      const BYTE* yp = p; const BYTE* uvp = p + (size_t)pitch * k.ch;
      const double kr = k.hd ? 0.2126 : 0.299, kb = k.hd ? 0.0722 : 0.114, kg = 1 - kr - kb;
      for (UINT y = 0; y < H; y++) for (UINT x = 0; x < W; x++) {
        double Y = (yp[(size_t)y * pitch + x] - 16) * (255.0 / 219), U = (uvp[(size_t)(y / 2) * pitch + (x & ~1u)] - 128) * (255.0 / 224), V = (uvp[(size_t)(y / 2) * pitch + (x & ~1u) + 1] - 128) * (255.0 / 224);
        double R = Y + 2 * (1 - kr) * V, B = Y + 2 * (1 - kb) * U, G = (Y - kr * R - kb * B) / kg;
        auto c8 = [](double v) { return (uint32_t)(v < 0 ? 0 : v > 255 ? 255 : std::lround(v)); };
        px[(size_t)y * W + x] = 0xFF000000u | (c8(R) << 16) | (c8(G) << 8) | c8(B);
      }
      Cam& c = *k.cam; std::lock_guard<std::mutex> l(c.mx);
      if (camTex(c, W, H, DXGI_FORMAT_B8G8R8A8_UNORM, false)) { g_ctx->UpdateSubresource(c.tex.Get(), 0, nullptr, px.data(), W * 4, 0); c.got = true; ok = true; }
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
      ok = kBlit(k, k.nv12.Get(), 0);
    }
    if (l2) b2->Unlock2D(); else mb->Unlock();
  }
  if (!ok) return;
  k.cam->fresh = true; k.cam->frames++;
  if (!k.okSent) { k.okSent = true; emit("kok %s %u %u %d", k.id.c_str(), k.dw, k.dh, k.d3d ? 1 : 0); }
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
    std::pair<std::vector<uint8_t>, LONGLONG> f;
    {
      std::unique_lock<std::mutex> l(k->qmx);
      k->cv.wait(l, [&] { return k->stop || !k->q.empty(); });
      if (k->stop) break;
      // tertinggal (GPU sibuk): buang sampai frame kunci terakhir tidak bisa di sini (butuh urutan) → antrean dibatasi di pengirim
      f = std::move(k->q.front()); k->q.pop_front();
    }
    ComPtr<IMFSample> s; ComPtr<IMFMediaBuffer> b;
    if (FAILED(MFCreateSample(&s)) || FAILED(MFCreateMemoryBuffer((DWORD)f.first.size(), &b))) continue;
    BYTE* p = nullptr; b->Lock(&p, nullptr, nullptr); memcpy(p, f.first.data(), f.first.size()); b->Unlock(); b->SetCurrentLength((DWORD)f.first.size());
    s->AddBuffer(b.Get()); s->SetSampleTime(f.second); s->SetSampleDuration(333333);
    HRESULT hr = k->mft->ProcessInput(0, s.Get(), 0);
    if (hr == MF_E_NOTACCEPTING) { kDrain(*k); hr = k->mft->ProcessInput(0, s.Get(), 0); }
    kDrain(*k);
  }
  if (k->mft) { k->mft->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0); k->mft->ProcessMessage(MFT_MESSAGE_COMMAND_FLUSH, 0); }
  k->iv.clear(); k->ov.Reset(); k->vp.Reset(); k->ven.Reset(); k->mft.Reset();
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
static void kFeed(const std::string& id, bool key, LONGLONG ts, std::vector<uint8_t>&& data) {
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
  std::lock_guard<std::mutex> l(k.qmx);
  if (k.q.size() > 12 || k.waitKey) { // dekoder tertinggal jauh → buang antrean, lanjut dari frame kunci berikutnya
    if (!key) { k.waitKey = true; kNeedKey(id); return; }
    k.q.clear(); k.waitKey = false;
  }
  k.q.emplace_back(std::move(data), ts);
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
      ComPtr<IMFSample> sm; MFCreateSample(&sm); sm->AddBuffer(b.Get()); sm->SetSampleTime(tsv); sm->SetSampleDuration(dur);
      hr = o.sw->WriteSample(o.vs, sm.Get());
      if (FAILED(hr)) { emit("oerr %s menulis video 0x%08lx — output dihentikan", o.id.c_str(), (unsigned long)hr); emit("ostopped %s %llu", o.id.c_str(), o.frames); it = g_out.erase(it); continue; }
      o.frames++;
    }
    // audio sunyi bila KLM tidak mengirim audio (> 120 ms tertinggal dari jam) → aliran audio tidak pernah putus
    while (o.aPos < t - 1200000) {
      const UINT n = 960; ComPtr<IMFMediaBuffer> ab; MFCreateMemoryBuffer(n * 4, &ab); BYTE* p = nullptr; ab->Lock(&p, nullptr, nullptr); memset(p, 0, n * 4); ab->Unlock(); ab->SetCurrentLength(n * 4);
      ComPtr<IMFSample> as; MFCreateSample(&as); as->AddBuffer(ab.Get()); as->SetSampleTime(o.aPos); as->SetSampleDuration(200000);
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
    ComPtr<IMFSample> s; MFCreateSample(&s); s->AddBuffer(b.Get()); s->SetSampleTime(o.aPos); s->SetSampleDuration(dur);
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
  if (c == "utex") {
    unsigned long long hv = 0, seq = 0; UINT W = 0, H = 0; is >> hv >> W >> H >> seq;
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
static void compose(Bus& b, bool program) {
  ensureRT(b); if (!b.rtv) return;
  ID3D11ShaderResourceView* none = nullptr; g_ctx->PSSetShaderResources(0, 1, &none);
  g_ctx->OMSetRenderTargets(1, b.rtv.GetAddressOf(), nullptr);
  viewport(g_W, g_H);
  float black[4] = { 0, 0, 0, 1 }; g_ctx->ClearRenderTargetView(b.rtv.Get(), black);
  if (program && g_tr.on) { drawSource(g_tr.from, 1); drawSource(g_tr.to, ease((float)g_tr.k)); }
  else drawSource(b.id, 1);
  if (program) drawUtc(); // grafis UTC ON AIR di atas Program (sama dengan lapisan DSK di mesin JS)
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
  double scale = std::max((double)g_W / b.scW, (double)g_H / b.scH);
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
  if (c == "utex" || c == "ulay" || c == "uclear" || c == "ureset" || c == "utk" || c == "ublob" || c == "utkgeo" || c == "utklive") { utcCommand(c, is, data); return; }
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
    readPixel(b, (UINT)std::min<double>(g_W - 1, std::max(0.0, fx * g_W)), (UINT)std::min<double>(g_H - 1, std::max(0.0, fy * g_H)), px);
    emit("probe %d %d %d", px[0], px[1], px[2]);
    return;
  }
  if (c == "parent") {
    unsigned long long v = 0; is >> v; HWND p = (HWND)(uintptr_t)v;
    if (!IsWindow(p)) { emit("err jendela induk tidak valid"); return; }
    if (p != g_parent) {
      for (Bus* b : { &g_pvw, &g_pgm }) { if (b->hwnd) DestroyWindow(b->hwnd); b->hwnd = nullptr; b->sc.Reset(); b->scRtv.Reset(); b->scW = b->scH = 0; b->shown = false; }
      g_parent = p;
    }
  } else if (c == "out") {
    UINT w = 0, h = 0, f = 0; is >> w >> h >> f;
    if (w >= 16 && h >= 16 && w <= 7680 && h <= 4320) { g_W = w; g_H = h; }
    if (f >= 1 && f <= 240) g_fps = f;
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
    } else { emit("srcerr %s jenis tidak didukung", id.c_str()); return; }
    g_src[id] = std::move(s);
  } else if (c == "del") {
    std::string id; is >> id; g_src.erase(id);
  } else if (c == "pvw" || c == "pgm") {
    std::string id; is >> id; (c == "pvw" ? g_pvw : g_pgm).id = id == "-" ? "" : id;
  } else if (c == "trans") {
    double ms = 0; std::string a, b; is >> ms >> a >> b;
    g_tr = Trans(); g_tr.on = true; g_tr.t0 = nowMs(); g_tr.dur = std::max(1.0, ms); g_tr.from = a == "-" ? "" : a; g_tr.to = b == "-" ? "" : b;
  } else if (c == "tbar") {
    std::string v; is >> v;
    if (v == "off") { g_tr.on = false; return; }
    std::string a, b; is >> a >> b;
    g_tr.on = true; g_tr.manual = true; g_tr.k = std::atoi(v.c_str()) / 1000.0; g_tr.from = a == "-" ? "" : a; g_tr.to = b == "-" ? "" : b;
  } else if (c == "stats") {
    sendStats(0, 0);
  } else if (c == "quit") {
    g_quit = true;
  }
}

static void frame(double now) {
  std::deque<Cmd> q;
  { std::lock_guard<std::mutex> l(g_qMx); q.swap(g_q); }
  for (auto& l : q) command(l.line, l.data);
  g_frameNo++;
  flushUtex();
  if (g_tr.on && !g_tr.manual) {
    g_tr.k = (now - g_tr.t0) / g_tr.dur;
    if (g_tr.k >= 1) { g_tr.on = false; g_pgm.id = g_tr.to; }
  }
  for (auto& kv : g_src) if (kv.second->kind == "screen") {
    const std::string& id = kv.first;
    bool used = id == g_pvw.id || id == g_pgm.id || (g_tr.on && (id == g_tr.from || id == g_tr.to));
    if (used) tickScreen(*kv.second, id, now);
  }
  pipeline();
  camTick();
  if (g_pgm.want || !g_parent || !g_out.empty()) compose(g_pgm, true);
  oVideo(now);
  if (g_pvw.want || !g_parent) compose(g_pvw, false);
  present(g_pgm);
  present(g_pvw);
  // pastikan monitor tetap di atas kanvas Chromium (Chromium bisa membuat ulang jendela anaknya saat ukuran berubah)
  static double zAt = 0;
  if (now - zAt > 1000) {
    zAt = now;
    for (Bus* b : { &g_pgm, &g_pvw }) if (b->shown && GetWindow(b->hwnd, GW_HWNDPREV)) SetWindowPos(b->hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
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
      for (size_t i = 0; i < h264.size(); i++) { char b[96]; snprintf(b, sizeof b, "kenc kt %d %lld %zu", i == 0 ? 1 : 0, (long long)i * 333333, h264[i].size()); command(b, h264[i]); }
      double t0 = nowMs(); while (nowMs() - t0 < 4000 && !(g_cams.count("kt") && g_cams["kt"]->frames > 5)) { run(1); Sleep(20); }
      int fr = g_cams.count("kt") ? g_cams["kt"]->frames.load() : 0;
      bool d3d = g_kdec.count("kt") && g_kdec["kt"]->d3d;
      emit("  %s dekoder KLMCAM: %d frame terdekode (%s)", fr > 5 ? "OK " : "GAGAL", fr, d3d ? "DXVA GPU" : "perangkat lunak"); if (fr <= 5) ok = 0;
      command("pgm kt"); run(3);
      chk(g_pgm, 960, 540, 156, 156, 156, 8, "KLMCAM terdekode di Program (abu Y=150)");
      command("kdecoff kt"); command("pgm a"); run(2);
      emit("  %s dekoder KLMCAM dihentikan", !g_kdec.count("kt") ? "OK " : "GAGAL"); if (g_kdec.count("kt")) ok = 0;
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
