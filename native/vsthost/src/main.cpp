// KLM Mix VST host — proses helper (satu proses per instance plugin).
// Protokol biner lewat stdin/stdout: [u32 len (termasuk byte tipe)][u8 tipe][payload], little-endian.
//   -> 'P' u32 seq,u32 n,u32 ch, float32 planar      <- 'A' format sama (audio terproses)
//   -> 'E' u8 0=tutup 1=buka 2=toggle                <- 'W' {"open":bool}
//   -> 'G' ambil state                               <- 'S' bytes
//   -> 'L' bytes set state                           <- 'K' {"ok":bool}
//   -> 'V' u32 id, f64 nilai normal 0..1
//   -> 'p' daftar parameter                          <- 'p' JSON
//   -> 'B' u8 bypass
//   -> 'Q' keluar
//   <- 'I' info JSON (sekali, setelah load)   <- 'D' state berubah   <- 'X' log teks
#include "plug.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <ole2.h>
#else
#include <unistd.h>
#endif

namespace klm {

std::string gWindowTitle;
double gSampleRate = 48000;
int gMaxBlock = 512;

static int gOutFd = 1, gInFd = 0;
static std::mutex gWriteMx;
static std::atomic<bool> gQuit {false};
static std::atomic<bool> gBypass {false};
static Plug* gPlug = nullptr;

std::string jsonEsc (const std::string& s)
{
	std::string o;
	o.reserve (s.size () + 8);
	for (unsigned char c : s)
	{
		switch (c)
		{
			case '"': o += "\\\""; break;
			case '\\': o += "\\\\"; break;
			case '\n': o += "\\n"; break;
			case '\r': o += "\\r"; break;
			case '\t': o += "\\t"; break;
			default:
				if (c < 0x20) { char b[8]; std::snprintf (b, sizeof b, "\\u%04x", c); o += b; }
				else o += (char)c;
		}
	}
	return o;
}

static bool writeAll (const void* p, size_t n)
{
	const char* c = (const char*)p;
	while (n > 0)
	{
#if defined(_WIN32)
		int w = _write (gOutFd, c, (unsigned)(n > (1 << 30) ? (1 << 30) : n));
#else
		ssize_t w = ::write (gOutFd, c, n);
#endif
		if (w <= 0) return false;
		c += w;
		n -= (size_t)w;
	}
	return true;
}
static bool readAll (void* p, size_t n)
{
	char* c = (char*)p;
	while (n > 0)
	{
#if defined(_WIN32)
		int r = _read (gInFd, c, (unsigned)(n > (1 << 30) ? (1 << 30) : n));
#else
		ssize_t r = ::read (gInFd, c, n);
#endif
		if (r <= 0) return false;
		c += r;
		n -= (size_t)r;
	}
	return true;
}

static void sendFrame (char type, const void* a, size_t na, const void* b = nullptr, size_t nb = 0)
{
	uint32_t len = (uint32_t)(1 + na + nb);
	std::lock_guard<std::mutex> lk (gWriteMx);
	writeAll (&len, 4);
	writeAll (&type, 1);
	if (na) writeAll (a, na);
	if (nb) writeAll (b, nb);
}
static void sendText (char type, const std::string& s) { sendFrame (type, s.data (), s.size ()); }

void logf (const char* fmt, ...)
{
	char buf[1024];
	va_list ap;
	va_start (ap, fmt);
	std::vsnprintf (buf, sizeof buf, fmt, ap);
	va_end (ap);
	std::fprintf (stderr, "[klm-vsthost] %s\n", buf);
	sendText ('X', buf);
}

// ---------------- antrean pekerjaan untuk thread UI ----------------
static std::mutex gUiMx;
static std::condition_variable gUiCv;
static std::deque<std::function<void ()>> gUiJobs;
#if defined(_WIN32)
static HWND gMsgWnd = nullptr;
static const UINT WM_KLM_JOBS = WM_APP + 7;
#endif

static void runOnUi (std::function<void ()> f)
{
	{
		std::lock_guard<std::mutex> lk (gUiMx);
		gUiJobs.push_back (std::move (f));
	}
#if defined(_WIN32)
	if (gMsgWnd) PostMessageW (gMsgWnd, WM_KLM_JOBS, 0, 0);
#endif
	gUiCv.notify_one ();
}
static void drainUi ()
{
	for (;;)
	{
		std::function<void ()> f;
		{
			std::lock_guard<std::mutex> lk (gUiMx);
			if (gUiJobs.empty ()) return;
			f = std::move (gUiJobs.front ());
			gUiJobs.pop_front ();
		}
		f ();
	}
}

static bool gLastEditorOpen = false;
static void sendEditorState ()
{
	bool open = gPlug && gPlug->editorOpen ();
	gLastEditorOpen = open;
	sendText ('W', std::string ("{\"open\":") + (open ? "true" : "false") + "}");
}
static void uiTick ()
{
	if (!gPlug) return;
	gPlug->idle ();
	if (gPlug->dirty.exchange (false)) sendFrame ('D', nullptr, 0);
	if (gPlug->editorClosed.exchange (false) || gPlug->editorOpen () != gLastEditorOpen) sendEditorState ();
}

// ---------------- jendela editor (Windows) ----------------
#if defined(_WIN32)
static const wchar_t* kEditorClass = L"KLMMixVstEditor";
static const wchar_t* kMsgClass = L"KLMMixVstMsg";

static std::wstring widen (const std::string& s)
{
	int n = MultiByteToWideChar (CP_UTF8, 0, s.c_str (), -1, nullptr, 0);
	std::wstring w (n > 0 ? n - 1 : 0, 0);
	if (n > 1) MultiByteToWideChar (CP_UTF8, 0, s.c_str (), -1, &w[0], n);
	return w;
}

static LRESULT CALLBACK editorProc (HWND h, UINT m, WPARAM wp, LPARAM lp)
{
	Plug* owner = (Plug*)GetWindowLongPtrW (h, GWLP_USERDATA);
	switch (m)
	{
		case WM_SIZE:
			if (owner && wp != SIZE_MINIMIZED) owner->onWindowSize (LOWORD (lp), HIWORD (lp));
			return 0;
		case WM_CLOSE:
			if (owner) owner->onWindowClose ();
			else DestroyWindow (h);
			return 0;
		case WM_ERASEBKGND: return 1;
	}
	return DefWindowProcW (h, m, wp, lp);
}
static LRESULT CALLBACK msgProc (HWND h, UINT m, WPARAM wp, LPARAM lp)
{
	if (m == WM_KLM_JOBS) { drainUi (); return 0; }
	if (m == WM_TIMER) { uiTick (); return 0; }
	return DefWindowProcW (h, m, wp, lp);
}

static DWORD styleFor (bool resizable)
{
	DWORD s = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN;
	if (resizable) s |= WS_THICKFRAME | WS_MAXIMIZEBOX;
	return s;
}
static UINT dpiOf (HWND h)
{
	HMODULE u = GetModuleHandleA ("user32.dll");
	typedef UINT (WINAPI * GDW) (HWND);
	auto f = u ? (GDW)GetProcAddress (u, "GetDpiForWindow") : nullptr;
	return f && h ? f (h) : 96;
}
static RECT outerRect (HWND h, DWORD style, int w, int hh)
{
	RECT r {0, 0, w, hh};
	HMODULE u = GetModuleHandleA ("user32.dll");
	typedef BOOL (WINAPI * ADJ) (LPRECT, DWORD, BOOL, DWORD, UINT);
	auto f = u ? (ADJ)GetProcAddress (u, "AdjustWindowRectExForDpi") : nullptr;
	if (f && h) f (&r, style, FALSE, 0, dpiOf (h));
	else AdjustWindowRectEx (&r, style, FALSE, 0);
	return r;
}

void* createEditorWindow (Plug* owner, const std::string& title, int w, int h, bool resizable)
{
	DWORD style = styleFor (resizable);
	RECT r = outerRect (nullptr, style, w, h);
	HWND hw = CreateWindowExW (0, kEditorClass, widen (title).c_str (), style, CW_USEDEFAULT, CW_USEDEFAULT, r.right - r.left,
	                           r.bottom - r.top, nullptr, nullptr, GetModuleHandleW (nullptr), nullptr);
	if (!hw) return nullptr;
	SetWindowLongPtrW (hw, GWLP_USERDATA, (LONG_PTR)owner);
	// ukur ulang sesuai DPI monitor tempat jendela muncul
	RECT r2 = outerRect (hw, style, w, h);
	SetWindowPos (hw, nullptr, 0, 0, r2.right - r2.left, r2.bottom - r2.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
	return hw;
}
void resizeEditorWindow (void* hwnd, int w, int h)
{
	HWND hw = (HWND)hwnd;
	if (!hw || w <= 0 || h <= 0) return;
	RECT cur;
	GetClientRect (hw, &cur);
	if (cur.right == w && cur.bottom == h) return;
	DWORD style = (DWORD)GetWindowLongPtrW (hw, GWL_STYLE);
	RECT r = outerRect (hw, style, w, h);
	SetWindowPos (hw, nullptr, 0, 0, r.right - r.left, r.bottom - r.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
}
void destroyEditorWindow (void* hwnd)
{
	HWND hw = (HWND)hwnd;
	if (!hw) return;
	SetWindowLongPtrW (hw, GWLP_USERDATA, 0);
	DestroyWindow (hw);
}
void showEditorWindow (void* hwnd)
{
	HWND hw = (HWND)hwnd;
	if (!hw) return;
	if (IsIconic (hw)) ShowWindow (hw, SW_RESTORE);
	else ShowWindow (hw, SW_SHOW);
	// bawa ke depan aplikasi KLM Mix (foreground lock Windows dilewati dengan topmost sesaat)
	SetWindowPos (hw, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
	SetWindowPos (hw, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
	SetForegroundWindow (hw);
}

static void registerClasses ()
{
	WNDCLASSEXW wc {};
	wc.cbSize = sizeof wc;
	wc.lpfnWndProc = editorProc;
	wc.hInstance = GetModuleHandleW (nullptr);
	wc.hCursor = LoadCursor (nullptr, IDC_ARROW);
	wc.hbrBackground = (HBRUSH)GetStockObject (BLACK_BRUSH);
	wc.hIcon = LoadIcon (nullptr, IDI_APPLICATION);
	wc.lpszClassName = kEditorClass;
	RegisterClassExW (&wc);
	WNDCLASSEXW mc {};
	mc.cbSize = sizeof mc;
	mc.lpfnWndProc = msgProc;
	mc.hInstance = GetModuleHandleW (nullptr);
	mc.lpszClassName = kMsgClass;
	RegisterClassExW (&mc);
}
static void setDpiAware ()
{
	HMODULE u = GetModuleHandleA ("user32.dll");
	typedef BOOL (WINAPI * SPDAC) (HANDLE);
	if (auto f = u ? (SPDAC)GetProcAddress (u, "SetProcessDpiAwarenessContext") : nullptr)
	{
		if (f ((HANDLE)-4)) return; // PER_MONITOR_AWARE_V2
	}
	typedef BOOL (WINAPI * SPDA) ();
	if (auto f = u ? (SPDA)GetProcAddress (u, "SetProcessDPIAware") : nullptr) f ();
}
#endif

// ---------------- thread audio (pembaca stdin) ----------------
static void readerLoop ()
{
	std::vector<uint8_t> buf;
	const int maxCh = 8;
	std::vector<std::vector<float>> in (maxCh), out (maxCh);
	for (auto& v : in) v.assign (gMaxBlock, 0.f);
	for (auto& v : out) v.assign (gMaxBlock, 0.f);
	float* pin[maxCh];
	float* pout[maxCh];
	std::vector<float> reply;
	while (!gQuit)
	{
		uint32_t len = 0;
		if (!readAll (&len, 4) || len == 0 || len > (64u << 20)) break;
		buf.resize (len);
		if (!readAll (buf.data (), len)) break;
		char t = (char)buf[0];
		const uint8_t* d = buf.data () + 1;
		size_t n = len - 1;
		if (t == 'P' && n >= 12)
		{
			uint32_t seq, frames, ch;
			std::memcpy (&seq, d, 4);
			std::memcpy (&frames, d + 4, 4);
			std::memcpy (&ch, d + 8, 4);
			if (ch < 1 || ch > (uint32_t)maxCh || n < 12 + (size_t)frames * ch * 4) continue;
			const float* src = (const float*)(d + 12);
			reply.resize ((size_t)frames * ch);
			for (uint32_t off = 0; off < frames; off += gMaxBlock)
			{
				int k = (int)std::min<uint32_t> (gMaxBlock, frames - off);
				for (uint32_t c = 0; c < ch; c++)
				{
					std::memcpy (in[c].data (), src + (size_t)c * frames + off, sizeof (float) * k);
					pin[c] = in[c].data ();
					pout[c] = out[c].data ();
				}
				if (gBypass || !gPlug)
					for (uint32_t c = 0; c < ch; c++) std::memcpy (pout[c], pin[c], sizeof (float) * k);
				else
					gPlug->process (pin, pout, (int)ch, k);
				for (uint32_t c = 0; c < ch; c++) std::memcpy (reply.data () + (size_t)c * frames + off, pout[c], sizeof (float) * k);
			}
			sendFrame ('A', d, 12, reply.data (), reply.size () * 4);
		}
		else if (t == 'E' && n >= 1)
		{
			int mode = d[0];
			runOnUi ([mode] {
				if (!gPlug) return;
				bool want = mode == 2 ? !gPlug->editorOpen () : mode == 1;
				gPlug->showEditor (want);
				sendEditorState ();
			});
		}
		else if (t == 'G')
		{
			runOnUi ([] {
				std::vector<uint8_t> s = gPlug ? gPlug->getState () : std::vector<uint8_t> ();
				sendFrame ('S', s.data (), s.size ());
			});
		}
		else if (t == 'L')
		{
			auto data = std::make_shared<std::vector<uint8_t>> (d, d + n);
			runOnUi ([data] {
				bool ok = gPlug && gPlug->setState (data->data (), data->size ());
				if (gPlug) gPlug->dirty = false;
				sendText ('K', std::string ("{\"ok\":") + (ok ? "true" : "false") + "}");
			});
		}
		else if (t == 'V' && n >= 12)
		{
			uint32_t id;
			double v;
			std::memcpy (&id, d, 4);
			std::memcpy (&v, d + 4, 8);
			runOnUi ([id, v] { if (gPlug) gPlug->setParam (id, v); });
		}
		else if (t == 'p')
		{
			runOnUi ([] { sendText ('p', gPlug ? gPlug->paramsJson () : "[]"); });
		}
		else if (t == 'B' && n >= 1)
		{
			gBypass = d[0] != 0;
		}
		else if (t == 'Q')
		{
			break;
		}
	}
	gQuit = true;
	runOnUi ([] {});
#if defined(_WIN32)
	if (gMsgWnd) PostMessageW (gMsgWnd, WM_CLOSE, 0, 0);
#endif
}

static std::string lower (std::string s)
{
	for (auto& c : s) c = (char)std::tolower ((unsigned char)c);
	return s;
}
static bool endsWith (const std::string& s, const std::string& e) { return s.size () >= e.size () && s.compare (s.size () - e.size (), e.size (), e) == 0; }

static std::string infoJson (bool ok, const std::string& err)
{
	char b[256];
	std::string j = std::string ("{\"ok\":") + (ok ? "true" : "false");
	if (!ok) return j + ",\"error\":\"" + jsonEsc (err) + "\"}";
	std::snprintf (b, sizeof b, ",\"editor\":%s,\"latency\":%d,\"in\":%d,\"out\":%d,\"params\":%d,\"sr\":%.0f,\"block\":%d", gPlug->hasEditor ? "true" : "false",
	               gPlug->latency, gPlug->numIn, gPlug->numOut, gPlug->numParams, gSampleRate, gMaxBlock);
	return j + ",\"name\":\"" + jsonEsc (gPlug->name) + "\",\"vendor\":\"" + jsonEsc (gPlug->vendor) + "\",\"format\":\"" + gPlug->format + "\"" + b + "}";
}

static int run (int argc, char** argv)
{
	std::string path, fmt;
	bool probe = false;
	for (int i = 1; i < argc; i++)
	{
		std::string a = argv[i];
		auto next = [&] () -> std::string { return i + 1 < argc ? std::string (argv[++i]) : std::string (); };
		if (a == "--plugin") path = next ();
		else if (a == "--sr") gSampleRate = std::atof (next ().c_str ());
		else if (a == "--block") gMaxBlock = std::atoi (next ().c_str ());
		else if (a == "--title") gWindowTitle = next ();
		else if (a == "--format") fmt = lower (next ());
		else if (a == "--probe") probe = true;
		else if (a == "--version") { std::printf ("klm-vsthost 1.8.0\n"); return 0; }
	}
	if (gSampleRate < 8000 || gSampleRate > 384000) gSampleRate = 48000;
	if (gMaxBlock < 16 || gMaxBlock > 8192) gMaxBlock = 512;

	// stdout asli dipakai untuk protokol; fd 1 diarahkan ke stderr agar printf plugin tidak merusak protokol
#if defined(_WIN32)
	_setmode (0, _O_BINARY);
	_setmode (1, _O_BINARY);
	gOutFd = _dup (1);
	_setmode (gOutFd, _O_BINARY);
	_dup2 (2, 1);
	gInFd = 0;
	setDpiAware ();
	OleInitialize (nullptr);
	registerClasses ();
	// panggilan ShowWindow pertama memakai STARTUPINFO dari proses induk (bisa SW_HIDE) → habiskan di jendela dummy
	if (HWND dummy = CreateWindowExW (0, L"STATIC", L"", WS_POPUP, 0, 0, 1, 1, nullptr, nullptr, GetModuleHandleW (nullptr), nullptr))
	{
		ShowWindow (dummy, SW_HIDE);
		DestroyWindow (dummy);
	}
#else
	gOutFd = dup (1);
	dup2 (2, 1);
	gInFd = 0;
#endif
	if (path.empty ())
	{
		sendText ('I', infoJson (false, "argumen --plugin kosong"));
		return 2;
	}
	if (fmt.empty ()) fmt = endsWith (lower (path), ".vst3") ? "vst3" : "vst2";
	gPlug = fmt == "vst3" ? createVst3 () : createVst2 ();
	std::string err;
	bool ok = false;
	try
	{
		ok = gPlug->load (path, gSampleRate, gMaxBlock, err);
	}
	catch (...)
	{
		err = "plugin melempar exception saat dimuat";
	}
	if (!ok)
	{
		sendText ('I', infoJson (false, err.empty () ? "gagal memuat plugin" : err));
		std::fflush (stderr);
		std::_Exit (3);
	}
	sendText ('I', infoJson (true, ""));
	if (probe)
	{
		gPlug->shutdown ();
		std::fflush (stderr);
		std::_Exit (0);
	}

	std::thread reader (readerLoop);
#if defined(_WIN32)
	SetThreadPriority (reader.native_handle (), THREAD_PRIORITY_TIME_CRITICAL);
	gMsgWnd = CreateWindowExW (0, kMsgClass, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, GetModuleHandleW (nullptr), nullptr);
	SetTimer (gMsgWnd, 1, 30, nullptr);
	drainUi ();
	MSG msg;
	while (!gQuit)
	{
		BOOL r = GetMessageW (&msg, nullptr, 0, 0);
		if (r <= 0) break;
		if (msg.hwnd == gMsgWnd && msg.message == WM_CLOSE) break;
		TranslateMessage (&msg);
		DispatchMessageW (&msg);
	}
	KillTimer (gMsgWnd, 1);
#else
	while (!gQuit)
	{
		{
			std::unique_lock<std::mutex> lk (gUiMx);
			gUiCv.wait_for (lk, std::chrono::milliseconds (30), [] { return !gUiJobs.empty () || gQuit.load (); });
		}
		drainUi ();
		uiTick ();
	}
#endif
	drainUi ();
	gPlug->shutdown ();
	std::fflush (stderr);
	// reader thread mungkin masih terblokir di read(); keluar langsung tanpa destruktor global plugin
	if (reader.joinable ()) reader.detach ();
	std::_Exit (0);
}

} // namespace klm

#if defined(_WIN32)
#include <shellapi.h>
int main (int, char**)
{
	// argumen Unicode (path plugin bisa berisi karakter non-ASCII) -> UTF-8
	int n = 0;
	LPWSTR* w = CommandLineToArgvW (GetCommandLineW (), &n);
	std::vector<std::string> store (n);
	std::vector<char*> argv (n + 1, nullptr);
	for (int i = 0; i < n; i++)
	{
		int l = WideCharToMultiByte (CP_UTF8, 0, w[i], -1, nullptr, 0, nullptr, nullptr);
		store[i].assign (l > 0 ? l - 1 : 0, 0);
		if (l > 1) WideCharToMultiByte (CP_UTF8, 0, w[i], -1, &store[i][0], l, nullptr, nullptr);
		argv[i] = &store[i][0];
	}
	LocalFree (w);
	return klm::run (n, argv.data ());
}
#else
int main (int argc, char** argv) { return klm::run (argc, argv); }
#endif
