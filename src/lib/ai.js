// Otak balasan bot WhatsApp Tetra = agent Hermes `cs-wa` lewat Runs API (Rama 16 Nov 2026: "wajib hukumnya lewat Hermes…
// full hanya hermes 100%"). Node hanya pipa: memberi FAKTA, meneruskan teks Hermes, dan menjalankan penanda [..].
// - Cara menjawab, prosedur, tugas latar: skill Hermes (faq-tetra, cara-balas-wa, strategi-cs, form-booking, tugas-sistem-cs,
//   mode-kontak-khusus, cs-mintet-pelajaran) yang dipin skills.auto_load profil cs-wa.
// - Penjaga balasan (klaim palsu, bocor pikiran, harga/link karangan, janji temu, durasi, gaya, follow-up, lampiran yang kurang):
//   plugin Hermes penjaga-cs (hermes-plugins/penjaga-cs, Tahap 3A/3B, 18 Nov).
// Tahap 3C (18 Nov): prompt lama (SYSTEM_PROMPT, V2), pemeriksa V2, profil klien V2, jalur model non-Hermes (Sumopod langsung,
// cadangan Gemini, 9Router, bayangan), dan penjaga kode lama dibuang dari sini — riwayatnya di git (sebelum commit Tahap 3C).
const fs = require('fs');
const path = require('path');

// Eksperimen A/B yang dijalankan messages.js dibaca dari skill cs-mintet-pelajaran (dirawat CS Mintet). Baris bernominal atau
// berbahaya diabaikan (bahan belajar memuat chat klien, jadi bisa tersusupi).
const RE_PELAJARAN_BAHAYA = /\b(?:se|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh)\s*(?:ratus|puluh|belas)?\s*(?:ribu|juta)\b|rekening|\brek\b|\b(bca|bni|bri|mandiri)\b|\d+\s*%|persen|\bhttps?:|\bwww\.|wa\.me|\d{6,}|abaikan|ignore|lupakan|system prompt|aturan di atas|(?<!\b(?:jangan|tidak|tak|dilarang|bukan|belum)\s+(?:\p{L}+\s+)?)\b(kasih|beri(kan)?|boleh|langsung|tawarkan)\s+(saja\s+)?(diskon|potongan|gratis|promo|free)/iu;
const PELAJARAN_FILE = () => process.env.PELAJARAN_FILE ||
  path.join(process.env.HOME || '/home/ubuntu', '.hermes/profiles/tetra-wa-bot/skills/cs-mintet-pelajaran/SKILL.md');
