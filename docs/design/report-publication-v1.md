# Penerbitan laporan — ticket #73

Irisan ini menambahkan penerbitan pertama dari paket beku dengan pengesahan lembaga dan layanan validator. Dasarnya ADR-0020–0022 dan spec #68. Pencatatan bukti tetap tindakan terpisah; atestasi auditor selalu `NOT_EXAMINED` dalam irisan ini.

## Protokol dan batas kepercayaan

`publishReport` menerima dua `Authorization` EIP-712 pada domain registry yang sama. Lembaga menandatangani `PUBLISH_REPORT`, validator menandatangani `VALIDATE_REPORT`. Identitas lembaga, laporan, versi, paket, predecessor, digest, kebijakan, outcome LOLOS, dan deadline harus cocok. Masing-masing mempunyai signer, epoch mandat, dan nonce sekali pakai. Role lembaga berasal dari administrator lembaga; admission authority registry mengelola validator lewat `setValidator`. Perubahan mandat validator menaikkan epoch termasuk ketika diaktifkan kembali. Satu alamat tidak dapat mengisi kedua peran.

Signature EOA dan ERC-1271 diperiksa saat eksekusi. Domain mengikuti [EIP-712](https://eips.ethereum.org/EIPS/eip-712); validitas akun kontrak mengikuti [ERC-1271](https://eips.ethereum.org/EIPS/eip-1271). Nonce aplikasi, tujuan tindakan, epoch, dan deadline melengkapi perlindungan replay. Validasi ERC-1271 melalui OpenZeppelin menggunakan panggilan baca sehingga tidak dapat mengubah state saat pemeriksaan.

Kontrak memverifikasi pernyataan layanan, bukan menjalankan ulang perhitungan atau membuktikan kebenaran pembayaran bank. Layanan validator dan sumber bank tetap batas kepercayaan. UI dan pembacaan versi menyatakan batas ini, tanpa label komputasi trustless atau opini audit otomatis.

Penerbitan pertama mensyaratkan predecessor kosong dan tidak adanya root laporan sebelumnya. `publishedVersion(institution, report, version)` mempertahankan dua otorisasi dan signature yang diterima. `latestPublishedPackage` menyediakan identitas pendahulu bagi irisan koreksi #75. Saat ini tidak ada metode koreksi, overwrite, atau root kedua. Digest bukti yang sudah ada harus cocok. Rotasi role kemudian tidak menghapus penerbitan lama.

## Layanan validator dan HTTP

Semua rute di bawah berada pada `/api/evidence/:preparation/reports/:package/publication`, membutuhkan sesi ruang kerja dan akses paket lembaga yang sesuai:

- `POST /` menerima hanya `{retryId,digest}`. Server membaca ulang commitment paket dan snapshot, membaca serta memverifikasi berkas wajib, menghitung ulang rekonsiliasi, angka, kebijakan hak amil terkonfigurasi, claims wajib, dan narasi. Ia memeriksa kecocokan snapshot, angka, rekonsiliasi, kebijakan dan disclosure tersimpan. Tidak menerima outcome atau withinCeiling dari pemanggil. Hanya hasil LOLOS mendapatkan signature validator.
- `GET /` membaca seluruh percobaan penerbitan paket; `GET /:id` memeriksa receipt/event dan canonical block kembali.
- `POST /:id/submit` menerima hanya signature lembaga atas payload yang telah disiapkan. Sumber dan kebijakan diperiksa ulang sebelum pengiriman pertama maupun rebroadcast yang masih pending, tanpa membuat signature baru. Kedua otorisasi divalidasi kontrak sebelum relayer membangun transaksi. Pemulihan receipt yang sudah included/confirmed tetap tersedia saat sumber kemudian hilang.
- `POST /:id/retry` menerima objek kosong dan memakai byte transaksi tersimpan. Retry yang sama mempertahankan identitas dan signature; pergantian mandat atau expiry memerlukan tinjauan baru secara eksplisit.
- `GET /version` mengembalikan identitas versi, `PUBLISHED` hanya jika receipt/event terkonfirmasi cocok serta versi registry mengikat paket dan digest yang sama, anchor, batas kepercayaan, dan status auditor. Kegagalan RPC menghasilkan 503; revert, event salah, atau reorg menghilangkan klaim status terbit. Pembacaan ini mencakup transaksi aplikasi yang tersimpan; discovery transaksi eksternal dan ringkasan publik merupakan irisan berikutnya.

Outage validator menghasilkan 503; penolakan kebijakan atau sumber hilang memberi 409 dengan alasan perbaikan. Paket dan temuan tetap dapat dibaca. Signature validator disimpan bersama intent sebelum meminta signature lembaga. Penerbitan memakai tabel intent/attempt dan allocator nonce durable #72 yang sama; filter tujuan memisahkan kedua riwayat. Tidak ada migrasi destruktif atau backfill status.

## Konfigurasi dan pemulihan

Tambahkan `REPORT_REGISTRY_VALIDATOR_KEY` pada lima konfigurasi registry #72; kunci hanya dibaca backend. Akunnya harus didaftarkan lewat `setValidator` oleh admission authority dan berbeda dari pengesah lembaga. Tanpa kunci, pencatatan tetap tersedia dan penerbitan menampilkan layanan belum tersedia. Kunci validator merupakan kewenangan pengesahan, bukan kunci relayer; gunakan akun terpisah dalam onboarding. Fixture memakai kunci sintetis, database PGlite di direktori sementara, berkas terenkripsi lokal, dan Anvil loopback.

Kontrak nonproxy #72 yang sudah dideploy tidak berubah ketika kode ini berubah. Deployment baru dengan bytecode ini dan konfigurasi eksplisit diperlukan untuk memakai penerbitan; tidak dilakukan oleh tiket ini. Backup database intent/attempt, direktori ciphertext dan kunci berkas bersama-sama sesuai panduan [operasi pencatatan](evidence-recording-operations.md). Recovery tidak menandatangani ulang otomatis atau mengubah nonce; transaksi dropped yang perlu fee bump/cancel masih pekerjaan operator. Konfirmasi lokal bukan finalitas settlement L1.

## Validasi

Seams disepakati spec: HTTP `app.fetch`, ABI publik Foundry, dan smoke browser menggunakan adapter lokal yang sama. Tes meliputi signature hilang, role salah, alamat ganda, domain/aksi/paket salah, replay, expiry, pencabutan dan reaktivasi validator, ERC-1271, immutable versi, serta invariant satu root dan dua nonce terpakai. API menjalankan validator asli untuk draf salah, klaim wajib hilang, sumber wajib hilang, berkas hilang, dan outage; tracer melewati database/berkas nyata, signature, EVM, receipt/event, restart, versi terbit, dan reorg/retry.

Jalankan `forge build --root sc`, `python3 scripts/export-registry-abi.py`, lalu dari `backend`: `bun test test/registry_api.test.ts`. Smoke opsional menggunakan `REGISTRY_BROWSER_MODULE` (path absolut Playwright) dan `REGISTRY_BROWSER_EXECUTABLE` (Chrome lokal). Seluruhnya tanpa AI live atau transaksi jaringan publik.

Hasil akhir pada perubahan #73:

- Foundry lokal: **88 lulus**, termasuk fuzz 1.000 kasus dan invariant publikasi 128 run × 32 panggilan; dua kontrak tes fork Sepolia live dikecualikan.
- Suite backend penuh dari direktori `backend` dengan smoke browser aktif: **474 lulus, 20 gagal**. Seluruh 20 nama kegagalan sama dengan log baseline #72; tidak ada kegagalan baru. Berkas registry sendiri **16 lulus**, termasuk dua browser smoke.
- Frontend: **133 lulus**, production build berhasil. Typecheck backend/frontend mempunyai diagnostik lama yang sama dengan checkout terisolasi commit `e715175`; tidak ada diagnostik baru setelah normalisasi nomor baris.
- Review Standards dan Spec sesudah perbaikan: **0 temuan tersisa**. Perbaikan review menyatukan aturan penilaian draf dan menutup celah sumber hilang antara endorsement dan broadcast/rebroadcast. Tes regresi membuktikan kedua celah gagal sebelum perbaikan dan lulus sesudahnya.

Log lokal: `/tmp/ticket73-backend-final-tests.log`, `/tmp/ticket73-foundry-final-tests.log`, `/tmp/ticket73-frontend-final-tests.log`, `/tmp/ticket73-frontend-build.log`. Screenshot smoke perilaku (harness tanpa stylesheet produksi): `/tmp/ticket73-browser-publication.png`. Hasil ini merupakan validasi fixture lokal, bukan audit keamanan independen atau bukti deployment publik.
