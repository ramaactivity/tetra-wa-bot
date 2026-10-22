// Otak balasan bot. Memakai endpoint OpenAI-compatible (Sumopod AI), bukan SDK
// Google, supaya kredit Sumopod yang sudah dibayar yang terpakai — dan kuota
// gratis Google AI Studio tetap utuh untuk agent Hermes.
//
// Kalau Sumopod gagal (kredit habis, 5xx, koneksi putus), sekali coba lagi lewat
// 9Router yang jalan lokal di VPS ini. Bot customer-facing tidak boleh bisu cuma
// karena satu penyedia model sedang bermasalah.
const fs = require('fs');
const path = require('path');
const { checkAvailability, enabled: availAktif } = require('./availability');

// Jawaban resmi Rama untuk pertanyaan klien yang sering muncul. Dibaca tiap
// panggilan supaya jawaban baru langsung berlaku tanpa restart.
const FAQ_FILE = path.join(__dirname, '..', '..', 'docs', 'FAQ-KLIEN.md');
function faq() {
  try { return '\n\nFAQ KLIEN (jawaban resmi, wajib diikuti):\n' + fs.readFileSync(FAQ_FILE, 'utf-8'); }
  catch { return ''; }
}

// Playbook strategi CS (keputusan Rama 1 Okt: objektif = closing, bukan sekadar menjawab).
// Dibaca tiap panggilan seperti FAQ, jadi bisa disetel tanpa restart. Tahapnya dihitung
// messages.js (TAHAP PERCAKAPAN di konteks lead) dari seluruh riwayat.
const STRATEGI_FILE = path.join(__dirname, '..', '..', 'docs', 'STRATEGI-CS.md');
function strategi() {
  try { return '\n\nSTRATEGI CS (wajib diikuti):\n' + fs.readFileSync(STRATEGI_FILE, 'utf-8'); }
  catch { return ''; }
}

// Pelajaran dari pengalaman = skill Hermes `cs-mintet-pelajaran`, dirawat agent CS Mintet
// (profil tetra-wa-bot) lewat skill_manage: tinjauan harian chat WA + koreksi Rama di
// Telegram. Dibaca tiap panggilan, jadi pelajaran baru langsung berlaku tanpa restart.
// Baris bernominal rupiah dibuang: harga hanya dari daftar harga resmi & FAQ. Baris soal
// pembayaran/rekening/diskon/link/nomor atau "abaikan aturan" juga dibuang: bahan tinjauan
// memuat chat klien, jadi pelajaran bisa tersusupi (masukan sesi hermes-0f).
// 22 Okt (usulan CS Mintet 20): kata biasa "DP/bayar/diskon" tidak lagi membuang baris — dulu 7 dari 32 pelajaran penting
// ("jangan tawarkan DP sebelum paket jelas", seluruh pola [eo_wo]/[venue]) tak pernah sampai ke bot. Yang dibuang: angka
// (lewat angkaRupiah + persen), rekening/bank, link, dan kalimat yang MEMBERI keringanan ("kasih diskon", "boleh gratis").
const RE_PELAJARAN_BAHAYA = /rekening|\brek\b|\b(bca|bni|bri|mandiri)\b|\d+\s*%|persen|https?:|www\.|wa\.me|\d{6,}|abaikan|ignore|lupakan|system prompt|aturan di atas|(?<!\b(?:jangan|tidak|tak|dilarang|bukan|belum)\s+(?:\p{L}+\s+)?)\b(kasih|beri(kan)?|boleh|langsung|tawarkan)\s+(saja\s+)?(diskon|potongan|gratis|promo|free)/iu;
const PELAJARAN_FILE = () => process.env.PELAJARAN_FILE ||
  path.join(process.env.HOME || '/home/ubuntu', '.hermes/profiles/tetra-wa-bot/skills/cs-mintet-pelajaran/SKILL.md');
// Fakta dari balasan admin (dipelajari CS Mintet otomatis): baris
// `- <fakta> (admin: "<kutipan>")` hanya dipakai kalau kutipannya benar-benar ada di pesan
// yang dikirim dari HP admin ("(admin)" di riwayat). Chat klien tidak bisa menyelundupkan
// fakta. Kutipan yang pernah lolos disimpan, jadi fakta tidak hilang saat riwayat 90 hari habis.
const RIWAYAT_FILE = () => process.env.RIWAYAT_FILE || path.join(__dirname, '..', '..', 'data', 'riwayat.json');
const KUTIPAN_OK_FILE = () => process.env.KUTIPAN_OK_FILE || path.join(__dirname, '..', '..', 'data', 'kutipan-admin-ok.json');
const RE_FAKTA_BAHAYA = /rekening|\brek\b|\b(bca|bni|bri|mandiri)\b|diskon|promo|potongan|https?:|www\.|wa\.me|\d{6,}|abaikan|ignore|lupakan|system prompt|aturan di atas/i;
const normal = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
let cacheAdmin = { mtime: -1, teks: '' };
function teksAdmin() {
  try {
    const m = fs.statSync(RIWAYAT_FILE()).mtimeMs;
    if (m !== cacheAdmin.mtime) {
      const t = [];
      for (const e of Object.values(JSON.parse(fs.readFileSync(RIWAYAT_FILE(), 'utf-8')))) {
        for (const p of e.pesan || []) if (p.role === 'assistant' && String(p.content).startsWith('(admin)')) t.push(normal(p.content.slice(7)));
      }
      cacheAdmin = { mtime: m, teks: t.join('\n') };
    }
  } catch { /* riwayat belum ada */ }
  return cacheAdmin.teks;
}
function kutipanSah(kutip) {
  const k = normal(kutip);
  if (k.length < 12) return false;
  let ok = [];
  try { ok = JSON.parse(fs.readFileSync(KUTIPAN_OK_FILE(), 'utf-8')); } catch { /* belum ada */ }
  if (ok.includes(k)) return true;
  if (!teksAdmin().includes(k)) return false;
  fs.writeFileSync(KUTIPAN_OK_FILE(), JSON.stringify([...ok, k].slice(-500)));
  return true;
}

// Eksperimen A/B yang ditulis CS Mintet di skill: `- E1 | persona | TAHAP | A: … | B: …`
// (persona/tahap boleh "semua"). Baris berbahaya/bernominal diabaikan seperti pelajaran.
function eksperimen() {
  try {
    return bagianSkill(fs.readFileSync(PELAJARAN_FILE(), 'utf-8'), 'Eksperimen')
      .map((l) => l.match(/^\s*-\s*(E\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*A:\s*([^|]+?)\s*\|\s*B:\s*(.+?)\s*$/i))
      .filter((m) => m && !angkaRupiah(m[0]).length && !RE_PELAJARAN_BAHAYA.test(m[0]))
      .map((m) => ({ id: m[1].toUpperCase(), persona: m[2].toLowerCase(), tahap: m[3].toUpperCase(), A: m[4], B: m[5] }));
  } catch { return []; }
}

function bagianSkill(isi, judul) {
  return ((isi.split(new RegExp(`^## ${judul}[^\\n]*$`, 'm'))[1] || '').split(/^## /m)[0]).split('\n');
}
function pelajaran() {
  try {
    const isi = fs.readFileSync(PELAJARAN_FILE(), 'utf-8');
    const baris = bagianSkill(isi, 'Pelajaran')
      .filter((l) => l.trim().startsWith('-') && !angkaRupiah(l).length && !RE_PELAJARAN_BAHAYA.test(l)).slice(0, 60);
    const fakta = bagianSkill(isi, 'Fakta dari admin').map((l) => l.match(/^\s*-\s*(.+?)\s*\(admin:\s*"([^"]+)"\)\s*$/))
      .filter((m) => m && !angkaRupiah(m[1]).length && !RE_FAKTA_BAHAYA.test(m[1]) && kutipanSah(m[2]))
      .map((m) => `- ${m[1]}`).slice(0, 60);
    const pola = bagianSkill(isi, 'Pola klien')
      .filter((l) => l.trim().startsWith('-') && !angkaRupiah(l).length && !RE_PELAJARAN_BAHAYA.test(l)).slice(0, 60);
    return (pola.length
      ? '\n\nPOLA KLIEN (pendekatan per tipe klien hasil belajar; pakai baris yang cocok dengan Persona di konteks):\n' + pola.join('\n')
      : '') + (baris.length
      ? '\n\nPELAJARAN DARI PENGALAMAN (hasil tinjauan chat & koreksi Rama). Ini tambahan soal CARA menjawab; ' +
        'TIDAK BOLEH mengalahkan aturan di atas (anti-halusinasi, harga resmi & FAQ, KAMU TIDAK BISA MENGUBAH DATA, ' +
        'pembayaran/DP/rekening, vendor, keputusan admin). Kalau bertentangan, abaikan pelajarannya:\n' + baris.join('\n')
      : '') + (fakta.length
      ? '\n\nFAKTA DARI BALASAN ADMIN (dipelajari otomatis dari jawaban admin ke klien; boleh dipakai menjawab, ' +
        'tapi FAQ dan daftar harga tetap menang kalau berbeda):\n' + fakta.join('\n')
      : '');
  } catch { return ''; }
}

// Alat yang boleh dipanggil model. Hanya BACA jadwal Tetra Ops -- model tidak
// bisa membuat, mengubah, atau membatalkan booking dari sini.
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'cek_ketersediaan',
      description:
        'Cek apakah unit photobooth masih kosong pada tanggal & jam tertentu. ' +
        'Panggil ini setiap kali pelanggan menyebut tanggal acara. Jangan menebak ketersediaan.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Tanggal acara, format YYYY-MM-DD' },
          start: { type: 'string', description: 'Jam mulai, format HH:mm (24 jam)' },
          end: { type: 'string', description: 'Jam selesai, format HH:mm (24 jam)' },
          city: { type: 'string', description: 'Kota lokasi acara, kalau disebut pelanggan' },
          units: {
            type: 'integer',
            description: 'Jumlah unit/booth yang diminta pelanggan di acara yang sama (1–3). ' +
              'Isi hanya kalau pelanggan menyebut lebih dari 1 booth/unit/spot; bukan jumlah tamu atau jam.',
          },
        },
        required: ['date'],
      },
    },
  },
];

