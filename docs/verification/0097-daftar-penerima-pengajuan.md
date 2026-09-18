# Verifikasi perubahan daftar penerima pengajuan — #97

Acuan: issue #97, spec #86, amandemen pilot #100, ADR-0027/0028/0029.
Baseline pemeriksaan: `9602cb2` (putaran perbaikan review kedua).

## Perilaku

- Pratinjau disimpan server dan mengikat akun, lembaga, pengajuan, versi dasar,
  versi pemetaan, baris hasil pemetaan, serta isi berkas. Payload SQL dienkripsi
  AES-256-GCM dengan binding akun/lembaga/pengajuan/preview dan kedaluwarsa
  setelah 30 menit. Preview invalid tidak disimpan. Apply memakai
  identitas pratinjau tersebut; baris atau berkas pengganti dari klien ditolak.
- Preview tidak menulis blob sumber. Saat apply, lokasi calon berkas diantrekan
  untuk cleanup sebelum penulisan; transaksi sukses mengonsumsi preview dan
  antrean berkas bersamaan dengan hasil operasi. Worker saat startup dan setiap
  menit menghapus preview kedaluwarsa serta berkas gagal/ditinggalkan, termasuk
  temporary ciphertext yang tertinggal sebelum rename. Dokumen terkomitmen
  dilindungi dari cleanup. Cleanup berkas diproses per batch 100.
- Schema preview memiliki FK lembaga/pengajuan, created_at, expires_at, dan
  indeks expiry/owner. Migrasi menghapus tabel preview plaintext lama serta
  mengantrekan sumbernya untuk cleanup; preview lama perlu dibuat ulang.
- ID penerima/baris diperiksa melalui indeks GIN JSONB pada draf dan revisi,
  termasuk ID yang belum pernah masuk versi pengajuan yang disetujui.
- Draf dan dokumen sumber disimpan dalam satu transaksi berpenjaga versi.
  Revisi pengajuan menggunakan transaksi revisi yang sama untuk dokumen sumber
  dan hasil operasi idempoten. Tidak ada metode penulisan dokumen langsung.
- Berkas identik tidak membuat versi, revisi, atau dokumen pengajuan baru.
  Identitas operasi yang sama dengan payload berbeda ditolak.
- ID stabil menentukan perubahan; urutan array tidak menentukan kesamaan.
  Baris tanpa ID mendapat peringatan eksplisit dan ID deterministik dalam
  pengajuan/berkas tersebut. Pemulihan ID sumber tanpa ID hanya berlaku ketika
  berkas persis terikat pada versi sekarang dan seluruh isi serta relasinya cocok.
- Persetujuan lama hanya dipertahankan untuk penerima dan materi bantuan yang
  sama. Perubahan identitas/kontak tidak mewarisi persetujuan baris sebelumnya.
  Error parsing tidak ditampilkan sebagai bukti penghapusan.
- UI menampilkan jumlah perubahan, total per satuan, rincian, dan masalah berkas.
  Nilai NIK/telepon/email tidak disalin ke uraian perubahan. Pratinjau lengkap
  dan dokumen tetap melalui akses privat lembaga.
- Hasil belum diketahui dibaca dari ledger sebelum retry. Hanya referensi
  operasi tanpa PII disimpan di session storage, terikat origin/akun/pengajuan,
  agar penutupan dialog dan pergantian sesi tidak menghilangkan pemulihan.
- Error tak terklasifikasi dicatat dengan incident ID dan SQLSTATE tanpa
  payload, nama berkas, atau detail SQL yang dapat berisi PII. HTTP mengembalikan
  reason INTERNAL_ERROR yang aman; handler tidak lagi memeriksa substring URL.
- Tombol impor #92 tetap memakai alur impor dan pembukaan sumber semula.
  Pembaruan daftar penerima dan revisi dari berkas memiliki tindakan tersendiri.

## Pengujian yang dijalankan

- `cd backend && bun test`: **925 pass, 20 skip, 0 fail**.
- `cd frontend && bun test`: **199 pass, 0 fail**.
- `bun test backend/test/proposal_beneficiary_list_api.test.ts` dengan
  `REGISTRY_BROWSER_MODULE` menunjuk Playwright dan
  `REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium`: **25 pass, 0 fail**.
  Suite ini memakai HTTP Hono, PostgreSQL PGlite persisten, berkas CSV/XLSX nyata,
  penyimpanan terenkripsi, dan Chromium. Fixture eksternal terbatas pada wallet
  sintetis, transport OTP, waktu, dan kegagalan transport/SQL yang disengaja.
- Regresi mencakup retry revisi, tabrakan payload, pratinjau usang, isolasi
  lembaga/pengajuan, pergantian penerima, kontak/barang, rollback transaksi,
  pembukaan ulang database, serta apply identik pada draf dan pengajuan disetujui.
- Uji historis mempertahankan realisasi, konfirmasi OTP, biaya, dan tabel
  kontribusi/alokasi, versi pengajuan, serta snapshot sumber yang dibekukan
  melalui API evidence. Tidak ada kontrak atau jalur penerbitan NFT yang diubah.
- Smoke browser memeriksa diff sebelum konfirmasi, respons apply yang hilang,
  pemulihan setelah dialog ditutup/dibuka, konflik edit bersamaan, batas realisasi,
  usulan revisi, daftar riwayat yang benar-benar dibuka, serta respons tertunda
  setelah pergantian akun melalui
  pemilik sesi `createWorkspaceAccess` yang dipakai aplikasi. CSS aplikasi
  dikompilasi untuk viewport 390×844; batas dialog/overflow diperiksa, apply
  dan pembukaan riwayat dijalankan lewat keyboard.
- Regresi tambahan menutup expiry/enkripsi preview, migrasi legacy, cleanup
  setelah rollback dan crash sebelum rename, ID khusus revisi, serta unduhan
  sumber oleh amil/pemeriksa/pemutus. Pembaca tanpa mandat ditolak 403, akun
  lembaga lain 404, dan permintaan tanpa sesi 401.
- Typecheck backend/frontend dibandingkan dengan checkout baseline awal
  `a443346f140ce9baacd5232e8e27fc03a5a8dc67` terpisah:
  **tidak ada error baru** (13 diagnostic unik backend, 118 frontend).
  Error TypeScript lama pada baseline masih ada.
- `git diff --check`: lulus.

Smoke browser relevan dijalankan tersendiri dengan akses loopback; tes opt-in
lain tetap mengikuti konfigurasi suite. Regresi temporary-file dibuktikan gagal
sebelum perbaikan, lalu lulus. Full suite final dijalankan ulang setelah perbaikan.

## Code review

Dua reviewer terpisah memeriksa diff terhadap `9602cb2`.

- **Standards:** tidak ada hard violation; dua smell kecil (validasi alasan
  ganda dan format nilai bantuan berulang) diperbaiki. Review ulang tidak
  menemukan temuan material.
- **Spec:** satu gap cleanup berkas sementara saat proses mati ditemukan,
  diperbaiki, dan ditutup dengan regresi ciphertext nyata. Review ulang tidak
  menemukan blocker tersisa.

Kosakata teknis `ProposalBeneficiaryList` / `beneficiary-list` dicatat di
CONTEXT.md sebagai Daftar penerima pengajuan; jalur approved tetap Revisi
pengajuan. Endpoint internal berubah dari `/reupload/*` menjadi
`/beneficiary-list/*`; frontend dan backend harus dirilis bersama. Referensi
session storage lama dipertahankan agar pembacaan hasil operasi durable tetap
bisa dipulihkan, sementara preview lama yang belum diterapkan dibuat ulang.
