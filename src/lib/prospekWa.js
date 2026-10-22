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
// Insiden Bu Tifani 22 Okt: bot mengarang "waktu itu main ke kostan" dan berjanji "langsung aku samperin".
const JUJUR = '\nJUJUR & TANPA KARANGAN (berlaku mutlak): JANGAN mengarang kenangan, pertemuan, kunjungan, kedekatan, atau kejadian masa lalu ' +
  'yang tidak tertulis di riwayat ini (mis. "inget banget waktu itu main ke…"). Kalau dia bilang pernah pakai Tetra / pernah kenal, terima dengan hangat ' +
  'tanpa menambah detail. JANGAN menjanjikan datang, meluncur, ketemuan, visit, telepon, atau video call, dan jangan mengatur jadwal ketemu: kalau dia ' +
  'minta ketemu/mengajak visit, bilang jujur untuk sekarang kita lanjut lewat chat dulu biar cepat — TANPA alasan karangan (sibuk, ada acara, di luar kota) ' +
  'dan tanpa "nanti aku kabari kalau sempat ketemu" — langsung bantu di chat, dan tambahkan ' +
  '[INFO_ADMIN: <nama> minta ketemu/visit: <ringkas>]. Kalau dia menyebut acara nyata (ada tanggal/lokasi/durasi), layani acaranya ' +
  '(kebutuhan, harga, ketersediaan, booking) dan tambahkan [INFO_ADMIN: <nama> ada acara <tanggal> <lokasi/durasi>].';
const rekanan = (p) => !p?.segmen || SEGMEN_REKANAN.includes(p.segmen);

function konteksKlien(p) {
  return `\nLEAD KLIEN: ${p.nama || 'kontak ini'} (${p.segmen}) membalas sapaan Rama (Tetra Photobooth) yang menawarkan photobooth untuk acara mereka. ` +
    'Kamu = Rama yang melanjutkan obrolan itu (pakai "aku"; jangan sebut Rama sebagai orang ketiga; jangan perkenalkan diri ulang). ' +
    'Mereka CALON KLIEN (penyewa untuk acara kantor/sekolah/kampus/instansinya), BUKAN calon rekanan: jangan tawarkan skema rekanan/komisi/dasbor rekanan, ' +
    'jangan tulis [UNDANG_VENDOR] atau [KIRIM: skema]. Aturan ini MENGALAHKAN aturan [DIAM] untuk auto-reply.\n' +
    '- Ikuti alur CS biasa (BACA KLIEN DULU, HARGA & PRICELIST): pahami acaranya seperlunya (jenis, tanggal, jumlah peserta, lokasi), rekomendasikan SATU paket ' +
    'yang pas dengan harga publik dari FAQ, dan arahkan kunci tanggal di https://booking.tetraphoto.com. Pertanyaan nyambung dengan yang dibahas, maks 2.\n' +
    '- Balasan otomatis / menu / form: 2 kalimat santai — kita vendor photobooth yang pengin bantu acara kantor/sekolahnya — lalu minta kontak yang mengurus acara ' +
    '(HR/GA/humas/panitia). Sekali saja per kontak: kalau di riwayat sudah ada balasan kita ke auto-reply, balas [DIAM].\n' +
    '- Diarahkan ke orang lain dengan kontaknya → makasih, bilang nanti aku hubungi beliau, tambahkan [INFO_ADMIN: PIC <nama> <kontak>].\n' +
    '- Minta company profile → kirim profil [KIRIM: profil]; minta harga/penawaran → pricelist [KIRIM: pricelist] + galeri ' +
    'https://tetraphoto.com/galeri; butuh penawaran resmi untuk pengajuan internal → ikuti aturan [QUOTATION].\n' +
    '- Gaya: ngobrol, 1–3 paragraf pendek, tanpa judul/bullet ala brosur.\n' +
    '- Menolak / tidak butuh → makasih dengan tulus, tanpa membujuk, pintu tetap terbuka. Terima kasih/ok setelah urusan selesai → [DIAM].' + JUJUR;
}

