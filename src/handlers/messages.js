// Handler utama event messages.upsert.
// Routing: kemitraan/sponsor → handoff · purna-jual → handoff · produk khusus →
// handoff · pricelist/form website → gate kualifikasi (smartLead) · sisanya → AI
// dengan konteks lead (persona + detail acara + yang masih kurang).
const live = require('../lib/liveConfig');
const supa = require('../lib/supa');
const { isPaused, setPause, HANDOFF_AI_MS, getRiwayat, tambahRiwayat, lupakanRiwayat } = require('../lib/store');
const { syncToSheet } = require('../lib/sheetSync');
const { extractText } = require('../lib/rules');
const { botSentIds } = require('../lib/botMessages');
const { sendReply } = require('../lib/sender');
const { notifyAdmin } = require('../lib/notify');
const { getAIResponse } = require('../lib/ai');
const { kirimPricelist, mintaPricelist } = require('../lib/pricelist');
const { enrich, classifyTopik } = require('../lib/enrichLead');
const smart = require('../lib/smartLead');
const { execSync } = require('child_process');

// Serialisasi pemrosesan per-JID
const jidChains = new Map();
function runSerial(jid, task) {
  const prev = jidChains.get(jid) || Promise.resolve();
  const next = prev.then(task, task);
  jidChains.set(jid, next);
  next.finally(() => { if (jidChains.get(jid) === next) jidChains.delete(jid); });
  return next;
}

function phoneDigits(msg) {
  const jid = msg.key?.remoteJid || '';
  if (jid.endsWith('@lid')) {
    const pn = msg.key?.senderPn;
    if (pn && pn.includes('@')) return pn.split('@')[0];
  }
  return jid.split('@')[0];
}

// ── Deteksi intent khusus (di luar penjualan retail) ──────────────────────────
// Kemitraan / franchise / sponsorship masuk: mereka MENAWARKAN kerja sama atau
// minta Tetra jadi sponsor — BUKAN menyewa photobooth. Harus ke owner.
function isKemitraan(t) {
  return /kemitraan|franchise|transfer knowledge|memulai usaha|membuka peluang|open kolaborasi|menawarkan kesempatan|proposal sponsor|tim sponsorship|sponsorship/i.test(t);
}

// Purna-jual: pelanggan existing butuh softfile/invoice/bayar/reschedule. Data
// transaksi dipegang manusia, bukan bot.
function isPostSale(t) {
  return /softfile|soft file|file foto|kwitansi|invoice|nota pembayaran|bayar sisa|sisa dp|reschedule|re.?schedule|kabar duka|meninggal|bukti transfer|pelunasan/i.test(t);
}

// Produk/jasa di luar pricelist unlimited standar → jangan dikarang, handoff.
function isSpecialProduct(t) {
  return /\b360\b|mingle|instant photobooth|instant photo|software|aplikasi|cetak foto aja|cetak doang|maksimal berapa|printer dnp/i.test(t);
}

// Susun konteks lead untuk di-inject ke AI tiap turn, biar bot "ingat" dan tidak
// nanya ulang hal yang sudah disebut. Terima teks GABUNGAN (riwayat user + pesan
// terbaru) supaya detail yang terpencar di beberapa pesan tetap terbaca.
function buildLeadContext(fullText) {
  const det = smart.parseLeadDetails(fullText);
  const seg = smart.detectSegment(fullText);
  const known = [];
  if (det.jenisAcara) known.push(`jenis=${det.jenisAcara}`);
  if (det.tanggal) known.push(`tanggal=${det.tanggal}`);
  if (det.lokasi) known.push(`lokasi=${det.lokasi}`);
  const missing = smart.missingFields(det);
  const lines = [`Persona: ${smart.segmentLabel(seg.segment)}`];
  if (known.length) lines.push(`Sudah diketahui: ${known.join(', ')}`);
  else lines.push('Belum ada detail acara.');
  if (missing.length) lines.push(`Masih kurang: ${missing.join(', ')} — tanyakan yang paling menentukan dulu, maksimal 2 hal dalam satu pesan.`);
  else lines.push('Detail acara sudah lengkap — fokus ke cek slot & rekomendasi paket.');
  return lines.join('\n');
}

