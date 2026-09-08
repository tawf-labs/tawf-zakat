# Pengelolaan otoritas — demo lokal ticket #77

Jalankan dari root repo. Semua akun dalam fixture pengujian sintetis; Anvil memakai
port loopback 18572 dan PostgreSQL sementara PGlite. Tidak memakai key mitra,
RPC produksi, atau data lembaga sungguhan.

```bash
forge build --root sc
python3 scripts/export-registry-abi.py
(cd backend && bun test test/workspace_api.test.ts)
(cd backend && bun test test/registry_api.test.ts)
forge test --root sc --match-contract 'ReportAuthorityTest|ReportAttestationTest'
```

`keeps a published version readable after rotation...` menerbitkan paket dalam
fixture, menyiapkan signature untuk publikasi berikutnya, mencabut lalu mengaktifkan
alamat pengesah yang sama, dan membuktikan signature tertunda ditolak sementara
ringkasan publik versi terbit tetap dapat dibaca. Kasus mandat auditor menunjukkan
signature epoch lama ditolak dan mandat pada atestasi diterima tetap tersimpan.
Kasus ERC-1271 memeriksa state wallet saat eksekusi; pemeriksaan riwayat tidak
meminta wallet saat ini mengesahkan ulang signature historis.

Untuk menjalankan pemeriksaan browser yang sudah tersedia, set
`REGISTRY_BROWSER_MODULE` ke module Playwright lokal sebelum menjalankan test API.
Opsional `REGISTRY_BROWSER_EXECUTABLE` memilih Chromium yang sudah terpasang.

## Alur aplikasi

Di ruang kerja, buka **Pengelolaan otoritas dan akses**. Lihat pelaku dan lembaga,
masukkan akun sasaran, lalu **Periksa otoritas live**. Snapshot menyebut blok,
role dan epoch. Pilih pengesah, validator, auditor beserta mandat, atau usulan/
penerimaan administrator. **Siapkan perubahan** memeriksa kontrak menggunakan
akun sesi sebagai pelaku. Tinjau perubahan, setujui checkbox, ganti jaringan bila
perlu, lalu kirim melalui wallet. Akun Safe dapat mengeksekusi calldata yang sama
dari Safe pemegang role. Hash yang belum diperiksa bukan bukti penerimaan.

Masukkan hash eksekusi pada **Periksa receipt kanonik**. Receipt menampilkan event,
blok, jumlah konfirmasi dan keadaan INCLUDED/CONFIRMED. Baca ulang receipt bila
terjadi reorg. Riwayat registry dibaca per halaman maksimum 2.000 blok; mulai pada
blok deployment untuk registry berumur panjang. Event AuthorityChanged merekam
scope, role, akun, pelaku, epoch akun, epoch pengelola dan mandat. Interval historis
bermula pada posisi blok/log event dan berakhir pada perubahan berikutnya untuk
role/akun yang sama. Usulan, pembatalan (alamat nol), dan penerimaan juga
disertakan; event penerimaan menyebut pengusul sebelumnya beserta epochnya dan
penerus beserta epoch barunya. Pelaku penerimaan bertindak dengan epoch baru. Validator dan operatornya memiliki scope global layanan;
pengesah dan auditor memiliki scope lembaga. Administrator lembaga mengelola
mandat auditor, bukan operator teknis. Pengelola tidak otomatis menjadi pengesah.

Rotasi administrator registry dan operator validator memakai dua transaksi:
usulan oleh pemegang kewenangan saat ini, lalu penerimaan oleh alamat penerus.
Alamat nol pada usulan membatalkan usulan tertunda. Penerus belum memiliki hak
pengelolaan sebelum penerimaan. Admission hanya melakukan onboarding lembaga;
tidak memiliki override administrator lembaga atau operator validator setelah
serah-terima. Setiap perubahan pengesah/validator/auditor menaikkan epoch, termasuk
regrant alamat yang sama. UI memeriksa ulang signing tertunda setiap empat detik,
sebelum membuka wallet, dan backend/kontrak memeriksa kembali ketika dikirim.
Mulai tinjauan baru untuk mendapatkan epoch dan nonce baru.

## Akses dokumen dan administrator ruang kerja

Bagian **Akses ruang kerja** terpisah dari registry. Administrator dapat mencabut
anggota non-admin. Keanggotaan dinonaktifkan, seluruh sesi akun pada lembaga itu
dicabut atomik, dan catatan pelaku/perubahan/waktu ditambahkan. Unduhan berikutnya,
termasuk URL lama dengan sesi lama, ditolak. Regrant tidak menghidupkan sesi lama.
Salinan yang sudah diunduh tidak dapat dihapus dari perangkat pembaca.

Penerus administrator ruang kerja harus sudah merupakan anggota aktif lembaga:
beri akses OFFICER/READER lewat `POST /api/workspace/members` bila diperlukan.
Administrator memakai **Usulkan administrator ruang kerja**; penerus masuk dengan
akunnya sendiri dan memakai **Terima usulan sebagai akun sesi**. Penerimaan
memeriksa ulang administrator pengusul, mengubah penerus menjadi ADMIN dan
administrator lama menjadi READER, lalu mengakhiri sesi keduanya. Masuk ulang.
Riwayat dan usulan dapat dibaca di panel. Hak ruang kerja tidak pernah memberikan
hak tanda tangan registry. Lakukan kedua serah-terima jika kedua scope diperlukan.

## Pemulihan

Jika satu administrator masih berwenang, gunakan jalur usulan/penerimaan biasa.
Jika Safe masih dapat memenuhi threshold, pulihkan pemilik melalui prosedur Safe
lalu perbarui mandat registry agar semua material epoch sebelumnya kedaluwarsa.
Jika seluruh otoritas hilang, hentikan tindakan baru; simpan receipt, riwayat,
dan bukti akses. Pemulihan membutuhkan verifikasi mandat lembaga dan keputusan
operasional tersendiri; aplikasi tidak menyediakan backdoor atau bypass
pengesahan penerbitan. Registry lama tetap menjadi arsip yang dapat diperiksa.

Perubahan kontrak ini belum dideploy. Registry immutable yang sudah terpasang tidak
memperoleh ABI baru secara otomatis; demo memakai deployment lokal baru. Jangan
mengganti alamat deployment aktif tanpa rencana migrasi terpisah.

## Hasil verifikasi

- HTTP registry/ruang kerja beserta lima smoke Chromium: **76 lulus, 0 gagal**.
- Tes frontend: **133 lulus, 0 gagal**; build frontend lulus.
- Tes ABI registry setelah perbaikan review: **80 lulus, 0 gagal**.
- Seluruh suite Foundry: **150 lulus, 0 gagal** dengan
  `FOUNDRY_INVARIANT_RUNS=64 FOUNDRY_INVARIANT_DEPTH=128 forge test --root sc`.
  Run default dihentikan setelah lebih dari sembilan menit; dua invariant
  pemeriksaan seluruh riwayat belum selesai. Konfigurasi repo tidak diubah.
- Typecheck dibandingkan commit awal `0f07d83`: tidak ada error baru; baseline
  masih mempunyai 136 diagnosis frontend dan 13 backend (pesan unik).
- Seluruh suite backend dijalankan. Dua puluh kegagalan legacy direproduksi pada
  commit awal; satu assertion demo tentang jumlah konfirmasi kemudian diperbaiki
  agar membandingkan isi dan blok penerimaan yang tetap, dan tes terkait lulus.
- Review Standards dan Spec selesai; temuan tipe aksi dan atribusi epoch
  penerimaan telah diperbaiki dan direview ulang tanpa temuan tersisa.
