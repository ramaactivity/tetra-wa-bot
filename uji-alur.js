// Uji alur handler pesan dengan dependensi palsu.
// JALANKAN DI SALINAN REPO: store.js menulis data/riwayat.json.
const assert = require('assert');
const path = require('path');
const { proto } = require('@whiskeysockets/baileys');
const R = (p) => require.resolve(path.join(process.cwd(), p));

const log = { kirim: [], notif: [], pause: [], sejarah: [] };
let aiJawab = 'halo';
const stub = (p, exp) => { require.cache[R(p)] = { id: R(p), filename: R(p), loaded: true, exports: exp }; };
stub('src/lib/supa.js', {
  fetchPausedContacts: async () => ({}), fetchLeadMessages: async () => [],
  insertLead: async () => {}, upsertPause: async (j, u, s) => log.pause.push({ s, jam: (u - Date.now()) / 3600000 }),
});
stub('src/lib/sheetSync.js', { syncToSheet: async () => {} });
stub('src/lib/sender.js', { sendReply: async (s, j, k, r, t) => log.kirim.push(t) });
stub('src/lib/notify.js', { notifyAdmin: async (s, f, rule, r, extra) => log.notif.push(`${rule.name}:${extra}`) });
stub('src/lib/pricelist.js', { kirimPricelist: async () => log.kirim.push('[PL]'), mintaPricelist: (t) => /pricelist/i.test(t) });
stub('src/lib/ai.js', {
  getAIResponse: async () => { if (aiJawab instanceof Error) throw aiJawab; return aiJawab; },
  ringkasPercakapan: async (lama, pesan) => `RINGKAS ${pesan.length}`,
});
stub('src/lib/liveConfig.js', { isEnabled: () => true, get: () => ({ PAUSE_HOURS: 24 }) });

const store = require(R('src/lib/store.js'));
const { registerMessageHandler } = require(R('src/handlers/messages.js'));
const handlers = {};
const sock = {
  ev: { on: (e, f) => (handlers[e] = f) },
  presenceSubscribe: async () => {},
  fetchMessageHistory: async (n, key, ts) => log.sejarah.push({ jid: key.remoteJid, ts }),
};
process.env.REPLY_DELAY_SECONDS = '0.05';
registerMessageHandler(sock);

let n = 0;
const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));
async function kirim(message, jid = `62800${++n}@s.whatsapp.net`) {
  log.kirim = []; log.notif = []; log.pause = [];
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

  console.log('SEMUA UJI LOLOS');
  process.exit(0);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
