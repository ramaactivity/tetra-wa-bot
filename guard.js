// ============================================================================
// TETRA GUARD — watchdog untuk Tetra WA Bot. Proses PM2 terpisah (`tetra-guard`).
//
// Prinsip yang dipegang, berdasarkan kejadian 23 Sep 2026:
//
//   * Guard TIDAK PERNAH menulis, menyalin, atau memulihkan auth_info.
//     Versi sebelumnya merestore "snapshot sehat" saat ada masalah. Session Signal
//     yang dipulihkan dari salinan lama = lebih tua dari yang dipegang WhatsApp
//     = badai "Bad MAC" = device dicabut. Guard itulah yang merusak session.
//   * Guard TIDAK me-restart bot berulang untuk memancing kode pairing.
//     Versi sebelumnya restart tiap 5 menit selagi belum terdaftar: 68x "di-unlink"
//     dalam sejam, dan kode yang terbit tidak pernah ada yang memasukkan.
//     Pairing itu tindakan manusia; guard cukup MEMBERI TAHU, jelas dan tidak spam.
//   * Setiap tindakan punya cooldown, dan tindakan selalu lebih lunak dari sinyalnya:
//     restart hanya kalau prosesnya memang macet, bukan kalau WhatsApp menolak.
//
// Sinyal yang dipantau tiap 30 detik:
//   0. Instance index.js liar di luar PM2        -> bunuh (akar Bad MAC)
//   1. tetra-bot tidak `online` di PM2           -> start
//   2. Heartbeat bot_status.updated_at basi      -> proses macet -> restart
//   3. Status logged_out di DB                   -> dipercaya HANYA kalau log bot
//                                                   mengonfirmasi 401; alert saja, tanpa
//                                                   restart, tanpa menyentuh auth
//   3b. Belum terdaftar (menunggu pairing)       -> beri tahu 1x + ingatkan tiap jam
//   4. Loop putus-sambung tanpa pernah tersambung-> 1x restart bersih per 10 menit
//   5. Lonjakan "Bad MAC" di log                 -> alert saja (jangan bertindak)
//   6. 440 connectionReplaced di log             -> alert: ada instance lain
// ============================================================================

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '.env.local') });
  dotenv.config({ path: path.join(__dirname, '.env') });
} catch { /* dotenv opsional */ }

const BOT_DIR = __dirname;
const AUTH_DIR = path.join(BOT_DIR, 'auth_info');
const PAIR_FILE = path.join(BOT_DIR, 'PAIRING-CODE.txt');
const PM2 = '/home/ubuntu/.npm-global/bin/pm2';
const PM2_HOME = '/home/ubuntu/.pm2';
const ERR_LOG = `${PM2_HOME}/logs/tetra-bot-error.log`;
const OUT_LOG = `${PM2_HOME}/logs/tetra-bot-out.log`;
const STATE_FILE = path.join(BOT_DIR, '.guard-state.json');

// ── Ambang & cooldown ────────────────────────────────────────────────────────
const LOOP_MS = 30000;              // periksa tiap 30 dtk
const RESTART_COOLDOWN_MS = 120000; // maks 1 restart per 2 menit
const HEARTBEAT_STALE_MS = 240000;  // bot bump updated_at tiap 90 dtk; 4 menit = 2x luput
const RECONNECT_LOOP_MIN = 8;       // "Koneksi putus" sebanyak ini tanpa 1 pun "tersambung"
const LOOP_RESTART_COOLDOWN_MS = 600000; // maks 1 restart-bersih per 10 menit untuk loop
const BADMAC_ALERT_MIN = 20;        // Bad MAC sebanyak ini di 400 baris terakhir = lonjakan
const ALERT_COOLDOWN_MS = 1800000;  // alert berulang untuk kondisi yang sama: 30 menit
const REMINDER_MS = 3600000;        // pengingat pairing: 1 jam
const LOG_TAIL_LINES = 400;

// ── Alert Telegram (topic Server Status, terpisah dari bot WA) ───────────────
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.GUARD_TELEGRAM_CHAT_ID || '-1004377661750';
const TG_THREAD = process.env.GUARD_TELEGRAM_THREAD_ID || '6';

let supa = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
} catch (e) {
  console.error('[guard] Supabase init gagal:', e.message);
}

