// KLM Mix VST host — plugin VST3 (memakai VST 3 SDK, lisensi MIT)
#include "plug.h"

#include "public.sdk/source/common/memorystream.h"
#include "public.sdk/source/vst/hosting/hostclasses.h"
#include "public.sdk/source/vst/hosting/module.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/hosting/plugprovider.h"
#include "public.sdk/source/vst/hosting/processdata.h"
#include "public.sdk/source/vst/utility/stringconvert.h"
#include "pluginterfaces/base/funknown.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/gui/iplugviewcontentscalesupport.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"

#include <cstring>
#include <mutex>

#if defined(_WIN32)
#include <windows.h>
#endif

using namespace Steinberg;
using namespace Steinberg::Vst;

namespace klm {

class KlmHostApp : public HostApplication
{
public:
	tresult PLUGIN_API getName (String128 name) override
	{
		return StringConvert::convert ("KLM Mix", name) ? kResultTrue : kInternalError;
	}
};
static KlmHostApp* gHostApp = nullptr;

struct Vst3Plug;

class CompHandler : public IComponentHandler
{
public:
	Vst3Plug* p = nullptr;
	tresult PLUGIN_API beginEdit (ParamID) override { return kResultOk; }
	tresult PLUGIN_API performEdit (ParamID id, ParamValue v) override;
	tresult PLUGIN_API endEdit (ParamID) override;
	tresult PLUGIN_API restartComponent (int32 flags) override;
	tresult PLUGIN_API queryInterface (const TUID iid, void** obj) override
	{
		if (FUnknownPrivate::iidEqual (iid, IComponentHandler::iid) || FUnknownPrivate::iidEqual (iid, FUnknown::iid))
		{
			*obj = this;
			return kResultTrue;
		}
		*obj = nullptr;
		return kNoInterface;
	}
	uint32 PLUGIN_API addRef () override { return 1000; }
	uint32 PLUGIN_API release () override { return 1000; }
};

class Frame : public IPlugFrame
{
public:
	Vst3Plug* p = nullptr;
	tresult PLUGIN_API resizeView (IPlugView* view, ViewRect* r) override;
	tresult PLUGIN_API queryInterface (const TUID iid, void** obj) override
	{
		if (FUnknownPrivate::iidEqual (iid, IPlugFrame::iid) || FUnknownPrivate::iidEqual (iid, FUnknown::iid))
		{
			*obj = this;
			return kResultTrue;
		}
		*obj = nullptr;
		return kNoInterface;
	}
	uint32 PLUGIN_API addRef () override { return 1000; }
	uint32 PLUGIN_API release () override { return 1000; }
};

static std::string u8 (const TChar* s, int max = 128) { return StringConvert::convert (s, max); }

struct Vst3Plug : Plug
{
	VST3::Hosting::Module::Ptr module;
	IPtr<PlugProvider> provider;
	IPtr<IComponent> component;
	IPtr<IEditController> controller;
	IPtr<IAudioProcessor> processor;
	HostProcessData pd;
	ParameterChanges inChanges {256};
	ParameterChangeTransfer transfer {1024};
	ProcessContext ctx {};
	CompHandler handler;
	Frame frame;
	std::mutex procMx;
	bool active = false;
	int block = 512;
	double sr = 48000;
	IPtr<IPlugView> view;
	void* hwnd = nullptr;
	bool resizing = false;

	Vst3Plug () { format = "VST3"; handler.p = this; frame.p = this; }

