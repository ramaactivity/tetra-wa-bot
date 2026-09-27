// Notif lead ke admin: tiap kali bot membalas lead, ping ADMIN_NOTIFY_JID
// dengan pengirim, topik (nama rule), dan kutipan pesan asli.
// Notif ini juga pesan bot → id-nya diingat agar tak ke-detect "admin manual".
const live = require('./liveConfig');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');

// `from` = nomor HP asli (digit) hasil resolve LID→senderPn, atau bisa juga
// JID lengkap. Ambil bagian sebelum '@' supaya dua-duanya aman buat wa.me.
// `from` = nomor HP asli, `riwayat` = array pesan terakhir
async function notifyAdmin(sock, from, rule, riwayat, extra = '') {
  const adminJid = live.get().ADMIN_NOTIFY_JID;
  if (!adminJid) return;

  const num = String(from || '').split('@')[0];
  // rule.name 'INFO' = admin perlu menjawab satu hal, bot tetap melayani sisanya.
  const judul = rule?.name === 'INFO'
    ? '📝 *Info untuk Admin — bot tetap melayani klien*'
    : '🔔 *Handoff ke Admin — Tetra Photobooth*';
  let notif = `${judul}\n` +
    `Pelanggan: wa.me/${num}\n` +
    `${rule?.name === 'INFO' ? 'Perlu dijawab admin' : 'Alasan'}: ${extra}\n\n` +
    `*Riwayat Chat (terakhir):*\n`;
  
  // Format riwayat (misalnya 3-5 pesan terakhir)
  const ringkasan = Array.isArray(riwayat) ? riwayat.slice(-5).map(m => `[${m.role.toUpperCase()}] ${m.content}`).join('\n') : riwayat;
  notif += ringkasan;

  const sent = await sock.sendMessage(adminJid, { text: notif });
  rememberBotMsg(sent);
  deliveryLog.track(sent, 'notif→admin');
}

module.exports = { notifyAdmin };
