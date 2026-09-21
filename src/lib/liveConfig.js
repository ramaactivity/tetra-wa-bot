// Live config: gabungan config.js (default/fallback) + override dari Supabase
// (bot_settings + bot_rules) yang di-refresh berkala. Kalau DB kosong/down,
// nilai terakhir / config.js tetap dipakai → bot tak pernah mati gara-gara DB.
//
// Lihat WHATSAPP_BOT_LEADS_HANDOVER §5.3: config.js = fallback, DB = override.
const base = require('../../config');
const supa = require('./supa');

// Salinan config aktif (mutable). Awalnya = config.js apa adanya.
const current = {
  ENABLED: true, // master on/off (bot_settings.enabled)
  RULES: base.RULES,
  SALAM_REPLY: base.SALAM_REPLY,
  COOLDOWN_HOURS: base.COOLDOWN_HOURS,
  PAUSE_HOURS: base.PAUSE_HOURS,
  ADMIN_NOTIFY_JID: base.ADMIN_NOTIFY_JID,
  BUSINESS_START_HOUR: base.BUSINESS_START_HOUR,
  BUSINESS_END_HOUR: base.BUSINESS_END_HOUR,
  TIMEZONE_OFFSET: base.TIMEZONE_OFFSET,
  AFTER_HOURS_NOTE: base.AFTER_HOURS_NOTE,
};

// Map { wa_jid -> paused_until_ms } dari dashboard (bot_paused_contacts).
let remotePaused = {};

// Map { wa_jid -> { segment, org_name } } untuk kontak yang di-set MANUAL admin
// di dashboard. Ini sumber kebenaran segmen — bot tak boleh menimpa.
let manualSegments = {};

// Segmen manual sebuah kontak (kalau ada), atau null.
function getManualSegment(jid) {
  return manualSegments[jid] || null;
}

function get() {
  return current;
}

function getRules() {
  return current.RULES;
}

function isEnabled() {
  return current.ENABLED !== false;
}

function isRemotePaused(jid) {
  const until = remotePaused[jid];
  return until ? Date.now() < until : false;
}

// Map satu baris bot_rules → bentuk rule yang dipakai engine (sama spt config.js).
function mapRule(r) {
  return {
    name: r.name,
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    reply: r.reply || '',
    file: r.file_path || '',
  };
}

async function refresh() {
  if (!supa.enabled()) return;

  const settings = await supa.fetchSettings();
  if (settings) {
    if (typeof settings.enabled === 'boolean') current.ENABLED = settings.enabled;
    if (settings.salam_reply != null) current.SALAM_REPLY = settings.salam_reply;
    if (settings.after_hours_note != null) current.AFTER_HOURS_NOTE = settings.after_hours_note;
    if (settings.admin_notify_jid != null) current.ADMIN_NOTIFY_JID = settings.admin_notify_jid;
    if (Number.isFinite(settings.cooldown_hours)) current.COOLDOWN_HOURS = settings.cooldown_hours;
    if (Number.isFinite(settings.pause_hours)) current.PAUSE_HOURS = settings.pause_hours;
    if (Number.isFinite(settings.business_start_hour)) current.BUSINESS_START_HOUR = settings.business_start_hour;
    if (Number.isFinite(settings.business_end_hour)) current.BUSINESS_END_HOUR = settings.business_end_hour;
    if (Number.isFinite(settings.timezone_offset)) current.TIMEZONE_OFFSET = settings.timezone_offset;
  }

  const rules = await supa.fetchRules();
  // Hanya override kalau DB benar-benar punya rule aktif; kalau kosong/null,
  // pertahankan RULES sebelumnya (config.js) supaya bot tak kehilangan balasan.
  if (Array.isArray(rules) && rules.length > 0) {
    current.RULES = rules.map(mapRule);
  }

  const paused = await supa.fetchPausedContacts();
  if (paused) remotePaused = paused;

  const manual = await supa.fetchManualContacts();
  if (manual) manualSegments = manual;
}

// Refresh sekali di awal lalu tiap intervalMs (default 60 dtk).
function start(intervalMs = 60000) {
  refresh().catch((e) => console.error('[liveConfig] refresh awal:', e.message));
  const t = setInterval(
    () => refresh().catch((e) => console.error('[liveConfig] refresh:', e.message)),
    intervalMs
  );
  if (t.unref) t.unref();
  return t;
}

module.exports = { get, getRules, isEnabled, isRemotePaused, getManualSegment, refresh, start };