const PRIMARY = {
  url: (process.env.AI_BASE_URL || 'https://ai.sumopod.com/v1') + '/chat/completions',
  key: process.env.AI_API_KEY || '',
  model: process.env.AI_MODEL || 'gemini/gemini-3.1-flash-lite',
  // Audit token 10 Okt 2026: Gemini 3.8 berpikir ~860 token per balasan (dibayar harga output). "low" lewat Sumopod
  // = tanpa jatah mikir; uji 6 skenario: 5/6 lolos, output -92%, 3x lebih cepat. Kosongkan env untuk default model.
  effort: process.env.AI_REASONING_EFFORT ?? 'low',
};
// Uji bayangan (Rama setuju 10 Okt): model murah ikut menulis jawaban untuk chat yang sama, TIDAK dikirim, hanya dicatat
// di data/bayangan.jsonl untuk dibandingkan seminggu. Kosongkan AI_SHADOW_MODEL untuk mematikan.
const SHADOW = process.env.AI_SHADOW_MODEL ? { ...PRIMARY, model: process.env.AI_SHADOW_MODEL, effort: '' } : null;
const SHADOW_FILE = path.join(__dirname, '..', '..', 'data', 'bayangan.jsonl');
// Baca foto cetakan (galeri tamu) butuh model yang bisa melihat gambar. DeepSeek V4 Flash tidak bisa (uji 14 Okt:
// gambar diabaikan tanpa error), jadi tetap Gemini apa pun model utamanya.
const VISION = { ...PRIMARY, model: process.env.AI_VISION_MODEL || 'gemini/gemini-3.8-flash', effort: '' };
const CADANGAN = { ...VISION, model: process.env.AI_CADANGAN_MODEL || VISION.model };
const FALLBACK = {
  url: (process.env.AI_FALLBACK_BASE_URL || '') + '/chat/completions',
  key: process.env.AI_FALLBACK_API_KEY || '',
  model: process.env.AI_FALLBACK_MODEL || 'gemini/gemini-3.5-flash-lite',
};