	bool load (const std::string& path, double sampleRate, int maxBlock, std::string& err) override
	{
		sr = sampleRate;
		block = maxBlock;
		if (!gHostApp)
		{
			gHostApp = new KlmHostApp ();
			PluginContextFactory::instance ().setPluginContext (gHostApp);
		}
		module = VST3::Hosting::Module::create (path, err);
		if (!module)
		{
			if (err.empty ()) err = "Modul VST3 tidak bisa dimuat";
			return false;
		}
		auto factory = module->getFactory ();
		factory.setHostContext (gHostApp);
		std::string fvendor = factory.info ().vendor ();
		for (auto& ci : factory.classInfos ())
		{
			if (ci.category () != kVstAudioEffectClass) continue;
			auto pp = owned (new PlugProvider (factory, ci, true));
			if (!pp->initialize ()) continue;
			provider = pp;
			name = ci.name ();
			vendor = ci.vendor ().empty () ? fvendor : ci.vendor ();
			break;
		}
		if (!provider)
		{
			err = "Tidak ada kelas efek audio VST3 yang bisa dibuat di file ini";
			return false;
		}
		component = provider->getComponentPtr ();
		controller = provider->getControllerPtr ();
		processor = U::cast<IAudioProcessor> (component);
		if (!component || !processor)
		{
			err = "Plugin tidak menyediakan pemroses audio";
			return false;
		}
		if (controller) controller->setComponentHandler (&handler);

		// bus utama stereo (input & output), bus lain (sidechain) dibiarkan
		int32 nInB = component->getBusCount (kAudio, kInput), nOutB = component->getBusCount (kAudio, kOutput);
		std::vector<SpeakerArrangement> ia (nInB > 0 ? nInB : 1), oa (nOutB > 0 ? nOutB : 1);
		for (int32 i = 0; i < nInB; i++) processor->getBusArrangement (kInput, i, ia[i]);
		for (int32 i = 0; i < nOutB; i++) processor->getBusArrangement (kOutput, i, oa[i]);
		if (nInB > 0) ia[0] = SpeakerArr::kStereo;
		if (nOutB > 0) oa[0] = SpeakerArr::kStereo;
		if (processor->setBusArrangements (nInB ? ia.data () : nullptr, nInB, nOutB ? oa.data () : nullptr, nOutB) != kResultTrue)
		{
			// plugin menolak stereo (mis. mono): pakai susunan bawaannya
			for (int32 i = 0; i < nInB; i++) processor->getBusArrangement (kInput, i, ia[i]);
			for (int32 i = 0; i < nOutB; i++) processor->getBusArrangement (kOutput, i, oa[i]);
		}
		for (int32 i = 0; i < nInB; i++) component->activateBus (kAudio, kInput, i, i == 0);
		for (int32 i = 0; i < nOutB; i++) component->activateBus (kAudio, kOutput, i, i == 0);
		int32 nEvIn = component->getBusCount (kEvent, kInput);
		for (int32 i = 0; i < nEvIn; i++) component->activateBus (kEvent, kInput, i, false);

		ProcessSetup setup {kRealtime, kSample32, block, sr};
		if (processor->setupProcessing (setup) != kResultOk)
		{
			err = "Plugin menolak pengaturan proses (sample rate / blok)";
			return false;
		}
		pd.prepare (*component, block, kSample32);
		for (int32 b = 0; b < pd.numInputs; b++)
			for (int32 c = 0; c < pd.inputs[b].numChannels; c++)
				if (pd.inputs[b].channelBuffers32 && pd.inputs[b].channelBuffers32[c]) std::memset (pd.inputs[b].channelBuffers32[c], 0, sizeof (float) * block);
		numIn = pd.numInputs > 0 ? pd.inputs[0].numChannels : 0;
		numOut = pd.numOutputs > 0 ? pd.outputs[0].numChannels : 0;
		ctx.sampleRate = sr;
		ctx.tempo = 120;
		ctx.timeSigNumerator = 4;
		ctx.timeSigDenominator = 4;
		ctx.state = ProcessContext::kPlaying | ProcessContext::kTempoValid | ProcessContext::kTimeSigValid | ProcessContext::kProjectTimeMusicValid;
		pd.processContext = &ctx;
		pd.inputParameterChanges = &inChanges;
		if (component->setActive (true) != kResultOk)
		{
			err = "Plugin gagal diaktifkan";
			return false;
		}
		processor->setProcessing (true);
		active = true;
		latency = (int)processor->getLatencySamples ();
		numParams = controller ? controller->getParameterCount () : 0;
		if (controller)
		{
			auto v = owned (controller->createView (ViewType::kEditor));
			hasEditor = v != nullptr;
		}
		return true;
	}

