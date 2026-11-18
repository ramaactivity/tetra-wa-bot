"""Pemeriksa balasan WhatsApp cs-wa: fungsi murni, tanpa impor Hermes (diuji di uji_penjaga.py).

Pindahan dari penjaga kode Node `~/tetra-wa-bot/src/lib/ai.js` (Tahap 3, Rama 18 Nov 2026: "bener-bener native semua
dihandle oleh hermes"). Asal tiap aturan ditulis di komentarnya: insiden/keputusan Rama yang melahirkannya. Kalau aturan
diubah, ubah di sini dan tambah kasusnya di uji_penjaga.py.

Kelas masalah:
  fatal  -> tidak boleh terkirim; kalau tetap ada setelah ditulis ulang, balasan diganti [ADMIN_HANDOFF]
  buang  -> kalau tetap ada setelah ditulis ulang, kalimatnya dibuang
  gaya   -> diminta tulis ulang; kalau tetap ada, balasan tetap dikirim
"""
from __future__ import annotations

import math
import re
from functools import lru_cache

PENANDA_PROMPT = "<!-- End Hermes runtime environment -->"
RE_FAKTA_AWAL = re.compile(r"WAKTU SEKARANG: (?:Minggu|Senin|Selasa|Rabu|Kamis|Jumat|Sabtu),|TUGAS SISTEM \(bukan pesan untuk klien\)")
HANDOFF = "[ADMIN_HANDOFF]"
# Pembanding "bocor pikiran" = aturan (SOUL + skill prosedur), bukan fakta FAQ yang memang boleh dikutip (Node dulu juga
# tanpa FAQ). Blok skill di prompt: "---\nname: <skill>" ... "[Skill directory: …/<skill>]".
RE_BLOK_FAQ = re.compile(r"---\nname: faq-tetra\n[\s\S]*?\[Skill directory: [^\]]*/faq-tetra\]")
# Vendor rekanan jangan merasa dilempar bot (Rama 30 Sep): harga yang tidak bisa dipastikan -> kalimat santai + kabari admin.
HANDOFF_VENDOR = "Bentar ya, harganya aku pastiin dulu ke admin hehe.\n[INFO_ADMIN: harga untuk vendor perlu dicek admin]"


# ── Bacaan dasar ────────────────────────────────────────────────────────────────────────────────────────────────
def normal(t: str) -> str:
    return re.sub(r"\s+", " ", str(t).lower()).strip()


def isi_klien(teks: str) -> str:
    """Teks yang dibaca klien: tanpa penanda [..] dan tanpa link."""
    return re.sub(r"https?:\S+", "", re.sub(r"\[[A-Z_]+[^\]]*\]", "", str(teks))).strip()


def bagi_sistem(sistem: str) -> tuple[str, str]:
    """(prompt stabil berisi SOUL + skill, fakta dari sistem bot WA). Hermes menempel instruksi Runs API sesudah prompt
    stabil (turn_context.py: effective_system + "\\n\\n" + ephemeral)."""
    i = sistem.rfind(PENANDA_PROMPT)
    if i >= 0:
        i += len(PENANDA_PROMPT)
        return sistem[:i], sistem[i:].strip()
    m = None
    for m in RE_FAKTA_AWAL.finditer(sistem):
        pass
    return (sistem[:m.start()], sistem[m.start():].strip()) if m else (sistem, "")


def baca_frasa(isi_file: str) -> tuple[list[str], list[str]]:
    """docs/FRASA-KAKU.md -> (frasa kaku: tulis ulang, kata robot: dibuang kalau tetap muncul). Kata robot = baris di
    bawah judul '## Kata robot'."""
    kaku, robot, bagian = [], [], ""
    for baris in isi_file.splitlines():
        if baris.startswith("## "):
            bagian = baris.lower()
        elif baris.startswith("- "):
            f = baris[2:].split(" #")[0].strip().lower()
            if f:
                (robot if "kata robot" in bagian else kaku).append(f)
    return kaku, robot


# ── Angka & sumber ──────────────────────────────────────────────────────────────────────────────────────────────
RE_ANGKA = re.compile(r"(rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)?(?![\w])", re.I)


def angka_rupiah(teks: str) -> list[int]:
    """Nominal rupiah >= 10.000. Tanpa "Rp"/satuan hanya angka berpemisah ribuan >= 100.000 (admin tulis "2.300.000")."""
    out = []
    for m in RE_ANGKA.finditer(str(teks)):
        sat = (m.group(3) or "").lower()
        ribuan = bool(re.fullmatch(r"\d{1,3}([.,]\d{3})+", m.group(2)))
        n = float(re.sub(r"[.,]", "", m.group(2))) if ribuan else float(m.group(2).replace(",", "."))
        if not m.group(1) and not sat and not (ribuan and n >= 100000):
            continue
        if sat in ("jt", "juta"):
            n *= 1e6
        elif sat in ("rb", "ribu", "k"):
            n *= 1e3
        if n >= 10000:
            out.append(math.floor(n + 0.5))
    return out


def tabel_classic(stabil: str) -> dict[str, int]:
    """Harga paket Photobooth Classic per durasi dari skill faq-tetra (baris pertama di bawah '### Photobooth Classic').
    Node dulu membaca tabel ini dari SYSTEM_PROMPT lama; sejak otak Hermes (16 Nov) tabel itu tidak ikut -> cek ketat mati."""
    i = stabil.find("### Photobooth Classic")
    if i < 0:
        return {}
    baris = next((b for b in stabil[i:].splitlines()[1:] if b.startswith("- ")), "")
    return {d: int(h.replace(".", "")) for d, h in re.findall(r"(\d+)\s*jam\s*Rp\s*([\d.]+)", baris, re.I)}


