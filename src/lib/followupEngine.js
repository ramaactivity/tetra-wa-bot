// Follow-up klien cerdas berbasis AI untuk Tetra Photobooth.
// Menyasar klien yang tanya pricelist / tertarik tapi diam 1–7 hari (belum deal),
// belum dipegang admin, dan belum pernah di-followup. Kirim SATU pesan personal
// (bukan blast) yang mengingatkan + menawarkan lock slot DP Rp 500.000.
//
// KUNCI: follow-up WAJIB baca seluruh history chat klien (jenis acara, tanggal,
// venue, keraguan yang pernah ditanya) supaya pesannya personal dan TIDAK
// menanyakan ulang hal yang sudah jelas diberitahu klien. Info yang sudah klien
// beri diakui, yang masih kurang saja yang digali.
//
// Keamanan: hanya kontak yang PERNAH kirim pesan duluan (inbound) yang di-followup,
// dengan jeda minimal 1 hari dan maksimal 1 pesan per 7 hari per kontak.
const path = require('path');
const supa = require('./supa');
const { getAIResponse } = require('./ai');
const live = require('./liveConfig');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');
const { loadJson, saveJson, tambahRiwayat } = require('./store');
const { parseLeadDetails, mergeDetails, missingFields } = require('./smartLead');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'followup.json');
const MIN_AGE_MS = 24 * 3600 * 1000;        // minimal 1 hari diam
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;     // maksimal 7 hari (lebih lama = basi)
const LOOKBACK_MS = 14 * 24 * 3600 * 1000;   // cuma cek lead 2 minggu terakhir
const RESEND_AFTER_MS = 7 * 24 * 3600 * 1000; // jangan follow-up ulang dalam 7 hari
const TICK_MS = 6 * 3600 * 1000;             // cek tiap 6 jam

// Pagar anti-blokir. WhatsApp menandai nomor yang mengirim pesan keluar beruntun
// ke banyak kontak sekaligus, apalagi di luar jam wajar. Follow-up itu pesan
// yang TIDAK diminta pelanggan, jadi pagarnya harus lebih ketat dari balasan biasa.
const MAKS_PER_SIKLUS = 10;                  // sisanya menunggu siklus berikutnya
const JEDA_MIN_MS = 20000;                   // jeda acak 20-45 dtk antar kiriman
const JEDA_MAKS_MS = 45000;

function dalamJamKerja() {
  const cfg = live.get();
  const jam = new Date(Date.now() + (cfg.TIMEZONE_OFFSET || 7) * 3600 * 1000).getUTCHours();
  return jam >= (cfg.BUSINESS_START_HOUR ?? 8) && jam < Math.min(cfg.BUSINESS_END_HOUR ?? 20, 21);
}

