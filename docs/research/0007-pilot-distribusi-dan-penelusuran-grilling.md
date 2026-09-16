# Pilot distribusi dan penelusuran — sesi grill-with-docs

Catatan sumber: diagram dan percakapan pendamping telah dibaca saat riset. Berkas asal di `docs/temp` tidak tersedia dalam repositori ini; temuan dan keputusan yang dipakai dicatat dalam dokumentasi berikut.

- Tanggal mulai: 2026-09-16.
- Status: wawancara selesai; Q1–Q3, Q5–Q12, prinsip Q13a, Q14–Q16, Q17a, Q18–Q32 dan Q34–Q40 diterima; Q33 menetapkan NFT wajib pilot. Q4 menerima pendekatan satu kegiatan nyata dengan kondisi pilot masih terbuka. Putaran 10 diterima. Pengguna mengonfirmasi pemahaman bersama pada 2026-09-16; rincian teknis dan kondisi mitra tetap terbuka. ZK keanggotaan kontribusi tetap berprioritas tinggi.
- Metode: skill `grill-with-docs`, melalui `grilling` dan `domain-modeling`.
- Tujuan: menyelaraskan diagram riset teman pengguna dengan arah ZKT, dukungan sembako/uang, bukti untuk lembaga dan donatur, serta pekerjaan #86 yang sudah berjalan.
- Dasar: [pemetaan dan koreksi konteks](../design/pilot-voucher-traceability-mapping.md), [strategi](../strategy/README.md), [CONTEXT](../../CONTEXT.md), ADR-0016–0030, riset 0002–0005, diagram dari riset teman pengguna dan percakapan pendamping (`research_temp.txt`).

## Konteks yang sudah diberikan pengguna

- Stakeholder membutuhkan fitur siap dipakai dalam pilot.
- Diagram merupakan kesimpulan riset teman pengguna. Nama `research_temp` hanya nama berkas, bukan status kualitas atau persetujuannya.
- Sembako dan uang tunai perlu ditelusuri secara transparan tanpa tumpang tindih.
- Pengguna meminta pemetaan pekerjaan lama dan pembacaan konteks proyek sebelum memperinci desain baru.
- Spec #86 dan keputusan lama belum diganti. Snapshot pemeriksaan sesi sebelumnya: #87–#91 CLOSED, #92–#99 OPEN.

Rekomendasi dalam dokumen pemetaan belum otomatis menjadi keputusan yang disetujui. Makna voucher dan batas akses donatur kini diterima pada Q9/Q11; hubungan kegiatan/pengajuan dan konfirmasi kemudian diperinci pada Q14/Q16. Nama tampilan serta rincian teknis tetap terbuka.

## Pohon keputusan

```text
Q1 Hasil minimum yang wajib dibuktikan pilot
├─ alur lengkap dan batas fitur pertama
├─ keluaran donatur / lembaga / pemeriksa
└─ ukuran penerimaan dan urutan tiket

Q2 Kedudukan organizer terhadap Pengelola Zakat
├─ pemilik data, akun kerja, mandat dan persetujuan
├─ pihak yang menerima/mengeluarkan dana
└─ hubungan mitra, petugas lapangan dan penerima

Q3 Bagian diagram yang sudah menjadi komitmen tetap
├─ arti campaign dan voucher; hubungan dengan program/pengajuan
├─ bukti penerimaan dan pilihan OTP/QR
└─ NFT, publikasi, akses serta koreksi

Q4 Kondisi pilot yang diketahui
├─ tenggat, volume dan bentuk kegiatan
├─ perangkat, koneksi serta jalur kegagalan
└─ masukan/keluaran nyata dan kriteria siap pakai

Hasil Q1–Q4
└─ rincian bantuan dan alokasi → realisasi → bukti → rekonsiliasi/laporan
   → revisi/sisa/kegagalan → pengujian → dampak pada tiket/ADR
   → konfirmasi pemahaman bersama
```

## Putaran 1 — dijawab

| Pertanyaan | Pilihan/rekomendasi yang diajukan | Status |
| --- | --- | --- |
| Q1: hasil minimum pilot | Satu alur terbatas menghasilkan penelusuran donatur dan paket bukti yang dapat dipakai amil; alternatif mendahulukan salah satunya. | Diterima: pengguna setuju rekomendasi C. |
| Q2: kedudukan organizer | Organizer adalah petugas/unit di bawah penugasan satu Pengelola Zakat. | Diterima; pengguna menyatakan riset temannya belum mencakup organisasi independen dan lingkupnya BAZNAS/LAZ. |
| Q3: kekuatan komitmen diagram | Pertahankan tujuan dan lima tahap sebagai acuan; mekanisme rinci boleh dibahas dengan alasan tercatat. | Diterima; pengguna meminta GoBarakah ditelusuri sebagai inspirasi tambahan. |
| Q4: konteks pilot | Gunakan satu kegiatan nyata; rincian yang belum diketahui tetap terbuka. | Pendekatan diterima. Mitra, tanggal, skala, dan koneksi belum ditentukan; bukan persetujuan atas nilai asumsi tertentu. |

Q1/Q2 dicatat pada [ADR-0031](../adr/0031-institutional-pilot-donor-traceability-and-evidence.md); istilah Penyelenggara kegiatan ditambahkan ke CONTEXT. Q3 tidak otomatis menyetujui QR, TOTP, NFT atau protokol tertentu. Fakta GoBarakah ditelusuri dalam [riset pembanding](0008-gobarakah-e-voucher.md); mekanisme platform lain belum menjadi keputusan ZKT.

