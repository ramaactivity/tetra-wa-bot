// Pengingat untuk tim internal Tetra (Iqbal desain/konten, Fahmi konten, Adit crew/operasional), dari agent
// CS Mintet lewat Tetra Ops (perintah send-tim). Keputusan Rama 8 Okt 2026. Rem sendiri, terpisah dari sapaan
// sales & relasi: hanya nomor di TIM_WA, maks 4 pesan/nomor/hari, jam 07–21 WIB, pesan sama tidak dikirim dua kali.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const FILE = path.join(__dirname, '..', '..', 'data', 'tim-wa.json');
const MAKS_PER_NOMOR = 4;
const daftarTim = () => String(process.env.TIM_WA || '').split(',').map((x) => x.replace(/\D/g, '')).filter(Boolean);
const wib = (now) => {
  const d = new Date(now.getTime() + 7 * 3600 * 1000);
  return { tanggal: d.toISOString().slice(0, 10), jam: d.getUTCHours() };
};
function baca() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return { tanggal: '', hitung: {}, hash: [] }; }
}
const sidik = (nomor, pesan) => crypto.createHash('sha1').update(`${nomor}|${String(pesan).trim()}`).digest('hex').slice(0, 16);
/** { ok } | { tunda: alasan } | { tolak: alasan } */
function cek(nomor, pesan, now = new Date()) {
  if (!daftarTim().includes(nomor)) return { tolak: `${nomor} bukan nomor tim (TIM_WA)` };
  const s = baca();
  if (s.hash.includes(sidik(nomor, pesan))) return { tolak: 'pesan yang sama sudah pernah dikirim' };
  const w = wib(now);
  if (w.jam < 7 || w.jam >= 21) return { tunda: 'di luar jam 07–21 WIB' };
  if ((s.tanggal === w.tanggal ? s.hitung[nomor] || 0 : 0) >= MAKS_PER_NOMOR) return { tolak: `jatah ${MAKS_PER_NOMOR} pesan/hari untuk ${nomor} habis` };
  return { ok: true };
}
function catat(nomor, pesan, now = new Date()) {
  const s = baca();
  const w = wib(now);
  if (s.tanggal !== w.tanggal) { s.tanggal = w.tanggal; s.hitung = {}; }
  s.hitung[nomor] = (s.hitung[nomor] || 0) + 1;
  s.hash = [...s.hash, sidik(nomor, pesan)].slice(-1000);
  fs.writeFileSync(FILE, JSON.stringify(s, null, 1));
}
const anggota = (nomor) => daftarTim().includes(String(nomor || '').replace(/\D/g, ''));
module.exports = { cek, catat, anggota, MAKS_PER_NOMOR, _FILE: FILE };
