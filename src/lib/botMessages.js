// Lacak id pesan yang dikirim bot, biar pesan bot sendiri tidak salah dikira
// "admin bales manual" (keduanya muncul sebagai fromMe). Lihat handler messages.js.
const botSentIds = new Set();

// Cache isi pesan terkirim (id -> proto.IMessage). Dipakai callback getMessage()
// di bot.js: saat device penerima gagal decrypt, ia kirim "retry receipt" minta
// kirim ulang, dan Baileys butuh isi pesan asli untuk re-encrypt. Tanpa cache ini
// pesan nyangkut "Waiting for this message" selamanya di sisi penerima.
const MSG_CACHE_MAX = 1000;
const sentMessages = new Map(); // id -> proto.IMessage (insertion-ordered)

function rememberBotMsg(sent) {
  const id = sent?.key?.id;
  if (id) botSentIds.add(id);
  // Batasi pertumbuhan memori; set hanya dipakai untuk dedup jangka pendek.
  if (botSentIds.size > 1000) botSentIds.clear();

  // Simpan isi pesan untuk melayani retry-receipt.
  if (id && sent.message) {
    sentMessages.set(id, sent.message);
    if (sentMessages.size > MSG_CACHE_MAX) {
      // Buang entri terlama (Map menjaga urutan insertion).
      sentMessages.delete(sentMessages.keys().next().value);
    }
  }
}

// Ambil isi pesan terkirim by id untuk getMessage() Baileys.
function getSentMessage(id) {
  return sentMessages.get(id);
}

module.exports = { botSentIds, rememberBotMsg, getSentMessage };