GoBarakah memperjelas cabang keputusan Q5: voucher sebagai hak penerima untuk menebus pada vendor memerlukan alur berbeda dari penyerahan langsung oleh petugas pada diagram. Mode distribusi dari dana yang sudah tersedia juga menjadi pembanding untuk Q6. Ini merupakan masukan wawancara, bukan alasan otomatis mengganti diagram atau spec lama.

## Putaran 2 — dijawab

| Pertanyaan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q5: penyerahan oleh petugas atau penebusan pada merchant | Mulai dari penyerahan langsung sesuai diagram; penebusan merchant menjadi cabang tersendiri bila kebutuhan mitra mengharuskannya. | Diterima |
| Q6: sumber pendanaan kegiatan pertama | Mulai dari dana yang sudah diterima lembaga beserta catatan kontribusinya; penggalangan baru dalam ZKT dinilai sebagai perluasan. | Diterima |
| Q7: peran ZKT dalam pencairan | Pertahankan pembayaran oleh lembaga; aplikasi mencatat kewenangan, status, dan bukti. Integrasi eksekusi merupakan keputusan tambahan. | Diterima |
| Q8: keluaran kerja amil | Rekap kegiatan, realisasi/sisa per penerima, indeks bukti dan sumber laporan periode yang dapat ditelusuri; format resmi tidak dijanjikan tanpa contoh mitra. | Diterima |

Pengguna menjawab, “semuanya saya ikuti rekomendasimu”. Cakupan Q5–Q8 ditambahkan ke ADR-0031. Ini menyepakati batas pilot; bukan persetujuan otomatis atas mekanisme turunan atau perubahan tracker.

Pilihan Q5 dan Q6 membuka pertanyaan arti voucher serta pengalokasian kontribusi. Q7 membuka rincian pembayaran, konfirmasi dan rekonsiliasi. Q8 membuka format, penerima keluaran dan skenario penerimaan. Detail kondisi lapangan Q4 tetap merupakan prasyarat untuk menyatakan kesiapan pilot; belum memblokir pembahasan batas produk ini.

## Putaran 3 — arti penelusuran dan batas bukti

| Pertanyaan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q9: arti voucher dalam penyerahan langsung | Bukti kontribusi/kode penelusuran donatur; hak bantuan penerima tetap berasal dari rincian pengajuan yang disetujui. Jangan menciptakan hak bantuan kedua hanya karena voucher ada. | Diterima |
| Q10: ketelitian hubungan kontribusi dan bantuan | Mulai dari kontribusi ke kegiatan dengan pendanaan gabungan dan penandaan jenis dana/peruntukan. Tampilkan hasil kegiatan; klaim alokasi ke penerima tertentu hanya jika ada dasar tercatat dan tidak terhitung ganda. | Diterima |
| Q11: batas akses donatur dan publik | Publik mendapat agregat; donatur mendapat catatan kontribusinya dan progres kegiatan terkait; identitas, kontak, foto wajah, dan dokumen lengkap penerima tetap terbatas. | Diterima |
| Q12: syarat menyatakan bantuan diterima | Bedakan catatan petugas dan konfirmasi penerima/perwakilan. Nilai/jumlah aktual, waktu, petugas, dan bukti konfirmasi dicatat; konfirmasi yang belum ada tetap ditandai, bukan otomatis lengkap. | Diterima |
| Q13: peran blockchain/NFT pada pilot | Usulan awal: registry paket bukti dan NFT per penyerahan bukan syarat pilot. | Belum diterima; pengguna meminta penelusuran lebih dalam karena ketua tim mungkin menginginkan NFT. |

Q9–Q12 dicatat pada [ADR-0032](../adr/0032-contribution-traceability-and-recipient-confirmation.md) dan glosarium. Pengguna kemudian menjelaskan tujuan NFT menurut pengetahuannya: **bukti distribusi yang bisa diverifikasi**. Kewajiban memakai token belum dikonfirmasi. Riset Q13 membandingkan fungsi token, pengikatan bukti, akses, koreksi, dan beban operasional tanpa menganggap NFT wajib atau ditolak. Pembanding harus mencakup bukti per kejadian tanpa NFT; kebutuhan verifikasi lebih awal daripada laporan periode tidak dengan sendirinya mengharuskan tokenisasi.

Q9/Q10 mendahului identitas kegiatan/campaign, struktur alokasi, koreksi dan penanganan dana tersisa. Q11 mendahului cara akses donatur serta publikasi. Q12 mendahului protokol OTP/QR/BAST, perwakilan, kegagalan konfirmasi dan koneksi. Q13 mendahului rincian pengikatan bukti distribusi ke paket laporan; keberadaan desain registry tidak membuktikan implementasinya telah siap.

### Pendalaman Q13

[Riset NFT](0009-nft-untuk-bukti-distribusi-pilot.md) membandingkan NFT dengan registry/atestasi, termasuk bukti per kejadian tanpa token. Pemeriksaan kode pada sesi ini menemukan implementasi registry laporan dan verifier lokal; kesiapan deployment serta perluasan untuk konfirmasi distribusi tidak diverifikasi. Pernyataan historis ADR-0022 tentang belum adanya implementasi tidak dipakai sebagai deskripsi kondisi kode sekarang.

Kesimpulan riset yang diajukan untuk dibahas: kebutuhan verifikasi distribusi belum membuktikan kebutuhan kepemilikan token. NFT dapat menjadi sertifikat pernyataan lembaga atas kegiatan/tahap penyaluran, tetap merujuk sumber bukti yang sama dengan laporan. Kebutuhan pembekuan isi, akses terbatas, koreksi dan pemeriksaan penerbit tetap ada pada kedua pilihan. NFT sertifikat lembaga merupakan opsi bersyarat, bukan keputusan yang telah diterima.

