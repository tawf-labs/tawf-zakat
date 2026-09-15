# Pengajuan penyaluran dan UX — bahan grill-with-docs

- Tanggal pemeriksaan: 2026-09-15, Asia/Jakarta.
- Status: selesai — Q1–Q23 dan rangkuman pemahaman bersama diterima pengguna pada 2026-09-15. Keputusan arsitektur dicatat dalam ADR-0026–0030 dan keputusan interaksi di bawah. [Rancangan layar dan alur](../design/pengajuan-penyaluran-ux.md) mendasari [spec implementasi #86](https://github.com/tawf-labs/tawf-zakat/issues/86), yang diterbitkan dengan label `ready-for-agent`. Catatan riset ini bukan SOP lembaga mitra.
- Snapshot kode yang diperiksa: `0f9705e`; inspeksi source, tanpa pengujian browser atau pembacaan RPC.
- Metode: sumber primer BAZNAS dan LAZ; dokumen PDF yang gagal dibaca melalui browser diunduh dan diekstrak lokal. Tidak menggunakan contoh dokumen pihak ketiga sebagai dasar persyaratan.
- Batas: contoh BAZNAS daerah berlaku pada lembaga/program yang menerbitkannya. Dokumen SiMBA di bawah terbit 2018; bukti historis pola kerja, bukan konfirmasi fitur produksi SiMBA September 2026.

## 1. Pengajuan perorangan dan lembaga memerlukan identitas yang berbeda

**BAZNAS Kabupaten Kolaka Utara**, dalam persyaratan proposal lembaga/organisasi tanggal 25 November 2025, meminta struktur kelembagaan, RAB, rekening atas nama lembaga, serta KTP ketua panitia atau penanggung jawab. KTP pada kasus ini mengidentifikasi penanggung jawab kegiatan. Dokumen ini tidak mengatakan satu penanggung jawab berarti hanya ada satu penerima manfaat akhir. [Persyaratan resmi Kolaka Utara](https://kabkolakautara.baznas.go.id/berita/news-show/persyaratan-pengajuan-proposal-bantuan-lembaga-atau-organisasi-di-baznas-kabupaten-kolaka-utara/32151).

**BAZNAS Kota Padang** menerbitkan persyaratan berbeda per program. Bedah rumah meminta KTP, KK, bukti kepemilikan tanah dan foto rumah; ekonomi meminta rincian biaya usaha; pendidikan meminta KTP suami-istri, rincian utang sekolah dan rekening bank sekolah. Dakwah/advokasi menerima permohonan lembaga/perorangan dengan KTP ketua pelaksana/pengurus, proposal, RAB, perjanjian bantuan dan kesediaan memberikan laporan kegiatan. Ini contoh bahwa penerima transfer, pengaju, penanggung jawab, dan penerima manfaat tidak selalu orang yang sama. [Persyaratan Permohonan Bantuan BAZNAS Kota Padang, halaman 1–3](https://bucket-api.baznas.go.id/bucket-api/file?bucket=bzn-fdr-smb-p5739641&file=attachments%2Fpemberitahuan%2F1736761623808286349_720-Persyaratan-Permohonan-Bantuan.pdf).

**Implikasi desain:** kolom identitas harus menjelaskan pihak yang diidentifikasi. Pertanyaan “mengapa hanya satu KTP?” mempunyai jawaban berbeda untuk bantuan perorangan, pengajuan lembaga, dan penyaluran kepada banyak mustahik. Q4/Q13 kemudian membedakan penanggung jawab dari daftar penerima dan menetapkan daftar lengkap sebelum meminta persetujuan sebagai kebijakan produk; sumber di atas tidak menetapkan gerbang tersebut secara universal.

## 2. Template spreadsheet dan impor CSV mempunyai preseden operasional

Panduan SiMBA Edisi Kedua, terbit **1 Maret 2018**, mendokumentasikan:

- Halaman 79–80: migrasi data mustahik perorangan/kelompok dengan membuka template spreadsheet, membuat salinan, mengisi data, menyimpan sebagai `.csv`, lalu mengunggah ke aplikasi.
- Halaman 81: ekspor daftar mustahik perorangan maupun kelompok ke Excel.
- Halaman 82–83: pencatatan transaksi kas keluar sebagai aktivitas tersendiri, dengan jenis penyaluran/penggunaan.

Sumber: [Panduan SiMBA Edisi Kedua, BAZNAS](https://bucket-api.baznas.go.id/bucket-api/file?bucket=bzn-fdr-smb-p5739641&file=attachments%2Fpemberitahuan%2F106-Panduan-SIMBA-Edisi-Kedua.pdf).

**Batas bukti:** panduan membuktikan pola template, impor CSV, dan ekspor Excel pernah didokumentasikan resmi. Panduan ini tidak membuktikan dukungan impor `.xlsx` saat ini, tidak menentukan skema kolom untuk ZKT, dan tidak menyamakan migrasi master data mustahik dengan pengajuan penyaluran atau impor bukti laporan periode. Istilah fitur yang bisa dibahas adalah **impor data massal melalui template**; nama di SiMBA adalah migrasi data mustahik.

## 3. Pengajuan pencairan, pelaksanaan, dan laporan merupakan tahap berbeda

**Dompet Dhuafa**, pada skema Mitra Pengelola Zakat (MPZ), mendeskripsikan urutan: mitra mengajukan pencairan sesuai saldo/kebutuhan program; dana masuk rekening operasional dan pendayagunaan mitra; mitra melaksanakan program; mitra menyampaikan laporan program dan keuangan secara reguler atau maksimal 30 hari setelah program. Persyaratan KTP tiga pengurus berada pada tahap **pendaftaran menjadi MPZ**, bukan daftar identitas semua penerima manfaat. [Mitra Pengelola Zakat Dompet Dhuafa](https://www.dompetdhuafa.org/mitra-pengelola-zakat/).

**BAZNAS Kabupaten Pesisir Barat** melaporkan penyampaian LPJ kepada BAZNAS Provinsi Lampung pada 26 Maret 2026 atas penyaluran dana zakat serta bantuan beras. Berita resmi menyebut pendataan penerima dengan pendekatan *by name by address*. Ini contoh pelaporan realisasi kepada lembaga lain, bukan formulir permohonan bantuan awal. [LPJ BAZNAS Pesisir Barat](https://kabpesisirbarat.baznas.go.id/berita/news-show/baznas-pesisir-barat-sampaikan-laporan-pertanggung-jawaban/42294).

**Batas bukti:** tenggat 30 hari merupakan ketentuan skema MPZ Dompet Dhuafa pada sumber tersebut; jangan diterapkan sebagai aturan semua LAZ/BAZNAS. Contoh LPJ tidak menetapkan bahwa identitas lengkap harus dibuka kepada publik.

## 4. Peran auditor perlu dibedakan dari persetujuan operasional

BAZNAS RI menyatakan laporan keuangannya diaudit setiap tahun oleh KAP independen, sedangkan audit syariah dilakukan tim yang ditetapkan Kementerian Agama. Sumber ini menunjukkan sedikitnya dua jenis pemeriksaan dengan objek berbeda; tidak menyatakan setiap pengajuan penyaluran wajib disetujui auditor sebelum dibayar. [Penjelasan BAZNAS RI atas Laporan Keuangan 2024, 2 Maret 2026](https://baznas.go.id/news-show/Penjelasan_BAZNAS_RI_Atas_Respons_Publik_Terkait_Laporan_Keuangan_2024/3805).

**Keputusan domain:** Q8 mempertahankan auditor sebagai pemeriksa setelah kegiatan, terpisah dari pemeriksa pengajuan operasional. Q23 memusatkan pekerjaan auditor pada versi laporan periode dan penelusuran buktinya, dengan temuan serta tanggapan amil. Jenis mandat, lingkup pemeriksaan, serta akses tetap harus dinyatakan; label auditor tidak menyamakan pemeriksaan teknis bukti dengan audit keuangan atau audit syariah resmi.

### Tambahan riset: persetujuan pada contoh BAZNAS kabupaten

BAZNAS Bengkalis menjelaskan pada 3 Juni 2024 bahwa SOP lokalnya mencakup seleksi administrasi dokumen, kunjungan rumah untuk pendataan/verifikasi/wawancara, lalu keputusan rapat pleno pimpinan. Survei dipimpin Wakil Ketua II bidang Pendistribusian dan Pendayagunaan. [Penjelasan resmi BAZNAS Bengkalis](https://kabbengkalis.baznas.go.id/news-show/baznasbengkalis_lakukan_surfeyfaktual_kelayakanmustahik/7328).

Sumber ini adalah penjelasan resmi SOP dalam berita lembaga, belum salinan SOP bertanda tangan. Tidak disebutkannya DPS tidak membuktikan ketiadaan DPS, tetapi sumber tidak mendukung klaim bahwa persetujuan DPS wajib menjadi tahap setiap pengajuan di seluruh BAZNAS kabupaten/kota. Pemetaan fungsi pemeriksa dan pemberi persetujuan ke jabatan lembaga adalah inferensi desain yang diterima pada Q8 dan dicatat melalui ADR-0028. Keputusan ini menggantikan gerbang DPS universal dalam desain ADR-0006 dan memerlukan penyesuaian integrasi jika diterapkan pada vault lama.

## 5. Kesimpulan sementara dari sumber eksternal

Tiga objek yang dipisahkan dalam desain adalah **pengajuan dalam program**, **data penerima manfaat**, dan **bukti realisasi/laporan**. Identitas pengurus atau penanggung jawab pada proposal tidak dapat otomatis diperlakukan sebagai identitas seluruh mustahik. Impor CSV mempunyai preseden yang konkret, tetapi isi template mengikuti objek yang dipilih. Q1–Q23 telah menetapkan arah produk dan interaksi; skema serta integrasi rinci masih menjadi pekerjaan spesifikasi.

## 6. Temuan source aplikasi

| Area | Bukti | Implikasi desain |
| --- | --- | --- |
| Form pengajuan | [CreateProposalModal.tsx](../../frontend/src/features/governance/CreateProposalModal.tsx), baris 31–38, 76–79, 105–126: satu nama/NIK/asnaf/nominal; judul program hanya dipakai pada toast dan tidak masuk payload. | Model satu penerima per proposal; belum ada hubungan program dengan banyak pengajuan/penerima. Kolom saat ini meminta NIK, sedangkan unggahan berkas diberi label survei/SKTM. |
| Batas model | [ZakatProtocolL1.sol](../../sc/src/ZakatProtocolL1.sol), baris 65–75; [schema.ts](../../backend/src/db/schema.ts), baris 53–60. | Perubahan menjadi banyak penerima melibatkan model data dan integrasi, bukan hanya menambah baris form. |
| Periode dan status | Form baris 72–74 memilih bulan berjalan; skema status Pending/Approved/Executed/Cancelled. | Pilihan periode bantuan, draf, revisi, dan realisasi sebagian belum tercakup model tersebut. |
| JSON sumber | [EvidencePreparationForm.tsx](../../frontend/src/features/workspace/EvidencePreparationForm.tsx), baris 206–240, 269–283: “Siapkan snapshot sumber”, dua ledger JSON dan manifest. | Ini kandidat terkuat fitur yang dikeluhkan pengguna; belum konfirmasi eksplisit pengguna. Adapter tabular perlu mempertahankan asal, satuan, cakupan, dan snapshot. |
| Impor tabular yang sudah ada | [reconciliationTools.ts](../../frontend/src/features/reconciliation/reconciliationTools.ts), baris 72–86: CSV/TSV/TXT; XLSX diarahkan menjadi CSV. | Impor rekonsiliasi dan persiapan bukti tersimpan saat ini berbeda kemampuan. |
| Identitas header | [Navbar.tsx](../../frontend/src/components/layout/Navbar.tsx), baris 51–72 menampilkan alamat pendek. [WorkspacePanel.tsx](../../frontend/src/features/workspace/WorkspacePanel.tsx), baris 97–114 menampilkan lembaga, alamat, dan kode role. Keanggotaan pada schema baris 175–183 belum memiliki nama orang. | Nama akun perlu sumber profil/onboarding; kewenangan ruang kerja tetap berbeda dari kewenangan penandatanganan sesuai ADR-0023. |
| Status pemeriksaan | [ProposalList.tsx](../../frontend/src/features/governance/ProposalList.tsx), baris 22–25 dan 93: filter “Selesai & WTP” hanya memeriksa Executed; baris 153–165 memberi status Cancelled label fallback “Menunggu DPS”. | Penyaluran, pembatalan, dan kesimpulan audit harus dibaca sebagai keadaan berbeda. |

ADR-0006 memisahkan persetujuan sebelum penyaluran dari atestasi auditor sesudah kegiatan. Kontrak vault lama masih mengizinkan approval auditor dan menghitung approval umum (baris 200–220), sebagaimana telah dicatat ADR-0019/0020. Menyelaraskan teks UI saja tidak memperbaiki kewenangan kontrak. SOP persetujuan BAZNAS kabupaten/kota juga belum dibuktikan sama dengan istilah DPS pada model lama.

## 7. Prinsip UX dan status usulan

- **Identitas mudah dikenali — diterima Q6:** nama akun, lembaga, dan peran kerja menjadi konteks utama; alamat wallet tersedia pada detail. Ini penerapan prinsip pengenalan, kesesuaian bahasa, dan visibilitas status, bukan aturan universal susunan header. Sumber: [NN/g, 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).
- **Impor bertahap — diterima Q5:** unduh template → isi → unggah → periksa baris bermasalah dan total → konfirmasi simpan. XLSX menjadi format utama dan CSV alternatif, dengan template berbeda sesuai objek. Pola pemeriksaan jawaban dan perbaikan validasi: [GOV.UK Check answers](https://design-system.service.gov.uk/patterns/check-answers/) dan [Validation](https://design-system.service.gov.uk/patterns/validation/).
- **Lampiran sesuai kebutuhan — diterima Q13/Q16:** berkas mengikuti keadaan penerima, cara penyaluran, dan tahapnya; jelaskan kegunaan, format, dan batas ukuran. Sumber prinsip interaksi: [GOV.UK File upload](https://design-system.service.gov.uk/components/file-upload/). Akses identitas penerima mengikuti batas dokumen terbatas ADR-0021, termasuk bila berkas lama dikaitkan ke alur baru.

## 8. Pohon keputusan dan catatan wawancara

### Disepakati

- **Q1 — Cakupan:** desain pengajuan sebelum penyaluran sampai pemeriksaan; realisasi dan laporan periode tetap dibedakan, dana dikelola lembaga.
- **Q2 — Acuan:** BAZNAS kabupaten/kota sebagai persona awal; kecocokan LAZ diuji berikutnya. Belum ada mitra tertentu yang dinyatakan.
- Dicatat dalam [ADR-0026](../adr/0026-disbursement-workflow-design-scope.md).

- **Q3 — Titik awal:** diterima; amil internal memasukkan permohonan yang diterima lembaga beserta asalnya. Portal pemohon eksternal menjadi kemungkinan perluasan berikutnya.
- **Q4 — Model program:** diterima; satu program menaungi banyak pengajuan, satu pengajuan memuat satu atau banyak penerima beserta rincian bantuan masing-masing. Penanggung jawab terpisah. Dicatat dalam [ADR-0027](../adr/0027-program-proposals-and-beneficiary-rosters.md).
- **Q5 — Masukan tabular:** diterima; XLSX utama, CSV alternatif, template terpisah untuk daftar penerima dan data sumber laporan, dengan pratinjau, pemeriksaan kesalahan/total, lalu konfirmasi simpan. JSON menjadi detail teknis. Skema kolom belum ditetapkan; kebijakan data bermasalah dipilih Q10. Dukungan semua ekspor SiMBA tidak diasumsikan.
- **Q6 — Sumber identitas akun:** diterima; nama akun dan keterkaitan lembaga dikelola administrator lembaga. Akun orang dibedakan dari akun bersama; header menampilkan nama, lembaga, dan peran yang sah, alamat wallet tersedia di detail. Profil belum tersedia tidak boleh diberi identitas rekaan. Nama tampilan tidak memberi kewenangan penandatanganan.

Q3–Q6 diterima pengguna melalui jawaban “ya saya setuju semua” setelah rekomendasi lengkap putaran tersebut. Hubungan program/pengajuan/penerima serta identitas akun telah dicatat dalam CONTEXT.md.

### Putaran Q7–Q12 — diterima

Pengguna menjawab “saya setuju semuanya” atas rekomendasi lengkap Q7–Q12. Ini pilihan desain produk untuk diuji, bukan klaim persyaratan nasional BAZNAS.

- **Q7 — Bentuk bantuan awal:** uang dan barang untuk penerima terdaftar; fasilitas kolektif seperti pembangunan sumur menjadi kemungkinan perluasan berikutnya. Q13/Q16 kemudian memperinci identitas/perwakilan, penerima pembayaran, kelengkapan daftar, dan bukti sesuai penyaluran.
- **Q8 — Persetujuan lembaga:** amil penyusun → pemeriksa administrasi/kelayakan → pemberi persetujuan lembaga. Penyusun tidak menyetujui pengajuannya sendiri. Jabatan serta pengawasan syariah dipetakan menurut SOP; auditor memeriksa sesudah kegiatan. Gerbang DPS universal ADR-0006 digantikan untuk desain baru melalui ADR-0028. Q17 menetapkan pengesahan pencatatan keputusan; matriks mandat/nominal menjadi rincian spesifikasi.
- **Q9 — Realisasi sebagian:** diterima; jumlah/nominal disetujui, tersalur, dan sisa ditampilkan beserta bukti per penerima atau kelompok penyerahan yang dapat ditelusuri. Pengajuan belum selesai hanya karena sebagian tersalur. Q7–Q9 dicatat dalam [ADR-0028](../adr/0028-institutional-approval-and-partial-realization.md).
- **Q10 — Impor bermasalah:** masukan boleh disimpan sebagai draf dengan baris dan kesalahan tetap terlihat; pengiriman pengajuan diblokir sampai kesalahan wajib selesai. Baris tidak dibuang diam-diam. Sumber laporan bermasalah belum menjadi snapshot siap diperiksa.
- **Q11 — Navigasi kerja:** Ruang Kerja Lembaga menjadi pintu utama pekerjaan internal dengan menu Program, Pengajuan, Realisasi, Rekonsiliasi, dan Laporan/Pemeriksaan sesuai akses, antrean tugas, serta identitas aktif. Halaman publik memiliki navigasinya sendiri.
- **Q12 — Perangkat utama:** laptop untuk tabel, impor, dan pemeriksaan; ponsel mendukung melihat status dan pencatatan/unggahan bukti lapangan. Q18 menetapkan koneksi diperlukan pada versi awal, dengan status penyimpanan dan pilihan mencoba ulang yang jelas.

### Putaran Q13–Q19 — diterima

Pengguna menjawab “saya setuju semua” atas rekomendasi lengkap Q13–Q19. Kata rekomendasi dalam daftar berikut mempertahankan isi usulan yang telah diterima, bukan pertanyaan yang masih terbuka. Q15/Q17 dicatat melalui [ADR-0029](../adr/0029-proposal-revisions-and-recorded-institutional-decisions.md).

- **Q13 — Gerbang kelengkapan penerima:** rekomendasi: daftar penerima dan rincian bantuan lengkap sebelum pengiriman untuk persetujuan; draf boleh belum lengkap. NIK dan dokumen mengikuti keadaan penerima; anak, keluarga, atau orang tanpa KTP memiliki hubungan wali/perwakilan atau bukti alternatif yang harus ditelaah pemeriksa. Tidak memakai NIK fiktif atau satu NIK penanggung jawab sebagai pengganti semua penerima. Ini usulan kebijakan aplikasi, bukan pengesahan persyaratan hukum universal. Skema kolom final mengikuti pilihan ini.
- **Q14 — Bantuan berulang:** rekomendasi: satu mustahik dapat menerima pada periode/program yang berbeda; kemiripan penerima/program/periode menimbulkan peringatan dan pemeriksaan, bukan larangan seumur hidup. Duplikasi baris persis dalam satu pengajuan diblokir. Batas manfaat dan pengecualian mengikuti kebijakan program. Pengenal dan pencocokan teknis ditetapkan setelah kebijakan identitas.
- **Q15 — Perubahan setelah persetujuan:** rekomendasi: perubahan penerima atau hak bantuan menghasilkan revisi dengan alasan dan persetujuan baru; riwayat dan realisasi yang sudah terjadi dipertahankan. Bagian yang berubah belum boleh direalisasikan. Sisa yang tidak disalurkan ditutup secara eksplisit melalui keputusan lembaga beserta alasan, bukan dipindah ke penerima lain tanpa persetujuan.
- **Q16 — Bukti realisasi:** rekomendasi: bukti mengikuti cara penyaluran; transfer membawa bukti pembayaran, tunai/barang membawa bukti penerimaan atau BAST yang menghubungkan penerima dengan jumlah. Pembayaran sekolah/penyedia mencatat penerima manfaat dan pihak penerima pembayaran secara terpisah. Foto menjadi pendukung; unggahan belum membuktikan kebenaran atau kelengkapan. Realisasi yang dilaporkan dengan bukti belum lengkap tetap terlihat sebagai perlu dilengkapi dan belum dapat dinyatakan selesai oleh sistem.
- **Q17 — Keputusan lembaga dan penandatanganan:** rekomendasi awal: aplikasi mencatat rujukan keputusan (termasuk berita acara pleno jika berlaku), lalu satu pejabat berwenang mengesahkan pencatatannya. Tanda tangan tersebut tidak diklaim membuktikan kuorum pleno digital. Persetujuan digital beberapa pejabat diperlakukan sebagai kebutuhan tambahan bila diwajibkan SOP mitra; sampai itu tersedia alur tidak boleh mengklaim pemenuhan SOP tersebut. Ini keputusan bentuk fitur, bukan penentuan SOP oleh pengguna.
- **Q18 — Ponsel tanpa koneksi:** rekomendasi: versi awal memerlukan koneksi untuk menyimpan atau mengunggah, dengan indikator tersimpan/belum tersimpan yang jelas dan pilihan mencoba ulang. Sinkronisasi offline menjadi kemungkinan perluasan; tidak menjanjikan bukti sudah tersimpan ketika koneksi gagal.
- **Q19 — Unggah ulang spreadsheet:** rekomendasi: pada draf, berkas baru ditampilkan sebagai perbandingan tambahan/perubahan/penghapusan sebelum pengguna menerapkan; identitas baris stabil mencegah baris ganda akibat unggah ulang. Riwayat sumber dipertahankan, dan berkas sumber laporan yang sudah dibekukan menghasilkan persiapan baru bila diganti. Unggah ulang pengajuan yang telah disetujui mengikuti aturan revisi, bukan menimpa diam-diam.

### Putaran Q20–Q23 — diterima

Pengguna menjawab “ya saya setuju semua” atas rekomendasi lengkap putaran ini. Rekomendasi di bawah telah menjadi keputusan. Q20/Q22 memperinci ADR-0026; Q21 dicatat dalam ADR-0030; Q23 memperinci alur kerja pemeriksaan tanpa mengganti batas versi/atestasi ADR-0022.

- **Q20 — Pembayaran dalam alur baru:** rekomendasi: versi awal berfokus pada pencatatan bantuan uang IDR/barang dan bukti pembayaran yang dilaksanakan lembaga di luar aplikasi. Jalur vault USDC tetap terpisah. Tombol “Catat realisasi” tidak mengirim uang. Keputusan ini menutup ketidakjelasan antara desain pencatatan dan eksekusi dana, tanpa memerintahkan penghapusan jalur lama.
- **Q21 — Akuntabilitas akun:** rekomendasi: setiap petugas mempunyai akun kerja pribadi yang ditautkan ke lembaga; akun bersama dipakai sebagai akun pengesahan lembaga. Riwayat membedakan operator yang terautentikasi dan akun pengesah institusi. Nama operator tidak ditebak dari tanda tangan wallet bersama. Model ini diperlukan untuk menegakkan larangan penyusun menyetujui sendiri; protokol identitas serta onboarding menjadi bagian spec, bukan autentikasi yang sudah tersedia saat ini.
- **Q22 — Batas anggaran awal:** rekomendasi: pagu program menjadi referensi dengan peringatan, sementara lembaga memutuskan ketersediaan dana. Aplikasi menegakkan batas bantuan yang disetujui per pengajuan dan menampilkan sisa. Reservasi anggaran lintas pengajuan serta perbankan langsung menjadi pengembangan berikutnya; aplikasi tidak menyebut sisa pagu referensi sebagai saldo bank terverifikasi. Mata uang/unit wajib eksplisit.
- **Q23 — Pekerjaan auditor:** rekomendasi: halaman pemeriksaan mengikuti versi laporan periode dengan penelusuran ke pengajuan, penerima, realisasi, dan bukti sesuai akses. Auditor mencatat temuan; amil memberi tanggapan/bukti tambahan; auditor menetapkan tindak lanjut temuan tersebut. Temuan dan riwayat tanggapan tidak mengubah transaksi atau mengesahkan penyaluran. Atestasi tetap terikat versi yang diperiksa sesuai ADR-0022; perubahan sumber resmi mengikuti koreksi versi, bukan mengubah snapshot lama.

### Penutupan sesi dan rincian yang menjadi pekerjaan spesifikasi

Q1–Q23 telah diterima. Pengguna menjawab **“setuju semua”** atas rangkuman penutup pemahaman bersama pada 2026-09-15; sesi `grill-with-docs` selesai. Rangkuman diterima sebagai dasar spesifikasi UI/UX berikutnya. Kode aplikasi belum berubah. Nama kolom, identitas baris stabil, pemetaan jabatan/mandat dan batas nominal, aturan error, konfigurasi dokumen sesuai SOP, akses/retensi, protokol autentikasi dan penandatanganan, serta pengujian penerimaan harus diperinci sebelum implementasi terkait. Ini rincian yang dinyatakan terbuka, bukan izin untuk menganggap mekanismenya sudah ada atau sesuai seluruh lembaga.

Konfirmasi pemahaman bersama yang diwajibkan skill grilling telah terpenuhi. Tidak ada keputusan arah desain yang menunggu jawaban dalam sesi ini. Riset, glosarium, ADR-0026–0030, dan rancangan terpadu telah diselaraskan dengan keputusan tersebut. Persetujuan desain tidak menyatakan pilot lembaga siap produksi; validasi SOP mitra dan spesifikasi teknis mengikuti sebagai pekerjaan berikutnya.

### Hasil to-spec

Pengguna meminta publikasi melalui skill `to-spec` dan menyetujui batas pengujian dengan jawaban **“Sesuai, gunakan rancangan pengujian tersebut.”** Spec diterbitkan pada [issue #86 — Pengajuan penyaluran lembaga](https://github.com/tawf-labs/tawf-zakat/issues/86), berstatus OPEN dan berlabel `ready-for-agent`, berisi 60 user stories serta 26 skenario penerimaan. Isi issue telah diverifikasi identik dengan draf publikasi.

Batas utama adalah HTTP aplikasi terautentikasi dengan penyimpanan/aturan nyata. Smoke browser memeriksa UX dan harness registry lokal digunakan kembali untuk integrasi yang tersentuh. Spec merujuk #68 serta #81–#85 agar pekerjaan sumber, akses, dan registry tidak diduplikasi. Sub-issue dan kode aplikasi belum dibuat pada tahap ini.

### Hasil to-tickets

Pengguna menyetujui penggabungan usulan 15 menjadi 13 tiket. Revisi digabung dengan pembatalan/penutupan sisa, dan temuan auditor digabung dengan tanggapan/tindak lanjut. [Peta tiket implementasi](../design/pengajuan-penyaluran-tickets.md) memuat tautan seluruh issue, dependensi, alasan penggabungan, dan keterlacakan 60 user stories serta 26 skenario penerimaan.

Pada verifikasi publikasi 2026-09-15, seluruh 13 issue OPEN dan berlabel `ready-for-agent`; 13 relasi sub-issue ke #86 serta 15 dependensi native telah diperiksa. Tiket awal tanpa blocker adalah [#87](https://github.com/tawf-labs/tawf-zakat/issues/87) dan [#88](https://github.com/tawf-labs/tawf-zakat/issues/88). Judul, isi, dan status spec #86 tetap sama. Status pekerjaan selanjutnya mengikuti tracker; kode aplikasi belum diubah pada tahap ini.
