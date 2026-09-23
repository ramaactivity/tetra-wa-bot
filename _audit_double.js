require('dotenv').config({ path: '/home/ubuntu/tetra-wa-bot/.env' });
require('dotenv').config({ path: '/home/ubuntu/tetra-wa-bot/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // 1. Semua lead dari nomor tes 6287880492635
  const jid1 = '6287880492635@s.whatsapp.net';
  const { data: a } = await supa.from('whatsapp_bot_leads')
    .select('id, wa_jid, phone, name, topic, message, created_at, reply_status')
    .eq('wa_jid', jid1).order('created_at', { ascending: true });
  console.log('=== lead untuk 6287880492635@s.whatsapp.net ===');
  for (const r of (a || [])) {
    console.log(`[${r.created_at}] topic=${r.topic} name=${r.name} msg="${(r.message||'').slice(0,80)}"`);
  }

  // cek juga jid varian lid / tanpa @
  const { data: b } = await supa.from('whatsapp_bot_leads')
    .select('id, wa_jid, name, topic, message, created_at')
    .like('wa_jid', '6287880492635%').order('created_at', { ascending: true });
  console.log('\n=== semua jid mengandung 6287880492635 ===', b?.length, 'baris');
  for (const r of (b || [])) console.log(`[${r.created_at}] jid=${r.wa_jid} topic=${r.topic} msg="${(r.message||'').slice(0,60)}"`);

  // 2. lead 10 menit terakhir (17:45-17:55 WIB = 10:45-10:55 UTC) untuk lihat aktivitas tes
  const { data: recent } = await supa.from('whatsapp_bot_leads')
    .select('id, wa_jid, name, topic, message, created_at')
    .gte('created_at', '2026-09-22T10:40:00Z')
    .order('created_at', { ascending: true });
  console.log('\n=== lead sejak 17:40 WIB ===', recent?.length, 'baris');
  for (const r of (recent || [])) console.log(`[${r.created_at}] jid=${r.wa_jid} topic=${r.topic} msg="${(r.message||'').slice(0,70)}"`);
}
main();
