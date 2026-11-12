// KLM Mix VST host — antarmuka plugin bersama (VST3 & VST2)
#pragma once
#include <atomic>
#include <cstdint>
#include <string>
#include <vector>

namespace klm {

struct Plug
{
	std::string name, vendor, format;
	bool hasEditor = false;
	int latency = 0;
	int numIn = 2, numOut = 2, numParams = 0;
	std::atomic<bool> dirty {false};     // parameter/state berubah (dari GUI plugin)
	std::atomic<bool> editorClosed {false};

	virtual ~Plug () {}
	virtual bool load (const std::string& path, double sampleRate, int maxBlock, std::string& err) = 0;
	// thread audio: in/out = ch buffer planar sepanjang n (n <= maxBlock)
	virtual void process (float** in, float** out, int ch, int n) = 0;
	// thread UI
	virtual std::vector<uint8_t> getState () = 0;
	virtual bool setState (const uint8_t* data, size_t size) = 0;
	virtual void showEditor (bool show) { (void)show; }
	virtual bool editorOpen () const { return false; }
	virtual std::string paramsJson () { return "[]"; }
	virtual void setParam (uint32_t id, double normalized) { (void)id; (void)normalized; }
	virtual void idle () {}
	virtual void shutdown () {}
	// dari jendela editor (thread UI)
	virtual void onWindowSize (int w, int h) { (void)w; (void)h; }
	virtual void onWindowClose () { showEditor (false); editorClosed = true; }
};

std::string jsonEsc (const std::string& s);
void logf (const char* fmt, ...);
#if defined(_WIN32)
void* createEditorWindow (Plug* owner, const std::string& title, int w, int h, bool resizable);
void resizeEditorWindow (void* hwnd, int w, int h);
void destroyEditorWindow (void* hwnd);
void showEditorWindow (void* hwnd);
#endif
extern std::string gWindowTitle;
extern double gSampleRate;
extern int gMaxBlock;

Plug* createVst3 ();
Plug* createVst2 ();

} // namespace klm
