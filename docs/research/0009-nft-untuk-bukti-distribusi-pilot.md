# NFT untuk bukti distribusi pilot ZKT

- Ditelusuri: 2026-09-16, dari spesifikasi dan dokumentasi primer.
- Status: bahan keputusan Q13; pengguna meminta pendalaman, belum menyetujui atau menolak NFT. Pengguna kemudian menjelaskan motif ketua tim: **bukti distribusi yang bisa diverifikasi**. Kewajiban memakai token belum dikonfirmasi.
- Tindak lanjut Q13a: pengguna menerima kemampuan verifikasi sebagai syarat utama dan NFT sebagai pilihan bentuk sertifikat. Pemilihan mekanisme belum diputuskan; lihat [ADR-0032](../adr/0032-contribution-traceability-and-recipient-confirmation.md).
- Keputusan berikutnya Q32/Q33: sertifikat per tahap penyaluran disepakati dan pengguna menetapkan **NFT wajib pilot**. Rekomendasi bersyarat/penundaan dalam riset ini merupakan pembanding historis, bukan cakupan akhir. Lihat [ADR-0035](../adr/0035-staged-distribution-certificates-and-required-pilot-nft.md). Q37–Q40 kemudian menerima pemegang lembaga, pembatasan transfer/pemulihan berjejak, satu NFT per versi, dan penerbitan oleh layanan berwenang dengan anggaran terpisah. Standar belum dipilih.
- Dasar proyek: [wawancara Q9–Q13](0007-pilot-distribusi-dan-penelusuran-grilling.md), [ADR-0021](../adr/0021-period-evidence-institutional-endorsement-and-private-sources.md), [ADR-0022](../adr/0022-append-only-report-evidence-registry.md).

## Kesimpulan bersyarat

**NFT dapat merepresentasikan bukti distribusi yang diterbitkan lembaga, tetapi kemampuan verifikasi berasal dari isi bukti, pengikatan kriptografis dan kewenangan penerbitnya.** Dengan motif yang dijelaskan pengguna, perbandingan utama adalah NFT bukti distribusi versus pernyataan bertanda tangan/registry yang langsung memuat rujukan bukti. Sertifikat apresiasi donatur menjadi alternatif sekunder, bukan rekomendasi utama.

Jika tujuannya hanya mengikat bukti agar perubahan dapat diperiksa, registry periode dalam ADR-0021/0022 sudah ditujukan untuk kebutuhan itu. NFT belum menunjukkan keuntungan tambahan yang wajib bagi pilot. Kode saat ini sudah memiliki `recordEvidence`, `publishReport`, `attestReport` dan riwayat koreksi pada [ReportEvidenceRegistry](../../sc/src/ReportEvidenceRegistry.sol), serta [verifier laporan](../../backend/src/report-verifier.ts) yang memeriksa paket/signature dan, bila koneksi diberikan, receipt terhadap RPC. Deployment tidak diperiksa. Ini bukan model konfirmasi penerima per kejadian; perluasan masih diperlukan untuk kebutuhan tersebut. Keterangan ADR lama tentang belum diimplementasikan merupakan konteks historis.

## 1. Apa yang diberikan standar

