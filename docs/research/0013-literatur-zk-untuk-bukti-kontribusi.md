# Literatur ZK untuk bukti kontribusi

- Tanggal penelusuran: 2026-09-16. Seleksi terarah, bukan tinjauan lengkap atau klaim literatur paling mutakhir.
- Kebutuhan: kontribusi tertentu termasuk dalam batch berkomitmen yang disahkan lembaga; identitas dan nominal tidak dibuka kepada publik.
- Keputusan pengguna: Q20 mengizinkan lembaga/prover berwenang memproses witness; Q21 menargetkan verifikasi ZK nyata oleh smart contract; Q22 membatasi batch pada catatan yang direkonsiliasi dengan sumber lembaga dan disahkan pihak berwenang. Lihat [catatan wawancara](0007-pilot-distribusi-dan-penelusuran-grilling.md).
- Batas: akun/wallet donatur tidak wajib, tidak ada custody baru, dan tidak menjanjikan hubungan dana donatur tertentu ke penerima tertentu.

## Temuan utama

**Landasan paling dekat ialah pembuktian keanggotaan atas nilai yang terikat komitmen, kemudian pengesahan batch oleh lembaga.** Paper ledger baru berguna untuk memperluas audit agregat, tetapi mengganti ZKT menjadi ledger pembayaran privat akan memperbesar lingkup tanpa langsung memperbaiki bukti kontribusi pertama.

Lima paper di bawah mencakup publikasi 2023–2026 dan baseline 2018. Fakta paper dibedakan dari penilaian kecocokan ZKT. Klaim performa penulis tidak dipindahkan menjadi janji biaya/gas atau kesiapan pilot.

## 1. Lima landasan yang diperiksa

### A. Zero-knowledge proofs for set membership: efficient, succinct, modular

