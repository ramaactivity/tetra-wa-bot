// Contoh percakapan nyata untuk prompt V2 (Tahap 2, Rama 11 Nov 2026: "balasnya template, tidak adaptif").
// Bot belajar dari potongan chat asli yang BERHASIL/GAGAL, bukan dari daftar larangan. Perpustakaan dirawat CS Mintet
// (profil Hermes tetra-wa-bot, references/contoh.md; format tetap: "## C-001 | berhasil|gagal | <jenis> | <tgl>" lalu
// Situasi:/Klien:/Balasan:/Hasil:/Kenapa:). File dibaca tiap panggilan, jadi entri baru langsung terpakai.
// ponytail: kemiripan = irisan kata, cukup untuk puluhan–ratusan entri; ganti embedding kalau perpustakaan ribuan.
const fs = require('fs');
const path = require('path');

const CONTOH_FILE = () => process.env.CONTOH_FILE ||
  path.join(process.env.HOME || '/home/ubuntu', '.hermes/profiles/tetra-wa-bot/skills/cs-mintet-pelajaran/references/contoh.md');

const STOP = new Set('yang dan atau untuk dengan dari ini itu ada aku kak kami saya bisa juga sudah udah mau tapi kalau buat nya'
  .split(' '));
const kata = (t) => new Set(String(t).toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
  .filter((w) => w.length >= 3 && !STOP.has(w)));

function urai(isi) {
  return isi.split(/^## (?=C-\d+)/m).slice(1).map((blok) => {
    const [kepala, ...badan] = blok.split('\n');
    const [id, hasil, jenis] = kepala.split('|').map((s) => s.trim());
    const teks = badan.join('\n').replace(/<!--[\s\S]*?-->/g, '').trim();
    const bagian = (k) => (teks.match(new RegExp(`^${k}:\\s*([\\s\\S]*?)(?=^\\w+:|$(?![\\s\\S]))`, 'm')) || [])[1]?.trim() || '';
    return { id, berhasil: /berhasil/i.test(hasil), jenis: (jenis || '').toLowerCase(), teks,
      kunci: kata(bagian('Situasi') + ' ' + bagian('Klien')) };
  }).filter((c) => c.id && c.teks);
}

// Jenis situasi dari konteks lead (penanda yang ditulis messages.js / prospekWa / klienBooking).
function jenisDari(konteks) {
  const k = String(konteks || '');
  if (/KLIEN SUDAH BOOKING/.test(k)) return 'klien booking';
  if (/VENDOR|REKANAN/.test(k)) return 'rekanan';
  return 'lead baru';
}

// Pilih maks 2 contoh berhasil + 1 gagal yang paling mirip. Kosong kalau perpustakaan tidak ada.
function pilih(pesan, history = [], konteks = '', n = 2) {
  let semua;
  try { semua = urai(fs.readFileSync(CONTOH_FILE(), 'utf-8')); } catch { return []; }
  const q = kata([pesan, ...history.filter((m) => m.role === 'user').slice(-2).map((m) => m.content)].join(' '));
  const jenis = jenisDari(konteks);
  const skor = (c) => {
    let irisan = 0;
    for (const w of c.kunci) if (q.has(w)) irisan++;
    return irisan / Math.sqrt((c.kunci.size || 1) * (q.size || 1)) + (c.jenis.includes(jenis) ? 0.15 : 0);
  };
  const urut = semua.map((c) => ({ c, s: skor(c) })).sort((a, b) => b.s - a.s);
  return [...urut.filter((x) => x.c.berhasil).slice(0, n), ...urut.filter((x) => !x.c.berhasil).slice(0, 1)]
    .filter((x) => x.s > 0).map((x) => x.c);
}

// Nominal di contoh dimasking: harga lama tidak boleh jadi "sumber harga" penjaga, dan FAQ tetap satu-satunya acuan.
function blokPrompt(pesan, history, konteks) {
  const c = pilih(pesan, history, konteks);
  if (!c.length) return '';
  return '\n\nCONTOH PERCAKAPAN NYATA (referensi pendekatan, JANGAN salin kalimatnya; harga di contoh disamarkan, pakai HARGA RESMI/FAQ):\n' +
    c.map((x) => `--- ${x.berhasil ? 'BERHASIL (tiru cara berpikirnya)' : 'GAGAL (hindari pendekatannya)'} | ${x.jenis}\n` +
      x.teks.replace(/Rp\s?[\d.,]+(\s?(jt|juta|rb|ribu|k)\b)?/gi, 'Rp …')).join('\n');
}

module.exports = { pilih, blokPrompt, urai, jenisDari };

if (require.main === module) {
  // Uji cepat tanpa jaringan: node src/lib/contoh.js
  const assert = require('assert');
  const os = require('os');
  const f = path.join(os.tmpdir(), `contoh-uji-${process.pid}.md`);
  fs.writeFileSync(f, ['# judul', '## C-001 | berhasil | lead baru | 1 Nov', 'Situasi: Wedding di Bogor tanya harga 3 jam',
    'Klien: kak harga 3 jam berapa untuk wedding?', 'Balasan: 3 jam Rp 2.500.000 ya Kak.', 'Hasil: membalas', 'Kenapa: tepat',
    '## C-002 | gagal | lead baru | 2 Nov', 'Situasi: Kantor minta penawaran resmi gathering', 'Klien: minta quotation gathering kantor',
    'Balasan: x', 'Hasil: diam', 'Kenapa: y', '## C-003 | berhasil | klien booking | 3 Nov', 'Situasi: Klien booking tanya desain frame',
    'Klien: desain frame kapan dikirim?', 'Balasan: z', 'Hasil: membalas', 'Kenapa: w', '<!-- akhir -->'].join('\n'));
  process.env.CONTOH_FILE = f;
  assert.strictEqual(urai(fs.readFileSync(f, 'utf-8')).length, 3);
  const p = pilih('halo kak harga wedding 3 jam berapa ya', [], 'KONTAK PERTAMA');
  assert.strictEqual(p[0].id, 'C-001');
  assert.ok(p.some((c) => !c.berhasil), 'satu contoh gagal ikut');
  assert.strictEqual(pilih('desain frame acaraku gimana', [], 'KLIEN SUDAH BOOKING: 28 Nov')[0].id, 'C-003');
  const b = blokPrompt('harga wedding 3 jam', [], '');
  assert.ok(b.includes('Rp …') && !/2\.500\.000/.test(b), 'nominal dimasking');
  process.env.CONTOH_FILE = path.join(os.tmpdir(), 'tidak-ada.md');
  assert.deepStrictEqual(pilih('apa saja'), []);
  fs.unlinkSync(f);
  console.log('UJI CONTOH LOLOS');
}
