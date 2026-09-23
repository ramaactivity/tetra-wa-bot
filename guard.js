// ============================================================================
// TETRA GUARD — watchdog self-healing untuk Tetra WA Bot.
//
// Berjalan sebagai proses PM2 terpisah (`tetra-guard`) supaya kalau bot mati,
// yang menolongnya bukan proses yang mati itu sendiri. Tiap 30 detik guard
// memeriksa 5 sinyal kesehatan lalu bertindak otomatis tanpa menunggu manusia:
//
//   1. Proses tetra-bot tidak `online` di PM2  → restart.
//   2. Heartbeat (bot_status.updated_at) basi   → proses nyangkut → restart.
//   3. Link WA `logged_out`                     → tak bisa di-heal penuh; restart
//      (agar pairing code/QR muncul lagi) + alert admin untuk scan ulang.
//   4. Reconnect-loop (putus terus tanpa pernah tersambung) → snapshot session
//      sehat (auth_info.healthy) direstore, lalu restart.
//   5. Instance ganda index.js di luar PM2      → bunuh yang liar (akar Bad MAC).
//
// Tiap tindakan punya cooldown agar tidak thrash (restart beruntun tanpa henti),
// dan tiap tindakan mengirim alert ke Telegram (channel terpisah dari bot WA,
// jadi tetap sampai walau bot-nya sendiri yang bermasalah).
// ============================================================================

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Env: sama urutannya dengan index.js — .env.local menang, .env cadangan.
try {
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '.env.local') });
  dotenv.config({ path: path.join(__dirname, '.env') });
} catch { /* dotenv opsional */ }

const BOT_DIR = __dirname;
const AUTH_DIR = path.join(BOT_DIR, 'auth_info');
const HEALTHY_DIR = path.join(BOT_DIR, 'auth_info.healthy');
const PM2 = '/home/ubuntu/.npm-global/bin/pm2';
const PM2_HOME = '/home/ubuntu/.pm2';
const ERR_LOG = `${PM2_HOME}/logs/tetra-bot-error.log`;
const OUT_LOG = `${PM2_HOME}/logs/tetra-bot-out.log`;
const STATE_FILE = path.join(BOT_DIR, '.guard-state.json');

// ── Ambang & cooldown ───────────────────────────────────────────────────────
const LOOP_MS = 30000;             // cek tiap 30 dtk
const RESTART_COOLDOWN_MS = 120000; // max 1 restart per 2 menit
const RESTORE_COOLDOWN_MS = 600000; // max 1 restore snapshot per 10 menit
const HEARTBEAT_STALE_MS = 240000;  // 4 menit tanpa heartbeat = proses nyangkut
const RECONNECT_LOOP_MIN = 5;       // "putus" sebanyak ini tanpa 1 pun "tersambung" = korup
const LOG_TAIL_LINES = 400;

// ── Alert Telegram (channel server, terpisah dari bot WA) ───────────────────
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.GUARD_TELEGRAM_CHAT_ID || '-1004377661750';
const TG_THREAD = process.env.GUARD_TELEGRAM_THREAD_ID || '6';

let supa = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
} catch (e) {
  console.error('[guard] Supabase init gagal:', e.message);
}

// Apakah bot sedang "fresh" (belum terdaftar / session sudah dibersihkan)?
// Dipakai untuk membedakan "connecting biasa saat reconnect" dari "menunggu
// pairing ulang" (yang butuh kode/QR baru dari manusia).
function isUnregistered() {
  try {
    // Baca langsung tiap kali (bukan require, yang hasilnya di-cache) supaya
    // tidak basi setelah bot berhasil pairing dan menulis creds baru.
    const raw = fs.readFileSync(path.join(AUTH_DIR, 'creds.json'), 'utf8');
    return JSON.parse(raw).registered === false;
  } catch {
    return true; // tak ada creds.json = belum terdaftar
  }
}

// ── Util ────────────────────────────────────────────────────────────────────
const now = () => Date.now();
const log = (...a) => console.log(`[guard ${new Date().toISOString()}]`, ...a);

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}
function saveState(s) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}

