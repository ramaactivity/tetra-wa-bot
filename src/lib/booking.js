// Tahap setelah DP: kumpulkan data acara (boleh dicicil klien), teruskan bukti
// transfer & rekap ke admin untuk diinput ke Tetra Ops, dan ingatkan berkala
// sampai lengkap. Keputusan Rama 27 Sep 2026.
//
// Pemicu: klien kirim bukti transfer (gambar/dokumen setelah obrolan soal DP),
// atau admin menulis konfirmasi DP secara manual ("DP sudah kami terima").
// Bot TIDAK pernah memverifikasi pembayaran; itu tetap tugas admin.
const path = require('path');
const fs = require('fs');

const live = require('./liveConfig');
const { loadJson, saveJson, tambahRiwayat, getRiwayat } = require('./store');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');
const { sendDocument } = require('./sender');
const { postOps, opsBase } = require('./availability');

const FILE = path.join(__dirname, '..', '..', 'data', 'booking.json');
const KATALOG = path.join(__dirname, '..', '..', 'assets', 'KATALOG DESAIN FRAME TETRA.pdf');
const semua = loadJson(FILE); // jid -> { mulai, sumber, nama, phone, data, lengkap, dilapor, terakhirTanya, h3 }
const simpan = () => saveJson(FILE, semua);

// [kunci, label ke admin, wajib]. Wajib = yang dibutuhkan untuk input Tetra Ops
// dan kerja crew; sisanya membantu tapi tidak menahan status "lengkap".
const FIELD = [
  ['nama_acara', 'Nama pengantin / acara', true],
  ['tanggal', 'Tanggal acara', true],
  ['jam', 'Jam photobooth', true],
  ['lokasi', 'Lokasi / venue', true],
  ['maps', 'Link Google Maps', false],
  ['paket', 'Paket', true],
  // Event multi-unit (2–3 booth di satu acara). Kosong = 1 unit; tidak ditanyakan.
  ['jumlah_unit', 'Jumlah unit', false],
  ['jumlah_tamu', 'Perkiraan jumlah tamu', false],
  ['pic', 'PIC hari H (nama & no. HP)', true],
  ['kontak_wo', 'Kontak WO/EO', false],
  ['instagram', 'Instagram', false],
  ['ukuran_frame', 'Ukuran frame', true],
  ['orientasi', 'Orientasi frame', false],
  ['desain_frame', 'Desain frame', true],
  ['teks_frame', 'Teks di frame', false],
  ['backdrop', 'Backdrop', true],
  ['catatan', 'Catatan lain', false],
];

const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

function get(jid) { return semua[jid] || null; }

// Aktif = sudah DP dan acaranya belum lewat.
function aktif(jid) {
  const b = semua[jid];
  return !!b && !(b.data.tanggal_iso && b.data.tanggal_iso < hariIni());
}

function kurang(b) {
  return FIELD.filter(([k, , wajib]) => wajib && !b.data[k]).map(([k, label]) => ({ k, label }));
}

function mulai(jid, sumber, nama, phone) {
  if (semua[jid]) return semua[jid];
  semua[jid] = { mulai: Date.now(), sumber, nama, phone, data: {}, lengkap: false, dilapor: '', terakhirTanya: Date.now() };
  simpan();
  console.log(`[booking] ${jid.split('@')[0]}: tahap booking dimulai (${sumber})`);
  return semua[jid];
}

// Gabung hasil ekstraksi; nilai kosong tidak menimpa yang sudah ada.
function perbarui(jid, baru) {
  const b = semua[jid];
  if (!b || !baru) return b;
  for (const [k, v] of Object.entries(baru)) {
    if (v !== null && v !== undefined && String(v).trim() !== '') b.data[k] = String(v).trim();
  }
  b.lengkap = kurang(b).length === 0;
  simpan();
  return b;
}

// Teks jumlah unit untuk rekap: '' kalau kosong/1 unit, supaya rekap biasa tidak berubah.
function teksUnit(d) {
  const n = parseInt(String(d.jumlah_unit || '').match(/\d+/)?.[0], 10);
  if (!d.jumlah_unit || n === 1) return '';
  return n ? `${n} (${n} spot photobooth)` : d.jumlah_unit;
}
const isWedding = (b) => /wedding|nikah|pengantin|resepsi|akad|lamaran|engagement/i.test(`${b.data.nama_acara || ''} ${b.data.catatan || ''} ${b.jenis || ''}`);

