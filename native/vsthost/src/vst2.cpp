// KLM Mix VST host — plugin VST 2.x (Windows). ABI VST2 dideklarasikan sendiri (struktur publik yang
// umum dipakai host open-source); tidak memakai header SDK VST2.
#include "plug.h"

#include <cstdio>
#include <cstring>
#include <mutex>

#if defined(_WIN32)
#include <windows.h>
#endif

namespace klm {

#if defined(_WIN32)

struct AEffect;
typedef intptr_t (*HostCallback) (AEffect*, int32_t, int32_t, intptr_t, void*, float);
typedef intptr_t (*DispatcherProc) (AEffect*, int32_t, int32_t, intptr_t, void*, float);
typedef void (*ProcessProc) (AEffect*, float**, float**, int32_t);
typedef void (*SetParamProc) (AEffect*, int32_t, float);
typedef float (*GetParamProc) (AEffect*, int32_t);
typedef AEffect* (*EntryProc) (HostCallback);

#pragma pack(push, 8)
struct AEffect
{
	int32_t magic;
	DispatcherProc dispatcher;
	ProcessProc process;
	SetParamProc setParameter;
	GetParamProc getParameter;
	int32_t numPrograms, numParams, numInputs, numOutputs, flags;
	intptr_t resvd1, resvd2;
	int32_t initialDelay, realQualities, offQualities;
	float ioRatio;
	void* object;
	void* user;
	int32_t uniqueID, version;
	ProcessProc processReplacing;
	void* processDoubleReplacing;
	char future[56];
};
struct ERect { int16_t top, left, bottom, right; };
struct TimeInfo
{
	double samplePos, sampleRate, nanoSeconds, ppqPos, tempo, barStartPos, cycleStartPos, cycleEndPos;
	int32_t timeSigNumerator, timeSigDenominator, smpteOffset, smpteFrameRate, samplesToNextClock, flags;
};
#pragma pack(pop)

enum
{
	kMagic = ('V' << 24) | ('s' << 16) | ('t' << 8) | 'P',
	effOpen = 0, effClose = 1, effGetParamLabel = 6, effGetParamDisplay = 7, effGetParamName = 8, effSetSampleRate = 10, effSetBlockSize = 11, effMainsChanged = 12,
	effEditGetRect = 13, effEditOpen = 14, effEditClose = 15, effEditIdle = 19, effGetChunk = 23, effSetChunk = 24,
	effGetEffectName = 45, effGetVendorString = 47, effGetProductString = 48, effStartProcess = 71, effStopProcess = 72,
	flagHasEditor = 1, flagCanReplacing = 1 << 4, flagProgramChunks = 1 << 5,
	amAutomate = 0, amVersion = 1, amCurrentId = 2, amIdle = 3, amGetTime = 7, amIOChanged = 13, amSizeWindow = 15, amGetSampleRate = 16, amGetBlockSize = 17,
	amGetCurrentProcessLevel = 23, amGetVendorString = 32, amGetProductString = 33, amGetVendorVersion = 34, amCanDo = 37, amGetLanguage = 38, amUpdateDisplay = 42, amBeginEdit = 43, amEndEdit = 44
};

struct Vst2Plug;
static Vst2Plug* gV2 = nullptr;
static TimeInfo gTime {};

struct Vst2Plug : Plug
{
	HMODULE lib = nullptr;
	AEffect* e = nullptr;
	std::mutex procMx;
	int block = 512;
	double sr = 48000;
	std::vector<std::vector<float>> bufIn, bufOut;
	std::vector<float*> pin, pout;
	void* hwnd = nullptr;
	bool editorOn = false;
	DWORD audioThread = 0;

	Vst2Plug () { format = "VST2"; gV2 = this; }
	intptr_t disp (int32_t op, int32_t idx = 0, intptr_t val = 0, void* ptr = nullptr, float opt = 0) { return e ? e->dispatcher (e, op, idx, val, ptr, opt) : 0; }

