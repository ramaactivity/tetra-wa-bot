// Pengiriman balasan dengan perilaku human-like (mitigasi ban + natural):
// jeda 1–3 dtk → tandai read → "mengetik" sepanjang balasannya (±40 ms per
// karakter, 2–12 dtk) → kirim. Penundaan utama (menunggu klien selesai mengetik)
// ada di handlers/messages.js; di sini hanya ritme membaca & mengetik.
// Mendukung lampiran file (gambar / dokumen) dari folder assets/.
const fs = require('fs');
const path = require('path');

const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Kirim balasan ke jid. rule.file (opsional) = path relatif ke root project.
// Mengembalikan objek pesan terkirim (untuk diingat di botSentIds).
async function sendReply(sock, jid, msgKey, rule, replyText) {
  // --- human-like ---
  await delay(1000 + Math.floor(Math.random() * 2000));
  await sock.readMessages([].concat(msgKey));
  await sock.sendPresenceUpdate('composing', jid);
  await delay(Math.min(12000, 2000 + String(replyText || '').length * 40));
  await sock.sendPresenceUpdate('paused', jid);

  // --- kirim balasan (teks / file) ---
  const filePath = rule.file ? path.join(__dirname, '..', '..', rule.file) : null;
  let sent;

  if (filePath && fs.existsSync(filePath)) {
    sent = await sendDocument(sock, jid, filePath, replyText);
  } else {
    sent = await sock.sendMessage(jid, { text: replyText });
  }

  rememberBotMsg(sent);
  deliveryLog.track(sent, 'balasan→customer', { toLead: true }); // pantau + tulis status ke lead
  console.log(`[reply] → ${String(jid).split('@')[0]}: ${String(replyText).slice(0, 160).replace(/\n/g, ' | ')}`);
  return sent;
}

// Kirim satu berkas (gambar atau dokumen) ke jid. Dipakai oleh sendReply dan oleh
// perintah `send-pdf:` di command poller, supaya aturan mimetype/caption cuma ada
// di satu tempat.
async function sendDocument(sock, jid, filePath, caption) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    return sock.sendMessage(jid, { image: { url: filePath }, caption });
  }
  return sock.sendMessage(jid, {
    document: { url: filePath },
    fileName: path.basename(filePath),
    mimetype: ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
    caption,
  });
}

module.exports = { sendReply, sendDocument, delay };
