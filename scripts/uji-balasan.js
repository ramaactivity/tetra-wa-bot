#!/usr/bin/env node
// Alat uji untuk CS Mintet (agent Hermes pelatih, profil tetra-wa-bot): kirim satu situasi chat ke otak Hermes cs-wa lewat
// jalur yang SAMA PERSIS dengan klien (getAIResponse: Runs API cs-wa + semua penjaga Node), lalu cetak balasannya.
// TIDAK mengirim apa pun ke WhatsApp dan tidak menulis riwayat klien. Dipakai untuk membuktikan pelajaran baru benar-benar
// mengubah balasan (Rama 16 Nov: "harus bisa terus belajar dan bertumbuh… mengoreksi dirinya sendiri").
//
// Pakai: node ~/tetra-wa-bot/scripts/uji-balasan.js --pesan "kak harga 3 jam?" [--riwayat /tmp/r.json] [--konteks "Panggilan klien: Kak Rina"]
//   --riwayat: file JSON berisi array [{"role":"user"|"assistant","content":"..."}]; balasan admin manusia diawali "(admin) ".
// Keluaran: satu baris JSON {"balasan": "...", "detik": n} atau {"error": "..."}.
const path = require('path');
const fs = require('fs');
process.chdir(path.join(__dirname, '..'));
const dot = require('dotenv');
dot.config({ path: '.env.local' });
dot.config({ path: '.env' });

const arg = (nama) => { const i = process.argv.indexOf(`--${nama}`); return i > 0 ? process.argv[i + 1] : undefined; };
const pesan = arg('pesan');
if (!pesan) { console.log(JSON.stringify({ error: 'wajib --pesan "<pesan klien>"' })); process.exit(2); }
let riwayat = [];
if (arg('riwayat')) {
  try { riwayat = JSON.parse(fs.readFileSync(arg('riwayat'), 'utf-8')); } catch (e) { console.log(JSON.stringify({ error: `riwayat tidak terbaca: ${e.message}` })); process.exit(2); }
  if (!Array.isArray(riwayat)) { console.log(JSON.stringify({ error: 'riwayat harus array' })); process.exit(2); }
}
if (process.env.AI_OTAK !== 'hermes') console.error('[uji-balasan] PERINGATAN: AI_OTAK bukan hermes, hasil bukan dari cs-wa');
const anggaran = require('../src/lib/anggaranUji');
try {
  anggaran.periksaDanCatat('uji_balasan', { pesan });
} catch (err) {
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
}
const ai = require('../src/lib/ai');
(async () => {
  const t = Date.now();
  const balasan = await ai.getAIResponse(riwayat.map((m) => ({ role: m.role, content: String(m.content || '') })), pesan, arg('konteks') || 'Panggilan klien: Kak');
  console.log(JSON.stringify({ balasan, detik: Math.round((Date.now() - t) / 1000) }));
  process.exit(0);
})().catch((e) => { console.log(JSON.stringify({ error: e.message })); process.exit(1); });
