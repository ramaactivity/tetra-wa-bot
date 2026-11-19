# Pola sambutan otomatis akun bisnis (bukan balasan manusia)

Dibaca `src/lib/prospekWa.js` saat bot mulai (audit Bruno t_951a932f N6). Satu pola per baris diawali `- `, berupa potongan regex
(huruf besar/kecil diabaikan); teks setelah ` #` = keterangan. Pesan masuk yang cocok dihitung BALASAN OTOMATIS: tidak mereset hitungan
"pesan kita belum dibalas manusia" dan tidak dianggap lead membalas. Tambah pola baru di sini (lalu restart bot), bukan di kode.

- thank you for (contacting|reaching)
- thank ?you for your (message|chat)
- terima ?kasih (sudah|telah|atas) (menghubungi|pesan)
- we will (reply|get back)
- selamat datang di
- wilujeng sumping
- (mohon|silakan) (kirim|isi)\b.{0,40}(tanggal|nama|data)
- mohon dibantu (untuk )?(di)?isi # Agave Hall 19 Nov: "list plan ini mohon dibantu untuk diisi dulu ya"
- ^\s*\*?form data # hanya di AWAL pesan (template); "ini form datanya kak" dari manusia tidak boleh ikut
- please let us know how we can # Maxima Production
- may i have your name
- (not here|away) right now
- out of (the )?office
- sedang (cuti|umroh|umrah)
- jam (operasional|kerja) kami
- sedang (tidak|di luar)