def harga_asing(teks: str, sumber: str, stabil: str = "", khusus_dari: str = "") -> list[int]:
    """Nominal di balasan yang tidak bersumber (zero mistake soal angka). Sumber = semua yang dilihat model; turunan
    wajar boleh: x1-10 (unit, jam extend, pcs), diskon 10%, jumlah dua kelipatan, selisih (sisa pelunasan)."""
    dasar = set(angka_rupiah(sumber))
    l1 = set()
    for a in dasar:
        l1.update(a * k for k in range(1, 11))
        l1.add(math.floor(a * 0.9 + 0.5))
        l1.add(math.floor(a * 0.1 + 0.5))
    boleh = set(l1)
    arr = list(l1)
    for x in arr:
        for y in arr:
            boleh.add(x + y)
    for a in dasar:
        for b in dasar:
            boleh.add(abs(a - b))
    salah = [n for n in angka_rupiah(teks) if n not in boleh]
    # Cek ketat paket Classic per durasi: kombinasi di atas rapat, jadi "4 jam Rp 2.000.000" (angka 2 jam) bisa lolos.
    tabel = tabel_classic(stabil)
    layanan_lain = bool(re.search(r"360|videobooth|magazine|photo ?stage", teks, re.I))
    per_durasi: dict[str, set[int]] = {}
    for d, h in re.findall(r"(\d+)\s*jam\s*:?\s*Rp\s*([\d.]+)", sumber, re.I):
        per_durasi.setdefault(d, set()).add(int(h.replace(".", "") or 0))
    khusus = angka_rupiah(khusus_dari)  # harga vendor / dari admin di chat
    nilai_tabel = {x for v in tabel.values() for x in (v, v * 2, v * 3, math.floor(v * 0.9 + 0.5))}
    for baris in str(teks).split("\n"):
        if re.search(r"360|videobooth|magazine|photo ?stage", baris, re.I):
            continue
        for m in re.finditer(r"(?<![\d.,])(\d+)\s*jam\b([^\n]{0,40})", baris, re.I):
            # "4 jam tambahan x Rp 500.000" = harga extend, bukan harga paket 4 jam.
            depan = re.split(r"rp", m.group(2), flags=re.I)[0]
            if (re.search(r"extend|tambah|per jam|×|\bx\b", depan, re.I) or re.search(r"/\s*jam", m.group(2), re.I)
                    or re.search(r"extend|tambah", baris[max(0, m.start() - 15):m.start()], re.I)):
                continue
            d = m.group(1)
            resmi = list(per_durasi.get(d, ())) if layanan_lain else ([tabel[d]] if d in tabel else [])
            angka = angka_rupiah(re.split(r"\d+(?:[.,]\d+)?\s*jam", m.group(2), flags=re.I)[0])
            if d not in tabel or not angka:
                continue
            n = angka[0]
            cocok = any(n in (r, r * 2, r * 3, math.floor(r * 0.9 + 0.5)) for r in resmi)
            harga_khusus = n not in nilai_tabel and n in khusus
            if not cocok and not harga_khusus and n not in salah:
                salah.append(n)
    return salah


RE_URL = re.compile(r"https?://[^\s)\]]+", re.I)
RE_ALAMAT = re.compile(r"\b(?:[Jj]l\.?|[Jj]ln\.?|[Jj]alan|[Bb]lok|[Kk]awasan|[Kk]omplek|[Kk]ompleks|[Rr]uko|[Gg]ang)\s+[A-Z0-9][^\n,.;]{2,40}")


def tautan_asing(teks: str, sumber: str) -> list[str]:
    """Link harus tertulis di sumber; alamat: semua kata pentingnya (>=4 huruf) ada di sumber (audit Nov ...2792:
    dua link maps karangan + "Kawasan Niaga Citra Indah Blok A1 Sentul")."""
    src = str(sumber).lower()
    out = []
    for u in RE_URL.findall(str(teks)):
        x = re.sub(r"/$", "", re.sub(r"[.,!?]+$", "", u))
        if x.lower() not in src:
            out.append(x)
    for a in RE_ALAMAT.finditer(isi_klien(str(teks))):
        kata = [w for w in re.split(r"[^a-z0-9]+", a.group(0).lower())[1:] if len(w) >= 4]
        if kata and not all(w in src for w in kata):
            out.append(a.group(0).strip())
    return out


# ── Pola ────────────────────────────────────────────────────────────────────────────────────────────────────────
# Insiden 14 Okt (Rakha): pikiran model ikut terkirim. DeepSeek berpikir dalam bahasa Inggris -> penandanya ikut dijaga.
RE_PIKIRAN = re.compile(
    r"^\s*(?:[-*]\s*)?(?:aturan\b|cek aturan|klien (?:bilang|cuma|sudah|minta|mau|menanyakan)\b|mari\b|tunggu[:,]|wait\b|"
    r"balasan (?:singkat|final|untuk klien)|atau lebih natural|jadi:|draf\b|we (?:need|should|must)\b|let me\b|let's\b|"
    r"the (?:user|client|customer)\b|i (?:need|should|will|must)\b|okay,? (?:so|let)|hmm\b|final (?:answer|reply)\b|draft\b)",
    re.I | re.M)


@lru_cache(maxsize=4)
def _kalimat_aturan(stabil: str) -> tuple[str, ...]:
    potong = re.split(r"\n|(?<=[.!?])\s+", stabil)
    return tuple({s for s in (normal(re.sub(r"^[\s\-*\d.)]+", "", p)) for p in potong) if len(s) >= 40})


def bocor_pikiran(teks: str, stabil: str) -> bool:
    """Penanda catatan internal, atau >=2 kalimat aturan (>=40 huruf) tersalin utuh (satu saja bisa kutipan sah)."""
    if RE_PIKIRAN.search(teks):
        return True
    t = normal(teks)
    n = 0
    for s in _kalimat_aturan(stabil):
        if s in t:
            n += 1
            if n >= 2:
                return True
    return False


