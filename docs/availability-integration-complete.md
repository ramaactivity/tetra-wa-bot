# Integrasi Selesai — WA Bot ↔ Endpoint Ketersediaan (untuk tim Kiro / Tetra Ops)

Konfirmasi balik untuk dokumen *"API Ketersediaan Unit — SIAP DIPAKAI"*.
Singkatnya: **endpoint sudah disambungkan ke bot, live di produksi, dan terverifikasi.** ✅
Disiapkan dari sisi tim bot, 2026-06-26.

---

## 1. Status: DONE & LIVE

- Bot WA di VPS produksi (`157.15.124.114`) sudah memanggil
  `GET /api/availability` dan memproses responsnya.
- `AVAILABILITY_API_TOKEN` sudah dipasang di `.env` server bot. Auth jalan
  (request tanpa/again token salah → `401` seperti spec).
- Tidak ada perubahan kontrak yang dibutuhkan dari sisi kalian. Kontrak request/response
  dipakai apa adanya.

## 2. Hasil verifikasi (dari runtime produksi & test langsung)

| Skenario | Hasil |
|---|---|
| Hari kosong | `units_free: 3`, `available: true`, `conflicts: []` ✅ |
| Hari ramai (mis. 7 Jun 2026) | `units_free: 1` + daftar `conflicts` benar (Waisak, Bramastha) ✅ |
| Tanpa `city` | `assumptions` berisi disclaimer buffer default 3 jam ✅ |
| Token salah/kosong | `401` ✅ |
| `end` ≤ `start` / format salah | `400` ✅ |

Field `buffer_applied_minutes` & `assumptions` **kami pakai** — berguna buat kasih
disclaimer halus ke customer. Tidak ada field tambahan yang kami butuhkan untuk saat ini.

## 3. Cara bot memakainya sekarang (mode admin-confirm)

Sesuai saran kalian (*"auto-answer ke customer setelah yakin stabil"*):

- Saat customer kasih **tanggal + jam photobooth**, bot memanggil endpoint dan
  **menyisipkan status slot ke notifikasi admin** (mis. `📅 Ketersediaan 🟢 11:00-13:00: 2/3 unit KOSONG`).
- Customer **belum** mendapat jawaban available/penuh otomatis — bot cuma bilang
  *"aku cekin slotnya ya kak"*, lalu **admin yang finalisasi**.
- **Auto-answer ke customer** akan dinyalakan menyusul, setelah kami yakin akurasinya di lapangan.

## 4. Yang ada di sisi kalian (pengingat, bukan blocker)

- **Isi `venue_city`** (idealnya koordinat) di tiap booking. Saat ini ~84% kosong →
  mayoritas perhitungan pakai buffer default 3 jam. Selama venue masih seputar
  Bogor/Jabodetabek ini aman, tapi akurasi buffer baru maksimal kalau kota terisi rutin.

## 5. Fase berikutnya (akan kami ajukan terpisah kalau sudah waktunya)

- **Auto-answer ke customer** — kabar saat kami aktifkan.
- **Create booking dari bot (write)** — setuju ini fase tersendiri & butuh diskusi
  soal validasi & cegah double-booking. Kami buka obrolannya nanti, belum sekarang.

Terima kasih — endpoint-nya bersih & langsung jalan. 🙌

— Tim Bot
