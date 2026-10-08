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
  Browsers,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const { registerMessageHandler } = require('./handlers/messages');
const { sendDocument, delay } = require('./lib/sender');
const { kirimPricelist } = require('./lib/pricelist');
const { getSentMessage, rememberBotMsg } = require('./lib/botMessages');
const deliveryLog = require('./lib/deliveryLog');
const reminder = require('./lib/reminder');
const followup = require('./lib/followupEngine');
const supa = require('./lib/supa');
const live = require('./lib/liveConfig');
const store = require('./lib/store');
const prospekWa = require('./lib/prospekWa');
const relasiWa = require('./lib/relasiWa');
const { kirimGrupAdmin } = require('./lib/notify');
const timWa = require('./lib/timWa');
const portal = require('./lib/portal');

// ── Cache retry dekripsi yang hidup lintas reconnect ─────────────────────────
// Antarmuka CacheStore Baileys: get/set/del/flushAll. TTL per entri.
function buatCache(ttlMs) {
  const m = new Map(); // key -> { v, exp }
  const hidup = (k) => { const e = m.get(k); if (e && e.exp < Date.now()) { m.delete(k); return undefined; } return e; };
  return {
    get: (k) => hidup(k)?.v,
    set: (k, v) => { m.set(k, { v, exp: Date.now() + ttlMs }); if (m.size > 5000) m.delete(m.keys().next().value); },
    del: (k) => m.delete(k),
    flushAll: () => m.clear(),
  };
}
// Baileys: retry >= MAKS -> del(key) lalu berhenti; reconnect berikutnya pesan yang
// sama dikirim ulang server dan hitungan mulai dari 0 lagi (loop tanpa ujung).
// Di sini key yang sudah mencapai batas tidak benar-benar dihapus selama 24 jam,
// jadi Baileys terus melihatnya "sudah habis" dan tidak meminta retry lagi.
// Pesan klien yang gagal tetap dilaporkan ke admin oleh handlers/messages.js.
const RETRY_MAKS = 5; // = maxMsgRetryCount default Baileys
const retryCache = (() => {
  const c = buatCache(24 * 3600 * 1000);
  const del = c.del;
  c.del = (k) => { if ((c.get(k) || 0) < RETRY_MAKS) del(k); };
  return c;
})();
// Tiap permintaan "kirim ulang isi pesan" ke HP memunculkan popup "Syncing with
// WhatsApp on Google Chrome (Ubuntu)" di HP (30 Sep: belasan-puluhan popup beruntun
// saat pesan gagal dibuka setelah reconnect). Dibatasi 3 permintaan / 10 menit:
// Baileys menganggap key yang get()-nya truthy sudah pernah diminta, jadi di atas
// kuota get() mengembalikan true dan tidak ada permintaan baru ke HP.
const KUOTA_SYNC = 3;
const JENDELA_SYNC_MS = 10 * 60 * 1000;
const placeholderResendCache = (() => {
  const c = buatCache(3600 * 1000);
  let riwayatMinta = [];
  const get = c.get, set = c.set;
  c.get = (k) => {
    const v = get(k);
    if (v !== undefined) return v;
    riwayatMinta = riwayatMinta.filter((t) => Date.now() - t < JENDELA_SYNC_MS);
    return riwayatMinta.length >= KUOTA_SYNC ? true : undefined;
  };
  c.set = (k, v) => { riwayatMinta.push(Date.now()); set(k, v); };
  return c;
})();

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');

// Referensi socket aktif (di-update tiap (re)connect) supaya command poller bisa
// logout/akses socket terbaru meski startBot dipanggil ulang saat reconnect.
let currentSock = null;
let pollerStarted = false;
let shuttingDown = false;
let isConnected = false; // true hanya saat link WA 'open' → dipakai gating healthcheck ping
let reconnectTimer = null; // debounce reconnect — cegah dua socket hidup bersamaan
let reconnectAttempts = 0; // backoff eksponensial saat koneksi putus

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