	void process (float** in, float** out, int ch, int n) override
	{
		std::lock_guard<std::mutex> lk (procMx);
		if (!active || n > block || numOut == 0)
		{
			for (int c = 0; c < ch; c++) std::memcpy (out[c], in[c], sizeof (float) * n);
			return;
		}
		if (pd.numInputs > 0)
			for (int32 c = 0; c < pd.inputs[0].numChannels; c++)
				std::memcpy (pd.inputs[0].channelBuffers32[c], in[c < ch ? c : ch - 1], sizeof (float) * n);
		transfer.transferChangesTo (inChanges);
		pd.numSamples = n;
		tresult r = processor->process (pd);
		ctx.projectTimeSamples += n;
		ctx.continousTimeSamples += n;
		ctx.projectTimeMusic += n / sr * (ctx.tempo / 60.0);
		inChanges.clearQueue ();
		if (r != kResultOk)
		{
			for (int c = 0; c < ch; c++) std::memcpy (out[c], in[c], sizeof (float) * n);
			return;
		}
		for (int c = 0; c < ch; c++)
		{
			int sc = c < numOut ? c : numOut - 1; // keluaran mono → kiri & kanan
			std::memcpy (out[c], pd.outputs[0].channelBuffers32[sc], sizeof (float) * n);
		}
	}

	static void put32 (std::vector<uint8_t>& v, uint32_t x) { for (int i = 0; i < 4; i++) v.push_back ((x >> (8 * i)) & 255); }
	static uint32_t get32 (const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }

	std::vector<uint8_t> getState () override
	{
		std::vector<uint8_t> out = {'K', 'V', '3', 'S'};
		MemoryStream cs, ks;
		{
			std::lock_guard<std::mutex> lk (procMx);
			component->getState (&cs);
		}
		if (controller) controller->getState (&ks);
		put32 (out, (uint32_t)cs.getSize ());
		out.insert (out.end (), (uint8_t*)cs.getData (), (uint8_t*)cs.getData () + cs.getSize ());
		put32 (out, (uint32_t)ks.getSize ());
		out.insert (out.end (), (uint8_t*)ks.getData (), (uint8_t*)ks.getData () + ks.getSize ());
		return out;
	}

	bool setState (const uint8_t* d, size_t n) override
	{
		if (n < 12 || std::memcmp (d, "KV3S", 4) != 0) return false;
		uint32_t cl = get32 (d + 4);
		if (8 + (size_t)cl + 4 > n) return false;
		uint32_t kl = get32 (d + 8 + cl);
		if (8 + (size_t)cl + 4 + kl > n) return false;
		MemoryStream cs ((void*)(d + 8), cl), cs2 ((void*)(d + 8), cl), ks ((void*)(d + 12 + cl), kl);
		{
			std::lock_guard<std::mutex> lk (procMx);
			if (cl) component->setState (&cs);
		}
		if (controller)
		{
			if (cl) controller->setComponentState (&cs2);
			if (kl) controller->setState (&ks);
		}
		return true;
	}

	std::string paramsJson () override
	{
		if (!controller) return "[]";
		std::string j = "[";
		int32 n = controller->getParameterCount ();
		bool first = true;
		for (int32 i = 0; i < n && i < 512; i++)
		{
			ParameterInfo pi {};
			if (controller->getParameterInfo (i, pi) != kResultOk) continue;
			if (pi.flags & (ParameterInfo::kIsReadOnly | ParameterInfo::kIsHidden)) continue;
			ParamValue v = controller->getParamNormalized (pi.id);
			String128 disp {};
			controller->getParamStringByValue (pi.id, v, disp);
			char buf[96];
			std::snprintf (buf, sizeof buf, "\"id\":%u,\"v\":%.6f,\"def\":%.6f,\"steps\":%d,\"bypass\":%s", (unsigned)pi.id, v, pi.defaultNormalizedValue, (int)pi.stepCount, (pi.flags & ParameterInfo::kIsBypass) ? "true" : "false");
			j += (first ? "{" : ",{") + std::string (buf) + ",\"name\":\"" + jsonEsc (u8 (pi.title)) + "\",\"unit\":\"" + jsonEsc (u8 (pi.units)) + "\",\"text\":\"" + jsonEsc (u8 (disp)) + "\"}";
			first = false;
		}
		return j + "]";
	}

	void setParam (uint32_t id, double v) override
	{
		if (controller) controller->setParamNormalized (id, v);
		transfer.addChange (id, v, 0);
		dirty = true;
	}

