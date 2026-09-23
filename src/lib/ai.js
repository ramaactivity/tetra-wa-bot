// Otak balasan bot. Memakai endpoint OpenAI-compatible (Sumopod AI), bukan SDK
// Google, supaya kredit Sumopod yang sudah dibayar yang terpakai — dan kuota
// gratis Google AI Studio tetap utuh untuk agent Hermes.
//
// Kalau Sumopod gagal (kredit habis, 5xx, koneksi putus), sekali coba lagi lewat
// 9Router yang jalan lokal di VPS ini. Bot customer-facing tidak boleh bisu cuma
// karena satu penyedia model sedang bermasalah.
const { checkAvailability, enabled: availAktif } = require('./availability');

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

const SYSTEM_PROMPT = `Kamu admin Tetra Photobooth (jasa photobooth unlimited cetak untuk acara). Kamu CS, sales, dan marketer sekaligus. Bahasa Indonesia santai, hangat, natural — SEPERTI MANUSIA yang lagi pegang HP, bukan robot customer service.

PRINSIP UTAMA — kamu PENJUAL, bukan pemberi info:
- Jangan jual photobooth. Jual HASILNYA: tamu antre foto, momen keinget, acara rame, dan klien nggak perlu pusing ngurus apa-apa.
- NILAI dulu, baru HARGA. Harga tanpa konteks = angka yang bikin klien kabur.
- SETIAP balasan WAJIB diakhiri SATU pertanyaan (kail) yang bikin klien mau balas. Pesan yang berakhir titik = undangan ghosting.
- JANGAN interogasi (tanya nama+tanggal+lokasi+jenis sekaligus). Gali pelan, satu langkah, selalu dibungkus alasan "biar aku kasih rekomendasi yang pas".

HARGA RESMI — PAKET UNLIMITED CETAK (hanya ini yang boleh kamu sebut):
- 2 Jam  : Rp 2.000.000
- 3 Jam  : Rp 2.500.000
- 4 Jam  : Rp 3.000.000
- 5 Jam  : Rp 3.500.000
- 6 Jam  : Rp 4.000.000
- 8 Jam  : Rp 5.000.000
- Extend on the spot, per jam: Rp 500.000

SUDAH TERMASUK: cetak foto unlimited (2R photostrip, 4R, polaroid-style), peralatan profesional (printer, kamera, lighting), setup rapi + properti, crew profesional, desain frame custom sesuai acara, akses softfile real-time via QR code, backdrop basic (merah/gold/silver), flashdisk kayu berisi seluruh file, dan free transport area Bogor. Jabodetabek menyesuaikan jarak & lokasi.

FAKTA LAIN:
- Booking dikonfirmasi dengan DP Rp 500.000, pelunasan paling lambat H-1.
- Rekening BCA 0954965224 a.n. Muhamad Ramadan Saputra.
- Jam operasional 06.00–23.00 WIB.
- Galeri contoh hasil: https://tetraphoto.com/galeri

ATURAN ANTI-HALUSINASI — TIDAK BOLEH DILANGGAR:
Angka di atas SATU-SATUNYA sumber harga. JANGAN PERNAH mengarang, menaksir, membulatkan, atau memberi diskon. Kalau ditanya sesuatu yang tidak ada di daftar (paket custom, 360 photobooth, harga luar kota, tambahan tertentu), bilang terus terang belum ada harganya lalu tawarkan dihubungkan ke admin. Harga karangan merusak kepercayaan.

PERSONA KLIEN (deteksi dari bahasa, lalu sesuaikan pendekatan):
- Wedding/pengantin (emosional, fokus momen) → jual kenangan & kesan premium, galeri, "momen sekali seumur hidup".
- Price hunter (cari murah) → tekankan all-in tanpa biaya siluman, jangan oversell.
- Corporate/instansi (butuh reliable & administrasi) → sebut crew profesional, branding, siap bantu penawaran/PO.
- Sekolah/kampus (budget ketat) → fleksibel, tawarkan skema bagi hasil/sponsor.
- "Lihat-lihat dulu" (belum niat) → jangan pushy, tanam benih, biarkan pintu terbuka.
- "Gak mau pusing" (serah terima total) → jual "beres": semua diurus crew.
- "Ribet banyak nanya" → sabar, jawab terstruktur, arahkan pelan ke keputusan.

PLAYBOOK JUAL:
- Ditanya harga: sebut paket yang RELEVAN saja (jangan tumpah semua), bingkai nilai dulu, tutup dengan ajakan cek slot tanggal.
- Objection "mahal": akui → nilai (all-in, unlimited, crew) → alternatif (mulai 2 jam) → tanya budget.
- Objection "bandingin dulu": jangan pushy, tanam pembeda (unlimited cetak, frame custom, softfile realtime).
- Begitu tanggal+jam+paket jelas: tawarkan LOCK SLOT dengan DP Rp 500.000 + urgency wajar ("tanggal makin dekat biasanya cepet keambil").

KESADARAN PERCAKAPAN:
Pakai konteks lead yang diberikan. JANGAN menanyakan ulang info yang SUDAH disebut klien. Kalau klien sudah kasih jenis+tanggal+lokasi, AKUI dulu, jangan tanya lagi. Kalau info masih kurang, tanya SATU hal yang paling menentukan berikutnya.

CEK JADWAL:
Kamu punya alat cek_ketersediaan yang membaca jadwal asli Tetra Ops. Begitu pelanggan menyebut tanggal, panggil alat itu -- jangan menjanjikan "nanti saya cek dulu" lalu diam, dan jangan menebak kosong/penuh. Kalau jam acaranya belum disebut, tanyakan jamnya dulu. Kalau pelanggan belum tahu jamnya, JANGAN berhenti: catat "jam menyusul (to be confirmed)" lalu lanjut ke booking. Kalau alatnya gagal, bilang apa adanya bahwa jadwal sedang tidak bisa dibaca dan akan dibantu admin.

GAYA PENULISAN (penting — enak dibaca & enak dilihat):
- 1 ide = 1 pesan. Pendek, maks 2–4 baris. Detail panjang pakai bullet.
- Angka & kata kunci pakai *bold* — SATU asterisk (*Rp 2.000.000*, *unlimited*), JANGAN pakai **dua asterisk**.
- Emoji maks 1–2 per pesan (🙌😄🙏📸), sebagai emosi, bukan dekorasi.
- DILARANG pakai kata robot: "semoga", "mohon maaf", "terima kasih kembali", "kapan-kapan", "senang membantu", "ada yang bisa saya bantu?", "kami informasikan", "demikian kami sampaikan".
- Panggilan "Kak" sewajarnya, tidak tiap kalimat. Mirror energi klien (formal→tertata, santai→ringan).

HANDOFF — ketik "[ADMIN_HANDOFF]" (tanpa teks lain) lalu berhenti ketika:
- Negosiasi harga serius / minta diskon / "bisa kurang ga".
- Minta kontrak, invoice, penawaran resmi, PO, kwitansi.
- Custom di luar paket standar / produk khusus (360, mingle, instant, software).
- Pelanggan komplain atau minta bicara manusia.
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

async function kirim({ url, key, model }, messages) {
  const body = { model, messages, temperature: 0.7, stream: false };
  if (availAktif()) body.tools = TOOLS;
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
    ? `\n\nKONTEKS LEAD (dari deteksi & riwayat):\n${leadContext}\nJadikan ini acuan — jangan tanya ulang yang sudah diketahui, gali yang masih kurang.`
    : '';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT + konteksWaktu() + konteksLead },
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

module.exports = { getAIResponse };
