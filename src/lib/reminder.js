// Pengingat berkala ke admin: setiap REMINDER_INTERVAL_HOURS (hanya pada jam
// aktif), kirim daftar LEAD yang BELUM dibales admin secara manual.
//
// Definisi "belum dibales": untuk tiap kontak, ambil lead (pesan) TERBARU-nya;
// kalau admin belum pernah balas manual SETELAH waktu pesan itu, berarti masih
// menunggu. Sinyal "admin balas manual" = bot_paused_contacts.updated_at (bot
// meng-upsert ini tiap mendeteksi balasan manual dari WA Tetra — lihat store.js
// setPause & handlers/messages.js).
//
// Semua best-effort: kalau Supabase down / socket belum siap, tick dilewati.
const path = require('path');

const live = require('./liveConfig');
const supa = require('./supa');
const { loadJson, saveJson } = require('./store');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');

const HOURS = (n) => n * 3600 * 1000;

// Bisa di-override via .env server; default sesuai kesepakatan.
const INTERVAL_H = Number(process.env.REMINDER_INTERVAL_HOURS) || 3;   // tiap 3 jam
const ACTIVE_START = Number(process.env.REMINDER_ACTIVE_START) || 8;   // jam lokal mulai
const ACTIVE_END = Number(process.env.REMINDER_ACTIVE_END) || 22;     // jam lokal selesai
const LOOKBACK_H = Number(process.env.REMINDER_LOOKBACK_HOURS) || 72;  // abaikan lead > 3 hari
const MAX_LIST = 10;                                                   // maksimal yg dirinci
const TICK_MS = 30 * 60 * 1000;                                       // cek tiap 30 menit

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'reminder.json');

let lastSentAt = 0;

// Jam lokal sekarang (pakai TIMEZONE_OFFSET dari live config, mis. 7 = WIB).
function localHour() {
  const off = live.get().TIMEZONE_OFFSET || 0;
  return (((new Date().getUTCHours() + off) % 24) + 24) % 24;
}

function withinActiveHours() {
  const h = localHour();
  return h >= ACTIVE_START && h < ACTIVE_END;
}

function fmtWaiting(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam`;
  return `${Math.floor(h / 24)} hari`;
}

// Hitung daftar lead yang belum dibales admin (1 entri per kontak, lead terbaru).
async function computePending() {
  const sinceIso = new Date(Date.now() - HOURS(LOOKBACK_H)).toISOString();
  const [leads, replied] = await Promise.all([
    supa.fetchRecentLeads(sinceIso),
    supa.fetchAdminReplyTimes(),
  ]);

  // Lead terbaru per kontak.
  const latest = {};
  for (const l of leads) {
    const t = new Date(l.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (!latest[l.wa_jid] || t > latest[l.wa_jid]._t) latest[l.wa_jid] = { ...l, _t: t };
  }

  // Belum dibales kalau admin balas manual TERAKHIR lebih awal dari pesan terbaru.
  const pending = [];
  let manualCount = 0; // kontak yang SUDAH kamu bales manual (gak ditampilkan)
  for (const jid of Object.keys(latest)) {
    const l = latest[jid];
    if ((replied[jid] || 0) < l._t) pending.push(l);
    else manualCount++;
  }
  pending.sort((a, b) => a._t - b._t); // yang paling lama nunggu di atas
  return { pending, manualCount };
}

// Badge status balasan bot per lead (dari kolom reply_status: delivered/read).
function botBadge(rs) {
  if (rs === 'read') return '🤖 dibales bot · 👁️ dibaca customer';
  if (rs === 'delivered') return '🤖 dibales bot · ✓✓ terkirim';
  return '🤖 dibales bot';
}

function buildMessage({ pending, manualCount }) {
  const shown = pending.slice(0, MAX_LIST);
  let msg =
    `⏰ *Pengingat Lead — Tetra*\n` +
    `Ada *${pending.length}* lead yang belum kamu bales manual:\n`;
  shown.forEach((l, i) => {
    const num = String(l.phone || l.wa_jid).split('@')[0];
    msg +=
      `\n${i + 1}. *${l.name || 'Tanpa nama'}* — ${l.topic || '-'}\n` +
      `   wa.me/${num}\n` +
      `   ${botBadge(l.reply_status)} · ⏳ ${fmtWaiting(Date.now() - l._t)}`;
  });
  if (pending.length > shown.length) {
    msg += `\n\n…dan ${pending.length - shown.length} lead lainnya.`;
  }
  if (manualCount > 0) {
    msg += `\n\n_✅ ${manualCount} lead lain sudah kamu bales manual (gak ditampilkan)._`;
  }
  msg += `\n\n_Balas langsung dari WA Tetra. Pengingat tiap ${INTERVAL_H} jam (${ACTIVE_START}:00–${ACTIVE_END}:00)._`;
  return msg;
}

async function maybeSend(sock) {
  if (!withinActiveHours()) return;
  if (Date.now() - lastSentAt < HOURS(INTERVAL_H)) return;

  const adminJid = live.get().ADMIN_NOTIFY_JID;
  if (!adminJid) return;

  const result = await computePending();
  if (result.pending.length === 0) return; // inbox bersih → diam, jangan spam

  const sent = await sock.sendMessage(adminJid, { text: buildMessage(result) });
  rememberBotMsg(sent); // jangan ke-detect "admin balas manual"
  deliveryLog.track(sent, 'reminder→admin');

  lastSentAt = Date.now();
  saveJson(STATE_FILE, { lastSentAt });
  console.log(`⏰ Reminder terkirim ke admin: ${result.pending.length} lead belum dibales.`);
}

// getSock = fungsi yang mengembalikan socket aktif terbaru (atau socket langsung).
function start(getSock) {
  const st = loadJson(STATE_FILE);
  if (st && Number.isFinite(st.lastSentAt)) lastSentAt = st.lastSentAt;

  const tick = () => {
    const sock = typeof getSock === 'function' ? getSock() : getSock;
    if (!sock) return;
    maybeSend(sock).catch((e) => console.error('[reminder]', e.message));
  };
  const t = setInterval(tick, TICK_MS);
  if (t.unref) t.unref();
  // Cek awal ~60 dtk setelah start (responsif pasca-restart). Aman dari spam:
  // lastSentAt dipersist → tak kirim ulang dalam INTERVAL_H walau sering restart.
  const first = setTimeout(tick, 60 * 1000);
  if (first.unref) first.unref();
  return t;
}

module.exports = { start, computePending, buildMessage, maybeSend };
