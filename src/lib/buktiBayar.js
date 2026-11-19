// Bukti transfer klien → draft pembayaran di Tetra Ops (rancangan Hermes t_5c804dee; keputusan Rama 19 Nov, tetra-ops DR-055).
// - Klien kirim gambar bukti → POST /api/bot/pembayaran/draft sumber "client_only" (menunggu konfirmasi Rama di Tetra Ops).
// - Rama membalas konfirmasi di chat klien ("DPnya sudah masuk…") → kirim ULANG draft yang sama (pesan_id_wa sama) sumber "admin_wa",
//   auto_confirm=true. Gerbang (nominal, rekening tujuan, sisa tagihan, keyakinan ≥ 0,8) diperiksa Tetra Ops; gagal = tetap menunggu.
//   Nomor WA Tetra hanya dipegang Rama (jawaban Rama 19 Nov), jadi pesan manusia dari nomor itu = persetujuan Rama.
// - Isian bukti dibaca cs-wa (vision, tugas baca-pesan-galeri → `bukti`) dan hanya USULAN; Rama bisa mengganti semuanya di Tetra Ops.
// - Bot TIDAK menulis pembukuan, tidak membuat kuitansi, tidak mengirim apa pun ke klien.
// - Gagal kirim → gambar disimpan di data/bukti-bayar/ dan dicoba ulang pada kiriman berikutnya (bukti tidak boleh hilang).
const fs = require('fs');
const path = require('path');
const { loadJson, saveJson, nomorDari } = require('./store');
const { postOps } = require('./availability');

const DIR = path.join(__dirname, '..', '..', 'data', 'bukti-bayar');
const FILE = path.join(__dirname, '..', '..', 'data', 'bukti-bayar.json');
const semua = loadJson(FILE); // pesan_id_wa -> { jid, t, body (tanpa gambar), gambar: path|null, status, gerbang }
const simpan = () => saveJson(FILE, semua);
const JENDELA_MS = 3 * 24 * 3600e3; // konfirmasi admin menaikkan bukti dari 3 hari terakhir

async function kirim(id) {
  const e = semua[id];
  const body = { ...e.body };
  if (e.gambar) {
    try { body.gambar = fs.readFileSync(e.gambar).toString('base64'); } catch { /* sudah terkirim sebelumnya */ }
  }
  const r = await postOps('/api/bot/pembayaran/draft', body);
  if (!r.ok) {
    console.error(`[bukti-bayar] ${id} (${body.sumber}): HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)} — disimpan, dicoba ulang nanti`);
    return false;
  }
  if (e.gambar) { try { fs.unlinkSync(e.gambar); } catch { /* biarkan */ } e.gambar = null; }
  e.status = r.json.status || 'menunggu';
  e.gerbang = r.json.gerbang || [];
  e.terkirim = body.sumber;
  simpan();
  console.log(`[bukti-bayar] ${id} (${body.sumber}): ${e.status}${e.gerbang.length ? ` — gerbang gagal: ${e.gerbang.join(', ')}` : ''}`);
  return true;
}

// Kiriman yang tertunda (Tetra Ops mati/belum siap) ikut dicoba setiap ada kiriman baru.
async function cobaUlang() {
  for (const [id, e] of Object.entries(semua)) if (e.terkirim !== e.body.sumber) await kirim(id);
}

// msg = pesan gambar klien; bukti = keluaran cs-wa (lihat.bukti) atau null kalau belum terbaca.
async function dariKlien(jid, msg, bukti, gambarB64) {
  const id = msg.key?.id;
  if (!id || semua[id]) return;
  for (const [k, e] of Object.entries(semua)) if (Date.now() - e.t > 30 * 24 * 3600e3 && e.terkirim === e.body.sumber) delete semua[k];
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  const gambar = path.join(DIR, `${id}.jpg`);
  fs.writeFileSync(gambar, Buffer.from(gambarB64, 'base64'), { mode: 0o600 });
  const b = bukti || {};
  const angka = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Math.round(Number(x)) : null); // tak terbaca = null, bukan 0
  semua[id] = {
    jid, t: Date.now(), gambar,
    body: {
      pesan_id_wa: id, wa_jid: jid, client_wa: nomorDari(jid), nama_klien: msg.pushName || null, invoice_no: null,
      nominal: angka(b.nominal), nama_pengirim: b.nama_pengirim || null, bank_pengirim: b.bank_pengirim || null,
      bank_tujuan: b.bank_tujuan || null, waktu_transfer: b.waktu_transfer || null,
      waktu_pesan: new Date((Number(msg.messageTimestamp) || Date.now() / 1000) * 1000).toISOString(),
      confidence: Number.isFinite(Number(b.confidence)) ? Number(b.confidence) : null, teks_mentah: b.teks_mentah || null,
      sumber: 'client_only', auto_confirm: false, gambar_mime: msg.message?.imageMessage?.mimetype || 'image/jpeg',
    },
  };
  simpan();
  await cobaUlang();
}

// Rama membalas konfirmasi di chat klien: naikkan HANYA bukti terakhir chat ini. Kalau bukti terakhir sudah disetujui, tidak ada yang
// naik: konfirmasi kedua ("transfernya sudah kami terima ya") tidak boleh menyetujui bukti lama yang mungkin kiriman dobel (DP tercatat 2×).
async function konfirmasiAdmin(jid) {
  // Terakhir = t terbesar; seri (milidetik sama) → yang disimpan belakangan (urutan sisip objek).
  const [id, e] = Object.entries(semua).filter(([, x]) => x.jid === jid && Date.now() - x.t < JENDELA_MS)
    .reduce((akhir, x) => (!akhir || x[1].t >= akhir[1].t ? x : akhir), null) || [];
  if (!id) { console.log(`[bukti-bayar] ${jid.split('@')[0]}: konfirmasi admin tanpa gambar bukti di chat ini — catat manual di Tetra Ops`); return; }
  if (e.body.sumber === 'admin_wa' || ['disetujui', 'tercatat', 'dibatalkan'].includes(e.status)) {
    console.log(`[bukti-bayar] ${id}: bukti terakhir sudah ${e.status || 'dikonfirmasi'}, konfirmasi admin berikutnya tidak menaikkan bukti lain`);
    return;
  }
  semua[id].body = { ...semua[id].body, sumber: 'admin_wa', auto_confirm: true };
  simpan();
  await cobaUlang();
}

module.exports = { dariKlien, konfirmasiAdmin, _semua: semua };