**Q13a diterima:** pengguna mengikuti rekomendasi untuk menetapkan kemampuan verifikasi sebagai syarat utama dan NFT sebagai pilihan bentuk sertifikat. Dicatat pada ADR-0032. Ini bukan konfirmasi bahwa ketua tim mewajibkan atau membatalkan NFT. Kebutuhan integrasi aplikasi luar yang mengonsumsi token serta pemilihan mekanisme masih terbuka. Cabang ini tidak mengubah penerimaan Q9–Q12.

## Putaran 4 — hubungan kegiatan, dana, dan operasi lapangan

| Pertanyaan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q14: kegiatan yang ditelusuri donatur | Untuk pilot pertama, satu pengajuan dalam satu program menjadi cakupan kegiatan yang ditelusuri; halaman donatur menyajikan progresnya, tanpa membuat proses persetujuan paralel. Bukan aturan permanen satu program hanya satu kegiatan. | Diterima |
| Q15: pencatatan alokasi kontribusi | Catat nominal kontribusi yang dialokasikan pada setiap kegiatan, pertahankan jenis dana/peruntukan, cegah total alokasi melebihi kontribusi tercatat. Sisa belum dialokasikan tetap terlihat dan tidak otomatis dipindahkan. Ini catatan alokasi, bukan verifikasi saldo bank. | Diterima |
| Q16: cara konfirmasi penerimaan | OTP sebagai jalur utama bila kontak penerima/perwakilan tersedia; penerima mengetahui jenis/jumlah yang dikonfirmasi. Sediakan tanda terima/BAST sebagai jalur pengganti yang diperiksa petugas lain. Metode dan kelengkapan bukti tetap dibedakan. Tidak otomatis mensyaratkan aplikasi offline. | Diterima |
| Q17: akses donatur pada pilot | Donatur dapat mengakses catatan kontribusinya dan progres kegiatan melalui akses pribadi yang diverifikasi, tanpa wallet wajib. | Belum diterima; pengguna meminta penelusuran alur donasi tanpa login, dengan bukti melalui email/WhatsApp. |
| Q18: kapan bukti/progres dapat dilihat | Progres operasional yang sudah dicatat dan diperiksa dapat ditampilkan dengan status konfirmasi yang jelas; bukti terverifikasi diterbitkan setelah pengesahan lembaga atas cakupan tertentu, tanpa wajib menunggu laporan periode. Pengesahan laporan/validator tetap mengikuti ADR-0022. | Diterima |

Q14–Q16 dan Q18 dicatat pada [ADR-0033](../adr/0033-pilot-activity-allocation-confirmation-and-publication.md). Q17 perlu membedakan pembayaran tanpa pendaftaran akun, pengiriman bukti, akses transaksi tertentu, dan pembukaan seluruh riwayat pribadi. Tidak ada keputusan untuk mewajibkan akun atau wallet bagi donatur.

Pengguna juga menyatakan proses verifikasi bukti zakat masih mock padahal seharusnya menggunakan ZK. Ini menjadi pemicu pemeriksaan implementasi aktif, bukan langsung disimpulkan bahwa seluruh verifikasi proyek palsu atau bahwa keberadaan artefak circuit membuktikan integrasi. Ekspektasi ZK nyata dicatat; statement yang hendak dibuktikan, cakupan privat/publik, jalur produk, dan kaitannya dengan pengesahan laporan perlu diselesaikan berdasarkan temuan kode. Tanda tangan, Merkle inclusion, dan zero-knowledge proof harus dibedakan.

### Pendalaman Q17 dan kebutuhan ZK

[Riset akses tanpa akun](0010-akses-donatur-tanpa-akun.md) mendukung pemisahan pembayaran tamu, pengiriman bukti, akses satu kontribusi, dan riwayat pribadi. Rekomendasi revisi Q17: tanpa pendaftaran wajib; bukti/akses per kontribusi dikirim melalui kontak yang terkait bila tersedia, ringkasan kegiatan tetap publik, akun riwayat opsional. Tautan terbatas dan OTP merupakan alternatif autentikasi akses, bukan bukti pembayaran. Sumber kontak, pengiriman ulang, kontak bersama dan data historis tetap perlu diperinci.

Inspeksi awal kode lokal menemukan [SearchReceiptForm](../../frontend/src/features/verification/SearchReceiptForm.tsx) menetapkan `isValid: true` tanpa memanggil `verifyClientProof`, memakai fallback root/proof, serta menghasilkan bukti contoh dan toast berhasil untuk ID berisi `TRX-`/`USDC-` ketika respons API tidak OK. Ini masalah konkret pada jalur donor; tidak menyimpulkan seluruh verifier laporan proyek mock. Temuan ini perlu masuk pekerjaan kesiapan pilot tersendiri, dan tidak dipenuhi hanya dengan menambahkan NFT.

[Hasil pemeriksaan lengkap](0011-status-verifikasi-bukti-dan-zk.md) mengonfirmasi badge sertifikat statis, lookup donor tanpa pemeriksaan kepemilikan kontribusi, serta perbedaan Merkle/signature nyata dari ZK. Verifier ZK lama merupakan placeholder yang menolak proof; pipeline dan circuit arsip belum membentuk jalur aktif. Inspeksi ini statis: deployment dan runtime tidak diperiksa. Kebutuhan membangun ZK nyata tidak boleh dinyatakan selesai hanya dengan menghubungkan pemeriksaan Merkle yang sudah ada.

