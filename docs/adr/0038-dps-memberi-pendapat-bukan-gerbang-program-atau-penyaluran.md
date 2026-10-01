# ADR-0038: DPS Memberi Pendapat Syariah, Bukan Gerbang Program atau Penyaluran

- Status: Accepted — 2026-10-01, berdasarkan wawancara staf eksekutif Lazismu Tangerang Selatan ([catatan kasar](../research/LAZISMU.md)).
- Related: ADR-0026, ADR-0027, ADR-0028, ADR-0030, ADR-0039 (MVP tanpa peran auditor dan DPS).
- Further supersedes: ADR-0006 untuk persetujuan DPS sebagai tahap sebelum penyaluran pada alur baru. ADR-0028 sudah melepas DPS sebagai gerbang universal, tetapi masih membuka DPS sebagai tahap persetujuan tersendiri; tahap itu kini tidak ada.

ADR-0028 memetakan persetujuan menurut SOP lembaga dan menyebut "keterlibatan pengawas syariah mengikuti SOP lembaga", sehingga pembaca masih dapat menganggap DPS sebagai tahap persetujuan yang tinggal diaktifkan. Wawancara di Lazismu Tangsel memberi gambaran yang berbeda. Dewan syariah di sana tidak mengurus keuangan dan hanya memberi pendapat. Program zakat, infak, maupun penghimpunan tidak diajukan kepada DPS. Program berjalan setelah lembaga memutuskannya: program inisiatif sendiri lewat rapat kepengurusan, sedangkan program arahan Lazismu pusat didanai pusat, umumnya dalam bentuk barang. Pelaksanaan keuangannya dipegang bendahara. Permintaan bantuan, baik dengan maupun tanpa proposal, tetap diverifikasi; kondisi warga dhuafa diverifikasi lewat RT/RW dengan fotokopi KTP/KK dan surat keterangan tidak mampu. Sumber BAZNAS Bengkalis pada riset 0005 juga tidak menempatkan DPS sebagai tahap keputusan pengajuan.

Keputusan:

1. **Program bantuan dibuka tanpa tahap persetujuan di aplikasi.** Membuka program merupakan keputusan lembaga di luar aplikasi, misalnya rapat kepengurusan atau arahan lembaga di atasnya. Aplikasi mencatat program yang sudah diputuskan dan tidak menyediakan status "menunggu persetujuan". Perilaku kode saat ini (program langsung `ACTIVE`) kini merupakan pilihan yang disengaja.
2. **Alur pengajuan penyaluran tidak memiliki tahap persetujuan DPS.** Kontrol sebelum penyaluran tetap terdiri dari pemeriksa pengajuan dan pemberi persetujuan penyaluran sesuai ADR-0028. Jika SOP mitra menunjuk anggota DPS sebagai pemberi persetujuan, orang tersebut menerima fungsi pemberi persetujuan melalui mandat operasional (ADR-0030), bukan melalui tahap DPS terpisah.
3. **Pendapat syariah DPS bukan status alur.** Jika lembaga ingin mencatatnya, pendapat DPS diperlakukan sebagai dokumen pendukung. Ketiadaan pendapat itu tidak menahan program atau pengajuan.

Alternatif tahap DPS opsional yang dapat diaktifkan per lembaga tidak dipilih. Dua lembaga yang sejauh ini menjadi acuan tidak memiliki tahap tersebut, sementara tahap opsional menambah jalur status, label, dan pengujian tanpa ada mitra yang membutuhkannya. Jika kelak ada mitra yang SOP-nya mewajibkan persetujuan DPS terpisah dari pemberi persetujuan, keputusan ini perlu dibuka kembali, termasuk pertanyaan apakah hal itu cukup dipenuhi lewat mandat.

Batas bukti: sumbernya satu wawancara di satu LAZ tingkat kota dengan satu narasumber, dan catatannya masih berupa catatan kasar, bukan salinan SOP bertanda tangan. Keputusan ini tidak menyatakan bahwa DPS di semua LAZ atau di seluruh Lazismu tidak memiliki kewenangan persetujuan. Pengguna memastikan bahwa "orang keuangan" yang menjalankan program adalah bendahara. Bendahara tetap dipetakan lewat mandat sesuai SOP lembaga, bukan dijadikan peran baku di aplikasi.

Konsekuensi:

- Jalur vault USDC lama (ADR-0006, ADR-0015, `SHARIA_SUPERVISOR_ROLE`, serta tahap `PERSETUJUAN_DPS` di `backend/src/disbursement-duration.ts`) tidak berubah dan tetap menjadi jalur lama. Angka durasi dari jalur itu tidak boleh disajikan sebagai durasi alur pengajuan baru.
- Label akun contoh "DPS approver" di `backend/src/scripts/pilot-database-bootstrap.ts` diganti menjadi "Pemberi persetujuan sintetis". Basis data pilot yang sudah dibootstrap tetap memakai label lama sampai dibootstrap ulang.
- ADR-0016 butir 5, yaitu meminta pendapat syariah tertulis dari DPS lembaga mitra sebelum skema harga ditawarkan, sejalan dengan peran DPS sebagai pemberi pendapat.
