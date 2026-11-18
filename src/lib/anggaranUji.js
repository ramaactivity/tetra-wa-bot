// Anggaran uji AI Sumopod untuk Tetra Photobooth (Rama 18 Nov 2026: mekanisme anti-boros saldo).
//
// Aturan:
// 1. Otorisasi: HANYA Hermes (tetra-wa-bot) yang boleh menjalankan uji AI. Claude support dilarang memanggil AI langsung.
// 2. Saldo: Uji AI ditolak bila sisa saldo Sumopod <= $1.00.
// 3. Batas harian:
//    - uji_balasan: maks 15 panggilan/hari
//    - regresi (lengkap dengan AI): maks 1x/hari (13 panggilan)
//    - total panggilan AI uji: maks 30 panggilan/hari
// 4. Gratis dulu: regresi wajib diarahkan ke `npm run regresi -- --cepat` bila tanpa perubahan kode/aturan utama.

const fs = require('fs');
const path = require('path');

const FILE_ANGGARAN = process.env.ANGGARAN_UJI_FILE || path.join(__dirname, '..', '..', 'data', 'anggaran-uji.json');
const FILE_SALDO = process.env.SALDO_SUMOPOD_FILE || path.join(process.env.HOME || '/home/ubuntu', '.hermes', 'profiles', 'tetra-wa-bot', 'saldo-sumopod.json');

// uji_balasan_cron (temuan Hermes t_769ccf81): cron "Belajar cepat CS Mintet" (4×/hari) menguji ±12× per putaran → ±48/hari, 3× jatah
// harian, sehingga uji sebelum rilis selalu kehabisan. Cron tetap boleh membuktikan pelajaran (Rama 16 Nov), tapi maks 4/hari dan
// tidak memakan jatah uji_balasan pemanggil lain (terpakai.uji_balasan = selain cron); total_panggilan tetap untuk semua.
const BATAS = {
  uji_balasan: 15,
  uji_balasan_cron: 4,
  regresi: 1,
  total_panggilan: 30,
  min_saldo_usd: 1.00
};

function tanggalHariIni() {
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 10);
}

function bacaAnggaran() {
  const today = tanggalHariIni();
  let data = {
    tanggal: today,
    batas: BATAS,
    terpakai: { uji_balasan: 0, regresi: 0, total_panggilan: 0 },
    riwayat: []
  };
  try {
    if (fs.existsSync(FILE_ANGGARAN)) {
      const f = JSON.parse(fs.readFileSync(FILE_ANGGARAN, 'utf-8'));
      if (f && f.tanggal === today) {
        data = f;
      }
    }
  } catch (e) {
    // jika korup, mulai baru hari ini
  }
  return data;
}

function simpanAnggaran(data) {
  try {
    const dir = path.dirname(FILE_ANGGARAN);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FILE_ANGGARAN, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('[anggaranUji] Gagal menyimpan anggaran:', e.message);
  }
}

function cekSaldo() {
  try {
    if (!fs.existsSync(FILE_SALDO)) return { ok: true, saldo: null };
    const st = JSON.parse(fs.readFileSync(FILE_SALDO, 'utf-8'));
    if (!st || !st.dasar || !st.sampel || !st.sampel.length) return { ok: true, saldo: null };
    const spend = st.sampel[st.sampel.length - 1][1];
    const sisa = st.dasar.saldo - (spend - st.dasar.spend);
    return { ok: sisa > BATAS.min_saldo_usd, sisa: Math.max(0, sisa) };
  } catch (e) {
    return { ok: true, saldo: null };
  }
}

function namaProfil() {
  const langsung = process.env.HERMES_SESSION_PROFILE || process.env.HERMES_PROFILE;
  if (langsung) return langsung;
  // Sesi cron (gateway) mengirim HERMES_SESSION_PROFILE KOSONG dan tidak punya HERMES_PROFILE
  // (diukur 18 Nov: HERMES_CRON_SESSION=1, HERMES_SESSION_PROFILE=, HERMES_HOME=.../profiles/tetra-wa-bot).
  // Tanpa fallback ini semua cron tercatat "hermes:agent:cron" dan tidak bisa dibedakan per profil.
  const m = /\/profiles\/([^/]+)\/?$/.exec(process.env.HERMES_HOME || '');
  return m ? m[1] : '';
}

