# ADR-0026: Cakupan Desain Pengajuan sampai Pemeriksaan

- Status: Accepted — Q1/Q2, diperinci Q20/Q22 sesi `grill-with-docs` pada 2026-09-15.
- Related: ADR-0020, ADR-0021, ADR-0022.

Desain ZKT diperluas untuk membahas alur pengajuan sebelum bantuan disalurkan sampai pemeriksaan, dengan BAZNAS kabupaten/kota sebagai persona operasional awal dan kecocokan untuk LAZ diuji berikutnya. Pengguna menerima arah ini karena form pengajuan, masukan data, dan identitas pengguna saat ini belum mencerminkan kebutuhan kerja lembaga.

Realisasi penyaluran dan laporan periode tetap dibedakan, serta pengelolaan dana tetap menjadi tanggung jawab lembaga. Ini memperluas cakupan desain dari fokus pilot bukti dan rekonsiliasi pada ADR-0020. Alternatif mempertahankan pembahasan hanya pada bukti realisasi dan laporan periode tidak dipilih karena tidak menjawab masalah pengajuan sebelum penyaluran.

Q20 menetapkan alur baru berfokus pada pencatatan bantuan IDR/barang dan bukti pembayaran yang dilaksanakan lembaga di luar aplikasi. Tombol “Catat realisasi” tidak mengirim dana. Jalur vault USDC tetap terpisah; keputusan ini tidak menghapus atau memigrasikan jalur lama. Q22 memilih pagu program sebagai referensi dengan peringatan, sementara lembaga memastikan ketersediaan dana. Batas bantuan disetujui per pengajuan tetap ditegakkan. Reservasi anggaran lintas pengajuan dan perbankan langsung menjadi kemungkinan pengembangan berikutnya; angka pagu tidak diklaim sebagai saldo bank terverifikasi.

Rincian model program/penerima, titik awal pengajuan, alur persetujuan, impor, dan sumber identitas akun dibahas dalam [catatan riset dan wawancara](../research/0005-pengajuan-penyaluran-dan-ux-grilling.md). Persona BAZNAS kabupaten/kota merupakan acuan desain awal, belum validasi kebutuhan lembaga mitra tertentu.
