// Supabase data layer untuk integrasi Tetra Ops (lead capture, remote config,
// status koneksi, command queue). SEMUA operasi fault-tolerant: kalau env tidak
// ada atau Supabase tak terjangkau, fungsi diam (return null/void) dan bot tetap
// jalan penuh pakai config.js. DB hanya MENAMBAH kemampuan, tak pernah jadi
// titik gagal yang mematikan auto-reply.
//
// Env yang dibutuhkan (di .env server bot — lihat .env.example):
//   SUPABASE_URL                 (atau NEXT_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY    (server-only; bypass RLS untuk tulis/baca)
try {
  require('dotenv').config();
} catch {
  /* dotenv opsional — env bisa juga di-inject pm2/systemd */
}

// supabase-js v2 menolak createClient di Node < 22 yang tak punya WebSocket
// global (dipakai realtime-js). Bot ini cuma pakai REST (PostgREST), tapi
// konstruktor tetap butuh WebSocket ada. Sediakan dari paket `ws` supaya tak
// throw. Kalau `ws` tak ada pun, kita catch & fallback ke config.js.
if (typeof globalThis.WebSocket === 'undefined') {
  try {
    globalThis.WebSocket = require('ws');
  } catch {
    /* ws opsional — ditangani di catch createClient di bawah */
  }
}

let supa = null;
try {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    supa = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('[supa] Supabase terhubung — integrasi Tetra Ops aktif.');
  } else {
    console.warn(
      '[supa] SUPABASE_URL / SERVICE_ROLE_KEY belum di-set — integrasi DB OFF, pakai config.js saja.'
    );
  }
} catch (e) {
  console.warn('[supa] Supabase init gagal — integrasi DB OFF, bot tetap jalan via config.js:', e.message);
}

const enabled = () => supa !== null;

// ── Fase 1: lead capture ────────────────────────────────────────────────────
// row: { wa_jid, phone, name, topic, message, is_after_hours }
async function insertLead(row) {
  if (!supa) return;
  try {
    const { error } = await supa.from('whatsapp_bot_leads').insert(row);
    if (error) console.error('[supa] insertLead:', error.message);
  } catch (e) {
    console.error('[supa] insertLead:', e.message);
  }
}