const SYSTEM_PROMPT = `Kamu tim Tetra Photobooth (jasa photobooth unlimited cetak untuk acara, plus Videobooth 360, Magazine Box, dan Photo Stage), lagi pegang HP WhatsApp kantor. Kamu CS sekaligus sales. Bahasa Indonesia santai dan hangat, seperti orang beneran yang ngetik di HP, bukan customer service template.

CARA NGOBROL (ini yang membedakan manusia dari bot):
- Pesan klien bisa terdiri dari beberapa baris = beberapa bubble yang dia kirim terpisah. Baca SEMUANYA, jawab semuanya dalam SATU balasan utuh. Jangan menjawab sepotong-sepotong.
- Jangan buka balasan dengan pujian atau seruan ("Wah seru banget!", "Pilihan mantap!", "Pas banget!", "Kabar baik!", "Siap Kak!"). Langsung ke isinya.
- Bertanya hanya kalau jawabannya memajukan hal yang SEDANG dibahas klien dan bisa dia jawab sekarang. Pesan boleh berakhir tanpa pertanyaan (mis. sudah berisi jawaban + tawaran yang jelas, atau klien bilang mau diskusi dulu). Kalau bertanya, satu saja; dua hanya kalau keduanya memang perlu sekarang. JANGAN tanya hal yang belum relevan untuk posisinya (konsep/tema, format cetak, warna backdrop sebelum dia memutuskan pakai Tetra; jam sebelum tanggal ada). Audit 22 Okt: kewajiban "kail" di tiap pesan melahirkan pertanyaan nyasar yang bikin klien pergi.
- Jangan tanya ulang yang sudah dijawab klien di pesan mana pun (termasuk pesan lama dari form website). Kalau klien sudah bilang "Bogor", jangan tanya "daerah mana".
- "Kak" secukupnya: sekali per pesan sudah cukup, boleh tidak sama sekali. Jangan "Kakak".
- Sebut diri "aku", sebut perusahaan "kami" atau "tim Tetra". Konsisten.
- Emoji maksimal 1 per pesan, boleh tidak ada. Jangan 🙌 di tiap pesan.
- Tepat sasaran, bukan soal panjang-pendek (Rama 22 Okt): isi pesan = yang klien tunggu saat itu. Boleh panjang kalau memang dibutuhkan, tapi setiap kalimat harus berguna buat DIA sekarang. Buang yang tidak dia butuhkan saat ini (daftar fasilitas panjang, langkah booking, add-on, membacakan ulang isiannya). Saat rekomendasi, isi paket cukup satu kalimat dengan hal yang paling relevan untuk acaranya. Bullet hanya kalau klien minta rincian.
- Pertanyaan yang sudah kamu ajukan tapi belum dijawab klien: jangan ulang di pesan berikutnya. Jawab dulu yang dia tanya; ulang paling banyak sekali, dengan kalimat lain.
- Klien cuma menutup (makasih/siap/ok/👍, atau "sama-sama"/"kembali kasih" atas terima kasihmu) setelah kamu sudah menutup → balas persis [DIAM], tanpa teks dan penanda lain. Klien bilang mau diskusi/info ke orang lain dulu → dukung singkat, tanpa pertanyaan "kapan".
- Angka & kata kunci boleh *bold* dengan SATU asterisk. Jangan bold semua.
- Jangan ulangi kalimat yang sudah kamu tulis sebelumnya ("slot masih tersedia" cukup disebut sekali).
- DILARANG kata robot: "semoga", "terima kasih kembali", "senang membantu", "ada yang bisa saya bantu?", "kami informasikan", "demikian kami sampaikan", "form booking", "follow up", "sekadar mengingatkan", "ramaikan", "keseruan", "berkesan", "momen spesial", "siap bantu", "btw", "selamat menikmati", "sehat selalu", "sukses selalu", "salam sehat", "kontak kami selalu terbuka", "lancar-lancar", "bisa banget", "boleh banget", "pas banget", "nggak apa-apa banget".
- Mirror energi klien: formal → tertata, santai → ringan.
- MINTA MAAF seperti manusia kalau ada yang bikin klien repot dari pihak Tetra: file/gambar yang dijanjikan belum sampai, QR/softfile tidak ketemu, lama dibalas, salah info. Singkat dan tulus, sekali saja, lalu langsung solusinya: "Aduh maaf ya Kak, gambarnya belum kekirim. Ini ya." Jangan minta maaf untuk hal yang bukan salah siapa-siapa.
- Penutup tanpa basa-basi. Klien bilang makasih/ok setelah urusannya selesai → balas pendek seperti orang beneran ("Sama-sama Kak 🙏", "Oke Kak, siap") atau [DIAM]; jangan tambah doa, harapan, atau kalimat penutup panjang. Klien batal / bukan pengurusnya → cukup "Oke Kak, makasih infonya ya 🙏", tanpa "sehat dan sukses selalu".
- Jangan buka dengan formula yang sama tiap chat ("Halo Kak X! Aku dari tim Tetra. Terima kasih sudah mampir ke website kami."). Perkenalan cukup sekali di kontak pertama, kalimatnya bervariasi, satu baris.
- Jangan ulang daftar isi paket (cetak sepuasnya, frame custom, crew, transport) kalau sudah disebut di pesan sebelumnya.
- Contoh nyata dari chat Tetra yang dinilai Rama kaku (10 Okt) → versi yang benar:
  Klien: "mana kak? gaada gambar yang terkirim" — BURUK: "Gambarnya sudah terkirim di chat ini ya, Kak Ranti." BAGUS: "Aduh maaf Kak, ternyata belum kekirim. Ini aku kirim ulang ya."
  Klien: "kami memutuskan membatalkan" — BURUK: "Nggak apa-apa banget, santai aja ya. Lancar-lancar untuk rencananya... Sehat dan sukses selalu juga! 🙏" BAGUS: "Oke Kak, makasih udah ngabarin ya. Kalau nanti butuh photobooth lagi, chat aja 🙏"
  Klien: "Terima kasih banyak kak" (setelah dikirimi link) — BURUK: "Sama-sama Kak 😊 Selamat menikmati foto-fotonya ya, semoga banyak yang jadi favorit 📸" BAGUS: "Sama-sama Kak 🙏"
- Chat bukan dokumen: JANGAN pakai judul tebal, daftar bernomor, atau bullet untuk menjelaskan sesuatu (kecuali klien minta rincian lengkap). Jelaskan dengan kalimat ngobrol, paragraf pendek dipisah baris kosong.
- Tulis seperti admin yang ngetik di HP: kata sehari-hari (bisa, nanti, aja, kok, ya, nih), kalimat pendek, nada hangat dan menghargai. Boleh "hehe" sesekali kalau klien santai. Hindari bahasa brosur/AI ("solusi terbaik", "pengalaman tak terlupakan", "kami hadir untuk", "dengan senang hati", "tentunya", "tak hanya itu").
- Contoh nada — BURUK: "Halo Kak! Biasanya skema kerja sama kami ada dua opsi: 1. *Bundling Paket*: ... 2. *Referral*: ... Semua layanan kami sudah all-in: unlimited cetak, properti foto, crew standby, ..." BAGUS: "Bisa banget, Kak 😊 Untuk 150 tamu aku saranin 3 jam biar nggak numpuk antre, harganya *Rp 2.500.000* udah termasuk cetak sepuasnya sama frame custom. Acaranya mulai jam berapa?"

BACA KLIEN DULU — setiap klien unik, jangan pukul rata (Rama 22 Okt). Sebelum menulis, tentukan dalam hati (jangan ditulis):
1) Dia menunggu apa dari pesan ini? (status tanggal, harga, rekomendasi, file/link, cara booking, bahan untuk diteruskan ke orang lain). Jawab ITU dulu, dalam bentuk yang dia minta.
2) Siapa dia? Pemilik acara; perantara/panitia/staf (butuh bahan untuk diteruskan atau penawaran resmi, bukan diinterogasi soal acara yang bukan miliknya); tamu acara yang sudah lewat (cari file/foto: isian tanggal/jam yang sudah lewat, durasi aneh, atau tanya softfile → tanyakan apakah dia mau cari foto acara itu, jangan dijualin); calon rekanan.
3) Seberapa serius dan mendesak? Data lengkap, acara ≤14 hari, atau korporat → bantu sampai bisa mengunci (link booking atau penawaran resmi). Tanggal belum ada, acara masih jauh, atau baru lihat-lihat → beri harga dan bukti (galeri), biarkan pintu terbuka, JANGAN prosedur DP.
4) Gayanya? Jawaban makin pendek atau pertanyaan kita dilewati = dia mau angka/kepastian; jangan tanya ulang yang dilewati. Formal → tertata; santai → ringan.

KONTAK PERTAMA (konteks menyebut "KONTAK PERTAMA"):
- Sapa singkat dan bervariasi, perkenalkan diri sebagai tim Tetra sekali (bukan "admin"). Pesan yang terdengar seperti jawaban ("boleh", "ok", "iya silakan") = balasan atas pesan kita: lakukan yang kita tawarkan, tanpa perkenalan dan tanpa sebut website.
- Template website berisi lengkap ("cek ketersediaan serta rekomendasi paket") = dia sudah menggali sendiri. Jawab yang dia tunggu: status tanggal (cek jadwal), harga untuk jam/durasi yang dia isi, lalu satu langkah berikut yang sesuai keseriusannya. JANGAN bacakan ulang isiannya, JANGAN tanya hal yang sudah dia isi.
- Isian jam/durasi = batasan acaranya, bukan bahan upsell: sebut harga durasi itu (durasi yang tak ada di tabel dibulatkan ke atas). Kalau tamunya banyak untuk durasi itu, boleh sampaikan jujur sekali sebagai info + satu opsi naik dengan harganya; keputusan di klien.
- Template kosong atau isian minim → JANGAN menebak jenis acaranya. Beri gambaran harga netral (mulai 2 jam *Rp 2.000.000*, sudah all-in) lalu satu kalimat tanya acaranya apa dan tanggal berapa, supaya bisa cek slot dan kasih paket yang pas.
- Isian samar ("Oktober/November", tanggal tanpa tahun) → pakai yang sudah ada, pastikan yang perlu saja.

HARGA & PRICELIST (Rama 22 Okt, menggantikan aturan 1 Okt "tahan pricelist sampai kebutuhan jelas"; audit: 8 klien yang harganya ditahan semuanya hilang):
- Klien minta harga/PL → di balasan itu juga beri harga yang relevan. Kebutuhan cukup jelas → SATU paket yang pas + harga + alasan singkat. Belum jelas → harga mulai dan 2–3 paket utama (bukan seluruh daftar). Klien menyebut "PL/pricelist/daftar harga" → tulis juga [KIRIM: pricelist]. Boleh satu pertanyaan untuk mempersempit, tapi jangan menahan harga demi menggali dan jangan ceramah "bukan asal kirim daftar".
- Setiap kali [KIRIM: pricelist], tetap tulis SATU paket yang paling pas + harganya sebagai teks (bukan seluruh daftar). Klien bilang gambar/file harganya tidak terlihat atau belum masuk → tulis harga 2–3 paket utamanya langsung di chat dan kirim ulang; JANGAN menjawab bahwa file "sudah terkirim" (usulan CS Mintet 5, disetujui Rama 22 Okt).
- Klien yang suka lihat-lihat sendiri atau menimbang paket: boleh sebut SEKALI bahwa semua paket, harga, dan tanggal kosong bisa dilihat dan dipesan langsung di https://booking.tetraphoto.com (Rama 22 Okt) — sebagai kemudahan, bukan desakan.
- Saran durasi: tamu ≤100 → 2–3 jam; 100–200 → 3–4 jam; >200 → 4 jam ke atas Ini patokan internal, bukan paksaan: kalau jam acaranya sudah fix, hormati. Boleh hitung tamu per jam dari angka klien (300 tamu / 3 jam = 100 orang per jam, hitung dengan benar), tapi JANGAN klaim kapasitas booth ("satu booth melayani 80 orang per jam", "4 jam muat 300 orang") — angka itu tidak ada di fakta resmi.
- Jangan menurunkan paket sendiri dari yang klien pilih, tapi harga pilihan klien sendiri SELALU disebut.
- "Mahal": akui → nilai all-in tanpa biaya tambahan → beri opsi nyata yang lebih ringan dari katalog (durasi lebih pendek, Photo Stage, dll.) atau tanya patokan budget. Diskon 10% hanya sesuai FAQ.
- "Bandingin dulu" / "lihat-lihat dulu": santai, satu pembeda (unlimited cetak, frame custom, softfile realtime), pintu tetap terbuka.
- "Diskusi dulu / tanya pasangan, keluarga, atasan": tawarkan ringkasan singkat yang bisa diteruskan (paket, harga, yang sudah termasuk); jangan tanya "kapan".

ADD-ON & UPSELL — boleh, tapi lihat kliennya (Rama 22 Okt):
- Snapbook = buku tamu versi kekinian (dulu Guest Cam), cetak foto tamu, TV Live Gallery: tawarkan HANYA kalau ada sinyal butuh (dia ingin semua tamu ikut foto/kenang-kenangan, tanya tambahan, budget longgar) atau setelah paket utama disepakati. Selama urusan photobooth utama belum beres, JANGAN tawarkan. Satu tawaran saja, tier ≥ jumlah tamu, harga persis dari FAQ KLIEN, jangan diulang kalau tidak direspons.
- "Tidak bisa" (mis. ganci di bawah 100 pcs, durasi di bawah 2 jam) → maaf singkat + alternatif nyata dari katalog kalau ada.

MENGUNCI TANGGAL — dipicu kesiapan klien, bukan kelengkapan data:
- Sinyal siap: tanya cara booking/DP/rekening, bilang cocok dengan paketnya, atau acara dekat dengan data lengkap. Saat itu arahkan ke https://booking.tetraphoto.com dan jelaskan singkat langkahnya (pilih acara & tanggal → paket → add-on → isi nama & WA → verifikasi WA → bayar DP min *Rp 500.000* lewat transfer di dashboard; tanggal DIKUNCI begitu bukti DP diunggah — pakai kata "dikunci"). Sebut 1–2 keunggulan dashboard yang relevan (FAQ KLIEN bagian Booking online). Klien yang lebih nyaman lewat chat, minta rekening, atau sudah transfer: tetap dilayani di chat (bukti DP diteruskan ke admin); nomor rekening hanya diberikan kalau dia minta atau memilih lewat chat.
- Tanggal + jam + paket sudah jelas dan dia tidak sedang ragu → tawarkan jalan mengunci singkat (link booking + "kalau mau aku bantu"), tanpa prosedur panjang.
- Belum ada sinyal siap (tanggal belum ada, masih menimbang, acara masih jauh): jangan sodorkan prosedur DP; cukup pastikan dia tahu tanggalnya bisa dikunci kapan pun dia siap (sekali saja).
- Riwayat berisi pesan portal booking ("[otomatis dari portal booking Tetra Ops]", "[otomatis: verifikasi portal booking]") = klien memakai booking.tetraphoto.com: untuk data acara, desain frame, pembayaran, dokumen, undang WO, dan pindah tanggal arahkan ke dashboard https://booking.tetraphoto.com/akun (sebut menu yang dimaksud); JANGAN minta data acara satu per satu di chat.

HARGA RESMI — PHOTOBOOTH CLASSIC UNLIMITED CETAK (paket lain, add-on, dan extend ada di FAQ KLIEN):
- 2 Jam  : Rp 2.000.000
- 3 Jam  : Rp 2.500.000
- 4 Jam  : Rp 3.000.000
- 5 Jam  : Rp 3.500.000
- 6 Jam  : Rp 4.000.000
- 8 Jam  : Rp 5.000.000
- Extend on the spot, per jam: Rp 500.000
- Durasi yang tidak ada di tabel (mis. 7 jam): JANGAN sebut "paket 7 jam". Tawarkan 6 jam + extend 1 jam (*Rp 4.000.000* + *Rp 500.000* = *Rp 4.500.000*, keputusan Rama 7 Okt) atau 8 jam (*Rp 5.000.000*). Durasi setengah jam (mis. 5,5 jam) dibulatkan ke paket di atasnya: 5,5 jam → *6 jam Rp 4.000.000*; jangan menulis harga gabungan hasil hitungan sendiri.

LEBIH DARI 1 UNIT (mis. "2 booth", "2 spot", "paket 3 jam x 2"): Tetra punya 3 unit, jadi satu acara bisa pakai 2–3 unit.
- Harga = harga paket per unit × jumlah unit, sebut per unitnya, mis. "*Rp 2.500.000*/unit × 2 = *Rp 5.000.000*". Tanpa diskon; harga spesial hanya dari admin.
- Cek jadwal dengan units = jumlah unit yang diminta. Jangan tanya jumlah unit kalau klien tidak menyebut (anggap 1).
- Klien minta lebih dari 3 unit: jangan janji, bilang admin yang cek, tambahkan [INFO_ADMIN: klien minta <n> unit].

SUDAH TERMASUK: cetak foto unlimited (2R photostrip, 4R, atau Polaroid), peralatan profesional (printer, kamera, lighting), setup + properti foto, crew, desain frame custom sesuai acara (logo/tema klien bisa dipakai; desain di-ACC klien sebelum hari H), softfile real-time via QR code, flashdisk kayu berisi seluruh file, backdrop basic, dan free transport se-Jabodetabek.

FAKTA LAIN:
- Booking dikonfirmasi dengan DP minimal Rp 500.000, pelunasan paling lambat H-1.
- Rekening BCA 0954965224 a.n. Muhamad Ramadan Saputra.
- Jam operasional 06.00–23.00 WIB. Basis Bogor.
- Galeri contoh hasil: https://tetraphoto.com/galeri

ATURAN ANTI-HALUSINASI — TIDAK BOLEH DILANGGAR:
- Angka di atas dan di FAQ KLIEN SATU-SATUNYA sumber harga. JANGAN mengarang, menaksir, atau membulatkan. Diskon hanya menurut aturan di FAQ.
- Jangan mengarang fakta operasional: jumlah crew, jam kedatangan crew, ukuran area/backdrop, lama setup, jumlah unit, add-on, prosedur yang tidak tertulis di sini. Kalau ditanya, bilang admin yang konfirmasi detailnya.
- Jangan pura-pura kenal venue ("tempatnya adem dan luas"). Kamu belum tentu pernah ke sana.
- Yang tidak ada di daftar harga maupun FAQ (paket custom, biaya transport luar Jabodetabek/Magazine Box, harga backdrop Luxury): bilang terus terang admin yang info harganya, tetap layani pertanyaan lain.
- Fakta operasional (transport, kebutuhan venue, backdrop, format cetak, pajak, promo, setelah DP) ada di FAQ KLIEN di bawah. Yang tidak tertulis di sini maupun di FAQ jangan dijawab dengan tebakan; kalau itu inti pertanyaannya, pakai HANDOFF.
- Sebelum bilang "aku cek/tanyain ke admin", baca dulu pesan ADMIN di riwayat (berawalan "(admin)"). Kalau admin sudah menjawab hal itu (mis. "paling lambat Rabu", "aman insyaallah"), pakai jawaban itu — jangan bertanya ulang ke admin.
- "Boleh/iya/mau/oke" dari klien = setuju dengan tawaran TERAKHIR kita (mis. kirim contoh hasil) → langsung lakukan tawaran itu, jangan ganti topik.
- "[kirim gambar]" tanpa keterangan BUKAN bukti transfer atau desain final: tanggapi sesuai konteks (mis. "makasih Kak, referensinya aku teruskan ke admin desain"), jangan menyimpulkan isinya.
- Jangan menyebut nama klien, acara, venue, atau rekanan lain yang tidak ada di percakapan ini. Jangan menjanjikan dokumen yang tidak ada (company profile, proposal PDF, brosur fisik, materi khusus): yang ada hanya lampiran di daftar LAMPIRAN dan galeri https://tetraphoto.com/galeri. Jangan janji mengirim email, menelepon, atau mengantar barang.
- Snapbook: pilih tier yang SAMA ATAU LEBIH BESAR dari jumlah tamu; tamu di atas 500 (atau rentangnya melewati 500) → tak terbatas.
- Jawab MAKSUD pesan TERAKHIR klien. Topik baru jangan dijawab dengan topik lama: minta unduh/softfile foto acara ≠ pricelist, tanya lowongan kerja ≠ cek tanggal kosong, komplain ≠ jualan.
- Pertanyaan di luar sewa photobooth yang jawabannya tidak ada di sini (lowongan kerja/magang, dll): jangan mengarang. Bilang nanti tim yang kabari, lalu [INFO_ADMIN: <topiknya>].
- Kamu TIDAK BISA melihat gambar/dokumen/voice note (jangan menebak isinya; kalau perlu tanya singkat maksudnya) dan TIDAK BISA mengecek rekening. JANGAN PERNAH bilang DP/pembayaran sudah masuk, sudah diterima, atau slot sudah resmi/pasti diamankan. Kalau klien bilang sudah transfer, minta kirim foto bukti transfernya; konfirmasi pembayaran selalu dari admin.
- Riset harga / benchmark / survei vendor: jawab rate card standar apa adanya (harga + yang termasuk). Jangan tanya skema kerja sama, bagi hasil, atau sponsor.

BUKAN CALON KLIEN — balas persis "[DIAM]" (tanpa teks lain) kalau pesannya bukan obrolan dengan Tetra soal jasa photobooth: ucapan selamat/doa/broadcast ke banyak orang, auto-reply bot lain, promosi vendor, pesan salah kirim. Termasuk usaha lain (bakery, catering, dekor, MUA, WO) yang mengirim ucapan selamat untuk pengantin/klien mereka atau portofolio acara: itu broadcast, BUKAN permintaan photobooth, walaupun menyebut pernikahan/tanggal/kota. Jangan tanya tanggal acaranya. Kalau usaha lain terang-terangan mengajak kenalan/kerja sama, ikuti bagian VENDOR / REKANAN (calon rekanan baru). Kalau ragu, balas biasa.

CEK JADWAL:
Kamu punya alat cek_ketersediaan yang membaca jadwal asli Tetra Ops. Begitu tanggal disebut, panggil alat itu SEKALI — jangan menebak, jangan bilang "nanti aku cek" lalu diam. Hasilnya cukup disampaikan sekali; jangan cek ulang tanggal yang sama kecuali jamnya berubah. Kalau jam belum disebut, cek tanggalnya dulu lalu tanyakan jam. Kalau klien belum tahu jamnya, catat "jam menyusul" dan lanjut ke booking. Kalau alatnya gagal, bilang apa adanya bahwa jadwal sedang tidak bisa dibaca dan admin yang bantu.

LAMPIRAN — tambahkan di baris paling akhir (tidak terlihat klien), SEKALI per percakapan:
- "[KIRIM: backdrop]" kalau klien menanyakan pilihan/warna backdrop atau background basic. Kalimatmu cukup sebut warnanya singkat dan bilang contohnya aku kirim.
- "[KIRIM: katalog]" kalau klien minta contoh/pilihan desain frame sebelum DP.
- "[KIRIM: layout]" kalau klien bingung/menanyakan bedanya 2R (photostrip), 4R, dan Polaroid, bentuknya seperti apa, atau layout/pose yang bisa dipilih.
- "[KIRIM: panduan]" kalau klien mau mendesain frame sendiri, minta template/ukuran canvas/"sample template untuk cetak". PDF ini sudah memuat halaman layout, jadi tidak perlu [KIRIM: layout] juga.
- "[KIRIM: skema]" kalau kamu menjelaskan skema/tawaran kerja sama rekanan (komisi 10% atau potongan 10%) ke WO/EO/venue/vendor: satu gambar ilustrasi dua skema + contoh angka. Teksmu tetap singkat (gambar yang menjelaskan detailnya).
- "[KIRIM: pricelist]" sesuai aturan HARGA & PRICELIST di atas (klien menyebut PL/pricelist/daftar harga). Yang terkirim: satu gambar harga Unlimited Photobooth (PDF lengkap ikut hanya kalau klien minta semua layanan/360/Magazine/Photo Stage/PDF). Jangan ulang isinya di chat.
- JANGAN kirim link halaman website (tetraphoto.com/pricelist) untuk harga; klien di HP jadi bingung. Kalau klien minta link unduhan, beri link file langsung: https://tetraphoto.com/pricelist-tetra-photobooth-2026.pdf (langsung tersimpan saat diklik).
Jangan pakai penanda ini kalau di riwayat file yang sama sudah pernah dikirim.

PENAWARAN RESMI / QUOTATION — kalau klien minta penawaran resmi, quotation, atau surat penawaran (umumnya korporat/instansi):
- Pastikan dulu datanya cukup: nama klien atau instansi (+ nama PIC untuk "u.p."), layanan + durasi (+ format cetak kalau photobooth), dan kota/venue. Tanggal, jam, jumlah tamu, add-on, backdrop, dan perlu-tidaknya pajak dicantumkan ikut kalau sudah disebut. Tanyakan yang kurang, maks 2 per pesan.
- Kalau sudah cukup: balas bahwa penawarannya kamu siapkan dan dicek admin dulu, nanti PDF-nya dikirim di chat ini (jangan janji jam pasti, jangan sebut diskon). Lalu di baris paling akhir tulis "[QUOTATION]".
- Kalau klien mengubah isi setelah itu (mis. durasi), boleh "[QUOTATION]" lagi untuk penawaran baru.

VENDOR / REKANAN — kalau konteks menyebut "KONTAK INI VENDOR REKANAN", ikuti ATURAN VENDOR di konteks itu (gaya akrab, harga khusus vendor, tanpa perkenalan & tanpa gaya sales, JANGAN sebut harga publik). Kalau pengirim mengaku WO/EO/vendor/party planner tapi TIDAK ada konteks itu: layani ramah (info umum, cek jadwal), bilang harga kerja sama untuk rekanan dibahas langsung dengan admin, jangan jadikan harga publik sebagai harga final untuk mereka, dan tambahkan [INFO_ADMIN: calon rekanan baru <nama usaha>].

KAMU TIDAK BISA MENGUBAH DATA — kamu tidak punya akses ke sistem jadwal/booking Tetra Ops. JANGAN PERNAH bilang sudah memperbarui, mengubah, menggeser, menjadwalkan ulang, membatalkan, mengamankan slot, atau mengonfirmasi sesuatu (mis. "sudah aku perbarui jadwalnya"). Itu bohong dan berbahaya. Permintaan perlengkapan/acara (backdrop, frame, jam) dari klien atau vendor juga JANGAN dijawab "sudah dicatat/disiapkan/siap dibawa tim" — bilang "aku teruskan ke admin ya" (data booking yang kamu catat di tahap booking setelah DP adalah pengecualian).
- Klien yang sudah booking minta ubah sesuatu (jam, tanggal, lokasi, paket/durasi, add-on, backdrop, batal/reschedule): bilang permintaannya kamu teruskan ke admin untuk dicek dan diperbarui, nanti admin yang konfirmasi di chat ini. Jangan bilang "bisa" atau "aman" dulu; boleh bilang slot jam itu masih kosong kalau hasil cek jadwal memang kosong, tapi tetap admin yang mengubah.
- Lalu di baris paling akhir tulis "[PERUBAHAN: <apa> | <nilai lama kalau tahu> -> <nilai baru>]", contoh "[PERUBAHAN: jam | 08.00 -> 10.00-13.00]". Satu penanda per permintaan.

INFO KE ADMIN TANPA BERHENTI — untuk hal yang jawabannya dari admin tapi percakapan tetap kamu layani (tanya promo, backdrop custom/Luxury, hal "admin yang konfirmasi" di FAQ): tulis balasan biasa ke klien (bilang admin yang akan info bagian itu), lalu di baris paling akhir tambahkan "[INFO_ADMIN: <topik singkat>]". Penanda ini tidak terlihat klien. Cukup sekali per topik; jangan ulang kalau di riwayat kamu sudah bilang admin akan info topik yang sama.

SETELAH HANDOFF — kalau di riwayat kamu sudah meneruskan ke admin tapi belum ada balasan admin (pesan berawalan "(admin)") dan klien chat lagi, admin sedang belum sempat. Lanjut layani semua yang bisa kamu jawab. Untuk hal yang tetap butuh admin, bilang sudah diteruskan dan admin akan membalas; jangan pakai [ADMIN_HANDOFF] lagi untuk hal yang sama.

RIWAYAT — pesan berawalan "(admin)" adalah balasan manual admin Tetra: itu keputusan resmi, ikuti dan jangan dibantah. Pesan berawalan tanggal dalam kurung adalah chat lama. "CATATAN KLIEN" di bawah adalah ringkasan percakapan lama; pakai supaya tidak tanya ulang.

IDENTITAS — sebut dirimu "tim Tetra" (mis. "aku dari tim Tetra"), JANGAN "admin Tetra": urusan khusus kamu teruskan ke admin/owner, jadi kalau kamu mengaku admin lalu bilang "aku teruskan ke admin" itu bertabrakan (insiden 8 Okt).

ACARA DADAKAN — calon klien yang BELUM booking butuh photobooth HARI INI atau BESOK (klien yang sudah booking dan mengingatkan acaranya BUKAN dadakan: konfirmasi santai, jangan ragukan crew/alat): JANGAN bilang "bisa", "bisa diusahakan", atau "masih kosong" walaupun cek jadwal kosong (crew & alat harus dicek admin). Tanyakan yang belum diketahui (lokasi, jam mulai, durasi, jenis acara) dalam satu pesan, bilang kamu langsung kabari admin supaya dikonfirmasi secepatnya, dan tambahkan [INFO_ADMIN: DADAKAN <tanggal> <lokasi/jam kalau ada>].

DI LUAR LAYANAN — Tetra hanya menyewakan jasa photobooth lengkap (alat + crew + cetak). Tetra TIDAK menyewakan akun/lisensi software photobooth (mis. dslrBooth, "sewa akunnya saja") dan tidak menyewakan alat tanpa crew. Baca dulu maksud klien: "sewa DSLR booth / dslrBooth + sewa akunnya" = software, bukan jasa kita. Jawab sopan bahwa itu tidak tersedia, lalu tawarkan jasa photobooth lengkap kalau acaranya cocok. Jangan handoff untuk ini.

HANDOFF — tulis SATU kalimat singkat yang menyebut hal spesifik yang kamu cek ke admin/owner (mis. "Soal harga 5 unit aku cek dulu ke admin ya Kak, nanti aku kabari di sini."), lalu "[ADMIN_HANDOFF]" di akhir, dan berhenti, ketika:
- Minta kontrak, invoice, PO, kwitansi. (Penawaran resmi/quotation: ikuti bagian PENAWARAN RESMI, bukan handoff.)
- Produk yang tidak ada di katalog FAQ (mingle, instant photobooth, cetak foto saja). Software/akun: ikuti DI LUAR LAYANAN, bukan handoff.
- Batal atau reschedule booking.
- Klien komplain atau minta bicara manusia.
- Ditanya hal yang tidak kamu ketahui faktanya.`;

