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
// Daftar polanya = DATA di docs/SAMBUTAN-OTOMATIS.md (audit Bruno t_951a932f N6): ditambah tanpa mengubah kode.
function muatPolaOtomatis() {
  try {
    const pola = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'SAMBUTAN-OTOMATIS.md'), 'utf-8').split('\n')
      .filter((l) => l.startsWith('- ')).map((l) => l.slice(2).split(' #')[0].trim()).filter(Boolean);
    return new RegExp(pola.join('|'), 'i');
  } catch (e) {
    console.error('[prospek] docs/SAMBUTAN-OTOMATIS.md tidak terbaca, pakai pola minimal:', e.message);
    return /thank you for (contacting|reaching)|terima ?kasih (sudah|telah|atas) (menghubungi|pesan)/i;
  }
}
const RE_OTOMATIS = muatPolaOtomatis();
const otomatis = (teks) => RE_OTOMATIS.test(String(teks || ''));

// Lead yang membalas sapaan sales (Bruno). Segmen dari tabel prospek Tetra Ops (paket perbaikan Bruno, Rama 22 Okt):
// venue & WO/EO = calon rekanan; korporat/instansi/kampus/personal = calon KLIEN (5 konversi 1 Sep–22 Okt semuanya
// korporat/instansi, tapi dulu dilayani sebagai calon rekanan dan tak pernah diarahkan ke booking).
const SEGMEN_REKANAN = ['venue', 'eo_wo'];
const rekanan = (p) => !p?.segmen || SEGMEN_REKANAN.includes(p.segmen);

