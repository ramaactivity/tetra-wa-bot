// Persistent state untuk anti-spam (cooldown) & human-handoff (pause).
// State disimpan sebagai JSON di folder data/ supaya survive restart.
//
// Cooldown/pause window dibaca dari liveConfig per-panggil (bisa diubah dari
// dashboard). Pause juga disinkron ke Supabase (bot_paused_contacts) supaya
// dashboard ikut lihat, dan pause DARI dashboard dihormati lewat isRemotePaused.
const fs = require('fs');
const path = require('path');

const live = require('./liveConfig');
const supa = require('./supa');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const COOLDOWN_FILE = path.join(DATA_DIR, 'cooldown.json');
const PAUSE_FILE = path.join(DATA_DIR, 'pause.json');
const RIWAYAT_FILE = path.join(DATA_DIR, 'riwayat.json');

const cooldownMs = () => live.get().COOLDOWN_HOURS * 3600 * 1000;

// Hand-off dibatasi waktu, TIDAK permanen.
//
// Versi lama memakai ~100 tahun. Akibatnya nyata: 21 Sep 2026 sebuah instance bot
// lama ikut membalas di nomor yang sama, bot ini membacanya sebagai "admin sudah
// ambil alih", dan lima calon pelanggan dibisukan selamanya tanpa ada yang tahu.
// Syaratnya memang longgar -- pesan keluar dari perangkat tertaut mana pun ikut
// terhitung -- jadi akibatnya tidak boleh permanen.
//
// Balasan manual admin  -> PAUSE_HOURS (default 24 jam, bisa diubah dari dashboard)
// Hand-off eksplisit AI -> 2 jam (HANDOFF_AI_JAM). Keputusan Rama 27 Sep: kalau
// admin belum membalas 2 jam dan klien chat lagi, bot melayani dulu. Dulu 7 hari:
// dua klien yang sudah DP dibisukan 2-3 hari. reminder.js mengeskalasi ke
// Telegram setelah 1 jam, sebelum bot ambil alih.
const handoffMs = () => (live.get().PAUSE_HOURS || 24) * 3600 * 1000;
const HANDOFF_AI_MS = (Number(process.env.HANDOFF_AI_JAM) || 2) * 3600 * 1000;

// ---------- low-level JSON I/O ----------
function loadJson(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(`Gagal load ${file}:`, e.message);
  }
  return {};
}

function saveJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch (e) {
    console.error(`Gagal save ${file}:`, e.message);
  }
}

// ---------- in-memory state (dimuat sekali saat start) ----------
const cooldown = loadJson(COOLDOWN_FILE); // `${jid}:${ruleName}` -> ts
const pause = loadJson(PAUSE_FILE); // jid -> ts
const riwayat = loadJson(RIWAYAT_FILE); // jid -> { ts, pesan: [{role, content}] }

// Ingatan percakapan per kontak. Tanpa ini tiap pesan dibaca seperti orang asing
// yang baru datang: bot menyebut tanggal, pelanggan menjawab jamnya, lalu bot
// bertanya tanggal lagi. Disimpan ke berkas supaya restart tidak menghapus
// percakapan yang sedang berjalan.
//
// Bentuk: jid -> { ts, pesan: [{role, content, t}], ringkasan, sejarah }
//  - pesan > RINGKAS_SETELAH: yang lama dirangkum AI jadi `ringkasan` (catatan
//    klien), SISAKAN pesan terakhir tetap utuh. Tidak ada yang dibuang begitu saja.
//  - sejarah = chat lama dari HP sudah ditarik (history sync), jangan tarik ulang.
//  - TTL 90 hari: acara sering dibooking berbulan-bulan sebelumnya.
const RIWAYAT_MAKS = 250;      // batas keras; normalnya dirangkum jauh sebelum ini
// 30 Sep: diperpanjang (dulu 60/40) atas permintaan Rama supaya konteks chat
// panjang tetap utuh terbaca; model flash-lite murah untuk konteks sebesar ini.
const RINGKAS_SETELAH = 120;
const SISAKAN = 80;
const RIWAYAT_TTL_MS = 90 * 24 * 3600 * 1000;

const aktif = (jid) => riwayat[jid] && Date.now() - riwayat[jid].ts <= RIWAYAT_TTL_MS;

function getRiwayat(jid) {
  return aktif(jid) ? riwayat[jid].pesan || [] : [];
}

function getRingkasan(jid) {
  return aktif(jid) ? riwayat[jid].ringkasan || '' : '';
}