// Nama kontak WA sering ngawur ("F", "rama", "Teman Rama", "test-pdf").
// Hanya pakai nama kalau benar-benar mirip nama orang; selain itu panggil "Kak".
function cleanName(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/\s{2,}/g, ' ');
  if (s.length < 3) return null;                       // 1–2 huruf → bukan nama
  if (/[0-9]/.test(s)) return null;                    // ada angka
  if (/[^\p{L}\s.'-]/u.test(s)) return null;           // simbol/emoji
  const low = s.toLowerCase();
  const BLOCK = new Set([
    'rama', 'teman rama', 'pak rama', 'mas rama', 'tetra', 'admin', 'owner', 'founder',
    'test', 'tes', 'coba', 'coba-coba', 'tester', 'test-pdf', 'test pdf',
    'customer', 'client', 'user', 'guest', 'unknown', 'tanpa nama', 'none', 'null',
    'pak', 'bu', 'ibu', 'bapak', 'kak', 'kakak', 'min', 'admin tetra',
    'halo', 'hai', 'hi', 'ping', 'p',
  ]);
  if (BLOCK.has(low) || low.startsWith('test') || low.startsWith('teman ')) return null;
  return s;
}

const MISSING_LABEL = { jenis: 'jenis acara', tanggal: 'tanggal acara', lokasi: 'lokasi/venue' };

// Susun konteks lead (dari seluruh history) jadi string utk system prompt AI.
function buildLeadContext(panggilan, details, missing, historyLines) {
  const known = [
    `Panggilan klien: ${panggilan}`,
    `Jenis acara: ${details.jenisAcara || '(belum disebut)'}`,
    `Tanggal acara: ${details.tanggal || '(belum disebut)'}`,
    `Lokasi/venue: ${details.lokasi || '(belum disebut)'}`,
  ];
  const belum = missing.length
    ? `Yang BELUM klien beri (hanya ini yang boleh ditanyakan): ${missing.map((m) => MISSING_LABEL[m] || m).join(', ')}.`
    : 'Semua detail acara (jenis, tanggal, lokasi) SUDAH lengkap — JANGAN tanya ulang.';
  const riwayat = historyLines.length
    ? `Riwayat chat klien (kronologis):\n${historyLines.join('\n')}`
    : '(tidak ada riwayat)';
  return [...known, belum, riwayat].join('\n');
}

async function generateFollowupMessage(panggilan, leadContext) {
  const prompt =
    `Tulis SATU pesan follow-up WhatsApp untuk klien yang beberapa hari lalu tanya pricelist tapi belum lanjut. ` +
    `Sapa hangat, ingatkan Tetra masih siap bantu photobooth-nya, dan tawarkan lock slot tanggal dengan DP *Rp 500.000*. ` +
    `Sesuaikan dengan KONTEKS LEAD di system prompt: akui detail yang sudah klien sebut, jangan tanya ulang, ` +
    `kenali keraguan/pertanyaan klien di riwayat (mis. listrik/watt, format cetak, harga) dan yakinkan dengan santun. ` +
    `Hanya tanya yang masih kurang. Pendek (maks 4 baris), akhiri satu pertanyaan terbuka.\n` +
    `Balas persis [DIAM] tanpa teks lain kalau dari riwayat: ini bukan calon klien (ucapan, broadcast, ` +
    `auto-reply, vendor lain), klien sudah bilang transfer/bayar DP, atau klien sudah menolak.`;

  try {
    return await getAIResponse([], prompt, leadContext);
  } catch (e) {
    console.error('[followupEngine] Gagal generate pesan:', e.message);
    return null;
  }
}

async function runFollowupCycle(sock) {
  if (!live.isEnabled()) return;
  if (!sock) return;
  console.log('[followup] Menjalankan siklus follow-up...');

  const state = loadJson(STATE_FILE); // { jid: ts_ms }
  const sinceIso = new Date(Date.now() - LOOKBACK_MS).toISOString();
  const [leads, paused] = await Promise.all([
    supa.fetchRecentLeads(sinceIso),
    supa.fetchPausedContacts(),
  ]);

  // Kelompokkan SEMUA pesan per kontak (kronologis) supaya konteksnya utuh.
  const byJid = {};
  for (const l of leads) {
    const t = new Date(l.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    (byJid[l.wa_jid] ||= []).push({ ...l, _t: t });
  }

  const now = Date.now();
  let sent = 0;

  if (!dalamJamKerja()) {
    console.log('[followup] di luar jam kerja — siklus dilewati.');
    return;
  }

  for (const jid of Object.keys(byJid)) {
    if (sent >= MAKS_PER_SIKLUS) {
      console.log(`[followup] batas ${MAKS_PER_SIKLUS} pesan/siklus tercapai — sisanya siklus berikutnya.`);
      break;
    }
    const msgs = byJid[jid].sort((a, b) => a._t - b._t);
    const last = msgs[msgs.length - 1];
    const age = now - last._t;

    if (age < MIN_AGE_MS || age > MAX_AGE_MS) continue;                 // diam 1–7 hari
    if (paused && paused[jid] && paused[jid] > now) continue;           // admin sedang pegang
    if (state[jid] && now - state[jid] < RESEND_AFTER_MS) continue;     // sudah di-followup
    if (!msgs.some((m) => /pricelist|lead/i.test(m.topic || ''))) continue; // cuma yang tanya harga

    // Kumpulkan detail acara dari SELURUH riwayat (bukan cuma pesan terakhir),
    // karena klien sering kasih detail terpencar di beberapa pesan.
    let details = { jenisAcara: null, tanggal: null, lokasi: null };
    for (const m of msgs) {
      details = mergeDetails(details, parseLeadDetails(m.message || ''));
    }
    const missing = missingFields(details);

    // Ringkas riwayat klien (maks 8 pesan terakhir, masing-masing dipotong).
    const historyLines = msgs.slice(-8).map((m) =>
      `- ${String(m.message || '').replace(/\s+/g, ' ').slice(0, 160)}`
    );

    const panggilan = cleanName(last.name) || 'Kak';
    const leadContext = buildLeadContext(panggilan, details, missing, historyLines);
    const msg = await generateFollowupMessage(panggilan, leadContext);
    if (!msg || typeof msg !== 'string') continue;
    if (/\[(ADMIN_HANDOFF|DIAM)\]/.test(msg)) {
      state[jid] = now; // AI memutuskan jangan di-follow-up; jangan ditanya ulang tiap 6 jam
      continue;
    }

    try {
      if (sent > 0) {
        await new Promise((r) => setTimeout(r, JEDA_MIN_MS + Math.random() * (JEDA_MAKS_MS - JEDA_MIN_MS)));
      }
      const sentMsg = await sock.sendMessage(jid, { text: msg });
      rememberBotMsg(sentMsg);
      deliveryLog.track(sentMsg, 'followup→customer');
      tambahRiwayat(jid, 'assistant', msg); // klien membalas follow-up → bot tahu konteksnya
      state[jid] = now;
      sent++;
      console.log(`[followup] terkirim ke ${jid} (${panggilan})`);
    } catch (e) {
      console.error(`[followup] gagal kirim ke ${jid}:`, e.message);
    }
  }

  saveJson(STATE_FILE, state);
  console.log(`[followup] selesai, terkirim ${sent} pesan.`);
}

// getSock = fungsi yang mengembalikan socket aktif terbaru (atau socket langsung).
function start(getSock) {
  const tick = () => {
    const sock = typeof getSock === 'function' ? getSock() : getSock;
    if (!sock) return;
    runFollowupCycle(sock).catch((e) => console.error('[followup]', e.message));
  };
  const t = setInterval(tick, TICK_MS);
  if (t.unref) t.unref();
  // Jalan pertama ~2 menit setelah start (biar koneksi siap); aman dari spam
  // karena state[jid] dipersist dan ada jeda minimal 7 hari per kontak.
  const first = setTimeout(tick, 120 * 1000);
  if (first.unref) first.unref();
  return t;
}

module.exports = { start, runFollowupCycle, generateFollowupMessage, cleanName };
