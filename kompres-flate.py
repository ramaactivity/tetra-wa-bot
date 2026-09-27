# Foto yang tersimpan lossless (Flate) -> JPEG q95 4:4:4, resolusi & ruang warna tetap.
# Per gambar: diterima hanya kalau beda piksel rata2 < BATAS dan hemat >= 30%.
# Mask (SMask) dan gambar kecil tidak disentuh.
import fitz, io, os, sys
from PIL import Image, ImageChops, ImageStat
src, out = sys.argv[1], sys.argv[2]
BATAS = 3.0  # per gambar mentah; penentu akhir = beda render halaman di bawah
d = fitz.open(src)
masks = set()
for x in range(1, d.xref_length()):
    if d.xref_is_stream(x):
        s = d.xref_get_key(x, "SMask")[1]
        if s.endswith(" 0 R"): masks.add(int(s.split()[0]))
def kanal(cs):
    if cs == "/DeviceRGB": return 3
    if cs == "/DeviceGray": return 1
    if cs == "/DeviceCMYK": return 4
    if cs.startswith("[/ICCBased"):
        n = d.xref_get_key(int(cs.split()[1]), "N")[1]
        return int(n) if n.isdigit() else 0
    return 0
MODE = {1: "L", 3: "RGB", 4: "CMYK"}
n_ok = n_skip = hemat = 0
for x in range(1, d.xref_length()):
    if not d.xref_is_stream(x) or x in masks: continue
    if d.xref_get_key(x, "Subtype")[1] != "/Image" or d.xref_get_key(x, "Filter")[1] != "/FlateDecode": continue
    raw = d.xref_stream_raw(x)
    if len(raw) < 150_000: continue
    if d.xref_get_key(x, "BitsPerComponent")[1] != "8" or d.xref_get_key(x, "Decode")[1] != "null": continue
    n = kanal(d.xref_get_key(x, "ColorSpace")[1])
    if n not in MODE: continue
    w, h = int(d.xref_get_key(x, "Width")[1]), int(d.xref_get_key(x, "Height")[1])
    data = d.xref_stream(x)
    if len(data) != w * h * n: continue
    im = Image.frombytes(MODE[n], (w, h), data)
    b = io.BytesIO(); im.save(b, "JPEG", quality=95, subsampling=0, optimize=True); jpg = b.getvalue()
    if len(jpg) > len(raw) * 0.7: n_skip += 1; continue
    cek = Image.open(io.BytesIO(jpg)).convert("RGB")
    beda = sum(ImageStat.Stat(ImageChops.difference(im.convert("RGB"), cek)).mean) / 3
    if beda >= BATAS: n_skip += 1; continue
    d.update_stream(x, jpg, compress=False)
    d.xref_set_key(x, "Filter", "/DCTDecode"); d.xref_set_key(x, "DecodeParms", "null")
    if n == 4: d.xref_set_key(x, "Decode", "[1 0 1 0 1 0 1 0]")  # JPEG CMYK dari PIL = Adobe (terbalik)
    hemat += len(raw) - len(jpg); n_ok += 1
d.save(out, garbage=4, deflate=True, clean=True)
A, B = fitz.open(src), fitz.open(out); hs = []
for i in range(len(A)):
    pa = A[i].get_pixmap(dpi=150); pb = B[i].get_pixmap(dpi=150)
    hs.append(sum(ImageStat.Stat(ImageChops.difference(
        Image.frombytes("RGB", (pa.width, pa.height), pa.samples),
        Image.frombytes("RGB", (pb.width, pb.height), pb.samples))).mean) / 3)
print(f"{n_ok} gambar jadi JPEG, {n_skip} dilewati; {os.path.getsize(src)/1e6:.1f}MB -> {os.path.getsize(out)/1e6:.1f}MB")
print(f"beda render @150dpi: rata2 {sum(hs)/len(hs):.2f}/255, terburuk {max(hs):.2f} (hal {hs.index(max(hs))+1})")
