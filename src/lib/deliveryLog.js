// Logging tanda-terima pesan KELUAR (balasan ke customer & notif admin).
// Memantau perubahan status pesan dari WhatsApp: SERVER_ACK → DELIVERY_ACK → READ.
// Tujuan: bukti NYATA tiap balasan bot benar-benar SAMPAI & DIBACA di HP penerima —
// menjawab "gimana tampilannya di HP customer" tanpa menebak. Murni mendengar event
// `messages.update` Baileys; TIDAK mengubah cara kirim, TIDAK menyentuh auth_info.
//
// Catatan: status READ (👁️) hanya muncul kalau penerima mengaktifkan read receipt.
// Kalau read receipt-nya OFF, kita berhenti di DELIVERY_ACK (✓✓ terkirim) — itu sudah
// cukup sebagai bukti pesan sampai ke HP penerima.

const supa = require('./supa');

const MAX = 800; // batasi memori; pesan terlama dibuang saat penuh

// id pesan -> { jid, label, last, toLead } (last = status tertinggi yg sudah dicatat,
// toLead = tulis status ke whatsapp_bot_leads buat dashboard Tetra Ops)
const tracked = new Map();

// proto.WebMessageInfo.Status (angka) → label manusiawi.
const STATUS = {
  0: '❌ error kirim',
  1: '⏳ pending',
  2: '✓ sampai server WA',
  3: '✓✓ TERKIRIM ke HP penerima',
  4: '👁️ DIBACA penerima',
  5: '▶️ diputar',
};
const NAME_TO_NUM = { ERROR: 0, PENDING: 1, SERVER_ACK: 2, DELIVERY_ACK: 3, READ: 4, PLAYED: 5 };

// Daftarkan 1 pesan terkirim untuk dipantau status-nya. `label` = konteks singkat
// (mis. "balasan→customer" / "notif→admin"). opts.toLead=true → status delivered/read
// ditulis ke whatsapp_bot_leads (buat dashboard Tetra Ops). Dipanggil setelah sendMessage.
function track(sent, label, opts = {}) {
  const id = sent?.key?.id;
  if (!id) return;
  tracked.set(id, { jid: sent.key?.remoteJid || '?', label, last: 1, toLead: !!opts.toLead });
  if (tracked.size > MAX) tracked.delete(tracked.keys().next().value);
}

// Pasang listener status. Panggil sekali per socket (di bot.js).
function register(sock) {
  sock.ev.on('messages.update', (updates) => {
    for (const u of updates || []) {
      const id = u.key?.id;
      if (!id) continue;
      const rec = tracked.get(id);
      if (!rec) continue; // bukan pesan yang kita lacak → abaikan

      let st = u.update?.status;
      if (st === undefined || st === null) continue;
      if (typeof st === 'string') st = NAME_TO_NUM[st] ?? Number(st);
      st = Number(st);
      if (!Number.isFinite(st) || st <= rec.last) continue; // hanya catat progres maju

      rec.last = st;
      const num = String(rec.jid).split('@')[0];
      console.log(`📬 [${rec.label}] ${num}: ${STATUS[st] || `status ${st}`}`);

      // Tulis status ke lead (buat dashboard) hanya untuk balasan customer,
      // saat delivered (3) / read (4). Best-effort, tak blok event handler.
      if (rec.toLead && st >= 3) {
        supa.updateLatestLeadStatus(rec.jid, st >= 4 ? 'read' : 'delivered').catch(() => {});
      }

      if (st >= 4) tracked.delete(id); // sudah dibaca → selesai dipantau
    }
  });
}

module.exports = { track, register };
