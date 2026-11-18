"""Saringan isi skill cs-mintet-pelajaran: fungsi murni, regex tanpa LLM (diuji di uji_saring.py).

Rekomendasi Hermes (kartu konsultasi t_e35d4cc7, 18 Nov 2026): sejak otak WA pindah ke Hermes (16 Nov), cs-wa memuat skill ini UTUH
lewat skills.auto_load, sedangkan saringan pemuat Node lama (ai.js pelajaran()/RE_PELAJARAN_BAHAYA/faktaBahaya/kutipanSah, git
2fec1e8) ikut hilang. Bahan belajar CS Mintet memuat chat klien, jadi pelajaran bisa tersusupi atau salah fakta. Aturan lama dipakai
lagi dengan koreksi Hermes: nominal yang ADA di FAQ boleh (contoh anti-pola memakai harga resmi), dan kata rekening/gratis di kalimat
LARANGAN bukan bahaya ("rekening/pembayaran tidak diulang", "sponsorship booth gratis ditolak").
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

RE_ANGKA = re.compile(r"(rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)?(?![\w])", re.I)


def angka_rupiah(teks: str) -> list[int]:
    """Sama dengan penjaga-cs/penjaga.py (salinan; dua plugin tidak saling impor)."""
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


RE_LARANGAN = re.compile(r"\b(jangan|tidak|tak|bukan|dilarang|belum|tanpa|ditolak|tolak)\b", re.I)
ATURAN = [
    ("link", re.compile(r"\bhttps?:|\bwww\.|wa\.me", re.I)),
    ("nomor panjang (rekening/HP)", re.compile(r"\d{6,}|\b0\d{2,4}[- ]\d{3,4}[- ]\d{3,5}\b")),
    ("upaya mengubah aturan", re.compile(r"abaikan|ignore|lupakan|system prompt|aturan di atas", re.I)),
]
# Hanya bahaya kalau BUKAN kalimat larangan (koreksi Hermes atas regex lama; bagian "Cara merawat" sendiri berbunyi "DILARANG harga,
# nominal, persen, diskon, promo, rekening, link…").
RE_NOMINAL_HURUF = re.compile(r"\b(?:se|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(?:ratus|puluh|belas)?\s*(?:ribu|juta)\b", re.I)
RE_PERSEN = re.compile(r"\d+\s*%|\bpersen\b", re.I)
RE_REKENING = re.compile(r"rekening|\brek\b|\b(bca|bni|bri|mandiri)\b", re.I)
RE_KERINGANAN = re.compile(r"\b(kasih|beri(kan)?|boleh|langsung|tawarkan)\s+(saja\s+)?(diskon|potongan|gratis|promo|free)\b", re.I)
RE_FAKTA = re.compile(r'^\s*-\s*(.+?)\s*\(admin:\s*"([^"]+)"\)\s*$')
RE_FAKTA_KERINGANAN = re.compile(r"\b(diskon|potongan|gratis|free|promo)\b", re.I)


def normal(t: str) -> str:
    return re.sub(r"\s+", " ", str(t).lower()).strip()


class Kutipan:
    """Fakta dari admin hanya sah kalau kutipannya ada di pesan yang benar-benar dikirim admin ("(admin)" di riwayat bot). Yang lolos
    disimpan di allowlist (riwayat cuma 90 hari; allowlist menjaga fakta lama) — file sama dengan pemuat Node lama."""

    def __init__(self, riwayat: Path, allowlist: Path):
        self.riwayat, self.allowlist, self._admin = riwayat, allowlist, None

    def _teks_admin(self) -> str:
        if self._admin is None:
            t = []
            try:
                for e in json.loads(self.riwayat.read_text(encoding="utf-8")).values():
                    t += [normal(p["content"][7:]) for p in e.get("pesan", []) if p.get("role") == "assistant" and str(p.get("content", "")).startswith("(admin)")]
            except (OSError, ValueError):
                pass
            self._admin = "\n".join(t)
        return self._admin

    def sah(self, kutip: str) -> bool:
        k = normal(kutip)
        if len(k) < 12:
            return False
        try:
            ok = json.loads(self.allowlist.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            ok = []
        if k in ok:
            return True
        if k not in self._teks_admin():
            return False
        try:
            self.allowlist.write_text(json.dumps((ok + [k])[-500:], ensure_ascii=False))
        except OSError:
            pass
        return True


def angka_faq(teks_faq: str) -> set[int]:
    return set(angka_rupiah(teks_faq))


def masalah_baris(baris: str, faq: set[int], kutipan: Kutipan | None) -> list[str]:
    t = str(baris)
    out = [f"nominal Rp {n:,} tidak ada di FAQ".replace(",", ".") for n in angka_rupiah(t) if n not in faq]
    out += [nama for nama, rx in ATURAN if rx.search(t)]
    for rx, nama in ((RE_NOMINAL_HURUF, "nominal ditulis huruf"), (RE_PERSEN, "persen"), (RE_REKENING, "rekening/bank"),
                     (RE_KERINGANAN, "memberi keringanan")):
        m = rx.search(t)
        if m and not RE_LARANGAN.search(t[:m.start()]) and not RE_LARANGAN.search(t[m.end():m.end() + 25]):
            out.append(nama)
    f = RE_FAKTA.match(t)
    if f:
        if kutipan is not None and not kutipan.sah(f.group(2)):
            out.append("kutipan admin tidak ditemukan di pesan admin asli")
        if RE_FAKTA_KERINGANAN.search(f.group(1)) and re.search(r"\b(boleh|bisa|dikasih|diberi(kan)?|dapat|berlaku|ada)\b", f.group(1), re.I) \
                and not RE_LARANGAN.search(f.group(1)):
            out.append("fakta memberi keringanan")
    return out


def baris_baru(baru: str, lama: str = "") -> list[str]:
    """Baris yang ditambahkan/diubah (baris yang sudah ada di versi lama tidak dinilai ulang)."""
    ada = {b.strip() for b in str(lama).splitlines()}
    return [b for b in str(baru).splitlines() if b.strip() and b.strip() not in ada and b.strip() != "---"]


def periksa(baru: str, lama: str, faq: set[int], kutipan: Kutipan | None) -> list[tuple[str, list[str]]]:
    return [(b, m) for b in baris_baru(baru, lama) if (m := masalah_baris(b, faq, kutipan))]
