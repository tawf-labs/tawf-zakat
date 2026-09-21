# Pemulihan pemegang sertifikat — #113

Mekanisme dan alasan: [ADR-0036](../adr/0036-custody-recovery-by-replacement-issuance.md).
Dokumen ini adalah bukti dan runbook, bukan bukti deployment pilot.

## Alur

1. Administrator institusi menetapkan pengendali baru (`setCustodian`) atau merotasi
   administrator registry. Sampai itu terjadi, tidak ada yang dapat dipulihkan (API 409).
2. Petugas dengan mandat `RECOVER_CERTIFICATE_CUSTODY` dan akun pengesah aktif memanggil
   `POST …/certificates/:id/recoveries {institutionId, decisionRef}`. Target dibaca dari kontrak.
3. Pengesah menandatangani `CustodyRecovery` (EIP-712) → `…/recoveries/:id/submit`; layanan
   memvalidasi via kontrak, menyimpan transaksi bertanda tangan (anggaran dan nonce yang sama
   dengan penerbitan) lalu menyiarkan. `retry` mengirim byte yang sama.
4. Status `PREPARED → SUBMITTED → INCLUDED → CONFIRMED` diturunkan ulang dari chain; hasil
   baru dinyatakan setelah konfirmasi. Verifier publik menampilkan `custody` (pemegang saat ini,
   token lama `REPLACED`, token aktif, apakah pemegang = pengendali institusi).

## Yang diuji

- `sc/test/DistributionCertificateNFT.t.sol` (31 tes): pengganti ke pengendali terselesaikan;
  transfer tetap terkunci; penandatangan palsu/dicabut, tanda tangan/aksi salah, replay,
  pengendali usang; hanya versi resmi terkini; koreksi setelah pemulihan; rotasi administrator.
- `backend/test/distribution_certificate_recovery.test.ts` (12 tes HTTP/SQL/EVM + smoke browser):
  mandat terpisah, pembaca dan lintas lembaga ditolak, dasar wajib, penerbit/isi/riwayat tak berubah,
  token lama utuh, replay, koreksi lalu pemulihan lagi, pengesahan usang tidak hidup kembali
  (pengendali diganti, mandat dicabut lalu diaktifkan), respons hilang + retry byte sama,
  reorg, integritas catatan, tanpa material rahasia pada respons. Smoke browser 1280→390 dengan
  CSS nyata: pengesahan usang ditolak, pemulihan baru ditandatangani, verifier menampilkan token lama dan pengganti.
- Suite penuh backend, `forge test --match-contract DistributionCertificateNFTTest`, typecheck backend/frontend.

## Perbaikan hasil code review

Pengesahan sekarang mengikat token asal, epoch custody, dan epoch administrator registry.
Rotasi bolak-balik atau penetapan ulang alamat yang sama tidak menghidupkan signature lama,
termasuk melalui kontrak langsung tanpa polling API. Status `voided` bersifat monoton di SQL,
termasuk saat attempt sudah tersimpan dan penulisan observasi bersaing. Intent kedaluwarsa
membutuhkan tinjauan baru; receipt kanonis yang sudah berhasil tetap terbaca setelah deadline.
UI mempertahankan riwayat sambil menyediakan pemulihan berikutnya dan mendahulukan intent
pending yang masih sah. Pembangunan transaksi issuance/recovery memakai satu helper gas/budget.