// Model tidak punya jam. Tanpa ini dia menjawab "besok tanggal berapa?" -- yang
// justru harus dia yang tahu. Dihitung tiap panggilan, bukan saat start, supaya
// tidak basi di proses yang hidup berhari-hari.
function konteksWaktu() {
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][wib.getUTCDay()];
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
    'Agustus', 'September', 'Oktober', 'November', 'Desember'][wib.getUTCMonth()];
  const tgl = `${hari}, ${wib.getUTCDate()} ${bulan} ${wib.getUTCFullYear()}`;
  const jam = String(wib.getUTCHours()).padStart(2, '0') + '.' + String(wib.getUTCMinutes()).padStart(2, '0');
  return `\n\nWAKTU SEKARANG: ${tgl}, pukul ${jam} WIB.\n` +
    `Pakai ini untuk mengartikan "besok", "minggu depan", "weekend ini" dan sejenisnya. ` +
    `Jangan balik bertanya tanggal berapa besok -- kamu sudah tahu.`;
}

// Penjaga harga (keputusan: zero mistake soal angka). Setiap nominal rupiah di
// balasan harus muncul di sumber yang dilihat model (daftar harga, FAQ, konteks
// vendor, chat termasuk harga dari admin, hasil alat) atau turunan wajarnya:
// × 2/3 unit, diskon 10%, jumlah/selisih dua nominal. TGO tidak punya ini.
function angkaRupiah(teks) {
  const out = [];
  const re = /(rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)?(?![\w])/gi;
  for (const m of String(teks).matchAll(re)) {
    const sat = (m[3] || '').toLowerCase();
    const ribuan = /^\d{1,3}([.,]\d{3})+$/.test(m[2]);
    let n = ribuan ? Number(m[2].replace(/[.,]/g, '')) : Number(m[2].replace(',', '.'));
    // Tanpa "Rp"/satuan: hanya angka berpemisah ribuan >= 100.000 (admin sering tulis "2.300.000").
    if (!m[1] && !sat && !(ribuan && n >= 100000)) continue;
    if (sat === 'jt' || sat === 'juta') n *= 1e6;
    else if (sat === 'rb' || sat === 'ribu' || sat === 'k') n *= 1e3;
    if (n >= 10000) out.push(Math.round(n));
  }
  return out;
}
// Insiden 14 Okt (klien Rakha): dengan reasoning_effort "low" Gemini kadang menulis pikirannya di content
// (kutip aturan diskon, draf, "Cek aturan:") lalu jawaban di ujung — semuanya terkirim ke klien. Tanda bocor:
// ≥2 kalimat aturan prompt/strategi tersalin utuh (satu saja bisa template sah, mis. skema kerja sama vendor),
// atau baris khas catatan internal.
// DeepSeek berpikir dalam bahasa Inggris ("We need...", "The user...") — penandanya ikut dijaga.
const RE_PIKIRAN = /^\s*(?:[-*]\s*)?(?:aturan\b|cek aturan|klien (?:bilang|cuma|sudah|minta|mau|menanyakan)\b|mari\b|tunggu[:,]|wait\b|balasan (?:singkat|final|untuk klien)|atau lebih natural|jadi:|draf\b|we (?:need|should|must)\b|let me\b|let's\b|the (?:user|client|customer)\b|i (?:need|should|will|must)\b|okay,? (?:so|let)|hmm\b|final (?:answer|reply)\b|draft\b)/im;
function bocorPikiran(teks) {
  if (RE_PIKIRAN.test(teks)) return true;
  const t = normal(teks);
  return (SYSTEM_PROMPT + '\n' + strategi()).split(/\n|(?<=[.!?])\s+/)
    .map((s) => normal(s.replace(/^[\s\-*\d.)]+/, '')))
    .filter((s) => s.length >= 40 && t.includes(s)).length >= 2;
}
// Aturan gaya yang tetap dilanggar walau tertulis di prompt (uji buta 14 Okt, 104 pasang Gemini vs DeepSeek: kata
// terlarang 7×, "saya", balasan 4 paragraf). Dicek di kode. Daftar kata dibaca dari baris "DILARANG kata robot" di
// prompt, jadi sumbernya tetap satu.
const KATA_TERLARANG = [...(SYSTEM_PROMPT.match(/DILARANG kata robot:(.*)/)?.[1] || '').matchAll(/"([^"]+)"/g)]
  .map((m) => m[1].toLowerCase().replace(/\?$/, ''));
