// klm-procaudio — tangkap suara PC (WASAPI process loopback, Windows 10 2004+) KECUALI suara KLM Mix sendiri,
// lalu kirim ke port Mirroring KLM Mix (127.0.0.1) sebagai PCM s16le stereo 48 kHz (protokol KLMM, paket tipe 5).
// Dipakai input "Android tanpa aplikasi — Miracast": suara HP yang diputar aplikasi Tampilan Nirkabel Windows ikut masuk
// tanpa gema (keluaran KLM Mix tidak ikut tertangkap).
//   klm-procaudio --port 8624 --token <hex> --exclude-pid <pid KLM Mix> [--name "Miracast"]
// Status ke stdout (baris JSON). Lisensi: MIT (bagian dari KLM Mix).
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#if defined(_MSC_VER)
#include <audioclientactivationparams.h>
#pragma comment(lib, "mmdevapi.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "ws2_32.lib")
#else
// header belum ada di sebagian toolchain MinGW — definisi sesuai Windows SDK 10.0.19041
typedef enum { AUDIOCLIENT_ACTIVATION_TYPE_DEFAULT = 0, AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK = 1 } AUDIOCLIENT_ACTIVATION_TYPE;
typedef enum { PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE = 0, PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE = 1 } PROCESS_LOOPBACK_MODE;
typedef struct { DWORD TargetProcessId; PROCESS_LOOPBACK_MODE ProcessLoopbackMode; } AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS;
typedef struct { AUDIOCLIENT_ACTIVATION_TYPE ActivationType; union { AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams; }; } AUDIOCLIENT_ACTIVATION_PARAMS;
#define VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK L"VAD\\Process_Loopback"
#endif

static void status(const char *ev, const char *msg) {
  char m[512]; size_t k = 0;
  for (const char *p = msg ? msg : ""; *p && k + 3 < sizeof m; p++) { if (*p == '"' || *p == '\\') m[k++] = '\\'; if ((unsigned char) *p >= 0x20) m[k++] = *p; }
  m[k] = 0;
  printf("{\"ev\":\"%s\",\"msg\":\"%s\"}\n", ev, m); fflush(stdout);
}

// ---------- penanganan selesai aktivasi (COM, agile) ----------
class Done : public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
  LONG ref = 1;
public:
  HANDLE ev = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  IActivateAudioInterfaceAsyncOperation *op = nullptr;
  ~Done() { CloseHandle(ev); }
  STDMETHODIMP QueryInterface(REFIID r, void **o) override {
    if (r == __uuidof(IUnknown) || r == __uuidof(IActivateAudioInterfaceCompletionHandler)) { *o = static_cast<IActivateAudioInterfaceCompletionHandler *>(this); AddRef(); return S_OK; }
    if (r == __uuidof(IAgileObject)) { *o = static_cast<IAgileObject *>(this); AddRef(); return S_OK; }
    *o = nullptr; return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return (ULONG) InterlockedIncrement(&ref); }
  STDMETHODIMP_(ULONG) Release() override { ULONG n = (ULONG) InterlockedDecrement(&ref); if (!n) delete this; return n; }
  STDMETHODIMP ActivateCompleted(IActivateAudioInterfaceAsyncOperation *o) override { op = o; op->AddRef(); SetEvent(ev); return S_OK; }
};

static SOCKET sock = INVALID_SOCKET;
static bool sendAll(const void *p, int n) { const char *c = (const char *) p; while (n > 0) { int w = send(sock, c, n, 0); if (w <= 0) return false; c += w; n -= w; } return true; }
static bool connectMix(int port, const char *token, const char *name) {
  sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (sock == INVALID_SOCKET) return false;
  sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons((u_short) port); a.sin_addr.s_addr = htonl(0x7f000001);
  if (connect(sock, (sockaddr *) &a, sizeof a) != 0) { closesocket(sock); sock = INVALID_SOCKET; return false; }
  BOOL one = TRUE; setsockopt(sock, IPPROTO_TCP, TCP_NODELAY, (const char *) &one, sizeof one);
  char js[512]; int jl = snprintf(js, sizeof js, "{\"token\":\"%s\",\"name\":\"%s\",\"audio\":48000,\"audioOnly\":true}", token, name);
  unsigned char hd[7] = { 'K', 'L', 'M', 'M', 1, (unsigned char) (jl >> 8), (unsigned char) (jl & 255) };
  return sendAll(hd, 7) && sendAll(js, jl);
}
static bool sendPcm(const int16_t *d, int frames, uint64_t ptsUs) {
  uint32_t n = (uint32_t) frames * 4; unsigned char h[13]; h[0] = 5;
  h[1] = (unsigned char) (n >> 24); h[2] = (unsigned char) (n >> 16); h[3] = (unsigned char) (n >> 8); h[4] = (unsigned char) n;
  for (int i = 0; i < 8; i++) h[5 + i] = (unsigned char) (ptsUs >> (56 - 8 * i));
  return sendAll(h, 13) && sendAll(d, (int) n);
}

