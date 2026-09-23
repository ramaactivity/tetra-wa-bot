// Entry point Tetra WA Bot. Semua logika ada di src/.

// Muat env SEKALI di awal, sebelum modul lain membaca process.env. Baca .env.local
// (dipakai server ini) DULU lalu .env (kalau ada); dotenv tak menimpa var yang sudah
// di-set, jadi .env.local menang & .env jadi cadangan. Kedua file opsional — env juga
// bisa diinject pm2/systemd.
const path = require('path');
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '.env.local') });
  dotenv.config({ path: path.join(__dirname, '.env') });
} catch {
  /* dotenv opsional */
}

const { startBot } = require('./src/bot');

// Jaga-jaga: error tak tertangani TIDAK boleh mematikan bot. Proses yang mati
// mendadak = shutdown kotor = session WA bisa korup (akar "Bad MAC").
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught exception:', err && err.message ? err.message : err);
  // sengaja tidak exit — biar bot tetap hidup; kalau benar-benar fatal, pm2 restart
});

startBot().catch((e) => console.error('Fatal:', e));
