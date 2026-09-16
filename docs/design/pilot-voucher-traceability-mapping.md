# Pemetaan pekerjaan lama dan penelusuran pilot sembako/uang

Catatan sumber: diagram dan percakapan pendamping telah dibaca saat riset. Berkas asal di `docs/temp` tidak tersedia dalam repositori ini; temuan dan keputusan yang dipakai dicatat dalam dokumentasi berikut.

- Tanggal: 2026-09-16.
- Status: pemetaan dengan riwayat usulan; keputusan terkini dirangkum dalam [cakupan pilot](pilot-distribution-agreed-scope.md). [Spec #100](https://github.com/tawf-labs/tawf-zakat/issues/100) kemudian diterbitkan dan #86/#92–#99 diamandemen; dependensi GitHub dipertahankan. Bagian pemetaan awal di bawah merupakan riwayat sebelum publikasi, dengan keputusan terkini pada rangkuman cakupan.
- Arahan pengguna: diagram adalah kesimpulan riset teman dan acuan arah baru; hasil yang diminta ialah fitur siap dipakai dalam pilot. Sembako dan uang tunai perlu ditelusuri secara transparan tanpa tumpang tindih.
- Dasar: diagram 16 langkah dari riset teman pengguna, percakapan pendamping (`research_temp.txt`), [spec #86](https://github.com/tawf-labs/tawf-zakat/issues/86), [peta tiket](pengajuan-penyaluran-tickets.md), [CONTEXT](../../CONTEXT.md), dan [riset perubahan prioritas](../research/0006-perubahan-prioritas-di-tengah-implementasi.md).
- Bukti: status #87–#99 dibaca pada sesi ini; isi #92–#99 dibaca lengkap. Inspeksi terarah kode lokal HEAD `0fecd6a`; bukan audit seluruh aplikasi atau verifikasi deployment. Tidak menjalankan tes aplikasi untuk perubahan dokumen ini.

**Perkembangan keputusan:** [ADR-0031](../adr/0031-institutional-pilot-donor-traceability-and-evidence.md) menerima penyerahan langsung, dana yang sudah diterima lembaga, pembayaran oleh lembaga, serta keluaran bukti amil. [ADR-0032](../adr/0032-contribution-traceability-and-recipient-confirmation.md) menerima referensi kontribusi donatur, penelusuran tingkat kegiatan, akses terbatas, dan konfirmasi penerima yang terpisah. Bagian eksplorasi di bawah mempertahankan alternatif awal; jika berbeda, ikuti keputusan tersebut dan [catatan wawancara](../research/0007-pilot-distribusi-dan-penelusuran-grilling.md). Q13a menerima kemampuan verifikasi sebagai syarat utama; Q32/Q33 kemudian menetapkan sertifikat per tahap dan **NFT wajib pilot** melalui [ADR-0035](../adr/0035-staged-distribution-certificates-and-required-pilot-nft.md).

[ADR-0033](../adr/0033-pilot-activity-allocation-confirmation-and-publication.md) kemudian menerima satu pengajuan sebagai cakupan kegiatan pertama, alokasi nominal kontribusi eksplisit, OTP dengan jalur tanda terima yang diperiksa, serta publikasi bukti distribusi sebelum laporan periode. Q17a/Q27/Q29 kemudian menerima akses per kontribusi tanpa akun melalui OTP serta pemulihan oleh petugas berwenang. Inspeksi lanjutan menemukan sukses simulasi pada halaman verifikasi bukti donatur; pemenuhan verifikasi nyata termasuk ZK yang diminta pengguna menjadi pekerjaan kesiapan pilot yang perlu dipetakan tersendiri, tanpa menganggapnya sudah tercakup oleh NFT atau tiket realisasi #94/#95.

Rincian bukti kode serta gerbang integrasi berada pada [riset 0011](../research/0011-status-verifikasi-bukti-dan-zk.md). Riset akses donatur berada pada [riset 0010](../research/0010-akses-donatur-tanpa-akun.md). Prioritas perbaikan yang diajukan: hilangkan sukses buatan dan paparan rincian kontribusi tanpa otorisasi sebelum pilot, kemudian penuhi statement ZK yang dipilih melalui pipeline dan pengujian nyata. Ini belum mengubah urutan/dependensi tracker.

**Prioritas tinggi yang sudah diputuskan:** Q19 menerima ZK nyata untuk keanggotaan kontribusi dalam kumpulan catatan yang disahkan lembaga, dengan identitas/nominal tersembunyi dari publik ([ADR-0034](../adr/0034-private-contribution-membership-zk-priority.md)). Q17a menerima akses per kontribusi tanpa pendaftaran wajib. [Paper proyek dan perbedaannya dengan kebutuhan pilot](../research/0012-paper-zk-dan-cakupan-pilot.md) menjadi dasar traceability; circuit eligibility arsip dan benchmark historis tidak dianggap implementasi ataupun ukuran performa membership yang baru.

Q20–Q22 selanjutnya menerima pemrosesan witness oleh pihak berwenang, verifier ZK nyata di smart contract, serta batch dari catatan penerimaan yang sudah dicocokkan dan disahkan. [Riset literatur tambahan](../research/0013-literatur-zk-untuk-bukti-kontribusi.md) mendukung perincian membership terikat receipt dan pengendalian versi; paper ledger yang lebih baru tidak otomatis memperluas pilot ke custody atau ledger transaksi privat.

| Kelompok pekerjaan | Dampak prioritas yang diajukan |
| --- | --- |
| Kebenaran hasil verifikasi dan akses bukti | Prasyarat jalur pilot: hentikan sukses simulasi, bedakan status nyata, batasi akses rincian kontribusi. |
| ZK kontribusi end-to-end | Prioritas tinggi yang diterima pengguna; perlu sumber batch sah, circuit membership, prover, verifier nyata, pengikatan receipt, dan pengujian. Bukan penambahan label ZK pada Merkle/NFT. |
| Operasi dan sumber laporan #92–#98 | Tetap dibutuhkan untuk hasil donatur sekaligus amil; dependensi lama tetap dipertahankan sampai rencana irisan implementasi baru disepakati. |
| NFT distribusi | Wajib pilot menurut Q33, mewakili sertifikat tahap distribusi Q32; Q37–Q40 menetapkan pemegang lembaga, tidak dipindahkan bebas, NFT per versi dan operasi beranggaran. Tidak menggantikan ZK kontribusi. |

Tabel ini memetakan kebutuhan, bukan mengubah status tiket, menyatakan pekerjaan lama selesai, atau menetapkan tanggal tanpa kapasitas/tenggat pilot.

## 0. Koreksi setelah membaca konteks proyek secara menyeluruh

Pembacaan lanjutan mencakup ADR-0001–0030, riset 0001–0005, serta [strategi komersial](../strategy/README.md). Riset 0006 dan dokumen ini adalah hasil percakapan sekarang, bukan bukti independen untuk membenarkan usulannya sendiri. Pembacaan sumber internal tidak berarti angka pasar, ketentuan hukum, dan deployment historis diverifikasi ulang.

**Koreksi utama: voucher tidak dijadikan pusat model seluruh aplikasi.** Usulan awal satu voucher sebagai satu hak bantuan terlalu cepat menjadikan mekanisme pada diagram sebagai model universal. Hak bantuan sudah menjadi bagian Pengajuan penyaluran dan rinciannya. Voucher sebaiknya menjadi penghubung penelusuran pada alur campaign yang membutuhkannya; tidak menciptakan hak, nominal disetujui, atau realisasi kedua.

### Arah produk yang mendasari koreksi

| Dasar | Keputusan dan implikasi yang masih relevan |
| --- | --- |
| [ADR-0016](../adr/0016-commercial-positioning-technology-vendor-not-licensed-amil.md), strategi §2–6, riset 0002 §10.1/10.7 | ZKT diposisikan sebagai vendor teknologi bagi lembaga, dengan nilai pada pembuktian, rekonsiliasi, dan berkurangnya kerja ulang. Lembaga adalah pembeli utama; kepercayaan donatur merupakan manfaat tambahan yang penting. Generator laporan saja pernah diturunkan prioritasnya karena tesis diferensiasi berada pada asal angka dan bukti. |
| [ADR-0017](../adr/0017-reconciliation-engine-v0-shared-pure-core-and-two-callers.md) dan [ADR-0018](../adr/0018-deterministic-validator-decides-never-the-model.md) | Mesin rekonsiliasi dan perhitungan deterministik memberi dasar angka; AI menyusun draf yang tetap diperiksa. Tampilan donatur juga harus menjelaskan sumber serta batas angka yang ditampilkan. |
| [ADR-0020](../adr/0020-institutional-pilot-evidence-and-reconciliation.md)–[0022](../adr/0022-append-only-report-evidence-registry.md) | Pilot berpusat pada bukti periode, snapshot, pengesahan, versi koreksi dan pemeriksaan. Semua dana tidak harus lebih dahulu melewati ZKT agar lembaga mendapat manfaat. Registry laporan terpisah dari vault. |
| [ADR-0026](../adr/0026-disbursement-workflow-design-scope.md)–[0030](../adr/0030-personal-operators-and-institutional-endorsement-accounts.md), riset 0005 | Arah kemudian diperluas secara sah ke pekerjaan operasional: program → pengajuan → pemeriksaan/keputusan → realisasi IDR/barang → laporan. Jadi pencatatan operasional #86 bukan penyimpangan yang perlu dibatalkan hanya karena strategi awal menyebut lapisan bukti. |
| Diagram teman pengguna | Menambahkan pengumpulan bukti pada saat penyerahan dan hubungan yang mudah ditelusuri donatur. Bagian ini dapat memperkuat arah produk. Penggalangan, voucher, dan pencairan perlu dinilai terpisah karena dapat mengubah proses serta tanggung jawab produk. |

### Susunan yang direkomendasikan sekarang

Pertahankan dua pintu masuk: **sumber lembaga yang sudah ada** (melalui format yang benar-benar didukung) dan **alur operasional ZKT** (#86 ditambah bagian diagram). Keduanya menyuplai lapisan bukti yang sama sesuai detail sumber yang tersedia. Sumber berupa rekap tidak dipaksa mempunyai voucher atau penerima rekaan. Pembacaan sumber eksternal tidak otomatis menciptakan Pengajuan penyaluran atau persetujuan historis baru.

Pada alur operasional, hierarki program, pengajuan, rincian bantuan dan realisasi tetap menjadi pemilik fakta. Campaign/donasi/voucher menaut ke fakta itu bila alokasi tersedia dan sah. Lapisan bukti mengikat sumber, cakupan, versi, hasil pemeriksaan dan pengesah; laporan lembaga, pemeriksaan auditor dan penelusuran donatur menyajikannya menurut akses masing-masing.

Ada tiga cakupan keterlacakan yang perlu diberi label jujur: (1) rekap lembaga/periode, (2) rincian pengajuan/penerima/realisasi, (3) kontribusi donatur tertentu ke realisasi. Cakupan ketiga membutuhkan catatan alokasi tambahan; tidak dapat diturunkan hanya karena dua total cocok. Hubungan alokasi akuntansi juga tidak boleh diklaim sebagai pelacakan fisik lembar uang.

**Implikasi prioritas:** #98 merupakan penghubung penting antara operasi dan nilai utama produk, sehingga hasilnya harus masuk rancangan alur pilot sejak awal. Ini bukan izin melewati dependensi #95/#96 atau menutup #98 dengan implementasi parsial. #99 dinilai berdasarkan kebutuhan pemeriksa pilot; ketiadaannya pada diagram donatur bukan alasan cukup untuk menunda. #92 dapat mempertahankan impor penerima sesuai model yang sudah disepakati; kolom tambahan voucher/kontak tidak perlu memblokir seluruh kemampuan impor bila belum diputuskan.

Rekomendasi menahan tiket sebelumnya diperhalus: tahan bagian yang bergantung pada asumsi berubah (campaign, alokasi, pencairan, protokol konfirmasi), lalu nilai bagian yang tidak terpengaruh terhadap kapasitas pilot. Tidak otomatis membekukan seluruh backlog atau menjalankan semuanya bersamaan.

### Hal yang perlu diuji bersama mitra, mengikuti strategi

Ambil satu contoh pekerjaan dan dokumen anonim yang boleh diperiksa: daftar penerima, bukti pembayaran/serah terima, dan laporan hasilnya. Telusuri data apa yang diketik ulang, bukti apa yang dikejar, siapa yang menerima laporan, serta berapa waktu kerja yang dipakai. Bandingkan sebelum/sesudah pada tugas yang sama. Indikator awal yang disarankan: waktu menyiapkan paket bukti, jumlah input ulang, kelengkapan bukti, dan waktu menelusuri angka ke sumber. Target angkanya belum ditetapkan.

Strategi dan riset juga mempunyai bagian historis yang perlu dibaca dengan batas: tenggat yang disebut 227 hari bukan pengukuran jam kerja amil; penyebab selisih angka pada riset 0002 masih perlu konfirmasi; klaim implementasi kontrak lama dikoreksi oleh riset 0003/0004 dan ADR-0019; DPS sebagai gerbang universal diganti sebagian oleh ADR-0028. Angka pasar, jadwal GTM, dan calon mitra pada strategi tidak membuktikan komitmen pilot sekarang. Dokumen ini mempertahankan keputusan produk yang diterima tanpa mengulang klaim tersebut sebagai kepastian baru.

### Batas perubahan yang perlu diputuskan secara eksplisit

Merekam bukti lebih awal dan menyajikannya ke donatur dapat menjadi perluasan #86. Menjadi platform penggalangan wajib, mengendalikan pencairan, atau mengganti unit bukti laporan dengan NFT per penerima merupakan perubahan lebih besar yang membuka kembali ADR-0016/0020/0021/0022/0026. Diagram tetap menjadi acuan yang dihormati; rincian mana yang harus mengubah keputusan lama belum disimpulkan hanya dari label “Sistem & Blockchain”.

## 1. Satu perjalanan, dua bentuk realisasi

Rekomendasi: pertahankan lima tahap diagram untuk alur campaign baru. Gunakan hubungan data yang sama dari pendataan sampai laporan, dengan rincian dan bukti realisasi menurut jenis bantuan. Diagram tidak perlu digandakan menjadi dua sistem atau menjadi prasyarat bagi semua sumber bukti lembaga.

| Tahap diagram | Yang dipertahankan | Perincian untuk sembako dan uang |
| --- | --- | --- |
| 1–4: persiapan dan pengecekan | Pendataan, pemeriksaan lembaga, persetujuan, lalu program donasi aktif | Setiap rincian menyebut penerima, jenis bantuan, periode, hak, dan pihak berwenang. Persetujuan membuka campaign perlu dibedakan dari keputusan hak bantuan atau izin pencairan jika SOP membedakannya. |
| 5–6: donasi dan voucher | Donatur membayar dan mendapat referensi unik untuk penelusuran | Catat penerimaan donasi, sumber konfirmasinya, lalu alokasi ke bantuan. Keterhubungan donatur, voucher, dan penerima harus memiliki arti eksplisit. |
| 7–9: target, bukti pembayaran awal, pencairan | Tahap persiapan dana dan distribusi tetap ada | Pembayaran penyedia sembako atau penyerahan dana kepada petugas belum berarti mustahik menerima bantuan. Penerima pembayaran, tujuan, bukti, dan sisa pertanggungjawaban dicatat tersendiri. |
| 10–13: konfirmasi dan penyaluran | Konfirmasi penerima, pencatatan kejadian, bukti lapangan | Sembako: kuantitas/satuan dan bukti serah terima. Tunai: nominal dan bukti penerimaan uang. Transfer, jika masuk pilot: penerima pembayaran dan status transaksi beserta sumber konfirmasinya. |
| 14–16: bukti blockchain dan laporan donatur | Bukti digital, notifikasi, dan penelusuran oleh donatur | Bukti merujuk realisasi yang sama. Penambahan bukti blockchain tidak membuat realisasi kedua atau otomatis mengubah hasil pemeriksaan. |

OTP tetap acuan diagram. QR, TOTP, GPS, dan offline dalam percakapan dicatat sebagai opsi lanjutan yang memerlukan keputusan tersendiri; pemetaan ini tidak memilih penggantinya. NFT pada tahap 14 dipertahankan sebagai kebutuhan yang perlu diperinci relasinya dengan registry bukti, tanpa menganggap NFT tersebut sudah tersedia.

## 2. Hubungan yang diusulkan

Istilah baru di bawah masih usulan, sehingga belum dimasukkan ke glosarium sebagai keputusan diterima.

- **Campaign donasi:** pembukaan penggalangan untuk tujuan bantuan tertentu. Hubungannya dengan Program bantuan bisa diperinci tanpa mengganti arti program lama secara diam-diam.
- **Penerimaan donasi:** catatan dana masuk beserta referensi pembayaran, nominal, jenis dana, waktu dan status konfirmasi. Memulai pembayaran belum sama dengan dana diterima.
- **Alokasi donasi:** pengaitan sejumlah dana dari penerimaan donasi ke rincian bantuan tertentu, dengan alasan dan riwayat perubahan. Pagu referensi bukan sumber dana masuk.
- **Voucher:** usulan referensi penelusuran pada alur campaign yang menautkan kontribusi dan rincian bantuan yang disetujui. Hak bantuan tetap dimiliki pengajuan/rinciannya. Satu orang yang mendapat sembako dan uang memiliki dua rincian bantuan; apakah tampilan donatur memerlukan satu atau dua voucher belum diputuskan. Voucher tidak wajib bagi realisasi dari proses lembaga lain.
- **Realisasi penyaluran:** tetap memakai arti dalam CONTEXT, yakni catatan penyerahan yang benar-benar dilakukan beserta jumlah, penerima, dan bukti. Voucher terdanai tidak berarti bantuan telah diterima.
- **Bukti digital realisasi:** catatan publikasi/pengesahan atas realisasi tertentu dan versinya; NFT, bila dipakai, merupakan representasi bukti itu, bukan catatan penyerahan tambahan.

Diagram menerbitkan voucher kepada donatur pada langkah 6; belum jelas apakah voucher adalah bukti kontribusi donatur, sarana klaim penerima, atau keduanya. Usulan terbaru mempertahankan hak bantuan pada pengajuan dan menautkan voucher ke sana. **Ini keputusan domain yang perlu diterima, bukan sekadar mengganti nama field.** Jika voucher memang memberi kemampuan mengklaim bantuan, kewenangan tersebut perlu dirancang tanpa menggandakan sumber hak yang disetujui.

Hubungan pada alur campaign: penerimaan donasi → alokasi → rincian bantuan disetujui → realisasi → bukti, dengan voucher sebagai referensi penelusuran. Dari realisasi yang sama, aplikasi membentuk tampilan donatur dan sumber laporan periode. Laporan donatur dan laporan periode boleh berbeda cakupan, cut-off dan hak akses, tetapi angka bersamanya harus dapat ditelusuri ke kejadian serta versi sumber yang sama. Selisih antar-cakupan harus dijelaskan, bukan dipaksa sama. Konsistensi dua tampilan internal belum menjadi pembuktian pembayaran oleh sumber independen.

### Satu-ke-satu dan kontribusi bersama

Pilihan eksklusif satu donatur per voucher dapat didukung. Namun satu donasi yang membiayai beberapa voucher tetap memerlukan rincian nominal per voucher. Jika kontribusi beberapa donatur ke satu voucher diizinkan, masing-masing harus melihat bagiannya; model itu tidak boleh disebut satu-ke-satu eksklusif.

Sisa donasi yang belum dialokasikan tetap terlihat terpisah. Pengalihan ke program, penerima, atau bentuk bantuan lain memerlukan kebijakan yang diterima; tidak dilakukan otomatis untuk menghabiskan saldo. Model ini belum memutuskan aturan surplus, biaya, refund, atau ketentuan zakat.

## 3. Cara mencegah tumpang tindih

1. **Pisahkan pendanaan, penyerahan, kelengkapan bukti, dan publikasi.** Contoh: terdanai penuh; diserahkan sebagian; bukti perlu dilengkapi; pencatatan blockchain tertunda. Satu status “selesai” tidak cukup untuk menjelaskan semuanya.
2. **Penerimaan dan alokasi mempunyai identitas stabil.** Pembayaran yang sama tidak menjadi penerimaan baru karena webhook/retry; bagian dana yang sama tidak dialokasikan dua kali. Perubahan alokasi menyimpan riwayat pembatalan/penggantian, bukan menimpa jejak lama.
3. **Realisasi menunjuk hak yang disetujui.** Total realisasi berlaku tidak melampaui hak dalam satuannya. Retry dan pencatatan dari dua petugas harus diperiksa sebagai potensi kejadian yang sama. Kesalahan diperbaiki melalui koreksi berjejak; kejadian gagal atau disengketakan tetap dapat diperiksa.
4. **Pengeluaran dan manfaat tidak dijumlahkan sebagai kejadian setara.** Pembelian paket Rp150.000 lalu penyerahan satu paket kepada penerima bukan bantuan Rp300.000. Pengeluaran menjelaskan biaya; realisasi barang menjelaskan manfaat yang diserahkan.
5. **Nilai rencana dan biaya aktual ditampilkan terpisah.** Paket rencana Rp150.000 yang dibeli Rp140.000 menyisakan selisih Rp10.000 untuk ditangani menurut kebijakan. Angka itu tidak boleh hilang atau membuat kuantitas bantuan bertambah sendiri.
6. **Total beda satuan tetap terpisah.** Satu paket sembako dan Rp100.000 tunai dilaporkan sebagai dua rincian. Nilai IDR barang hanya masuk ringkasan nilai ketika dasar penilaian dinyatakan; jumlah paket tidak dijumlahkan dengan rupiah.
7. **Konfirmasi mengikat kejadian yang spesifik.** Bahan konfirmasi penerima perlu menunjuk rincian bantuan, jenis/jumlah, kejadian dan versi yang dimaksud, serta voucher jika alur menggunakannya. Keberhasilan OTP saja tidak langsung membuktikan jumlah atau isi bantuan yang diserahkan. Protokol dan jalur tanpa telepon belum diputuskan.
8. **Minting tidak menghitung ulang bantuan.** Percobaan ulang publikasi bukti menunjuk realisasi/versi yang sama. Bukti koreksi menautkan catatan sebelumnya, dan notifikasi dikirim berdasarkan hasil publikasi yang benar-benar diketahui.

### Contoh sintetis

Donasi D1 Rp150.000 dialokasikan ke V1: satu paket sembako untuk penerima A. Pembayaran Rp150.000 kepada penyedia dicatat sebagai pengeluaran terkait. Saat paket diterima A, R1 mencatat satu paket diserahkan. Laporan menampilkan biaya Rp150.000 dan satu paket diterima, dengan hubungan antara keduanya; tidak menjumlahkannya menjadi dua bantuan.

Donasi D2 Rp100.000 dialokasikan ke V2: uang tunai Rp100.000 untuk penerima B. Dana diserahkan kepada petugas lalu Rp60.000 diserahkan kepada B. R2 mencatat Rp60.000 dan sisa hak Rp40.000; penyerahan dana ke petugas tidak membuat B dianggap menerima Rp100.000. Bukti tahap pertama tidak menutup voucher seluruhnya.

Contoh menetapkan biaya paket sama dengan alokasi hanya untuk ilustrasi. Tidak mengasumsikan biaya selalu sama atau semua pengeluaran boleh dibebankan ke dana tertentu.

## 4. Transparansi dan arti bukti

Usulan tampilan donatur: nilai kontribusinya, tujuan alokasi, jenis/jumlah bantuan, progres, tanggal yang dinyatakan, kelengkapan bukti, status pemeriksaan, dan referensi bukti digital. Bila voucher didanai bersama, tampilkan kontribusi donatur tersebut dan total voucher tanpa membuka identitas kontributor lain secara otomatis.

Publik memperoleh ringkasan yang diizinkan; petugas/pemeriksa memperoleh dokumen rinci sesuai mandat. NIK, nomor telepon, rekening, foto identitas, dan foto penerima yang dapat mengidentifikasi orang tetap mengikuti batas Dokumen terbatas. Donatur belum otomatis mempunyai hak akses pemeriksa. Membuka foto penerima pada NFT publik memerlukan pembukaan kembali keputusan akses pada ADR-0021/0024; usulan awal ialah bukti publik yang sudah diseleksi dan dokumen asli tetap terbatas.

ERC-721 menetapkan antarmuka kepemilikan, transfer, dan metadata token, bukan verifikasi bahwa sembako telah diserahkan. Ethereum memerlukan sumber eksternal untuk fakta di luar blockchain. Karena itu, kesimpulan desainnya: pencatatan blockchain dapat mengikat catatan/bukti dan pengesahnya; kebenaran kejadian lapangan tetap memerlukan proses pemeriksaan. Ini batas yang juga sudah dicatat ADR-0022. [ERC-721](https://eips.ethereum.org/EIPS/eip-721), [Ethereum: Oracles](https://ethereum.org/en/developers/docs/oracles/), diperiksa 2026-09-16.

Pemilik NFT tidak otomatis menjadi pemilik hak bantuan atau identitas donatur asal. Jika NFT bisa berpindah, atribusi donasi historis harus tetap menunjuk kejadian aslinya. Kebijakan transfer NFT, pihak penerima token, pelaksana minting, biaya, dan pemulihan saat publikasi gagal masih perlu ditetapkan.

## 5. Pemetaan seluruh tiket lama

Status berikut snapshot GitHub sesi 2026-09-16. “Ubah” berarti mempertahankan kebutuhan yang masih berlaku lalu memperinci integrasi; belum mengubah tiket aslinya. Tidak ada tiket yang terbukti harus dibuang seluruhnya.

| Tiket | Status | Rekomendasi | Hubungan dengan diagram dan pekerjaan berikutnya |
| --- | --- | --- | --- |
| [#87](https://github.com/tawf-labs/tawf-zakat/issues/87) akun pribadi | CLOSED | Pakai | Dasar atribusi organizer/petugas. Identitas donatur/penerima dan akun eksternal belum otomatis tercakup. |
| [#88](https://github.com/tawf-labs/tawf-zakat/issues/88) impor sumber | CLOSED | Pakai sesuai kebutuhan | Mendukung sumber laporan; pembaca tabular dapat dipakai #92. Bukan impor pembayaran/voucher siap pakai. Tutup celah smoke browser jika masuk pilot. |
| [#89](https://github.com/tawf-labs/tawf-zakat/issues/89) program/draf | CLOSED | Pakai dan perluas | Tahap 1–2. Program, penerima dan rincian IDR/barang tersedia; campaign, voucher, pendanaan dan identitas kontak perlu rancangan tambahan. |
| [#90](https://github.com/tawf-labs/tawf-zakat/issues/90) mandat | CLOSED | Pakai dan petakan | Dasar kewenangan tahap 2–3/9. Periksa mandat pembukaan campaign, pencairan, petugas penyerahan dan pengesahan bukti. |
| [#91](https://github.com/tawf-labs/tawf-zakat/issues/91) dokumen/pemeriksaan | CLOSED | Pakai | Tahap 1–3. Pemeriksaan kelayakan belum menjadi verifikasi nomor telepon atau keputusan pendanaan. |
| [#92](https://github.com/tawf-labs/tawf-zakat/issues/92) impor penerima | OPEN | Pertahankan model yang disepakati | Tahap 1. Relevan jika pendataan massal. Kolom baru kontak/voucher menunggu keputusan tersendiri; jangan mewajibkan voucher untuk semua penerima. |
| [#93](https://github.com/tawf-labs/tawf-zakat/issues/93) keputusan | OPEN | Ubah integrasi | Tahap 3–4. Tentukan apakah keputusan hak bantuan, pembukaan campaign, dan pencairan adalah tindakan berbeda. Persetujuan lama hanya mengesahkan pencatatan pengajuan. |
| [#94](https://github.com/tawf-labs/tawf-zakat/issues/94) realisasi IDR | OPEN | Pertahankan inti; perluas | Tahap 9–13 untuk uang. Realisasi tetap terkait rincian pengajuan dan bukti penerimaan; voucher menaut ke catatan itu bila tersedia. Pisahkan dana ke petugas dari dana ke penerima. Integrasi pembayaran aktual adalah scope tersendiri. |
| [#95](https://github.com/tawf-labs/tawf-zakat/issues/95) realisasi barang | OPEN | Pertahankan inti; perluas | Tahap 9–13 untuk sembako. Hubungkan biaya/pengadaan yang relevan, jumlah paket, alokasi penerima, dan bukti. Tidak perlu langsung menjadi sistem inventori penuh. |
| [#96](https://github.com/tawf-labs/tawf-zakat/issues/96) revisi/penutupan | OPEN | Pertahankan kebutuhan inti | Pelengkap jalur gagal diagram: penerima berubah, bantuan sebagian, sisa ditutup. Tambahkan dampak terhadap alokasi/voucher; penutupan hak belum menyelesaikan saldo dana. |
| [#97](https://github.com/tawf-labs/tawf-zakat/issues/97) unggah ulang | OPEN | Tunda bersyarat | Dapat menyusul jika pilot menerima koreksi manual berjejak dan tidak memerlukan penggantian berkas massal. Jika file sering diperbarui, tetap kebutuhan pilot. |
| [#98](https://github.com/tawf-labs/tawf-zakat/issues/98) sumber realisasi | OPEN | Masukkan hasilnya ke alur pilot sejak awal | Penghubung utama operasi ke lapisan bukti dan laporan. Tampilan donatur, atribusi dana, dan bukti tahap 14–16 merupakan tambahan; laporan periode tetap memiliki lifecycle sendiri. Perubahan urutan memerlukan perincian scope/dependensi. |
| [#99](https://github.com/tawf-labs/tawf-zakat/issues/99) temuan auditor | OPEN | Nilai bersama pemeriksa pilot | Relevan dengan kesiapan pemeriksaan yang menjadi nilai produk. Ketiadaannya dalam diagram donatur tidak cukup untuk menunda. Siklus diskusi lengkap dapat menyusul jika kebutuhan pilot terpenuhi oleh pembacaan bukti dan pemeriksaan yang tersedia. |

### Temuan kode yang membatasi klaim reuse

- [ProgramRecord](../../backend/src/disbursement.ts) mempunyai status ACTIVE/ARCHIVED. ACTIVE bukan bukti campaign telah melewati persetujuan untuk menggalang donasi.
- Pada berkas yang sama, ID Beneficiary dideskripsikan stabil dalam pengajuan dan tidak memiliki field telepon. Jangan menganggap pendataan yang ada sudah menjadi identitas penerima lintas campaign atau telepon terverifikasi.
- [Endpoint verify-approval](../../backend/src/routes/disbursement.ts) memeriksa kewenangan lalu mengembalikan `allowed` dan mandat. Itu bukan operasi pengesahan keputusan durable yang menjadi #93.
- [Mandat operasional](../../backend/src/operational-mandate.ts) memiliki fungsi pengajuan/realisasi/pemeriksaan; fungsi kampanye dan dana perlu dipetakan secara eksplisit.
- Keberadaan pembuat laporan periode tidak membuktikan laporan donatur tersedia. #98 memang masih merencanakan adapter realisasi baru dan relasi asalnya.

### Dependensi yang perlu ditinjau

Saat ini #95 bergantung pada #94; #96 pada #94; #98 pada #95 dan #96; #99 pada #98. Jika pilot memerlukan kedua bentuk bantuan, pertahankan aturan realisasi bersama lalu buat irisan uang dan barang yang terintegrasi. Jika sembako didahulukan, perinci ulang bagian bersama yang sebelumnya dimiliki #94 dan hubungan blockernya; jangan sekadar mengerjakan #95 dengan melewati dependency.

Kebutuhan baru yang belum menjadi cakupan #87–#99: lifecycle campaign, penerimaan dan atribusi donasi, penerbitan/lifecycle voucher, target pendanaan dan aturan saldo, tindakan pencairan bila aplikasi melaksanakannya, konfirmasi penerima, serta publikasi bukti/notifikasi donatur. Jalur vault lama bukan bukti kemampuan ini cocok dengan pilot baru. Diperlukan pemeriksaan integrasi tersendiri sebelum reuse dinyatakan.

## 6. Pekerjaan pendamping yang dapat berjalan bersama pemetaan

| Pekerjaan | Hasil konkret | Pihak yang diperlukan |
| --- | --- | --- |
| Turunkan diagram ke satu contoh sembako dan satu contoh tunai | Masing-masing memuat aktor, data masuk, keputusan, bukti, status akhir, dan satu skenario gagal; menjadi calon skenario penerimaan | Tim produk dan teman penyusun riset; amil mitra memeriksa kesesuaian |
| Tetapkan arti voucher dan batas pembayaran | Putusan apakah voucher menunjuk kontribusi atau hak bantuan; siapa menerima/mengeluarkan dana; pencatatan atau eksekusi | Pemilik produk dan penanggung jawab operasional mitra |
| Susun matriks siapa boleh melihat apa | Tampilan donatur, publik, amil, penerima dan pemeriksa; contoh bukti yang layak dipublikasikan | Mitra/pemilik data dan tim produk |
| Tetapkan batas pilot | Mitra, waktu penggunaan, volume, perangkat/koneksi, bentuk bantuan, keluaran laporan, penerima hasil | Stakeholder dan pelaksana pilot |
| Ukur pekerjaan yang ingin dikurangi | Contoh dokumen/proses yang boleh diperiksa, jam kerja, jumlah input ulang dan bukti yang harus dikejar; baseline sebelum pilot | Amil/pemeriksa mitra dan tim produk; tidak memerlukan perubahan arsitektur dahulu |
| Telusuri satu kejadian memakai data sintetis | Donasi → alokasi → hak → realisasi → bukti → laporan, termasuk retry, bantuan sebagian dan koreksi | Tim implementasi; percobaan teknis setelah pertanyaan penentunya jelas |

Tidak perlu memulai lima alur implementasi sekaligus. Dokumen kebutuhan, contoh operasional dan penentuan penerima hasil dapat berjalan bersamaan dengan inspeksi kode. Teman penyusun riset paling berguna untuk menjelaskan alasan setiap gerbang pada diagram dan contoh proses nyata, sehingga tim tidak mengulang riset yang sudah dilakukan.

## 7. Daftar pertanyaan awal dan hasil audit kelengkapannya

Daftar berikut merupakan pertanyaan awal; status terkininya ada pada tabel sesudah daftar.

1. Apakah campaign selalu untuk satu jenis bantuan, atau boleh berisi sembako dan uang dengan rincian terpisah? Bagaimana lembaga yang hanya memasukkan bukti dari proses yang sudah ada tetap dilayani?
2. Apa tepatnya yang dimiliki/dilihat donatur saat menerima voucher pada langkah 6? Apakah kontribusi bersama diizinkan?
3. Siapa menerima dana pada langkah 9, dan apakah sistem mengeksekusi pembayaran atau merekam pembayaran lembaga? Jika mengeksekusi, buka kembali ADR-0026 dan batas #86.
4. Apakah target pendanaan menahan seluruh campaign atau hanya hak yang belum cukup didanai? Apa hasil ketika target gagal atau ada sisa biaya?
5. Apa bukti yang diterima untuk tunai, transfer dan sembako; bagaimana penerima tanpa telepon dan penyerahan gagal ditangani?
6. Apakah tahap 14 menerbitkan bukti per kejadian penyerahan atau setelah seluruh voucher selesai? Bagaimana koreksi dan penyaluran sebagian terlihat?
7. Apakah donatur melihat foto penerima? Jika ya, pembatasan akses apa yang disepakati dan bagaimana itu diselaraskan dengan ADR-0021/0024?

Audit setelah Q31 menghubungkan pertanyaan awal dengan [catatan keputusan terkini](../research/0007-pilot-distribusi-dan-penelusuran-grilling.md#putaran-9--keputusan-yang-ditemukan-kembali):

| Pertanyaan awal | Status terkini |
| --- | --- |
| 1: cakupan bantuan/campaign dan sumber lama | Uang/barang dalam rincian pengajuan, satu pengajuan untuk kegiatan pertama (Q14), sumber lembaga tetap dipakai; penggalangan baru bukan syarat (Q6). |
| 2: voucher dan kontribusi bersama | Q9/Q10/Q15: referensi kontribusi, pendanaan gabungan dan alokasi eksplisit. |
| 3: pembayaran/pencairan | Q7: lembaga menjalankan pembayaran. Batas pencatatan biaya/uang muka masih Q34. |
| 4: target/sisa | Gerbang target crowdfunding tidak otomatis berlaku pada dana yang sudah diterima. Sisa tidak dipindahkan otomatis; pengalihan disengaja masih Q35. |
| 5: bukti dan pengecualian | Aturan lama bantuan uang/barang dan perwakilan, Q12/Q16 OTP/BAST, Q31 sengketa; rincian teknis/SOP tetap diturunkan. |
| 6: penerbitan/koreksi dan parsial | Q18 menerima publikasi sebelum laporan; unit/siklus sertifikat distribusi masih Q32, NFT Q33, arti selesai Q36. Q24 adalah versi bukti kontribusi, bukan keputusan otomatis untuk distribusi. |
| 7: foto penerima | Q11: foto wajah/identitas serta dokumen lengkap penerima terbatas; akses donatur tidak membuka hak pemeriksa. |

Q32 dan Q34–Q36 diterima; Q33 memilih NFT wajib pilot. Q37–Q40 kemudian menerima pemegang lembaga, pembatasan transfer/pemulihan berjejak, NFT per versi dan operasi beranggaran. Tabel ini tidak mengubah seluruh alternatif lama menjadi kebutuhan pilot.

Teks ini menyimpan usulan awal agar dapat ditinjau. Keputusan yang diterima kemudian dicatat pada glosarium/ADR; kode, issue, label dan dependensi belum diubah. Nama file asal tidak menjadi penilaian kualitas riset. Tenggat dan cakupan pilot final belum ditetapkan.

## Tindak lanjut tracker

Penataan yang diminta pengguna telah dijalankan: spec #100 terbit, #86/#92–#99 disesuaikan, #87–#91 dipertahankan selesai, dan sebelas issue lama ditutup dengan bukti atau cakupan pengganti. Lihat [hasil publikasi dan verifikasi](../verification/0100-pilot-spec-tracker.md). Status snapshot historis pada tabel awal tidak menggantikan hasil sinkronisasi ini.

Setelah persetujuan `to-tickets`, 15 tiket #101–#115 diterbitkan di bawah #100 dengan dependensi native. Lihat [indeks tiket](../design/pilot-distribution-tickets.md) dan [verifikasi publikasi tiket](../verification/0101-pilot-tickets.md).
