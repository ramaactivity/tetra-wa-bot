#!/usr/bin/env node
// Perbaiki whatsapp_bot_leads.event_date dengan pendeteksi tanggal yang sudah dibetulkan (audit 18 Nov: "8 agustus 13.30"
// terbaca 2013, jam "10.12" terbaca tanggal). Default UJI KERING: hanya menampilkan rencana. Ubah data: --apply.
// Dijalankan Hermes (skill uji-perubahan-bot), --apply hanya setelah Rama menyetujui jumlah & contohnya.
process.chdir(require('path').join(__dirname, '..'));
const d = require('dotenv'); d.config({ path: '.env.local' }); d.config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');
const lead = require('../src/lib/smartLead');
const apply = process.argv.includes('--apply');
const sb = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
(async () => {
  let rows = [], from = 0;
  for (;;) {
    const { data, error } = await sb.from('whatsapp_bot_leads').select('id,message,event_date,received_at').range(from, from + 999);
    if (error) throw error;
    rows = rows.concat(data); if (data.length < 1000) break; from += 1000;
  }
  const ubah = [];
  for (const r of rows) {
    const ref = new Date(r.received_at);  // tahun "tanggal tanpa tahun" dihitung dari kapan pesan itu masuk
    const baru = lead.toISODate(lead.parseLeadDetails(String(r.message || '')).tanggal, ref) || null;
    if ((r.event_date || null) !== baru) ubah.push({ id: r.id, lama: r.event_date, baru, masuk: r.received_at.slice(0, 10), pesan: String(r.message || '').replace(/\s+/g, ' ').slice(0, 80) });
  }
  const isi = ubah.filter((u) => u.baru && !u.lama).length, hapus = ubah.filter((u) => !u.baru).length;
  console.log(`${rows.length} baris dibaca; berubah ${ubah.length} (terisi baru ${isi}, dikosongkan ${hapus}, diganti ${ubah.length - isi - hapus})`);
  for (const u of ubah.slice(0, 15)) console.log(`- ${u.masuk} ${u.lama || '∅'} → ${u.baru || '∅'} | ${JSON.stringify(u.pesan)}`);
  if (!apply) { console.log('UJI KERING — belum ada yang diubah. Jalankan dengan --apply setelah disetujui Rama.'); return; }
  for (const u of ubah) {
    const { error } = await sb.from('whatsapp_bot_leads').update({ event_date: u.baru }).eq('id', u.id);
    if (error) throw error;
  }
  console.log(`DITERAPKAN: ${ubah.length} baris.`);
})().catch((e) => { console.error('GAGAL:', e.message); process.exit(1); });
