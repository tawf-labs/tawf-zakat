# ADR-0043: Laporan Periode Disusun dari Data Aplikasi, Pembukuan sebagai Pembanding Opsional

- Status: Accepted — 2026-10-02, keputusan pengguna. Rancangan alur ada di [dokumen desain](../design/laporan-periode-ux.md).
- Related: ADR-0021, ADR-0022, ADR-0024, ADR-0039, ADR-0042.

Bagian *Bukti & laporan* saat ini meminta staf mengisi dua sisi rekonsiliasi (klaim dan sumber) lewat JSON, spreadsheet, atau stream internal, lalu mengetik identitas laporan, versi, ID paket pendahulu, dan angka klaim berkunci teknis (`CLAIM.ZAKAT.ON`). Staf operasional Lazismu tidak mengenal istilah itu. Padahal sejak pilot berjalan di aplikasi, realisasi penyaluran dan biaya operasional sudah tercatat di database.

Keputusan:

1. **Laporan periode disusun dari data aplikasi.** Staf memilih periode, aplikasi membekukan data yang sudah tercatat hingga batas waktu laporan, dan angka laporan diambil dari snapshot itu. Staf tidak mengunggah atau menempel data yang sudah ada di aplikasi.
2. **Rekap pembukuan bendahara menjadi pembanding opsional.** Bila bendahara punya rekap pembukuan (Excel menurut template), rekap itu dapat diunggah di langkah *Bandingkan dengan pembukuan*, dan selisihnya ditampilkan dalam bahasa biasa. Tanpa unggahan, laporan tetap dapat diterbitkan, dan laporan menyatakan bahwa angkanya tidak dibandingkan dengan pembukuan.
3. **Cakupan tahap pertama: realisasi penyaluran dan biaya operasional**, yang sudah punya sumber internal. Penghimpunan (kontribusi Rupiah) menyusul setelah sumber internalnya dibangun.
4. **Istilah teknis tidak tampil di alur utama.** Commitment, digest, SHA-256, manifest, berkas provenance, pemulihan registry, dan unduhan paket pemeriksaan dipindah ke bagian *Detail teknis* yang tertutup secara bawaan. Identitas laporan, versi, dan pendahulu koreksi diisi aplikasi.

Model data dan registry tidak berubah: snapshot beku, paket laporan, vonis validator, serta pengesahan lembaga dan validator untuk penerbitan (ADR-0021, ADR-0022) tetap menjadi dasar. Yang berubah adalah sisi mana yang diisi aplikasi dan apa yang diperlihatkan kepada staf.

Alternatif mewajibkan unggahan pembukuan tidak dipilih karena menghambat lembaga yang belum punya rekap rapi dan menambah langkah tanpa nilai bila pembukuannya sendiri bersumber dari aplikasi. Alternatif menghapus rekonsiliasi dari MVP tidak dipilih karena perbandingan dengan pembukuan bendahara adalah pemeriksaan yang bernilai bagi audit Lazismu pusat.

Konsekuensi:

- Rekonsiliasi antar-lembaga dan sumber tempel tetap didukung API, tetapi tidak menjadi alur staf.
- Laporan tanpa pembanding pembukuan harus menyatakannya dalam batas pemeriksaan, agar tidak terbaca sebagai sudah direkonsiliasi.
- Penerbitan laporan dari alur baru tetap menghasilkan kunci periode biaya operasional (ADR-0042, #129), karena sumbernya adalah stream realisasi internal.
