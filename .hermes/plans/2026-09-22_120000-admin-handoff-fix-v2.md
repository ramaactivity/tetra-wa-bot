# Perbaikan Logika Admin Hand-off (Revisi)

> **Untuk Hermes:** Gunakan skill subagent-driven-development untuk mengimplementasikan rencana ini tugas demi tugas.

**Tujuan:**
Memperbaiki mekanisme `[ADMIN_HANDOFF]` agar:
1. Menghilangkan *false positive* saat admin membalas manual.
2. Sinkronisasi status `paused` (Supabase) dengan AI Agent agar bot tahu admin sedang dalam sesi handoff tanpa kehilangan riwayat chat.
3. Menambahkan mekanisme "panggil balik" (hand-back) agar admin bisa mengembalikan kontrol ke AI Agent setelah selesai.

**Arsitektur:**
- **Status Sinkronisasi:** Balasan admin (via HP) akan otomatis meng-update `bot_paused_contacts` di Supabase. AI Agent akan mengecek *flag* ini sebelum membalas.
- **Konteks:** AI tetap mencatat *chat history* bahkan saat *paused*, agar transisi kembali ke AI mulus (tidak kehilangan konteks).

---

### Tugas 1: Sinkronisasi Admin Handoff ke Supabase
**Objektif:** Saat admin membalas manual, bot mendeteksi `fromMe` dan segera `upsertPause` ke Supabase dengan flag khusus agar bot tidak membalas.

**File:**
- `src/handlers/messages.js`

**Langkah:**
1. Update logika `if (msg.key.fromMe)` untuk memanggil `supa.upsertPause(jid, new Date(Date.now() + 60*60*1000).getTime(), 'admin')`.
2. Pastikan `isPaused` tetap mengizinkan bot membaca pesan untuk *logging* ke Supabase/riwayat tapi mencegah pengiriman balasan AI.

### Tugas 2: Mekanisme Handoff Kembali (Hand-back)
**Objektif:** Admin bisa mengembalikan kendali ke AI Agent via perintah atau status di Supabase.

**File:**
- `src/handlers/messages.js`
- `src/lib/supa.js`

**Langkah:**
1. Tambahkan pengecekan status di Supabase (misal: tombol 'Done' di dashboard atau command khusus admin di chat).
2. Jika admin ingin selesai, `markCommand` atau hapus status pause di Supabase.
3. Bot otomatis kembali membalas AI setelah pause berakhir atau di-reset.

### Tugas 3: Verifikasi Riwayat AI saat Handoff
**Objektif:** Pastikan riwayat AI tidak dihapus/reset saat admin mengambil alih.

**File:**
- `src/handlers/messages.js`

**Langkah:**
1. Hapus pemanggilan `lupakanRiwayat(jid)` di `registerMessageHandler` agar AI tetap punya memori percakapan saat admin selesai.

---
**Validasi:**
- Cek log saat admin membalas: `Diabaikan dari [JID]: kontak ini di-pause`.
- Tes kembalinya kendali ke AI setelah pause habis.