// Eksperimen A/B yang ditulis CS Mintet di skill: `- E1 | persona | TAHAP | A: … | B: …`
// (persona/tahap boleh "semua"). Baris berbahaya/bernominal diabaikan seperti pelajaran.
function eksperimen() {
  try {
    return bagianSkill(fs.readFileSync(PELAJARAN_FILE(), 'utf-8'), 'Eksperimen')
      .map((l) => l.match(/^\s*-\s*(E\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*A:\s*([^|]+?)\s*\|\s*B:\s*(.+?)\s*$/i))
      .filter((m) => m && !angkaRupiah(m[0]).length && !RE_PELAJARAN_BAHAYA.test(m[0]))
      .map((m) => ({ id: m[1].toUpperCase(), persona: m[2].toLowerCase(), tahap: m[3].toUpperCase(), A: m[4], B: m[5] }));
  } catch { return []; }
}

function bagianSkill(isi, judul) {
  return ((isi.split(new RegExp(`^## ${judul}[^\\n]*$`, 'm'))[1] || '').split(/^## /m)[0]).split('\n');
}
function angkaRupiah(teks) {
  const out = [];
  const re = /(rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)?(?![\w])/gi;
  for (const m of String(teks).matchAll(re)) {
    const sat = (m[3] || '').toLowerCase();
    const ribuan = /^\d{1,3}([.,]\d{3})+$/.test(m[2]);
    let n = ribuan ? Number(m[2].replace(/[.,]/g, '')) : Number(m[2].replace(',', '.'));
    // Tanpa "Rp"/satuan: hanya angka berpemisah ribuan >= 100.000 (admin sering tulis "2.300.000").
    if (!m[1] && !sat && !(ribuan && n >= 100000)) continue;
    if (sat === 'jt' || sat === 'juta') n *= 1e6;
    else if (sat === 'rb' || sat === 'ribu' || sat === 'k') n *= 1e3;
    if (n >= 10000) out.push(Math.round(n));
  }
  return out;
}

const HERMES = { hermes: true, model: 'hermes:cs-wa', timeout: Number(process.env.HERMES_CS_TIMEOUT_MS || 150000) };
const pakaiHermes = () => process.env.AI_OTAK === 'hermes' && !!process.env.HERMES_CS_KEY;
// Pekerjaan AI di balik layar (ringkasan chat, baca data booking/quotation, nilai follow-up) juga lewat Hermes (Rama 16 Nov:
// "full hanya hermes 100%"); wajib Hermes = tanpa cadangan model lain.
const HERMES_TUGAS = { hermes: true, tugas: true, model: 'hermes:cs-wa', timeout: Number(process.env.HERMES_TUGAS_TIMEOUT_MS || 90000) };
// 18 Nov (Rama: "pindahkan semuanya ke buku hermes"): cara kerja, mode ambil alih, pesan situasi, dan tugas sistem ada di
// skill cara-balas-wa; strategi di skill strategi-cs; semuanya dipin lewat `skills.auto_load` profil cs-wa. Node hanya memberi fakta.
async function kirimHermes(endpoint, messages) {
  const url = process.env.HERMES_CS_URL || 'http://127.0.0.1:8642/p/cs-wa/v1';
  const H = { Authorization: `Bearer ${process.env.HERMES_CS_KEY}`, 'Content-Type': 'application/json' };
  const sys = (endpoint.tugas ? 'TUGAS SISTEM (bukan pesan untuk klien).\n\n' : '') +
    (messages[0]?.role === 'system' ? messages[0].content : '');
  const percakapan = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.tool_calls)
    .map((m) => ({ role: m.role, content: String(m.content || '') }));
  const akhir = percakapan.pop();
  const r = await fetch(`${url}/runs`, { method: 'POST', headers: H, signal: AbortSignal.timeout(20000),
    body: JSON.stringify({ instructions: sys, conversation_history: percakapan, input: akhir?.content || '' }) });
  if (!r.ok) throw new Error(`hermes runs HTTP ${r.status} ${(await r.text()).slice(0, 160)}`);
  const { run_id } = await r.json();
  const batas = Date.now() + endpoint.timeout;
  let st;
  while (Date.now() < batas) {
    await new Promise((ok) => setTimeout(ok, 2000));
    st = await (await fetch(`${url}/runs/${run_id}`, { headers: H, signal: AbortSignal.timeout(15000) })).json();
    if (!['started', 'running', 'queued', 'pending'].includes(st.status)) break;
  }
  if (st?.status !== 'completed') {
    fetch(`${url}/runs/${run_id}/stop`, { method: 'POST', headers: H }).catch(() => {});
    throw new Error(`hermes run ${run_id} ${st?.status || 'tanpa status'}`);
  }
  // Status tanggal hanya sah kalau alat jadwal Tetra Ops benar-benar mengembalikan "bisa terima booking" di run ini (usulan 72).
  let jadwalTersedia = false;
  try {
    const ev = await (await fetch(`${url}/runs/${run_id}/events`, { headers: H, signal: AbortSignal.timeout(10000) })).text();
    jadwalTersedia = /cek_ketersediaan[\s\S]{0,400}?bisa_terima_booking\\*"\s*:\s*true/.test(ev);
  } catch (e) { console.log(`[hermes] event ${run_id} tidak terbaca: ${e.message}`); }
  console.log(`[hermes${endpoint.tugas ? '-tugas' : ''}] ${run_id} selesai, token masuk ${st.usage?.input_tokens ?? '?'} (cache ${st.usage?.cache_read_tokens ?? '?'}), jadwal ${jadwalTersedia ? 'dicek: tersedia' : '-'}, model ${st.runtime?.model || '?'}`);
  // Penanda lampiran dirapikan ke kunci satu kata ("[KIRIM: format cetak]" → "[KIRIM: format]") supaya semua penjaga
  // lampiran ikut menyala (uji 16 Nov: penjaga "jangan ulang ukuran" tidak menyala karena kuncinya dua kata).
  const content = String(st.output || '').replace(/\[KIRIM:\s*(\w+)[^\]]*\]/gi, '[KIRIM: $1]');
  return { content, tool_calls: [], jadwalTersedia };
}

// Kalimat untuk situasi sistem (bukti transfer masuk, voice note, link galeri, berhenti dihubungi, dst.) ditulis Hermes,
// bukan teks tetap Node (Rama 16 Nov: "full hanya hermes 100%"). Node memberi situasi + fakta; data persis (link, isian
// form) ditempel Node. Mengembalikan null kalau Hermes gagal/tidak dipakai — pemanggil yang memutuskan (wajib Hermes:
// tanpa kalimat bawaan, admin dikabari).
// `simpan`: kunci [KIRIM: x] yang tetap dibiarkan untuk dieksekusi pemanggil (mis. ['form'] → form resmi ditempel Node).
async function kalimatHermes(situasi, { history = [], pesanKlien = '', leadContext = '', simpan = [] } = {}) {
  if (process.env.AI_OTAK !== 'hermes' || !process.env.HERMES_CS_KEY) return null;
  const messages = [
    { role: 'system', content: konteksWaktu() + (leadContext ? `\n\nKONTEKS:\n${leadContext}` : '') + `\n\nSITUASI DARI SISTEM: ${situasi}` },
    ...history.slice(-10).filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: String(m.content || '') })),
    { role: 'user', content: pesanKlien || '(tidak ada pesan baru dari klien; sistem yang meminta pesan ini)' },
  ];
  // Penjaga (klaim, bocor, harga) dan tulis ulang frasa kaku dikerjakan plugin Hermes penjaga-cs (Tahap 3A); kalau tidak aman,
  // plugin mengembalikan [ADMIN_HANDOFF] -> setelah penanda dibuang kosong -> null (pemanggil mengabari admin).
  for (let coba = 1; coba <= 2; coba++) {
    try {
      const r = await kirimHermes({ ...HERMES, situasi: true }, messages);
      const dibiarkan = (m) => simpan.some((k) => new RegExp(`^\\[KIRIM:\\s*${k}\\b`, 'i').test(m));
      return String(r.content || '').replace(/\[[A-Z_]+[^\]]*\]/g, (m) => (dibiarkan(m) ? m : '')).replace(/https?:\/\/\S+/g, '').trim() || null;
    } catch (e) { console.error(`[hermes-situasi] gagal (percobaan ${coba}): ${e.message}`); }
  }
  return null;
}

