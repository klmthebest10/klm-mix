# klm-vsthost — host plugin VST asli untuk KLM Mix

Proses helper kecil (C++17) yang memuat **satu** plugin VST3 atau VST2 (64-bit) dan memprosesnya untuk KLM Mix.
Electron menjalankan satu proses per instance plugin lewat broker (`electron/vst-broker.js`, utilityProcess), sehingga
plugin yang crash tidak menjatuhkan aplikasi.

- `src/main.cpp` — protokol biner stdin/stdout, thread audio, thread UI (loop pesan Win32, jendela editor, DPI)
- `src/vst3.cpp` — hosting VST3 memakai **VST 3 SDK** (Steinberg, lisensi MIT): bus stereo, parameter, state, editor `IPlugView`
- `src/vst2.cpp` — hosting VST 2.x (Windows) dengan deklarasi ABI sendiri (tanpa SDK VST2)
- `test/testgain.cpp` — plugin uji "KLM Test Gain" (VST3, tanpa GUI); `test/host-test.js` — uji protokol

## Build

```
git clone --branch v3.8.1_build_84 https://github.com/steinbergmedia/vst3sdk.git
git -C vst3sdk submodule update --init base cmake pluginterfaces public.sdk
cmake -S native/vsthost -B native/vsthost/build -DVST3_SDK=<path>/vst3sdk
cmake --build native/vsthost/build --config Release
node native/vsthost/test/host-test.js native/vsthost/build/bin/Release/klm-vsthost(.exe) native/vsthost/build/KLMTestGain.vst3
```

CI (`.github/workflows/build-windows.yml`) membangunnya otomatis dan electron-builder menyalinnya ke
`resources/vsthost/klm-vsthost.exe`.

## Protokol

Frame: `[u32 panjang (termasuk byte tipe)][u8 tipe][payload]`, little-endian.

| → helper | arti | ← balasan |
|---|---|---|
| `P` u32 seq, u32 n, u32 ch, float32 planar | proses audio | `A` (format sama) |
| `E` u8 0/1/2 | tutup / buka / toggle editor | `W` `{"open":bool}` |
| `G` | ambil state | `S` bytes (`KV3S…` / `KV2C…` / `KV2P…`) |
| `L` bytes | pasang state | `K` `{"ok":bool}` |
| `V` u32 id, f64 | set parameter (0..1) | — |
| `p` | daftar parameter | `p` JSON |
| `B` u8 | bypass | — |
| `Q` | keluar | — |

Pesan spontan: `I` info JSON (sekali setelah dimuat), `D` state berubah (dari GUI plugin), `X` log.
