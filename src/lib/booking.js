// Tahap setelah DP: kirim form data acara lengkap sekali (Rama 11 Nov), teruskan bukti
// transfer & rekap ke admin untuk diinput ke Tetra Ops, dan ingatkan berkala
// sampai lengkap. Keputusan Rama 27 Sep 2026.
//
// Pemicu: klien kirim bukti transfer (gambar/dokumen setelah obrolan soal DP),
// atau admin menulis konfirmasi DP secara manual ("DP sudah kami terima").
// Bot TIDAK pernah memverifikasi pembayaran; itu tetap tugas admin.
const path = require('path');
const fs = require('fs');

const live = require('./liveConfig');
const { loadJson, saveJson, tambahRiwayat, nomorDari } = require('./store');
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
  // Rama 11 Nov: nama layanan wajib tertulis (Photobooth / Videobooth 360 / Photo Stage / Magazine Box) + durasi, supaya tidak rancu.
  ['paket', 'Paket (nama layanan + durasi, mis. Photobooth Unlimited 3 jam)', true],
  // Event multi-unit (2–3 booth di satu acara). Kosong = 1 unit; tidak ditanyakan.
  ['jumlah_unit', 'Jumlah unit', false],
  ['jumlah_tamu', 'Perkiraan jumlah tamu', false],
  ['pic', 'PIC hari H (nama & no. HP)', true],
  ['kontak_wo', 'Kontak WO/EO', false],
  ['instagram', 'Instagram', false],
  ['ukuran_frame', 'Ukuran frame', true],
  ['orientasi', 'Orientasi frame', false],
  ['desain_frame', 'Desain frame', true],
  // Rama 11 Nov: teks frame dipisah. Nama di frame = inisial/nama panggilan yang dicetak (bukan nama lengkap di atas).
  ['nama_frame', 'Nama/inisial yang dicetak di frame (bukan nama lengkap, mis. D & R)', false],
  ['tanggal_frame', 'Tanggal yang dicetak di frame', false],
  ['hashtag', 'Hashtag acara', false],
  ['teks_frame', 'Teks lain di frame', false],
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

// Form untuk klien, format form admin Tetra (Rama 11 Nov: "langsung aja: kaka tolong dibantu untuk melengkapi form berikut yaa",
// bukan ditanya dicicil). Yang sudah diketahui langsung terisi supaya klien tinggal cek.
// Satu sumber baris form: dipakai form data sistem (teksForm) DAN penjaga form susunan Hermes (semua label + nilai asli wajib ada).
function barisForm(b) {
  const w = isWedding(b);
  const d = b.data;
  const r = (bagian, label, asli, petunjuk = '') => ({ bagian, label, asli: asli ? String(asli) : '', nilai: asli ? String(asli) : petunjuk });
  return [
    r(1, w ? 'Nama Pengantin' : 'Nama Acara / Instansi', d.nama_acara),
    r(1, 'Tanggal Event', d.tanggal),
    r(1, 'Jam Photobooth', d.jam),
    r(1, 'Lokasi Event', d.lokasi),
    r(1, 'Link Google Maps', d.maps),
    r(1, 'Paket yang Dipilih', d.paket),
    ...(teksUnit(d) ? [r(1, 'Jumlah Unit', teksUnit(d))] : []),
    r(1, 'Perkiraan Jumlah Tamu', d.jumlah_tamu),
    r(1, 'No. Kontak PIC / WO di hari H', d.pic || d.kontak_wo),
    r(1, w ? 'Instagram Pengantin' : 'Instagram Acara (opsional)', d.instagram),
    r(2, 'Ukuran Frame', d.ukuran_frame, '2R / 4R / Polaroid (lihat gambar perbandingan ukurannya di bawah)'),
    r(2, 'Desain', d.desain_frame, 'pilih dari katalog di bawah, atau custom'),
    r(2, 'Nama / Inisial di Frame', d.nama_frame),
    r(2, 'Tanggal di Frame', d.tanggal_frame),
    r(2, 'Hashtag', d.hashtag),
    r(3, 'Backdrop', d.backdrop, 'pilih warna backdrop basic (compliment free dari kami, lihat gambar di bawah) atau pakai dekorasi sendiri'),
  ];
}

