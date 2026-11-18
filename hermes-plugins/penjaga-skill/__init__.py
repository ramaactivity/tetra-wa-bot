"""penjaga-skill: saringan isi skill cs-mintet-pelajaran sebelum ditulis (profil tetra-wa-bot = penulisnya).

Rekomendasi Hermes (kartu konsultasi t_e35d4cc7, 18 Nov 2026): hook `pre_tool_call` plugin Python, fail-closed (callback error/timeout =
alat diblok, hooks.md "pre_tool_call"), dipanggil untuk setiap pemanggilan alat di semua jenis proses termasuk worker cron. Bukan
shell hook (tidak terdaftar di worker cron), bukan skills.write_approval (mematikan izin tumbuh sendiri CS Mintet), bukan guard bawaan
(tanpa aturan rupiah/rekening/kutipan), bukan sisi pembaca (racun tetap tertinggal di file). Menjaga semua jalur tulis: skill_manage
(bentuk operations[] dan datar), write_file/patch ke folder skill, dan perintah terminal yang menulis ke folder itu.
Aturan & asal-usulnya: saring.py. Kejadian: <plugin-data>/penjaga-skill/kejadian.jsonl.
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
SKILL = "cs-mintet-pelajaran"
BOT = Path(__file__).resolve().parents[2]
FAQ_FILE = BOT / "hermes-skills" / "faq-tetra" / "SKILL.md"
RIWAYAT = BOT / "data" / "riwayat.json"              # pesan "(admin)" asli
ALLOWLIST = BOT / "data" / "kutipan-admin-ok.json"   # kutipan admin yang pernah lolos (file sama dengan pemuat Node lama)
DIR_CADANGAN = Path.home() / ".hermes" / "cs-skills" / SKILL
# Perintah terminal yang menyebut folder skill dan bisa menulis: alihkan keluaran KE skill (bukan "2>/dev/null"), tee ke skill, sed -i,
# atau alat pengubah/penjalan skrip (konservatif: membaca cukup lewat read_file/cat/grep tanpa itu).
RE_TULIS = re.compile(r"(?<![0-9&])>>?\s*[\"']?[^\s;|&]*" + SKILL + r"|\btee\b[^;|&]*" + SKILL +
                      r"|\bsed\s+(-\w+\s+)*-i\b|\b(mv|cp|rm|ln|install|truncate|dd|python3?|perl|node)\b", re.I)


def _dir_skill() -> Path:
    try:
        from hermes_constants import get_hermes_home
        p = Path(get_hermes_home()) / "skills" / SKILL
        if p.exists():
            return p.resolve()
    except Exception:  # di luar Hermes (uji)
        pass
    return DIR_CADANGAN.resolve() if DIR_CADANGAN.exists() else DIR_CADANGAN


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


def _di_skill(path: str, dir_skill: Path) -> bool:
    if not path:
        return False
    try:
        return Path(os.path.expanduser(path)).resolve().is_relative_to(dir_skill) or SKILL in str(path)
    except (OSError, ValueError):
        return SKILL in str(path)


def tulisan(tool_name: str, args: dict, dir_skill: Path) -> list[tuple[str, str, bool]] | str | None:
    """(teks baru, teks lama, hanya_tandai) yang akan masuk ke skill; str = alasan blok langsung; None = bukan urusan penjaga.
    hanya_tandai: file references/ (contoh percakapan asli; tidak dibaca cs-wa) cukup dicatat, tidak diblok (Hermes t_e35d4cc7)."""
    if tool_name == "skill_manage":
        ops = args.get("operations")
        ops = ops if isinstance(ops, list) else [args]
        out = []
        for op in ops:
            if not isinstance(op, dict) or (op.get("name") or args.get("name")) != SKILL:
                continue
            aksi = op.get("action") or args.get("action")
            if aksi in ("delete", "remove_file"):
                return f"{aksi} pada skill {SKILL} tidak diizinkan otomatis (minta Rama)"
            fp = op.get("file_path") or "SKILL.md"
            lama, tandai = _baca(dir_skill / fp), fp.startswith("references/")
            if op.get("new_string") is not None:
                out.append((op["new_string"], (op.get("old_string") or "") + "\n" + lama, tandai))
            for k in ("content", "file_content"):
                if op.get(k) is not None:
                    out.append((op[k], lama, tandai))
        return out or None
    if tool_name == "write_file" and _di_skill(args.get("path", ""), dir_skill):
        return [(args.get("content") or "", _baca(Path(os.path.expanduser(args.get("path", "")))), "/references/" in args.get("path", ""))]
    if tool_name == "patch":
        if _di_skill(args.get("path", ""), dir_skill):
            return [(args.get("new_string") or "", (args.get("old_string") or "") + "\n" + _baca(Path(os.path.expanduser(args["path"]))),
                     "/references/" in args["path"])]
        v4a = str(args.get("patch") or "")
        if SKILL in v4a or str(dir_skill) in v4a:
            return [("\n".join(b[1:] for b in v4a.splitlines() if b.startswith("+")), "", False)]
        return None
    if tool_name == "terminal":
        cmd = str(args.get("command") or "")
        if (SKILL in cmd or str(dir_skill) in cmd) and RE_TULIS.search(cmd):
            return f"menulis ke folder skill {SKILL} lewat terminal tidak diizinkan; pakai skill_manage (isinya diperiksa penjaga)"
    return None


def cek(tool_name="", args=None, task_id="", **_):
    if tool_name not in ("skill_manage", "write_file", "patch", "terminal"):
        return None
    dir_skill = _dir_skill()
    t = tulisan(tool_name, args or {}, dir_skill)
    if t is None:
        return None
    if isinstance(t, str):
        _kejadian({"alat": tool_name, "blok": t, "sesi": task_id})
        log.warning("penjaga-skill: blok %s: %s", tool_name, t)
        return {"action": "block", "message": f"penjaga-skill: {t}."}
    faq_teks = _baca(FAQ_FILE)
    faq = S.angka_faq(faq_teks)
    kutipan = S.Kutipan(RIWAYAT, ALLOWLIST)
    catat = [x for baru, lama, tandai in t if tandai for x in S.periksa(baru, lama, faq, kutipan, faq_teks)]
    if catat:
        _kejadian({"alat": tool_name, "sesi": task_id, "tandai": [[b.strip()[:200], m] for b, m in catat]})
    masalah = [x for baru, lama, tandai in t if not tandai for x in S.periksa(baru, lama, faq, kutipan, faq_teks)]
    if not masalah:
        return None
    rinci = "; ".join(f'"{b.strip()[:90]}" ({", ".join(m)})' for b, m in masalah[:5])
    _kejadian({"alat": tool_name, "sesi": task_id, "masalah": [[b.strip()[:200], m] for b, m in masalah]})
    log.warning("penjaga-skill: blok %s, %d baris: %s", tool_name, len(masalah), rinci[:300])
    return {"action": "block", "message": (
        f"penjaga-skill: tulisan ke {SKILL} ditolak, {len(masalah)} baris bermasalah: {rinci}. Harga cukup merujuk faq-tetra (nominal hanya "
        "kalau persis ada di FAQ); tanpa persen, rekening/nomor, link, atau kalimat yang memberi diskon/gratis; kutipan admin harus persis dari "
        "pesan admin asli. Tulis ulang barisnya, atau kalau memang perlu jadikan usulan untuk Rama di cs-mintet-usulan.md.")}


def register(ctx) -> None:
    ctx.register_hook("pre_tool_call", cek)
