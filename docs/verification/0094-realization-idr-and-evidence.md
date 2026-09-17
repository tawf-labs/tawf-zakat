# Issue #94 — Realisasi IDR bertahap dan bukti pembayaran

Tanggal: 2026-09-17. Issue: https://github.com/tawf-labs/tawf-zakat/issues/94
Konteks: Spesifikasi Issue #86 dan Amandemen Pilot Issue #100.

## Hasil

- `backend/test/disbursement_realization_api.test.ts`: **20 pass, 0 fail, 627 `expect()`** (19 tes API + 1 smoke browser), di PGlite dan di PostgreSQL lokal (`REALIZATION_TEST_DATABASE_URL`).
- Suite disbursement lain (`disbursement_*`, `proposal_*`, `e2e_disbursement_pipeline`): **94 pass, 3 skip, 0 fail**. Tiga smoke opsional suite lama tidak diaktifkan pada run regresi tersebut.
- Frontend: **198 pass, 0 fail**; `vite build` berhasil. `tsc --noEmit` penuh masih gagal pada komponen di luar irisan realisasi (antara lain `PageHeader`, `Globe`, dan import tidak terpakai); tidak ada diagnostic pada `features/disbursement`.

## Cakupan

1. **Pencatatan kejadian.** `REALIZATION_DISCLAIMER_NOTICE` dikirim server dan ditampilkan pada tombol serta dialog. `reportedAt`, `recordedAt`, dan operator disimpan terpisah.
2. **Penerima pembayaran pihak lain.** `paymentRecipient { name, relation }` tidak mengubah penerima manfaat. Ringkasan per baris memakai penerima yang tercatat pada realisasi. Nominal IDR dihitung eksak dengan BigInt sampai 18 digit.
3. **Skenario 13 (80 dari 100).** Status `PARTIALLY_REALIZED`. Jumlah penerima unik dan jumlah kejadian pembayaran dihitung terpisah (80 vs 81).
4. **Skenario 14.**
   - Batas hak dicek atomik dengan kunci baris pengajuan; tes memakai permintaan serentak.
   - Setiap pencatatan wajib membawa `operationId` dan `expectedVersion`.
   - Retry yang sama, termasuk dua permintaan identik serentak, mengembalikan hasil yang sama tanpa menambah baris.
   - Versi basi ditolak 409.
   - Dialog mempertahankan identitas retry sampai hasilnya pasti dan menampilkan status "Belum tersimpan", "Hasil penyimpanan belum diketahui", atau "Realisasi tersimpan".
5. **Bukti.**
   - Tunai dibuktikan dengan `RECEIPT_OR_BAST`, transfer dengan `PAYMENT_PROOF`, dan setiap bukti wajib menyebut jumlah yang dibuktikan per realisasi.
   - Bukti dianggap lengkap hanya jika jumlah bukti tepat sama dengan nominal realisasi.
   - BAST kelompok dialokasikan eksplisit ke setiap realisasi dalam `batchGroupId` yang sama.
   - Foto hanya pendukung dan tidak dialokasikan.
   - Unggahan bersifat idempoten.
   - `storageRef` tidak pernah keluar dari server, dan unduhan diperiksa ulang dengan SHA-256.
   - Hak akses berkas pengajuan tidak berubah; bukti realisasi memakai pemeriksaan akses sendiri.
6. **Bukti belum lengkap** tetap mengurangi sisa hak. Antrean ada di `GET /api/workspace/proposals/queue/incomplete-evidence` dan memuat tujuan, jumlah kejadian, total, serta kejadian terlama.
7. **Konfirmasi OTP (hanya tunai).**
   - Kode dikirim hanya lewat `runtime.messages`; tanpa transport, endpoint menjawab 503. Kode tidak pernah dikembalikan ke petugas.
   - Kontak harus cocok dengan kontak pada snapshot versi pengajuan yang dirujuk realisasi; kontak bebas, kontak kosong, dan kontak tanpa hubungan tercatat ditolak. UI memilih kontak tercatat.
   - Tantangan menyimpan identitas penerima, perwakilan dan hubungan kontak dari snapshot tersebut. Kode disimpan sebagai hash dengan nonce; alamat kontak hanya disimpan sebagai petunjuk tersamar pada tantangan.
   - Kolom `confirmer_json` ditambahkan secara aditif oleh `ensureSchema()`. Tantangan lama tanpa ikatan identitas ditolak dan perlu diterbitkan ulang.
   - Kode terikat ke versi realisasi, jumlah, dan jenis bantuan.
   - Kode ditolak jika kedaluwarsa, sudah dipakai, milik realisasi lain, sudah melewati lima percobaan salah, atau jika realisasi berubah setelah kode dikirim.
   - Kode baru membatalkan kode lama, dan pengiriman yang gagal membatalkan tantangannya.
