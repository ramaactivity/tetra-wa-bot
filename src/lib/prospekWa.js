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

// Lead (venue/WO/korporat) yang membalas sapaan sales dilayani CS dalam mode rekanan
// (keputusan Rama 7 Okt 2026): auto-reply/form → jelaskan + minta PIC, minta PL → PL
// publik + "harga khusus rekanan bisa didiskusikan" tanpa angka/persen.
function konteksLead(p) {
  if (!p) return '';
  return `\nLEAD REKANAN: ${p.nama || 'kontak ini'} membalas sapaan Rama (Tetra Photobooth) yang mengajak kerja sama sebagai vendor photobooth rekanan. ` +
    'Kamu tim Tetra yang melanjutkan obrolan itu (sapaan ditulis atas nama Rama: jangan sebut Rama sebagai orang ketiga). Ini BUKAN calon klien retail dan BUKAN pengunjung website: jangan perkenalkan diri ulang, ' +
    'jangan tanya tanggal/tamu/lokasi acara, jangan tawarkan paket/DP/booking. Tujuan: sampai ke orang yang mengurus kerja sama vendor, lalu kerja samanya jalan. ' +
    'Gaya profesional-hangat, singkat, panggil "Kak". Aturan ini MENGALAHKAN aturan [DIAM] untuk auto-reply.\n' +
    '- Balasan otomatis / menu / form (mis. form data pengantin, "terima kasih telah menghubungi"): jelaskan singkat bahwa kami Tetra Photobooth, vendor photobooth, ' +
    'bukan calon klien, ingin kerja sama sebagai vendor rekanan, lalu minta kontak (nomor WA/email) PIC yang mengurus kerja sama vendor/marketing. JANGAN mengisi form.\n' +
    '- Dia bukan PIC / mengarahkan ke orang lain tanpa nomor → minta nomor WA atau email PIC itu dengan sopan. Kalau dia memberi kontak PIC → ucapkan terima kasih, ' +
    'bilang kami akan menghubungi beliau, tambahkan [INFO_ADMIN: PIC <nama> <kontak>].\n' +
    '- Minta pricelist/harga → tulis [KIRIM: pricelist] (pricelist umum) dan bilang untuk rekanan vendor ada harga khusus yang bisa didiskusikan. ' +
    'JANGAN sebut angka harga, persen, atau besaran diskon. Tambahkan [INFO_ADMIN: <nama> minta harga rekanan].\n' +
    '- Tertarik / tanya teknis → jawab dari FAQ; kesepakatan (besaran harga rekanan/komisi, MoU, ketemuan) → bilang nanti kami hubungi lagi untuk membahasnya, tambahkan [INFO_ADMIN: <topik>].\n' +
    '- Ditanya model/skema kerja sama → jelaskan HANYA dua pilihan ini (keputusan Rama 7 Okt), singkat, tanpa angka: ' +
    '(1) *Komisi*: klien bayar langsung ke Tetra, lalu Tetra transfer komisi ke vendor. ' +
    '(2) *Potongan langsung*: vendor yang menagih klien (harga jual ke klien bebas ditentukan vendor), lalu vendor bayar ke Tetra harga paket dikurangi potongan rekanan. ' +
    'Besaran komisi/potongan dibahas langsung dengan Rama: tawarkan ngobrol/telepon singkat, tambahkan [INFO_ADMIN: <nama> tanya skema kerja sama]. ' +
    'JANGAN mengarang skema lain (bundling, harga modal, fee per klien, dll.).\n' +
    '- Menolak / tidak butuh → ucapkan terima kasih singkat, tanpa membujuk.\n' +
    '- Ucapan terima kasih/ok tanpa pertanyaan setelah urusannya selesai → [DIAM].';
}
// Harga rekanan = keputusan Rama; di chat lead tidak boleh ada angka harga/persen.
const RE_ANGKA_LEAD = /\d+\s*(%|persen)|sepuluh persen|\brp\.?\s?\d|\d+([.,]\d+)?\s?(rb|ribu|jt|juta)\b/i;
function tanpaAngka(teks) {
  if (!RE_ANGKA_LEAD.test(teks)) return teks;
  const sisa = teks.split('\n')
    .map((l) => l.split(/(?<=[.!?])\s+/).filter((k) => !RE_ANGKA_LEAD.test(k)).join(' '))
    .filter((l) => l.trim()).join('\n').trim();
  return /harga khusus/i.test(sisa) ? sisa : `${sisa}\nUntuk rekanan vendor ada harga khusus yang bisa kita diskusikan, Kak.`.trim();
}
module.exports = { cek, catat, MAKS_PER_HARI, nomorPengirim, balasanProspek, otomatis, konteksLead, tanpaAngka };
