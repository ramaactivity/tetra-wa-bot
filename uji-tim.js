// Uji jalur pengingat tim (8 Okt 2026): allowlist TIM_WA, jam 07–21, maks 4/hari, tanpa pesan dobel.
process.env.TIM_WA = '6285884359656,6281998197784';
const assert = require('assert');
const fs = require('fs');
const t = require('./src/lib/timWa');
try { fs.unlinkSync(t._FILE); } catch (_) {}
const jam = (h) => new Date(Date.UTC(2026, 9, 8, h - 7, 0));
assert(t.cek('6281234567890', 'halo', jam(10)).tolak, 'bukan tim ditolak');
assert(t.cek('6285884359656', 'halo', jam(6)).tunda, 'subuh ditunda');
assert(t.cek('6285884359656', 'halo', jam(22)).tunda, 'malam ditunda');
assert(t.cek('6285884359656', 'halo', jam(15)).ok);
for (let i = 1; i <= 4; i++) t.catat('6285884359656', `pesan ${i}`, jam(15));
assert(t.cek('6285884359656', 'pesan 1', jam(16)).tolak, 'pesan dobel ditolak');
assert(t.cek('6285884359656', 'pesan 5', jam(16)).tolak, 'jatah 4/hari habis');
assert(t.cek('6281998197784', 'pesan 5', jam(16)).ok, 'jatah per nomor');
assert(t.anggota('+62 858-8435-9656') && !t.anggota('6281234567890'));
fs.unlinkSync(t._FILE);
console.log('UJI TIM LOLOS');
