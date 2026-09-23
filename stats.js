// Skrip Statistik Leads Tetra Photobooth
// Gunakan: node /home/ubuntu/tetra-wa-bot/stats.js
require('dotenv').config({ path: __dirname + '/.env' });
const { createClient } = require('@supabase/supabase-js');

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function showStats() {
  const { data, error } = await supa.from('whatsapp_bot_leads').select('created_at, topic');
  if (error) {
    console.error('Gagal mengambil data:', error.message);
    return;
  }

  const monthly = {};
  const topics = {};

  for (const r of data) {
    if (!r.created_at) continue;
    const date = new Date(r.created_at);
    const monthYear = `${date.toLocaleString('id-ID', { month: 'long' })} ${date.getFullYear()}`;
    monthly[monthYear] = (monthly[monthYear] || 0) + 1;
    topics[r.topic] = (topics[r.topic] || 0) + 1;
  }

  console.log('═══════════════════════════════════════');
  console.log('📊 STATISTIK LEADS TETRA PHOTOBOOTH');
  console.log('═══════════════════════════════════════');
  console.log(`Total Seluruh Leads : ${data.length}\n`);

  console.log('📅 PERBANDINGAN BULANAN:');
  for (const [m, count] of Object.entries(monthly)) {
    console.log(`  • ${m}: ${count} leads`);
  }

  console.log('\n📌 BERDASARKAN TOPIK/KATEGORI:');
  for (const [t, count] of Object.entries(topics)) {
    console.log(`  • ${t}: ${count}`);
  }
  console.log('═══════════════════════════════════════');
}

showStats();