function simpanKontak(jid, patch) {
  riwayat[jid] = { ...(aktif(jid) ? riwayat[jid] : {}), ts: Date.now(), ...patch };
  // Buang percakapan basi sekalian, supaya berkasnya tidak tumbuh selamanya.
  for (const [k, v] of Object.entries(riwayat)) {
    if (Date.now() - (v.ts || 0) > RIWAYAT_TTL_MS) delete riwayat[k];
  }
  saveJson(RIWAYAT_FILE, riwayat);
}

function tambahRiwayat(jid, role, content) {
  if (!content) return;
  simpanKontak(jid, { pesan: [...getRiwayat(jid), { role, content, t: Date.now() }].slice(-RIWAYAT_MAKS) });
}

function lupakanRiwayat(jid) {
  delete riwayat[jid];
  saveJson(RIWAYAT_FILE, riwayat);
}

// Chat lama dari HP (urut lama→baru, semuanya sebelum `sejakMs`). Halaman pertama
// menggantikan entri yang tidak lebih lengkap darinya: entri lama tanpa stempel,
// entri sebelum sejakMs, dan isi-ulang Supabase "(pesan ...)" yang cuma sisi klien.
// Halaman berikutnya (lebih tua lagi) cukup ditaruh di depan.
function gabungSejarah(jid, lama, sejakMs, halamanPertama) {
  let kini = getRiwayat(jid);
  if (halamanPertama) {
    kini = kini.filter((p) => p.t && p.t >= sejakMs && !String(p.content).startsWith('(pesan '));
  }
  simpanKontak(jid, { pesan: [...lama, ...kini].slice(-RIWAYAT_MAKS), sejarah: true });
}

const sudahSejarah = (jid) => !!(aktif(jid) && riwayat[jid].sejarah);

// Rangkum pesan lama bila riwayat kepanjangan. `fn` = ai.ringkasPercakapan,
// disuntik dari pemanggil supaya store tidak bergantung ke modul AI.
async function rangkumBilaPerlu(jid, fn) {
  const pesan = getRiwayat(jid);
  if (pesan.length <= RINGKAS_SETELAH) return;
  const lama = pesan.slice(0, pesan.length - SISAKAN);
  const ringkasan = await fn(getRingkasan(jid), lama);
  if (!ringkasan) return;
  simpanKontak(jid, { ringkasan, pesan: getRiwayat(jid).slice(lama.length) });
  console.log(`[riwayat] ${jid.split('@')[0]}: ${lama.length} pesan lama dirangkum jadi catatan klien`);
}

// ---------- cooldown (anti-spam per kontak × rule) ----------
const isOnCooldown = (key) =>
  cooldown[key] ? Date.now() - cooldown[key] < cooldownMs() : false;
const setCooldown = (key) => {
  cooldown[key] = Date.now();
  saveJson(COOLDOWN_FILE, cooldown);
};

// ---------- pause (auto-pause / human handoff) ----------
// File pause sekarang menyimpan EXPIRY (paused_until, ms epoch), bukan waktu mulai.
// Entri lama (versi sebelumnya menyimpan waktu mulai = di masa lalu) otomatis
// terbaca sebagai sudah kedaluwarsa → tak masalah saat transisi.
const isPaused = (jid) => {
  if (live.isRemotePaused(jid)) return true;
  const until = pause[jid];
  return until ? Date.now() < until : false;
};
// Default PERMANEN (hand-off ke admin). durationMs hanya untuk kasus khusus.
const setPause = (jid, durationMs, alasan = 'tidak disebut') => {
  const ms = durationMs || handoffMs();
  const until = Date.now() + ms;
  pause[jid] = until;
  saveJson(PAUSE_FILE, pause);
  // Selalu dicatat. Bot yang berhenti membalas tanpa jejak adalah cara paling
  // mahal untuk kehilangan pelanggan -- itu yang terjadi sebelum ini.
  const sampai = new Date(until).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
  console.log(`Hand-off ${jid}: ${alasan}. Bot diam sampai ${sampai} WIB (${Math.round(ms / 3600000)} jam).`);
  // Sinkron ke Supabase (best-effort) supaya dashboard lihat pause ini.
  supa.upsertPause(jid, until, 'admin');
};

module.exports = {
  HANDOFF_AI_MS,
  getRiwayat,
  getRingkasan,
  tambahRiwayat,
  lupakanRiwayat,
  gabungSejarah,
  sudahSejarah,
  rangkumBilaPerlu,
  loadJson,
  saveJson,
  isOnCooldown,
  setCooldown,
  isPaused,
  setPause,
};
