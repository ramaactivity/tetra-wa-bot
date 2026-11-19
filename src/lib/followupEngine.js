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
const { postOps } = require('./availability');
const { getAIResponse, nilaiFollowup, RE_PENUTUP } = require('./ai');
const lampiranLib = require('./lampiran');
const undangVendor = require('./undangVendor');
const fs = require('fs');
const live = require('./liveConfig');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');
const { loadJson, saveJson, tambahRiwayat, getRiwayat, getRingkasan, getProspek, semuaProspek, nomorDari } = require('./store');
const prospekWa = require('./prospekWa');
const { kirimPricelist } = require('./pricelist');
const { kirimTelegram } = require('./notify');
const booking = require('./booking');
const vendorLib = require('./vendor');

const STATE_FILE = path.join(__dirname, '..', '..', 'data', 'followup.json');
const PROSPEK_FILE = path.join(__dirname, '..', '..', 'data', 'followup-prospek.json');
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
  // Follow-up hanya 09–20 walau jam kerja bot 06–23 (audit 22 Okt: 3 follow-up jam 06.18, 0 dibalas).
  return jam >= Math.max(cfg.BUSINESS_START_HOUR ?? 8, 9) && jam < Math.min(cfg.BUSINESS_END_HOUR ?? 20, 20);
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
    // Panggilan sayang/keluarga yang sering jadi nama WA ("Kak say", 22 Okt) — bukan nama orang.
    'say', 'sayang', 'syg', 'beb', 'bebeb', 'baby', 'babe', 'honey', 'cinta', 'bunda', 'bun', 'mama', 'mamah', 'mami',
    'papa', 'papah', 'papi', 'ayah', 'umi', 'abi', 'ummi', 'abah', 'emak', 'dek', 'adek', 'bestie', 'aku', 'saya', 'me',
  ]);
  if (BLOCK.has(low) || low.startsWith('test') || low.startsWith('teman ')) return null;
  return s;
}

