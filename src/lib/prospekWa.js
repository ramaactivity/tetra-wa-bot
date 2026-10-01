// Rem untuk sapaan WA pertama ke prospek (perintah send-text dari agent Sales).
// Keputusan Rama 1 Okt 2026: WA dingin dari nomor utama, MAKS 15 nomor/hari.
// Pengaman ada di sini (bukan di AI): kuota harian, jam kerja WIB, jeda acak
// antar-sapaan, dan satu nomor tidak pernah disapa dua kali.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'prospek-wa.json');
const MAKS_PER_HARI = 15;
const JEDA_MIN_MS = 4 * 60 * 1000;
const JEDA_ACAK_MS = 5 * 60 * 1000;

function wib(now = new Date()) {
  const d = new Date(now.getTime() + 7 * 3600 * 1000);
  return { tanggal: d.toISOString().slice(0, 10), jam: d.getUTCHours(), hari: d.getUTCDay() };
}

function baca() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (_) {
    return { tanggal: '', hari_ini: 0, berikutnya_ms: 0, pernah: [] };
  }
}

function tulis(s) {
  fs.writeFileSync(FILE, JSON.stringify(s, null, 1));
}

/** { ok } | { tunda: alasan } (biarkan antre) | { tolak: alasan } (tandai error). */
function cek(nomor, now = new Date()) {
  const s = baca();
  if (s.pernah.includes(nomor)) return { tolak: `${nomor} sudah pernah disapa` };
  const w = wib(now);
  if (w.hari === 0 || w.hari === 6 || w.jam < 9 || w.jam >= 17) return { tunda: 'di luar Senin–Jumat 09–17 WIB' };
  const hariIni = s.tanggal === w.tanggal ? s.hari_ini : 0;
  if (hariIni >= MAKS_PER_HARI) return { tunda: `kuota ${MAKS_PER_HARI}/hari habis` };
  if (now.getTime() < (s.berikutnya_ms || 0)) return { tunda: 'menunggu jeda antar-sapaan' };
  return { ok: true };
}

function catat(nomor, now = new Date()) {
  const s = baca();
  const w = wib(now);
  if (s.tanggal !== w.tanggal) {
    s.tanggal = w.tanggal;
    s.hari_ini = 0;
  }
  s.hari_ini += 1;
  s.berikutnya_ms = now.getTime() + JEDA_MIN_MS + Math.floor(Math.random() * JEDA_ACAK_MS);
  s.pernah.push(nomor);
  tulis(s);
}

module.exports = { cek, catat, MAKS_PER_HARI };
