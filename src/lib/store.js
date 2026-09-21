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

const cooldownMs = () => live.get().COOLDOWN_HOURS * 3600 * 1000;

// Hand-off ke admin = PERMANEN. Sekali admin balas manual ATAU bot selesai
// (sudah kirim pricelist / sapa B2B), kontak itu tidak di-auto-reply lagi
// selamanya — bukan 24 jam. ~100 tahun = praktis permanen, dan tetap punya nilai
// numerik valid untuk disimpan ke file & Supabase.
const HANDOFF_MS = 100 * 365 * 24 * 3600 * 1000;

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
const setPause = (jid, durationMs = HANDOFF_MS) => {
  const until = Date.now() + durationMs;
  pause[jid] = until;
  saveJson(PAUSE_FILE, pause);
  // Sinkron ke Supabase (best-effort) supaya dashboard lihat pause ini.
  supa.upsertPause(jid, until, 'admin');
};

module.exports = {
  loadJson,
  saveJson,
  isOnCooldown,
  setCooldown,
  isPaused,
  setPause,
};
