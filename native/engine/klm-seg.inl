// ---------------------------------------------------------------- Latar AI native (Fase 9)
// Model segmentasi orang (MediaPipe Selfie Segmenter, .tflite) dijalankan langsung di GPU lewat compute shader D3D11:
// file .tflite dibaca sendiri (flatbuffer), bobot fp16 diubah ke float, tiap operator = satu dispatch compute shader.
// Tanpa runtime AI tambahan (tanpa TensorFlow / ONNX / DirectML) — cukup GPU dengan Direct3D feature level 11.
// Disertakan oleh klm-engine.cpp (memakai g_dev, g_ctx, emit, nowMs).

namespace segm {

static uint32_t rd32(const uint8_t* p) { uint32_t v; memcpy(&v, p, 4); return v; }
// tabel flatbuffer minimal (hanya baca)
struct Tab {
  const uint8_t* base = nullptr; const uint8_t* t = nullptr; const uint8_t* vt = nullptr; uint16_t vsz = 0; size_t n = 0;
  Tab() {}
  Tab(const uint8_t* b, size_t len, size_t off) : base(b), n(len) {
    if (off + 4 > len) return;
    t = b + off; int32_t so; memcpy(&so, t, 4);
    const ptrdiff_t vo = (ptrdiff_t)off - so; if (vo < 0 || (size_t)vo + 4 > len) { t = nullptr; return; }
    vt = b + vo; memcpy(&vsz, vt, 2);
  }
  bool ok() const { return t != nullptr; }
  uint16_t fo(int i) const { if (!t) return 0; const uint16_t o = (uint16_t)(4 + 2 * i); if (o + 2 > vsz) return 0; uint16_t r; memcpy(&r, vt + o, 2); return r; }
  template <class T> T sc(int i, T def) const { const uint16_t o = fo(i); if (!o) return def; T v; memcpy(&v, t + o, sizeof(T)); return v; }
  Tab tab(int i) const { const uint16_t o = fo(i); if (!o) return Tab(); const size_t p = (size_t)(t + o - base); return Tab(base, n, p + rd32(t + o)); }
  const uint8_t* vec(int i, uint32_t& cnt) const {
    cnt = 0; const uint16_t o = fo(i); if (!o) return nullptr;
    const size_t p = (size_t)(t + o - base) + rd32(t + o); if (p + 4 > n) return nullptr;
    cnt = rd32(base + p); return base + p + 4;
  }
  Tab vtab(int i, uint32_t k) const { uint32_t c; const uint8_t* p = vec(i, c); if (!p || k >= c) return Tab(); const uint8_t* q = p + 4 * (size_t)k; return Tab(base, n, (size_t)(q - base) + rd32(q)); }
  std::vector<int32_t> ivec(int i) const { uint32_t c; const uint8_t* p = vec(i, c); std::vector<int32_t> r(c); if (p && c) memcpy(r.data(), p, 4 * (size_t)c); return r; }
  std::string str(int i) const { uint32_t c; const uint8_t* p = vec(i, c); return p ? std::string((const char*)p, c) : std::string(); }
};

static float half2f(uint16_t h) {
  const uint32_t s = (h & 0x8000u) << 16, e = (h >> 10) & 0x1f, m = h & 0x3ff; uint32_t f;
  if (e == 0) { if (!m) f = s; else { int ee = -1; uint32_t mm = m; do { ee++; mm <<= 1; } while (!(mm & 0x400)); f = s | ((uint32_t)(127 - 15 - ee) << 23) | ((mm & 0x3ff) << 13); } }
  else if (e == 31) f = s | 0x7f800000u | (m << 13);
  else f = s | ((e + 112) << 23) | (m << 13);
  float r; memcpy(&r, &f, 4); return r;
}

enum Code { ADD = 0, AVERAGE_POOL_2D = 1, CONCATENATION = 2, CONV_2D = 3, DEPTHWISE_CONV_2D = 4, DEQUANTIZE = 6, LOGISTIC = 14, MAX_POOL_2D = 17, MUL = 18, RELU = 19,
  RELU_N1_TO_1 = 20, RELU6 = 21, RESHAPE = 22, RESIZE_BILINEAR = 23, TANH = 28, PAD = 34, MEAN = 40, SUB = 41, DIV = 42, SQUEEZE = 43, MAXIMUM = 55, MINIMUM = 57,
  TRANSPOSE_CONV = 67, EXPAND_DIMS = 70, RESIZE_NEAREST_NEIGHBOR = 97, HARD_SWISH = 117 };

struct Tensor {
  std::vector<int> shape; int type = 0; std::string name; bool isConst = false;
  std::vector<float> cf; std::vector<int32_t> ci;
  int H = 1, W = 1, C = 1; size_t n = 1;
  ComPtr<ID3D11Buffer> b; ComPtr<ID3D11ShaderResourceView> srv; ComPtr<ID3D11UnorderedAccessView> uav;
};
struct Disp { int sh = 0; ComPtr<ID3D11Buffer> cb; ID3D11ShaderResourceView* in[3] = { nullptr, nullptr, nullptr }; ID3D11UnorderedAccessView* out = nullptr; UINT gx = 1, gy = 1; };
struct P { int32_t a[4], b[4], c[4], d[4], e[4]; float f[4]; };

static const char* kCs = R"(
cbuffer P : register(b0) { int4 a; int4 b; int4 c; int4 d; int4 e; float4 f; };
StructuredBuffer<float> X : register(t0); StructuredBuffer<float> Wt : register(t1); StructuredBuffer<float> Bs : register(t2);
RWStructuredBuffer<float> Y : register(u0);
float act(float v, int t) {
  if (t == 1) return max(v, 0); if (t == 2) return clamp(v, -1, 1); if (t == 3) return clamp(v, 0, 6); if (t == 4) return tanh(v);
  return v;
}
int idx(uint3 id) { return (int)(id.x + id.y * 4194240u); }
// konvolusi biasa NHWC, filter [OC,KH,KW,IC] — a=(IH,IW,IC,OC) b=(OH,OW,KH,KW) c=(sh,sw,padT,padL) d=(dilH,dilW,act,bias) e.x=jumlah
[numthreads(64, 1, 1)] void csConv(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  int oc = i % a.w; int t = i / a.w; int ox = t % b.y; int oy = t / b.y;
  float s = d.w ? Bs[oc] : 0;
  for (int ky = 0; ky < b.z; ky++) { int iy = oy * c.x - c.z + ky * d.x; if (iy < 0 || iy >= a.x) continue;
    for (int kx = 0; kx < b.w; kx++) { int ix = ox * c.y - c.w + kx * d.y; if (ix < 0 || ix >= a.y) continue;
      int bx = (iy * a.y + ix) * a.z, bw = ((oc * b.z + ky) * b.w + kx) * a.z;
      for (int k = 0; k < a.z; k++) s += X[bx + k] * Wt[bw + k]; } }
  Y[i] = act(s, d.z);
}
// konvolusi depthwise, filter [1,KH,KW,IC*M] — a=(IH,IW,IC,OC) b=(OH,OW,KH,KW) c=(sh,sw,padT,padL) d=(dilH,dilW,act,bias) e=(jumlah,M)
[numthreads(64, 1, 1)] void csDw(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  int oc = i % a.w; int t = i / a.w; int ox = t % b.y; int oy = t / b.y; int ic = oc / e.y;
  float s = d.w ? Bs[oc] : 0;
  for (int ky = 0; ky < b.z; ky++) { int iy = oy * c.x - c.z + ky * d.x; if (iy < 0 || iy >= a.x) continue;
    for (int kx = 0; kx < b.w; kx++) { int ix = ox * c.y - c.w + kx * d.y; if (ix < 0 || ix >= a.y) continue;
      s += X[(iy * a.y + ix) * a.z + ic] * Wt[(ky * b.w + kx) * a.w + oc]; } }
  Y[i] = act(s, d.z);
}
// operasi dua tensor dengan broadcast — a=(Ah,Aw,Ac) b=(Bh,Bw,Bc) c=(H,W,C,op) d.x=act e.x=jumlah
[numthreads(64, 1, 1)] void csBin(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  int ch = i % c.z; int t = i / c.z; int x = t % c.y; int y = t / c.y;
  float p = X[((a.x > 1 ? y : 0) * a.y + (a.y > 1 ? x : 0)) * a.z + (a.z > 1 ? ch : 0)];
  float q = Wt[((b.x > 1 ? y : 0) * b.y + (b.y > 1 ? x : 0)) * b.z + (b.z > 1 ? ch : 0)];
  float r = c.w == 0 ? p + q : c.w == 1 ? p * q : c.w == 2 ? p - q : c.w == 3 ? p / q : c.w == 4 ? max(p, q) : c.w == 5 ? min(p, q) : (p - q) * (p - q);
  Y[i] = act(r, d.x);
}
// operasi satu tensor — a.x=op (0 salin, 1 relu, 2 relu6, 3 sigmoid, 4 hard-swish, 5 tanh, 6 relu-1..1) e.x=jumlah
[numthreads(64, 1, 1)] void csUn(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  float v = X[i], r = v;
  if (a.x == 1) r = max(v, 0); else if (a.x == 2) r = clamp(v, 0, 6); else if (a.x == 3) r = 1 / (1 + exp(-v));
  else if (a.x == 4) r = v * clamp(v + 3, 0, 6) / 6; else if (a.x == 5) r = tanh(v); else if (a.x == 6) r = clamp(v, -1, 1);
  Y[i] = r;
}
// rata-rata seluruh H×W per kanal — a=(H,W,C) e.x=C
[numthreads(64, 1, 1)] void csMean(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  float s = 0; int n = a.x * a.y;
  for (int p = 0; p < n; p++) s += X[p * a.z + i];
  Y[i] = s / n;
}
// pooling — a=(IH,IW,C,max) b=(OH,OW,KH,KW) c=(sh,sw,padT,padL) d.x=act e.x=jumlah
[numthreads(64, 1, 1)] void csPool(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  int ch = i % a.z; int t = i / a.z; int ox = t % b.y; int oy = t / b.y;
  float s = a.w ? -3.4e38 : 0; int n = 0;
  for (int ky = 0; ky < b.z; ky++) { int iy = oy * c.x - c.z + ky; if (iy < 0 || iy >= a.x) continue;
    for (int kx = 0; kx < b.w; kx++) { int ix = ox * c.y - c.w + kx; if (ix < 0 || ix >= a.y) continue;
      float v = X[(iy * a.y + ix) * a.z + ch]; if (a.w) s = max(s, v); else s += v; n++; } }
  Y[i] = act(a.w ? s : s / max(n, 1), d.x);
}
// ubah ukuran — a=(IH,IW,C,nearest) b=(OH,OW,align,half) e.x=jumlah, f.xy = skala (y, x)
[numthreads(64, 1, 1)] void csResize(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  int ch = i % a.z; int t = i / a.z; int ox = t % b.y; int oy = t / b.y;
  float fy = b.w ? (oy + 0.5) * f.x - 0.5 : oy * f.x, fx = b.w ? (ox + 0.5) * f.y - 0.5 : ox * f.y;
  if (a.w) { // tetangga terdekat
    int ny = min(b.z ? (int)round(oy * f.x) : (int)floor(b.w ? (oy + 0.5) * f.x : oy * f.x), a.x - 1);
    int nx = min(b.z ? (int)round(ox * f.y) : (int)floor(b.w ? (ox + 0.5) * f.y : ox * f.y), a.y - 1);
    Y[i] = X[(max(ny, 0) * a.y + max(nx, 0)) * a.z + ch]; return;
  }
  int y0 = max((int)floor(fy), 0), y1 = min((int)ceil(fy), a.x - 1), x0 = max((int)floor(fx), 0), x1 = min((int)ceil(fx), a.y - 1);
  float dy = fy - y0, dx = fx - x0;
  float v00 = X[(y0 * a.y + x0) * a.z + ch], v01 = X[(y0 * a.y + x1) * a.z + ch], v10 = X[(y1 * a.y + x0) * a.z + ch], v11 = X[(y1 * a.y + x1) * a.z + ch];
  Y[i] = v00 * (1 - dy) * (1 - dx) + v01 * (1 - dy) * dx + v10 * dy * (1 - dx) + v11 * dy * dx;
}
// gabung kanal: salin X (P piksel × Ci) ke Y (× Cout) mulai kanal off — a=(Ci,Cout,off) e.x=jumlah
[numthreads(64, 1, 1)] void csConcat(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  int ch = i % a.x; int p = i / a.x;
  Y[p * a.y + a.z + ch] = X[i];
}
// konvolusi transpos, filter [OC,KH,KW,IC] — a=(IH,IW,IC,OC) b=(OH,OW,KH,KW) c=(sh,sw,padT,padL) d=(act,bias) e.x=jumlah
[numthreads(64, 1, 1)] void csTConv(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  int oc = i % a.w; int t = i / a.w; int ox = t % b.y; int oy = t / b.y;
  float s = d.y ? Bs[oc] : 0;
  for (int ky = 0; ky < b.z; ky++) { int ty = oy + c.z - ky; if (ty < 0 || ty % c.x) continue; int iy = ty / c.x; if (iy >= a.x) continue;
    for (int kx = 0; kx < b.w; kx++) { int tx = ox + c.w - kx; if (tx < 0 || tx % c.y) continue; int ix = tx / c.y; if (ix >= a.y) continue;
      int bx = (iy * a.y + ix) * a.z, bw = ((oc * b.z + ky) * b.w + kx) * a.z;
      for (int k = 0; k < a.z; k++) s += X[bx + k] * Wt[bw + k]; } }
  Y[i] = act(s, d.x);
}
// isi nol di tepi — a=(IH,IW,IC) b=(OH,OW,OC) c=(padT,padL,padC) e.x=jumlah
[numthreads(64, 1, 1)] void csPad(uint3 id : SV_DispatchThreadID) {
  int i = idx(id); if (i >= e.x) return;
  int ch = i % b.z; int t = i / b.z; int x = t % b.y; int y = t / b.y;
  int iy = y - c.x, ix = x - c.y, ic = ch - c.z;
  Y[i] = (iy >= 0 && iy < a.x && ix >= 0 && ix < a.y && ic >= 0 && ic < a.z) ? X[(iy * a.y + ix) * a.z + ic] : 0;
}
// gambar sumber → tensor masukan [1,H,W,3] — a=(H,W) f=(skala, geser)
Texture2D<float4> Src : register(t3); SamplerState Sm : register(s0);
[numthreads(8, 8, 1)] void csIn(uint3 id : SV_DispatchThreadID) {
  if ((int)id.x >= a.y || (int)id.y >= a.x) return;
  float3 v = Src.SampleLevel(Sm, (float2(id.xy) + 0.5) / float2(a.y, a.x), 0).rgb * f.x + f.y;
  int o = (int)(id.y * a.y + id.x) * 3; Y[o] = v.r; Y[o + 1] = v.g; Y[o + 2] = v.b;
}
// keluaran model → mask 8-bit (sama dengan segment.js: balik, tepi halus, redam kedip) — a=(H,W,C,balik) f=(lo,hi)
RWTexture2D<unorm float> Mk : register(u1);
[numthreads(8, 8, 1)] void csPost(uint3 id : SV_DispatchThreadID) {
  if ((int)id.x >= a.y || (int)id.y >= a.x) return;
  int p = (int)(id.y * a.y + id.x);
  float v = X[p * a.z + a.z - 1]; if (a.w) v = 1 - v;
  v = v <= f.x ? 0 : v >= f.y ? 1 : (v - f.x) / (f.y - f.x); v = v * v * (3 - 2 * v);
  v = Y[p] * 0.35 + v * 0.65; Y[p] = v; Mk[id.xy] = v;
}
)";
enum { S_CONV, S_DW, S_BIN, S_UN, S_MEAN, S_POOL, S_RESIZE, S_CONCAT, S_TCONV, S_PAD, S_IN, S_POST, S_N };
static const char* kCsNames[S_N] = { "csConv", "csDw", "csBin", "csUn", "csMean", "csPool", "csResize", "csConcat", "csTConv", "csPad", "csIn", "csPost" };