async function tgAlert(text) {
  if (!TG_TOKEN) return;
  try {
    const body = new URLSearchParams({
      chat_id: TG_CHAT,
      message_thread_id: TG_THREAD,
      parse_mode: 'Markdown',
      text,
    });
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) console.error('[guard] alert Telegram gagal:', res.status);
  } catch (e) {
    console.error('[guard] alert Telegram error:', e.message);
  }
}

function pm2(args, opts = {}) {
  try {
    return execFileSync(PM2, args, {
      encoding: 'utf8',
      env: { ...process.env, PM2_HOME },
      timeout: 20000,
      ...opts,
    });
  } catch (e) {
    // stdout/stderr tetap di e.stdout/e.stderr
    return (e.stdout || '') + (e.stderr || '');
  }
}

function pm2Status() {
  try {
    const out = pm2(['jlist']);
    const list = JSON.parse(out);
    return list.find((p) => p.name === 'tetra-bot') || null;
  } catch {
    return null;
  }
}

function tailLines(file, n) {
  try {
    const buf = fs.readFileSync(file);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

// Hitung berapa kali substring muncul di deretan baris log.
function countIn(lines, needle) {
  let c = 0;
  for (const l of lines) if (l.includes(needle)) c++;
  return c;
}

// Bunuh proses index.js yang TIDAK dikelola PM2 (akar "Bad MAC": dua socket
// memperebutkan auth_info yang sama).
function killStrayInstances(pm2Pid) {
  try {
    const out = execSync(`pgrep -f 'node .*tetra-wa-bot/index.js' || true`, { encoding: 'utf8' });
    const pids = out.trim().split('\n').map((s) => s.trim()).filter(Boolean).map(Number);
    let killed = 0;
    for (const p of pids) {
      if (p && p !== Number(pm2Pid)) {
        try { process.kill(p, 'SIGKILL'); killed++; } catch {}
      }
    }
    if (killed) log(`⚠️  Bunuh ${killed} instance index.js liar (di luar PM2).`);
    return killed;
  } catch {
    return 0;
  }
}

// Restore snapshot session sehat → auth_info. Syarat: snapshot ada & lebih muda
// dari 24 jam (kalau snapshot basi, jangan dipakai — takut malah bikin logout).
function restoreSnapshot() {
  try {
    if (!fs.existsSync(HEALTHY_DIR)) { log('Tidak ada auth_info.healthy — skip restore.'); return false; }
    const creds = path.join(HEALTHY_DIR, 'creds.json');
    if (!fs.existsSync(creds)) { log('Snapshot tanpa creds.json — skip restore.'); return false; }
    const mtime = fs.statSync(creds).mtimeMs;
    if (now() - mtime > 24 * 3600 * 1000) {
      log('Snapshot basi (>24 jam) — skip restore, lebih aman restart biasa.');
      return false;
    }
    // Hapus isi auth_info, salin ulang dari snapshot (bukan swap dir — auth_info
    // harus tetap jadi path aktif yang dipakai bot).
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.cpSync(HEALTHY_DIR, AUTH_DIR, { recursive: true });
    log('♻️  auth_info direstore dari auth_info.healthy.');
    return true;
  } catch (e) {
    console.error('[guard] restore gagal:', e.message);
    return false;
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

async function doRestart(restore) {
  // Stop total dulu (jangan restart langsung — biarkan socket lama benar-benar
  // mati), tunggu sebentar, lalu start. Mencegah dua socket hidup bersamaan.
  pm2(['stop', 'tetra-bot']);
  await new Promise((r) => setTimeout(r, 3000));
  if (restore) restoreSnapshot();
  pm2(['start', 'tetra-bot']);
}

async function tick() {
  const state = loadState();
  const t = now();

  // ── 0. Instance ganda ──────────────────────────────────────────────────────
  const st = pm2Status();
  if (st) killStrayInstances(st.pid);

  // ── 1. Proses tidak online ─────────────────────────────────────────────────
  if (!st || st.pm2_env.status !== 'online') {
    const last = state.lastRestart || 0;
    if (t - last > RESTART_COOLDOWN_MS) {
      log('Bot tidak online — restart.');
      pm2(['start', 'tetra-bot']); // start = no-op kalau sudah ada tapi stop
      state.lastRestart = t;
      saveState(state);
      await tgAlert(`🔧 *Tetra Guard* — bot ` + (st ? `status \`${st.pm2_env.status}\`` : 'tidak ada di PM2') + `, saya nyalakan ulang otomatis.`);
    }
    return;
  }

  // ── 2 & 3 & 4: sinyal yang butuh data DB / log ─────────────────────────────
  const db = await fetchBotStatus();

  // 2. Heartbeat basi (proses online tapi diam → nyangkut)
  if (db && db.updated_at) {
    const age = t - new Date(db.updated_at).getTime();
    if (age > HEARTBEAT_STALE_MS) {
      const last = state.lastRestart || 0;
      if (t - last > RESTART_COOLDOWN_MS) {
        log(`Heartbeat basi ${(age / 1000).toFixed(0)} dtk — restart (proses nyangkut).`);
        await doRestart(false);
        state.lastRestart = t;
        saveState(state);
        await tgAlert(`🧟 *Tetra Guard* — bot online tapi diam ${(age / 1000).toFixed(0)} dtk (heartbeat basi). Saya restart otomatis.`);
      }
      return;
    }
  }

  // 3. Link logged_out — device di-unlink server-side (hanya bermakna bila bot
  //    MASIH terdaftar; kalau sudah unregistered, "logged_out" cuma berarti
  //    "belum bisa auth karena belum pairing" dan itu masuk cabang 3b di bawah).
  //    Sinyal ini kadang juga PALSU (race/konflik antar-instance) dan restart
  //    bersih bisa tersambung lagi (terbukti di log). Jadi pakai eskalasi:
  //      restart bersih dulu (maks 3x) → kalau tetap logged_out, barulah hapus
  //      auth_info + minta pairing baru (session lama benar-benar mati).
  if (db && db.connection === 'logged_out' && !isUnregistered()) {
    const logoutRestarts = state.logoutRestarts || 0;
    const lastRestart = state.lastRestart || 0;
    const canRestart = t - lastRestart > RESTART_COOLDOWN_MS;

    if (logoutRestarts < 3) {
      if (canRestart) {
        log(`logged_out (pemulihan ke-${logoutRestarts + 1}) — restart bersih dulu.`);
        pm2(['restart', 'tetra-bot']);
        state.logoutRestarts = logoutRestarts + 1;
        state.lastRestart = t;
        saveState(state);
        if (logoutRestarts === 0) {
          await tgAlert(`📵 *Tetra Guard* — bot Tetra *di-unlink* (logged out). Saya coba pulihkan dengan restart bersih dulu; kalau 3x gagal, saya bersihkan session & minta pairing baru.`);
        }
      }
      return;
    }

    // Sudah 3x restart tetap logged_out → session benar-benar mati. Bersihkan.
    const lastClear = state.lastLogoutClear || 0;
    if (t - lastClear > 1800 * 1000) {
      log('logged_out persisten — hapus auth_info, minta pairing baru.');
      pm2(['stop', 'tetra-bot']);
      await new Promise((r) => setTimeout(r, 3000));
      try {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        log('auth_info dibersihkan (session lama tidak valid).');
      } catch (e) {
        console.error('[guard] hapus auth_info gagal:', e.message);
      }
      pm2(['start', 'tetra-bot']);
      state.lastLogoutClear = t;
      state.logoutRestarts = 0; // reset streak setelah clear
      state.lastRestart = t;
      saveState(state);
      await tgAlert(
        `📵 *Tetra Guard* — link WhatsApp bot Tetra *benar-benar mati* (3x restart gagal).\n\n` +
        `Saya sudah bersihkan session lama & nyalakan ulang bot. Bot kini minta *kode pairing baru*.\n\n` +
        `Langkah manual (sekali saja, dari HP Tetra):\n` +
        `1. WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat → *Tautkan dengan nomor telepon*\n` +
        `2. Masukkan kode pairing yang terbit di server (` + '`PAIRING-CODE.txt`' + `) atau scan QR dari dashboard Tetra Ops.\n\n` +
        `Sampai kode masuk, bot belum bisa terima/balas chat.`
      );
    } else {
      // Sudah dibersihkan tapi belum re-link → ingatkan berkala (1x/jam).
      const last = state.lastLogoutAlert || 0;
      if (t - last > 3600 * 1000) {
        state.lastLogoutAlert = t;
        saveState(state);
        await tgAlert(`⏳ *Tetra Guard* — bot masih *logged out* & menunggu kode pairing dimasukkan (lihat PAIRING-CODE.txt / dashboard).`);
      }
    }
    return;
  }

  // 3b. Menunggu pairing ulang — bot "fresh" (unregistered) dan belum tersambung.
  //     Ini terjadi SETELAH session dibersihkan (relink wajib). Bot unregistered
  //     kadang melapor 'logged_out'/'close' (bukan 'connecting') karena tak punya
  //     session valid — itu semua tetap "menunggu pairing". Kode pairing
  //     kadaluarsa ~60 dtk, jadi regenerate berkala (restart bot) supaya selalu
  //     ada kode/QR segar, dan ingatkan admin secara berkala (tak spam).
  if (db && isUnregistered() && (db.connection === 'connecting' || db.connection === 'close' || db.connection === 'logged_out')) {
    const last = state.lastPairingAction || 0;
    if (t - last > 300000) { // tiap 5 menit
      log('Menunggu pairing ulang — regenerate kode pairing + ingatkan admin.');
      pm2(['restart', 'tetra-bot']);
      state.lastPairingAction = t;
      saveState(state);
      await tgAlert(
        `📲 *Tetra Guard* — bot Tetra menunggu *di-tautkan ulang*.\n\n` +
        `Cara (sekali saja, dari HP Tetra):\n` +
        `• Scan *QR di dashboard Tetra Ops*, atau\n` +
        `• WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat → *Tautkan dengan nomor telepon*, lalu masukkan kode di ` + '`PAIRING-CODE.txt`' + ` (kode baru terbit tiap 5 menit).\n\n` +
        `Sampai tersambung, bot belum bisa terima/balas chat.`
      );
    }
    return;
  }

  // Link sehat → reset streak logged_out (supaya eskalasi mulai dari 0 lagi).
  if (db && (db.connection === 'open' || db.connection === 'connecting')) {
    if (state.logoutRestarts) {
      state.logoutRestarts = 0;
      saveState(state);
    }
  }

  // 4. Reconnect-loop: putus terus tanpa pernah tersambung = session korup
  const lines = tailLines(OUT_LOG, LOG_TAIL_LINES);
  const disconnects = countIn(lines, 'Koneksi putus');
  const connects = countIn(lines, 'Bot tersambung');
  if (disconnects >= RECONNECT_LOOP_MIN && connects === 0) {
    const last = state.lastRestore || 0;
    if (t - last > RESTORE_COOLDOWN_MS) {
      log(`Reconnect-loop terdeteksi (${disconnects}x putus, 0 tersambung) — restore snapshot + restart.`);
      await doRestart(true);
      state.lastRestore = t;
      state.lastRestart = t;
      saveState(state);
      await tgAlert(`🔁 *Tetra Guard* — bot loop putus-sambung ${disconnects}x tanpa pernah tersambung. Saya restore session sehat (auth_info.healthy) lalu restart otomatis.`);
    }
    return;
  }

  // Sehat semua: reset penanda restore bila sudah lama (biar tak menumpuk).
  if (state.lastRestore && t - state.lastRestore > RESTORE_COOLDOWN_MS * 6) {
    state.lastRestore = 0;
    saveState(state);
  }
}

async function main() {
  log('Tetra Guard aktif — memantau tetra-bot tiap 30 dtk.');
  // Jalankan sekali langsung, lalu loop.
  await tick().catch((e) => console.error('[guard] tick error:', e.message));
  setInterval(() => {
    tick().catch((e) => console.error('[guard] tick error:', e.message));
  }, LOOP_MS);
}

// Guard sendiri tak boleh mati diam-diam: kalau error tak tertangani, log saja.
process.on('unhandledRejection', (r) => console.error('[guard] unhandledRejection:', r));
process.on('uncaughtException', (e) => console.error('[guard] uncaughtException:', e.message));

main();
