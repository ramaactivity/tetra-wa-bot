"""Uji penjaga-cs tanpa AI: python3 uji_penjaga.py (dari mana saja). Kasus GAGAL ASLI pindahan uji-regresi.js Node
(audit 22 Okt, 27 Okt, Nov 2026) + alur plugin (tulis ulang, jaring cepat). Gagal = perbaiki akarnya, jangan longgarkan uji."""
import importlib
import sys
from pathlib import Path

DIR = Path(__file__).resolve().parent
BOT = DIR.parents[1]
sys.path.insert(0, str(DIR.parent))
plugin = importlib.import_module(DIR.name)
P = importlib.import_module(DIR.name + ".penjaga")

FRASA, ROBOT = P.baca_frasa((BOT / "docs" / "FRASA-KAKU.md").read_text(encoding="utf-8"))
SKILL = BOT / "hermes-skills"


def blok(nama):
    return (SKILL / nama / "SKILL.md").read_text(encoding="utf-8") + f"\n\n[Skill directory: {SKILL / nama}]\n\n"


STABIL = ((BOT / "docs" / "PERSONA-CS.md").read_text(encoding="utf-8") + "\n\n" +
          "".join(blok(n) for n in ("faq-tetra", "cara-balas-wa", "strategi-cs", "mode-kontak-khusus")) + P.PENANDA_PROMPT)
WAKTU = "WAKTU SEKARANG: Rabu, 18 November 2026, pukul 19.00 WIB."


def giliran(pesan, fakta="KONTEKS LEAD (dari deteksi & riwayat):\nTAHAP PERCAKAPAN: REKOMENDASI.", riwayat=(), alat=None):
    msgs = [{"role": "system", "content": STABIL + "\n\n" + WAKTU + "\n\n" + fakta}]
    msgs += [{"role": r, "content": c} for r, c in riwayat]
    msgs.append({"role": "user", "content": pesan})
    if alat:
        msgs += [{"role": "assistant", "content": "", "tool_calls": [{"id": "1", "function": {"name": "mcp_tetra_ops_cek_ketersediaan"}}]},
                 {"role": "tool", "tool_call_id": "1", "content": alat}]
    return msgs


hasil = []


def kasus(nama):
    def bungkus(fn):
        try:
            fn()
            hasil.append(("LOLOS", nama, ""))
        except AssertionError as e:
            hasil.append(("GAGAL", nama, str(e)[:300]))
        return fn
    return bungkus


def gaya(teks, pertama=False, klien=""):
    return P.masalah_gaya(teks, pertama, klien, FRASA, ROBOT)


def kode(lst):
    return [m[0] for m in lst]


@kasus("usulan 72: klaim masih available dikenali, kalimat biasa tidak")
def _():
    for t in ["Tanggal 2 Desember masih available nih Kak Yessi.", "Untuk 26 Desember masih available ya Kak.", "Tanggal itu masih kosong seharian.", "jadwalnya aman kok"]:
        assert P.RE_KLAIM_TERSEDIA.search(t), t
    for t in ["Kalau tanggalnya sudah fix kabari ya Kak.", "Desainnya masih bisa custom kok.", "Masih ada yang mau ditanyain Kak?"]:
        assert not P.RE_KLAIM_TERSEDIA.search(t), t
    assert P.buang_kalimat("Tanggal 26 Desember masih available ya Kak. Acaranya mulai jam berapa?", P.RE_KLAIM_TERSEDIA) == "Acaranya mulai jam berapa?"


@kasus("usulan 65 & 70: bot tidak mengaku ikut grup/tech meeting (...6996)")
def _():
    assert "koordinasi" in kode(gaya("Boleh Kak, silakan tambahkan. Nanti di grup aku koordinasikan langsung sama WO-nya soal area photobooth, meja-kursi, dan akses loading."))
    assert "koordinasi" in kode(gaya("Dari tim Tetra biasanya koordinasi teknis dikoordinasikan langsung via chat atau telepon dengan WO/PIC di lokasi."))
    for t in ["Kak izin tambahkan ke grup bareng WO ya🙏", "kak tech meeting tgl 11 jam 2 di Sasono Mulyo ya", "boleh undang adminnya ke grup vendor?"]:
        assert P.RE_AJAK_GRUP.search(t), t
    assert not P.RE_AJAK_GRUP.search("Kak frame-nya udah masuk belum?")
    assert gaya("Boleh Kak, undangannya aku teruskan ke admin ya.\n[INFO_ADMIN: klien mengajak ke grup WA bersama WO]") == []


