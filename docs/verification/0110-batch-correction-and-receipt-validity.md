# Koreksi batch dan keberlakuan receipt — #110

Mengimplementasikan koreksi #110 terhadap spec #100 dan ADR-0034. Dokumen ini
mendefinisikan kebijakan transisi dan batas pemeriksaan mandiri, bukan bukti
bahwa deployment pilot sudah diperbarui.

## Kebijakan anggota dan versi

Koreksi nominal atau pembayaran refund mengubah versi kontribusi dari #106.
Keputusan refund saja tidak menyatakan dana sudah dikembalikan. Ketidakcocokan
versi/status sumber langsung membuat snapshot lama tidak berlaku pada API,
bahkan sebelum batch pengganti dibuat. Proof matematis lama tetap disimpan.

Batch pengganti memakai nomor batch yang sama dan versi resmi berikutnya.
Semua anggota yang masih ENDORSED mendapat commitment, salt, dan witness baru,
termasuk anggota yang nominalnya tidak berubah. Anggota REJECTED akibat pencatatan
ganda dikeluarkan dari populasi sebelum leaf dan path dibangun. Leaf dan witness
menggunakan urutan yang sama melalui satu pembangun snapshot.

Pembuatan penerus menandai pendahulu SUPERSEDED. Penerus masih DRAFT sampai root
hasil pengesahan dikonfirmasi final; status ENDORSED baru diberikan setelah itu.
Receipt anggota yang tidak berubah menjadi PENDING_REPROOF sampai proof penerus
terkonfirmasi. Receipt versi kontribusi yang telah berubah menjadi SUPERSEDED.
Publikasi gagal tidak mengembalikan status bisnis pendahulu menjadi CURRENT.

## Koreksi kedua ketika penerus masih draf

`POST /api/workspace/contribution-batches/:id/correct` juga menerima DRAFT.
Draf yang belum memiliki hash/transaksi bertanda tangan dapat digantikan oleh
snapshot baru pada versi resmi yang sama. Draf lama menjadi ABANDONED; row,
anggota, witness, alasan, pengesahan terdahulu dan attempt tetap tersimpan.
`replacesDraftId` menunjuk draf tersebut; `predecessorBatchId` tetap menunjuk
pendahulu resmi. Draf baru harus diperiksa dan disahkan ulang.

Lock lembaga/batch/operasi serta unique index parsial membatasi satu kandidat
aktif per nomor/versi dan satu penerus aktif per pendahulu. Worker tidak dapat
menyimpan transaksi bertanda tangan untuk draf yang sudah ABANDONED. Endpoint
pengesahan dan retry menolak draf tersebut. Bila transaksi sudah ditandatangani,
penggantian draf ditolak: rekonsiliasi hasil chain dahulu, jangan mengganti target
transaksi dengan hasil kirim yang belum diketahui. Nomor versi root tidak dilompati.

## Riwayat dan data sebelum perubahan

`ensureSchema()` melakukan backfill history dari receipt yang sudah ada dalam
transaksi SQL yang sama dengan perubahan skema. `saveReceiptProof` juga mengunci
kontribusi dan mengarsipkan row lama sebelum overwrite secara atomik. Backfill
idempoten; proof, public inputs, batch, hash dan hasil transaksi lama dipertahankan.

Endpoint privat `GET /contribution-batches/:batchId/proofs/:contributionId`
memilih proof berdasarkan batch, termasuk history setelah reproof anggota tak
berubah. Proyeksi publik memberi identitas batch dan versi pada riwayat, tanpa
witness, identitas donatur atau nominal.

## Pemeriksaan mandiri dan batas chain

Root terakhir tercatat di registry **bukan** bukti bahwa sumber offchain belum
dikoreksi. Ketika RPC/gas/publikasi gagal, tidak ada cara bagi kontrak untuk
mengetahui perubahan yang belum dikirim. Karena itu ABI membedakan:

- `isLatestRegisteredBatchRoot`: hanya membandingkan root yang terakhir tercatat.
- `getReceiptVerificationWithBatch`: hasil matematis, identitas batch, flag
  `isLatestRegisteredRoot`, dan `businessValidity` (`UNKNOWN = 0`, `SUPERSEDED = 1`).
  Tidak ada nilai CURRENT dari kontrak. Root historis yang telah diganti memberi
  SUPERSEDED; root terakhir memberi UNKNOWN, termasuk saat penerus gagal terbit.
- API publik menggabungkan finalitas EVM dengan versi/status sumber, status batch,
  dan keberadaan penerus untuk memberi CURRENT/PENDING_REPROOF/SUPERSEDED/PENDING.
  `chainBusinessValidity` tetap dipisahkan dari keputusan gabungan tersebut.

Pemeriksa independen dapat memverifikasi matematika dan transaksi melalui EVM,
tetapi perlu memeriksa sumber lembaga terkini untuk klaim bisnis CURRENT. Jangan
menampilkan badge current hanya karena flag root terakhir bernilai true. Tanpa
akses sumber, tampilkan UNKNOWN. Klaim validitas matematis juga tidak boleh
muncul pada receipt yang belum memiliki hasil verifikasi.