// Gabungkan seluruh pesan USER dalam riwayat + pesan terbaru menjadi satu teks.
// Dipakai untuk parse detail acara & segmentasi supaya gate kualifikasi tidak
// menanya ulang hal yang sudah diberi klien di pesan sebelumnya.
function fullUserText(jid, originalText) {
  const hist = getRiwayat(jid)
    .filter((p) => p.role === 'user')
    .map((p) => p.content);
  return [...hist, originalText].join('\n');
}

// Kirim handoff: jawab klien singkat + notif admin + pause bot ke kontak ini.
async function handoff(sock, msg, alasan, jawabanKlien) {
  const jid = msg.key.remoteJid;
  await sendReply(sock, jid, msg.key, { name: 'handoff' }, jawabanKlien);
  await notifyAdmin(sock, phoneDigits(msg), { name: 'HANDOFF' }, getRiwayat(jid), alasan);
  await supa.upsertPause(jid, Date.now() + HANDOFF_AI_MS, 'ai');
}

// ── Penundaan balasan (debounce per kontak) ──────────────────────────────────
// Klien WhatsApp mengetik terpecah: "Untuk hari Minggu" / "Lokasi di kebun su" /
// "Bogor". Membalas tiap bubble = tiga balasan dengan konteks sepotong-sepotong
// (23 Sep 2026: 8 balasan dalam 2 menit ke satu klien). Sekarang bubble dikumpulkan
// dulu; timer mulai ulang tiap bubble baru; kalau klien masih terlihat mengetik,
// tunggu lagi. Semua bubble digabung jadi SATU giliran user → SATU balasan utuh.
const TUNGGU_MS = () => (Number(process.env.REPLY_DELAY_SECONDS) || 25) * 1000;
const MASIH_NGETIK_MS = 10000;  // presence "composing" lebih baru dari ini = masih ngetik
const TUNGGU_MAKS_MS = 120000;  // batas total menunggu, apa pun yang terjadi
const PESAN_TERLAMA_MS = 12 * 3600 * 1000; // pesan yang masuk selagi bot offline tetap dibalas (maks 12 jam)
const antrian = new Map();      // jid -> { msgs: [], timer, mulai }
const ngetik = new Map();       // jid -> ts terakhir terlihat mengetik
const sudahSubscribe = new Set();

