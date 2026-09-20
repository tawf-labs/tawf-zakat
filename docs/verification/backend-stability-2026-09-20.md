# Backend: stabilitas tes dan typecheck — 2026-09-20

Pekerjaan ini menindaklanjuti kegagalan suite penuh yang dicatat pada #109,
sebelum implementasi #110. Tidak mengubah statement ZK, skema database produksi,
atau aturan pengesahan lembaga.

## Diagnosis yang direproduksi

1. **Polling receipt fixture terlalu lambat.** Client Viem pada
   `test/registry_api.test.ts` memakai polling bawaan sekitar 4 detik, sementara
   Anvil menambang langsung. Run diagnosis mereproduksi timeout 5 detik pada
   pergantian administrator A → B → A. Bun kemudian melaporkan penghentian proses
   yang masih hidup, termasuk Anvil fixture; tes selanjutnya gagal koneksi RPC.
   Polling fixture diubah menjadi 25 ms. Timeout tes tidak dinaikkan. Pada run
   penuh setelah perbaikan, skenario tersebut selesai sekitar 131 ms.

2. **Descriptor berkas SQL rusak setelah lifecycle browser pada Bun 1.3.6.**
   Run dengan browser menghasilkan 54 tes lulus lalu `ErrnoError` saat cleanup;
   run lain gagal lebih awal dengan `Bad file descriptor` pada tabel PGlite.
   Tanpa browser: 47 lulus, 7 skip. Reproduksi minimal memisahkan urutannya:
   tutup Chromium lewat Playwright, buka berkas SQL baru, lalu garbage collection.
   Pemeriksaan descriptor menemukan `EBADF`, dan penutupan SQL gagal. Ini terjadi
   pada siklus pertama di Bun 1.3.6; reproduksi yang sama melewati 20 siklus pada
   Bun 1.4.2. Bukan bukti kerusakan PostgreSQL server atau kebutuhan mengubah data.

Regresi permanen `backend/test/browser_storage_lifecycle.test.ts` menguji
browser nyata, penulisan SQL, GC, pembacaan ulang setelah restart, dan cleanup.
Tes tersebut gagal pada runtime lama sebelum guard versi ditambahkan.

Backend kini mematok Bun 1.4.2 lewat `.tool-versions` dan `packageManager`;
`engines`, preload tes, README dan base image Docker diselaraskan. Rilis runtime:
[Bun 1.4.2](https://github.com/oven-sh/bun/releases/tag/bun-v1.4.2).
Pilihan versi didasarkan pada reproduksi lokal; tidak mengatribusikan penyebab
ke PR upstream tertentu yang belum dibuktikan. Cleanup registry juga memakai
`finally` agar kegagalan penutupan SQL tidak meninggalkan Anvil fixture.

## Penyelesaian 22 error TypeScript

- Tipe status draf kontribusi merujuk deklarasi yang ada; error kontribusi hilang
  menerima nama entitas dan ID sesuai constructor.
- `ProposalRecord` mendeklarasikan timestamp yang sudah digunakan kode; pemetaan
  event mempertahankan literal union, dan proyeksi IPFS tidak menduplikasi `cid`.
- Upload byte IPFS menyalin typed array ke buffer yang cocok untuk `Blob` dan
  memakai `byteLength`; tidak menggunakan `any` untuk membungkam error.
- Seed memakai jumlah dari sumber fixture yang diketahui, tanpa mengubah
  `itemCount = null` pada batch historis yang populasinya memang tidak diketahui.
  Field seed role yang tidak ada pada skema dihapus dari insert.
- Fixture OTP menerima key uji; runtime setelah restart menerima TTL sesi dan
  challenge; tes filesystem memakai `parentPath`; pembandingan role tetap
  memeriksa seluruh pasangan nama/hash tanpa benturan inferensi literal.

TypeScript 6.0.2 dipatok sebagai dev dependency backend; `bun run typecheck`
menjalankan `tsc --noEmit`. Tidak ada `@ts-ignore`, pelemahan strict mode, atau
pengecualian file dari typecheck. Script seed/cleanup lama tidak dijalankan.

## Cara mengulang

Hasil suite penuh dengan browser aktif: **1.057 lulus, 0 gagal, 0 skip**, 8.901
assertion pada 81 file, sekitar 262 detik. `mise exec -- bun run typecheck`
lulus tanpa error. `git diff --check` juga lulus.

Suite registry dan regresi lifecycle diulang dua kali lagi dengan browser aktif:
masing-masing **55 lulus, 0 gagal, 0 skip, 804 assertion**, sekitar 70 detik.
Hasil ini menunjukkan kegagalan yang direproduksi sudah teratasi; bukan jaminan
bahwa tidak ada flakiness lain pada kombinasi platform atau runtime yang berbeda.

Dari `backend/`:

```bash
mise install
mise exec -- bun install --frozen-lockfile
mise exec -- bun run typecheck
REGISTRY_BROWSER_MODULE=/absolute/path/to/playwright-core/index.mjs \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
mise exec -- bun test
```

Tanpa variabel browser, smoke browser dilewati. Database memakai direktori
PGlite sementara dan rantai memakai Anvil lokal. Database kerja `zkt-pg`, data
pilot, dan deployment tidak diubah. Image Docker belum dibangun dalam sesi ini.