// Nama yang klien tulis sendiri (isian "Nama: …" di form website/booking) menang atas nama profil WA, yang sering
// panggilan lain atau nama orang lain (audit Nov: form "Nama: rara" dipanggil "Kak hilwa", "Eva" jadi "Kak Eca").
function namaDariChat(teks) {
  const semua = [...String(teks || '').matchAll(/(?:^|\n)\s*[-•*]?\s*nama(?:\s+(?:lengkap|pemesan|klien|kakak|pic))?\s*[:：]\s*([^\n,;]{2,30})/gi)];
  for (const m of semua.reverse()) { const n = cleanName(m[1].trim()); if (n) return n; }
  return null;
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

// Gerbang sebelum memanggil AI (audit 22 Okt). RE_TUNDA: klien minta waktu → follow-up ditunda. Penjaga TEKS follow-up (kalimat basi,
// desakan booking, mengulang pertanyaan, bentuk pesan) sejak Tahap 3B ada di plugin Hermes penjaga-cs (mode follow-up): gagal → [DIAM].
const RE_TUNDA = /diskusi|dirundingkan|dibicarakan|tanya(in)?\s+(dulu|ke|sama)|info(in)?\s+ke|nanti\s+(aku|saya|ku|kami)?\s*(kabari|kabarin|hubungi|info)|kabar(i|in)\s+(lagi|nanti)|pikir(-pikir)?\s+dulu|dulu\s+ya\b/i;
const RE_SOAL_BOOKING = /\bdp\b|booking|\bbook\b|transfer|rekening|cara\s+(pesan|bayar|booking)|bayar(nya)?\s+(ke|gimana)/i;

async function generateFollowupMessage(panggilan, leadContext, vendor = null) {
  // Vendor rekanan: bukan penawaran. Konfirmasi/kelanjutan urusan yang sedang berjalan,
  // gaya akrab, tanpa "masih tertarik?" (keputusan Rama 30 Sep 2026).
  if (vendor) {
    const p = `TUGAS FOLLOW-UP VENDOR: tulis SATU pesan lanjutan untuk vendor rekanan ${vendor.nama} — ikuti skill mode-kontak-khusus bagian "Follow-up khusus".`;
    try { return await getAIResponse([], p, leadContext + vendorLib.konteks(vendor)); }
    catch (e) { console.error('[followupEngine] Gagal generate pesan vendor:', e.message); return null; }
  }
  // 18 Nov (Rama: 100% cara Hermes): prosedur follow-up pindah ke skill cara-balas-wa bagian "Follow-up calon klien yang
  // belum membalas" (bisa dilatih CS Mintet lewat skill_manage). Node hanya memberi FAKTA + PENILAIAN + TRANSKRIP di leadContext.
  const prompt = `TUGAS FOLLOW-UP: tulis SATU pesan WhatsApp lanjutan untuk ${panggilan}, calon klien yang belum membalas, ` +
    `mengikuti bagian "Follow-up calon klien yang belum membalas" di skill cara-balas-wa. ` +
    `Panggil "${panggilan}"${panggilan === 'Kak' ? '' : ' atau "Kak" saja'}; jangan pakai nama lain. Balas HANYA pesannya, atau persis [DIAM].`;
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
    if (getProspek(jid)) continue;                                      // lead sales → followupProspek
    if (!msgs.some((m) => /pricelist|lead/i.test(m.topic || ''))) continue; // cuma yang tanya harga
    if (booking.get(jid)) continue;                                     // sudah DP → followupBooking

    // Pagar keras (tanpa AI). Pernah dipegang admin TIDAK otomatis dilewati (keputusan
    // Rama 30 Sep: agent harus adaptif); penilai AI membaca balasan admin sebagai
    // keputusan resmi. Yang sedang dipegang admin (pause aktif) sudah dilewati di atas.
    const pesan = transkripGabungan(jid, msgs);
    const vendor = await vendorLib.cari(last.phone);
    const lewati = (alasan) => { state[jid] = now; console.log(`[followup] lewati ${jid}: ${alasan}`); };
    if (pesan.some((p) => p.role === 'user' && RE_TOLAK.test(p.content))) { lewati('klien sudah menolak/pakai vendor lain'); continue; }
    // Satu follow-up per percakapan: yang lagi hanya kalau klien sempat membalas sesudahnya.
    if (state[jid] && !pesan.some((p) => p.role === 'user' && (p.t || 0) > state[jid])) continue;
    // Penutup "ok/makasih" yang sengaja tidak dibalas ([diam-penutup]) bukan pesan yang belum dijawab (audit 27 Okt:
    // follow-up mati diam-diam di Nadia, …9546, …2881). Penilai AI tetap memutuskan perlu tidaknya follow-up.
    if (pesan.at(-1)?.role === 'user' && !RE_PENUTUP.test(String(pesan.at(-1).content).trim())) { lewati('pesan terakhir klien belum dijawab — urusan balasan/assist, bukan follow-up'); continue; }

    const transkrip = barisTranskrip(pesan.slice(-80)).join('\n');
    const ringkasan = getRingkasan(jid);
    let nilai = null;
    if (!vendor) {
      const n = nilai = await nilaiFollowup(transkrip, ringkasan);
      console.log(`[followup] nilai ${jid}: ${n.kirim ? 'KIRIM' : 'diam'} (${n.status}) ${n.alasan || ''}`);
      if (!n.kirim) { state[jid] = now; continue; }
    }

    // Klien bilang diskusi dulu / nanti mengabari: beri ruang minimal 5 hari (audit 22 Okt: ditagih besoknya).
    const klienAkhir = pesan.filter((p) => p.role === 'user').at(-1);
    if (klienAkhir && RE_TUNDA.test(klienAkhir.content) && now - (klienAkhir.t || 0) < 5 * 864e5) continue;
    const botAkhir = pesan.filter((p) => p.role === 'assistant').at(-1);
    const tanyaAkhir = (String(botAkhir?.content || '').match(/[^.!?\n]*\?/g) || []).at(-1)?.trim() || '';
    const hariDiam = Math.round((now - (botAkhir?.t || now)) / 864e5);
    const tanyaBooking = pesan.some((p) => p.role === 'user' && RE_SOAL_BOOKING.test(p.content));
    const jamKlien = Math.round((now - (pesan.filter((p) => p.role === 'user').at(-1)?.t || now)) / 36e5);
    const panggilan = namaDariChat(pesan.filter((p) => p.role === 'user').map((p) => p.content).join('\n')) || cleanName(last.name) || 'Kak';
    const leadContext = `Panggilan klien: ${panggilan}\n` +
      // N5 audit Bruno: aturan gaya ("jangan tulis 'tadi'…") pindah ke skill cara-balas-wa; Node hanya fakta waktu.
      `FAKTA: pesan terakhir kita ${hariDiam} hari lalu; pesan terakhir klien ${jamKlien} jam lalu; pertanyaan terakhir kita yang belum dia jawab: "${tanyaAkhir || '-'}"; ` +
      `dia ${tanyaBooking ? 'SUDAH' : 'BELUM'} pernah bertanya soal booking/DP.\n` +
      (nilai ? `PENILAIAN (penilai follow-up Hermes): ${nilai.status || '-'} — ${nilai.alasan || '-'}\n` : '') +
      (ringkasan ? `CATATAN KLIEN (chat lama):\n${ringkasan}\n` : '') +
      `TRANSKRIP LENGKAP (kronologis; ADMIN = balasan manual admin, keputusan resmi):\n${transkrip}`;
    // Penanda [KIRIM:*] dikumpulkan lalu dicabut (Syifa minta PL 22 Okt). Penanda lain sudah ditahan penjaga Hermes ([DIAM]);
    // sisa yang lolos dicabut supaya tidak pernah terkirim mentah.
    const lampiran = new Set();
    const bersihkan = (m) => {
      if (typeof m !== 'string') return m;
      lampiranLib.kunci(m).forEach((k) => lampiran.add(k));
      return m.replace(/\[KIRIM:[^\]]*\]/gi, '').replace(/\[(?!DIAM\]|ADMIN_HANDOFF\])[A-Z_]+[^\]]*\]/g, '')
        .replace(/\*\*([^*\n]+)\*\*/g, '*$1*').trim();
    };
    const msg = bersihkan(await generateFollowupMessage(panggilan, leadContext, vendor));
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
      if (lampiran.has('pricelist') && !getRiwayat(jid).some((x) => String(x.content).includes('[kirim PDF pricelist]')))
        await kirimPricelist(sock, jid, 'followup-pricelist', { pdf: true });
      await lampiranLib.kirimLampiran(sock, jid, [...lampiran], 'followup');
      state[jid] = now;
      sent++;
      console.log(`[followup] terkirim ke ${jid} (${panggilan})`);
    } catch (e) {
      console.error(`[followup] gagal kirim ke ${jid}:`, e.message);
    }
  }

  saveJson(STATE_FILE, state);
  console.log(`[followup] selesai, terkirim ${sent} pesan.`);
  sent += await followupProspek(sock, paused, sent);
  await followupBooking(sock, paused, sent);
}

