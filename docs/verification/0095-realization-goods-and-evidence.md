# Issue #95 — Realisasi barang dan perbaikan hasil review

Verifikasi lokal 2026-09-18. Acuan: [#95](https://github.com/tawf-labs/zkt-hackathon/issues/95), [#86](https://github.com/tawf-labs/zkt-hackathon/issues/86), dan amandemen [#100](https://github.com/tawf-labs/zkt-hackathon/issues/100).

## Perbaikan yang diverifikasi

- Alokasi BAST harus menyatakan satu dimensi: nominal IDR positif atau kuantitas desimal positif beserta satuan. Payload campuran, negatif, nol, dan format rusak ditolak sebelum penyimpanan. Upaya alokasi −1 kg lalu 11 kg untuk realisasi 10 kg tidak dapat membuat bukti lengkap.
- Frontend dan backend memakai aritmetika desimal eksak bersama (`shared/exact-decimal.ts`). Sisa realisasi 0.3 kg setelah bukti 0.1 kg tepat 0.2 kg; validasi dan unggahan berikutnya mempertahankan presisi tersebut.
- Ringkasan barang dikelompokkan berdasarkan pasangan jenis barang dan satuan. `unitSummaries` membawa `aidType` dan `unit`; kunci `totalsByUnit` adalah JSON pasangan tersebut. Beras dan gula yang sama-sama memakai kg tidak digabungkan.
- `valuationBasis` mencatat sumber/rujukan dan perhitungan estimasi nilai pengajuan. Form, pemeriksaan, pengesahan, dan ringkasan memperlihatkan dasar tersebut. Kolom impor/ekspor `dasar_valuasi_barang` membawa data yang sama.
- Draf bernominal barang tanpa dasar penilaian boleh disimpan sebagai belum lengkap, tetapi tidak dapat diajukan. Proyeksi data historis tanpa dasar mengembalikan valuasi tidak tersedia tanpa menimpa nominal aslinya. Dasar penilaian yang tersedia ikut terikat digest hak yang disahkan; format digest data lama tanpa dasar dipertahankan.
- Estimasi pengajuan dipisahkan dari biaya aktual dan uang muka. Perubahan ini tidak menentukan kebijakan valuasi universal, menilai dokumen secara otomatis, atau membuat inventori/pengadaan penuh.
- Validasi uang/barang tetap terpisah, tetapi penyimpanan kejadian memakai satu blok INSERT. Ringkasan tampilan dan validasi baris dipisahkan dari komponen banner/modal agar masing-masing komponen kembali di bawah 150 baris.

- Antrean bukti menyajikan nominal uang hanya untuk kejadian uang; barang membawa jenis/kuantitas/satuan dari versi pengajuan yang terikat realisasi. Penjumlahan tetap eksak dan antarjenis tidak dicampur. Melengkapi semua BAST menghapus pengajuan dari antrean.
- Pengujian perubahan harga membedakan estimasi Rp100.000 dari biaya aktual Rp120.000, sementara realisasi tetap 10 kg dan sisa pertanggungjawaban Rp80.000 tetap terbuka setelah barang seluruhnya diserahkan dan BAST dilengkapi.
- Migrasi aditif diuji pada empat tabel dengan bentuk schema sebelum barang dan baris IDR yang sudah terisi (realisasi, alokasi BAST, OTP, sengketa). Dua kali migrasi mempertahankan isi lama, dokumen, dan data donasi legacy; jalur IDR masih dapat mencatat realisasi berikutnya.

## Pemetaan kriteria tiket #95

| Kriteria | Bukti implementasi/verifikasi |
| --- | --- |
| Pemeriksaan/pengesahan dan angka eksak | Fixture pengajuan melalui HTTP, signature pengesahan asli, penyerahan pecahan eksak, satuan salah ditolak. |
| Bertahap/kelompok, concurrency, retry | Tes batas hak serentak, operasi idempoten, BAST kelompok, restart SQL. Bukti tertunda tetap memotong hak. |
| Jenis/satuan terpisah, valuasi berdasar | Beras/gula dipisahkan meski sama-sama kg; basis valuasi terikat versi dan digest; nilai tanpa dasar tidak dianggap tersedia. |
| BAST privat dan integritas | Alokasi barang wajib positif dan sesatuan; foto tidak melengkapi bukti; memakai jalur penyimpanan/unduhan privat terverifikasi yang sama dengan regresi IDR. |
| Hak tetap dan kompatibilitas | Realisasi mengacu hak versi disetujui; perubahan satuan ditolak; migrasi data IDR terisi lulus. Jalur vault/USDC tidak diubah. |
| Form, antrean, ponsel, status | Smoke laptop/ponsel mencatat beras/gula, membaca antrean, melengkapi BAST pecahan, lalu mencapai penyerahan penuh tanpa konfirmasi palsu. |
| Konfirmasi dan sengketa bersama | OTP barang menyatakan jenis/kuantitas/satuan; BAST diperiksa petugas lain; sengketa menahan konfirmasi dan mempertahankan riwayat. |
| Biaya, estimasi, pertanggungjawaban | Harga aktual berbeda dari estimasi, tanpa hitung ganda; sisa uang muka tetap terbuka setelah penyerahan penuh. |
| Sumber untuk sertifikat/donatur | ID realisasi tetap, versi bertambah pada bukti/status, proposalVersion tetap terikat, biaya/konfirmasi terbaca dari sumber yang sama. Penerbitan token mengikuti batas integrasi tiket dan tetap milik spec pilot. |

## Hasil pengujian perubahan ini

- Regresi backend enam suite: **102 lulus, 0 gagal**, 1.827 assertion. Suite: `disbursement_realization_goods_api`, `disbursement_realization_api`, `disbursement_api`, `disbursement_decision_api`, `beneficiary_import_api`, dan `activity_allocation_api`.
- Enam smoke browser opt-in dilewati pada perintah regresi tersebut. Dua smoke realisasi kemudian dijalankan secara eksplisit dengan Chromium lokal: **2 lulus, 0 gagal**. Smoke barang menguji form realisasi, pemisahan beras/gula, BAST bertahap 0.1 + 0.2, antrean barang tanpa Rp0, penyerahan sebagian hingga seluruh pengajuan, status konfirmasi tetap belum dikonfirmasi, keyboard, dan batas layout pada laptop 1280×900 serta ponsel 390×844. Smoke IDR menguji retry setelah respons hilang, bukti, dan pembacaan ulang pada kedua ukuran layar.
- Tes frontend: **198 lulus, 0 gagal**, 558 assertion.
- Build produksi frontend: **berhasil**.
- Typecheck frontend dan backend belum bersih. Diagnostik dibandingkan dengan checkout sementara `HEAD d209dcc`: **identik setelah normalisasi path**, tanpa galat baru. Baseline masih memuat antara lain impor tidak terpakai di frontend dan masalah tipe `ProposalRecord`/IPFS di backend.
- `git diff --check`: lulus.

Tes HTTP menggunakan autentikasi aplikasi, SQL PGlite, dan penyimpanan berkas privat nyata. Fixture pesan OTP menggantikan layanan pengiriman eksternal. Smoke menghubungkan UI ke HTTP/SQL yang sama dengan wallet sintetis lokal. Tidak ada deployment, transaksi publik, atau perubahan kontrak pada perbaikan ini.

## Menjalankan ulang

Dari root repositori:

```bash
bun test backend/test/disbursement_realization_goods_api.test.ts backend/test/disbursement_realization_api.test.ts backend/test/disbursement_api.test.ts backend/test/disbursement_decision_api.test.ts backend/test/beneficiary_import_api.test.ts backend/test/activity_allocation_api.test.ts
```

Dari `frontend/`, jalankan `bun test` dan `bun run build`. Setelah build, dari `backend/` jalankan smoke dengan path Playwright dan Chromium lokal:

```bash
REGISTRY_BROWSER_MODULE=/path/to/playwright/index.mjs REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium bun test test/disbursement_realization_goods_api.test.ts test/disbursement_realization_api.test.ts --test-name-pattern 'browser:'
```

Smoke perlu izin membuka server localhost dan meluncurkan Chromium. Screenshot verifikasi lokal: `/tmp/issue95-fixed-1280.png` dan `/tmp/issue95-fixed-390.png`.

## Batas verifikasi

Smoke baru memakai pengajuan barang yang telah disetujui melalui HTTP nyata; pengisian seluruh pengajuan dan proses tanda tangan pengesahan barang belum dijalankan melalui browser pada verifikasi ini. Empat smoke lain tidak dijalankan ulang. Tidak ada klaim siap produksi atau konfigurasi SOP mitra; gateway OTP nyata tetap memerlukan konfigurasi. Kuantitas tetap menjadi actuals utama; angka estimasi tidak membuktikan biaya aktual atau penerimaan bantuan.
