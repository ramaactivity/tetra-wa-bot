
const supa = require('./src/lib/supa');
async function audit() {
  const leads = await supa.fetchRecentLeads('2026-01-01T00:00:00Z');
  console.log(JSON.stringify(leads, null, 2));
}
audit();