@kasus("usulan 62: tanya satu harga tidak ditutup pertanyaan pilihan (...3958, ...7846)")
def _():
    assert "penutup_jualan" in kode(gaya("Untuk 2 jam harganya Rp 2.000.000 ya Kak.\n\nMau tetap ambil yang 2 jam atau lanjut yang 3 jam?", False, "Kalau mau ambil yang 2 jam berapa yaa kira2?"))
    assert gaya("Iya betul Kak Said, bahan kain polos.", False, "Oh, kain polos gt ya?") == []
    assert P.penutup_jualan("Untuk 2 jam Rp 2.000.000 ya Kak.\nAcaranya tanggal berapa Kak?", "berapa yang 2 jam?") == ""


@kasus("usulan 61: harga durasi di tabel tidak dijawab dipegang admin (...2152)")
def _():
    assert "dipegang_admin" in kode(gaya("Yang ini datanya dipegang admin, Kak. Aku terusin dulu ya.", False, "kalau 6 jam berapa ka udah dapet soft file ka?"))
    assert "dipegang_admin" not in kode(gaya("Untuk 6 jam Rp 4.000.000 ya Kak, iya sudah dapat softfile-nya.", False, "kalau 6 jam berapa ka udah dapet soft file ka?"))


@kasus("usulan 64: info backdrop basic gratis tanpa pertanyaan memilih (...6793)")
def _():
    assert "tanya_backdrop" in kode(gaya("Untuk backdrop basic kain polos jadi compliment free dari kami ya Kak.\n\nKakak lebih condong ke yang mana?"))
    assert "tanya_backdrop" not in kode(gaya("Silahkan Kak, berikut pilihan warna backdrop basic yang jadi compliment free dari kami ya."))
    assert "tanya_backdrop" not in kode(gaya("Backdrop basic free dari kami, transport juga gratis Jabodetabek.\nMau pakai format cetak yang mana, Kak? 2R photostrip, 4R, atau Polaroid?"))


@kasus("usulan 71: janji mengabari & minta kirim ulang dikenali (...5386)")
def _():
    for t in ["Nanti tim yang kabari jadwal dan biayanya ya Kak.", "nanti aku kabarin lagi ya kak", "Tim yang infoin ya Kak."]:
        assert P.RE_JANJI_KABARI.search(t), t
    assert not P.RE_JANJI_KABARI.search("Kabar baiknya softfile langsung bisa diunduh.")
    for t in ["Fotonya masih belum masuk ke sini Kak", "boleh dikirim ulang Kak?"]:
        assert P.RE_MINTA_ULANG.search(t), t


@kasus("usulan 73: 7 jam wajib dua jalan; 9-13 jam wajib paket 13 jam (...1015)")
def _():
    assert P.durasi_dua_jalan("Bisa pakai paket 6 jam ditambah extend 1 jam, totalnya Rp 4.500.000.", "acara 7 jam")
    assert not P.durasi_dua_jalan("Bisa 6 jam + extend 1 jam (Rp 4.500.000) atau paket 8 jam Rp 5.000.000.", "acara 7 jam")
    assert not P.durasi_dua_jalan("Paket 6 jam Rp 4.000.000.", "kalau 6 jam berapa?")
    assert P.durasi_dua_jalan("12 jam 7 juta kak, paket 8 jam 5 juta + extend 4 jam", "butuh 12 jam kak")
    assert not P.durasi_dua_jalan("8 jam + extend 4 jam, atau paket 13 jam Rp 7.500.000", "butuh 12 jam")
    assert "pertama_harga" not in kode(gaya("Halo Kak Jasmin! Buat 7 jam bisa 6 jam Rp 4.000.000 + extend 1 jam Rp 500.000, atau paket 8 jam Rp 5.000.000.", True, "Durasi: 7 jam"))