# Klaim tindakan yang bot tidak bisa lakukan (audit 22 Okt, 6 kasus nyata; uji V2 11 Nov "Sudah aku perbarui").
RE_KLAIM_AKSI = re.compile("|".join([
    # "-?nya": "DP-nya sudah masuk" lolos dari pola Node lama (ditemukan saat pindahan 18 Nov).
    r"\b(bukti\s+)?(transfer|tf|dp|pembayaran|pelunasan)(-?nya)?\s+(sudah|udah|telah)\s+(masuk|diterima|kami terima|aku terima|lunas)",
    r"\bmasuk\s+(skema|daftar)\s+rekanan",
    r"\b(sudah|udah)\s+(aku|kami)\s+(siapin|siapkan|daftarkan|hubungi)\b",
    r"\b(aku|kami|tim\s+kami)\s+(akan\s+|nanti\s+|segera\s+)?(kirim(kan|in)?|hubungi)\b[^.\n?]{0,30}\be-?mail\b",
    r"\b(di)?antar(kan|in)?\s+ke\s+(kantor|alamat|rumah|venue)",
    r"\b(sudah|udah)\s+(aku|kami)\s+(perbarui|perbaharui|update|ubah|ganti|geser|amankan)\b",
    r"\b(aku|kami)\s+(sudah\s+|udah\s+)?(perbarui|perbaharui|update)\b",
]), re.I)
# Lokasi kantor & janji temu sepihak (Rama 11 Nov: "jangan pernah share lokasi kantor… jangan asal terima janji sepihak").
RE_JANJI_TEMU = re.compile("|".join([
    r"\b(silakan|silahkan|boleh|bisa)\s+(langsung\s+)?(datang|mampir|main|ambil)\s+(ke\s+)?(kantor|studio|basecamp|workshop|gudang|rumah|tempat)\s+(kami|kita|tetra|aku)",
    r"\b(aku|kami|kita)\s+tunggu\s+(di|ke)\b",
    r"\b(aku|kami)\s+(yang\s+)?(antar(kan|in)?|anterin|jemput|samperin)\b",
    r"\b(kita|aku|kami)\s+ketemu(an)?\s+(di|jam|besok|hari|lusa)\b",
    r"\b(alamat|lokasi)\s+(kantor|studio|basecamp)\s+(kami|kita|tetra)\s*(di|ada di|:)",
    r"\bshare\s*lo[kc]\b[^.\n]{0,30}\b(kantor|studio|kami)\b",
]), re.I)
# Janji kirim file tanpa penanda [KIRIM:..] = tidak ada yang terkirim (uji V2 11 Nov).
RE_JANJI_KIRIM = re.compile(r"\b(?:aku|kami)\s+(?:kirim(?:in|kan)?|lampirkan)\b[^.\n]{0,40}\b(?:gambar|contoh|file|pdf|katalog|ukuran|pricelist|skema|profil|ilustrasi|desain)", re.I)
# Janji ke admin tanpa penanda = admin tidak pernah tahu (uji 14 Okt); "nanti aku kabari" juga janji (audit Nov ...4324).
RE_JANJI_ADMIN = re.compile(r"\b(?:teruskan|terusin|tanyain|tanyakan|sampaikan|pastiin|pastikan|konfirmasi(?:kan)?|cek(?:in)?|kabarin)\b[^.\n?]{0,25}\b(?:ke|sama|dengan|dari) (?:admin|owner|tim)\b|\bnanti (?:aku|kami) (?:kabari|kabarin|infoin|infokan|kasih kabar)\b", re.I)
# Usulan 72: status tanggal hanya dari hasil alat jadwal di giliran ini (15 Nov ...1015, 12 Nov ...4133).
RE_KLAIM_TERSEDIA = re.compile(r"\bmasih\s+(?:available|tersedia|kosong|free|bisa dilayani|bisa kami layani)\b|\b(?:tanggal|jadwal)(?:nya)?\s+(?:itu\s+|tersebut\s+|ini\s+)?(?:masih\s+)?(?:aman|kosong|available|tersedia)\b", re.I)
# Usulan 65 & 70: bot tidak ikut grup WA/rapat/tech meeting dan tidak hadir di lokasi (...6996).
RE_KOORDINASI_LAPANGAN = re.compile(r"\b(?:aku|kami|tim kami|crew kami|tim tetra)\b[^.?!\n]{0,40}\b(?:koordinasi(?:kan)?|hadir|datang|gabung|ikut)\b[^.?!\n]{0,60}\b(?:grup|group|tech(?:nical)?\s*meeting|rapat|meeting|tm)\b|\bdi grup\b[^.?!\n]{0,20}\baku\s+koordinasi|\bkoordinasi teknis\b[^.?!\n]{0,40}\b(?:via|lewat)\s+(?:chat|telepon|telpon|wa|whatsapp)\b", re.I)
RE_AJAK_GRUP = re.compile(r"\b(?:tambah\w*|masuk\w*|add|undang\w*|gabung|ikut\w*)\b[^.?!\n]{0,40}\b(?:grup|group|tech(?:nical)?\s*meeting|rapat|meeting)\b|\btech(?:nical)?\s*meeting\b", re.I)
# Usulan 71: janji "nanti aku/tim kabari" cukup sekali; jangan bilang file belum masuk / minta kirim ulang berkali-kali (...5386).
RE_JANJI_KABARI = re.compile(r"\b(?:nanti|ntar)\b[^.?!\n]{0,40}\b(?:aku|tim|admin|kami)\b[^.?!\n]{0,25}\b(?:kabar(?:i|in)|infoin|informasikan|hubungi)\b|\b(?:tim|admin)\s+(?:yang\s+)?(?:kabar(?:i|in)|infoin)\b", re.I)
RE_MINTA_ULANG = re.compile(r"\b(?:kirim(?:kan)?\s+ulang|dikirim\s+ulang|kirim\s+lagi|(?:belum|tidak|nggak|gak|ga)\s+masuk|belum\s+ke(?:kirim|terima))\b", re.I)
RE_PENANDA_ADMIN = re.compile(r"\[(INFO_ADMIN|ADMIN_HANDOFF|SULIT|QUOTATION|PERUBAHAN)", re.I)
# ponytail: rentang emoji umum, bukan \p{Extended_Pictographic} (modul `regex` tidak ada di runtime Hermes).
RE_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⌀-⏿⬀-⯿]")