// ── Fase 2: remote config (settings + rules + paused) ────────────────────────
async function fetchSettings() {
  if (!supa) return null;
  try {
    const { data, error } = await supa
      .from('bot_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (error) {
      console.error('[supa] fetchSettings:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('[supa] fetchSettings:', e.message);
    return null;
  }
}

async function fetchRules() {
  if (!supa) return null;
  try {
    const { data, error } = await supa
      .from('bot_rules')
      .select('name, keywords, reply, file_path, priority, is_active')
      .eq('is_active', true)
      .order('priority', { ascending: true });
    if (error) {
      console.error('[supa] fetchRules:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.error('[supa] fetchRules:', e.message);
    return null;
  }
}

// Returns map { wa_jid -> paused_until_ms } untuk pause yang masih berlaku.
async function fetchPausedContacts() {
  if (!supa) return null;
  try {
    const { data, error } = await supa
      .from('bot_paused_contacts')
      .select('wa_jid, paused_until');
    if (error) {
      console.error('[supa] fetchPausedContacts:', error.message);
      return null;
    }
    const out = {};
    for (const r of data || []) {
      const until = new Date(r.paused_until).getTime();
      if (Number.isFinite(until)) out[r.wa_jid] = until;
    }
    return out;
  } catch (e) {
    console.error('[supa] fetchPausedContacts:', e.message);
    return null;
  }
}

// ── Reminder admin: lead masuk dalam window + waktu admin terakhir balas ──────
// Lead dalam `lookback` terakhir (buat hitung "belum dibales admin").
async function fetchRecentLeads(sinceIso) {
  if (!supa) return [];
  try {
    const { data, error } = await supa
      .from('whatsapp_bot_leads')
      .select('wa_jid, phone, name, message, topic, created_at, reply_status')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[supa] fetchRecentLeads:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('[supa] fetchRecentLeads:', e.message);
    return [];
  }
}

// Map { wa_jid -> updated_at_ms }: kapan admin TERAKHIR balas manual / pegang
// kontak (bot_paused_contacts di-upsert tiap admin balas manual). Dipakai untuk
// menentukan lead mana yang belum ditindaklanjuti admin.
// Semua pesan masuk satu kontak sejak sinceIso (kronologis). Untuk mengisi ulang
// ingatan bot saat riwayat lokal kosong.
async function fetchLeadMessages(waJid, sinceIso) {
  if (!supa) return [];
  try {
    const { data, error } = await supa
      .from('whatsapp_bot_leads')
      .select('message, created_at')
      .eq('wa_jid', waJid)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: true })
      .limit(40);
    if (error) { console.error('[supa] fetchLeadMessages:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.error('[supa] fetchLeadMessages:', e.message);
    return [];
  }
}

async function fetchAdminReplyTimes() {
  if (!supa) return {};
  try {
    // Hanya source='admin'. Handoff AI juga meng-upsert tabel ini; tanpa filter,
    // lead yang di-handoff dianggap "sudah dibales" dan hilang dari pengingat.
    const { data, error } = await supa
      .from('bot_paused_contacts')
      .select('wa_jid, updated_at')
      .eq('source', 'admin');
    if (error) {
      console.error('[supa] fetchAdminReplyTimes:', error.message);
      return {};
    }
    const out = {};
    for (const r of data || []) {
      const t = new Date(r.updated_at).getTime();
      if (Number.isFinite(t)) out[r.wa_jid] = t;
    }
    return out;
  } catch (e) {
    console.error('[supa] fetchAdminReplyTimes:', e.message);
    return {};
  }
}

// Handoff AI 24 jam terakhir yang belum disentuh admin (begitu admin membalas
// manual, source berubah jadi 'admin'). Dipakai eskalasi di reminder.js.
// Tidak disaring paused_until: bot sudah ambil alih setelah 2 jam, tapi admin
// tetap perlu tahu klien ini belum dibalas.
async function fetchHandoffAI() {
  if (!supa) return [];
  try {
    const { data, error } = await supa
      .from('bot_paused_contacts')
      .select('wa_jid, updated_at')
      .eq('source', 'ai')
      .gt('updated_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    if (error) { console.error('[supa] fetchHandoffAI:', error.message); return []; }
    return data || [];
  } catch (e) {
    console.error('[supa] fetchHandoffAI:', e.message);
    return [];
  }
}

// Upsert pause (dipakai saat admin balas manual → dashboard ikut lihat).
async function upsertPause(waJid, untilMs, source = 'admin') {
  if (!supa) return;
  try {
    const { error } = await supa.from('bot_paused_contacts').upsert(
      {
        wa_jid: waJid,
        paused_until: new Date(untilMs).toISOString(),
        source,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wa_jid' }
    );
    if (error) console.error('[supa] upsertPause:', error.message);
  } catch (e) {
    console.error('[supa] upsertPause:', e.message);
  }
}

// ── Fase 3: status koneksi + command queue ───────────────────────────────────
// patch: { connection?, qr?, last_connected_at? }
async function updateStatus(patch) {
  if (!supa) return;
  try {
    const { error } = await supa
      .from('bot_status')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (error) console.error('[supa] updateStatus:', error.message);
  } catch (e) {
    console.error('[supa] updateStatus:', e.message);
  }
}

async function fetchPendingCommands() {
  if (!supa) return [];
  try {
    const { data, error } = await supa
      .from('bot_commands')
      .select('id, command')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) {
      console.error('[supa] fetchPendingCommands:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error('[supa] fetchPendingCommands:', e.message);
    return [];
  }
}

async function markCommand(id, status, result) {
  if (!supa) return;
  try {
    const { error } = await supa
      .from('bot_commands')
      .update({
        status,
        result: result ?? null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) console.error('[supa] markCommand:', error.message);
  } catch (e) {
    console.error('[supa] markCommand:', e.message);
  }
}

// Tabel whatsapp_bot_contacts mungkin belum dibuat Kiro → jangan spam error log.
function isMissingTable(error) {
  if (!error) return false;
  return error.code === '42P01' || /does not exist|could not find the table|relation .* does not/i.test(error.message || '');
}

// Kolom reply_status/reply_status_at mungkin belum ditambah Kiro di dashboard →
// jangan spam error log sampai dia bikin kolomnya (lihat handover).
function isMissingColumn(error) {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(error.message || '');
}

// ── Status tanda-terima balasan (delivered/read) → tempel ke lead terbaru ─────
// Dipakai deliveryLog: saat balasan customer berubah status, update baris
// whatsapp_bot_leads TERBARU untuk kontak itu. Best-effort; diam kalau kolom
// belum ada (Kiro tambah nanti). PostgREST tak dukung UPDATE+ORDER+LIMIT, jadi
// ambil id lead terbaru dulu, baru update by id.
async function updateLatestLeadStatus(waJid, statusLabel) {
  if (!supa) return;
  try {
    const { data, error } = await supa
      .from('whatsapp_bot_leads')
      .select('id')
      .eq('wa_jid', waJid)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      if (!isMissingTable(error)) console.error('[supa] leadStatus(select):', error.message);
      return;
    }
    if (!data) return; // belum ada lead utk kontak ini → tak ada yg di-update
    const { error: uerr } = await supa
      .from('whatsapp_bot_leads')
      .update({ reply_status: statusLabel, reply_status_at: new Date().toISOString() })
      .eq('id', data.id);
    if (uerr && !isMissingColumn(uerr) && !isMissingTable(uerr)) {
      console.error('[supa] leadStatus(update):', uerr.message);
    }
  } catch (e) {
    console.error('[supa] updateLatestLeadStatus:', e.message);
  }
}

// ── Segmentasi kontak (B2B vs private) ───────────────────────────────────────
// Map { wa_jid -> { segment, org_name } } untuk kontak yang di-set MANUAL admin.
async function fetchManualContacts() {
  if (!supa) return null;
  try {
    const { data, error } = await supa
      .from('whatsapp_bot_contacts')
      .select('wa_jid, segment, org_name')
      .eq('segment_source', 'manual');
    if (error) {
      if (!isMissingTable(error)) console.error('[supa] fetchManualContacts:', error.message);
      return null;
    }
    const out = {};
    for (const r of data || []) out[r.wa_jid] = { segment: r.segment, org_name: r.org_name };
    return out;
  } catch (e) {
    console.error('[supa] fetchManualContacts:', e.message);
    return null;
  }
}

// Upsert segmen hasil deteksi bot (source='auto'). Caller wajib pastikan kontak
// belum di-set manual (manual menang). Best-effort.
async function upsertContactAuto(jid, fields) {
  if (!supa) return;
  try {
    const { error } = await supa.from('whatsapp_bot_contacts').upsert(
      {
        wa_jid: jid,
        phone: fields.phone || null,
        name: fields.name || null,
        segment: fields.segment || 'private',
        segment_source: 'auto',
        org_name: fields.org_name || null,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wa_jid' }
    );
    if (error && !isMissingTable(error)) console.error('[supa] upsertContactAuto:', error.message);
  } catch (e) {
    console.error('[supa] upsertContactAuto:', e.message);
  }
}

// Hapus pause (Admin Hand-back) — panggil ini via command queue (Selesai/Done)
async function hapusPause(waJid) {
  if (!supa) return;
  try {
    const { error } = await supa
      .from('bot_paused_contacts')
      .delete()
      .eq('wa_jid', waJid);
    if (error) console.error('[supa] hapusPause:', error.message);
  } catch (e) {
    console.error('[supa] hapusPause:', e.message);
  }
}

// Nama add-on aktif di master Tetra Ops. Quotation mencocokkan nama persis,
// jadi AI harus memilih dari daftar ini. Cache 1 jam.
let cacheAddon = { t: 0, nama: [] };
// Kontak vendor di Tetra Ops (nama + nomor). Cache 1 jam; gagal = pakai cache lama.
let cacheVendor = { t: 0, data: [] };
async function fetchVendorContacts() {
  if (!supa) return [];
  if (Date.now() - cacheVendor.t < 3600 * 1000) return cacheVendor.data;
  try {
    const { data, error } = await supa.from('contacts').select('name, phone').eq('type', 'vendor').eq('is_active', true);
    if (error) { console.error('[supa] fetchVendorContacts:', error.message); return cacheVendor.data; }
    cacheVendor = { t: Date.now(), data: data || [] };
    return cacheVendor.data;
  } catch (e) {
    console.error('[supa] fetchVendorContacts:', e.message);
    return cacheVendor.data;
  }
}

async function fetchAddonNames() {
  if (!supa) return [];
  if (Date.now() - cacheAddon.t < 3600 * 1000 && cacheAddon.nama.length) return cacheAddon.nama;
  try {
    const { data, error } = await supa.from('addons').select('name').eq('is_active', true).is('deleted_at', null);
    if (error) { console.error('[supa] fetchAddonNames:', error.message); return cacheAddon.nama; }
    cacheAddon = { t: Date.now(), nama: (data || []).map((r) => r.name) };
    return cacheAddon.nama;
  } catch (e) {
    console.error('[supa] fetchAddonNames:', e.message);
    return cacheAddon.nama;
  }
}

module.exports = {
  fetchVendorContacts,
  fetchAddonNames,
  fetchHandoffAI,
  fetchLeadMessages,
  enabled,
  insertLead,
  fetchSettings,
  fetchRules,
  fetchPausedContacts,
  upsertPause,
  hapusPause, // Export fungsi baru
  updateStatus,
  fetchPendingCommands,
  markCommand,
  fetchManualContacts,
  upsertContactAuto,
  updateLatestLeadStatus,
  fetchRecentLeads,
  fetchAdminReplyTimes,
};