// ── Util ─────────────────────────────────────────────────────────────────────
const now = () => Date.now();
const log = (...a) => console.log(`[guard ${new Date().toISOString()}]`, ...a);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch { /* abaikan */ }
}

// Dibaca langsung tiap kali (bukan require) supaya tidak basi setelah pairing.
function isUnregistered() {
  try {
    return JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8')).registered === false;
  } catch {
    return true; // tidak ada creds.json = belum terdaftar
  }
}

// Kode pairing yang masih segar (< 90 dtk), atau null.
function kodePairingSegar() {
  try {
    const [kode, iso] = fs.readFileSync(PAIR_FILE, 'utf8').trim().split('\n');
    if (kode && iso && now() - new Date(iso).getTime() < 90000) return kode;
  } catch { /* tidak ada */ }
  return null;
}

async function tgAlert(text) {
  if (!TG_TOKEN) return;
  try {
    const body = new URLSearchParams({ chat_id: TG_CHAT, message_thread_id: TG_THREAD, parse_mode: 'Markdown', text });
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST', body, signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error('[guard] alert Telegram gagal:', res.status);
  } catch (e) {
    console.error('[guard] alert Telegram error:', e.message);
  }
}

function pm2(args) {
  try {
    return execFileSync(PM2, args, { encoding: 'utf8', env: { ...process.env, PM2_HOME }, timeout: 20000 });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}

function pm2Status() {
  try {
    return JSON.parse(pm2(['jlist'])).find((p) => p.name === 'tetra-bot') || null;
  } catch {
    return null;
  }
}

function tailLines(file, n) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}
const countIn = (lines, needle) => lines.reduce((c, l) => c + (l.includes(needle) ? 1 : 0), 0);

