// Plugin uji "KLM Test Gain" (VST3, SingleComponentEffect, tanpa GUI) — hanya untuk pengujian host di CI.
// Parameter Gain (id 0) normal 0..1 -> gain linear x2 (default 0.5 = unity). State = double nilai gain.
#include "public.sdk/source/main/pluginfactory.h"
#include "public.sdk/source/vst/vstsinglecomponenteffect.h"
#include "pluginterfaces/base/ibstream.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"
#include "base/source/fstreamer.h"

#include <cstring>

using namespace Steinberg;
using namespace Steinberg::Vst;

class KlmTestGain : public SingleComponentEffect
{
public:
	double gain = 0.5;
	static FUnknown* createInstance (void*) { return (IAudioProcessor*)new KlmTestGain; }

	tresult PLUGIN_API initialize (FUnknown* ctx) override
	{
		tresult r = SingleComponentEffect::initialize (ctx);
		if (r != kResultOk) return r;
		addAudioInput (STR16 ("Stereo In"), SpeakerArr::kStereo);
		addAudioOutput (STR16 ("Stereo Out"), SpeakerArr::kStereo);
		parameters.addParameter (STR16 ("Gain"), STR16 ("x"), 0, 0.5, ParameterInfo::kCanAutomate, 0);
		return kResultOk;
	}
	tresult PLUGIN_API setBusArrangements (SpeakerArrangement* in, int32 nIn, SpeakerArrangement* out, int32 nOut) override
	{
		if (nIn == 1 && nOut == 1 && in[0] == out[0] && (in[0] == SpeakerArr::kStereo || in[0] == SpeakerArr::kMono))
			return SingleComponentEffect::setBusArrangements (in, nIn, out, nOut);
		return kResultFalse;
	}
	tresult PLUGIN_API canProcessSampleSize (int32 s) override { return s == kSample32 ? kResultTrue : kResultFalse; }
	tresult PLUGIN_API process (ProcessData& data) override
	{
		if (auto pc = data.inputParameterChanges)
		{
			for (int32 i = 0; i < pc->getParameterCount (); i++)
			{
				auto q = pc->getParameterData (i);
				if (!q || q->getParameterId () != 0 || q->getPointCount () <= 0) continue;
				int32 off;
				ParamValue v;
				if (q->getPoint (q->getPointCount () - 1, off, v) == kResultTrue) gain = v;
			}
		}
		if (data.numInputs < 1 || data.numOutputs < 1 || data.numSamples <= 0) return kResultOk;
		int32 ch = data.outputs[0].numChannels < data.inputs[0].numChannels ? data.outputs[0].numChannels : data.inputs[0].numChannels;
		float g = (float)(gain * 2.0);
		for (int32 c = 0; c < ch; c++)
		{
			float* i = data.inputs[0].channelBuffers32[c];
			float* o = data.outputs[0].channelBuffers32[c];
			for (int32 n = 0; n < data.numSamples; n++) o[n] = i[n] * g;
		}
		data.outputs[0].silenceFlags = 0;
		return kResultOk;
	}
	tresult PLUGIN_API setState (IBStream* s) override
	{
		IBStreamer st (s, kLittleEndian);
		double v;
		if (!st.readDouble (v)) return kResultFalse;
		gain = v;
		setParamNormalized (0, v);
		return kResultOk;
	}
	tresult PLUGIN_API getState (IBStream* s) override
	{
		IBStreamer st (s, kLittleEndian);
		st.writeDouble (gain);
		return kResultOk;
	}
	tresult PLUGIN_API setParamNormalized (ParamID id, ParamValue v) override
	{
		if (id == 0) gain = v;
		return SingleComponentEffect::setParamNormalized (id, v);
	}
};

BEGIN_FACTORY_DEF ("KLM", "https://github.com/klmthebest10/klm-mix", "")
DEF_CLASS2 (INLINE_UID (0x4B4C4D31, 0x54657374, 0x4761696E, 0x00000001), PClassInfo::kManyInstances, kVstAudioEffectClass, "KLM Test Gain", 0, "Fx",
            "1.0.0", kVstVersionString, KlmTestGain::createInstance)
END_FACTORY
