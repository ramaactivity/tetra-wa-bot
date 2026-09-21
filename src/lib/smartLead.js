// Otak alur "Smart Lead" (gated, deterministik — tanpa AI):
//  - parse detail acara (jenis / tanggal / lokasi) dari form website maupun chat bebas
//  - deteksi frasa "nolak ngasih detail" (cuma mau cek harga) -> langsung PL
//  - rakit pertanyaan gerbang (tanya yang kurang) & balasan kirim PL
const base = require('../../config');
const { hasSalam, isWithinBusinessHours } = require('./rules');
const live = require('./liveConfig');

// ---------- deteksi jenis acara (echo natural kata yang dipakai klien) ----------
const EVENT_PATTERNS = [
  /\b(wedding|pernikahan|nikahan|nikah|akad|resepsi|pemberkatan|prewedding|prewed)\b/i,
  /\b(lamaran|tunangan|engagement)\b/i,
  /\b(ulang\s*tahun|ultah|birthday|sweet\s*seventeen|sweet\s*17)\b/i,
  /\b(wisuda|graduation|kelulusan)\b/i,
  /\b(acara\s*kampus|kampus|ospek|himpunan|fakultas|universitas|sekolah|prom\s*night)\b/i,
  /\b(gathering|corporate|kantor|perusahaan|company|employee|outing|family\s*gathering)\b/i,
  /\b(peresmian|grand\s*opening|launching|opening|soft\s*opening|pembukaan)\b/i,
  /\b(festival|bazaar|bazar|expo|pameran|exhibition|car\s*free\s*day)\b/i,
  /\b(reuni|reunion)\b/i,
  /\b(khitan|sunat|aqiqah|tasyakuran|syukuran|tasyakkuran|akikah)\b/i,
  /\b(gala\s*dinner|gala|awarding|anniversary|annual\s*meeting)\b/i,
  /\b(arisan|pengajian|seminar|workshop)\b/i,
];

function detectEvent(text) {
  for (const re of EVENT_PATTERNS) {
    const m = text.match(re);
    if (m) return (m[1] || m[0]).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  return null;
}

// ---------- deteksi kota/lokasi ----------
const CITIES = [
  'jakarta', 'jaksel', 'jakpus', 'jaktim', 'jakbar', 'jakut', 'bogor', 'depok',
  'tangerang', 'tangsel', 'bsd', 'serpong', 'bintaro', 'bekasi', 'cikarang',
  'bandung', 'cimahi', 'cibubur', 'sentul', 'sukabumi', 'cianjur', 'karawang',
  'purwakarta', 'cilegon', 'serang', 'garut', 'tasik', 'tasikmalaya', 'cirebon',
  'bali', 'surabaya', 'semarang', 'yogyakarta', 'jogja', 'jogjakarta', 'solo',
  'malang', 'puncak', 'gadog', 'cikampek', 'lampung', 'medan', 'makassar',
];

function detectCity(text) {
  const low = text.toLowerCase();
  for (const c of CITIES) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(low)) {
      return c.charAt(0).toUpperCase() + c.slice(1);
    }
  }
  return null;
}

// ---------- deteksi tanggal ----------
// Bulan lengkap dipakai sendiri; singkatan HANYA dihitung kalau ada angka tanggal
// di depannya (biar nama orang spt "Agus" / kata spt "Resepsi" tidak kebaca tanggal).
const FULL_MONTHS = 'januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember';
const ABBR_MONTHS = 'jan|feb|mar|apr|jun|jul|agt|agus|agst|agu|sept|sep|okt|nov|des';

function detectDate(text) {
  let m = text.match(new RegExp(`(\\b\\d{1,2}\\s+)?\\b(${FULL_MONTHS})\\b(\\.?\\s*\\d{2,4})?`, 'i'));
  if (m && m[0].trim()) return m[0].replace(/\s+/g, ' ').trim();
  m = text.match(new RegExp(`\\b\\d{1,2}\\s*(${ABBR_MONTHS})\\b(\\.?\\s*\\d{2,4})?`, 'i'));
  if (m) return m[0].replace(/\s+/g, ' ').trim();
  m = text.match(/\b(\d{1,2})[/\-.](\d{1,2})([/\-.]\d{2,4})?\b/);
  if (m) return m[0];
  return null;
}

