// Klien read-only ke endpoint Ketersediaan Unit Tetra Ops.
// Fault-tolerant TOTAL: kalau token belum di-set / network gagal / non-200 /
// timeout → kembalikan null. Pemanggil memperlakukan null = "tak bisa cek
// otomatis" lalu lanjut ke alur admin-confirm. Fungsi ini TIDAK PERNAH throw.
//
// Env yang dipakai (di .env server bot):
//   AVAILABILITY_API_TOKEN   (wajib; tanpa ini fitur OFF)
//   AVAILABILITY_API_URL     (opsional; default ke endpoint produksi Tetra Ops)
try {
  require('dotenv').config();
} catch {
  /* dotenv opsional — env bisa di-inject pm2/systemd */
}

const BASE_URL =
  process.env.AVAILABILITY_API_URL ||
  'https://tetra-ops-lac.vercel.app/api/availability';
const TIMEOUT_MS = 8000;

const token = () => process.env.AVAILABILITY_API_TOKEN || '';

// Apakah fitur cek-otomatis aktif (token sudah di-set)?
function enabled() {
  return !!token();
}

// Cek ketersediaan unit untuk satu window.
// params: { date:'YYYY-MM-DD', start:'HH:mm', end:'HH:mm', city?:string, units?:1..3 }
// return: objek response Tetra Ops (units_free, units_requested, available =
//         units_free >= units, conflicts,
//         buffer_applied_minutes, assumptions, ...) ATAU null kalau gagal/OFF.
// Model sering mengecek tanggal yang sama berkali-kali dalam satu percakapan
// (23 Sep: 7x untuk satu tanggal dalam 8 menit). Simpan hasil 5 menit.
const cache = new Map(); // key -> { ts, data }
const CACHE_MS = 5 * 60 * 1000;

async function checkAvailability(params = {}) {
  const key = JSON.stringify([params.date, params.start, params.end, params.city || '', unitsOf(params)]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.data;
  const data = await checkAvailabilityRaw(params);
  if (data) cache.set(key, { ts: Date.now(), data });
  return data;
}

// Tetra Ops menolak units di luar 1..3 (400). Lebih dari 3 = cek 3 (semua unit);
// sisanya urusan admin (Tetra cuma punya 3).
const unitsOf = (p) => Math.min(3, Math.max(1, parseInt(p.units, 10) || 1));

async function checkAvailabilityRaw(params = {}) {
  const { date, start, end, city } = params;
  if (!token()) return null; // belum dikonfigurasi → diam (mode admin-confirm)
  if (!date || !start || !end) return null; // param kurang → jangan panggil

  const qs = new URLSearchParams({ date, start, end, units: String(unitsOf(params)) });
  if (city) qs.set('city', city);
  const url = `${BASE_URL}?${qs.toString()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}` },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn(`[availability] HTTP ${res.status} (${date} ${start}-${end})`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[availability] gagal panggil endpoint:', e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Ringkas hasil cek jadi catatan singkat untuk notif admin (string; '' kalau null).
// Dipakai di mode admin-confirm: admin lihat status slot biar bisa konfirmasi cepat.
function summarize(result) {
  if (!result) return '';
  const total = result.units_total ?? 3;
  const free = result.units_free ?? 0;
  const minta = result.units_requested ?? 1;
  const head = result.available
    ? `🟢 ${result.window}: ${free}/${total} unit KOSONG` + (minta > 1 ? `, klien minta ${minta} → CUKUP` : '')
    : minta > 1 && free > 0
      ? `🔴 ${result.window}: sisa ${free} unit, klien minta ${minta} → TIDAK CUKUP`
      : `🔴 ${result.window}: PENUH (0/${total})`;
  let out = `📅 Ketersediaan ${head}`;
  if (Array.isArray(result.conflicts) && result.conflicts.length) {
    out += `\nBentrok: ${result.conflicts.map((c) => `${c.project} (${c.time})`).join(', ')}`;
  }
  if (Array.isArray(result.assumptions) && result.assumptions.length) {
    out += `\n⚠️ ${result.assumptions[0]}`;
  }
  return out;
}

// Endpoint bot lain di Tetra Ops (/api/bot/booking, /api/bot/quotation): origin
// dan token sama dengan cek jadwal. Tidak pernah melempar error; pemanggil cek ok.
const opsBase = () => new URL(BASE_URL).origin;
async function postOps(path, body) {
  try {
    const res = await fetch(opsBase() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: { error: e.message } };
  }
}

module.exports = { checkAvailability, enabled, summarize, opsBase, postOps };