// Form untuk klien. Yang sudah diketahui langsung terisi supaya klien tinggal cek.
function teksForm(b, pembuka) {
  const w = isWedding(b);
  const d = b.data;
  const baris = (label, v) => `• ${label}: ${v || ''}`.trimEnd();
  return [
    pembuka,
    '',
    'Biar tim Tetra bisa siapin semuanya, bantu lengkapi data acaranya ya Kak. Boleh dicicil, nggak harus sekaligus. Yang sudah aku tahu sudah aku isi, tinggal dicek.',
    '',
    '*1. Data acara*',
    baris(w ? 'Nama pengantin' : 'Nama acara / instansi', d.nama_acara),
    baris('Tanggal', d.tanggal),
    baris('Jam photobooth', d.jam),
    baris('Lokasi + link Google Maps', [d.lokasi, d.maps].filter(Boolean).join(' ')),
    baris('Paket', d.paket),
    ...(teksUnit(d) ? [baris('Jumlah unit', teksUnit(d))] : []),
    baris('Perkiraan jumlah tamu', d.jumlah_tamu),
    baris('PIC di hari H (nama & no. HP)', d.pic),
    baris('Kontak WO/EO (kalau ada)', d.kontak_wo),
    baris(w ? 'Instagram pengantin' : 'Instagram acara (opsional)', d.instagram),
    '',
    '*2. Frame foto*',
    baris('Ukuran', d.ukuran_frame || '2R photostrip / 4R / Polaroid'),
    baris('Orientasi', d.orientasi || 'portrait / landscape'),
    baris('Desain', d.desain_frame || 'pilih dari katalog di bawah, atau custom'),
    baris('Teks di frame (nama, tanggal, hashtag)', d.teks_frame),
    '',
    '*3. Backdrop*',
    baris('Pilihan', d.backdrop || 'basic Tetra (White/Red/Silver/Gold/Emerald Green/Blue) atau dekorasi acara'),
    '',
    'Kalau lebih enak ngobrol daripada ngisi, santai aja Kak, nanti aku tanyain pelan-pelan.',
  ].join('\n');
}

// Setelah data wajib lengkap (dari form atau digali bertahap), rekap dikirim ke klien untuk dicek ulang (Rama 22 Okt).
function teksKonfirmasi(b) {
  const isi = FIELD.filter(([k]) => b.data[k] && (k !== 'jumlah_unit' || teksUnit(b.data)))
    .map(([k, label]) => `• ${label}: ${k === 'jumlah_unit' ? teksUnit(b.data) : b.data[k]}`);
  return ['Ini rekap data acaranya ya Kak, tolong dicek lagi:', '', ...isi, '',
    'Kalau sudah benar, balas "oke" ya. Kalau ada yang salah atau mau diubah, langsung koreksi di sini aja.'].join('\n');
}
// Kirim rekap ke klien SEKALI, saat data wajib pertama kali lengkap. Perubahan sesudahnya cukup dilapor ke admin.
async function kirimKonfirmasi(sock, jid) {
  const b = semua[jid];
  if (!b || !b.lengkap || b.dikonfirmasi) return false;
  b.dikonfirmasi = Date.now();
  simpan();
  await kirimTeks(sock, jid, teksKonfirmasi(b), 'rekap-booking→customer');
  return true;
}
const CAPTION_KATALOG =
  'Ini katalog desain frame Tetra. Tinggal screenshot yang Kak suka atau sebut halamannya.\n\n' +
  'Belum ada yang cocok? Desain custom juga bisa, gratis. Kirim aja brief atau contoh desainnya.';

async function kirimTeks(sock, jid, teks, label) {
  const sent = await sock.sendMessage(jid, { text: teks });
  rememberBotMsg(sent);
  deliveryLog.track(sent, label);
  tambahRiwayat(jid, 'assistant', teks);
}

async function kirimKatalog(sock, jid) {
  if (!fs.existsSync(KATALOG)) { console.error('[booking] katalog tidak ada:', KATALOG); return; }
  const sent = await sendDocument(sock, jid, KATALOG, CAPTION_KATALOG);
  rememberBotMsg(sent);
  deliveryLog.track(sent, 'katalog→customer');
  tambahRiwayat(jid, 'assistant', `[kirim PDF katalog desain frame]\n${CAPTION_KATALOG}`);
}

// Teruskan pesan asli klien (mis. foto bukti transfer) ke admin.
async function teruskanKeAdmin(sock, msg) {
  const adminJid = live.get().ADMIN_NOTIFY_JID;
  if (!adminJid) return;
  const sent = await sock.sendMessage(adminJid, { forward: msg });
  rememberBotMsg(sent);
}

