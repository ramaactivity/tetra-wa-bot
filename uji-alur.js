// Uji alur handler pesan dengan dependensi palsu. Jalankan di SALINAN repo.
const assert = require('assert');
const path = require('path');
const R = (p) => require.resolve(path.join(process.cwd(), p));

const log = { kirim: [], notif: [], pause: [] };
let aiJawab = 'halo';
const stub = (p, exp) => { require.cache[R(p)] = { id: R(p), filename: R(p), loaded: true, exports: exp }; };
stub('src/lib/supa.js', {
  fetchPausedContacts: async () => ({}), fetchLeadMessages: async () => [],
  insertLead: async () => {}, upsertPause: async (j, u, s) => log.pause.push(s),
});
stub('src/lib/sheetSync.js', { syncToSheet: async () => {} });
stub('src/lib/sender.js', { sendReply: async (s, j, k, r, t) => log.kirim.push(t) });
stub('src/lib/notify.js', { notifyAdmin: async (...a) => log.notif.push(a[4]) });
stub('src/lib/pricelist.js', { kirimPricelist: async () => log.kirim.push('[PL]'), mintaPricelist: (t) => /pricelist/i.test(t) });
stub('src/lib/ai.js', { getAIResponse: async () => { if (aiJawab instanceof Error) throw aiJawab; return aiJawab; } });
stub('src/lib/liveConfig.js', { isEnabled: () => true, get: () => ({ PAUSE_HOURS: 24 }) });

const { registerMessageHandler } = require(R('src/handlers/messages.js'));
const handlers = {};
const sock = { ev: { on: (e, f) => (handlers[e] = f) }, presenceSubscribe: async () => {} };
process.env.REPLY_DELAY_SECONDS = '0.05';
registerMessageHandler(sock);

let n = 0;
async function kirim(message) {
  log.kirim = []; log.notif = []; log.pause = [];
  const jid = `62800${++n}@s.whatsapp.net`;
  await handlers['messages.upsert']({ type: 'notify', messages: [{ key: { remoteJid: jid, id: 'x' + n }, message, messageTimestamp: Math.floor(Date.now() / 1000) }] });
  await new Promise((r) => setTimeout(r, 400));
  return { ...log };
}

(async () => {
  let r = await kirim({ audioMessage: {} });
  assert.match(r.kirim[0], /voice note/); assert.strictEqual(r.notif.length, 0);

  r = await kirim({ imageMessage: {} });
  assert.match(r.kirim[0], /Admin cek dulu/); assert.deepStrictEqual(r.pause, ['ai']); assert.strictEqual(r.notif.length, 1);

  aiJawab = '[DIAM]';
  r = await kirim({ conversation: 'Selamat menempuh hidup baru!' });
  assert.strictEqual(r.kirim.length, 0);

  aiJawab = '[ADMIN_HANDOFF]';
  r = await kirim({ conversation: 'minta pricelist dong, kirim aja' });
  assert.ok(!r.kirim.some((t) => t.includes('[ADMIN_HANDOFF]')), 'kode handoff bocor ke klien');
  assert.match(r.kirim.at(-1), /teruskan ke admin/);

  aiJawab = new Error('Sumopod & 9Router mati');
  r = await kirim({ conversation: 'halo kak mau tanya' });
  assert.match(r.kirim[0], /teruskan ke admin/); assert.strictEqual(r.notif.length, 1);

  aiJawab = 'Tanggal 7 November masih kosong.';
  r = await kirim({ conversation: 'tgl 7 nov kosong?' });
  assert.deepStrictEqual(r.kirim, ['Tanggal 7 November masih kosong.']);

  console.log('SEMUA UJI LOLOS');
  process.exit(0);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
