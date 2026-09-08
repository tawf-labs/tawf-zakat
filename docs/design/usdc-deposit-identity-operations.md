# Identitas dan jumlah asli deposit USDC — tiket #67

Status: implementasi pengembangan, data sintetis dan basis data uji terisolasi. **Tidak ada migrasi atau deployment produksi yang dijalankan oleh tiket ini.** Menjalankan `apply` pada salinan produksi adalah tindakan operator yang terpisah dan disengaja; menyebarkan kodenya bukan persetujuan untuk itu, dan tiket #66 tetap merupakan deployment tanpa migrasi.

Keputusan arsitekturnya dicatat pada [ADR-0025](../adr/0025-usdc-deposit-identity-and-native-amount-storage.md), yang mempersempit batas tanpa migrasi [ADR-0017](../adr/0017-reconciliation-engine-v0-shared-pure-core-and-two-callers.md) keputusan 9 untuk cakupan ini saja.

## Apa yang berubah, dan mengapa

Sebelum tiket ini, satu deposit USDC masuk ke aplikasi lewat event `USDCDeposited` dan kehilangan tiga hal sekaligus di batas intake:

- **Presisinya.** Jumlahnya melewati `Number`, lalu diskalakan ulang dengan heuristik besar angka (`amountUSDC > 1e6 ? /1e6 : amountUSDC`). Deposit 0,5 USDC menjadi 500.000 USDC.
- **Nilainya.** Yang tersimpan hanya estimasi rupiah pada kurs tetap 16.200. Estimasi bukan jumlah, dan kurs itu tidak dapat dijalankan mundur menjadi deposit.
- **Identitasnya.** `txHash` dan `logIndex` dibuang, sehingga baris ledger tidak dapat dipasangkan kembali dengan event yang menghasilkannya.

Ditambah satu cacat idempotensi: `trxId` dibuat dengan sufiks acak, sehingga `ON CONFLICT DO NOTHING` tidak pernah menemukan konflik dan event yang diproses ulang menyisipkan donasi kedua.

Sesudahnya: jumlah disimpan sebagai satuan minor USDC dalam bentuk teks desimal, identitas mengikat chain, kontrak, transaction hash dan log index, `trxId` diturunkan dari identitas itu, dan `amount_idr` bernilai `0` — sebuah fakta, karena deposit USDC memang tidak menyumbang rupiah, menggantikan estimasi yang selama ini disajikan sebagai angka.

## Kolom dan indeks yang ditambahkan

Pada tabel `donations`, seluruhnya nullable dan aditif:

| Kolom | Tipe | Isi |
| --- | --- | --- |
| `amount_usdc_6dp` | TEXT | Satuan minor USDC sebagai bilangan bulat desimal |
| `deposit_chain_id` | INTEGER | Chain id EIP-155 |
| `deposit_contract` | TEXT | Alamat kontrak, huruf kecil |
| `deposit_tx_hash` | TEXT | Transaction hash, huruf kecil |
| `deposit_log_index` | INTEGER | Log index di dalam transaksi tersebut |

Ditambah indeks unik parsial `donations_deposit_identity` atas keempat kolom identitas `WHERE deposit_tx_hash IS NOT NULL`. Parsial, agar baris warisan yang tidak memiliki identitas tidak saling bertabrakan pada satu tuple NULL. Dua deposit dalam transaksi yang sama dibedakan oleh log index.

`amount_usdc_6dp` sengaja TEXT, bukan kolom numerik: driver pada proyek ini mengembalikan kolom `bigint` sebagai JavaScript number, dan jumlah deposit harus tetap utuh melewati 2^53 satuan minor.

Tidak ada kolom lama yang diubah, dihapus, atau ditulis ulang. Baris warisan tidak disentuh migrasi ini.

## Prosedur migrasi

1. Hentikan writer pada salinan yang akan dimigrasi, atau pastikan indexer tidak sedang memproses event.
2. Ambil backup PostgreSQL beserta manifest checksum-nya; simpan di lokasi terbatas. Migrasi ini aditif, tetapi backup adalah syarat pemulihan pada langkah 6, bukan formalitas.
3. Jalankan pemeriksaan dahulu, tanpa menulis apa pun:
   ```
   cd backend && DATABASE_URL=... bun run usdc:verify
   ```
   Keluarannya menyebut apakah migrasi sudah ada, berapa baris donasi USDC yang tersimpan, dan berapa yang belum terverifikasi.
4. Terapkan:
   ```
   cd backend && DATABASE_URL=... bun run usdc:migrate
   ```
   Seluruh pernyataan memakai `ADD COLUMN IF NOT EXISTS` / `CREATE UNIQUE INDEX IF NOT EXISTS`, sehingga menjalankannya dua kali tidak berpengaruh. Skrip memverifikasi ulang setelah menerapkan, agar yang terbaca adalah keadaan yang baru saja dibuat.
5. Jalankan indexer dan amati satu deposit baru masuk. Baris barunya harus memuat `amount_usdc_6dp` dan keempat kolom identitas. Proses ulang event yang sama; jumlah baris tidak boleh bertambah.
6. Bila perlu dibatalkan: migrasi ini tidak menghapus data, sehingga pemulihan berarti mengembalikan backup langkah 2. Kolom yang sudah ditambahkan boleh dibiarkan — kode berjalan pada kedua sisi migrasi.

## Deployment yang belum dimigrasi

