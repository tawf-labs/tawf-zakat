# Issue #105 — Pemulihan kontak dan akses donatur berjejak

Issue: https://github.com/tawf-labs/tawf-zakat/issues/105. Induk: spec #100 (US-50, US-51, US-89, US-91; AC13, AC14, AC15, AC29, AC30).

## Cakupan

- Donatur mengajukan referensi kontribusi, email baru, nama opsional, dan dasar hubungan (minimal 5 karakter). Pemeriksaan petugas tetap diperlukan; panjang teks bukan verifikasi kepemilikan.
- Petugas dengan mandat `RECORD_CONTRIBUTIONS` memutuskan permohonan. Aktor, alasan, waktu, versi kontribusi, dan perubahan kontak tersamar dicatat. Versi usang ditolak dan retry keputusan memakai `operationId`.
- Persetujuan memperbarui kontak, menaikkan versi, menghabiskan kode OTP lama dan mencabut sesi kontribusi terkait. Penolakan tidak menghapus kontribusi atau membuat kontak pengganti.
- Endpoint publik berdasarkan ID permohonan maupun referensi hanya mengembalikan ID, status, kontak tersamar, dan waktu. **Alasan keputusan dan bukti pemeriksaan tetap privat**, termasuk ketika alasan berisi nama, nominal, atau alamat email. UI donor memakai pesan status yang tetap.
- Donatur dapat mengajukan pemulihan baru setelah persetujuan atau penolakan terdahulu. Permohonan baru menjalani pemeriksaan baru; persetujuan lama tidak diwariskan.
- Modal memakai komponen Dialog bersama untuk fokus dan keyboard. Formulir donor, status, rincian pemeriksaan, dan formulir keputusan dipisah menjadi komponen di bawah 150 baris. Pemetaan daftar/detail privat dan proyeksi publik masing-masing mempunyai satu mapper.

## Verifikasi perbaikan review

Suite `backend/test/donor_recovery_api.test.ts` menggunakan Hono HTTP, sesi petugas dengan signature nyata, SQL terisolasi, dan transport pesan fixture:

- Regresi privasi: alasan penolakan sengaja berisi nama, nominal, dan email sintetis. Dua endpoint publik tidak mengembalikannya, sedangkan detail petugas tetap menyimpannya.
- Dua petugas berwenang mengirim keputusan bersamaan melalui `Promise.all`; satu berhasil, satu menerima 409, dan riwayat hanya mempunyai satu keputusan.
- Database benar-benar ditutup dan dibuka kembali melalui `database.reopen()`. Setelah itu keputusan, versi, kontak, dan idempotensi tetap terbaca lewat HTTP; sesi dan kode lama tetap ditolak.
- Smoke Chromium memakai UI donor **dan UI petugas**, CSS aplikasi, viewport 1280×900 dan 390×844. Alur mencakup penolakan, persetujuan, pengajuan pemulihan kedua setelah reload, keputusan kedua, lalu OTP ke kontak terakhir. Fokus dialog, Escape, Tab/Shift+Tab, tombol lewat Enter, dan pesan kesalahan juga diperiksa.

Jalankan dari `backend` dengan modul Playwright yang sudah terpasang:

```bash
NODE_ENV=test \
REGISTRY_BROWSER_MODULE="$LOCAL_PLAYWRIGHT_MODULE" \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/donor_otp_access_api.test.ts test/donor_recovery_api.test.ts
```

Tanpa `REGISTRY_BROWSER_MODULE`, kedua smoke browser dilewati. Database default adalah PGlite persisten di direktori temporer. `DONOR_ACCESS_TEST_DATABASE_URL` dapat menunjuk PostgreSQL lokal; harness menggunakan schema terisolasi. Pada mode PostgreSQL, `reopen()` menyambungkan ulang klien, bukan me-restart server PostgreSQL.

## Hasil eksekusi 2026-09-20

- Kedua suite donor dengan Chromium: **31 pass, 0 fail, 247 assertions**, tanpa tes dilewati.
- `bun run build` di backend dan frontend: lulus.
- `git diff --check`: lulus.
- `tsc --noEmit` frontend: belum lulus secara global karena diagnostik pada file di luar perubahan ini (antara lain `PageHeader.tsx`, `Globe.tsx`, dan import tidak terpakai). Tidak ada diagnostik pada file yang diubah dalam perbaikan ini.
- Seluruh pengiriman memakai transport fixture; tidak mengirim email nyata, menjalankan migrasi produksi, atau melakukan deployment.
