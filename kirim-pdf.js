#!/usr/bin/env node
// Kirim PDF dari assets/ ke satu nomor WhatsApp, lewat antrean bot_commands.
//
//   node kirim-pdf.js 6281234567890
//   node kirim-pdf.js 6281234567890 "PRICELIST TETRA PHOTOBOOTH.pdf"
//
// Kenapa lewat antrean, bukan kirim langsung: koneksi WhatsApp hidup di dalam
// proses bot (pm2). Proses lain tidak bisa memakai socket itu. Jadi perintah
// dititipkan ke tabel bot_commands, dan bot yang sedang online mengeksekusinya
// dalam <=10 detik. Skrip ini menunggu sampai statusnya berubah lalu melapor.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const nomor = String(process.argv[2] || '').replace(/\D/g, '');
const berkas = process.argv[3] || '';

if (nomor.length < 8 || nomor.length > 15) {
  console.error('Pakai: node kirim-pdf.js <nomor 62xxx> ["Nama Berkas.pdf"]');
  process.exit(1);
}

const perintah = berkas ? `send-pdf:${nomor}:${berkas}` : `send-pdf:${nomor}`;

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supa
    .from('bot_commands')
    .insert({ command: perintah, status: 'pending' })
    .select('id')
    .single();
  if (error) {
    console.error('Gagal menitipkan perintah:', error.message);
    process.exit(1);
  }
  console.log(`Perintah "${perintah}" masuk antrean (id=${data.id}). Menunggu bot...`);

  // Bot memeriksa antrean tiap 10 detik; beri waktu 60 detik sebelum menyerah.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data: row } = await supa
      .from('bot_commands')
      .select('status, result')
      .eq('id', data.id)
      .single();
    if (row && row.status !== 'pending') {
      console.log(`${row.status === 'done' ? 'BERHASIL' : 'GAGAL'}: ${row.result}`);
      process.exit(row.status === 'done' ? 0 : 1);
    }
  }
  console.error('Waktu habis 60 detik — bot tidak mengambil perintahnya. Cek: pm2 list');
  process.exit(1);
})();
