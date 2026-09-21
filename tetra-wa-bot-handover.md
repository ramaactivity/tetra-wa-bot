# Tetra Photobooth — WhatsApp Auto-Reply Bot (v1)
### Handover Package untuk Antigravity / Claude Code

---

## 0. Instruksi buat Claude Code (baca ini dulu)

Lo lagi nge-build bot WhatsApp **dari nol** buat Tetra Photobooth. Inti tujuannya: **balas otomatis chat awal calon klien berdasarkan KONTEKS kata kuncinya** (pricelist, DP, lokasi, ketersediaan), plus beberapa fitur pelengkap biar admin nggak kewalahan.

Ini **v1**. Scope-nya sudah final di dokumen ini — **jangan nambah apa-apa di luar ini** (no database, no dashboard, no AI). Modul lead-capture ke Supabase ada di Section "v2 (Nanti)" → **jangan dikerjain sekarang.**

Fitur v1 yang HARUS ada:
1. **Multi-template** — balasan beda tergantung keyword (rule-based, prioritas berurutan).
2. **Auto-pause (human handoff)** — kalau admin bales manual, bot stop auto-reply ke kontak itu.
3. **Notif lead ke admin** — tiap lead masuk, bot ping nomor WA admin.
4. **Jam kerja** — di luar jam operasional, balasan dikasih catatan after-hours.
5. **Kirim pricelist sebagai file** — opsional lampirkan gambar/PDF pricelist.

Kerjakan urut: scaffold → implement sesuai reference code → test lokal (scan QR) → panduan deploy ke VPS.

---

## 1. Konteks & Keputusan Arsitektur

**Masalah:** Admin Tetra kewalahan jawab pertanyaan awal calon klien (mayoritas minta pricelist, sebagian tanya DP/lokasi/ketersediaan tanggal).

**Kenapa Baileys (bukan Cloud API / Fonnte):**
- Nomor Tetra (`6285213526630`) **wajib tetap aktif & dipakai manual** di iPhone admin → nggak bisa didedikasikan ke WhatsApp Cloud API.
- Slot WhatsApp Business App di iPhone admin udah kepake bisnis lain → Coexistence butuh device kedua (nggak ada).
- Gateway pihak ketiga (Fonnte dll) sudah dicoba & bermasalah (autoreply nggak ke-trigger walau koneksi sukses). Bikin sendiri = kontrol penuh, no black-box.

**Solusi:** Bot Baileys connect ke nomor Tetra sebagai **linked device** (sama persis cara WhatsApp Web). Scan QR sekali dari iPhone admin. Nomor Tetra tetap primary & bisa dipakai manual; bot cuma companion device.

**Konsekuensi yang sudah diterima:**
- Jalur **unofficial** → ada risiko banned. Mitigasi: bot HANYA membalas chat masuk personal (bukan blast, bukan grup), ada cooldown + delay human-like + auto-pause. Risiko untuk pola reply-only tergolong rendah, tapi tetap ada.
- Butuh proses nyala 24 jam → host di VPS DomaiNesia (Section 6).

---

## 2. Tech Stack

| Komponen | Pilihan | Catatan |
|---|---|---|
| Bahasa | Node.js 20 LTS | |
| Library WA | `@whiskeysockets/baileys` | Fork Baileys yang dimaintain |
| QR render | `qrcode-terminal` | QR ASCII di terminal SSH |
| Boom | `@hapi/boom` | Baca disconnect reason |
| Logger | `pino` | Silent by default |
| Process manager | `pm2` | Auto-restart + survive reboot |
| Hosting | VPS DomaiNesia | `157.15.124.114`, Ubuntu 24.04, user `root` |
| Session | `useMultiFileAuthState` (file) | Nggak perlu scan QR ulang tiap restart |

**TIDAK pakai:** database, Vercel/serverless (Baileys butuh WebSocket persisten), framework web apa pun.

---

## 3. Spesifikasi Fungsional

### 3.1 Scope pesan yang diproses
Bot HANYA memproses pesan masuk yang: **personal** (bukan grup `@g.us` / bukan `status@broadcast`), **bukan dari admin sendiri**, **berisi teks**, dan **bukan dari nomor admin** (ADMIN_NOTIFY_JID). Selain itu → diam.