// Blok FAKTA lead (audit Bruno t_951a932f §4.1; Rama 19 Nov: follow-up "kebanyakan salah"). Dulu Node menulis "LEAD … membalas sapaan"
// untuk SEMUA lead (juga yang belum pernah membalas) dan tidak memberi tahu file apa yang sudah terkirim → cs-wa mengarang ("pricelist yang
// kemarin sudah dilihat", perkenalan ulang). Sekarang hanya fakta; cara menanggapi = skill Hermes mode-kontak-khusus.
// Dipakai balasan chat lead, susulan, dan tombol Follow-up Tetra Ops. riw = riwayat gabungan orang ini; pr = baris prospek Tetra Ops.
const tglWib = (t) => (t ? new Date(t).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
const RE_PESAN_SISTEM = /^\((admin|catatan sistem)\)/;
const RE_MINTA_PIC = /\bPIC\b|nomor WA|e-?mail|kontak (yang|orang)/i;
const RE_MINTA_WAKTU = /sebentar ya|tampung dulu|periode (awal|akhir)|belum buka (rekanan|vendor)|nanti\s+(kami|kita|saya|aku)?\s*(kabari|kabarin|hubungi|info)|diskusi(kan)?\s+dulu|tanya(in)?\s+(dulu|atasan|ke)|pikir(-pikir)?\s+dulu|kabar(i|in)\s+(lagi|nanti)/i;
function fileTerkirim(riw) {
  const { LAMPIRAN } = require('./lampiran'); // di dalam fungsi: hindari require melingkar
  const tanda = riw.map((x) => ({ t: x.t, c: (String(x.content).match(/\[kirim (PDF|dokumen:)[^\]]*\]/gi) || []).join(' ') })).filter((x) => x.c);
  return [['pricelist', /pricelist/i], ...Object.values(LAMPIRAN).map((l) => [l.label, l.pernah])]
    .map(([label, re]) => { const x = tanda.filter((y) => y.c.includes(`[kirim PDF ${label}]`) || re.test(y.c)).at(-1); return x && `${label} (${tglWib(x.t)})`; })
    .filter(Boolean);
}
function faktaLead(p, riw = [], pr = null) {
  if (!p) return '';
  const kita = riw.filter((x) => x.role === 'assistant' && !RE_PESAN_SISTEM.test(String(x.content)));
  const masuk = riw.filter((x) => x.role === 'user');
  const manusia = masuk.filter((x) => !otomatis(x.content));
  const oto = masuk.filter((x) => otomatis(x.content));
  const iManusia = riw.findLastIndex((x) => x.role === 'user' && !otomatis(x.content));
  const takDibalas = riw.slice(iManusia + 1).filter((x) => x.role === 'assistant' && !RE_PESAN_SISTEM.test(String(x.content))).length;
  const file = fileTerkirim(riw);
  const mintaPic = kita.slice(1).filter((x) => RE_MINTA_PIC.test(String(x.content))).at(-1); // sapaan pertama tidak dihitung
  const mintaWaktu = manusia.filter((x) => RE_MINTA_WAKTU.test(String(x.content))).at(-1);
  const catatan = (String(pr?.catatan || '').split('\n').filter((l) => l.trim() && !/^\s*cmd\s+\S+\s*$/i.test(l)).at(-1) || '').trim().slice(0, 140);
  return ['', 'FAKTA LEAD (dari sistem; jangan menyebut hal di luar fakta ini dan transkrip):',
    `LEAD: ${p.nama || '-'} | segmen: ${p.segmen || pr?.segmen || '-'} (${rekanan(p) ? 'calon rekanan' : 'calon klien'}) | nomor: ${p.nomor || '-'}`,
    `SAPAAN PERTAMA: ${kita[0] ? `${tglWib(kita[0].t)} lewat WA` : 'belum ada di WA'}`,
    `BALASAN MANUSIA: ${manusia.length ? `${manusia.length}× (terakhir ${tglWib(manusia.at(-1).t)})` : 'belum pernah'}`,
    `BALASAN OTOMATIS: ${oto.length ? `${oto.length}× (terakhir ${tglWib(oto.at(-1).t)})` : 'tidak ada'}`,
    `PESAN KITA: ${kita.length}× (terakhir ${tglWib(kita.at(-1)?.t)}) | belum dibalas manusia: ${takDibalas}`,
    `FILE TERKIRIM: ${file.length ? file.join(', ') : 'belum ada'}`,
    `PIC: ${pr?.pic ? `${pr.pic} (tercatat di Tetra Ops)` : 'belum tercatat'}`,
    `STATUS TETRA OPS: ${pr?.status || '-'}${catatan ? ` | catatan terakhir: ${catatan}` : ''}`,
    `KITA MINTA PIC: ${mintaPic ? `ya (${tglWib(mintaPic.t)})` : 'belum'}`,
    `LEAD MINTA WAKTU: ${mintaWaktu ? `ya ("${String(mintaWaktu.content).replace(/\s+/g, ' ').slice(0, 60)}", ${tglWib(mintaWaktu.t)})` : 'tidak'}`,
  ].join('\n');
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
module.exports = { cek, catat, MAKS_PER_HARI, nomorPengirim, balasanProspek, otomatis, faktaLead, tanpaAngka, rekanan };

if (require.main === module) {
  // Uji cepat: node src/lib/prospekWa.js
  const assert = require('assert');
  const K = (c, t) => ({ role: 'assistant', content: c, t }), L = (c, t) => ({ role: 'user', content: c, t });
  const t0 = Date.parse('2026-11-10T03:00:00Z');
  // Pindy 19 Nov: belum pernah dibalas manusia, sambutan otomatis bertanda tangan "Merry", tanpa file terkirim.
  const pindy = faktaLead({ nama: 'Pindy Organizer', segmen: 'eo_wo', nomor: '6281283320730' }, [
    K('[sapaan dari tim sales] Halo Kak, saya Rama dari Tetra Photobooth', t0), L('Thank you for contacting Pindy Organizer! Cheers, Merry', t0 + 2e3),
    K('Boleh minta kontak PIC yang pegang kerja sama vendor?', t0 + 864e5), L('Terima kasih telah menghubungi kami, kami akan segera membalas', t0 + 864e5 + 2e3)],
  { status: 'disapa', catatan: 'cmd 123' });
  assert.match(pindy, /calon rekanan/);
  assert.match(pindy, /BALASAN MANUSIA: belum pernah/);
  assert.match(pindy, /BALASAN OTOMATIS: 2×/);
  assert.match(pindy, /PESAN KITA: 2× .*belum dibalas manusia: 2/);
  assert.match(pindy, /FILE TERKIRIM: belum ada/);
  assert.match(pindy, /KITA MINTA PIC: ya/);
  assert.match(pindy, /PIC: belum tercatat/);
  assert.doesNotMatch(pindy, /membalas sapaan/, 'fakta palsu lama tidak boleh kembali');
  // Lead yang membalas manusia + sudah dikirimi pricelist & profil rekanan; minta waktu.
  const violetta = faktaLead({ nama: 'Violetta Wedding', segmen: 'eo_wo' }, [
    K('[sapaan dari tim sales] Halo', t0), L('Ok. Boleh minta PL nya ka', t0 + 6e4), K('[kirim PDF pricelist] + gambar ringkas paket unlimited', t0 + 12e4),
    K('[kirim PDF profil rekanan]\nProfil rekanan', t0 + 13e4), L('sebentar ya kak, kita tampung dulu', t0 + 864e5)], null);
  assert.match(violetta, /BALASAN MANUSIA: 2×/);
  assert.match(violetta, /FILE TERKIRIM: pricelist \(.*\), profil rekanan/);
  assert.match(violetta, /belum dibalas manusia: 0/);
  assert.match(violetta, /LEAD MINTA WAKTU: ya \("sebentar ya kak/);
  assert.match(faktaLead({ nama: 'PT X', segmen: 'corporate' }, [], null), /calon klien/);
  assert.ok(otomatis('Sebelumnya, list plan ini mohon dibantu untuk diisi dulu ya: [WEDDING / BIRTHDAY]'));
  assert.ok(!otomatis('ini form datanya kak, sudah saya isi'), 'form data dari manusia bukan sambutan');
  assert.strictEqual(tanpaAngka('Paket 3 jam Rp 2.500.000. Rekanan dapat 10%.'), 'Paket 3 jam Rp 2.500.000. Rekanan dapat 10%.');
  assert.strictEqual(tanpaAngka('Bisa 15% kok. Kabari ya.'), 'Kabari ya.');
  assert.strictEqual(faktaLead(null), '');
  console.log('UJI PROSPEK WA LOLOS');
}