// Kirim ke "Booking Masuk" Tetra Ops (POST /api/bot/booking, idempoten per
// external_id). Hanya kalau isinya berubah sejak kiriman terakhir. Gagal = dicatat,
// tidak menghentikan alur ke klien; kiriman berikutnya mencoba lagi.
async function sinkronOps(jid) {
  const b = semua[jid];
  if (!b) return;
  const data = {};
  for (const [k] of FIELD) data[k] = b.data[k] || null;
  data.tanggal_iso = b.data.tanggal_iso || null;
  const body = {
    external_id: `wa:${jid}:${b.mulai}`,
    wa_jid: jid,
    client_wa: /^\d{8,15}$/.test(String(b.phone || '')) ? String(b.phone) : null,
    client_name: b.nama || null,
    sumber: b.sumber === 'admin' ? 'admin' : 'bukti-transfer',
    dp_dilaporkan_at: new Date(b.mulai).toISOString(),
    bukti_url: null,
    lengkap: !!b.lengkap,
    data,
  };
  const kunci = JSON.stringify(body);
  if (b.disinkron === kunci) return;
  const r = await postOps('/api/bot/booking', body);
  if (!r.ok) {
    console.error(`[booking→ops] ${jid.split('@')[0]}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    return;
  }
  const url = String(r.json.url || '');
  b.opsUrl = url.startsWith('/') ? opsBase() + url : url || b.opsUrl;
  b.disinkron = kunci;
  simpan();
  console.log(`[booking→ops] ${jid.split('@')[0]}: ${r.json.status || 'ok'} ${b.opsUrl || ''}`);
}

// Rekap siap-input Tetra Ops. `judul` menjelaskan kenapa dikirim sekarang.
function teksRekap(jid, judul) {
  const b = semua[jid];
  const num = String(b.phone || jid).split('@')[0];
  const isi = FIELD.filter(([k]) => k !== 'jumlah_unit' || teksUnit(b.data))
    .map(([k, label]) => `${label}: ${k === 'jumlah_unit' ? teksUnit(b.data) : b.data[k] || '-'}`);
  const k = kurang(b);
  return [
    `📋 *${judul}*`,
    `Klien: ${b.nama || 'Tanpa nama'} — wa.me/${num}`,
    `DP: bukti ${b.sumber === 'admin' ? 'dikonfirmasi admin' : 'dikirim klien'} ${new Date(b.mulai).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
    '',
    ...isi,
    '',
    k.length ? `⏳ Belum diisi: ${k.map((x) => x.label).join(', ')}` : '✅ Data wajib lengkap — siap input ke Tetra Ops.',
  ].join('\n') + (b.opsUrl ? `\n\nBuka di Booking Masuk: ${b.opsUrl}` : '');
}

async function laporAdmin(sock, jid, judul) {
  const adminJid = live.get().ADMIN_NOTIFY_JID;
  if (!adminJid || !semua[jid]) return;
  const sent = await sock.sendMessage(adminJid, { text: teksRekap(jid, judul) });
  rememberBotMsg(sent);
  deliveryLog.track(sent, 'booking→admin');
  // DP masuk / dikonfirmasi → juga ke grup admin (Rama 8 Okt). Rekap data biasa tidak.
  const notify = require('./notify'); // di dalam fungsi: hindari require melingkar
  if (notify.RE_GRUP?.test(judul) && notify.kirimGrupAdmin) await notify.kirimGrupAdmin(sock, teksRekap(jid, judul));
  semua[jid].dilapor = JSON.stringify(semua[jid].data);
  simpan();
}

// Setelah data berubah: lapor saat pertama kali lengkap, dan tiap ada perubahan
// sesudahnya (jam/lokasi bisa berubah) supaya Tetra Ops ikut diperbarui.
async function laporBilaBerubah(sock, jid, sebelumLengkap) {
  const b = semua[jid];
  if (!b || !b.lengkap || b.dilapor === JSON.stringify(b.data)) return;
  await laporAdmin(sock, jid, sebelumLengkap ? 'Update data booking' : 'Data booking lengkap');
}

// Konteks untuk AI balasan: apa yang sudah terisi & yang masih perlu ditanya.
function konteksAI(jid) {
  const b = semua[jid];
  if (!b || !aktif(jid)) return '';
  const k = kurang(b);
  const terisi = FIELD.filter(([key]) => b.data[key]).map(([key, label]) => `${label}=${b.data[key]}`).join('; ');
  return `\n\nTAHAP BOOKING (klien sudah DP; verifikasi & invoice tetap dari admin). Form data sudah dikirim; kalau klien tidak mengisi, gali bertahap lewat obrolan.\n` +
    `Sudah terisi: ${terisi || '-'}\n` +
    (b.dikonfirmasi && Date.now() - b.dikonfirmasi < 5 * 60e3
      ? 'Rekap data barusan dikirim ke klien untuk dicek: JANGAN kirim rekap/daftar lagi; tanggapi pesannya singkat saja.\n' : '') +
    (k.length
      ? `Masih kurang: ${k.map((x) => x.label).join(', ')}. Kalau pas, tanyakan maks 2 yang kurang secara natural. Jangan kirim ulang form lengkap.`
      : 'Data wajib sudah lengkap. Cukup konfirmasi kalau klien mengubah sesuatu.');
}

// Riwayat pendek untuk ekstraksi (pesan terbaru paling relevan).
const riwayatUntukEkstrak = (jid) => getRiwayat(jid).slice(-16);

module.exports = {
  FIELD, get, aktif, kurang, mulai, perbarui, teksForm, teksKonfirmasi, kirimKonfirmasi, kirimTeks, kirimKatalog,
  teruskanKeAdmin, laporAdmin, laporBilaBerubah, konteksAI, riwayatUntukEkstrak, teksRekap, sinkronOps,
  semua: () => semua, simpan,
};
