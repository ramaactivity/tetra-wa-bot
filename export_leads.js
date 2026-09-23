
require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function syncAll() {
  const { data, error } = await supa.from('whatsapp_bot_leads').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Error fetching leads:', error.message);
    return;
  }
  console.log(`Found ${data.length} leads in Supabase.`);
  
  const rows = [["ID WhatsApp", "Nomor Telepon", "Nama", "Topik", "Pesan", "Waktu Masuk"]];
  for (const r of data) {
    rows.push([
      r.wa_jid || '',
      r.phone || '',
      r.name || 'Klien',
      r.topic || 'chat',
      r.message || '',
      r.created_at || ''
    ]);
  }
  
  const fs = require('fs');
  fs.writeFileSync('data/leads_export.json', JSON.stringify(rows));
  console.log('Exported to data/leads_export.json');
}

syncAll();
