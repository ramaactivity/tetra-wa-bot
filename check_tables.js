
require('dotenv').config({ path: '/home/ubuntu/tetra-wa-bot/.env' });
const { createClient } = require('@supabase/supabase-js');
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkTables() {
  // Let's test querying some common table names or listing tables via PostgREST / information_schema if accessible
  const { data, error } = await supa.from('whatsapp_bot_leads').select('id').limit(1);
  console.log("Leads table accessible:", !error);

  // Check if there are other tables like bookings, calendar, schedules, etc.
  const tables = ['bookings', 'schedule', 'events', 'bot_settings', 'bot_rules', 'bot_paused_contacts', 'whatsapp_bot_contacts'];
  for (const t of tables) {
    const { error: err } = await supa.from(t).select('id').limit(1);
    console.log(`Table '${t}' accessible:`, !err);
  }
}
checkTables();