Kode berjalan tanpa kolom-kolom ini. Jalur intake memeriksa katalog sekali, lalu menulis baris dalam bentuk warisan dan mencatat peringatan bahwa identitas tidak tersimpan. Deposit tetap tercatat; yang hilang adalah kemampuan memasangkannya. Ini keadaan yang sah dan sengaja didukung: menolak menyimpan deposit karena skemanya belum siap akan kehilangan deposit itu sepenuhnya.

Baris yang ditulis dalam keadaan itu menyimpan `amount_idr = 0` dan tidak menyimpan jumlah aslinya, sehingga nilainya memang tidak terbaca dari baris tersebut. Itu disengaja: mengembalikan estimasi kurs tetap berarti menyajikan taksiran sebagai angka, persis yang tiket ini hapus. Jumlahnya tidak hilang dari sistem — `onchain_events` menyimpan seluruh argumen event, termasuk `amountUSDC` yang eksak — dan baris menjadi lengkap setelah migrasi dijalankan lalu event diindeks ulang. Peringatan pada log menyebut `txHash#logIndex` yang bersangkutan agar baris itu dapat ditemukan kembali.

Pembacaan tabel `donations` juga aman sebelum migrasi. Drizzle menyebut setiap kolom modelnya pada `SELECT`, sehingga menambahkan lima kolom ke model akan menggagalkan **seluruh** pembacaan `donations` pada basis data yang belum dimigrasi. Karena itu proyeksi kolom dipilih dari katalog: kolom lama selalu disebut, kolom deposit hanya disebut bila ada. Perilaku ini diuji pada `usdc_deposit_store.test.ts`, bagian "reading donations across the migration boundary".

Pada sisi pembacaan, jalur sumber internal USDC pada paket bukti menyatakan sisi klaim `MISSING` dengan alasan yang menyebut tiket ini, dan seluruh baris USDC ikut sebagai catatan belum terverifikasi. Sisi on-chain tetap dibaca. Sumber terstruktur lain tidak terpengaruh sama sekali.

## Strategi baris historis

**Tidak ada backfill berdasarkan kemiripan, dan itulah strateginya.**

Baris donasi USDC yang ditulis sebelum tiket ini menyimpan estimasi rupiah pada kurs tetap, sebuah timestamp, dan alamat donatur yang dipotong. Tidak satu pun dapat membuktikan dari log mana baris itu berasal: dua deposit dengan besaran sama pada jam yang sama tidak dapat dibedakan oleh ketiganya. Memasangkannya dengan cara menebak akan menghasilkan persis rekonsiliasi palsu yang menjadi alasan pekerjaan ini ada.

Karena itu:

- Baris warisan dibiarkan apa adanya. Estimasi rupiahnya tidak dihapus dan tidak dikonversi.
- Baris tersebut dilaporkan sebagai **belum terverifikasi**, dengan `trx_id`-nya, pada `usdc:verify`, pada mode internal `/api/reconciliation/internal`, dan pada paket bukti.
- Angka periode melaporkannya terpisah sebagai `pengumpulan.usdc_estimasi_idr` — estimasi warisan, di luar total pengumpulan — sedangkan `pengumpulan.usdc` hanya memuat baris yang menyimpan jumlah aslinya.
- Backfill hanya sah bila sumber on-chain dapat membuktikan pasangan **dan** jumlahnya. Untuk baris warisan, tidak dapat. Bila kemudian ditemukan sumber yang membuktikannya — misalnya catatan operasional yang menyimpan `txHash` per transaksi — pemetaan itu adalah pekerjaan tersendiri dengan buktinya sendiri, bukan perluasan diam-diam skrip ini.

## Verifikasi setelah migrasi

`usdc:verify` melaporkan empat angka, dan masing-masing berarti sesuatu yang berbeda:

- **Baris donasi USDC** — seluruh baris dengan `payment_method = 'USDC'`.
- **Terikat identitas event** — baris dengan identitas *dan* jumlah asli. Hanya baris inilah yang masuk perbandingan.
- **Belum terverifikasi** — sisanya, beserta `trx_id`-nya. Angka ini tidak diharapkan menjadi nol pada deployment yang pernah menjalankan jalur lama.
- **Migrasi belum diterapkan** — dilaporkan sebagai keadaan tersendiri, bukan sebagai nol baris teridentifikasi. Ledger yang tidak dapat menyimpan identitas dan ledger yang kebetulan belum menyimpannya bukan hal yang sama.

Untuk memeriksa rekonsiliasinya sendiri, jalankan mode internal atau bekukan paket bukti dari sumber internal USDC. Keduanya membaca mapper yang sama, sehingga tidak mungkin memberi dua jawaban berbeda tentang satu deposit.

## Yang tetap berada di luar cakupan

- **Jumlah penyaluran USDC masih dibaca dengan heuristik besar angka.** `ledger-rows.ts:toUsdcMinorUnits` menskalakan ulang nilai di bawah 1.000.000, dan itu dipakai untuk jumlah *proposal*, bukan deposit. Proposal 0,5 USDC akan dilaporkan sebagai 500.000 USDC pada jalur rekonsiliasi lama. Karena itu basis hak amil dalam USDC dinyatakan belum dapat diperiksa, bukan dihitung. Memperbaikinya berarti mengubah kolom jumlah proposal dan menyentuh governance; itu tiket tersendiri.
- Migrasi produksi, backfill spekulatif, dan penggunaan data pribadi mitra.
- Perubahan pada jalur batch Merkle fiat. Deposit USDC tidak pernah masuk antrean settlement fiat, dan itu tidak berubah.
