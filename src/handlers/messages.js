// Handler utama event messages.upsert (alur SEDERHANA — bot cuma untuk customer
// BARU, maksimal 2 balasan, lalu hand-off PERMANEN ke admin):
//  1. Deteksi balasan manual admin → pause PERMANEN kontak (human handoff).
//  2. Filter scope: hanya chat personal masuk, bukan grup/status/admin.
//  3. B2B (rekanan) → cukup SAPA sekali → notif prioritas → diam (admin yang balas).
//  4. Private → sapa / minta detail (#1), kirim pricelist (#2) → pause permanen.
// DP, cek-ketersediaan, dan semua rule statis (lokasi/fasilitas/durasi/dll)
// SENGAJA dimatikan — itu jadi tanggung jawab admin manual.
const live = require('../lib/liveConfig');
const supa = require('../lib/supa');
const base = require('../../config');
const { isPaused, setPause } = require('../lib/store');
const { extractText, findRule, isWithinBusinessHours } = require('../lib/rules');
const { botSentIds } = require('../lib/botMessages');
const { sendReply } = require('../lib/sender');
const { notifyAdmin } = require('../lib/notify');
const smart = require('../lib/smartLead');
const leadStore = require('../lib/leadStore');

// Teks sapaan (balasan pertama untuk chat tanpa inquiry jelas, mis. cuma "halo").
const GREETING_PRIVATE = `${base.SMART_LEAD.GREETING}\n\nAda yang bisa kami bantu, Kak? Boleh diceritakan kebutuhan acaranya, nanti kami carikan paket yang pas 🙌`;
// Sapaan B2B: ringan saja — kebutuhan rekanan ditangani langsung oleh admin.
const GREETING_B2B = `${base.SMART_LEAD.GREETING}\n\nMohon ditunggu sebentar ya Kak, admin kami akan segera membantu kebutuhan acaranya 🙌`;

// Nomor telepon asli (MSISDN) untuk display + wa.me. WhatsApp kini bisa
// meng-address chat pakai LID (`<lid>@lid`) demi privasi — angka di situ BUKAN
// nomor HP. Saat LID, nomor asli ada di `msg.key.senderPn`
// (`628xxx@s.whatsapp.net`). Kalau bukan LID, remoteJid sudah berisi nomor.
// `wa_jid` tetap pakai remoteJid (identitas utk pause/cooldown), hanya `phone`
// yang di-resolve ke nomor asli.
function phoneDigits(msg) {
  const jid = msg.key?.remoteJid || '';
  if (jid.endsWith('@lid')) {
    const pn = msg.key?.senderPn; // contoh: 628xxx@s.whatsapp.net
    if (pn && pn.includes('@')) return pn.split('@')[0];
  }
  return jid.split('@')[0];
}

// Serialisasi pemrosesan per-JID. WhatsApp bisa mengirim beberapa pesan beruntun
// sebagai event `messages.upsert` TERPISAH yang handler-nya jalan berbarengan.
// Tanpa antrian, dua pesan bisa sama-sama membaca state lead yang belum sempat
// di-commit (mis. stage 'awaiting' belum jadi 'sent') → balasan dobel. Antrian ini
// memaksa pesan dari kontak yang sama diproses satu-per-satu, berurutan.
const jidChains = new Map(); // jid -> Promise (ekor antrian per kontak)
function runSerial(jid, task) {
  const prev = jidChains.get(jid) || Promise.resolve();
  const next = prev.then(task, task); // jalan apa pun hasil task sebelumnya
  jidChains.set(jid, next);
  next.finally(() => {
    if (jidChains.get(jid) === next) jidChains.delete(jid); // bersihkan ekor
  });
  return next;
}

