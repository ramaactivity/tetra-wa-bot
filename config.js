module.exports = {
  // ====== ATURAN BALASAN (urutan = prioritas; rule pertama yang cocok menang) ======
  // Taruh rule SPESIFIK di atas, rule UMUM (pricelist) di bawah.
  RULES: [
    {
      name: 'dp',
      keywords: ['dp', 'uang muka', 'bayar', 'pembayaran', 'transfer', 'rekening', 'booking fee'],
      reply: `Untuk mengamankan tanggal acara, booking dikonfirmasi dengan DP ya 🙌

💰 *DP: Rp 500.000*
🏦 Transfer ke *BCA 0954965224*
👤 a.n. *Muhamad Ramadan Saputra*
🗓️ Pelunasan paling lambat *H-1* sebelum acara

Kalau sudah transfer, tinggal kirim bukti transfernya ke chat ini ya, nanti langsung kami konfirmasi & amankan tanggalnya 🙏`,
    },
    {
      name: 'lokasi',
      keywords: ['lokasi', 'area', 'jangkauan', 'luar kota', 'bisa ke', 'coverage', 'jangkau'],
      reply: `Kami melayani area *Jabodetabek* untuk acara kamu 🚗

✅ Jabodetabek: *GRATIS biaya transport* 🎉
📍 Luar Jabodetabek: boleh diinfokan dulu lokasi venue-nya, nanti kami bantu cekkan & hitung estimasinya ya

Boleh infokan lokasi venue acaranya di mana? 🙌`,
    },
    {
      name: 'booking',
      keywords: ['available', 'tersedia', 'kosong', 'booking', 'jadwal', 'tanggal', 'slot', 'ready'],
      reply: `Untuk cek ketersediaan tanggal, boleh diinfokan ya:
1. Tanggal acara?
2. Lokasi venue?
3. Jenis acaranya apa?

Nanti langsung kami cekkan slot-nya 🙌`,
    },
    {
      name: 'fasilitas',
      keywords: ['dapet apa', 'dapat apa', 'dapatkan', 'include', 'termasuk', 'fasilitas', 'isi paket', 'yang didapat', 'benefit', 'apa aja yang di', 'apa saja yang di'],
      reply: `Paket Photobooth Tetra udah include ya Kak 🙌
• Photobooth unlimited sesuai jam
• 2 orang crew
• Printer, kamera & lighting profesional
• Unlimited cetak cepat (±10 detik) + frame
• Free desain frame custom
• Sleeve foto
• Properti lucu
• Background basic (kalau penyelenggara nggak nyediain)
• Free transport (Jabodetabek)
• Flashdisk kayu untuk softfile
• QR Code realtime buat download softfile

Pricelist lengkap & paketnya: 👉 https://tetraphoto.com/pricelist`,
    },
    {
      name: 'durasi',
      keywords: ['durasi', 'berapa jam', 'brp jam', 'berapa lama', 'brp lama', 'lama sewa', 'jam sewa', 'tambah jam', 'fullday', 'full day', 'perjam', 'per jam'],
      reply: `Durasi sewa Tetra fleksibel ya Kak 🙌
• Minimal 2 jam
• Maksimal fullday 12 jam
• Tambah jam: Rp500.000/jam

Pricelist lengkap per paket: 👉 https://tetraphoto.com/pricelist`,
    },
    {
      name: 'cetak_softfile',
      keywords: ['cetak', 'print', 'softfile', 'soft file', 'softcopy', 'soft copy', 'file foto', 'filenya', 'qr code', 'qrcode', 'flashdisk', 'flasdisk', 'flashdisc'],
      reply: `Soal hasil foto tenang aja Kak 📸
• Cetak instan unlimited, cuma ±15 detik per cetak
• Softfile bisa langsung download realtime via QR Code di lokasi
• Keseluruhan softfile juga dikirim lewat Google Drive setelah acara
• Plus dapat flashdisk kayu untuk softfile-nya 🙌`,
    },
    {
      name: 'custom',
      keywords: ['custom', 'kustom', 'frame', 'template', 'desain frame', 'backdrop', 'background', 'props', 'properti', 'tema acara'],
      reply: `Bisa banget Kak! ✨
• Frame/template: free custom sesuai tema acara
• Backdrop: kalau dekor/vendor belum nyediain, Tetra kasih background kain basic polos (pilihan warna: merah, putih, gold, silver) + props seru & lucu 🙌

Tinggal infoin tema acaranya ya, nanti kami sesuaikan.`,
    },
    {
      name: 'persiapan',
      keywords: ['butuh apa', 'perlu apa', 'nyiapin', 'siapin', 'disiapin', 'siapkan', 'disiapkan', 'persiapan', 'colokan', 'listrik', 'ruang', 'space', 'tempat photobooth', 'kebutuhan tempat'],
      reply: `Yang perlu disiapkan dari sisi Kakak simpel kok 🙌
• Area sekitar 3x3 meter
• 1 meja + 2 kursi
• Lokasi dekat sumber listrik (colokan)

Sisanya biar tim Tetra yang urus 😊`,
    },
    {
      name: 'pricelist',
      keywords: ['pricelist', 'price list', 'harga', 'price', 'berapa', 'paket', 'list', 'minta pl', 'info pl', 'lihat pl', 'liat pl', 'cek pl'],
      // Sengaja dikosongkan: arahkan customer cek website dulu, JANGAN auto-kirim PDF.
      // PDF tetap tersimpan di assets/ buat dikirim MANUAL oleh admin (last option).
      // Kalau suatu saat mau auto-kirim lagi, isi: 'assets/PRICELIST TETRA PHOTOBOOTH.pdf'
      file: '',
      reply: `Halo Kaka! Terima kasih sudah menghubungi Tetra Photobooth 📸

Detail lengkap untuk pricelist bisa langsung diakses di sini:
https://tetraphoto.com/pricelist

Boleh bantu infokan detail berikut agar kami bisa segera cek ketersediaan jadwal?

Jenis acara:
Tanggal acara:
Lokasi venue:

Ditunggu kabar baiknya ya Kak, kalau ada yang kurang jelas langsung tanya aja ya! 🙌`,
    },
    {
      name: 'galeri',
      keywords: ['galeri', 'gallery', 'contoh hasil', 'contoh foto', 'contoh fotonya', 'contoh hasilnya', 'portofolio', 'portfolio', 'hasil cetak', 'lihat hasil', 'liat hasil', 'dokumentasi', 'hasil fotonya'],
      reply: `Boleh banget Kak! Ini galeri contoh hasil cetak & dokumentasi Tetra Photobooth 📸

👉 https://tetraphoto.com/galeri

Kalau udah ada gambaran acaranya (jenis acara / tanggal / kota venue), info aja ya Kak — biar kami bantu rekomendasi paket yang pas 🙌`,
    },
  ],

  // ====== SALAM ======
  // Kalau pesan masuk mengandung "Assalamualaikum"/"Assalamu'alaikum" (variasi spasi &
  // apostrof tetap kebaca), balasan diawali teks ini di paling atas. Kosongkan = matikan.
  SALAM_REPLY: `Wa'alaikumsalam wr. wb. 🙏`,

  // ====== SMART LEAD (alur gated: tahan PL sampai dapat detail acara) ======
  // Saat klien minta pricelist:
  //  - belum kasih detail  -> bot tanya detail dulu (gate), framing "biar harganya pas"
  //  - sudah kasih detail / nolak ngasih detail / maksa -> bot langsung kirim link PL
  // Teks di sini bisa kamu edit bebas. PRICELIST_URL = link yang dikirim ke klien.
  SMART_LEAD: {
    PRICELIST_URL: 'https://tetraphoto.com/pricelist',
    GALERI_URL: 'https://tetraphoto.com/galeri', // galeri contoh hasil. Kosongkan ('') = matikan.
    GREETING: 'Halo Kak, terima kasih sudah menghubungi Tetra Photobooth 📸',
    // Kalimat penutup setelah kirim pricelist. Bot DIAM setelah ini (hand-off ke
    // admin) — jadi jangan ngundang balasan/janji yang bot sendiri nggak lanjutin.
    HANDOFF_DETAIL: 'Nanti tim kami lanjut bantu cek ketersediaan jadwal & pilihkan paket yang cocok ya, Kak',
    HANDOFF_NODETAIL: 'Kalau sudah ada gambaran acaranya, kabari aja ya Kak, nanti kami bantu carikan paket yang pas 🙌',
    // Intro balasan khusus REKANAN (B2B) per segmen. Edit bebas.
    B2B: {
      eo_wo: 'Senang banget bisa kerja sama dengan rekan EO/WO 🙌 Untuk partner biasanya kami ada *rate khusus & skema kerja sama*, apalagi kalau acaranya rutin.',
      corporate: 'Untuk acara corporate biasanya kami ada paket & *rate khusus*, apalagi kalau berkala (annual / gathering rutin) 🙌',
      instansi: 'Untuk instansi/pemerintah kami siap bantu sampai kelengkapan administrasinya (penawaran resmi / PO) 🙌',
      venue: 'Senang bisa kerja sama dengan pihak venue 🙌 Untuk venue partner biasanya ada *skema khusus* (in-house).',
      // Dipakai untuk SEMUA segmen pendidikan (osis/bem/sekolah/kampus).
      // NETRAL — jangan langsung dorong satu model; gali kebutuhan dulu.
      pendidikan: 'Seru nih acara sekolah/kampusnya! 🙌 Tetra fleksibel kok — bisa sewa biasa, kerja sama bagi hasil, atau skema lain, tergantung kebutuhan acaranya.',
    },
  },

  // ====== ANTI-SPAM ======
  COOLDOWN_HOURS: 12, // template yang sama tidak dikirim 2x ke kontak yang sama dalam rentang ini

  // ====== AUTO-PAUSE (HUMAN HANDOFF) ======
  PAUSE_HOURS: 24, // setelah admin bales manual, bot diam ke kontak itu sekian jam

  // ====== NOTIF LEAD KE ADMIN ======
  ADMIN_NOTIFY_JID: '6289611384767@s.whatsapp.net', // notif lead ke WA admin. Kosong = matikan notif.

  // ====== JAM KERJA (WIB / UTC+7) ======
  BUSINESS_START_HOUR: 6,
  BUSINESS_END_HOUR: 23,
  TIMEZONE_OFFSET: 7,
  AFTER_HOURS_NOTE: `

(Catatan: pesan ini masuk di luar jam operasional kami 06.00–23.00 WIB. Tim kami akan membalas lebih lengkap di jam kerja ya 🙏)`,
};
