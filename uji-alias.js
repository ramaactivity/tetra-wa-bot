// Uji tanpa AI: satu orang = satu riwayat (LID + nomor HP), src/lib/store.js. Kasus asal: Yessi 19 Nov (chat acara di LID, invoice di
// nomor HP → form & Booking Masuk kosong). Jalan di SALINAN store.js di folder sementara dengan data buatan: data/ dan auth_info/ asli
// tidak dibaca maupun ditulis (pelajaran 16 Nov: uji yang menyentuh store hanya di salinan). Jalankan: node uji-alias.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-alias-'));
fs.mkdirSync(`${T}/src/lib`, { recursive: true });
fs.mkdirSync(`${T}/data`);
fs.mkdirSync(`${T}/auth_info`);
fs.copyFileSync(path.join(__dirname, 'src/lib/store.js'), `${T}/src/lib/store.js`);
fs.writeFileSync(`${T}/src/lib/liveConfig.js`, 'module.exports = { get: () => ({}), isRemotePaused: () => false };');
fs.writeFileSync(`${T}/src/lib/supa.js`, 'module.exports = { upsertPause() {} };');

const LID = '111222333444555@lid', HP = '6281200000001@s.whatsapp.net', LAIN = '6289900000002@s.whatsapp.net';
const t0 = Date.now() - 3600e3, kini = Date.now();
fs.writeFileSync(`${T}/data/riwayat.json`, JSON.stringify({
  [LID]: { ts: kini, pesan: [{ role: 'user', content: 'acara natal 2 des', t: t0 + 2 }], ringkasan: 'Acara: Natal 2 Des', profil: 'P-lid' },
  [HP]: { ts: kini, pesan: [{ role: 'user', content: 'backdrop putih ya', t: t0 + 1 }, { role: 'assistant', content: '[kirim PDF invoice]', t: t0 + 3 }],
    ringkasan: 'Minta backdrop putih', prospek: { sumber: 'sales' } },
  [LAIN]: { ts: kini, pesan: [{ role: 'user', content: 'halo', t: t0 }] },
  '222333444555666@lid': { ts: kini, pesan: [{ role: 'user', content: 'dari lid kedua', t: t0 }] },
}));
fs.writeFileSync(`${T}/auth_info/lid-mapping-111222333444555_reverse.json`, '"6281200000001"'); // ditulis Baileys: LID → HP
fs.writeFileSync(`${T}/auth_info/lid-mapping-6285500000003.json`, '"222333444555666"'); // ditulis Baileys: HP → LID
const s = require(`${T}/src/lib/store.js`);
const isi = (jid) => s.getRiwayat(jid).map((p) => p.content);
const mentah = () => JSON.parse(fs.readFileSync(`${T}/data/riwayat.json`, 'utf-8'));

const hasil = [];
const kasus = (nama, fn) => { try { fn(); hasil.push(['LOLOS', nama]); } catch (e) { hasil.push(['GAGAL', nama, e.message.slice(0, 300)]); } };

kasus('LID dipetakan dari auth_info: riwayat kedua alamat digabung urut waktu (dari alamat mana pun)', () => {
  const urut = ['backdrop putih ya', 'acara natal 2 des', '[kirim PDF invoice]'];
  assert.deepStrictEqual(isi(LID), urut);
  assert.deepStrictEqual(isi(HP), urut);
});
kasus('ringkasan digabung; profil & prospek diambil satu (milik alamat ini, kalau kosong pasangannya)', () => {
  assert.strictEqual(s.getRingkasan(LID), 'Acara: Natal 2 Des\n\nMinta backdrop putih');
  assert.strictEqual(s.getProfil(HP), 'P-lid');
  assert.deepStrictEqual(s.getProspek(LID), { sumber: 'sales' });
});
kasus('nomorDari: HP asli untuk LID, null kalau belum diketahui (bukan digit LID), null untuk grup', () => {
  assert.strictEqual(s.nomorDari(LID), '6281200000001');
  assert.strictEqual(s.nomorDari(HP), '6281200000001');
  assert.strictEqual(s.nomorDari('999888777666555@lid'), null);
  assert.strictEqual(s.nomorDari('120363000000000000@g.us'), null);
});
kasus('menulis tetap per alamat: pesan baru di LID tidak menggandakan riwayat HP', () => {
  s.tambahRiwayat(LID, 'assistant', 'siap kak');
  const r = mentah();
  assert.deepStrictEqual(r[LID].pesan.map((p) => p.content), ['acara natal 2 des', 'siap kak']);
  assert.strictEqual(r[HP].pesan.length, 2);
  assert.strictEqual(isi(HP).at(-1), 'siap kak');
});
kasus('pasangan dari pesan masuk (remoteJidAlt) tercatat di data/jid-alias.json dan langsung dipakai', () => {
  s.catatAlias('777888999000111@lid', LAIN);
  assert.deepStrictEqual(isi('777888999000111@lid'), ['halo']);
  assert.strictEqual(JSON.parse(fs.readFileSync(`${T}/data/jid-alias.json`, 'utf-8'))['777888999000111'], '6289900000002');
});
kasus('dari nomor HP ke LID lewat file Baileys arah sebaliknya', () => {
  assert.deepStrictEqual(isi('6285500000003@s.whatsapp.net'), ['dari lid kedua']);
});
kasus('kontak tanpa pasangan tidak berubah', () => {
  assert.deepStrictEqual(isi('999888777666555@lid'), []);
  assert.deepStrictEqual(isi(LAIN), ['halo']); // dibaca dari HP: LID 777… belum punya riwayat
});

fs.rmSync(T, { recursive: true, force: true });
for (const [st, n, e] of hasil) console.log(`${st === 'LOLOS' ? '✅' : '❌'} ${n}${e ? `\n   -> ${e}` : ''}`);
const gagal = hasil.filter((h) => h[0] === 'GAGAL').length;
console.log(`\n${hasil.length - gagal}/${hasil.length} lolos (uji-alias)`);
process.exit(gagal ? 1 : 0);
