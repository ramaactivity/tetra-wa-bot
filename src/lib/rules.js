// Logika pemilihan & penyusunan balasan: ekstrak teks, cari rule yang cocok,
// cek jam kerja, dan tambahkan catatan after-hours bila perlu.
//
// Sumber config = liveConfig (config.js + override Supabase). Dibaca per-panggil
// supaya perubahan dari dashboard langsung berlaku tanpa restart.
const live = require('./liveConfig');

// Ambil teks dari berbagai tipe pesan WhatsApp.
function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  );
}

// Rule pertama yang cocok menang (prioritas = urutan RULES — DB sudah diurut
// priority asc; config.js fallback juga sudah berurutan).
// Matching: contains + case-insensitive (textLower sudah lowercase).
const findRule = (textLower) =>
  live
    .getRules()
    .find((rule) =>
      (rule.keywords || []).some((k) => textLower.includes(String(k).toLowerCase()))
    );

// Server pakai UTC → hitung jam lokal via TIMEZONE_OFFSET (WIB = +7).
function isWithinBusinessHours() {
  const cfg = live.get();
  const localHour = (new Date().getUTCHours() + cfg.TIMEZONE_OFFSET) % 24;
  return localHour >= cfg.BUSINESS_START_HOUR && localHour < cfg.BUSINESS_END_HOUR;
}

// Deteksi salam. Normalisasi (buang spasi, apostrof, dll) supaya semua variasi kebaca:
// "Assalamualaikum", "Assalamu'alaikum", "assalamu alaikum", "asalamualaikum", dll.
function hasSalam(text) {
  const norm = (text || '').toLowerCase().replace(/[^a-z]/g, '');
  return norm.includes('assalamualaikum') || norm.includes('asalamualaikum');
}

// Susun teks balasan: salam (bila ada) di paling atas → reply rule → catatan after-hours.
function buildReply(rule, incomingText = '') {
  const cfg = live.get();
  let text = rule.reply;
  if (cfg.SALAM_REPLY && hasSalam(incomingText)) text = `${cfg.SALAM_REPLY}\n\n${text}`;
  if (!isWithinBusinessHours() && cfg.AFTER_HOURS_NOTE) text += cfg.AFTER_HOURS_NOTE;
  return text;
}

module.exports = { extractText, findRule, isWithinBusinessHours, hasSalam, buildReply };
