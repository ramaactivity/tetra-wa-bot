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
// Hand-off eksplisit AI -> 7 hari, karena di sana manusia memang sedang mengambil alih
const handoffMs = () => (live.get().PAUSE_HOURS || 24) * 3600 * 1000;
const HANDOFF_AI_MS = 7 * 24 * 3600 * 1000;

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
const RIWAYAT_MAKS = 12; // 6 giliran bolak-balik; cukup untuk satu alur tanya-booking
const RIWAYAT_TTL_MS = 6 * 3600 * 1000; // percakapan dianggap baru setelah 6 jam diam

function getRiwayat(jid) {
  const r = riwayat[jid];
  if (!r || Date.now() - r.ts > RIWAYAT_TTL_MS) return [];
  return r.pesan || [];
}

function tambahRiwayat(jid, role, content) {
  if (!content) return;
  const pesan = [...getRiwayat(jid), { role, content }].slice(-RIWAYAT_MAKS);
  riwayat[jid] = { ts: Date.now(), pesan };
  // Buang percakapan basi sekalian, supaya berkasnya tidak tumbuh selamanya.
  for (const [k, v] of Object.entries(riwayat)) {
    if (Date.now() - (v.ts || 0) > RIWAYAT_TTL_MS) delete riwayat[k];
  }
  saveJson(RIWAYAT_FILE, riwayat);
}

function lupakanRiwayat(jid) {
  delete riwayat[jid];
  saveJson(RIWAYAT_FILE, riwayat);
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
  tambahRiwayat,
  lupakanRiwayat,
  loadJson,
  saveJson,
  isOnCooldown,
  setCooldown,
  isPaused,
  setPause,
};
