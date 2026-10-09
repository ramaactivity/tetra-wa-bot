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
    : rule?.name === 'PERUBAHAN'
    ? '✏️ *Permintaan PERUBAHAN booking — perlu persetujuan admin*\nBot TIDAK mengubah apa pun. Cek jadwal, ubah di Tetra Ops, lalu konfirmasi ke klien.'
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
  if (rule?.name !== 'PERUBAHAN' && RE_GRUP.test(String(extra))) await kirimGrupAdmin(sock, notif);
}

// Grup WA admin "Tetra Photobooth" (keputusan Rama 8 Okt): HANYA yang penting — acara dadakan dan
// booking/DP/pelunasan masuk. Permintaan perubahan TIDAK (Rama: "ini gausah"). Handoff & info biasa tidak ("jangan terlalu bala di grup owner").
// Selalu diberi tanda bahwa pengirimnya bot, bukan Rama. Gagal kirim ke grup tidak menggagalkan apa pun.
const RE_GRUP = /\bDADAKAN\b|bukti (dp|bayar|transfer|pelunasan)|\bdp (masuk|dikonfirmasi|diterima)|pelunasan|booking (masuk|baru)/i;
async function kirimGrupAdmin(sock, teks) {
  const grup = live.get().ADMIN_GROUP_JID;
  if (!grup || !grup.endsWith('@g.us')) return null;
  const g = await sock.sendMessage(grup, { text: `🤖 _Pesan otomatis dari bot CS Mintet, bukan Rama._\n\n${teks}` })
    .catch((e) => { console.error('[notif] gagal ke grup admin:', e.message); return null; });
  if (g) { rememberBotMsg(g); deliveryLog.track(g, 'notif→grup-admin'); }
  return g;
}

// Kirim teks ke topic Telegram CS Mintet (grup Agent Rama). Melempar error kalau gagal.
const TG_CHAT = process.env.ESKALASI_TELEGRAM_CHAT_ID || '-1004377661750';
const TG_THREAD = process.env.ESKALASI_TELEGRAM_THREAD_ID || '109';
async function kirimTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN kosong');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, message_thread_id: Number(TG_THREAD), text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status} ${(await res.text()).slice(0, 150)}`);
}

// Grup WA crew "Tetra Crew": briefing & pengingat rekap dari Tetra Ops (perintah send-grup-crew). Tanda pesan
// otomatis dibuat halus di bawah (Rama 9 Okt: "catatan dikirim botnya subtle aja").
async function kirimGrupCrew(sock, teks) {
  const grup = live.get().CREW_GROUP_JID;
  if (!grup || !grup.endsWith('@g.us')) return null;
  const g = await sock.sendMessage(grup, { text: `${teks}\n\n_🤖 otomatis_` })
    .catch((e) => { console.error('[notif] gagal ke grup crew:', e.message); return null; });
  if (g) { rememberBotMsg(g); deliveryLog.track(g, 'briefing→grup-crew'); }
  return g;
}
module.exports = { notifyAdmin, kirimTelegram, kirimGrupAdmin, kirimGrupCrew, RE_GRUP };
