// Notif lead ke admin: tiap kali bot membalas lead, ping ADMIN_NOTIFY_JID
// dengan pengirim, topik (nama rule), dan kutipan pesan asli.
// Notif ini juga pesan bot → id-nya diingat agar tak ke-detect "admin manual".
const live = require('./liveConfig');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');

// `from` = nomor HP asli (digit) hasil resolve LID→senderPn, atau bisa juga
// JID lengkap. Ambil bagian sebelum '@' supaya dua-duanya aman buat wa.me.
async function notifyAdmin(sock, from, rule, originalText, extra = '') {
  const adminJid = live.get().ADMIN_NOTIFY_JID;
  if (!adminJid) return; // fitur dimatikan kalau JID kosong

  const num = String(from || '').split('@')[0];
  let notif =
    `🔔 *Lead baru — Tetra Photobooth*\n` +
    `Dari: wa.me/${num}\n` +
    `Topik: ${rule.name}\n` +
    `Pesan: "${originalText}"`;
  if (extra) notif += `\n${extra}`; // mis. ringkasan ketersediaan slot

  const sent = await sock.sendMessage(adminJid, { text: notif });
  rememberBotMsg(sent);
  deliveryLog.track(sent, 'notif→admin'); // pantau sampai/dibaca di HP admin
}

module.exports = { notifyAdmin };
