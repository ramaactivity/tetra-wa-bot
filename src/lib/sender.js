// Pengiriman balasan dengan perilaku human-like (mitigasi ban + natural):
// tandai read → delay acak 2–5 dtk → presence "composing" ~1 dtk → kirim.
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
  await sock.readMessages([msgKey]);
  await delay(2000 + Math.floor(Math.random() * 3000));
  await sock.sendPresenceUpdate('composing', jid);
  await delay(1000);

  // --- kirim balasan (teks / file) ---
  const filePath = rule.file ? path.join(__dirname, '..', '..', rule.file) : null;
  let sent;

  if (filePath && fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      sent = await sock.sendMessage(jid, { image: { url: filePath }, caption: replyText });
    } else {
      sent = await sock.sendMessage(jid, {
        document: { url: filePath },
        fileName: path.basename(filePath),
        mimetype: ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
        caption: replyText,
      });
    }
  } else {
    sent = await sock.sendMessage(jid, { text: replyText });
  }

  rememberBotMsg(sent);
  deliveryLog.track(sent, 'balasan→customer', { toLead: true }); // pantau + tulis status ke lead
  return sent;
}

module.exports = { sendReply, delay };
