// Uji alur handler pesan dengan dependensi palsu.
// JALANKAN DI SALINAN REPO: store.js menulis data/riwayat.json.
const assert = require('assert');
const path = require('path');
const { proto } = require('@whiskeysockets/baileys');
const R = (p) => require.resolve(path.join(process.cwd(), p));

const log = { kirim: [], notif: [], pause: [], sejarah: [], wa: [], tg: [] };
let ekstrak = {};
const ops = []; let opsJawab = { ok: true, status: 200, json: { status: 'baru', url: '/operations/booking-masuk/abc', doc_number: 'QUO-TP-01-27092026' } };
let paused = {};
let aiJawab = 'halo';
let leadsUji = [{ wa_jid: '62700111@lid', name: 'Sidik CIMB', phone: '6285776848169' }];
let nilai = { kirim: true, status: 'calon_klien_menggantung' };
const stub = (p, exp) => { require.cache[R(p)] = { id: R(p), filename: R(p), loaded: true, exports: exp }; };
stub('src/lib/supa.js', {
  fetchPausedContacts: async () => paused,
  fetchVendorContacts: async () => [{ name: 'Party Planner', phone: '+62 878-7189-3437' }, { name: 'Primera Wedding', phone: '0899-0471-515' }],
  fetchRecentLeads: async () => leadsUji,
  fetchAddonNames: async () => ['Guest Books Photo'], fetchLeadMessages: async () => [],
  insertLead: async () => {}, upsertPause: async (j, u, s) => log.pause.push({ s, jam: (u - Date.now()) / 3600000 }),
});
stub('src/lib/sheetSync.js', { syncToSheet: async () => {} });
stub('src/lib/sender.js', { sendReply: async (s, j, k, r, t) => log.kirim.push(t), sendDocument: async (s, j, f, c) => { log.kirim.push(`[DOK ${require('path').basename(f)}]`); return { key: { id: 'd' + Math.random() } }; } });
stub('src/lib/deliveryLog.js', { track: () => {} });
stub('src/lib/notify.js', { notifyAdmin: async (s, f, rule, r, extra) => log.notif.push(`${rule.name}:${extra}`), kirimTelegram: async (t) => log.tg.push(t) });
stub('src/lib/pricelist.js', { kirimPricelist: async () => log.kirim.push('[PL]'), mintaPricelist: (t) => /pricelist/i.test(t), ASSETS_DIR: '/tmp' });
stub('src/lib/ai.js', {
  getAIResponse: async (...a) => { if (aiJawab instanceof Error) throw aiJawab; return typeof aiJawab === 'function' ? aiJawab(...a) : aiJawab; },
  ringkasPercakapan: async (lama, pesan) => `RINGKAS ${pesan.length}`,
  ekstrakBooking: async () => ekstrak,
  nilaiFollowup: async () => nilai,
  ekstrakQuotation: async () => ({ klien: { nama: 'PT Maju', attn: 'Bu Sari' }, acara: { kota: 'Jakarta' },
    layanan: [{ kategori: 'photobooth_classic', jam: '4', format: '4r' }, { kategori: null }], addons: [], gross_up: true, usulan_diskon: { persen: 10, alasan: 'x' } }),
});
stub('src/lib/availability.js', {
  checkAvailability: async () => null, enabled: () => true, summarize: () => '',
  opsBase: () => 'https://ops.test', postOps: async (p, body) => { ops.push({ p, body }); return opsJawab; },
});
stub('src/lib/liveConfig.js', { isEnabled: () => true, get: () => ({ PAUSE_HOURS: 24, ADMIN_NOTIFY_JID: 'admin@s.whatsapp.net' }) });

const store = require(R('src/lib/store.js'));
const { registerMessageHandler } = require(R('src/handlers/messages.js'));
const handlers = {};
const sock = {
  ev: { on: (e, f) => (handlers[e] = f) },
  presenceSubscribe: async () => {},
  fetchMessageHistory: async (n, key, ts) => log.sejarah.push({ jid: key.remoteJid, ts }),
  readMessages: async () => {},
  sendMessage: async (jid, isi) => {
    if (jid === 'admin@s.whatsapp.net') log.wa.push(isi.forward ? '[FORWARD]' : isi.text);
    else log.kirim.push(isi.text);
    return { key: { id: 'b' + Math.random(), remoteJid: jid } };
  },
};
process.env.REPLY_DELAY_SECONDS = '0.05';
registerMessageHandler(sock);

