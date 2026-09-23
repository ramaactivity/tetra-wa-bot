
const supa = require('./src/lib/supa');
async function audit() {
  const leads = await supa.fetchRecentLeads('2026-06-01T00:00:00Z');
  // Ambil yang 'read' atau 'delivered' sebagai indikasi interaksi berhasil
  const successful = leads.filter(l => l.reply_status === 'read' || l.reply_status === 'delivered');
  console.log('--- RINGKASAN AUDIT ---');
  console.log('Total Leads:', leads.length);
  console.log('Leads Berhasil (Read/Delivered):', successful.length);
  console.log('Sampel Topik Lead:', [...new Set(leads.map(l => l.topic))]);
}
audit();
