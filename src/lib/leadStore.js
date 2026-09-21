// Ingatan percakapan lead per kontak (untuk alur gated soft-gate).
// stage: 'awaiting' = bot sudah tanya detail, nunggu jawaban
//        'sent'     = PL sudah dikirim (jangan di-gate lagi)
// State kedaluwarsa setelah TTL supaya percakapan lama dianggap baru lagi.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'data', 'leadstate.json');
const TTL_MS = 48 * 3600 * 1000; // 48 jam

let state = {};
try {
  if (fs.existsSync(FILE)) state = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
} catch (e) {
  console.error('[leadStore] gagal load:', e.message);
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch (e) {
    console.error('[leadStore] gagal save:', e.message);
  }
}

// Kembalikan { stage, ts, details } kalau masih berlaku, atau null.
function getLead(jid) {
  const e = state[jid];
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) {
    delete state[jid];
    save();
    return null;
  }
  return e;
}

function setLead(jid, stage, details) {
  state[jid] = { stage, ts: Date.now(), details: details || {} };
  save();
}

module.exports = { getLead, setLead };
