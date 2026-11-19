// Uji tanpa AI: bukti transfer → draft pembayaran Tetra Ops (src/lib/buktiBayar.js, alur DP Rama 19 Nov). Jalan di SALINAN modul di
// folder sementara; data/ asli dan Tetra Ops tidak disentuh (postOps tiruan). Jalankan: node uji-bukti-bayar.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-bukti-'));
fs.mkdirSync(`${T}/src/lib`, { recursive: true });
fs.mkdirSync(`${T}/data`);
fs.copyFileSync(path.join(__dirname, 'src/lib/buktiBayar.js'), `${T}/src/lib/buktiBayar.js`);
fs.writeFileSync(`${T}/src/lib/store.js`, `const fs=require('fs');
module.exports={loadJson:(f)=>{try{return JSON.parse(fs.readFileSync(f,'utf-8'))}catch{return {}}},saveJson:(f,d)=>fs.writeFileSync(f,JSON.stringify(d)),
nomorDari:(j)=>j.endsWith('@lid')?'6281298116793':null};`);
fs.writeFileSync(`${T}/src/lib/availability.js`, 'module.exports = { postOps: async (p, b) => global.ops(p, b) };');
const kiriman = [];
let jawab = { ok: true, status: 200, json: { ok: true, status: 'menunggu', gerbang: [] } };
global.ops = async (p, b) => { kiriman.push({ p, b }); return jawab; };
const bb = require(`${T}/src/lib/buktiBayar.js`);
const J = '144439901184133@lid';
const pesan = (id) => ({ key: { id }, pushName: 'Yessi', messageTimestamp: 1795050000, message: { imageMessage: { mimetype: 'image/jpeg' } } });
const B64 = Buffer.from('gambar-bukti').toString('base64');

const hasil = [];
const kasus = async (nama, fn) => { try { await fn(); hasil.push(['LOLOS', nama]); } catch (e) { hasil.push(['GAGAL', nama, e.message.slice(0, 300)]); } };

(async () => {
  await kasus('bukti klien → draft client_only dengan gambar & isian cs-wa; nominal tak terbaca = null (bukan 0)', async () => {
    await bb.dariKlien(J, pesan('A1'), { nominal: 700000, nama_pengirim: 'AGRET ANGGRAINI', bank_tujuan: 'BCA 0954965224', confidence: 0.93 }, B64);
    const b = kiriman.at(-1).b;
    assert.strictEqual(kiriman.at(-1).p, '/api/bot/pembayaran/draft');
    assert.deepStrictEqual([b.pesan_id_wa, b.sumber, b.auto_confirm, b.nominal, b.nama_pengirim, b.client_wa, b.gambar],
      ['A1', 'client_only', false, 700000, 'AGRET ANGGRAINI', '6281298116793', B64]);
    await bb.dariKlien(J, pesan('A0'), { nominal: 0 }, B64);
    assert.strictEqual(kiriman.at(-1).b.nominal, null);
    assert.ok(!fs.existsSync(`${T}/data/bukti-bayar/A1.jpg`), 'gambar dihapus setelah terkirim');
  });
  await kasus('pesan sama tidak dikirim dua kali', async () => {
    const n = kiriman.length;
    await bb.dariKlien(J, pesan('A1'), {}, B64);
    assert.strictEqual(kiriman.length, n);
  });
  await kasus('Tetra Ops gagal → gambar disimpan, dicoba ulang pada kiriman berikutnya', async () => {
    jawab = { ok: false, status: 503, json: {} };
    await bb.dariKlien(J, pesan('A2'), { nominal: 500000 }, B64);
    assert.ok(fs.existsSync(`${T}/data/bukti-bayar/A2.jpg`), 'gambar tersimpan');
    jawab = { ok: true, status: 200, json: { ok: true, status: 'menunggu', gerbang: [] } };
    const n = kiriman.length;
    await bb.dariKlien('6289900000002@s.whatsapp.net', pesan('B1'), {}, B64);
    assert.ok(kiriman.slice(n).some((k) => k.b.pesan_id_wa === 'A2' && k.b.gambar === B64), 'A2 dikirim ulang dengan gambar');
    assert.ok(!fs.existsSync(`${T}/data/bukti-bayar/A2.jpg`));
  });
  await kasus('konfirmasi admin → bukti TERAKHIR chat ini dikirim ulang admin_wa + auto_confirm, tanpa gambar; chat lain tidak ikut', async () => {
    jawab = { ok: true, status: 200, json: { ok: true, status: 'disetujui', gerbang: [] } };
    const n = kiriman.length;
    await bb.konfirmasiAdmin(J);
    const k = kiriman.slice(n);
    assert.strictEqual(k.length, 1, JSON.stringify(k.map((x) => x.b.pesan_id_wa)));
    assert.deepStrictEqual([k[0].b.pesan_id_wa, k[0].b.sumber, k[0].b.auto_confirm, k[0].b.gambar], ['A2', 'admin_wa', true, undefined]);
    const n2 = kiriman.length;
    await bb.konfirmasiAdmin(J); // konfirmasi kedua: bukti terakhir (A2) sudah disetujui → bukti lama (A1/A0, mungkin dobel) TIDAK ikut naik
    assert.strictEqual(kiriman.length, n2, JSON.stringify(kiriman.slice(n2).map((x) => x.b.pesan_id_wa)));
    jawab = { ok: true, status: 200, json: { ok: true, status: 'menunggu', gerbang: [] } };
    await bb.dariKlien(J, pesan('A3'), { nominal: 2000000 }, B64); // bukti baru (pelunasan) → konfirmasi berikutnya menaikkan A3
    const n3 = kiriman.length;
    await bb.konfirmasiAdmin(J);
    assert.strictEqual(kiriman.slice(n3)[0]?.b.pesan_id_wa, 'A3');
  });
  await kasus('konfirmasi admin tanpa gambar bukti di chat → tidak mengirim apa pun', async () => {
    const n = kiriman.length;
    await bb.konfirmasiAdmin('6280000000000@s.whatsapp.net');
    assert.strictEqual(kiriman.length, n);
  });

  fs.rmSync(T, { recursive: true, force: true });
  for (const [st, n, e] of hasil) console.log(`${st === 'LOLOS' ? '✅' : '❌'} ${n}${e ? `\n   -> ${e}` : ''}`);
  const gagal = hasil.filter((h) => h[0] === 'GAGAL').length;
  console.log(`\n${hasil.length - gagal}/${hasil.length} lolos (uji-bukti-bayar)`);
  process.exit(gagal ? 1 : 0);
})();