### 3.2 Multi-template (rule-based)
- Config berisi **daftar RULES**. Tiap rule = `{ name, keywords[], reply, file? }`.
- Matching: **contains** + **case-insensitive**.
- **Rule pertama yang cocok menang** (prioritas = urutan di array). Taruh rule spesifik (DP, lokasi, booking) di ATAS, rule umum (pricelist) di BAWAH — supaya "DP berapa" kena rule DP, bukan pricelist.
- Kalau nggak ada rule cocok → diam (nggak ada catch-all di v1).

### 3.3 Anti-spam (cooldown per kontak × rule)
- Key cooldown = `${jid}:${ruleName}`.
- Jangan kirim **template yang sama** ke **kontak yang sama** dua kali dalam `COOLDOWN_HOURS` (default 12 jam).
- Tapi template BEDA tetap boleh dikirim (mis. klien tanya pricelist lalu tanya DP → dua-duanya kebales).
- Disimpan ke `cooldown.json`, survive restart.

### 3.4 Auto-pause / human handoff
- Begitu **admin membalas manual** ke sebuah chat (terdeteksi dari pesan `fromMe` yang BUKAN dikirim bot), bot **stop auto-reply ke kontak itu** selama `PAUSE_HOURS` (default 24 jam).
- Tujuan: bot nggak pernah motong percakapan yang udah dihandle admin.
- **Penting:** pesan yang dikirim bot sendiri juga `fromMe` → harus dibedakan. Caranya: simpan `key.id` tiap pesan bot ke `botSentIds`; saat ada pesan `fromMe` masuk, kalau id-nya ada di situ berarti itu pesan bot (abaikan), kalau nggak ada berarti admin manual (→ pause).
- Disimpan ke `pause.json`, survive restart.

### 3.5 Notif lead ke admin
- Tiap kali bot membalas lead, kirim notifikasi ke `ADMIN_NOTIFY_JID` (nomor WA pribadi admin): siapa pengirimnya (`wa.me/...`), topik (nama rule), dan kutipan pesan aslinya.
- Notif ini juga pesan bot → id-nya wajib disimpan ke `botSentIds` (biar nggak ke-detect sebagai "admin manual reply").
- Kalau `ADMIN_NOTIFY_JID` kosong → fitur ini mati.

### 3.6 Jam kerja (after-hours)
- Jam operasional default 09.00–18.00 **WIB (UTC+7)**.
- Di luar jam itu, balasan ditambah `AFTER_HOURS_NOTE` di akhir.
- Server pakai UTC → hitung jam lokal via `TIMEZONE_OFFSET`.

### 3.7 Kirim pricelist sebagai file
- Rule boleh punya field `file` (path ke `assets/`). Kalau diisi & file-nya ada → kirim sebagai **gambar** (`.jpg/.png/.webp`) atau **dokumen** (`.pdf`) dengan caption = teks balasan. Kalau kosong/tidak ada → kirim teks biasa (link saja).
- Admin yang menyediakan file aslinya di folder `assets/`.

### 3.8 Perilaku human-like (mitigasi ban + natural)
Sebelum kirim: tandai read → delay acak 2–5 dtk → presence "composing" ~1 dtk → kirim.

### 3.9 Reliability
- Auto-reconnect saat koneksi putus, KECUALI `DisconnectReason.loggedOut` (admin unlink device → harus scan QR ulang).
- Session via `useMultiFileAuthState('auth_info')` → restart nggak butuh scan ulang.

---

## 4. Struktur Project

```
tetra-wa-bot/
├── index.js          # Entry point + semua logika
├── config.js         # RULES, cooldown, pause, notif, jam kerja
├── package.json
├── .gitignore
├── README.md
├── assets/           # (opsional) file pricelist.jpg / pricelist.pdf
├── auth_info/        # (auto) session WhatsApp — JANGAN commit
├── cooldown.json     # (auto) state anti-spam — JANGAN commit
└── pause.json        # (auto) state human-handoff — JANGAN commit
```

---

## 5. Reference Implementation