const isiKlien = (teks) => teks.replace(/\[[A-Z_]+[^\]]*\]/g, '').replace(/https?:\S+/g, '').trim();
function masalahGaya(teks) {
  const isi = isiKlien(teks);
  const t = normal(isi);
  const out = [];
  const kata = KATA_TERLARANG.filter((k) => t.includes(k));
  if (kata.length) out.push(`kata terlarang: ${kata.map((k) => `"${k}"`).join(', ')}`);
  if (/\bsaya\b/i.test(isi)) out.push('sebut diri "aku", bukan "saya"');
  if (/\bkamu\b/i.test(isi)) out.push('sapa klien "Kak", bukan "kamu"');
  const klaim = isi.match(RE_KLAIM_AKSI);
  if (klaim) {
    out.push(`klaim tindakan yang tidak bisa kamu lakukan ("${klaim[0]}"): kamu tidak bisa melihat gambar/rekening, mengirim email, ` +
      'mengantar barang, atau mendaftarkan rekanan. Bilang akan diteruskan ke admin, lalu tambahkan [INFO_ADMIN: <apa yang perlu dilakukan>]');
  }
  if ((isi.match(/\p{Extended_Pictographic}/gu) || []).length > 1) out.push('emoji maksimal 1');
  if ((isi.match(/\?/g) || []).length > 2) out.push('maksimal 2 pertanyaan');
  // Panjang sengaja TIDAK dicek (Rama 22 Okt: "panjang pendek tidak merepresentasikan kualitas"; data: 200–400
  // karakter dibalas 89%, <200 cuma 67%). Ukurannya tepat sasaran — dijaga lewat aturan prompt.
  return out;
}
// Klaim tindakan yang bot tidak bisa lakukan (audit 22 Okt, 6 kasus nyata): gambar dianggap bukti transfer "udah masuk",
// "masuk skema rekanan", "materi udah aku siapin", janji kirim/hubungi lewat email, "diantar ke kantor". Diuji ke seluruh
// riwayat: 6 kena, semuanya klaim palsu ("aku catat" sengaja tidak dijaga — sah di tahap isi data booking).
const RE_KLAIM_AKSI = new RegExp([
  '\\b(bukti\\s+)?(transfer|tf|dp|pembayaran|pelunasan)(nya)?\\s+(sudah|udah|telah)\\s+(masuk|diterima|kami terima|aku terima|lunas)',
  '\\bmasuk\\s+(skema|daftar)\\s+rekanan',
  '\\b(sudah|udah)\\s+(aku|kami)\\s+(siapin|siapkan|daftarkan|hubungi)\\b',
  '\\b(aku|kami|tim\\s+kami)\\s+(akan\\s+|nanti\\s+|segera\\s+)?(kirim(kan|in)?|hubungi)\\b[^.\\n?]{0,30}\\be-?mail\\b',
  '\\b(di)?antar(kan|in)?\\s+ke\\s+(kantor|alamat|rumah|venue)',
].join('|'), 'i');
const RE_JANJI_ADMIN = /\b(?:teruskan|terusin|tanyain|tanyakan|sampaikan|pastiin|pastikan|konfirmasi(?:kan)?|cek(?:in)?|kabarin)\b[^.\n?]{0,25}\b(?:ke|sama|dengan|dari) (?:admin|owner|tim)\b/i;
// Jaring terakhir kalau tulis ulang masih memuat kata terlarang: buang kalimatnya (baris penanda [..] tidak disentuh).
function buangKataTerlarang(teks) {
  const sisa = teks.split('\n').map((baris) => (baris.trim().startsWith('[') ? baris : baris.split(/(?<=[.!?])\s+/)
    .filter((k) => !KATA_TERLARANG.some((w) => normal(k).includes(w))).join(' ')))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return isiKlien(sisa) ? sisa : teks;
}
function hargaAsing(teks, sumber) {
  const dasar = [...new Set(angkaRupiah(sumber))];
  // Kelipatan 1–10 (unit, jam extend, pcs add-on) + diskon 10%; lalu jumlah dua
  // kelipatan (bundling, paket + extend: 10 jam = 5jt + 2×500rb) dan selisih (sisa pelunasan).
  const l1 = new Set();
  for (const a of dasar) { for (let k = 1; k <= 10; k++) l1.add(a * k); l1.add(Math.round(a * 0.9)); }
  const boleh = new Set(l1);
  const arr = [...l1];
  for (const x of arr) for (const y of arr) boleh.add(x + y);
  for (const a of dasar) for (const b of dasar) boleh.add(Math.abs(a - b));
  // ponytail: kombinasi di atas rapat (ada add-on 100–200rb), jadi harga karangan yang
  // bulat bisa lolos. Risiko terbesar = harga paket Classic salah durasi: dicek tajam di bawah.
  const salah = angkaRupiah(teks).filter((n) => !boleh.has(n));
  const tabel = {};
  for (const m of String(sumber).matchAll(/-\s*(\d+)\s*Jam\s*:\s*Rp\s*([\d.]+)/gi)) tabel[m[1]] ||= Number(m[2].replace(/\./g, ''));
  // Pesan yang menyebut layanan lain: harga per durasi dari SEMUA layanan ("6 jam Rp 4.500.000" sah untuk 360, walau
  // barisnya tidak menyebut "360"). Pesan Classic saja tetap dicocokkan ketat ke tabel Classic.
  const layananLain = /360|videobooth|magazine|photo ?stage/i.test(teks);
  const perDurasi = {};
  for (const m of String(sumber).matchAll(/(\d+)\s*jam\s*:?\s*Rp\s*([\d.]+)/gi)) {
    (perDurasi[m[1]] ||= new Set()).add(Number(m[2].replace(/\./g, '')));
  }
  // Harga khusus = nominal yang tertulis di luar daftar harga & FAQ umum (konteks vendor, chat admin).
  const khusus = angkaRupiah(String(sumber).split(SYSTEM_PROMPT).join('').split(strategi()).join('').split(faq()).join(''));
  const nilaiTabel = new Set(Object.values(tabel).flatMap((v) => [v, v * 2, v * 3, Math.round(v * 0.9)]));
  for (const baris of String(teks).split('\n')) {
    if (/360|videobooth|magazine|photo ?stage/i.test(baris)) continue;
    // "5,5 jam" bukan "5 jam", dan harga sesudah durasi lain di baris yang sama ("5,5 jam → ambil 6 Jam Rp 4.000.000")
    // milik durasi itu (salah tangkap 21 Okt: klien Elqi dioper ke admin padahal 6 jam Rp 4.000.000 benar).
    for (const m of baris.matchAll(/(?<![\d.,])(\d+)\s*jam\b([^\n]{0,40})/gi)) {
      const resmi = layananLain ? [...(perDurasi[m[1]] || [])] : [tabel[m[1]]];
      const n = angkaRupiah(m[2].split(/\d+(?:[.,]\d+)?\s*jam/i)[0])[0];
      if (!tabel[m[1]] || !n) continue;
      const cocok = resmi.some((r) => [r, r * 2, r * 3, Math.round(r * 0.9)].includes(n));
      const hargaKhusus = !nilaiTabel.has(n) && khusus.includes(n); // harga vendor / dari admin di chat
      if (!cocok && !hargaKhusus && !salah.includes(n)) salah.push(n);
    }
  }
  return salah;
}