// ---------- normalisasi untuk cek ketersediaan (endpoint Tetra Ops) ----------
// Peta nama bulan (lengkap + singkatan) → angka. Dipakai mengubah teks tanggal
// klien ("11 juli") menjadi format ISO yang dipahami endpoint.
const MONTH_NUM = {
  januari: 1, jan: 1, februari: 2, feb: 2, pebruari: 2, maret: 3, mar: 3,
  april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  agustus: 8, agt: 8, agus: 8, agst: 8, agu: 8, ags: 8,
  september: 9, sept: 9, sep: 9, oktober: 10, okt: 10,
  november: 11, nov: 11, desember: 12, des: 12,
};
const pad2 = (n) => String(n).padStart(2, '0');

// Ubah teks tanggal bebas → 'YYYY-MM-DD', atau null kalau tak terbaca.
// Tahun: pakai yang ditulis klien; kalau tak ada → tahun ref, tapi kalau
// tanggalnya sudah lewat dibanding ref, naik ke tahun berikutnya.
function toISODate(raw, ref = new Date()) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  let day, mon, year;
  let m = s.match(/\b(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{2,4}))?/);
  if (m && MONTH_NUM[m[2]]) {
    day = +m[1];
    mon = MONTH_NUM[m[2]];
    if (m[3]) year = +m[3];
  } else {
    m = s.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?/);
    if (m) {
      day = +m[1];
      mon = +m[2];
      if (m[3]) year = +m[3];
    }
  }
  if (!day || !mon || mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  if (year != null && year < 100) year += 2000;
  if (year == null) {
    year = ref.getFullYear();
    const cand = new Date(year, mon - 1, day);
    const refDay = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    if (cand < refDay) year += 1; // tanggal sudah lewat tahun ini → tahun depan
  }
  // Tolak tanggal yang tak nyata (mis. 30 Feb, 31 Apr).
  const dt = new Date(year, mon - 1, day);
  if (dt.getMonth() !== mon - 1 || dt.getDate() !== day) return null;
  return `${year}-${pad2(mon)}-${pad2(day)}`;
}

// Ubah teks jam bebas → { start:'HH:mm', end:'HH:mm' }, atau null.
// Konservatif: butuh RENTANG (mulai & selesai). Format jam tunggal ("jam 11")
// sengaja tak diterima karena durasi belum tentu diketahui.
function parseJamRange(text) {
  if (!text) return null;
  const s = String(text).toLowerCase();
  const SEP = '(?:\\s*(?:-|–|—|s\\/?d\\.?|sampai|smp|hingga|ke)\\s*)';
  // 11.00-13.00 / 11:00 – 13:00 / 11.00 s/d 13.00
  let m = s.match(new RegExp(`\\b(\\d{1,2})[.:](\\d{2})${SEP}(\\d{1,2})[.:](\\d{2})`));
  if (m) return { start: `${pad2(+m[1])}:${m[2]}`, end: `${pad2(+m[3])}:${m[4]}` };
  // jam 11-13 / jam 11 sampai 13 (butuh kata "jam" agar tak salah baca angka lain)
  m = s.match(new RegExp(`jam\\s*(\\d{1,2})${SEP}(\\d{1,2})\\b`));
  if (m) return { start: `${pad2(+m[1])}:00`, end: `${pad2(+m[2])}:00` };
  return null;
}

// Nilai field form yang dianggap "kosong" (belum diisi sungguhan).
function isEmptyVal(v) {
  if (!v) return true;
  const t = v.trim();
  return (
    /^(belum|tba|nanti|menyusul|tentatif|tentative|-+|\?+|tdk|tidak\s*tahu|gatau|ga\s*tau|na|n\/a)$/i.test(t) ||
    /belum\s*(tahu|tau|fix|ada|pasti|tentu|nentu|di?tentukan)/i.test(t)
  );
}