> Implement file-file ini. Boleh dirapikan, tapi jangan ubah logika inti.

### 5.1 `package.json`
```json
{
  "name": "tetra-wa-bot",
  "version": "1.0.0",
  "description": "Auto-reply WhatsApp bot untuk Tetra Photobooth",
  "main": "index.js",
  "scripts": { "start": "node index.js" },
  "dependencies": {
    "@whiskeysockets/baileys": "^6.7.0",
    "@hapi/boom": "^10.0.1",
    "qrcode-terminal": "^0.12.0",
    "pino": "^9.0.0"
  }
}
```

### 5.2 `config.js`
```js
module.exports = {
  // ====== ATURAN BALASAN (urutan = prioritas; rule pertama yang cocok menang) ======
  // Taruh rule SPESIFIK di atas, rule UMUM (pricelist) di bawah.
  RULES: [
    {
      name: 'dp',
      keywords: ['dp', 'uang muka', 'bayar', 'pembayaran', 'transfer', 'rekening', 'booking fee'],
      reply: `Untuk mengamankan tanggal, booking dikonfirmasi dengan DP ya 🙌

[ISI: nominal DP, nomor rekening, atas nama, & kebijakan pelunasan kamu di sini]

Kalau sudah, kirim bukti transfernya ke chat ini ya, nanti kami konfirmasi 🙏`,
    },
    {
      name: 'lokasi',
      keywords: ['lokasi', 'area', 'jangkauan', 'luar kota', 'bisa ke', 'coverage', 'jangkau'],
      reply: `Kami melayani area Jabodetabek, dan bisa juga ke luar kota 🚗

[ISI: detail area & biaya transport luar kota kamu di sini]

Boleh infokan lokasi venue acaranya di mana? Biar kami cek ya 🙌`,
    },
    {
      name: 'booking',
      keywords: ['available', 'tersedia', 'kosong', 'booking', 'jadwal', 'tanggal', 'slot', 'ready'],
      reply: `Untuk cek ketersediaan tanggal, boleh diinfokan ya:
1. Tanggal acara?
2. Lokasi venue?
3. Jenis acaranya apa?

Nanti langsung kami cekkan slot-nya 🙌`,
    },
    {
      name: 'pricelist',
      keywords: ['pricelist', 'price list', 'harga', 'price', 'berapa', 'paket', 'list'],
      // Opsional: taruh file di assets/ lalu isi path-nya. Kosongkan ('') = kirim link saja.
      file: '', // contoh: 'assets/pricelist.jpg' atau 'assets/pricelist.pdf'
      reply: `Halo! Makasih udah menghubungi Tetra Photobooth 📸

Pricelist lengkap bisa langsung diintip di sini:
https://tetraphoto.com/pricelist

Biar kami bisa bantu cek ketersediaan tanggal & kasih rekomendasi paket yang paling pas, boleh diinfokan:
1. Jenis acaranya apa? (wedding / corporate / birthday / lainnya)
2. Tanggal acara?
3. Lokasi venue?

Ditunggu kabarnya ya, let's make some fun memories together! 🙌`,
    },
  ],

  // ====== ANTI-SPAM ======
  COOLDOWN_HOURS: 12, // template yang sama tidak dikirim 2x ke kontak yang sama dalam rentang ini

  // ====== AUTO-PAUSE (HUMAN HANDOFF) ======
  PAUSE_HOURS: 24, // setelah admin bales manual, bot diam ke kontak itu sekian jam

  // ====== NOTIF LEAD KE ADMIN ======
  ADMIN_NOTIFY_JID: '', // nomor WA admin, format '62xxxx@s.whatsapp.net'. Kosong = matikan notif.

  // ====== JAM KERJA (WIB / UTC+7) ======
  BUSINESS_START_HOUR: 9,
  BUSINESS_END_HOUR: 18,
  TIMEZONE_OFFSET: 7,
  AFTER_HOURS_NOTE: `

(Catatan: pesan ini masuk di luar jam operasional kami 09.00–18.00 WIB. Tim kami akan membalas lebih lengkap di jam kerja ya 🙏)`,
};
```

### 5.3 `index.js`
```js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const cfg = require('./config');