Bukti red/green: lima regresi kontrak gagal sebelum pemeriksaan epoch/token ditambahkan;
setelah perbaikan, **31 tes kontrak sertifikat lulus**. Suite recovery dengan browser aktif:
**13 lulus, 0 gagal, 0 skip, 202 assertion**. Smoke mencakup desktop/mobile berulang, tanpa
mandat, konflik persiapan, lost response dan retry byte identik, wallet tertunda setelah
rotasi, sesi akses berakhir, pemilihan pending di atas riwayat, serta verifier historis.
Tes juga menangkap regresi urutan key JSONB; domain deployment kini dibandingkan berdasarkan
nilai field, bukan urutan serialisasi. Typecheck backend/frontend lulus.
Suite backend penuh dengan browser aktif: **1.107 lulus, 0 gagal, 0 skip**, 10.069 assertion
pada 85 file (323,77 detik). Suite frontend penuh dengan browser aktif: **217 lulus, 0 gagal,
0 skip**. `git diff --check` juga lulus.
Suite Foundry penuh: **195 lulus, 0 gagal, 0 skip**, dengan
`FOUNDRY_INVARIANT_RUNS=128 FOUNDRY_INVARIANT_DEPTH=32 forge test` (fuzz tetap 256 run).
Run invariant default 256×500 dihentikan sebelum selesai karena biaya eksekusi; hasil
suite penuh yang diklaim adalah konfigurasi terbatas tersebut, bukan run default.
Review ulang terpisah Standards dan Spec: tidak ada temuan actionable baru.

Ulangi tes browser dari `backend/` atau `frontend/` dengan:

```sh
REGISTRY_BROWSER_MODULE=/absolute/path/to/playwright-core/index.mjs \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium bun test
```

## Runbook operator (tanpa secret)

- Tetapkan pengendali baru: administrator institusi mengirim
  `setCustodian(institutionId, alamatBaru)` ke kontrak sertifikat dari dompet/Safe-nya.
  Jangan simpan private key atau frasa pemulihan di tiket, log atau lingkungan layanan.
- Pastikan petugas memiliki mandat `RECOVER_CERTIFICATE_CUSTODY` dan akun pengesah aktif
  pada registry; cantumkan nomor surat keputusan sebagai dasar.
- Bila pengesahan usang (mandat, epoch pengendali/administrator atau token asal berubah), atau
  melewati deadline 600 detik, mulai persiapan baru dan tinjau ulang; jangan mencoba mengirim
  ulang tanda tangan lama. Mengembalikan alamat pengendali ke alamat sebelumnya tidak
  menghidupkan signature lama, termasuk melalui panggilan kontrak langsung.
- Bila respons pengiriman hilang, periksa status terlebih dahulu. "Kirim ulang transaksi tersimpan"
  hanya menyiarkan byte yang sama ketika konteks pengesahan masih sah; receipt transaksi yang
  sudah masuk chain tetap direkonsiliasi walaupun masa pengesahan kemudian berakhir.
- Pemulihan yang sudah selesai tetap menjadi riwayat. Bila pengendali berubah lagi, siapkan
  pemulihan berikutnya dari panel yang sama; tidak perlu menghapus pemulihan terdahulu.
- Batas operasional allocator tetap berlaku: transaksi tersimpan yang dropped/belum disiarkan
  dan sudah usang dapat menahan nonce relayer. Tidak ada fee bump/cancel otomatis; operator
  harus menyelesaikan nonce tersebut sebelum antrean berikutnya maju. Jangan menghapus baris
  nonce, mengganti byte tersimpan, atau menghidupkan pengesahan lama. Lihat
  [operasi relay](../design/evidence-recording-operations.md#api-dan-durability) untuk prinsip
  penyimpanan byte dan penanganan nonce yang sama.
- Anggaran layanan dan relayer sama dengan penerbitan; pastikan saldo/anggaran cukup.
- Kunci administrator hilang/terkompromi: di luar cakupan sertifikat; ikuti tata kelola registry.

## Batas rollout

Kontrak berubah lagi (wire format `CustodyRecovery`, pemeriksaan epoch/token asal dan ABI):
perlu deployment yang cocok serta persiapan/pengesahan baru. Kontrak yang sudah dideploy tidak
berubah oleh patch ini. Jangan menyalin signature lama atau menganggap token ID lintas
deployment identik. Tidak ada deployment, transaksi pilot, atau migrasi data pilot di sini.
Skema aditif `certificate_recoveries` tetap digunakan tanpa migrasi baru untuk perbaikan ini.
Tidak diuji: penerima kontrak pintar yang menolak mint, dan penetapan pengendali lewat UI.
