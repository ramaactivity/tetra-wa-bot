#!/usr/bin/env node
// Terbitkan kode pairing WhatsApp untuk bot Tetra dan kirim ke Telegram (topic
// Server Status), supaya orang yang memegang HP Tetra bisa langsung mengetiknya.
//
//   node pairing.js            -> hanya kalau bot belum terdaftar
//   node pairing.js --paksa    -> putus session yang ada (auth_info dihapus), pairing dari nol
//
// Kenapa bukan restart tiap 5 menit seperti guard lama: kode pairing hanya berguna
// saat ada manusia yang siap mengetik. Diterbitkan on-demand, dikirim ke Telegram,
// selesai. Bot tetap satu-satunya penulis auth_info; skrip ini tidak menyentuhnya
// kecuali dengan --paksa, dan itu pun setelah bot dihentikan dulu.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PM2 = '/home/ubuntu/.npm-global/bin/pm2';
const AUTH_DIR = path.join(__dirname, 'auth_info');
const PAIR_FILE = path.join(__dirname, 'PAIRING-CODE.txt');
const paksa = process.argv.includes('--paksa');

const pm2 = (args) => execFileSync(PM2, args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

function terdaftar() {
  try { return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8')).registered === true; }
  catch { return false; }
}

async function kirimTelegram(teks) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return console.log('(TELEGRAM_BOT_TOKEN kosong — kode tidak dikirim ke Telegram)');
  const body = new URLSearchParams({
    chat_id: process.env.GUARD_TELEGRAM_CHAT_ID || '-1004377661750',
    message_thread_id: process.env.GUARD_TELEGRAM_THREAD_ID || '6',
    parse_mode: 'Markdown',
    text: teks,
  });
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  console.log(res.ok ? 'Kode dikirim ke Telegram (topic Server Status).' : `Telegram gagal: HTTP ${res.status}`);
}

(async () => {
  if (!String(process.env.PAIR_NUMBER || '').replace(/\D/g, '')) {
    console.error('PAIR_NUMBER belum diisi di .env (nomor WA HP Tetra, format 62xxx).');
    process.exit(1);
  }
  if (terdaftar() && !paksa) {
    console.error('Bot masih terdaftar (session ada). Kalau memang mau pairing ulang dari nol: node pairing.js --paksa');
    process.exit(1);
  }
  // Selalu mulai dari kunci identitas BARU. Terbukti 23 Sep 2026: creds.json yang
  // belum terdaftar tapi sudah pernah dipakai untuk permintaan kode yang gagal,
  // kalau dipakai lagi, ditolak WhatsApp dengan 401 dalam 1-3 detik (71x berturut-
  // turut). Dengan auth_info kosong, socket bertahan dan kode bisa dimasukkan.
  console.log(paksa ? 'Menghentikan bot dan membersihkan session lama...' : 'Menghentikan bot, menyiapkan kunci baru...');
  pm2(['stop', 'tetra-bot']);
  await tidur(4000); // beri waktu socket ditutup rapi (SIGTERM handler)
  fs.rmSync(AUTH_DIR, { recursive: true, force: true });

  const mulai = Date.now();
  try { fs.unlinkSync(PAIR_FILE); } catch { /* belum ada */ }
  console.log('Menyalakan ulang bot untuk menerbitkan kode...');
  pm2(['restart', 'tetra-bot']);

  for (let i = 0; i < 30; i++) {
    await tidur(1500);
    try {
      const st = fs.statSync(PAIR_FILE);
      if (st.mtimeMs > mulai) break;
    } catch { /* belum terbit */ }
  }
  let kode = null;
  try { kode = fs.readFileSync(PAIR_FILE, 'utf8').trim().split('\n')[0]; } catch { /* tidak ada */ }
  if (!kode) {
    console.error('Kode tidak terbit dalam 45 detik. Cek: tail -30 ~/.pm2/logs/tetra-bot-out.log');
    process.exit(1);
  }

  console.log(`\n==============================\n  KODE PAIRING: ${kode}\n==============================\nBerlaku ±60 detik.\n`);
  await kirimTelegram(
    `📲 *Kode pairing bot Tetra:* \`${kode}\`\n\n` +
    `Di HP Tetra: WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat → *Tautkan dengan nomor telepon* → ketik kode di atas.\n` +
    `Berlaku ±60 detik. Kalau kedaluwarsa, jalankan lagi \`node pairing.js\`.`
  );
})().catch((e) => { console.error('Gagal:', e.message); process.exit(1); });
