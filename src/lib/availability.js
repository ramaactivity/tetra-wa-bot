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
// params: { date:'YYYY-MM-DD', start:'HH:mm', end:'HH:mm', city?:string }
// return: objek response Tetra Ops (units_free, available, conflicts,
//         buffer_applied_minutes, assumptions, ...) ATAU null kalau gagal/OFF.
async function checkAvailability({ date, start, end, city } = {}) {
  if (!token()) return null; // belum dikonfigurasi → diam (mode admin-confirm)
  if (!date || !start || !end) return null; // param kurang → jangan panggil

  const qs = new URLSearchParams({ date, start, end });
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
  const head = result.available
    ? `🟢 ${result.window}: ${free}/${total} unit KOSONG`
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

module.exports = { checkAvailability, enabled, summarize };