**Fakta:** ERC-721 menyediakan identitas token, kepemilikan dan antarmuka transfer yang dapat dipakai aplikasi wallet. Metadata merupakan ekstensi opsional; `tokenURI` boleh berubah. Nama koleksi tidak memastikan penerbitnya sah, karena kontrak lain dapat memakai nama sama. Keaslian penerbit perlu diperiksa dari kontrak dan kewenangannya. [ERC-721](https://eips.ethereum.org/EIPS/eip-721).

**Implikasi ZKT:** sertifikat dapat dikenali di luar antarmuka ZKT, sepanjang aplikasi tujuan mendukungnya. Itu belum berarti seluruh makna bukti, status koreksi, atau pengesahan lembaga dipahami aplikasi tersebut. Kemampuan lintas aplikasi harus diuji pada target nyata. Memiliki token tidak dengan sendirinya membuktikan pemegangnya pemberi donasi, penerima bantuan, atau pemilik dana.

**Fakta:** blockchain memerlukan masukan eksternal untuk kejadian di luar jaringan, dan keakuratan masukan tetap masalah tersendiri. [Ethereum: oracle problem](https://ethereum.org/developers/docs/oracles/#what-is-the-oracle-problem).

**Implikasi ZKT:** foto palsu atau jumlah keliru yang dimasukkan petugas tetap dapat dicatat secara konsisten di blockchain. NFT tidak menggantikan konfirmasi penerima, pemeriksaan lembaga, atau rekonsiliasi. Waktu pencatatan blockchain juga harus dibedakan dari waktu penyerahan yang dinyatakan petugas. Q12 tetap berlaku walaupun NFT digunakan.

## 2. Bentuk yang dibandingkan

Tabel berikut merupakan penilaian desain untuk keputusan Q9–Q12 yang sudah diterima, bukan hasil pengujian pengguna.

| Pilihan | Klaim yang diwakili | Manfaat tambahan potensial | Beban / ketidakcocokan | Kapan layak |
| --- | --- | --- | --- | --- |
| Registry paket laporan tanpa NFT | Lembaga dan validator mengesahkan paket versi tertentu | Bukti laporan dapat diperiksa dan koreksinya ditelusuri sesuai ADR-0022 | Kode tersedia; integrasi alur distribusi dan kesiapan operasional tetap perlu dibuktikan | Kebutuhan utama adalah laporan dan integritas bukti |
| NFT per kejadian penyerahan | Lembaga menerbitkan catatan kejadian tertentu | Identitas token untuk tiap kejadian, bisa dirujuk aplikasi luar | Harus menentukan pemilik, koreksi, data publik dan kaitan laporan; banyak kejadian menambah pekerjaan penerbitan | Ada konsumen nyata yang membutuhkan token kejadian, bukan sekadar halaman bukti |
| NFT per kegiatan/batch distribusi | Lembaga menerbitkan ringkasan distribusi versi tertentu | Objek bukti standar dengan isi agregat | Perlu aturan versi dan hubungan ke bukti terbatas; manfaat pemilik token belum pasti | Ringkasan agregat sesuai Q11 dan integrasi NFT memang dibutuhkan |
| NFT sertifikat kontribusi | Penerbit mengakui kontribusi donatur pada kegiatan tertentu | Sertifikat di wallet dan penggunaan lintas aplikasi | Perlu persetujuan publikasi, pengaitan wallet, pemulihan akses, koreksi dan biaya | Ketua tim/donatur memerlukan sertifikat portabel dan bersedia menguji penggunaannya |
| Atestasi/registry kejadian tanpa token | Pihak tertentu menyatakan fakta per kejadian/batch | Pernyataan terstruktur tanpa konsep kepemilikan token; waktu publikasi bisa sebelum laporan | Perlu perluasan model kejadian, otorisasi, akses dan status | Verifikasi distribusi dibutuhkan sebelum laporan, tanpa integrasi NFT |

Untuk alternatif terakhir, antarmuka resmi EAS menyediakan skema, penerima, waktu kedaluwarsa, sifat dapat dicabut, rujukan atestasi lain dan data khusus. Ini menunjukkan adanya pilihan teknis tanpa NFT, bukan rekomendasi mengganti registry ZKT atau bukti bahwa pengesahan ganda ADR-0022 otomatis tersedia. [Kode resmi IEAS](https://github.com/ethereum-attestation-service/eas-contracts/blob/master/contracts/IEAS.sol).

## 3. Apa tepatnya yang dapat diverifikasi?

**Analisis berdasarkan batas oracle dan ADR-0022:** pisahkan tiga lapisan:

1. **Integritas dan atribusi:** apakah bukti yang diperiksa cocok dengan komitmen, diterbitkan pihak berwenang, dan versi itu belum digantikan/dicabut? NFT maupun registry dapat dirancang untuk ini.
2. **Kelengkapan prosedur:** apakah jumlah aktual, petugas, konfirmasi penerima/perwakilan, serta pemeriksaan lembaga tersedia dan saling sesuai? Ini tergantung protokol bukti Q12, bukan jumlah token.
3. **Kebenaran kejadian:** apakah barang/uang benar-benar diterima orang yang berhak? Memerlukan sumber lapangan dan pemeriksaan yang dipercaya; token saja tidak menyelesaikannya.

**Kasus terbaik NFT:** tiap bukti distribusi yang telah memenuhi aturan memperoleh identitas token standar, diterbitkan kontrak lembaga yang dikenali, merujuk versi bukti, dan dapat ditemukan/diperiksa alat luar. Lembaga dapat menjadi pemegang token; pemiliknya belum diputuskan. Kegunaannya paling kuat jika aplikasi mitra memang mengonsumsi objek NFT tersebut. Kepemilikan di wallet bukan keharusan agar publik dapat memeriksa catatan.

Sesuai Q11, NFT agregat kegiatan/batch lebih selaras dibanding rincian setiap penerima terbuka. Menghilangkan nama saja belum menjadikan rincian kejadian sesuai keputusan akses. Pernyataan “lembaga mengesahkan 80 penyerahan berdasarkan bukti konfirmasi” perlu dibedakan dari “blockchain mengamati langsung 80 penyerahan”.

**Alternatif setara untuk motif saat ini:** registry mencatat identitas bukti, komitmen, penerbit, status dan rujukan versi. Verifier independen memeriksa signature/kontrak resmi dan kecocokan bukti. Explorer dapat membantu memeriksa pencatatan, tetapi pembaca tetap perlu mengetahui arti kolom, penerbit sah, dan statusnya. NFT juga memerlukan informasi tersebut; keduanya tidak cukup dengan badge “verified”.

Granularitas bukti adalah keputusan terpisah dari tokenisasi. Bukti per penyerahan dapat ditautkan ke laporan periode tanpa menjadi NFT. Sebaliknya, satu NFT dapat menunjuk paket bukti kegiatan. Jika ingin komitmen publik sebelum laporan terbit, waktu publikasi itu juga perlu diputuskan tersendiri; rancangan registry periode saat ini tidak otomatis memenuhi kebutuhan tersebut.

Dalam pendanaan gabungan A dan B untuk 100 paket, keduanya dapat melihat catatan 80 paket terkonfirmasi tanpa mengklaim paket tertentu milik A. Beberapa tampilan/token yang merujuk bukti sama tidak boleh menggandakan realisasi. Hak penerima tetap berasal dari pengajuan, bukan kepemilikan token. Ini mempertahankan Q9/Q10.

## 4. Transfer, persetujuan, dan koreksi

**Fakta:** ERC-5192 menyediakan pemeriksaan status terkunci; transfer wajib gagal ketika token terkunci. Standar ini tidak mendefinisikan protokol persetujuan penerima, koreksi klaim, atau pemulihan akun. Label soulbound saja tidak menyelesaikan kebutuhan tersebut. [ERC-5192](https://eips.ethereum.org/EIPS/eip-5192).

**Fakta:** ERC-5484 melarang transfer, menetapkan kewenangan burn yang tidak berubah, mewajibkan metadata dipresentasikan dan signature penerima diperoleh sebelum penerbitan, serta melarang penerbit mengubah metadata setelahnya. Standar membahas rotasi kunci lewat burn dan penerbitan ulang sesuai kewenangan yang dipilih. [ERC-5484](https://eips.ethereum.org/EIPS/eip-5484).

**Usulan:** bukti distribusi tidak memerlukan pasar perdagangan. Pilihan standar baru dibuat setelah pemegang token, persetujuan, wallet hilang, dan koreksi diputuskan. Hindari menyamakan burn dengan koreksi laporan: riwayat bukti lama tetap perlu ada. Bukti yang salah harus dapat ditandai dicabut/digantikan dan menunjuk penggantinya; verifier harus menampilkan status itu. Versi lama tidak boleh terlihat sah hanya karena gambar masih tampil di wallet. Ini menerapkan prinsip riwayat [ADR-0022](../adr/0022-append-only-report-evidence-registry.md), dengan pekerjaan tambahan untuk NFT.

## 5. Foto, metadata, dan ketersediaan

**Fakta:** IPFS tidak menyediakan kerahasiaan isi secara otomatis; konten perlu dienkripsi jika sensitif. Informasi penyedia/CID pada DHT dapat terbuka. [Privasi IPFS](https://docs.ipfs.tech/concepts/privacy-and-encryption/). Pinning mempertahankan konten pada node atau layanan yang memeliharanya; konten cache dapat dibuang. [Pinning IPFS](https://docs.ipfs.tech/how-to/pin-files/). CID dapat mengikat konten tertentu, tetapi keberlanjutan penyimpanan tetap perlu diurus. [Praktik data NFT IPFS](https://docs.ipfs.tech/how-to/best-practices-for-nft-data/).

**Usulan sesuai Q11:** metadata publik memakai ilustrasi sertifikat dan informasi kegiatan yang telah disetujui untuk publik. Foto wajah, KTP, kontak, lokasi rinci dan dokumen penerima tetap pada penyimpanan terbatas. Nominal serta identitas donatur juga jangan otomatis diumumkan melalui wallet. Tautan publik tidak menjadi jalan belakang menuju berkas privat. Klaim immutable harus menjelaskan bagian yang dibekukan: isi sertifikat/komitmen versi tertentu, sementara status koreksi diperiksa terpisah.

## 6. Biaya dan gerbang keputusan

Transaksi Ethereum memerlukan gas; jumlah biaya bergantung pada komputasi dan harga gas. Tidak ada estimasi rupiah dalam riset ini karena jaringan, kontrak, volume dan waktu eksekusi belum dipilih. [Ethereum: gas](https://ethereum.org/developers/docs/gas/).

**Analisis operasional:** NFT menambah pekerjaan pengaitan akun dengan wallet, kunci penerbit, penerbitan ulang/koreksi, pemantauan transaksi, pengambilan metadata dan dukungan pengguna. Sponsor biaya dapat memindahkan pembayar, tetapi tidak menghapus pekerjaan tersebut. Ukur biaya total setelah desain dan volume pilot jelas.

Motif bukti distribusi terverifikasi sudah dijelaskan pengguna. Sebelum menyetujui NFT sebagai syarat pilot, rincian yang masih perlu dipastikan:

1. Apakah pemeriksaan ditujukan kepada publik, donatur, atau pemeriksa berwenang yang mempunyai berkas lengkap?
2. Apakah buktinya harus dipublikasikan per penyerahan sebelum laporan periode, atau cukup melalui paket laporan?
3. Adakah aplikasi mitra yang membutuhkan antarmuka token? Jika ada, sebutkan kandidatnya.
4. Apakah NFT adalah syarat stakeholder, atau mekanisme yang boleh diganti apabila hasil verifikasinya sama?

**Rekomendasi bersyarat:** mulai dari kontrak verifikasi—apa yang diperiksa, oleh siapa, kapan dan dengan data apa. Jika tidak membutuhkan kepemilikan/antarmuka token, registry atau atestasi langsung lebih sesuai dengan motif saat ini. Jika ketua tim menghendaki NFT sebagai objek bukti, gunakan representasi institusional yang merujuk bukti yang sama dan tunjukkan manfaat integrasinya; jangan gandakan sumber angka. Uji apakah pemeriksa luar dapat memeriksa bukti asli dan mendeteksi perubahan, penerbit palsu serta versi yang dikoreksi. Riset ini mempertahankan Q9–Q12 dan tidak mengubah spec, tracker, atau ADR menjadi keputusan NFT.

## 7. Pemeriksaan standar setelah NFT diwajibkan

Pemeriksaan ulang sumber primer mendukung penundaan pemilihan standar sampai kebijakan produk ditetapkan. ERC-721 mengizinkan pembatasan transfer, tetapi tidak menjamin isi metadata tetap atau penerbit yang sah. ERC-5192 menyediakan status terkunci dan larangan transfer saat terkunci; pemulihan, persetujuan dan koreksi masih perlu rancangan sendiri. ERC-5484 mensyaratkan persetujuan penerima, metadata tetap dan kebijakan burn yang ditetapkan saat penerbitan, serta membahas rotasi melalui burn/penerbitan pengganti. Ketiganya tidak boleh diperlakukan sebagai mekanisme pemulihan yang identik. [ERC-721](https://eips.ethereum.org/EIPS/eip-721), [ERC-5192](https://eips.ethereum.org/EIPS/eip-5192), [ERC-5484](https://eips.ethereum.org/EIPS/eip-5484).

ERC-4906 mendefinisikan pemberitahuan pembaruan metadata kepada aplikasi lain. Adanya event tersebut bukan jaminan setiap wallet memuat ulang gambar atau memeriksa status sengketa/koreksi aplikasi ZKT. Karena itu, usulan Q39 membedakan isi sertifikat tetap dari status keberlakuan yang dapat berubah dan harus diperiksa. [ERC-4906](https://eips.ethereum.org/EIPS/eip-4906). Q39 kemudian menerima kebijakan isi tetap dan status terpisah tersebut. Belum ada pemilihan standar atau pengujian kompatibilitas wallet.