// Backoff eksponensial: 2s → 4s → 8s → ... (maks 30s). Reset saat berhasil open.
function scheduleReconnect(delayOverride) {
  if (reconnectTimer || shuttingDown) return; // sudah dijadwalkan / sedang berhenti
  reconnectAttempts += 1;
  const delay = delayOverride || Math.min(60000, 2000 * Math.pow(2, reconnectAttempts - 1));
  console.log(`[reconnect] coba lagi dalam ${(delay / 1000).toFixed(0)} dtk (percobaan ke-${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBot().catch((e) => console.error('[reconnect] gagal:', e.message));
  }, delay);
  if (reconnectTimer.unref) reconnectTimer.unref();
}

// TIDAK ADA snapshot/restore auth_info. Session Signal harus hanya ditulis oleh
// Baileys sendiri. Menyalin lalu memulihkannya membuat session lokal lebih tua dari
// yang dipegang WhatsApp -> "Bad MAC" / "MessageCounterError" beruntun -> device
// dicabut (401). Itu persis kejadian 23 Sep 2026 11:08. Kalau session rusak, satu-
// satunya jalan yang aman adalah pairing ulang (node pairing.js).

async function startBot() {
  // Kunci belum-terdaftar yang sudah pernah dipakai meminta kode pairing, kalau
  // dipakai lagi, ditolak WhatsApp: 401 "Connection Failure" {reason:401,location:rva}
  // dalam 1-3 detik (23 Sep 2026: 71x berturut-turut). Karena kunci belum-terdaftar
  // tidak menyimpan apa pun yang berharga, mulai saja selalu dari kunci baru.
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8'));
    if (creds.registered === false) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      console.log('🔑 Kunci belum-terdaftar dibuang — pairing selalu dari kunci baru.');
    }
  } catch (_) { /* belum ada auth_info: memang baru */ }
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    // Hitungan retry dekripsi disimpan DI LUAR socket (saran resmi Baileys). Tanpa ini
    // tiap reconnect (500 "Stream Errored (ack)" ±50 menit sekali) mengulang retry
    // pesan lama yang sama dari nol -> badai Bad MAC tiap 50 menit (29-30 Sep 2026).
    msgRetryCounterCache: retryCache,
    placeholderResendCache,
    // Jangan sinkron riwayat penuh saat connect: itu ribuan pesan lama yang harus
    // didekripsi sekaligus -- sumber Bad MAC di awal koneksi, dan tidak dibutuhkan bot.
    syncFullHistory: false,
    // Jangan tandai 'online' otomatis: notifikasi tetap masuk ke HP Tetra.
    markOnlineOnConnect: false,
    logger: pino({ level: 'silent' }), // ganti ke 'info' kalau mau debug
    // Pairing lewat kode HANYA diterima kalau identitas browser-nya dikenal WhatsApp.
    // Nama kustom ('Tetra Bot') membuat WhatsApp menolak dengan "Couldn't link device",
    // padahal nama yang sama tidak masalah untuk jalur QR.
    browser: process.env.PAIR_NUMBER
      ? Browsers.ubuntu('Chrome')
      : ['Tetra Bot', 'Chrome', '1.0.0'],
    // Layani retry-receipt: kalau device penerima gagal decrypt, ia minta kirim
    // ulang & Baileys ambil isi pesan asli dari sini untuk re-encrypt. Tanpa ini
    // pesan nyangkut "Waiting for this message" selamanya di sisi penerima.
    getMessage: async (key) => getSentMessage(key.id) || undefined,
  });
  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  // Pairing lewat KODE, alternatif scan QR. QR di log server praktis tidak bisa discan:
  // blok ASCII-nya terpotong lebar baris dan Baileys menggantinya tiap ~20 detik.
  // Isi PAIR_NUMBER di .env (nomor WA HP Tetra, format 62xxx, tanpa + dan tanpa spasi).
  const pairNumber = String(process.env.PAIR_NUMBER || '').replace(/\D/g, '');
  if (pairNumber && !state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(pairNumber);
        const pretty = String(code).match(/.{1,4}/g).join('-');
        console.log([
          '',
          '==================================================',
          '  KODE PAIRING WHATSAPP: ' + pretty,
          '==================================================',
          '  Di HP Tetra: WhatsApp > Setelan > Perangkat Tertaut',
          '  > Tautkan Perangkat > "Tautkan dengan nomor telepon"',
          '  lalu ketik kode di atas. Berlaku sekitar 60 detik.',
          '',
        ].join('\n'));
        fs.writeFileSync(
          path.join(__dirname, '..', 'PAIRING-CODE.txt'),
          pretty + '\n' + new Date().toISOString() + '\n'
        );
      } catch (e) {
        console.log('Gagal meminta kode pairing:', (e && e.message) || e);
      }
    }, 2000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      // Mode kode pairing aktif -> QR sengaja tidak dicetak. QR di log server tidak
      // bisa discan (terpotong lebar baris) dan hanya membuat log sulit dibaca.
      if (!process.env.PAIR_NUMBER) {
        console.log(
          '\n📷 Scan QR ini dari WhatsApp HP Tetra (Setelan → Perangkat Tertaut → Tautkan Perangkat):\n'
        );
        qrcode.generate(qr, { small: true });
      }
      // Publish QR string ke dashboard supaya bisa discan dari web.
      supa.updateStatus({ connection: 'connecting', qr });
    }

    if (connection === 'connecting') {
      isConnected = false;
      supa.updateStatus({ connection: 'connecting' });
    }

    if (connection === 'open') {
      isConnected = true;
      reconnectAttempts = 0; // reset backoff — koneksi sehat
      console.log('✅ Bot tersambung & siap. Menunggu pesan masuk...');
      // Daftar grup yang diikuti (nama → JID) untuk mengisi ADMIN_GROUP_JID; hanya dicatat di log.
      sock.groupFetchAllParticipating()
        .then((gs) => Object.values(gs).forEach((g) => console.log(`[grup] ${g.id} | ${g.subject} | ${g.participants?.length ?? '?'} anggota`)))
        .catch((e) => console.error('[grup] gagal ambil daftar:', e.message));
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
      const alasan = (lastDisconnect?.error && lastDisconnect.error.message) || '';

      if (code === DisconnectReason.loggedOut) {
        // 401: WhatsApp sendiri yang mencabut device. Restart tidak akan menolong.
        const detail = lastDisconnect?.error?.data ? JSON.stringify(lastDisconnect.error.data).slice(0, 300) : '';
        console.log(`❌ Device di-unlink (401${alasan ? ': ' + alasan : ''}). Tidak menyambung ulang — perlu pairing baru: node pairing.js`);
        if (detail) console.log('   detail 401:', detail);
        supa.updateStatus({ connection: 'logged_out', qr: null });
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        // 440: ada instance LAIN yang memakai session ini. Menyambung ulang berarti
        // berebut session dan berujung Bad MAC. Diam, biar yang satunya dimatikan.
        console.error('⛔ Koneksi DIGANTIKAN instance lain (440). Bot berhenti menyambung. Cari proses ganda: pgrep -af tetra-wa-bot');
        supa.updateStatus({ connection: 'close' });
        return;
      }
      // 500 (badSession, mis. "Stream Errored (ack)") SENGAJA tidak ada di daftar ini:
      // 23 Sep 2026 15:44 bot berhenti menyambung karena 500 dan diam 3+ jam, padahal
      // kunci masih terdaftar. Kalau session memang rusak, WhatsApp akan menjawab 401
      // saat reconnect dan itu ditangani di atas.
      if (
        code === DisconnectReason.forbidden ||
        code === DisconnectReason.multideviceMismatch
      ) {
        console.error(`⛔ Koneksi ditolak WhatsApp (${code}: ${alasan}). Tidak menyambung ulang — perlu pairing baru: node pairing.js`);
        supa.updateStatus({ connection: 'logged_out', qr: null });
        return;
      }
      if (code === DisconnectReason.restartRequired) {
        // 515: normal tepat setelah pairing berhasil — WhatsApp minta socket dibuka ulang.
        console.log('🔄 WhatsApp minta socket dibuka ulang (515) — menyambung segera.');
        try { sock.end(undefined); } catch (_) { /* sudah tertutup */ }
        reconnectAttempts = 0;
        scheduleReconnect(1000);
        return;
      }
      if (!sock.authState?.creds?.registered) {
        // Belum terdaftar dan kode tidak dimasukkan sampai kedaluwarsa. Jangan
        // memancing kode baru sendiri -- itu loop 5-menit versi lama. Pairing adalah
        // tindakan manusia: node pairing.js.
        console.log('⏸️  Kode pairing kedaluwarsa tanpa dimasukkan. Bot menunggu; jalankan: node pairing.js');
        supa.updateStatus({ connection: 'close' });
        return;
      }
      // 408 timeout / 428 closed / 503 unavailable / tanpa kode: gangguan jaringan biasa.
      console.log(`🔄 Koneksi putus (${code ?? 'tanpa kode'}${alasan ? ': ' + alasan : ''}), menyambung ulang dengan backoff...`);
      supa.updateStatus({ connection: 'close' });
      try { sock.end(undefined); } catch (_) { /* sudah tertutup */ }
      scheduleReconnect();
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
    followup.start(() => (isConnected ? currentSock : null)); // jangan kirim saat link belum sehat // follow-up AI ke lead yang diam 1–7 hari
    // Heartbeat: bukti proses bot hidup → dashboard bisa deteksi "bot mati"
    // (kalau bot_status.updated_at basi > beberapa menit = proses mati/VPS down).
    // Field `connection` (open/close/logged_out) tetap menandai status link WA.
    const hb = setInterval(() => {
      // Selain bump updated_at, TEGASKAN ULANG status sebenarnya. Ada instance lain
      // (kode lama, di luar VPS ini) yang menulis logged_out ke baris yang sama tiap
      // beberapa detik (terbukti 23 Sep 12:33). Dengan ini, dashboard Tetra Ops paling
      // lama salah 90 detik, bukan selamanya.
      supa.updateStatus(isConnected ? { connection: 'open' } : {});
    }, 90000);
    // PENTING: interval ini HARUS tetap "ref" (jangan di-unref). Kalau socket
    // WA tertutup — mis. saat belum terdaftar (menunggu pairing) atau setelah
    // logged out — tidak ada handle aktif lain (semua timer lain di-unref),
    // sehingga event loop kosong dan proses keluar sendiri dengan kode 0.
    // PM2 lalu restart, dan bot crash-loop tiap ~8 detik: pairing code berganti
    // terus, mustahil dimasukkan. Satu interval ref'd ini menjaga proses tetap
    // hidup & stabil (PM2 tetap jadi lapis restart kalau benar-benar crash).

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
// -- Berkas & kalimat untuk perintah send-pdf -------------------------------
// Urutan kirim: GAMBAR dulu (harga langsung kebaca tanpa membuka lampiran),
// lalu PDF untuk yang mau lihat lengkapnya. Ubah kalimatnya di sini. Semua
// berkas wajib berada di dalam folder assets/.
const GAMBAR_RINGKAS = 'UNLIMITED PHOTOBOOTH.jpg';
const CAPTION_GAMBAR = 'Ini paket unlimited cetak ya kak, harganya sudah all-in.';

const DEFAULT_PDF = 'PRICELIST TETRA PHOTOBOOTH.pdf';
const CAPTION_PDF = 'Kalau mau cek lengkapnya, ada di pricelist ini kak.';

// PDF invoice hanya boleh diunduh dari tetra-ops: baris bot_commands bisa disisipkan
// siapa pun yang punya akses Supabase, jadi URL asing ditolak.
const TETRA_OPS_ORIGIN = process.env.TETRA_OPS_ORIGIN || 'https://tetra-ops-lac.vercel.app';
async function kirimInvoice(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch (_) {
    return { ok: false, pesan: 'payload bukan JSON' };
  }
  const nomor = String(p.nomor || '').replace(/\D/g, '');
  const pesan = String(p.pesan || '').trim();
  const namaFile = String(p.nama_file || 'Invoice.pdf').replace(/[\\/:*?"<>|]+/g, '');
  let url;
  try {
    url = new URL(String(p.pdf_url || ''));
  } catch (_) {
    return { ok: false, pesan: 'pdf_url tidak sah' };
  }
  if (nomor.length < 8 || nomor.length > 15) return { ok: false, pesan: `Nomor tidak wajar: "${p.nomor}"` };
  if (!pesan || pesan.length > 1500) return { ok: false, pesan: 'pesan kosong / terlalu panjang' };
  if (url.origin !== TETRA_OPS_ORIGIN) return { ok: false, pesan: `pdf_url bukan dari ${TETRA_OPS_ORIGIN}` };
  if (!currentSock || !isConnected) return { ok: false, pesan: 'socket belum siap' };

  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const tipe = res.headers.get('content-type') || '';
  if (!res.ok || !tipe.includes('pdf')) return { ok: false, pesan: `unduh PDF gagal: HTTP ${res.status} ${tipe}` };
  const pdf = Buffer.from(await res.arrayBuffer());
  if (pdf.length > 10 * 1024 * 1024) return { ok: false, pesan: 'PDF > 10 MB' };

  const jid = `${nomor}@s.whatsapp.net`;
  await currentSock.sendPresenceUpdate('composing', jid);
  await delay(Math.min(8000, 2000 + pesan.length * 20));
  await currentSock.sendPresenceUpdate('paused', jid);
  const sentTeks = await currentSock.sendMessage(jid, { text: pesan });
  rememberBotMsg(sentTeks);
  deliveryLog.track(sentTeks, 'dokumen→customer');
  await delay(1500);
  const sentPdf = await currentSock.sendMessage(jid, { document: pdf, fileName: namaFile, mimetype: 'application/pdf' });
  rememberBotMsg(sentPdf);
  // Masuk riwayat supaya AI paham konteksnya kalau klien membalas pengingat ini.
  store.tambahRiwayat(jid, 'assistant', `${pesan}\n[terlampir: ${namaFile}]`);
  console.log(`🧾 Dokumen ${namaFile} + pesan terkirim ke ${nomor}`);
  return { ok: true, pesan: `terkirim ke ${nomor} teks=${sentTeks?.key?.id} pdf=${sentPdf?.key?.id}` };
}
// Dari agent Sales (Bruno) lewat Tetra Ops prospek_kirim_wa: sapaan pertama ke
// prospek. Format: send-text:{"nomor","pesan"}. Rem (kuota 15/hari, jam kerja,
// jeda acak, sekali per nomor) ada di lib/prospekWa.js. Pesan masuk riwayat
// supaya AI CS paham konteksnya kalau prospek membalas.
// Hasil: { ok, pesan } atau { tunda } (biarkan perintah tetap pending).
async function kirimTeks(raw) {
  let p;
  try {
    p = JSON.parse(raw);
  } catch (_) {
    return { ok: false, pesan: 'payload bukan JSON' };
  }
  const nomor = String(p.nomor || '').replace(/\D/g, '');
  const pesan = String(p.pesan || '').trim();
  if (!/^628\d{8,11}$/.test(nomor)) return { ok: false, pesan: `Bukan nomor HP Indonesia: "${p.nomor}"` };
  if (!pesan || pesan.length > 1000) return { ok: false, pesan: 'pesan kosong / terlalu panjang' };
  const rem = prospekWa.cek(nomor);
  if (rem.tolak) return { ok: false, pesan: rem.tolak };
  if (rem.tunda) return { tunda: rem.tunda };
  if (!currentSock || !isConnected) return { tunda: 'socket belum siap' };

  const [cek] = (await currentSock.onWhatsApp(nomor)) || [];
  if (!cek?.exists) return { ok: false, pesan: `${nomor} tidak terdaftar di WhatsApp` };
  const jid = cek.jid;
  await currentSock.sendPresenceUpdate('composing', jid);
  await delay(Math.min(8000, 2000 + pesan.length * 20));
  await currentSock.sendPresenceUpdate('paused', jid);
  const sent = await currentSock.sendMessage(jid, { text: pesan });
  prospekWa.catat(nomor);
  rememberBotMsg(sent);
  deliveryLog.track(sent, 'prospek→wa');
  store.tambahRiwayat(jid, 'assistant', `${pesan}\n[sapaan dari tim sales Tetra]`);
  console.log(`📣 Sapaan prospek terkirim ke ${nomor}`);
  return { ok: true, pesan: `terkirim ke ${nomor} id=${sent?.key?.id}` };
}
// Dari agent Hermes (CS Mintet, Bruno) lewat Tetra Ops wa_kirim_kontak: pesan ke kontak yang
// SUDAH dikenal (klien/vendor/PIC; divalidasi di Tetra Ops). Format: send-relasi:{"nomor","pesan","alasan"}.
// Rem di lib/relasiWa.js. Pesan masuk riwayat supaya CS paham konteks kalau dibalas.
async function kirimRelasi(raw) {
  let p;
  try { p = JSON.parse(raw); } catch (_) { return { ok: false, pesan: 'payload bukan JSON' }; }
  const nomor = String(p.nomor || '').replace(/\D/g, '');
  const pesan = String(p.pesan || '').trim();
  if (!/^628\d{8,11}$/.test(nomor)) return { ok: false, pesan: `Bukan nomor HP Indonesia: "${p.nomor}"` };
  if (!pesan || pesan.length > 1000) return { ok: false, pesan: 'pesan kosong / terlalu panjang' };
  const rem = relasiWa.cek(nomor, pesan);
  if (rem.tolak) return { ok: false, pesan: rem.tolak };
  if (rem.tunda) return { tunda: rem.tunda };
  if (!currentSock || !isConnected) return { tunda: 'socket belum siap' };
  const [cek] = (await currentSock.onWhatsApp(nomor)) || [];
  if (!cek?.exists) return { ok: false, pesan: `${nomor} tidak terdaftar di WhatsApp` };
  const jid = cek.jid;
  await currentSock.sendPresenceUpdate('composing', jid);
  await delay(Math.min(8000, 2000 + pesan.length * 20));
  await currentSock.sendPresenceUpdate('paused', jid);
  const sent = await currentSock.sendMessage(jid, { text: pesan });
  relasiWa.catat(nomor, pesan);
  rememberBotMsg(sent);
  deliveryLog.track(sent, 'relasi→wa');
  store.tambahRiwayat(jid, 'assistant', `${pesan}\n[pesan dari tim Tetra: ${String(p.alasan || '').slice(0, 150)}]`);
  console.log(`💌 Pesan relasi terkirim ke ${nomor} (${String(p.alasan || '').slice(0, 60)})`);
  return { ok: true, pesan: `terkirim ke ${nomor} id=${sent?.key?.id}` };
}
// Dari portal klien Tetra Ops: kabar transaksi (DP diterima / ditolak). Format:
// send-portal:{"nomor","pesan"}. Jatah harian di lib/portal.js (di luar rem sapaan sales).
async function kirimPortal(raw) {
  let p;
  try { p = JSON.parse(raw); } catch (_) { return { ok: false, pesan: 'payload bukan JSON' }; }
  const nomor = String(p.nomor || '').replace(/\D/g, '');
  const pesan = String(p.pesan || '').trim();
  if (!/^628\d{8,11}$/.test(nomor)) return { ok: false, pesan: `Bukan nomor HP Indonesia: "${p.nomor}"` };
  if (!pesan || pesan.length > 1500) return { ok: false, pesan: 'pesan kosong / terlalu panjang' };
  const rem = portal.cek();
  if (rem.tolak) return { ok: false, pesan: rem.tolak };
  if (!currentSock || !isConnected) return { tunda: 'socket belum siap' };
  const [cek] = (await currentSock.onWhatsApp(nomor)) || [];
  if (!cek?.exists) return { ok: false, pesan: `${nomor} tidak terdaftar di WhatsApp` };
  const jid = cek.jid;
  await currentSock.sendPresenceUpdate('composing', jid);
  await delay(Math.min(6000, 1500 + pesan.length * 15));
  await currentSock.sendPresenceUpdate('paused', jid);
  const sent = await currentSock.sendMessage(jid, { text: pesan });
  portal.catat();
  rememberBotMsg(sent);
  deliveryLog.track(sent, 'portal→customer');
  store.tambahRiwayat(jid, 'assistant', `${pesan}\n[otomatis dari portal booking Tetra Ops]`);
  console.log(`🎟️  Pesan portal terkirim ke ${nomor}`);
  return { ok: true, pesan: `terkirim ke ${nomor} id=${sent?.key?.id}` };
}

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
        } else if (c.command.startsWith('hand-back:')) {
          // Format: hand-back:<nomor>
          const [, rawNumber] = c.command.split(':');
          const number = String(rawNumber || '').replace(/\D/g, '');
          const jid = `${number}@s.whatsapp.net`;
          await supa.hapusPause(jid);
          await supa.markCommand(c.id, 'done', `Handoff dilepas untuk ${number}`);
          console.log(`✅ Handoff dilepas untuk ${number}, AI aktif kembali.`);
        } else if (c.command.startsWith('send-pdf:')) {
          // Format: send-pdf:<nomor>[:<berkas di dalam assets/>]
          //   send-pdf:6281234567890
          //   send-pdf:6281234567890:PRICELIST TETRA PHOTOBOOTH.pdf
          const [, rawNumber, rawFile] = c.command.split(':');
          const number = String(rawNumber || '').replace(/\D/g, '');
          const fileName = (rawFile || DEFAULT_PDF).trim();

          // Batas kepercayaan: baris di bot_commands bisa disisipkan siapa pun yang
          // punya akses Supabase. Nomor wajib masuk akal, dan berkas WAJIB berada di
          // dalam assets/ — tanpa ini `../.env` ikut terkirim ke nomor asing.
          const assetsDir = path.join(__dirname, '..', 'assets');
          const filePath = path.resolve(assetsDir, fileName);

          if (number.length < 8 || number.length > 15) {
            await supa.markCommand(c.id, 'error', `Nomor tidak wajar: "${rawNumber}"`);
          } else if (!filePath.startsWith(assetsDir + path.sep)) {
            await supa.markCommand(c.id, 'error', 'Berkas harus berada di dalam assets/');
          } else if (!fs.existsSync(filePath)) {
            await supa.markCommand(c.id, 'error', `Berkas tidak ada: ${fileName}`);
          } else if (!currentSock || !isConnected) {
            await supa.markCommand(c.id, 'error', 'socket belum siap');
          } else {
            const jid = `${number}@s.whatsapp.net`;
            const { idGambar, idPdf } = await kirimPricelist(currentSock, jid, 'send-pdf', { pdf: true });
            console.log(`Pricelist terkirim ke ${number} (gambar=${idGambar} pdf=${idPdf})`);
            await supa.markCommand(c.id, 'done', `terkirim ke ${number} gambar=${idGambar} pdf=${idPdf}`);
          }
        } else if (/^send-(invoice|document):/.test(c.command)) {
          // Dari Tetra Ops: kirim_dokumen, tombol "Kirim ke klien" di Telegram, atau
          // pengingat pelunasan -- owner sudah menyetujui di sana. Format keduanya:
          // send-<jenis>:{"nomor","pesan","pdf_url","nama_file"}
          const hasil = await kirimInvoice(c.command.slice(c.command.indexOf(':') + 1));
          await supa.markCommand(c.id, hasil.ok ? 'done' : 'error', hasil.pesan);
        } else if (c.command.startsWith('send-relasi:')) {
          const hasil = await kirimRelasi(c.command.slice(c.command.indexOf(':') + 1));
          if (!hasil.tunda) await supa.markCommand(c.id, hasil.ok ? 'done' : 'error', hasil.pesan);
        } else if (c.command.startsWith('send-tim:')) {
          // Pengingat tim internal dari agent CS Mintet (8 Okt). Format: send-tim:{"nomor","pesan"}. Rem di lib/timWa.js.
          let p = {};
          try { p = JSON.parse(c.command.slice(c.command.indexOf(':') + 1)); } catch (_) { /* dicek di bawah */ }
          const nomor = String(p.nomor || '').replace(/\D/g, '');
          const pesan = String(p.pesan || '').trim();
          const rem = !pesan || pesan.length > 1500 ? { tolak: 'pesan kosong / terlalu panjang' } : timWa.cek(nomor, pesan);
          if (rem.tolak) await supa.markCommand(c.id, 'error', rem.tolak);
          else if (rem.tunda || !currentSock || !isConnected) { /* biarkan pending */ }
          else {
            const sent = await currentSock.sendMessage(`${nomor}@s.whatsapp.net`, { text: pesan });
            timWa.catat(nomor, pesan);
            rememberBotMsg(sent);
            deliveryLog.track(sent, 'tim→wa');
            store.tambahRiwayat(`${nomor}@s.whatsapp.net`, 'assistant', `${pesan}\n[pengingat tim dari bot CS Mintet]`);
            await supa.markCommand(c.id, 'done', `terkirim ke ${nomor}`);
          }
        } else if (c.command.startsWith('send-grup-admin:')) {
          // Dari Tetra Ops (8 Okt): kabar booking/DP/pelunasan portal ke grup WA admin. Format: send-grup-admin:{"pesan"}
          let p = {};
          try { p = JSON.parse(c.command.slice(c.command.indexOf(':') + 1)); } catch (_) { /* dicek di bawah */ }
          const teks = String(p.pesan || '').trim();
          if (!teks || teks.length > 2000) await supa.markCommand(c.id, 'error', 'pesan kosong / terlalu panjang');
          else if (!currentSock || !isConnected) { /* biarkan pending, dicoba lagi */ }
          else {
            const g = await kirimGrupAdmin(currentSock, teks);
            await supa.markCommand(c.id, g ? 'done' : 'error', g ? 'terkirim ke grup admin' : 'ADMIN_GROUP_JID kosong / gagal kirim');
          }
        } else if (c.command.startsWith('send-portal:')) {
          const hasil = await kirimPortal(c.command.slice(c.command.indexOf(':') + 1));
          if (!hasil.tunda) await supa.markCommand(c.id, hasil.ok ? 'done' : 'error', hasil.pesan);
        } else if (c.command.startsWith('send-text:')) {
          const hasil = await kirimTeks(c.command.slice(c.command.indexOf(':') + 1));
          if (!hasil.tunda) await supa.markCommand(c.id, hasil.ok ? 'done' : 'error', hasil.pesan);
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

// Shutdown rapi saat pm2 stop/restart: tutup socket dulu supaya penulisan berkas
// auth_info selesai, baru keluar. Proses yang dibunuh mendadak di tengah tulis =
// session korup = Bad MAC saat hidup lagi. pm2 memberi 5 detik (kill_timeout).
function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`⏹️  ${sig} diterima — menutup socket dengan rapi...`);
  try { if (currentSock) currentSock.end(undefined); } catch (_) { /* sudah tertutup */ }
  setTimeout(() => process.exit(0), 1500).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
