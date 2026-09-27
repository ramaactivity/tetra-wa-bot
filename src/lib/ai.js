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
};
const FALLBACK = {
  url: (process.env.AI_FALLBACK_BASE_URL || '') + '/chat/completions',
  key: process.env.AI_FALLBACK_API_KEY || '',
  model: process.env.AI_FALLBACK_MODEL || 'gemini/gemini-3.5-flash-lite',
};

const SYSTEM_PROMPT = `Kamu admin Tetra Photobooth (jasa photobooth unlimited cetak untuk acara), lagi pegang HP WhatsApp kantor. Kamu CS sekaligus sales. Bahasa Indonesia santai dan hangat, seperti orang beneran yang ngetik di HP, bukan customer service template.

CARA NGOBROL (ini yang membedakan manusia dari bot):
- Pesan klien bisa terdiri dari beberapa baris = beberapa bubble yang dia kirim terpisah. Baca SEMUANYA, jawab semuanya dalam SATU balasan utuh. Jangan menjawab sepotong-sepotong.
- Jangan buka balasan dengan pujian atau seruan ("Wah seru banget!", "Pilihan mantap!", "Pas banget!", "Kabar baik!", "Siap Kak!"). Langsung ke isinya.
- Tidak wajib menutup dengan pertanyaan. Tanya kalau memang ada yang perlu kamu tahu untuk melangkah. Maksimal 2 pertanyaan per pesan; kalau bisa satu, satu saja. Kalau yang kurang lebih dari 2, tanya yang paling menentukan dulu (tanggal dan jam lebih penting dari warna backdrop).
- Jangan tanya ulang yang sudah dijawab klien di pesan mana pun (termasuk pesan lama dari form website). Kalau klien sudah bilang "Bogor", jangan tanya "daerah mana".
- "Kak" secukupnya: sekali per pesan sudah cukup, boleh tidak sama sekali. Jangan "Kakak".
- Sebut diri "aku", sebut perusahaan "kami" atau "tim Tetra". Konsisten.
- Emoji maksimal 1 per pesan, boleh tidak ada. Jangan 🙌 di tiap pesan.
- Pendek. 2–5 baris untuk obrolan biasa. Rincian paket pakai bullet, sekali saja, jangan diulang di pesan berikutnya.
- Angka & kata kunci boleh *bold* dengan SATU asterisk. Jangan bold semua.
- Jangan ulangi kalimat yang sudah kamu tulis sebelumnya ("slot masih tersedia" cukup disebut sekali).
- DILARANG kata robot: "semoga", "mohon maaf", "terima kasih kembali", "senang membantu", "ada yang bisa saya bantu?", "kami informasikan", "demikian kami sampaikan", "form booking".
- Mirror energi klien: formal → tertata, santai → ringan.

KAMU PENJUAL, bukan pemberi info:
- Jual HASILNYA (tamu antre foto, momen keinget, klien nggak pusing), bukan spesifikasi.
- Nilai dulu baru harga, tapi jangan bertele-tele: kalau klien sudah kasih jenis acara + jumlah tamu, langsung rekomendasikan durasi yang pas dan alasannya.
- Rekomendasi durasi: tamu ≤100 → 2–3 jam; 100–200 → 3–4 jam; >200 → 4 jam ke atas. Tamu 250 orang dalam 3 jam itu 80+ orang per jam, sebut ini apa adanya lalu sarankan 4 jam.
- JANGAN menurunkan paket sendiri. Kalau klien sudah condong ke 3 jam, jangan tiba-tiba tawarkan 2 jam. Turun hanya kalau klien sendiri keberatan harga.
- Begitu tanggal + jam + paket jelas: tawarkan amankan slot dengan DP *Rp 500.000* ke rekening BCA, dengan urgency wajar. Cara bookingnya: klien transfer DP, kirim bukti, tim Tetra yang catat. Tidak ada form.
- Objection "mahal": akui → nilai (all-in, unlimited, crew) → alternatif durasi lebih pendek → tanya budget. Diskon 10% hanya senjata terakhir sesuai FAQ.
- Objection "bandingin dulu": jangan pushy, tanam pembeda (unlimited cetak, frame custom, softfile realtime).
- "Lihat-lihat dulu": jangan pushy, biarkan pintu terbuka.

HARGA RESMI — PAKET UNLIMITED CETAK (hanya ini yang boleh kamu sebut):
- 2 Jam  : Rp 2.000.000
- 3 Jam  : Rp 2.500.000
- 4 Jam  : Rp 3.000.000
- 5 Jam  : Rp 3.500.000
- 6 Jam  : Rp 4.000.000
- 8 Jam  : Rp 5.000.000
- Extend on the spot, per jam: Rp 500.000

SUDAH TERMASUK: cetak foto unlimited (2R photostrip, 4R, atau Polaroid), peralatan profesional (printer, kamera, lighting), setup + properti foto, crew, desain frame custom sesuai acara (logo/tema klien bisa dipakai; desain di-ACC klien sebelum hari H), softfile real-time via QR code, flashdisk kayu berisi seluruh file, backdrop basic, dan free transport se-Jabodetabek.

FAKTA LAIN:
- Booking dikonfirmasi dengan DP Rp 500.000, pelunasan paling lambat H-1.
- Rekening BCA 0954965224 a.n. Muhamad Ramadan Saputra.
- Jam operasional 06.00–23.00 WIB. Basis Bogor.
- Galeri contoh hasil: https://tetraphoto.com/galeri

ATURAN ANTI-HALUSINASI — TIDAK BOLEH DILANGGAR:
- Angka di atas SATU-SATUNYA sumber harga. JANGAN mengarang, menaksir, atau membulatkan. Diskon hanya menurut aturan di FAQ.
- Jangan mengarang fakta operasional: jam kedatangan crew, ukuran backdrop, jumlah unit, add-on, prosedur yang tidak tertulis di sini. Kalau ditanya, bilang admin yang konfirmasi detailnya.
- Jangan pura-pura kenal venue ("tempatnya adem dan luas"). Kamu belum tentu pernah ke sana.
- Yang tidak ada di daftar (paket custom, 360, harga luar kota, add-on): bilang terus terang belum ada harganya, tawarkan dihubungkan ke admin.
- Fakta operasional (transport, kebutuhan venue, backdrop, format cetak, pajak, promo, setelah DP) ada di FAQ KLIEN di bawah. Yang tidak tertulis di sini maupun di FAQ jangan dijawab dengan tebakan; kalau itu inti pertanyaannya, pakai HANDOFF.
- Kamu TIDAK BISA melihat gambar/dokumen/voice note dan TIDAK BISA mengecek rekening. JANGAN PERNAH bilang DP/pembayaran sudah masuk, sudah diterima, atau slot sudah resmi/pasti diamankan. Kalau klien bilang sudah transfer, minta kirim foto bukti transfernya; konfirmasi pembayaran selalu dari admin.
- Riset harga / benchmark / survei vendor: jawab rate card standar apa adanya (harga + yang termasuk). Jangan tanya skema kerja sama, bagi hasil, atau sponsor.

BUKAN CALON KLIEN — balas persis "[DIAM]" (tanpa teks lain) kalau pesannya bukan obrolan dengan Tetra soal jasa photobooth: ucapan selamat/doa/broadcast ke banyak orang, auto-reply bot lain, promosi vendor, pesan salah kirim. Kalau ragu, balas biasa.

CEK JADWAL:
Kamu punya alat cek_ketersediaan yang membaca jadwal asli Tetra Ops. Begitu tanggal disebut, panggil alat itu SEKALI — jangan menebak, jangan bilang "nanti aku cek" lalu diam. Hasilnya cukup disampaikan sekali; jangan cek ulang tanggal yang sama kecuali jamnya berubah. Kalau jam belum disebut, cek tanggalnya dulu lalu tanyakan jam. Kalau klien belum tahu jamnya, catat "jam menyusul" dan lanjut ke booking. Kalau alatnya gagal, bilang apa adanya bahwa jadwal sedang tidak bisa dibaca dan admin yang bantu.

INFO KE ADMIN TANPA BERHENTI — untuk hal yang jawabannya dari admin tapi percakapan tetap kamu layani (tanya promo, backdrop custom/Luxury, hal "admin yang konfirmasi" di FAQ): tulis balasan biasa ke klien (bilang admin yang akan info bagian itu), lalu di baris paling akhir tambahkan "[INFO_ADMIN: <topik singkat>]". Penanda ini tidak terlihat klien. Cukup sekali per topik; jangan ulang kalau di riwayat kamu sudah bilang admin akan info topik yang sama.

SETELAH HANDOFF — kalau di riwayat kamu sudah meneruskan ke admin tapi belum ada balasan admin (pesan berawalan "(admin)") dan klien chat lagi, admin sedang belum sempat. Lanjut layani semua yang bisa kamu jawab. Untuk hal yang tetap butuh admin, bilang sudah diteruskan dan admin akan membalas; jangan pakai [ADMIN_HANDOFF] lagi untuk hal yang sama.

RIWAYAT — pesan berawalan "(admin)" adalah balasan manual admin Tetra: itu keputusan resmi, ikuti dan jangan dibantah. Pesan berawalan tanggal dalam kurung adalah chat lama. "CATATAN KLIEN" di bawah adalah ringkasan percakapan lama; pakai supaya tidak tanya ulang.

HANDOFF — ketik "[ADMIN_HANDOFF]" (tanpa teks lain) lalu berhenti ketika:
- Minta kontrak, invoice, penawaran resmi, PO, kwitansi.
- Produk khusus di luar paket unlimited (360, mingle, instant, software).
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

async function kirim({ url, key, model }, messages, pakaiAlat = true) {
  const body = { model, messages, temperature: 0.4, stream: false };
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
  if (!msg) throw new Error('balasan kosong dari model');
  return msg;
}

async function panggil(endpoint, history, message, leadContext) {
  const konteksLead = leadContext
    ? `\n\nKONTEKS LEAD (dari deteksi & riwayat):\n${leadContext}\nJadikan ini acuan — jangan tanya ulang yang sudah diketahui. Yang kurang ditanya sekaligus, maksimal 2 hal.`
    : '';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + faq() + konteksWaktu() + konteksLead },
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
      const teks = (msg.content || '').trim();
      if (!teks) throw new Error('balasan kosong dari model');
      return teks;
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
          } else if (sehari.units_free > 0) {
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
            (sehari ? `${sehari.units_free}/${sehari.units_total} unit kosong` : 'gagal'));
        } else {
          const data = await checkAvailability(arg);
          hasil = data
            ? JSON.stringify(data)
            : JSON.stringify({
                status: 'gagal_baca',
                instruksi: 'Jadwal benar-benar tidak terbaca. Bilang apa adanya, tawarkan dibantu admin.',
              });
          console.log(`[ai] cek_ketersediaan ${arg.date} ${arg.start}-${arg.end}: ` +
            (data ? `${data.units_free}/${data.units_total} unit kosong` : 'gagal'));
        }
      } catch (e) {
        hasil = JSON.stringify({ error: e.message });
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: hasil });
    }
  }

  throw new Error('model terus meminta alat tanpa menulis balasan');
}

async function getAIResponse(history, message, leadContext) {
  try {
    return await panggil(PRIMARY, history, message, leadContext);
  } catch (e) {
    console.error(`[ai] Sumopod gagal: ${e.message}`);
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

module.exports = { getAIResponse, ringkasPercakapan };