	static intptr_t host (AEffect* eff, int32_t op, int32_t idx, intptr_t val, void* ptr, float opt)
	{
		(void)opt;
		Vst2Plug* p = gV2;
		switch (op)
		{
			case amVersion: return 2400;
			case amAutomate: case amBeginEdit: case amEndEdit: if (p) p->dirty = true; return 1;
			case amCurrentId: return eff ? eff->uniqueID : 0;
			case amIdle: return 0;
			case amGetTime:
				gTime.sampleRate = gSampleRate;
				gTime.tempo = 120;
				gTime.timeSigNumerator = 4;
				gTime.timeSigDenominator = 4;
				gTime.flags = (1 << 1) | (1 << 9) | (1 << 10) | (1 << 13); // playing | ppqPos | tempo | timeSig valid
				gTime.ppqPos = gTime.samplePos / gSampleRate * 2.0;
				return (intptr_t)&gTime;
			case amIOChanged: if (p && p->e) p->latency = p->e->initialDelay; return 1;
			case amSizeWindow: if (p && p->hwnd) resizeEditorWindow (p->hwnd, idx, (int)val); return 1;
			case amGetSampleRate: return (intptr_t)gSampleRate;
			case amGetBlockSize: return gMaxBlock;
			case amGetCurrentProcessLevel: return (p && GetCurrentThreadId () == p->audioThread) ? 2 : 1;
			case amGetVendorString: if (ptr) std::strcpy ((char*)ptr, "KLM"); return 1;
			case amGetProductString: if (ptr) std::strcpy ((char*)ptr, "KLM Mix"); return 1;
			case amGetVendorVersion: return 1700;
			case amCanDo:
				if (ptr && (!std::strcmp ((char*)ptr, "sizeWindow") || !std::strcmp ((char*)ptr, "sendVstTimeInfo") || !std::strcmp ((char*)ptr, "supplyIdle"))) return 1;
				return 0;
			case amGetLanguage: return 1;
			case amUpdateDisplay: if (p) p->dirty = true; return 1;
			default: return 0;
		}
	}

	bool load (const std::string& path, double sampleRate, int maxBlock, std::string& err) override
	{
		sr = sampleRate;
		block = maxBlock;
		int wl = MultiByteToWideChar (CP_UTF8, 0, path.c_str (), -1, nullptr, 0);
		std::wstring wp (wl, 0);
		MultiByteToWideChar (CP_UTF8, 0, path.c_str (), -1, &wp[0], wl);
		lib = LoadLibraryW (wp.c_str ());
		if (!lib) { err = "DLL VST2 tidak bisa dimuat (bukan 64-bit / butuh runtime lain?)"; return false; }
		auto entry = (EntryProc)GetProcAddress (lib, "VSTPluginMain");
		if (!entry) entry = (EntryProc)GetProcAddress (lib, "main");
		if (!entry) { err = "Bukan plugin VST2 (tidak ada VSTPluginMain)"; return false; }
		e = entry (&Vst2Plug::host);
		if (!e || e->magic != kMagic) { e = nullptr; err = "Plugin VST2 tidak valid"; return false; }
		if (!e->processReplacing || !(e->flags & flagCanReplacing)) { err = "Plugin VST2 lama tanpa processReplacing tidak didukung"; return false; }
		disp (effOpen);
		disp (effSetSampleRate, 0, 0, nullptr, (float)sr);
		disp (effSetBlockSize, 0, block);
		char buf[256] = {0};
		disp (effGetEffectName, 0, 0, buf);
		name = buf;
		if (name.empty ())
		{
			std::memset (buf, 0, sizeof buf);
			disp (effGetProductString, 0, 0, buf);
			name = buf;
		}
		if (name.empty ())
		{
			size_t s = path.find_last_of ("/\\");
			name = path.substr (s == std::string::npos ? 0 : s + 1);
			if (name.size () > 4) name = name.substr (0, name.size () - 4);
		}
		std::memset (buf, 0, sizeof buf);
		disp (effGetVendorString, 0, 0, buf);
		vendor = buf;
		hasEditor = (e->flags & flagHasEditor) != 0;
		numIn = e->numInputs;
		numOut = e->numOutputs;
		numParams = e->numParams;
		latency = e->initialDelay;
		bufIn.assign (numIn > 0 ? numIn : 0, std::vector<float> (block, 0.f));
		bufOut.assign (numOut > 0 ? numOut : 0, std::vector<float> (block, 0.f));
		for (auto& b : bufIn) pin.push_back (b.data ());
		for (auto& b : bufOut) pout.push_back (b.data ());
		disp (effMainsChanged, 0, 1);
		disp (effStartProcess);
		return true;
	}

	void process (float** in, float** out, int ch, int n) override
	{
		if (!audioThread) audioThread = GetCurrentThreadId ();
		std::lock_guard<std::mutex> lk (procMx);
		if (!e || n > block || numOut <= 0)
		{
			for (int c = 0; c < ch; c++) std::memcpy (out[c], in[c], sizeof (float) * n);
			return;
		}
		for (int c = 0; c < numIn; c++) std::memcpy (pin[c], in[c < ch ? c : ch - 1], sizeof (float) * n);
		e->processReplacing (e, pin.data (), pout.data (), n);
		gTime.samplePos += n;
		for (int c = 0; c < ch; c++) std::memcpy (out[c], pout[c < numOut ? c : numOut - 1], sizeof (float) * n);
	}