// ── Lead sales (venue/WO/korporat) yang membalas sapaan ─────────────────────
// (1) Balasan lead manusia yang belum terjawab (bot restart, dsb.) dijawab di sini (Rama 7 Okt: lead tidak boleh mati).
// (2) Susulan ke lead yang diam: DIMATIKAN sejak 19 Nov (SUSULAN_LEAD) sampai syarat audit Bruno t_951a932f §6 terpenuhi dan Rama
//     setuju; kalau dinyalakan, Hermes yang memutuskan perlu-tidaknya dari blok FAKTA (maks 1 susulan per kanal ada di skill).
// Percakapan yang dipegang admin (ada balasan admin sesudah pesan terakhir lead) dilewati.
function hariKerja(dariMs, keMs) {
  let n = 0;
  for (let t = dariMs + 864e5; t <= keMs; t += 864e5) {
    const d = new Date(t + 7 * 3600e3).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

// Kandidat (cek murah sebelum AI). Perlu-tidaknya & isi pesan diputuskan Hermes dari blok FAKTA ([DIAM] boleh) — audit Bruno
// t_951a932f N2/N4: dulu Node memutuskan jenis "lanjut"/"minta-pic" dan menulisnya sebagai perintah ke cs-wa.
// 'balas'   : ada pesan lead yang belum kita jawab (20 menit – 3 hari) dan tidak sedang dipegang admin.
// 'susulan' : lead diam sesudah pesan kita; jeda ≥ 3 hari kerja sejak pesan kita terakhir (rem jeda).
function jenisProspek(riw, s, now) {
  const user = riw.filter((p) => p.role === 'user');
  if (!user.length || s.stop || user.some((p) => RE_TOLAK.test(p.content))) return null;
  const lastUserT = user.at(-1).t || 0;
  const sesudah = riw.slice(riw.lastIndexOf(user.at(-1)) + 1);
  if (sesudah.some((p) => String(p.content).startsWith('(admin)'))) return null;
  if (!sesudah.length) return now - lastUserT > 20 * 60e3 && now - lastUserT < 3 * 864e5 ? 'balas' : null;
  return hariKerja(riw.at(-1).t || 0, now) >= 3 ? 'susulan' : null;
}

// Dua rem keputusan Rama 19 Nov, diperiksa SEBELUM AI dipanggil (cek murah, tabel Hermes A2). Isi & prosedur follow-up tetap milik
// skill Hermes (mode-kontak-khusus "Follow-up khusus").
// 1. "pesan followup nya juga kebanyakan salah" → susulan ke lead (lanjut / minta-pic / menjawab sambutan otomatis) DIHENTIKAN sampai
//    isinya dibereskan Hermes dan Rama setuju. Balasan ke lead yang membalas sungguhan tetap jalan. Nyalakan lagi hanya atas izin Rama.
const SUSULAN_LEAD = false;
// 2. "kalau udah 3x ga dibalas yaudah jangan di followup lagi. takutnya malah spam" → maks 3 pesan kita sesudah pesan MANUSIA terakhir
//    lead. Sambutan otomatis akun bisnis bukan balasan: dulu sambutan yang masuk 2 detik setelah follow-up mereset hitungan, sehingga
//    follow-up berputar tiap 3 hari kerja tanpa henti.
const MAKS_TAK_DIBALAS = 3;
const MAKS_SUSULAN_HARI = 10; // N9 audit Bruno: semua lead digabung
function takDibalas(riw) {
  const i = riw.findLastIndex((p) => p.role === 'user' && !prospekWa.otomatis(p.content));
  return riw.slice(i + 1).filter((p) => p.role === 'assistant' && !/^\((admin|catatan sistem)\)/.test(String(p.content))).length;
}

async function followupProspek(sock, paused, sudah) {
  const now = Date.now();
  const w = new Date(now + 7 * 3600e3);
  if ([0, 6].includes(w.getUTCDay()) || w.getUTCHours() < 9 || w.getUTCHours() >= 17) return 0;
  // { <nomor HP | jid>: { sejak: t pesan MANUSIA terakhir, stop }, _susulan: t siklus susulan terakhir, _hari: { tgl, n } }
  const state = loadJson(PROSPEK_FILE);
  const tglHariIni = new Date(now + 7 * 3600e3).toISOString().slice(0, 10);
  const hari = state._hari?.tgl === tglHariIni ? state._hari : { tgl: tglHariIni, n: 0 };
  // N9: susulan tidak dipicu restart (siklus pertama jalan 2 menit setelah start) — paling cepat sekali per TICK_MS, maks per hari.
  const bolehSusulan = SUSULAN_LEAD && now - (state._susulan || 0) >= TICK_MS - 60e3;
  if (bolehSusulan) state._susulan = now;
  // N1: state lama per jid (LID & "62…@s.whatsapp.net") dipindah ke satu kunci per orang (nomor HP); stop dari kunci mana pun ikut.
  for (const k of Object.keys(state)) {
    const o = k.startsWith('_') ? k : nomorDari(k) || k;
    if (o === k) continue;
    state[o] = { ...(state[o] || {}), ...state[k], stop: !!(state[o]?.stop || state[k]?.stop) };
    delete state[k];
  }
  const orangDilihat = new Set();
  let sent = 0;
  for (const jid of semuaProspek()) {
    if (sudah + sent >= MAKS_PER_SIKLUS) break;
    if (paused && paused[jid] > now) continue;
    // N1: satu orang = satu hitungan (dulu LID & nomor HP punya state sendiri-sendiri: 31 orang dobel, Yulia n=2 di LID & n=1 di HP).
    const orang = nomorDari(jid) || jid;
    if (orangDilihat.has(orang)) continue;
    orangDilihat.add(orang);
    const riw = getRiwayat(jid); // gabungan LID + nomor HP
    const lastManusiaT = riw.filter((p) => p.role === 'user' && !prospekWa.otomatis(p.content)).at(-1)?.t || 0;
    const lama = state[orang];
    // N2: hitungan mulai dari pesan MANUSIA terakhir; sambutan otomatis tidak mereset apa pun.
    const s = lama?.sejak === lastManusiaT ? lama : { sejak: lastManusiaT };
    // N3: aturan Rama "kalau udah 3x ga dibalas yaudah jangan di followup lagi" ditulis ke Tetra Ops (status berhenti) supaya SEMUA jalur
    // (tombol Follow-up, Bruno/MCP, statistik) ikut berhenti. Sekali per "pesan manusia terakhir"; lead yang membalas lagi hidup kembali.
    const tertunda = riw.slice(riw.findLastIndex((x) => x.role !== 'user') + 1).some((x) => !prospekWa.otomatis(x.content));
    if (!tertunda && takDibalas(riw) >= MAKS_TAK_DIBALAS && s.berhentiOps !== lastManusiaT) {
      const nomorB = getProspek(jid)?.nomor || nomorDari(jid);
      const r = nomorB ? await postOps('/api/bot/prospek/berhenti', { nomor: nomorB, alasan: 'tak_dibalas_3x', catatan: `${takDibalas(riw)} pesan kita tak dibalas manusia (bot WA)` }) : { ok: false, status: 'tanpa nomor' };
      if (r.ok) {
        s.berhentiOps = lastManusiaT;
        state[orang] = s;
        console.log(`[followup-lead] ${orang}: berhenti di Tetra Ops (tak dibalas ${takDibalas(riw)}×) — diubah ${r.json.diubah?.length || 0}, tetap ${r.json.tetap?.length || 0}`);
      } else console.error(`[followup-lead] ${orang}: gagal tandai berhenti (HTTP ${r.status}) — dicoba siklus berikutnya`);
    }
    const jenis = jenisProspek(riw, s, now);
    if (!jenis) continue;
    // 'balas' yang isinya hanya sambutan otomatis = susulan juga (bukan menjawab manusia).
    const menjawabManusia = jenis === 'balas' && riw.slice(riw.findLastIndex((x) => x.role !== 'user') + 1).some((x) => !prospekWa.otomatis(x.content));
    if (!menjawabManusia && (!bolehSusulan || hari.n >= MAKS_SUSULAN_HARI || takDibalas(riw) >= MAKS_TAK_DIBALAS)) continue;
    const p0 = getProspek(jid);
    const nomor = p0.nomor || nomorDari(jid) || await prospekWa.nomorPengirim(sock, { key: { remoteJid: jid } }).catch(() => '');
    const pr = await supa.cariProspek(nomor).catch(() => null);
    const p = { ...p0, nomor, segmen: p0.segmen || pr?.segmen };
    // berhenti hanya menghentikan SUSULAN; lead berhenti yang membalas sungguhan tetap dijawab (audit §5.2).
    if (pr && (['tolak', 'jangan_hubungi'].includes(pr.status) || /DIPEGANG RAMA/.test(pr.catatan || '') ||
      (!menjawabManusia && (pr.status === 'berhenti' || /dialihkan ke/.test(pr.catatan || ''))))) {
      state[orang] = { ...s, stop: true }; // PIC sudah disapa / lead menolak / berhenti: jangan dikejar lagi
      continue;
    }
    // N4: tanpa label jenis sebagai perintah — hanya blok FAKTA; isi & perlu-tidaknya = skill mode-kontak-khusus.
    const fakta = prospekWa.faktaLead(p, riw, pr);
    let msg;
    try {
      if (menjawabManusia) {
        const i = riw.findLastIndex((x) => x.role !== 'user');
        msg = await getAIResponse(riw.slice(0, i + 1), riw.slice(i + 1).map((x) => x.content).join('\n'), fakta);
      } else {
        msg = await getAIResponse(riw.slice(-30), 'TUGAS: tulis SATU pesan lanjutan untuk lead ini, atau [DIAM].', fakta);
      }
    } catch (e) { console.error(`[followup-lead] gagal generate ${jid}:`, e.message); continue; }
    msg = String(msg || '');
    if (!msg.trim() || /\[(DIAM|ADMIN_HANDOFF)\]/.test(msg)) { // "masih tertarik"/"follow up" ditahan penjaga Hermes → [DIAM]
      state[orang] = { ...s, stop: true };
      console.log(`[followup-lead] ${jid}: ${jenis} tidak dikirim (${msg.replace(/\s+/g, ' ').slice(0, 80)})`);
      continue;
    }
    const info = (msg.match(/\[INFO_ADMIN:?\s*([^\]]*)\]/i) || [])[1];
    const lampiran = lampiranLib.kunci(msg);
    const pl = lampiran.includes('pricelist') && !riw.some((x) => String(x.content).includes('[kirim PDF pricelist]'));
    // Audit 27 Okt: "ini profil kerja sama rekanan kami" terkirim tanpa PDF. Lampiran yang filenya tidak ada → jangan kirim teksnya.
    const hilang = lampiran.filter((k) => k !== 'pricelist' && !fs.existsSync(path.join(require('./pricelist').ASSETS_DIR, lampiranLib.LAMPIRAN[k].file)));
    if (hilang.length) { console.error(`[followup-lead] ${jid}: lampiran ${hilang.join(',')} tidak ada — pesan ditahan`); continue; }
    let infoUndang = null;
    if (undangVendor.RE_TAG.test(msg)) {
      const u = await undangVendor.proses(msg, { phone: nomor, jid });
      msg = u.teks; infoUndang = u.info;
    }
    msg = prospekWa.tanpaAngka(msg.replace(/\[[A-Z_]+[^\]]*\]/g, '').replace(/\*\*([^*\n]+)\*\*/g, '*$1*').trim());
    try {
      if (sudah + sent > 0) await new Promise((r) => setTimeout(r, JEDA_MIN_MS + Math.random() * (JEDA_MAKS_MS - JEDA_MIN_MS)));
      const sentMsg = await sock.sendMessage(jid, { text: msg });
      rememberBotMsg(sentMsg);
      deliveryLog.track(sentMsg, `lead-${jenis}→wa`);
      tambahRiwayat(jid, 'assistant', msg);
      if (pl) await kirimPricelist(sock, jid, 'lead-pricelist', { pdf: true });
      await lampiranLib.kirimLampiran(sock, jid, lampiran, 'lead');
      if (infoUndang) await kirimTelegram(`🤝 ${infoUndang} — wa.me/${nomor}`).catch(() => {});
      if (pr) await supa.catatJawabanProspek(nomor, msg + (pl ? ' [+ pricelist]' : '')).catch(() => {});
      if (info) await kirimTelegram(`🤝 Lead ${p.nama || jid.split('@')[0]}: ${info}`).catch(() => {});
      state[orang] = s;
      if (!menjawabManusia) hari.n++;
      sent++;
      console.log(`[followup-lead] ${menjawabManusia ? 'balas' : 'susulan'} terkirim ke ${jid} (${p.nama || '-'})`);
    } catch (e) {
      console.error(`[followup-lead] gagal kirim ke ${jid}:`, e.message);
    }
  }
  state._hari = hari;
  saveJson(PROSPEK_FILE, state);
  if (sent) console.log(`[followup-lead] ${sent} pesan lead terkirim.`);
  return sent;
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
      `TUGAS FOLLOW-UP DATA BOOKING: klien sudah DP; data acara yang masih kurang: ${k.join(', ')}.` +
      (sisaHari !== null ? ` Acaranya ${Math.max(0, Math.ceil(sisaHari))} hari lagi.` : '') +
      ' Ikuti skill mode-kontak-khusus bagian "Follow-up khusus".';
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

// Tombol "Follow-up" di halaman Leads Tetra Ops (Rama 18 Nov; spek HERMES docs/SPEC-LEADS-HERMES.md): draf ditulis Hermes cs-wa
// dari transkrip utuh, dikembalikan ke Tetra Ops lewat hasil perintah; terkirim hanya setelah owner klik Kirim (send-followup).
async function drafFollowup(jid, { alasan = '', konteks = '' } = {}) {
  const pesan = transkripGabungan(jid, []);
  // N8 audit Bruno: lead sales pakai blok FAKTA lead (bukan prosedur follow-up klien); lead berhenti/menolak tidak dibuatkan draf.
  const p0 = getProspek(jid);
  if (p0) {
    const nomor = p0.nomor || nomorDari(jid) || '';
    const pr = await supa.cariProspek(nomor).catch(() => null);
    if (pr && ['berhenti', 'jangan_hubungi', 'tolak'].includes(pr.status)) return { ok: false, pesan: `lead ini berstatus ${pr.status} di Tetra Ops — tidak dibuatkan follow-up` };
    const riw = getRiwayat(jid);
    if (takDibalas(riw) >= MAKS_TAK_DIBALAS) return { ok: false, pesan: `sudah ${takDibalas(riw)} pesan kita tidak dibalas manusia — aturan Rama: jangan di-follow-up lagi` };
    const fakta = prospekWa.faktaLead({ ...p0, nomor, segmen: p0.segmen || pr?.segmen }, riw, pr) +
      `\nFAKTA: owner meminta follow-up dari Tetra Ops (alasan: ${alasan || '-'}).` + (konteks ? `\nKONTEKS DARI TETRA OPS: ${String(konteks).slice(0, 800)}` : '');
    const m = await getAIResponse(riw.slice(-30), 'TUGAS: tulis SATU pesan lanjutan untuk lead ini, atau [DIAM].', fakta).catch(() => null);
    const draf = String(m || '').replace(/\[KIRIM:[^\]]*\]/gi, '').trim();
    if (!draf) return { ok: false, pesan: 'Hermes gagal menulis draf' };
    if (/\[DIAM\]/i.test(draf)) return { ok: false, pesan: 'Hermes menilai belum ada hal baru yang berguna untuk follow-up lead ini ([DIAM])' };
    return { ok: true, pesan: draf };
  }
  // Klien lama dari Tetra Ops (mis. korporat sebelum bot ada, Juni 2026) belum punya riwayat: boleh menyapa dari konteks saja.
  if (!pesan.length && !konteks) return { ok: false, pesan: 'riwayat chat kontak ini kosong di bot; kirim konteks (acara terakhir) untuk menyapa ulang' };
  const panggilan = (pesan.length && namaDariChat(pesan.filter((p) => p.role === 'user').map((p) => p.content).join('\n'))) || 'Kak';
  const botAkhir = pesan.filter((p) => p.role === 'assistant').at(-1);
  const hariDiam = Math.round((Date.now() - (botAkhir?.t || Date.now())) / 864e5);
  const ringkasan = getRingkasan(jid);
  const leadContext = `Panggilan klien: ${panggilan}\n` +
    `FAKTA: owner meminta follow-up dari Tetra Ops (alasan: ${alasan || '-'}); pesan terakhir kita ${hariDiam} hari lalu.\n` +
    (konteks ? `KONTEKS DARI TETRA OPS: ${String(konteks).slice(0, 800)}\n` : '') +
    (ringkasan ? `CATATAN KLIEN (chat lama):\n${ringkasan}\n` : '') +
    (pesan.length ? `TRANSKRIP LENGKAP (kronologis; ADMIN = balasan manual admin, keputusan resmi):\n${barisTranskrip(pesan.slice(-80)).join('\n')}`
      : 'TRANSKRIP: belum pernah chat lewat bot WA (klien lama) — pakai KONTEKS DARI TETRA OPS.');
  const m = await generateFollowupMessage(panggilan, leadContext);
  const draf = String(m || '').replace(/\[KIRIM:[^\]]*\]/gi, '').trim();
  if (!draf) return { ok: false, pesan: 'Hermes gagal menulis draf' };
  if (/^\[DIAM\]$/i.test(draf)) return { ok: false, pesan: 'Hermes menilai belum ada hal baru yang berguna untuk follow-up kontak ini ([DIAM])' };
  return { ok: true, pesan: draf };
}

module.exports = { drafFollowup, start, runFollowupCycle, followupBooking, followupProspek, _jenisProspek: jenisProspek, _takDibalas: takDibalas, _SUSULAN_LEAD: SUSULAN_LEAD, generateFollowupMessage, cleanName, namaDariChat };
