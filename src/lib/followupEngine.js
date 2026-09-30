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
const { getAIResponse, nilaiFollowup } = require('./ai');
const live = require('./liveConfig');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');
const { loadJson, saveJson, tambahRiwayat, getRiwayat, getRingkasan } = require('./store');
const booking = require('./booking');
const vendorLib = require('./vendor');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'followup.json');
const MIN_AGE_MS = 24 * 3600 * 1000;        // minimal 1 hari diam
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;     // maksimal 7 hari (lebih lama = basi)
const LOOKBACK_MS = 14 * 24 * 3600 * 1000;   // cuma cek lead 2 minggu terakhir
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

// ── Baca konteks utuh sebelum follow-up ─────────────────────────────────────
// Insiden 27–28 Sep 2026: follow-up hanya membaca 8 pesan klien dari Supabase
// (dipotong 160 huruf). Balasan admin dan pesan selama pause tidak terbaca, jadi
// bot menagih DP ke klien yang sudah bilang "aku booking tempat lain", dan
// menawari photobooth ke bakery yang cuma broadcast ucapan selamat.
// Sekarang: transkrip gabungan (riwayat bot + admin + leads), pagar keras tanpa
// AI, lalu penilai AI yang harus bilang "kirim". Ragu = diam.

// Klien sudah memutuskan tidak lanjut. Pagar keras: tidak diserahkan ke AI.
const RE_TOLAK = new RegExp([
  '(booking|book|pakai|pake|ambil|dapet|dapat|deal|pesan)\\b.{0,30}\\b(tempat|vendor|yang|photobooth) lain',
  '(udah|sudah|udh) (ada|dapet|dapat|pakai|pake|booking) (vendor|photobooth|pb)',
  '\\b(gak|ga|nggak|enggak|tidak|ngga) jadi\\b', '\\bbatal\\b', '\\bcancel', 'belum berjodoh',
  '\\b(gak|ga|nggak|tidak|ngga) (perlu|usah) (lagi|dulu)', 'jangan (hubungi|chat|wa)',
].join('|'), 'i');

const norm = (t) => String(t || '').replace(/^\(pesan [^)]*\)\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Riwayat bot (sisi klien, bot, dan balasan manual admin) + pesan klien di
// Supabase yang tidak tercatat di riwayat (mis. masuk saat pause, sebelum 27 Sep).
function transkripGabungan(jid, leads) {
  const riw = getRiwayat(jid);
  const ada = riw.map((p) => norm(p.content));
  const extra = leads
    .filter((l) => l.message && !ada.some((a) => a.includes(norm(l.message).slice(0, 80))))
    .map((l) => ({ role: 'user', content: l.message, t: l._t }));
  return [...riw, ...extra].sort((a, b) => (a.t || 0) - (b.t || 0));
}

function barisTranskrip(pesan) {
  const jam = (t) => t ? new Date(t + 7 * 3600e3).toISOString().slice(5, 16).replace('T', ' ') : '--';
  return pesan.map((p) => {
    const c = String(p.content || '');
    const siapa = p.role === 'user' ? 'KLIEN' : c.startsWith('(admin)') ? 'ADMIN' : 'TETRA';
    return `[${jam(p.t)}] ${siapa}: ${c.replace(/^\(admin\)\s*/, '').replace(/\s+/g, ' ').slice(0, 600)}`;
  });
}

