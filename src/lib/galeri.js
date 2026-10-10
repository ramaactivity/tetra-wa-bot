// Tamu minta softfile/foto acara → kirim link galeri TAMU (/l/{slug}, publik) acara itu. Keputusan Rama 10 Okt 2026:
// QR di cetakan Dinda & Rafi tidak muncul, tamu bertanya ke WA dengan nama klien, tanggal, atau foto cetakannya.
// Sumber: Tetra Ops POST /api/bot/galeri (membaca Booth). Link HANYA dikirim kalau tepat satu acara cocok:
// di tanggal yang sama bisa ada dua wedding (Dinda & Rafi + Adel & Alpi), salah kirim = foto orang lain.
const { postOps } = require('./availability');

const RE_MINTA = /soft ?file|file foto|hasil foto|foto ?-?(2|an)?\s?(nya|photobooth|booth)|fotonya|link (foto|galer[iy]|gallery)|galer[iy]|gallery|barcode|\bqr\b|(download|unduh|ambil) foto/i;
const TANYA_MS = 30 * 60 * 1000;
const ditanya = new Map(); // jid -> waktu bot menanyakan nama/tanggal acara (ponytail: memori proses, hilang saat restart)

async function cari(q, tanggal) {
  const r = await postOps('/api/bot/galeri', { q: q || undefined, tanggal: tanggal || undefined });
  if (!r.ok || !Array.isArray(r.json?.hasil)) return null;
  return r.json.hasil.map((e) => {
    const g = (e.galeri || []).find((x) => x.url_tamu) || {};
    return { judul: e.judul, tanggal: e.tanggal, url: g.url_tamu || null, jumlah: g.jumlah_foto || 0, sampai: g.tamu_aktif_sampai || null };
  });
}

const tgl = (iso) => {
  if (!iso) return '';
  // Jam ada (mis. 2026-11-08T17:00Z) → tanggal WIB (9 Nov); tanggal polos apa adanya.
  const w = String(iso).length > 10 ? new Date(Date.parse(iso) + 7 * 3600e3).toISOString() : String(iso);
  const [y, m, d] = w.slice(0, 10).split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][m - 1]}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
};

/** Pilih tindakan dari petunjuk {nama, tanggal} + hasil pencarian. Pure, diuji di uji-galeri.js. */
function putuskan(p, hasil, sudahDitanya) {
  if (hasil === null) return { aksi: 'admin', alasan: 'pencarian galeri gagal (Tetra Ops/Booth tidak terjangkau)' };
  if (hasil.length === 1) {
    const e = hasil[0];
    if (!e.url) return { aksi: 'admin', alasan: `galeri tamu ${e.judul} (${e.tanggal}) belum aktif/expired` };
    // Gaya (Rama 10 Okt): seperti admin manusia, bukan template bot. Tamu yang nanya biasanya gagal scan QR → minta maaf.
    const teks = `Ini Kak link galerinya, semua foto di acara ${e.judul} ada di sini ya:\n${e.url}\n\n` +
      (e.jumlah ? 'Bisa langsung didownload. ' : 'Fotonya masih proses upload, kalau belum muncul coba buka lagi agak nanti ya. ') +
      (e.sampai ? `Linknya aktif sampai ${tgl(e.sampai)}. ` : '') + 'Mohon maaf ya jadi repot nyari 🙏';
    return { aksi: 'kirim', teks, acara: e };
  }
  if (sudahDitanya || (p.nama && p.tanggal)) {
    return { aksi: 'admin', alasan: hasil.length ? `${hasil.length} acara cocok (${hasil.map((e) => e.judul).join(', ')}), perlu dipilih admin`
      : `acara tidak ketemu (nama: ${p.nama || '-'}, tanggal: ${p.tanggal || '-'})` };
  }
  return { aksi: 'tanya', teks: 'Acaranya siapa ya Kak, sama tanggal berapa? Foto cetakannya dikirim ke sini juga boleh, nanti aku cariin linknya.' };
}

/** Cari dengan nama+tanggal; nama saja kalau tanggal tidak membantu. Tanggal saja tidak pernah (bisa >1 acara). */
async function cariDariPetunjuk(p) {
  if (!p.nama) return [];
  const a = await cari(p.nama, p.tanggal);
  if (a === null || a.length || !p.tanggal) return a;
  return cari(p.nama, null);
}

module.exports = { RE_MINTA, TANYA_MS, ditanya, cari, cariDariPetunjuk, putuskan };
