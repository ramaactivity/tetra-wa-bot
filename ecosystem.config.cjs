// Konfigurasi PM2 untuk Tetra WA Bot + Tetra Guard (watchdog).
// Dipakai saat `pm2 start ecosystem.config.cjs` (atau `pm2 reload`).
// Kebijakan restart di sini memastikan keduanya bangkit lagi otomatis
// setelah crash/reboot VPS (dikombinasikan dengan `pm2 save` + `pm2 startup`).
module.exports = {
  apps: [
    {
      name: 'tetra-bot',
      script: 'index.js',
      cwd: '/home/ubuntu/tetra-wa-bot',
      interpreter: 'node',
      // JANGAN mati permanen: nyalakan ulang terus, dengan batas tinggi + jeda
      // antar restart supaya tidak thrash dan supaya PM2 tidak "menyerah".
      autorestart: true,
      max_restarts: 1000,
      min_uptime: '30s',
      restart_delay: 3000,
      // Restart otomatis kalau bocor memori (gejala umum proses Node lama jalan).
      max_memory_restart: '512M',
      // Log ke file PM2 standar supaya guard bisa memindai isinya.
      out_file: '/home/ubuntu/.pm2/logs/tetra-bot-out.log',
      error_file: '/home/ubuntu/.pm2/logs/tetra-bot-error.log',
      merge_logs: true,
      time: true,
      // Crash tak tertangani di bot sudah ditahan di index.js (uncaughtException),
      // jadi proses hampir tak pernah exit sendiri; autorestart di sini cadangan.
      kill_timeout: 5000,
    },
    {
      name: 'tetra-guard',
      script: 'guard.js',
      cwd: '/home/ubuntu/tetra-wa-bot',
      interpreter: 'node',
      autorestart: true,
      max_restarts: 1000,
      min_uptime: '30s',
      restart_delay: 3000,
      max_memory_restart: '256M',
      out_file: '/home/ubuntu/.pm2/logs/tetra-guard-out.log',
      error_file: '/home/ubuntu/.pm2/logs/tetra-guard-error.log',
      merge_logs: true,
      time: true,
      kill_timeout: 5000,
    },
  ],
};
