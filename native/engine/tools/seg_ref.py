"""Referensi Latar AI untuk uji mandiri mesin native (CI).

Menjalankan model segmentasi (selfie_segmenter.tflite) dengan TensorFlow Lite resmi pada gambar uji sintetis
(siluet orang) dan menyimpan masukan & keluarannya sebagai float32 mentah. klm-engine.exe --selftest menjalankan
model yang sama dengan interpreter GPU-nya sendiri lalu membandingkan hasilnya.

pakai: python seg_ref.py <model.tflite> <folder keluaran>
"""
import os
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
    x = test_image(h, w)[None].astype(np.float32)
    it.set_tensor(ind["index"], x)
    it.invoke()
    y = it.get_tensor(outd["index"]).astype(np.float32)
    x.tofile(os.path.join(out, "in.bin"))
    y.tofile(os.path.join(out, "out.bin"))
    with open(os.path.join(out, "shape.txt"), "w") as f:
        f.write("%d %d %d %d %d\n" % (h, w, c, y.shape[1], y.shape[2]))
    print("REF min %.4f max %.4f mean %.4f  orang(>0.5) %.1f%%" % (y.min(), y.max(), y.mean(), 100.0 * (y > 0.5).mean()))
    print("REF tengah badan %.3f  pojok latar %.3f" % (y[0, int(h * 0.8), w // 2, 0], y[0, 8, 8, 0]))


if __name__ == "__main__":
    main()