// Kalimat basi & klaim palsu yang pernah lolos. Ketemu = pesan tidak dikirim.
const RE_SLOP = /follow.?up|sekadar mengingatkan|ramaikan|berkesan|momen spesial|siap (bantu|membantu)|keduluan|sudah (aku|kami) (koordinasi|cek|catat|teruskan)|masih (aman|tersedia|kosong)|\[/i;

async function generateFollowupMessage(panggilan, leadContext, vendor = null) {
  // Vendor rekanan: bukan penawaran. Konfirmasi/kelanjutan urusan yang sedang berjalan,
  // gaya akrab, tanpa "masih tertarik?" (keputusan Rama 30 Sep 2026).
  if (vendor) {
    const p = `Tulis SATU pesan WhatsApp singkat (maks 3 baris) ke vendor rekanan ${vendor.nama} untuk ` +
      `menindaklanjuti urusan yang terakhir dibahas di riwayat (mis. konfirmasi jadwal, desain frame, data acara). ` +
      `Gaya akrab sesuai ATURAN VENDOR. JANGAN tanya "masih tertarik", JANGAN tawarkan paket/DP, JANGAN gaya sales. ` +
      `Kalau di riwayat tidak ada urusan yang perlu ditindaklanjuti, balas persis [DIAM].`;
    try { return await getAIResponse([], p, leadContext + vendorLib.konteks(vendor)); }
    catch (e) { console.error('[followupEngine] Gagal generate pesan vendor:', e.message); return null; }
  }
  const prompt =
    `Tulis SATU pesan WhatsApp lanjutan dari admin Tetra ke ${panggilan} yang belum membalas. Tujuannya satu: dia mau membalas.\n` +
    `- Buka langsung dengan hal spesifik miliknya dari TRANSKRIP (acaranya, tanggal, venue, atau pertanyaan terakhirnya). Jangan buka dengan basa-basi.\n` +
    `- Beri SATU alasan nyata untuk membalas sekarang, dan hanya dari fakta di transkrip/system prompt: jawab keraguan yang pernah ia sebut, ` +
    `rekomendasi durasi sesuai jumlah tamu, tawaran cek slot kalau tanggalnya belum dicek, atau contoh hasil di https://tetraphoto.com/galeri ` +
    `(link galeri hanya kalau belum pernah dikirim di transkrip).\n` +
    `- Tutup dengan SATU pertanyaan yang gampang dijawab dan MEMAJUKAN booking (tanggal, jam, durasi, atau mau diamankan slotnya), bukan "gimana Kak?" atau basa-basi (weekend/weekday).\n` +
    `- Maks 3 kalimat pendek, gaya chat orang asli, tanpa bullet, emoji maks 1.\n` +
    `- DILARANG: mengaku sudah melakukan sesuatu (sudah koordinasi/cek/catat), bilang slot masih aman/tersedia, menjanjikan promo/diskon, ` +
    `harga yang tidak ada di transkrip, dan kata/frasa "follow up", "sekadar mengingatkan", "ramaikan", "berkesan", "momen spesial", "keduluan", "siap bantu".\n` +
    `Contoh BURUK: "Halo Kak! Mau follow up rencana photobooth-nya. Tim Tetra siap ramaikan acaranya biar makin berkesan. Slotnya bisa diamankan dengan DP Rp 500.000."\n` +
    `Contoh BAGUS: "Kak Diela, tanggal wedding di Balitro-nya sudah ketemu? Kalau sudah, kabari aja, aku cek slotnya hari itu juga. Untuk wedding biasanya 4 jam paling aman, tamu nggak numpuk antre."\n` +
    `Kalau dari transkrip ternyata tidak pantas dikirimi pesan, balas persis [DIAM].`;
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
    if (!msgs.some((m) => /pricelist|lead/i.test(m.topic || ''))) continue; // cuma yang tanya harga
    if (booking.get(jid)) continue;                                     // sudah DP → followupBooking

    // Pagar keras (tanpa AI). Admin/handoff pernah pegang klien = follow-up urusan
    // admin. Vendor rekanan dikecualikan: follow-up-nya konfirmasi urusan berjalan.
    const pesan = transkripGabungan(jid, msgs);
    const vendor = await vendorLib.cari(last.phone);
    const lewati = (alasan) => { state[jid] = now; console.log(`[followup] lewati ${jid}: ${alasan}`); };
    if (!vendor && paused && jid in paused) { lewati('pernah dipegang admin/handoff'); continue; }
    if (!vendor && pesan.some((p) => String(p.content).startsWith('(admin)'))) { lewati('ada balasan admin'); continue; }
    if (pesan.some((p) => p.role === 'user' && RE_TOLAK.test(p.content))) { lewati('klien sudah menolak/pakai vendor lain'); continue; }
    // Satu follow-up per percakapan: yang lagi hanya kalau klien sempat membalas sesudahnya.
    if (state[jid] && !pesan.some((p) => p.role === 'user' && (p.t || 0) > state[jid])) continue;
    if (pesan.at(-1)?.role === 'user') { lewati('pesan terakhir klien belum dijawab — urusan admin, bukan follow-up'); continue; }

    const transkrip = barisTranskrip(pesan.slice(-80)).join('\n');
    const ringkasan = getRingkasan(jid);
    if (!vendor) {
      const n = await nilaiFollowup(transkrip, ringkasan);
      console.log(`[followup] nilai ${jid}: ${n.kirim ? 'KIRIM' : 'diam'} (${n.status}) ${n.alasan || ''}`);
      if (!n.kirim) { state[jid] = now; continue; }
    }

    const panggilan = cleanName(last.name) || 'Kak';
    const leadContext = `Panggilan klien: ${panggilan}\n` +
      (ringkasan ? `CATATAN KLIEN (chat lama):\n${ringkasan}\n` : '') +
      `TRANSKRIP LENGKAP (kronologis; ADMIN = balasan manual admin, keputusan resmi):\n${transkrip}`;
    const msg = await generateFollowupMessage(panggilan, leadContext, vendor);
    if (!msg || typeof msg !== 'string') continue;
    if (/\[(ADMIN_HANDOFF|DIAM)\]/.test(msg)) {
      state[jid] = now; // AI memutuskan jangan di-follow-up; jangan ditanya ulang tiap 6 jam
      continue;
    }
    if (!vendor && RE_SLOP.test(msg)) {
      console.log(`[followup] DITAHAN ${jid} (kalimat terlarang): ${msg.replace(/\s+/g, ' ').slice(0, 200)}`);
      continue; // siklus berikutnya coba tulis ulang
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
  await followupBooking(sock, paused, sent);
}

// ── Follow-up data booking (klien sudah DP, data acara belum lengkap) ────────
// Tiap 48 jam; 24 jam kalau acara tinggal ≤7 hari. Dihitung dari aktivitas
// terakhir di chat, jadi klien yang baru saja membalas tidak ditagih.
// H-3 masih belum lengkap → admin dikabari sekali.
async function followupBooking(sock, paused, sudahTerkirim) {
  const now = Date.now();
  let sent = 0;
  for (const [jid, b] of Object.entries(booking.semua())) {
    if (sudahTerkirim + sent >= MAKS_PER_SIKLUS) break;
    if (!booking.aktif(jid) || b.lengkap) continue;
    const sisaHari = b.data.tanggal_iso ? (Date.parse(`${b.data.tanggal_iso}T00:00:00+07:00`) - now) / 864e5 : null;

    if (sisaHari !== null && sisaHari <= 3 && !b.h3) {
      await booking.laporAdmin(sock, jid, 'H-3 tapi data booking belum lengkap');
      b.h3 = true; booking.simpan();
    }
    if (paused && paused[jid] > now) continue;                          // admin sedang pegang

    const riw = getRiwayat(jid);
    const jedaJam = sisaHari !== null && sisaHari <= 7 ? 24 : 48;
    if (now - Math.max(b.terakhirTanya || 0, riw.at(-1)?.t || 0) < jedaJam * 3600 * 1000) continue;

    const k = booking.kurang(b).map((x) => x.label);
    const prompt =
      `Tulis SATU pesan WhatsApp singkat (maks 4 baris) untuk klien yang SUDAH DP, mengingatkan dengan ramah ` +
      `data acara yang masih kurang: ${k.join(', ')}. Sebut maks 3 yang paling penting, bilang boleh dicicil. ` +
      (sisaHari !== null ? `Acaranya ${Math.max(0, Math.ceil(sisaHari))} hari lagi. ` : '') +
      `Jangan tawarkan DP atau paket lagi, jangan kirim ulang form lengkap.`;
    let msg;
    try { msg = await getAIResponse(riw.slice(-20), prompt, booking.konteksAI(jid)); }
    catch (e) { console.error('[followup-booking] gagal generate:', e.message); continue; }
    msg = String(msg || '').replace(/\[INFO_ADMIN[^\]]*\]/g, '').trim();
    if (!msg || /\[(ADMIN_HANDOFF|DIAM)\]/.test(msg)) continue;

    try {
      if (sudahTerkirim + sent > 0) {
        await new Promise((r) => setTimeout(r, JEDA_MIN_MS + Math.random() * (JEDA_MAKS_MS - JEDA_MIN_MS)));
      }
      const sentMsg = await sock.sendMessage(jid, { text: msg });
      rememberBotMsg(sentMsg);
      deliveryLog.track(sentMsg, 'followup-booking→customer');
      tambahRiwayat(jid, 'assistant', msg);
      b.terakhirTanya = now; booking.simpan();
      sent++;
      console.log(`[followup-booking] terkirim ke ${jid} (kurang: ${k.join(', ')})`);
    } catch (e) {
      console.error(`[followup-booking] gagal kirim ke ${jid}:`, e.message);
    }
  }
  if (sent) console.log(`[followup-booking] ${sent} pengingat data booking terkirim.`);
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

module.exports = { start, runFollowupCycle, followupBooking, generateFollowupMessage, cleanName };
