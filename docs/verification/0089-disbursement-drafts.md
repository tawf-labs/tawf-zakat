# Verifikasi perbaikan draf pengajuan #89

Tanggal: 2026-09-16. Baseline: `a08c66f`.

Delapan temuan review diperbaiki: perpindahan editor, relasi penerima baru dengan
rincian bantuan, versi wajib, retry durable, indikator perubahan belum tersimpan,
label aksesibel, target tombol hapus, dan pemisahan komponen sesuai ADR-0012.
Review ulang Standards dan Spec tidak menemukan temuan tersisa dalam cakupan ini.

## Kontrak mutasi draf

`POST /api/workspace/proposals` wajib membawa `operationId` dan `expectedVersion`.
Versi `0` hanya untuk membuat draf; perubahan memakai ID draf dan versi tersimpan
terakhir. `DELETE /api/workspace/proposals/:id` membawa JSON dengan kedua field
tersebut, dengan versi minimal `1`. Versi hilang/tidak valid ditolak HTTP 400;
versi usang atau benturan ID ditolak HTTP 409. Update tidak membuat ulang draf
yang sudah dihapus. Identitas penyusun dan waktu pembuatan dipertahankan.

Retry memakai `operationId`, akun, lembaga, dan isi permintaan yang sama. Server
menyimpan hasil operasi dalam transaksi yang sama dengan mutasi, lalu mengembalikan
hasil semula saat retry, termasuk setelah restart atau perubahan berikutnya.
Pemakaian ulang identitas operasi dengan isi berbeda ditolak HTTP 409.

Tabel `proposal_draft_operations` dibuat secara aditif oleh `ensureSchema()` pada
startup runtime ruang kerja. Hasil operasi tetap privat, termasuk setelah draf
dihapus agar retry penghapusan aman. Tidak ada backfill atau perubahan data legacy.
Klien API lain harus menyertakan field mutasi wajib ini.

Editor membuat UUID sebelum penerima dihubungkan ke rincian bantuan. Navigasi
memasang editor sesuai identitas draf; perubahan belum tersimpan memerlukan
konfirmasi untuk dibuang. Saat hasil penyimpanan belum diketahui, editor menahan
perubahan dan navigasi sampai operasi yang sama diperiksa kembali. Payload retry
hanya berada dalam memori tab, mengikuti lifecycle akses ruang kerja.

## Hasil pengujian

- Backend: **107 lulus, 0 gagal, 0 skip**, termasuk dua smoke Chromium.
- Frontend ruang kerja: **64 lulus, 0 gagal**.
- Build frontend: `bun run build` berhasil.
- Typecheck: 17 diagnostik backend dan 136 frontend, identik dengan baseline
  `a08c66f` setelah normalisasi nomor baris/kolom. Tidak ada diagnostik baru.
- `git diff --check` berhasil.

Dari direktori `backend`, dengan adapter browser dan Chromium yang tersedia:

```sh
REGISTRY_BROWSER_MODULE=/path/to/playwright-core/index.mjs \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/disbursement_api.test.ts test/tenancy.test.ts \
  test/workspace_api.test.ts test/workspace_store.test.ts \
  test/workspace_officer_api.test.ts
```

Dari direktori `frontend`:

```sh
bun test src/features/workspace
bun run build
bunx tsc --noEmit
```

Tes HTTP tambahan mencakup versi wajib, benturan pembuatan, dua edit bersamaan,
retry identik bersamaan, identitas operasi yang digunakan dengan isi berbeda,
retry setelah restart, penghapusan dengan versi usang, retry penghapusan, dan
penolakan update atas draf yang sudah dihapus.

Smoke draf memakai form aplikasi asli dan API/database nyata: dua penerima dengan
bantuan masing-masing, perpindahan draf A/B/draf baru, membatalkan atau menerima
pembuangan perubahan, pindah program tanpa memindahkan draf lama, serta respons
jaringan yang sengaja dibuang **setelah** backend menyimpan. Pemeriksaan ulang
menghasilkan satu draf dengan versi yang sama.