function cekOtorisasi() {
  // Boleh jika dijalankan oleh Hermes agent, sesi Rama manual, atau flag --paksa
  if (process.argv.includes('--paksa') || process.env.RAMA_MANUAL === '1') {
    return { ok: true, pemanggil: 'rama_manual' };
  }
  // Identitas dari env yang Hermes injeksikan ke tiap perintah (gateway/session_context.py, tools/environments/base_session_env.py):
  // cron yang jalan di proses gateway tidak membawa HERMES_PROFILE, jadi dulu tercatat "hermes:agent" (temuan Hermes t_769ccf81).
  const profil = namaProfil();
  if (process.env.HERMES_AGENT === 'true' || profil) {
    const cron = process.env.HERMES_CRON_SESSION === '1';
    return { ok: true, pemanggil: `hermes:${profil || 'agent'}${cron ? ':cron' : ''}`, cron };
  }
  return {
    ok: false,
    alasan: 'Claude / pemanggil non-Hermes DILARANG menjalankan uji AI Sumopod (Rama 18 Nov: 100% Hermes). Claude hanya support kode/alat. Serahkan pengujian ke agent Hermes via Kanban.'
  };
}

function periksaDanCatat(jenis, detail = {}) {
  // 1. Otorisasi pemanggil
  const oto = cekOtorisasi();
  if (!oto.ok) {
    throw new Error(oto.alasan);
  }

  // 2. Saldo Sumopod
  const sld = cekSaldo();
  if (!sld.ok) {
    throw new Error(`Saldo AI Sumopod menipis (sisa ±$${sld.sisa.toFixed(2)} <= $${BATAS.min_saldo_usd.toFixed(2)}). Uji AI ditahan agar bot WA klien tidak berhenti.`);
  }

  // 3. Batas kuota harian
  const data = bacaAnggaran();
  const bebanPanggilan = jenis === 'regresi' ? (detail.jumlah_kasus || 13) : 1;
  // Hitungan per pemanggil disimpan terpisah, bukan dihitung dari `riwayat` (riwayat dipotong 50 entri → hitungan bocor).
  data.terpakai_per_pemanggil = data.terpakai_per_pemanggil || {};
  const milik = data.terpakai_per_pemanggil[oto.pemanggil] || { uji_balasan: 0, regresi: 0, total_panggilan: 0 };
  if (jenis === 'uji_balasan' && oto.cron && milik.uji_balasan >= BATAS.uji_balasan_cron) {
    throw new Error(`Jatah uji AI pemanggil otomatis (cron) habis (${milik.uji_balasan}/${BATAS.uji_balasan_cron} per hari). ` +
      'Jangan uji ulang; tulis temuannya sebagai usulan.');
  }

  if (jenis === 'uji_balasan' && !oto.cron && data.terpakai.uji_balasan >= BATAS.uji_balasan) {
    throw new Error(`Anggaran harian uji_balasan habis (${data.terpakai.uji_balasan}/${BATAS.uji_balasan} kali). Kumpulkan uji untuk besok.`);
  }

  if (jenis === 'regresi' && data.terpakai.regresi >= BATAS.regresi) {
    throw new Error(`Anggaran harian regresi AI habis (${data.terpakai.regresi}/${BATAS.regresi} kali). Gunakan uji gratis tanpa AI: 'npm run regresi -- --cepat'.`);
  }

  if (data.terpakai.total_panggilan + bebanPanggilan > BATAS.total_panggilan) {
    throw new Error(`Anggaran harian total panggilan AI uji terlampaui (${data.terpakai.total_panggilan} + ${bebanPanggilan} > ${BATAS.total_panggilan} panggilan). Sisa anggaran: ${BATAS.total_panggilan - data.terpakai.total_panggilan} panggilan.`);
  }

  // Catat pemakaian
  if (jenis === 'uji_balasan' && !oto.cron) data.terpakai.uji_balasan += 1;
  if (jenis === 'regresi') data.terpakai.regresi += 1;
  data.terpakai.total_panggilan += bebanPanggilan;
  if (jenis === 'uji_balasan' || jenis === 'regresi') milik[jenis] += 1;
  milik.total_panggilan += bebanPanggilan;
  data.terpakai_per_pemanggil[oto.pemanggil] = milik;

  data.riwayat.push({
    t: new Date().toISOString(),
    jenis,
    pemanggil: oto.pemanggil,
    beban: bebanPanggilan,
    detail
  });

  // Simpan riwayat maksimal 50 entri terakhir
  if (data.riwayat.length > 50) data.riwayat = data.riwayat.slice(-50);

  simpanAnggaran(data);
  return {
    ok: true,
    terpakai: data.terpakai,
    sisa_panggilan: BATAS.total_panggilan - data.terpakai.total_panggilan
  };
}

function status() {
  const data = bacaAnggaran();
  const sld = cekSaldo();
  return {
    tanggal: data.tanggal,
    terpakai: data.terpakai,
    batas: BATAS,
    sisa_total: BATAS.total_panggilan - data.terpakai.total_panggilan,
    sisa_saldo_usd: sld.sisa
  };
}

module.exports = {
  BATAS,
  cekOtorisasi,
  cekSaldo,
  bacaAnggaran,
  periksaDanCatat,
  status
};