@kasus("tanda AI dirapikan: tanda pisah jadi koma, rentang jam tetap, bold 0 (Rama 11 Nov)")
def _():
    r = P.rapikan_gaya("Halo Kak — untuk *3 jam* harganya *Rp 2.500.000* — sudah termasuk cetak.\nJam 11.30–14.00 aman.\n[KIRIM: pricelist]")
    assert "—" not in r and "–" not in r, r
    assert "11.30-14.00" in r, r
    assert "*" not in r, r
    assert "Rp 2.500.000" in r and r.endswith("\n[KIRIM: pricelist]"), r
    assert P.rapikan_gaya("Siap Kak, aman.") == "Siap Kak, aman."
    assert P.rapikan_gaya("Berikut penawaran harga untuk acaranya") == "Berikut quotation untuk acaranya"


@kasus("lokasi kantor & janji temu sepihak ditangkap, kalimat sah lolos (Rama 11 Nov)")
def _():
    for t in ["nanti langsung aku samperin ke sana", "Boleh mas, ini share lok kantor kami", "Silakan datang ke kantor kami di Bogor",
              "Oke Kak, besok jam 10 kita ketemu di kantor ya", "aku tunggu di lobby ya", "nanti aku antar flashdisknya"]:
        assert P.RE_JANJI_TEMU.search(t), t
    for t in ["crew datang paling lambat 1 jam sebelum acara", "Tim kami datang ke venue jam 9 buat setup", "Kalau mau ketemu, admin yang atur jadwalnya ya"]:
        assert not P.RE_JANJI_TEMU.search(t), t


@kasus("frasa kaku Rama & kata robot dibaca dari docs/FRASA-KAKU.md")
def _():
    assert "crew standby" in FRASA and "paling menentukan" in FRASA
    assert "semoga" in ROBOT and "sukses selalu" in ROBOT and "semoga" not in FRASA
    assert P.frasa_kaku("Sudah termasuk cetak sepuasnya dan crew standby ya Kak", FRASA) == ["crew standby"]
    assert P.frasa_kaku("Bisa Kak, buat 150 tamu 3 jam pas. Acaranya mulai jam berapa?", FRASA) == []
    for f in ["aku cekkan slotnya dulu ya", "Siap Kak, aku kirim pricelist-nya ya", "Untuk 25 Oktober jadwalnya masih kosong ya", "Halo Kak, aku dari tim Tetra",
              "Maaf ya kak kejadian begini.", "Mohon maaf atas ketidaknyamanannya Kak", "Maaf atas kejadian ini"]:
        assert P.frasa_kaku(f, FRASA), f
    for f in ["Masih available nih Kak, mau aku bantu proses bookingnya?", "Silahkan Kak, berikut pricelistnya ya",
              "Maaf ya Kak. Aku teruskan ke tim buat dicetak ulang, masing-masing 2 pcs ya."]:
        assert P.frasa_kaku(f, FRASA) == [], f
    assert "kata_robot" in kode(gaya("Sama-sama Kak, semoga lancar acaranya 🙏"))


@kasus("pricelist: jawaban dua jalan 12 jam tidak ditulis ulang kode (18 Nov)")
def _():
    assert gaya("Bisa dua jalan kak: paket 8 jam Rp 5.000.000 + extend 4 jam (Rp 500.000/jam) jadi Rp 7.000.000, atau paket 13 jam Rp 7.500.000 (format 2R).\n[KIRIM: pricelist]") == []
    assert gaya("Silahkan Kak, berikut pricelistnya ya. Acaranya kapan?\n[KIRIM: pricelist]") == []


