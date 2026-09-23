# Perbaikan Logika Admin Hand-off Tetra WA Bot

> **Untuk Hermes:** Gunakan skill subagent-driven-development untuk mengimplementasikan rencana ini tugas demi tugas.

**Tujuan:**
Memperbaiki mekanisme `[ADMIN_HANDOFF]` agar:
1. Menghilangkan *false positive* (bot terpicu handoff saat admin membalas manual).
2. Memastikan ringkasan percakapan yang dikirim ke admin mencakup konteks yang cukup.
3. Memastikan *state* `paused` di Supabase benar-benar tersinkronisasi sehingga bot tidak kembali membalas saat admin sedang dalam sesi handoff.

**Arsitektur:**
Menggunakan Supabase (`bot_paused_contacts`) sebagai *source of truth* untuk status handoff, dan memperbaiki deteksi `fromMe` di `messages.js` agar sinkron dengan Supabase.

**Stack:**
Node.js, Baileys, Supabase.

---

### Tugas 1: Audit Sinkronisasi `fromMe` & `paused`
**Objektif:** Memastikan balasan manual admin langsung memicu `upsertPause` di Supabase, bukan sekadar memanggil `setPause` (lokal).

**File:**
- `src/handlers/messages.js`

**Langkah:**
1. Periksa `handleMessage` di `src/handlers/messages.js` (baris 43-51).
2. Ubah pemanggilan `setPause` (lokal) menjadi `await supa.upsertPause(jid, new Date(Date.now() + HANDOFF_AI_MS).getTime(), 'admin')`.
3. Verifikasi apakah `upsertPause` sudah menangani *case* admin (balas manual).

### Tugas 2: Pembenahan Ringkasan Handoff
**Objektif:** Membuat ringkasan percakapan yang dikirim ke admin lebih informatif.

**File:**
- `src/lib/notify.js`
- `src/handlers/messages.js`

**Langkah:**
1. Modifikasi `notifyAdmin` untuk menerima array pesan (riwayat singkat).
2. Pastikan pesan berisi 3-5 pesan terakhir pelanggan + timestamp.

### Tugas 3: Verifikasi State `paused`
**Objektif:** Memastikan `isPaused(jid)` selalu sinkron dengan Supabase di awal `handleMessage`.

**File:**
- `src/handlers/messages.js`

**Langkah:**
1. Tambahkan pengecekan `await supa.fetchPausedContacts()` di awal `handleMessage` atau secara periodik agar `isPaused` lokal tidak "basi".
2. Test bot membalas setelah admin handoff (seharusnya diam).

---

**Validasi:**
1. Jalankan tes *handoff* menggunakan `test-notify` via Supabase.
2. Cek apakah pesan admin (dari WA HP) terdeteksi `fromMe` dan memicu `upsertPause`.

**Risiko:**
- Sinkronisasi Supabase yang gagal bisa membuat bot terus membalas padahal admin sudah ambil alih.
- *Rate limit* Supabase (minimalisir jumlah query).