int main(int argc, char **argv) {
  int port = 8624; DWORD pid = 0; char token[40] = "", name[80] = "Suara PC";
  for (int i = 1; i + 1 < argc; i++) {
    const char *k = argv[i];
    if (!strcmp(k, "--port")) port = atoi(argv[++i]);
    else if (!strcmp(k, "--token")) snprintf(token, sizeof token, "%s", argv[++i]);
    else if (!strcmp(k, "--exclude-pid")) pid = (DWORD) strtoul(argv[++i], nullptr, 10);
    else if (!strcmp(k, "--name")) snprintf(name, sizeof name, "%s", argv[++i]);
  }
  for (char *c = token; *c; c++) if (!((*c >= '0' && *c <= '9') || (*c >= 'a' && *c <= 'f'))) *c = 0;
  if (!token[0] || !pid) { status("error", "argumen kurang (--token, --exclude-pid)"); return 2; }
  for (char *c = name; *c; c++) if (*c == '"' || *c == '\\' || (unsigned char) *c < 0x20) *c = ' ';
  SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
  WSADATA wsa; WSAStartup(MAKEWORD(2, 2), &wsa);
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);

  AUDIOCLIENT_ACTIVATION_PARAMS ap{}; ap.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
  ap.ProcessLoopbackParams.TargetProcessId = pid; ap.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;
  PROPVARIANT pv; PropVariantInit(&pv); pv.vt = VT_BLOB; pv.blob.cbSize = sizeof ap; pv.blob.pBlobData = (BYTE *) &ap;
  Done *done = new Done();
  IActivateAudioInterfaceAsyncOperation *aop = nullptr;
  HRESULT hr = ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, __uuidof(IAudioClient), &pv, done, &aop);
  if (FAILED(hr)) { status("error", "Windows ini belum mendukung tangkap suara per aplikasi (butuh Windows 10 versi 2004 atau lebih baru)"); return 3; }
  if (WaitForSingleObject(done->ev, 5000) != WAIT_OBJECT_0 || !done->op) { status("error", "aktivasi audio tidak selesai"); return 3; }
  HRESULT ahr = E_FAIL; IUnknown *unk = nullptr;
  done->op->GetActivateResult(&ahr, &unk);
  if (FAILED(ahr) || !unk) { char m[96]; snprintf(m, sizeof m, "aktivasi audio gagal (0x%08lx)", (unsigned long) ahr); status("error", m); return 3; }
  IAudioClient *ac = nullptr; unk->QueryInterface(__uuidof(IAudioClient), (void **) &ac); unk->Release();
  if (!ac) { status("error", "IAudioClient tidak tersedia"); return 3; }

  WAVEFORMATEX fmt{}; fmt.wFormatTag = WAVE_FORMAT_PCM; fmt.nChannels = 2; fmt.nSamplesPerSec = 48000; fmt.wBitsPerSample = 16;
  fmt.nBlockAlign = 4; fmt.nAvgBytesPerSec = 48000 * 4;
  HANDLE evt = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = ac->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, 200000, 0, &fmt, nullptr);
  if (FAILED(hr)) { char m[96]; snprintf(m, sizeof m, "audio tidak bisa disiapkan (0x%08lx)", (unsigned long) hr); status("error", m); return 4; }
  ac->SetEventHandle(evt);
  IAudioCaptureClient *cap = nullptr;
  if (FAILED(ac->GetService(__uuidof(IAudioCaptureClient), (void **) &cap)) || !cap) { status("error", "IAudioCaptureClient tidak tersedia"); return 4; }

  int16_t *zero = nullptr; UINT32 zeroCap = 0;
  uint64_t frames = 0, lastTry = 0;
  ac->Start();
  status("ready", "");
  bool connected = false;
  for (;;) {
    DWORD w = WaitForSingleObject(evt, 200);
    if (!connected) {
      uint64_t now = GetTickCount64();
      if (now - lastTry > 1000) { lastTry = now; connected = connectMix(port, token, name); if (connected) status("connected", ""); }
    }
    if (w != WAIT_OBJECT_0) continue;
    UINT32 n = 0;
    while (SUCCEEDED(cap->GetNextPacketSize(&n)) && n) {
      BYTE *data = nullptr; UINT32 got = 0; DWORD flags = 0;
      if (FAILED(cap->GetBuffer(&data, &got, &flags, nullptr, nullptr))) break;
      const int16_t *pcm = (const int16_t *) data;
      if (flags & AUDCLNT_BUFFERFLAGS_SILENT) { if (zeroCap < got) { free(zero); zero = (int16_t *) calloc((size_t) got * 2, sizeof(int16_t)); zeroCap = got; } pcm = zero; }
      if (connected && !sendPcm(pcm, (int) got, frames * 1000000ULL / 48000)) { closesocket(sock); sock = INVALID_SOCKET; connected = false; status("disconnected", ""); }
      frames += got;
      cap->ReleaseBuffer(got);
    }
  }
}