| Pertanyaan lanjutan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q17a: pola akses tanpa akun | Tidak wajib mendaftar; kirim bukti/akses satu kontribusi ke kontak terkait, progres umum publik, riwayat akun opsional. | Diterima |
| Q19: statement ZK pertama | Mulai dari membuktikan catatan kontribusi termasuk kumpulan catatan yang disahkan lembaga tanpa membuka identitas/nominal ke publik; tidak otomatis membuktikan pembayaran bank atau penyerahan bantuan fisik. ZK untuk perhitungan laporan/distribusi merupakan statement berbeda yang perlu dipilih eksplisit. | Diterima; pengguna menegaskan prioritas tinggi sebagai nilai jual teknologi. |

Pengguna menunjuk [paper PDF](../../archive/zk-private-zakat.pdf) dan [LaTeX](../../archive/zk-private-zakat.tex) sebagai dasar riset. Penerimaan Q17a diperbarui pada ADR-0033; Q19 dicatat pada [ADR-0034](../adr/0034-private-contribution-membership-zk-priority.md). Paper dibaca untuk membedakan arah riset, hasil historis, keterbatasan yang diakui, dan kebutuhan circuit pilot; bukan otomatis bukti bahwa pipeline saat ini sudah siap.

[Riset perbandingan paper](0012-paper-zk-dan-cakupan-pilot.md) menemukan bahwa verifikasi UltraHONK penuh masih disebut pekerjaan lanjutan pada paper, circuit arsip tidak memeriksa membership terhadap batch berwenang, dan benchmark lama belum direproduksi untuk statement baru. Hasil tersebut memperjelas pekerjaan Q19, tidak membatalkan prioritas tinggi yang ditetapkan pengguna.

## Putaran 5 — batas kepercayaan ZK prioritas tinggi

| Pertanyaan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q20: pihak yang tidak boleh melihat data privat | Lindungi identitas/nominal dari publik; lembaga dan layanan pemroses yang diberi kewenangan tetap boleh mengolahnya untuk proving. Privasi juga terhadap operator prover memerlukan jalur berbeda dan belum diasumsikan. | Diterima |
| Q21: lokasi verifikasi proof | Untuk menutup keterbatasan paper dan kebutuhan teknologi prioritas tinggi, gunakan verifier ZK nyata di smart contract, dengan kemampuan pemeriksaan mandiri; bukan hanya anchor hash. Kelayakan ukuran, biaya, dan pipeline perlu dibuktikan, bukan memakai angka benchmark lama. Alternatif: verifier independen di luar chain dengan root berwenang dicatat di chain. | Diterima: verifier ZK di smart contract |
| Q22: kelayakan catatan masuk batch | Hanya catatan penerimaan yang dicocokkan dengan sumber lembaga dan disahkan pihak berwenang; impor/unggah bukti saja belum cukup. Sumber dapat berasal dari proses lembaga yang sudah ada, tanpa mewajibkan dana lewat ZKT. | Diterima |

Q20–Q22 diperbarui pada ADR-0034 dan istilah Batch kontribusi ditambahkan ke glosarium. Pengguna mengizinkan riset baru karena paper arsip mungkin bukan pilihan paling sesuai. Literatur dinilai terhadap statement dan batas aktor yang sudah diterima, serta kemampuan implementasi/verifikasi onchain; tanggal terbit saja tidak menjadi alasan mengganti desain.

[Riset literatur 0013](0013-literatur-zk-untuk-bukti-kontribusi.md) membandingkan landasan set-membership 2023, zkLedger 2018, konsistensi lintas ledger 2024, PADL 2025, dan flow tracing 2026. Rekomendasi teknisnya ialah proof keanggotaan yang terikat receipt tertentu dan batch sah, bukan mengganti sistem menjadi ledger pembayaran privat. Komitmen acak dengan Merkle biasa juga dapat merahasiakan isi; manfaat tambahan ZK pada posisi/path anggota serta korespondensi receipt–catatan perlu diperjelas dalam statement. Ini perincian yang diusulkan untuk Q19, bukan implementasi selesai atau pilihan library RSA dari paper.

[Riset toolchain 0014](0014-kelayakan-toolchain-zk-onchain.md) menemukan pipeline resmi generated Solidity verifier. Noir/Barretenberg menjadi kandidat pertama uji kelayakan terbatas, dengan Circom/snarkjs Groth16 sebagai pembanding bila ada hambatan terukur. Ini rekomendasi riset, belum pilihan stack: pasangan versi dan circuit pilot belum dijalankan, ukuran verifier/gas belum diukur. Verifier read-only melalui `eth_call` dibedakan dari transaksi yang mencatat hasil persisten; Q23 memperinci kebutuhan ini tanpa mengubah kewajiban proof nyata Q21.

## Putaran 6 — hasil verifikasi dan koreksi

| Pertanyaan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q23: apakah hasil verifikasi harus tercatat sebagai transaksi | Catat keberhasilan verifikasi proof nyata sekali per versi receipt di smart contract; pemeriksaan ulang tidak perlu transaksi baru. Prover/pengirim transaksi berwenang dapat melayani donatur tanpa wallet wajib, sementara pembayar biaya dan operasi perlu ditetapkan. Alternatifnya pemanggilan verifier read-only tanpa hasil/event persisten. | Diterima |
| Q24: koreksi batch/receipt | Pertahankan bukti lama sebagai riwayat dengan status digantikan; terbitkan versi koreksi yang disahkan dan proof yang sesuai. Validitas matematis proof terhadap root lama dibedakan dari keberlakuan versi saat ini. | Diterima |

Pengguna menerima seluruh rekomendasi putaran ini. Keputusan dicatat pada ADR-0034 dan istilah Versi bukti kontribusi pada glosarium. Ini tidak memilih toolchain atau mengubah status implementasi. Pencatatan ulang proof tidak boleh menggandakan nilai kontribusi/realisasi.

## Putaran 7 — operasi penerbitan, akses, dan pengecualian — dijawab