**Fakta:** Daniel Benarroch, Matteo Campanelli, Dario Fiore, Kobi Gurkan dan Dimitris Kolonelos; *Designs, Codes and Cryptography*, terbit 1 Juli 2023. Ini versi panjang karya konferensi 2021. Paper memformalkan pembuktian `u ∈ S` yang terhubung dengan komitmen terhadap `u`, serta komposisinya dengan syarat tambahan atas nilai yang sama. Konstruksinya memakai accumulator RSA atau pairing, dan membandingkan pendekatan Merkle tree di dalam zkSNARK. [Paper penerbit, §1 dan §3](https://link.springer.com/article/10.1007/s10623-023-01245-1).

**Kecocokan:** sangat dekat dengan kebutuhan “kontribusi dalam receipt ini termasuk batch”, karena komitmen receipt harus mengikat nilai yang sama dengan anggota batch. Sekadar membuktikan ada anggota rahasia dalam batch belum cukup.

**Batas:** landasan formal tidak berarti harus mengadopsi accumulator RSA. Kompleksitas implementasi dan verifier EVM perlu dibandingkan dengan Merkle-in-SNARK. Repositori penulis secara eksplisit menyatakan implementasinya belum siap produksi. [Kode penulis](https://github.com/kobigurk/cpsnarks-set).

### B. zkLedger: Privacy-Preserving Auditing for Distributed Ledgers

**Fakta:** Neha Narula, Willy Vasquez, Madars Virza; USENIX NSDI, April 2018. Ledger kolumnar dan proof tipe Schnorr memungkinkan pertanyaan audit atas transaksi privat. Kelengkapan atas ledger yang didefinisikan merupakan perhatian utama: peserta tidak boleh memilih hanya transaksi yang menguntungkan saat menjawab audit. [Paper USENIX](https://www.usenix.org/conference/nsdi18/presentation/narula).

**Kecocokan:** baseline kuat untuk memisahkan privacy, ketepatan jawaban, dan kelengkapan himpunan yang diperiksa. Berguna ketika ZKT kelak membuktikan total penerimaan atau alokasi tanpa membuka baris individual.

**Batas:** modelnya transaksi dalam ledger bersama. Membuktikan lengkap terhadap ledger itu tidak otomatis membuktikan semua transfer bank di luar sistem sudah dimasukkan. Q22 tetap memerlukan pengikatan sumber serta tanggung jawab lembaga. Pilot receipt tidak memerlukan penggantian pembukuan lembaga dengan zkLedger.

### C. Cross Ledger Transaction Consistency for Financial Auditing

**Fakta:** Vlasis Koutsos, Xiangan Tian, Dimitrios Papadopoulos dan Dimitris Chatzopoulos; ePrint 2024/1155, diterima arsip 16 Juli 2024, tercatat AFT'24. CLOSC/CLOLC memeriksa pasangan transaksi antarbuku dengan perlindungan nominal dan hubungan organisasi. Penulis memakai arsitektur dua tingkat dan evaluasi Hyperledger Fabric. Paper menyoroti bukti inclusion lama yang tetap valid walau ledger kemudian berubah. [Metadata](https://eprint.iacr.org/2024/1155), [paper §1 dan §5](https://eprint.iacr.org/2024/1155.pdf).

**Kecocokan:** lebih dekat daripada ledger pembayaran baru untuk arah rekonsiliasi lintas organisasi/sumber. Pelajaran langsung untuk pilot adalah mengikat proof ke versi batch tertentu dan memeriksa apakah versi itu masih berlaku.

**Batas:** transaksi memiliki pencatatan pasangan dan pihak yang mengikuti protokol. CSV bank atau receipt sepihak belum memenuhi asumsi itu. Implementasi Fabric dan kebutuhan organisasi berpasangan tidak dapat dianggap sebagai verifier EVM siap pakai.

### D. Private, Auditable, and Distributed Ledger for Financial Institutes — PADL

**Fakta:** Shaltiel Eloul, Yash Satsangi, Yeoh Wei Zhu, Omar Amer, Georgios Papadopoulos dan Marco Pistoia; arXiv v1, 7 Januari 2025. PADL memperluas ledger berbentuk tabel untuk transaksi multi-aset privat, memakai komitmen, audit token dan NIZK. Contohnya mencakup pertukaran aset, settlement dan obligasi; tersedia mode audit yang menjaga kerahasiaan maupun membuka informasi kepada pihak tertentu. [Metadata](https://arxiv.org/abs/2501.03808), [paper §3–§4](https://arxiv.org/html/2501.03808v1).

**Kecocokan:** kandidat baru yang substantif untuk masa depan: membuktikan hubungan antarnilai/jenis aset tanpa membuka seluruh data, serta membedakan akses auditor dari publik.

**Batas:** PADL adalah protokol transaksi dan ledger multi-peserta. “Sembako dan uang” dalam pembukuan ZKT tidak otomatis membutuhkan transfer aset kriptografis PADL. Paper arXiv ini belum membuktikan integrasi, keamanan implementasi atau kesiapan operasional ZKT; klaim kesiapan penulis bukan hasil pemeriksaan proyek ini.

### E. Token-Guided Flow Tracing for Auditable Zero-Knowledge Smart Contract Transfers

**Fakta:** Junhee Lee, Jihye Kim, Hyunok Oh dan Heejin Park; *IET Information Security*, pertama terbit 20 Agustus 2026. Paper membatasi pembukaan audit menurut aliran transaksi, arah, serta epoch melalui pengelola tracing token dan auditor. Jaminan pembatasan bergantung pada model otorisasi jujur dan tidak berkolusinya dua peran tersebut di luar otorisasi. [Paper penerbit, abstrak dan model keamanan](https://ietresearch.onlinelibrary.wiley.com/doi/10.1049/ise2/1765419).

**Kecocokan:** inspirasi terbaru untuk menghindari akses auditor yang terlalu luas; izin pemeriksaan dapat dibatasi menurut kasus dan periode.

**Batas:** objeknya transfer privat dalam smart contract, bukan bukti pemberian eksternal. Tracing token adalah kapabilitas audit, bukan NFT receipt donatur. Mengadopsi mekanisme penuh akan menambah model pembayaran dan manajemen kunci yang tidak dibutuhkan pilot ini. Kebaruan tanggal tidak menjadikannya pilihan implementasi pertama.

## 2. Matriks keputusan — analisis ZKT

| Landasan | Pilot membership receipt | Pengembangan berikutnya | Keputusan riset |
| --- | --- | --- | --- |
| Set membership 2023 | Sangat langsung: ikat receipt ke anggota yang sama | Syarat tambahan pada kontribusi | Landasan formal utama; bandingkan implementasi yang lebih sederhana |
| zkLedger 2018 | Pelajaran batas kelengkapan | Audit agregat privat | Baseline model audit |
| CLOSC/CLOLC 2024 | Versi ledger/batch tidak boleh ambigu | Rekonsiliasi antarlembaga | Referensi pengikatan sumber dan versi |
| PADL 2025 | Terlalu luas untuk receipt pertama | Relasi nilai/aset dan akses auditor | Tunda adopsi ledger; ambil prinsip |
| Flow tracing 2026 | Tidak langsung | Pemeriksaan dengan lingkup terbatas | Inspirasi izin audit, bukan arsitektur pembayaran pilot |

## 3. Asal data tetap merupakan persoalan tersendiri

Sebagai pembanding protokol, workshop resmi TLSNotary 14 November 2024 mendemonstrasikan pembuktian sebagian isi sesi TLS, baik interaktif maupun dengan attestation dari notary tepercaya. Ia menunjukkan cara mengikat informasi kepada sumber web, dengan asumsi kepercayaan yang perlu dijelaskan. [Dokumentasi workshop resmi](https://tlsnotary.org/blog/2024/11/14/devcon/).

**Analisis:** itu mungkin berguna kelak jika sumber institusi menyediakan data yang cocok. Namun, autentisitas respons server bukan jaminan seluruh pembukuan lengkap atau bantuan sudah diterima. Kesesuaian bank/API serta kemampuan verifikasi onchain belum diteliti; TLSNotary tidak otomatis memenuhi Q21. Untuk pilot, Q22 menetapkan sumber yang direkonsiliasi dan pengesahan lembaga sebagai batas kepercayaan yang terbuka.

## 4. Statement pilot yang direkomendasikan untuk diperinci

**Nilai tambah ZK harus jelas:** komitmen dengan randomness memadai dan Merkle proof biasa sudah dapat menyembunyikan nama/nominal bila pembukaannya tidak diberikan. ZK berguna untuk menyembunyikan path/posisi anggota atau membuktikan korespondensi komitmen receipt dan catatan batch tanpa membuka catatannya. Perbedaan membership biasa dan membership dengan elemen tersembunyi dibahas dalam [penjelasan penulis di ZKProof](https://zkproof.org/2020/02/27/zkp-set-membership/). Ini tidak mengubah Q21; detail tambahan yang benar-benar dibutuhkan perlu ditetapkan sebelum circuit.

Berikut usulan desain berdasarkan literatur, belum circuit atau klaim keamanan yang telah diuji:

> Ada satu catatan kontribusi dan randomizer yang cocok dengan komitmen receipt ini; catatan yang sama termasuk dalam batch versi tertentu yang disahkan lembaga.

Public input dapat mencakup identitas lembaga, batch/versi, root, komitmen receipt dan versi skema. Witness memuat catatan rahasia, randomizer serta path membership. Nama, nominal dan pembukaan komitmen tidak dipublikasikan. Pengecekan pengesahan root dan status versinya harus terikat ke hasil verifier kontrak, bukan sekadar label UI.

Donatur memperoleh hubungan receipt dengan catatannya melalui akses privat tanpa akun wajib; lembaga/prover berwenang dapat menghasilkan proof sesuai Q20. Publik memeriksa klaim atas komitmen, sedangkan donatur dapat memeriksa kecocokan pembukaannya. Komitmen yang dipakai ulang dapat menghubungkan beberapa presentasi; jangan menjanjikan unlinkability. Batch kecil dan metadata publik juga perlu dievaluasi agar hasil agregat tidak membocorkan nominal.

Proof ini belum membuktikan seluruh sumber bank masuk, tidak ada alokasi ganda, jumlah alokasi tidak melebihi kontribusi, atau bantuan diterima. Klaim tersebut memerlukan statement tambahan, cakupan data lengkap dan aturan koreksi. Nullifier untuk mencegah pemakaian proof berulang juga tidak sendirian membuktikan pembukuan bebas alokasi ganda.

**Rekomendasi:** fondasi pertama adalah membership terikat receipt ditambah root yang disahkan. Ambil pelajaran kelengkapan dan versi dari zkLedger/CLOSC; jadikan audit agregat sebagai tahap berbeda. Pemilihan proof system/toolchain mengikuti kebutuhan verifier smart contract dan pengujian implementasi, bukan umur paper. Tidak ada perubahan kode, deployment atau tracker melalui riset ini.
