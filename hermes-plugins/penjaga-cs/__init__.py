"""penjaga-cs: penjaga balasan WhatsApp agent cs-wa (Tahap 3, Rama 18 Nov 2026: "bener-bener native semua dihandle oleh hermes").

Dulu penjaga ini kode Node (~/tetra-wa-bot/src/lib/ai.js): deteksi -> minta cs-wa tulis ulang -> oper admin. Sekarang di Hermes:
- middleware `llm_request` (pengamat, tidak mengubah permintaan) mencatat permintaan terakhir tiap sesi: prompt stabil (SOUL +
  skill), fakta dari bot WA, chat, dan hasil alat. Itu sumber yang persis dilihat cs-wa (penjaga harga/link membacanya).
- `transform_llm_output` A (periksa_dan_perbaiki): semua masalah sekaligus -> tulis ulang lewat ctx.llm (maks 2 putaran, dalam
  batas waktu) -> buang kalimat / tambah penanda admin / rapikan gaya; masalah fatal yang tersisa -> [ADMIN_HANDOFF].
- `transform_llm_output` B (jaring_cepat): kalau A tidak selesai (lewat plugins.hook_callback_timeout atau galat), balasan
  bermasalah fatal tetap tidak terkirim. Hasil pertama yang berupa teks menang; A terdaftar lebih dulu.
Kejadian dicatat di <plugin-data>/penjaga-cs/kejadian.jsonl (dibaca bahan belajar CS Mintet); status.json = tanda hidup
(jumlah balasan diperiksa, waktu terakhir).
Pembagian sumber: kode ini di repo bot (~/tetra-wa-bot/hermes-plugins/penjaga-cs), profil cs-wa memuatnya lewat symlink.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

from . import penjaga as P

log = logging.getLogger("penjaga-cs")
FRASA_FILE = Path(__file__).resolve().parents[2] / "docs" / "FRASA-KAKU.md"
BATAS_DTK = 75     # tulis ulang hanya kalau giliran belum selama ini (bot Node menunggu satu run maks 150 dtk)
TIMEOUT_LLM = 40
_catatan: dict = {}
_kunci = threading.Lock()
_frasa = {"mtime": None, "isi": ([], [])}
_llm = None


def _baca_frasa():
    """Dibaca ulang kalau file berubah: Rama menandai frasa baru = tambah satu baris, langsung berlaku."""
    try:
        mt = FRASA_FILE.stat().st_mtime
        if mt != _frasa["mtime"]:
            _frasa["isi"] = P.baca_frasa(FRASA_FILE.read_text(encoding="utf-8"))
            _frasa["mtime"] = mt
    except OSError as e:
        log.warning("penjaga-cs: %s tidak terbaca (%s); frasa kaku tidak dicek", FRASA_FILE, e)
    return _frasa["isi"]


def _status(bermasalah: bool) -> None:
    """Tanda hidup: kapan terakhir balasan diperiksa (balasan bersih tidak meninggalkan jejak lain)."""
    try:
        from plugins.plugin_storage import plugin_data_dir
        f = plugin_data_dir("penjaga-cs") / "status.json"
        with _kunci:
            st = json.loads(f.read_text()) if f.exists() else {"diperiksa": 0, "bermasalah": 0}
            st["diperiksa"] += 1
            st["bermasalah"] += int(bermasalah)
            st["terakhir"] = int(time.time() * 1000)
            f.write_text(json.dumps(st))
    except Exception as e:
        log.warning("penjaga-cs: status tidak tercatat: %s", e)


def _kejadian(rec: dict) -> None:
    try:
        from plugins.plugin_storage import plugin_data_dir
        with open(plugin_data_dir("penjaga-cs") / "kejadian.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": int(time.time() * 1000), **rec}, ensure_ascii=False) + "\n")
    except Exception as e:  # catatan gagal tidak boleh menahan balasan
        log.warning("penjaga-cs: kejadian tidak tercatat: %s", e)


def _catat(request=None, session_id="", turn_id=None, **_):
    msgs = request.get("messages") if isinstance(request, dict) else None
    if session_id and isinstance(msgs, list):
        with _kunci:
            lama = _catatan.get(session_id)
            mulai = lama["mulai"] if lama and lama["turn"] == turn_id else time.time()
            _catatan[session_id] = {"msgs": msgs, "turn": turn_id, "mulai": mulai}
            while len(_catatan) > 300:
                _catatan.pop(next(iter(_catatan)))
    return None


def periksa_dan_perbaiki(response_text="", session_id="", **_):
    c = _catatan.get(session_id)
    if not c or not response_text:
        if response_text and session_id:
            log.warning("penjaga-cs: tidak ada catatan permintaan untuk sesi %s, balasan tidak diperiksa", session_id)
        return None
    g = P.Giliran(c["msgs"])
    if g.tugas:
        c["selesai"] = True
        return None
    frasa, robot = _baca_frasa()
    teks, jejak = response_text, []
    masalah = P.periksa(teks, g, frasa, robot)
    while masalah and len(jejak) < 2 and time.time() - c["mulai"] < BATAS_DTK and _llm is not None:
        jejak.append([m[0] for m in masalah])
        try:
            baru = (_llm.complete(messages=P.pesan_tulis_ulang(c["msgs"], teks, masalah), timeout=TIMEOUT_LLM,
                                  purpose="penjaga-cs: tulis ulang balasan cs-wa").text or "").strip()
        except Exception as e:
            log.warning("penjaga-cs: tulis ulang gagal (%s)", e)
            break
        if not baru:
            break
        m2 = P.periksa(baru, g, frasa, robot)
        if any(m[1] == "fatal" for m in m2) and not any(m[1] == "fatal" for m in masalah):
            break  # tulis ulang malah memunculkan masalah fatal: draf sebelumnya yang dipakai
        teks, masalah = baru, m2
    akhir, aksi = P.selesaikan(teks, g, frasa, robot)
    c["selesai"] = True
    _status(bool(jejak or aksi))
    if jejak or aksi:
        log.info("penjaga-cs %s: masalah %s, aksi %s", session_id, jejak, aksi)
        _kejadian({"sesi": session_id, "masalah": jejak, "aksi": aksi, "situasi": g.situasi,
                   "awal": response_text[:400], "akhir": akhir[:400]})
    return akhir if akhir != response_text else None


def jaring_cepat(response_text="", session_id="", **_):
    with _kunci:
        c = _catatan.pop(session_id, None)
    if not c or not response_text or c.get("selesai"):
        return None
    g = P.Giliran(c["msgs"])
    if g.tugas:
        return None
    fatal = [m[0] for m in P.periksa(response_text, g, *_baca_frasa()) if m[1] == "fatal"]
    if not fatal:
        return None
    log.warning("penjaga-cs jaring cepat %s: %s (pemeriksa utama tidak selesai)", session_id, fatal)
    _kejadian({"sesi": session_id, "masalah": [fatal], "aksi": ["jaring:handoff"], "awal": response_text[:400]})
    return P.HANDOFF_VENDOR if g.vendor and fatal == ["harga"] else P.HANDOFF


def register(ctx) -> None:
    global _llm
    _llm = getattr(ctx, "llm", None)  # tanpa ctx.llm (mis. probe validator): tetap periksa, tanpa tulis ulang
    ctx.register_middleware("llm_request", _catat)
    ctx.register_hook("transform_llm_output", periksa_dan_perbaiki)
    ctx.register_hook("transform_llm_output", jaring_cepat)
