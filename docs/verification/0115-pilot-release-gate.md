# #115 — Gerbang verifikasi pilot terpadu

Tanggal: 2026-09-21. Baseline: `d94bc11234a97aa043809c3f6743fa0e7aa235bf`, branch `refine-ux`, ditambah perubahan #115 pada working tree. Tiket [#115](https://github.com/tawf-labs/zkt-hackathon/issues/115) mengimplementasikan gerbang [spec #100](../specs/pilot-distribution-zk-nft.md); [#110](0110-batch-correction-and-receipt-validity.md) adalah konteks koreksi batch, bukan parent spec.

## Keputusan rilis

**BLOCKED — #115 belum boleh ditutup sebagai pilot siap digunakan.** Hasil lokal bukan pengganti AC32–AC34. Tidak ada deployment, transaksi publik, pengiriman OTP nyata, pembacaan secret, migrasi DB operasional atau perubahan status issue pada pekerjaan ini.

- URL/build/chain/deployment pilot yang disepakati: **belum tersedia/diverifikasi**. URL historis dalam dokumen lama tidak otomatis menjadi target sekarang.
- Setup Groth16 yang dapat diterima untuk target: **belum tersedia**. Artefak saat ini setup lokal satu operator; RPC ZK aplikasi masih dibatasi loopback/Foundry. Kapasitas tree 16 receipt per batch harus dicocokkan dengan volume mitra.
- Provider kontak, role pengesah/validator/auditor, custodian, signer/nonce, konfirmasi, storage dan anggaran: **belum diverifikasi pada target**.
- Drill backup/restore SQL + ciphertext + kunci dan migrasi/rollback pada salinan PostgreSQL pilot: **belum dijalankan**. Restart PGlite/file recovery otomatis bukan penggantinya.
- SOP, mandat, kanal, volume, koneksi, output laporan dan anggaran mitra: **belum dikonfirmasi**.
- #116 (enumerasi referensi), #117 (reload/pageerror), #118 (Anvil tertinggal setelah terminasi) masih OPEN saat tracker dibaca. Review/disposisi sesuai cakupan target diperlukan; tidak ditutup oleh suite hijau.

Prosedur operator: [runbook rilis, backup/restore, migrasi dan rollback](../design/pilot-release-runbook.md). Runbook adalah langkah yang harus dijalankan, bukan klaim sudah dilaksanakan.

## Lingkup lokal dan batas bukti

Graphify yang sudah ada di `~/Dev/brain/projects/zkt-hackathon` ditelusuri dengan vocabulary `pilot`, `release`, `verification`, `correction`, `attestation`. Graph digunakan sebagai peta sumber; acceptance dan keputusan diverifikasi ke spec, ADR, kode/test, serta komentar #115. Tidak rebuild graph atau menganggap edge graph sebagai hasil tes.

Batas tes yang telah disepakati di #100: HTTP aplikasi dengan login/signature nyata, SQL terisolasi dan file terenkripsi, Groth16 sungguhan dan kontrak di Anvil lokal, plus browser sintetis. Transport OTP/keadaan lapangan tetap fixture. Existing journey #114 menelusuri kontribusi → alokasi → realisasi → sertifikat → laporan dengan sumber yang sama, tetapi seeding proposal/mandat bukan perjalanan UI approval end-to-end atau penerimaan mitra.

Tambahan #115: `backend/test/report_audit_correction_journey.test.ts`, perjalanan temuan → tanggapan amil → `BUTUH_KOREKSI_LAPORAN` → koreksi resmi dengan dua pengesahan → atestasi baru. Paket awal, opini lama dan temuan/event tetap utuh setelah SQL ditutup/dibuka kembali. Dokumen temuan, tanggapan amil dan atestasi diunduh byte-for-byte oleh pihak berwenang; unauthenticated ditolak dan amil tidak dapat membaca kertas kerja auditor. Koreksi berawal `NOT_EXAMINED` tanpa mewarisi opini pendahulu. Ini pembukaan ulang database/runtime, **bukan restart seluruh proses/OS**. Onboarding/mandat, nominal dan dokumen adalah fixture sintetis; report/finding/publication/attestation dibuat melalui HTTP, bukan row seed.

## Matriks AC01–AC34