	std::vector<uint8_t> getState () override
	{
		std::vector<uint8_t> out;
		if (!e) return out;
		if (e->flags & flagProgramChunks)
		{
			void* data = nullptr;
			intptr_t sz = disp (effGetChunk, 0, 0, &data);
			out = {'K', 'V', '2', 'C'};
			if (data && sz > 0) out.insert (out.end (), (uint8_t*)data, (uint8_t*)data + sz);
		}
		else
		{
			out = {'K', 'V', '2', 'P'};
			for (int i = 0; i < e->numParams; i++)
			{
				float v = e->getParameter (e, i);
				uint8_t* b = (uint8_t*)&v;
				out.insert (out.end (), b, b + 4);
			}
		}
		return out;
	}
	bool setState (const uint8_t* d, size_t n) override
	{
		if (!e || n < 4) return false;
		std::lock_guard<std::mutex> lk (procMx);
		if (!std::memcmp (d, "KV2C", 4)) { if (n > 4) disp (effSetChunk, 0, (intptr_t)(n - 4), (void*)(d + 4)); return true; }
		if (!std::memcmp (d, "KV2P", 4))
		{
			size_t cnt = (n - 4) / 4;
			for (size_t i = 0; i < cnt && (int)i < e->numParams; i++) { float v; std::memcpy (&v, d + 4 + i * 4, 4); e->setParameter (e, (int32_t)i, v); }
			return true;
		}
		return false;
	}
	std::string paramsJson () override
	{
		if (!e) return "[]";
		std::string j = "[";
		for (int i = 0; i < e->numParams && i < 512; i++)
		{
			char nm[256] = {0}, disp1[256] = {0}, lab[256] = {0}, buf[64];
			disp (effGetParamName, i, 0, nm);
			disp (effGetParamDisplay, i, 0, disp1);
			disp (effGetParamLabel, i, 0, lab);
			std::snprintf (buf, sizeof buf, "\"id\":%d,\"v\":%.6f,\"def\":0,\"steps\":0,\"bypass\":false", i, e->getParameter (e, i));
			j += (i ? ",{" : "{") + std::string (buf) + ",\"name\":\"" + jsonEsc (nm) + "\",\"unit\":\"" + jsonEsc (lab) + "\",\"text\":\"" + jsonEsc (disp1) + "\"}";
		}
		return j + "]";
	}
	void setParam (uint32_t id, double v) override
	{
		if (e && (int)id < e->numParams) e->setParameter (e, (int32_t)id, (float)v);
		dirty = true;
	}
	bool editorOpen () const override { return editorOn; }
	void showEditor (bool show) override
	{
		if (!e || !hasEditor) return;
		if (show)
		{
			if (editorOn && hwnd) { showEditorWindow (hwnd); return; }
			hwnd = createEditorWindow (this, gWindowTitle.empty () ? name : gWindowTitle, 640, 400, false);
			if (!hwnd) return;
			disp (effEditOpen, 0, 0, hwnd);
			ERect* r = nullptr;
			disp (effEditGetRect, 0, 0, &r);
			if (r && r->right > r->left) resizeEditorWindow (hwnd, r->right - r->left, r->bottom - r->top);
			editorOn = true;
			showEditorWindow (hwnd);
		}
		else if (editorOn)
		{
			disp (effEditClose);
			editorOn = false;
			if (hwnd) { destroyEditorWindow (hwnd); hwnd = nullptr; }
		}
	}
	void idle () override { if (editorOn) disp (effEditIdle); }
	void shutdown () override
	{
		showEditor (false);
		std::lock_guard<std::mutex> lk (procMx);
		if (e)
		{
			disp (effStopProcess);
			disp (effMainsChanged, 0, 0);
			disp (effClose);
			e = nullptr;
		}
		// DLL sengaja tidak di-unload: sebagian plugin crash saat FreeLibrary; proses ini akan segera berakhir
	}
};

Plug* createVst2 () { return new Vst2Plug (); }

#else

struct Vst2Stub : Plug
{
	bool load (const std::string&, double, int, std::string& err) override { err = "VST2 hanya didukung di Windows"; return false; }
	void process (float** in, float** out, int ch, int n) override { for (int c = 0; c < ch; c++) std::memcpy (out[c], in[c], sizeof (float) * n); }
	std::vector<uint8_t> getState () override { return {}; }
	bool setState (const uint8_t*, size_t) override { return false; }
};
Plug* createVst2 () { return new Vst2Stub (); }

#endif

} // namespace klm