// Log pemakaian AI per panggilan (token, alat) → data/llm-usage.jsonl, untuk hitung
// biaya & audit. ponytail: file tumbuh ±150 KB/hari, rotasi kalau sudah jadi masalah.
const USAGE_FILE = path.join(__dirname, '..', '..', 'data', 'llm-usage.jsonl');
function catatPemakaian(model, data, msg) {
  const u = data?.usage || {};
  const baris = { t: Date.now(), model, masuk: u.prompt_tokens || 0, keluar: u.completion_tokens || 0,
    alat: (msg?.tool_calls || []).map((c) => c.function?.name) };
  fs.appendFile(USAGE_FILE, JSON.stringify(baris) + '\n', () => {});
}

async function kirim({ url, key, model, effort }, messages, pakaiAlat = true) {
  const body = { model, messages, temperature: 0.4, stream: false };
  if (effort) body.reasoning_effort = effort;
  if (pakaiAlat && availAktif()) body.tools = TOOLS;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const msg = data?.choices?.[0]?.message;
  catatPemakaian(model, data, msg);
  if (!msg) throw new Error('balasan kosong dari model');
  return msg;
}

async function panggil(endpoint, history, message, leadContext) {
  const konteksLead = leadContext
    ? `\n\nKONTEKS LEAD (dari deteksi & riwayat):\n${leadContext}\nJadikan ini acuan — jangan tanya ulang yang sudah diketahui. Yang kurang ditanya sekaligus, maksimal 2 hal.`
    : '';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + strategi() + faq() + pelajaran() + konteksWaktu() + konteksLead },
    ...history, // bentuk OpenAI: { role: 'user' | 'assistant', content }
    { role: 'user', content: message },
  ];

  // Maksimal dua putaran: model minta data jadwal -> kita jawab -> model menulis
  // balasan final. Dibatasi supaya satu pesan pelanggan tidak pernah berubah
  // jadi rantai panggilan tak berujung.
  for (let putaran = 0; putaran < 2; putaran++) {
    const msg = await kirim(endpoint, messages);
    const panggilanAlat = msg.tool_calls || [];
    if (!panggilanAlat.length) {
      let teks = (msg.content || '').trim();
      if (!teks) throw new Error('balasan kosong dari model');
      // Sumber harga diambil SEBELUM koreksi: balasan salah yang didorong ke messages tidak boleh ikut jadi "sumber"
      // (dulu nominal karangan yang diulang di tulis ulang jadi lolos).
      const sumberHarga = messages.map((m) => m.content || '').join('\n');
      if (bocorPikiran(teks)) {
        console.log(`[bocor ${endpoint.model}] pikiran model ikut di balasan — minta tulis ulang: ${teks.slice(0, 120)}`);
        messages.push({ role: 'assistant', content: teks }, { role: 'user', content:
          'KOREKSI SISTEM: balasan tadi memuat catatan/pikiran internal dan kutipan aturan. Klien TIDAK BOLEH melihat ' +
          'itu. Tulis ulang HANYA pesan final yang dikirim ke klien, tanpa analisis, tanpa kutipan aturan.' });
        teks = ((await kirim({ ...endpoint, effort: '' }, messages, false)).content || '').trim();
        if (!teks || bocorPikiran(teks)) {
          console.log(`[bocor ${endpoint.model}] tulis ulang masih bocor — diteruskan ke admin, tidak dikirim ke klien`);
          return '[ADMIN_HANDOFF]';
        }
      }
      // Model kadang mengulang persis pesannya sendiri (uji replay 22 Okt #14) → tulis ulang sekali.
      const sekarang = normal(isiKlien(teks));
      const kembar = sekarang.length > 40 && history.filter((m) => m.role === 'assistant').slice(-4)
        .some((m) => { const dulu = normal(isiKlien(String(m.content))); return dulu.length > 40 && (dulu.includes(sekarang) || sekarang.includes(dulu)); });
      if (kembar) {
        console.log(`[ulang ${endpoint.model}] balasan sama dengan pesan sebelumnya — minta tulis ulang: ${teks.slice(0, 80)}`);
        messages.push({ role: 'assistant', content: teks }, { role: 'user', content:
          'KOREKSI SISTEM: balasanmu sama dengan pesan yang sudah kamu kirim sebelumnya. Tulis balasan BARU yang menanggapi pesan terakhir klien.' });
        const ulang = ((await kirim({ ...endpoint, effort: '' }, messages, false)).content || '').trim();
        if (ulang && !bocorPikiran(ulang)) teks = ulang;
      }
      const gaya = masalahGaya(teks);
      if (gaya.length) {
        console.log(`[gaya ${endpoint.model}] ${gaya.join('; ')} — minta tulis ulang: ${teks.slice(0, 120)}`);
        messages.push({ role: 'assistant', content: teks }, { role: 'user', content:
          `KOREKSI SISTEM: perbaiki balasan tadi — ${gaya.join('; ')}. Isi, maksud, dan penanda [..] tetap sama. ` +
          'Tulis HANYA pesan final untuk klien.' });
        const ulang = ((await kirim({ ...endpoint, effort: '' }, messages, false)).content || '').trim();
        if (ulang && !bocorPikiran(ulang)) teks = ulang;
        teks = buangKataTerlarang(teks);
        if (RE_KLAIM_AKSI.test(isiKlien(teks))) {
          console.log(`[klaim ${endpoint.model}] masih mengklaim tindakan setelah tulis ulang — diteruskan ke admin`);
          return '[ADMIN_HANDOFF]';
        }
      }
      let asing = hargaAsing(teks, sumberHarga);
      if (asing.length) {
        console.log(`[harga ${endpoint.model}] nominal tanpa sumber ${asing.join(', ')} — minta tulis ulang: ${teks.slice(0, 120)}`);
        messages.push({ role: 'assistant', content: teks }, { role: 'user', content:
          `KOREKSI SISTEM: nominal ${asing.map((n) => 'Rp ' + n.toLocaleString('id-ID')).join(', ')} tidak ada di daftar harga, FAQ, maupun chat. ` +
          'Tulis ulang balasan untuk klien HANYA dengan harga resmi; kalau harganya memang tidak ada, bilang admin yang info.' });
        teks = ((await kirim(endpoint, messages, false)).content || '').trim();
        asing = hargaAsing(teks, sumberHarga);
        if (!teks || asing.length || bocorPikiran(teks)) {
          console.log(`[harga ${endpoint.model}] masih ada nominal tanpa sumber ${asing.join(', ')} — diteruskan ke admin`);
          // Vendor rekanan jangan merasa dilempar bot (Rama): kalimat santai + info admin, tanpa pause.
          return /VENDOR REKANAN/.test(leadContext || '')
            ? 'Bentar ya, harganya aku pastiin dulu ke admin hehe.\n[INFO_ADMIN: harga untuk vendor perlu dicek admin]'
            : '[ADMIN_HANDOFF]';
        }
      }
      // Janji "aku teruskan ke admin" tanpa penanda = admin tidak pernah tahu, klien menunggu selamanya (uji 14 Okt:
      // DeepSeek di kasus nego). Penanda ditambahkan di kode.
      if (RE_JANJI_ADMIN.test(isiKlien(teks)) && !/\[(INFO_ADMIN|ADMIN_HANDOFF|SULIT|QUOTATION|PERUBAHAN)/i.test(teks)) {
        console.log(`[janji ${endpoint.model}] janji ke admin tanpa penanda — INFO_ADMIN ditambahkan: ${teks.slice(0, 80)}`);
        teks += `\n[INFO_ADMIN: klien menunggu jawaban admin soal "${String(message).replace(/[[\]\n]+/g, ' ').slice(0, 80)}"]`;
      }
      return teks.replace(/^\(admin\)\s*/i, ''); // jangan pernah menyamar jadi pesan admin di riwayat
    }

    messages.push(msg);
    for (const tc of panggilanAlat) {
      let hasil;
      try {
        const arg = JSON.parse(tc.function?.arguments || '{}');

        // Bedakan "datanya kurang" dari "sistemnya rusak". Tanpa ini model bilang
        // "jadwal tidak bisa dibaca" padahal pelanggan cuma belum menyebut jam --
        // bot jadi terdengar rusak, dan pelanggan diminta menunggu admin sia-sia.
        if (!arg.date) {
          hasil = JSON.stringify({
            status: 'tanggal_belum_disebut',
            instruksi: 'Tanyakan tanggal acaranya. Jangan bilang sistem bermasalah.',
          });
          console.log('[ai] cek_ketersediaan dilewati: tanggal belum disebut');
        } else if (!arg.start || !arg.end) {
          // Jam belum disebut -> cek SEHARI PENUH. Aturan Tetra: ada 3 unit, jadi
          // selama belum ketiganya terpakai, tanggal itu masih bisa dilayani.
          // Jamnya tetap ditanyakan, tapi untuk memastikan slot, bukan untuk tahu
          // tanggalnya kosong atau tidak.
          const sehari = await checkAvailability({ ...arg, start: '00:00', end: '23:59' });
          if (!sehari) {
            hasil = JSON.stringify({
              status: 'gagal_baca',
              instruksi: 'Jadwal benar-benar tidak terbaca. Bilang apa adanya, tawarkan dibantu admin.',
            });
          } else if (!sehari.available && sehari.units_free > 0) {
            // Klien minta >1 unit, sisa unit kurang.
            hasil = JSON.stringify({
              status: 'unit_tidak_cukup',
              tanggal: arg.date,
              unit_diminta: sehari.units_requested,
              unit_kosong: sehari.units_free,
              instruksi:
                `Tanggal ini hanya sisa ${sehari.units_free} unit, klien minta ${sehari.units_requested}. ` +
                'Bilang apa adanya, tawarkan jumlah unit yang tersisa atau tanggal lain; jangan janji. ' +
                'Tambahkan [INFO_ADMIN: klien minta ' + sehari.units_requested + ' unit, sisa ' + sehari.units_free + '].',
            });
          } else if (sehari.available) {
            hasil = JSON.stringify({
              status: 'tanggal_masih_tersedia',
              tanggal: arg.date,
              unit_kosong: sehari.units_free,
              unit_total: sehari.units_total,
              instruksi:
                'Tanggal ini MASIH BISA dilayani. Bilang masih tersedia, lalu tanyakan jam ' +
                'mulai dan selesai untuk memastikan slotnya. Jangan sebut jumlah unit ke pelanggan. ' +
                'Kalau pelanggan belum tahu jamnya, itu TIDAK masalah: catat sebagai "jam menyusul ' +
                '(to be confirmed)" dan lanjut saja ke langkah booking. Jangan memaksa, jangan mengulang pertanyaan.',
            });
          } else {
            hasil = JSON.stringify({
              status: 'tanggal_penuh',
              tanggal: arg.date,
              instruksi:
                'Ketiga unit sudah terpakai seharian di tanggal ini. Bilang penuh dengan sopan, ' +
                'lalu tawarkan tanggal lain.',
            });
          }
          console.log(`[ai] cek_ketersediaan ${arg.date} (sehari): ` +
            (sehari ? `${sehari.units_free}/${sehari.units_total} unit kosong, minta ${sehari.units_requested ?? 1}` : 'gagal'));
        } else {
          const data = await checkAvailability(arg);
          // Minta >1 unit tapi sisa kurang: admin perlu tahu (Tetra cuma punya 3).
          const kurangUnit = data && !data.available && data.units_free > 0;
          hasil = data
            ? JSON.stringify(kurangUnit ? {
                ...data,
                instruksi: `Hanya sisa ${data.units_free} unit, klien minta ${data.units_requested}. ` +
                  'Bilang apa adanya, tawarkan jumlah unit yang tersisa atau jam/tanggal lain; jangan janji. ' +
                  `Tambahkan [INFO_ADMIN: klien minta ${data.units_requested} unit, sisa ${data.units_free}].`,
              } : data)
            : JSON.stringify({
                status: 'gagal_baca',
                instruksi: 'Jadwal benar-benar tidak terbaca. Bilang apa adanya, tawarkan dibantu admin.',
              });
          console.log(`[ai] cek_ketersediaan ${arg.date} ${arg.start}-${arg.end}: ` +
            (data ? `${data.units_free}/${data.units_total} unit kosong, minta ${data.units_requested ?? 1}` : 'gagal'));
        }
      } catch (e) {
        hasil = JSON.stringify({ error: e.message });
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: hasil });
    }
  }

  throw new Error('model terus meminta alat tanpa menulis balasan');
}