Pemilik sesuai [peta tiket](../design/pilot-distribution-tickets.md#keterlacakan-spec-100). Semua baris juga menjadi tanggung jawab #115. Nama test berikut adalah stem file `.test.ts`, relatif terhadap `backend/test/` kecuali disebut lain. **Cakupan lokal** berarti suite menguji perilaku relevan, bukan sertifikasi bahwa seluruh AC atau deployment sudah diterima. Keberadaan nama suite tidak menggantikan hasil eksekusi di bagian berikut.

| AC | Pemilik fitur | Bukti lokal utama | Batas/gerbang tambahan |
| --- | --- | --- | --- |
| 01 | #87–93 | `disbursement_api`, `workspace_officer_api`, `workspace_mandate_api`, `disbursement_examination_api`, `disbursement_decision_api` | Baseline dipertahankan; approval journey #114 memakai seed. |
| 02 | #88, #92, #97 | `beneficiary_import_api`, `proposal_beneficiary_list_api` | 100 baris/7 error, exact amount, identity, re-upload/conflict. |
| 03 | #90, #91, #93 | `disbursement_decision_api`, `workspace_mandate_api` | Mandat/signature/identitas petugas uji, bukan SOP nyata. |
| 04 | #94, #95 | `disbursement_realization_api`, `disbursement_realization_goods_api` | Hak, concurrent HTTP, retry/restart; bukan stress test PostgreSQL produksi. |
| 05 | #94, #95, #97 | Realization IDR/barang, `proposal_beneficiary_list_api` | OTP transport fixture; BAST sintetis diperiksa petugas lain. |
| 06 | #94, #95 | Realization IDR/barang | Bukti kurang mengurangi hak; foto tidak otomatis menjadi konfirmasi. |
| 07 | #94, #95, #98, #107, #114 | Goods realization, `activity_reallocation_api`, `disbursement_realization_source_api`, `activity_trace_journey` | Valuasi hanya bila ada dasar; tidak menggandakan pembelian/penyerahan. |
| 08 | #102, #108, #109 | `contribution_api`, `contribution_zk_receipt` | Sumber/matching/endorsement bukan verifikasi bank independen. |
| 09 | #103, #107, #114 | `activity_allocation_api`, `activity_reallocation_api`, `activity_trace_api` | Pooled funding, tanpa donor-to-package fiktif. |
| 10 | #96, #106, #107, #110 | `contribution_correction_api`, `activity_reallocation_api`, `contribution_batch_correction` | Selisih 50.000 tidak menghapus actuals atau membuka tambahan. |
| 11 | #96, #106, #107 | `disbursement_revision_api`, reallocation/correction API | Penutupan hak, reallocation dan pembayaran refund terpisah. |
| 12 | #96, #106, #107, #110 | `contribution_correction_api`, `contribution_batch_correction` | Keputusan refund tidak sama dengan pembayaran actual. |
| 13 | #101, #104, #105, #114 | `public_verification`, `donor_otp_access_api`, `donor_recovery_api`, `activity_trace_api` | Otorisasi objek teruji; #116 enumerasi publik tetap risiko terbuka. |
| 14 | #104, #105 | `donor_otp_access_api`, `donor_recovery_api`, `email_transport` | Provider/real delivery dan kanal mitra belum diterima. |
| 15 | #92, #97–99, #101–105, #108–109, #111, #114 | Donor, contribution, ZK, certificate, reporting, trace suites | Redaction/allowlist bukan audit menyeluruh log dan bundle target. |
| 16 | #108, #110 | `contribution_zk_receipt`, `contribution_batch_correction`, `sc/test/ContributionProofRegistry.t.sol` | Real Groth16 + generated verifier; setup lokal saja. |
| 17 | #108, #110 | Suite ZK/registry yang sama | Root/receipt/institution/context salah ditolak, bukan pembuktian bank. |
| 18 | #108–110 | Suite ZK/registry yang sama | Reread/retry/reorg nyata lokal; nonce signer eksklusif masih prasyarat operasi. |
| 19 | #96, #99, #106, #110, #114 | Batch correction, contribution correction, audit findings, trace | Receipt tak berubah juga reproof; chain-only currentness `UNKNOWN`. |
| 20 | #101, #104, #108–110 | Public verification, donor OTP, receipt/correction suites | Pending/failed/unavailable bukan hijau; budget default nol. |
| 21 | #111 | `distribution_certificate_api`, `sc/test/DistributionCertificateNFT.t.sol` | Satu versi/token di EVM lokal, bukan deployment pilot. |
| 22 | #111, #113 | `distribution_certificate_recovery`, kontrak NFT | Recovery replacement issuance, bukan transfer atau admin-key recovery. |
| 23 | #96, #99, #111–114 | Certificate API/correction/recovery; `frontend/test/certificate-verifier-browser.test.ts` | ABI/domain/epoch target harus cocok #113. |
| 24 | #94–96, #98–99, #112, #114 | Realization, certificate correction, source dan trace journey | Sengketa lapangan masih sintetis. |
| 25 | #94–95, #98, #107, #111–112, #114 | Certificate API/correction, trace API/journey/browser | Dana/realisasi/konfirmasi/publikasi terpisah; pending nonce perlu operator. |
| 26 | #96–99, #112, #114 | `disbursement_realization_source_api`, revision/correction/trace | Status konfirmasi/sengketa dibekukan saat freeze, bukan rekonstruksi as-of cut-off. |
| 27 | #88, #98, #101, #114 | `evidence_api`, `disbursement_realization_source_api`, `registry_api`, `sc/test/ReportPublication.t.sol` | Dua endorsement nyata lokal; journey #114 sendiri tidak memublikasikan laporan. |
| 28 | #99, #112 | `report_audit_findings_api`, `report_audit_correction_journey` (#115), certificate correction | Tambahan #115 menghubungkan temuan sampai koreksi/atestasi; lihat hasil aktual. |
| 29 | #87, #90, #92–94, #97, #99, #101–106, #109, #111, #113–114 | Workspace/session/feature HTTP; `browser_storage_lifecycle`; frontend donor-session browser | Isolasi/revocation/stale response bukan hanya tombol tersembunyi. |
| 30 | #94–95, #99, #101, #104–105, #108–114 | Browser opt-in di suite backend, trace journey; frontend `*browser.test.ts` | Chromium harus aktif, bukan silent skip; smoke entry bukan navigasi deployed lengkap. |
| 31 | #98 | `usdc_deposit_intake`, `usdc_deposit_store`, `usdc_deposit_pipeline`, `evidence_internal_usdc_api`, `proposal_amount` | Native USDC/event identity tidak dikonversi ke IDR/beneficiary rekaan. |
| 32 | #115 | `reconciliation_api` memastikan `668020210274`; `period_report_api` menolak draf salah; journey lokal | **BLOCKED:** actual URL/build, secrets/provider/storage/authority/budget dan navigasi deployed belum diperiksa. |
| 33 | #108–109, #111, #113, #115 | Artefak/toolchain di bawah, runbook rilis, #108–113 | **PARTIAL/BLOCKED:** belum ada manifest deployment pilot, gas/konfirmasi target dan drill restore/migrasi. |
| 34 | #115 | Daftar prasyarat dan runbook | **BLOCKED:** persetujuan/data/SOP mitra bukan hasil fixture otomatis. |

## Pengujian sesi ini

| Pemeriksaan | Hasil |
| --- | --- |
| `bash sc/circuits/compile.sh` | PASS, semua enam checksum artefak pinned cocok; tidak regenerasi setup. |
| `cd backend && bun run build` | PASS, server/indexer serta runner Node tersalin. Bukan verifikasi packaging pilot. |
| Backend LPZN/validator/draft/USDC/proposal subset (5 file) | 67 pass, 0 fail. LPZN total dan validator lokal, bukan URL target. |
| Frontend `bun test` dengan browser diaktifkan | 220 pass, 0 fail; termasuk browser sertifikat dan sesi donor. |
| Frontend `bun run typecheck` | PASS. |
| Frontend `bun run build` | PASS, termasuk SSR smoke bawaan; warning ukuran chunk muncul. |
| Backend tambahan audit correction journey (setelah perbaikan review) | **1 pass, 0 fail, 134 assertion**, 2,42 detik; typecheck ulang PASS. |
| Backend full suite dengan browser + typecheck | **1.123 pass, 0 fail**, 88 file, 10.471 assertion, 330,30 detik; typecheck PASS. Run ini sebelum polish fixture/path/cleanup dan tambahan assertion lampiran; perubahan terakhir diverifikasi ulang terarah pada baris di atas. |
| Foundry full default | **195 pass, 0 fail, 0 skipped**, 19 suite, 323,96 detik. Run pertama terkena timeout harness 120 detik; rerun lengkap selesai dengan waktu 900 detik, tanpa mengurangi fuzz/invariant (256 run dengan total 128.000 calls per invariant suite). |
| Code review Standards/Spec | Dua reviewer independen + recheck. **Standards PASS:** parent scratch, URL path dan exceptional cleanup diperbaiki (3 temuan selesai). **Spec PARTIAL:** celah assertion lampiran selesai; satu blocker rilis AC32–34 tetap. Tidak ada defect lokal terbuka dari review ini. |
| PostgreSQL contention independen dan restore pilot | NOT RUN; DB operasional tidak digunakan. |
| Smoke aplikasi/API pilot dan OTP/provider nyata | NOT RUN; target dan izin tidak tersedia. |

Perintah subset yang sudah berjalan:

```sh
cd backend
bun test test/reconciliation_totals.test.ts test/period_report_draft_api.test.ts test/report_validator.test.ts test/usdc_deposit_pipeline.test.ts test/proposal_amount.test.ts
```

Reproduksi full backend (dari root repo; `BROWSER_MODULE` harus menunjuk instalasi Playwright Core yang tersedia):

```sh
BROWSER_MODULE="$PWD/.scratch/issue113-review-tools/node_modules/playwright-core/index.mjs"
cd backend
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 \
  REGISTRY_BROWSER_MODULE="$BROWSER_MODULE" \
  REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
  bun --no-env-file test
bun --no-env-file run typecheck
```

Jalankan suite backend serial, tidak bersamaan dengan suite lain yang memakai port Anvil tetap. Preload `backend/test/setup.ts` wajib aktif; `--no-env-file` dan allowlist environment menghindari konfigurasi operasional shell. File test baru menggunakan port OS dinamis dan lokasi scratch workspace sendiri. Kontrak harus sudah dibangun dengan `cd sc && forge build`; `forge test` memakai default invariant penuh, sehingga batas waktu 120 detik tidak cukup pada mesin sesi ini.

Browser memakai Playwright Core yang sudah tersedia pada `.scratch/issue113-review-tools/node_modules/playwright-core/index.mjs` dan `/usr/bin/chromium`. Lokasi ini **prasyarat lokal, bukan dependency portabel yang sudah dipaketkan**. Jangan menganggap suite yang tidak mengatur `REGISTRY_BROWSER_MODULE` sudah mencakup browser. Proses test membaca fixture sintetis; jangan membawa secret/provider produksi ke lingkungan pengujian.

## Toolchain dan artefak lokal terukur

Bun `1.4.2`; Node `v25.2.1`; Forge `1.7.1-monad-v1.0.0` (`bb49277de2e0979b9d37dc0e5f7f18f24b0262b8`); compiler Solidity `0.8.31+commit.fd3a2265`, optimizer 1 run, via IR (`sc/foundry.toml`). Pipeline pinned #108 memakai Circom `2.2.3`, snarkjs `0.7.6`, circomlib `2.0.5`/circomlibjs `0.1.7`; compiler circuit tidak diregenerasi pada sesi ini.

Enam hash circuit/witness/verifier/fixture tervalidasi oleh [`sc/circuits/artifacts.sha256`](../../sc/circuits/artifacts.sha256). Groth16 key dan WASM harus dipaketkan bersama runner serta generated verifier yang cocok, bukan mengambil verifier dari deployment lama.

Berikut hasil pembacaan artefak Foundry lokal. `runtime template` belum substitusi immutable constructor, **bukan hash `eth_getCode` alamat yang sudah dideploy**. Setiap ukuran di bawah 24.576 byte, tetapi itu tidak membuktikan deployment/fork target kompatibel.

| Kontrak | Runtime template bytes | SHA-256 runtime template |
| --- | ---: | --- |
| Groth16Verifier | 1.752 | `9bbe2b6f93616c5e3095b7edf784d617ee17cc7a38cb37fb6fc7380d24660397` |
| ContributionProofRegistry | 5.262 | `372ec53a27a31c6c55ff9073a90df025942f5012ecd11c6d0393fa754e8196eb` |
| DistributionCertificateNFT | 12.976 | `279ad67bf697555d115155d71421ac2cfc62f3a5280b8c3788dcf350cc444f84` |
| ReportEvidenceRegistry | 21.013 | `e33c5e21769461514b36d3a3965cf4c21ddf1e83ca5d35a58ad37380d98920e7` |

Pengukuran ulang lokal dari `contribution_zk_receipt.test.ts` pada sesi ini: deployment verifier **432.065 gas**, registry **1.196.246 gas**, dan receipt `verifyAndRecordReceiptProof` **467.326 gas** (`getTransactionReceipt(...).gasUsed`, bukan total gas test). Ukuran runtime yang dibaca dari EVM cocok tabel: 1.752 dan 5.262 byte. Angka ini menggunakan transaksi/kontrak Anvil aktual pada fixture sintetis, **bukan biaya atau pengukuran jaringan pilot**.

Ukuran/gas proof historis #108: 256 byte proof, 5 public inputs, estimasi publish 448.862 dan reread 279.419 gas, dengan domain/artefak sebelum perubahan #110. Ini **bukti historis**, bukan pengukuran ulang. Gas per-test Foundry mencakup operasi tes dan tidak boleh disebut gas transaksi publication. Pengukuran RPC/receipt NFT dan deployment pilot, proof latency/capacity, konfirmasi, fee cap dan anggaran nyata masih wajib dilengkapi untuk AC33.

## Paket bukti yang masih harus diberikan operator

Simpan lampiran terbatas (tanpa mengunggah isi PII ke repo): manifest URL/build/chain/alamat/blok/role/kebijakan konfirmasi, hash actual deployed code, provider readiness, anggaran/nonce owner, pengukuran gas dan volume, arsip hasil smoke yang disanitasi, hasil backup+restore+migrasi pada salinan, keputusan risiko #116–118, serta persetujuan mitra AC34. Referensi dan status nonrahasia boleh masuk tiket #115 setelah ditinjau pemilik.

Belum ada persetujuan rilis, commit/push, ataupun penutupan issue dari bukti lokal ini.
