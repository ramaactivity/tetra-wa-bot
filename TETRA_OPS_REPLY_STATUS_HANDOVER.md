# Handover ke Kiro — Status Tanda-Terima Balasan di Dashboard Leads

**Konteks:** Bot WA Tetra punya masalah "Waiting for this message" (pesan nyangkut karena
sesi enkripsi). Sudah diperbaiki di sisi bot (retry-receipt dilayani). Untuk transparansi,
bot sekarang **memantau status tiap balasan ke customer** (terkirim/dibaca) dan **menulisnya
ke Supabase**. Tinggal ditampilkan di dashboard.

## Yang SUDAH dikerjakan bot (repo `tetra-wa-bot`, live di VPS)

Setiap balasan auto-reply ke customer dipantau via event Baileys `messages.update`. Saat
status berubah, bot meng-**update baris lead TERBARU** kontak itu di tabel `whatsapp_bot_leads`:

| Kolom | Tipe | Isi |
|-------|------|-----|
| `reply_status` | `text` | `'delivered'` (✓✓ sampai HP) → `'read'` (👁️ dibaca) |
| `reply_status_at` | `timestamptz` | waktu status terakhir berubah |

Bot mencocokkan lead lewat `wa_jid` (ambil lead `created_at` paling baru untuk kontak itu).
Kode: `src/lib/deliveryLog.js` → `supa.updateLatestLeadStatus(waJid, status)` di `src/lib/supa.js`.

Penulisan ini **fault-tolerant**: kalau kolomnya belum ada, bot diam saja (tidak error, tidak
crash). Jadi begitu kolom dibuat, data langsung mulai masuk — tanpa perlu restart bot.

## Yang perlu Kiro kerjakan (repo `tetra-ops`)

### 1. Migration: tambah 2 kolom ke `whatsapp_bot_leads`
```sql
alter table public.whatsapp_bot_leads
  add column if not exists reply_status     text,
  add column if not exists reply_status_at  timestamptz;
```
(Nilai `reply_status`: `NULL` = belum ada info / belum terkirim, `'delivered'`, `'read'`.)

### 2. UI: tampilkan di menu Leads
Saran badge di tiap baris lead:
- `reply_status = 'read'`   → 👁️ **Dibaca** (hijau)
- `reply_status = 'delivered'` → ✓✓ **Terkirim** (abu)
- `reply_status = NULL`     → — (atau "Menunggu", kalau mau)

Opsional: tooltip `reply_status_at` (mis. "Dibaca 26 Jun 10:47").

## Catatan penting
- `reply_status = 'read'` hanya muncul kalau **read receipt customer ON**. Kalau OFF, status
  berhenti di `'delivered'` — itu normal, dan `'delivered'` sudah cukup sbg bukti pesan sampai.
- Status menempel ke **lead terbaru** per kontak (heuristik wa_jid). Cukup untuk indikator;
  kalau nanti butuh presisi per-pesan, bisa ditambah kolom `reply_msg_id` (koordinasi dulu).
- Notif ke admin TIDAK ditulis ke leads (cuma balasan ke customer), jadi tak mengotori data.

— Disiapkan dari sisi bot, 2026-06-26.
