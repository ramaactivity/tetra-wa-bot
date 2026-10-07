// Portal klien Tetra Ops (booking publik, keputusan Rama 6 Okt 2026 — DR-027 di repo tetra-ops).
//  1) Verifikasi nomor: klien MENGIRIM "TP-XXXXXX" dari WA-nya. Pesan diteruskan ke
//     Tetra Ops POST /api/bot/portal-verify (yang mencocokkan nomor pengirim), lalu
//     balasannya dikirim apa adanya. Tidak lewat AI / antrean / hand-off: kode harus
//     dijawab walau kontak sedang di-pause admin.
//  2) Pesan transaksi dari Tetra Ops (DP diterima / ditolak): perintah
//     send-portal:{"nomor","pesan"}. Di luar rem 15/hari sapaan sales karena klien
//     menunggunya, tapi tetap dijatah per hari supaya antrean nyasar tidak jadi spam.
const { postOps } = require('./availability');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');
const store = require('./store');

const RE_KODE = /\bTP-[A-Z0-9]{6}\b/i;
const MAKS_PER_HARI = 60;
// ponytail: hitungan di memori, reset saat restart. Cukup untuk ±puluhan pesan/hari.
let hari = '';
let terkirim = 0;

async function nomorAsli(sock, msg) {
  const jid = msg.key?.remoteJid || '';
  let pn = jid;
  if (jid.endsWith('@lid')) {
    pn = msg.key?.remoteJidAlt || msg.key?.senderPn ||
      (await sock?.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null)) || '';
  }
  return String(pn).split('@')[0].split(':')[0].replace(/\D/g, '') || null;
}

/** true = pesan ini kode verifikasi portal dan sudah dibalas; jangan diproses lagi. */
async function verifikasi(sock, msg, teks) {
  if (!RE_KODE.test(teks)) return false;
  const jid = msg.key.remoteJid;
  const r = await postOps('/api/bot/portal-verify', { text: teks, phone: await nomorAsli(sock, msg), wa_jid: jid });
  if (!r.ok || !r.json?.matched || !r.json.reply) {
    if (!r.ok) console.error(`[portal] verifikasi gagal HTTP ${r.status}: ${r.json?.error || ''}`);
    return false; // Tetra Ops tak terjangkau → biarkan alur CS biasa yang menjawab
  }
  await sock.readMessages([msg.key]).catch(() => {});
  const sent = await sock.sendMessage(jid, { text: r.json.reply });
  rememberBotMsg(sent);
  deliveryLog.track(sent, 'portal-verifikasi→customer');
  store.tambahRiwayat(jid, 'user', teks);
  store.tambahRiwayat(jid, 'assistant', `${r.json.reply}\n[otomatis: verifikasi portal booking]`);
  console.log(`[portal] verifikasi ${jid.split('@')[0]}: ${r.json.ok ? 'berhasil' : 'ditolak'}`);
  return true;
}

/** Jatah harian send-portal. Hasil: { ok } atau { tolak }. */
function cek() {
  const now = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  if (now !== hari) { hari = now; terkirim = 0; }
  return terkirim >= MAKS_PER_HARI ? { tolak: `jatah ${MAKS_PER_HARI} pesan portal/hari habis` } : { ok: true };
}
function catat() { terkirim += 1; }

module.exports = { verifikasi, cek, catat, MAKS_PER_HARI };
