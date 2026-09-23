// Backfill kolom enrichment (segment/category/location/event_date) ke Supabase
// lewat koneksi Postgres LANGSUNG (bukan PostgREST upsert yang bermasalah).
// Idempotent — aman jalan ulang.
// Jalankan: PG_PASSWORD=... node /home/ubuntu/tetra-wa-bot/backfill_enrich.js
const { Client } = require('pg');
const { enrich } = require('./src/lib/enrichLead');

const PASSWORD = process.env.PG_PASSWORD;
if (!PASSWORD) { console.error('PG_PASSWORD tidak diset'); process.exit(1); }

(async () => {
  const c = new Client({
    host: 'aws-1-ap-southeast-1.pooler.supabase.com', port: 5432,
    user: 'postgres.rdrkzwesykebhibcwcsj', password: PASSWORD, database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  console.log('[pg] terhubung');

  const { rows } = await c.query(
    'SELECT id, message FROM public.whatsapp_bot_leads ORDER BY created_at'
  );
  console.log('[backfill] total lead:', rows.length);

  const ids = [], segs = [], cats = [], locs = [], evs = [];
  for (const r of rows) {
    const e = enrich(r);
    ids.push(r.id);
    segs.push(e.segmen);
    cats.push(e.kategori);
    locs.push(e.lokasi);
    evs.push(e.tanggal_acara || null);
  }

  const upd = await c.query(
    `UPDATE public.whatsapp_bot_leads AS t
     SET segment = v.segment, category = v.category,
         location = v.location, event_date = v.event_date
     FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[])
          AS v(id, segment, category, location, event_date)
     WHERE t.id = v.id`,
    [ids, segs, cats, locs, evs]
  );
  console.log('[backfill] baris ter-update:', upd.rowCount);

  const chk = await c.query(
    `SELECT count(*) AS total,
            count(segment) AS seg, count(category) AS cat,
            count(location) AS loc, count(event_date) AS ev
     FROM public.whatsapp_bot_leads`
  );
  console.log('[verif]', JSON.stringify(chk.rows[0]));

  await c.end();
  console.log('SELESAI');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
