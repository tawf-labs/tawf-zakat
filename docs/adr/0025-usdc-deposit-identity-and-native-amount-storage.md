# ADR-0025: Identitas dan Jumlah Asli Deposit USDC Disimpan, Tanpa Backfill Berdasarkan Kemiripan

- Status: Accepted — diputuskan saat implementasi tiket #67 (tindak lanjut pasca-v0 dari Spec #55).
- Date: 2026-09-09.
- Decider: implementasi tiket #67, sebagai penerus terbatas atas ADR-0017 keputusan 9.
- Related: ADR-0017 (inti rekonsiliasi murni dan batas tanpa migrasi), ADR-0004 (Drizzle dan Neon), ADR-0021 (paket bukti dan sumber privat), ADR-0024 (snapshot dibekukan).

Baris donasi USDC **menyimpan jumlah aslinya dalam satuan minor USDC** dan **identitas event depositnya** — chain, kontrak, transaction hash, dan log index — pada lima kolom baru di tabel `donations`, dijaga oleh satu indeks unik parsial. Migrasinya **dijalankan operator secara eksplisit**, bukan saat boot. **Tidak ada backfill baris historis berdasarkan kemiripan.**

## Mengapa ini menyimpang dari ADR-0017 keputusan 9

ADR-0017 keputusan 9 menetapkan v0 bersifat stateless: "No new tables, no Drizzle migrations, no stored history." Batas itu benar untuk tujuannya — mesin rekonsiliasi dapat diuji terhadap angka LPZN sungguhan dan didemokan ke lembaga mitra sebelum skema penyimpanan dikunci.

ADR yang sama sudah mencatat harga batas tersebut pada bagian batasannya: "USDC deposits are not reconciled per deposit… Closing this needs columns that v0's no-migration constraint rules out." Tiket #67 adalah pekerjaan pasca-v0 yang membayar harga itu, dan sengaja dipisahkan dari #55 maupun deployment tanpa migrasi #66 justru agar penyimpangan ini menjadi keputusan tersendiri dan bukan efek samping sebuah rilis.

Karena itu ADR ini **tidak membatalkan** keputusan 9. Ia mempersempitnya: batas tanpa migrasi tetap berlaku untuk mesin rekonsiliasi dan jalur v0, sedangkan penyimpanan identitas deposit USDC dikeluarkan darinya dengan prosedur, verifikasi, dan pemulihan yang dituliskan di [runbook](../design/usdc-deposit-identity-operations.md).

Batas ADR-0017 tentang bentuk kode tetap utuh: pemetaan deposit tetap fungsi murni, dua pemanggil membaca inti yang sama, dan tidak ada logika perbandingan yang ditulis ulang.

## Apa yang disimpan, dan mengapa dalam bentuk itu

Jumlah disimpan sebagai **teks desimal**, bukan kolom numerik. Driver pada proyek ini mengembalikan kolom `bigint` sebagai JavaScript number, dan `Number` berhenti eksak pada 9.007.199.254.740.991 satuan minor — sebuah jumlah yang nyata jauh sebelum ia besar. Teks desimal adalah satu-satunya bentuk yang selamat melewati driver, JSON, dan serialisasi kanonik tanpa kehilangan satuan.

Identitas mengikat keempat bagiannya sekaligus. Transaction hash sendirian tidak cukup: dua deposit dalam satu transaksi hanya dibedakan oleh log index, dan transaksi yang sama pada chain berbeda bukan deposit yang sama. Indeks uniknya **parsial** (`WHERE deposit_tx_hash IS NOT NULL`) agar baris warisan yang tidak memiliki identitas tidak saling bertabrakan pada satu tuple NULL.

`trxId` diturunkan dari identitas itu, menggantikan sufiks acak. Sufiks acak membuat `ON CONFLICT DO NOTHING` tidak pernah menemukan konflik, sehingga event yang diproses ulang menyisipkan donasi kedua — idempotensi yang tampak ada di kode tetapi tidak pernah berlaku.

`amount_idr` diisi `0` untuk deposit baru. Itu sebuah fakta: deposit USDC tidak menyumbang rupiah. Yang digantikannya adalah estimasi pada kurs tetap 16.200 yang disajikan sebagai angka, padahal ia sebuah taksiran yang tidak dapat dijalankan mundur menjadi deposit.

