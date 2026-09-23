// Skrip untuk menghitung statistik otomatis dan memperbarui tab "Statistik" di Google Sheet
require('dotenv').config({ path: __dirname + '/.env' });
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function updateSheetStats() {
  try {
    const { data, error } = await supa.from('whatsapp_bot_leads').select('created_at, topic, message');
    if (error) {
      console.error('Gagal ambil data leads:', error.message);
      return;
    }

    const totalLeads = data.length;
    const monthly = {};
    const topics = {};
    let closings = 0; // Simulasi / hitung dari deal

    for (const r of data) {
      if (!r.created_at) continue;
      const date = new Date(r.created_at);
      const monthYear = `${date.toLocaleString('id-ID', { month: 'long' })} ${date.getFullYear()}`;
      monthly[monthYear] = (monthly[monthYear] || 0) + 1;
      topics[r.topic] = (topics[r.topic] || 0) + 1;
      
      if (r.topic === 'booking' || r.topic === 'dp') {
        closings++;
      }
    }

    const rows = [
      ["METRIK STATISTIK & RINGKASAN LEADS TETRA", ""],
      ["Total Leads Keseluruhan", totalLeads],
      ["Total Deal / Closing (Booking/DP)", closings],
      ["", ""],
      ["BULAN / TAHUN", "JUMLAH LEADS"]
    ];

    for (const [m, count] of Object.entries(monthly)) {
      rows.push([m, count]);
    }

    rows.push(["", ""]);
    rows.push(["TOP TOPIK / KATEGORI", "JUMLAH"]);
    for (const [t, count] of Object.entries(topics)) {
      rows.push([t, count]);
    }

    // Update via google-workspace python wrapper
    const fs = require('fs');
    fs.writeFileSync('/tmp/stat_update.json', JSON.stringify(rows));
    
    const ssid = '1T-WqMq97zEEkggMLts6ZcyLB4w3PXlx85t5scnruFdE';
    const pyScript = `
import json
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import os

token_path = os.path.expanduser('~/.hermes/google_token.json')
creds = Credentials.from_authorized_user_file(token_path)
service = build('sheets', 'v4', credentials=creds)
ssid = '1T-WqMq97zEEkggMLts6ZcyLB4w3PXlx85t5scnruFdE'

with open('/tmp/stat_update.json', 'r') as f:
    rows = json.load(f)

body = {'values': rows}
service.spreadsheets().values().update(
    spreadsheetId=ssid, range=f'Statistik!A1:B{len(rows)}',
    valueInputOption='RAW', body=body).execute()
print("Statistik tab updated successfully.")
`;
    fs.writeFileSync('/tmp/update_stat.py', pyScript);
    execSync('python /tmp/update_stat.py');
    console.log('Statistik Google Sheet berhasil di-update secara otomatis.');

  } catch (e) {
    console.error('Error updating sheet stats:', e.message);
  }
}

updateSheetStats();