// Pesan terstruktur (form data acara, rekap) disusun Hermes dengan format skill form-booking (Rama 16 Nov: "gua mau").
// Penjaga: SEMUA string di wajibAda (label form + nilai asli) harus ada persis; gagal tiga kali → null (pemanggil memakai
// versi data sistem, karena isian ini dipakai admin untuk input booking di Tetra Ops).
async function susunHermes(situasi, { history = [], wajibAda = [] } = {}) {
  if (!pakaiHermes()) return null;
  const norm = (x) => rapikanGaya(String(x), 0).toLowerCase().replace(/\s+/g, ' ').trim();
  const messages = [
    { role: 'system', content: konteksWaktu() + `\n\nSITUASI DARI SISTEM: ${situasi}` },
    ...history.slice(-10).filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({ role: m.role, content: String(m.content || '') })),
    { role: 'user', content: '(sistem meminta pesan ini; tidak ada pesan baru dari klien)' },
  ];
  for (let coba = 1; coba <= 3; coba++) {
    try {
      const r = await kirimHermes({ ...HERMES, situasi: true }, messages);
      const t = rapikanGaya(r.content, 0).replace(/\[[A-Z_]+[^\]]*\]/g, '').trim();
      const nt = norm(t);
      const hilang = wajibAda.filter((w) => w && !nt.includes(norm(w)));
      // Tahap 3A: klaim/bocor/frasa kaku dijaga plugin penjaga-cs; Node hanya memastikan nilai data sistem tersalin persis.
      if (t && !hilang.length) return t;
      console.log(`[hermes-susun] ditolak (percobaan ${coba}): hilang ${hilang.length ? hilang.join(' | ').slice(0, 160) : '(kosong/dioper admin)'}`);
      if (!t) return null;
      messages.push({ role: 'assistant', content: t }, { role: 'user', content: 'KOREKSI SISTEM: ' +
        `baris/nilai ini hilang atau berubah, wajib ditulis persis: ${hilang.map((h) => `"${h}"`).join(', ')}. Tulis ulang pesannya utuh. Balas HANYA pesannya.` });
    } catch (e) { console.error(`[hermes-susun] gagal (percobaan ${coba}): ${e.message}`); }
  }
  return null;
}