8. **Pemeriksaan BAST.** Dilakukan oleh petugas selain pencatat (403 jika pencatat sendiri) dan hanya ketika total alokasi tanda terima/BAST sama dengan seluruh nominal realisasi. BAST parsial tidak mengonfirmasi seluruh realisasi. Transfer tidak diberi label konfirmasi penerima (409).
9. **Uang muka dan biaya.**
   - Dicatat terpisah dari bantuan.
   - Biaya hanya dapat mempertanggungjawabkan uang muka dari pengajuan yang sama dan tidak boleh melebihi sisanya.
   - Tidak ada perubahan status otomatis.
10. **Sengketa.**
    - Subjeknya penerimaan atau jumlah, dengan nominal tidak melebihi realisasi.
    - Sengketa menahan konfirmasi OTP dan BAST.
    - Hasil pemeriksaan (`EXAMINED`/`RESOLVED`) ditambahkan sebagai riwayat oleh pemeriksa, pemutus, atau penangan pemeriksaan laporan yang bukan pencatat.
    - `RESOLVED` melepas tahanan, dan konfirmasi harus diulang.
    - Realisasi tidak dihapus atau dihitung ulang, dan tidak ada `ON DELETE CASCADE`.
11. **Isolasi dan sesi.** Lembaga lain, realisasi dari pengajuan lain, sesi yang sudah logout, dan sesi kedaluwarsa tidak dapat membaca atau menulis.
12. **Restart.** Setelah koneksi basis data dibuka ulang, ringkasan, bukti, sengketa, dan hasil retry tetap utuh.
13. **Smoke browser** (Chromium, laptop 1280 dan ponsel 390) mencakup:
    - respons hilang setelah commit lalu retry tanpa pencatatan ganda;
    - unggah BAST dan baca ulang dari sesi baru;
    - unduhan privat;
    - pencatatan di ponsel lewat keyboard, dengan pembayaran ke sekolah;
    - bagian realisasi dan dialognya tanpa scroll horizontal, memakai CSS hasil build produksi;
    - OTP melalui kontak tercatat dan transport fixture, lalu sengketa sesudah konfirmasi;
    - pencatatan uang muka, biaya, sengketa, dan hasil pemeriksaan dengan respons hilang setelah commit dan retry tanpa duplikasi;
    - penyelesaian sengketa dan pemeriksaan BAST oleh akun petugas lain pada ponsel.
14. **Perbaikan retry amandemen.** Uang muka, biaya, sengketa, dan hasil pemeriksaannya wajib memakai `operationId`. Hash permintaan mengikat endpoint/subjek dan payload. Ledger operasi serta hasil mutasi disimpan dalam satu transaksi; retry serentak dan setelah koneksi DB dibuka ulang mengembalikan hasil durable yang sama. Payload berbeda dengan identitas yang sama ditolak 409.
15. **Frontend.** Data ringkasan, kejadian, berkas, antrean, uang muka/biaya, dan sengketa memakai TanStack Query dengan key per konteks akses/pengajuan. Cache privat dihapus saat konteks sesi dilepas. Mutasi amandemen berbagi hook retry dan indikator status; field dikunci selama hasil belum pasti. Form penerima manfaat dan penerima pembayaran dipisah menjadi komponen kecil.

## Batasan yang diketahui

- Produksi belum mengonfigurasi `messages` (transport SMS/email), sehingga OTP menjawab 503 dan petugas memakai pemeriksaan BAST.
- Alur realisasi setelah revisi disetujui menunggu #97; penolakan versi basi dan pembatalan OTP saat versi realisasi berubah sudah diuji. Konsumsi identitas/status oleh #98 dan pekerjaan ZK/NFT belum menjadi bukti integrasi end-to-end.
- Halaman ruang kerja di luar bagian realisasi (tabel petugas) masih melebar di layar 390 px. Ini sudah ada sebelum #94.
- Skema tabel realisasi berubah dari draf sebelumnya. Basis data lokal yang sudah membuat tabel versi lama perlu dihapus tabel `disbursement_realization_*`-nya sebelum `ensureSchema()`.

## Menjalankan ulang

```bash
cd frontend && bun run build && bun test
cd ../backend && bun test test/disbursement_realization_api.test.ts
# dengan PostgreSQL lokal dan smoke browser:
REALIZATION_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/zkt \
REGISTRY_BROWSER_MODULE=/path/playwright-core/index.mjs REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/disbursement_realization_api.test.ts
```
