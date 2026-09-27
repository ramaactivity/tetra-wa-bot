# Ganti teks di PDF pricelist dengan font yang tertanam (Poppins), posisi & warna sama.
# (halaman, teks span lama, teks baru, rata) ; rata "kanan" = tepi kanan tetap.
import fitz, sys
src, out = sys.argv[1], sys.argv[2]
GANTI = [
    (18, "CUSTOME SLEEVE 1000 LEMBAR", "CUSTOM SLEEVE 1000 LEMBAR", "kiri"),
    (18, "RP. 200.000", "Rp. 200.000", "kanan"),
    (18, "RP. 1.500.000", "Rp. 1.500.000", "kanan"),
    (21, "Minimal booking DP sebesar Rp500.000,- ", "Minimal booking DP sebesar Rp. 500.000", "kiri"),
]
d = fitz.open(src)
for hal, lama, baru, rata in GANTI:
    p = d[hal - 1]
    span = next(s for b in p.get_text("dict")["blocks"] for l in b.get("lines", []) for s in l["spans"] if s["text"] == lama)
    xref = next(f[0] for f in p.get_fonts() if f[3].endswith("+" + span["font"]))
    buf = d.extract_font(xref)[3]
    font = fitz.Font(fontbuffer=buf)
    hilang = [c for c in set(baru) if not font.has_glyph(ord(c))]
    assert not hilang, f"glyph tidak ada di font subset: {hilang}"
    r = fitz.Rect(span["bbox"])
    p.add_redact_annot(r, fill=None)
    p.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)
    nama = f"F{xref}"
    p.insert_font(fontname=nama, fontbuffer=buf)
    # Jarak antarhuruf (tracking) dari teks asli: lebar asli - lebar alami, dibagi jumlah huruf.
    ukur = lama.rstrip()
    trk = (r.width - font.text_length(ukur, span["size"])) / max(len(ukur), 1) if lama.strip() else 0
    trk = max(trk, 0)
    lebar = font.text_length(baru, span["size"]) + trk * len(baru)
    x = span["origin"][0] if rata == "kiri" else r.x1 - lebar + trk  # bbox asli tanpa spasi setelah huruf terakhir
    c = span["color"]; warna = ((c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255)
    for ch in baru:
        p.insert_text((x, span["origin"][1]), ch, fontname=nama, fontsize=span["size"], color=warna)
        x += font.text_length(ch, span["size"]) + trk
    print(f"hal {hal}: {lama!r} -> {baru!r}")
d.save(out, garbage=4, deflate=True, clean=True)
