# Tiket pilot distribusi, ZK dan NFT

- Status: pembagian dan dependensi disetujui pengguna; 15 tiket diterbitkan sebagai #101–#115 di bawah spec #100 melalui skill `to-tickets`.
- Sumber: [spec #100](https://github.com/tawf-labs/tawf-zakat/issues/100), isi lengkap dan komentar dibaca ulang; sama dengan [salinan spec](../specs/pilot-distribution-zk-nft.md).
- Dasar: ADR-0031–0035 dan fondasi #86. Batas pengujian yang telah disetujui tetap berlaku.

## Pemakaian kembali pekerjaan lama

#87–#91 tetap selesai. Delapan tiket berikut tetap menjadi pemilik pekerjaan operasional; tidak dibuat duplikat dan dependensinya tidak berubah. Kriteria tambahan pada tiket lama sudah diterbitkan pada sesi to-spec sebelumnya.

| Tiket | Hasil | Blocked by |
| --- | --- | --- |
| [#92](https://github.com/tawf-labs/tawf-zakat/issues/92) | Impor daftar penerima | #88, #89 |
| [#93](https://github.com/tawf-labs/tawf-zakat/issues/93) | Keputusan dan pengesahan pengajuan | #91 |
| [#94](https://github.com/tawf-labs/tawf-zakat/issues/94) | Realisasi IDR, konfirmasi dan sengketa | #93 |
| [#95](https://github.com/tawf-labs/tawf-zakat/issues/95) | Realisasi barang, biaya dan konfirmasi | #94 |
| [#96](https://github.com/tawf-labs/tawf-zakat/issues/96) | Revisi dan penutupan sisa pengajuan | #94 |
| [#97](https://github.com/tawf-labs/tawf-zakat/issues/97) | Unggah ulang penerima dan perbandingan perubahan | #92, #96 |
| [#98](https://github.com/tawf-labs/tawf-zakat/issues/98) | Sumber laporan dari realisasi | #95, #96 |
| [#99](https://github.com/tawf-labs/tawf-zakat/issues/99) | Temuan, tanggapan dan tindak lanjut auditor | #98 |

## Lima belas irisan baru

Nomor draf N01–N15 dipetakan berurutan ke #101–#115. Tabel berikut memakai nomor GitHub; setiap tiket berada di bawah #100 dengan label `ready-for-agent` dan dependensi native.

| Tiket | Judul | Blocked by | Hasil |
| --- | --- | --- | --- |
| [#101](https://github.com/tawf-labs/tawf-zakat/issues/101) | Verifikasi jujur dan perlindungan rincian kontribusi | Tidak ada | Pengguna halaman verifikasi mendapat hasil yang berasal dari bukti nyata atau status tidak tersedia, sementara lookup publik tidak membocorkan rincian donatur. |
| [#102](https://github.com/tawf-labs/tawf-zakat/issues/102) | Kontribusi diterima dengan sumber dan pengesahan lembaga | Tidak ada | Amil mencatat atau mengimpor penerimaan lembaga, memeriksa sumbernya, lalu pihak berwenang mengesahkan catatan yang layak masuk batch kontribusi. |
| [#103](https://github.com/tawf-labs/tawf-zakat/issues/103) | Alokasi kontribusi ke kegiatan dan sisa dana | #102, #93 | Amil mengalokasikan sebagian kontribusi ke kegiatan dari pengajuan yang disahkan, lalu melihat pendanaan gabungan dan bagian belum dialokasikan. |
| [#104](https://github.com/tawf-labs/tawf-zakat/issues/104) | Akses kontribusi donatur melalui OTP tanpa akun | #101, #103 | Donatur menerima pemberitahuan minimum, membuka satu kontribusi melalui OTP, dan melihat alokasi kegiatan tanpa mendaftar atau menghubungkan wallet. |
| [#105](https://github.com/tawf-labs/tawf-zakat/issues/105) | Pemulihan kontak dan akses donatur berjejak | #104 | Petugas berwenang memeriksa permintaan pemulihan, memperbaiki kontak yang sah dan memulihkan akses satu kontribusi dengan riwayat keputusan. |
| [#106](https://github.com/tawf-labs/tawf-zakat/issues/106) | Koreksi kontribusi dan pencatatan pengembalian | #103 | Lembaga memperbaiki nominal kontribusi dan mencatat keputusan serta realisasi pengembalian, dengan selisih alokasi dan riwayat tetap terlihat. |
| [#107](https://github.com/tawf-labs/tawf-zakat/issues/107) | Pengalihan alokasi dan pertanggungjawaban kegiatan | #106, #95, #96 | Amil menelaah dana yang masih tersedia setelah biaya dan kewajiban kegiatan, lalu lembaga mengesahkan pengalihan dengan alasan dan riwayat. |
| [#108](https://github.com/tawf-labs/tawf-zakat/issues/108) | Satu receipt dengan proof ZK nyata hingga EVM | #101, #102 | Petugas mengesahkan satu batch kecil dari kontribusi yang sah, menghasilkan proof nyata, dan pengguna memeriksa hasil transaksi verifier untuk receipt tertentu. |
| [#109](https://github.com/tawf-labs/tawf-zakat/issues/109) | Batch kontribusi dan penerbitan ZK yang dapat dipulihkan | #108 | Lembaga mengesahkan batch banyak kontribusi dan layanan memproses receipt otomatis dalam anggaran, dengan status dan pemulihan sesudah kegagalan. |
| [#110](https://github.com/tawf-labs/tawf-zakat/issues/110) | Koreksi batch dan keberlakuan receipt ZK | #106, #109 | Koreksi kontribusi menghasilkan batch/receipt pengganti yang disahkan, sementara pemeriksa membedakan proof historis yang valid matematis dari bukti yang masih berlaku. |
| [#111](https://github.com/tawf-labs/tawf-zakat/issues/111) | Sertifikat tahap hingga NFT distribusi terverifikasi | #101, #95 | Pejabat mengesahkan cakupan tahap penyaluran uang/barang dan layanan menerbitkan NFT ke akun lembaga; publik memeriksa penerbit, isi dan statusnya. |
| [#112](https://github.com/tawf-labs/tawf-zakat/issues/112) | Koreksi dan sengketa pada NFT distribusi | #111, #96 | Lembaga memperbarui keberlakuan sertifikat yang diperselisihkan atau dikoreksi, menerbitkan NFT versi pengganti dan mempertahankan bukti lama. |
| [#113](https://github.com/tawf-labs/tawf-zakat/issues/113) | Pemulihan akun pemegang NFT lembaga | #112 | Lembaga memulihkan akses pengendali akun atau melakukan penggantian berwenang yang disetujui desain, dengan pemegang, penerbit dan riwayat sertifikat tetap terlacak. |
| [#114](https://github.com/tawf-labs/tawf-zakat/issues/114) | Penelusuran donatur dan rekap amil dari sumber yang sama | #104, #107, #110, #112, #98 | Donatur melihat kontribusi, alokasi, progres kegiatan, status ZK dan NFT; amil menelusuri angka yang sama ke sumber laporan tanpa memasukkan ulang data. |
| [#115](https://github.com/tawf-labs/tawf-zakat/issues/115) | Kesiapan dan verifikasi rilis pilot terpadu | #105, #113, #114, #97, #99 | Operator membuktikan keseluruhan pilot pada lingkungan yang disepakati, dengan aplikasi/API benar-benar dapat diakses dan bukti ZK/NFT yang dapat diperiksa. |

## Alasan pembagian dan dependensi

- Tidak diperlukan refactor lebar baru: dokumen privat, sesi, pembacaan versi dan lifecycle registry sudah diselesaikan #82–#85. #101 merupakan koreksi perilaku yang dapat dibuktikan pada jalur aktif. Refactor kecil yang diperlukan setiap irisan dilakukan sebelum menambah perilaku di irisan tersebut.
- #103 memakai pengajuan yang disahkan sehingga menunggu #93. Kontribusi #102 dan receipt ZK #108 tidak memerlukan realisasi atau alokasi kegiatan lebih dahulu.
- #108 adalah tracer satu receipt lengkap melalui SQL/API/UI/prover/EVM, bukan tiket circuit horizontal. #109 menangani batch/otomasi/pemulihan; #110 menangani versi koreksi. Jika toolchain tidak dapat memenuhi statement, tiket tidak ditutup dengan hash atau proof palsu.
- NFT pertama #111 menunggu realisasi barang #95, yang sudah mencakup IDR/konfirmasi melalui #94. NFT tidak menunggu ZK karena pernyataan yang dibuktikan berbeda. Koreksi #112 memakai #96; recovery #113 memakai hubungan versi yang sudah tersedia.
- #107 membutuhkan realisasi biaya/barang dan penutupan/revisi untuk menentukan sisa yang dapat dialihkan. Alokasi awal #103 tidak perlu menunggu biaya tersebut.
- #114 menyatukan proyeksi donor/amil dari perilaku yang sudah selesai. Tidak menyimpan ledger baru atau menjadi tempat menunda implementasi prover/mint/konfirmasi.
- #115 menguji integrasi dan rilis. Seluruh 14 tiket baru lainnya serta #92–#99 menjadi leluhurnya dalam graph. Mandat, kanal, anggaran, target deployment dan kondisi mitra yang belum tersedia tetap prasyarat nyata; publikasi tiket tidak memberi izin tindakan produksi.
- Batas pekerjaan lintas tiket eksplisit: #94/#95 memiliki konfirmasi/sengketa/biaya; #107 memiliki perhitungan ketersediaan dan keputusan pengalihan; #110/#112 mengikat koreksi ke bukti; #114 memiliki tampilan terpadu. Cakupan yang sama pada tabel keterlacakan berarti kontribusi terhadap skenario integrasi, bukan implementasi ganda.

**Dapat dimulai sekarang:** #92, #93, #101, #102. Tidak ada rantai yang memaksa semua pekerjaan menunggu ZK atau NFT.

## Keterlacakan spec #100

Penomoran di sini milik spec #100; nomor US pada baseline #86 tetap terpisah. Seluruh 96 user stories dan 34 AC memiliki pemilik. Tes setiap tiket membuktikan bagian perilakunya, sedangkan #115 memverifikasi matriks terpadu; angka cakupan bukan klaim tes sudah lulus.

| Pemilik | User stories #100 | Acceptance criteria #100 |
| --- | --- | --- |
| #87 (baseline selesai) | US-02, US-04, US-90 | AC01, AC29 |
| #88 (baseline selesai) | US-02, US-82, US-90 | AC01, AC02, AC27 |
| #89 (baseline selesai) | US-02, US-03, US-90 | AC01 |
| #90 (baseline selesai) | US-02, US-04, US-12, US-13, US-90 | AC01, AC03, AC29 |
| #91 (baseline selesai) | US-02, US-11, US-90 | AC01, AC03 |
| #92 | US-08, US-09, US-10, US-11, US-19, US-89, US-91 | AC01, AC02, AC15, AC29 |
| #93 | US-01, US-03, US-04, US-12, US-13, US-91 | AC01, AC03, AC29 |
| #94 | US-06, US-07, US-14, US-16, US-17, US-18, US-19, US-20, US-21, US-22, US-23, US-24, US-25, US-26, US-27, US-28, US-31, US-86, US-89, US-91 | AC04, AC05, AC06, AC07, AC24, AC25, AC29, AC30 |
| #95 | US-15, US-18, US-20, US-21, US-22, US-23, US-24, US-25, US-26, US-27, US-28, US-29, US-30, US-31, US-86, US-89, US-91 | AC04, AC05, AC06, AC07, AC24, AC25, AC30 |
| #96 | US-87, US-88, US-91 | AC10, AC11, AC12, AC19, AC23, AC24, AC26 |
| #97 | US-08, US-09, US-10, US-19, US-87, US-89, US-91 | AC02, AC05, AC15, AC26, AC29 |
| #98 | US-78, US-79, US-80, US-81, US-82, US-86, US-90, US-91 | AC07, AC15, AC24, AC25, AC26, AC27, AC31 |
| #99 | US-83, US-84, US-85, US-86, US-89, US-91 | AC15, AC19, AC23, AC24, AC26, AC28, AC29, AC30 |
| #101 | US-52, US-54, US-89, US-90, US-91 | AC13, AC15, AC20, AC27, AC29, AC30 |
| #102 | US-05, US-32, US-33, US-34, US-51, US-91 | AC08, AC15, AC29 |
| #103 | US-01, US-03, US-35, US-36, US-37, US-38, US-91 | AC09, AC15, AC29 |
| #104 | US-38, US-39, US-46, US-47, US-48, US-49, US-52, US-53, US-54, US-89, US-91 | AC13, AC14, AC15, AC20, AC29, AC30 |
| #105 | US-50, US-51, US-89, US-91 | AC13, AC14, AC15, AC29, AC30 |
| #106 | US-40, US-41, US-42, US-44, US-45, US-91 | AC10, AC11, AC12, AC19, AC29 |
| #107 | US-31, US-37, US-40, US-43, US-86, US-91 | AC07, AC09, AC10, AC11, AC12, AC25 |
| #108 | US-34, US-53, US-54, US-55, US-56, US-57, US-58, US-59, US-60, US-61, US-92 | AC08, AC15, AC16, AC17, AC18, AC20, AC30, AC33 |
| #109 | US-34, US-53, US-54, US-57, US-60, US-61, US-62, US-94 | AC08, AC15, AC18, AC20, AC29, AC30, AC33 |
| #110 | US-41, US-63, US-64, US-91, US-92 | AC10, AC12, AC16, AC17, AC18, AC19, AC20, AC30 |
| #111 | US-65, US-66, US-67, US-68, US-69, US-71, US-74, US-75, US-76, US-77, US-92, US-94 | AC15, AC21, AC22, AC23, AC25, AC29, AC30, AC33 |
| #112 | US-24, US-26, US-66, US-71, US-72, US-73, US-91, US-92 | AC23, AC24, AC25, AC26, AC28, AC30 |
| #113 | US-67, US-69, US-70, US-94 | AC22, AC23, AC29, AC30, AC33 |
| #114 | US-01, US-38, US-39, US-40, US-52, US-53, US-54, US-55, US-66, US-68, US-73, US-76, US-78, US-79, US-80, US-81, US-86, US-89, US-91 | AC07, AC09, AC13, AC15, AC19, AC23, AC24, AC25, AC26, AC27, AC29, AC30 |
| #115 | US-01, US-02, US-06, US-52, US-89, US-90, US-91, US-92, US-93, US-94, US-95, US-96 | AC01, AC02, AC03, AC04, AC05, AC06, AC07, AC08, AC09, AC10, AC11, AC12, AC13, AC14, AC15, AC16, AC17, AC18, AC19, AC20, AC21, AC22, AC23, AC24, AC25, AC26, AC27, AC28, AC29, AC30, AC31, AC32, AC33, AC34 |

## Pemeriksaan publikasi

- Graph tidak bersiklus; tiket diterbitkan dengan blocker baru lebih dahulu. Setiap blocker memakai nomor issue nyata.
- Tidak ada user story atau AC tanpa pemilik. Release gate menjangkau seluruh pekerjaan terbuka yang direncanakan.
- Lima belas body memakai template issue (Parent, What to build, Acceptance criteria, Blocked by), tanpa path kode atau snippet implementasi.
- Publikasi memakai relasi sub-issue ke #100 dan dependency native. Body, judul, label dan state parent #100/#86 tidak diubah; #92–#99 tetap anak #86.

Hasil pembacaan ulang tracker dicatat pada [verifikasi publikasi tiket](../verification/0101-pilot-tickets.md).