let n = 0;
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
async function kirim(message, jid = `62800${++n}@s.whatsapp.net`) {
  log.kirim = []; log.notif = []; log.pause = []; log.wa = []; log.tg = [];
  await handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: jid, id: 'x' + Math.random() }, message, messageTimestamp: Math.floor(Date.now() / 1000) }] });
  await tunggu(400);
  return { ...log, jid };
}

(async () => {
  let r = await kirim({ audioMessage: {} });
  assert.match(r.kirim[0], /voice note/); assert.strictEqual(r.notif.length, 0);

  r = await kirim({ imageMessage: {} });
  assert.match(r.kirim[0], /Admin cek dulu/); assert.strictEqual(r.pause[0].s, 'ai');
  assert.ok(Math.abs(r.pause[0].jam - 2) < 0.01, 'handoff AI harus pause 2 jam');

  aiJawab = '[DIAM]';
  r = await kirim({ conversation: 'Selamat menempuh hidup baru!' });
  assert.strictEqual(r.kirim.length, 0);

  aiJawab = '[ADMIN_HANDOFF]';
  r = await kirim({ conversation: 'minta pricelist dong, kirim aja' });
  assert.ok(!r.kirim.some((t) => t.includes('[ADMIN_HANDOFF]')), 'kode handoff bocor ke klien');

  aiJawab = new Error('Sumopod & 9Router mati');
  r = await kirim({ conversation: 'halo kak mau tanya' });
  assert.match(r.kirim[0], /teruskan ke admin/); assert.strictEqual(r.notif.length, 1);

  // INFO_ADMIN: penanda dibuang dari balasan, admin dapat notif INFO, bot tidak pause
  aiJawab = 'Untuk promo nanti admin yang info ya Kak.\n[INFO_ADMIN: tanya promo]';
  r = await kirim({ conversation: 'ada promo ga kak?' });
  assert.deepStrictEqual(r.kirim, ['Untuk promo nanti admin yang info ya Kak.']);
  assert.deepStrictEqual(r.notif, ['INFO:tanya promo']); assert.strictEqual(r.pause.length, 0);

  // Balasan manual admin masuk riwayat
  const jidA = r.jid;
  await handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: jidA, id: 'adm1', fromMe: true }, message: { conversation: 'Promo 5% ya kak' } }] });
  await tunggu(100);
  assert.strictEqual(store.getRiwayat(jidA).at(-1).content, '(admin) Promo 5% ya kak');

  // Riwayat dari HP: diminta saat kontak pertama chat, digabung di depan
  process.env.TARIK_SEJARAH = 'on'; // fitur ini mati secara bawaan (popup Syncing di HP)
  const jidH = '62899@s.whatsapp.net';
  aiJawab = 'oke';
  const nowS = Math.floor(Date.now() / 1000);
  const pSejarah = kirim({ conversation: 'jadi gimana kak?' }, jidH);
  await tunggu(20);
  assert.ok(log.sejarah.some((x) => x.jid === jidH), 'history tidak diminta');
  handlers['messaging-history.set']({
    syncType: proto.HistorySync.HistorySyncType.ON_DEMAND,
    messages: [
      { key: { remoteJid: jidH, fromMe: false, id: 'h1' }, message: { conversation: 'wedding 5 des di Sentul' }, messageTimestamp: nowS - 86400 * 20 },
      { key: { remoteJid: jidH, fromMe: true, id: 'h2' }, message: { conversation: 'siap kak, 3 jam ya' }, messageTimestamp: nowS - 86400 * 19 },
    ],
  });
  await pSejarah;
  const rh = store.getRiwayat(jidH).map((p) => p.content);
  assert.match(rh[0], /wedding 5 des di Sentul/); assert.match(rh[1], /3 jam/);
  assert.strictEqual(rh[2], 'jadi gimana kak?'); assert.ok(store.sudahSejarah(jidH));

  // Riwayat panjang dirangkum: sisa 80 pesan utuh + catatan klien
  const jidL = '62877@s.whatsapp.net';
  for (let i = 0; i < 130; i++) store.tambahRiwayat(jidL, i % 2 ? 'assistant' : 'user', `pesan ${i}`);
  await kirim({ conversation: 'lanjut' }, jidL);
  assert.strictEqual(store.getRiwayat(jidL).length, 80);
  assert.match(store.getRingkasan(jidL), /^RINGKAS \d+$/);

  aiJawab = 'Tanggal 7 November masih kosong.';
  r = await kirim({ conversation: 'tgl 7 nov kosong?' });
  assert.deepStrictEqual(r.kirim, ['Tanggal 7 November masih kosong.']);

  // Lampiran backdrop: teks dulu, lalu PDF; penanda tidak bocor; tidak dobel
  const jidD = '62833@s.whatsapp.net';
  aiJawab = 'Backdrop basic ada 6 warna Kak, contohnya aku kirim ya.\n[KIRIM: backdrop]';
  r = await kirim({ conversation: 'backdropnya ada warna apa aja kak?' }, jidD);
  assert.deepStrictEqual(r.kirim, ['Backdrop basic ada 6 warna Kak, contohnya aku kirim ya.', '[DOK BACKDROP TETRA.pdf]']);
  r = await kirim({ conversation: 'yang biru ada ya kak?' }, jidD);
  assert.ok(!r.kirim.includes('[DOK BACKDROP TETRA.pdf]'), 'PDF backdrop terkirim dua kali');
  assert.ok(!r.kirim.some((t) => /\[KIRIM/.test(t)), 'penanda KIRIM bocor');

  // Quotation: penanda dibuang, draft diminta ke Tetra Ops, tidak dobel, gagal → admin tahu
  const jidQ = '62844@s.whatsapp.net';
  aiJawab = 'Siap Bu, penawarannya aku siapkan dan dicek admin dulu.\n[QUOTATION]';
  ops.length = 0;
  r = await kirim({ conversation: 'minta penawaran resmi ya kak, PT Maju, 4 jam 4R di Jakarta' }, jidQ);
  assert.deepStrictEqual(r.kirim, ['Siap Bu, penawarannya aku siapkan dan dicek admin dulu.']);
  const q = ops.find((o) => o.p === '/api/bot/quotation');
  assert.ok(q, 'quotation tidak diminta');
  assert.strictEqual(q.body.sumber.jenis, 'wa_bot'); assert.strictEqual(q.body.layanan.length, 1);
  assert.strictEqual(q.body.layanan[0].jam, 4); assert.ok(!('usulan_diskon' in q.body), 'bot tidak boleh usul diskon');
  assert.ok(q.body.external_id.startsWith('quo:62844@'));
  await kirim({ conversation: 'ditunggu ya' }, jidQ);
  const q2 = ops.filter((o) => o.p === '/api/bot/quotation');
  assert.strictEqual(q2.at(-1).body.external_id, q.body.external_id, 'permintaan sama harus external_id sama');
  opsJawab = { ok: false, status: 400, json: { error: 'Body tidak valid' } };
  r = await kirim({ conversation: 'tolong kirim lagi penawarannya' }, jidQ);
  assert.ok(r.notif.some((n) => /GAGAL/.test(n)), 'gagal quotation tidak dilaporkan ke admin');
  opsJawab = { ok: true, status: 200, json: { status: 'baru', url: '/operations/booking-masuk/abc', doc_number: 'QUO-TP-01-27092026' } };

  // [KIRIM: pricelist] digerbang (keputusan Rama 1 Okt): kebutuhan belum digali -> tidak dikirim
  const jidP = '62855@s.whatsapp.net';
  aiJawab = 'Ini gambaran paketnya Kak.\n[KIRIM: pricelist]';
  r = await kirim({ conversation: 'saya ada rencana wedding, boleh info pricelist nya kak' }, jidP);
  assert.deepStrictEqual(r.kirim, ['Ini gambaran paketnya Kak.'], 'PL terkirim sebelum kebutuhan digali');
  // Klien minta lagi setelah ditanya -> boleh, sekali saja
  r = await kirim({ conversation: 'pricelist nya dulu aja kak' }, jidP);
  assert.deepStrictEqual(r.kirim, ['Ini gambaran paketnya Kak.', '[PL]']);
  store.tambahRiwayat(jidP, 'assistant', '[kirim PDF pricelist] + gambar ringkas paket unlimited');
  r = await kirim({ conversation: 'yang 360 berapa lagi kak' }, jidP);
  assert.ok(!r.kirim.includes('[PL]'), 'pricelist terkirim dua kali');

  // Klaim palsu "sudah aku perbarui": ditulis ulang; kalau tetap klaim -> kalimat aman + admin dikabari
  const jidK = '62866@s.whatsapp.net';
  aiJawab = 'Geser ke 10.00-13.00 aman Kak, sudah aku perbarui ya jadwalnya.';
  r = await kirim({ conversation: 'kak jamnya digeser jam 10-1 bisa?' }, jidK);
  assert.strictEqual(r.kirim.length, 1); assert.ok(!/sudah aku perbarui/.test(r.kirim[0]), 'klaim palsu terkirim');
  assert.match(r.kirim[0], /teruskan ke admin/);
  assert.ok(r.notif.some((n) => n.startsWith('PERUBAHAN:')), 'admin tidak dikabari (WA)');
  assert.ok(r.tg.some((t) => /perubahan/i.test(t)), 'admin tidak dikabari (Telegram)');
  let panggil = 0;
  aiJawab = () => (++panggil === 1 ? 'Sudah aku ubah jadwalnya Kak.' : 'Aku teruskan ke admin ya Kak, nanti dikonfirmasi.\n[PERUBAHAN: jam | 08.00 -> 10.00-13.00]');
  r = await kirim({ conversation: 'jadi jam 10 ya kak' }, jidK);
  assert.deepStrictEqual(r.kirim, ['Aku teruskan ke admin ya Kak, nanti dikonfirmasi.']);
  assert.ok(r.notif.includes('PERUBAHAN:jam | 08.00 -> 10.00-13.00'));

  // Penanda PERUBAHAN biasa: tidak bocor, admin WA+Telegram, usulan ke Tetra Ops
  ops.length = 0;
  aiJawab = 'Permintaan geser jamnya aku teruskan ke admin ya Kak.\n[PERUBAHAN: jam | 08.00 -> 10.00-13.00]';
  r = await kirim({ conversation: 'geser jam 10 bisa kak?' }, '62877001@s.whatsapp.net');
  assert.deepStrictEqual(r.kirim, ['Permintaan geser jamnya aku teruskan ke admin ya Kak.']);
  assert.strictEqual(r.tg.length, 1);
  const chg = ops.find((o) => o.p === '/api/bot/perubahan');
  assert.ok(chg && chg.body.jenis === 'jam' && /10\.00-13\.00/.test(chg.body.perubahan), 'usulan ke Tetra Ops salah');

  // Admin membalas saat bot memproses -> balasan bot dibatalkan
  const jidR = '62888@s.whatsapp.net';
  aiJawab = async () => {
    await handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: jidR, id: 'admR', fromMe: true }, message: { conversation: 'Bisaa kaka, boleh.' } }] });
    return 'Bisa Kak.';
  };
  r = await kirim({ conversation: 'bisa geser jam kak?' }, jidR);
  assert.strictEqual(r.kirim.length, 0, 'bot ikut membalas padahal admin sudah membalas: ' + JSON.stringify(r.kirim));

  // Tebal Markdown dirapikan ke gaya WA
  aiJawab = 'Harganya **Rp 2.000.000** ya Kak.';
  r = await kirim({ conversation: 'harga 2 jam?' });
  assert.deepStrictEqual(r.kirim, ['Harganya *Rp 2.000.000* ya Kak.']);

  // Layout & panduan: panduan saja kalau keduanya; tidak dikirim ulang kalau admin sudah kirim manual
  const jidL2 = '62899001@s.whatsapp.net';
  aiJawab = 'Ini panduan ukurannya Kak.\n[KIRIM: layout] [KIRIM: panduan]';
  r = await kirim({ conversation: 'minta template ukuran buat desain sendiri kak' }, jidL2);
  assert.deepStrictEqual(r.kirim, ['Ini panduan ukurannya Kak.', '[DOK LAYOUT & PANDUAN UKURAN.pdf]']);
  aiJawab = 'Bedanya begini Kak.\n[KIRIM: layout]';
  r = await kirim({ conversation: 'bedanya 2R sama 4R apa?' }, jidL2);
  assert.deepStrictEqual(r.kirim, ['Bedanya begini Kak.'], 'layout dikirim padahal panduan (berisi layout) sudah');
  const jidL3 = '62899002@s.whatsapp.net';
  store.tambahRiwayat(jidL3, 'assistant', '(admin) [kirim dokumen: LAYOUT & PANDUAN UKURAN .pdf]');
  aiJawab = 'Panduannya sudah dikirim admin di atas ya Kak.\n[KIRIM: panduan]';
  r = await kirim({ conversation: 'ukuran canvasnya berapa ya?' }, jidL3);
  assert.ok(!r.kirim.some((t) => /PANDUAN/.test(t)), 'panduan dikirim ulang padahal admin sudah kirim');

  // Pesan tak terbuka (Bad MAC): pulih -> diam; tidak pulih 10 menit -> admin dikabari (klien dikenal saja)
  const mh = require(R('src/handlers/messages.js'));
  const stub = (j) => handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: j, id: 's' + Math.random() }, messageStubType: 2 }] });
  await stub('62700111@lid'); await stub('62700222@lid'); await stub('62700333@lid');
  await handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: '62700222@lid', id: 'ok1' }, message: { conversation: 'halo' }, messageTimestamp: Math.floor(Date.now() / 1000) }] });
  for (const g of mh._gagalBuka.values()) g.sejak -= 11 * 60 * 1000;
  log.tg = []; log.wa = [];
  await mh.periksaGagalBuka();
  assert.strictEqual(log.tg.length, 1, 'harus tepat 1 laporan (Sidik); yang pulih & tak dikenal tidak');
  assert.match(log.tg[0], /Sidik CIMB \(wa\.me\/6285776848169\)/);
  assert.ok(log.wa.some((t) => /tidak bisa dibuka bot/.test(t)), 'admin WA tidak dikabari');
  log.tg = [];
  await mh.periksaGagalBuka();
  assert.strictEqual(log.tg.length, 0, 'laporan dobel');
  await tunggu(300);

  // Vendor rekanan: konteks vendor + harga khusus, tanpa KONTAK PERTAMA; vendor tanpa kesepakatan -> admin
  let ctxVendor = '';
  aiJawab = (h, m, ctx) => { ctxVendor = ctx; return 'Siap teh, aman tanggalnya. Masih 1,7 ya teh hihi'; };
  r = await kirim({ conversation: 'Kaaa mau tanya, Minggu 4 Okt jam 19-21, 101 Hotel, unlimited 2 jam. Available?' }, '6287871893437@s.whatsapp.net');
  assert.match(ctxVendor, /KONTAK INI VENDOR REKANAN: Party Planner/); assert.match(ctxVendor, /1\.700\.000/);
  assert.ok(!/KONTAK PERTAMA dengan klien/.test(ctxVendor), 'vendor tidak boleh diperlakukan kontak pertama');
  await kirim({ conversation: 'halo kak' }, '628990471515@s.whatsapp.net');
  assert.match(ctxVendor, /VENDOR REKANAN: Primera Wedding/); assert.match(ctxVendor, /Belum ada kesepakatan harga tertulis/);
  await kirim({ conversation: 'halo kak mau tanya harga' }, '6281200001111@s.whatsapp.net');
  assert.ok(!/VENDOR REKANAN/.test(ctxVendor), 'nomor biasa dianggap vendor');

  // ── Tahap booking ──
  const booking = require(R('src/lib/booking.js'));
  const jidB = '62811@s.whatsapp.net';
  aiJawab = 'Sip, ditunggu bukti transfernya ya Kak.';
  await kirim({ conversation: 'aku udah transfer dp ya kak' }, jidB);
  ekstrak = { tanggal: 'Sabtu, 5 Des 2026', tanggal_iso: '2026-12-05', paket: '3 jam', lokasi: 'Sentul' };
  r = await kirim({ imageMessage: {} }, jidB);
  assert.match(r.kirim[0], /bukti transfernya sudah aku terima/); assert.match(r.kirim[0], /\*1\. Data acara\*/);
  assert.match(r.kirim[0], /Tanggal: Sabtu, 5 Des 2026/, 'form tidak terisi otomatis');
  assert.ok(r.kirim.includes('[DOK KATALOG DESAIN FRAME TETRA.pdf]'), 'katalog tidak terkirim');
  assert.deepStrictEqual(r.wa[0], '[FORWARD]', 'bukti transfer tidak diteruskan ke admin');
  assert.match(r.wa[1], /Bukti DP masuk/); assert.match(r.wa[1], /Belum diisi: .*PIC/);
  assert.ok(!/Jumlah unit/.test(r.wa[1]), '1 unit tidak perlu disebut di rekap');
  const kirimOps = ops.filter((o) => o.p === '/api/bot/booking');
  assert.ok(kirimOps.length >= 1 && kirimOps[0].body.external_id.startsWith('wa:62811@'), 'booking tidak dikirim ke Tetra Ops');
  assert.strictEqual(kirimOps.at(-1).body.data.tanggal_iso, '2026-12-05');
  assert.match(r.wa[1], /Buka di Booking Masuk: https:\/\/ops\.test\/operations\/booking-masuk\/abc/);
  assert.strictEqual(r.pause.length, 0, 'tahap booking tidak boleh pause');

  // Data dicicil sampai lengkap → rekap "lengkap" ke admin
  ekstrak = { nama_acara: 'Budi & Sari', jam: '13.00-16.00', pic: 'Andi 0812', ukuran_frame: '4R', desain_frame: 'katalog hal 5 no 2', backdrop: 'Gold' };
  aiJawab = 'Siap, sudah aku catat Kak.';
  r = await kirim({ conversation: 'pengantin Budi & Sari, jam 13-16, PIC Andi 0812, 4R desain hal 5 no 2, backdrop gold' }, jidB);
  assert.ok(booking.get(jidB).lengkap); assert.match(r.wa.at(-1), /Data booking lengkap/);
  // Ubah jam setelah lengkap → rekap "Update"
  ekstrak = { jam: '14.00-17.00', jumlah_unit: '2' };
  r = await kirim({ conversation: 'eh jamnya mundur jadi 14-17 ya, sama jadi 2 booth' }, jidB);
  assert.match(r.wa.at(-1), /Update data booking/); assert.match(r.wa.at(-1), /14\.00-17\.00/);
  // Multi-unit: tampil di rekap admin & terkirim apa adanya ke Tetra Ops
  assert.match(r.wa.at(-1), /Jumlah unit: 2 \(2 spot photobooth\)/);
  assert.strictEqual(ops.filter((o) => o.p === '/api/bot/booking').at(-1).body.data.jumlah_unit, '2');

  // Gambar di tahap booking → diteruskan, bot tetap melayani, tidak mulai ulang
  r = await kirim({ imageMessage: {} }, jidB);
  assert.deepStrictEqual(r.kirim, ['Sudah aku terima Kak, aku teruskan ke tim Tetra ya.']);
  assert.ok(r.wa.includes('[FORWARD]'));

  // Admin konfirmasi DP manual → form + katalog
  const jidC = '62822@s.whatsapp.net';
  ekstrak = {};
  log.kirim = []; log.wa = [];
  await handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: jidC, id: 'adm2', fromMe: true }, message: { conversation: 'DP sudah kami terima ya kak, terima kasih' } }] });
  await tunggu(200);
  assert.match(log.kirim[0], /DP-nya sudah diterima/); assert.ok(log.kirim.includes('[DOK KATALOG DESAIN FRAME TETRA.pdf]'));
  assert.match(log.wa[0], /DP dikonfirmasi admin/);

  // Kontak di-pause: bot diam tapi pesan tetap masuk riwayat
  paused = { [jidC]: Date.now() + 3600e3 };
  r = await kirim({ conversation: 'acaranya di Bogor kak' }, jidC);
  assert.strictEqual(r.kirim.length, 0);
  assert.strictEqual(store.getRiwayat(jidC).at(-1).content, 'acaranya di Bogor kak');
  paused = {};

  // Follow-up data booking: jidC belum lengkap & diam > 48 jam → diingatkan
  const fe = require(R('src/lib/followupEngine.js'));
  const bc = booking.get(jidC); bc.terakhirTanya = 0;
  const rw = store.getRiwayat(jidC); rw.forEach((p) => { p.t = 1; });
  aiJawab = 'Kak, tinggal nama acara & PIC-nya ya, boleh dicicil.';
  log.kirim = [];
  await fe.followupBooking(sock, {}, 0);
  assert.deepStrictEqual(log.kirim, ['Kak, tinggal nama acara & PIC-nya ya, boleh dicicil.']);
  log.kirim = [];
  await fe.followupBooking(sock, {}, 0);
  assert.strictEqual(log.kirim.length, 0, 'follow-up booking dobel');

  // ── Follow-up klien: baca konteks utuh dulu (insiden 27–28 Sep) ──
  // Paksa "jam kerja" 10.00 supaya tes tidak bergantung jam jalan.
  require.cache[R('src/lib/liveConfig.js')].exports.get = () => ({ TIMEZONE_OFFSET: 10 - new Date().getUTCHours() });
  const duaHari = new Date(Date.now() - 2 * 864e5).toISOString();
  const lead = (jid, message) => ({ wa_jid: jid, name: 'Dini', phone: '628111', message, topic: 'lead', created_at: duaHari });
  const siap = (jid, ...chat) => chat.forEach(([role, c]) => store.tambahRiwayat(jid, role, c));
  const fu = async () => { log.kirim = []; await fe.runFollowupCycle(sock); return log.kirim; };
  // 1. Admin sudah pernah balas manual → tidak di-follow-up bot
  siap('fu1@lid', ['user', 'promo expo masih ada?'], ['assistant', '(admin) Spesial buat kaka promonya masih berlaku'], ['assistant', 'Yuk dibooking kak']);
  // 2. Klien bilang sudah booking tempat lain (hanya ada di Supabase, tidak di riwayat)
  siap('fu2@lid', ['user', 'harga 3 jam berapa?'], ['assistant', '3 jam Rp 2.500.000 ya Kak.']);
  // 3. Pernah di-pause (handoff/admin) walau sudah kedaluwarsa
  siap('fu3@lid', ['user', 'minta pricelist'], ['assistant', 'Ini pricelistnya Kak.']);
  // 4. Penilai AI bilang bukan calon klien (broadcast vendor)
  siap('fu4@lid', ['user', 'Selamat menempuh hidup baru Kak Silvia & Syahrul, Been Sae Bakery'], ['assistant', 'Aamiin.']);
  leadsUji = [lead('fu1@lid', 'promo expo masih ada?'), lead('fu2@lid', 'harga 3 jam berapa?'),
    { ...lead('fu2@lid', 'yahh maaf kak tadi sore aku booking tempat lain'), created_at: new Date(Date.now() - 1.5 * 864e5).toISOString() },
    lead('fu3@lid', 'minta pricelist'), lead('fu4@lid', 'Selamat menempuh hidup baru')];
  paused = { 'fu3@lid': Date.now() - 864e5 };
  nilai = { kirim: false, status: 'vendor_atau_usaha_lain' };
  aiJawab = 'Kak Dini, tanggal 7 Nov-nya jadi?';
  assert.deepStrictEqual(await fu(), [], 'follow-up terkirim ke kontak yang harus dilewati');
  // 5. Calon klien menggantung + penilai setuju → terkirim; kalimat basi ditahan
  paused = {};
  siap('fu5@lid', ['user', 'wedding november di Balitro, tamu belum tahu'], ['assistant', 'Wedding biasanya 4 jam paling aman Kak.']);
  leadsUji = [lead('fu5@lid', 'wedding november di Balitro, tamu belum tahu')];
  nilai = { kirim: true, status: 'calon_klien_menggantung' };
  aiJawab = 'Halo Kak! Mau follow up, tim Tetra siap ramaikan acaranya.';
  assert.deepStrictEqual(await fu(), [], 'kalimat basi lolos');
  aiJawab = 'Kak Dini, tanggal wedding di Balitro sudah ketemu? Kabari aja, aku cek slotnya hari itu juga.';
  assert.deepStrictEqual(await fu(), [aiJawab]);

  // ── Mode assist: admin pegang tapi diam >= 30 menit ──
  const { _assist } = require(R('src/handlers/messages.js'));
  const siapAssist = (jid, tanya) => {
    siap(jid, ['user', 'harga 3 jam berapa?'], ['assistant', '(admin) 3 jam 2,5jt kak']);
    store.tambahRiwayat(jid, 'user', tanya);
    store.getRiwayat(jid).at(-1).t = Date.now() - 31 * 60e3;
    paused[jid] = Date.now() + 20 * 3600e3;
  };
  const assist = async () => { log.kirim = []; log.notif = []; log.tg = []; await _assist(); await tunggu(50); return log; };
  paused = {};
  // Pertanyaan umum → dijawab bot
  siapAssist('as1@lid', 'jam operasional sampai jam berapa kak?');
  aiJawab = 'Jam operasional kami 06.00–23.00 WIB Kak.';
  r = await assist();
  assert.deepStrictEqual(r.kirim, ['Jam operasional kami 06.00–23.00 WIB Kak.']);
  assert.strictEqual(store.getRiwayat('as1@lid').at(-1).content, 'Jam operasional kami 06.00–23.00 WIB Kak.');
  r = await assist();
  assert.strictEqual(r.kirim.length, 0, 'assist menjawab dua kali');
  // Pertanyaan sulit → tidak dijawab, admin WA + Telegram dikabari
  delete paused['as1@lid'];
  siapAssist('as2@lid', 'bisa diskon lagi ga kak?');
  aiJawab = '[SULIT: minta diskon]';
  r = await assist();
  assert.strictEqual(r.kirim.length, 0);
  assert.match(r.notif[0], /minta diskon/); assert.match(r.tg[0], /minta diskon/);
  // Klaim palsu → tidak dikirim, admin dikabari
  delete paused['as2@lid'];
  siapAssist('as3@lid', 'jamnya bisa mundur jadi jam 2?');
  aiJawab = 'Siap Kak, sudah aku ubah jadwalnya jadi jam 14.00.';
  r = await assist();
  assert.strictEqual(r.kirim.length, 0, 'klaim palsu lolos di mode assist');
  assert.strictEqual(r.tg.length, 1);
  // Admin membalas saat bot sedang memproses → bot batal kirim
  delete paused['as3@lid'];
  siapAssist('as4@lid', 'lokasi basecamp di mana kak?');
  aiJawab = async () => {
    await handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: 'as4@lid', id: 'admAs4', fromMe: true }, message: { conversation: 'Di Bogor kak' } }] });
    return 'Basecamp kami di Bogor Kak.';
  };
  r = await assist();
  assert.strictEqual(r.kirim.length, 0, 'bot menjawab padahal admin sudah membalas');
  // Pesan belum 30 menit → belum dinilai
  delete paused['as4@lid'];
  siap('as5@lid', ['assistant', '(admin) oke kak']); store.tambahRiwayat('as5@lid', 'user', 'kak satu lagi');
  paused['as5@lid'] = Date.now() + 3600e3;
  aiJawab = 'jawaban';
  r = await assist();
  assert.strictEqual(r.kirim.length, 0, 'assist terlalu cepat');

  console.log('SEMUA UJI LOLOS');
  process.exit(0);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
