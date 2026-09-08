# Atestasi auditor — ticket #76

Irisan ini menambahkan catatan pemeriksaan auditor atas satu versi laporan yang sudah terbit. Atestasi adalah pendapat yang dicatat di samping versi, bukan perubahan terhadapnya: angka paket, pengesahan lembaga dan vonis validator tidak tersentuh. Dasarnya ADR-0020–0022 dan spec #68.

## Kewenangan dan batas klaim

`setAuditor(institutionId, auditor, active, mandate)` dipanggil administrator lembaga, mencatat dasar mandat, dan menaikkan epoch pada setiap perubahan termasuk pengaktifan kembali. Aktivasi tanpa dasar mandat ditolak. Catatan atestasi menyimpan salinan mandat saat diterima; pencabutan atau mandat baru tidak mengubah dasar mandat pada riwayat lama. Keanggotaan pembaca pada ruang kerja tidak memberi hak atestasi sama sekali; kewenangan hanya berasal dari mandat pada registry, dan diperiksa saat eksekusi.

Kewenangan ini dicatat oleh lembaga yang diperiksa. Registry karena itu membuktikan bahwa sebuah akun bermandat menandatangani kesimpulan tertentu atas versi tertentu — bukan bahwa auditor tersebut independen, bukan bahwa pemeriksaannya lengkap, dan bukan sertifikasi kepatuhan menyeluruh. API dan UI menyatakan batas ini di samping setiap kesimpulan.

## Protokol

`attestReport` menerima satu struct `Attestation` EIP-712 pada domain registry yang sama. Ia mengikat auditor, lembaga, laporan, versi, paket dan digest paket, lingkup, kesimpulan, commitment bukti pemeriksaan, dan — bila tindak lanjut — identitas atestasi sebelumnya. Aksi `ATTEST_REPORT` terpisah dari `RECORD_EVIDENCE`, `PUBLISH_REPORT` dan `VALIDATE_REPORT`, sehingga pengesahan untuk tindakan lain tidak dapat dipakai di sini.

Registry menolak atestasi atas versi yang tidak ada, atau yang paket/digest-nya tidak sama dengan versi yang diterima pada `publishReport`. Relayer hanya mengirim transaksi: ia tidak dapat mengarang kesimpulan maupun mengganti versi, karena keduanya berada dalam payload bertanda tangan. Signature EOA dan ERC-1271 diperiksa saat eksekusi, bersama epoch mandat, deadline dan nonce sekali pakai. Registry juga membatasi lingkup dan kesimpulan pada kosakata yang sama dengan API, termasuk pada panggilan kontrak langsung.

Tindak lanjut menyusul catatan auditor yang sama pada versi yang sama; rujukan ke catatan auditor lain, ke paket lain, ke versi lain, atau ke catatan yang tidak ada ditolak. Catatan lama tidak pernah diubah atau dihapus — daftar per versi hanya bertambah.

Atestasi disimpan per identitas versi (`institution`, `report`, `version`) dan dibaca lewat `attestationCount`/`attestationIdAt`/`attestationById`. Tidak ada pembacaan yang memakai `reportId` saja, sehingga opini tidak menempel pada versi lain. Pembacaan backend menjatuhkan catatan yang paket atau digest-nya tidak cocok dengan versi yang sedang dibaca.

## Backend dan HTTP

Rute berada pada `/api/evidence/:preparation/reports/:package/attestation`, memerlukan sesi ruang kerja untuk membuka halaman dan mandat registry untuk menandatangani:

- `POST /` menerima `{retryId, packageDigest, scope, conclusion, predecessor, evidence[]}`. Lingkup dan kesimpulan berasal dari kosakata tetap yang memuat kesimpulan tidak positif, sehingga pemanggil tidak dapat mengarang label yang menenangkan. Paket harus sudah menjadi versi terbit dan digest-nya harus sama dengan yang ditinjau. Bukti pemeriksaan disimpan terenkripsi lebih dulu, lalu di-commit; kegagalan penyimpanan menghasilkan 409 dan tidak ada apa pun yang ditandatangani.
- `GET /` dan `GET /:id` membaca ulang receipt, event dan canonical block. `POST /:id/submit` menerima hanya signature auditor; `POST /:id/retry` memakai byte transaksi tersimpan.
- `GET /:id/files/:fileId` mengunduh kertas kerja hanya bagi auditor pemilik intent dengan sesi aktif. Unduhan memeriksa ukuran dan SHA-256, dikirim sebagai attachment tanpa cache; locator penyimpanan tidak keluar lewat JSON API.
- Identitas retry yang sama mengembalikan pernyataan yang sama, bukan kesimpulan kedua. Identitas yang sudah dipakai tindakan registry lain ditolak.

UI memulihkan intent milik akun dari riwayat server sesudah reload dan menyimpan identitas retry pada session storage. Kegagalan upload tetap mengizinkan perbaikan dan retry; pergantian akun/paket membatalkan konteks signing yang lama. Setelah satu catatan selesai, auditor dapat memulai tindak lanjut baru.

