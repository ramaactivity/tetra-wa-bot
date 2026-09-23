const { Client } = require('pg');

const PASSWORD = process.env.PG_PASSWORD;
if (!PASSWORD) { console.error('PG_PASSWORD tidak diset'); process.exit(1); }

const hosts = [
  { host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432, label: 'session-pooler' },
  { host: 'db.rdrkzwesykebhibcwcsj.supabase.co', port: 5432, label: 'direct' },
  { host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 6543, label: 'transaction-pooler' },
];

const SQL = `
alter table public.whatsapp_bot_leads
  add column if not exists segment text,
  add column if not exists category text,
  add column if not exists location text,
  add column if not exists event_date text;
`;

async function main() {
  for (const h of hosts) {
    const client = new Client({
      host: h.host,
      port: h.port,
      user: 'postgres.rdrkzwesykebhibcwcsj',
      password: PASSWORD,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
    });
    try {
      await client.connect();
      console.log(`[OK] connected via ${h.label} (${h.host}:${h.port})`);
      await client.query(SQL);
      console.log('[OK] ALTER TABLE berhasil');
      const cols = await client.query(`
        select column_name from information_schema.columns
        where table_schema='public' and table_name='whatsapp_bot_leads'
        order by ordinal_position;
      `);
      console.log('KOLOM SAAT INI:', cols.rows.map(r => r.column_name).join(', '));
      await client.end();
      return;
    } catch (e) {
      console.log(`[FAIL] ${h.label}: ${e.message}`);
      try { await client.end(); } catch (_) {}
    }
  }
  console.log('SEMUA KONEKSI GAGAL');
}

main();