function konteksWaktu() {
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][wib.getUTCDay()];
  const bulan = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli',
    'Agustus', 'September', 'Oktober', 'November', 'Desember'][wib.getUTCMonth()];
  const tgl = `${hari}, ${wib.getUTCDate()} ${bulan} ${wib.getUTCFullYear()}`;
  const jam = String(wib.getUTCHours()).padStart(2, '0') + '.' + String(wib.getUTCMinutes()).padStart(2, '0');
  return `\n\nWAKTU SEKARANG: ${tgl}, pukul ${jam} WIB.`; // cara memakainya: skill cara-balas-wa (18 Nov)
}

// Tanda AI yang bikin klien merasa dibalas bot (Rama 11 Nov: "banyak yang kabur pas merasakan ah ini mah dijawab bot"):
// tanda pisah "—"/"–" di tengah kalimat dan banyak teks tebal. Dirapikan deterministik untuk SEMUA teks buatan model
// (balasan chat & follow-up lewat getAIResponse, sapaan prospek lewat bot.js). Baris penanda [..] tidak disentuh;
// rentang angka (11.30–14.00) jadi tanda hubung biasa; bold hanya yang pertama yang dibiarkan.
function rapikanGaya(teks, maksTebal = 1) {
  let tebal = 0;
  return String(teks || '').split('\n').map((baris) => {
    if (/^\s*\[[A-Z_]+/.test(baris)) return baris;
    let b = baris.replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
      .replace(/^\s*[–—]\s*/, '')
      .replace(/\s*[–—]\s*$/, '')
      .replace(/\s*[–—]\s*/g, ', ')
      .replace(/,\s*([,.!?])/g, '$1');
    b = b.replace(/\*([^*\n]+)\*/g, (m, isi) => (tebal++ < maksTebal ? m : isi));
    // Istilah ke klien: "quotation", bukan "penawaran" (Rama 11 Nov).
    b = b.replace(/\b(surat\s+)?penawaran(\s+(resmi|harga))?(\s*\(quotation\))?/gi, (m) => (/^[A-Z]/.test(m) ? 'Quotation' : 'quotation'));
    return b;
  }).join('\n');
}

// Klien cuma menutup ("ok", "noted", "makasih kak 🙏"): dipakai gerbang follow-up (pesan terakhir klien yang belum dijawab).
const RE_PENUTUP = /^(?:(?:ok(?:e|ay|eh)?|sip|siap|noted|baik|makasih|makasi|terima ?kasih|thanks?|thank you|thx|tq|sama[- ]sama|kembali kasih|mantap|oke deh|ya|iya|yaa|kak|ka|kk|mas|mba|mbak|min|banyak|deh|ya kak|👍|🙏|😊|🙂|👌)[\s,.!]*)+$/i;

// Satu giliran balasan klien = satu run Hermes cs-wa. Penjaga balasan = plugin penjaga-cs; Node meneruskan teksnya apa adanya.
async function panggil(history, message, leadContext) {
  const messages = [
    { role: 'system', content: konteksWaktu() + (leadContext ? `\n\nKONTEKS LEAD (dari deteksi & riwayat):\n${leadContext}` : '') },
    ...history,
    { role: 'user', content: message },
  ];
  const teks = String((await kirimHermes(HERMES, messages)).content || '').trim();
  if (!teks) throw new Error('balasan kosong dari model');
  return teks;
}

// Dicoba dua kali; tetap gagal → error bertanda hermes (messages.js: klien tidak dikirimi kalimat bawaan Node, admin dikabari saat
// itu juga untuk membalas manual, Rama dapat alarm Telegram setiap kejadian). Tanpa jalur model lain.
async function getAIResponse(history, message, leadContext) {
  let galat = new Error(process.env.AI_OTAK !== 'hermes' ? 'AI_OTAK bukan hermes' : 'HERMES_CS_KEY kosong');
  for (let coba = 1; coba <= 2 && pakaiHermes(); coba++) {
    try { return await panggil(history, message, leadContext); }
    catch (e) { galat = e; console.error(`[hermes] gagal (percobaan ${coba}): ${e.message}`); }
  }
  const x = new Error(`otak Hermes gagal: ${galat.message}`);
  x.hermes = true;
  throw x;
}

// Rangkum percakapan lama jadi catatan klien, supaya riwayat panjang tidak
// dibuang begitu saja dan AI tetap tahu fakta di awal chat.
// Tugas latar (Rama 18 Nov: "bener-bener native semua dihandle oleh hermes"): prosedur & bentuk JSON tiap tugas ada di skill
// Hermes `tugas-sistem-cs` (dipin skills.auto_load cs-wa). Node hanya memberi data dan membaca hasilnya; tanpa jalur non-Hermes.
const hariIniWIB = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const barisChat = (pesan) => pesan.map((p) => `${p.role === 'user' ? 'KLIEN' : 'TETRA'}: ${p.content}`).join('\n');
const jsonDari = (raw) => { const m = String(raw || '').match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]); } catch { return null; } };
async function tugasHermes(nama, data) {
  const msg = await kirimHermes(HERMES_TUGAS, [
    { role: 'system', content: `TUGAS SISTEM: ${nama} — kerjakan sesuai skill tugas-sistem-cs bagian "${nama}".` },
    { role: 'user', content: data },
  ]);
  return String(msg.content || '').trim();
}