## Migrasi dijalankan operator, bukan saat boot

Skema tidak berubah karena sebuah proses dinyalakan. Tiket #66 menyebar tanpa migrasi, dan perubahan skema yang datang sebagai efek samping deployment persis yang dihindari dengan memisahkan pekerjaan ini.

Konsekuensinya, kode harus berjalan di kedua sisi migrasi. Jalur intake memeriksa katalog, lalu menulis baris dalam bentuk warisan bila kolomnya belum ada, sambil mencatat peringatan. Menolak menyimpan deposit karena skemanya belum siap akan kehilangan deposit itu sepenuhnya — kegagalan yang lebih buruk daripada menyimpannya tanpa identitas.

Alternatif yang ditolak: menjalankan migrasi otomatis saat boot. Itu memindahkan keputusan skema dari operator ke jadwal rilis, dan membuat rollback deployment tidak lagi berarti rollback basis data.

## Tidak ada backfill berdasarkan kemiripan

Baris donasi USDC yang ditulis sebelum tiket ini menyimpan estimasi rupiah, sebuah timestamp, dan alamat donatur yang dipotong. Tidak satu pun dapat membuktikan dari log mana baris itu berasal: dua deposit dengan besaran sama pada jam yang sama tidak dapat dibedakan oleh ketiganya.

Memasangkannya dengan cara menebak akan menghasilkan persis rekonsiliasi palsu yang menjadi alasan pekerjaan ini ada — dan palsu dengan cara yang paling sulit ditemukan kemudian, karena hasilnya tampak seimbang. Karena itu baris warisan dibiarkan apa adanya dan dilaporkan sebagai **belum terverifikasi** beserta `trx_id`-nya, pada mode internal, pada paket bukti, dan pada `usdc:verify`.

Backfill tetap sah bila kelak ada sumber on-chain yang dapat membuktikan pasangan **dan** jumlahnya. Itu pekerjaan tersendiri dengan buktinya sendiri, bukan perluasan diam-diam skrip migrasi ini.

## Sisi penyaluran, ditutup terpisah

Ketika ADR ini ditulis, jumlah **penyaluran** USDC masih dibaca dengan heuristik besar angka (`toUsdcMinorUnits` menskalakan ulang nilai di bawah 1.000.000), sehingga proposal 0,5 USDC dilaporkan sebagai 500.000 USDC dan basis hak amil dalam USDC dinyatakan belum dapat diperiksa.

Tiket #80 menutupnya dengan keputusan yang sama bentuknya, di tabel sebelahnya:

- Heuristiknya dihapus. Satuan diambil dari `currency_type` — sebuah fakta tersimpan — dan tidak pernah dari besar angka. Ini tidak memerlukan migrasi sama sekali.
- Kolom `disbursement_proposals.amount_exact` (TEXT) menyimpan jumlah persis seperti yang dinyatakan chain, dengan migrasi aditif yang dijalankan operator lewat `bun run proposal:migrate`. Kolom itu mengangkat penolakan pembaca chain atas jumlah di atas 2^53 satuan minor.
- Baris tanpa kolom eksak tetap terbaca lewat kolom angka. Itu bukan tebakan: satuannya tetap dari `currency_type`, hanya presisinya yang dibatasi.
- Basis hak amil USDC karena itu menjadi dapat diperiksa: pengumpulan dari deposit terverifikasi, penyaluran dari proposal tereksekusi. Bila salah satu belum lengkap, keduanya dilaporkan `null` beserta alasannya, bukan nol.

Backfill jumlah eksak untuk baris lama **sah** di sini, tidak seperti deposit warisan pada #67: proposal membawa `proposalIdOnChain`, dan chain memancarkan `DisbursementProposed`/`DisbursementExecuted` beserta jumlahnya, sehingga pasangannya dapat dibuktikan. Itu tetap pekerjaan tersendiri dengan pengujiannya sendiri terhadap chain, bukan sesuatu yang dijalankan skrip migrasi tanpa pengawasan.

## Yang tetap terbuka

Kolom `disbursement_proposals.amount` tetap `bigint({ mode: "number" })` dan tetap menjadi sumber bagi baris yang belum menyimpan jumlah eksak. Menghapusnya berarti menulis ulang setiap penulis proposal dan menyentuh governance; itu keputusan tersendiri lagi.
