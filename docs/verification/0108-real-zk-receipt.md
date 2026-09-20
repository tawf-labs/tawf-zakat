# #108 — receipt kontribusi dengan Groth16 nyata

Tracer lokal: kontribusi #102 dicatat → dicocokkan → disahkan; petugas bermandat
membentuk snapshot batch → mengesahkan root → memproses proof; generated verifier
menerima proof pada Anvil dan registry mencatat hasil sekali per versi receipt.
Halaman verifikasi publik dan rincian donatur menggunakan hasil ini. Pemeriksaan
ulang membaca EVM tanpa wallet, tanpa mengonsumsi hak atau membuat transaksi.

## Pernyataan dan batas trust

Circom 2.2.3, circomlib 2.0.5, circomlibjs 0.1.7, snarkjs 0.7.6; Groth16 BN254,
Poseidon, kedalaman pohon 4 (maksimum 16 catatan). Prover memakai Node 25.2.1;
API/test Bun 1.3.6. Solidity 0.8.31, optimizer 1, via IR. Pengukuran memakai
Foundry 1.7.1-monad-v1.0.0, commit bb49277de2e0979b9d37dc0e5f7f18f24b0262b8.

Public signals, urut persis:

1. `batchRoot`.
2. `receiptCommitment = Poseidon(institutionKey, contributionIdHash, leaf)`.
3. `institutionKey = keccak256(institutionId) mod Fr`.
4. `contributionIdHash = keccak256(abi.encode("ZKT_CONTRIBUTION_MEMBERSHIP_V1", contributionId, batchNumber, batchVersion, receiptVersion)) mod Fr`.
5. Indeks jenis dana: ZAKAT=0, FITRAH=1, INFAK_SEDEKAH=2, KURBAN=3, DSKL=4.

`leaf = Poseidon(context, amount, salt, fundType, purposeHash)`; amount, random
256-bit salt direduksi ke Fr, purposeHash, path dan arah sibling privat. Nominal
harus positif dan lebih kecil dari Fr. Tujuan terikat pada leaf/root; donor identity
tidak diperlukan circuit. ID kontribusi merupakan UUID opaque, bukan nama atau
referensi bank. Root disahkan akun relay yang diotorisasi registry lembaga;
pengesahan petugas dan mandatnya dicatat terpisah dalam SQL. Bukti matematis tidak
membuktikan pembayaran bank, kelengkapan pemasukan, atau penyerahan bantuan.

Witness disimpan dalam SQL privat dan hanya dipakai pemroses berwenang; operator
SQL/prover dipercaya (ADR-0034 Q20). File sementara berada dalam direktori 0700,
input 0600, dibuang setelah proses selesai; error tidak mengembalikan stderr/witness.
Publik hanya membaca proyeksi tanpa donor, nominal, source reference atau path.

**Setup ini hanya lokal, belum aman untuk produksi.** Setup fase 1 dan 2 baru
menggunakan entropy acak pada satu mesin/operator. Tidak ada upacara multipihak
atau klaim penghancuran toxic waste yang dapat diaudit. Pasangan WASM/zkey,
verification key, generated Solidity verifier dan fixture synthetic dipin bersama
melalui `sc/circuits/artifacts.sha256`. Jangan memakai angka/setup ini untuk
mengklaim kesiapan pilot produksi. Koreksi batch/recovery antrean masuk #109/#110.

## Reproduksi

Dari root repo:

```sh
(cd backend && bun install --frozen-lockfile)
sc/circuits/compile.sh                 # verifikasi checksum pasangan yang dipin
forge build --root sc
(cd backend && bun test test/contribution_zk_receipt.test.ts)
forge test --root sc --match-contract ContributionProofRegistryTest -vv
```

