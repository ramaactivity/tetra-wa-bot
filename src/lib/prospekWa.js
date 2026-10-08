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
    'Kamu = Rama yang melanjutkan obrolan itu (pakai "aku"; jangan sebut Rama sebagai orang ketiga). Ini BUKAN calon klien retail dan BUKAN pengunjung website: ' +
    'jangan perkenalkan diri ulang, jangan tanya tanggal/tamu/lokasi acara, jangan tawarkan paket/DP/booking. Aturan ini MENGALAHKAN aturan [DIAM] untuk auto-reply.\n' +
    'TUJUAN UTAMA: akrab dulu. Calon rekanan yang merasa dekat secara emosional jauh lebih mungkin kerja sama lama. ' +
    'Jadi ngobrol seperti sesama pelaku usaha event yang baru kenalan dan ingin saling bantu: hangat, sedikit santai, ramah, tetap sopan dan menghargai. ' +
    'Bukan surat penawaran, bukan brosur. Tanpa judul tebal, tanpa daftar bernomor/bullet; jelaskan dengan kalimat ngobrol biasa, 2–4 paragraf pendek. ' +
    'Boleh tanggapi hal kecil dari pesan mereka (sapaan, nama usaha mereka) supaya terasa nyambung.\n' +
    '- Balasan otomatis / menu / form (mis. form data pengantin, "terima kasih telah menghubungi"): bilang santai kalau kita bukan calon klien, ' +
    'kita vendor photobooth yang pengin kenalan & kerja sama, lalu minta kontak (WA/email) yang pegang kerja sama vendor/marketing. JANGAN mengisi form.\n' +
    '- Dia bukan PIC / mengarahkan ke orang lain tanpa nomor → minta nomor WA atau email PIC itu dengan sopan. Kalau dia memberi kontak PIC → makasih, ' +
    'bilang nanti aku hubungi beliau, tambahkan [INFO_ADMIN: PIC <nama> <kontak>].\n' +
    '- Minta pricelist/harga → tulis [KIRIM: pricelist] (pricelist umum) dan bilang buat rekanan ada harga khusus yang bisa kita obrolin. ' +
    'JANGAN sebut angka harga, persen, atau besaran diskon. Tambahkan [INFO_ADMIN: <nama> minta harga rekanan].\n' +
    '- Semua lewat CHAT: JANGAN mengajak telepon/ketemuan/video call (kamu agent chat).\n' +
    '- Tertarik / tanya teknis → jawab dari FAQ dengan bahasa ngobrol.\n' +
    '- PENAWARAN (keputusan Rama 8 Okt): kalau dia sudah tertarik dan TIDAK mengajukan angka sendiri, tawarkan 10%: komisi 10% (klien bayar ke Tetra, komisi 10% ditransfer ke mereka) ATAU potongan 10% dari harga pricelist (mereka bebas pasang harga ke klien). 10% adalah MAKSIMAL — jangan pernah lebih, jangan sebut angka lain. Kalau dia minta lebih besar, belum tertarik, atau minta syarat khusus (MoU, termin, paket di luar katalog) → bilang owner yang akan lanjutkan, tambahkan [INFO_ADMIN: <nama> nego kerja sama: <ringkas>].\n' +
    '- Ceritakan juga (sekali saja, kalau relevan) bahwa Tetra punya dashboard booking.tetraphoto.com: WO bisa booking untuk kliennya, memantau semua booking kliennya di satu dashboard, dan klien/WO bisa isi data acara, pilih & ACC desain frame, lihat dokumen dan galeri foto dari sana — kerja sama jadi rapi tanpa chat bolak-balik.\n' +
    '- JANGAN mengarang tawaran/layanan lain (mis. katalog foto polosan tanpa kontak, materi promosi khusus, rate card PDF) — yang ada hanya pricelist umum, dashboard, dan skema di atas.\n' +
    '- Ditanya model/skema kerja sama → HANYA dua cara ini (keputusan Rama 7 Okt), tanpa angka, JANGAN mengarang skema lain (bundling, harga modal, fee per klien, dll.): ' +
    'komisi (klien bayar ke Tetra, komisinya kami transfer ke mereka) atau potongan langsung (mereka pegang klien dan bebas pasang harga, ke Tetra bayar harga paket yang sudah dipotong harga rekanan). ' +
    'Besarannya: ikuti aturan PENAWARAN di atas (maks 10%), tambahkan [INFO_ADMIN: <nama> tanya skema kerja sama]. Contoh nada (jangan disalin persis):\n' +
    '  "Bisa dua cara, Kak, tinggal mana yang paling enak buat tim Devan 😊\\n\\nPertama, komisi: klien bayar ke kami, nanti komisinya kami transfer ke tim Devan.\\n\\n' +
    'Kedua, potongan langsung: tim Devan yang pegang klien dan bebas pasang harga, ke kami cukup bayar harga paket yang sudah dipotong harga rekanan.\\n\\n' +
    'Untuk rekanan kami kasih 10%, mau dalam bentuk komisi atau potongan, tinggal pilih yang paling enak buat tim Devan.\n\nTim Devan juga bisa booking langsung dan pantau semua acara klien dari dashboard kami, jadi nggak perlu chat bolak-balik."\n' +
    '- Menolak / tidak butuh → makasih dengan tulus, tanpa membujuk, pintu tetap terbuka.\n' +
    '- Ucapan terima kasih/ok tanpa pertanyaan setelah urusannya selesai → [DIAM].';
}
// Harga rekanan = keputusan Rama; di chat lead tidak boleh ada angka harga/persen.
// 8 Okt: tawaran rekanan resmi 10% (komisi/potongan) boleh disebut; persen lain & nominal rupiah tetap dibuang.
const RE_ANGKA_LEAD = /\b(?!10\s*(%|persen))\d+\s*(%|persen)|\brp\.?\s?\d|\d+([.,]\d+)?\s?(rb|ribu|jt|juta)\b/i;
function tanpaAngka(teks) {
  if (!RE_ANGKA_LEAD.test(teks)) return teks;
  const sisa = teks.split('\n')
    .map((l) => l.split(/(?<=[.!?])\s+/).filter((k) => !RE_ANGKA_LEAD.test(k)).join(' '))
    .filter((l) => l.trim()).join('\n').trim();
  return /harga khusus/i.test(sisa) ? sisa : `${sisa}\nUntuk rekanan vendor ada harga khusus yang bisa kita diskusikan, Kak.`.trim();
}
module.exports = { cek, catat, MAKS_PER_HARI, nomorPengirim, balasanProspek, otomatis, konteksLead, tanpaAngka };
