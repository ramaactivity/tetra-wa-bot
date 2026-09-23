// Probe diagnostik: lihat perilaku asli Baileys saat unregistered + pairing.
// Tidak menyentuh bot yang jalan. Hanya cetak event connection.update apa adanya.
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const AUTH_DIR = path.join(__dirname, 'auth_info.probe');

(async () => {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  console.log('Baileys version dari server:', version);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'info' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: true,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (u) => {
    console.log('CONN UPDATE:', JSON.stringify({
      connection: u.connection,
      qr: u.qr ? '(qr ada, ' + u.qr.length + ' char)' : null,
      lastDisconnect: u.lastDisconnect
        ? (u.lastDisconnect.error instanceof Boom
          ? 'Boom status=' + u.lastDisconnect.error.output.statusCode + ' msg=' + u.lastDisconnect.error.message
          : String(u.lastDisconnect.error || u.lastDisconnect))
        : null,
    }));
  });

  const pairNumber = String(process.env.PAIR_NUMBER || '').replace(/\D/g, '');
  console.log('PAIR_NUMBER:', pairNumber);

  // Coba request pairing code setelah 3 detik
  setTimeout(async () => {
    try {
      const code = await sock.requestPairingCode(pairNumber);
      console.log('PAIRING CODE:', code);
    } catch (e) {
      console.log('PAIRING CODE GAGAL:', e.message);
    }
  }, 3000);

  // Berhenti setelah 20 detik
  setTimeout(() => {
    console.log('--- probe selesai, keluar ---');
    process.exit(0);
  }, 20000);
})();
