# #109 — batch dan publikasi receipt yang dapat dipulihkan

Alur memakai circuit, statement, dan pasangan artefak #108 tanpa perubahan:
Circom 2.2.3, Groth16 BN254, Poseidon, tree depth 4 / maksimal 16 receipt per
batch. Banyak batch diproses oleh satu relay khusus. Batas setup lokal dan
kepercayaan operator pada [catatan #108](0108-real-zk-receipt.md) tetap
berlaku. RPC produksi belum diaktifkan; target pengujian adalah Anvil chain 31337.
Checksum ada di `sc/circuits/artifacts.sha256`. Generated verifier tetap 1.752
byte, registry 3.541 byte; deployment lokal 432.065 dan 823.507 gas. Verifikasi
receipt sekitar 438.600 gas (berubah sedikit karena encoding proof).

## Persetujuan dan pemrosesan

Tab **Batch bukti ZK** pada penerimaan kontribusi menampilkan populasi, cutoff,
catatan tidak layak, daftar terpilih dan total per mata uang. Snapshot hanya
memuat sumber ENDORSED yang diterima sebelum cutoff. POST endorse harus menyebut
`snapshotRoot` persis. Akun petugas, mandat dan versinya dicatat. Root dan seluruh
receipt masuk SQL secara atomik; pengesahan root juga memakai antrean dan anggaran.
Worker memeriksa snapshot, keanggotaan aktif, mandat, kewenangan signer pada
registry, artefak, dan tujuan chain sebelum pengiriman.

`zk_publications` menyimpan operasi root atau satu versi receipt, proof privat,
identitas artefak/deployment, transaksi bertanda tangan, hash, status, dan hasil
blok. `zk_publication_attempts` mempertahankan percobaan termasuk transaksi revert.
`zk_publication_budgets` menyimpan lease dengan token dan reservasi biaya kumulatif.
Lease 300 detik membatasi worker; prover dibatasi 120 detik. SQL menolak penulisan
worker yang kehilangan lease. Pengesahan ulang snapshot yang sama mencatat akun
dan versi mandat baru dalam `zk_publication_approvals`; transaksi yang sudah
ditandatangani tetap memakai bytes yang sama. Hasil transaksi yang sudah mined
direkonsiliasi meski mandat pengirim kemudian dicabut. Restart mengambil transaksi tersimpan sebelum
membuat transaksi berikutnya. Broadcast ambigu mengirim ulang byte yang sama;
reorg memulihkan urutan nonce yang sama. Nonce signer tidak boleh digunakan oleh
aplikasi lain. Konfirmasi selalu diperiksa melalui RPC; proyeksi HTTP menggunakan
`Cache-Control: no-store`, dan status gagal/RPC tidak tersedia tidak hijau dari cache.

Perbaikan review #109: recovery juga membaca transaksi bertanda tangan dalam
riwayat attempt, termasuk transaksi revert sebelum retry. Bila reorg menghapus
nonce pendahulu, worker mengirim ulang bytes lama lebih dulu tanpa mengganti
operasi terbaru atau menambah reservasi anggaran. Replay tetap memeriksa mandat,
snapshot, artefak dan lease. Retry yang tertahan anggaran tidak menghapus bytes
attempt lama. Worker dan pemeriksaan publik memakai pemeriksaan finalitas yang sama.

Penerimaan dana tidak diubah oleh antrean. Donatur tidak perlu wallet atau gas.
Notifikasi memakai adapter `zkNotifications.send({ operationId, status })` tanpa
kontak/witness/nominal. Pengiriman minimal ini bersifat at-least-once; transport
harus deduplikasi berdasarkan operationId/status bila perlu. Kegagalan notifikasi
tidak membatalkan receipt confirmed. Adapter belum mengirim email/SMS otomatis.

## Konfigurasi dan recovery

Gunakan konfigurasi lokal #108 serta:

- `ZK_MAX_ATTEMPTS` dan `ZK_MAX_WEI`: batas kumulatif **anggaran layanan/pilot**,
  default nol. Tentukan penyedia dan nilai anggaran sebelum mengaktifkan worker.
- `ZK_GAS_LIMIT=700000`, `ZK_MAX_FEE_PER_GAS=2000000000`: cap tiap transaksi.
- `ZK_CONFIRMATIONS=1`: jumlah blok minimum; naikkan sesuai kebijakan jaringan.

Reservasi sebelum proving adalah gasLimit × maxFeePerGas dan satu attempt,
termasuk pengesahan root. Tidak ada refund reservasi otomatis, bahkan jika proof
atau proses mati sebelum broadcast. Kebijakan konservatif ini menjaga batas biaya
saat hasil belum pasti; tidak mengurangi nominal kontribusi. Batas lifetime dapat
dinaikkan operator. Jangan menghapus tabel anggaran untuk mereset counter.

Worker berjalan setiap 3 detik setelah schema siap. Retry lewat UI menjadwalkan
ulang pekerjaan tertahan. Transaksi revert tetap ada di attempt lama dan retry
menggunakan anggaran baru. Transaksi pending mempertahankan bytes/nonce/fee;
jika fee cap terlalu rendah, operator perlu menunggu fee jaringan turun. Tidak ada
replacement transaksi otomatis. Antrean berhenti di transaksi pending/ambigu
paling awal untuk mencegah pemakaian nonce yang tidak aman.

Migrasi bersifat additive/idempotent: empat tabel publikasi serta kolom cutoff dan
versi mandat pada batch. Backup SQL privat dan artefak pinned bersama; transaksi
bertanda tangan dan witness tidak boleh masuk log atau backup publik. Hentikan
worker sebelum restore. Sesudah restore, periksa RPC/chain/registry/signer yang
sama, pertahankan counter anggaran dan transaksi tersimpan, lalu nyalakan worker.
Batch lama #108 perlu ditinjau saat mengadopsi otomasi. Rollback aplikasi: hentikan
worker, pertahankan tabel dan kolom baru; jangan menyalakan jalur publisher lama
pada signer yang mempunyai transaksi pending. Tidak ada rollback chain atau
penghapusan penerimaan dana.

## Pemeriksaan

Regresi perbaikan review: snapshot EVM diambil sebelum transaksi out-of-gas,
kemudian retry, restart SQL dan reorg menguji pemulihan nonce pendahulu.
Skenario mencakup budget habis setelah retry, worker ganda, mandat dicabut saat
replay, pemulihan tanpa reservasi tambahan, serta ambang konfirmasi yang sama
pada HTTP internal dan publik. Verifikasi akhir perbaikan: **8 tes lulus,
0 gagal, 0 skip, 166 assertion**, termasuk smoke batch dan donor pada desktop
1280 px dan ponsel 390 px. Chromium tidak melaporkan page error maupun overflow
horizontal. Screenshot batch diperiksa pada `/tmp/issue109-batch-390.png`.
Typecheck masih memiliki 22 error baseline; output sebelum dan sesudah perbaikan
identik. Pengujian memakai SQL PGlite terisolasi dan Anvil, bukan database
kerja Docker atau deployment pilot.

Perintah verifikasi akhir:

```bash
REGISTRY_BROWSER_MODULE=/home/harkon666/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.mjs \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/contribution_zk_receipt.test.ts
```

`bun test test/contribution_zk_receipt.test.ts` menjalankan HTTP, SQL PGlite,
prover sungguhan dan EVM lokal: banyak receipt, budget gate, lease ganda, transaksi
revert dan retry, broadcast ambigu, pencabutan/pembaruan mandat, pengesahan ulang, restart
SQL dengan transaksi pending, replay, reorg, isolasi witness, artefak/proving gagal,
dan pemeriksaan publik tanpa transaksi tambahan. Set `REGISTRY_BROWSER_MODULE`
ke instalasi Playwright serta `REGISTRY_BROWSER_EXECUTABLE` ke Chromium untuk
smoke review–pengesahan–budget/retry–pending–confirmed pada 1280 dan 390 pixel.

Hasil run implementasi awal (sebelum perbaikan review): 8 tes lulus, 156 assertion, termasuk smoke batch dan donor pada
laptop/ponsel. Frontend: 216 tes lulus; typecheck lulus. Typecheck backend masih
memiliki 22 error baseline; hasilnya dibandingkan dengan worktree commit
`f94ef2a` dan identik, tanpa tambahan error dari #109.

Suite backend lengkap dengan seluruh smoke browser diaktifkan: 1.044 lulus,
12 gagal, 7 error lanjutan (1.056 tes / 80 file). Semua tes #109 lulus. Kegagalan
bermula dari timeout default 5 detik pada pergantian administrator di
`registry_api.test.ts`; Anvil fixture kemudian dihentikan dan tes registry berikutnya
kehilangan RPC. Rerun file registry dengan timeout 30 detik melewati bagian itu,
tetapi smoke pemulihan sesi menemukan error PGlite `Bad file descriptor`, diikuti
kegagalan sesi/cleanup. Rerun registry tanpa browser: 47 lulus, 7 skip, 0 gagal.
Suite lengkap tidak dilaporkan hijau; kegagalan harness registry ini masih perlu
investigasi terpisah. Source dan tes registry tersebut tidak diubah oleh #109.

Review Standards dan Spec terpisah menemukan risiko pemulihan transaksi yang
sudah mined sesudah mandat dicabut, serta pengesahan ulang setelah perubahan
mandat. Keduanya diperbaiki dan direview ulang tanpa blocker tersisa; regresi EVM
nyata mencakup kedua kasus.
