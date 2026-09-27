# Kompres katalog: gambar di atas 300 dpi (ukuran tampil) diperkecil ke 300 dpi,
# warna CMYK asli dipertahankan; mask transparansi tidak disentuh (dipakai bersama
# beberapa gambar, dan PDF mengizinkan resolusi mask berbeda dari gambarnya). Tidak ada konversi warna.
import fitz, io, os, sys
from PIL import Image, ImageChops, ImageStat
src, out, TARGET = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 300
d = fitz.open(src); tampil = {}
for p in d:
    for img in p.get_images(full=True):
        for r in p.get_image_rects(img[0]):
            tampil[img[0]] = max(tampil.get(img[0], 0), r.width, 1)
n = 0
for x, wpt in tampil.items():
    if d.xref_get_key(x, "Filter")[1] != "/DCTDecode": continue
    raw = d.xref_stream_raw(x); im = Image.open(io.BytesIO(raw))
    dpi = im.width / (wpt / 72)
    if dpi < TARGET * 1.15: continue
    ukuran = (max(1, round(im.width * TARGET / dpi)), max(1, round(im.height * TARGET / dpi)))
    b = io.BytesIO(); im.resize(ukuran, Image.LANCZOS).save(b, "JPEG", quality=92, optimize=True)
    d.update_stream(x, b.getvalue(), compress=False)
    d.xref_set_key(x, "Filter", "/DCTDecode")  # update_stream membuang Filter
    d.xref_set_key(x, "Width", str(ukuran[0])); d.xref_set_key(x, "Height", str(ukuran[1]))
    n += 1
d.save(out, garbage=4, deflate=True, clean=True)
A = fitz.open(src); B = fitz.open(out); h = []
for i in range(len(A)):
    pa = A[i].get_pixmap(dpi=150); pb = B[i].get_pixmap(dpi=150)
    h.append(sum(ImageStat.Stat(ImageChops.difference(
        Image.frombytes("RGB", (pa.width, pa.height), pa.samples),
        Image.frombytes("RGB", (pb.width, pb.height), pb.samples))).mean) / 3)
print(f"{n} gambar diperkecil → {os.path.getsize(out)/1e6:.1f}MB; beda piksel @150dpi rata2 {sum(h)/len(h):.2f}/255, terburuk {max(h):.2f}")
