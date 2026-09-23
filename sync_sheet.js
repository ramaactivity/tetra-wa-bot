// Rebuild Google Sheet "Tetra Leads History" dari Supabase:
//  1. baca semua leads (paginated)
//  2. enrich (topik/segmen/kategori/lokasi/tanggal acara dari teks pesan)
//  3. hitung agregat bulanan (long-format: Tahun,Bulan,Periode,Dimensi,Nilai,Jumlah)
//  4. tulis JSON ke /tmp lalu panggil build_sheet.py (Python + Sheets API)
// Jalankan: node /home/ubuntu/tetra-wa-bot/sync_sheet.js
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '.env.local') }); } catch {}
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch {}
const { createClient } = require('@supabase/supabase-js');
const { enrich, toRow } = require('./src/lib/enrichLead');
const fs = require('fs');
const { execSync } = require('child_process');

const pad2 = (n) => String(n).padStart(2, '0');
// --refresh = mode cron: hanya update Bulanan + Config (Database & Statistik tak disentuh).
const REFRESH = process.argv[2] === '--refresh';

async function fetchAllLeads(supa) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supa
      .from('whatsapp_bot_leads')
      .select('*')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

function sortEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('SUPABASE_URL / SERVICE_ROLE_KEY kosong.'); process.exit(1); }
  const supa = createClient(url, key);

  const leads = await fetchAllLeads(supa);
  console.log(`[sync] ${leads.length} leads dari Supabase`);

  const databaseRows = [];
  const monthly = {}; // key `${tahun}-${bulan}`

  for (const r of leads) {
    const e = enrich(r);
    databaseRows.push(toRow(e));
    if (!e.tahun || !e.bulan) continue;
    const key = `${e.tahun}-${pad2(e.bulan)}`;
    const m = monthly[key] || (monthly[key] = {
      tahun: e.tahun, bulan: e.bulan, label: e.bulanLabel,
      total: 0, deal: 0, topik: {}, segmen: {}, kategori: {}, lokasi: {},
    });
    m.total++;
    if (e.topik === 'dp' || e.topik === 'booking') m.deal++;
    m.topik[e.topik] = (m.topik[e.topik] || 0) + 1;
    m.segmen[e.segmen] = (m.segmen[e.segmen] || 0) + 1;
    m.kategori[e.kategori] = (m.kategori[e.kategori] || 0) + 1;
    m.lokasi[e.lokasi] = (m.lokasi[e.lokasi] || 0) + 1;
  }

  // ── Bulanan long-format ────────────────────────────────────────────────────
  const bulananRows = [];
  const months = [];
  const sortedKeys = Object.keys(monthly).sort();
  for (const key of sortedKeys) {
    const m = monthly[key];
    months.push(m.label);
    bulananRows.push([m.tahun, m.bulan, m.label, 'Total', 'Total', m.total]);
    bulananRows.push([m.tahun, m.bulan, m.label, 'Deal', 'Deal', m.deal]);
    for (const [v, c] of sortEntries(m.topik)) bulananRows.push([m.tahun, m.bulan, m.label, 'Topik', v, c]);
    for (const [v, c] of sortEntries(m.segmen)) bulananRows.push([m.tahun, m.bulan, m.label, 'Segmen', v, c]);
    for (const [v, c] of sortEntries(m.kategori)) bulananRows.push([m.tahun, m.bulan, m.label, 'Kategori', v, c]);
    for (const [v, c] of sortEntries(m.lokasi)) bulananRows.push([m.tahun, m.bulan, m.label, 'Lokasi', v, c]);
  }

  const payload = {
    database: databaseRows,
    bulanan: bulananRows,
    months,
  };
  fs.writeFileSync('/tmp/tetra_sync.json', JSON.stringify(payload));
  console.log(`[sync] database rows=${databaseRows.length}, bulanan rows=${bulananRows.length}, months=${months.join(' | ')}`);

  // Panggil builder Python (Sheets API).
  const flag = REFRESH ? ' --refresh' : '';
  execSync(`python3 /home/ubuntu/tetra-wa-bot/build_sheet.py${flag}`, { stdio: 'inherit' });
}

main().catch((e) => { console.error('[sync] FATAL:', e.message); process.exit(1); });
