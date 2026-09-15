# ADR-0028: Persetujuan menurut SOP Lembaga dan Realisasi Bertahap

- Status: Accepted — Q7–Q9 sesi `grill-with-docs`, 2026-09-15.
- Related: ADR-0026, ADR-0027, ADR-0021/0022.
- Partially supersedes: ADR-0006 untuk persetujuan DPS sebagai gerbang universal desain baru; pemisahan auditor setelah kegiatan tetap berlaku.

Desain awal mendukung bantuan uang dan barang kepada penerima terdaftar. Fasilitas kolektif seperti pembangunan sumur menjadi kemungkinan perluasan berikutnya. Pengajuan melalui amil penyusun, pemeriksa administrasi/kelayakan, lalu pemberi persetujuan lembaga; penyusun tidak boleh menyetujui pengajuannya sendiri. Jabatan pemberi persetujuan serta keterlibatan pengawas syariah mengikuti SOP lembaga. Auditor tetap memeriksa setelah kegiatan.

Alternatif mempertahankan DPS sebagai satu-satunya gerbang setiap pengajuan tidak dipilih. Contoh SOP BAZNAS Bengkalis menjelaskan seleksi administrasi, survei/verifikasi, lalu keputusan pleno pimpinan. Karena jabatan dan mandat lokal perlu dibedakan dari fungsi aplikasi, desain mengikuti pemetaan kewenangan lembaga tanpa mengklaim satu susunan berlaku nasional. Lihat [bukti sumber dan batasnya](../research/0005-pengajuan-penyaluran-dan-ux-grilling.md#tambahan-riset-persetujuan-pada-contoh-baznas-kabupaten).

Pengajuan dapat direalisasikan bertahap. Catatan menghubungkan penerima, jumlah uang/barang, dan bukti per penerima atau kelompok penyerahan yang dapat ditelusuri; tampilan membedakan disetujui, tersalurkan, dan sisa. Adanya satu realisasi tidak menutup seluruh pengajuan. Alternatif satu status selesai untuk seluruh batch akan menghilangkan sisa kewajiban dan mengaburkan angka laporan.

Keputusan ini mengubah desain domain, bukan kewenangan deployment lama secara otomatis. Integrasi vault harus disesuaikan sebelum diklaim memenuhi model baru; akses ruang kerja tetap tidak menggantikan kewenangan penandatanganan registry. Q15/Q17 memilih revisi, penutupan sisa, serta pengesahan pencatatan keputusan lembaga melalui [ADR-0029](0029-proposal-revisions-and-recorded-institutional-decisions.md). Identitas pelaku ditetapkan melalui [ADR-0030](0030-personal-operators-and-institutional-endorsement-accounts.md). Batas nominal mandat serta protokol autentikasi/pengesahan masih harus diperinci dalam spesifikasi.