function fieldFromForm(text, labelRe) {
  const m = text.match(labelRe);
  if (!m) return null;
  let v = (m[1] || '').split('\n')[0].trim().replace(/^[:•\-\s]+/, '').replace(/[.,;]+$/, '').trim();
  return isEmptyVal(v) ? null : v;
}

// Apakah pesan ini "form website" (punya struktur Jenis acara: ... / dari website)?
function isWebsiteForm(text) {
  return /jenis\s*acara\s*[:•]/i.test(text) || /\bdari\s*website\b/i.test(text);
}

// Parse detail acara dari pesan (form terstruktur dulu, lalu deteksi bebas).
function parseLeadDetails(originalText) {
  const text = originalText || '';
  const isForm = /jenis\s*acara\s*[:•]/i.test(text);
  let jenisAcara = null;
  let tanggal = null;
  let lokasi = null;
  if (isForm) {
    jenisAcara = fieldFromForm(text, /jenis\s*acara[^:•\n]*[:•]\s*([^\n]*)/i);
    tanggal = fieldFromForm(text, /tanggal[^:•\n]*[:•]\s*([^\n]*)/i);
    lokasi = fieldFromForm(text, /lokasi[^:•\n]*[:•]\s*([^\n]*)/i);
  }
  if (!jenisAcara) jenisAcara = detectEvent(text);
  if (!lokasi) lokasi = detectCity(text);
  if (!tanggal) tanggal = detectDate(text);
  return { jenisAcara, tanggal, lokasi };
}

function mergeDetails(a, b) {
  a = a || {};
  b = b || {};
  return {
    jenisAcara: b.jenisAcara || a.jenisAcara || null,
    tanggal: b.tanggal || a.tanggal || null,
    lokasi: b.lokasi || a.lokasi || null,
  };
}

function missingFields(d) {
  const m = [];
  if (!d.jenisAcara) m.push('jenis');
  if (!d.tanggal) m.push('tanggal');
  if (!d.lokasi) m.push('lokasi');
  return m;
}

// Klien NOLAK ngasih detail / cuma mau cek harga / maksa kirim -> langsung PL.
function wantsDirectPL(t) {
  return (
    (/(kirim|share|sharing|japri)\s*(aja|dong|in|kan|nya)?/i.test(t) &&
      /(pl|pricelist|price|harga|file|link)/i.test(t)) ||
    /langsung\s*(aja|kirim|pl|harga|dong)/i.test(t) ||
    /\b(file|link)\s*(nya)?\s*(aja|dong)/i.test(t) ||
    /li?hat[\s-]*li?hat|liat[\s-]*liat/i.test(t) ||           // lihat-lihat / liat-liat
    /(survey|surve)\s*(harga)?/i.test(t) ||                    // survey harga
    /cek\s*harga\s*(nya)?\s*(dulu|aja)?/i.test(t) ||           // cek harga aja
    /(tau|tahu|liat|lihat)\s*harga(nya)?\s*(dulu|aja)?/i.test(t) || // mau tau harga aja
    /pengen\s*(tau|tahu|liat|lihat|cek)\s*harga/i.test(t) ||
    /belum\s*ada\s*(rencana|tanggal|tgl|venue|lokasi|planning|plan|gambaran)/i.test(t) ||
    /(gausah|ga\s*usah|nggak\s*usah|tanpa)\s*(detail|ribet|nanya|isi)/i.test(t)
  );
}