const COOLDOWN_FILE = path.join(__dirname, 'cooldown.json');
const PAUSE_FILE = path.join(__dirname, 'pause.json');
const COOLDOWN_MS = cfg.COOLDOWN_HOURS * 3600 * 1000;
const PAUSE_MS = cfg.PAUSE_HOURS * 3600 * 1000;

// ---------- persistent stores ----------
function loadJson(file) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (e) { console.error(`Gagal load ${file}:`, e.message); }
  return {};
}
function saveJson(file, data) {
  try { fs.writeFileSync(file, JSON.stringify(data)); }
  catch (e) { console.error(`Gagal save ${file}:`, e.message); }
}

let cooldown = loadJson(COOLDOWN_FILE); // `${jid}:${ruleName}` -> ts
let pause = loadJson(PAUSE_FILE);       // jid -> ts

const isOnCooldown = (key) => cooldown[key] ? (Date.now() - cooldown[key] < COOLDOWN_MS) : false;
const setCooldown = (key) => { cooldown[key] = Date.now(); saveJson(COOLDOWN_FILE, cooldown); };
const isPaused = (jid) => pause[jid] ? (Date.now() - pause[jid] < PAUSE_MS) : false;
const setPause = (jid) => { pause[jid] = Date.now(); saveJson(PAUSE_FILE, pause); };

// ---------- helpers ----------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  );
}

const findRule = (textLower) =>
  cfg.RULES.find((rule) => rule.keywords.some((k) => textLower.includes(k.toLowerCase())));

function isWithinBusinessHours() {
  const localHour = (new Date().getUTCHours() + cfg.TIMEZONE_OFFSET) % 24;
  return localHour >= cfg.BUSINESS_START_HOUR && localHour < cfg.BUSINESS_END_HOUR;
}

function buildReply(rule) {
  let text = rule.reply;
  if (!isWithinBusinessHours() && cfg.AFTER_HOURS_NOTE) text += cfg.AFTER_HOURS_NOTE;
  return text;
}

// id pesan yang dikirim bot, biar nggak salah dikira "admin bales manual"
const botSentIds = new Set();
function rememberBotMsg(sent) {
  const id = sent?.key?.id;
  if (id) botSentIds.add(id);
  if (botSentIds.size > 1000) botSentIds.clear();
}

// ---------- main ----------
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }), // ganti ke 'info' kalau mau debug
    browser: ['Tetra Bot', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\n📷 Scan QR ini dari WhatsApp HP Tetra (Setelan → Perangkat Tertaut → Tautkan Perangkat):\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') console.log('✅ Bot tersambung & siap. Menunggu pesan masuk...');
    if (connection === 'close') {
      const code = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : null;
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ Device di-unlink. Hapus folder auth_info lalu start ulang untuk scan QR baru.');
      } else {
        console.log('🔄 Koneksi putus, menyambung ulang...');
        startBot();
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const jid = msg.key.remoteJid;
        if (!jid) continue;

        // --- Deteksi balasan manual admin (auto-pause / human handoff) ---
        if (msg.key.fromMe) {
          if (botSentIds.has(msg.key.id)) {
            botSentIds.delete(msg.key.id); // pesan bot sendiri → abaikan
          } else if (!jid.endsWith('@g.us') && jid !== 'status@broadcast') {
            setPause(jid); // admin bales manual → pause kontak ini
            console.log(`⏸️  Admin bales manual ke ${jid}, auto-reply di-pause.`);
          }
          continue;
        }

        if (jid === 'status@broadcast') continue;
        if (jid.endsWith('@g.us')) continue;                                   // skip grup
        if (cfg.ADMIN_NOTIFY_JID && jid === cfg.ADMIN_NOTIFY_JID) continue;    // jangan auto-reply ke admin
        if (isPaused(jid)) { console.log(`⏸️  ${jid} di-pause (admin handle), dilewati.`); continue; }

        const text = extractText(msg.message).toLowerCase();
        if (!text) continue;

        const rule = findRule(text);
        if (!rule) continue;

        const cdKey = `${jid}:${rule.name}`;
        if (isOnCooldown(cdKey)) { console.log(`⏳ ${jid} sudah dibales "${rule.name}" (cooldown), dilewati.`); continue; }

        // --- human-like ---
        await sock.readMessages([msg.key]);
        await delay(2000 + Math.floor(Math.random() * 3000));
        await sock.sendPresenceUpdate('composing', jid);
        await delay(1000);

        // --- kirim balasan (teks / file) ---
        const replyText = buildReply(rule);
        let sent;
        const filePath = rule.file ? path.join(__dirname, rule.file) : null;
        if (filePath && fs.existsSync(filePath)) {
          const ext = path.extname(filePath).toLowerCase();
          if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
            sent = await sock.sendMessage(jid, { image: { url: filePath }, caption: replyText });
          } else {
            sent = await sock.sendMessage(jid, {
              document: { url: filePath },
              fileName: path.basename(filePath),
              mimetype: ext === '.pdf' ? 'application/pdf' : 'application/octet-stream',
              caption: replyText,
            });
          }
        } else {
          sent = await sock.sendMessage(jid, { text: replyText });
        }
        rememberBotMsg(sent);
        setCooldown(cdKey);
        console.log(`📤 Balasan "${rule.name}" terkirim ke ${jid}`);

        // --- notif lead ke admin ---
        if (cfg.ADMIN_NOTIFY_JID) {
          const num = jid.split('@')[0];
          const notif =
            `🔔 *Lead baru — Tetra Photobooth*\n` +
            `Dari: wa.me/${num}\n` +
            `Topik: ${rule.name}\n` +
            `Pesan: "${extractText(msg.message)}"`;
          const n = await sock.sendMessage(cfg.ADMIN_NOTIFY_JID, { text: notif });
          rememberBotMsg(n);
        }
      } catch (err) {
        console.error('Error memproses pesan:', err.message);
      }
    }
  });
}