struct Model {
  bool ok = false; std::string err, path; std::vector<uint8_t> file;
  std::vector<Tensor> T; std::vector<Disp> D; int input = -1, output = -1; int IH = 0, IW = 0, OH = 0, OW = 0, OC = 1;
  ComPtr<ID3D11ComputeShader> cs[S_N]; ComPtr<ID3D11SamplerState> samp; double ms = 0; int ops = 0;
};
static Model M;

static bool mkBuf(Tensor& t, bool uav) {
  D3D11_BUFFER_DESC bd{}; bd.ByteWidth = (UINT)(std::max<size_t>(t.n, 1) * 4); bd.Usage = D3D11_USAGE_DEFAULT;
  bd.BindFlags = D3D11_BIND_SHADER_RESOURCE | (uav ? D3D11_BIND_UNORDERED_ACCESS : 0); bd.MiscFlags = D3D11_RESOURCE_MISC_BUFFER_STRUCTURED; bd.StructureByteStride = 4;
  std::vector<float> z; const void* init = nullptr;
  if (t.isConst) { if (t.cf.size() < t.n) t.cf.resize(t.n, 0.f); init = t.cf.data(); } else { z.assign(std::max<size_t>(t.n, 1), 0.f); init = z.data(); }
  D3D11_SUBRESOURCE_DATA sd{ init, 0, 0 };
  if (FAILED(g_dev->CreateBuffer(&bd, &sd, &t.b))) return false;
  D3D11_SHADER_RESOURCE_VIEW_DESC sv{}; sv.Format = DXGI_FORMAT_UNKNOWN; sv.ViewDimension = D3D11_SRV_DIMENSION_BUFFER; sv.Buffer.NumElements = (UINT)std::max<size_t>(t.n, 1);
  if (FAILED(g_dev->CreateShaderResourceView(t.b.Get(), &sv, &t.srv))) return false;
  if (uav) { D3D11_UNORDERED_ACCESS_VIEW_DESC uv{}; uv.Format = DXGI_FORMAT_UNKNOWN; uv.ViewDimension = D3D11_UAV_DIMENSION_BUFFER; uv.Buffer.NumElements = (UINT)std::max<size_t>(t.n, 1);
    if (FAILED(g_dev->CreateUnorderedAccessView(t.b.Get(), &uv, &t.uav))) return false; }
  return true;
}
static void dims(Tensor& t) {
  std::vector<int> s = t.shape; while (s.size() < 4) s.insert(s.begin(), 1);
  if (s.size() > 4) { int k = 1; while (s.size() > 4) { k *= s[0]; s.erase(s.begin()); } s[0] *= k; }
  t.H = s[1]; t.W = s[2]; t.C = s[3]; t.n = (size_t)std::max(1, s[0]) * t.H * t.W * t.C;
}
static void samePad(int in, int k, int st, int dil, int out, int& pad) { const int ek = (k - 1) * dil + 1; pad = std::max(0, ((out - 1) * st + ek - in) / 2); }
static ComPtr<ID3D11Buffer> mkCB(const P& p) {
  D3D11_BUFFER_DESC bd{}; bd.ByteWidth = (sizeof(P) + 15) & ~15u; bd.Usage = D3D11_USAGE_IMMUTABLE; bd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
  std::vector<uint8_t> tmp(bd.ByteWidth, 0); memcpy(tmp.data(), &p, sizeof(P)); D3D11_SUBRESOURCE_DATA sd{ tmp.data(), 0, 0 };
  ComPtr<ID3D11Buffer> b; g_dev->CreateBuffer(&bd, &sd, &b); return b;
}
static void groups(Disp& d, size_t n) { const size_t g = (n + 63) / 64; d.gx = (UINT)std::min<size_t>(g, 65535); d.gy = (UINT)((g + 65534) / 65535); }
static const char* opName(int c) {
  switch (c) { case ADD: return "ADD"; case AVERAGE_POOL_2D: return "AVERAGE_POOL_2D"; case CONCATENATION: return "CONCATENATION"; case CONV_2D: return "CONV_2D";
    case DEPTHWISE_CONV_2D: return "DEPTHWISE_CONV_2D"; case DEQUANTIZE: return "DEQUANTIZE"; case LOGISTIC: return "LOGISTIC"; case MAX_POOL_2D: return "MAX_POOL_2D";
    case MUL: return "MUL"; case RELU: return "RELU"; case RELU6: return "RELU6"; case RESHAPE: return "RESHAPE"; case RESIZE_BILINEAR: return "RESIZE_BILINEAR";
    case TANH: return "TANH"; case PAD: return "PAD"; case MEAN: return "MEAN"; case SUB: return "SUB"; case DIV: return "DIV"; case TRANSPOSE_CONV: return "TRANSPOSE_CONV";
    case RESIZE_NEAREST_NEIGHBOR: return "RESIZE_NEAREST_NEIGHBOR"; case HARD_SWISH: return "HARD_SWISH"; default: return "?"; }
}

