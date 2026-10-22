// Handler utama event messages.upsert.
// Routing: kemitraan/sponsor → handoff · purna-jual → handoff · produk khusus →
// handoff · pricelist/form website → gate kualifikasi (smartLead) · sisanya → AI
// dengan konteks lead (persona + detail acara + yang masih kurang) · bukti
// transfer / konfirmasi DP admin → tahap booking (lib/booking.js).
const live = require('../lib/liveConfig');
const supa = require('../lib/supa');
const { proto, downloadMediaMessage } = require('@whiskeysockets/baileys');
const { HANDOFF_AI_MS, getRiwayat, getRingkasan, tambahRiwayat, getProspek, tandaiProspek, gabungSejarah, sudahSejarah, rangkumBilaPerlu } = require('../lib/store');
const { syncToSheet } = require('../lib/sheetSync');
const { extractText } = require('../lib/rules');
const { botSentIds } = require('../lib/botMessages');
const { sendReply, sendDocument } = require('../lib/sender');
const { rememberBotMsg } = require('../lib/botMessages');
const deliveryLog = require('../lib/deliveryLog');
const { notifyAdmin, kirimTelegram } = require('../lib/notify');
const { ekstrakGaleri, eksperimen, getAIResponse, ringkasPercakapan, ekstrakBooking, ekstrakQuotation } = require('../lib/ai');
const { postOps } = require('../lib/availability');
const crypto = require('crypto');
const booking = require('../lib/booking');
const prospekWa = require('../lib/prospekWa');
const timWa = require('../lib/timWa');
const portal = require('../lib/portal');
const galeri = require('../lib/galeri');
// Klien lama yang membalas sapaan reaktivasi sales: CS harus tahu konteksnya.
// ponytail: hanya di memori proses; hilang saat restart (balasan berikutnya mengisinya lagi).
const klienLamaCtx = new Map();
// Tamu Booth (halaman foto tamu → nomor + izin dihubungi, 8 Okt): jid -> baris catatan "tamu booth: …".
const tamuCtx = new Map();
const RE_STOP = /^\s*(stop|unsubscribe|berhenti|jangan (hubungi|chat|wa)( (saya|aku))?( lagi)?)\s*[.!🙏]*\s*$/i;
function konteksTamu(jid) {
  const t = tamuCtx.get(jid);
  if (!t) return '';
  return `\nTAMU BOOTH: ${t.replace(/^tamu booth:\s*/i, '')}. Dia tamu yang baru foto di photobooth Tetra di acara itu, lalu meninggalkan nomor karena tertarik pakai Tetra. ` +
    'Ini balasan atas pesan kita: jangan perkenalan ulang, jangan sebut website. Layani sebagai calon klien yang hangat: tanggapi pesannya, gali acaranya (jenis, tanggal, lokasi) seperti biasa. ' +
    'Kalau ada kode promo di atas, itu milik nomor ini; sebut saat bahas harga/booking, jangan janjikan lebih dari hadiahnya dan sebut batas berlakunya. ' +
    'Begitu dia siap booking, kirim link booking di atas (kode promonya sudah terisi otomatis). Admin bisa menolak bukti promo belakangan, jadi jangan bilang promonya pasti.';
}
function konteksKlienLama(jid) {
  const k = klienLamaCtx.get(jid);
  if (!k) return '';
  return `\nKLIEN LAMA: ${k.nama}${k.pic ? ` (PIC ${k.pic})` : ''} sudah pernah memakai Tetra${k.alasan ? ` — ${k.alasan}` : ''}. ` +
    'Dia sudah tahu harga & layanan Tetra: JANGAN mengirim atau menawarkan pricelist kecuali dia sendiri memintanya. ' +
    'Ini balasan atas sapaan Rama, BUKAN pengunjung website baru: jangan memperkenalkan diri ulang. Balas sesuai isi pesannya, hangat dan singkat (panggil "kak"). ' +
    'Kalau rencana acaranya masih lama (lebih dari ±2 bulan lagi, mis. "Juni tahun depan") atau belum jelas: cukup ucapkan terima kasih dan bilang nanti kami kabari lagi mendekati waktunya — JANGAN menanyakan detail. ' +
    'Kalau acaranya dalam ±2 bulan: baru tanyakan tanggal pasti, lokasi, dan detail acaranya supaya bisa dicek ketersediaan unit.';
}
const vendorLib = require('../lib/vendor');
const { kirimPricelist, mintaPricelist, ASSETS_DIR } = require('../lib/pricelist');
const path = require('path');
const { enrich, classifyTopik } = require('../lib/enrichLead');
const smart = require('../lib/smartLead');
const { cleanName } = require('../lib/followupEngine');
const { execSync } = require('child_process');

// Serialisasi pemrosesan per-JID
const jidChains = new Map();
function runSerial(jid, task) {
  const prev = jidChains.get(jid) || Promise.resolve();
  const next = prev.then(task, task);
  jidChains.set(jid, next);
  next.finally(() => { if (jidChains.get(jid) === next) jidChains.delete(jid); });
  return next;
}

// Teks pesan, atau penanda untuk media tanpa caption. Tanpa ini bukti transfer
// (gambar) dan voice note diabaikan diam-diam, sementara klien menunggu.
// Kartu kontak (vCard) dibaca jadi teks "[kirim kontak: Nama 628…]". Dulu dianggap kosong dan
// dibuang: House of Liza mengirim kontak PIC (Mbak Widya), bot malah menanyakan nomornya (7 Okt).
function kartuKontak(message) {
  const list = message?.contactMessage ? [message.contactMessage] : message?.contactsArrayMessage?.contacts || [];
  return list.map((c) => {
    const v = String(c.vcard || '');
    const tel = (v.match(/waid=(\d{8,15})/) || [])[1] ||
      String((v.match(/\nTEL[^:\n]*:([+\d\s().-]{8,})/) || [])[1] || '').replace(/\D/g, '').replace(/^0/, '62');
    return `${c.displayName || 'tanpa nama'}${tel ? ` ${tel}` : ''}`;
  }).join('; ');
}

// Bot menjanjikan/mengklaim pricelist terkirim, atau klien bilang belum menerima → kirim sekarang (lihat handleBatch).
const RE_JANJI_FILE = /(sudah|udah|barusan|telah)\s+(aku\s+|kami\s+)?(kirim|terkirim|kukirim|dikirim)|\b(ini|berikut)\s+(aku\s+|kami\s+)?kirim(kan)?|\baku\s+kirim(kan)?\b|terlampir|di (atas|bawah) ya/i;
const RE_BELUM_TERIMA = /\b(gak|ga|gaada|nggak|enggak|tidak|belum|blm)\b.{0,15}\b(ada|masuk|terkirim|muncul|nyampe|sampai|keliatan|kelihatan|kebuka|ke ?kirim)\b|\bmana\b|\bdimana\b|\bdi ?mana\b|kirim(in|kan)? (lagi|ulang)/i;
const RE_TOPIK_PL = /harga|pricelist|price ?list|\bpl\b|daftar paket/i;
function janjiPricelist(jawaban, pesanKlien, lampiran, riwayat) {
  // Sedang mengirim lampiran lain (backdrop/katalog/layout) → "gambar" yang dimaksud bukan pricelist.
  if (lampiran.some((k) => k !== 'pricelist')) return false;
  const sudah = riwayat.some((p) => String(p.content).includes('[kirim PDF pricelist]'));
  const dekat = riwayat.slice(-2).filter((p) => p.role === 'assistant').map((p) => p.content).join('\n');
  const topik = RE_TOPIK_PL.test(`${jawaban}\n${pesanKlien}\n${dekat}`);
  if (!topik) return false;
  // Klien bilang belum menerima & sebelumnya bot menyinggung pricelist/harga → kirim (juga kirim ulang).
  const bahasPL = riwayat.slice(-6).some((p) => p.role === 'assistant' && /harga|pricelist|gambar/i.test(String(p.content)));
  if (RE_BELUM_TERIMA.test(pesanKlien) && bahasPL) return true;
  if (sudah) return false;
  return RE_JANJI_FILE.test(jawaban);
}

function teksPesan(message) {
  const t = extractText(message);
  if (t) return t;
  const kartu = kartuKontak(message);
  if (kartu) return `[kirim kontak: ${kartu}]`;
  if (message?.imageMessage) return '[kirim gambar]';
  const dok = message?.documentMessage || message?.documentWithCaptionMessage?.message?.documentMessage;
  if (dok) return `[kirim dokumen${dok.fileName ? `: ${dok.fileName}` : ''}]`;
  if (message?.audioMessage) return '[kirim voice note]';
  return '';
}

function phoneDigits(msg) {
  const jid = msg.key?.remoteJid || '';
  if (jid.endsWith('@lid')) {
    // Baileys 7: nomor HP ada di remoteJidAlt (senderPn = nama lama di 6.x).
    const pn = msg.key?.remoteJidAlt || msg.key?.senderPn;
    if (pn && pn.includes('@')) return pn.split('@')[0];
  }
  return jid.split('@')[0];
}

// ── Deteksi intent khusus (di luar penjualan retail) ──────────────────────────
// Kemitraan / franchise / sponsorship masuk: mereka MENAWARKAN kerja sama atau
// minta Tetra jadi sponsor — BUKAN menyewa photobooth. Harus ke owner.
function isKemitraan(t) {
  return /kemitraan|franchise|transfer knowledge|memulai usaha|membuka peluang|open kolaborasi|menawarkan kesempatan|proposal sponsor|tim sponsorship|sponsorship/i.test(t);
}

