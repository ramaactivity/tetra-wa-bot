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
const { loadJson, saveJson, tambahRiwayat, getRiwayat, getRingkasan, getProspek, semuaProspek } = require('./store');
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
const RE_SLOP = /follow.?up|sekadar mengingatkan|ramaikan|keseruan|berkesan|momen spesial|siap (bantu|membantu)|keduluan|amankan|sudah (aku|kami) (koordinasi|cek|catat|teruskan)|masih (aman|tersedia|kosong)|\[/i;

// Penanda follow-up (audit 22 Okt). RE_TUNDA: klien minta waktu. RE_DESAK: dorongan booking. ulangTanya: pertanyaan follow-up
// membahas topik yang sama dengan pertanyaan terakhir kita yang tidak dijawab.
const RE_TUNDA = /diskusi|dirundingkan|dibicarakan|tanya(in)?\s+(dulu|ke|sama)|info(in)?\s+ke|nanti\s+(aku|saya|ku|kami)?\s*(kabari|kabarin|hubungi|info)|kabar(i|in)\s+(lagi|nanti)|pikir(-pikir)?\s+dulu|dulu\s+ya\b/i;
const RE_SOAL_BOOKING = /\bdp\b|booking|\bbook\b|transfer|rekening|cara\s+(pesan|bayar|booking)|bayar(nya)?\s+(ke|gimana)/i;
const RE_DESAK = /\bDP\b|\bkunci\b|dikunci|amankan|booking\.tetraphoto|rekening|bentrok|keburu|sebelum\s+diambil/i;
const TOPIK_TANYA = { tanggal: /tanggal|tgl|kapan/i, jam: /jam\s+berapa|mulai\s+jam|jam\s+(mulai|acara|selesai)/i,
  lokasi: /lokasi|venue|di\s?mana|daerah|kota/i, tamu: /tamu|undangan|berapa\s+orang/i, format: /2R|4R|polaroid|format/i };
function ulangTanya(lama, baru) {
  const qBaru = (String(baru || '').match(/[^.!?\n]*\?/g) || []).join(' ');
  if (!lama || !qBaru) return false;
  return Object.values(TOPIK_TANYA).some((re) => re.test(lama) && re.test(qBaru));
}
async function generateFollowupMessage(panggilan, leadContext, vendor = null) {
  // Vendor rekanan: bukan penawaran. Konfirmasi/kelanjutan urusan yang sedang berjalan,
  // gaya akrab, tanpa "masih tertarik?" (keputusan Rama 30 Sep 2026).
  if (vendor) {
    const p = `Tulis SATU pesan WhatsApp singkat (maks 3 baris) ke vendor rekanan ${vendor.nama} untuk ` +
      `menindaklanjuti urusan yang terakhir dibahas di riwayat (mis. konfirmasi jadwal, desain frame, data acara). ` +
      `Gaya akrab sesuai ATURAN VENDOR. JANGAN tanya "masih tertarik", JANGAN tawarkan paket/DP, JANGAN gaya sales ("amankan"). ` +
      `Jangan tanya hal yang sudah ada di riwayat. Kalau di riwayat sudah ada pesan Tetra dalam 3 hari terakhir, balas persis [DIAM]. ` +
      `Kalau di riwayat tidak ada urusan yang perlu ditindaklanjuti, balas persis [DIAM].`;
    try { return await getAIResponse([], p, leadContext + vendorLib.konteks(vendor)); }
    catch (e) { console.error('[followupEngine] Gagal generate pesan vendor:', e.message); return null; }
  }
  // Ditulis ulang 22 Okt dari audit 28 follow-up (19% dibalas): 24/28 cuma mengulang pertanyaan yang dicuekin, ajakan
  // DP 0/5 dibalas. Yang berhasil memberi sesuatu dulu. Prinsip Rama: tiap klien unik, jangan salesy.
  const prompt =
    `Kamu tim Tetra (bukan admin). Tulis SATU pesan WhatsApp lanjutan untuk ${panggilan}, calon klien yang belum membalas. ` +
    `Tujuannya: dia merasa dipahami dan terbantu sehingga mudah membalas; deal itu hasil, bukan isi pesan.\n` +
    `Sebelum menulis, baca TRANSKRIP dan FAKTA, tentukan dalam hati: dia sedang memutuskan apa, menunggu apa/siapa, seberapa hangat ` +
    `dan bagaimana nadanya. Pilih SATU langkah yang paling cocok untuk DIA — setiap klien beda, jangan pola yang sama:\n` +
    `- info praktis yang khas acaranya (tip yang berguna, bukan brosur);\n` +
    `- jawab keraguan yang tersirat (diam setelah dapat harga = mungkin soal harga: tegaskan sudah all-in tanpa biaya tambahan, ` +
    `buka pintu untuk patokan budget; paket/opsi yang lebih murah HANYA kalau dia pernah menyinggung budget atau mahal);\n` +
    `- beri harga kalau dia pernah minta dan belum dapat angkanya;\n` +
    `- keputusannya di orang lain (pasangan/keluarga/atasan/panitia): ringkasan singkat yang bisa langsung diteruskan, tanpa pertanyaan;\n` +
    `- kantor/instansi/sekolah: tawarkan penawaran resmi untuk diajukan;\n` +
    `- berhenti di tahap booking: ringankan prosesnya (lewat chat juga bisa, aku bantu);\n` +
    `- beri jalan keluar yang sopan ("kalau belum butuh sekarang, santai aja");\n` +
    `- atau balas persis [DIAM] kalau tidak ada hal baru yang berguna untuknya.\n` +
    `Aturan:\n` +
    `- Isi harus BARU dibanding pesan Tetra sebelumnya. JANGAN ulang pertanyaan yang sudah dia lewati (lihat FAKTA); kalau info itu ` +
    `memang perlu, beri alasan yang menguntungkan dia atau bilang boleh menyusul.\n` +
    `- Pertanyaan opsional. Kalau ada, satu saja dan bisa dijawab satu kata/angka atau pilihan A/B atas hal yang memang sedang dia timbang.\n` +
    `- JANGAN ajak DP/kunci/amankan tanggal, kirim link booking atau rekening, atau urgensi ("biar nggak bentrok", "keburu") ` +
    `kecuali dia sendiri sudah bertanya soal booking.\n` +
    `- JANGAN mengarang detail yang tidak ada di transkrip atau system prompt: jenis acara, kategori, siapa pengambil keputusan, ` +
    `kapasitas/angka per jam, jumlah orang per foto. Hitungan harus benar. Minta maaf hanya kalau memang Tetra yang telat atau salah.\n` +
    `- Jangan mengaku sudah melakukan sesuatu, jangan bilang slot masih aman/tersedia, jangan janji promo/diskon. Harga dan fakta hanya ` +
    `dari transkrip dan system prompt; kalau ada info Tetra yang keliru dan relevan di transkrip, luruskan dengan jujur.\n` +
    `- Panggil "${panggilan}"${panggilan === 'Kak' ? '' : ' atau "Kak" saja'}; jangan pakai nama lain.\n` +
    `- Link galeri hanya kalau dia ragu soal hasil atau minta contoh dan belum pernah dikirim, dengan arahan apa yang dilihat.\n` +
    `- Gaya chat orang asli, tanpa bullet, emoji maks 1; panjang sesuai isinya. Kata terlarang di system prompt tetap berlaku ` +
    `(termasuk "follow up", "sekadar mengingatkan"). Keputusan/ucapan ADMIN di transkrip = keputusan resmi.\n` +
    `Balas persis [DIAM] kalau dia sudah batal/bukan calon klien, bilang belum ada rencana, admin sedang menangani, ` +
    `acaranya sudah lewat, atau kamu tidak punya hal baru yang berguna.`;
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
    if (pesan.at(-1)?.role === 'user') { lewati('pesan terakhir klien belum dijawab — urusan balasan/assist, bukan follow-up'); continue; }

    const transkrip = barisTranskrip(pesan.slice(-80)).join('\n');
    const ringkasan = getRingkasan(jid);
    if (!vendor) {
      const n = await nilaiFollowup(transkrip, ringkasan);
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
    const panggilan = cleanName(last.name) || 'Kak';
    const leadContext = `Panggilan klien: ${panggilan}\n` +
      `FAKTA: pesan terakhir kita ${hariDiam} hari lalu; pertanyaan terakhir kita yang belum dia jawab: "${tanyaAkhir || '-'}"; ` +
      `dia ${tanyaBooking ? 'SUDAH' : 'BELUM'} pernah bertanya soal booking/DP.\n` +
      (ringkasan ? `CATATAN KLIEN (chat lama):\n${ringkasan}\n` : '') +
      `TRANSKRIP LENGKAP (kronologis; ADMIN = balasan manual admin, keputusan resmi):\n${transkrip}`;
    let msg = await generateFollowupMessage(panggilan, leadContext, vendor);
    // Tertahan kalimat terlarang → tulis ulang sekali sekarang, bukan menunggu siklus berikutnya (usulan CS Mintet 12:
    // follow-up Alfa tertunda ±6 jam berulang 3 hari).
    if (typeof msg === 'string' && RE_SLOP.test(msg)) {
      console.log(`[followup] tulis ulang ${jid} (kalimat terlarang): ${msg.replace(/\s+/g, ' ').slice(0, 120)}`);
      msg = await generateFollowupMessage(panggilan, leadContext, vendor);
    }
    // Desakan booking tanpa diminta, atau mengulang pertanyaan yang dicuekin → tulis ulang sekali; masih → tidak dikirim.
    const salah = (m) => typeof m === 'string' && !/\[(DIAM|ADMIN_HANDOFF)\]/.test(m) &&
      ((!tanyaBooking && RE_DESAK.test(m)) || ulangTanya(tanyaAkhir, m));
    if (salah(msg)) {
      console.log(`[followup] tulis ulang ${jid} (desak/ulang tanya): ${msg.replace(/\s+/g, ' ').slice(0, 120)}`);
      msg = await generateFollowupMessage(panggilan, leadContext, vendor);
      if (salah(msg)) { lewati('masih mendesak/mengulang pertanyaan setelah tulis ulang'); continue; }
    }
    if (!msg || typeof msg !== 'string') continue;
    if (/\[(ADMIN_HANDOFF|DIAM)\]/.test(msg)) {
      state[jid] = now; // AI memutuskan jangan di-follow-up; jangan ditanya ulang tiap 6 jam
      continue;
    }
    if (RE_SLOP.test(msg)) {
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
  sent += await followupProspek(sock, paused, sent);
  await followupBooking(sock, paused, sent);
}

// ── Lead sales (venue/WO/korporat) yang membalas sapaan ─────────────────────
// Keputusan Rama 7 Okt 2026: lead tidak boleh mati. (1) Balasan lead yang belum
// terjawab (bot restart, dsb.) dijawab di sini. (2) Lead manusia yang diam setelah
// kita jawab: SATU follow-up di hari kerja ke-3 sejak pesan terakhirnya (aturan follow-up lintas agent, Rama 22 Okt:
// maks 1 susulan per kanal, tanpa pindah kanal).
// (3) Hanya auto-reply (tak ada manusia): satu follow-up minta PIC setelah 2 hari kerja.
// Percakapan yang dipegang admin (ada balasan admin sesudah pesan terakhir lead) dilewati.
function hariKerja(dariMs, keMs) {
  let n = 0;
  for (let t = dariMs + 864e5; t <= keMs; t += 864e5) {
    const d = new Date(t + 7 * 3600e3).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

function jenisProspek(riw, s, now) {
  const user = riw.filter((p) => p.role === 'user');
  if (!user.length || s.stop || user.some((p) => RE_TOLAK.test(p.content))) return null;
  const lastUserT = user.at(-1).t || 0;
  const sesudah = riw.slice(riw.lastIndexOf(user.at(-1)) + 1);
  if (sesudah.some((p) => String(p.content).startsWith('(admin)'))) return null;
  if (!sesudah.length) return now - lastUserT > 20 * 60e3 && now - lastUserT < 3 * 864e5 ? 'balas' : null;
  const manusia = user.some((p) => !prospekWa.otomatis(p.content));
  if (manusia) {
    const hk = hariKerja(lastUserT, now);
    return s.n === 0 && hk >= 3 ? 'lanjut' : null;
  }
  // Balasan kita ke auto-reply biasanya sudah minta PIC: jangan minta lagi (audit 22 Okt: dua kali minta PIC).
  const sudahMinta = riw.some((p) => p.role === 'assistant' && /\bPIC\b|nomor WA|e-?mail|kontak (yang|orang)/i.test(String(p.content)) &&
    !/sapaan dari tim sales/.test(String(p.content)));
  return !sudahMinta && s.n === 0 && hariKerja(riw.at(-1).t || 0, now) >= 2 ? 'minta-pic' : null;
}

async function followupProspek(sock, paused, sudah) {
  const now = Date.now();
  const w = new Date(now + 7 * 3600e3);
  if ([0, 6].includes(w.getUTCDay()) || w.getUTCHours() < 9 || w.getUTCHours() >= 17) return 0;
  const state = loadJson(PROSPEK_FILE); // { jid: { sejak: t pesan lead terakhir, n, stop } }
  let sent = 0;
  for (const jid of semuaProspek()) {
    if (sudah + sent >= MAKS_PER_SIKLUS) break;
    if (paused && paused[jid] > now) continue;
    const riw = getRiwayat(jid);
    const lastUserT = riw.filter((p) => p.role === 'user').at(-1)?.t || 0;
    const s = state[jid]?.sejak === lastUserT ? state[jid] : { sejak: lastUserT, n: 0 };
    const jenis = jenisProspek(riw, s, now);
    if (!jenis) continue;
    const p0 = getProspek(jid);
    const nomor = p0.nomor || await prospekWa.nomorPengirim(sock, { key: { remoteJid: jid } }).catch(() => '');
    const pr = await supa.cariProspek(nomor).catch(() => null);
    const p = { ...p0, segmen: p0.segmen || pr?.segmen };
    if (pr && (['tolak', 'jangan_hubungi'].includes(pr.status) || /DIPEGANG RAMA/.test(pr.catatan || '') ||
      (jenis !== 'balas' && /dialihkan ke/.test(pr.catatan || '')))) {
      state[jid] = { ...s, stop: true }; // PIC sudah disapa / lead menolak: jangan dikejar lagi
      continue;
    }
    let msg;
    try {
      if (jenis === 'balas') {
        const i = riw.findLastIndex((x) => x.role !== 'user');
        msg = await getAIResponse(riw.slice(0, i + 1), riw.slice(i + 1).map((x) => x.content).join('\n'), prospekWa.konteksLead(p));
      } else {
        const tugas = jenis === 'lanjut'
          ? `${p.nama || 'Lead ini'} belum membalas lagi. Tulis SATU pesan lanjutan singkat (maks 3 kalimat) yang merujuk hal terakhir di riwayat ` +
            `(mis. pricelist yang sudah dikirim, kontak PIC yang diminta) dan mengajak lanjut ngobrol soal ${prospekWa.rekanan(p) ? 'kerja sama vendor rekanan' : 'kebutuhan photobooth untuk acara mereka'}. ` +
            'Jangan menagih, jangan tanya "masih tertarik?", jangan pakai kata "follow up".'
          : `Kontak ini baru membalas otomatis. Tulis SATU pesan lanjutan singkat (maks 2 kalimat) yang meminta nomor WA/email PIC yang mengurus ${prospekWa.rekanan(p) ? 'kerja sama vendor/marketing' : 'acara kantor/sekolah (HR/GA/humas/panitia)'}.`;
        // Audit 22 Okt: follow-up lead menulis "kemarin" untuk pesan 5–12 hari lalu, menyapa nama dari data prospek
        // ("Kak Talia" untuk Aydi), dan minta PIC padahal lead masih menunggu harga rekanan.
        const hari = Math.max(0, Math.round((now - (riw.filter((x) => x.role !== 'user').at(-1)?.t || now)) / 864e5));
        const fakta = `\nFAKTA: pesan terakhir kita ${hari} hari lalu — jangan tulis "kemarin/tadi" kalau tidak benar. Sapa "Kak" saja; ` +
          'nama orang hanya kalau orang itu sendiri menyebut namanya di riwayat. Kalau lead masih menunggu sesuatu dari kita ' +
          '(harga/skema rekanan, contoh hasil, materi), pesan ini harus memenuhi itu — jangan minta PIC atau mengulang pertanyaan lama. ' +
          'Jangan menganggap tawaran kita sudah disetujui kalau lead belum bilang setuju.';
        msg = await getAIResponse(riw.slice(-30), `${tugas}${fakta}\nKalau dari riwayat tidak pantas dikirimi pesan, balas persis [DIAM].`, prospekWa.konteksLead(p));
      }
    } catch (e) { console.error(`[followup-lead] gagal generate ${jid}:`, e.message); continue; }
    msg = String(msg || '');
    if (!msg.trim() || /\[(DIAM|ADMIN_HANDOFF)\]/.test(msg) || /masih tertarik|follow.?up/i.test(msg)) {
      state[jid] = { ...s, stop: true };
      console.log(`[followup-lead] ${jid}: ${jenis} tidak dikirim (${msg.replace(/\s+/g, ' ').slice(0, 80)})`);
      continue;
    }
    const info = (msg.match(/\[INFO_ADMIN:?\s*([^\]]*)\]/i) || [])[1];
    const pl = /\[KIRIM:\s*pricelist\s*\]/i.test(msg) && !riw.some((x) => String(x.content).includes('[kirim PDF pricelist]'));
    msg = prospekWa.tanpaAngka(msg.replace(/\[[A-Z_]+[^\]]*\]/g, '').replace(/\*\*([^*\n]+)\*\*/g, '*$1*').trim());
    try {
      if (sudah + sent > 0) await new Promise((r) => setTimeout(r, JEDA_MIN_MS + Math.random() * (JEDA_MAKS_MS - JEDA_MIN_MS)));
      const sentMsg = await sock.sendMessage(jid, { text: msg });
      rememberBotMsg(sentMsg);
      deliveryLog.track(sentMsg, `lead-${jenis}→wa`);
      tambahRiwayat(jid, 'assistant', msg);
      if (pl) await kirimPricelist(sock, jid, 'lead-pricelist', { pdf: true });
      if (pr) await supa.catatJawabanProspek(nomor, msg + (pl ? ' [+ pricelist]' : '')).catch(() => {});
      if (info) await kirimTelegram(`🤝 Lead ${p.nama || jid.split('@')[0]}: ${info}`).catch(() => {});
      state[jid] = { ...s, n: s.n + (jenis === 'balas' ? 0 : 1) };
      sent++;
      console.log(`[followup-lead] ${jenis} terkirim ke ${jid} (${p.nama || '-'})`);
    } catch (e) {
      console.error(`[followup-lead] gagal kirim ke ${jid}:`, e.message);
    }
  }
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
      `Tulis SATU pesan WhatsApp singkat (maks 4 baris) untuk klien yang SUDAH DP, mengingatkan dengan ramah ` +
      `data acara yang masih kurang: ${k.join(', ')}. Tanyakan maks 2 yang paling penting dengan kalimat biasa (bukan daftar), bilang boleh dicicil. ` +
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

module.exports = { start, runFollowupCycle, followupBooking, followupProspek, _jenisProspek: jenisProspek, generateFollowupMessage, cleanName };