// ---------- penyusunan teks ----------
// Rapikan nilai sebelum di-echo ke klien biar nggak kebawa mentah/bertele-tele:
// buang catatan dalam kurung "(...)", ambil opsi pertama (atau / /), batasi panjang.
// Data LENGKAP tetap tersimpan di log lead — ini cuma buat tampilan balasan.
function cleanAck(v) {
  if (!v) return '';
  let s = String(v).split('(')[0]; // buang "(lgi dlm proses...)", "(atau)...", dst
  s = s.split(/\s+atau\s+|\s*\/\s*|;|•/i)[0]; // ada beberapa opsi → ambil pertama
  s = s.trim().replace(/[.,;:\-\s]+$/, '').trim();
  if (s.length > 40) s = `${s.slice(0, 40).trim()}…`;
  return s;
}

function ackParts(d) {
  const p = [];
  const je = cleanAck(d.jenisAcara);
  const tg = cleanAck(d.tanggal);
  const lo = cleanAck(d.lokasi);
  if (je) p.push(`acara *${je}*`);
  if (tg) p.push(`tanggal *${tg}*`);
  if (lo) p.push(`di *${lo}*`);
  return p;
}

// Baris template isian (copy-paste). Cuma yang BELUM diberi yang ditampilkan,
// biar tidak menanyakan ulang info yang sudah dikasih klien.
const ASK_LABEL = {
  jenis: 'Acara: ',
  tanggal: 'Tanggal: ',
  lokasi: 'Kota/Venue: ',
};
// Jam PAKAI photobooth (bukan durasi acara) — penting buat cek ketersediaan unit.
// Selalu ditanyakan karena tak terdeteksi otomatis dari teks.
const JAM_LINE = 'Jam photobooth: (mis. 11.00–13.00)';

// Pertanyaan gerbang → DUA bubble terpisah biar natural & blok form gampang
// di-copy: { intro } = sapaan/akui detail, { form } = template isian copy-paste
// (cuma field yang masih kurang + jam photobooth).
function buildGateReply(details, missing) {
  const c = base.SMART_LEAD;
  const a = ackParts(details);
  const form = [...missing.map((m) => ASK_LABEL[m]), JAM_LINE].join('\n');
  const intro = a.length
    ? `${c.GREETING}\n\nSip, untuk ${a.join(' ')} ya Kak 🙌 Boleh lengkapi sisanya biar kami kirimkan paket & harganya:`
    : `${c.GREETING}\n\nBoleh dibantu isi detail acaranya dulu ya, biar kami kirimkan paket & harga yang paling sesuai 🙌`;
  return { intro, form };
}

// Balasan kirim PL: akui detail (kalau ada), kirim link + galeri, tutup hand-off.
// withGreeting=false untuk balasan di tengah percakapan (sapaan tak diulang —
// sudah disapa di pesan sebelumnya).
function buildPlReply(details, withGreeting = true) {
  const c = base.SMART_LEAD;
  const hasDetail = ackParts(details || {}).length > 0; // cuma buat tahu ada detail atau belum
  const head = withGreeting ? `${c.GREETING}\n\n` : '';
  const galeri = c.GALERI_URL
    ? `\n\nContoh hasilnya bisa diintip di galeri:\n👉 ${c.GALERI_URL}`
    : '';
  const pl = `Ini pricelist lengkap kami:\n👉 ${c.PRICELIST_URL}${galeri}`;

  if (hasDetail) {
    return `${head}Sip, detail acaranya sudah kami catat ya Kak 🙌\n\n${pl}\n\n${c.HANDOFF_DETAIL}`;
  }
  return `${head}${pl}\n\n${c.HANDOFF_NODETAIL}`;
}

// Tambah salam (kalau ada) di atas & catatan after-hours (kalau di luar jam) di bawah.
function finalize(text, originalText) {
  const cfg = live.get();
  let out = text;
  if (cfg.SALAM_REPLY && hasSalam(originalText)) out = `${cfg.SALAM_REPLY}\n\n${out}`;
  if (!isWithinBusinessHours() && cfg.AFTER_HOURS_NOTE) out += cfg.AFTER_HOURS_NOTE;
  return out;
}