| Pertanyaan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q25: operasi dan anggaran penerbitan | Setelah batch disahkan, layanan berwenang memproses proof dan mengirim transaksi dalam batas anggaran. Biaya dari anggaran layanan/pilot yang disepakati, tidak dipotong otomatis dari kontribusi dan tidak menuntut wallet donatur. Penanggung jawab serta nominal anggaran tetap harus ditetapkan sebelum operasi nyata. | Diterima |
| Q26: penerimaan tercatat tetapi proof belum terbit | Bukti penerimaan lembaga dapat tersedia lebih dahulu dengan status verifikasi ZK masih diproses/bermasalah. Status terverifikasi hanya setelah keberhasilan pemeriksaan dan transaksi dikonfirmasi; kegagalan proving/publikasi tidak otomatis membatalkan penerimaan dana atau disamarkan sebagai sukses. | Diterima |
| Q27: perlindungan rincian melalui pesan | Pesan berisi pemberitahuan minimum dan akses progres umum; rincian pribadi kontribusi dibuka setelah kode ke kontak terkait, tanpa pendaftaran/password. Sesi terbatas menghindari pengulangan kode setiap halaman. Kanal dan durasi belum dipilih. | Diterima |
| Q28: koreksi nominal berdampak pada alokasi | Catat koreksi yang disahkan tanpa menimpa realisasi. Jika alokasi melebihi kontribusi terkoreksi, tampilkan selisih, hentikan alokasi tambahan yang memperburuk selisih, dan minta keputusan lembaga untuk penyelesaian; jangan membagi ulang atau memindahkan dana otomatis. | Diterima |

Pengguna menjawab, “saya setuju dengan semua rekomendasimu”. Q25/Q26 dicatat pada ADR-0034 dan Q27/Q28 pada ADR-0033; riset akses tanpa akun diberi penunjuk ke pilihan OTP yang telah diterima. Penanggung jawab dan nominal anggaran belum ditetapkan oleh jawaban ini.

## Konsolidasi sebelum penutupan arah produk

Arah yang telah diterima: satu kegiatan lembaga memakai pengajuan, penerima, persetujuan dan realisasi yang sama untuk pekerjaan amil, penelusuran donatur, serta sumber laporan periode. Kontribusi dialokasikan eksplisit tanpa penghitungan ganda; uang dan barang dicatat menurut realisasinya. Akses privat donatur memakai OTP tanpa akun wajib. ZK keanggotaan kontribusi terhadap batch berwenang tetap berprioritas tinggi, diverifikasi di smart contract dan dicatat sekali per versi. Penerimaan dana, konfirmasi penyaluran, status proof dan pengesahan laporan merupakan klaim terpisah.

Pembacaan ulang [wawancara pengajuan](0005-pengajuan-penyaluran-dan-ux-grilling.md) dan ADR-0026–0030 menunjukkan bahwa perwakilan penerima, bantuan parsial, revisi dengan persetujuan kembali, penutupan sisa, serta pemisahan penyusun/pengesah/auditor sudah diputuskan. Topik tersebut tidak perlu diwawancarai ulang. Pembatalan pengajuan yang sudah diputuskan tidak otomatis menentukan pengembalian kontribusi donatur.

### Putaran 8 — pengecualian — dijawab

| Pertanyaan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q29: kontak donatur salah, bersama, kosong atau hilang akses | Pertahankan kontribusi dan progres publik. Pembukaan akses privat/perubahan kontak memerlukan pemeriksaan petugas berwenang dengan dasar hubungan ke kontribusi serta jejak perubahan. Nomor referensi saja tidak cukup. Kontak bersama tidak membuka seluruh riwayat; akses lama dicabut saat pemulihan mengharuskannya. | Diterima |
| Q30: pembatalan atau pengembalian kontribusi setelah alokasi/proof | ZKT mencatat keputusan lembaga dan realisasi pengembalian sebagai kejadian terpisah; lembaga menjalankan pembayaran di luar ZKT. Pertahankan riwayat penerimaan/proof, perbarui status keberlakuan serta alokasi, dan tandai selisih tanpa menimpa penyaluran yang sudah terjadi. Ini tidak menetapkan hak refund otomatis atau kebijakan baru untuk zakat. | Diterima setelah klarifikasi |
| Q31: penerima menyangkal penerimaan atau jumlah yang tercatat | Pertahankan catatan dan bukti, beri status diperselisihkan pada bagian terkait, tahan klaim konfirmasi final atas bagian tersebut, dan catat pemeriksaan serta keputusan/koreksi lembaga. Jika bukti sudah terbit, tampilkan status sengketa/koreksinya; konfirmasi OTP sebelumnya tidak menutup jalur keberatan. | Diterima setelah klarifikasi |

Pengguna menerima Q29. Untuk Q30, pengguna meminta arti pengembalian; untuk Q31, pengguna menanyakan apakah pemicunya temuan auditor. Kedua pertanyaan klarifikasi semula tidak dianggap persetujuan. Setelah penjelasan, pengguna menyetujui seluruh rekomendasi Q30/Q31 dan meminta pemeriksaan ulang cabang sebelum pembahasan ZK. Keputusan diperbarui pada ADR-0033 dan istilah terkait pada glosarium.

Penjelasan Q30: pengembalian berarti uang benar-benar dikirim kembali oleh lembaga kepada pengirim setelah keputusan lembaga, misalnya penanganan transfer ganda yang telah diperiksa. Ini berbeda dari satu transfer yang keliru dicatat dua kali (koreksi data) atau sisa alokasi kegiatan (belum otomatis dikembalikan). Rekomendasi mencakup pencatatan kejadian dan bukti jika terjadi; tidak menetapkan kebolehan, hak refund zakat, atau tombol pembatalan bebas bagi donatur.

