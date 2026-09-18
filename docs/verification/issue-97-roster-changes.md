# Verifikasi perubahan daftar penerima pengajuan — #97

Acuan: issue #97, spec #86, amandemen pilot #100, ADR-0027/0028/0029.
Baseline pemeriksaan: `a443346f140ce9baacd5232e8e27fc03a5a8dc67`.

## Perilaku

- Pratinjau disimpan server dan mengikat akun, lembaga, pengajuan, versi dasar,
  versi pemetaan, baris hasil pemetaan, serta berkas terenkripsi. Apply memakai
  identitas pratinjau tersebut; baris atau berkas pengganti dari klien ditolak.
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
- Tombol impor #92 tetap memakai alur impor dan pembukaan sumber semula.
  Pembaruan daftar penerima dan revisi dari berkas memiliki tindakan tersendiri.

## Pengujian yang dijalankan

- `cd backend && bun test`: **920 pass, 20 skip, 0 fail**.
- `cd frontend && bun test`: **199 pass, 0 fail**.
- `bun test backend/test/beneficiary_reupload_api.test.ts` dengan
  `REGISTRY_BROWSER_MODULE` menunjuk Playwright dan
  `REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium`: **20 pass, 0 fail**.
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
  usulan/riwayat revisi, dan respons tertunda setelah pergantian akun melalui
  pemilik sesi `createWorkspaceAccess` yang dipakai aplikasi.
- Typecheck backend/frontend dibandingkan dengan checkout baseline terpisah:
  **tidak ada error baru**. Error TypeScript lama pada baseline masih ada.
- `git diff --check`: lulus.

Full suite pertama di sandbox terhalang pembukaan port WebSocket. Eksekusi ulang
full suite dengan akses loopback lulus seperti dicatat di atas. Smoke browser
relevan dijalankan tersendiri; tes opt-in lain tetap mengikuti konfigurasi suite.

## Code review

Review Standards dan Spec dilakukan oleh dua reviewer terpisah. Temuan tentang
atribusi penyusun, interpretasi diff invalid, prop tidak terpakai, pemulihan setelah
dialog ditutup, revisi kosong, dan penggunaan pemilik sesi di smoke telah diperbaiki.
Review ulang tidak menemukan blocker tersisa.