Test API menjalankan Anvil loopback port 18596, SQL PGlite terisolasi (opsional
`DONOR_ACCESS_TEST_DATABASE_URL` untuk PostgreSQL), signature EIP-712 sungguhan,
proof sungguhan, dan transaksi verifier. Tidak membutuhkan private key produksi.
`sc/circuits/compile.sh --new-local-setup` membuat pasangan baru dengan versi
compiler/Node yang diperiksa, memverifikasi zkey, mengekspor verifier dan meregenerasi
fixture Solidity serta checksums. Ini rotasi setup, bukan regenerasi byte-identik:
setelahnya wajib rebuild kontrak, redeploy dan rerun tests. Jangan mencampur versi.

Untuk aplikasi yang dijalankan terpisah: mulai Anvil chain 31337, sediakan akun
uji lokal yang didanai melalui `ZK_RELAY_PRIVATE_KEY`, `ZK_RPC_URL` loopback, serta
`ZK_INSTITUTION_ID` yang sama dengan SQL. Jalankan
`bun backend/src/scripts/zk-deploy-local.ts`, gunakan `ZK_REGISTRY_ADDRESS` hasilnya,
dan jalankan backend dengan konfigurasi workspace/SQL biasa. Script tidak mencetak
private key. `ZK_RPC_URL`, `ZK_REGISTRY_ADDRESS`, `ZK_RELAY_PRIVATE_KEY` harus lengkap;
tanpanya operasi pengesahan/proof menolak 503. Prover memerlukan folder `sc/circuits`
dan output `sc/out` pasangan ini pada deployment aplikasi, termasuk ketika menjalankan
`backend/dist/index.js`. Build menyalin runner Node ke dist.

Endpoint petugas memakai session bertanda tangan dan mandat operasional:

- POST `/api/workspace/contribution-batches`: institutionId, contributionIds, fundType, currencyUnit.
- POST `/api/workspace/contribution-batches/:id/endorse`: institutionId; mandat ENDORSE_CONTRIBUTIONS.
- POST `/api/workspace/contribution-batches/:id/proofs/:contributionId/process`: institutionId; mandat RECORD_CONTRIBUTIONS.
- GET `/api/public/receipt-verification/:contributionId`: ID opaque kuitansi, bukan referensi bank.

Public `recordedStatus` adalah riwayat SQL; `status=UNCONFIRMED` jika RPC tidak dapat
mengonfirmasi atau tuple EVM berbeda. `SUPERSEDED` dipakai hanya jika memang ada
proof versi terdahulu. Hasil konfirmasi memerlukan root, commitment, batch dan blok
yang cocok. Pemeriksaan memakai generated verifier bytecode yang sama dengan build.

## Verifikasi dan pengukuran lokal

Generated verifier runtime **1.752 byte**, deployment **432.065 gas**; registry
runtime **3.541 byte**, deployment **823.507 gas**. Satu verifikasi receipt pada
tracer API sekitar **438.600 gas** (calldata proof acak mengubah gas beberapa puluh).
Angka adalah gas terukur pada EVM lokal, bukan harga fiat atau estimasi L2 produksi.
Konfirmasi: satu inclusion sukses pada Anvil, tanpa klaim finalitas produksi.

Cakupan test: sumber belum disahkan ditolak; proof sah; root tak berwenang;
statement/receipt/lembaga/batch/versi salah; amount/purpose/witness/proof diubah;
verifier bytecode tidak cocok; proving gagal; RPC tidak tersedia; retry identik dan
klaim SQL konkuren; recovery transaksi yang sudah tercatat; lookup batch berbeda;
receipt tanpa proof; public read tanpa data privat.

Browser smoke opt-in memakai harness `frontend/test/verification-smoke.tsx` dan
API/SQL/EVM yang sama:

```sh
cd backend
REGISTRY_BROWSER_MODULE=/absolute/path/to/playwright-core/index.mjs \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/contribution_zk_receipt.test.ts
```

Ukuran 1280×900 dan 390×844: periksa proof publik, masuk OTP, lihat kontribusi,
lihat hasil ZK, periksa ulang; jumlah transaksi relay tetap. Screenshot disimpan
ke `/tmp/issue108-receipt-{1280,390}.png`. Hasil proof sukses berasal dari API/EVM
asli; regresi kegagalan jaringan memakai request abort dan respons HTTP 503.

