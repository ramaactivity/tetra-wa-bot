# Spec Endpoint Ketersediaan — Tetra Ops → WA Bot

Dokumen handover buat tim Tetra Ops (Kiro). Tujuan: WA Bot bisa cek
ketersediaan unit photobooth secara otomatis sebelum konfirmasi/booking ke customer.

---

## Konteks bisnis

- Tetra Photobooth punya **3 unit**. Max 3 acara **bersamaan**.
- Yang mengunci unit = **jam pakai photobooth**, BUKAN durasi acara.
  - Contoh: wedding berlangsung 07:00–15:00, tapi photobooth cuma dipesan
    11:00–13:00 → unit cuma terkunci di slot 11:00–13:00.
- Dalam 1 hari bisa >3 event, asal jam photobooth-nya nggak numpuk di 3 unit yang sama.
- Window photobooth = `jam mulai + durasi paket` (paket 2 jam, 3 jam, unlimited X jam).

---

## Endpoint

```
GET /api/availability?date=2026-07-11&start=11:00&end=13:00
Authorization: Bearer <token>
```

| Param | Wajib | Keterangan |
|---|---|---|
| `date` | ya | Tanggal acara, format `YYYY-MM-DD` |
| `start` | ya | Jam mulai photobooth, `HH:mm` |
| `end` | ya | Jam selesai photobooth = `start` + durasi paket. Kalau paket belum dipilih, bot kirim durasi default 2 jam. |
| `city` | opsional | Kota/venue acara, dipakai buat nentuin buffer (lihat di bawah) |

### Response

```json
{
  "date": "2026-07-11",
  "window": "11:00-13:00",
  "units_total": 3,
  "units_free": 2,
  "available": true,
  "conflicts": [
    { "project": "Bramastha & Adindya", "time": "10:00-13:00", "city": "Bogor" }
  ]
}
```

---

## Logika perhitungan (di sisi Tetra Ops)

1. Ambil semua event di `date` beserta **jam pakai photobooth**-nya (bukan jam acara).
2. Untuk tiap event existing, perluas window-nya jadi `[start − buffer, end + buffer]`
   (lihat tabel buffer).
3. Hitung **max unit yang kepakai bersamaan** yang overlap dengan window `[start, end]` yang diminta.
4. `units_free = 3 − max_overlap`.
5. `available = units_free > 0`.

### Buffer antar acara (unit yang sama)

Buffer = waktu bongkar + perjalanan + pasang. Tergantung jarak lokasi 2 acara berurutan:

| Kondisi lokasi | Buffer |
|---|---|
| Venue sama | 2 jam |
| Beda venue, kota sama | 2–3 jam |
| Beda kota (Jabodetabek) | 3 jam |
| Luar kota / jauh | 4 jam |

> Heuristik berbasis field kota/venue. Upgrade ke travel-time API (Google Maps)
> opsional di masa depan kalau butuh presisi.

---

## Catatan integrasi

- Logika overlap + buffer **ditaruh di sisi Tetra Ops** (paling deket sama skema data event).
- Bot cuma **konsumsi** endpoint ini (read-only). Nggak ada write dari bot untuk tahap ini.
- Perlu **token auth** (Bearer) buat bot. Mohon di-generate & dikasih ke tim bot.
- Tahap berikutnya (opsional): endpoint create booking biar bot bisa bantu proses booking otomatis.