// Klien cuma menutup ("ok", "noted", "makasih kak 🙏") setelah pesan terakhir kita yang bukan pertanyaan → diam, tanpa
// memanggil model. Uji buta 22 Okt: DeepSeek tetap membalas panjang (#110, #164: mengklaim "sudah masuk skema rekanan").
const RE_PENUTUP = /^(?:(?:ok(?:e|ay|eh)?|sip|siap|noted|baik|makasih|makasi|terima ?kasih|thanks?|thank you|thx|tq|sama[- ]sama|kembali kasih|mantap|oke deh|ya|iya|yaa|kak|ka|kk|mas|mba|mbak|min|banyak|deh|ya kak|👍|🙏|😊|🙂|👌)[\s,.!]*)+$/i;
function cumaMenutup(history, message) {
  const akhir = history.at(-1);
  return akhir?.role === 'assistant' && !String(akhir.content).includes('?') &&
    RE_PENUTUP.test(String(message).trim());
}
async function getAIResponse(history, message, leadContext) {
  if (cumaMenutup(history, message)) {
    console.log(`[diam-penutup] klien cuma menutup: ${String(message).slice(0, 60)}`);
    return '[DIAM]';
  }
  try {
    const jawab = await panggil(PRIMARY, history, message, leadContext);
    if (SHADOW) {
      const t = Date.now();
      panggil(SHADOW, history, message, leadContext)
        .then((b) => fs.appendFile(SHADOW_FILE, JSON.stringify({ t, ms: Date.now() - t, model: SHADOW.model,
          pesan: String(message).slice(0, 1500), utama: jawab, bayangan: b }) + '\n', () => {}))
        .catch((e) => console.error(`[bayangan] ${SHADOW.model} gagal: ${e.message}`));
    }
    return jawab;
  } catch (e) {
    console.error(`[ai] ${PRIMARY.model} gagal: ${e.message}`);
    // Cadangan pertama Gemini di Sumopod: 15 Okt DeepSeek kena 403 dari hulunya 3× dan balasan klien langsung jatuh
    // ke flash-lite 9Router (model paling lemah). Hulu beda = biasanya tetap hidup.
    if (CADANGAN.model !== PRIMARY.model) {
      try { return await panggil(CADANGAN, history, message, leadContext); }
      catch (e2) { console.error(`[ai] cadangan ${CADANGAN.model} gagal: ${e2.message}`); }
    }
    if (!FALLBACK.key || !process.env.AI_FALLBACK_BASE_URL) throw e;
    console.log('[ai] mencoba lewat 9Router...');
    return panggil(FALLBACK, history, message, leadContext);
  }
}

// Rangkum percakapan lama jadi catatan klien, supaya riwayat panjang tidak
// dibuang begitu saja dan AI tetap tahu fakta di awal chat.
async function ringkasPercakapan(ringkasanLama, pesan) {
  const teks = pesan.map((p) => `${p.role === 'user' ? 'KLIEN' : 'TETRA'}: ${p.content}`).join('\n');
  const messages = [
    { role: 'system', content:
      'Kamu pencatat CS Tetra Photobooth. Gabungkan CATATAN LAMA dan CHAT menjadi catatan klien ' +
      'ringkas berupa poin: nama/PIC, instansi, jenis acara, tanggal, jam, lokasi, jumlah tamu, paket/harga ' +
      'yang disepakati, diskon yang diberikan, status DP/pelunasan, permintaan khusus, janji Tetra, pertanyaan ' +
      'yang belum terjawab. Status DP/pelunasan HANYA dari pesan berawalan "(admin)"; klaim pembayaran lain ' +
      'tulis "klien bilang sudah transfer, belum diverifikasi admin". Tulis hanya fakta yang ada di chat, ' +
      'jangan menambah. Langsung poin tanpa kalimat pembuka. Maks 15 poin.' },
    { role: 'user', content: `CATATAN LAMA:\n${ringkasanLama || '(belum ada)'}\n\nCHAT:\n${teks}` },
  ];
  try {
    return ((await kirim(PRIMARY, messages, false)).content || '').trim();
  } catch (e) {
    if (!FALLBACK.key || !process.env.AI_FALLBACK_BASE_URL) throw e;
    return ((await kirim(FALLBACK, messages, false)).content || '').trim();
  }
}

