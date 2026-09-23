// Sinkronisasi 1 lead ke Google Sheet (tab Database, 13 kolom).
// Terima objek hasil enrichLead.enrich() → tulis ke /tmp lalu append via Python
// (hindari masalah escaping quote/newline di shell).
const fs = require('fs');
const { exec } = require('child_process');
const { toRow } = require('./enrichLead');

const ROW_FILE = '/tmp/tetra_sheet_row.json';
// python3 sistem tidak punya modul google; venv ini punya (dan tidak ditimpa `hermes update`).
const APPEND_CMD = '/home/ubuntu/.venv_xlsx/bin/python3 /home/ubuntu/tetra-wa-bot/sheet_append.py';

function syncToSheet(enriched) {
  try {
    const row = toRow(enriched);
    fs.writeFileSync(ROW_FILE, JSON.stringify([row]));
    exec(APPEND_CMD, (err, stdout) => {
      if (err) {
        console.error('[sheet] Sync error:', err.message);
      } else if (stdout && !/appended/.test(stdout)) {
        console.error('[sheet] Sync unexpected output:', stdout.trim());
      }
    });
  } catch (e) {
    console.error('[sheet] Sync error:', e.message);
  }
}

module.exports = { syncToSheet };