@kasus("isi lampiran tidak diulang di teks: skema rekanan, format, sleeve (Rama 11 Nov)")
def _():
    royal = ("Boleh Kak. Jadi skema rekanannya ada dua: komisi, klien bayar harga publish ke kami, komisi 10% kami transfer ke Royal Organizer setelah acara selesai; "
             "atau potongan langsung, Kakak pegang kliennya dan bebas jual berapa pun, ke kami cukup bayar harga publish dikurangi 10%. Aku kirim gambar skemanya ya, biar lebih kebayang.\n[KIRIM: skema]")
    assert gaya(royal) and P.frasa_kaku(royal, FRASA)
    assert gaya("Boleh Kak, silahkan berikut skema rekanannya ya. Kalau ada yang kurang jelas, silahkan ditanyakan ya Kak\n[KIRIM: skema]") == []
    assert gaya("2R itu 5 x 15 cm, 4R 10 x 15 cm, Polaroid 7,5 x 10 cm.\n[KIRIM: format]")
    assert gaya("2R itu 5 x 15 cm, 4R 10 x 15 cm, Polaroid 7,5 x 10 cm.\n[KIRIM: format cetak]"), "penanda dua kata juga dikenali"
    sleeve = ("Soal desainnya biar jelas: cetakan fotonya sudah menyatu dengan desain frame sesuai tema acara, itu termasuk di paket. Terus tamu juga dapat sleeve, "
              "tapi yang termasuk itu sleeve basic hitam atau putih, jadi desainnya basic, bukan desain klien. Kalau sleeve-nya mau pakai desain/branding klien sendiri, "
              "itu add-on Custom Sleeve Rp 1.500.000 untuk 1.000 lembar.")
    assert gaya(sleeve)
    assert gaya("Silahkan Kak, berikut gambaran cetakan foto dan sleeve-nya ya. Kalau ada yang kurang jelas silahkan ditanyakan\n[KIRIM: sleeve]") == []


@kasus("basa-basi Rama 11 Nov ditangkap, jawaban beralasan lolos")
def _():
    for x in ["Untuk 200-300 tamu, 3 jam memang pas.", "dan durasi 3 jam memang sudah cukup untuk 200-300 tamu di resepsi.",
              "Untuk 200-300 tamu, 3 jam sudah cukup kok.", "Harganya Rp 2.500.000, sudah termasuk cetak sepuasnya dan crew.",
              "Untuk 3 jam itu paketnya Rp 2.500.000, sudah termasuk cetak sepuasnya, frame custom sesuai tema acara, crew, dan transport se-Jabodetabek.",
              "Cibubur masih masuk Jabodetabek jadi tidak ada biaya tambahan, sudah termasuk dalam harga."]:
        assert P.basa_basi(x), x
    assert P.basa_basi("Cibubur masih free transport ya Kak.") == []
    assert P.basa_basi("Soal pajak, harga kami aslinya belum termasuk pajak, tapi kalau ketentuan kantor mewajibkan, nanti sistemnya di-gross up 2,5%.") == []
    assert "frasa_kaku" in kode(gaya("Untuk tanggal 6 Desember slotnya masih available nih Kak."))
    assert "dua_pengantar" in kode(gaya("Biar lebih gampang, ini ada gambaran perbandingannya ya Kak. Silahkan Kak, berikut perbandingan format cetaknya ya. [KIRIM: format]"))
    assert "dua_pengantar" not in kode(gaya("Silahkan Kak, berikut perbandingan format cetaknya ya. Rencananya untuk acara apa Kak? [KIRIM: format]"))
    assert P.basa_basi("Dengan 300 tamu, 3 jam bikin semua tamu kebagian foto tanpa antre lama.") == []
    assert P.basa_basi("Cukup Kak, soalnya 1 jam bisa melayani 100+ tamu, jadi 3 jam sudah pas buat 300 tamu.", "3 jam cukup ga buat 300 tamu?") == []
    assert len(P.frasa_kaku("Paham, Kak. Tanggal 19 Desember sendiri masih kosong di jam itu.", FRASA)) >= 2


@kasus("pertanyaan penutup pindah ke baris baru")
def _():
    assert P.pisah_pertanyaan("Untuk 3 jam paketnya Rp 2.500.000, cetaknya sepuasnya. Lokasi acaranya di mana?") == "Untuk 3 jam paketnya Rp 2.500.000, cetaknya sepuasnya.\nLokasi acaranya di mana?"
    assert P.pisah_pertanyaan("Siap Kak. Tanggal berapa?") == "Siap Kak. Tanggal berapa?"