Pencatatan, penerbitan dan atestasi kini berbagi satu jalur relay durable ([`registry-relay.ts`](../../backend/src/registry-relay.ts)): tanda tangan sekali, byte transaksi disimpan sebelum broadcast, alokasi nonce relayer terkunci, lalu observasi receipt. Perbedaan ketiganya ada pada apa yang diotorisasi dan apa yang diperiksa registry, bukan pada bagaimana transaksi bertahan terhadap acknowledgement yang hilang, restart, atau reorg. Intent atestasi memakai tabel yang sama dengan kolom `kind`; migrasi bersifat aditif dan baris lama tetap terbaca sebagai pencatatan.

Pembacaan versi, riwayat koreksi dan ringkasan publik menampilkan `NOT_EXAMINED` atau kesimpulan aktual per versi, termasuk yang tidak positif. Kesimpulan dan lingkup adalah kosakata tetap yang sudah tercatat on-chain, jadi pembaca publik menerimanya apa adanya; kertas kerja tetap terbatas dan hanya commitment-nya publik.

## Yang tidak diubah

Atestasi penyaluran pada vault `ZakatProtocolL1` tidak disentuh dan tidak dianggap setara dengan atestasi registry ini. Tidak ada penghapusan kontrak, perpindahan dana, atau deployment yang dilakukan oleh irisan ini; deployment baru diperlukan untuk memakai `attestReport`.

## Validasi

Seams yang sama seperti #73–#75: HTTP `app.fetch`, ABI publik Foundry, dan smoke browser dengan adapter lokal. Foundry menguji auditor sah, akun tanpa mandat, pengesah lembaga yang bukan auditor, mandat dicabut dan diaktifkan kembali, expiry, domain/chain salah, signature rusak, replay, versi belum terbit, paket/digest ditukar, tindak lanjut sah, dan perebutan catatan auditor lain. API menguji kewenangan nyata pada EVM lokal, kosakata kesimpulan, pemisahan atestasi antar dua identitas versi, kegagalan penyimpanan bukti, event salah, retry, reload database, dan ringkasan publik.

Jalankan `forge build --root sc`, `python3 scripts/export-registry-abi.py`, lalu dari `backend`: `bun test test/registry_api.test.ts`. Smoke opsional memakai `REGISTRY_BROWSER_MODULE` dan `REGISTRY_BROWSER_EXECUTABLE`. Seluruhnya tanpa AI live atau transaksi jaringan publik.


## Review implementasi

Baseline review: `a590dfad6a74db00ce4362eb56f5b16a4614d129` (HEAD sebelum implementasi #76), termasuk berkas baru. Dua reviewer memeriksa standar dan spec secara terpisah.

### Standards

Dua konflik dokumentasi diperbaiki: mandat historis kini disimpan pada catatan yang diterima, dan kosakata lingkup/kesimpulan diperiksa oleh registry. Satu temuan duplikasi diperbaiki dengan menurunkan pilihan UI dari enum bersama, dengan label tampilan lokal.

### Spec

Penyimpanan mandat historis dan pembatasan kosakata telah diperbaiki. Kertas kerja kini dapat diunduh kembali dengan pemeriksaan pemilik dan integritas. Form tidak lagi terkunci setelah kegagalan upload. Smoke browser mencakup berkas lebih besar daripada batas aman satu argumen spread, retry setelah upload gagal, reload sebelum signing, serta kesimpulan tidak positif pada pembaca privat dan publik.

Temuan yang diselesaikan: Standards 3; Spec 4. Tidak ada temuan tersisa dari review tersebut.


## Hasil validasi lanjutan

- HTTP registry + lima smoke Chromium: **37 lulus, 0 gagal** (`REGISTRY_BROWSER_MODULE=/tmp/zkt-browser/node_modules/playwright/index.mjs REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium bun test test/registry_api.test.ts`).
- Seluruh tes backend: **490 lulus, 5 smoke browser dilewati pada run tanpa adapter, 20 gagal**. Dua puluh kegagalan sama persis dengan baseline HEAD pada 44 berkas non-registry; tidak ada regresi kegagalan baru. Smoke kemudian dijalankan secara eksplisit melalui perintah di atas.
- Seluruh tes frontend: **133 lulus, 0 gagal**.
- Build backend dan frontend berhasil.
- Typecheck backend dan frontend masih gagal pada modul legacy; hasil lengkap identik dengan baseline HEAD, tanpa diagnostik baru dari perubahan ini.
- Review spec akhir memeriksa perbaikan form setelah upload gagal dan menyatakan tidak ada temuan tersisa.
- Seluruh suite Foundry (`forge test --root sc`): **133 lulus, 0 gagal, 0 dilewati**, termasuk fuzz, tiga suite invariant, dan tes fork yang sudah ada; selesai dalam 539,86 detik.
