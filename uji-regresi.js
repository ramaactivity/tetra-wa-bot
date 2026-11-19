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

const BOT_DIR = __dirname;
// Frasa kaku Rama (docs/FRASA-KAKU.md). Penjaganya di plugin Hermes penjaga-cs (Tahap 3); di sini hanya untuk menilai jawaban uji.
const FRASA = require('fs').readFileSync(`${BOT_DIR}/docs/FRASA-KAKU.md`, 'utf-8').split('\n').filter((l) => l.startsWith('- '))
  .map((l) => l.slice(2).split(' #')[0].trim().toLowerCase()).filter(Boolean);
const frasaKaku = (t) => FRASA.filter((f) => String(t).replace(/\[[A-Z_]+[^\]]*\]/g, '').toLowerCase().includes(f));

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
  await kasus('wajib Hermes: Hermes mati → error bertanda hermes, TIDAK jatuh ke jalur lama (Rama 16 Nov)', async () => {
    const simpan = { o: process.env.AI_OTAK, u: process.env.HERMES_CS_URL, k: process.env.HERMES_CS_KEY };
    Object.assign(process.env, { AI_OTAK: 'hermes', HERMES_CS_URL: 'http://127.0.0.1:9/v1', HERMES_CS_KEY: 'uji' });
    try {
      await assert.rejects(ai.getAIResponse([], 'kak harga 3 jam berapa?', 'Panggilan klien: Kak'), (e) => e.hermes === true);
    } finally {
      for (const [k, v] of [['AI_OTAK', simpan.o], ['HERMES_CS_URL', simpan.u], ['HERMES_CS_KEY', simpan.k]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });
  await kasus('usulan 67: kalimat oper owner yang sama tidak dikirim dua kali (…1927 panitia kampus)', () => {
    assert.ok(msgs._sudahDikirim([{ role: 'user', content: 'proposal sponsorship' }, { role: 'assistant', content: msgs._KALIMAT_KEMITRAAN }], msgs._KALIMAT_KEMITRAAN));
    assert.ok(!msgs._sudahDikirim([{ role: 'user', content: msgs._KALIMAT_KEMITRAAN }], msgs._KALIMAT_KEMITRAAN));
  });
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
  await kasus('buku instruksi (persona & cara-balas-wa) tidak memakai frasa kaku di luar kutipan (docs/FRASA-KAKU.md)', () => {
    // Kata instruksi bocor ke balasan; contoh yang dikutip "..." boleh (penangkapan frasa di jawaban = uji_penjaga.py).
    const fs = require('fs');
    const buku = fs.readFileSync(`${BOT_DIR}/docs/PERSONA-CS.md`, 'utf-8') + '\n' + fs.readFileSync(`${BOT_DIR}/hermes-skills/cara-balas-wa/SKILL.md`, 'utf-8');
    const instruksi = buku.replace(/"[^"]*"/g, '').toLowerCase();
    assert.ok(FRASA.includes('crew standby') && FRASA.includes('semoga'));
    assert.deepStrictEqual(FRASA.filter((f) => instruksi.includes(f)), []);
  });
  // 18 Nov (Rama: 100% buku Hermes): aturan "jangan daftar harga kalau ada pricelist" pindah ke skill faq-tetra; kode tidak boleh lagi
  // memaksa tulis ulang jawaban dua jalan (12 jam) yang benar.
  await kasus('pricelist: gambar dikirim tanpa caption (teks & gambar terpisah, Rama 12 & 18 Nov)', () => {
    assert.strictEqual(require('./src/lib/pricelist').CAPTION_GAMBAR, '');
  });
  await kasus('follow-up lead: susulan dihentikan & maks 3 pesan tak dibalas manusia; sambutan otomatis bukan balasan (Rama 19 Nov)', () => {
    const fe = require('./src/lib/followupEngine');
    assert.strictEqual(fe._SUSULAN_LEAD, false, 'susulan lead dinyalakan lagi hanya atas izin Rama');
    const K = (c) => ({ role: 'assistant', content: c }), L = (c) => ({ role: 'user', content: c });
    const oto = 'Hello! Thank you for contacting Maxima Production. Please let us know how we can help you.';
    const agave = 'Sebelumnya, list plan ini mohon dibantu untuk diisi dulu ya: [WEDDING / BIRTHDAY]';
    // sapaan + 2 susulan = 3 pesan tak dibalas → berhenti; sambutan otomatis di sela-selanya tidak mereset hitungan
    assert.strictEqual(fe._takDibalas([K('sapaan'), L(oto), K('fu1'), L(agave), K('fu2')]), 3, 'sambutan otomatis tidak mereset hitungan');
    assert.strictEqual(fe._takDibalas([K('sapaan'), L('boleh kak, kirim PL nya'), K('ini PL'), K('(admin) siap kak')]), 1, 'balasan manusia mereset; pesan admin tidak dihitung');
  });
  await kasus('data acara setelah DP: form lengkap langsung, bukan dicicil (Rama 11 Nov)', () => {
    const booking = require('./src/lib/booking');
    const f = booking.teksForm({ data: { tanggal: '22 November', paket: 'Unlimited 8 jam' }, jenis: 'wedding' }, '');
    assert.match(f, /Boleh dibantu untuk dilengkapi formnya Kak/, f);
    assert.doesNotMatch(f, /langsung aja|tolong dibantu/i, f);
    assert.match(f, /Tanggal Event: 22 November/, f);
    assert.deepStrictEqual(frasaKaku(f), [], f);
    assert.ok(frasaKaku('Kak, biar desain frame-nya bisa mulai dikerjakan, aku butuh nama acara. Sisanya boleh nyusul, dicicil juga nggak masalah.').length);
  });
  await kasus('form per jenis acara: Natal → form keagamaan, bukan "Nama Pengantin" (Rama 19 Nov, Yessi; peta Hermes t_8843a9c1 A2)', () => {
    const booking = require('./src/lib/booking');
    const b = { data: { nama_acara: 'Natal 2026', tanggal: '2 Desember 2026', lokasi: 'Grand Wisata' }, jenis: 'natal' };
    assert.strictEqual(booking.jenisGrup(b), 'keagamaan');
    const f = booking.badanForm(b);
    assert.match(f, /Gereja \/ Komunitas \/ Penyelenggara:/, f);
    assert.match(f, /Lokasi Event: Grand Wisata/, f);
    assert.doesNotMatch(f, /Pengantin/, f);
    assert.strictEqual(booking.jenisGrup({ data: { jenis: 'Korporat', catatan: 'minta promo' } }), 'korporat');
    assert.strictEqual(booking.jenisGrup({ data: { catatan: 'ada promo segala' } }), 'lainnya', 'promo/segala bukan prom/gala');
  });
  await kasus('tanggal acara: jam tidak terbaca tahun/tanggal (audit 18 Nov, "8 agustus 13.30" → 2013)', () => {
    const lead = require('./src/lib/smartLead');
    const ref = new Date('2026-07-01T00:00:00+07:00');
    const iso = (t) => lead.toISODate(lead.parseLeadDetails(t).tanggal, ref);
    assert.strictEqual(iso('360 untuk 8 agustus 13.30 bisa ?'), '2026-08-08');
    assert.strictEqual(iso('Acara: wedding\nTanggal: Sabtu, 21 November 2026\nJam photobooth: 11.00 - 13.00'), '2026-11-21');
    assert.strictEqual(iso('tgl 25/12 di bogor'), '2026-12-25');
    assert.strictEqual(iso('acaranya mulai jam 10.12 kak'), null);
  });
  await kasus('jatah uji per pemanggil: cron maks 4 uji_balasan/hari & tidak memakan jatah lain (temuan Hermes t_769ccf81)', () => {
    const simpan = { ...process.env };
    const file = `/tmp/anggaran-regresi-${process.pid}.json`;
    try {
      Object.assign(process.env, { ANGGARAN_UJI_FILE: file, SALDO_SUMOPOD_FILE: '/tmp/tidak-ada-saldo.json', HERMES_SESSION_PROFILE: '', HERMES_HOME: '/home/ubuntu/.hermes/profiles/tetra-wa-bot', HERMES_CRON_SESSION: '1' });
      delete process.env.HERMES_PROFILE; delete process.env.RAMA_MANUAL;
      delete require.cache[require.resolve('./src/lib/anggaranUji')];
      const a = require('./src/lib/anggaranUji');
      for (let i = 0; i < 4; i++) a.periksaDanCatat('uji_balasan');
      assert.throws(() => a.periksaDanCatat('uji_balasan'), /cron\) habis/);
      process.env.HERMES_CRON_SESSION = '0';
      const r = a.periksaDanCatat('uji_balasan');
      assert.strictEqual(r.terpakai.uji_balasan, 1, 'cron tidak memakan jatah uji_balasan pemanggil lain');
      assert.strictEqual(r.terpakai.total_panggilan, 5);
      const d = JSON.parse(require('fs').readFileSync(file, 'utf-8'));
      assert.strictEqual(d.terpakai_per_pemanggil['hermes:tetra-wa-bot:cron'].uji_balasan, 4);
      assert.strictEqual(d.riwayat.at(-1).pemanggil, 'hermes:tetra-wa-bot');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in simpan)) delete process.env[k];
      Object.assign(process.env, simpan);
      try { require('fs').unlinkSync(file); } catch {}
      delete require.cache[require.resolve('./src/lib/anggaranUji')];
    }
  });
  await kasus('klien bilang pricelist belum masuk → dikirim ulang (pemulihan pengiriman tetap di Node)', () => {
    assert.ok(msgs._janjiPricelist('Aduh maaf Kak', 'kak pricelistnya ga masuk', [], [{ role: 'assistant', content: 'Silahkan Kak, berikut pricelistnya ya' }]));
    assert.ok(!msgs._janjiPricelist('Ini pricelist-nya ya Kak', 'mau liat harga', [], []), 'janji tanpa penanda kini ditangani plugin');
  });

  if (!process.argv.includes('--cepat')) {
    // ── Dengan AI (model sungguhan) ─────────────────────────────────────────
    const anggaran = require('./src/lib/anggaranUji');
    try {
      anggaran.periksaDanCatat('regresi', { jumlah_kasus: 13 });
    } catch (err) {
      console.log(`\n⚠️  Uji AI regresi ditahan: ${err.message}`);
      console.log("   Gunakan: npm run regresi -- --cepat (uji aturan & penjaga tanpa AI)\n");
      process.exit(1);
    }
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
      assert.ok(!/https?:\/\/(?!(?:[\w-]+\.)?tetraphoto\.com)/i.test(r) && !/maps\.app|goo\.gl|\bblok\s+[a-z]?\d/i.test(r), r); // link/alamat karangan
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
      assert.deepStrictEqual(frasaKaku(isi), [], isi);
    });
  }

  for (const [s, n, e] of hasil) console.log(`${s === 'LOLOS' ? '✅' : '❌'} ${n}${e ? `\n   → ${e}` : ''}`);
  const gagal = hasil.filter((h) => h[0] === 'GAGAL').length;
  console.log(`\n${hasil.length - gagal}/${hasil.length} lolos`);
  process.exit(gagal ? 1 : 0);
})();
