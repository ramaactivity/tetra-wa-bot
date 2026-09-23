// Enrichment lead untuk statistik: ubah pesan mentah → dimensi terstruktur
// (topik/intent, segmen, jenis acara, lokasi, tanggal acara, periode bulan).
// SEMUA nilai diturunkan dari teks pesan secara deterministik — tidak ada yang
// dikarang. Dipakai oleh sync_sheet.js (backfill) dan sheetSync (live).
const { parseLeadDetails, toISODate, detectSegment, detectCity } = require('./smartLead');
const base = require('../../config');

// ── Topik / intent ──────────────────────────────────────────────────────────
// Klasifikasi untuk STATISTIK (bukan urutan balasan). Intent komersial didahulukan
// supaya "minta pricelist ... tanggal X" terbaca pricelist (bukan booking karena
// kata "tanggal"), dan "berapa jam" terbaca durasi (bukan pricelist karena "berapa").
const GREET_WORDS = /^(halo+|hai+|hi+|hallo+|haloo+|hii+|assalamu\w*|assalamualaikum|selamat\s+(pagi|siang|sore|malam)|pagi|siang|sore|malam|permisi|punten|test|tes|ping|p)$/i;
const HONORIFICS = /\b(kak|min|admin|gan|bro|mas|mba|pak|bu|tetra|sis)\b/gi;

