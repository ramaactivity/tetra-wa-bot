
require('dotenv').config({ path: '/home/ubuntu/tetra-wa-bot/.env' });
const { createClient } = require('@supabase/supabase-js');
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkEvents() {
  const { data, error } = await supa.from('events').select('*').limit(5);
  console.log("Events data:", data, "Error:", error);
}
checkEvents();
