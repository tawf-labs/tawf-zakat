# Cakupan pilot distribusi, penelusuran donatur, ZK dan NFT

Rangkuman ini menyimpan kesepakatan penutup brainstorming. Tindak lanjutnya telah diterbitkan sebagai [spec #100](../specs/pilot-distribution-zk-nft.md) dan [tiket #101–#115](pilot-distribution-tickets.md); pernyataan tentang langkah berikutnya atau tracker yang belum diperbarui di bawah merujuk tahap brainstorming.

- Tanggal: 2026-09-16.
- Status: sintesis keputusan Q1–Q40 yang diterima sesuai perincian [jurnal wawancara](../research/0007-pilot-distribusi-dan-penelusuran-grilling.md); pemahaman bersama dikonfirmasi pengguna pada 2026-09-16 sebagai dasar revisi spec dan pemetaan tiket. Rekomendasi awal yang diganti pengguna tidak dianggap diterima.
- Dasar: ADR-0026–0030 dan [ADR-0031](../adr/0031-institutional-pilot-donor-traceability-and-evidence.md), [0032](../adr/0032-contribution-traceability-and-recipient-confirmation.md), [0033](../adr/0033-pilot-activity-allocation-confirmation-and-publication.md), [0034](../adr/0034-private-contribution-membership-zk-priority.md), [0035](../adr/0035-staged-distribution-certificates-and-required-pilot-nft.md).
- Batas: rangkuman desain; bukan hasil uji atau pernyataan siap produksi. Tindak lanjut `to-spec` telah menerbitkan [spec #100](https://github.com/tawf-labs/tawf-zakat/issues/100), menyesuaikan tiket dan menutup pekerjaan lama; lihat [catatan publikasi](../verification/0100-pilot-spec-tracker.md). Pernyataan snapshot tracker pada bagian hubungan pekerjaan lama merekam keadaan saat rangkuman disepakati.

## Hasil pilot

Satu kegiatan di bawah BAZNAS/LAZ menghasilkan penelusuran donatur dan paket bukti yang dipakai amil dari sumber yang sama. Kegiatan pertama mengikuti satu pengajuan dalam satu program. Bantuan uang dan barang memakai rincian, persetujuan, realisasi parsial dan sisa yang telah dirancang pada spec #86. Petugas lembaga menjalankan penyerahan; pembayaran dijalankan lembaga, sementara ZKT mencatat dan membantu pemeriksaannya.

Pilot memakai dana yang sudah diterima lembaga beserta catatan kontribusi yang tersedia. Penggalangan baru, penebusan merchant, eksekusi pembayaran oleh ZKT, inventori/pengadaan lengkap dan aplikasi sepenuhnya offline merupakan perluasan. NFT dan ZK nyata termasuk hasil wajib yang sudah dipilih; keduanya tidak ditunda secara diam-diam ketika menyusun tiket.

## Satu sumber, keluaran sesuai kebutuhan

| Bagian | Perilaku yang disepakati | Rujukan |
| --- | --- | --- |
| Kontribusi dan alokasi | Voucher adalah referensi kontribusi. Catat nominal alokasi ke kegiatan, jenis dana, peruntukan dan bagian belum dialokasikan. Pendanaan gabungan tidak membuat klaim satu donor–satu penerima tanpa dasar. | Q9/Q10/Q15 |
| Penyaluran | Rincian penerima dan hak berasal dari pengajuan yang disetujui. Catatan petugas dibedakan dari konfirmasi penerima/perwakilan. OTP dipakai saat kontak tersedia; BAST pengganti diperiksa petugas lain. | Q12/Q14/Q16; ADR-0027–0029 |
| Biaya/barang | Bedakan uang muka, biaya aktual, nilai rencana dan penyerahan barang. Jumlah/satuan barang eksplisit; nilai IDR menyebut sumber/dasar. Pembelian dan serah terima tidak menggandakan nilai bantuan. | Q34 |
| Donatur/publik | Publik mendapat agregat; rincian satu kontribusi dibuka melalui OTP tanpa akun atau wallet wajib. Foto wajah, identitas, kontak dan berkas lengkap penerima tetap terbatas. Pemulihan akses diperiksa petugas. | Q11/Q17a/Q27/Q29 |
| Amil/pemeriksa | Rekap kegiatan, realisasi/sisa, indeks bukti dan sumber laporan memakai catatan yang sama. Pengesahan laporan periode dan pemeriksaan auditor tetap mengikuti aturan lama. | Q8/Q18; ADR-0022 |
| Penyelesaian | Status penyaluran, pertanggungjawaban dana, konfirmasi/sengketa dan penerbitan bukti terlihat terpisah. Satu status sukses tidak menutupi pekerjaan yang belum selesai. | Q36 |

### Dua jenis bukti yang wajib

| | ZK kontribusi | NFT distribusi |
| --- | --- | --- |
| Pernyataan | Catatan kontribusi termasuk batch penerimaan yang telah dicocokkan dan disahkan lembaga, tanpa membuka identitas/nominal kepada publik | Lembaga mengesahkan sertifikat suatu tahap penyaluran yang merujuk realisasi dan konfirmasi penerima |
| Hasil | Proof nyata diverifikasi di smart contract dan keberhasilannya dicatat sekali per versi receipt; dapat diperiksa ulang | NFT per versi sertifikat, dipegang akun lembaga; donatur melihat dan memeriksa tanpa wajib wallet |
| Batas | Lembaga/prosesor berwenang dapat melihat witness; bukan bukti otomatis pembayaran bank atau penyerahan fisik | Tidak diperdagangkan/dipindahkan bebas; token bukan hak bantuan, pembayaran, ataupun akses dokumen privat |
| Koreksi | Pertahankan batch/receipt historis, tandai digantikan dan terbitkan versi sah yang sesuai | Isi versi tetap; koreksi menghasilkan NFT versi baru dan hubungan pengganti, sementara status keberlakuan/sengketa dapat diperiksa |
| Operasi | Layanan berwenang setelah pengesahan; anggaran layanan/pilot terpisah | Layanan berwenang setelah pengesahan; anggaran layanan/pilot terpisah |

Penerbitan tidak dipotong otomatis dari kontribusi dan tidak menuntut gas donatur. Tertunda/gagal terlihat; mengirim transaksi belum cukup untuk menyatakan sukses. Penerimaan dana atau penyerahan nyata tetap tercatat ketika penerbitan bukti gagal, tetapi hasil teknologi yang diwajibkan belum terpenuhi. Pemulihan akun lembaga mempertahankan riwayat dan kewenangan; protokolnya masih harus ditentukan dalam spesifikasi.

## Pengecualian yang wajib dipertahankan

- Koreksi nominal tidak menimpa realisasi. Selisih terhadap alokasi terdahulu ditampilkan; alokasi tambahan yang memperburuknya dihentikan sampai penyelesaian lembaga (Q28).
- Pengembalian dana mencatat keputusan dan realisasi secara terpisah. Koreksi data ganda atau sisa alokasi tidak otomatis berarti pengembalian. Kebijakan mengikuti lembaga dan jenis dana (Q30).
- Kekurangan dokumen dibedakan dari pertentangan konkret atas penerimaan/jumlah. Sengketa mempertahankan bukti, menahan klaim konfirmasi final terkait, dan ditindaklanjuti lembaga. Temuan auditor tidak mengubah transaksi otomatis (Q31).
- Pengalihan alokasi memerlukan keputusan berjejak dan alasan, memperhitungkan penggunaan/kewajiban, serta mempertahankan peruntukan. Belum diserahkan bukan berarti bebas dipindahkan (Q35).

## Hubungan dengan pekerjaan lama

[Pemetaan tiket](pilot-voucher-traceability-mapping.md) menyimpan snapshot status sesi ini: #87–#91 CLOSED dan #92–#99 OPEN. Belum ada pembaruan tracker, pemeriksaan deployment atau validasi ulang runtime. Status CLOSED tidak membuktikan kesiapan pilot.

| Kelompok | Implikasi bagi rencana implementasi berikutnya |
| --- | --- |
| #87–#91 | Pertahankan fondasi akun, sumber, program/pengajuan, mandat dan pemeriksaan. Perinci integrasi baru serta verifikasi alur yang benar-benar dipakai. |
| #92–#98 | Pertahankan kebutuhan impor, keputusan, realisasi uang/barang, revisi dan sumber laporan. #98 menghubungkan operasi dengan nilai laporan; dependensi tetap dihormati sampai revisi rencana disepakati. |
| #97/#99 | Jangan otomatis ditunda karena tidak muncul pada diagram. Nilai kebutuhan unggah ulang dan pemeriksaan bersama alur pilot. |
| Tambahan | Penerimaan/alokasi kontribusi, akses donatur, konfirmasi lapangan, biaya terkait, ZK nyata, NFT tahap, status/koreksi dan pengujian integrasi perlu cakupan eksplisit. |
| Kebenaran verifikasi | Temuan sukses simulasi dan akses rincian tanpa otorisasi pada [riset 0011](../research/0011-status-verifikasi-bukti-dan-zk.md) harus ditangani dalam kesiapan pilot. |

Tidak ada keputusan untuk membuang seluruh spec #86 atau membekukan seluruh backlog. Langkah berikutnya ialah menurunkan perubahan kebutuhan dan irisan implementasi ke spec/tiket yang dapat ditinjau, tanpa menyatakan kebutuhan baru sudah tercakup tiket lama.

## Yang masih harus diperinci

**Spesifikasi/uji kelayakan:** statement dan circuit ZK, pasangan versi toolchain, public inputs, root berwenang, ukuran verifier/gas; standar NFT, penyimpanan/pengikatan metadata, pemulihan akun, protokol pengesahan/versi; pilihan jaringan dan target deployment; OTP, sesi, retensi/akses, retry dan kriteria konfirmasi transaksi. Riset yang ada belum membuktikan pipeline produksi berjalan. Perubahan batas produk akibat hasil uji harus dibuka kembali secara eksplisit.

**Validasi mitra:** lembaga nyata, tanggal, volume, koneksi/perangkat, kanal kontak, SOP/pejabat, contoh laporan, dasar valuasi biaya dan nominal anggaran. Tidak ada nilai yang diisi oleh persetujuan umum pengguna. Baseline waktu menyiapkan bukti dan kebutuhan format harus diperiksa untuk menilai manfaat pilot.

**Calon skenario penerimaan:** bantuan uang/barang parsial menuju sumber laporan tanpa hitung ganda; akses privat lintas kontribusi ditolak; proof palsu/root tidak berwenang ditolak; NFT penerbit palsu atau versi digantikan tidak tampil sebagai bukti terkini; kegagalan penerbitan, pengembalian, selisih alokasi dan sengketa terlihat; verifikasi dapat diulang tanpa menggandakan catatan. Ini bahan spesifikasi, belum hasil tes.