# Basa-basi (Rama 11 Nov): validasi tak diminta, menjual crew, mendaftar isi paket, penegas yang mengulang makna.
RE_VALIDASI = re.compile(r"(\d+\s*jam|durasi(nya)?|paket(nya)?)[^.?!\n]{0,40}\b(sudah|udah|memang)\s*(cukup|pas|sesuai|aman)\b|\b(sudah|udah|memang)\s+(cukup|pas|sesuai)\b[^.?!\n]{0,30}\b(tamu|jam)\b", re.I)
RE_ALASAN = re.compile(r"\b(karena|soalnya|biar|supaya|sehingga|jadi|kebagian|antre|antri|per jam)\b", re.I)
RE_CREW = re.compile(r"\btermasuk\b[^.?!\n]{0,50}\bcrew\b|\bcrew\s+(yang\s+)?(standby|siap)\b", re.I)
RE_DAFTAR_ISI = re.compile(r"(?<!belum\s)\b(termasuk|include)\s+([^.?!\n,]{2,30}),\s*([^.?!\n,]{2,30})(,\s*|\s+dan\s+)[^.?!\n]{2,30}", re.I)
RE_PENEGAS = re.compile(r"\b(tidak|tanpa|gak|nggak|ga)\s+(ada\s+)?biaya(\s+tambahan)?\b[^.?!\n]{0,30}\b(sudah\s+)?(termasuk|include|gratis|free)\b|\b(gratis|free)\b[^.?!\n]{0,30}\b(tanpa|tidak\s+ada)\s+biaya\b|\bsudah\s+(termasuk|include)\s+(dalam|di)\s+harga\b", re.I)


def basa_basi(isi: str, pesan_klien: str = "") -> list[str]:
    out = []
    tanya = str(pesan_klien)
    v = RE_VALIDASI.search(isi)
    if v and not (re.search(r"cukup|pas\b|ideal|berapa jam|enaknya|sebaiknya|rekomendasi|saran|kurang", tanya, re.I) and RE_ALASAN.search(isi)):
        out.append(f'hapus kalimat validasi yang tidak diminta ("{v.group(0)}") — basa-basi; kalau klien memang bertanya cukup/tidak, '
                   "jawab singkat dengan patokan ±100 tamu per jam, tanpa narasi manfaat")
    if RE_CREW.search(isi) and not re.search(r"crew|kru|petugas|operator|teknis", tanya, re.I):
        out.append("jangan menjual crew (itu standar minimum): pilih satu nilai lain yang relevan untuk acaranya, atau buang")
    di = RE_DAFTAR_ISI.search(isi)
    if di and not re.search(r"\b(tapi|kalau|namun|nanti)\b", di.group(0), re.I) and not re.search(r"termasuk apa|dapat apa|include|sudah termasuk|isi paket|fasilitas", tanya, re.I):
        out.append("jangan mendaftar isi paket: sebut SATU nilai yang paling relevan untuk acaranya")
    if RE_PENEGAS.search(isi):
        out.append('buang penegas yang mengulang makna (mis. "tidak ada biaya tambahan, sudah termasuk dalam harga"): cukup satu pernyataan singkat')
    return out


def penutup_jualan(teks: str, pesan_klien: str = "") -> str:
    """Usulan 62: klien tanya satu hal singkat -> penutup pertanyaan pilihan/jualan bikin klien berhenti (...3958, ...7846)."""
    klien = str(pesan_klien or "").strip()
    if not klien or len(klien) > 120 or not re.search(r"\?|\b(berapa|apa|apakah|bisa|ada|gimana|bagaimana|termasuk)\b", klien, re.I):
        return ""
    baris = [b for b in re.split(r"\n+", isi_klien(teks).strip()) if b]
    akhir = (baris[-1] if baris else "").strip()
    if not re.search(r"\?\s*$", akhir) or not re.search(r"\batau\b", akhir, re.I):
        return ""
    return akhir if re.search(r"\b(jam|paket|durasi|frame|backdrop|warna|ambil|pakai|lanjut|format|2r|4r|polaroid)\b", akhir, re.I) else ""


def jam_diminta(pesan_klien: str) -> int:
    return max([0] + [int(x) for x in re.findall(r"\b(\d{1,2})\s*jam\b", str(pesan_klien or ""), re.I)])


def durasi_dua_jalan(teks: str, pesan_klien: str) -> bool:
    """Usulan 73: 7 jam wajib dua jalan (6 jam + extend DAN 8 jam); 9-13 jam wajib menyebut paket 13 jam juga."""
    isi, j = isi_klien(teks), jam_diminta(pesan_klien)
    if j == 7:
        return bool(re.search(r"\b6\s*jam\b", isi, re.I)) and not re.search(r"\b8\s*jam\b", isi, re.I)
    if 9 <= j <= 13:
        return bool(re.search(r"\b8\s*jam\b", isi, re.I)) and not re.search(r"\b13\s*jam\b", isi, re.I)
    return False


def durasi_kurang(teks: str, pesan_klien: str) -> int:
    """Durasi > 8 jam dijawab harga paket 8 jam saja (audit Nov ...2553): wajib extend atau paket 13 jam."""
    jam = [int(x) for x in re.findall(r"(\d{1,2})\s*jam", str(pesan_klien), re.I)]
    n = max(jam) if jam else 0
    if n <= 8 or n > 24:
        return 0
    return n if re.search(r"\bRp\b", teks, re.I) and not re.search(r"extend|tambah(?:an)?\s*(?:durasi|jam)|per jam|13 jam", teks, re.I) else 0