@kasus("link & alamat karangan ditangkap (...2792)")
def _():
    g = P.Giliran(giliran("boleh share lok?"))
    assert P.tautan_asing("share lok https://maps.app.goo.gl/w132t81yQ9kZ7dLLA", g.sumber)
    assert P.tautan_asing("Kawasan Niaga Citra Indah Blok A1 Sentul ya mas", g.sumber)
    assert P.tautan_asing("booking di https://booking.tetraphoto.com ya Kak", g.sumber) == []


@kasus("12 jam dijawab paket 8 jam saja ditangkap (...2553)")
def _():
    assert P.durasi_kurang("Untuk 12 jam pakai paket 8 jam *Rp 5.000.000*", "acaranya 12 jam kak")
    assert not P.durasi_kurang("8 jam Rp 5.000.000 + extend 4 jam Rp 2.000.000", "acaranya 12 jam kak")


@kasus("harga: tabel Classic dari skill faq-tetra hidup lagi, extend bukan harga paket")
def _():
    g = P.Giliran(giliran("kak 4 jam berapa?"))
    assert P.tabel_classic(g.stabil).get("4") == 3000000, P.tabel_classic(g.stabil)
    h = lambda t: P.harga_asing(t, g.sumber, g.stabil, g.khusus_dari)
    assert h("8 jam *Rp 5.000.000* + 4 jam tambahan × Rp 500.000 = *Rp 7.000.000*") == []
    assert h("paket *8 jam Rp 5.000.000* + extend 4 jam (*Rp 500.000*/jam) jadi *Rp 7.000.000*") == []
    assert h("4 jam Rp 2.000.000"), "harga paket 2 jam untuk 4 jam harus ditangkap"
    assert h("6 jam Rp 4.500.000 untuk Videobooth 360") == []
    assert h("Totalnya Rp 2.345.678 ya Kak"), "nominal karangan"  # angka bulat bisa terbentuk dari jumlah harga resmi (sifat penjaga asli)


@kasus("harga khusus vendor & dari admin di chat tidak dianggap karangan")
def _():
    fakta = "KONTAK INI VENDOR REKANAN: Teh Evi.\nKESEPAKATAN KHUSUS VENDOR INI: 2 jam Rp 1.700.000"
    g = P.Giliran(giliran("teh harga vendor 2 jam tetap 1,7 kan?", fakta))
    assert P.harga_asing("Iya teh, 2 jam Rp 1.700.000 sesuai kesepakatan.", g.sumber, g.stabil, g.khusus_dari) == []
    g2 = P.Giliran(giliran("oke kak", riwayat=[("user", "kak bisa kurang?"), ("assistant", "(admin) bisa kak jadi 2.300.000 untuk 3 jam")]))
    assert P.harga_asing("Siap Kak, 3 jam Rp 2.300.000 sesuai yang admin sampaikan.", g2.sumber, g2.stabil, g2.khusus_dari) == []


@kasus("janji nanti aku kabari tercatat ke admin (...4324)")
def _():
    assert P.RE_JANJI_ADMIN.search("Siap Kak, nanti aku kabari ya")


@kasus("fakta dari bot WA dibaca dari ujung prompt, bukan dari isi skill")
def _():
    g = P.Giliran(giliran("halo", "KONTEKS LEAD (dari deteksi & riwayat):\nTAHAP PERCAKAPAN: SAPA (KONTAK PERTAMA) — belum pernah ada percakapan."))
    assert g.pertama and not g.vendor and not g.tugas and not g.situasi
    g = P.Giliran(giliran("halo"))
    assert not g.pertama and not g.vendor, "kata KONTAK PERTAMA/VENDOR REKANAN di skill tidak boleh terbaca sebagai fakta"
    t = [{"role": "system", "content": STABIL + "\n\nTUGAS SISTEM (bukan pesan untuk klien).\n\nTUGAS SISTEM: ringkas-chat — kerjakan sesuai skill tugas-sistem-cs bagian \"ringkas-chat\"."},
         {"role": "user", "content": "KLIEN: halo"}]
    assert P.Giliran(t).tugas and P.periksa("{\"x\": \"semoga\"}", P.Giliran(t), FRASA, ROBOT) == []
    assert P.Giliran(giliran("(tidak ada pesan baru)", "SITUASI DARI SISTEM: bukti transfer masuk")).situasi


