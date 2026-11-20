"""Referensi Latar AI untuk uji mandiri mesin native (CI).

Menjalankan model segmentasi (selfie_segmenter.tflite) dengan TensorFlow Lite resmi pada gambar uji sintetis
(siluet orang) dan menyimpan masukan & keluarannya sebagai float32 mentah. klm-engine.exe --selftest menjalankan
model yang sama dengan interpreter GPU-nya sendiri lalu membandingkan hasilnya.

pakai: python seg_ref.py <model.tflite> <folder keluaran> [foto uji]
"""
import os
import struct
import sys

import numpy as np
import tensorflow as tf


def test_image(h, w):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    img = np.zeros((h, w, 3), np.float32)
    # latar: gradien langit + lantai
    img[..., 0] = 0.25 + 0.3 * (x / w)
    img[..., 1] = 0.45 + 0.2 * (y / h)
    img[..., 2] = 0.75 - 0.3 * (y / h)
    # kepala (warna kulit)
    head = ((x - w * 0.5) / (w * 0.15)) ** 2 + ((y - h * 0.33) / (h * 0.19)) ** 2 <= 1
    img[head] = (0.88, 0.68, 0.56)
    # rambut
    hair = head & (y < h * 0.24)
    img[hair] = (0.12, 0.09, 0.07)
    # leher + badan (baju gelap)
    neck = (np.abs(x - w * 0.5) < w * 0.06) & (y > h * 0.48) & (y < h * 0.58)
    img[neck] = (0.85, 0.65, 0.53)
    t = np.clip((y - h * 0.56) / (h * 0.44), 0, 1)
    body = (y >= h * 0.56) & (np.abs(x - w * 0.5) < w * (0.16 + 0.26 * t))
    img[body] = (0.16, 0.18, 0.26)
    return img


# ---- metadata TFLite (NormalizationOptions) dibaca langsung dari flatbuffer — sama dengan mesin native
class Tab:
    def __init__(self, b, off):
        self.b, self.t = b, off
        self.vt = off - struct.unpack_from("<i", b, off)[0]
        self.vsz = struct.unpack_from("<H", b, self.vt)[0]

    def fo(self, i):
        o = 4 + 2 * i
        return struct.unpack_from("<H", self.b, self.vt + o)[0] if o + 2 <= self.vsz else 0

    def u(self, i, fmt, d):
        o = self.fo(i)
        return struct.unpack_from(fmt, self.b, self.t + o)[0] if o else d

    def vec(self, i):
        o = self.fo(i)
        if not o:
            return None, 0
        p = self.t + o + struct.unpack_from("<I", self.b, self.t + o)[0]
        return p + 4, struct.unpack_from("<I", self.b, p)[0]

    def vtab(self, i, k):
        p, n = self.vec(i)
        if p is None or k >= n:
            return None
        q = p + 4 * k
        return Tab(self.b, q + struct.unpack_from("<I", self.b, q)[0])

    def tab(self, i):
        o = self.fo(i)
        return Tab(self.b, self.t + o + struct.unpack_from("<I", self.b, self.t + o)[0]) if o else None

    def s(self, i):
        p, n = self.vec(i)
        return self.b[p:p + n].decode("utf-8", "replace") if p is not None else ""


def normalization(path):
    b = open(path, "rb").read()
    root = Tab(b, struct.unpack_from("<I", b, 0)[0])
    _, nm = root.vec(6)
    for i in range(nm):
        md = root.vtab(6, i)
        if md.s(0) != "TFLITE_METADATA":
            continue
        bu = root.vtab(4, md.u(1, "<I", 0))
        p, n = bu.vec(0)
        mb = b[p:p + n]
        mm = Tab(mb, struct.unpack_from("<I", mb, 0)[0])
        tin = mm.vtab(3, 0).vtab(2, 0)
        _, np_ = tin.vec(4)
        for k in range(np_):
            pu = tin.vtab(4, k)
            if pu.u(0, "<B", 0) != 1:
                continue
            no = pu.tab(1)
            mp, a = no.vec(0)
            sp, c = no.vec(1)
            if a and c:
                return struct.unpack_from("<f", mb, mp)[0], struct.unpack_from("<f", mb, sp)[0]
    return None


def photo(path, h, w):
    raw = tf.io.read_file(path)
    img = tf.io.decode_image(raw, channels=3, expand_animations=False)
    img = tf.image.resize(tf.cast(img, tf.float32) / 255.0, (h, w), method="bilinear", antialias=True)
    return np.clip(img.numpy(), 0, 1).astype(np.float32)


def main():
    model, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    try:
        tf.lite.experimental.Analyzer.analyze(model_path=model)
    except Exception as e:  # hanya informasi
        print("analyzer:", e)
    it = tf.lite.Interpreter(model_path=model)
    it.allocate_tensors()
    try:
        for op in it._get_ops_details():
            print("OP", op["index"], op["op_name"], list(op["inputs"]), list(op["outputs"]))
    except Exception as e:
        print("ops:", e)
    ind, outd = it.get_input_details()[0], it.get_output_details()[0]
    print("INPUT", ind["name"], ind["shape"], ind["dtype"], ind.get("quantization"))
    print("OUTPUT", outd["name"], outd["shape"], outd["dtype"])
    _, h, w, c = ind["shape"]
    norm = normalization(model)
    print("NORMALISASI metadata:", norm)
    img = None
    if len(sys.argv) > 3 and os.path.exists(sys.argv[3]):
        try:
            img = photo(sys.argv[3], h, w)
            print("FOTO uji:", sys.argv[3])
        except Exception as e:
            print("foto uji gagal:", e)
    if img is None:
        img = test_image(h, w)
    x = img[None].astype(np.float32)
    img.astype(np.float32).tofile(os.path.join(out, "img.bin"))
    if norm:
        x = ((x * 255.0 - norm[0]) / norm[1]).astype(np.float32)
    it.set_tensor(ind["index"], x)
    it.invoke()
    y = it.get_tensor(outd["index"]).astype(np.float32)
    x.tofile(os.path.join(out, "in.bin"))
    y.tofile(os.path.join(out, "out.bin"))
    with open(os.path.join(out, "shape.txt"), "w") as f:
        f.write("%d %d %d %d %d\n" % (h, w, c, y.shape[1], y.shape[2]))
    print("REF min %.4f max %.4f mean %.4f  orang(>0.5) %.1f%%" % (y.min(), y.max(), y.mean(), 100.0 * (y > 0.5).mean()))
    print("REF tengah badan %.3f  pojok latar %.3f" % (y[0, int(h * 0.8), w // 2, 0], y[0, 8, 8, 0]))
    ys, xs = np.nonzero(y[0, :, :, 0] > 0.5)
    if len(xs):
        print("REF kotak orang x %d..%d  y %d..%d" % (xs.min(), xs.max(), ys.min(), ys.max()))


if __name__ == "__main__":
    main()
