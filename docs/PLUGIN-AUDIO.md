# Plugin Audio KLM Mix

KLM Mix punya **rak efek** di setiap input audio dan di **Master** (tombol **FX** di mixer).
Urutan efek bebas, tiap efek punya **bypass** dan **Mix** (wet/dry), dan rantai bisa disimpan sebagai **preset**.

## Efek bawaan (18)
| Kategori | Efek |
|---|---|
| EQ & Filter | EQ Parametrik 5-Band, Filter HPF/LPF/Band/Notch (12/24 dB), Penghilang Dengung Listrik 50/60 Hz |
| Dinamika | Kompresor, Limiter, Noise Gate, Peredam Bising (Expander), De-esser, Penyeimbang Volume (AGC) |
| Ruang & Waktu | Reverb (ruang, hall, masjid, plate, katedral, atau **impulse response eksternal**), Delay/Echo (ping-pong) |
| Modulasi | Chorus, Flanger, Tremolo / Auto-pan |
| Warna | Saturasi / Warm, Pitch Shift |
| Utilitas | Stereo Width / Mono, Gain / Phase |

Preset rantai bawaan: *Vokal Siaran, Ceramah / Pengajian, Podcast / Talkshow, Musik Latar, Suara Telepon / Radio, Qiraah / Adzan (reverb masjid), Master Siaran*.

## Memasang plugin eksternal
- **FX → Pasang plugin / IR…** lalu pilih file, atau salin file ke **folder plugin** (`%APPDATA%\KLM Mix\config\plugins`) lalu **Muat ulang**.
- **Impulse response** (`.wav`, `.flac`, `.mp3`, `.ogg`, `.aiff`): muncul di efek **Reverb → Ruang** dengan tanda 📂.
  Cocok untuk rekaman ruangan asli (masjid, aula), hall/plate komersial, atau kabinet speaker.
- **Plugin JavaScript** (`.js`): format plugin KLM di bawah.

> VST/AU tidak dapat dimuat langsung di mesin audio ini. Jalankan VST di host (mis. Cantabile Lite, LightHost)
> lalu kirim ke KLM Mix lewat kabel audio virtual (VB-Cable) sebagai input **Mic / Audio Device**.

## Format plugin KLM (.js)
Modul ES dengan `export default`:

```js
export default {
  id: 'nama-unik',            // wajib
  name: 'Nama di daftar',     // wajib
  desc: 'Keterangan singkat', author: 'Anda',
  parallel: false,            // true = efek kirim (reverb/delay): dry tetap, Mix = jumlah wet
  mix: 1,                     // nilai Mix awal (0..1)
  worklet: `...kode AudioWorkletProcessor + registerProcessor(...)...`,   // opsional
  params: [ { k: 'drive', n: 'Drive', min: 0, max: 24, step: 0.5, def: 6, unit: 'dB' },
            { k: 'mode', n: 'Mode', def: 'a', options: [['a', 'Mode A'], ['b', 'Mode B']] } ],
  create(ctx, params, h) {
    // ctx = AudioContext KLM Mix (48 kHz). h = { smooth(param, v), worklet(name, opts), dbToGain(db), irs }
    const g = ctx.createGain();
    return { input: g, output: g, set(k, v) { /* terapkan parameter */ }, destroy() {} };
  }
};
```

Contoh lengkap: [`docs/plugin-contoh/bitcrusher.js`](plugin-contoh/bitcrusher.js).
Plugin berjalan di aplikasi dengan hak penuh — **pasang hanya plugin dari sumber tepercaya**.