@kasus("klaim tanggal tersedia hanya sah kalau alat jadwal bilang bisa (usulan 72)")
def _():
    teks = "Tanggal 2 Desember masih available ya Kak. Acaranya mulai jam berapa?"
    assert "klaim_tersedia" in kode(P.periksa(teks, P.Giliran(giliran("2 desember bisa?")), FRASA, ROBOT))
    g = P.Giliran(giliran("2 desember bisa?", alat='{"bisa_terima_booking": true, "unit_kosong": 2}'))
    assert g.jadwal_tersedia and "klaim_tersedia" not in kode(P.periksa(teks, g, FRASA, ROBOT))
    akhir, aksi = P.selesaikan(teks, P.Giliran(giliran("2 desember bisa?")), FRASA, ROBOT)
    assert "available" not in akhir and "jam berapa" in akhir and "buang:klaim_tersedia" in aksi, akhir


@kasus("bocor pikiran: catatan internal & kutipan aturan ditangkap, kutipan FAQ tidak")
def _():
    g = P.Giliran(giliran("harga 3 jam?"))
    assert "bocor" in kode(P.periksa("We need to answer the price.\nUntuk 3 jam Rp 2.500.000 ya Kak.", g, FRASA, ROBOT))
    faq = [s for s in P._kalimat_aturan(P.RE_BLOK_FAQ.search(g.stabil).group(0)) if 60 < len(s) < 160][:2]
    aturan = [s for s in P._kalimat_aturan(g.aturan) if 60 < len(s) < 160][:2]
    assert len(faq) == 2 and len(aturan) == 2
    assert not P.bocor_pikiran(" ".join(faq), g.aturan), "dua kalimat FAQ boleh dikutip"
    assert P.bocor_pikiran(" ".join(aturan), g.aturan), "dua kalimat aturan = bocor"


@kasus("selesaikan: fatal jadi handoff, vendor dapat kalimat santai, penanda admin ditambah, (admin) dibuang")
def _():
    g = P.Giliran(giliran("kak sudah transfer ya"))
    assert P.selesaikan("Siap Kak, DP-nya sudah masuk ya.", g, FRASA, ROBOT)[0] == P.HANDOFF
    gv = P.Giliran(giliran("teh 2 jam berapa?", "KONTAK INI VENDOR REKANAN: Teh Evi.\nKESEPAKATAN KHUSUS VENDOR INI: (belum ada)"))
    assert P.selesaikan("Untuk teteh 2 jam Rp 1.333.000 ya.", gv, FRASA, ROBOT)[0] == P.HANDOFF_VENDOR
    t, aksi = P.selesaikan("Soal harga 5 unit aku cek dulu ke admin ya Kak.", g, FRASA, ROBOT)
    assert "[INFO_ADMIN:" in t and "tambah:janji_admin" in aksi, t
    t, _ = P.selesaikan("Boleh Kak, undangannya aku teruskan ya.", P.Giliran(giliran("kak izin tambahkan ke grup bareng WO ya")), FRASA, ROBOT)
    assert "[INFO_ADMIN: klien mengajak" in t, t
    assert P.selesaikan("(admin) Siap Kak.", g, FRASA, ROBOT)[0] == "Siap Kak."
    t, aksi = P.selesaikan("Sama-sama Kak. Semoga lancar acaranya ya.", g, FRASA, ROBOT)
    assert t == "Sama-sama Kak." and "buang:kata_robot" in aksi, t