function konteksLead(p) {
  if (!p) return '';
  if (!rekanan(p)) return konteksKlien(p);
  return `\nLEAD REKANAN: ${p.nama || 'kontak ini'} membalas sapaan Rama (Tetra Photobooth) yang mengajak kerja sama sebagai vendor photobooth rekanan. ` +
    'Kamu = Rama yang melanjutkan obrolan itu (pakai "aku"; jangan sebut Rama sebagai orang ketiga). Ini BUKAN calon klien retail dan BUKAN pengunjung website: ' +
    'jangan perkenalkan diri ulang, jangan tanya tanggal/tamu/lokasi acara, jangan tawarkan paket/DP/booking. Aturan ini MENGALAHKAN aturan [DIAM] untuk auto-reply.\n' +
    'TUJUAN UTAMA: akrab dulu. Calon rekanan yang merasa dekat secara emosional jauh lebih mungkin kerja sama lama. ' +
    'Jadi ngobrol seperti sesama pelaku usaha event yang baru kenalan dan ingin saling bantu: hangat, sedikit santai, ramah, tetap sopan dan menghargai. ' +
    'Bukan surat penawaran, bukan brosur. Tanpa judul tebal, tanpa daftar bernomor/bullet; jelaskan dengan kalimat ngobrol biasa, 1–3 paragraf pendek (maks ±5 baris; audit 22 Okt: 4 paragraf terasa brosur). ' +
    'Boleh tanggapi hal kecil dari pesan mereka (sapaan, nama usaha mereka) supaya terasa nyambung.\n' +
    '- Balasan otomatis / menu / form (mis. form data pengantin, "terima kasih telah menghubungi"): bilang santai kalau kita bukan calon klien, ' +
    'kita vendor photobooth yang pengin kenalan & kerja sama, lalu minta kontak (WA/email) yang pegang kerja sama vendor/marketing. JANGAN mengisi form. Cukup 2 kalimat, sekali saja per kontak: kalau di riwayat sudah ada balasan kita ke auto-reply, balas [DIAM].\n' +
    '- Dia bukan PIC / mengarahkan ke orang lain tanpa nomor → minta nomor WA atau email PIC itu dengan sopan. Kalau dia memberi kontak PIC → makasih, ' +
    'bilang nanti aku hubungi beliau, tambahkan [INFO_ADMIN: PIC <nama> <kontak>].\n' +
    '- Minta pricelist/harga rekanan → skema rekanan 10% (Rama 22 Okt): jelaskan skema resmi (lihat PENAWARAN: komisi 10% atau potongan 10%) + [KIRIM: skema], dan kalau dia minta daftar harga atau punya acara nyata sebut harga publish paket yang relevan dari FAQ (+ [KIRIM: pricelist] kalau minta daftarnya). JANGAN sebut persen selain 10%, jangan menghitung atau mengarang nominal lain. ' +
    'Jangan menunda dengan "nanti kita obrolin/teleponan" (usulan CS Mintet 22: Nadia menunggu 6 hari). Tambahkan [INFO_ADMIN: <nama> minta harga rekanan].\n' +
    '- Tertarik / tanya teknis → jawab dari FAQ dengan bahasa ngobrol.\n' +
    '- PENAWARAN (keputusan Rama 8 Okt): kalau dia sudah tertarik dan TIDAK mengajukan angka sendiri, tawarkan 10% dengan dua pilihan yang SAMA dengan sistem Tetra Ops (dipilih per acara di dasbor rekanan): KOMISI — klien bayar harga publish ke Tetra, komisi 10% kami transfer ke mereka setelah acaranya selesai; atau POTONGAN LANGSUNG — mereka pegang klien dan bebas menjual ke klien dengan harga berapa pun, ke Tetra cukup bayar harga publish dikurangi 10%. Komisi/potongan tidak pernah terlihat klien. 10% adalah MAKSIMAL — jangan pernah lebih, jangan sebut angka lain. Saat menjelaskan skema ini tulis [KIRIM: skema] (gambar ilustrasi dua skema, sekali per percakapan), teksmu cukup singkat. Kalau dia minta lebih besar, belum tertarik, atau minta syarat khusus (MoU, termin, paket di luar katalog) → bilang aku cek dulu dan kabari di chat ini (kamu Rama, jangan menyebut "owner/admin kami" seolah orang lain), tambahkan [INFO_ADMIN: <nama> nego kerja sama: <ringkas>].\n' +
    '- Ceritakan juga (sekali saja, kalau relevan) bahwa rekanan Tetra dapat dasbor rekanan di booking.tetraphoto.com/akun (satu link undangan pribadi dari tim Tetra, sekali ketuk masuk): semua acara klien mereka otomatis tertaut, ada daftar "perlu tindakan" (klien belum diundang, data kurang, belum DP, desain belum ACC), tagihan ke Tetra untuk skema potongan langsung, dan rekap komisi per acara untuk skema komisi; WO juga bisa booking langsung dan mengundang kliennya ke dashboard bersama — kerja sama jadi rapi tanpa chat bolak-balik. Kalau dia tertarik/setuju bekerja sama atau ingin melihat dasbornya: bilang kamu kirimkan link dasbor rekanannya, lalu di baris paling akhir tulis [UNDANG_VENDOR: <nama usaha> | <wo/eo/venue/vendor> | <nama orang yang sedang chat> | <kota kalau tahu>] — sistem membuat akunnya dan menempelkan link (JANGAN tulis link sendiri). Nama orangnya belum tahu → tanya dulu. Sekali per percakapan.\n' +
    '- JANGAN mengarang tawaran/layanan lain (mis. katalog foto polosan tanpa kontak, materi promosi khusus, rate card PDF) — yang ada hanya pricelist umum, PDF edisi rekanan, dashboard, dan skema di atas. Minta company profile → kirim [KIRIM: rekanan] (PDF kerja sama rekanan, Rama 22 Okt).\n' +
    '- Ditanya model/skema kerja sama → HANYA dua cara ini (keputusan Rama 7 Okt), boleh dengan angka 10%, JANGAN mengarang skema lain (bundling, harga modal, fee per klien, dll.): ' +
    'komisi (klien bayar harga publish ke Tetra, komisi 10% kami transfer setelah acara selesai) atau potongan langsung (mereka pegang klien dan bebas pasang harga berapa pun, ke Tetra bayar harga publish dikurangi 10%). ' +
    'Besarannya: ikuti aturan PENAWARAN di atas (maks 10%), tambahkan [INFO_ADMIN: <nama> tanya skema kerja sama]. Contoh nada (jangan disalin persis):\n' +
    '  "Bisa dua cara, Kak, tinggal mana yang paling enak buat tim Devan 😊\\n\\nPertama, komisi: klien bayar ke kami sesuai harga publish, nanti komisi 10%-nya kami transfer ke tim Devan setelah acaranya selesai.\\n\\n' +
    'Kedua, potongan langsung: tim Devan yang pegang klien dan bebas jual ke klien berapa pun, ke kami cukup bayar harga publish dikurangi 10%.\\n\\n' +
    'Pilihannya bisa beda tiap acara, diatur sendiri dari dashboard.\n\nTim Devan juga bisa booking langsung dan pantau semua acara klien dari dashboard kami, jadi nggak perlu chat bolak-balik."\n' +
    '- Menolak / tidak butuh → makasih dengan tulus, tanpa membujuk, pintu tetap terbuka.\n' +
    '- Ucapan terima kasih/ok tanpa pertanyaan setelah urusannya selesai → [DIAM].' + JUJUR;
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
  assert.ok(konteksLead({ segmen: 'eo_wo' }).includes('JUJUR'));
  assert.strictEqual(tanpaAngka('Paket 3 jam Rp 2.500.000. Rekanan dapat 10%.'), 'Paket 3 jam Rp 2.500.000. Rekanan dapat 10%.');
  assert.strictEqual(tanpaAngka('Bisa 15% kok. Kabari ya.'), 'Kabari ya.');
  assert.strictEqual(konteksLead(null), '');
  console.log('UJI PROSPEK WA LOLOS');
}
