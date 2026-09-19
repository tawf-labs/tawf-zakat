# Issue #105 — Pemulihan kontak dan akses donatur berjejak

Tanggal: 2026-09-19. Issue: https://github.com/tawf-labs/tawf-zakat/issues/105. Induk: spec #100 (US-50, US-51, US-89, US-91; AC13, AC14, AC15, AC29, AC30).

## Cakupan yang diimplementasikan

- **Pengajuan Pemulihan Kontak oleh Donatur (`POST /api/donor/recovery-request`):**
  - Donatur yang kehilangan akses atau kontribusinya tercatat dengan kontak salah/kosong dapat mengajukan permohonan pemulihan dengan menyertakan: referensi kuitansi, kontak email baru yang valid, nama pengenal opsional, dan dasar hubungan/bukti kepemilikan kontribusi (minimal 10 karakter; nomor referensi kuitansi saja tidak cukup).
  - Validasi ketat input (`validateRecoveryRequestInput`): memastikan format email dan deskripsi bukti memadai, menolak jika permohonan berstatus `PENDING` sudah ada untuk kontribusi tersebut guna mencegah spamming.
  - Kontak baru disamarkan (`requested_contact_masked`) menggunakan algoritma `maskContact()` untuk menjaga privasi donatur.

- **Proyeksi Publik Status Pemulihan (`GET /api/donor/recovery-request/:id` & `GET /api/donor/recovery-status?reference=...`):**
  - Menyajikan status transparan (`PENDING`, `APPROVED`, `REJECTED`) bersama kontak tersamar (`n***r@example.com`) dan catatan/alasan keputusan tanpa membocorkan nominal rupiah, nama asli, atau identitas lembaga.

- **Pemeriksaan dan Keputusan Petugas Lembaga (`/api/workspace/contributions/recovery-requests`):**
  - Memerlukan mandat operasional `RECORD_CONTRIBUTIONS` milik petugas lembaga (`assertOperationalMandate` & `AC29`). Operator tanpa mandat ditolak 403 Forbidden.
  - Keputusan (`POST /contributions/recovery-requests/:id/decision`) mencatat akun petugas, ID profil amil, alasan wajib (minimal 5 karakter), waktu keputusan, dan versi kontribusi (`expectedContributionVersion`).
  - Menjamin konkurensi optimistik (`DonorRecoveryConflictError` / 409 Conflict saat bentrok versi) dan idempotensi mutlak melalui `operationId`.

- **Pemberlakuan Keputusan:**
  - **Persetujuan (`APPROVED`):** Memperbarui `contributions.donor_contact` ke kontak baru, menaikkan versi kontribusi, mencabut seketika semua kode OTP yang belum terpakai (`consumed_at = now`), dan membatalkan seluruh sesi donatur yang aktif untuk kontribusi tersebut (`revoked_at = now`). Menulis audit trail berjejak di `contribution_history` dengan kontak tersamar.
  - **Penolakan (`REJECTED`):** Mencatat alasan penolakan dan status `REJECTED` pada permohonan, tanpa merekayasa kontak atau menghapus kontribusi yang ada (`US-51`).

- **Antarmuka Pengguna (Frontend):**
  - **Donatur (`DonorRecoveryModal` & `DonorOtpAccess`):** Tombol bantuan "Ajukan Pemulihan Kontak & Akses" pada form OTP, dialog modal pengajuan bukti, serta pelacakan status permohonan yang jujur dan informatif.
  - **Petugas Lembaga (`DonorRecoveryTable` & `DonorRecoveryReviewModal` di `ContributionPanel`):** Tab khusus "Pemulihan Kontak" di ruang kerja amil, filter status, tabel permohonan, dan modal dialog verifikasi bukti serta pengambilan keputusan persetujuan/penolakan berjejak.

## Hasil Pengujian

- `backend/test/donor_recovery_api.test.ts` (9 test, 100% pass):
  1. Pengajuan recovery request dengan referensi, kontak baru, dan bukti hubungan (US-50, AC105.1).
  2. Proyeksi publik status tahap tanpa kebocoran data pribadi atau nominal (AC15, AC105.4).
  3. Penegakan mandat operasional `RECORD_CONTRIBUTIONS` (AC29, AC105.1).
  4. Penolakan permohonan tanpa mengubah kontribusi atau membuat kontak palsu (US-51, AC105.4).
  5. Persetujuan pemulihan: update kontak, kenaikan versi, pencabutan kode/sesi lama, dan akses OTP baru (AC14, AC105.2, AC105.3).
  6. Deteksi bentrok versi optimistik mencegah persetujuan ganda (AC105.2).
  7. Idempotensi keputusan dengan `operationId` (AC105.2).
  8. Ketahanan persistensi state melintasi restart database (US-91).
  9. **Smoke test browser Chromium nyata (AC30):** Alur lengkap donatur mengajukan pemulihan kontak via UI form publik, amil memeriksa dan menyetujui via API ruang kerja, modal ditutup, donatur meminta OTP ke kontak baru, menerima kode di outbox email, memverifikasi, dan membuka rincian kontribusi.
- Total pengujian donor (`donor_otp_access_api.test.ts` + `donor_recovery_api.test.ts`): **31 pass, 0 fail, 215 assertions**.
- Verifikasi build backend (`bun run build`): lulus 0 error.
- Verifikasi frontend dan SSR (`bun run build` & `bun run verify:ssr`): seluruh rute HTTP 200 pass.

## Batasan & Catatan

- Pemulihan kontak hanya dapat disetujui oleh amil yang memiliki mandat operasional `RECORD_CONTRIBUTIONS` pada lembaga terkait.
- Kontak yang telah dipulihkan langsung menggantikan kontak lama secara definitif; sesi donatur aktif terdahulu tidak dapat dipakai kembali dan harus meminta OTP baru ke kontak hasil pemulihan.
