// Uji alur handler pesan dengan dependensi palsu.
// JALANKAN DI SALINAN REPO: store.js menulis data/riwayat.json.
const assert = require('assert');
const path = require('path');
const { proto } = require('@whiskeysockets/baileys');
const R = (p) => require.resolve(path.join(process.cwd(), p));

const log = { kirim: [], notif: [], pause: [], sejarah: [], wa: [] };
let ekstrak = {};
const ops = []; let opsJawab = { ok: true, status: 200, json: { status: 'baru', url: '/operations/booking-masuk/abc', doc_number: 'QUO-TP-01-27092026' } };
let paused = {};
let aiJawab = 'halo';
const stub = (p, exp) => { require.cache[R(p)] = { id: R(p), filename: R(p), loaded: true, exports: exp }; };
stub('src/lib/supa.js', {
  fetchPausedContacts: async () => paused,
  fetchAddonNames: async () => ['Guest Books Photo'], fetchLeadMessages: async () => [],
  insertLead: async () => {}, upsertPause: async (j, u, s) => log.pause.push({ s, jam: (u - Date.now()) / 3600000 }),
});
stub('src/lib/sheetSync.js', { syncToSheet: async () => {} });
stub('src/lib/sender.js', { sendReply: async (s, j, k, r, t) => log.kirim.push(t), sendDocument: async (s, j, f, c) => { log.kirim.push(`[DOK ${require('path').basename(f)}]`); return { key: { id: 'd' + Math.random() } }; } });
stub('src/lib/deliveryLog.js', { track: () => {} });
stub('src/lib/notify.js', { notifyAdmin: async (s, f, rule, r, extra) => log.notif.push(`${rule.name}:${extra}`) });
stub('src/lib/pricelist.js', { kirimPricelist: async () => log.kirim.push('[PL]'), mintaPricelist: (t) => /pricelist/i.test(t), ASSETS_DIR: '/tmp' });
stub('src/lib/ai.js', {
  getAIResponse: async () => { if (aiJawab instanceof Error) throw aiJawab; return aiJawab; },
  ringkasPercakapan: async (lama, pesan) => `RINGKAS ${pesan.length}`,
  ekstrakBooking: async () => ekstrak,
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
  log.kirim = []; log.notif = []; log.pause = []; log.wa = [];
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

  // Riwayat panjang dirangkum: sisa 40 pesan utuh + catatan klien
  const jidL = '62877@s.whatsapp.net';
  for (let i = 0; i < 70; i++) store.tambahRiwayat(jidL, i % 2 ? 'assistant' : 'user', `pesan ${i}`);
  await kirim({ conversation: 'lanjut' }, jidL);
  assert.strictEqual(store.getRiwayat(jidL).length, 40);
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

  // [KIRIM: pricelist] -> gambar + PDF lewat kirimPricelist, sekali saja
  const jidP = '62855@s.whatsapp.net';
  aiJawab = 'Ini gambaran paketnya Kak.\n[KIRIM: pricelist]';
  r = await kirim({ conversation: 'minta daftar harga semua paketnya kak' }, jidP);
  assert.deepStrictEqual(r.kirim, ['Ini gambaran paketnya Kak.', '[PL]']);
  store.tambahRiwayat(jidP, 'assistant', '[kirim PDF pricelist] + gambar ringkas paket unlimited');
  r = await kirim({ conversation: 'yang 360 berapa lagi kak' }, jidP);
  assert.ok(!r.kirim.includes('[PL]'), 'pricelist terkirim dua kali');

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
  ekstrak = { jam: '14.00-17.00' };
  r = await kirim({ conversation: 'eh jamnya mundur jadi 14-17 ya' }, jidB);
  assert.match(r.wa.at(-1), /Update data booking/); assert.match(r.wa.at(-1), /14\.00-17\.00/);

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

  console.log('SEMUA UJI LOLOS');
  process.exit(0);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
