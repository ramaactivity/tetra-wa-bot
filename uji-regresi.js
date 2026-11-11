// Uji regresi: kasus GAGAL ASLI dari audit 22 Okt, 27 Okt, dan Nov 2026. WAJIB lolos sebelum `pm2 restart tetra-bot`
// (lihat DEPLOY.md). Jalankan: npm run regresi        (lengkap, ±2 menit, memanggil model sungguhan)
//                            npm run regresi -- --cepat   (tanpa AI: routing & penjaga saja)
// Bagian AI dinilai dengan sifat jawaban (bukan kalimat persis): tidak ada kalimat oper-admin baku, harga sesuai FAQ,
// tidak ada link/alamat karangan, panjang pesan pertama, dst. Kalau sebuah kasus gagal, perbaiki akarnya — jangan
// melonggarkan ujinya.
process.env.RIWAYAT_FILE = '/tmp/riwayat-regresi.json';
process.env.KUTIPAN_OK_FILE = '/tmp/kutipan-regresi.json';
const d = require('dotenv'); d.config({ path: `${__dirname}/.env.local` }); d.config({ path: `${__dirname}/.env` });
const assert = require('assert');
const ai = require('./src/lib/ai');
const msgs = require('./src/handlers/messages');
const { namaDariChat } = require('./src/lib/followupEngine');
const klienBooking = require('./src/lib/klienBooking');

const hasil = [];
async function kasus(nama, fn) {
  try { await fn(); hasil.push(['LOLOS', nama]); } catch (e) { hasil.push(['GAGAL', nama, e.message.slice(0, 300)]); }
}
const pesan = (teks) => ({ message: { conversation: teks } });
const SAPA = 'TAHAP PERCAKAPAN: SAPA — belum pernah ada percakapan. Ini KONTAK PERTAMA dengan klien ini — ikuti aturan KONTAK PERTAMA.';
const LANJUT = 'TAHAP PERCAKAPAN: REKOMENDASI.';
const BAKU_ADMIN = /dipegang admin|aku cek dulu ke admin ya\. Nanti dibalas/i;

