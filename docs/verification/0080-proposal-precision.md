# Verifikasi kelanjutan #80

Basis review: `c501ca9...HEAD` untuk implementasi awal #80, ditambah perbaikan
working tree setelah `2d006eb`. Ringkasan sesi sebelumnya tidak sesuai kode:
pembaca chain masih menolak >2^53, daftar proposal masih menebak skala, dan
proposal USDC warisan masih dihitung tanpa jumlah terverifikasi.

## Perubahan

- Chain state dan receipt mempertahankan jumlah uint256; daftar proposal
  memformat USDC dari jumlah eksak, tanpa heuristik besar angka.
- Writer memakai proyeksi kolom eksplisit sebelum/sesudah migrasi, sentinel `-1`
  untuk kolom lama pada nilai besar, dan upsert dengan pemeriksaan identitas.
- Konfirmasi ulang receipt memulihkan jumlah warisan secara idempoten. Insert
  tanpa bukti waktu pengajuan mempertahankan `created_at = NULL`.
- Mapper menolak angka eksak numerik yang sudah kehilangan presisi. Proposal
  USDC tanpa `amount_exact` tetap tercantum sebagai belum terverifikasi pada
  rekonsiliasi. Perhitungan angka periode ditolak bila penyaluran tersebut ada.
- Basis hak amil tidak dianggap lengkap ketika jumlah penyaluran belum sah.
  Total audit menggunakan integer tepat, diserialisasi sebagai string bila besar.

## Review

| Sumbu | Hasil |
| --- | --- |
| Standards | Temuan penolakan >2^53 dan angka numerik eksak tidak aman diperbaiki; review ulang tanpa temuan penghalang. Penjelasan ADR tentang periode diperjelas. |
| Spec | Temuan legacy, chain, daftar proposal, dan pemulihan diperbaiki. Migrasi produksi tetap tindakan operator terpisah, bukan syarat kelulusan uji lokal. |

## Operasional

Pemeriksaan baca-saja `bun run proposal:verify` pada 2026-09-09 menjawab:
kolom eksak belum ada; jumlah proposal 0. Ini observasi database terkonfigurasi,
bukan bukti deployment kode atau pengujian transaksi publik. Tidak ada migrasi,
deployment, maupun penutupan issue dilakukan pada sesi ini.

[Runbook](../design/proposal-amount-precision-operations.md) mencakup SQL migrasi,
restart untuk cache katalog, pemulihan receipt, dan batas rollback sentinel.

## Hasil pengujian

- Backend lengkap, akses Anvil/WebSocket lokal: **630 pass, 6 skip, 20 fail**.
  Semua 20 nama kegagalan juga muncul pada baseline `2d006eb`; tidak ada nama
  kegagalan baru. Checkout baseline terisolasi memiliki satu kegagalan setup
  tambahan karena artefak kontrak hasil build tidak disimpan di Git; karena itu
  angka kelulusan total kedua checkout tidak dibandingkan langsung.
- Frontend lengkap: **133 pass, 0 fail**.
- Mapper jumlah setelah tambahan kasus numeric-unsafe: **9 pass, 0 fail**.
- Typecheck backend: **13 diagnostik**, seluruhnya kategori/lokasi lama;
  baseline memiliki 14. Satu mock konfirmasi lama diperbaiki agar menyertakan
  `amountExact`. Ini bukan klaim typecheck bersih.
- `git diff --check`: lulus.

Pengujian sandbox awal tidak dapat membuka layanan lokal. Suite akhir dijalankan
ulang di luar sandbox, memakai `NODE_ENV=test` dan data sintetis terisolasi.
Log sesi tersedia di `/tmp/zkt-backend-final.log`, `/tmp/zkt-backend-baseline.log`,
`/tmp/zkt-frontend-final.log`, dan `/tmp/zkt-typecheck-final.log`.

## Pelaksanaan migrasi setelah persetujuan pengguna — 2026-09-09 WIB

Pengguna menyetujui backup, migrasi #80, dan verifikasi setelah commit `fdadffd`.

- Backup custom PostgreSQL: `backend/pre-proposal80-migration-20260908T183316Z.dump.bak`
  (74.264 byte, izin 0600), disimpan lokal dan diabaikan Git. Timestamp nama
  berkas menggunakan UTC. Checksum ada pada berkas `.sha256` di sebelahnya.
- `pg_restore --list` dan pembacaan seluruh arsip ke `/dev/null` berhasil;
  `sha256sum --check` cocok. Ini verifikasi keterbacaan arsip, bukan uji restore
  ke database terpisah.
- Verifikasi sebelum migrasi: kolom belum ada, proposal 0.
- `bun run proposal:migrate` berhasil menjalankan
  `ALTER TABLE disbursement_proposals ADD COLUMN IF NOT EXISTS amount_exact TEXT`.
- Verifikasi ulang dari proses terpisah: kolom sudah ada, proposal tetap 0,
  jumlah eksak 0, USDC tanpa jumlah eksak 0. Tidak ada backfill yang diperlukan.
- Tidak ada API lokal yang mendengarkan port 3001 saat pemeriksaan, sehingga
  tidak ada proses API lokal untuk direstart. Proses yang kemudian dijalankan
  akan membaca katalog baru. Proses deployment lain tidak diverifikasi di sini.
- Tidak ada transaksi publik atau deployment aplikasi dilakukan. Status issue
  GitHub tidak diubah oleh pelaksanaan migrasi ini.