async function ringkasPercakapan(ringkasanLama, pesan) {
  return tugasHermes('ringkas-chat', `CATATAN LAMA:\n${ringkasanLama || '(belum ada)'}\n\nCHAT:\n${barisChat(pesan)}`);
}

// Isi form data acara dari chat (klien sering mencicil). Kunci yang boleh = FIELD booking (data, bukan aturan).
async function ekstrakBooking(dataLama, pesan, field) {
  const daftar = field.map(([k, label]) => `- ${k}: ${label}`).join('\n');
  return jsonDari(await tugasHermes('isi-data-booking', `HARI INI: ${hariIniWIB()}\nKUNCI YANG BOLEH:\n${daftar}\n` +
    `- tanggal_iso: tanggal acara format YYYY-MM-DD\n\nDATA SAAT INI:\n${JSON.stringify(dataLama)}\n\nCHAT TERBARU:\n${barisChat(pesan)}`)) || {};
}

// Permintaan quotation (kontrak Tetra Ops /api/bot/quotation). Harga dihitung Tetra Ops, bukan di sini.
async function ekstrakQuotation(pesan, ringkasan, namaAddon = []) {
  const j = jsonDari(await tugasHermes('susun-quotation', `HARI INI: ${hariIniWIB()}\nDAFTAR ADD-ON RESMI: ${namaAddon.join(' | ') || '(kosong)'}\n\n` +
    `${ringkasan ? `CATATAN KLIEN:\n${ringkasan}\n\n` : ''}CHAT:\n${barisChat(pesan)}`));
  if (!j) throw new Error('ekstrak quotation: tidak ada JSON');
  return j;
}

// Penilai sebelum follow-up. Ragu, gagal, atau JSON rusak = TIDAK kirim.
async function nilaiFollowup(transkrip, ringkasan) {
  try {
    const j = jsonDari(await tugasHermes('nilai-follow-up', `${ringkasan ? `CATATAN KLIEN (chat lama):\n${ringkasan}\n\n` : ''}` +
      `WAKTU SEKARANG: ${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} WIB\n\nTRANSKRIP:\n${transkrip}`));
    if (!j) throw new Error('JSON penilai rusak/kosong');
    return { kirim: j.kirim === true, status: j.status || '?', alasan: j.alasan || '' };
  } catch (e) {
    return { kirim: false, status: 'gagal_nilai', alasan: e.message.slice(0, 100) };
  }
}

// Tamu minta foto/softfile (lib/galeri.js) & gambar dari kontak: mata Hermes (vision_analyze, auxiliary.vision gemini-3.8-flash).
// Gambar disimpan sementara di folder profil cs-wa lalu dihapus.
async function ekstrakGaleri(teks, gambarB64) {
  let file = null;
  try {
    if (gambarB64) {
      const dir = path.join(process.env.HOME || '/home/ubuntu', '.hermes', 'profiles', 'cs-wa', 'cache', 'wa-gambar');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      file = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
      fs.writeFileSync(file, Buffer.from(gambarB64, 'base64'), { mode: 0o600 });
    }
    return jsonDari(await tugasHermes('baca-pesan-galeri', `HARI INI: ${hariIniWIB()}\nGAMBAR: ${file || '(tidak ada)'}\n` +
      `PESAN WHATSAPP:\n${teks || '(tanpa teks)'}`)) || {};
  } finally {
    if (file) { try { fs.unlinkSync(file); } catch { /* sudah terhapus */ } }
  }
}

module.exports = {
  susunHermes, kalimatHermes, pakaiHermes, rapikanGaya, RE_PENUTUP, eksperimen, getAIResponse,
  ringkasPercakapan, ekstrakBooking, ekstrakQuotation, nilaiFollowup, ekstrakGaleri,
};