function registerMessageHandler(sock) {
  // Pesan keluar dari perangkat lain (admin bales manual dari HP) → bot diam.
  const handleFromMe = async (msg) => {
    const jid = msg.key.remoteJid;
    if (botSentIds.has(msg.key.id)) {
      botSentIds.delete(msg.key.id);
    } else if (!jid.endsWith('@g.us') && jid !== 'status@broadcast') {
      // Admin bales manual → bot diam 24 jam (PAUSE_HOURS), BUKAN 7 hari.
      // 7 hari terlalu lama: pelanggan yang chat lagi 2-3 hari kemudian jadi
      // dibisukan padahal admin belum tentu sempat balas.
      const adminPauseMs = (live.get().PAUSE_HOURS || 24) * 3600 * 1000;
      await supa.upsertPause(jid, Date.now() + adminPauseMs, 'admin');
      // Bubble klien yang masih menunggu dibuang: admin sudah pegang percakapan ini.
      const q = antrian.get(jid);
      if (q) { clearTimeout(q.timer); antrian.delete(jid); }
    }
  };

  // Kalau riwayat kosong (pertama kali / sudah lama), isi dari pesan masuk yang
  // tersimpan di Supabase. Klien yang isi form website minggu lalu tidak boleh
  // ditanya ulang jenis/tanggal/lokasi acaranya.
  const pastikanRiwayat = async (jid) => {
    if (getRiwayat(jid).length) return;
    const lama = await supa.fetchLeadMessages(jid, new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString());
    for (const r of lama) {
      const tgl = new Date(r.created_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      tambahRiwayat(jid, 'user', `(pesan ${tgl}) ${r.message}`);
    }
    if (lama.length) console.log(`[riwayat] ${jid.split('@')[0]}: ${lama.length} pesan lama dimuat dari database`);
  };

  // Satu batch = semua bubble klien yang masuk dalam satu jeda menunggu.
  const handleBatch = async (msgs) => {
    try {
      const msg = msgs[msgs.length - 1];
      const jid = msg.key.remoteJid;
      const keys = msgs.map((m) => m.key);

      // Periksa status pause dari Supabase (admin bisa saja membalas selagi kita menunggu)
      const pausedContacts = await supa.fetchPausedContacts();
      const alasanDiam = !live.isEnabled()
        ? 'bot dimatikan di bot_settings.enabled'
        : jid === 'status@broadcast'
        ? 'status/broadcast'
        : jid.endsWith('@g.us')
        ? 'pesan grup'
        : (pausedContacts && pausedContacts[jid] && pausedContacts[jid] > Date.now())
        ? 'kontak ini di-pause (hand-off ke admin)'
        : null;
      if (alasanDiam) return;

      const originalText = msgs.map((m) => extractText(m.message)).filter(Boolean).join('\n');
      if (!originalText) return;

      await pastikanRiwayat(jid);

      // [Auto-database logging] — tiap bubble tetap dicatat sendiri-sendiri
      for (const m of msgs) {
        const ts = Number(m.messageTimestamp) || 0;
        const teks = extractText(m.message);
        if (!teks) continue;
        const createdIso = new Date((ts || Math.floor(Date.now() / 1000)) * 1000).toISOString();
        const leadData = {
          wa_jid: jid,
          phone: phoneDigits(m),
          name: m.pushName || 'Klien',
          topic: classifyTopik(teks),
          message: teks,
        };
        const enriched = enrich({ ...leadData, created_at: createdIso });
        await supa.insertLead({
          ...leadData,
          segment: enriched.segmen,
          category: enriched.kategori,
          location: enriched.lokasi,
          event_date: enriched.tanggal_acara || null,
        });
        await syncToSheet(enriched);
      }

      const t = originalText.toLowerCase();
      const fullText = fullUserText(jid, originalText);

      // ── 1. Kemitraan / sponsorship / franchise → handoff owner ──
      if (isKemitraan(t)) {
        await handoff(sock, msg, 'Lead kemitraan/sponsorship/franchise',
          'Wah menarik! Untuk peluang kemitraan/kerja sama, ini langsung dibahas sama founder kami ya — aku cuma bantu info layanan. Boleh aku sambungkan?');
        return;
      }

      // ── 2. Purna-jual → handoff admin ──
      if (isPostSale(t)) {
        await handoff(sock, msg, 'Purna-jual (softfile/invoice/bayar/reschedule)',
          'Siap Kak, untuk urusan ini aku sambungkan ke admin ya — mereka yang pegang data transaksinya. Sebentar 🙏');
        return;
      }

      // ── 3. Produk khusus → handoff (jangan karang harga) ──
      if (isSpecialProduct(t)) {
        await handoff(sock, msg, 'Produk khusus (360/mingle/instant/software/cetak doang)',
          'Untuk itu di luar paket unlimited standar ya Kak — harga & ketersediaannya beda. Biar tim kami yang info detailnya, aku sambungkan ya?');
        return;
      }

      // Command Admin: /stats
      if (t === '/stats' && phoneDigits(msg) === '5352849332') {
        const stats = execSync('node /home/ubuntu/tetra-wa-bot/stats.js').toString();
        await sendReply(sock, jid, keys, { name: 'stats' }, stats);
        return;
      }

      // ── 4. Pricelist / form website → gate kualifikasi ──
      const isForm = smart.isWebsiteForm(originalText);
      if (mintaPricelist(originalText) || isForm) {
        const det = smart.parseLeadDetails(fullText);
        const seg = smart.detectSegment(fullText);

        // B2B (eo_wo/corporate/instansi/venue/edu) → framing kemitraan, bukan dump retail
        if (seg.segment !== 'private') {
          const reply = smart.buildB2BReply(seg.segment, det, seg.orgName, false);
          tambahRiwayat(jid, 'user', originalText);
          tambahRiwayat(jid, 'assistant', reply);
          await sendReply(sock, jid, keys, { name: 'b2b' }, reply);
          return;
        }

        const missing = smart.missingFields(det);

        // Sudah lengkap ATAU nolak kasih detail → kirim PL + AI lanjutin (cek slot)
        if (missing.length === 0 || smart.wantsDirectPL(originalText)) {
          await kirimPricelist(sock, jid, 'auto-pricelist');
          const ai = await getAIResponse(getRiwayat(jid), originalText, buildLeadContext(fullText));
          tambahRiwayat(jid, 'user', originalText);
          tambahRiwayat(jid, 'assistant', ai);
          await sendReply(sock, jid, keys, { name: 'ai-reply' }, ai);
          return;
        }

        // Gate: tanya yang kurang, dibungkus manfaat
        const gate = smart.buildGateReply(det, missing);
        tambahRiwayat(jid, 'user', originalText);
        tambahRiwayat(jid, 'assistant', gate.intro + '\n\n' + gate.form);
        await sendReply(sock, jid, keys, { name: 'gate' }, gate.intro + '\n\n' + gate.form);
        return;
      }

      // ── 5. Default → AI dengan konteks lead ──
      const aiResponse = await getAIResponse(getRiwayat(jid), originalText, buildLeadContext(fullText));

      if (aiResponse.includes('[ADMIN_HANDOFF]')) {
        // Klien tidak boleh ditinggal diam: satu kalimat, lalu admin yang lanjut.
        tambahRiwayat(jid, 'user', originalText);
        await handoff(sock, msg, 'Handoff diminta oleh AI',
          'Untuk yang ini aku sambungkan ke admin ya Kak, biar dijawab langsung sama yang pegang datanya. Ditunggu sebentar 🙏');
        return;
      }

      tambahRiwayat(jid, 'user', originalText);
      tambahRiwayat(jid, 'assistant', aiResponse);
      await sendReply(sock, jid, keys, { name: 'ai-reply', file: '' }, aiResponse);

    } catch (err) {
      console.error('Error memproses pesan:', err.message);
    }
  };

  const jadwalkan = (jid, ms) => {
    const q = antrian.get(jid);
    if (!q) return;
    clearTimeout(q.timer);
    q.timer = setTimeout(() => flush(jid), ms);
  };

  const flush = (jid) => {
    const q = antrian.get(jid);
    if (!q) return;
    const masihNgetik = Date.now() - (ngetik.get(jid) || 0) < MASIH_NGETIK_MS;
    if (masihNgetik && Date.now() - q.mulai < TUNGGU_MAKS_MS) {
      jadwalkan(jid, MASIH_NGETIK_MS);
      return;
    }
    antrian.delete(jid);
    ngetik.delete(jid);
    console.log(`[tunggu] ${jid.split('@')[0]}: ${q.msgs.length} bubble digabung setelah ${Math.round((Date.now() - q.mulai) / 1000)} dtk`);
    runSerial(jid, () => handleBatch(q.msgs));
  };

  // Presence klien: "composing" = masih mengetik → jangan dulu balas;
  // "paused" = berhenti mengetik → boleh balas lebih cepat.
  sock.ev.on('presence.update', ({ id, presences }) => {
    if (!antrian.has(id)) return;
    for (const p of Object.values(presences || {})) {
      const s = p && p.lastKnownPresence;
      if (s === 'composing' || s === 'recording') ngetik.set(id, Date.now());
      else if (s === 'paused') { ngetik.delete(id); jadwalkan(id, 4000); }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key?.remoteJid;
      if (!jid || !msg.message) continue;
      if (msg.key.fromMe) { runSerial(jid, () => handleFromMe(msg)); continue; }
      if (jid === 'status@broadcast' || jid.endsWith('@g.us')) continue;
      const ts = Number(msg.messageTimestamp) || 0;
      if (ts && Date.now() - ts * 1000 > PESAN_TERLAMA_MS) continue;
      if (!extractText(msg.message)) continue;

      if (!sudahSubscribe.has(jid)) {
        sudahSubscribe.add(jid);
        sock.presenceSubscribe(jid).catch(() => {});
      }
      const q = antrian.get(jid) || { msgs: [], timer: null, mulai: Date.now() };
      q.msgs.push(msg);
      antrian.set(jid, q);
      jadwalkan(jid, TUNGGU_MS());
    }
  });
}

module.exports = { registerMessageHandler };
