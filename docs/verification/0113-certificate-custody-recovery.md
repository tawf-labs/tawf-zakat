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

- `sc/test/DistributionCertificateNFT.t.sol` (24 tes): pengganti ke pengendali terselesaikan;
  transfer tetap terkunci; penandatangan palsu/dicabut, tanda tangan/aksi salah, replay,
  pengendali usang; hanya versi resmi terkini; koreksi setelah pemulihan; rotasi administrator.
- `backend/test/distribution_certificate_recovery.test.ts` (7 tes HTTP/SQL/EVM + smoke browser):
  mandat terpisah, pembaca dan lintas lembaga ditolak, dasar wajib, penerbit/isi/riwayat tak berubah,
  token lama utuh, replay, koreksi lalu pemulihan lagi, pengesahan usang tidak hidup kembali
  (pengendali diganti, mandat dicabut lalu diaktifkan), respons hilang + retry byte sama,
  reorg, integritas catatan, tanpa material rahasia pada respons. Smoke browser 1280→390 dengan
  CSS nyata: pengesahan usang ditolak, pemulihan baru ditandatangani, verifier menampilkan token lama dan pengganti.
- Suite penuh backend, `forge test --match-contract DistributionCertificateNFTTest`, typecheck backend/frontend.

## Runbook operator (tanpa secret)

- Tetapkan pengendali baru: administrator institusi mengirim
  `setCustodian(institutionId, alamatBaru)` ke kontrak sertifikat dari dompet/Safe-nya.
  Jangan simpan private key atau frasa pemulihan di tiket, log atau lingkungan layanan.
- Pastikan petugas memiliki mandat `RECOVER_CERTIFICATE_CUSTODY` dan akun pengesah aktif
  pada registry; cantumkan nomor surat keputusan sebagai dasar.
- Bila pengesahan usang (mandat/pengendali berubah), mulai persiapan baru; jangan mencoba
  mengirim ulang tanda tangan lama. Kegagalan RPC: gunakan "Kirim ulang transaksi tersimpan".
- Anggaran layanan dan relayer sama dengan penerbitan; pastikan saldo/anggaran cukup.
- Kunci administrator hilang/terkompromi: di luar cakupan sertifikat; ikuti tata kelola registry.

## Batas rollout

Kontrak berubah lagi (fungsi/event/error baru, ABI diekspor ulang): perlu deployment baru;
tidak ada deployment atau transaksi pilot di sini. Skema aditif `certificate_recoveries`.
Tidak diuji: penerima kontrak pintar yang menolak mint, dan penetapan pengendali lewat UI.