startBot().catch((e) => console.error('Fatal:', e));
```

### 5.4 `.gitignore`
```
node_modules/
auth_info/
cooldown.json
pause.json
*.log
```

### 5.5 `README.md`
Isi singkat: cara jalanin lokal (`npm install` → `npm start` → scan QR), penjelasan `config.js` (cara edit RULES, isi ADMIN_NOTIFY_JID, taruh file pricelist di `assets/`), dan referensi ke Section 6 untuk deploy.

---

## 6. Deploy ke VPS (DomaiNesia)

> Server live: **DomaiNesia `157.15.124.114`** (Ubuntu 24.04, user `root`). Server
> **BUKAN repo git** — kode disalin via `scp`/`rsync`. Untuk update rutin (deploy
> per-file, backup, rollback, verifikasi) lihat **[DEPLOY.md](DEPLOY.md)**.

### 6.1 VPS
1. VPS sudah aktif: `157.15.124.114`, Ubuntu 24.04, akses SSH sebagai `root`
   (key SSH ada di `.env.local` mesin dev sebagai `VPS_SSH_KEY`).
2. Bot ini **outbound-only** → nggak perlu buka port inbound. Skip firewall.

### 6.2 Setup server (SSH) — sekali di awal
```bash
ssh -i <VPS_SSH_KEY> root@157.15.124.114

# Node 20 (umumnya sudah terpasang). Kalau server baru:
#   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
#   source ~/.bashrc && nvm install 20 && nvm use 20

