# DEPLOY.md — Runbook deploy Tetra WA Bot

Panduan ringkas untuk deploy perubahan ke bot WA yang jalan 24/7 di VPS.
**Kredensial deploy (VPS_HOST / VPS_USER / VPS_SSH_KEY / VPS_PROJECT_DIR) ada di
`.env.local` lokal** (gitignored). **Runtime env bot di server** ada di
`/root/tetra-wa-bot/.env` (loader `index.js` baca `.env.local` dulu lalu `.env`).
File ini cuma prosedur.

> ⚠️ **3 aturan wajib:**
> 1. **JANGAN** pernah copy/sync `auth_info/` atau `data/` ke server — bisa logout sesi WhatsApp / menimpa state. Hanya deploy file kode (`src/`, `config.js`, dll).
> 2. **JANGAN** jalankan bot di lokal (`npm start`) — bentrok dengan sesi linked-device live di VPS, bisa nge-logout.
> 3. Reply RULES live di Supabase (`bot_rules`), **bukan** `config.js`. Ubah keyword/balasan lewat dashboard, bukan deploy kode.

---

## 0. Sekali di awal tiap sesi terminal

```bash
cd "/Users/masrampc/Desktop/TETRA WA BOT"
set -a; source .env.local; set +a   # muat VPS_HOST, VPS_USER, VPS_SSH_KEY, dll.
```

Singkatan SSH (dipakai di bawah):
```bash
SSH="ssh -i $VPS_SSH_KEY $VPS_USER@$VPS_HOST"
```

---

## 1. Cek kondisi bot

```bash
$SSH "pm2 status"                       # online? berapa kali restart?
$SSH "pm2 logs $PM2_APP --lines 30"     # log terakhir (Ctrl-C buat keluar)
$SSH "grep -c 'Bad MAC' /root/.pm2/logs/tetra-bot-error.log"   # noise sesi (burst saat restart = normal)
```

---

## 2. Deploy 1 file (alur paling umum)

```bash
F=src/lib/notify.js                     # ← ganti ke file yang kamu ubah

# (opsional) cek syntax lokal dulu
node -c "$F"

# backup file lama di server (jaga-jaga rollback)
$SSH "cp $VPS_PROJECT_DIR/$F $VPS_PROJECT_DIR/$F.bak-\$(date +%Y%m%d-%H%M)"

# upload → cek syntax di server → restart
scp -i "$VPS_SSH_KEY" "$F" "$VPS_USER@$VPS_HOST:$VPS_PROJECT_DIR/$F"
$SSH "cd $VPS_PROJECT_DIR && node -c $F && pm2 restart $PM2_APP"
```

## 2b. Deploy beberapa file sekaligus

```bash
FILES="src/lib/supa.js src/lib/deliveryLog.js src/lib/sender.js"
for F in $FILES; do node -c "$F" || { echo "SYNTAX FAIL: $F"; break; }; done
for F in $FILES; do
  $SSH "cp $VPS_PROJECT_DIR/$F $VPS_PROJECT_DIR/$F.bak-\$(date +%Y%m%d-%H%M)"
  scp -i "$VPS_SSH_KEY" "$F" "$VPS_USER@$VPS_HOST:$VPS_PROJECT_DIR/$F"
done
$SSH "cd $VPS_PROJECT_DIR && for F in $FILES; do node -c \$F || exit 1; done && pm2 restart $PM2_APP"
```

---

## 3. Verifikasi setelah deploy

```bash
# tunggu ~10 dtk, lalu pastikan link WA 'open'
$SSH "pm2 logs $PM2_APP --out --lines 40 --nostream | grep -E 'tersambung & siap|putus'"
$SSH "pm2 status"   # status=online, restart count naik 1 (bukan loop)
```

**Catatan normal:** sesaat setelah restart ada burst error `Bad MAC` (replay pesan grup offline dari 1 kontak sesi rusak) — membludak ~1-2 menit lalu **berhenti sendiri**. Bukan masalah.

---

## 4. Tes notif ke admin (tanpa HP)

Picu balasan tes lewat command queue Supabase (dijalankan proses bot yang hidup — tanpa koneksi WA kedua):

```bash
$SSH "cd $VPS_PROJECT_DIR && node -e '
require(\"dotenv\").config();
if(typeof globalThis.WebSocket===\"undefined\")globalThis.WebSocket=require(\"ws\");
const {createClient}=require(\"@supabase/supabase-js\");
const s=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
s.from(\"bot_commands\").insert({command:\"test-notify\",status:\"pending\"}).then(({error})=>{console.log(error?error.message:\"INSERTED\");process.exit(0)});
'"
```

Lalu lihat tanda-terima di log (muncul `📬 ... ✓✓ TERKIRIM` / `👁️ DIBACA`):
```bash
$SSH "pm2 logs $PM2_APP --out --lines 50 --nostream | grep '📬'"
```

---

## 5. Rollback (kalau deploy bermasalah)

```bash
F=src/lib/notify.js
# lihat backup yang ada
$SSH "ls -t $VPS_PROJECT_DIR/$F.bak-* | head"
# pulihkan yang terbaru
$SSH "cp \$(ls -t $VPS_PROJECT_DIR/$F.bak-* | head -1) $VPS_PROJECT_DIR/$F && cd $VPS_PROJECT_DIR && node -c $F && pm2 restart $PM2_APP"
```

---

## 6. Hal sensitif (butuh izin / hati-hati)

- **Reset sesi enkripsi** (hapus file di `auth_info/` buat hilangkan delay "Waiting"): tindakan destruktif di prod, backup dulu + restart. Lihat memory `tetra-bot-deployment` untuk daftar file & prosedur. Jangan asal hapus.
- **Re-link device** (logout + scan QR ulang): paling tuntas tapi bot offline sebentar & butuh akses fisik HP bot `6285213526630`.
- **Ubah skema Supabase / dashboard**: itu repo `tetra-ops` milik Kiro — koordinasi, jangan ALTER tabel sepihak. Lihat `TETRA_OPS_REPLY_STATUS_HANDOVER.md`.

---

## Referensi cepat

| Hal | Nilai |
|-----|-------|
| VPS | `157.15.124.114` (DomaiNesia, Ubuntu 24.04, root) |
| Project di server | `/root/tetra-wa-bot` (BUKAN repo git → deploy via scp) |
| Runtime env server | `/root/tetra-wa-bot/.env` (loader baca `.env.local` lalu `.env`) |
| pm2 app | `tetra-bot` |
| WA bot (linked device) | `6285213526630` |
| Admin notif JID | `6289611384767@s.whatsapp.net` |
| Supabase ref | `rdrkzwesykebhibcwcsj` |
| Cek ketersediaan | endpoint `tetra-ops-lac.vercel.app/api/availability`; token `AVAILABILITY_API_TOKEN` di `.env` server |
| Error log | `/root/.pm2/logs/tetra-bot-error.log` |
| Kredensial deploy (lokal) | `.env.local` di mesin dev (`VPS_*`, gitignored) |