// Isi form data acara dari chat (klien sering mencicil / menjawab di tengah
// obrolan). Hanya mengembalikan kolom yang disebut jelas; tebakan = kosong.
async function ekstrakBooking(dataLama, pesan, field) {
  const teks = pesan.map((p) => `${p.role === 'user' ? 'KLIEN' : 'TETRA'}: ${p.content}`).join('\n');
  const daftar = field.map(([k, label]) => `- ${k}: ${label}`).join('\n');
  const messages = [
    { role: 'system', content:
      'Kamu mengisi data booking photobooth dari chat WhatsApp. Kembalikan HANYA objek JSON tanpa teks lain. ' +
      'Kunci yang boleh:\n' + daftar + '\n- tanggal_iso: tanggal acara format YYYY-MM-DD\n' +
      'Isi hanya kolom yang dinyatakan jelas oleh klien, atau yang disepakati klien di chat (paket/jam yang ia setujui). ' +
      'Jangan menebak; kalau tidak ada, jangan tulis kuncinya. Tulis nilai ringkas apa adanya. ' +
      'Kalau klien mengoreksi nilai lama, pakai nilai terbaru. ' +
      'jumlah_unit: angka saja (mis. "2"), hanya kalau klien menyebut jumlah booth/unit/spot photobooth ' +
      '("2 booth", "dua unit", "2 spot", "paket 3 jam x 2"); jumlah tamu, jam, durasi, atau lembar foto BUKAN jumlah unit. ' +
      `Hari ini ${new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)}; kalau tanggal acara diketahui, ` +
      'WAJIB isi tanggal_iso (tahun tidak disebut = tanggal terdekat ke depan).' },
    { role: 'user', content: `DATA SAAT INI:\n${JSON.stringify(dataLama)}\n\nCHAT TERBARU:\n${teks}` },
  ];
  const ambil = async (ep) => (await kirim(ep, messages, false)).content || '';
  let raw;
  try { raw = await ambil(PRIMARY); }
  catch (e) { if (!FALLBACK.key || !process.env.AI_FALLBACK_BASE_URL) throw e; raw = await ambil(FALLBACK); }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

// Susun permintaan quotation (kontrak Tetra Ops /api/bot/quotation) dari chat.
// Harga TIDAK diisi di sini: Tetra Ops yang menghitung dari master paket/add-on.
async function ekstrakQuotation(pesan, ringkasan, namaAddon = []) {
  const teks = pesan.map((p) => `${p.role === 'user' ? 'KLIEN' : 'TETRA'}: ${p.content}`).join('\n');
  const hariIni = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const messages = [
    { role: 'system', content:
      'Susun permintaan penawaran (quotation) photobooth dari chat WhatsApp. Kembalikan HANYA objek JSON:\n' +
      '{"klien":{"nama":"nama instansi/perusahaan kalau korporat, kalau pribadi nama orang","organisasi":null,"attn":"nama PIC untuk u.p.","email":null},' +
      '"acara":{"judul":null,"jenis":"wedding|corporate|birthday|wisuda|gathering|instansi|reuni|event","tanggal":"YYYY-MM-DD","jam_mulai":"HH:MM","jam_selesai":"HH:MM","venue":null,"kota":null,"jumlah_tamu":null},' +
      '"layanan":[{"kategori":"photobooth_classic|videobooth_360|magazine_combo|magazine_box_only|photostage_only|photostage_combo","jam":3,"format":"2r|4r|polaroid","qty":1}],' +
      '"addons":[{"nama":"nama add-on","qty":1}],"backdrop":"White|Red|Silver|Gold|Emerald Green|Blue|Luxury #01|Luxury #02|dekorasi_klien","gross_up":false,"catatan":null}\n' +
      `Hari ini ${hariIni}; tanggal tanpa tahun = tanggal terdekat ke depan. gross_up true hanya kalau klien minta pajak dicantumkan. ` +
      'Isi hanya yang disebut/disepakati di chat; yang tidak ada tulis null (atau array kosong). Jangan menebak, jangan isi harga atau diskon. ' +
      'format hanya untuk photobooth; jam = durasi layanan dalam jam (bilangan bulat). ' +
      'qty = jumlah unit/booth layanan itu di acara yang sama ("2 booth", "x 2 unit"); tidak disebut = 1; jumlah tamu atau jam BUKAN qty. ' +
      (namaAddon.length ? `addons[].nama WAJIB persis salah satu dari: ${namaAddon.join(' | ')}. Add-on yang tidak ada di daftar masukkan ke catatan.` : '') },
    { role: 'user', content: `${ringkasan ? `CATATAN KLIEN:\n${ringkasan}\n\n` : ''}CHAT:\n${teks}` },
  ];
  const ambil = async (ep) => (await kirim(ep, messages, false)).content || '';
  let raw;
  try { raw = await ambil(PRIMARY); }
  catch (e) { if (!FALLBACK.key || !process.env.AI_FALLBACK_BASE_URL) throw e; raw = await ambil(FALLBACK); }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('ekstrak quotation: tidak ada JSON');
  return JSON.parse(m[0]);
}

// Penilai sebelum follow-up: baca SELURUH transkrip, putuskan pantas dikirimi
// pesan lanjutan atau tidak. Ragu, gagal, atau JSON rusak = TIDAK kirim.
async function nilaiFollowup(transkrip, ringkasan) {
  const messages = [
    { role: 'system', content:
      'Kamu supervisor CS Tetra Photobooth. Baca SELURUH transkrip chat WhatsApp di bawah dari awal sampai akhir, ' +
      'lalu putuskan apakah pantas mengirim pesan follow-up penjualan ke kontak ini SEKARANG. ' +
      'Kembalikan HANYA JSON: {"kirim":true|false,"status":"calon_klien_menggantung|sudah_menolak|pakai_vendor_lain|' +
      'bukan_calon_klien|vendor_atau_usaha_lain|menunggu_jawaban_tetra|menunggu_admin|sudah_deal|lainnya","alasan":"satu kalimat"}.\n' +
      'kirim=true HANYA kalau SEMUA benar:\n' +
      '1. Kontak jelas calon klien yang menanyakan jasa photobooth untuk acaranya sendiri.\n' +
      '2. Pesan terakhir dari TETRA/ADMIN dan pertanyaan klien sudah terjawab semua; klien yang belum membalas.\n' +
      '3. Klien TIDAK menolak, tidak bilang sudah pakai/booking vendor lain, tidak bilang batal/tidak jadi, tidak minta berhenti dihubungi.\n' +
      '4. Tidak ada urusan yang sedang menunggu admin (promo, diskon, harga khusus, quotation, keluhan, handoff).\n' +
      '5. Bukan usaha lain (bakery, dekor, MUA, WO, vendor), bukan ucapan selamat/broadcast/portofolio/promosi/salah kirim.\n' +
      '6. Belum DP/deal.\n' +
      '7. Kalau pesan klien terakhir "mau diskusi dulu / kabari nanti / info ke X dulu" atau penutup sopan (makasih/siap/ok), kirim=false kecuali pesan itu sudah ≥3 hari lalu (lihat jam di transkrip dan WAKTU SEKARANG).\n' +
      'Pesan ADMIN = keputusan resmi pemilik. Pernah dilayani admin BOLEH di-follow-up kalau urusan dengan admin sudah tuntas dan klien yang belum membalas; ' +
      'jangan kalau admin masih punya janji/urusan terbuka. Kalau ragu sedikit pun, kirim=false.' },
    { role: 'user', content: `${ringkasan ? `CATATAN KLIEN (chat lama):\n${ringkasan}\n\n` : ''}WAKTU SEKARANG: ${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} WIB\n\nTRANSKRIP:\n${transkrip}` },
  ];
  const ambil = async (ep) => (await kirim(ep, messages, false)).content || '';
  try {
    let raw;
    try { raw = await ambil(PRIMARY); }
    catch (e) { if (!FALLBACK.key || !process.env.AI_FALLBACK_BASE_URL) throw e; raw = await ambil(FALLBACK); }
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
    return { kirim: j.kirim === true, status: j.status || '?', alasan: j.alasan || '' };
  } catch (e) {
    return { kirim: false, status: 'gagal_nilai', alasan: e.message.slice(0, 100) };
  }
}

// Tamu minta foto/softfile acara (lib/galeri.js): ambil nama acara + tanggal dari chat dan/atau foto cetakan
// photobooth (nama & tanggal tercetak di frame). Model yang sama bisa melihat gambar (format image_url OpenAI).
async function ekstrakGaleri(teks, gambarB64) {
  const hariIni = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const isi = [{ type: 'text', text: `PESAN WHATSAPP:\n${teks || '(tanpa teks)'}` }];
  if (gambarB64) isi.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${gambarB64}` } });
  const messages = [
    { role: 'system', content:
      'Kamu membantu CS Tetra Photobooth. Kembalikan HANYA objek JSON tanpa teks lain:\n' +
      '{"minta_foto_acara": true|false, "cetakan_photobooth": true|false, "nama": "…"|null, "tanggal": "YYYY-MM-DD"|null}\n' +
      '- minta_foto_acara: pengirim meminta foto/softfile/link galeri dari acara yang SUDAH/SEDANG berlangsung (tamu atau klien). ' +
      'Calon klien yang minta CONTOH hasil, pricelist, atau tanya harga = false.\n' +
      '- cetakan_photobooth: gambar adalah foto hasil cetak photobooth (strip/frame berisi foto dan nama acara). Bukti transfer, screenshot, desain = false.\n' +
      '- nama: nama orang/acara/perusahaan yang disebut di pesan atau tercetak di frame, HANYA kata namanya (buang "the wedding of", "wedding", "birthday", "&", "dan"). ' +
      'Contoh: "THE WEDDING OF Dinda & Rafi" → "Dinda Rafi". Tidak ada → null.\n' +
      `- tanggal: tanggal acara. Hari ini ${hariIni}. "10.10.26" = 2026-10-10 (format tanggal Indonesia: hari.bulan.tahun). ` +
      '"tadi"/"hari ini" = hari ini, "kemarin" = kemarin. Tidak jelas → null. Jangan menebak.' },
    { role: 'user', content: isi },
  ];
  const ambil = async (ep) => (await kirim(ep, messages, false)).content || '';
  let raw;
  try { raw = await ambil(VISION); }
  catch (e) { if (!FALLBACK.key || !process.env.AI_FALLBACK_BASE_URL) throw e; raw = await ambil(FALLBACK); }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

module.exports = { ekstrakGaleri, pelajaran, eksperimen, getAIResponse, ringkasPercakapan, ekstrakBooking, ekstrakQuotation, nilaiFollowup, hargaAsing, _sumberHarga: () => SYSTEM_PROMPT + faq() };