	void restart (int32 flags)
	{
		if (flags & kLatencyChanged)
		{
			std::lock_guard<std::mutex> lk (procMx);
			latency = (int)processor->getLatencySamples ();
		}
		if (flags & (kReloadComponent | kIoChanged))
		{
			std::lock_guard<std::mutex> lk (procMx);
			processor->setProcessing (false);
			component->setActive (false);
			ProcessSetup setup {kRealtime, kSample32, block, sr};
			processor->setupProcessing (setup);
			component->setActive (true);
			processor->setProcessing (true);
			latency = (int)processor->getLatencySamples ();
		}
		dirty = true;
	}

	// ---------- editor ----------
	bool editorOpen () const override { return view != nullptr; }
	void showEditor (bool show) override
	{
#if defined(_WIN32)
		if (show)
		{
			if (view && hwnd) { showEditorWindow (hwnd); return; }
			if (!controller) return;
			view = owned (controller->createView (ViewType::kEditor));
			if (!view) return;
			if (view->isPlatformTypeSupported (kPlatformTypeHWND) != kResultTrue) { view = nullptr; return; }
			ViewRect r {};
			view->getSize (&r);
			int w = r.getWidth () > 0 ? r.getWidth () : 640, h = r.getHeight () > 0 ? r.getHeight () : 400;
			hwnd = createEditorWindow (this, gWindowTitle.empty () ? name : gWindowTitle, w, h, view->canResize () == kResultTrue);
			if (!hwnd) { view = nullptr; return; }
			if (auto css = U::cast<IPlugViewContentScaleSupport> (view))
			{
				UINT dpi = 96;
				HMODULE u = GetModuleHandleA ("user32.dll");
				typedef UINT (WINAPI * GDW) (HWND);
				if (auto f = u ? (GDW)GetProcAddress (u, "GetDpiForWindow") : nullptr) dpi = f ((HWND)hwnd);
				css->setContentScaleFactor (dpi / 96.f);
			}
			view->setFrame (&frame);
			if (view->attached (hwnd, kPlatformTypeHWND) != kResultTrue)
			{
				view->setFrame (nullptr);
				view = nullptr;
				destroyEditorWindow (hwnd);
				hwnd = nullptr;
				return;
			}
			view->getSize (&r);
			if (r.getWidth () > 0 && (r.getWidth () != w || r.getHeight () != h)) resizeEditorWindow (hwnd, r.getWidth (), r.getHeight ());
			showEditorWindow (hwnd);
		}
		else
		{
			if (view)
			{
				view->setFrame (nullptr);
				view->removed ();
				view = nullptr;
			}
			if (hwnd) { destroyEditorWindow (hwnd); hwnd = nullptr; }
		}
#else
		(void)show;
#endif
	}
	void onWindowSize (int w, int h) override
	{
		if (!view || resizing) return;
		ViewRect cur {};
		view->getSize (&cur);
		if (cur.getWidth () == w && cur.getHeight () == h) return;
		ViewRect r (0, 0, w, h);
		if (view->checkSizeConstraint (&r) == kResultTrue) view->onSize (&r);
	}
	tresult resizeFromPlug (IPlugView* v, ViewRect* r)
	{
		if (!r || v != view) return kInvalidArgument;
#if defined(_WIN32)
		if (!hwnd) return kInternalError;
		resizing = true;
		resizeEditorWindow (hwnd, r->getWidth (), r->getHeight ());
		resizing = false;
#endif
		view->onSize (r);
		return kResultTrue;
	}

	void shutdown () override
	{
		showEditor (false);
		std::lock_guard<std::mutex> lk (procMx);
		if (active && processor && component)
		{
			processor->setProcessing (false);
			component->setActive (false);
		}
		active = false;
		if (controller) controller->setComponentHandler (nullptr);
		processor = nullptr;
		controller = nullptr;
		component = nullptr;
		provider = nullptr;
		module = nullptr;
	}
};

tresult PLUGIN_API CompHandler::performEdit (ParamID id, ParamValue v)
{
	p->transfer.addChange (id, v, 0);
	p->dirty = true;
	return kResultOk;
}
tresult PLUGIN_API CompHandler::endEdit (ParamID) { p->dirty = true; return kResultOk; }
tresult PLUGIN_API CompHandler::restartComponent (int32 flags) { p->restart (flags); return kResultOk; }
tresult PLUGIN_API Frame::resizeView (IPlugView* view, ViewRect* r) { return p->resizeFromPlug (view, r); }

Plug* createVst3 () { return new Vst3Plug (); }

} // namespace klm
