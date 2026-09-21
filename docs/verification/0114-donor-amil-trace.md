# Penelusuran donatur dan rekap amil dari sumber yang sama — #114

Mengimplementasikan #114 terhadap spec #100. Tiket ini hanya membaca dan memproyeksikan;
alokasi (#103/#107), prover dan batch (#108–#110), realisasi (#94/#95), snapshot laporan
(#98) dan NFT (#111–#113) tetap dimiliki tiket masing-masing. Dokumen ini menjelaskan
kebijakan dan batas pemeriksaan, bukan bukti deployment pilot.

## Satu sumber, dua pembaca

`backend/src/activity-trace.ts` membangun `ActivityTrackView` untuk satu kegiatan. Donatur
(`GET /api/donor/contributions/:id/trace`, sesi OTP #104) dan amil
(`GET /api/workspace/activities/:id/trace`, sesi ruang kerja) memakai fungsi yang sama,
jadi identitas kegiatan (`activityId`, `proposalId`, `proposalVersion`, versi kegiatan) dan
angka dana/penyaluran/konfirmasi identik. Tes membandingkan keduanya secara langsung.

Angka tidak dihitung ulang dari jumlah NFT atau proof: dana dari akuntabilitas kegiatan
(#107), penyerahan dan konfirmasi dari catatan realisasi, NFT dari status sertifikat (#111/#112).

## Track terpisah

Setiap track berbentuk `OK` + data atau `UNAVAILABLE` + alasan. Sumber yang gagal dibaca
tidak pernah menjadi angka nol atau status sukses.

| Track | Sumber | Catatan |
| --- | --- | --- |
| Progres penyaluran | realisasi + ringkasan bantuan per satuan | barang tidak dijumlahkan ke rupiah |
| Dana dan pertanggungjawaban | `calculateActivityAccountability` | uang muka, kekurangan alokasi, kelebihan komitmen |
| Konfirmasi dan sengketa | `confirmationStatus` realisasi | terpisah dari progres |
| NFT distribusi | `line` + `publicSummary` per garis sertifikat | percobaan disiapkan/pending/gagal terpisah dari versi terbit; issuer, digest dan tautan versi tepat |
| Pengembalian (donor) | lifecycle refund kontribusi pada sesi | keputusan, pembayaran dan pembatalan berbeda; rincian pembayaran privat tidak dibuka |
| Bukti kontribusi (donor) | catatan proof + versi kontribusi | keberlakuan chain tetap di verifier `/api/public/receipt-verification/:id` |

`deliveryHeadline` menyatakan "seluruh paket diserahkan" hanya sebagai
`DELIVERED_WITH_OPEN_ITEMS` bila masih ada uang muka belum dipertanggungjawabkan, sengketa,
konfirmasi tertunda, publikasi NFT tertunda, atau sumber yang tidak terbaca.
`DELIVERED_AND_SETTLED` hanya bila tidak ada yang terbuka.

## Batas klaim (dikirim bersama proyeksi)

- Pooled funding: kontribusi tidak dinyatakan membiayai paket atau penerima tertentu.
- Receipt ZK bukan bukti fisik penerimaan bantuan.
- NFT tahap bukan laporan periode dua pengesahan dan tidak menjamin isi masih berlaku.
- Snapshot laporan bersifat historis dan tidak menggantikan status kegiatan terkini.

## Donatur

- Hanya alokasi milik kontribusi pada sesi; angka kegiatan bersifat agregat dan jumlah
  alokasi gabungan tampil sebagai `pooledAllocationCount`. Identitas donatur lain, penerima,
  locator berkas dan material privat proof tidak muncul. Alamat issuer NFT memang publik.
- `allocationBasis = BEFORE_CORRECTION` bila alokasi dibuat pada versi kontribusi lebih lama
  dari versi kini; `proofMatchesContributionVersion = false` bila proof tercatat untuk versi lama.
- Pengalihan (#107) atas dana kontribusi ini tampil sebagai `changes` (jumlah, nama kegiatan
  tujuan, waktu, alasan). Koreksi kontribusi (#106) tampil dari riwayat koreksi yang sudah ada.
  Refund ditampilkan melalui track tersendiri; kegagalan membacanya bukan daftar kosong.
- Sesi satu kontribusi tidak membuka kontribusi lain (403), tanpa sesi 401, sesi operator
  bukan sesi donatur. Penolakan 401/403 pada refresh trace memanggil pemilik sesi untuk
  menghapus session storage/cache dan seluruh rincian privat, lalu meminta OTP ulang.

## Amil

`reportSources` membaca paket laporan (#98) yang membekukan kegiatan itu dan menandainya
`HISTORICAL_SNAPSHOT` dengan `commitment`, cut-off, dan angka beku. `differsFromCurrent`
menyebut apa yang kini berbeda (`PROPOSAL_VERSION`, `ALLOCATED_TOTAL`, `REALIZATION_COUNT`);
hitungan realisasi yang tidak terbaca tidak dibandingkan. Berkas provenance yang tidak
terbaca dinyatakan `UNAVAILABLE`/`FAILED`, bukan daftar kosong. Rekap tidak memuat identitas
donatur, penerima, locator berkas maupun salt.

## Yang belum dicakup / batas

- Notifikasi (kriteria keenam) tidak diubah: adapter OTP #104 tetap minimum; proyeksi bersifat
  baca-saja sehingga tidak ada kirim ulang yang membuat bukti atau transaksi baru.
- Viewer publik tanpa sesi tidak mendapat proyeksi ini. Journey membaca API verifier publik
  (`/api/public/receipt-verification/:id`, `/api/public/certificates/...`), bukan mengasumsikan
  badge UI membuktikan transaksi atau currentness.
- Browser journey memakai komponen produksi donor/amil melalui entry smoke yang mempersingkat
  navigasi login. OTP dan sesi wallet dibentuk lewat HTTP, tetapi pengiriman OTP memakai outbox
  lokal. Tidak menguji penyedia pesan nyata atau seluruh alur navigasi halaman aplikasi.
- Tidak ada transaksi jaringan publik, deployment pilot, laporan dua pengesahan onchain,
  maupun pembuktian penerimaan fisik manusia. BAST sintetis bukan bukti kejadian lapangan.
- Journey tidak menggantikan suite fault-injection UI, koreksi/reproof lengkap, refund dan
  pengalihan: skenario lintas-sistem ini sengaja dibatasi pada satu kegiatan.

## Pengujian

- `backend/test/activity_trace_api.test.ts` — HTTP donor/amil di database terisolasi: pooled
  tanpa donatur lain, sengketa dan konfirmasi terpisah, sumber gagal ≠ nol, koreksi dan
  pengalihan, isolasi sesi, kesamaan angka donor/amil, aturan murni. Browser (Chromium, ponsel
  390px): kedua layar membaca track yang sama, status tertunda tetap terlihat, kegagalan sumber
  dinyatakan dan pulih lewat keyboard.
- `backend/test/disbursement_realization_source_api.test.ts` — paket laporan nyata dibekukan,
  lalu alokasi bertambah: snapshot tetap historis dan selisihnya terbaca dari rekap amil.
- `backend/test/activity_trace_journey.test.ts` — satu journey HTTP nyata dengan SQL terisolasi,
  file terenkripsi nyata, `createZkProofService`/Groth16 nyata, kontrak lokal Anvil nyata dan
  Chromium. Tidak ada stub prover, mint, atau keberhasilan verifier.

### Journey lintas-sistem yang dapat diulang

Dari root repository, dengan browser diaktifkan:

```sh
cd backend
REGISTRY_BROWSER_MODULE="$PWD/../.scratch/issue113-review-tools/node_modules/playwright-core/index.mjs" \
REGISTRY_BROWSER_EXECUTABLE=/usr/bin/chromium \
bun test test/activity_trace_journey.test.ts
```

Jalankan dari `backend` agar `bunfig.toml` memuat `test/setup.ts`: kredensial operasional
penyedia/database dibuang dari lingkungan tes, penandatangan relayer dinonaktifkan, dan RPC
fallback diarahkan ke loopback.

Prasyarat: `bun`, `node`, `anvil`, artefak kontrak `sc/out`, artefak circuit dan checksum
`sc/circuits/build`/`sc/circuits/artifacts.sha256`, serta dependency frontend/backend yang sudah
tersedia. Prover memakai path circuit standar; variabel browser menunjuk instalasi Playwright
lokal yang sudah ada, bukan memasang dependency baru. Tanpa `REGISTRY_BROWSER_MODULE`, semua
langkah HTTP/SQL/file/proof/EVM tetap berjalan; hanya bagian browser dilewati dengan pesan
`browser NOT RUN`. Jadi hasil tanpa variabel tersebut bukan bukti coverage browser.
Tes mengikuti teardown/reset runtime suite yang ada; kunci fixture adalah kunci publik bawaan
Anvil, bukan rahasia operasional. RPC hanya `127.0.0.1:18624`; tes menolak
port yang sudah dipakai. Server HTTP memakai port dinamis. File fixture berada di direktori unik
`.scratch/issue114-journey-*`; server, Anvil, database dan file dibersihkan dalam teardown.

Fixture menyiapkan lembaga, mandat dan pengajuan disetujui beserta snapshot versi melalui SQL/store
(sama dengan suite sertifikat). Sesudah itu, operasi kontribusi, alokasi, realisasi, dokumen,
laporan, batch/proof, sertifikat dan koreksi/sengketa melalui API HTTP produksi:

1. Donatur pertama mengalokasikan IDR 600.000; donatur kedua kemudian menambah IDR 400.000.
   Sesi OTP hanya boleh membuka kontribusinya sendiri (401/403 untuk akses terlarang).
2. Kegiatan campuran menganggarkan IDR 1.000.000 dan 10 kg; baru IDR 400.000 dan 4 kg diserahkan.
   Satuan barang tidak dikonversi menjadi rupiah; headline tetap `IN_PROGRESS`.
3. BAST sintetis diunggah melalui API, terenkripsi oleh file store, dibaca kembali byte-for-byte
   lewat endpoint berizin, dan ditolak untuk token donor.
4. Paket laporan dibekukan sebelum alokasi kedua. Rekap amil mempertahankan commitment,
   dua realisasi dan alokasi historis IDR 600.000, lalu menandai `ALLOCATED_TOTAL` berbeda.
5. Batch dua kontribusi menghasilkan proof Groth16 asli untuk donatur pertama, transaksi
   sukses di registry lokal dan verifier `VALID`/`CURRENT` tanpa membuka nominal/material privat.
6. NFT tahap mula-mula `PREPARED`/tertunda; setelah signature dan mint lokal menjadi versi 1
   `CURRENT`. Issuer, content digest dan tautan verifier versi yang dipublikasikan dibandingkan
   dengan trace. Sengketa mengubah currentness menjadi `DISPUTED`; versi pengganti terkonfirmasi
   membuat versi 1 `SUPERSEDED` tanpa mengganti digest historisnya.
7. Koreksi nominal kontribusi mempertahankan matematika proof `VALID`, tetapi keberlakuan bisnis
   menjadi `SUPERSEDED`; alokasi ditandai `BEFORE_CORRECTION`.
8. Track dana, distribusi, konfirmasi, sertifikat dan ringkasan donor/amil dibandingkan langsung.
   Chromium 390×844 membaca API yang sama, melihat publikasi tertunda dan memuat ulang sengketa
   lewat keyboard Enter; tidak ada horizontal overflow, identitas donor lain atau page error.

### Hasil eksekusi

- 2026-09-21: journey final yang diperketat **1 pass, 0 fail, 88 assertions** (4,16 detik
  termasuk startup), dengan browser Chromium diaktifkan. Meliputi proof Groth16 nyata, dua
  versi NFT lokal, status `PREPARED`, issuer/digest/tautan versi yang cocok pada donor dan amil,
  sengketa, koreksi kontribusi, snapshot historis dan pemulihan lewat keyboard.
- Red → green: sebelum perbaikan backend, regresi gagal karena `issuance.state` tidak ada;
  setelah kontrak bersama dan proyeksi lifecycle diterapkan, seluruh journey final lulus.
- Regresi browser frontend (`activity-trace-browser.test.ts` dan
  `certificate-verifier-browser.test.ts`): **2 pass, 0 fail, 34 assertions**. Menguji alasan
  pengalihan, refund diputuskan/dibayar/dibatalkan/gagal dibaca, mint gagal/pending, issuer/digest,
  tautan verifier versi tepat, dan sumber laporan tidak tersedia yang tidak menjadi klaim kosong.
  Typecheck frontend juga lulus.
- `donor-trace-session-browser.test.ts`: **2 pass, 18 assertions** setelah red → green.
  Panel `DonorAccessPanel` utuh menjalani form OTP, kemudian hanya endpoint trace menolak
  sesi dengan 401 atau 403. Rincian privat dan session storage hilang; reload tetap meminta OTP.
- Regresi browser OTP #104: selector judul kegiatan kini dibatasi ke region alokasi,
  dan region penelusuran diperiksa terpisah. Judul yang sama sah tampil di kedua panel;
  selector global lama gagal strict-mode. Red → green: **1 pass, 0 fail, 7 assertions**,
  termasuk navigasi, expiry dan logout.
- Suite proof receipt #108: **8 pass, 0 fail, 176 assertions** dengan Groth16/EVM lokal dan
  browser desktop/ponsel. Full run sebelumnya mengungkap asumsi race pada tes: request kedua
  juga sah menerima 201 bila memenangkan lease atau mengamati publikasi yang sudah selesai.
  Assertion kini simetris dan memeriksa satu publikasi, satu tambahan attempt serta satu nonce
  terpakai untuk dua request bersamaan ditambah retry idempoten; endpoint produksi tidak diubah.
- Full suite backend final dengan browser diaktifkan: **1122 pass, 0 fail**, **10348 assertions**,
  87 file, 313,21 detik. `bun run typecheck` lulus sebelum suite. Termasuk journey #114 nyata,
  regresi OTP #104, concurrency proof #108, dan seluruh suite API/browser backend.
- Full suite frontend terakhir dengan browser diaktifkan: **220 pass, 0 fail** (663 assertions).
  Typecheck dan build produksi lulus; build memperingatkan beberapa chunk melebihi 500 kB.
- Kontrak terkait: `forge test --match-contract 'DistributionCertificateNFTTest|ContributionProofRegistryTest'`
  menghasilkan **45 pass, 0 fail**.
- 2026-09-21: full suite kontrak `cd sc && forge test` selesai **195 pass, 0 fail, 0 skipped**,
  19 suite, **349,30 detik** (728,61 detik CPU). Tidak memakai filter atau mengurangi konfigurasi:
  fuzz 256 runs; invariant 256 runs × depth 500. Ketiga invariant publikasi, koreksi dan riwayat
  registry masing-masing menyelesaikan **128000 calls, 0 reverts**. Forge
  `1.7.1-monad-v1.0.0` (commit `bb49277de2e0979b9d37dc0e5f7f18f24b0262b8`).
  Hasil ini menggantikan keterbatasan percobaan awal yang berhenti pada timeout 120 detik;
  tidak ada perubahan kode kontrak atau konfigurasi tes untuk memperoleh hasil hijau.
- Review ulang independen: sumbu Standards tidak menemukan pelanggaran actionable; sumbu Spec
  mengonfirmasi temuan revocation trace 401/403 terselesaikan dan tidak menemukan temuan baru.
  Review statis tambahan untuk selector OTP dan assertion concurrency proof juga tidak menemukan
  masalah actionable. Review statis tidak menggantikan hasil eksekusi tes di atas.
