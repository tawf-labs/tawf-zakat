# ADR-0040: Satu Berita Acara Verifikasi untuk Seluruh Daftar Penerima

- Status: Accepted — 2026-10-01, keputusan pengguna setelah wawancara Lazismu Tangsel ([catatan kasar](../research/LAZISMU.md)).
- Related: ADR-0027 (Q13: dukungan dasar identitas/perwakilan), ADR-0038, ADR-0039.

Kebijakan dokumen bawaan sebelumnya mewajibkan surat permohonan untuk setiap pengajuan serta KTP/KK, bukti identitas alternatif, atau surat perwalian untuk setiap penerima. Untuk daftar berisi ratusan mustahik, persyaratan ini menjadi ratusan unggahan. Di Lazismu Tangsel, kelayakan warga dhuafa diverifikasi RT/RW yang paling mengenal warganya, dan salinan KTP/KK pun hanya diperoleh dari RT/RW. Lembaga tidak memeriksa sendiri setiap kartu identitas tersebut. Jadi foto KTP/KK per mustahik di aplikasi tidak menambah bukti di luar yang sudah dinyatakan RT/RW, tetapi memperlambat pengajuan. Permintaan bantuan juga tidak selalu datang sebagai proposal tertulis.

Keputusan: secara bawaan, pengajuan cukup dilengkapi satu dokumen kategori `RECIPIENT_VERIFICATION`, yaitu berita acara verifikasi penerima, misalnya surat keterangan atau data dari RT/RW, yang berlaku untuk seluruh daftar penerima. Surat permohonan, KTP/KK per penerima, bukti identitas alternatif, dan surat perwalian tidak lagi wajib secara bawaan. Dokumen-dokumen itu tetap dapat diunggah, dan lembaga yang SOP-nya memintanya dapat mewajibkannya kembali lewat kebijakan lembaga (`requireIdentityDoc` dan seterusnya). Dasar identitas per baris (NIK atau keterangan identitas alternatif) tetap diisi pada daftar penerima karena peringatan bantuan berulang bergantung padanya. Yang dipangkas hanya lampiran berkasnya.

Alternatif mempertahankan KTP/KK per penerima sebagai bawaan tidak dipilih karena biayanya ditanggung setiap pengajuan, padahal yang diverifikasi tetap RT/RW. Alternatif menjadikan mode satu dokumen sekadar opsi juga tidak dipilih karena belum ada UI pengaturan kebijakan, sehingga lembaga baru akan tetap terjebak pada alur lambat.

Konsekuensi:

- Bukti per orang di aplikasi menjadi lebih lemah. Pemeriksa tidak dapat mencocokkan setiap penerima dengan citra kartu identitasnya, hanya dengan NIK yang diketik dan dokumen verifikasi kelompok. Salinan KTP/KK yang diterima dari RT/RW tetap menjadi arsip lembaga di luar aplikasi.
- Kebijakan yang sudah disimpan lembaga tidak diubah. Kolom baru `require_recipient_verification` bernilai `FALSE` untuk baris lama, sedangkan lembaga tanpa kebijakan tersimpan mendapat bawaan baru.
- Unggah KTP/KK massal hanya ditampilkan jika kebijakan lembaga mewajibkan KTP/KK.
- "Berita acara" di sini adalah dokumen sebelum penyaluran dan berbeda dari BAST, yang menyatakan penyerahan bantuan.
