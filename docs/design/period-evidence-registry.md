# Rancangan Registry Bukti Laporan Periode

- Tanggal: 2026-09-08.
- Status: rancangan hasil `grill-with-docs`; Q1–Q9 diterima. Detail implementasi dan operasional yang belum ditetapkan disebutkan secara eksplisit di bawah.
- Dasar keputusan: [ADR-0020](../adr/0020-institutional-pilot-evidence-and-reconciliation.md), [ADR-0021](../adr/0021-period-evidence-institutional-endorsement-and-private-sources.md), [ADR-0022](../adr/0022-append-only-report-evidence-registry.md).
- Bukti implementasi dan wawancara: [riset 0004](../research/0004-smart-contract-project-fit-grilling.md). Spec implementasi telah diterbitkan sebagai [issue #68](https://github.com/tawf-labs/tawf-zakat/issues/68); dokumen ini mempertahankan dasar desain dan riwayat keputusan.
- Pemecahan yang disetujui telah diterbitkan sebagai 11 sub-issue #69–#79 di bawah spec #68, dengan 12 hubungan dependensi native yang terverifikasi. Ambil urutan dan status terkini dari tracker; tiket awal tanpa blocker adalah [#69 — Ruang kerja lembaga](https://github.com/tawf-labs/tawf-zakat/issues/69).

Pilot membantu lembaga merekonsiliasi sumber, menyusun laporan periode, mengesahkan paket bukti, dan menyediakan bahan pemeriksaan auditor. Registry terpisah mengikat paket dan pengesahannya. Dana tetap berada dalam kendali lembaga; penerimaan melalui vault bukan prasyarat membuat bukti laporan.

## 1. Alur dan pembagian tanggung jawab

1. Lembaga memasukkan data sumber dengan cakupan periode, unit pelapor, jenis dana, mata uang, dan cut-off yang jelas.
2. Backend membekukan sumber, menghitung rekonsiliasi serta angka laporan, dan menyimpan temuan. Pembaca berwenang dapat menghitung ulang dari snapshot yang sama.
3. AI menyusun draf; validator deterministik memeriksa kesesuaian draf terhadap angka dan aturan yang dinyatakan. Layanan harus membedakan pemeriksaan ini dari pemeriksaan kelengkapan sumber.
4. Lembaga mengesahkan paket tertentu. Registry mencatat bukti; penerbitan sebagai laporan lolos memerlukan pengesahan lembaga dan layanan validator atas paket yang sama sesuai Q9/ADR-0022.
5. Auditor memberi atestasi terhadap versi yang benar-benar diperiksa. Koreksi menghasilkan versi baru, menunjuk pendahulunya, dan menyimpan alasan serta pengesah.

Backend bertanggung jawab atas penyimpanan, perhitungan, akses, dan pengiriman transaksi. Kontrak bertanggung jawab atas identitas paket, otorisasi tindakan, hubungan versi, serta catatan atestasi. Antarmuka menampilkan status masing-masing pemeriksaan dan menyediakan berkas sesuai akses pembaca.

## 2. Status yang harus dibedakan

| Dimensi | Makna dan batas |
| --- | --- |
| Sumber dibekukan | Snapshot tertentu tersedia dengan cakupan dan cut-off. Tidak membuktikan semua transaksi lembaga telah diberikan. |
| Hasil rekonsiliasi | Cocok, ditemukan selisih, atau belum diperiksa; cantumkan sumber dan cakupan pembanding. Selisih bukan kesimpulan kecurangan. |
| Vonis draf | `LOLOS` atau `DITOLAK` menurut versi validator tertentu. Draf yang sesuai angka dapat tetap melaporkan selisih rekonsiliasi secara jujur. |
| Bukti tercatat | Registry menerima commitment dan pengesahan untuk pencatatan bukti. Temuan atau draf ditolak tetap dapat disimpan dengan statusnya. |
| Laporan diterbitkan | Pengesahan lembaga dan pernyataan lolos layanan validator diterima untuk paket/versi yang sama. Ini bukan opini auditor atau pembuktian kebenaran seluruh sumber. |
| Pemeriksaan auditor | Atestasi berisi lingkup dan kesimpulan auditor untuk versi tertentu; tidak diwarisi otomatis oleh versi koreksi. |
| Konfirmasi blockchain | Transaksi diajukan, masuk blok, dan mencapai tingkat konfirmasi yang ditentukan. Hash transaksi saja belum cukup. |

Tidak ada satu status `verified` yang menggantikan seluruh dimensi ini. Ringkasan publik harus menjelaskan siapa menyatakan apa dan atas versi mana.

## 3. Paket yang diikat

Berikut kebutuhan skema yang direkomendasikan untuk spec; nama field dan encoding belum ditetapkan:

- Identitas lembaga, unit pelapor/cakupan konsolidasi, periode, identitas laporan, identitas versi, dan versi sebelumnya bila merupakan koreksi.
- Manifest snapshot: asal sumber, waktu pengambilan/cut-off, format dan versi pemetaan, cakupan yang tersedia/hilang, serta commitment berkas mentah dan baris yang dinormalisasi.
- Nilai mata uang dalam unit eksplisit tanpa tebakan dari besar angka; jenis dana dan dasar aturan amil yang berlaku pada lembaga. Cakupan yang belum didukung dinyatakan belum diperiksa.
- Hasil rekonsiliasi, angka laporan, klaim/narasi draf, temuan, vonis, serta versi mesin perhitungan dan aturan validator.
- Ringkasan publik dan commitment paket; lokasi berkas terbatas diselesaikan melalui layanan akses. Alasan koreksi dan identitas pengesah terikat pada versi.

Snapshot harus berasal dari pembacaan konsisten atau berkas unggahan yang sudah dibekukan. Kegagalan membaca database tidak boleh berubah menjadi snapshot kosong yang dianggap berhasil. Spec perlu menetapkan serialisasi kanonik, batas ukuran, serta apa yang termasuk dalam hash agar backend, wallet, dan kontrak mengikat isi yang sama.

Sumber identitas dan rincian bank tetap terbatas. NIK atau pengenal yang mudah ditebak tidak aman hanya karena di-hash; commitment, redaksi, penyimpanan, dan akses perlu dirancang bersama. CID publik bukan kontrol akses. Retensi, pemulihan akses, dan pemegang kunci berkas diputuskan saat desain penyimpanan/onboarding lembaga.

## 4. Operasi registry yang diusulkan

Nama berikut menjelaskan perilaku, belum menetapkan ABI:

| Operasi | Otorisasi dan perilaku yang perlu diuji |
| --- | --- |
| `recordEvidence` | Pengesahan lembaga mengikat paket dan tujuan pencatatan. Boleh menyimpan hasil yang menemukan selisih atau draf ditolak; tidak menghasilkan status laporan lolos. |
| `publishReport` | Memerlukan pengesahan lembaga dan hasil `LOLOS` bertanda tangan layanan validator yang berwenang atas paket yang sama. Registry memeriksa kedua kewenangan. |
| `attestReport` | Auditor berwenang mengikat versi, lingkup pemeriksaan, kesimpulan, dan commitment bukti pemeriksaannya. Keberadaan atestasi tidak selalu berarti opini positif. |
| Pencatatan versi koreksi | Versi baru menunjuk versi sebelumnya milik lembaga/laporan yang sesuai, membawa alasan dan pengesah. Bukti sebelumnya tetap tersedia; atestasi lama tetap melekat pada versi lama. |

Pencatatan dan penerbitan bisa memakai mekanisme penyimpanan yang sama, tetapi tujuan signature dan aturan otorisasinya harus berbeda. Pengesahan untuk menyimpan bukti tidak boleh dipakai ulang sebagai izin menerbitkan laporan. Usulan spec: satu penerus resmi per versi agar koreksi serentak tidak menciptakan dua versi terbaru; mekanisme konflik dan pembatalan pengajuan ditentukan sebelum implementasi.

Registry tidak membutuhkan fungsi deposit atau transfer token untuk memenuhi keputusan pilot. ABI vault lama tetap merupakan integrasi tersendiri. Pilihan proxy/upgrade tidak otomatis mengikuti kebutuhan versi laporan; versi data berbeda dari upgrade logic kontrak.

## 5. Q9 — Gerbang penerbitan dan kepercayaan validator

**Keputusan diterima dalam [ADR-0022](../adr/0022-append-only-report-evidence-registry.md):** `publishReport` memerlukan pengesahan lembaga dan pernyataan `LOLOS` bertanda tangan dari layanan validator berwenang atas paket immutable yang sama.

Dengan pilihan ini, kontrak menolak jalur langsung yang hanya membawa pengesahan lembaga tanpa pernyataan validator yang sah. Kontrak memeriksa dua kewenangan yang berbeda secara eksplisit, bukan sekadar menghitung dua signature. Relayer hanya mengirim transaksi; ia tidak memperoleh hak mengesahkan laporan karena membayar gas.

Kedua pengesahan perlu mengikat identitas lembaga/laporan/versi, induk koreksi, digest paket, hasil/versi kebijakan validator, tujuan tindakan, batas berlaku, dan perlindungan replay. Domain signature mengikat chain serta alamat registry. Detail nonce dan retry idempoten ditetapkan dalam spec. [EIP-712](https://eips.ethereum.org/EIPS/eip-712) tidak menyediakan perlindungan replay dengan sendirinya.

**Batas kepercayaan:** signature layanan membuktikan layanan menyatakan paket lolos. Ia tidak membuktikan layanan benar-benar menjalankan algoritme dengan benar. Layanan yang salah atau kuncinya disalahgunakan dapat menandatangani hasil palsu; pengesahan lembaga tetap dibutuhkan, dan pihak berwenang dapat memeriksa ulang dari snapshot. Kontrak tidak mengetahui kebenaran pembayaran bank atau kelengkapan sumber melalui hash/signature saja. Lihat [batas fakta eksternal](https://ethereum.org/developers/docs/oracles/#what-is-the-oracle-problem).

Trade-off penerbitan ini adalah ketergantungan pada ketersediaan dan kejujuran layanan validator. Perhitungan yang dapat diulang membantu pemeriksa menemukan ketidaksesuaian; kemampuan tersebut tidak otomatis mencegah layanan menyatakan hasil palsu sebelum diperiksa pihak lain.

Usulan kompatibilitas: dukung EOA dan akun kontrak melalui [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271). Validasi akun kontrak bergantung pada state saat transaksi; perubahan owner Safe tidak menghapus riwayat publikasi yang sudah diterima. Kebijakan onboarding lembaga/auditor, rotasi, pencabutan, serta pemulihan kewenangan masih perlu dirinci. Dua pengesahan ini bukan dua opini audit dan tidak membuat layanan ZKT independen dari dirinya sendiri.

## 6. Kecocokan dengan implementasi sekarang

- Mesin rekonsiliasi dan validator murni dapat dipertahankan. Adapter snapshot, identitas lembaga/versi, penyimpanan bukti, signing, registry, dan pembacaan status adalah pekerjaan tambahan.
- `validateDraft` saat ini mempercayai input angka dan flag plafon amil. Layanan penerbitan harus membangun hasil dari snapshot terikat dan menerapkan kebijakan kelengkapan yang eksplisit; menandatangani respons validator lama saja belum memenuhi rancangan paket.
- OpenZeppelin 5.5.0 lokal menyediakan `EIP712`, `SignatureChecker`, dan `Nonces`, kompatibel dengan Solidity 0.8.31 repo. Kebijakan dua peran, encoding paket, deadline, dan versi tetap perlu diimplementasikan aplikasi.
- Helper typed-data lama mengikat vault, belum memiliki paket/revisi/nonce/deadline, dan verifikasi backend lama berbasis EOA. Helper tersebut tidak dapat langsung dianggap mendukung registry dan Safe.
- Preservasi unit native USDC serta identitas event dalam [issue #67](https://github.com/tawf-labs/zkt-hackathon/issues/67) diperlukan sebelum sumber internal USDC diklaim terverifikasi secara presisi. Intake eksternal harus menyatakan unit dan cakupannya sendiri.
- Konfirmasi anchor perlu receipt/event yang benar, penanganan retry, serta pemulihan ketika blok berubah. Ketersediaan source snapshot juga harus dipantau; commitment saja tidak menjamin berkas dapat dibaca kemudian.
- Temuan DPS, pool Amil, BAST, dan auditor pada vault tetap terbuka untuk pengguna alur vault. Registry laporan tidak memperbaiki aturan kontrak tersebut.

## 7. Kriteria penerimaan untuk spec berikutnya

1. Paket dapat dihitung ulang dari snapshot; perubahan sumber/draf/hasil/versi setelah pengesahan membuat verifikasi gagal.
2. Kegagalan sumber dibedakan dari data kosong, dan cakupan yang hilang tidak berubah menjadi klaim rekonsiliasi lengkap.
3. Bukti dengan temuan tetap tersimpan. Draf `DITOLAK` tidak mendapat status laporan lolos; uji API dan kontrak langsung sesuai keputusan Q9.
4. Otorisasi yang salah lembaga/aksi/domain, kedaluwarsa, atau diulang ditolak; validator hilang/tidak berwenang atau paket kedua signature berbeda juga ditolak.
5. Koreksi tidak menghapus versi/atestasi lama dan tidak menghubungkan laporan lintas lembaga. Retry tidak membuat versi ganda.
6. Rotasi/pencabutan kewenangan berlaku untuk tindakan baru tanpa menghapus sejarah tindakan yang sah. Uji EOA dan ERC-1271 jika dukungan tersebut masuk spec.
7. Transaksi gagal, belum terkonfirmasi, atau terkena perubahan canonical block tidak ditampilkan sebagai anchor yang telah memenuhi kebijakan konfirmasi.
8. Pembaca tanpa kewenangan tidak memperoleh berkas sensitif melalui aplikasi atau lokasi penyimpanan; ringkasan publik tetap menampilkan cakupan/status sebenarnya.

Tes baseline vault yang sudah dijalankan berjumlah 23 lulus; belum ada implementasi atau tes registry baru. Q1–Q9 telah diterima sebagai dasar arsitektur untuk spec. Format sumber lembaga nyata dan kebijakan operasional tetap perlu divalidasi sebelum menyatakan pilot siap digunakan.

## 8. Urutan yang direkomendasikan untuk spesifikasi

Mulai dengan satu alur utuh: data contoh lembaga → snapshot → rekonsiliasi dan draf → dua pengesahan → registry → tampilan publik/akses pemeriksa → versi koreksi. Irisan awal ini menguji hubungan antarkomponen yang selama ini terlewat. Kriteria pada bagian 7 menjadi kontrak perilaku lintas backend, Solidity, dan antarmuka.

Sebelum tiket implementasi dinyatakan siap dikerjakan, spec harus menyelesaikan hal berikut; keputusan Q1–Q9 belum memilih detail ini:

| Detail terbuka | Hasil konkret yang diperlukan |
| --- | --- |
| Sumber dan cakupan awal | Sampel berkas, format masukan, jenis dana yang didukung, unit, periode/cut-off, serta aturan data hilang. Tidak mengasumsikan akses API SiMBA. |
| Kewenangan | Pemegang kewenangan onboarding lembaga/auditor/validator, pemisahan pemegang kunci, rotasi, pencabutan, dan pemulihan. |
| Kebijakan lolos | Pemeriksaan wajib atas kelengkapan dan angka, batas vonis validator, serta penyajian selisih yang dilaporkan dengan benar. |
| Berkas terbatas | Penyimpanan, enkripsi/redaksi, pemberian akses, retensi, dan pemulihan ketersediaan bukti. |
| Protokol paket dan versi | Serialisasi/hash, skema pengesahan, replay/retry, konflik koreksi, serta hubungan atestasi dengan versi. |
| Operasional chain | Jaringan/deployment registry, kebijakan konfirmasi dan pemulihan reorg, serta keputusan upgrade logic jika diperlukan. |

Penyesuaian alur vault ditangani berdasarkan kebutuhan pengguna alur tersebut dan temuan riset 0004. Registry baru tidak menjadi alasan menandai temuan vault selesai. Issue yang sudah ada perlu dipetakan terhadap spec agar pekerjaan snapshot/angka presisi tidak diduplikasi.
