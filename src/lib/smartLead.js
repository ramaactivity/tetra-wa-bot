// Otak alur "Smart Lead" (gated, deterministik — tanpa AI):
//  - parse detail acara (jenis / tanggal / lokasi) dari form website maupun chat bebas
//  - deteksi frasa "nolak ngasih detail" (cuma mau cek harga) -> langsung PL
//  - deteksi segmen (private / corporate / pendidikan / EO) untuk konteks AI
//  Kalimat balasan ke klien selalu dari AI (lib/ai.js), bukan template di sini.

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
  return /jenis\s*acara\s*[:•]/i.test(text) || /\b(dari|di)\s*(halaman\b[^\n]*)?\s*website\b/i.test(text) ||
    /website\s*tetra/i.test(text);
}

// ── Pesan dari tombol WA website ─────────────────────────────────────────────
// Kontrak dengan repo website (docs/PROMPT-WEBSITE-WA-TEMPLATE.md di HERMES):
// label "Acara / Tanggal / Jam photobooth / Lokasi / Jumlah tamu / Paket / Nama"
// satu per baris, penanda "website Tetra (halaman X)". Format lama (form kosong
// "Jenis acara : / Tanggal acara : / Lokasi/venue :", intro per halaman/paket)
// tetap dibaca. Ganti label di website = ganti LABEL_WEB di sini juga.
const LABEL_WEB = {
  acara: /^(?:jenis\s*)?acara/i,
  tanggal: /^tanggal/i,
  jam: /^jam/i,
  lokasi: /^(?:lokasi|venue)/i,
  tamu: /^(?:jumlah|perkiraan)\s*tamu|^tamu/i,
  paket: /^paket/i,
  nama: /^nama/i,
};
function parseWebsite(text) {
  const t = text || '';
  const out = { dariWebsite: isWebsiteForm(t), halaman: null };
  for (const baris of t.split('\n')) {
    const m = baris.match(/^\s*[•\-*]?\s*([^:]{2,30}?)\s*:\s*(.*)$/);
    if (!m) continue;
    for (const [k, re] of Object.entries(LABEL_WEB)) {
      if (!out[k] && re.test(m[1].trim())) { const v = m[2].trim(); if (v && !isEmptyVal(v)) out[k] = v; }
    }
  }
  // Konteks dari kalimat pembuka: "(halaman Wedding)", "halaman photobooth wedding",
  // "tertarik dengan paket Unlimited (3 Jam)", "acara di Bogor".
  const hal = t.match(/halaman\s+(?:photobooth\s+)?([^\n).,]+?)(?:\s+di\s+website|\)|\.|\n|$)/i);
  if (hal) out.halaman = hal[1].trim();
  const pk = t.match(/paket\s+([^\n]+?\(\s*\d+\s*jam[^)]*\))/i);
  if (!out.paket && pk) out.paket = pk[1].trim();
  const area = t.match(/untuk acara di\s+([A-Z][\w ]+?)[.\n]/);
  if (!out.lokasi && area) out.lokasi = area[1].trim();
  const isian = ['acara', 'tanggal', 'jam', 'lokasi', 'tamu', 'nama'].filter((k) => out[k]);
  // Kosong = klien menekan kirim tanpa mengisi, atau pesan terpotong (in-app browser memutus di "&").
  out.kosong = out.dariWebsite && isian.length === 0;
  out.terpotong = out.dariWebsite && /&\s*$/.test(t.trim());
  return out;
}

// Parse detail acara dari pesan (form terstruktur dulu, lalu deteksi bebas).
function parseLeadDetails(originalText) {
  const text = originalText || '';
  const isForm = /jenis\s*acara\s*[:•]/i.test(text);
  let jenisAcara = null;
  let tanggal = null;
  let lokasi = null;
  if (isForm) {
    jenisAcara = fieldFromForm(text, /jenis\s*acara[^:•\n]*[:•][^\S\r\n]*([^\n]*)/i);
    tanggal = fieldFromForm(text, /tanggal[^:•\n]*[:•][^\S\r\n]*([^\n]*)/i);
    lokasi = fieldFromForm(text, /lokasi[^:•\n]*[:•][^\S\r\n]*([^\n]*)/i);
  }
  if (!isForm) {
    const w = parseWebsite(text);
    jenisAcara = w.acara || null; tanggal = w.tanggal || null; lokasi = w.lokasi || null;
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
    /\b(smp|sma|smk|smpn|sman|smkn|mts|man|madrasah|sekolah|siswa|guru|kepala\s*sekolah|pramuka|ambalan|pensi|pentas\s*seni|class\s*?meeting|porseni|scoutition|jambore)\b/i.test(t) ||
    /\bmin\s*\d/i.test(t) || // "MIN 2" (madrasah); "min" polos = panggilan admin, jangan ditandai sekolah
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

module.exports = {
  parseLeadDetails,
  detectCity,
  detectEvent,
  toISODate,
  parseJamRange,
  mergeDetails,
  missingFields,
  isWebsiteForm,
  parseWebsite,
  wantsDirectPL,
  detectSegment,
  segmentLabel,
};
