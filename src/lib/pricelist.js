// Kirim paket pricelist: GAMBAR dulu (harga langsung kebaca di chat), lalu PDF
// untuk yang mau lihat lengkapnya. Satu-satunya tempat kalimat & nama berkasnya
// ditulis — dipakai oleh balasan otomatis (handlers/messages.js) dan oleh
// perintah manual send-pdf (bot.js).
const path = require('path');
const fs = require('fs');

const { sendDocument, delay } = require('./sender');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');
const { tambahRiwayat } = require('./store');

const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');

const GAMBAR_RINGKAS = 'UNLIMITED PHOTOBOOTH.jpg';
// Caption dibuat minimal: file-nya yang "bicara", kalimat penjualan ditangani AI
// (auto-pricelist) atau admin (send-pdf). Jangan tanya tanggal di caption — AI
// sudah tanya dengan kail yang lebih natural.
const CAPTION_GAMBAR = 'Paket unlimited cetak — harga all-in 📸';

const PDF_LENGKAP = 'PRICELIST TETRA PHOTOBOOTH.pdf';
const CAPTION_PDF = 'Pricelist lengkap Tetra Photobooth.';

// Sengaja sempit: hanya permintaan pricelist yang gamblang. Kata seperti "harga"
// atau "berapa" saja tidak cukup — "DP berapa?" lebih pas dijawab AI daripada
// dikirimi dua lampiran.
const KATA_KUNCI = [
  'pricelist', 'price list', 'priceliat', 'prices', 'daftar harga', 'list harga',
  'minta pl', 'info pl', 'lihat pl', 'liat pl', 'cek pl',
];

function mintaPricelist(teks) {
  const t = String(teks || '').toLowerCase();
  return KATA_KUNCI.some((k) => t.includes(k));
}

// Kirim gambar lalu PDF. `label` hanya untuk log pengiriman.
// Mengembalikan { idGambar, idPdf }.
// Default cukup GAMBAR (keputusan Rama 1 Okt: teks + gambar + PDF = dobel, klien kabur).
// PDF lengkap hanya kalau `pdf` (klien minta layanan lain/semua paket, atau perintah manual admin).
async function kirimPricelist(sock, jid, label = 'pricelist', { pdf: denganPdf = false } = {}) {
  let idGambar = '';

  const pathGambar = path.join(ASSETS_DIR, GAMBAR_RINGKAS);
  if (fs.existsSync(pathGambar)) {
    const img = await sendDocument(sock, jid, pathGambar, CAPTION_GAMBAR);
    rememberBotMsg(img);
    deliveryLog.track(img, `${label}-gambar`);
    idGambar = img?.key?.id || '';
    await delay(2500); // jeda, supaya tidak terasa ditembakkan sekaligus
  }

  let pdf = null;
  if (denganPdf || !idGambar) {
    pdf = await sendDocument(sock, jid, path.join(ASSETS_DIR, PDF_LENGKAP), CAPTION_PDF);
    rememberBotMsg(pdf);
    deliveryLog.track(pdf, `${label}-pdf`);
  }
  // Penanda "[kirim PDF pricelist]" dipakai pencegah kirim-ulang; tetap ditulis walau hanya gambar.
  tambahRiwayat(jid, 'assistant', pdf ? '[kirim PDF pricelist] + gambar ringkas paket unlimited'
    : '[kirim PDF pricelist] (hanya gambar harga paket unlimited)');
  return { idGambar, idPdf: pdf?.key?.id || '' };
}

module.exports = {
  kirimPricelist,
  mintaPricelist,
  ASSETS_DIR,
  GAMBAR_RINGKAS,
  PDF_LENGKAP,
};