// ---------- SEGMENTASI B2B vs PRIVATE (rekanan) ----------
const SEGMENT_LABELS = {
  private: 'Private',
  corporate: 'Corporate',
  instansi: 'Instansi/Pemerintah',
  eo_wo: 'EO/WO',
  venue: 'Venue',
  // Dunia pendidikan — 4 kategori terpisah. Bot balas NETRAL (gali kebutuhan dulu).
  osis: 'OSIS',         // organisasi siswa (SD/SMP/SMA)
  bem: 'BEM',           // organisasi mahasiswa (kampus)
  sekolah: 'Sekolah',   // institusi sekolah
  kampus: 'Kampus',     // institusi kampus/universitas
};
function segmentLabel(seg) {
  return SEGMENT_LABELS[seg] || 'Private';
}

// Coba tangkap nama organisasi (PT/CV/EO/WO + Nama). Ambil maksimal 4 kata
// berhuruf-kapital berturut (berhenti di kata huruf-kecil spt "mau/untuk/acara").
function cleanOrg(s) {
  return s.trim().replace(/\s{2,}/g, ' ').replace(/[.,;]+$/, '');
}
function detectOrgName(text) {
  let m = text.match(/\b(PT|CV|UD|PD)\.?\s+((?:[A-Z][\w&'.-]*\s*){1,4})/);
  if (m) return `${m[1].toUpperCase()} ${cleanOrg(m[2])}`;
  m = text.match(/\b(EO|WO)\.?\s+((?:[A-Z][\w&'.-]*\s*){1,4})/);
  if (m) return `${m[1].toUpperCase()} ${cleanOrg(m[2])}`;
  return null;
}

// Tentukan segmen dari sinyal kuat. Default 'private'. Konservatif biar minim
// salah-tag (admin bisa koreksi manual di dashboard, itu yang menang).
function detectSegment(originalText) {
  const t = (originalText || '').toLowerCase();
  const orgName = detectOrgName(originalText || '');

  // ── DUNIA PENDIDIKAN — CEK PALING DULU (bukan EO/WO). 4 kategori. ──
  // Bot balas NETRAL (gali kebutuhan dulu); admin bisa koreksi segmen di dashboard.
  // OSIS (organisasi siswa sekolah)
  if (/\bosis\b|\bmpk\b|rohis|ekskul|ekstrakurikuler|paskibra/i.test(t)) {
    return { segment: 'osis', orgName };
  }
  // BEM (organisasi mahasiswa)
  if (/\bbem\b|\bdema\b|\bhima\b|himpunan\s*mahasiswa|\bukm\b|senat\s*mahasiswa/i.test(t)) {
    return { segment: 'bem', orgName };
  }
  // Kampus (institusi perguruan tinggi)
  if (/\b(universitas|kampus|fakultas|rektorat|dekanat|politeknik|institut|akademi|sekolah\s*tinggi|mahasiswa|kuliah|ospek|\bmaba\b|wisuda|jurusan|prodi)\b/i.test(t)) {
    return { segment: 'kampus', orgName };
  }
  // Sekolah (institusi sekolah) + panitia/sponsorship generik (default ke sekolah)
  if (
    /\b(smp|sma|smk|smpn|sman|smkn|mts|man|min|madrasah|sekolah|siswa|guru|kepala\s*sekolah|pramuka|ambalan|pensi|pentas\s*seni|class\s*?meeting|porseni|scoutition|jambore)\b/i.test(t) ||
    /\b(panitia|sponsor|sponsorship|open\s*(stand|booth)|proposal\s*sponsor)\b/i.test(t)
  ) {
    return { segment: 'sekolah', orgName };
  }
  // EO/WO (rekanan channel)
  if (
    /\b(wedding organizer|event organizer|\beo\b|\bwo\b|organizer|agensi|agency)\b/i.test(t) ||
    /\b(kerja\s*sama|kerjasama|kolaborasi|rate\s*card|vendor\s*list|daftar\s*vendor|jadi\s*rekanan|jadi\s*vendor)\b/i.test(t)
  ) {
    return { segment: 'eo_wo', orgName };
  }
  // Instansi / pemerintah (sekolah/kampus sudah ditangani 'kampus' di atas)
  if (
    /\b(instansi|dinas|kementerian|kemenag|kemendikbud|pemda|pemkot|pemkab|pemprov|kelurahan|kecamatan|bumn|polri|tni|polres|polsek|kodim|puskesmas|rsud)\b/i.test(t)
  ) {
    return { segment: 'instansi', orgName };
  }
  // Corporate
  if (
    /\bpt\.?\s+[a-z]/i.test(t) ||
    /\bcv\.?\s+[a-z]/i.test(t) ||
    /\b(perusahaan|corporate|korporat|company|product\s*launch|launching\s*produk|annual|gathering\s*kantor|kantor\s*kami|acara\s*kantor|townhall|town\s*hall|employee|karyawan|family\s*gathering)\b/i.test(t)
  ) {
    return { segment: 'corporate', orgName };
  }
  // Venue — hanya kalau framing-nya PIHAK venue (bukan sekadar lokasi)
  if (
    /\b(pihak\s*(venue|gedung|hotel)|venue\s*kami|gedung\s*kami|kami\s*dari\s*(venue|gedung|hotel)|in[\s-]?house\s*vendor|preferred\s*vendor)\b/i.test(t)
  ) {
    return { segment: 'venue', orgName };
  }
  return { segment: 'private', orgName: null };
}

// Balasan khusus rekanan (B2B): framing kemitraan + tanya org & frekuensi.
function buildB2BReply(segment, details, orgName, withGreeting = true) {
  const c = base.SMART_LEAD;
  const head = withGreeting ? `${c.GREETING}\n\n` : '';
  const intro = (c.B2B && c.B2B[segment]) || (c.B2B && c.B2B.corporate) || '';
  const orgAck = orgName ? `Sip, dari *${orgName}* ya Kak! ` : '';

  // Dunia pendidikan (osis/bem/sekolah/kampus) → balasan NETRAL: gali kebutuhan
  // dulu (sewa / bagi hasil / sponsor beda-beda), jangan dorong satu model.
  const EDU = ['osis', 'bem', 'sekolah', 'kampus'];
  if (EDU.includes(segment)) {
    const eduIntro = (c.B2B && c.B2B.pendidikan) || 'Seru nih acara sekolah/kampusnya! 🙌';
    const ask = [];
    if (!orgName) ask.push('• Dari sekolah/kampus/organisasi apa ya, Kak?');
    ask.push('• Acaranya apa & kapan?');
    ask.push('• Estimasi pengunjung/peserta berapa?');
    ask.push('• Kebutuhannya gimana — sewa biasa, kerja sama bagi hasil, atau lagi cari sponsor?');
    return (
      `${head}${orgAck}${eduIntro}\n\n` +
      `Boleh diinfoin dulu ya:\n${ask.join('\n')}\n\n` +
      `Nanti tim kami bantu carikan skema yang paling cocok buat acara Kakak ya 🙏`
    );
  }

  // corporate / instansi / eo_wo / venue → framing kemitraan + pricelist sebagai gambaran.
  const ask = [];
  if (!orgName) ask.push('• Dari PT/instansi/EO mana ya, Kak?');
  ask.push('• Acaranya jenis apa & kapan?');
  ask.push('• Sekali ini aja, atau ada rencana acara rutin/berkala?');
  return (
    `${head}${orgAck}${intro}\n\n` +
    `Boleh diinfoin dulu ya:\n${ask.join('\n')}\n\n` +
    `Ini pricelist sebagai gambaran awal: 👉 ${c.PRICELIST_URL}\n` +
    `Nanti tim kami siapin penawaran kerja sama yang paling pas ya 🙏`
  );
}

module.exports = {
  parseLeadDetails,
  toISODate,
  parseJamRange,
  mergeDetails,
  missingFields,
  isWebsiteForm,
  wantsDirectPL,
  buildGateReply,
  buildPlReply,
  finalize,
  detectSegment,
  segmentLabel,
  buildB2BReply,
};
