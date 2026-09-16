# Verifikasi perbaikan mandat operasional #90

Tanggal: 2026-09-16. Baseline: `6707045`. Sumber: issue #90, spec #86,
ADR-0012, ADR-0028–0030.

## Perilaku yang diperbaiki

- Atribusi penyusun disimpan bersama versi draf. Melepas akun kerja tidak
  menghapus identitas penyusunnya. Pemeriksaan pengesahan menolak seluruh petugas
  yang pernah mengubah isi material draf, termasuk melalui akun lain.
  Penyimpanan tanpa perubahan isi tidak menambah penyusun baru.
- Pemeriksaan perubahan draf mencakup program/nominal sebelum dan sesudah
  perubahan. Objek asal diperiksa ketika barisnya dikunci dalam transaksi
  penyimpanan. Arsip program dan hapus draf memakai cakupan objek yang dituju.
- Perubahan dan pencabutan mandat serta akun pengesahan wajib membawa
  `expectedVersion`. Field hilang/tidak valid menghasilkan HTTP 400; versi usang
  menghasilkan HTTP 409. Versi bertambah dalam transaksi yang sama dengan audit.
  Pengaktifan kembali dilakukan secara eksplisit memakai versi terbaru, bukan
  sebagai efek samping penyimpanan form atau pengulangan pendaftaran.
- Form pembuatan mempertahankan ID selama retry. Pembuatan ulang dengan ID mandat
  dan isi berbeda ditolak. Retry pendaftaran akun pengesahan setelah pencabutan
  tidak menghidupkan akun kembali. Retry mutasi dengan versi lama ditolak aman;
  klien harus memuat ulang keadaan server sebelum tindakan baru.
- Form mandat dan akun pengesahan dipisahkan dari daftar dan pemuatan data.
  TanStack Query memakai cache privat per konteks sesi; mutasi menginvalidasi
  daftar terkait dan menyegarkan snapshot ruang kerja untuk kartu, navbar,
  serta pilihan pengesah. Respons refresh yang lebih lama tidak menimpa hasil baru.
- Pilihan pengesah berada dalam komponen yang dipasang sesuai konteks sesi.
  Logout, invalidasi akses, atau pergantian akun membuang pilihan dan cache.
  Pencabutan/perubahan versi akun pengesahan juga membatalkan pilihan lama.

## Perubahan persistensi dan kompatibilitas

`ensureSchema()` menambahkan kolom `version` pada `operational_mandates` dan
`institutional_endorsement_accounts`, serta tabel `proposal_draft_contributors`.
Tidak ada penghapusan mandat, akun, atau draf yang sudah tersimpan.

Atribusi lama dipulihkan dari pembuat draf dan hasil penyimpanan durable pada
`proposal_draft_operations`, memakai hubungan akun–petugas termasuk keanggotaan
nonaktif. Untuk catatan lama, pelaku save diperlakukan sebagai penyusun secara
konservatif. Migrasi idempoten dan tidak menimpa atribusi yang sudah direkam.
Jika identitas atau versi historis tidak dapat dipulihkan lengkap, pemeriksaan
pengesahan ditahan dengan alasan eksplisit, bukan menganggap tidak ada penyusun.

Klien lain yang memakai PATCH/DELETE mandat atau akun pengesahan harus ikut
mengirim `expectedVersion` dari hasil pembacaan terbaru. Frontend di perubahan
ini sudah memakai kontrak tersebut.

Endpoint `verify-approval` tetap pemeriksaan kelayakan, bukan penerimaan keputusan
atau tanda tangan yang dapat dipakai ulang. Penerimaan keputusan pada tiket
berikutnya harus memeriksa ulang versi, identitas penyusun, dan mandat pada saat
mutasi. Hak registry/publikasi/atestasi tidak diubah.

## Pengujian

- 121 tes backend terkait lulus; tiga smoke Chromium dijalankan terpisah dan lulus.
- 177 tes frontend lulus.
- `bun run build` frontend berhasil.
- Typecheck dibandingkan dengan arsip commit baseline memakai dependensi yang
  sama: backend tetap 14 diagnostik, frontend turun dari 139 menjadi 136.
  Tidak ada diagnostik baru; typecheck seluruh repositori belum bersih karena
  diagnostik lama di luar perbaikan ini.
- `git diff --check` berhasil.

Regresi API/SQL mencakup akun pembuat yang dilepas lalu storage dibuka ulang,
penyusun material kedua, penyimpanan tanpa perubahan isi, backfill atribusi,
riwayat tidak lengkap, perpindahan lintas cakupan, arsip/hapus dalam cakupan,
versi wajib, dua edit bersaing, serta retry pendaftaran setelah pencabutan.

Smoke memakai UI asli dan API/SQL nyata: pemberian mandat, edit usang setelah
pencabutan, pengaktifan kembali eksplisit, penyegaran pilihan pengesah setelah
pendaftaran, pembatalan pilihan setelah pencabutan/pengaktifan akun, logout,
dan pergantian ke akun lain milik petugas yang sama.

Dari `backend`:

```sh
REGISTRY_BROWSER_MODULE=/path/to/playwright-core/index.mjs \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/tenancy.test.ts test/workspace_api.test.ts \
  test/workspace_store.test.ts test/workspace_officer_api.test.ts \
  test/disbursement_api.test.ts test/workspace_mandate_api.test.ts --timeout 45000
```

Dari `frontend`: `bun test src` dan `bun run build`.
