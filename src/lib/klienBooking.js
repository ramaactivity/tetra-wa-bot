// Klien yang sudah booking (Tetra Ops DR-052, POST /api/bot/klien). Audit 27 Okt: Aisy (28 Nov, sudah booking)
// dijawab "tanggal masih kosong… aman" lalu ditanya ulang tanggal & jam. Hasil disisipkan ke konteks AI.
// Cache 10 menit per nomor; gagal/timeout = lanjut tanpa konteks (dicatat di log).
const { postOps } = require('./availability');

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // nomor → { t, teks }

const tanggalID = (iso) => new Date(`${iso}T00:00:00+07:00`).toLocaleDateString('id-ID',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });

function susun(booking) {
  if (!booking?.length) return '';
  const baris = booking.map((b) => `- ${tanggalID(b.tanggal)}${b.jam_mulai ? ` jam ${b.jam_mulai}${b.jam_selesai ? `–${b.jam_selesai}` : ''}` : ''}` +
    `${b.paket ? `, ${b.paket}` : ''}${b.venue ? `, ${b.venue}` : ''}${b.nama_acara ? ` (${b.nama_acara})` : ''}, status bayar ${b.status_bayar}` +
    `${b.lewat_vendor ? ', lewat vendor/WO' : ''}`).join('\n');
  return '\n\nKLIEN SUDAH BOOKING (data Tetra Ops):\n' + baris + '\n' +
    'Ini klien kita, bukan calon klien. Jangan bilang tanggal itu kosong/tersedia (unit yang terpakai di tanggal itu termasuk acaranya sendiri), ' +
    'jangan tanya ulang tanggal, jam, atau paket yang sudah tercatat, jangan menawarkan booking/DP lagi. Bantu urusan persiapan acaranya ' +
    '(desain, backdrop, data acara, teknis hari H). Status pembayaran hanya disebut kalau klien menanyakannya.';
}

async function konteks(nomor, panggil = postOps) {
  const n = String(nomor || '').replace(/\D/g, '');
  if (n.length < 9) return '';
  const c = cache.get(n);
  if (c && Date.now() - c.t < CACHE_MS) return c.teks;
  const r = await panggil('/api/bot/klien', { phone: n });
  if (!r.ok || !r.json?.ok) {
    console.log(`[klien-booking] cek ${n} gagal (${r.json?.error || `HTTP ${r.status}`}), lanjut tanpa konteks`);
    return '';
  }
  const teks = susun(r.json.booking);
  cache.set(n, { t: Date.now(), teks });
  if (teks) console.log(`[klien-booking] ${n}: ${r.json.booking.length} booking`);
  return teks;
}

module.exports = { konteks, susun };

if (require.main === module) {
  // Uji cepat tanpa jaringan: node src/lib/klienBooking.js
  const assert = require('assert');
  assert.strictEqual(susun([]), '');
  const t = susun([{ tanggal: '2026-11-28', jam_mulai: '18:00', jam_selesai: '22:00', paket: 'Unlimited 4 Jam', venue: 'Gedung X', nama_acara: 'Aisy', status_bayar: 'dp', lewat_vendor: false }]);
  assert.ok(/Sabtu, 28 November 2026 jam 18:00–22:00/.test(t) && /status bayar dp/.test(t) && /Jangan bilang tanggal itu kosong/.test(t));
  (async () => {
    let n = 0;
    const ok = async () => { n++; return { ok: true, json: { ok: true, booking: [] } }; };
    assert.strictEqual(await konteks('0812-3456-7890', ok), '');
    await konteks('6281234567890', ok); // nomor beda format = kunci cache beda, tetap memanggil
    assert.strictEqual(await konteks('081234567890', ok), ''); assert.ok(n >= 2);
    const gagal = async () => ({ ok: false, status: 0, json: { error: 'timeout' } });
    assert.strictEqual(await konteks('089999999999', gagal), '');
    assert.strictEqual(await konteks('12', ok), '');
    console.log('UJI KLIEN BOOKING LOLOS');
  })();
}
