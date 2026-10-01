// Kenali vendor rekanan (WO/EO/party planner) dari nomor HP pengirim.
// Daftar nomor: Tetra Ops (contacts.type = 'vendor'), jadi vendor baru yang diinput
// Rama otomatis dikenali. Kesepakatan harga & gaya per vendor: docs/VENDOR-REKANAN.md
// (dibaca tiap panggilan, tanpa restart). Keputusan Rama 30 Sep 2026.
const fs = require('fs');
const path = require('path');
const supa = require('./supa');

const FILE = path.join(__dirname, '..', '..', 'docs', 'VENDOR-REKANAN.md');
const digit = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.startsWith('0') ? '62' + d.slice(1) : d; };
const bacaFile = () => { try { return fs.readFileSync(FILE, 'utf8'); } catch { return ''; } };
const aturanUmum = (teks) => (teks.match(/## Aturan umum[\s\S]*?(?=\n## |$)/) || [''])[0].trim();
const bagian = (teks, nomor) => (teks.match(new RegExp(`\\n## ${nomor}\\b[\\s\\S]*?(?=\\n## |$)`)) || [''])[0].trim();

// null = bukan vendor terdaftar.
async function cari(nomor) {
  const n = digit(nomor);
  if (n.length < 8) return null;
  const teks = bacaFile();
  const khusus = bagian(teks, n);
  const v = (await supa.fetchVendorContacts()).find((x) => digit(x.phone) === n);
  if (!v && !khusus) return null;
  const nama = v?.name || (khusus.match(/— ([^(\n]+)/) || [])[1]?.trim() || 'Vendor';
  return { nomor: n, nama, khusus, aturan: aturanUmum(teks) };
}

// Konteks untuk AI balasan & follow-up.
function konteks(v) {
  if (!v) return '';
  return `\n\nKONTAK INI VENDOR REKANAN: ${v.nama}. Ikuti ATURAN VENDOR di bawah (menggantikan aturan KONTAK PERTAMA & gaya sales).\n` +
    `${v.khusus || '(Belum ada kesepakatan harga tertulis untuk vendor ini: harga apa pun dicek admin, pakai [INFO_ADMIN].)'}\n\n${v.aturan}`;
}

module.exports = { cari, konteks, digit };
