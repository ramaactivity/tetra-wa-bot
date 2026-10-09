const live = require('./src/lib/liveConfig');
live.get().ADMIN_NOTIFY_JID = '62800@s.whatsapp.net'; live.get().ADMIN_GROUP_JID = '1203@g.us';
const { notifyAdmin } = require('./src/lib/notify');
const assert = require('assert');
(async () => {
  for (const [rule, extra, keGrup] of [[{ name: 'HANDOFF' }, 'Handoff diminta oleh AI', false], [{ name: 'INFO' }, 'minta promo', false],
    [{ name: 'INFO' }, 'DADAKAN 9 Oktober 2026 Bogor', true], [{ name: 'PERUBAHAN' }, 'jam 08.00 -> 10.00', false], [{ name: 'INFO' }, 'bukti bayar/pelunasan dikirim klien di tahap booking — cek mutasi', true], [{ name: 'INFO' }, 'klien kirim file di tahap booking', false]]) {
    const kirim = [];
    await notifyAdmin({ sendMessage: async (j, m) => { kirim.push([j, m.text]); return { key: { id: 'x' } }; } }, '628123', rule, [], extra);
    const g = kirim.find(([j]) => j.endsWith('@g.us'));
    assert.strictEqual(!!g, keGrup, `${rule.name} ${extra}`);
    if (g) assert(g[1].startsWith('🤖 _Pesan otomatis dari bot CS Mintet, bukan Rama._'));
  }
  live.get().CREW_GROUP_JID = '1205@g.us';
  const { kirimGrupCrew } = require('./src/lib/notify');
  const k2 = [];
  await kirimGrupCrew({ sendMessage: async (j, m) => { k2.push([j, m.text]); return { key: { id: 'y' } }; } }, 'BRIEFING BESOK');
  assert(k2.length === 1 && k2[0][0] === '1205@g.us' && k2[0][1].startsWith('🤖 _Briefing otomatis') && k2[0][1].endsWith('BRIEFING BESOK'));
  console.log('UJI NOTIF GRUP LOLOS');
})();
