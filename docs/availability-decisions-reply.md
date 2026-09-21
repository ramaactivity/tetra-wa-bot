# Jawaban Tim Bot — 4 Keputusan Endpoint Ketersediaan

Balasan untuk *"Handover BALIK — Endpoint Ketersediaan (Tetra Ops → WA Bot)"*.
Terima kasih sudah meluruskan asumsi sebelum bangun endpoint. Semua keputusan kami
ambil **konservatif** (utamakan jangan over-promise ke customer). Detail di bawah.

---

## Keputusan final

| # | Keputusan | Jawaban tim bot | Catatan |
|---|---|---|---|
| **1** | Booking `draft`/tentatif ikut mengunci unit? | **YA, ikut mengunci** | Setuju rekomendasi kalian. Double-booking lebih bahaya daripada bot bilang "aku cek dulu". Admin tetap konfirmasi akhir (kami mulai dari mode admin-confirm). |
| **2** | Buffer default saat kota tak diketahui? | **3 jam** | Setuju. Aman karena venue terdata selama ini seputar Bogor/Jabodetabek. |
| **3** | Event existing yang jam-nya kosong (2 kasus)? | **Tahan 1 unit seharian** (konservatif) | Setuju. Dampak kecil (cuma 2 kasus). |
| **4** | Env token & siapa simpan | **`AVAILABILITY_API_TOKEN`**, Tetra Ops yang generate | Kirim token via channel aman (bukan repo). Kami simpan di env VPS bot. |

---

## Status di sisi data (kota kosong) — kami catat

Soal `venue_city` kosong di ~84% event: kami **terima konsekuensinya** (buffer jalan pakai
default 3 jam untuk sekarang). Setuju bahwa upgrade Google Maps API **percuma** sebelum
kualitas data kota dibenahi. Saran kalian buat mulai isi `venue_city` (idealnya koordinat)
di tiap booking **kami dukung** — itu pekerjaan sisi Tetra Ops, kami nggak blok fitur ini
karenanya.

## Soal field tambahan di response

Boleh banget kalau kalian **tambah** `buffer_applied_minutes` dan `assumptions` di response.
Itu justru membantu — bot bisa kasih disclaimer halus ke customer kalau hitungannya pakai
default (mis. *"perkiraan ya kak, nanti tim kami konfirmasi final"*). Kontrak inti
request/response tetap sama seperti spec awal.

## Catatan alur (penting biar ekspektasi sama)

- **Tahap awal kami pakai mode admin-confirm**: bot bilang ke customer "aku cekin slotnya ya"
  lalu admin yang finalisasi. Jadi walau endpoint sudah live, jawaban availability **belum
  langsung diumbar otomatis** ke customer sampai kami yakin akurasinya.
- **Auto-answer ke customer** (bot langsung bilang "available/penuh") menyusul setelah
  kami uji endpoint-nya stabil.
- **Create booking dari bot (write)** — setuju ditunda, fase berikutnya, diskusi terpisah.

Silakan lanjut implementasi. Begitu endpoint + token siap, kami sambungkan sisi bot.

— Tim Bot