function isGreetingOnly(t) {
  const s = (t || '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(HONORIFICS, '')
    .trim()
    .toLowerCase();
  return GREET_WORDS.test(s);
}

const TOPIC_PRIORITY = ['dp', 'durasi', 'pricelist', 'booking'];

function classifyTopik(message) {
  const t = (message || '').trim().toLowerCase();
  if (!t) return 'lead';
  const rules = base.RULES || [];
  const byName = (n) => rules.find((r) => r.name === n);
  const ordered = [
    ...TOPIC_PRIORITY.map(byName).filter(Boolean),
    ...rules.filter((r) => !TOPIC_PRIORITY.includes(r.name)),
  ];
  for (const r of ordered) {
    const kw = r.keywords || [];
    if (kw.some((k) => t.includes(String(k).toLowerCase()))) return r.name;
  }
  if (isGreetingOnly(t)) return 'sapa';
  return 'lead';
}

// ── Label segmen (Indonesia) ────────────────────────────────────────────────
const SEGMENT_LABEL = {
  private: 'Pribadi',
  corporate: 'Corporate',
  instansi: 'Instansi',
  eo_wo: 'EO/WO',
  venue: 'Venue',
  osis: 'OSIS',
  bem: 'BEM',
  sekolah: 'Sekolah',
  kampus: 'Kampus',
};

// ── Normalisasi jenis acara ─────────────────────────────────────────────────
const EVENT_LABEL = {
  wedding: 'Wedding', pernikahan: 'Wedding', nikahan: 'Wedding', nikah: 'Wedding',
  akad: 'Wedding', resepsi: 'Wedding', pemberkatan: 'Wedding', prewedding: 'Wedding',
  prewed: 'Wedding', weeding: 'Wedding', weding: 'Wedding', 'intimate wedding': 'Wedding',
  lamaran: 'Lamaran', tunangan: 'Lamaran', engagement: 'Lamaran',
  'ulang tahun': 'Ulang Tahun', ultah: 'Ulang Tahun', birthday: 'Ulang Tahun',
  ulangtahun: 'Ulang Tahun', 'sweet seventeen': 'Ulang Tahun', 'sweet 17': 'Ulang Tahun',
  'sweet 17th': 'Ulang Tahun', '17 an': 'Ulang Tahun', '17an': 'Ulang Tahun',
  wisuda: 'Wisuda', graduation: 'Wisuda', kelulusan: 'Wisuda',
  'acara kampus': 'Kampus', kampus: 'Kampus', ospek: 'Kampus', himpunan: 'Kampus',
  fakultas: 'Kampus', universitas: 'Kampus', 'prom night': 'Sekolah', sekolah: 'Sekolah',
  gathering: 'Corporate', corporate: 'Corporate', kantor: 'Corporate',
  perusahaan: 'Corporate', company: 'Corporate', employee: 'Corporate',
  outing: 'Corporate', 'family gathering': 'Corporate',
  peresmian: 'Grand Opening', 'grand opening': 'Grand Opening', launching: 'Grand Opening',
  opening: 'Grand Opening', 'soft opening': 'Grand Opening', pembukaan: 'Grand Opening',
  festival: 'Festival/Bazaar', bazaar: 'Festival/Bazaar', bazar: 'Festival/Bazaar',
  expo: 'Festival/Bazaar', pameran: 'Festival/Bazaar', exhibition: 'Festival/Bazaar',
  'car free day': 'Festival/Bazaar',
  reuni: 'Reuni', reunion: 'Reuni',
  khitan: 'Khitan/Aqiqah', sunat: 'Khitan/Aqiqah', aqiqah: 'Khitan/Aqiqah',
  tasyakuran: 'Tasyakuran', syukuran: 'Tasyakuran', tasyakkuran: 'Tasyakuran',
  akikah: 'Tasyakuran',
  'gala dinner': 'Gala/Awarding', gala: 'Gala/Awarding', awarding: 'Gala/Awarding',
  anniversary: 'Gala/Awarding', 'annual meeting': 'Gala/Awarding',
  arisan: 'Sosial', pengajian: 'Sosial', seminar: 'Seminar/Workshop',
  workshop: 'Seminar/Workshop',
};

function normalizeEvent(raw) {
  if (!raw) return 'Lainnya';
  const key = String(raw).toLowerCase().replace(/\s+/g, ' ').trim();
  return EVENT_LABEL[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Normalisasi lokasi: form field bisa berisi nama venue ("Hotel Luminor Bogor")
// bukan nama kota. Coba ekstrak kota; kalau tak ada, pakai teks mentah (rapikan).
function cleanLokasi(det, msg) {
  const raw = det.lokasi;
  if (!raw) return 'Lainnya';
  const city = detectCity(raw) || detectCity(msg);
  if (city) return capitalize(city);
  let s = String(raw).split('(')[0].replace(/[.,;]+$/, '').trim();
  if (s.length > 25) s = s.slice(0, 25).trim() + '…';
  return s ? capitalize(s) : 'Lainnya';
}

// ── Waktu WIB ───────────────────────────────────────────────────────────────
const WIB_OFFSET_MS = 7 * 3600 * 1000;
const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const pad2 = (n) => String(n).padStart(2, '0');

function wibDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + WIB_OFFSET_MS);
}

// ── Entry utama ─────────────────────────────────────────────────────────────
// row: { wa_jid, phone, name, topic, message, created_at, ... }
// → objek terstruktur siap tulis ke Sheet.
function enrich(row) {
  const msg = row.message || '';
  const det = parseLeadDetails(msg);
  const seg = detectSegment(msg);
  const topik = classifyTopik(msg);

  const created = wibDate(row.created_at || row.received_at);
  const tahun = created ? created.getFullYear() : null;
  const bulan = created ? created.getMonth() + 1 : null;
  const bulanLabel = created && tahun
    ? `${MONTHS_ID[created.getMonth()]} ${tahun}`
    : '';

  const eventIso = toISODate(det.tanggal);

  return {
    tanggal: created ? `${created.getFullYear()}-${pad2(created.getMonth() + 1)}-${pad2(created.getDate())}` : '',
    waktu: created ? `${pad2(created.getHours())}:${pad2(created.getMinutes())}` : '',
    nama: row.name || 'Klien',
    nomor: row.phone || '',
    topik,
    segmen: SEGMENT_LABEL[seg.segment] || 'Pribadi',
    kategori: normalizeEvent(det.jenisAcara),
    lokasi: cleanLokasi(det, msg),
    tanggal_acara: eventIso || '',
    pesan: msg,
    tahun: tahun ?? '',
    bulan: bulan ?? '',
    bulanLabel,
  };
}

// Susun sebagai array baris (13 kolom) sesuai urutan tab Database.
function toRow(e) {
  return [
    e.tanggal, e.waktu, e.nama, e.nomor, e.topik, e.segmen, e.kategori,
    e.lokasi, e.tanggal_acara, e.pesan, e.tahun, e.bulan, e.bulanLabel,
  ];
}

module.exports = { enrich, toRow, classifyTopik, normalizeEvent, SEGMENT_LABEL };
