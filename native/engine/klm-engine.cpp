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
// Keluaran stdout (satu baris per kejadian): ready <adapter> | shown <bus> | hidden <bus> | click <bus> <x> <y> <btn> <dbl>
//   | srcerr <id> <pesan> | srcok <id> <w> <h> | stats fps=.. ms=.. mem=.. | err <pesan>
//
// --selftest : uji mandiri tanpa KLM (jendela tersembunyi, perangkat WARP bila tanpa GPU) — dipakai CI.
#include <windows.h>
#include <d3d11_1.h>
#include <dxgi1_2.h>
#include <d3dcompiler.h>
#include <psapi.h>
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
static std::mutex g_qMx;
static std::deque<std::string> g_q;
static std::atomic<bool> g_quit{false};
static void stdinThread() {
  HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
  char buf[8192]; DWORD n = 0; std::string line;
  while (!g_quit && ReadFile(h, buf, sizeof buf, &n, nullptr) && n) {
    for (DWORD i = 0; i < n; i++) {
      char c = buf[i];
      if (c == '\n') {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        { std::lock_guard<std::mutex> l(g_qMx); g_q.push_back(line); }
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
static ComPtr<ID3D11PixelShader> g_psTex, g_psDown, g_psSolid;
static ComPtr<ID3D11SamplerState> g_samp;
static ComPtr<ID3D11BlendState> g_blend;
static ComPtr<ID3D11RasterizerState> g_rast;
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

  D3D11_SAMPLER_DESC sd{}; sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
  sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP; sd.MaxLOD = D3D11_FLOAT32_MAX;
  g_dev->CreateSamplerState(&sd, &g_samp);
  D3D11_BLEND_DESC bd{}; auto& rt = bd.RenderTarget[0];
  rt.BlendEnable = TRUE; rt.SrcBlend = D3D11_BLEND_SRC_ALPHA; rt.DestBlend = D3D11_BLEND_INV_SRC_ALPHA; rt.BlendOp = D3D11_BLEND_OP_ADD;
  rt.SrcBlendAlpha = D3D11_BLEND_ONE; rt.DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA; rt.BlendOpAlpha = D3D11_BLEND_OP_ADD;
  rt.RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
  g_dev->CreateBlendState(&bd, &g_blend);
  D3D11_RASTERIZER_DESC rd{}; rd.FillMode = D3D11_FILL_SOLID; rd.CullMode = D3D11_CULL_NONE; rd.DepthClipEnable = TRUE;
  g_dev->CreateRasterizerState(&rd, &g_rast);
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
  auto it = g_src.find(id); if (it == g_src.end()) return;
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
static float ease(float p) { return p < 0.5f ? 2 * p * p : 1 - std::pow(-2 * p + 2, 2.0f) / 2; }
static void compose(Bus& b, bool program) {
  ensureRT(b); if (!b.rtv) return;
  ID3D11ShaderResourceView* none = nullptr; g_ctx->PSSetShaderResources(0, 1, &none);
  g_ctx->OMSetRenderTargets(1, b.rtv.GetAddressOf(), nullptr);
  viewport(g_W, g_H);
  float black[4] = { 0, 0, 0, 1 }; g_ctx->ClearRenderTargetView(b.rtv.Get(), black);
  if (program && g_tr.on) { drawSource(g_tr.from, 1); drawSource(g_tr.to, ease((float)g_tr.k)); }
  else drawSource(b.id, 1);
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
  emit("stats fps=%d ms=%.2f mem=%llu warp=%d", fps, ms, (unsigned long long)(pm.WorkingSetSize / (1024 * 1024)), g_warp ? 1 : 0);
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
static void command(const std::string& line) {
  std::istringstream is(line); std::string c; is >> c;
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
  std::deque<std::string> q;
  { std::lock_guard<std::mutex> l(g_qMx); q.swap(g_q); }
  for (auto& l : q) command(l);
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
  if (g_pgm.want || !g_parent) compose(g_pgm, true);
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
  for (Bus* b : { &g_pvw, &g_pgm }) if (b->hwnd) DestroyWindow(b->hwnd);
  timeEndPeriod(1);
  return 0;
}