function registerMessageHandler(sock) {
  // Waktu bot mulai mendengar. Pesan dengan timestamp lebih lama dari ini berarti
  // hasil history-sync saat pertama connect → diabaikan (jangan dibales / jangan pause).
  const startedAt = Math.floor(Date.now() / 1000);

  // Pemrosesan satu pesan. `return` = berhenti memproses pesan ini (dulu `continue`).
  const handleMessage = async (msg) => {
      try {
        if (!msg.message) return;
        const jid = msg.key.remoteJid;
        if (!jid) return;
        // Nomor HP asli (resolve LID → senderPn) untuk lead/notif/contact.
        const phone = phoneDigits(msg);

        // Abaikan pesan lama (history sync) — hanya proses pesan yang masuk setelah bot start.
        const ts = Number(msg.messageTimestamp) || 0;
        if (ts && ts < startedAt) return;

        // Abaikan chat dengan nomor sendiri (note-to-self) — bukan customer.
        const ownNum = sock.user?.id?.split(':')[0]?.split('@')[0];
        if (ownNum && jid.split('@')[0] === ownNum) return;

        // --- Deteksi balasan manual admin (auto-pause / human handoff) ---
        if (msg.key.fromMe) {
          if (botSentIds.has(msg.key.id)) {
            botSentIds.delete(msg.key.id); // pesan bot sendiri → abaikan
          } else if (!jid.endsWith('@g.us') && jid !== 'status@broadcast') {
            setPause(jid); // admin bales manual → pause PERMANEN (bukan 24 jam)
            console.log(`⏸️  Admin bales manual ke ${jid}, auto-reply MATI permanen.`);
          }
          return;
        }

        // --- Master on/off (bot_settings.enabled dari dashboard) ---
        if (!live.isEnabled()) return; // bot dimatikan → tidak auto-reply

        // --- Filter scope pesan masuk ---
        if (jid === 'status@broadcast') return;
        if (jid.endsWith('@g.us')) return; // skip grup
        const adminJid = live.get().ADMIN_NOTIFY_JID;
        if (adminJid && jid === adminJid) return; // jangan auto-reply ke admin
        if (isPaused(jid)) {
          console.log(`⏸️  ${jid} di-pause (admin handle), dilewati.`);
          return;
        }

        const text = extractText(msg.message).toLowerCase();
        if (!text) return;
        const originalText = extractText(msg.message);

        // Helper: catat lead ke Supabase + (opsional) ping admin. Best-effort.
        const logAndNotify = async (topic, notifRule, extra = '') => {
          supa.insertLead({
            wa_jid: jid,
            phone,
            name: msg.pushName || null,
            topic,
            message: originalText,
            is_after_hours: !isWithinBusinessHours(),
          });
          if (notifRule) await notifyAdmin(sock, phone, notifRule, originalText, extra);
        };
        const PL = { name: 'pricelist', file: '' }; // pseudo-rule: kirim teks saja
        const GREET = { name: 'greeting', file: '' };

        const lead = leadStore.getLead(jid);

        // ===== SEGMENTASI: REKANAN (B2B) vs PRIVATE =====
        // Override manual admin (dari dashboard) MENANG atas tebakan bot.
        const manualSeg = live.getManualSegment(jid);
        const auto = smart.detectSegment(originalText);
        const segment = (manualSeg && manualSeg.segment) || auto.segment;
        const orgName = (manualSeg && manualSeg.org_name) || auto.orgName || null;
        const isB2B = segment !== 'private';

        const rule = findRule(text);
        const isLeadInquiry = (rule && rule.name === 'pricelist') || smart.isWebsiteForm(originalText);

        // (B2B) Rekanan → cukup SAPA sekali (kalau belum disapa) + notif PRIORITAS,
        // lalu DIAM PERMANEN. Kebutuhan rekanan penting → admin yang balas sendiri.
        if (isB2B) {
          if (!lead) {
            await sendReply(sock, jid, msg.key, GREET, smart.finalize(GREETING_B2B, originalText));
          }
          leadStore.setLead(jid, 'sent', smart.parseLeadDetails(originalText));
          setPause(jid); // hand-off permanen ke admin
          if (!manualSeg) {
            supa.upsertContactAuto(jid, { phone, name: msg.pushName || null, segment, org_name: orgName });
          }
          await logAndNotify(segment, { name: `🏢 PRIORITAS — ${smart.segmentLabel(segment)}` });
          console.log(`🏢 B2B (${segment}) → sapa + hand-off admin ${jid}`);
          return;
        }

        // ===== ALUR PRIVATE — maksimal 2 balasan, lalu hand-off permanen =====

        // (A) Bot tadi sudah sapa / tanya detail → balasan #2 = kirim PL, lalu DIAM.
        if (lead && lead.stage === 'awaiting') {
          const merged = smart.mergeDetails(lead.details, smart.parseLeadDetails(originalText));
          await sendReply(sock, jid, msg.key, PL, smart.finalize(smart.buildPlReply(merged, false), originalText));
          leadStore.setLead(jid, 'sent', merged);
          setPause(jid); // PL terkirim → tanggung jawab admin, bot diam permanen
          await logAndNotify('pricelist', { name: 'pricelist (detail masuk)' });
          console.log(`📤 PL terkirim (#2) → hand-off admin ${jid}`);
          return;
        }

        // (B) Klien minta pricelist (balasan #1)
        if (isLeadInquiry) {
          const details = smart.parseLeadDetails(originalText);
          const missing = smart.missingFields(details);

          // Detail sudah lengkap ATAU klien nolak/maksa → langsung kirim PL + diam.
          if (missing.length === 0 || smart.wantsDirectPL(text)) {
            await sendReply(sock, jid, msg.key, PL, smart.finalize(smart.buildPlReply(details), originalText));
            leadStore.setLead(jid, 'sent', details);
            setPause(jid); // PL terkirim → hand-off permanen
            await logAndNotify('pricelist', { name: 'pricelist' });
            console.log(`📤 PL terkirim langsung (#1) → hand-off admin ${jid}`);
          } else {
            // Special case: minta PL tapi belum kasih detail → tanya detail (balasan #1).
            // 2 bubble: (1) sapaan/akui detail, (2) form copy-paste. Balasan #2
            // (kirim PL) menyusul saat dia jawab, di branch (A).
            const gate = smart.buildGateReply(details, missing);
            await sendReply(sock, jid, msg.key, { name: 'gate', file: '' }, smart.finalize(gate.intro, originalText));
            await sendReply(sock, jid, msg.key, { name: 'gate-form', file: '' }, gate.form);
            leadStore.setLead(jid, 'awaiting', details);
            await logAndNotify('lead', null); // notif ke admin nanti pas dia kasih detail
            console.log(`🚪 Gate: minta detail (#1, 2 bubble) ke ${jid}`);
          }
          return;
        }

        // (C) Tidak ada inquiry jelas (mis. cuma "halo") → SAPA balik (balasan #1).
        // Balasan #2 (kirim PL) menyusul saat dia respon, di branch (A).
        await sendReply(sock, jid, msg.key, GREET, smart.finalize(GREETING_PRIVATE, originalText));
        leadStore.setLead(jid, 'awaiting', {});
        await logAndNotify('sapa', null);
        console.log(`👋 Sapa customer baru (#1) ke ${jid}`);
      } catch (err) {
        console.error('Error memproses pesan:', err.message);
      }
  };

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      const jid = msg.key?.remoteJid;
      if (!jid) continue; // tanpa jid tak bisa diantrikan; abaikan
      // Antrikan per kontak: pesan berikutnya dari jid yang sama menunggu
      // pesan ini selesai (state ter-commit) → cegah balasan dobel.
      await runSerial(jid, () => handleMessage(msg));
    }
  });
}

module.exports = { registerMessageHandler };