Penjelasan Q31: keberatan penerima mengenai jumlah/penerimaan dapat muncul langsung atau melalui pemeriksaan petugas/auditor. Temuan auditor tetap dicatat pada alur temuan dan tanggapan yang sudah diputuskan pada Q23 wawancara 0005. Dokumen kurang atau kejanggalan saja tidak otomatis berarti penerimaan diperselisihkan atau kecurangan terbukti. Usulan status diperselisihkan berlaku ketika ada pertentangan konkret atas klaim penerimaan; kasus kekurangan bukti tetap dibedakan. Hasil pemeriksaan/koreksi mengikuti kewenangan lembaga, tanpa memberi auditor kewenangan mengubah transaksi.

Ketiga pertanyaan menutup pengecualian yang belum diselesaikan aturan lama. Permintaan pemeriksaan ulang pengguna membuka audit kelengkapan sebelum rangkuman pemahaman bersama dan penurunan perubahan spec/tiket. Pada saat penutupan putaran 8, NFT masih pilihan bentuk sertifikat menurut Q13a. Q33 kemudian mewajibkan NFT untuk pilot; standar token dan integrasi aplikasi luar belum dipilih.

## Audit kelengkapan cabang sebelum ZK

Pengguna meminta pemeriksaan ulang agar pertanyaan sebelum ZK tidak terlupakan. Pembacaan silang mencakup pohon Q1–Q18, ADR-0026–0034, wawancara 0005, seluruh tujuh pertanyaan awal pada pemetaan, dan langkah diagram/teks teman. Kesimpulan sebelumnya bahwa tinggal tiga pengecualian terlalu cepat: bukti distribusi dan biaya/alokasi kegiatan masih menyimpan keputusan produk, bukan semuanya rincian teknis.

| Cabang awal | Keputusan yang sudah ada | Sisa dan tindak lanjut |
| --- | --- | --- |
| Q1/Q8: hasil donatur dan amil | Satu alur, rekap realisasi/sisa, indeks bukti dan sumber laporan; tidak menggandakan input | Arti penyelesaian kegiatan Q36; format mitra dan ukuran keberhasilan operasional memerlukan contoh/baseline |
| Q2/Q5/Q7: lembaga, penyelenggara dan pembayaran | Petugas lembaga, penyerahan langsung, pembayaran oleh lembaga; mandat, operator dan pengesah terpisah | Batas pencatatan biaya/uang muka Q34; nama pejabat/mandat nyata divalidasi ke mitra |
| Q3/Q6: diagram dan pendanaan | Diagram acuan yang dapat diperinci; dana sudah diterima lembaga; penggalangan baru bukan prasyarat | Target crowdfunding bukan gerbang pilot yang otomatis wajib; jangan menambahkan kewajiban seluruh realisasi sudah teratribusi ke donor. Cakupan keterlacakan yang belum lengkap harus terlihat |
| Q9/Q10/Q14/Q15: voucher, kegiatan, alokasi | Referensi kontribusi, pendanaan gabungan, satu pengajuan untuk kegiatan awal, nominal eksplisit dan peruntukan tetap | Pengalihan alokasi yang disengaja Q35; tidak diselesaikan oleh koreksi nominal Q28 atau pengembalian Q30 |
| Q11/Q17: akses dan foto | Agregat publik, akses pribadi satu kontribusi lewat OTP tanpa pendaftaran, foto wajah/identitas terbatas; pemulihan Q29 | Kanal dan durasi menjadi spesifikasi; tidak membuka kembali foto penerima untuk NFT |
| Q12/Q16: konfirmasi lapangan | Uang/barang parsial, OTP atau BAST diperiksa petugas lain, dasar perwakilan dari aturan lama, kekurangan bukti dibedakan dari sengketa Q31 | Protokol anti-duplikasi, rincian unggahan dan SOP menjadi spesifikasi; offline penuh/QR/TOTP/GPS tidak otomatis masuk karena ada dalam brainstorming |
| Q13a/Q18: bukti distribusi dan NFT | Verifiabilitas wajib, token hanya opsi, bukti sebelum laporan periode setelah pengesahan lembaga | Bentuk/cakupan/siklus bukti distribusi Q32 dan masuk/tundanya NFT Q33; ZK kontribusi tidak menutup keduanya |
| Sembako/uang dan biaya pada diagram 7–13 | Uang dan kuantitas barang terpisah, penyedia berbeda dari penerima manfaat, realisasi bertahap | Q34 menetapkan batas pencatatan biaya dan dasar nilai barang; harga rencana belum menjadi biaya aktual atau nilai bantuan diterima |
| Q4: kondisi dan penerimaan pilot | Satu kegiatan nyata sebagai acuan; kondisi belum diisi dengan asumsi | Mitra, tenggat, volume, perangkat/koneksi, kanal, SOP, contoh keluaran dan anggaran tetap fakta yang perlu dikonfirmasi sebelum siap pakai |
| Pekerjaan #86–#99 | Pemetaan sudah tersedia, tidak ada bukti seluruh tiket lama perlu dibuang; dependensi belum diubah | Rencana irisan implementasi dan pembaruan spec disusun setelah cakupan produk terkonsolidasi; tidak menyamakan CLOSED dengan lolos pilot |

### Putaran 9 — keputusan yang ditemukan kembali — dijawab

Pengguna menerima rekomendasi Q32 dan Q34–Q36, tetapi memilih **NFT harus masuk pilot** pada Q33. Rekomendasi menunda NFT tidak diterima. Keputusan satu baris tidak otomatis memilih rincian teknis pada baris lainnya.