// Badan form saja (label & isian dari data sistem): ditempel di posisi [KIRIM: form] tulisan cs-wa (kontrak Hermes t_d063ba1a).
function badanForm(b) {
  const baris = barisForm(b);
  const bagian = (n) => baris.filter((x) => x.bagian === n).map((x) => `- ${x.label}: ${x.nilai}`.trimEnd());
  return ['1. Data Event', ...bagian(1), '', '2. Frame Foto', ...bagian(2), '', '3. Backdrop', ...bagian(3)].join('\n');
}
function teksForm(b, pembuka) {
  return [
    ...(pembuka ? [pembuka, ''] : []),
    // Wajib Hermes (Rama 16 Nov): permintaan mengisi form sudah ada di pembuka tulisan Hermes.
    ...(pembuka && process.env.AI_OTAK === 'hermes' ? [] : ['Kak, tolong dibantu untuk melengkapi form berikut yaa.', '']),
    badanForm(b),
  ].join('\n');
}

// Setelah data wajib lengkap (dari form atau chat), rekap dikirim ke klien untuk dicek ulang (Rama 22 Okt).
function barisRekap(b) {
  return FIELD.filter(([k]) => b.data[k] && (k !== 'jumlah_unit' || teksUnit(b.data)))
    .map(([k, label]) => ({ label, nilai: String(k === 'jumlah_unit' ? teksUnit(b.data) : b.data[k]) }));
}
function teksKonfirmasi(b, pembuka = null) {
  const isi = barisRekap(b).map((x) => `• ${x.label}: ${x.nilai}`);
  if (pembuka) return [pembuka, '', ...isi].join('\n');
  return ['Ini rekap data acaranya ya Kak, tolong dicek lagi:', '', ...isi, '',
    'Kalau sudah benar, balas "oke" ya. Kalau ada yang salah atau mau diubah, langsung koreksi di sini aja.'].join('\n');
}
// Kirim rekap ke klien SEKALI, saat data wajib pertama kali lengkap. Perubahan sesudahnya cukup dilapor ke admin.
// buatPembuka: fungsi async opsional (tulisan Hermes), dipanggil hanya kalau rekap memang dikirim.
async function kirimKonfirmasi(sock, jid, buatPembuka = null) {
  const b = semua[jid];
  if (!b || !b.lengkap || b.dikonfirmasi) return false;
  b.dikonfirmasi = Date.now();
  simpan();
  // buatPembuka (wajib Hermes) mengembalikan rekap utuh susunan Hermes; gagal → rekap data sistem.
  const teksH = buatPembuka ? await buatPembuka(b).catch(() => null) : null;
  await kirimTeks(sock, jid, teksH || teksKonfirmasi(b), 'rekap-booking→customer');
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

async function kirimKatalog(sock, jid, buatPembuka = null) {
  if (!fs.existsSync(KATALOG)) { console.error('[booking] katalog tidak ada:', KATALOG); return; }
  const pengantar = buatPembuka ? await buatPembuka().catch(() => null) : null;
  const caption = pengantar || (process.env.AI_OTAK === 'hermes' ? '' : CAPTION_KATALOG);
  const sent = await sendDocument(sock, jid, KATALOG, caption);
  rememberBotMsg(sent);
  deliveryLog.track(sent, 'katalog→customer');
  tambahRiwayat(jid, 'assistant', `[kirim PDF katalog desain frame]\n${caption}`);
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
  // Hanya kunci yang terisi (Hermes t_8843a9c1: null tidak boleh menimpa data yang sudah ada di Tetra Ops) + jenis acara.
  const data = {};
  for (const k of [...FIELD.map(([x]) => x), 'tanggal_iso']) if (b.data[k]) data[k] = b.data[k];
  if (b.jenis) data.jenis = b.jenis;
  const body = {
    external_id: `wa:${jid}:${b.mulai}`,
    wa_jid: jid,
    client_wa: nomorDari(jid), // nomor HP asli (LID dipetakan), null kalau belum diketahui — bukan digit LID
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
  // 18 Nov: cara menanggapi tahap booking ada di skill Hermes mode-kontak-khusus; Node hanya fakta.
  return `\n\nTAHAP BOOKING: klien sudah DP; form data sudah dikirim.\nSudah terisi: ${terisi || '-'}\n` +
    (b.dikonfirmasi && Date.now() - b.dikonfirmasi < 5 * 60e3 ? 'REKAP DATA BARU SAJA DIKIRIM ke klien (≤ 5 menit lalu).\n' : '') +
    (k.length ? `Masih kosong: ${k.map((x) => x.label).join(', ')}.` : 'Data wajib sudah lengkap.');
}

module.exports = {
  barisForm, barisRekap, isWedding,
  FIELD, get, aktif, kurang, mulai, perbarui, teksForm, badanForm, teksKonfirmasi, kirimKonfirmasi, kirimTeks, kirimKatalog,
  teruskanKeAdmin, laporAdmin, laporBilaBerubah, konteksAI, teksRekap, sinkronOps,
  semua: () => semua, simpan,
};