(async () => {
  // ── Deterministik (tanpa AI) ───────────────────────────────────────────────
  await kasus('form dobel dalam satu batch diproses sekali (…0933 Eva)', () => {
    const f = 'Halo Tetra Photobooth!\nNama: Eva\nTanggal: 7 November';
    assert.strictEqual(msgs._unikkan([pesan(f), pesan(f), pesan('kak?')]).length, 2);
  });
  await kasus('form dikirim ulang ≤30 menit setelah dibalas → tidak dibalas lagi', () => {
    const riw = [{ role: 'user', content: 'Nama: Eva', t: Date.now() - 60e3 }, { role: 'assistant', content: 'Halo Kak Eva' }];
    assert.ok(msgs._kirimUlang(riw, 'Nama: Eva'));
    assert.ok(!msgs._kirimUlang(riw, 'Nama: Eva\nmau tanya lagi'));
  });
  await kasus('nama dari isian form menang atas profil WA (…2323 rara bukan "hilwa")', () => {
    assert.strictEqual(namaDariChat('Halo Tetra!\nNama: rara\nTanggal: 28 Nov'), 'rara');
    assert.strictEqual(namaDariChat('Nama Pengantin: Saadah & Muhammed'), null);
  });
  await kasus('tanda AI dirapikan: tanda pisah jadi koma, rentang jam tetap, bold maks satu (Rama 11 Nov)', () => {
    const r = ai.rapikanGaya('Halo Kak — untuk *3 jam* harganya *Rp 2.500.000* — sudah termasuk cetak.\nJam 11.30–14.00 aman.\n[KIRIM: pricelist]');
    assert.ok(!/[—–]/.test(r), r);
    assert.match(r, /11\.30-14\.00/, r);
    assert.strictEqual((r.match(/\*[^*\n]+\*/g) || []).length, 1, r);
    assert.match(r, /Rp 2\.500\.000/, r);
    assert.match(r, /\n\[KIRIM: pricelist\]$/, r);
    assert.strictEqual(ai.rapikanGaya('Siap Kak, aman.'), 'Siap Kak, aman.');
  });
  await kasus('lokasi kantor & janji temu sepihak ditangkap, kalimat sah lolos (Rama 11 Nov)', () => {
    for (const t of ['nanti langsung aku samperin ke sana', 'Boleh mas, ini share lok kantor kami', 'Silakan datang ke kantor kami di Bogor',
      'Oke Kak, besok jam 10 kita ketemu di kantor ya', 'aku tunggu di lobby ya', 'nanti aku antar flashdisknya']) assert.ok(ai.RE_JANJI_TEMU.test(t), t);
    for (const t of ['crew datang paling lambat 1 jam sebelum acara', 'Tim kami datang ke venue jam 9 buat setup',
      'Kalau mau ketemu, admin yang atur jadwalnya ya']) assert.ok(!ai.RE_JANJI_TEMU.test(t), t);
  });
  await kasus('mode assist tidak menjawab pemasok (…2792 kertas DNP)', () => {
    const pemasok = [{ role: 'user', content: 'Selamat pagi mas, saya temennya gilang yang jual paper dnp' },
      { role: 'assistant', content: '(admin) Harganya berapa mas?' }, { role: 'user', content: '1,1 mass satunya, kalo dua sejuta' },
      { role: 'user', content: 'Mau diantar siang ini gk mas?' }];
    assert.ok(!msgs._urusanKlien(pemasok));
    assert.ok(msgs._urusanKlien([{ role: 'user', content: 'kak untuk acara tanggal 28 jam berapa crew datang?' }]));
  });
  await kasus('assist diam saat admin baru membalas, kecuali ada pertanyaan baru (usulan #60)', () => {
    const now = Date.now();
    const hist = [{ role: 'user', content: 'kak desainnya udah fix ya', t: now - 50 * 60e3 }, { role: 'assistant', content: '(admin) siap kak aku proses', t: now - 40 * 60e3 }];
    assert.ok(msgs._adminMasihPegang(hist, [{ role: 'user', content: 'oke makasih kak', t: now - 25 * 60e3 }], now));
    assert.ok(!msgs._adminMasihPegang(hist, [{ role: 'user', content: 'kak kalau pelunasan kapan ya?', t: now - 25 * 60e3 }], now));
    const lama = [{ role: 'assistant', content: '(admin) siap kak', t: now - 3 * 3600e3 }];
    assert.ok(!msgs._adminMasihPegang(lama, [{ role: 'user', content: 'oke kak', t: now - 25 * 60e3 }], now));
  });
  await kasus('frasa kaku Rama ditangkap & instruksi V2 tidak memuatnya (docs/FRASA-KAKU.md)', () => {
    assert.ok(ai.daftarFrasaKaku().includes('crew standby') && ai.daftarFrasaKaku().includes('paling menentukan'));
    assert.deepStrictEqual(ai.frasaKaku('Sudah termasuk cetak sepuasnya dan crew standby ya Kak'), ['crew standby']);
    assert.deepStrictEqual(ai.frasaKaku('Durasi yang dipilih paling menentukan, Kak'), ['paling menentukan']);
    assert.deepStrictEqual(ai.frasaKaku('Bisa Kak, buat 150 tamu 3 jam pas. Acaranya mulai jam berapa?'), []);
    for (const f of ['aku cekkan slotnya dulu ya', 'Siap Kak, aku kirim pricelist-nya ya', 'Untuk 25 Oktober jadwalnya masih kosong ya', 'Halo Kak, aku dari tim Tetra'])
      assert.ok(ai.frasaKaku(f).length, f);
    assert.deepStrictEqual(ai.frasaKaku('Masih available nih Kak, mau aku bantu proses bookingnya?'), []);
    assert.deepStrictEqual(ai.frasaKaku('Silahkan Kak, berikut pricelistnya ya'), []);
    for (const f of ['Maaf ya kak kejadian begini.', 'Mohon maaf atas ketidaknyamanannya Kak', 'Maaf atas kejadian ini'])
      assert.ok(ai.frasaKaku(f).length, f);
    assert.deepStrictEqual(ai.frasaKaku('Maaf ya Kak. Aku teruskan ke tim buat dicetak ulang, masing-masing 2 pcs ya.'), []);
    // Instruksi (di luar contoh yang dikutip "...") tidak boleh memakai frasa kaku: kata instruksi bocor ke balasan.
    const instruksi = ai._SYSTEM_PROMPT_V2.replace(/"[^"]*"/g, '').toLowerCase();
    assert.deepStrictEqual(ai.daftarFrasaKaku().filter((f) => instruksi.includes(f)), []);
  });
  await kasus('pricelist: daftar harga di teks ditolak penjaga, gambar tanpa caption (Rama 11 Nov)', () => {
    assert.ok(ai.masalahGaya('Siap Kak. 2 jam Rp 2.000.000, 3 jam Rp 2.500.000.\n[KIRIM: pricelist]').length);
    assert.deepStrictEqual(ai.masalahGaya('Silahkan Kak, berikut pricelistnya ya. Acaranya kapan?\n[KIRIM: pricelist]'), []);
    assert.strictEqual(require('./src/lib/pricelist').CAPTION_GAMBAR, '');
  });
  await kasus('isi lampiran tidak diulang di teks: skema rekanan & format (Rama 11 Nov, Royal Organizer)', () => {
    const royal = 'Boleh Kak. Jadi skema rekanannya ada dua: komisi, klien bayar harga publish ke kami, komisi 10% kami transfer ke Royal Organizer setelah acara selesai; atau potongan langsung, Kakak pegang kliennya dan bebas jual berapa pun, ke kami cukup bayar harga publish dikurangi 10%. Aku kirim gambar skemanya ya, biar lebih kebayang.\n[KIRIM: skema]';
    assert.ok(ai.masalahGaya(royal).length && ai.frasaKaku(royal).length);
    assert.deepStrictEqual(ai.masalahGaya('Boleh Kak, silahkan berikut skema rekanannya ya. Kalau ada yang kurang jelas, silahkan ditanyakan ya Kak\n[KIRIM: skema]'), []);
    assert.ok(ai.masalahGaya('2R itu 5 x 15 cm, 4R 10 x 15 cm, Polaroid 7,5 x 10 cm.\n[KIRIM: format]').length);
    const sleeve = 'Soal desainnya biar jelas: cetakan fotonya sudah menyatu dengan desain frame sesuai tema acara, itu termasuk di paket. Terus tamu juga dapat sleeve, tapi yang termasuk itu sleeve basic hitam atau putih, jadi desainnya basic, bukan desain klien. Kalau sleeve-nya mau pakai desain/branding klien sendiri, itu add-on Custom Sleeve Rp 1.500.000 untuk 1.000 lembar.';
    assert.ok(ai.masalahGaya(sleeve).length, 'penjelasan sleeve panjang tanpa ilustrasi harus ditolak');
    assert.deepStrictEqual(ai.masalahGaya('Silahkan Kak, berikut gambaran cetakan foto dan sleeve-nya ya. Kalau ada yang kurang jelas silahkan ditanyakan\n[KIRIM: sleeve]'), []);
  });
  await kasus('data acara setelah DP: form lengkap langsung, bukan dicicil (Rama 11 Nov)', () => {
    const booking = require('./src/lib/booking');
    const f = booking.teksForm({ data: { tanggal: '22 November', paket: 'Unlimited 8 jam' }, jenis: 'wedding' }, '');
    assert.match(f, /tolong dibantu untuk melengkapi form berikut/i, f);
    assert.match(f, /Tanggal Event: 22 November/, f);
    assert.deepStrictEqual(ai.frasaKaku(f), [], f);
    assert.ok(ai.frasaKaku('Kak, biar desain frame-nya bisa mulai dikerjakan, aku butuh nama acara. Sisanya boleh nyusul, dicicil juga nggak masalah.').length);
  });
  await kasus('basa-basi Rama 11 Nov ditangkap penjaga kode, jawaban beralasan lolos', () => {
    for (const x of ['Untuk 200-300 tamu, 3 jam memang pas.', 'dan durasi 3 jam memang sudah cukup untuk 200-300 tamu di resepsi.',
      'Untuk 200-300 tamu, 3 jam sudah cukup kok.', 'Harganya Rp 2.500.000, sudah termasuk cetak sepuasnya dan crew.',
      'Untuk 3 jam itu paketnya Rp 2.500.000, sudah termasuk cetak sepuasnya, frame custom sesuai tema acara, crew, dan transport se-Jabodetabek.',
      'Cibubur masih masuk Jabodetabek jadi tidak ada biaya tambahan, sudah termasuk dalam harga.'])
      assert.ok(ai.basaBasi(x).length, x);
    assert.deepStrictEqual(ai.basaBasi('Cibubur masih free transport ya Kak.'), []);
    assert.deepStrictEqual(ai.basaBasi('Dengan 300 tamu, 3 jam bikin semua tamu kebagian foto tanpa antre lama.'), []);
    assert.deepStrictEqual(ai.basaBasi('Cukup Kak, soalnya 1 jam bisa melayani 100+ tamu, jadi 3 jam sudah pas buat 300 tamu.', '3 jam cukup ga buat 300 tamu?'), []);
    assert.ok(ai.frasaKaku('Paham, Kak. Tanggal 19 Desember sendiri masih kosong di jam itu.').length >= 2);
  });
  await kasus('pertanyaan pindah ke baris baru; tanya format/backdrop → ilustrasi otomatis', () => {
    assert.strictEqual(ai.pisahPertanyaan('Untuk 3 jam paketnya Rp 2.500.000, cetaknya sepuasnya. Lokasi acaranya di mana?'),
      'Untuk 3 jam paketnya Rp 2.500.000, cetaknya sepuasnya.\n\nLokasi acaranya di mana?');
    assert.strictEqual(ai.pisahPertanyaan('Siap Kak. Tanggal berapa?'), 'Siap Kak. Tanggal berapa?');
    const { lampiranOtomatis } = require('./src/lib/lampiran');
    assert.match(lampiranOtomatis('Dua hal yang perlu kami pastikan dulu: format cetaknya mau yang mana (2R photostrip, 4R, atau Polaroid), dan apakah pajak perlu dicantumkan di penawaran? Kalau perlu, harganya di-gross up 2,5%.'), /\[KIRIM: format\]/);
    assert.match(lampiranOtomatis('Backdrop basic-nya mau warna apa Kak?'), /\[KIRIM: backdrop\]/);
    assert.doesNotMatch(lampiranOtomatis('Cetaknya 4R ya Kak.'), /KIRIM/);
  });
  await kasus('link & alamat karangan ditangkap (…2792)', () => {
    assert.ok(ai.tautanAsing('share lok https://maps.app.goo.gl/w132t81yQ9kZ7dLLA', ai._sumberHarga()).length);
    assert.ok(ai.tautanAsing('Kawasan Niaga Citra Indah Blok A1 Sentul ya mas', ai._sumberHarga()).length);
    assert.deepStrictEqual(ai.tautanAsing('booking di https://booking.tetraphoto.com ya Kak', ai._sumberHarga()), []);
  });
  await kasus('12 jam dijawab "paket 8 jam Rp 5.000.000" ditangkap (…2553)', () => {
    assert.ok(ai.durasiKurang('Untuk 12 jam pakai paket 8 jam *Rp 5.000.000*', 'acaranya 12 jam kak'));
    assert.ok(!ai.durasiKurang('8 jam Rp 5.000.000 + extend 4 jam Rp 2.000.000', 'acaranya 12 jam kak'));
  });
  await kasus('harga extend "4 jam tambahan × Rp 500.000" tidak dianggap harga paket 4 jam', () => {
    assert.deepStrictEqual(ai.hargaAsing('8 jam *Rp 5.000.000* + 4 jam tambahan × Rp 500.000 = *Rp 7.000.000*', ai._sumberHarga()), []);
    assert.deepStrictEqual(ai.hargaAsing('paket *8 jam Rp 5.000.000* + extend 4 jam (*Rp 500.000*/jam) jadi *Rp 7.000.000*', ai._sumberHarga()), []);
    assert.ok(ai.hargaAsing('4 jam Rp 2.000.000', ai._sumberHarga()).length);
  });
  await kasus('janji "nanti aku kabari" tercatat ke admin (…4324)', () => {
    assert.ok(ai.RE_JANJI_ADMIN.test('Siap Kak, nanti aku kabari ya'));
  });
  await kasus('"Ini pricelist-nya" tanpa file → file dikirim (…9166)', () => {
    assert.ok(msgs._janjiPricelist('Ini pricelist-nya ya Kak', 'mau liat harga', [], []));
  });

  if (!process.argv.includes('--cepat')) {
    // ── Dengan AI (model sungguhan) ─────────────────────────────────────────
    const tanya = (hist, teks, ctx = LANJUT) => ai.getAIResponse(hist, teks, ctx);
    await kasus("Sa'adah: form + minta contoh ukuran frame → dijawab + lampiran, bukan oper admin", async () => {
      const r = await tanya([{ role: 'assistant', content: 'Untuk booking, mohon dibantu isi form berikut ya kak' }],
        'Untuk booking, mohon dibantu isi form berikut ya kak:\n1. Data Event\n- Nama Pengantin: Saadah & Muhammed\n- Tanggal Event: 22 November\n- Ukuran Frame: -\nizin perbarui ya ka\nka sklian mau liat contoh ukuran frame nya jg bisakah?');
      assert.ok(!BAKU_ADMIN.test(r) && !/ADMIN_HANDOFF/.test(r), r);
      assert.match(r, /\[KIRIM:\s*(format|layout)\]/i, r);
    });
    await kasus('…9512 "dapat soft file juga kan?" → dijawab dari FAQ', async () => {
      const r = await tanya([{ role: 'assistant', content: 'Untuk 4 jam Rp 3.000.000, sudah termasuk cetak sepuasnya.' }], 'dapat soft file juga kan kak?');
      assert.ok(!BAKU_ADMIN.test(r) && !/ADMIN_HANDOFF/.test(r), r);
      assert.match(r, /qr|flashdisk|softfile|soft file/i, r);
    });
    await kasus('…2152 "kalau 6 jam berapa, dapet softfile?" → Rp 4.000.000', async () => {
      const r = await tanya([], 'kalau 6 jam berapa ka? udah dapet softfile ka?');
      assert.ok(!/ADMIN_HANDOFF/.test(r), r);
      assert.match(r, /4\.000\.000|4 ?jt|4 juta/i, r);
    });
    await kasus('…2977 klien booking tanya rekening pelunasan → rekening resmi', async () => {
      const ctx = LANJUT + klienBooking.susun([{ tanggal: '2026-11-22', jam_mulai: '11:00', paket: 'Unlimited 4R 3 jam', status_bayar: 'dp' }]);
      const r = await tanya([], 'aku tf kemana untuk pelunasannya kak?', ctx);
      assert.ok(!BAKU_ADMIN.test(r) && !/ADMIN_HANDOFF/.test(r), r);
      assert.match(r, /0954965224/, r);
    });
    await kasus('…4373 screenshot keluhan → ditanggapi, tanpa klaim DP diterima', async () => {
      const r = await tanya([{ role: 'assistant', content: 'Silakan unggah desainnya di dashboard ya Kak.' }],
        'kak ini kok gabisa ya\n[kirim gambar: screenshot dashboard booking dengan pesan error saat unggah desain]');
      assert.ok(!/(dp|pembayaran|transfer)\w*\s+(sudah|udah)\s+(masuk|diterima)/i.test(r), r);
      assert.ok(r.replace(/\[[^\]]*\]/g, '').trim().length > 0, r);
    });
    await kasus('…2792 pemasok minta share lok → tanpa link/alamat karangan', async () => {
      const r = await tanya([{ role: 'user', content: 'saya temennya gilang yang jual paper dnp' }, { role: 'assistant', content: '(admin) Mauu order bang' }],
        'Mau diantar siang ini gk mas? boleh minta share loknya?');
      assert.deepStrictEqual(ai.tautanAsing(r, ai._sumberHarga()), [], r);
    });
    await kasus('…2553 butuh 12 jam → 8 jam + extend atau paket 13 jam', async () => {
      const r = await tanya([], 'kak kalau photobooth 12 jam berapa ya?');
      assert.ok(/ADMIN_HANDOFF/.test(r) || /7\.000\.000|7\.500\.000|7 ?jt|7,5 ?jt/i.test(r), r);
    });
    await kasus('Narita: jasa fotografer → Tetra Visual', async () => {
      const r = await tanya([], 'Halo kak, sepertinya kita ga jadi pake fotobooth\nKira2 kalo jasa fotografer nya aja ada gak sih kak?');
      assert.match(r, /tetra visual|visual\.tetraphoto/i, r);
    });
    await kasus('Aisy sudah booking 28 Nov → tidak dibilang "masih kosong"', async () => {
      const ctx = LANJUT + klienBooking.susun([{ tanggal: '2026-11-28', jam_mulai: '11:00', jam_selesai: '13:00', paket: '4R Unlimited 2 Jam', venue: 'Sasono Mulyo Depok', status_bayar: 'dp' }]);
      const r = await tanya([], 'kak untuk tanggal 28 November masih aman kan ya?', ctx);
      assert.ok(!/masih kosong|masih tersedia|slotnya masih ada/i.test(r), r);
    });
    await kasus('A.O kontak pertama (form web) → ≤420 karakter, satu harga', async () => {
      const r = await tanya([], 'Halo Tetra Photobooth!\nSaya dari website Tetra (halaman Beranda) dan mau cek ketersediaan serta rekomendasi paket.\n\nTanggal: Sabtu, 26 Desember 2026\nJam photobooth: 11.30 - 14.00\nDurasi: 2,5 jam\nJumlah tamu: Lebih dari 300\nPaket: Unlimited Photobooth\nCatatan: Wedding',
        `Sumber: tombol WhatsApp di website Tetra.\nNama klien: A.O (boleh dipakai menyapa).\n${SAPA}`);
      const isi = r.replace(/\[[^\]]*\]/g, '').trim();
      assert.ok(isi.length <= 420, `${isi.length} karakter: ${isi}`);
      assert.ok((isi.match(/Rp ?\d/g) || []).length <= 1, isi);
    });
    await kasus('tanya beda 2R/4R/Polaroid → [KIRIM: format] + teks pendek (Rama 11 Nov: ilustrasi > teks panjang)', async () => {
      const r = await tanya([], 'kak bedanya 2R, 4R sama polaroid apa ya? segede apa?', SAPA);
      assert.match(r, /\[KIRIM:\s*format\]/i, r);
      const isi = r.replace(/\[[^\]]*\]/g, '').trim();
      assert.ok(isi.length <= 300 && (isi.match(/\d+(?:,\d+)?\s*[×x]\s*\d+/g) || []).length <= 1, isi);
    });
    await kasus('tanya cetakan & frame/sleeve → [KIRIM: sleeve] + teks pendek (Rama 11 Nov)', async () => {
      const r = await tanya([], 'Ka biar ga miskom, jadi printed foto sendiri sama frame fotonya sendiri bener kan? masing2 ada desainnya?', 'TAHAP PERCAKAPAN: GALI. Baca klien dari riwayat.');
      assert.match(r, /\[KIRIM:\s*sleeve\]/i, r);
      assert.ok(r.replace(/\[[^\]]*\]/g, '').trim().length <= 300, r);
    });
    await kasus('minta PL → penanda [KIRIM: pricelist] (file ikut terkirim)', async () => {
      const r = await tanya([], 'Malam kak\nMau liat pl nya bisa?', SAPA);
      assert.match(r, /\[KIRIM:\s*pricelist\]/i, r);
      const isi = r.replace(/\[[^\]]*\]/g, '');
      assert.ok((isi.match(/Rp ?\d/g) || []).length <= 1, `daftar harga di teks: ${isi}`);
      assert.deepStrictEqual(ai.frasaKaku(isi), [], isi);
    });
  }

  for (const [s, n, e] of hasil) console.log(`${s === 'LOLOS' ? '✅' : '❌'} ${n}${e ? `\n   → ${e}` : ''}`);
  const gagal = hasil.filter((h) => h[0] === 'GAGAL').length;
  console.log(`\n${hasil.length - gagal}/${hasil.length} lolos`);
  process.exit(gagal ? 1 : 0);
})();
