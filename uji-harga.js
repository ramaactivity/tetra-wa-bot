// Uji penjaga harga (ai.js hargaAsing) terhadap sumber asli: daftar harga + FAQ.
// Jalankan: node uji-harga.js
const fs = require('fs');
const assert = require('assert');
const { hargaAsing, _sumberHarga } = require('./src/lib/ai');
const src = _sumberHarga();
const vendor = src + '\n' + fs.readFileSync('docs/VENDOR-REKANAN.md', 'utf8');
const admin = src + '\n(admin) untuk kakak 3 jam aku kasih 2.300.000 ya';
const sah = (t, s = src) => assert.deepStrictEqual(hargaAsing(t, s), [], `salah tangkap: ${t}`);
const asing = (t, s = src) => assert.ok(hargaAsing(t, s).length, `lolos padahal karangan: ${t}`);
['Photomagnet Rp 650.000', 'Keychain Rp 10.000/pcs', '13 jam Rp 7.500.000', '10 jam = Rp 6.000.000',
  'Photobooth 4 jam + 360 4 jam = Rp 6.500.000', 'mulai Rp 2.000.000/2 jam', '3 jam 2,5jt',
  'Untuk 3 jam *Rp 2.500.000*/unit x 2 = *Rp 5.000.000*', '4 jam Rp2.700.000 setelah diskon 10%',
  '2 unit 3 jam Rp 5.000.000, sisa pelunasan Rp 4.500.000', 'transfer ke BCA 0954965224',
  'acara 12.00-15.00 untuk 200 tamu'].forEach((t) => sah(t));
sah('Teh Evi 2 jam *1,7jt* ya', vendor);
sah('3 jam Rp 2.300.000 sesuai kata admin', admin);
['3 jam cuma Rp 2.300.000', '3 jam Rp 3.000.000', '2 jam 1,5jt', 'spesial Rp 2.199.000'].forEach((t) => asing(t));
console.log('UJI HARGA LOLOS');