// Purna-jual: pelanggan existing butuh softfile/invoice/bayar/reschedule. Data
// transaksi dipegang manusia, bukan bot.
function isPostSale(t) {
  return /softfile|soft file|file foto|kwitansi|invoice|nota pembayaran|bayar sisa|sisa dp|reschedule|re.?schedule|kabar duka|meninggal|bukti transfer|pelunasan/i.test(t);
}

// Produk/jasa di luar pricelist unlimited standar → jangan dikarang, handoff.
// 360, Magazine Box, Photo Stage tidak di sini lagi: sudah ada di katalog FAQ
// dan boleh dijawab bot sendiri (keputusan Rama 27 Sep 2026).
function isSpecialProduct(t) {
  return /mingle|instant photobooth|instant photo|cetak foto aja|cetak doang|maksimal berapa|printer dnp/i.test(t);
}

// Susun konteks lead untuk di-inject ke AI tiap turn, biar bot "ingat" dan tidak
// nanya ulang hal yang sudah disebut. Terima teks GABUNGAN (riwayat user + pesan
// terbaru) supaya detail yang terpencar di beberapa pesan tetap terbaca.
// ── Tahap percakapan, persona, eksperimen A/B (keputusan Rama 1 Okt) ─────────
// Bot harus membaca SELURUH konteks, bukan satu bubble: kontak baru disapa dan digali
// dulu, klien lama dilanjutkan; tiap tipe klien punya pendekatan sendiri (pola dari
// skill Hermes cs-mintet-pelajaran) dan CS Mintet bisa menguji dua pendekatan (A/B).
// Tahan salah ketik klien ("weeding", "weding", "nikahan").
const RE_WEDDING = /w+e+d+i*n+g|nikah|resepsi|akad|lamaran|engagement|ngunduh|pengantin|manten/i;
function personaKlien(fullText, det) {
  const seg = smart.detectSegment(fullText).segment;
  if (seg && seg !== 'private') return seg;
  return RE_WEDDING.test(`${det.jenisAcara || ''} ${fullText}`) ? 'wedding' : 'private';
}
function tamuDari(teks) {
  const m = teks.match(/(\d{2,4})\s*(?:an\s*)?(?:orang|org|tamu|pax|undangan|peserta)\b/i) ||
    teks.match(/(?:tamu|undangan|peserta)\D{0,15}(\d{2,4})/i);
  return m ? m[1] : null;
}
function tahapPercakapan(jid, det, fullText, pesanBaru) {
  const riw = getRiwayat(jid);
  const bot = riw.filter((p) => p.role === 'assistant' && !/^[[(]/.test(String(p.content)));
  if (!bot.length && !getRingkasan(jid)) return { tahap: 'SAPA', belum: [], hari: 0 };
  const terakhir = riw.at(-1)?.t || 0;
  const hari = terakhir ? Math.floor((Date.now() - terakhir) / 864e5) : 0;
  const belum = [!det.jenisAcara && 'jenis acara', !det.tanggal && 'tanggal', !det.lokasi && 'lokasi',
    !tamuDari(fullText) && 'perkiraan jumlah tamu'].filter(Boolean);
  const sudahRekomendasi = bot.some((p) => /\d\s*jam/i.test(p.content) && /rp\s?\d|\d\s*(jt|juta)/i.test(p.content));
  let tahap = belum.length >= 2 ? 'GALI' : !sudahRekomendasi ? 'REKOMENDASI' : 'KERAGUAN/CLOSING';
  if (/\b(dp|booking|book|transfer|rekening|cara (pesan|booking|bayar)|amankan|lock|fix|deal|jadi ambil)\b/i.test(pesanBaru)) tahap = 'CLOSING';
  return { tahap, belum, hari };
}
// Varian tetap per kontak (hash), dicatat sekali ke data/eksperimen.jsonl untuk dinilai CS Mintet.
const EKSP_FILE = path.join(__dirname, '..', '..', 'data', 'eksperimen.jsonl');
let eksTercatat = null;
function varianEksperimen(jid, persona, tahap) {
  const e = eksperimen().find((x) => (x.persona === 'semua' || x.persona === persona) &&
    (x.tahap === 'SEMUA' || tahap.startsWith(x.tahap) || x.tahap.startsWith(tahap)));
  if (!e) return '';
  const v = parseInt(crypto.createHash('md5').update(`${jid}|${e.id}`).digest('hex').slice(0, 8), 16) % 2 ? 'B' : 'A';
  if (!eksTercatat) {
    eksTercatat = new Set();
    try { require('fs').readFileSync(EKSP_FILE, 'utf-8').split('\n').filter(Boolean).forEach((l) => { const j = JSON.parse(l); eksTercatat.add(`${j.jid}|${j.id}`); }); } catch { /* belum ada */ }
  }
  if (!eksTercatat.has(`${jid}|${e.id}`)) {
    eksTercatat.add(`${jid}|${e.id}`);
    require('fs').appendFile(EKSP_FILE, JSON.stringify({ t: Date.now(), jid, id: e.id, varian: v, persona, tahap }) + '\n', () => {});
  }
  return `\nEKSPERIMEN ${e.id} (varian ${v}) untuk pesan ini: ${e[v]}. Tetap patuhi aturan dan STRATEGI CS lainnya.`;
}

function buildLeadContext(fullText, jid, pesanBaru = '', namaWA = '', vendor = null) {
  const det = smart.parseLeadDetails(fullText);
  const seg = smart.detectSegment(fullText);
  const known = [];
  if (det.jenisAcara) known.push(`jenis=${det.jenisAcara}`);
  if (det.tanggal) known.push(`tanggal=${det.tanggal}`);
  if (det.lokasi) known.push(`lokasi=${det.lokasi}`);
  const missing = smart.missingFields(det);
  const persona = personaKlien(fullText, det);
  const lines = [`Persona: ${persona} (${smart.segmentLabel(seg.segment)})`];
  if (known.length) lines.push(`Sudah diketahui: ${known.join(', ')}`);
  else lines.push('Belum ada detail acara.');
  if (missing.length) lines.push(`Masih kurang: ${missing.join(', ')} — tanyakan yang paling menentukan dulu, maksimal 2 hal dalam satu pesan.`);
  else lines.push('Detail acara sudah lengkap — fokus ke cek slot & rekomendasi paket.');
  const w = smart.parseWebsite(pesanBaru);
  if (w.dariWebsite || w.halaman) {
    const info = [w.halaman && `halaman ${w.halaman}`, w.paket && `paket yang diklik: ${w.paket}`,
      w.jam && `jam photobooth: ${w.jam}`, w.tamu && `jumlah tamu: ${w.tamu}`].filter(Boolean);
    lines.push(`Sumber: tombol WhatsApp di website Tetra${info.length ? ` (${info.join('; ')})` : ''}.` +
      (w.kosong ? ' Template dari website terkirim TANPA isian' + (w.terpotong ? ' (pesannya juga terpotong)' : '') + '.' : ''));
  }
  const nama = w.nama || cleanName(namaWA);
  if (nama) lines.push(`Nama klien: ${nama} (boleh dipakai menyapa).`);
  if (!vendor) {
    const tp = tahapPercakapan(jid, det, fullText, pesanBaru);
    if (tp.tahap === 'SAPA') lines.push('TAHAP PERCAKAPAN: SAPA — belum pernah ada percakapan. Ini KONTAK PERTAMA dengan klien ini — ikuti aturan KONTAK PERTAMA.');
    else lines.push(`TAHAP PERCAKAPAN: ${tp.tahap}${tp.hari >= 3 ? ` + LANJUTAN (klien kembali setelah ${tp.hari} hari)` : ''}. ` +
      `Belum diketahui: ${tp.belum.join(', ') || '-'}. Ikuti tujuan tahap ini di STRATEGI CS.`);
    lines.push(varianEksperimen(jid, persona, tp.tahap).trim());
  }
  const ringkasan = getRingkasan(jid);
  if (ringkasan) lines.push(`\nCATATAN KLIEN (ringkasan percakapan lama):\n${ringkasan}`);
  return lines.join('\n');
}

// Gabungkan seluruh pesan USER dalam riwayat + pesan terbaru menjadi satu teks.
// Dipakai untuk parse detail acara & segmentasi supaya gate kualifikasi tidak
// menanya ulang hal yang sudah diberi klien di pesan sebelumnya.
function fullUserText(jid, originalText) {
  const hist = getRiwayat(jid)
    .filter((p) => p.role === 'user')
    .map((p) => p.content);
  return [...hist, originalText].join('\n');
}

// Kirim handoff: jawab klien singkat + notif admin + pause bot ke kontak ini.
// Dua sisi dicatat di riwayat supaya setelah pause habis AI tahu admin sudah dipanggil.
async function handoff(sock, msg, alasan, jawabanKlien, teksKlien) {
  const jid = msg.key.remoteJid;
  tambahRiwayat(jid, 'user', teksKlien);
  tambahRiwayat(jid, 'assistant', jawabanKlien);
  await sendReply(sock, jid, msg.key, { name: 'handoff' }, jawabanKlien);
  await notifyAdmin(sock, phoneDigits(msg), { name: 'HANDOFF' }, getRiwayat(jid), alasan);
  await supa.upsertPause(jid, Date.now() + HANDOFF_AI_MS, 'ai');
}

// Tamu/klien minta foto acara (lib/galeri.js). Mengembalikan true kalau sudah ditangani; false = bukan
// permintaan foto acara (mis. calon klien minta contoh hasil) → alur biasa lanjut.
async function layaniGaleri(sock, msg, keys, teks, gambar) {
  const jid = msg.key.remoteJid;
  // Beberapa pesan terakhir ikut dibaca: nama acara sering di bubble sebelumnya ("wedding dinda rafi" lalu foto cetakan).
  const konteks = [...getRiwayat(jid).slice(-4).map((x) => `${x.role === 'user' ? 'PENGIRIM' : 'TETRA'}: ${x.content}`), `PENGIRIM: ${teks}`].join('\n');
  const p = await ekstrakGaleri(konteks, gambar).catch((e) => { console.error('[galeri] ekstrak gagal:', e.message); return null; });
  const sudahDitanya = Date.now() - (galeri.ditanya.get(jid) || 0) < galeri.TANYA_MS;
  if (!p || !(p.minta_foto_acara || p.cetakan_photobooth || (sudahDitanya && p.nama))) return false;
  const hasil = await galeri.cariDariPetunjuk(p);
  const k = galeri.putuskan(p, hasil, sudahDitanya, Date.now() - (galeri.tanyaTanggal.get(jid) || 0) < galeri.TANYA_MS);
  console.log(`[galeri] ${jid} nama=${p.nama} tgl=${p.tanggal} cetakan=${p.cetakan_photobooth} → ${k.aksi}${k.alasan ? ` (${k.alasan})` : ''}`);
  if (k.aksi === 'admin') {
    galeri.ditanya.delete(jid);
    galeri.tanyaTanggal.delete(jid);
    await handoff(sock, msg, `Minta foto/softfile acara: ${k.alasan}`,
      'Bentar ya Kak, link galerinya aku tanyain ke admin dulu. Nanti aku kabarin di sini 🙏', teks);
    return true;
  }
  if (k.aksi === 'tanya') galeri.ditanya.set(jid, Date.now()); else galeri.ditanya.delete(jid);
  if (k.tanggal) galeri.tanyaTanggal.set(jid, Date.now()); else if (k.aksi !== 'tanya') galeri.tanyaTanggal.delete(jid);
  tambahRiwayat(jid, 'user', teks);
  tambahRiwayat(jid, 'assistant', k.teks);
  await sendReply(sock, jid, keys, { name: `galeri-${k.aksi}` }, k.teks);
  return true;
}

// ── Penundaan balasan (debounce per kontak) ──────────────────────────────────
// Klien WhatsApp mengetik terpecah: "Untuk hari Minggu" / "Lokasi di kebun su" /
// "Bogor". Membalas tiap bubble = tiga balasan dengan konteks sepotong-sepotong
// (23 Sep 2026: 8 balasan dalam 2 menit ke satu klien). Sekarang bubble dikumpulkan
// dulu; timer mulai ulang tiap bubble baru; kalau klien masih terlihat mengetik,
// tunggu lagi. Semua bubble digabung jadi SATU giliran user → SATU balasan utuh.
const TUNGGU_MS = () => (Number(process.env.REPLY_DELAY_SECONDS) || 25) * 1000;
const MASIH_NGETIK_MS = 10000;  // presence "composing" lebih baru dari ini = masih ngetik
const TUNGGU_MAKS_MS = 120000;  // batas total menunggu, apa pun yang terjadi
const PESAN_TERLAMA_MS = 12 * 3600 * 1000; // pesan yang masuk selagi bot offline tetap dibalas (maks 12 jam)
const antrian = new Map();      // jid -> { msgs: [], timer, mulai }

// Admin membalas manual saat bot masih memproses (28 Sep: pesan Boby dibalas admin
// dan bot di menit yang sama). jid -> waktu balasan manual admin terakhir.
const adminTerakhir = new Map();

// Klaim tindakan yang bot TIDAK bisa lakukan (28 Sep: "sudah aku perbarui
// jadwalnya" padahal Tetra Ops masih jam lama). Balasan seperti ini tidak dikirim.
const RE_KLAIM = new RegExp(
  '\\b(sudah|udah|telah|sdh)(\\s+\\w+){0,2}?\\s+(di)?' +
  '(perbarui|update|ubah|ganti|geser|pindah(kan)?|reschedule|jadwal(kan)?|kunci|amankan|batalkan|refund|konfirmasi)\\b' +
  '|\\b(dp|pembayaran|transfer|pelunasan)(nya)?\\s+(sudah|udah|telah)\\s+(masuk|diterima|terverifikasi|lunas)', 'i');
// Klaim palsu hanya dicatat sebagai PERUBAHAN kalau klien memang membahas booking (8 Okt: "ohh boleh" Kak Nadia
// jadi notif perubahan palsu ke grup owner).
const RE_SOAL_BOOKING = /jadwal|\bjam\b|tanggal|\btgl\b|geser|pindah|reschedule|\bubah|ganti|batal|cancel|booking|durasi|paket|extend|tambah (jam|unit)/i;
const KALIMAT_AMAN = 'Oke Kak, aku sampaikan ke admin dulu ya biar dicek jadwalnya. Nanti admin yang kabarin di sini.';

// Lampiran yang boleh diminta AI lewat penanda [KIRIM: kunci]. Dikirim setelah
// balasan teks, sekali per percakapan (label dicek di riwayat; format label sama
// dengan booking.kirimKatalog supaya katalog tidak terkirim dua kali).
// `pernah` = pola nama file di riwayat: file yang sudah dikirim admin manual
// ("(admin) [kirim dokumen: ...]") atau lewat lampiran lain tidak dikirim ulang.
const LAMPIRAN = {
  backdrop: { file: 'BACKDROP TETRA.pdf', label: 'backdrop basic', pernah: /BACKDROP TETRA/i,
    caption: 'Pilihan backdrop basic Tetra, sudah termasuk di paket.' },
  katalog: { file: 'KATALOG DESAIN FRAME TETRA.pdf', label: 'katalog desain frame', pernah: /KATALOG DESAIN/i,
    caption: 'Contoh desain frame Tetra. Belum ada yang cocok? Desain custom juga bisa, gratis.' },
  // PDF panduan juga memuat halaman layout, jadi layout tidak dikirim kalau panduan sudah.
  layout: { file: 'LAYOUT PHOTOBOOTH.pdf', label: 'layout photobooth', pernah: /LAYOUT (PHOTOBOOTH|&)|layout photobooth|panduan ukuran/i,
    caption: 'Bentuk & pilihan layout cetak Tetra: 2R photostrip, 4R, dan Polaroid.' },
  // Ilustrasi skema rekanan (komisi 10% vs potongan 10%), disetujui Rama 8 Okt 2026.
  skema: { file: 'SKEMA REKANAN TETRA.png', label: 'skema rekanan', pernah: /SKEMA REKANAN|skema rekanan/i,
    caption: 'Biar gampang kebayang, ini gambaran dua skema kerja sama rekanan Tetra 😊' },
  panduan: { file: 'LAYOUT & PANDUAN UKURAN.pdf', label: 'panduan ukuran', pernah: /PANDUAN UKURAN/i,
    caption: 'Panduan ukuran canvas untuk desain frame sendiri (2R 1200×3600 px, 4R 2400×3600 px, Polaroid 1800×2400 px per lembar).' },
};

// Gambar/dokumen dianggap bukti transfer kalau KLIEN menyinggung pembayaran di
// pesan ini atau 6 pesan terakhirnya (bukan dari tawaran DP bot sendiri).
const RE_BAYAR = /\b(dp|down ?payment|transfer|tf|trf|bukti|bayar|pembayaran|lunas|pelunasan)\b/i;
// Admin mengonfirmasi DP manual → mulai tahap booking juga.
const RE_DP_ADMIN = /\b(dp|down ?payment|pembayaran|transfer)(nya)?\b[^\n]{0,40}\b(diterima|terima|masuk|terverifikasi|dikonfirmasi|konfirmasi|aman)\b/i;

// ── Chat lama dari HP (history sync on-demand) ──────────────────────────────
// Bot hanya melihat pesan sejak ia tertaut. Supaya jawabannya berdasar seluruh
// percakapan (termasuk yang dulu dibalas admin manual), saat kontak pertama kali
// chat kita minta HP Tetra mengirim chat lama, 50 per halaman, maks 4 halaman.
// Syarat: HP Tetra online. Hasil datang lewat 'messaging-history.set', biasanya
// dalam beberapa detik -- masih di dalam jeda tunggu balasan.
const HALAMAN_SEJARAH = 50;
const MAKS_HALAMAN = 4;
const tarikSejarah = new Map(); // jid -> { sejakMs, halaman }
const sudahMinta = new Set();
const detik = (m) => { const t = m.messageTimestamp; return Number(t?.toNumber ? t.toNumber() : t) || 0; };
const tglPendek = (s) => new Date(s * 1000).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', year: 'numeric' });

function mintaSejarah(sock, key, tsMs, halaman, sejakMs) {
  tarikSejarah.set(key.remoteJid, { sejakMs, halaman });
  sock.fetchMessageHistory(HALAMAN_SEJARAH, key, tsMs)
    .catch((e) => console.error(`[sejarah] ${key.remoteJid.split('@')[0]}: gagal minta`, e.message));
}
const ngetik = new Map();       // jid -> ts terakhir terlihat mengetik
const sudahSubscribe = new Set();

// ── Pesan klien yang tidak bisa dibuka (Bad MAC) ─────────────────────────────
// Baileys meminta kirim ulang & minta isi pesan dari HP Tetra; biasanya pulih
// dalam hitungan menit. Yang TIDAK pulih dalam 10 menit dilaporkan ke admin supaya
// dibalas manual dari HP -- tidak ada pesan klien yang hilang diam-diam.
const gagalBuka = new Map(); // jid -> { sejak, dilapor }
const PULIH_MS = 10 * 60 * 1000;
const LAPOR_ULANG_MS = 6 * 3600 * 1000;
let sockTerakhir = null;
// JID akun Tetra sendiri (LID & nomor): salinan pesan dari HP/WA Web admin yang gagal
// dibuka itu urusan sesi perangkat sendiri, bukan pesan klien yang terlewat.
function milikSendiri(jid) {
  const u = sockTerakhir?.user;
  const inti = (x) => String(x || '').split('@')[0].split(':')[0];
  return !!jid && [u?.lid, u?.id].some((x) => x && inti(x) === inti(jid));
}
async function periksaGagalBuka() {
  const now = Date.now();
  const telat = [...gagalBuka].filter(([, g]) => now - g.sejak > PULIH_MS && (!g.dilapor || now - g.dilapor > LAPOR_ULANG_MS));
  if (!telat.length) return;
  // Hanya kontak yang dikenal (pernah chat sebagai lead / ada riwayat); sisanya log saja.
  const leads = await supa.fetchRecentLeads(new Date(now - 60 * 24 * 3600 * 1000).toISOString());
  for (const [jid, g] of telat) {
    g.dilapor = now;
    const l = leads.find((x) => x.wa_jid === jid);
    if (!l && !getRiwayat(jid).length) { console.log(`[gagal-dekripsi] ${jid}: tidak pulih 10 menit, kontak tak dikenal — tidak dilaporkan`); continue; }
    const nama = l?.name || 'Klien';
    const num = String(l?.phone || jid).split('@')[0];
    const jam = new Date(g.sejak + 7 * 3600 * 1000).toISOString().slice(11, 16);
    const teks = `⚠️ Pesan WhatsApp dari ${nama} (wa.me/${num}) tidak bisa dibuka bot sejak ${jam} WIB.\n` +
      'Bot TIDAK tahu isinya dan belum membalas. Buka chat ini di HP Tetra dan balas manual.';
    console.log(`[gagal-dekripsi] ${jid}: tidak pulih 10 menit — admin dikabari`);
    await kirimTelegram(teks).catch((e) => console.error('[gagal-dekripsi] Telegram:', e.message));
    const adminJid = live.get().ADMIN_NOTIFY_JID;
    if (adminJid && sockTerakhir) {
      await sockTerakhir.sendMessage(adminJid, { text: teks }).then(rememberBotMsg)
        .catch((e) => console.error('[gagal-dekripsi] WA admin:', e.message));
    }
  }
  for (const [jid, g] of gagalBuka) if (now - g.sejak > 24 * 3600 * 1000) gagalBuka.delete(jid);
}
setInterval(() => periksaGagalBuka().catch((e) => console.error('[gagal-dekripsi]', e.message)), 60 * 1000).unref();

// ── Mode assist (keputusan Rama 30 Sep 2026) ────────────────────────────────
// Kontak yang sedang dipegang admin (pause admin/handoff) tapi pesan barunya
// tidak dibalas admin >= ASSIST_MENIT: bot menilai sendiri. Pertanyaan sederhana
// yang jawabannya pasti ada di info resmi -> bot jawab; hal krusial -> tetap diam.
// Pola dari TGO (auto_fallback_to_ai), tanpa mengubah pause admin.
const ASSIST_MENIT = Number(process.env.ASSIST_MENIT) || 30;
const ASSIST_MAKS_MS = 12 * 3600 * 1000;   // pesan lebih tua dari ini: jangan tiba-tiba dijawab
// ponytail: status "sudah dinilai" di memori; restart = dinilai ulang sekali, aman karena AI bisa [DIAM] lagi.
const assistDinilai = new Map();           // jid -> t pesan klien terakhir yang sudah dinilai
let jalankanAssist = null;                 // diisi registerMessageHandler (butuh socket aktif)
setInterval(() => jalankanAssist && jalankanAssist().catch((e) => console.error('[assist]', e.message)), 5 * 60 * 1000).unref();

const KONTEKS_ASSIST = (menit) =>
  `\n\nMODE AMBIL ALIH: chat ini sedang dipegang admin, tapi pesan terbaru klien belum dibalas admin selama ${menit} menit. ` +
  'Kamu BOLEH menjawab HANYA kalau pertanyaannya sederhana, tidak krusial, dan jawabannya pasti ada di info resmi ' +
  '(harga paket standar, isi paket, cara booking & DP minimal, jam operasional, format cetak, backdrop basic, transport, galeri, cek jadwal). ' +
  'Pesan berawalan "(admin)" adalah keputusan resmi: jangan diulang, dibantah, atau diralat. ' +
  'Kalau pertanyaannya SULIT atau krusial, JANGAN dijawab: balas persis "[SULIT: <topik singkat>]" supaya admin dikabari. Sulit = ' +
  'diskon/promo/harga khusus/negosiasi, pembayaran atau konfirmasi DP/pelunasan, perubahan/batal/reschedule booking, komplain, ' +
  'hal yang sedang dibahas atau dijanjikan admin, hal yang tadi diteruskan ke admin, atau kamu tidak yakin jawabannya. ' +
  'Kalau pesannya tidak perlu dijawab (ok, makasih, ucapan, stiker), balas persis [DIAM]. ' +
  'Jangan pakai [ADMIN_HANDOFF], [QUOTATION], [PERUBAHAN], atau [KIRIM]. ' +
  'Kalau menjawab: jangan perkenalkan diri, jawab langsung dan singkat; boleh bilang bagian lain tetap admin yang lanjutkan.';

function registerMessageHandler(sock) {
  sockTerakhir = sock;
  // Pesan keluar dari perangkat lain (admin bales manual dari HP) → bot diam.
  const handleFromMe = async (msg) => {
    const jid = msg.key.remoteJid;
    if (botSentIds.has(msg.key.id)) {
      botSentIds.delete(msg.key.id);
    } else if (!jid.endsWith('@g.us') && jid !== 'status@broadcast') {
      // Admin bales manual → bot diam 24 jam (PAUSE_HOURS), BUKAN 7 hari.
      // 7 hari terlalu lama: pelanggan yang chat lagi 2-3 hari kemudian jadi
      // dibisukan padahal admin belum tentu sempat balas.
      const adminPauseMs = (live.get().PAUSE_HOURS || 24) * 3600 * 1000;
      // Balasan admin masuk ingatan bot: tanpa ini, setelah pause habis bot tidak
      // tahu apa yang sudah admin janjikan dan bisa bertentangan.
      const teksAdmin = teksPesan(msg.message) || '[pesan non-teks]';
      tambahRiwayat(jid, 'assistant', `(admin) ${teksAdmin}`);
      await supa.upsertPause(jid, Date.now() + adminPauseMs, 'admin');
      if (!booking.get(jid) && RE_DP_ADMIN.test(teksAdmin)) {
        await mulaiBooking(jid, null, 'admin', 'DP-nya sudah diterima ya Kak, makasih!',
          'DP dikonfirmasi admin — data booking').catch((e) => console.error('[booking] gagal mulai:', e.message));
      }
      // Bubble klien yang masih menunggu dibuang: admin sudah pegang percakapan ini.
      const q = antrian.get(jid);
      if (q) { clearTimeout(q.timer); antrian.delete(jid); }
    }
  };

  // Kalau riwayat kosong (pertama kali / sudah lama), isi dari pesan masuk yang
  // tersimpan di Supabase. Klien yang isi form website minggu lalu tidak boleh
  // ditanya ulang jenis/tanggal/lokasi acaranya.
  const pastikanRiwayat = async (jid) => {
    if (getRiwayat(jid).length) return;
    const lama = await supa.fetchLeadMessages(jid, new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
    for (const r of lama) {
      const tgl = new Date(r.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      tambahRiwayat(jid, 'user', `(pesan ${tgl}) ${r.message}`);
    }
    if (lama.length) console.log(`[riwayat] ${jid.split('@')[0]}: ${lama.length} pesan lama dimuat dari database`);
  };

  // Ekstrak data acara dari chat terbaru (+ catatan klien) ke rekap booking,
  // lalu lapor admin kalau baru lengkap / berubah setelah lengkap.
  const perbaruiBooking = async (jid, teksBaru) => {
    // Gagal ekstrak tidak boleh menggagalkan balasan ke klien; pesan tetap di riwayat
    // dan ikut terbaca pada ekstraksi berikutnya.
    try {
      const b = booking.get(jid);
      const sebelum = b.lengkap;
      const pesan = getRiwayat(jid).slice(-16);
      if (teksBaru) pesan.push({ role: 'user', content: teksBaru });
      const ringkasan = getRingkasan(jid);
      if (ringkasan) pesan.unshift({ role: 'assistant', content: `CATATAN KLIEN: ${ringkasan}` });
      booking.perbarui(jid, await ekstrakBooking(b.data, pesan, booking.FIELD));
      await booking.sinkronOps(jid);
      await booking.laporBilaBerubah(sock, jid, sebelum);
    } catch (e) {
      console.error(`[booking] ${jid.split('@')[0]}: gagal perbarui data:`, e.message);
    }
  };

  // Mulai tahap booking: form (terisi sebagian) + katalog ke klien, rekap ke admin.
  const mulaiBooking = async (jid, msg, sumber, pembuka, judulAdmin) => {
    const b = booking.mulai(jid, sumber, msg?.pushName, msg ? phoneDigits(msg) : null);
    b.jenis = smart.parseLeadDetails(fullUserText(jid, '')).jenisAcara || '';
    await perbaruiBooking(jid, null);
    await booking.kirimTeks(sock, jid, booking.teksForm(b, pembuka), 'form-booking→customer');
    await booking.kirimKatalog(sock, jid);
    await booking.laporAdmin(sock, jid, judulAdmin);
  };

  // Klien minta penawaran resmi: susun permintaan dari chat, minta Tetra Ops
  // membuat DRAFT quotation (harga dihitung di sana). Rama menyetujui lewat
  // Telegram, lalu Tetra Ops mengirim PDF lewat perintah send-document.
  // external_id = hash isi permintaan: permintaan sama tidak membuat draft ganda.
  const mintaQuotation = async (jid, msg) => {
    try {
      const req = await ekstrakQuotation(getRiwayat(jid).slice(-30), getRingkasan(jid), await supa.fetchAddonNames());
      const digit = phoneDigits(msg);
      req.klien = { ...(req.klien || {}), wa: /^\d{8,15}$/.test(digit) ? digit : null };
      req.layanan = (req.layanan || []).filter((l) => l && l.kategori)
        .map((l) => ({ ...l, jam: l.jam ? Math.round(Number(l.jam)) : null, qty: Number(l.qty) || 1 }));
      req.addons = (req.addons || []).filter((a) => a && a.nama).map((a) => ({ nama: a.nama, qty: Number(a.qty) || 1 }));
      req.sumber = { jenis: 'wa_bot', wa_jid: jid };
      delete req.usulan_diskon;
      const external_id = `quo:${jid}:${crypto.createHash('sha1').update(JSON.stringify(req)).digest('hex').slice(0, 12)}`;
      const r = await postOps('/api/bot/quotation', { ...req, external_id });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
      tambahRiwayat(jid, 'assistant', `(catatan sistem) draft quotation ${r.json.doc_number || ''} dibuat, menunggu persetujuan admin`);
      console.log(`[quotation] ${jid.split('@')[0]}: draft ${r.json.doc_number || r.json.id} dibuat`);
    } catch (e) {
      console.error(`[quotation] ${jid.split('@')[0]}: gagal:`, e.message);
      await notifyAdmin(sock, phoneDigits(msg), { name: 'INFO' }, getRiwayat(jid),
        `klien minta penawaran resmi, draft otomatis GAGAL dibuat (${e.message.slice(0, 120)}) — tolong buat manual`).catch(() => {});
    }
  };

  // Permintaan perubahan booking: bot tidak mengubah apa pun. Admin dikabari di WA
  // dan Telegram CS Mintet; Tetra Ops (/api/bot/perubahan) menampilkan usulan
  // untuk disetujui admin. Endpoint belum ada (404) = cukup notifikasi.
  const laporPerubahan = async (jid, msg, perubahan, teksKlien) => {
    const num = phoneDigits(msg);
    const nama = msg.pushName || 'Klien';
    await notifyAdmin(sock, num, { name: 'PERUBAHAN' }, getRiwayat(jid), perubahan).catch((e) => console.error('[perubahan] WA:', e.message));
    await kirimTelegram(`✏️ Permintaan perubahan booking (perlu persetujuan admin)\n\n${nama} — wa.me/${num}\n` +
      `Permintaan: ${perubahan}\nPesan klien: "${teksKlien.replace(/\s+/g, ' ').slice(0, 200)}"\n\n` +
      'Bot belum mengubah apa pun dan sudah bilang ke klien bahwa admin yang mengonfirmasi.')
      .catch((e) => console.error('[perubahan] Telegram:', e.message));
    const bagian = perubahan.split('|').map((x) => x.trim());
    const r = await postOps('/api/bot/perubahan', {
      external_id: `chg:${jid}:${crypto.createHash('sha1').update(perubahan).digest('hex').slice(0, 12)}`,
      wa_jid: jid, client_wa: /^\d{8,15}$/.test(num) ? num : null, client_name: nama,
      jenis: (bagian[0] || '').toLowerCase().slice(0, 40), perubahan: bagian.slice(1).join(' | ') || perubahan,
      pesan_klien: teksKlien.slice(0, 1000),
    });
    if (!r.ok && r.status !== 404) console.error(`[perubahan→ops] HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    console.log(`[perubahan] ${jid.split('@')[0]}: ${perubahan}`);
  };

  jalankanAssist = async () => {
    if (!live.isEnabled()) return;
    const jam = new Date(Date.now() + (live.get().TIMEZONE_OFFSET ?? 7) * 3600e3).getUTCHours();
    if (jam < 6 || jam >= 23) return; // jam operasional Tetra 06.00–23.00
    const paused = await supa.fetchPausedContacts();
    if (!paused) return;
    const now = Date.now();
    let hp = null; // jid -> nomor asli (jid sering @lid), diambil sekali per putaran bila perlu
    const nomor = async (jid) => {
      if (!hp) {
        hp = {};
        for (const l of await supa.fetchRecentLeads(new Date(now - 30 * 864e5).toISOString())) hp[l.wa_jid] ||= l.phone;
      }
      return hp[jid] || jid.split('@')[0];
    };
    for (const [jid, until] of Object.entries(paused)) {
      if (until <= now || jid.endsWith('@g.us')) continue;
      const riw = getRiwayat(jid);
      let i = riw.length;
      while (i > 0 && riw[i - 1].role === 'user') i--;
      const baru = riw.slice(i);
      if (!baru.length || !baru[0].t) continue;
      const umur = now - baru[0].t;
      const tAkhir = baru.at(-1).t;
      if (umur < ASSIST_MENIT * 60e3 || now - tAkhir > ASSIST_MAKS_MS || assistDinilai.get(jid) === tAkhir) continue;
      assistDinilai.set(jid, tAkhir);
      const num = await nomor(jid);
      await runSerial(jid, () => assistSatu(jid, num, riw.slice(0, i), baru, Math.round(umur / 60e3)));
    }
  };

  const assistSatu = async (jid, num, hist, baru, menit) => {
    const teks = baru.map((p) => p.content).join('\n');
    const mulai = Date.now();
    const vendor = await vendorLib.cari(num);
    let jawab = await getAIResponse(hist, teks,
      buildLeadContext(fullUserText(jid, ''), jid, teks, '', vendor) + vendorLib.konteks(vendor) + booking.konteksAI(jid) + KONTEKS_ASSIST(menit));
    const nama = jid.split('@')[0];
    // Bot tidak menjawab tapi klien menunggu: admin WAJIB tahu (WA admin + Telegram CS Mintet).
    const kabari = async (topik) => {
      const kutip = teks.replace(/\s+/g, ' ').slice(0, 200);
      await notifyAdmin(sock, num, { name: 'INFO' }, getRiwayat(jid),
        `klien menunggu ${menit} menit, perlu admin: ${topik}`).catch((e) => console.error('[assist] WA:', e.message));
      await kirimTelegram(`⏳ Klien menunggu ${menit} menit, belum dibalas admin — wa.me/${num}\n` +
        `Perlu admin: ${topik}\nPesan klien: "${kutip}"`).catch((e) => console.error('[assist] Telegram:', e.message));
      console.log(`[assist] ${nama}: tidak dijawab bot (${topik}) — admin dikabari`);
    };
    const sulit = jawab.match(/\[(SULIT|ADMIN_HANDOFF|QUOTATION|PERUBAHAN)(?::\s*([^\]]*))?\]/i);
    if (sulit) return kabari(sulit[2] || sulit[1].toLowerCase());
    if (/\[DIAM\]/i.test(jawab)) { console.log(`[assist] ${nama}: tidak perlu dijawab`); return; }
    const info = (jawab.match(/\[INFO_ADMIN:?\s*([^\]]*)\]/i) || [])[1];
    jawab = jawab.replace(/\[(INFO_ADMIN|KIRIM)[^\]]*\]/gi, '').replace(/\*\*([^*\n]+)\*\*/g, '*$1*').trim();
    if (!jawab || /\[/.test(jawab) || RE_KLAIM.test(jawab)) {
      console.log(`[assist] ${nama}: balasan tidak aman, tidak dikirim: ${jawab.slice(0, 120)}`);
      return kabari('bot tidak yakin menjawab');
    }
    // Admin membalas selama bot menilai / pause dicabut: jangan ikut menjawab.
    if ((adminTerakhir.get(jid) || 0) >= mulai || getRiwayat(jid).at(-1)?.role !== 'user') {
      console.log(`[assist] ${nama}: admin sudah membalas, batal`);
      return;
    }
    tambahRiwayat(jid, 'assistant', jawab);
    await sendReply(sock, jid, [], { name: 'assist' }, jawab);
    if (info) await notifyAdmin(sock, num, { name: 'INFO' }, getRiwayat(jid), info).catch(() => {});
    console.log(`[assist] ${nama}: dijawab bot setelah admin diam ${menit} menit`);
  };

  // Satu batch = semua bubble klien yang masuk dalam satu jeda menunggu.
  const handleBatch = async (msgs) => {
    const msg = msgs[msgs.length - 1];
    const jid = msg.key.remoteJid;
    const keys = msgs.map((m) => m.key);
    let originalText = '';
    let bolehBalas = false; // false = error apa pun tidak memicu balasan darurat (mis. kontak di-pause)
    const mulaiProses = Date.now();
    try {
      originalText = msgs.map((m) => teksPesan(m.message)).filter(Boolean).join('\n');
      if (!originalText || jid === 'status@broadcast' || jid.endsWith('@g.us')) return;

      await pastikanRiwayat(jid);

      // [Auto-database logging] — tiap bubble tetap dicatat sendiri-sendiri
      for (const m of msgs) {
        const ts = Number(m.messageTimestamp) || 0;
        const teks = teksPesan(m.message);
        if (!teks) continue;
        const createdIso = new Date((ts || Math.floor(Date.now() / 1000)) * 1000).toISOString();
        const leadData = {
          wa_jid: jid,
          phone: phoneDigits(m),
          name: m.pushName || 'Klien',
          topic: classifyTopik(teks),
          message: teks,
        };
        const enriched = enrich({ ...leadData, created_at: createdIso });
        await supa.insertLead({
          ...leadData,
          segment: enriched.segmen,
          category: enriched.kategori,
          location: enriched.lokasi,
          event_date: enriched.tanggal_acara || null,
        });
        await syncToSheet(enriched);
      }

      // Periksa status pause dari Supabase (admin bisa saja membalas selagi kita menunggu)
      const pausedContacts = await supa.fetchPausedContacts();
      const alasanDiam = !live.isEnabled()
        ? 'bot dimatikan di bot_settings.enabled'
        : jid === 'status@broadcast'
        ? 'status/broadcast'
        : jid.endsWith('@g.us')
        ? 'pesan grup'
        : (pausedContacts && pausedContacts[jid] && pausedContacts[jid] > Date.now())
        ? 'kontak ini di-pause (hand-off ke admin)'
        : null;
      if (alasanDiam) {
        // Di-pause (admin pegang): bot diam, tapi pesan tetap masuk ingatan dan
        // data booking tetap dicatat. Dulu pesan selama pause hilang dari riwayat.
        if (alasanDiam.startsWith('kontak ini di-pause')) {
          tambahRiwayat(jid, 'user', originalText);
          if (booking.aktif(jid)) await perbaruiBooking(jid, null);
        }
        return;
      }
      bolehBalas = true;

      const t = originalText.toLowerCase();
      const vendor = await vendorLib.cari(phoneDigits(msg)); // rekanan: gaya & harga khusus
      const lead = !klienLamaCtx.has(jid) && getProspek(jid); // lead sales: mode rekanan
      const fullText = fullUserText(jid, originalText);

      // ── 0. Media: voice note tak bisa diputar; gambar/dokumen (sering bukti
      // transfer) hanya admin yang boleh menilai. 24 Sep bot sempat bilang
      // "DP sudah masuk" padahal tidak bisa melihat gambar maupun rekening.
      if (t.trim() === '[kirim voice note]') {
        const minta = 'Maaf Kak, voice note belum bisa aku putar di sini. Boleh diketik aja?';
        tambahRiwayat(jid, 'user', originalText);
        tambahRiwayat(jid, 'assistant', minta);
        await sendReply(sock, jid, keys, { name: 'voice-note' }, minta);
        return;
      }
      if (/\[kirim (gambar|dokumen)/.test(t)) {
        const media = msgs.filter((m) => /\[kirim (gambar|dokumen)/.test(teksPesan(m.message)));
        const soalBayar = RE_BAYAR.test(t) ||
          getRiwayat(jid).slice(-6).some((p) => p.role === 'user' && RE_BAYAR.test(p.content));
        // Tahap booking: file (desain pilihan, grand design, bukti pelunasan) diteruskan
        // ke admin, bot tetap melayani.
        if (booking.aktif(jid) || soalBayar) {
          await sock.readMessages(keys).catch(() => {});
          for (const m of media) await booking.teruskanKeAdmin(sock, m).catch((e) => console.error('[booking] gagal teruskan:', e.message));
          tambahRiwayat(jid, 'user', originalText);
          if (booking.aktif(jid)) {
            const b = booking.get(jid);
            b.nama = b.nama || msg.pushName; b.phone = b.phone || phoneDigits(msg);
            await perbaruiBooking(jid, null);
            const ack = 'Oke Kak, udah masuk. Aku terusin ke tim ya.';
            tambahRiwayat(jid, 'assistant', ack);
            await sendReply(sock, jid, keys, { name: 'file-booking' }, ack);
            await notifyAdmin(sock, phoneDigits(msg), { name: 'INFO' }, getRiwayat(jid), soalBayar
              ? 'bukti bayar/pelunasan dikirim klien di tahap booking (lihat pesan yang diteruskan) — cek mutasi'
              : 'klien kirim file di tahap booking (lihat pesan yang diteruskan)');
          } else {
            await mulaiBooking(jid, msg, 'bukti-transfer',
              'Makasih Kak, bukti transfernya udah masuk. Admin cek dulu ke rekening ya, kalau sudah oke invoice-nya dikirim ke sini.',
              'Bukti DP masuk — cek mutasi BCA, lalu input booking');
          }
          return;
        }
        // Foto cetakan photobooth (tamu minta softfile): baca nama & tanggal di frame, kirim link galeri tamu.
        const gbr = media.find((m) => m.message?.imageMessage);
        if (gbr) {
          const buf = await downloadMediaMessage(gbr, 'buffer', {}).catch((e) => { console.error('[galeri] unduh gambar gagal:', e.message); return null; });
          if (buf && await layaniGaleri(sock, msg, keys, originalText, buf.toString('base64'))) return;
        }
        await handoff(sock, msg, 'Klien kirim gambar/dokumen (cek: bukti transfer?)',
          'Udah masuk Kak, aku cek dulu ke admin ya. Nanti dibalas di sini.', originalText);
        return;
      }

      // ── 0b. Minta foto/softfile/link galeri acara → link galeri tamu (bukan handoff purna-jual) ──
      if (!lead && (galeri.RE_MINTA.test(t) || Date.now() - (galeri.ditanya.get(jid) || 0) < galeri.TANYA_MS) &&
          !/invoice|kwitansi|nota|bayar|pelunasan|reschedule/i.test(t) && await layaniGaleri(sock, msg, keys, originalText)) return;
      // ── 1. Kemitraan / sponsorship / franchise → handoff owner ──
      if (!vendor && !lead && isKemitraan(t)) {
        await handoff(sock, msg, 'Lead kemitraan/sponsorship/franchise',
          'Soal kerja sama ini biasanya langsung dibahas sama owner kami, Kak. Aku sampaikan dulu ya, nanti dibalas di sini.', originalText);
        return;
      }

      // ── 2. Purna-jual → handoff admin ──
      if (!lead && isPostSale(t)) {
        await handoff(sock, msg, 'Purna-jual (softfile/invoice/bayar/reschedule)',
          'Yang ini datanya dipegang admin, Kak. Aku terusin dulu ya, nanti dibalas di sini.', originalText);
        return;
      }

      // ── 3. Produk khusus → handoff (jangan karang harga) ──
      if (!lead && isSpecialProduct(t)) {
        await handoff(sock, msg, 'Produk khusus (mingle/instant/software/cetak doang)',
          'Yang itu di luar paket unlimited biasa Kak, jadi harga sama jadwalnya beda. Aku tanyain ke tim dulu ya, nanti aku kabarin di sini.', originalText);
        return;
      }

      // Command Admin: /stats
      if (t === '/stats' && phoneDigits(msg) === '5352849332') {
        const stats = execSync('node /home/ubuntu/tetra-wa-bot/stats.js').toString();
        await sendReply(sock, jid, keys, { name: 'stats' }, stats);
        return;
      }

      // ── 4. Pricelist / form website → lampiran PL kalau detail lengkap atau
      // klien minta langsung. Kalimatnya tetap dari AI (dulu template gate/B2B
      // yang terasa bot dan salah sasaran), jadi aturan gaya berlaku sama.
      // Lampiran dikirim SETELAH balasan teks: sapaan dulu, baru file.
      // Gerbang (keputusan Rama 1 Okt): PL hanya setelah kebutuhan tergali (jenis, tanggal,
      // lokasi), atau klien menolak memberi detail, atau minta PL lagi setelah ditanya.
      const detPL = smart.parseLeadDetails(fullText);
      const bolehPL = !!lead || smart.missingFields(detPL).length === 0 || smart.wantsDirectPL(originalText) ||
        (mintaPricelist(originalText) && getRiwayat(jid).some((p) => p.role === 'user' && mintaPricelist(p.content))) ||
        // Aturan 1 Okt: minta PL lagi SETELAH ditanya detail = boleh (Ranti 8 Okt ditahan padahal sudah ditanya).
        (mintaPricelist(originalText) && getRiwayat(jid).some((p) => p.role === 'assistant' && /\?/.test(String(p.content))));
      const plDenganPdf = /\bpdf\b|lengkap|semua (paket|layanan)|360|video ?booth|magazine|photo ?stage/i.test(originalText);
      let kirimPL = false;
      // Form website TIDAK lagi memicu lampiran otomatis (22 Okt, usulan CS Mintet 13 + hasil E3: rekomendasi teks
      // saja lebih baik; teks + gambar = dobel). Lampiran lewat permintaan klien atau penanda [KIRIM: pricelist] dari AI.
      if (mintaPricelist(originalText.replace(/\(halaman[^)]*\)/gi, ''))) kirimPL = bolehPL; // "(halaman Pricelist)" bukan permintaan
      if (lead) kirimPL = mintaPricelist(originalText); // lead minta PL: PL publik lengkap (Rama 7 Okt)
      // Klien lama hanya dikirimi pricelist kalau memintanya sendiri (keputusan Rama 6 Okt).
      const plKlienLama = !klienLamaCtx.has(jid) || mintaPricelist(originalText);

      // ── 5. AI dengan konteks lead ──
      if (booking.aktif(jid)) {
        const b = booking.get(jid);
        b.nama = b.nama || msg.pushName; b.phone = b.phone || phoneDigits(msg);
        await perbaruiBooking(jid, originalText);
      }
      let aiResponse = await getAIResponse(getRiwayat(jid), originalText,
        buildLeadContext(fullText, jid, originalText, msg.pushName, vendor) + konteksKlienLama(jid) + konteksTamu(jid) + prospekWa.konteksLead(lead) + vendorLib.konteks(vendor) + booking.konteksAI(jid));

      if (aiResponse.includes('[DIAM]')) {
        // Ucapan/broadcast/auto-reply: dicatat, tidak dibalas.
        tambahRiwayat(jid, 'user', originalText);
        console.log(`[diam] ${jid.split('@')[0]}: bukan calon klien, tidak dibalas`);
        return;
      }

      if (aiResponse.includes('[ADMIN_HANDOFF]')) {
        // Klien tidak boleh ditinggal diam: satu kalimat yang menyebut hal yang dicek (8 Okt: kalimat baku
        // "biar dijawab yang pegang datanya" terasa robot), lalu admin yang lanjut. Kalimat AI dipakai kalau
        // pendek & aman; selain itu kalimat cadangan.
        const kalimat = aiResponse.replace(/\[[A-Z_]+[^\]]*\]/g, '').replace(/\*\*([^*\n]+)\*\*/g, '*$1*').trim();
        const aman = kalimat && kalimat.length <= 260 && !RE_KLAIM.test(kalimat) && !/\bRp\.?\s?\d/i.test(kalimat);
        await handoff(sock, msg, `Handoff diminta oleh AI${aman ? `: ${kalimat.slice(0, 120)}` : ''}`,
          aman ? kalimat : 'Bentar ya Kak, yang ini aku tanyain ke admin dulu. Nanti aku kabarin di sini.', originalText);
        return;
      }

      // [INFO_ADMIN: topik] = admin perlu tahu (promo, backdrop custom, dll) tapi
      // bot tetap melayani. Penanda dibuang sebelum dikirim ke klien.
      const info = aiResponse.match(/\[INFO_ADMIN:?\s*([^\]]*)\]/);
      aiResponse = aiResponse.replace(/\[INFO_ADMIN[^\]]*\]/g, '').trim();
      const lampiran = [...new Set([...aiResponse.matchAll(/\[KIRIM:\s*(\w+)\s*\]/gi)].map((m) => m[1].toLowerCase()))]
        .filter((k) => LAMPIRAN[k] || k === 'pricelist');
      aiResponse = aiResponse.replace(/\[KIRIM:[^\]]*\]/gi, '').trim()
        .replace(/\*\*([^*\n]+)\*\*/g, '*$1*'); // tebal gaya Markdown -> gaya WhatsApp
      const quotation = /\[QUOTATION\]/i.test(aiResponse);
      aiResponse = aiResponse.replace(/\[QUOTATION\]/gi, '').trim();
      let perubahan = (aiResponse.match(/\[PERUBAHAN:?\s*([^\]]*)\]/i) || [])[1];
      aiResponse = aiResponse.replace(/\[PERUBAHAN[^\]]*\]/gi, '').trim();

      // Pengaman: klaim sudah mengubah/mengamankan sesuatu -> tulis ulang sekali;
      // masih mengklaim -> kalimat aman, dan admin tetap dikabari.
      if (RE_KLAIM.test(aiResponse)) {
        console.log(`[klaim] ${jid.split('@')[0]}: balasan mengklaim tindakan, ditulis ulang: ${aiResponse.slice(0, 120)}`);
        const ulang = await getAIResponse(getRiwayat(jid), originalText,
          buildLeadContext(fullText, jid, originalText, msg.pushName, vendor) + konteksKlienLama(jid) + konteksTamu(jid) + prospekWa.konteksLead(lead) + vendorLib.konteks(vendor) + booking.konteksAI(jid) +
          `\n\nKOREKSI SISTEM: draf balasanmu mengklaim sudah melakukan tindakan ("${aiResponse.slice(0, 200)}"). ` +
          'Kamu tidak bisa mengubah atau mengonfirmasi apa pun. Tulis ulang: teruskan ke admin, tanpa klaim, ikuti aturan KAMU TIDAK BISA MENGUBAH DATA.')
          .catch(() => '');
        const bersih = String(ulang).replace(/\[[A-Z_]+[^\]]*\]/g, '').trim();
        perubahan = perubahan || (String(ulang).match(/\[PERUBAHAN:?\s*([^\]]*)\]/i) || [])[1] || (RE_SOAL_BOOKING.test(originalText) ? `klien: "${originalText.slice(0, 150)}"` : undefined);
        aiResponse = bersih && !RE_KLAIM.test(bersih) ? bersih : (RE_SOAL_BOOKING.test(originalText) ? KALIMAT_AMAN : 'Siap Kak, aku bantu cek dulu ya, nanti aku kabari di chat ini.');
      }

      if (lead) aiResponse = prospekWa.tanpaAngka(aiResponse);

      // Admin sudah membalas selama bot memproses: jangan ikut menjawab.
      if ((adminTerakhir.get(jid) || 0) >= mulaiProses) {
        tambahRiwayat(jid, 'user', originalText);
        console.log(`[batal] ${jid.split('@')[0]}: admin sudah membalas saat bot memproses, balasan bot tidak dikirim`);
        if (perubahan) await laporPerubahan(jid, msg, perubahan, originalText);
        return;
      }

      tambahRiwayat(jid, 'user', originalText);
      if (aiResponse) {
        tambahRiwayat(jid, 'assistant', aiResponse);
        await sendReply(sock, jid, keys, { name: 'ai-reply', file: '' }, aiResponse);
        if (lead?.nomor) {
          const pl = kirimPL || lampiran.includes('pricelist') ? ' [+ pricelist]' : '';
          supa.catatJawabanProspek(lead.nomor, aiResponse + pl).catch((e) => console.error('[prospek] gagal catat jawaban:', e.message));
        }
      }
      if (kirimPL && plKlienLama) await kirimPricelist(sock, jid, 'auto-pricelist', { pdf: plDenganPdf || !!lead });
      // Pricelist selalu lewat kirimPricelist: gambar Unlimited Photobooth dulu
      // (yang dicari kebanyakan klien), lalu PDF lengkap. Sekali per percakapan.
      if (lampiran.includes('pricelist') && !kirimPL && bolehPL && plKlienLama &&
          !getRiwayat(jid).some((p) => String(p.content).includes('[kirim PDF pricelist]'))) {
        await kirimPricelist(sock, jid, 'ai-pricelist', { pdf: plDenganPdf || !!lead });
      }
      // Ucapan dan tindakan harus sama (insiden Ranti 8 Okt: bot 3x bilang pricelist "sudah terkirim"
      // padahal gerbang menahan file; klien kesal). Bot menjanjikan/mengklaim pricelist, atau klien bilang
      // belum menerimanya → file dikirim sekarang, gerbang "gali dulu" tidak berlaku lagi.
      if (janjiPricelist(aiResponse, originalText, lampiran, getRiwayat(jid))) {
        await kirimPricelist(sock, jid, 'janji-pricelist', { pdf: plDenganPdf || !!lead });
      }
      for (const k of lampiran) {
        const l = LAMPIRAN[k];
        if (!l) continue;
        if (k === 'layout' && lampiran.includes('panduan')) continue; // panduan sudah memuat layout
        const tanda = `[kirim PDF ${l.label}]`;
        // Hanya catatan pengiriman file yang dicek, bukan kalimat obrolan ("ini panduan ukurannya").
        const terkirim = getRiwayat(jid).flatMap((p) => String(p.content).match(/\[kirim (PDF|dokumen:)[^\]]*\]/gi) || []);
        if (terkirim.some((c) => c.includes(tanda) || l.pernah.test(c))) continue;
        const sent = await sendDocument(sock, jid, path.join(ASSETS_DIR, l.file), l.caption);
        rememberBotMsg(sent);
        deliveryLog.track(sent, `${k}→customer`);
        tambahRiwayat(jid, 'assistant', `${tanda}\n${l.caption}`);
      }
      if (info) {
        await notifyAdmin(sock, phoneDigits(msg), { name: 'INFO' }, getRiwayat(jid), info[1] || 'perlu dijawab admin');
      }
      if (quotation) await mintaQuotation(jid, msg);
      if (perubahan) await laporPerubahan(jid, msg, perubahan, originalText);
      await rangkumBilaPerlu(jid, ringkasPercakapan)
        .catch((e) => console.error(`[riwayat] gagal merangkum ${jid.split('@')[0]}:`, e.message));

    } catch (err) {
      console.error('Error memproses pesan:', err.message);
      // AI mati / error lain: klien tetap dijawab dan admin dipanggil, jangan bisu.
      if (!originalText || !bolehBalas) return;
      try {
        await handoff(sock, msg, `Bot error: ${err.message.slice(0, 120)}`,
          'Bentar ya Kak, aku sampaikan ke admin dulu biar langsung dibalas.', originalText);
      } catch (e2) {
        console.error('Handoff darurat gagal:', e2.message);
      }
    }
  };

  const jadwalkan = (jid, ms) => {
    const q = antrian.get(jid);
    if (!q) return;
    clearTimeout(q.timer);
    q.timer = setTimeout(() => flush(jid), ms);
  };

  const flush = (jid) => {
    const q = antrian.get(jid);
    if (!q) return;
    const masihNgetik = Date.now() - (ngetik.get(jid) || 0) < MASIH_NGETIK_MS;
    if (masihNgetik && Date.now() - q.mulai < TUNGGU_MAKS_MS) {
      jadwalkan(jid, MASIH_NGETIK_MS);
      return;
    }
    antrian.delete(jid);
    ngetik.delete(jid);
    console.log(`[tunggu] ${jid.split('@')[0]}: ${q.msgs.length} bubble digabung setelah ${Math.round((Date.now() - q.mulai) / 1000)} dtk`);
    runSerial(jid, () => handleBatch(q.msgs));
  };

  sock.ev.on('messaging-history.set', ({ messages, syncType }) => {
    if (syncType !== proto.HistorySync.HistorySyncType.ON_DEMAND) return;
    const perJid = {};
    for (const m of messages || []) {
      const j = m.key?.remoteJid;
      if (tarikSejarah.has(j)) (perJid[j] ||= []).push(m);
    }
    for (const [jid, list] of Object.entries(perJid)) {
      const st = tarikSejarah.get(jid);
      list.sort((a, b) => detik(a) - detik(b));
      const lama = list
        .map((m) => ({ m, teks: teksPesan(m.message) }))
        .filter((x) => x.teks)
        .map(({ m, teks }) => ({ role: m.key.fromMe ? 'assistant' : 'user', content: `(${tglPendek(detik(m))}) ${teks}`, t: detik(m) * 1000 }));
      gabungSejarah(jid, lama, st.sejakMs, st.halaman === 1);
      console.log(`[sejarah] ${jid.split('@')[0]}: ${lama.length} pesan lama dari HP (halaman ${st.halaman})`);
      if (list.length >= HALAMAN_SEJARAH && st.halaman < MAKS_HALAMAN) {
        mintaSejarah(sock, list[0].key, detik(list[0]) * 1000, st.halaman + 1, st.sejakMs);
      } else {
        tarikSejarah.delete(jid);
      }
    }
  });

  // Presence klien: "composing" = masih mengetik → jangan dulu balas;
  // "paused" = berhenti mengetik → boleh balas lebih cepat.
  sock.ev.on('presence.update', ({ id, presences }) => {
    if (!antrian.has(id)) return;
    for (const p of Object.values(presences || {})) {
      const s = p && p.lastKnownPresence;
      if (s === 'composing' || s === 'recording') ngetik.set(id, Date.now());
      else if (s === 'paused') { ngetik.delete(id); jadwalkan(id, 4000); }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key?.remoteJid;
      // Stub CIPHERTEXT (2) = pesan gagal didekripsi (Bad MAC). Dicatat per JID
      // supaya ketahuan apakah pesan klien yang hilang atau cuma grup/status.
      if (msg.messageStubType === 2) {
        // Umur pesan: setelah restart/reconnect WA menyodorkan ulang pesan LAMA yang dulu
        // sudah terbaca; itu bukan pesan klien yang terlewat, jangan jadi peringatan.
        const umurMenit = Math.round((Date.now() / 1000 - (Number(msg.messageTimestamp) || Date.now() / 1000)) / 60);
        console.log(`[gagal-dekripsi] ${jid} (${type}, umur ${umurMenit} mnt)`);
        if (jid && umurMenit <= 60 && !msg.key.fromMe && !milikSendiri(jid) && !jid.endsWith('@g.us') && jid !== 'status@broadcast' && !gagalBuka.has(jid)) {
          gagalBuka.set(jid, { sejak: Date.now(), dilapor: 0 });
        }
      }
      if (!jid || !msg.message) continue;
      if (!msg.key.fromMe) gagalBuka.delete(jid); // pesan dari kontak ini terbaca lagi = pulih
      if (msg.key.fromMe) {
        // Dicatat seketika, bukan di antrean: handleFromMe mengantre di belakang
        // batch yang sedang diproses, padahal batch itu perlu tahu admin sudah membalas.
        if (!botSentIds.has(msg.key.id)) adminTerakhir.set(jid, Date.now());
        runSerial(jid, () => handleFromMe(msg));
        continue;
      }
      if (jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;
      const ts = Number(msg.messageTimestamp) || 0;
      if (ts && Date.now() - ts * 1000 > PESAN_TERLAMA_MS) continue;
      if (!teksPesan(msg.message)) continue;
      // Kode verifikasi portal booking (TP-XXXXXX): dijawab langsung, di luar AI/antrean/pause.
      if (await portal.verifikasi(sock, msg, teksPesan(msg.message)).catch((e) => {
        console.error('[portal] verifikasi:', e.message);
        return false;
      })) continue;
      // Tim internal Tetra (Iqbal/Fahmi/Adit, TIM_WA): bukan klien. Balasannya atas pengingat dicatat dan
      // diteruskan ke topic Telegram CS Mintet; CS tidak menjawab (8 Okt 2026).
      const nomorTim = timWa.anggota(phoneDigits(msg)) ? phoneDigits(msg)
        : await prospekWa.nomorPengirim(sock, msg).then((n) => (timWa.anggota(n) ? n : '')).catch(() => '');
      if (nomorTim) {
        const teks = teksPesan(msg.message);
        tambahRiwayat(jid, 'user', teks);
        require('../lib/notify').kirimTelegram(`👥 Balasan tim (${nomorTim}) atas pengingat:\n${teks.slice(0, 800)}`)
          .catch((e) => console.error('[tim] gagal teruskan ke Telegram:', e.message));
        console.log(`[tim] ${nomorTim} membalas, diteruskan ke Telegram`);
        continue;
      }
      // Balasan atas sapaan sales (Bruno): dicatat ke prospek Tetra Ops (Hermes melapor ke
      // topic Sales, pengalihan ke PIC diproses Bruno) lalu dijawab CS dalam mode rekanan.
      const nomorProspek = await prospekWa.balasanProspek(sock, msg).catch(() => null);
      if (nomorProspek) {
        const teks = teksPesan(msg.message);
        const oto = prospekWa.otomatis(teks);
        if (RE_STOP.test(teks)) {
          await supa.stopProspek(nomorProspek, teks).catch((e) => console.error(`[prospek] gagal STOP ${nomorProspek}:`, e.message));
          tambahRiwayat(jid, 'user', teks);
          const ok = 'Siap Kak, nomor ini nggak akan kami hubungi lagi. Makasih ya 🙏';
          const sent = await sock.sendMessage(jid, { text: ok }).catch(() => null);
          if (sent) { rememberBotMsg(sent); tambahRiwayat(jid, 'assistant', ok); }
          console.log(`[prospek] ${nomorProspek} membalas STOP → jangan_hubungi`);
          continue;
        }
        const hasil = await supa.catatBalasanProspek(nomorProspek, teks, msg.pushName, oto)
          .catch((e) => { console.error(`[prospek] gagal catat balasan ${nomorProspek}:`, e.message); return null; });
        console.log(`[prospek] ${nomorProspek}${hasil?.nama ? ` (${hasil.nama})` : ''} membalas sapaan sales${oto ? ' (otomatis)' : ''} → dicatat ke Tetra Ops${hasil?.klienLama ? '; klien lama → dilayani CS' : ''}`);
        // Balasan ber-LID tersimpan di kunci lain dari sapaan (kunci nomor HP): salin sapaannya
        // supaya CS tahu ini balasan atas sapaan sales, bukan pengunjung baru (kasus Riki 6 Okt).
        const RE_SAPA = /\[sapaan (pertama )?dari tim sales/;
        const pnJid = `${nomorProspek}@s.whatsapp.net`;
        if (pnJid !== jid && !getRiwayat(jid).some((p) => RE_SAPA.test(String(p.content)))) {
          const sapa = getRiwayat(pnJid).filter((p) => p.role === 'assistant' && RE_SAPA.test(String(p.content))).at(-1);
          if (sapa) tambahRiwayat(jid, 'assistant', sapa.content);
        }
        if (hasil?.klienLama) klienLamaCtx.set(jid, hasil);
        else if (hasil?.tamuBooth) tamuCtx.set(jid, hasil.tamuBooth);
        else {
          // Lead (venue/WO/korporat): dilayani CS dalam mode rekanan (keputusan Rama 7 Okt).
          // Auto-reply lagi setelah kita menjelaskan diri: cukup dicatat, tidak dibalas.
          tandaiProspek(jid, { nama: hasil?.nama || msg.pushName || null, nomor: nomorProspek });
          if (oto && getRiwayat(jid).some((p) => p.role === 'assistant' && !RE_SAPA.test(String(p.content)))) {
            tambahRiwayat(jid, 'user', teks);
            continue;
          }
        }
      }

      if (!sudahSubscribe.has(jid)) {
        sudahSubscribe.add(jid);
        sock.presenceSubscribe(jid).catch(() => {});
      }
      // Penarikan riwayat dari HP dimatikan (30 Sep): tidak pernah dijawab HP di Baileys 6
      // (0 respons sejak 27 Sep) tapi tiap permintaan memunculkan popup "Syncing..." di HP.
      // Nyalakan lagi dengan TARIK_SEJARAH=on kalau terbukti jalan (mis. di Baileys 7).
      if (process.env.TARIK_SEJARAH === 'on' && !sudahSejarah(jid) && !sudahMinta.has(jid)) {
        sudahMinta.add(jid);
        mintaSejarah(sock, msg.key, ts * 1000, 1, ts * 1000);
      }
      const q = antrian.get(jid) || { msgs: [], timer: null, mulai: Date.now() };
      q.msgs.push(msg);
      antrian.set(jid, q);
      jadwalkan(jid, TUNGGU_MS());
    }
  });
}

module.exports = { registerMessageHandler, buildLeadContext, _teksPesan: teksPesan, _janjiPricelist: janjiPricelist, _RE_STOP: RE_STOP, periksaGagalBuka, _gagalBuka: gagalBuka, _assist: () => jalankanAssist(), _KONTEKS_ASSIST: KONTEKS_ASSIST };
