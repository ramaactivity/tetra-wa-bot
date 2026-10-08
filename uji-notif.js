const live = require('./src/lib/liveConfig');
live.get().ADMIN_NOTIFY_JID = '62800@s.whatsapp.net'; live.get().ADMIN_GROUP_JID = '1203@g.us';
const { notifyAdmin } = require('./src/lib/notify');
const assert = require('assert');
(async () => {
  for (const [rule, extra, keGrup] of [[{ name: 'HANDOFF' }, 'Handoff diminta oleh AI', false], [{ name: 'INFO' }, 'minta promo', false],
    [{ name: 'INFO' }, 'DADAKAN 9 Oktober 2026 Bogor', true], [{ name: 'PERUBAHAN' }, 'jam 08.00 -> 10.00', true], [{ name: 'INFO' }, 'bukti bayar/pelunasan dikirim klien di tahap booking — cek mutasi', true], [{ name: 'INFO' }, 'klien kirim file di tahap booking', false]]) {
    const kirim = [];
    await notifyAdmin({ sendMessage: async (j, m) => { kirim.push([j, m.text]); return { key: { id: 'x' } }; } }, '628123', rule, [], extra);
    const g = kirim.find(([j]) => j.endsWith('@g.us'));
    assert.strictEqual(!!g, keGrup, `${rule.name} ${extra}`);
    if (g) assert(g[1].startsWith('🤖 _Pesan otomatis dari bot CS Mintet, bukan Rama._'));
  }
  console.log('UJI NOTIF GRUP LOLOS');
})();