// Baris log yang BARU sejak tick sebelumnya (berdasarkan ukuran berkas). Untuk
// sinyal yang menandai kejadian (Bad MAC, 440), jangan hitung ulang baris lama:
// versi sebelumnya mengulang alarm 63 Bad MAC tiap 30 menit padahal semuanya sisa
// badai jam 11:08. Rotasi log (ukuran mengecil) = mulai dari awal berkas.
function bacaBarisBaru(file, state, key) {
  try {
    const ukuran = fs.statSync(file).size;
    const sebelum = state[key] || 0;
    const mulai = ukuran >= sebelum ? sebelum : 0;
    state[key] = ukuran;
    if (ukuran === mulai) return [];
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(ukuran - mulai);
    fs.readSync(fd, buf, 0, buf.length, mulai);
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// Bunuh index.js yang TIDAK dikelola PM2: dua socket di satu session = Bad MAC.
function killStrayInstances(pm2Pid) {
  try {
    const out = execSync(`pgrep -f 'node .*tetra-wa-bot/index.js' || true`, { encoding: 'utf8' });
    let killed = 0;
    for (const p of out.trim().split('\n').map(Number).filter(Boolean)) {
      if (p !== Number(pm2Pid)) { try { process.kill(p, 'SIGKILL'); killed++; } catch { /* sudah mati */ } }
    }
    if (killed) log(`⚠️  Bunuh ${killed} instance index.js liar (di luar PM2).`);
    return killed;
  } catch {
    return 0;
  }
}

async function fetchBotStatus() {
  if (!supa) return null;
  try {
    const { data, error } = await supa.from('bot_status').select('*').eq('id', 1).maybeSingle();
    if (error) { console.error('[guard] bot_status:', error.message); return null; }
    return data;
  } catch (e) {
    console.error('[guard] bot_status:', e.message);
    return null;
  }
}

// Restart bersih: stop total dulu supaya socket lama benar-benar mati (SIGTERM ->
// bot menutup socket dengan rapi), jeda, baru start. Tidak pernah menyentuh auth_info.
async function restartBersih() {
  pm2(['stop', 'tetra-bot']);
  await new Promise((r) => setTimeout(r, 4000));
  pm2(['start', 'tetra-bot']);
}

const PETUNJUK_PAIRING =
  `Cara menyambungkan lagi (butuh HP Tetra di tangan):\n` +
  `1. Di server jalankan: \`cd ~/tetra-wa-bot && node pairing.js\`\n` +
  `   (kode 8 karakter akan dikirim ke topic ini, berlaku ±60 detik)\n` +
  `2. Di HP Tetra: WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat → *Tautkan dengan nomor telepon* → ketik kodenya.\n\n` +
  `Sampai tersambung, bot tidak membalas chat pelanggan.`;

// Alert yang tidak diulang sebelum cooldown-nya lewat. `key` membedakan kondisi.
async function alertSekali(state, key, cooldownMs, text) {
  const last = state[`alert_${key}`] || 0;
  if (now() - last < cooldownMs) return false;
  state[`alert_${key}`] = now();
  saveState(state);
  await tgAlert(text);
  return true;
}

async function tick() {
  const state = loadState();
  const t = now();

  // 0. Instance ganda di luar PM2
  const st = pm2Status();
  if (st) killStrayInstances(st.pid);

  // 1. Proses tidak online
  if (!st || st.pm2_env.status !== 'online') {
    if (t - (state.lastRestart || 0) > RESTART_COOLDOWN_MS) {
      log('Bot tidak online — start.');
      pm2(['start', 'tetra-bot']);
      state.lastRestart = t;
      saveState(state);
      await tgAlert(`🔧 *Tetra Guard* — bot ${st ? 'status `' + st.pm2_env.status + '`' : 'tidak ada di PM2'}, saya nyalakan ulang.`);
    }
    return;
  }

  const outLines = tailLines(OUT_LOG, LOG_TAIL_LINES);
  const errLines = tailLines(ERR_LOG, LOG_TAIL_LINES);
  const db = await fetchBotStatus();
  const unregistered = isUnregistered();

  // 5. Lonjakan Bad MAC: JANGAN bertindak otomatis. Penyebab hampir selalu session
  //    ganda atau session yang dipulihkan dari salinan lama; restart/restore justru
  //    memperparah. Beri tahu manusia, sebut apa yang harus dicek.
  const errBaru = bacaBarisBaru(ERR_LOG, state, 'errLogOffset');
  const outBaru = bacaBarisBaru(OUT_LOG, state, 'outLogOffset');
  saveState(state);
  const badMac = countIn(errBaru, 'Bad MAC');
  if (badMac >= BADMAC_ALERT_MIN) {
    await alertSekali(state, 'badmac', ALERT_COOLDOWN_MS,
      `🧨 *Tetra Guard* — ${badMac} error *Bad MAC* BARU dalam 30 detik terakhir.\n` +
      `Ini tanda session Signal tidak sinkron. Penyebab umum: ada instance lain memakai session yang sama, ` +
      `atau auth\\_info pernah disalin/dipulihkan. Guard TIDAK bertindak otomatis — cek \`pgrep -af tetra-wa-bot\` di server.`);
  }

  // 6. 440 = session diambil alih instance lain
  if (countIn(outBaru, 'DIGANTIKAN instance lain (440)') > 0) {
    await alertSekali(state, 'replaced', ALERT_COOLDOWN_MS,
      `⛔ *Tetra Guard* — WhatsApp melapor session bot *dipakai instance lain* (440). Bot sengaja berhenti menyambung agar tidak berebut. ` +
      `Matikan instance yang satunya (VPS lama? proses liar?) lalu \`pm2 restart tetra-bot\`.`);
  }

  // 3b. Belum terdaftar = menunggu manusia memasukkan kode. Tidak ada yang bisa
  //     dipulihkan otomatis; jangan restart, jangan spam.
  if (unregistered) {
    if (state.logoutRestarts) { state.logoutRestarts = 0; saveState(state); }
    const dikirim = await alertSekali(state, 'pairing', REMINDER_MS,
      `📲 *Tetra Guard* — bot Tetra *belum tertaut* ke WhatsApp.\n\n${PETUNJUK_PAIRING}`);
    if (dikirim) log('Menunggu pairing — pengingat dikirim (tidak restart).');
    return;
  }

  // Link sehat → reset penanda.
  if (db && db.connection === 'open') {
    if (state.logoutRestarts || state.authCleared) {
      state.logoutRestarts = 0; state.authCleared = 0; saveState(state);
    }
  }

  // 2. Heartbeat basi: proses online tapi diam -> macet -> restart bersih.
  if (db && db.updated_at) {
    const age = t - new Date(db.updated_at).getTime();
    if (age > HEARTBEAT_STALE_MS && t - (state.lastRestart || 0) > RESTART_COOLDOWN_MS) {
      log(`Heartbeat basi ${Math.round(age / 1000)} dtk — restart bersih (proses macet).`);
      await restartBersih();
      state.lastRestart = t; saveState(state);
      await tgAlert(`🧟 *Tetra Guard* — bot online tapi diam ${Math.round(age / 1000)} dtk (heartbeat basi). Saya restart bersih.`);
      return;
    }
  }

  // 3. Status 'logged_out' di bot_status. PELAJARAN 23 Sep 12:26: kolom ini bisa
  //    ditulis proses lain (webapp Tetra Ops, agent lain), dan guard versi sebelumnya
  //    mempercayainya lalu MENGHAPUS auth_info bot yang sedang sehat. Sekarang:
  //    - guard TIDAK PERNAH menghapus auth_info. Pairing adalah keputusan manusia
  //      (tombol "Tautkan ulang WhatsApp" di Mission Control / node pairing.js).
  //    - 'logged_out' hanya dipercaya kalau LOG BOT SENDIRI mengonfirmasi: ada baris
  //      401/ditolak yang muncul SETELAH baris "tersambung" terakhir.
  //    - kalau DB bilang logged_out tapi log bilang tersambung -> ada penulis lain;
  //      beri tahu manusia, jangan bertindak.
  if (db && db.connection === 'logged_out') {
    let idxSambung = -1, idxUnlink = -1;
    outLines.forEach((l, k) => {
      if (l.includes('Bot tersambung')) idxSambung = k;
      if (l.includes('di-unlink (401') || l.includes('ditolak WhatsApp')) idxUnlink = k;
    });
    const terkonfirmasi = idxUnlink > idxSambung;
    if (terkonfirmasi) {
      await alertSekali(state, 'logout401', REMINDER_MS,
        `📵 *Tetra Guard* — WhatsApp *mencabut* device bot Tetra (401, terkonfirmasi di log). ` +
        `Restart tidak akan menolong dan guard tidak menyentuh session.\n\n` +
        `Tautkan ulang lewat Mission Control → Channels → *Tautkan ulang WhatsApp* (centang "putus & tautkan ulang"), ` +
        `atau di server: \`node pairing.js --paksa\`.`);
    } else {
      await alertSekali(state, 'logout_palsu', ALERT_COOLDOWN_MS,
        `⚠️ *Tetra Guard* — \`bot_status.connection\` bertuliskan *logged_out*, tapi log bot menunjukkan masih tersambung. ` +
        `Ada proses lain yang menulis status itu (webapp Tetra Ops? agent lain?). Guard TIDAK bertindak. ` +
        `Kalau chat pelanggan memang tidak terbalas, cek Mission Control → Channels.`);
    }
    return;
  }

  // 4. Loop putus-sambung tanpa pernah tersambung: satu restart bersih, tanpa restore.
  const putus = countIn(outLines, 'Koneksi putus');
  const sambung = countIn(outLines, 'Bot tersambung');
  if (putus >= RECONNECT_LOOP_MIN && sambung === 0) {
    if (t - (state.lastLoopRestart || 0) > LOOP_RESTART_COOLDOWN_MS) {
      log(`Loop putus-sambung (${putus}x putus, 0 tersambung) — restart bersih.`);
      await restartBersih();
      state.lastLoopRestart = t; state.lastRestart = t; saveState(state);
      await tgAlert(`🔁 *Tetra Guard* — bot putus-sambung ${putus}x tanpa pernah tersambung. Saya restart bersih (tanpa menyentuh session). ` +
        `Kalau berulang, kemungkinan jaringan VPS atau WhatsApp sedang bermasalah.`);
    }
    return;
  }
}

async function main() {
  log('Tetra Guard aktif — memantau tetra-bot tiap 30 dtk. Tidak pernah menyentuh auth_info.');
  await tick().catch((e) => console.error('[guard] tick error:', e.message));
  setInterval(() => tick().catch((e) => console.error('[guard] tick error:', e.message)), LOOP_MS);
}

process.on('unhandledRejection', (r) => console.error('[guard] unhandledRejection:', r));
process.on('uncaughtException', (e) => console.error('[guard] uncaughtException:', e.message));

main();
