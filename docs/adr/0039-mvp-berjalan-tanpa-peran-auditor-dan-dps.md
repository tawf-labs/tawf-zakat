# ADR-0039: MVP Berjalan tanpa Peran Auditor dan DPS

- Status: Accepted — 2026-10-01, keputusan pengguna setelah wawancara Lazismu Tangsel ([catatan kasar](../research/LAZISMU.md)).
- Related: ADR-0006, ADR-0021, ADR-0022, ADR-0028, ADR-0038.
- Diubah 2026-10-02 (keputusan pengguna): menu *Temuan pemeriksaan* dihapus dari sidebar ruang kerja agar UI MVP seminimal mungkin. Komponen, API, kontrak, dan tes temuan serta atestasi auditor tetap dipertahankan dan dapat dimunculkan lagi; bagian lain yang menyebut auditor belum diubah.

MVP produk dapat dijalankan lembaga tanpa ada pengguna yang memegang peran auditor ataupun DPS. Alur MVP terdiri dari program bantuan, pengajuan penyaluran (penyusun → pemeriksa → pemberi persetujuan menurut SOP, ADR-0028), realisasi, dan penerbitan laporan periode. Tidak ada langkah dalam alur itu yang menunggu auditor atau DPS. Penerbitan laporan cukup dengan pengesahan lembaga dan pengesahan layanan validator (ADR-0022); kedudukan DPS ditetapkan ADR-0038. Di Lazismu Tangsel, program dijalankan bendahara, DPS hanya memberi pendapat, dan audit dilakukan atas instruksi Lazismu pusat setelah kegiatan dengan memeriksa struk, kuitansi, bukti transfer, dan rekening koran. Audit tersebut tetap berlangsung di luar aplikasi dan tidak menjadi syarat MVP.

Fitur auditor yang sudah dibangun tetap dipertahankan sebagai fitur opsional, tidak dihapus dan tidak disembunyikan: atestasi versi laporan, mandat auditor, temuan pemeriksaan beserta tanggapan dan tindak lanjutnya. Pilihan ini dipilih dibanding menghapus fitur karena penghapusan menyentuh registry, laporan, dan pengujian, padahal tidak ada yang bergantung padanya, serta karena audit lembaga, misalnya dari Lazismu pusat, nanti dapat memakainya. Menyembunyikan fitur dari UI juga tidak dipilih; jika tampilan auditor ternyata membingungkan pengguna MVP, penyembunyian dapat dilakukan kemudian tanpa mengubah keputusan ini.

Konsekuensi:

- Pekerjaan MVP tidak boleh menambahkan langkah yang mensyaratkan auditor atau DPS. Fitur baru tidak boleh menganggap atestasi sudah ada; laporan tanpa atestasi tetap sah terbit dengan keadaan `NOT_EXAMINED`.
- Demo dan materi produk MVP tidak menampilkan auditor atau DPS sebagai pelaku wajib. Klaim pemisahan kewenangan sebelum dan sesudah kegiatan (ADR-0006) tetap benar sebagai kemampuan, bukan prasyarat.
- Jalur vault USDC lama tetap memiliki `SHARIA_SUPERVISOR_ROLE` dan `AUDITOR_ROLE` di kontrak. Jalur itu bukan bagian alur MVP.