| Pertanyaan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q32: unit dan siklus bukti distribusi | Terbitkan sertifikat per tahap penyaluran yang disahkan pejabat lembaga berwenang, merujuk realisasi dan konfirmasi yang sama. Catat pengesahan/rujukan versi di chain agar penerbit, integritas dan status dapat diperiksa tanpa membuka berkas privat. Tidak menunggu seluruh kegiatan/laporan periode. Koreksi mempertahankan versi lama dan menaut pengganti; sengketa Q31 tercermin pada status cakupan terkait. Ini bukti pernyataan lembaga tentang penyaluran, bukan ZK kontribusi atau bukti blockchain mengamati kejadian fisik. | Diterima |
| Q33: apakah NFT termasuk hasil wajib pilot | Gunakan sertifikat distribusi yang dapat diverifikasi sebagai hasil dasar pilot; tunda penerbitan token NFT. Jika dipilih masuk pilot, standar, pemegang, transfer dan koreksinya perlu putaran lanjutan. Q13a sebelumnya hanya membuat NFT opsional, belum menyetujui penundaan implementasinya. | Pengguna memilih NFT wajib pilot; usulan tunda ditolak |
| Q34: lingkup biaya dan nilai sembako | Catat nominal/tujuan/pihak penerima pembayaran serta referensi dokumen biaya lembaga yang terkait kegiatan. Bedakan uang muka ke petugas, biaya aktual dan penyerahan barang. Kuantitas/satuan menjadi catatan utama barang; nilai IDR hanya dengan dasar/sumber yang jelas, estimasi terpisah dari aktual. Pembelian dan serah terima bukan dua nilai bantuan yang dijumlahkan. Pertanggungjawaban yang belum selesai tetap terlihat; tidak membangun pengadaan atau inventori lengkap. Kebijakan valuasi dan pembebanan biaya mengikuti lembaga. | Diterima |
| Q35: pengalihan sisa alokasi | Pengalihan memerlukan keputusan pihak berwenang, alasan dan riwayat yang terlihat pada penelusuran donatur. Hanya bagian yang dinyatakan masih tersedia setelah memeriksa penggunaan dan kewajiban kegiatan; belum diserahkan ke penerima tidak otomatis berarti bebas dialihkan. Pertahankan jenis dana/peruntukan dan realisasi terdahulu; alokasi ke peruntukan yang tidak sesuai tidak dibenarkan oleh keputusan pemindahan saja. | Diterima |
| Q36: arti kegiatan selesai bagi donatur | Turunkan status penyaluran dari pengajuan yang sama; tampilkan terpisah penyelesaian penyaluran, dana/pertanggungjawaban, konfirmasi/sengketa, dan publikasi bukti. Contoh seluruh paket telah diserahkan tetapi bukti belum lengkap atau sisa dana belum dipertanggungjawabkan tetap menampilkan pekerjaan tertunda; tidak memakai satu status sukses untuk seluruh aspek atau menambah persetujuan campaign paralel. | Diterima |

Q32/Q33 dicatat pada [ADR-0035](../adr/0035-staged-distribution-certificates-and-required-pilot-nft.md). Q34–Q36 memperinci ADR-0033; Sertifikat distribusi dan NFT distribusi ditambahkan ke glosarium. Q33 memperinci Q13a menjadi kewajiban implementasi NFT, tanpa mengubah batas privasi atau menggantikan ZK kontribusi. Tabel audit di atas merekam celah saat ditemukan; keputusan putaran 9 menutup celah arah tersebut dan membuka rincian NFT berikut.

### Putaran 10 — pemegang, transfer, versi dan operasi NFT — dijawab

| Pertanyaan | Rekomendasi untuk dibahas | Status |
| --- | --- | --- |
| Q37: siapa pemegang NFT tahap distribusi | Akun lembaga memegang NFT; donatur mengakses sertifikat dan keterkaitannya dengan kontribusi melalui aplikasi tanpa wallet wajib. Kepemilikan token bukan identitas operator, hak bantuan atau akses dokumen privat. Alternatif NFT untuk setiap donatur merupakan objek berbeda dari sertifikat tahap yang sudah dipilih. | Diterima |
| Q38: perpindahan token dan pemulihan | NFT tidak diperdagangkan atau dipindahkan bebas. Pemulihan harus melalui kewenangan lembaga dengan jejak yang mempertahankan penerbit/isi/riwayat sertifikat; tidak ada pemindahan admin diam-diam. Mekanisme pemulihan akun atau penerbitan pengganti mengikuti pilihan pemegang Q37 dan belum dipilih. | Diterima |
| Q39: hubungan token dengan versi sertifikat | Satu NFT merujuk satu versi sertifikat dengan isi tetap. Koreksi menerbitkan NFT versi baru, menaut pengganti, dan menandai versi lama sebagai riwayat; status sengketa/perubahan keberlakuan tetap dapat diperiksa terpisah. Jangan menimpa isi sertifikat lama atau mengandalkan gambar wallet untuk mengetahui status. Q32 sudah menetapkan riwayat, pertanyaan ini menentukan representasi tokennya. | Diterima |
| Q40: operasi dan biaya penerbitan NFT | Layanan berwenang menerbitkan NFT setelah pengesahan lembaga dalam batas anggaran layanan/pilot terpisah, tanpa potongan otomatis kontribusi atau gas donatur. Status NFT tertunda/gagal tetap terlihat dan baru terbit setelah transaksi berhasil dikonfirmasi. Kegagalan mint tidak mengubah realisasi bantuan menjadi belum terjadi, tetapi hasil NFT wajib pilot belum terpenuhi. Ini memperluas prinsip operasi Q25/Q26 dari ZK ke NFT, belum otomatis diterima sebelumnya. | Diterima |

