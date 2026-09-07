# Validasi ticket #70

Baseline sebelum melanjutkan implementasi: `930c2127f09f1fb5f384d77347b808a8be26502f`, branch `feat/69-institution-workspace`. Perubahan Claude yang belum di-commit dilanjutkan pada branch yang sama.

## Hasil pemeriksaan

| Pemeriksaan | Hasil |
| --- | --- |
| Backend: evidence API/files/snapshot/source, source-read, workspace API, internal reconciliation, period report verify/draft (9 file) | 175 lulus, 0 gagal |
| Frontend: `bun test` (10 file) | 132 lulus, 0 gagal |
| Backend: `bun test` (44 file) | 440 lulus, 22 gagal |
| Backend baseline terisolasi: `bun test` (39 file) | 343 lulus, 22 gagal; daftar kegagalan sama dengan implementasi akhir |
| WebSocket terpisah dengan izin membuka port lokal | 3 lulus, 0 gagal; kegagalan socket pada suite sandbox bukan regresi |
| Build frontend dan backend | Berhasil |
| TypeScript frontend/backend | Masih gagal pada baseline; tidak ada diagnostik baru setelah posisi baris dinormalisasi |
| Demo `cd backend && bun run demo:evidence` | Snapshot awal tetap Rp300.000.000 setelah input baru Rp0; commitment cocok; unduhan anonim HTTP 401 |
| `git diff --check` | Bersih |

Kegagalan backend lama mencakup endpoint governance/attestation yang telah ditutup (HTTP 410), fixture governance/relayer lama, serta pembukaan socket dalam sandbox. Tidak ada kontrak atau ABI yang berubah pada ticket ini, sehingga Foundry tidak dijalankan. Interaksi browser manual tidak diuji; validasi UI terdiri atas build, pemeriksaan tipe terhadap baseline, dan tes fungsi penyajian. Alur penyimpanan/otorisasi diuji melalui HTTP aplikasi dengan mesin, database PGlite, dan berkas terisolasi sungguhan.

Regresi tambahan dibuat gagal terlebih dahulu, lalu diluluskan oleh perbaikan: teks privat pada ringkasan publik, angka negatif ketika sisi lain hilang, klaim nol dengan sumber belum dibaca, cakupan OFF/BOTH terhadap sumber ON, galat penyimpanan yang memuat locator privat, unduhan nama Unicode, serta penggantian ciphertext sah dengan isi yang tidak sesuai commitment berkas.

## Standards

Reviewer terpisah menemukan kebocoran locator pada pesan galat, unduhan Unicode yang gagal, serta dua duplikasi pada tipe persiapan dan konstruksi metadata berkas. Seluruhnya diperbaiki. Review ulang: tidak ada pelanggaran atau temuan yang masih perlu ditindaklanjuti pada perubahan yang diperiksa.

## Spec

Reviewer terpisah menemukan cakupan neraca yang tidak tersedia dapat menjadi laporan nol seimbang, serta unduhan Unicode yang gagal. Keduanya diperbaiki. Review ulang menjalankan empat kasus HTTP (OFF/BOTH, Unicode, dan ciphertext pengganti): 4 lulus, 0 gagal. Tidak ada masalah penghalang tersisa pada cakupan ticket #70.

Temuan terbuka setelah review: Standards 0; Spec 0. Hasil ini bukan audit keamanan menyeluruh, deployment, atau validasi kesiapan pilot dengan data mitra.
