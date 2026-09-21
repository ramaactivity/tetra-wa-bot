// Boot & lifecycle koneksi WhatsApp (Baileys).
//  - Session via useMultiFileAuthState('auth_info') → restart tak perlu scan ulang.
//  - Render QR ASCII saat butuh pairing.
//  - Auto-reconnect kecuali DisconnectReason.loggedOut (device di-unlink).
//  - Publish status + QR ke Supabase (bot_status) & proses command queue
//    (bot_commands) dari dashboard Tetra Ops — semua best-effort, tak mematikan
//    bot kalau DB tak terjangkau.
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');

const { registerMessageHandler } = require('./handlers/messages');
const { getSentMessage, rememberBotMsg } = require('./lib/botMessages');
const deliveryLog = require('./lib/deliveryLog');
const reminder = require('./lib/reminder');
const supa = require('./lib/supa');
const live = require('./lib/liveConfig');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');

// Referensi socket aktif (di-update tiap (re)connect) supaya command poller bisa
// logout/akses socket terbaru meski startBot dipanggil ulang saat reconnect.
let currentSock = null;
let pollerStarted = false;
let isConnected = false; // true hanya saat link WA 'open' → dipakai gating healthcheck ping

// Dead-man's switch: lapor "hidup" ke healthchecks.io (alert email/Telegram kalau berhenti).
// Best-effort; cuma jalan kalau HEALTHCHECK_URL diset di .env.
function hcPing() {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    fetch(url, { signal: AbortSignal.timeout(10000) }).catch(() => {});
  } catch (_) {
    /* abaikan — jangan sampai matikan bot */
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // ganti ke 'info' kalau mau debug
    browser: ['Tetra Bot', 'Chrome', '1.0.0'],
    // Layani retry-receipt: kalau device penerima gagal decrypt, ia minta kirim
    // ulang & Baileys ambil isi pesan asli dari sini untuk re-encrypt. Tanpa ini
    // pesan nyangkut "Waiting for this message" selamanya di sisi penerima.
    getMessage: async (key) => getSentMessage(key.id) || undefined,
  });
  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log(
        '\n📷 Scan QR ini dari WhatsApp HP Tetra (Setelan → Perangkat Tertaut → Tautkan Perangkat):\n'
      );
      qrcode.generate(qr, { small: true });
      // Publish QR string ke dashboard supaya bisa discan dari web.
      supa.updateStatus({ connection: 'connecting', qr });
    }

    if (connection === 'connecting') {
      isConnected = false;
      supa.updateStatus({ connection: 'connecting' });
    }

    if (connection === 'open') {
      isConnected = true;
      console.log('✅ Bot tersambung & siap. Menunggu pesan masuk...');
      supa.updateStatus({
        connection: 'open',
        qr: null,
        last_connected_at: new Date().toISOString(),
      });
      hcPing(); // ping pertama langsung saat tersambung
    }

    if (connection === 'close') {
      isConnected = false;
      const code =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : null;
      if (code === DisconnectReason.loggedOut) {
        console.log(
          '❌ Device di-unlink. Hapus folder auth_info lalu start ulang untuk scan QR baru.'
        );
        supa.updateStatus({ connection: 'logged_out', qr: null });
      } else {
        console.log('🔄 Koneksi putus, menyambung ulang...');
        supa.updateStatus({ connection: 'close' });
        startBot();
      }
    }
  });

  registerMessageHandler(sock);
  deliveryLog.register(sock); // log tanda-terima (delivered/read) tiap pesan keluar

  // Start sekali: refresh remote config + poll command queue + heartbeat.
  if (!pollerStarted) {
    pollerStarted = true;
    live.start(60000); // refresh bot_settings/rules/paused tiap 60 dtk
    startCommandPoller();
    reminder.start(() => currentSock); // pengingat lead belum dibales ke admin
    // Heartbeat: bukti proses bot hidup → dashboard bisa deteksi "bot mati"
    // (kalau bot_status.updated_at basi > beberapa menit = proses mati/VPS down).
    // Field `connection` (open/close/logged_out) tetap menandai status link WA.
    const hb = setInterval(() => {
      supa.updateStatus({}); // best-effort: cuma bump updated_at
    }, 90000);
    if (hb.unref) hb.unref();

    // Dead-man's switch: ping healthchecks.io tiap 60 dtk HANYA saat link WA sehat.
    // Bot mati / logout / VPS down → ping berhenti → healthchecks kirim alert email/Telegram.
    const hc = setInterval(() => {
      if (isConnected) hcPing();
    }, 60000);
    if (hc.unref) hc.unref();
  }

  return sock;
}

// Poll bot_commands (status='pending') tiap 10 dtk → eksekusi → update status.
//  - reconnect / restart : exit proses; pm2 menyalakan ulang (auto-reconnect /
//    munculkan QR kalau perlu pairing).
//  - logout              : unlink device (sock.logout) → butuh scan QR ulang.
function startCommandPoller() {
  const POLL_MS = 10000;
  const tick = async () => {
    const cmds = await supa.fetchPendingCommands();
    for (const c of cmds) {
      try {
        if (c.command === 'logout') {
          await supa.markCommand(c.id, 'done', 'logout dijalankan');
          try {
            if (currentSock) await currentSock.logout();
          } catch (e) {
            console.error('[cmd] logout:', e.message);
          }
          supa.updateStatus({ connection: 'logged_out', qr: null });
        } else if (c.command === 'reconnect' || c.command === 'restart') {
          await supa.markCommand(c.id, 'done', `${c.command} dijalankan`);
          console.log(`♻️  Perintah "${c.command}" — proses keluar, pm2 restart.`);
          setTimeout(() => process.exit(0), 500);
        } else if (c.command === 'test-notify') {
          // Diagnostik: kirim 1 pesan tes ke ADMIN_NOTIFY_JID lewat socket aktif
          // (tanpa koneksi WA kedua) untuk verifikasi pengiriman ke admin sehat.
          const adminJid = live.get().ADMIN_NOTIFY_JID;
          if (!adminJid) {
            await supa.markCommand(c.id, 'error', 'ADMIN_NOTIFY_JID kosong');
          } else if (!currentSock) {
            await supa.markCommand(c.id, 'error', 'socket belum siap');
          } else {
            const text =
              `🧪 *Tes notif bot Tetra*\n` +
              `Kalau kamu lihat teks ini (bukan "Waiting for this message"), ` +
              `pengiriman notif ke admin sudah normal.`;
            const sent = await currentSock.sendMessage(adminJid, { text });
            rememberBotMsg(sent); // cache → retry-receipt bisa dilayani getMessage
            deliveryLog.track(sent, 'test-notify→admin'); // pantau sampai/dibaca
            await supa.markCommand(c.id, 'done', `terkirim id=${sent?.key?.id || '?'}`);
            console.log(`🧪 test-notify terkirim ke ${adminJid} (id=${sent?.key?.id})`);
          }
        } else {
          await supa.markCommand(c.id, 'error', `Perintah tak dikenal: ${c.command}`);
        }
      } catch (e) {
        console.error('[cmd] gagal proses:', e.message);
        await supa.markCommand(c.id, 'error', e.message);
      }
    }
  };
  const t = setInterval(() => tick().catch((e) => console.error('[cmd] poller:', e.message)), POLL_MS);
  if (t.unref) t.unref();
}

module.exports = { startBot };
