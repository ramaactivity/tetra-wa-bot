const { Client } = require('pg');
const PASSWORD = process.env.PG_PASSWORD;
if (!PASSWORD) { console.error('PG_PASSWORD tidak diset'); process.exit(1); }

(async () => {
  const c = new Client({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
    user: 'postgres.rdrkzwesykebhibcwcsj', password: PASSWORD, database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();

  const pk = await c.query(`SELECT a.attname, format_type(a.atttypid,a.atttypmod) t
    FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
    WHERE i.indrelid='public.whatsapp_bot_leads'::regclass AND i.indisprimary`);
  console.log('PRIMARY KEY:', JSON.stringify(pk.rows));

  const idx = await c.query(`SELECT i.relname idx, a.attname col, x.indisunique uniq
    FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid
    JOIN pg_attribute a ON a.attrelid=x.indrelid AND a.attnum=ANY(x.indkey)
    WHERE x.indrelid='public.whatsapp_bot_leads'::regclass`);
  console.log('INDEXES:', JSON.stringify(idx.rows));

  const cols = await c.query(`SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='whatsapp_bot_leads'
    ORDER BY ordinal_position`);
  console.log('COLS:', JSON.stringify(cols.rows.map(r => [r.column_name, r.data_type, r.is_nullable, r.column_default])));

  await c.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
