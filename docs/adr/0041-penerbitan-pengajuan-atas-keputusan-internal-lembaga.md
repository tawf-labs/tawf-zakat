# ADR-0041: Penerbitan Pengajuan atas Keputusan Internal Lembaga

- Status: Accepted — 2026-10-01, keputusan pengguna setelah wawancara Lazismu Tangsel ([catatan kasar](../research/LAZISMU.md)).
- Related: ADR-0038, ADR-0039, ADR-0040.
- Partially supersedes: ADR-0028 dan ADR-0029 sebagai alur bawaan. Pemeriksaan di aplikasi dan pengesahan bertanda tangan oleh akun yang berbeda dari penyusun kini menjadi opsi kebijakan lembaga, bukan satu-satunya jalan menuju status disetujui.

ADR-0028/0029 mengandaikan keputusan penyaluran diambil di dalam aplikasi: amil menyusun, pemeriksa menyatakan siap, lalu pemberi persetujuan yang bukan penyusun menandatangani keputusan beserta berkas SK/berita acara. Lazismu Tangsel tidak bekerja seperti itu. Program diputuskan lewat rapat kepengurusan, dijalankan bendahara, dan persetujuan berjalan melalui alur internal lembaga di luar sistem apa pun. Bagi mereka, mengajukan di aplikasi berarti menyiapkan program yang langsung siap menerima donasi dan disalurkan. Jika pemeriksaan dan tanda tangan tetap diwajibkan, pengguna harus mengulang di aplikasi keputusan yang sudah diambil, atau pengajuan tertahan di antrean yang tidak pernah dibuka siapa pun.

Keputusan:

1. **Kebijakan lembaga `decisionOutsideApp` menentukan jalannya, dan bawaannya `true`.** Amil yang memegang mandat `PREPARE_PROPOSALS` menerbitkan pengajuan lengkap (`POST /proposals/:id/publish`), dan pengajuan langsung berstatus `APPROVED` dengan hak bantuan yang disetujui sama dengan yang diajukan.
2. **Rujukan keputusan internal wajib diisi**, misalnya "Rapat pengurus 28 Sep 2026" atau nomor surat, beserta tanggalnya. Unggah berkas tidak diwajibkan. Aplikasi mencatat keputusan ini dengan dasar `RECORDED_OUTSIDE_APP`: operator dan mandat penerbit tercatat, tanpa akun pengesah, tanda tangan, maupun berkas SK.
3. **Kelengkapan tetap sama dengan pengajuan biasa.** Daftar penerima lengkap, berita acara verifikasi (ADR-0040), pembekuan versi beserta dokumennya, dan peringatan bantuan berulang dijalankan oleh kode yang sama dengan pengajuan untuk pemeriksaan.
4. **Jalur pemeriksaan tetap terbuka untuk semua lembaga.** Penerbitan langsung ditolak bagi lembaga dengan `decisionOutsideApp = false`. Kebijakan tersimpan yang sudah ada tetap memutus di aplikasi; hanya lembaga tanpa kebijakan tersimpan yang mendapat bawaan baru.

Alternatif menghapus alur pemeriksaan dan pengesahan sepenuhnya tidak dipilih karena BAZNAS kabupaten/kota (riset 0005) memutus lewat pleno yang dapat dicatat dan ditandatangani di aplikasi. Alternatif menerbitkan tanpa rujukan keputusan tidak dipilih karena audit Lazismu pusat membutuhkan pegangan siapa yang memutuskan dan kapan.

Konsekuensi:

- **Pemisahan tugas di aplikasi hilang pada mode ini.** Satu akun dapat menyusun sekaligus menerbitkan. Pengendaliannya berpindah ke proses internal lembaga. Yang dapat dibuktikan aplikasi hanyalah rujukan yang dikutip, akun penerbit, versi yang dibekukan, dan sidik hak bantuan, bukan bahwa rapat itu benar-benar memutuskan isi tersebut.
- Tab antrean pemeriksa disembunyikan bagi lembaga mode ini, dan form menampilkan "Terbitkan Pengajuan" sebagai pengganti "Ajukan untuk Pemeriksaan".
- **Belum tercakup:** revisi setelah terbit, pembatalan, dan penutupan sisa masih melalui keputusan bertanda tangan oleh pemegang `APPROVE_DECISIONS`. Lembaga mode ini memerlukan jalur setara (rujukan internal + alasan) sebelum langkah-langkah itu bisa dipakai tanpa akun pengesah.
