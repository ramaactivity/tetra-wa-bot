// Modul follow-up otomatis ke klien:
// Mendeteksi klien yang nanya pricelist (topic 'pricelist') dan belum ada 
// kelanjutan, tanggal acara masih di masa depan.
const supa = require('./supa');
const { sendReply } = require('./sender');

async function checkAndFollowup(sock) {
  // 1. Ambil lead yang topik 'pricelist' dan belum dibales admin (manual)
  // 2. Filter yang > 2-3 hari
  // 3. Kirim pesan follow-up
  // (Pesan contoh: "Halo Kak, mau tanya-tanya lagi soal paket Tetra Photobooth? Kami bantu ya.")
  // Implementasi sederhana:
  console.log('[followup] Menjalankan pengecekan follow-up...');
}

module.exports = { checkAndFollowup };