def buang_kalimat(teks: str, pola: re.Pattern) -> str:
    """Buang kalimat yang memuat pola (jaring terakhir kalau tulis ulang tetap melanggar)."""
    out = "\n".join(" ".join(k for k in re.split(r"(?<=[.!?])\s+", b) if not pola.search(k)) for b in teks.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def buang_kata_robot(teks: str, kata: list[str]) -> str:
    sisa = "\n".join(b if b.strip().startswith("[") else " ".join(k for k in re.split(r"(?<=[.!?])\s+", b)
                                                                    if not any(w in normal(k) for w in kata))
                     for b in teks.split("\n"))
    sisa = re.sub(r"\n{3,}", "\n\n", sisa).strip()
    return sisa if isi_klien(sisa) else teks


def frasa_kaku(teks: str, frasa: list[str]) -> list[str]:
    t = isi_klien(teks).lower()
    return [f for f in frasa if f in t]


def masalah_gaya(teks: str, pertama: bool = False, pesan_klien: str = "", frasa: list[str] = (), robot: list[str] = ()) -> list[tuple[str, str, str]]:
    """(kode, kelas, koreksi) per masalah. Panjang sengaja TIDAK dicek kecuali kontak pertama (Rama 22 Okt)."""
    isi = isi_klien(teks)
    t = normal(isi)
    out = []
    kata = [k for k in robot if k in t]
    if kata:
        out.append(("kata_robot", "buang", "kata terlarang: " + ", ".join(f'"{k}"' for k in kata)))
    if re.search(r"\bsaya\b", isi, re.I):
        out.append(("saya", "gaya", 'sebut diri "aku", bukan "saya"'))
    if re.search(r"\bkamu\b", isi, re.I):
        out.append(("kamu", "gaya", 'sapa klien "Kak", bukan "kamu"'))
    k = RE_KLAIM_AKSI.search(isi)
    if k:
        out.append(("klaim_aksi", "fatal", f'klaim tindakan yang tidak bisa kamu lakukan ("{k.group(0)}"): kamu tidak bisa melihat gambar/rekening, '
                    "mengirim email, mengantar barang, atau mendaftarkan rekanan. Bilang akan diteruskan ke admin, lalu tambahkan [INFO_ADMIN: <apa yang perlu dilakukan>]"))
    if len(RE_EMOJI.findall(isi)) > 1:
        out.append(("emoji", "gaya", "emoji maksimal 1"))
    # Rama 11 Nov: isi lampiran tidak diulang di teks (skema rekanan, format cetak, sleeve).
    if re.search(r"\[KIRIM:\s*(skema|rekanan)\b", teks, re.I) and re.search(r"komisi", isi, re.I) and re.search(r"potongan|harga publish", isi, re.I):
        out.append(("ulang_lampiran", "gaya", "skema rekanan sudah dilampirkan: jangan ulang isinya di teks, cukup pengantar singkat dan persilakan bertanya kalau ada yang kurang jelas"))
    if re.search(r"\[KIRIM:\s*format\b", teks, re.I) and len(re.findall(r"\d+(?:,\d+)?\s*[×x]\s*\d+", isi)) > 1:
        out.append(("ulang_lampiran", "gaya", "ilustrasi format cetak sudah dilampirkan: jangan ulang ukuran tiap format di teks, cukup pengantar singkat"))
    jelas_sleeve = re.search(r"sleeve", isi, re.I) and re.search(r"custom sleeve|sleeve basic|basic hitam|hitam (atau )?putih|bingkai|desain(nya)? sendiri", isi, re.I)
    if jelas_sleeve and not re.search(r"\[KIRIM:\s*sleeve\b", teks, re.I):
        out.append(("sleeve", "gaya", "penjelasan cetakan + sleeve sebaiknya lewat ilustrasi: tulis [KIRIM: sleeve] dengan pengantar singkat, jangan menjelaskan panjang di teks"))
    elif jelas_sleeve and len(isi) > 200:
        out.append(("ulang_lampiran", "gaya", "ilustrasi sleeve sudah dilampirkan: jangan ulang isinya di teks, cukup pengantar singkat (harga Custom Sleeve hanya kalau dia menanyakannya)"))
    out += [("basa_basi", "gaya", x) for x in basa_basi(isi, pesan_klien)]
    if re.search(r"\[KIRIM:", teks, re.I) and len(re.findall(r"\b(?:berikut|ini (?:ada |dia )?(?:gambaran|perbandingan|contoh))\b", isi, re.I)) >= 2:
        out.append(("dua_pengantar", "gaya", 'pengantar lampiran cukup SATU kalimat (senada "Silahkan Kak, berikut … ya"), jangan dua kalimat yang maknanya sama'))
    kaku = frasa_kaku(teks, frasa)
    if kaku:
        out.append(("frasa_kaku", "gaya", "hapus frasa kaku: " + ", ".join(f'"{f}"' for f in kaku) + " — ganti dengan kalimat biasa"))
    if (re.search(r"\[KIRIM:\s*format\b", teks, re.I) and len({x.lower() for x in re.findall(r"\b(2R|4R|polaroid)\b", isi, re.I)}) >= 2
            and len(isi) > 250):
        out.append(("ulang_lampiran", "gaya", "ilustrasi format sudah dilampirkan: jangan jelaskan tiap format di teks, cukup pengantar singkat + satu pertanyaan"))
    if isi.count("?") > 2:
        out.append(("tanya_banyak", "gaya", "maksimal 2 pertanyaan"))
    if RE_KOORDINASI_LAPANGAN.search(isi):
        out.append(("koordinasi", "gaya", "kamu tidak ikut grup WA, rapat, atau tech meeting dan tidak hadir di lokasi: jangan menjanjikan koordinasi/kehadiran "
                    "dan jangan menjelaskan proses internal. Jawab satu baris bahwa ajakan/undangannya diteruskan ke admin, lalu tambahkan [INFO_ADMIN: <ajakan klien>]"))
    # Usulan 61: harga durasi di tabel & isi paket dijawab langsung, bukan "datanya dipegang admin" (...2152 Sandra).
    if re.search(r"dipegang admin|datanya (?:ada )?di admin", isi, re.I) and re.search(r"\b[2-68]\s*jam\b|soft ?file|flashdisk|\bqr\b|termasuk", str(pesan_klien or ""), re.I):
        out.append(("dipegang_admin", "gaya", 'harga durasi/isi paket yang dia tanya ada di tabel FAQ: jawab langsung angkanya dan faktanya (mis. "6 jam Rp ..., iya dapat softfile"), jangan bilang datanya dipegang admin'))
    # Usulan 64: info backdrop basic gratis + lampiran berhenti di situ, tanpa pertanyaan memilih warna (...6793 Yessi).
    baris = [b for b in re.split(r"\n+", isi.strip()) if b]
    akhir = (baris[-1] if baris else "").strip()
    if (re.search(r"backdrop basic", isi, re.I) and re.search(r"compliment|free|gratis", isi, re.I) and re.search(r"\?\s*$", akhir)
            and re.search(r"warna|condong|backdrop", akhir, re.I)):
        out.append(("tanya_backdrop", "gaya", f'setelah info backdrop basic gratis + lampiran, jangan tutup dengan pertanyaan memilih ("{akhir}"): cukup kalimat itu lalu berhenti'))
    p = penutup_jualan(teks, pesan_klien)
    if p:
        out.append(("penutup_jualan", "gaya", f'penutup "{p}" adalah pertanyaan pilihan/jualan padahal klien baru tanya satu hal: jawab yang dia tanya lalu berhenti '
                    "(boleh tanpa pertanyaan; kalau memang perlu bertanya, hanya tanggal/lokasi yang belum diketahui)"))
    # Kontak pertama (Rama 28 Okt "terlalu ngegas"; 99 kontak pertama: >400 huruf dibalas 41% vs <400 87%, >=2 harga 33%).
    if pertama and len(isi) > 420:
        out.append(("pertama_panjang", "gaya", f"pesan pertama ke orang baru terlalu panjang ({len(isi)} karakter): ringkas jadi 2–4 kalimat (maks ±350 karakter), "
                    "jawab yang dia tanya saja, buang daftar isi paket, saran naik durasi/paket, dan catatan tambahan; sisakan satu pertanyaan ringan"))
    if pertama and not re.search(r"\b7\s*jam\b", str(pesan_klien or ""), re.I) and len(re.findall(r"Rp ?\d", isi)) > 1:
        out.append(("pertama_harga", "gaya", "pesan pertama cukup SATU angka harga (yang paling sesuai pertanyaannya)"))
    return out


# ── Gaya akhir (deterministik) ──────────────────────────────────────────────────────────────────────────────────
def rapikan_gaya(teks: str, maks_tebal: int = 0) -> str:
    """Tanda AI (Rama 11 Nov): tanda pisah jadi koma (rentang angka jadi '-'), bold dibatasi, "penawaran" -> "quotation".
    Baris penanda [..] tidak disentuh."""
    tebal = [0]

    def bold(m):
        tebal[0] += 1
        return m.group(0) if tebal[0] <= maks_tebal else m.group(1)

    def quotation(m):
        return "Quotation" if m.group(0)[0].isupper() else "quotation"

    out = []
    for b in str(teks or "").split("\n"):
        if re.match(r"^\s*\[[A-Z_]+", b):
            out.append(b)
            continue
        b = re.sub(r"(\d)\s*[–—]\s*(\d)", r"\1-\2", b)
        b = re.sub(r"^\s*[–—]\s*", "", b)
        b = re.sub(r"\s*[–—]\s*$", "", b)
        b = re.sub(r"\s*[–—]\s*", ", ", b)
        b = re.sub(r",\s*([,.!?])", r"\1", b)
        b = re.sub(r"\*([^*\n]+)\*", bold, b)
        b = re.sub(r"\b(surat\s+)?penawaran(\s+(resmi|harga))?(\s*\(quotation\))?", quotation, b, flags=re.I)
        out.append(b)
    return "\n".join(out)


def pisah_pertanyaan(teks: str) -> str:
    """Rama 11 Nov ("terlalu bertumpuk"): pertanyaan penutup yang menempel di kalimat informasi pindah ke baris baru."""
    baris = str(teks or "").split("\n")
    i = len(baris) - 1
    while i >= 0 and (not baris[i].strip() or re.match(r"^\s*\[[A-Z_]+", baris[i])):
        i -= 1
    if i < 0 or not re.search(r"\?\s*$", baris[i]):
        return teks
    m = re.match(r"^(.*[.!])\s+([A-Z][^.!?]*\?)\s*$", baris[i])
    if not m or len(m.group(1).strip()) < 40:
        return teks
    baris[i:i + 1] = [m.group(1).strip(), m.group(2).strip()]
    return "\n".join(baris)


# ── Konteks satu giliran ────────────────────────────────────────────────────────────────────────────────────────
def teks_pesan(m: dict) -> str:
    c = m.get("content")
    if isinstance(c, list):
        return "\n".join(str(p.get("text", "")) for p in c if isinstance(p, dict))
    return str(c or "")


class Giliran:
    """Apa yang dilihat cs-wa di permintaan terakhir giliran ini (dicatat middleware llm_request)."""

    def __init__(self, messages: list[dict]):
        sistem = "\n".join(teks_pesan(m) for m in messages if m.get("role") == "system")
        self.stabil, self.fakta = bagi_sistem(sistem)
        self.aturan = RE_BLOK_FAQ.sub("", self.stabil)
        obrolan = [m for m in messages if m.get("role") in ("user", "assistant") and not m.get("tool_calls") and teks_pesan(m).strip()]
        self.alat = [teks_pesan(m) for m in messages if m.get("role") == "tool"]
        iu = max((i for i, m in enumerate(obrolan) if m["role"] == "user"), default=-1)
        self.pesan_klien = teks_pesan(obrolan[iu]) if iu >= 0 else ""
        self.riwayat = obrolan[:iu] if iu >= 0 else obrolan
        self.obrolan = obrolan[:iu + 1] if iu >= 0 else obrolan
        self.tugas = self.fakta.startswith("TUGAS SISTEM (bukan pesan untuk klien)")
        self.situasi = "SITUASI DARI SISTEM:" in self.fakta
        self.pertama = "KONTAK PERTAMA" in self.fakta
        self.vendor = "VENDOR REKANAN" in self.fakta
        self.jadwal_tersedia = any(re.search(r'bisa_terima_booking\\*"?\s*:\s*true', a) for a in self.alat)
        bebas = "\n".join([self.fakta, *(teks_pesan(m) for m in obrolan), *self.alat])
        self.sumber = self.stabil + "\n" + bebas
        self.khusus_dari = bebas

    def balasan_dulu(self) -> list[str]:
        """6 balasan bot terakhir (bukan admin): janji untuk urusan lain berminggu-minggu lalu bukan pengulangan."""
        b = [isi_klien(teks_pesan(m)) for m in self.riwayat if m["role"] == "assistant" and not re.match(r"^\(admin\)", teks_pesan(m), re.I)]
        return b[-6:]


def periksa(teks: str, g: Giliran, frasa: list[str], robot: list[str]) -> list[tuple[str, str, str]]:
    """Semua masalah balasan sekaligus (dulu Node meminta tulis ulang satu per satu: sampai 6 putaran per pesan)."""
    if g.tugas:
        return []
    isi = isi_klien(teks)
    out = []
    if bocor_pikiran(teks, g.aturan):
        out.append(("bocor", "fatal", "balasan tadi memuat catatan/pikiran internal dan kutipan aturan. Klien TIDAK BOLEH melihat itu. "
                    "Tulis ulang HANYA pesan final yang dikirim ke klien, tanpa analisis, tanpa kutipan aturan"))
    asing = harga_asing(teks, g.sumber, g.stabil, g.khusus_dari)
    if asing:
        out.append(("harga", "fatal", "nominal " + ", ".join(f"Rp {n:,}".replace(",", ".") for n in asing) + " tidak ada di daftar harga, FAQ, maupun chat. "
                    "Tulis ulang HANYA dengan harga resmi; kalau harganya memang tidak ada, bilang admin yang info"))
    if g.situasi:  # pesan situasi/susun: penjaga yang sama dengan kalimatHermes/susunHermes lama
        out += [m for m in masalah_gaya(teks, False, "", frasa, robot) if m[0] in ("klaim_aksi", "frasa_kaku", "kata_robot")]
        return out
    sekarang = normal(isi)
    dulu4 = [isi_klien(teks_pesan(m)) for m in g.riwayat if m["role"] == "assistant"][-4:]  # Node: termasuk pesan admin
    if len(sekarang) > 40 and any(len(d := normal(x)) > 40 and (d in sekarang or sekarang in d) for x in dulu4):
        out.append(("kembar", "gaya", "balasanmu sama dengan pesan yang sudah kamu kirim sebelumnya. Tulis balasan BARU yang menanggapi pesan terakhir klien"))
    out += masalah_gaya(teks, g.pertama, g.pesan_klien, frasa, robot)
    tautan = tautan_asing(teks, g.sumber)
    if tautan:
        out.append(("tautan", "fatal", "link/alamat " + ", ".join(f'"{x}"' for x in tautan) + " tidak ada di info resmi maupun chat. Jangan menulis link atau alamat "
                    "yang tidak tertulis di sana; kalau klien butuh lokasi/alamat yang tidak kamu tahu, bilang admin yang kirim dan tambahkan [INFO_ADMIN: kirim alamat/lokasi]"))
    if not g.jadwal_tersedia and RE_KLAIM_TERSEDIA.search(isi):
        out.append(("klaim_tersedia", "buang", "kamu menyebut tanggal/jadwal masih tersedia/aman, padahal alat cek_ketersediaan tidak dipanggil atau tidak memastikannya di giliran ini. "
                    "Jangan menulis status tanggal sama sekali. Kalau tanggalnya sudah disebut, bilang tanggalnya dicatat dan admin yang konfirmasi jadwalnya, "
                    "lalu tambahkan [INFO_ADMIN: cek jadwal tanggal yang diminta klien]"))
    if RE_JANJI_TEMU.search(isi):
        out.append(("janji_temu", "fatal", "jangan membagikan alamat/lokasi kantor dan jangan menyanggupi atau menjanjikan janji temu, kunjungan, antar/jemput/ambil barang, "
                    "atau waktu tertentu atas nama Tetra. Bilang admin yang mengatur, lalu tambahkan [INFO_ADMIN: <apa yang diminta klien>]"))
    if RE_JANJI_KIRIM.search(isi) and not re.search(r"\[KIRIM:", teks, re.I):
        out.append(("janji_kirim", "gaya", "kamu bilang akan mengirim file/gambar, tapi tidak ada penanda [KIRIM: <kunci>] — tanpa penanda tidak ada yang terkirim. "
                    "Tambahkan penanda yang sesuai di baris paling akhir (backdrop, katalog, sleeve, format, layout, panduan, profil, rekanan, skema, pricelist), "
                    "atau jangan janjikan file kalau tidak ada yang cocok"))
    j = durasi_kurang(teks, g.pesan_klien)
    if j:
        out.append(("durasi_kurang", "fatal", f'klien butuh {j} jam, lebih panjang dari paket 8 jam. Hitung sesuai FAQ "Extend & durasi di atas 8 jam": '
                    "paket 8 jam + Rp 500.000 per jam tambahan, atau tawarkan paket 13 jam Rp 7.500.000 (2R). Jangan menawarkan paket 8 jam saja untuk durasi itu"))
    if RE_JANJI_KABARI.search(isi) and any(RE_JANJI_KABARI.search(b) for b in g.balasan_dulu()):
        out.append(("janji_kabari", "buang", "kamu sudah pernah berjanji akan mengabari di chat ini. Jangan ulang janji itu. Jawab hal yang paling dia tunggu kalau ada di info resmi, "
                    "sebut posisinya (masih di admin/tim) dalam satu kalimat, lalu tambahkan [INFO_ADMIN: klien menunggu kabar soal <topik>]"))
    if RE_MINTA_ULANG.search(isi) and (re.search(r"\[kirim (gambar|dokumen|video)", g.pesan_klien, re.I) or any(RE_MINTA_ULANG.search(b) for b in g.balasan_dulu())):
        out.append(("minta_ulang", "buang", "file/gambar dari klien sudah masuk, atau kamu sudah pernah minta dikirim ulang. Jangan bilang belum masuk dan jangan minta kirim ulang lagi. "
                    "Kalau isinya tidak terbaca, minta merek dan tipenya (atau isi pentingnya) dalam satu kalimat, lalu berhenti"))
    if durasi_dua_jalan(teks, g.pesan_klien):
        out.append(("dua_jalan", "gaya", 'klien butuh 7 jam, yang tidak ada di tabel. Sebut DUA jalan sesuai FAQ "Extend & durasi di atas 8 jam": paket 6 jam + extend 1 jam, '
                    "atau paket 8 jam, masing-masing dengan harga dari tabel FAQ. Jangan menghitung angka lain" if jam_diminta(g.pesan_klien) == 7 else
                    f"klien butuh {jam_diminta(g.pesan_klien)} jam. Sebut DUA jalan sesuai FAQ: paket 8 jam + extend per jam, ATAU paket 13 jam Rp 7.500.000 (format 2R). Jangan menghitung angka lain"))
    return out


def potong(x: str, n: int = 80) -> str:
    return re.sub(r"[\[\]\n]+", " ", str(x))[:n]


def selesaikan(teks: str, g: Giliran, frasa: list[str], robot: list[str]) -> tuple[str, list[str]]:
    """Langkah deterministik sesudah tulis ulang: fatal -> handoff, buang kalimat, tambah penanda admin, rapikan gaya."""
    aksi = []
    if g.tugas:
        return teks, aksi
    sisa = periksa(teks, g, frasa, robot)
    fatal = [m[0] for m in sisa if m[1] == "fatal"]
    if fatal:
        aksi.append("handoff:" + ",".join(fatal))
        return (HANDOFF_VENDOR if g.vendor and fatal == ["harga"] else HANDOFF), aksi
    kode = {m[0] for m in sisa}
    if "kata_robot" in kode:
        teks = buang_kata_robot(teks, robot)
        aksi.append("buang:kata_robot")
    if "klaim_tersedia" in kode:
        teks = buang_kalimat(teks, RE_KLAIM_TERSEDIA)
        aksi.append("buang:klaim_tersedia")
    if "minta_ulang" in kode:
        teks = buang_kalimat(teks, RE_MINTA_ULANG)
        aksi.append("buang:minta_ulang")
    if not g.situasi:
        if "janji_kabari" in kode:
            teks = buang_kalimat(teks, RE_JANJI_KABARI)
            if not re.search(r"\[INFO_ADMIN", teks, re.I):
                teks += f'\n[INFO_ADMIN: klien menunggu kabar soal "{potong(g.pesan_klien)}"]'
            aksi.append("buang:janji_kabari")
        if RE_JANJI_ADMIN.search(isi_klien(teks)) and not RE_PENANDA_ADMIN.search(teks):
            teks += f'\n[INFO_ADMIN: klien menunggu jawaban admin soal "{potong(g.pesan_klien)}"]'
            aksi.append("tambah:janji_admin")
        if RE_AJAK_GRUP.search(g.pesan_klien) and not re.search(r"\[(INFO_ADMIN|ADMIN_HANDOFF|SULIT)", teks, re.I):
            teks += f'\n[INFO_ADMIN: klien mengajak tim Tetra ke grup WA / pertemuan: "{potong(g.pesan_klien, 100)}"]'
            aksi.append("tambah:ajak_grup")
    teks = re.sub(r"^\(admin\)\s*", "", teks, flags=re.I)  # jangan pernah menyamar jadi pesan admin di riwayat
    teks = pisah_pertanyaan(rapikan_gaya(teks, 0))
    return teks, aksi


def koreksi(masalah: list[tuple[str, str, str]]) -> str:
    return ("KOREKSI SISTEM: perbaiki balasan tadi — " + "; ".join(m[2] for m in masalah) +
            ". Isi, maksud, dan penanda [..] yang memang perlu tetap sama. Tulis HANYA pesan final untuk klien.")


def pesan_tulis_ulang(messages: list[dict], draf: str, masalah: list[tuple[str, str, str]]) -> list[dict]:
    """Permintaan tulis ulang: konteks yang sama dengan cs-wa (prompt + chat), tanpa alat; hasil alat giliran ini ditempel
    di pesan koreksi supaya urutan peran tetap user/assistant bergantian."""
    g = Giliran(messages)
    sistem = [{"role": "system", "content": "\n".join(teks_pesan(m) for m in messages if m.get("role") == "system")}]
    alat = ("HASIL ALAT DI GILIRAN INI:\n" + "\n".join(a[:1500] for a in g.alat) + "\n\n") if g.alat else ""
    return sistem + [{"role": m["role"], "content": teks_pesan(m)} for m in g.obrolan] + [
        {"role": "assistant", "content": draf}, {"role": "user", "content": alat + koreksi(masalah)}]
