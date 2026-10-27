// Registry lampiran [KIRIM: kunci] + pengirimnya. Dipakai balasan chat (handlers/messages.js) dan follow-up
// (followupEngine.js) supaya penanda yang sama mengirim file yang sama di dua jalur (audit 27 Okt: follow-up lead
// menulis "ini profil kerja sama rekanan" tanpa PDF karena jalur follow-up hanya mengenal pricelist).
const path = require('path');
const { sendDocument } = require('./sender');
const { rememberBotMsg } = require('./botMessages');
const deliveryLog = require('./deliveryLog');
const { getRiwayat, tambahRiwayat } = require('./store');
const { ASSETS_DIR } = require('./pricelist');

// Lampiran yang boleh diminta AI lewat penanda [KIRIM: kunci]. Dikirim setelah
// balasan teks, sekali per percakapan (label dicek di riwayat; format label sama
// dengan booking.kirimKatalog supaya katalog tidak terkirim dua kali).
// `pernah` = pola nama file di riwayat: file yang sudah dikirim admin manual
// ("(admin) [kirim dokumen: ...]") atau lewat lampiran lain tidak dikirim ulang.
const LAMPIRAN = {
  backdrop: { file: 'BACKDROP TETRA.pdf', label: 'backdrop basic', pernah: /BACKDROP TETRA/i,
    caption: 'Pilihan backdrop basic Tetra, sudah termasuk di paket.' },
  katalog: { file: 'KATALOG DESAIN FRAME TETRA.pdf', label: 'katalog desain frame', pernah: /KATALOG DESAIN/i,
    caption: 'Contoh desain frame Tetra. Belum ada yang cocok? Desain custom juga bisa, gratis.' },
  // PDF panduan juga memuat halaman layout, jadi layout tidak dikirim kalau panduan sudah.
  layout: { file: 'LAYOUT PHOTOBOOTH.pdf', label: 'layout photobooth', pernah: /LAYOUT (PHOTOBOOTH|&)|layout photobooth|panduan ukuran/i,
    caption: 'Bentuk & pilihan layout cetak Tetra: 2R photostrip, 4R, dan Polaroid.' },
  // Ilustrasi ukuran asli 2R / 4R / Polaroid berdampingan dengan skala sama + patokan KTP (Rama 22 Okt 2026).
  format: { file: 'FORMAT CETAK TETRA.jpg', label: 'ilustrasi format cetak', pernah: /FORMAT CETAK TETRA|ilustrasi format cetak/i,
    caption: 'Ini perbandingan ukuran asli 2R, 4R, dan Polaroid ya, Kak.' },
  // Profil 1 halaman: edisi klien & edisi rekanan (Rama 22 Okt 2026; sumber HTML di repo HERMES docs/ilustrasi-tetra).
  profil: { file: 'PROFIL TETRA PHOTOBOOTH.pdf', label: 'profil tetra', pernah: /PROFIL TETRA|profil tetra/i,
    caption: 'Profil singkat Tetra Photobooth ya, Kak.' },
  rekanan: { file: 'REKANAN TETRA PHOTOBOOTH.pdf', label: 'profil rekanan', pernah: /REKANAN TETRA PHOTOBOOTH|profil rekanan/i,
    caption: 'Ringkasan kerja sama rekanan Tetra ya, Kak.' },
  // Ilustrasi skema rekanan (komisi 10% vs potongan 10%), disetujui Rama 8 Okt 2026.
  skema: { file: 'SKEMA REKANAN TETRA.png', label: 'skema rekanan', pernah: /SKEMA REKANAN|skema rekanan/i,
    caption: 'Biar gampang kebayang, ini gambaran dua skema kerja sama rekanan Tetra 😊' },
  // Ilustrasi cetakan foto + sleeve (bingkai kertas) + contoh asli 2R; desain asli di assets/sleeve-desain/ (Rama 22 Okt).
  sleeve: { file: 'SLEEVE TETRA.jpg', label: 'ilustrasi sleeve', pernah: /SLEEVE TETRA|ilustrasi sleeve/i,
    caption: 'Ini gambaran cetakan foto dan sleeve-nya ya, Kak.' },
  panduan: { file: 'LAYOUT & PANDUAN UKURAN.pdf', label: 'panduan ukuran', pernah: /PANDUAN UKURAN/i,
    caption: 'Panduan ukuran canvas untuk desain frame sendiri (2R 1200×3600 px, 4R 2400×3600 px, Polaroid 1800×2400 px per lembar).' },
};

/** Kunci [KIRIM: x] yang dikenal (pricelist punya jalur sendiri lewat kirimPricelist). */
function kunci(teks) {
  return [...new Set([...String(teks || '').matchAll(/\[KIRIM:\s*(\w+)\s*\]/gi)].map((m) => m[1].toLowerCase()))]
    .filter((k) => LAMPIRAN[k] || k === 'pricelist');
}

/** Kirim lampiran (selain pricelist) yang belum pernah terkirim di percakapan ini. Mengembalikan kunci yang terkirim. */
async function kirimLampiran(sock, jid, daftar, jalur) {
  const terkirimKini = [];
  for (const k of daftar) {
    const l = LAMPIRAN[k];
    if (!l) continue;
    if (k === 'layout' && daftar.includes('panduan')) continue; // panduan sudah memuat layout
    const tanda = `[kirim PDF ${l.label}]`;
    // Hanya catatan pengiriman file yang dicek, bukan kalimat obrolan ("ini panduan ukurannya").
    const terkirim = getRiwayat(jid).flatMap((p) => String(p.content).match(/\[kirim (PDF|dokumen:)[^\]]*\]/gi) || []);
    if (terkirim.some((c) => c.includes(tanda) || l.pernah.test(c))) continue;
    const sent = await sendDocument(sock, jid, path.join(ASSETS_DIR, l.file), l.caption);
    rememberBotMsg(sent);
    deliveryLog.track(sent, `${k}→${jalur}`);
    tambahRiwayat(jid, 'assistant', `${tanda}\n${l.caption}`);
    terkirimKini.push(k);
  }
  return terkirimKini;
}

module.exports = { LAMPIRAN, kunci, kirimLampiran };
