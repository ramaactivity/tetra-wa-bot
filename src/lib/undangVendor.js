// Undang calon rekanan (WO/EO/venue/vendor) ke dasbor rekanan Tetra Ops langsung dari chat (Rama 22 Okt 2026).
// AI menulis [UNDANG_VENDOR: nama usaha | wo/eo/venue/vendor | nama PIC | kota]; kode memanggil
// POST /api/bot/undang-vendor (Tetra Ops DR-050, kontrak docs/06_API_SPEC.md §20) dengan nomor lawan bicara,
// lalu menempelkan link ke balasan. AI tidak pernah menulis link sendiri. Gagal → kalimat aman + kabari admin.
const { postOps } = require('./availability');

const RE_TAG = /\[UNDANG_VENDOR:?\s*([^\]]*)\]/i;
const JENIS = ['wo', 'eo', 'venue', 'vendor'];

function bacaTag(teks) {
  const m = String(teks || '').match(RE_TAG);
  if (!m) return null;
  const [nama_usaha = '', jenis = '', nama_pic = '', kota = ''] = m[1].split('|').map((s) => s.trim());
  return { nama_usaha, jenis: JENIS.includes(jenis.toLowerCase()) ? jenis.toLowerCase() : 'vendor', nama_pic, kota };
}

function kalimatLink(j) {
  return j.masuk === 'link_pribadi'
    ? `Ini link dasbor rekanan ${j.vendor_name || 'kamu'}, sekali ketuk langsung masuk (berlaku 14 hari):\n${j.url}`
    : `${j.vendor_name || 'Kakak'} sudah terdaftar sebagai rekanan, masuk di ${j.url} pakai nomor WA ini ya.`;
}

/** Proses penanda. Hasil: { teks, info } — teks siap kirim; info = pesan untuk admin kalau gagal (atau null). */
async function proses(teks, { phone, jid }, panggil = postOps) {
  const data = bacaTag(teks);
  const bersih = String(teks || '').replace(RE_TAG, '').trim();
  if (!data) return { teks: bersih, info: null };
  const cadangan = `${bersih}\n\nLink dasbor rekanannya nanti dikirim tim Tetra ya.`.trim();
  if (data.nama_usaha.length < 2 || data.nama_pic.length < 2) {
    return { teks: cadangan, info: `undang ke dasbor rekanan: data kurang (usaha "${data.nama_usaha}", PIC "${data.nama_pic}") — undang manual di Pusat Vendor` };
  }
  const r = await panggil('/api/bot/undang-vendor', {
    nama_usaha: data.nama_usaha, jenis: data.jenis, nama_pic: data.nama_pic, phone: String(phone || ''),
    ...(data.kota ? { kota: data.kota } : {}), sumber: 'wa_bot', wa_jid: jid,
  });
  if (r.ok && r.json?.ok && r.json.url) {
    console.log(`[undang-vendor] ${data.nama_usaha} (${phone}): ${r.json.masuk}, ${r.json.baru ? 'baru' : 'sudah ada'}, ${r.json.status}`);
    return { teks: `${bersih}\n\n${kalimatLink(r.json)}`.trim(), info: null };
  }
  const kode = r.json?.error || `HTTP ${r.status}`;
  console.log(`[undang-vendor] gagal ${data.nama_usaha} (${phone}): ${kode}`);
  return { teks: cadangan, info: `undang ${data.nama_usaha} ke dasbor rekanan gagal (${kode}) — undang manual di Pusat Vendor` };
}

module.exports = { proses, bacaTag, RE_TAG };

if (require.main === module) {
  // Uji cepat tanpa jaringan: node src/lib/undangVendor.js
  const assert = require('assert');
  assert.deepStrictEqual(bacaTag('Siap Kak\n[UNDANG_VENDOR: Bunga WO | WO | Sari | Bogor]'),
    { nama_usaha: 'Bunga WO', jenis: 'wo', nama_pic: 'Sari', kota: 'Bogor' });
  assert.strictEqual(bacaTag('tanpa penanda'), null);
  assert.strictEqual(bacaTag('[UNDANG_VENDOR: X Studio | fotografer | Andi]').jenis, 'vendor');
  (async () => {
    const ok = await proses('Siap Kak, ini aku kirim ya.\n[UNDANG_VENDOR: Bunga WO | wo | Sari]', { phone: '0812', jid: 'x' },
      async () => ({ ok: true, json: { ok: true, url: 'https://b/akun/masuk/t', masuk: 'link_pribadi', vendor_name: 'Bunga WO', baru: true } }));
    assert.ok(ok.teks.includes('https://b/akun/masuk/t') && !ok.teks.includes('[') && ok.info === null);
    const gagal = await proses('Siap Kak.\n[UNDANG_VENDOR: Bunga WO | wo | Sari]', { phone: '0812', jid: 'x' },
      async () => ({ ok: false, status: 409, json: { ok: false, error: 'nomor_tim' } }));
    assert.ok(gagal.teks.includes('dikirim tim Tetra') && /nomor_tim/.test(gagal.info));
    const kurang = await proses('Siap.\n[UNDANG_VENDOR: Bunga WO | wo | ]', { phone: '0812', jid: 'x' }, async () => { throw new Error('tidak boleh dipanggil'); });
    assert.ok(/data kurang/.test(kurang.info));
    console.log('UJI UNDANG VENDOR LOLOS');
  })();
}
