// Uji mode lead sales (7 Okt 2026). Jalankan di SALINAN repo (data/ terpisah):
//   node uji-lead.js            → uji logika tanpa AI
//   UJI_AI=1 node uji-lead.js   → juga uji kering balasan AI untuk lead di data/riwayat.json (tidak mengirim apa pun)
const assert = require('assert');
const path = require('path');
const notify = require('./src/lib/notify');
notify.kirimTelegram = async (t) => console.log('   [telegram]', t);
const prospekWa = require('./src/lib/prospekWa');
const fe = require('./src/lib/followupEngine');

const { tanpaAngka } = prospekWa;
assert.strictEqual(tanpaAngka('Siap Kak, ini pricelistnya.'), 'Siap Kak, ini pricelistnya.');
let t = tanpaAngka('Ini pricelistnya Kak. Untuk rekanan diskon 10% ya.');
assert(!/10/.test(t) && /harga khusus/.test(t), t);
t = tanpaAngka('Paket 2 jam jadi Rp 1.800.000 untuk rekanan. Ada harga khusus rekanan yang bisa didiskusikan.');
assert(!/1\.800/.test(t) && /harga khusus/.test(t), t);

const J = fe._jenisProspek, H = 3600e3, D = 864e5;
const now = Date.parse('2026-10-07T04:00:00Z'); // Rabu 11.00 WIB
const sapa = { role: 'assistant', content: 'Halo [sapaan dari tim sales]', t: now - 5 * D };
const u = (c, t) => ({ role: 'user', content: c, t });
const a = (c, t) => ({ role: 'assistant', content: c, t });
assert.strictEqual(J([sapa, u('Boleh minta PL nya ka', now - H)], { n: 0 }, now), 'balas');
assert.strictEqual(J([sapa, u('Boleh minta PL nya ka', now - 5 * 60e3)], { n: 0 }, now), null, 'baru 5 menit: urusan jalur real-time');
assert.strictEqual(J([sapa, u('ok', now - 4 * D)], { n: 0 }, now), null, 'lewat 3 hari tak terjawab: jangan dibalas basi');
assert.strictEqual(J([sapa, u('Boleh PL', now - 6 * D), a('Ini Kak', now - 6 * D)], { n: 0 }, now), 'lanjut');
assert.strictEqual(J([sapa, u('Boleh PL', now - 2 * D), a('Ini Kak', now - 2 * D)], { n: 0 }, now), null);
assert.strictEqual(J([sapa, u('Boleh PL', now - 6 * D), a('Ini Kak', now - 6 * D)], { n: 1 }, now), null, 'fu2 baru hari kerja ke-7');
assert.strictEqual(J([sapa, u('Boleh PL', now - 10 * D), a('Ini Kak', now - 10 * D)], { n: 1 }, now), 'lanjut');
assert.strictEqual(J([sapa, u('Boleh PL', now - 30 * D), a('Ini Kak', now - 30 * D)], { n: 2 }, now), null, 'maks 2x');
const oto = u('Terima kasih telah menghubungi Maxima. We will reply soon', now - 4 * D);
assert.strictEqual(J([sapa, oto, a('Kami vendor photobooth, boleh minta kontak PIC?', now - 4 * D)], { n: 0 }, now), 'minta-pic');
assert.strictEqual(J([sapa, oto, a('Kami vendor photobooth, boleh minta kontak PIC?', now - 4 * D)], { n: 1 }, now), null, 'auto-reply: maks 1x');
assert.strictEqual(J([sapa, u('Boleh PL', now - 6 * D), a('(admin) siap kak', now - 6 * D)], { n: 0 }, now), null, 'dipegang admin');
assert.strictEqual(J([sapa, u('maaf kami sudah ada vendor photobooth lain', now - H)], { n: 0 }, now), null, 'menolak');
const { _teksPesan } = require('./src/handlers/messages');
assert.strictEqual(_teksPesan({ contactMessage: { displayName: 'Widya Kantor',
  vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Widya Kantor\nTEL;type=CELL;waid=6281234567890:+62 812-3456-7890\nEND:VCARD' } }),
  '[kirim kontak: Widya Kantor 6281234567890]');
assert.strictEqual(_teksPesan({ contactMessage: { displayName: 'Budi', vcard: 'BEGIN:VCARD\nTEL:0812 3456 789\nEND:VCARD' } }),
  '[kirim kontak: Budi 628123456789]');
assert.strictEqual(_teksPesan({ contactsArrayMessage: { contacts: [{ displayName: 'A', vcard: 'TEL;waid=628111:x' }, { displayName: 'B', vcard: '' }] } }),
  '[kirim kontak: A; B]', 'waid terlalu pendek diabaikan');
const { _RE_STOP } = require('./src/handlers/messages');
for (const t of ['STOP', 'stop.', ' Stop 🙏', 'berhenti', 'jangan hubungi saya lagi']) assert(_RE_STOP.test(t), t);
for (const t of ['stop dulu ya kak, aku tanya suami', 'nggak bisa stop mikirin photoboothnya', 'boleh']) assert(!_RE_STOP.test(t), t);
console.log('UJI LEAD (logika) LOLOS');

if (process.env.UJI_AI) {
  const terkirim = [];
  const sock = { sendMessage: async (jid, isi) => { terkirim.push([jid, isi]); return { key: { id: 'x' + terkirim.length } }; },
    sendPresenceUpdate: async () => {} };
  fe.followupProspek(sock, {}, 0).then(() => {
    for (const [jid, isi] of terkirim) console.log(`\n→ ${jid}\n${isi.text || `[file] ${isi.fileName || isi.caption || Object.keys(isi)}`}`);
  });
}