static bool load(const std::wstring& path, std::string& info) {
  M = Model();
  D3D_FEATURE_LEVEL fl = g_dev->GetFeatureLevel(); if (fl < D3D_FEATURE_LEVEL_11_0) { M.err = "GPU tanpa Direct3D 11 compute"; return false; }
  FILE* f = _wfopen(path.c_str(), L"rb"); if (!f) { M.err = "file model tidak bisa dibuka"; return false; }
  fseek(f, 0, SEEK_END); long len = ftell(f); fseek(f, 0, SEEK_SET);
  if (len < 1024 || len > 64 * 1024 * 1024) { fclose(f); M.err = "ukuran file model tidak wajar"; return false; }
  M.file.resize((size_t)len); const size_t got = fread(M.file.data(), 1, (size_t)len, f); fclose(f); if (got != (size_t)len) { M.err = "gagal membaca model"; return false; }
  const uint8_t* B = M.file.data(); const size_t N = M.file.size();
  if (memcmp(B + 4, "TFL3", 4) != 0) { M.err = "bukan file .tflite"; return false; }
  Tab root(B, N, rd32(B)); if (!root.ok()) { M.err = "model rusak"; return false; }
  uint32_t nOpc = 0; root.vec(1, nOpc); std::vector<int> opc(nOpc);
  for (uint32_t i = 0; i < nOpc; i++) { Tab o = root.vtab(1, i); int dc = (int)o.sc<int8_t>(0, 0), bc = o.sc<int32_t>(3, 0); opc[i] = std::max(dc, bc); }
  Tab sg = root.vtab(2, 0); if (!sg.ok()) { M.err = "model tanpa subgraph"; return false; }
  uint32_t nT = 0; sg.vec(0, nT); M.T.resize(nT);
  for (uint32_t i = 0; i < nT; i++) {
    Tab t = sg.vtab(0, i); Tensor& x = M.T[i];
    x.shape = t.ivec(0); x.type = t.sc<uint8_t>(1, 0); x.name = t.str(3); const uint32_t bi = t.sc<uint32_t>(2, 0);
    Tab bu = root.vtab(4, bi); uint32_t bn = 0; const uint8_t* bd = bu.ok() ? bu.vec(0, bn) : nullptr;
    dims(x);
    if (bd && bn) {
      x.isConst = true;
      if (x.type == 0) { x.cf.resize(bn / 4); memcpy(x.cf.data(), bd, (bn / 4) * 4); }
      else if (x.type == 1) { x.cf.resize(bn / 2); for (uint32_t k = 0; k < bn / 2; k++) { uint16_t h; memcpy(&h, bd + 2 * k, 2); x.cf[k] = half2f(h); } }
      else if (x.type == 2) { x.ci.resize(bn / 4); memcpy(x.ci.data(), bd, (bn / 4) * 4); }
      else if (x.type == 4) { x.ci.resize(bn / 8); for (uint32_t k = 0; k < bn / 8; k++) { int64_t v; memcpy(&v, bd + 8 * k, 8); x.ci[k] = (int32_t)v; } }
    }
  }
  std::vector<int32_t> ins = sg.ivec(1), outs = sg.ivec(2);
  if (ins.empty() || outs.empty()) { M.err = "model tanpa masukan/keluaran"; return false; }
  M.input = ins[0]; M.output = outs[0];
  // operator → dispatch
  struct Op { int code; std::vector<int32_t> in, out; Tab opt; };
  std::vector<Op> ops; uint32_t nO = 0; sg.vec(3, nO);
  for (uint32_t i = 0; i < nO; i++) { Tab o = sg.vtab(3, i); Op op; const uint32_t oi = o.sc<uint32_t>(0, 0); op.code = oi < opc.size() ? opc[oi] : -1; op.in = o.ivec(1); op.out = o.ivec(2); op.opt = o.tab(4); ops.push_back(op); }
  // konstanta: DEQUANTIZE (bobot fp16) & bentuk ulang konstanta dihitung sekali di CPU
  for (auto& op : ops) {
    if (op.in.empty() || op.out.empty() || op.in[0] < 0) continue;
    Tensor &a = M.T[op.in[0]], &y = M.T[op.out[0]];
    if ((op.code == DEQUANTIZE || op.code == RESHAPE || op.code == SQUEEZE || op.code == EXPAND_DIMS) && a.isConst && !a.cf.empty()) { y.isConst = true; y.cf = a.cf; op.code = -2; }
  }
  std::string bad; std::map<int, int> hist;
  for (auto& op : ops) {
    if (op.code == -2) continue; hist[op.code]++;
    switch (op.code) {
      case ADD: case MUL: case SUB: case DIV: case MAXIMUM: case MINIMUM: case CONV_2D: case DEPTHWISE_CONV_2D: case LOGISTIC: case HARD_SWISH: case RELU: case RELU6: case TANH: case RELU_N1_TO_1:
      case RESHAPE: case SQUEEZE: case EXPAND_DIMS: case DEQUANTIZE: case MEAN: case AVERAGE_POOL_2D: case MAX_POOL_2D: case RESIZE_BILINEAR: case RESIZE_NEAREST_NEIGHBOR: case CONCATENATION: case TRANSPOSE_CONV: case PAD: break;
      default: { char t[32]; snprintf(t, sizeof t, "%s%d", bad.empty() ? "" : ",", op.code); bad += t; }
    }
  }
  if (!bad.empty()) { M.err = "operator belum didukung: " + bad; return false; }
  // buffer GPU: konstanta float (bobot, bias, operand) & tensor aktivasi
  std::vector<char> needAct(M.T.size(), 0), needConst(M.T.size(), 0);
  needAct[M.input] = 1;
  for (auto& op : ops) {
    if (op.code == -2) continue;
    for (int o : op.out) if (o >= 0) needAct[o] = 1;
    for (int k : op.in) if (k >= 0 && M.T[k].isConst && !M.T[k].cf.empty()) needConst[k] = 1;
  }
  for (size_t i = 0; i < M.T.size(); i++) {
    Tensor& t = M.T[i];
    if (needConst[i] && t.isConst) { if (!mkBuf(t, false)) { M.err = "buffer GPU gagal"; return false; } }
    else if (needAct[i] && !t.isConst) { if (!mkBuf(t, true)) { M.err = "buffer GPU gagal"; return false; } }
  }
  for (auto& op : ops) {
    if (op.code == -2) continue;
    auto in = [&](int k) -> Tensor* { return k < (int)op.in.size() && op.in[k] >= 0 ? &M.T[op.in[k]] : nullptr; };
    Tensor* y = &M.T[op.out[0]]; Tensor* x = in(0); if (!x && op.code != TRANSPOSE_CONV) { M.err = "operator tanpa masukan"; return false; }
    P p{}; Disp d; d.out = y->uav.Get(); p.e[0] = (int)y->n;
    auto srv = [](Tensor* t) { return t ? t->srv.Get() : nullptr; };
    switch (op.code) {
      case CONV_2D: case DEPTHWISE_CONV_2D: {
        Tensor* w = in(1); Tensor* bs = in(2); const bool dw = op.code == DEPTHWISE_CONV_2D;
        const int pad = op.opt.sc<int8_t>(0, 0), sw = op.opt.sc<int32_t>(1, 1), sh = op.opt.sc<int32_t>(2, 1);
        const int actf = op.opt.sc<int8_t>(dw ? 4 : 3, 0), dlw = op.opt.sc<int32_t>(dw ? 5 : 4, 1), dlh = op.opt.sc<int32_t>(dw ? 6 : 5, 1);
        const int KH = w->H, KW = w->W; int pT = 0, pL = 0;
        if (pad == 0) { samePad(x->H, KH, sh, dlh, y->H, pT); samePad(x->W, KW, sw, dlw, y->W, pL); }
        int a_[4] = { x->H, x->W, x->C, y->C }, b_[4] = { y->H, y->W, KH, KW }, c_[4] = { sh, sw, pT, pL }, d_[4] = { dlh, dlw, actf, bs ? 1 : 0 };
        memcpy(p.a, a_, 16); memcpy(p.b, b_, 16); memcpy(p.c, c_, 16); memcpy(p.d, d_, 16);
        if (dw) p.e[1] = std::max(1, y->C / std::max(1, x->C));
        d.sh = dw ? S_DW : S_CONV; d.in[0] = srv(x); d.in[1] = srv(w); d.in[2] = srv(bs); break;
      }
      case TRANSPOSE_CONV: {
        Tensor* w = in(1); Tensor* xx = in(2); Tensor* bs = in(3); if (!w || !xx) { M.err = "TRANSPOSE_CONV tidak lengkap"; return false; }
        const int pad = op.opt.sc<int8_t>(0, 0), sw = op.opt.sc<int32_t>(1, 1), sh = op.opt.sc<int32_t>(2, 1), actf = op.opt.sc<int8_t>(3, 0);
        const int KH = w->H, KW = w->W; int pT = 0, pL = 0;
        if (pad == 0) { pT = std::max(0, ((xx->H - 1) * sh + KH - y->H) / 2); pL = std::max(0, ((xx->W - 1) * sw + KW - y->W) / 2); }
        int a_[4] = { xx->H, xx->W, xx->C, y->C }, b_[4] = { y->H, y->W, KH, KW }, c_[4] = { sh, sw, pT, pL }, d_[4] = { actf, bs ? 1 : 0, 0, 0 };
        memcpy(p.a, a_, 16); memcpy(p.b, b_, 16); memcpy(p.c, c_, 16); memcpy(p.d, d_, 16);
        d.sh = S_TCONV; d.in[0] = srv(xx); d.in[1] = srv(w); d.in[2] = srv(bs); break;
      }
      case ADD: case MUL: case SUB: case DIV: case MAXIMUM: case MINIMUM: {
        Tensor* q = in(1); if (!q) { M.err = "operasi biner tanpa operand"; return false; }
        const int actf = (op.code == MAXIMUM || op.code == MINIMUM) ? 0 : op.opt.sc<int8_t>(0, 0);
        const int opk = op.code == ADD ? 0 : op.code == MUL ? 1 : op.code == SUB ? 2 : op.code == DIV ? 3 : op.code == MAXIMUM ? 4 : 5;
        int a_[4] = { x->H, x->W, x->C, 0 }, b_[4] = { q->H, q->W, q->C, 0 }, c_[4] = { y->H, y->W, y->C, opk };
        memcpy(p.a, a_, 16); memcpy(p.b, b_, 16); memcpy(p.c, c_, 16); p.d[0] = actf;
        d.sh = S_BIN; d.in[0] = srv(x); d.in[1] = srv(q); break;
      }
      case LOGISTIC: case HARD_SWISH: case RELU: case RELU6: case TANH: case RELU_N1_TO_1: case RESHAPE: case SQUEEZE: case EXPAND_DIMS: case DEQUANTIZE:
        p.a[0] = op.code == RELU ? 1 : op.code == RELU6 ? 2 : op.code == LOGISTIC ? 3 : op.code == HARD_SWISH ? 4 : op.code == TANH ? 5 : op.code == RELU_N1_TO_1 ? 6 : 0;
        d.sh = S_UN; d.in[0] = srv(x); break;
      case MEAN: { int a_[4] = { x->H, x->W, x->C, 0 }; memcpy(p.a, a_, 16); p.e[0] = x->C; d.sh = S_MEAN; d.in[0] = srv(x); break; }
      case AVERAGE_POOL_2D: case MAX_POOL_2D: {
        const int pad = op.opt.sc<int8_t>(0, 0), sw = op.opt.sc<int32_t>(1, 1), sh = op.opt.sc<int32_t>(2, 1), fw = op.opt.sc<int32_t>(3, 1), fh = op.opt.sc<int32_t>(4, 1), actf = op.opt.sc<int8_t>(5, 0);
        int pT = 0, pL = 0; if (pad == 0) { samePad(x->H, fh, sh, 1, y->H, pT); samePad(x->W, fw, sw, 1, y->W, pL); }
        int a_[4] = { x->H, x->W, x->C, op.code == MAX_POOL_2D ? 1 : 0 }, b_[4] = { y->H, y->W, fh, fw }, c_[4] = { sh, sw, pT, pL };
        memcpy(p.a, a_, 16); memcpy(p.b, b_, 16); memcpy(p.c, c_, 16); p.d[0] = actf; d.sh = S_POOL; d.in[0] = srv(x); break;
      }
      case RESIZE_BILINEAR: case RESIZE_NEAREST_NEIGHBOR: {
        const int al = op.opt.sc<uint8_t>(2, 0), hp = op.opt.sc<uint8_t>(3, 0);
        int a_[4] = { x->H, x->W, x->C, op.code == RESIZE_NEAREST_NEIGHBOR ? 1 : 0 }, b_[4] = { y->H, y->W, al, hp };
        memcpy(p.a, a_, 16); memcpy(p.b, b_, 16);
        p.f[0] = (al && y->H > 1) ? (float)(x->H - 1) / (y->H - 1) : (float)x->H / y->H; p.f[1] = (al && y->W > 1) ? (float)(x->W - 1) / (y->W - 1) : (float)x->W / y->W;
        d.sh = S_RESIZE; d.in[0] = srv(x); break;
      }
      case PAD: {
        Tensor* pd = in(1); if (!pd || pd->ci.size() < 8) { M.err = "PAD tanpa konstanta"; return false; }
        int a_[4] = { x->H, x->W, x->C, 0 }, b_[4] = { y->H, y->W, y->C, 0 }, c_[4] = { pd->ci[2], pd->ci[4], pd->ci[6], 0 };
        memcpy(p.a, a_, 16); memcpy(p.b, b_, 16); memcpy(p.c, c_, 16); d.sh = S_PAD; d.in[0] = srv(x); break;
      }
      case CONCATENATION: {
        int axis = op.opt.sc<int32_t>(0, 0); const int rank = (int)y->shape.size(); if (axis < 0) axis += rank;
        if (axis != rank - 1) { M.err = "CONCATENATION selain sumbu kanal"; return false; }
        int off = 0;
        for (size_t k = 0; k < op.in.size(); k++) { // satu dispatch per masukan
          Tensor* xi = in((int)k); if (!xi) continue; P pk{}; pk.a[0] = xi->C; pk.a[1] = y->C; pk.a[2] = off; pk.e[0] = (int)xi->n;
          Disp dk; dk.sh = S_CONCAT; dk.out = y->uav.Get(); dk.in[0] = srv(xi); dk.cb = mkCB(pk); groups(dk, xi->n); M.D.push_back(dk); off += xi->C;
        }
        continue;
      }
      default: break;
    }
    if (d.sh == S_UN && !d.in[0]) { M.err = "masukan tidak tersedia"; return false; }
    d.cb = mkCB(p); groups(d, (size_t)p.e[0]); M.D.push_back(d);
  }
  // shader & sampler
  for (int i = 0; i < S_N; i++) {
    ComPtr<ID3DBlob> blob, err;
    if (FAILED(D3DCompile(kCs, strlen(kCs), "klmseg", nullptr, nullptr, kCsNames[i], "cs_5_0", D3DCOMPILE_OPTIMIZATION_LEVEL3, 0, &blob, &err))) {
      M.err = std::string("shader ") + kCsNames[i] + ": " + (err ? (const char*)err->GetBufferPointer() : "?"); return false; }
    if (FAILED(g_dev->CreateComputeShader(blob->GetBufferPointer(), blob->GetBufferSize(), nullptr, &M.cs[i]))) { M.err = "compute shader gagal"; return false; }
  }
  D3D11_SAMPLER_DESC sd{}; sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR; sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP; sd.MaxLOD = D3D11_FLOAT32_MAX;
  g_dev->CreateSamplerState(&sd, &M.samp);
  const Tensor &ti = M.T[M.input], &to = M.T[M.output];
  M.IH = ti.H; M.IW = ti.W; M.OH = to.H; M.OW = to.W; M.OC = to.C;
  if (ti.C != 3) { M.err = "masukan model bukan RGB"; return false; }
  M.ops = (int)M.D.size(); M.ok = true;
  char t[160]; std::string h; for (auto& kv : hist) { snprintf(t, sizeof t, "%s%s×%d", h.empty() ? "" : " ", opName(kv.first), kv.second); h += t; }
  snprintf(t, sizeof t, "masukan %dx%dx3, keluaran %dx%dx%d, %d dispatch • ", M.IH, M.IW, M.OH, M.OW, M.OC, M.ops); info = t + h;
  return true;
}
static void unbind() {
  ID3D11ShaderResourceView* ns[4] = { nullptr, nullptr, nullptr, nullptr }; ID3D11UnorderedAccessView* nu[2] = { nullptr, nullptr };
  g_ctx->CSSetShaderResources(0, 4, ns); g_ctx->CSSetUnorderedAccessViews(0, 2, nu, nullptr); g_ctx->CSSetShader(nullptr, nullptr, 0);
}
// jalankan seluruh operator (masukan sudah terisi)
static void runOps() {
  for (auto& d : M.D) {
    g_ctx->CSSetShader(M.cs[d.sh].Get(), nullptr, 0);
    g_ctx->CSSetConstantBuffers(0, 1, d.cb.GetAddressOf());
    g_ctx->CSSetShaderResources(0, 3, d.in);
    g_ctx->CSSetUnorderedAccessViews(0, 1, &d.out, nullptr);
    g_ctx->Dispatch(d.gx, d.gy, 1);
    ID3D11UnorderedAccessView* nu = nullptr; g_ctx->CSSetUnorderedAccessViews(0, 1, &nu, nullptr); // tensor ini dibaca operator berikutnya
  }
  unbind();
}
// gambar sumber (tekstur apa pun) → masukan model (diperkecil, rentang 0..1 · skala + geser)
static float g_inScale = 1.f, g_inOff = 0.f;
static void feed(ID3D11ShaderResourceView* src) {
  P p{}; p.a[0] = M.IH; p.a[1] = M.IW; p.f[0] = g_inScale; p.f[1] = g_inOff;
  static ComPtr<ID3D11Buffer> cb; static P last{}; if (!cb || memcmp(&last, &p, sizeof p)) { cb = mkCB(p); last = p; }
  g_ctx->CSSetShader(M.cs[S_IN].Get(), nullptr, 0); g_ctx->CSSetConstantBuffers(0, 1, cb.GetAddressOf());
  g_ctx->CSSetShaderResources(3, 1, &src); g_ctx->CSSetSamplers(0, 1, M.samp.GetAddressOf());
  ID3D11UnorderedAccessView* u = M.T[M.input].uav.Get(); g_ctx->CSSetUnorderedAccessViews(0, 1, &u, nullptr);
  g_ctx->Dispatch((M.IW + 7) / 8, (M.IH + 7) / 8, 1);
  unbind();
}
// keluaran model → mask R8 (+ status redam kedip per sumber)
static void post(ID3D11UnorderedAccessView* state, ID3D11UnorderedAccessView* mask, bool inv, float lo, float hi) {
  P p{}; p.a[0] = M.OH; p.a[1] = M.OW; p.a[2] = M.OC; p.a[3] = inv ? 1 : 0; p.f[0] = lo; p.f[1] = hi;
  ComPtr<ID3D11Buffer> cb = mkCB(p);
  g_ctx->CSSetShader(M.cs[S_POST].Get(), nullptr, 0); g_ctx->CSSetConstantBuffers(0, 1, cb.GetAddressOf());
  ID3D11ShaderResourceView* s = M.T[M.output].srv.Get(); g_ctx->CSSetShaderResources(0, 1, &s);
  ID3D11UnorderedAccessView* u[2] = { state, mask }; g_ctx->CSSetUnorderedAccessViews(0, 2, u, nullptr);
  g_ctx->Dispatch((M.OW + 7) / 8, (M.OH + 7) / 8, 1);
  unbind();
}
// baca balik tensor (uji mandiri)
static bool readBack(int ti, std::vector<float>& out) {
  Tensor& t = M.T[ti]; D3D11_BUFFER_DESC bd{}; t.b->GetDesc(&bd); bd.Usage = D3D11_USAGE_STAGING; bd.BindFlags = 0; bd.CPUAccessFlags = D3D11_CPU_ACCESS_READ; bd.MiscFlags = 0; bd.StructureByteStride = 0;
  ComPtr<ID3D11Buffer> st; if (FAILED(g_dev->CreateBuffer(&bd, nullptr, &st))) return false;
  g_ctx->CopyResource(st.Get(), t.b.Get()); D3D11_MAPPED_SUBRESOURCE m; if (FAILED(g_ctx->Map(st.Get(), 0, D3D11_MAP_READ, 0, &m))) return false;
  out.resize(t.n); memcpy(out.data(), m.pData, t.n * 4); g_ctx->Unmap(st.Get(), 0); return true;
}
static void upload(int ti, const std::vector<float>& v) { Tensor& t = M.T[ti]; if (v.size() >= t.n) g_ctx->UpdateSubresource(t.b.Get(), 0, nullptr, v.data(), 0, 0); }

} // namespace segm
