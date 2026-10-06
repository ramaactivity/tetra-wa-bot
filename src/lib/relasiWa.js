// Rem untuk WA ke kontak yang SUDAH dikenal (klien/vendor/PIC), perintah send-relasi
// dari agent Hermes (CS Mintet, Bruno) lewat Tetra Ops wa_kirim_kontak. Keputusan Rama
// 6 Okt 2026: otomatis penuh, tanpa tombol persetujuan. Pengamannya di sini (bukan di AI):
// kuota harian, jam 08–20 WIB, jeda acak, satu nomor maks sekali per 12 jam, pesan sama
// tidak pernah dikirim dua kali ke nomor yang sama. Validasi "nomor dikenal" ada di Tetra Ops.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FILE = path.join(__dirname, '..', '..', 'data', 'relasi-wa.json');
const MAKS_PER_HARI = 20;
const JEDA_MIN_MS = 60 * 1000;
const JEDA_ACAK_MS = 2 * 60 * 1000;
const PER_NOMOR_MS = 12 * 3600 * 1000;
function wib(now) {
  const d = new Date(now.getTime() + 7 * 3600 * 1000);
  return { tanggal: d.toISOString().slice(0, 10), jam: d.getUTCHours() };
}
function baca() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return { tanggal: '', hari_ini: 0, berikutnya_ms: 0, terakhir: {}, hash: [] }; }
}
const sidik = (nomor, pesan) => crypto.createHash('sha1').update(`${nomor}|${String(pesan).trim()}`).digest('hex').slice(0, 16);
/** { ok } | { tunda: alasan } (biarkan antre) | { tolak: alasan }. */
function cek(nomor, pesan, now = new Date()) {
  const s = baca();
  if (s.hash.includes(sidik(nomor, pesan))) return { tolak: `pesan yang sama sudah pernah dikirim ke ${nomor}` };
  const w = wib(now);
  if (w.jam < 8 || w.jam >= 20) return { tunda: 'di luar jam 08–20 WIB' };
  if ((s.tanggal === w.tanggal ? s.hari_ini : 0) >= MAKS_PER_HARI) return { tunda: `kuota ${MAKS_PER_HARI}/hari habis` };
  if (now.getTime() - (s.terakhir[nomor] || 0) < PER_NOMOR_MS) return { tunda: `${nomor} sudah dikirimi pesan < 12 jam lalu` };
  if (now.getTime() < (s.berikutnya_ms || 0)) return { tunda: 'menunggu jeda antar-pesan' };
  return { ok: true };
}
function catat(nomor, pesan, now = new Date()) {
  const s = baca();
  const w = wib(now);
  if (s.tanggal !== w.tanggal) { s.tanggal = w.tanggal; s.hari_ini = 0; }
  s.hari_ini += 1;
  s.berikutnya_ms = now.getTime() + JEDA_MIN_MS + Math.floor(Math.random() * JEDA_ACAK_MS);
  s.terakhir[nomor] = now.getTime();
  s.hash = [...s.hash, sidik(nomor, pesan)].slice(-2000);
  fs.writeFileSync(FILE, JSON.stringify(s, null, 1));
}
module.exports = { cek, catat, MAKS_PER_HARI, _FILE: FILE };