ABI `isBatchRootCurrent` yang ambigu pada draf awal #110 diganti, dan getter detail
bertambah satu output enum. Backend dan kontrak harus dirilis sebagai pasangan;
kontrak lama perlu deployment baru sesuai prosedur deployment proyek. Perubahan
ini tidak melakukan deployment jaringan atau transaksi pilot.

## Verifikasi dan rollout

Regresi HTTP/PGlite + Groth16 + Anvil mencakup koreksi nominal, penghapusan anggota
duplikat, koreksi kedua pada draf yang tertahan anggaran, penolakan penggantian
transaksi pending, backfill/reproof data lama, restart, dan publikasi penerus gagal.
Smoke browser memakai API/SQL/chain nyata pada lebar 1280 dan 390, membandingkan
receipt sebelum koreksi, pending reproof, dan setelah reproof; form koreksi serta
pengesahan dijalankan dari UI.

Jalankan dari backend (artefak Foundry harus dibangun terlebih dahulu):

```sh
bun test test/contribution_batch_correction.test.ts
REGISTRY_BROWSER_MODULE=/path/to/playwright/index.mjs REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium bun test test/contribution_batch_correction.test.ts
bun test test/contribution_zk_receipt.test.ts test/batch_queue.test.ts
bun run typecheck
```

Frontend: `bun run typecheck`. Dari `sc`:
`forge test --match-contract ContributionProofRegistryTest`.

Sebelum rollout, hentikan worker dan ambil backup database; bootstrap existing
memanggil `ensureSchema`, sehingga perubahan index/backfill harus ditinjau sebelum
menjalankan binary baru terhadap data pilot. Index aktif mengecualikan ABANDONED;
index lama yang melarang dua snapshot draf satu versi dilepas setelah penggantinya
ada. Rollback binary lama tidak aman setelah ada draf ABANDONED atau ABI baru.
Pulihkan backup hanya jika belum ada publikasi baru; jika sudah ada, pertahankan
riwayat chain dan lakukan perbaikan maju. Tidak ada backfill dari data rekaan atau
penghapusan history untuk memaksakan rollback.

Hasil sesi perbaikan 2026-09-20: suite #110 **10 pass** (termasuk smoke browser
1280/390); suite #108/#109 dan antrean fiat **15 pass** (dua smoke aktif);
suite koreksi/refund #106 **11 pass, 1 smoke browser tidak diaktifkan**;
Foundry registry **14 pass**. Typecheck backend/frontend dan `git diff --check`
lulus. Database uji terisolasi dan Anvil lokal; tidak memakai bank atau chain pilot.

## Pelengkapan bukti penutupan

Pengujian lanjutan 2026-09-20 menutup tiga celah bukti sebelumnya:

- Anggota yang nominalnya berubah dibuktikan pada batch penerus dengan Groth16
  nyata. Versi receipt, root dan hasil EVM cocok; proof lama masih dapat dibaca,
  sedangkan pengulangan proses mempertahankan hash tanpa transaksi baru.
- Receipt tetap CURRENT setelah keputusan refund, menjadi SUPERSEDED setelah
  pembayaran aktual, lalu mendapat proof versi baru yang terkonfirmasi. Retry
  pembayaran/proof tidak menaikkan versi atau menggandakan transaksi.
- Dua request koreksi HTTP berjalan bersamaan. Pada PostgreSQL terisolasi,
  transaksi ketiga menahan lock lembaga sampai `pg_stat_activity` memperlihatkan
  kedua request menunggu lock dari koneksi berbeda. Setelah dilepas, tepat satu
  respons 201 dan satu 409; hanya satu penerus tersimpan dan diterbitkan ke EVM.

Hasil terbaru suite #110: **11 pass, 0 fail, 0 skip, 610 assertions**, termasuk
smoke desktop/ponsel, memakai PostgreSQL 18.6 lokal dan Anvil. Parameter
`DONOR_ACCESS_TEST_DATABASE_URL` menunjuk database lokal khusus pengujian;
harness membuat/menghapus schema unik. Tanpa parameter ini, PGlite tetap dapat
menjalankan request bersamaan tetapi tidak membuktikan kompetisi lock lintas
koneksi. Uji reopen pada PostgreSQL berarti reconnect; hasil reopen filesystem
PGlite dari sesi sebelumnya tetap menjadi bukti persistensi terpisah.

`UNKNOWN` adalah batas pengetahuan kontrak, bukan kegagalan verifikasi matematis:
meskipun transaksi berhasil, kontrak tidak dapat memastikan sumber offchain belum
berubah lagi. API menggabungkan kedua sumber untuk menyatakan CURRENT. Tidak ada
perubahan menjadi klaim CURRENT mandiri dari chain dalam pelengkapan tes ini.
