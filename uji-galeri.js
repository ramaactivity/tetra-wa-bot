// Uji alur tamu minta foto acara (lib/galeri.js): kapan link dikirim, ditanya, atau diteruskan ke admin.
const assert = require('assert');
const { putuskan, RE_MINTA } = require('./src/lib/galeri');
const dinda = { judul: 'Wedding Rafi & Dinda', tanggal: '2026-10-10', url: 'https://booth.tetraphoto.com/l/wedding-rafi-dinda-2026-10-10', jumlah: 319, sampai: '2026-11-08T17:00:00+00:00' };
const adel = { ...dinda, judul: 'Wedding Adel & Alpi', url: 'https://booth.tetraphoto.com/l/wedding-adel-alpi-2026-10-10' };

let k = putuskan({ nama: 'Dinda Rafi', tanggal: '2026-10-10' }, [dinda], false);
assert.strictEqual(k.aksi, 'kirim'); assert(k.teks.includes(dinda.url) && k.teks.includes('Rafi & Dinda') && k.teks.includes('9 Nov') && k.teks.includes('maaf'));
k = putuskan({ nama: 'Dinda', tanggal: null }, [{ ...dinda, jumlah: 0 }], false);
assert(k.teks.includes('proses upload'), 'foto 0 → bilang masih diupload');
assert.strictEqual(putuskan({ nama: null, tanggal: '2026-10-10' }, [dinda, adel], false).aksi, 'tanya', 'dua acara sehari tidak boleh ditebak');
assert.strictEqual(putuskan({ nama: 'X', tanggal: null }, [dinda, adel], true, true).aksi, 'admin', 'sudah ditanya tetap ragu → admin');
assert.strictEqual(putuskan({ nama: 'Budi', tanggal: '2026-10-10' }, [], false).aksi, 'admin', 'nama+tanggal lengkap tapi tidak ketemu → admin');
assert.strictEqual(putuskan({ nama: 'Dinda', tanggal: null }, null, false).aksi, 'admin', 'Ops gagal → admin');
assert.strictEqual(putuskan({ nama: 'Dinda', tanggal: null }, [{ ...dinda, url: null }], false).aksi, 'admin', 'galeri off → admin');
for (const t of ['mau tanya untuk melihat hasil foto disebelah mana', 'mau cek file foto di pernikahan Dinda', 'minta softfile dong', 'scan barcode gak ketemu foto2nya', 'link galerinya mana kak', 'Minta dikirim kan poto'])
  assert(RE_MINTA.test(t), t);
console.log('UJI GALERI LOLOS');
assert.strictEqual(putuskan({ nama: 'Rizka Iqbal', tanggal: null }, [], true).aksi, 'tanya', 'nama saja tidak ketemu: tanya tanggal dulu');
assert.ok(putuskan({ nama: 'Rizka Iqbal', tanggal: null }, [], true).tanggal, 'penanda tanya tanggal');
assert.strictEqual(putuskan({ nama: 'Rizka Iqbal', tanggal: null }, [], true, true).aksi, 'admin', 'sudah ditanya tanggal: admin');
console.log('uji tanya tanggal ok');