mkdir -p /root/tetra-wa-bot
# Salin project dari mesin dev (TANPA node_modules/auth_info/data), dari mesin dev:
#   rsync -av --exclude node_modules --exclude auth_info --exclude data ./ root@157.15.124.114:/root/tetra-wa-bot/
cd /root/tetra-wa-bot
npm install
# Buat .env: SUPABASE_*, AVAILABILITY_API_TOKEN, dll — lihat .env.example
# Kalau pakai file pricelist: scp pricelist.jpg/pdf ke folder assets/
```

### 6.3 First run + scan QR
```bash
node index.js
```
Scan QR (ASCII) dari **HP Tetra**: WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat. Setelah `✅ Bot tersambung`, `Ctrl+C`.

### 6.4 Jadikan 24/7 (pm2)
```bash
npm install -g pm2
pm2 start index.js --name tetra-bot
pm2 save
pm2 startup   # jalankan command yang di-print, biar auto-nyala saat reboot
```
Perintah: `pm2 logs tetra-bot` · `pm2 restart tetra-bot` · `pm2 status`.

---

## 7. Checklist Testing

- [ ] `npm install` sukses; `node index.js` → QR muncul; scan → `✅ Bot tersambung`.
- [ ] Kirim "minta pricelist dong" → kebales **template pricelist**.
- [ ] Kirim "DP berapa ya?" → kebales **template DP** (BUKAN pricelist) → cek urutan RULES.
- [ ] Kirim "bisa ke luar kota?" → kebales **template lokasi**.
- [ ] Kirim "tanggal 20 masih available?" → kebales **template booking**.
- [ ] Kirim "halo kak" (tanpa keyword) → **TIDAK dibales**.
- [ ] Kirim keyword sama dari kontak sama <12 jam → **TIDAK dibales** (cooldown per-rule).
- [ ] Kirim keyword di grup → **TIDAK dibales**.
- [ ] **Auto-pause:** admin bales manual ke satu kontak → kontak itu kirim keyword lagi → **TIDAK dibales** (paused).
- [ ] **Notif admin:** isi `ADMIN_NOTIFY_JID` → ada lead masuk → nomor admin **dapat notif**.
- [ ] **Jam kerja:** test di luar 09–18 WIB → balasan ada catatan after-hours.
- [ ] **File:** taruh `assets/pricelist.jpg`, isi `file` di rule pricelist → balasan kekirim sebagai gambar + caption.
- [ ] Restart bot → **TIDAK** minta scan QR ulang. Reboot VM → bot nyala sendiri.

---

## 8. Troubleshooting

| Gejala | Penyebab & Solusi |
|---|---|
| Bot balas template yang salah | Urutan RULES — yang pertama match menang. Reorder (spesifik di atas, umum di bawah). |
| "DP berapa" malah dibales pricelist | Pindahkan rule `dp` di atas `pricelist`. |
| Minta scan QR tiap restart | Folder `auth_info` kehapus/ke-gitignore lalu clone kosong. Jangan hapus `auth_info`. |
| Bot connect tapi diam | Cek keyword match (lowercase+contains), cek `pm2 logs`, pastikan pesan PERSONAL. |
| Bales dobel | Pastikan cuma 1 proses (`pm2 status`). |
| Notif admin nggak masuk | Cek format `ADMIN_NOTIFY_JID` = `62...@s.whatsapp.net` (pakai 62, bukan 0; tanpa spasi). |
| Bot ke-pause padahal admin belum bales | Admin mungkin kirim dari device lain ke kontak itu — itu by design (dianggap handoff). |
| After-hours note muncul di jam kerja | Cek `TIMEZONE_OFFSET` (WIB=7) & jam server. |
| File pricelist nggak kekirim | Cek path `file` di config & file ada di `assets/`. Kalau bukan jpg/png/webp/pdf → dikirim sebagai dokumen biasa. |
| `loggedOut` | Admin unlink device. Hapus `auth_info`, start ulang, scan QR baru. |

---

## 9. v2 (NANTI — jangan dikerjakan sekarang)

- **Lead capture ke Supabase:** simpan `{ nomor, nama, topik, pesan_awal, timestamp }` ke tabel `leads` → nyambung ke Tetra Ops.
- **Parsing jawaban klien:** deteksi acara/tanggal/lokasi dari balasan, simpan terstruktur.
- **Catch-all sapaan kontak baru.**
- **Notif lewat Telegram** (alternatif notif WA).
- **Dashboard mini** lihat leads.

v2 ditangani sesi terpisah setelah v1 stabil di produksi.

---

## 10. Catatan Penting

1. **Risiko banned nyata** walau rendah untuk pola reply-only. Bot ini di nomor Tetra existing sesuai keputusan.
2. **JANGAN** pakai buat blast/broadcast ke nomor asing — itu pemicu banned tercepat. Pertahankan reply-only.
3. **Isi placeholder `[ISI: ...]`** di template DP & lokasi dengan info asli (nominal, rekening, area) sebelum dipakai.
4. **Backup folder `auth_info`** sesekali.