## SQL, rollout dan handoff #109

Tiga tabel baru dibuat secara additive oleh `ensureSchema`: batches, items/witness,
receipt proofs. Unique index `(contribution_id, version)` mencegah dua hasil resmi
lintas batch. Sebelum rollout, backup SQL secara privat (termasuk witness), hentikan
proses proof, verifikasi checksum, build/deploy pasangan kontrak, set konfigurasi,
tunggu schema siap, dan jalankan tracer. Index menolak data lama yang sudah duplikat;
jangan menghapus atau memilih duplikat diam-diam. WIP sebelum versi ini bukan format
receipt yang kompatibel karena context binding telah diperketat.

Rollback: nonaktifkan pemrosesan baru/relay, pulihkan aplikasi dan konfigurasi pasangan
sebelumnya bersama backup SQL yang sesuai; pertahankan tabel baru dan history.
Transaksi yang telah tercatat tidak dapat di-rollback dengan menghapus SQL.
Tidak ada reset/drop tabel atau migrasi data produksi otomatis dalam tiket ini.

#109 perlu budgeting, antrean, batas concurrency lintas receipt, job lease/recovery
PROVING setelah crash, penyimpanan pasangan deployment per receipt, reorg/finality,
monitoring serta backup restore drill. Retry setelah receipt EVM ada membaca event
asal dan tidak mengirim ulang; timeout sebelum inclusion dan recovery proses mati
masih memerlukan koordinasi operasi. #110 menangani koreksi/re-endorsement batch;
tracer menolak pemrosesan snapshot yang telah berubah.

## Hasil validasi 2026-09-20

- Backend full suite: **1.026 pass, 27 skip, 0 fail** (1.053 test / 80 file).
- Frontend full suite: **216 pass, 0 fail**; typecheck dan build lulus.
- Backend build lulus. Typecheck masih **22 diagnostic**, identik dengan checkout
  `HEAD` sebelum implementasi; tidak ada diagnostic tambahan dari perubahan #108.
- Test #108 dengan browser aktif: **5 pass, 0 fail, 89 assertions**.
- Kontrak #108: **10 pass, 0 fail**; dua reviewer standards/spec tidak menemukan
  blocker tersisa setelah perbaikan. Generated Solidity dipertahankan persis output
  snarkjs, termasuk whitespace generator, agar checksum pasangan mudah diaudit.
- Solidity full suite: **160 pass, 0 fail, 0 skip**, termasuk seluruh invariant
  (18 suite, 363 detik). Script deploy lokal juga berhasil diuji dengan akun
  sementara pada Anvil terpisah; gas deployment cocok dengan hasil integrasi.

## Perbaikan setelah code review 2026-09-20

- Halaman donatur memeriksa EVM saat dibuka. Status VERIFIED historis dari SQL
  tidak menjadi konfirmasi saat ini; pemeriksaan awal/ulang yang gagal menampilkan
  belum terkonfirmasi, dengan referensi transaksi historis tetap tersedia.
- Panel proof memakai TanStack Query dengan identitas kontribusi/versi, label
  operasional, serta rincian teknis yang tertutup secara default. Proyeksi SQL
  daftar/detail batch memakai mapper yang sama.
- Frontend: **216 pass, 0 fail**, typecheck lulus. Integrasi #108 dengan browser
  desktop/ponsel: **5 pass, 0 fail, 107 assertions**, termasuk kegagalan awal,
  kegagalan pemeriksaan ulang karena jaringan/HTTP, pemulihan status setelah
  pemeriksaan berhasil, dan jumlah transaksi relay yang tidak bertambah.
- Full suite backend/Solidity dan build di bagian sebelumnya merupakan hasil
  validasi implementasi awal, bukan pengujian ulang setelah perbaikan review.