@kasus("permintaan tulis ulang: peran bergantian, hasil alat ikut, tanpa alat")
def _():
    msgs = giliran("2 desember bisa?", riwayat=[("user", "halo"), ("assistant", "Halo Kak")], alat='{"bisa_terima_booking": false}')
    r = P.pesan_tulis_ulang(msgs, "draf", [("x", "gaya", "perbaiki y")])
    peran = [m["role"] for m in r]
    assert peran == ["system", "user", "assistant", "user", "assistant", "user"], peran
    assert "HASIL ALAT" in r[-1]["content"] and "KOREKSI SISTEM" in r[-1]["content"] and r[-2]["content"] == "draf"
    assert all("tool_calls" not in m for m in r)


class LLM:
    def __init__(self, jawab):
        self.jawab, self.n = list(jawab), 0

    def complete(self, **kw):
        self.n += 1
        teks = self.jawab.pop(0) if self.jawab else ""
        return type("R", (), {"text": teks})()


class Ctx:
    def __init__(self, llm):
        self.llm, self.hook, self.mw = llm, [], []

    def register_middleware(self, kind, fn):
        self.mw.append((kind, fn))

    def register_hook(self, name, fn):
        self.hook.append((name, fn))


def jalankan(llm, teks, msgs, a=True):
    """Tiru urutan Hermes: middleware tiap permintaan, lalu transform_llm_output A (kalau tidak lewat batas waktu) dan B;
    hasil teks pertama menang."""
    ctx = Ctx(llm)
    plugin.register(ctx)
    for _k, fn in ctx.mw:
        fn(request={"messages": msgs}, original_request={}, session_id="s1", turn_id="t1")
    hasil_hook = [fn(response_text=teks, session_id="s1", turn_id="t1") for i, (_n, fn) in enumerate(ctx.hook) if a or i > 0]
    menang = next((h for h in hasil_hook if isinstance(h, str) and h), None)
    return menang if menang is not None else teks


@kasus("alur plugin: tulis ulang sekali memperbaiki harga karangan")
def _():
    llm = LLM(["Untuk 4 jam Rp 3.000.000 ya Kak."])
    out = jalankan(llm, "Untuk 4 jam Rp 2.000.000 ya Kak.", giliran("4 jam berapa kak?"))
    assert out == "Untuk 4 jam Rp 3.000.000 ya Kak." and llm.n == 1, (out, llm.n)


@kasus("alur plugin: tulis ulang tetap salah dua kali -> handoff")
def _():
    llm = LLM(["4 jam Rp 2.000.000 Kak.", "4 jam Rp 2.100.000 Kak."])
    assert jalankan(llm, "Untuk 4 jam Rp 2.000.000 ya Kak.", giliran("4 jam berapa kak?")) == P.HANDOFF and llm.n == 2


@kasus("alur plugin: pemeriksa utama lewat batas waktu -> jaring cepat tetap menahan klaim palsu")
def _():
    out = jalankan(LLM([]), "Siap Kak, DP-nya sudah masuk ya.", giliran("kak sudah transfer ya"), a=False)
    assert out == P.HANDOFF, out
    assert jalankan(LLM([]), "Siap Kak, nanti admin cek ya.", giliran("kak sudah transfer ya"), a=False) == "Siap Kak, nanti admin cek ya."


@kasus("alur plugin: balasan bersih tidak diubah dan tidak memanggil AI; tugas sistem dilewati")
def _():
    llm = LLM([])
    t = "Untuk 3 jam Rp 2.500.000 ya Kak, cetaknya sepuasnya.\nAcaranya di mana Kak?"
    assert jalankan(llm, t, giliran("3 jam berapa?")) == t and llm.n == 0
    tugas = [{"role": "system", "content": STABIL + "\n\nTUGAS SISTEM (bukan pesan untuk klien).\n\nTUGAS SISTEM: ringkas-chat — x"}, {"role": "user", "content": "KLIEN: halo"}]
    assert jalankan(llm, "- semoga — *x*", tugas) == "- semoga — *x*" and llm.n == 0


for s, n, e in hasil:
    print(f"{'✅' if s == 'LOLOS' else '❌'} {n}" + (f"\n   -> {e}" if e else ""))
gagal = sum(1 for h in hasil if h[0] == "GAGAL")
print(f"\n{len(hasil) - gagal}/{len(hasil)} lolos")
sys.exit(1 if gagal else 0)
