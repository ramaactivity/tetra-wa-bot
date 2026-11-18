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

// Balasan prospek. Baileys 7 sering mengirim balasan dengan JID @lid tanpa nomor HP;
// pemetaan LID→HP ada di auth (lidMapping). Tanpa ini balasan tidak tersambung ke
// sapaan sales dan dianggap orang asing oleh CS (kasus Ibis Styles 6 Okt).
async function nomorPengirim(sock, msg) {
  const jid = msg.key?.remoteJid || '';
  let pn = jid;
  if (jid.endsWith('@lid')) {
    pn = msg.key?.remoteJidAlt || msg.key?.senderPn ||
      (await sock?.signalRepository?.lidMapping?.getPNForLID(jid).catch(() => null)) || '';
  }
  return String(pn).split('@')[0].split(':')[0].replace(/\D/g, '');
}
/** Nomor HP prospek kalau pesan ini balasan atas sapaan sales; selain itu null. */
async function balasanProspek(sock, msg) {
  const nomor = await nomorPengirim(sock, msg);
  return nomor && baca().pernah.includes(nomor) ? nomor : null;
}
// Pesan sambutan otomatis akun bisnis (bukan manusia): dicatat, status prospek tidak berubah.
const RE_OTOMATIS = /thank you for (contacting|reaching)|terima ?kasih (sudah|telah|atas) (menghubungi|pesan)|we will (reply|get back)|selamat datang di|wilujeng sumping|(mohon|silakan) (kirim|isi)\b.{0,40}(tanggal|nama|data)|jam (operasional|kerja) kami|sedang (tidak|di luar)/i;
const otomatis = (teks) => RE_OTOMATIS.test(String(teks || ''));

// Lead yang membalas sapaan sales (Bruno). Segmen dari tabel prospek Tetra Ops (paket perbaikan Bruno, Rama 22 Okt):
// venue & WO/EO = calon rekanan; korporat/instansi/kampus/personal = calon KLIEN (5 konversi 1 Sep–22 Okt semuanya
// korporat/instansi, tapi dulu dilayani sebagai calon rekanan dan tak pernah diarahkan ke booking).
const SEGMEN_REKANAN = ['venue', 'eo_wo'];
const rekanan = (p) => !p?.segmen || SEGMEN_REKANAN.includes(p.segmen);

// 18 Nov (Rama: "bener-bener native semua dihandle oleh hermes"): cara menanggapi lead klien/rekanan — termasuk aturan jujur,
// skema 10%, dasbor rekanan — ada di skill Hermes mode-kontak-khusus. Node hanya memberi fakta siapa lead ini.
function konteksLead(p) {
  if (!p) return '';
  if (!rekanan(p)) return `\nLEAD KLIEN: ${p.nama || 'kontak ini'} (${p.segmen}) membalas sapaan Rama (Tetra Photobooth) yang menawarkan photobooth untuk acara mereka.`;
  return `\nLEAD REKANAN: ${p.nama || 'kontak ini'} membalas sapaan Rama (Tetra Photobooth) yang mengajak kerja sama sebagai vendor photobooth rekanan.`;
}
// Persen rekanan maksimal 10% (Rama 8 Okt): kalimat dengan persen lain dibuang. Sejak 22 Okt harga publish (rupiah)
// boleh disebut ke lead (harga rekanan = publish − 10%); kebenaran nominalnya dijaga penjaga harga di ai.js.
const RE_ANGKA_LEAD = /\b(?!10\s*(%|persen))\d+\s*(%|persen)/i;
function tanpaAngka(teks) {
  if (!RE_ANGKA_LEAD.test(teks)) return teks;
  return teks.split('\n')
    .map((l) => l.split(/(?<=[.!?])\s+/).filter((k) => !RE_ANGKA_LEAD.test(k)).join(' '))
    .filter((l) => l.trim()).join('\n').trim();
}
module.exports = { cek, catat, MAKS_PER_HARI, nomorPengirim, balasanProspek, otomatis, konteksLead, tanpaAngka, rekanan };

if (require.main === module) {
  // Uji cepat: node src/lib/prospekWa.js
  const assert = require('assert');
  assert.ok(konteksLead({ nama: 'PT X', segmen: 'corporate' }).includes('LEAD KLIEN'));
  assert.ok(konteksLead({ nama: 'SMA Y', segmen: 'kampus' }).includes('LEAD KLIEN'));
  assert.ok(konteksLead({ nama: 'Gedung Z', segmen: 'venue' }).includes('LEAD REKANAN'));
  assert.ok(konteksLead({ nama: 'WO lama' }).includes('LEAD REKANAN')); // penanda lama tanpa segmen
  assert.ok(konteksLead({ segmen: 'eo_wo' }).length < 300); // aturan di skill mode-kontak-khusus; Node hanya fakta
  assert.strictEqual(tanpaAngka('Paket 3 jam Rp 2.500.000. Rekanan dapat 10%.'), 'Paket 3 jam Rp 2.500.000. Rekanan dapat 10%.');
  assert.strictEqual(tanpaAngka('Bisa 15% kok. Kabari ya.'), 'Kabari ya.');
  assert.strictEqual(konteksLead(null), '');
  console.log('UJI PROSPEK WA LOLOS');
}
