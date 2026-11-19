"""penjaga-skill: saringan isi skill yang dibaca cs-wa sebelum ditulis (profil tetra-wa-bot = penulisnya).

Rekomendasi Hermes (kartu konsultasi t_e35d4cc7, 18 Nov 2026): hook `pre_tool_call` plugin Python, fail-closed (callback error/timeout =
alat diblok, hooks.md "pre_tool_call"), dipanggil untuk setiap pemanggilan alat di semua jenis proses termasuk worker cron. Bukan
shell hook (tidak terdaftar di worker cron), bukan skills.write_approval (mematikan izin tumbuh sendiri CS Mintet), bukan guard bawaan
(tanpa aturan rupiah/rekening/kutipan), bukan sisi pembaca (racun tetap tertinggal di file). Kejadian: <plugin-data>/penjaga-skill/kejadian.jsonl.

Sasaran & kebijakan (kartu t_2642f0a1, B1 butir 3):
- `cs-mintet-pelajaran`  → disaring penuh (aturan saring.py) + delete/remove_file ditolak; references/ cukup ditandai.
- `faq-tetra` + `docs/FAQ-KLIEN.md` (buku resmi yang dibaca cs-wa) → DIBLOK kecuali teks baris baru tertulis di usulan berstatus
  disetujui/diterapkan di cs-mintet-usulan.md, dan aturan lama tidak dihapus diam-diam (SOUL: FAQ hanya boleh diubah atas
  persetujuan Rama). Tidak lewat saringan angka: FAQ memang tempatnya harga.
- `form-booking`, `cara-balas-wa`, `tugas-sistem-cs`, `mode-kontak-khusus`, `strategi-cs` → disaring angka/link/kutipan yang sama
  (kalimat & aturan bebas ditulis; ini yang membuat saya bisa memperbaiki kalimat tanpa menunggu Rama).
Jalur tulis yang dijaga: skill_manage, write_file, patch (termasuk V4A), dan terminal. Terminal kini DAFTAR-PUTIH baca-saja: perintah
yang menyebut skill/folder skill hanya lolos kalau semua segmennya cat/grep/rg/head/tail/wc/ls/stat/file/diff/realpath/readlink/
sha256sum/md5sum tanpa `>`, `tee`, `-i`, `-delete`, `-exec`, `--output` (daftar-hitam selalu ketinggalan: awk -i inplace, git
checkout --, rsync, python -c). `execute_code`/`browser_exec` yang menyebut skill diblok: dua-duanya menjalankan Python di mesin ini,
dan kode yang sah untuk membaca skill cukup `read_file`.
Kode di repo bot (~/tetra-wa-bot/hermes-plugins/penjaga-skill), profil tetra-wa-bot memuatnya lewat symlink.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path

from . import saring as S

log = logging.getLogger("penjaga-skill")
BOT = Path(__file__).resolve().parents[2]
HERMES_SKILLS = BOT / "hermes-skills"                 # dibaca cs-wa (skills.external_dirs)
CS_SKILLS = Path.home() / ".hermes" / "cs-skills"     # dibaca cs-wa (cs-mintet-pelajaran)
FAQ_FILE = HERMES_SKILLS / "faq-tetra" / "SKILL.md"
FAQ_DOK = BOT / "docs" / "FAQ-KLIEN.md"               # sumber manusia; isinya = skill faq-tetra
USULAN = Path.home() / ".hermes" / "profiles" / "tetra-wa-bot" / "cs-mintet-usulan.md"
RIWAYAT = BOT / "data" / "riwayat.json"               # pesan "(admin)" asli
ALLOWLIST = BOT / "data" / "kutipan-admin-ok.json"    # kutipan admin yang pernah lolos (file sama dengan pemuat Node lama)
DIR_CADANGAN = CS_SKILLS / "cs-mintet-pelajaran"

POLOS, PENUH, SETUJU = "saring", "penuh", "setuju"
SASARAN = {
    "cs-mintet-pelajaran": PENUH,
    "faq-tetra": SETUJU,
    "form-booking": POLOS,
    "cara-balas-wa": POLOS,
    "tugas-sistem-cs": POLOS,
    "mode-kontak-khusus": POLOS,
    "strategi-cs": POLOS,
}
AKAR = (HERMES_SKILLS, CS_SKILLS, Path.home() / ".hermes" / "skills", Path.home() / ".hermes" / "profiles" / "tetra-wa-bot" / "skills")
SEBUT = tuple(SASARAN) + ("hermes-skills", "cs-skills", "FAQ-KLIEN")
# Baca-saja: perintah pertama tiap segmen harus salah satu ini, dan tidak boleh ada penanda tulis di mana pun.
BACA = {"cat", "grep", "rg", "head", "tail", "wc", "ls", "stat", "file", "diff", "realpath", "readlink", "sha256sum", "md5sum"}
RE_TULIS = re.compile(r"\btee\b|(?<![0-9&])>>?|--in-place|\s-delete\b|\s-exec\b|--output\b")
RE_PECAH = re.compile(r"\s*(?:;|&&|\|\||\||\n)\s*")


def _dir_skill(nama: str = "cs-mintet-pelajaran") -> Path:
    for akar in AKAR:
        p = akar / nama
        if p.exists():
            return p.resolve()
    return DIR_CADANGAN.resolve() if DIR_CADANGAN.exists() else (CS_SKILLS / nama)


def _nama_path(path: str) -> str | None:
    """Nama sasaran yang disentuh sebuah path (lewat folder hermes-skills / cs-skills / FAQ-KLIEN.md), None kalau bukan sasaran."""
    teks = str(path or "")
    if not teks:
        return None
    try:
        rp = Path(os.path.expanduser(teks)).resolve()
    except (OSError, ValueError):
        rp = Path(os.path.expanduser(teks))
    for akar in (HERMES_SKILLS, CS_SKILLS):
        try:
            rel = rp.relative_to(akar.resolve())
        except (ValueError, OSError):
            continue
        if rel.parts and rel.parts[0] in SASARAN:
            return rel.parts[0]
    try:
        if rp == FAQ_DOK.resolve():
            return "faq-tetra"
    except OSError:
        pass
    if "skill" in teks.lower():  # symlink/relatif yang tidak bisa di-resolve: cukup namanya, asal jelas folder skill
        for nama in SASARAN:
            if nama in teks:
                return nama
    return None


def _sebut_sasaran(teks: str) -> bool:
    return any(s in teks for s in SEBUT)


def _kejadian(rec: dict) -> None:
    try:
        from plugins.plugin_storage import plugin_data_dir
        with open(plugin_data_dir("penjaga-skill") / "kejadian.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": int(time.time() * 1000), **rec}, ensure_ascii=False) + "\n")
    except Exception as e:
        log.warning("penjaga-skill: kejadian tidak tercatat: %s", e)


def _baca(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except OSError:
        return ""


def baca_saja(cmd: str) -> bool:
    """Daftar-putih perintah terminal: semua segmen diawali perintah baca, tanpa penanda penulis. `2>/dev/null` bukan penulisan."""
    c = re.sub(r"\d?>>?\s*/dev/null", " ", str(cmd))
    if RE_TULIS.search(c):
        return False
    for seg in RE_PECAH.split(c):
        kata = seg.split()
        while kata and "=" in kata[0] and "/" not in kata[0] and not kata[0].startswith("-"):
            kata.pop(0)  # awalan VARIABEL=nilai
        if kata and os.path.basename(kata[0]) not in BACA:
            return False
    return True


def tulisan(tool_name: str, args: dict) -> list[tuple[str, str, str, bool, bool]] | str | None:
    """Sasaran yang ditulis: [(nama, teks_baru, teks_lama, hanya_tandai, baru_adalah_isi_penuh)]; str = alasan blok langsung;
    None = bukan urusan penjaga. hanya_tandai: file references/ (contoh percakapan asli; tidak dibaca cs-wa) cukup dicatat."""
    if tool_name == "skill_manage":
        ops = args.get("operations")
        ops = ops if isinstance(ops, list) else [args]
        out = []
        for op in ops:
            if not isinstance(op, dict):
                continue
            nama = op.get("name") or args.get("name")
            if nama not in SASARAN:
                continue
            aksi = op.get("action") or args.get("action")
            if aksi in ("delete", "remove_file"):
                return f"{aksi} pada skill {nama} tidak diizinkan otomatis (minta Rama)"
            fp = op.get("file_path") or "SKILL.md"
            lama = _baca(_dir_skill(nama) / fp)
            tandai = str(fp).startswith("references/")
            for k in ("content", "file_content"):
                if op.get(k) is not None:
                    out.append((nama, op[k], lama, tandai, True))
            if op.get("new_string") is not None:
                old, baru = op.get("old_string") or "", op["new_string"]
                if old and old in lama:  # rekonstruksi isi baru supaya penghapusan ikut terlihat
                    out.append((nama, lama.replace(old, baru, 1), lama, tandai, True))
                else:
                    out.append((nama, baru, (old + "\n" + lama) if old else lama, tandai, False))
        return out or None
    if tool_name == "write_file":
        nama = _nama_path(args.get("path", ""))
        if nama:
            return [(nama, args.get("content") or "", _baca(Path(os.path.expanduser(args.get("path", "")))),
                     "/references/" in str(args.get("path", "")), True)]
        return None
    if tool_name == "patch":
        nama = _nama_path(args.get("path", ""))
        if nama:
            lama = _baca(Path(os.path.expanduser(str(args.get("path")))))
            old, baru = args.get("old_string") or "", args.get("new_string") or ""
            penuh = bool(old) and old in lama
            return [(nama, lama.replace(old, baru, 1) if penuh else baru, lama, "/references/" in str(args.get("path")), penuh)]
        v4a = str(args.get("patch") or "")
        for nama in SASARAN:
            if nama in v4a or str(_dir_skill(nama)) in v4a:
                return [(nama, "\n".join(b[1:] for b in v4a.splitlines() if b.startswith("+")), "", False, False)]
        return None
    if tool_name == "terminal":
        cmd = str(args.get("command") or "")
        if _sebut_sasaran(cmd) and not baca_saja(cmd):
            return ("perintah terminal yang menyebut skill/folder skill hanya boleh membaca (cat, grep, rg, head, tail, wc, ls, stat, "
                    "file, diff, realpath, readlink, sha256sum, md5sum) tanpa `>`, `tee`, `-i`, `-delete`, `-exec`, `--output`; "
                    "untuk menulis pakai skill_manage/write_file/patch (isinya diperiksa penjaga)")
        return None
    if tool_name in ("execute_code", "browser_exec"):
        kode = str(args.get("code") or "")
        if _sebut_sasaran(kode):
            return (f"kode {tool_name} yang menyebut skill/folder skill tidak dijalankan; membaca skill pakai read_file, menulis pakai "
                    "skill_manage/write_file/patch (isinya diperiksa penjaga)")
        return None
    return None


def cek(tool_name="", args=None, task_id="", **_):
    if tool_name not in ("skill_manage", "write_file", "patch", "terminal", "execute_code", "browser_exec"):
        return None
    t = tulisan(tool_name, args or {})
    if t is None:
        return None
    if isinstance(t, str):
        _kejadian({"alat": tool_name, "blok": t, "sesi": task_id})
        log.warning("penjaga-skill: blok %s: %s", tool_name, t)
        return {"action": "block", "message": f"penjaga-skill: {t}."}
    faq_teks = _baca(FAQ_FILE)
    faq = S.angka_faq(faq_teks)
    kutipan = S.Kutipan(RIWAYAT, ALLOWLIST)
    setuju = None
    catat, masalah = [], []
    for nama, baru, lama, tandai, penuh in t:
        if SASARAN.get(nama) == SETUJU:
            if setuju is None:
                setuju = S.usulan_disetujui(_baca(USULAN))
            hasil = S.masalah_setuju(baru, lama, setuju, penuh)
        else:
            hasil = S.periksa(baru, lama, faq, kutipan, faq_teks)
        (catat if tandai else masalah).extend((nama, b, m) for b, m in hasil)
    if catat:
        _kejadian({"alat": tool_name, "sesi": task_id, "tandai": [[f"[{n}] {b.strip()[:200]}", m] for n, b, m in catat]})
    if not masalah:
        return None
    rinci = "; ".join(f'[{n}] "{b.strip()[:90]}" ({", ".join(m)})' for n, b, m in masalah[:5])
    _kejadian({"alat": tool_name, "sesi": task_id, "masalah": [[f"[{n}] {b.strip()[:200]}", m] for n, b, m in masalah]})
    log.warning("penjaga-skill: blok %s, %d baris: %s", tool_name, len(masalah), rinci[:300])
    sasaran = ", ".join(sorted({n for n, _, _ in masalah}))
    return {"action": "block", "message": (
        f"penjaga-skill: tulisan ke {sasaran} ditolak, {len(masalah)} baris bermasalah: {rinci}. Harga cukup merujuk faq-tetra "
        "(nominal hanya kalau persis ada di FAQ); tanpa persen, rekening/nomor, link, atau kalimat yang memberi diskon/gratis; "
        "kutipan admin harus persis dari pesan admin asli. `faq-tetra`/`docs/FAQ-KLIEN.md` hanya boleh diubah dengan teks yang "
        "tertulis di usulan berstatus disetujui/diterapkan (cs-mintet-usulan.md) dan tanpa menghapus aturan lama — untuk mengubah "
        "FAQ, tulis dulu kalimat persisnya (versi Rama) di entri usulan yang disetujui, baru tempel ke FAQ. Tulis ulang "
        "barisnya, atau jadikan usulan untuk Rama.")}


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", cek)