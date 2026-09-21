# Tetra WA Bot

Auto-reply WhatsApp bot untuk **Tetra Photobooth**. Membalas otomatis chat awal calon
klien berdasarkan kata kunci (pricelist, DP, lokasi, ketersediaan tanggal), plus
auto-pause saat admin handle manual, notif lead ke admin, jam kerja, & kirim pricelist
sebagai file.

Dibangun dengan [Baileys](https://github.com/WhiskeySockets/Baileys) sebagai **linked
device** ke nomor Tetra — nomor tetap aktif & bisa dipakai manual di HP admin.

> ⚠️ Jalur unofficial. **Reply-only** ke chat personal masuk. JANGAN dipakai untuk
> blast/broadcast — itu pemicu banned tercepat.

---

## Struktur Project

```
.
├── index.js              # entry point (tipis) → memanggil startBot()
├── config.js             # ✏️ RULES + semua setting (file utama yang diedit admin)
├── package.json
├── assets/               # taruh pricelist.jpg / pricelist.pdf di sini
├── data/                 # state runtime: cooldown.json, pause.json (auto, gitignored)
├── auth_info/            # session WhatsApp (auto, gitignored — JANGAN dihapus)
└── src/
    ├── bot.js            # setup socket, koneksi, QR, auto-reconnect
    ├── handlers/
    │   └── messages.js   # pipeline pesan masuk: auto-pause, match rule, kirim, notif
    └── lib/
        ├── store.js      # persistensi cooldown & pause
        ├── rules.js      # extractText, findRule, jam kerja, buildReply
        ├── botMessages.js# lacak id pesan bot (bedakan dari admin manual)
        ├── sender.js     # kirim human-like (read → delay → composing → kirim)
        └── notify.js     # notif lead ke admin
```

---

## Jalanin Lokal

```bash
npm install
npm start            # atau: node index.js
```

Saat pertama jalan, QR ASCII muncul di terminal. Scan dari **HP Tetra**:
**WhatsApp → Setelan → Perangkat Tertaut → Tautkan Perangkat**.

Setelah muncul `✅ Bot tersambung & siap`, bot mulai mendengarkan pesan masuk.
Session disimpan di `auth_info/` → restart **tidak** minta scan ulang.

---

## Konfigurasi (`config.js`)

Semua diatur di [config.js](config.js):

- **`RULES`** — daftar aturan balasan. Tiap rule: `{ name, keywords[], reply, file? }`.
  - **Urutan = prioritas.** Rule pertama yang cocok menang. Taruh rule **spesifik**
    (dp, lokasi, booking) di **atas**, rule **umum** (pricelist) di **bawah** — supaya
    "DP berapa" kena rule `dp`, bukan `pricelist`.
  - Matching: **contains + case-insensitive**.
  - ✏️ **Isi placeholder `[ISI: ...]`** di rule `dp` & `lokasi` (nominal DP, rekening,
    area, biaya transport) sebelum dipakai produksi.
- **`COOLDOWN_HOURS`** (default 12) — template yang sama tak dikirim 2× ke kontak sama
  dalam rentang ini. Template **beda** tetap boleh.
- **`PAUSE_HOURS`** (default 24) — setelah admin bales manual, bot diam ke kontak itu.
- **`ADMIN_NOTIFY_JID`** — nomor WA admin untuk notif lead, format
  `62xxxx@s.whatsapp.net` (pakai `62`, bukan `0`; tanpa spasi). Kosongkan = matikan notif.
- **Jam kerja** — `BUSINESS_START_HOUR` / `BUSINESS_END_HOUR` / `TIMEZONE_OFFSET` (WIB=7).
  Di luar jam, balasan ditambah `AFTER_HOURS_NOTE`.

### Kirim pricelist sebagai file
1. Taruh file di `assets/`, mis. `assets/pricelist.jpg` atau `assets/pricelist.pdf`.
2. Isi field `file` di rule `pricelist`: `file: 'assets/pricelist.jpg'`.
3. Gambar (`.jpg/.png/.webp`) dikirim sebagai foto; `.pdf` sebagai dokumen; caption =
   teks balasan. Kalau `file` kosong/tak ada → kirim teks biasa.

---

## Deploy 24/7 (VPS DomaiNesia)

Bot live di VPS **DomaiNesia `157.15.124.114`** (Ubuntu 24.04, user `root`), jalan
pakai **pm2** sebagai app `tetra-bot`. Server **bukan repo git** — kode disalin via
`scp`/`rsync`. Update rutin: lihat **[DEPLOY.md](DEPLOY.md)**. Setup awal (sekali):

```bash
# di VM Ubuntu, Node 20
mkdir -p /root/tetra-wa-bot
# salin project dari mesin dev (TANPA node_modules/auth_info/data):
#   rsync -av --exclude node_modules --exclude auth_info --exclude data ./ root@157.15.124.114:/root/tetra-wa-bot/
cd /root/tetra-wa-bot
npm install
# buat .env (SUPABASE_*, AVAILABILITY_API_TOKEN, dll — lihat .env.example)
node index.js          # scan QR sekali dari HP bot, lalu Ctrl+C

npm install -g pm2
pm2 start index.js --name tetra-bot
pm2 save
pm2 startup            # jalankan command yang di-print → auto-nyala saat reboot
```

Perintah berguna: `pm2 logs tetra-bot` · `pm2 restart tetra-bot` · `pm2 status`.

Bot **outbound-only** → tak perlu buka port inbound.

---

## Environment & secrets (`.env.local`)

Bot memuat env dari **`.env.local`** (didahulukan) lalu **`.env`** saat start
([index.js](index.js)). Di server saat ini file-nya **`.env`** (`/root/tetra-wa-bot/.env`).
Keduanya di-gitignore → harus dibuat/diedit manual di server. Lihat
[.env.example](.env.example) untuk daftar lengkap.

| Var | Wajib? | Fungsi |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | untuk integrasi DB | Rules live + lead capture dari Supabase. Kosong → pakai `config.js`. |
| `AVAILABILITY_API_TOKEN` | untuk cek slot | Token endpoint ketersediaan Tetra Ops. Kosong → notif admin tanpa baris ketersediaan. |
| `AVAILABILITY_API_URL` | opsional | Override URL endpoint (default = produksi). |
| `HEALTHCHECK_URL` | opsional | Ping uptime monitor saat connect. |

> Cek aktif/tidak lewat `pm2 logs tetra-bot`: cari `[supa] Supabase terhubung`
> (DB ON). Kalau muncul `OFF`, env Supabase belum kebaca.

## Update / redeploy

Server **bukan repo git** — deploy = salin file kode via `scp` lalu `pm2 restart`
(jangan pernah sentuh `auth_info/` & `data/`). Runbook lengkap (backup, rollback,
verifikasi, tes notif) ada di **[DEPLOY.md](DEPLOY.md)**. Ringkas:

```bash
scp <file> root@157.15.124.114:/root/tetra-wa-bot/<file>
ssh root@157.15.124.114 'cd /root/tetra-wa-bot && node -c <file> && pm2 restart tetra-bot'
pm2 logs tetra-bot   # verifikasi: Supabase terhubung + tak ada error
```

> Nambah var env baru? Tambahkan juga ke `/root/tetra-wa-bot/.env` di server, lalu
> `pm2 restart tetra-bot --update-env`.

---

## Catatan

- **Backup `auth_info/`** sesekali. Kalau terhapus → harus scan QR ulang.
- Kalau `loggedOut` (admin unlink device): hapus `auth_info/`, start ulang, scan QR baru.
- Untuk debug, ubah logger di [src/bot.js](src/bot.js) dari `'silent'` → `'info'`.
- Checklist testing lengkap ada di `tetra-wa-bot-handover.md` Section 7.
