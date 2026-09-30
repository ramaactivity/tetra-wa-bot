// Instance UJI Baileys 7 di nomor cadangan. Tanpa Supabase/Tetra Ops/Telegram/Sheet.
// JANGAN pernah diarahkan ke auth_info produksi.
module.exports = { apps: [{
  name: "tetra-bot-v7-uji",
  cwd: "/home/ubuntu/tetra-wa-v7",
  script: "index.js",
  autorestart: true,
  max_restarts: 20,
  env: { SHEET_SYNC: "off", ADMIN_NOTIFY_JID: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", TELEGRAM_BOT_TOKEN: "", AVAILABILITY_API_TOKEN: "" },
}] };