Pengguna menjawab “saya setuju semuanya” untuk Q37–Q40. ADR-0035 dan glosarium diperbarui. Akun lembaga menjadi pemegang, transfer bebas tidak diperbolehkan, koreksi menghasilkan NFT versi baru, dan layanan berwenang menjalankan penerbitan beranggaran. Detail rotasi/pemulihan akun, persetujuan pemegang, standar token dan pengikatan metadata menjadi pekerjaan spesifikasi dalam batas tersebut. Privasi Q11, akses Q17a/Q27 dan bukti distribusi per tahap Q32 tidak ditanyakan ulang. Standar teknis belum dipilih; [riset NFT](0009-nft-untuk-bukti-distribusi-pilot.md) membedakan kemampuan standar dari kebijakan produk yang masih terbuka. Pembaruan spec/tiket tetap memerlukan rangkuman pemahaman bersama.


### Rincian yang tetap harus diselesaikan melalui spesifikasi dan uji kelayakan

- Statement, circuit, public inputs dan pengikatan receipt ke batch berwenang; pilihan toolchain memerlukan proof nyata, ukuran verifier/gas dan pipeline yang dapat direproduksi. Riset dokumentasi bukan bukti kelayakan runtime.
- Dampak koreksi batch terhadap receipt yang tidak berubah, status versi historis/transisi, jadwal batch, konfirmasi transaksi dan pemulihan. Prinsip Q24–Q26 menjadi batasnya.
- Kanal kontak, durasi OTP/sesi, pengiriman ulang, pemeriksaan bukti alternatif dan pengikatan bukti distribusi ke sumber laporan.
- Batas pencatatan biaya dan dasar nilai barang diterima pada Q34; metode valuasi khusus tetap memerlukan contoh pencatatan dan kebijakan mitra. Dukungan barang/satuan tidak menyiratkan kebijakan valuasi tertentu.

Usulan kriteria uji: proof mengikat kontribusi yang dimaksud sehingga proof kontribusi lain tidak dapat diberi label sebagai receipt ini; root buatan pihak tidak berwenang ditolak; manipulasi yang membuat statement tidak sah ditolak; bukti dapat diperiksa ulang; informasi privat tidak muncul melalui public inputs, calldata, metadata, atau log. Alur uang/barang parsial, batas alokasi, otorisasi akses, bukti tertunda/gagal dan riwayat koreksi juga harus diperiksa. Ini bahan spesifikasi yang belum diuji, bukan klaim kemampuan saat ini.

### Fakta operasional yang masih terbuka

Mitra, tanggal, volume, koneksi lapangan, kanal kontak yang tersedia, pihak berwenang dan anggaran nyata belum diketahui. Ini prasyarat menyatakan pilot siap digunakan; jawaban “setuju rekomendasi” tidak mengisi nilainya. Kondisi Q4 tidak menghalangi konsolidasi arah produk.

Pemenuhan ZK nyata membutuhkan statement dan circuit yang cocok, pembentukan proof, verifier nyata, sumber/root berwenang, pengikatan public input, serta penolakan bukti tidak sah pada alur produk. Perbaikan tampilan sukses palsu dan pembatasan akses bukti pribadi tetap diperlukan. Belum ada perubahan implementasi atau tracker pada tahap wawancara ini.

## Penutupan — pemahaman bersama dikonfirmasi

[Rangkuman cakupan pilot](../design/pilot-distribution-agreed-scope.md) menyatukan keputusan yang telah diterima, hubungan dengan pekerjaan lama, batas klaim ZK/NFT, serta rincian yang tetap harus diselesaikan. Tidak ada putaran pertanyaan arah produk baru yang diajukan saat ini. Setelah rangkuman disajikan, pengguna menjawab “ya kita sudah memiliki pemahaman yang sama”. Konfirmasi penutup yang diminta skill grilling telah terpenuhi; sesi brainstorming selesai. Rangkuman menjadi dasar revisi spec serta pemetaan tiket, tanpa perlu meminta ulang persetujuan keputusan yang sama.

Mekanisme pemulihan akun, standar token, toolchain ZK, chain/deployment target, protokol versi, skema, akses/retensi dan penerimaan teknis harus diperinci tanpa mengubah batas produk yang diterima. Jika uji kelayakan atau SOP mitra menuntut perubahan batas tersebut, keputusan dibuka kembali secara eksplisit. Mitra, tenggat, volume, kanal dan anggaran tidak diisi dengan asumsi. Belum ada implementasi atau publikasi perubahan tracker dari sesi ini.

## Tindak lanjut to-spec setelah penutupan brainstorming

Pengguna meminta penutupan issue lama dan penyesuaian #86 serta tiket terbuka setelahnya, dengan pekerjaan selesai tetap selesai. Batas pengujian HTTP/SQL/berkas nyata, proof/verifier/NFT EVM lokal dan smoke browser dikonfirmasi. [Spec #100](https://github.com/tawf-labs/tawf-zakat/issues/100) diterbitkan dengan `ready-for-agent`; #86/#92–#99 diamandemen dan sebelas issue lama ditutup. #87–#91 tidak diubah. Lihat [spec lokal](../specs/pilot-distribution-zk-nft.md) dan [hasil verifikasi tracker](../verification/0100-pilot-spec-tracker.md). Ini tindakan lanjutan setelah sesi wawancara; tidak mengubah pernyataan historis bahwa saat brainstorming belum ada publikasi tracker.

Setelah persetujuan `to-tickets`, 15 tiket #101–#115 diterbitkan di bawah #100 dengan dependensi native. Lihat [indeks tiket](../design/pilot-distribution-tickets.md) dan [verifikasi publikasi tiket](../verification/0101-pilot-tickets.md).
