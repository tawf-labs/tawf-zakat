# ADR-0022: Registry Bukti Terpisah dan Riwayat Koreksi Laporan

- Status: Accepted — Q6–Q9 pada sesi `grill-with-docs`.
- Date: 2026-09-08.
- Decider: pengguna, melalui penerimaan rekomendasi putaran Q6–Q8, kemudian Q9 tentang dua pengesahan penerbitan.
- Related: ADR-0020 (pilot), ADR-0021 (paket bukti, pengesahan, akses), ADR-0018 (penolakan draf).

Pilot memakai **registry bukti laporan yang terpisah dari vault**. Koreksi terhadap laporan yang sudah diterbitkan menghasilkan versi baru yang menunjuk versi sebelumnya, mencatat alasan dan pengesahnya, serta mempertahankan bukti versi lama. Hasil rekonsiliasi yang menemukan selisih tetap disimpan sebagai bukti pemeriksaan dengan status yang jelas; draf yang ditolak validator tetap tidak dapat ditandatangani sebagai laporan lolos.

## Trade-off

- **Versi baru dibanding menimpa laporan:** hubungan koreksi memerlukan penyimpanan dan antarmuka riwayat, tetapi pemeriksa tetap dapat mengetahui apa yang dinyatakan pada tiap penerbitan dan bagaimana angka berubah.
- **Menyimpan temuan dibanding hanya menyimpan hasil lolos:** penyimpanan tidak boleh menjadi tanda bahwa isi disetujui. Keuntungannya, hasil terpenting dari rekonsiliasi—selisih yang ditemukan—tetap dapat diperiksa dan ditindaklanjuti.
- **Registry terpisah dibanding memperluas vault:** pilot memperoleh identitas paket, pengesahan, dan kaitan atestasi tanpa menambah tanggung jawab custody. Integrasi dan deployment registry tersendiri diperlukan; registry ini tidak mengubah otorisasi atau pembagian pool pada vault lama.

## Batas perilaku

Pencatatan bukti, penerbitan laporan yang lolos pemeriksaan, dan atestasi auditor adalah tindakan berbeda. Sebuah paket dapat memuat temuan yang belum diselesaikan. Keberadaan catatan di blockchain membuktikan pencatatan dan pengesahan yang diperiksa registry, bukan kebenaran pembayaran bank atau opini audit otomatis.

Atestasi harus mengacu pada versi paket yang diperiksa. Pengesahan atau atestasi atas versi lama tidak otomatis berlaku untuk versi koreksinya. Riwayat versi dan pemeriksaan tetap dapat ditelusuri.

Temuan pada `ZakatProtocolL1` tetap terbuka untuk alur vault yang menggunakannya. Tidak ada penghapusan kontrak lama, perpindahan dana, reset data, atau deployment yang dilakukan melalui keputusan ini.

## Gerbang penerbitan — Q9 diterima

Penerbitan laporan memerlukan **pengesahan lembaga dan pernyataan `LOLOS` bertanda tangan layanan validator yang berwenang atas paket yang sama**. Registry memeriksa kedua kewenangan dan pengikatan paket, termasuk pada panggilan kontrak langsung. Pengesahan untuk sekadar mencatat bukti tidak dapat dipakai sebagai izin penerbitan. Atestasi auditor tetap tindakan terpisah.

Alternatif yang dipertimbangkan adalah pemeriksaan vonis hanya pada backend/UI dan registry cukup menerima pengesahan lembaga. Dua pengesahan dipilih agar pemanggilan langsung juga memerlukan pernyataan validator. Konsekuensinya, penerbitan bergantung pada ketersediaan layanan validator; layanan yang salah atau kuncinya disalahgunakan dapat menyatakan hasil palsu. Pengesahan lembaga tetap diperlukan.

Kontrak memeriksa pernyataan bertanda tangan, bukan menjalankan ulang seluruh perhitungan atau memastikan pembayaran bank benar. Pihak berwenang dapat memeriksa ulang hasil dari snapshot. Keputusan ini menerima batas kepercayaan tersebut; keberadaan dua signature bukan bukti komputasi tanpa kepercayaan atau dua opini audit independen.

[Rancangan registry](../design/period-evidence-registry.md) merangkai keputusan yang diterima, kebutuhan pengikatan signature, dan detail yang perlu diselesaikan dalam spec. [Catatan 0004](../research/0004-smart-contract-project-fit-grilling.md) menyimpan bukti kode dan riwayat keputusan. Keputusan arsitektur ini belum merupakan implementasi gerbang penerbitan.
