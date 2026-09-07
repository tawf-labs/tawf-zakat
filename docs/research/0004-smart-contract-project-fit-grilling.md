# Kecocokan smart contract dengan arah ZKT — bahan grill-with-docs

- Tanggal: 2026-09-08, Asia/Jakarta.
- Snapshot kode: `6a283c5` (`fix: verify governance receipts and reset Arbitrum demo deployment`).
- Status: temuan dan catatan wawancara. Q1–Q9 diterima pengguna dan tercatat di ADR-0020/0021/0022. Detail operasional dan implementasi masih perlu diperinci. Bukan spec implementasi atau audit keamanan menyeluruh.
- Metode: membaca konteks, ADR, strategi, issue GitHub aktif beserta komentar, kontrak dan integrasi; menjalankan tes kontrak yang relevan; memeriksa sumber primer melalui [catatan riset 0003](0003-smart-contract-primary-sources.md).

Kesimpulan setelah Q1–Q9: pilot membutuhkan registry bukti laporan terpisah yang memeriksa pengesahan lembaga dan layanan validator, disertai snapshot sumber, hasil pemeriksaan, serta riwayat koreksi. Kontrak vault lama tetap perlu diperbaiki apabila alurnya menjanjikan DPS wajib, batas pengeluaran Amil, dan bukti penyaluran yang ditegakkan kontrak. Pilihan ini mengikuti kebutuhan lembaga sesuai ADR-0016; memperluas custody bukan prasyarat pilot rekonsiliasi.

## 1. Pembacaan dokumentasi menurut skema Matt Pocock

Rute sesi: `ask-matt` → riset + `grill-with-docs` (`grilling` dan `domain-modeling`) → `to-spec` → `to-tickets`. [Spec #68](https://github.com/tawf-labs/tawf-zakat/issues/68) dan 11 sub-issue #69–#79 telah diterbitkan dengan label `ready-for-agent` setelah pengguna menyetujui pemecahannya. Seluruh 12 dependensi native terverifikasi; [#69](https://github.com/tawf-labs/tawf-zakat/issues/69) adalah tiket awal tanpa blocker saat publikasi. Belum masuk implementasi. Issue tracker adalah GitHub, bukan tiket lokal; URL yang dikembalikan GitHub kini memakai nama `tawf-labs/tawf-zakat`.

| Dokumen | Yang ditemukan | Implikasi |
| --- | --- | --- |
| [AGENTS.md](../../AGENTS.md), [domain.md](../agents/domain.md), [issue-tracker.md](../agents/issue-tracker.md) | Layout satu konteks dan tracker `tawf-labs/zkt-hackathon` sudah ditentukan. | Fondasi alur tersedia; tidak perlu menjalankan setup ulang. |
| [CONTEXT pada inspeksi awal](../../archive/CONTEXT-2026-09-08-before-pilot.md) | Campuran glossary, arsitektur, alamat deployment, API, detail UI, dan checklist selesai. | Belum sesuai `domain-modeling`, yang mengharuskan CONTEXT menjadi glossary saja. Ditindaklanjuti dengan glossary aktif dan arsip isi lama setelah pengguna menerima arah pilot. |
| [ADR-0002](../adr/0002-onchain-multisig-governance.md), [ADR-0005](../adr/0005-hybrid-safeglobal-and-dual-receipt-disbursement.md), [ADR-0006](../adr/0006-separation-of-powers-dps-approval-and-ex-post-auditor-attestation.md) | ADR lama masih menyatakan auditor ikut pre-approval, sedangkan 0006 memisahkan auditor menjadi ex-post. Status supersession belum konsisten. | Kebutuhan pemisahan tugas dibaca dari 0006; implementasi diperiksa terpisah. Riwayat lama perlu penunjuk keputusan pengganti. |
| [ADR-0015](../adr/0015-universal-gasless-eip712-for-amil-and-dps.md), [ADR-0019](../adr/0019-receipt-verified-governance-and-clean-redeployment.md) | Empat aksi governance kini memakai transaksi wallet dan konfirmasi receipt; janji universal gasless sudah diganti untuk manual testing. | Gasless adalah keputusan untuk dibuka lagi bila dibutuhkan, bukan fitur aktif yang boleh diasumsikan. Jalur auditor memiliki batas tersendiri. |
| [CONTEXT pada inspeksi awal](../../archive/CONTEXT-2026-09-08-before-pilot.md), [README.md](../../README.md), [sc/README.md](../../sc/README.md) | Mencampur Sepolia L1, Safe lama, ZKTCore/DAO/NFT/ZK, dan aplikasi terbaru. | Kontrak yang dianalisis adalah `ZakatProtocolL1.sol`; keberadaan kode DAO/ZK tidak membuktikan fitur itu bagian alur aktif. README masih perlu penyelarasan. |
| [Manifest 8 September](../deployments/2026-09-08-arbitrum-sepolia.md) | Mencatat Arbitrum Sepolia 421614, protocol `0x0D6CeC28a574ACa41b879767b081F6f2B4E9a849`, MockUSDC 6 desimal. | Referensi deployment sesi ini. Alamat, role, dan saldo tidak diperiksa ulang melalui RPC dalam analisis ini. |
| [ADR-0016](../adr/0016-commercial-positioning-technology-vendor-not-licensed-amil.md), [strategi](../strategy/README.md), [ADR-0017](../adr/0017-reconciliation-engine-v0-shared-pure-core-and-two-callers.md), [ADR-0018](../adr/0018-deterministic-validator-decides-never-the-model.md) | Arah produk sudah menjadi vendor teknologi, rekonsiliasi, dan kesiapan audit; vendor tidak mengendalikan dana zakat. | Memperluas custody harus memiliki kebutuhan pelanggan dan model kendali lembaga yang eksplisit. Angka yang cocok dengan ledger belum membuktikan kejadian bank benar. |

Klaim lama seperti “100% compliance”, “zero PII leakage”, dan “anti-double-claim integrity” di ADR adalah klaim dokumen yang harus diuji, bukan hasil sertifikasi yang diwarisi analisis ini. Format ADR boleh panjang jika membantu; masalah terpenting adalah pertentangan keputusan dan statusnya, bukan jumlah heading.

Sesudah pengguna menerima arah pilot, `CONTEXT.md` dirapikan menjadi glossary dan seluruh isi lamanya disimpan dalam arsip. ADR-0020 mencatat pilihan Q1/Q2; `docs/agents/domain.md` menunjuk sumber scope, deployment, dan sejarah secara eksplisit. Ini penyelarasan dokumen; temuan perilaku aplikasi di bawah tetap terbuka.

## 2. Perubahan kontrak yang beralasan dari bukti kode

### A. DPS wajib belum ditegakkan

`proposeDisbursement` memberi satu approval otomatis. `approveDisbursement` menerima tambahan approval dari admin, DPS, atau auditor secara setara. Dengan dua approval, proposal dapat dieksekusi tanpa DPS. Bukti: [kontrak](../../sc/src/ZakatProtocolL1.sol), baris 190–220; [tes governance](../../sc/test/ZakatProtocolL1_Governance.t.sol), baris 125–150, secara eksplisit menguji relayer → auditor → execution dan lulus.

Ini bertentangan dengan ADR-0006. Bila keputusan itu tetap berlaku, kontrak harus memeriksa persetujuan DPS secara eksplisit dan menempatkan auditor sesudah penyaluran. Aturan siapa yang dapat mengangkat/mencabut DPS juga perlu ditetapkan: admin `AccessControl` saat ini dapat memberikan role kepada alamat lain. Sekadar mengganti kondisi approval tidak menjamin independensi dari admin.

### B. Pembagian 12,5% belum membatasi seluruh pengeluaran Amil

Deposit membagi treasury dan mustahik dengan benar. Namun `_asnafCategory` tidak divalidasi dan semua proposal mendebit pool mustahik. UI menawarkan `Amil = 2`. Bukti: [kontrak](../../sc/src/ZakatProtocolL1.sol), baris 110–145, 156–178, 247–279; [form proposal](../../frontend/src/features/governance/CreateProposalModal.tsx), baris 16–24.

Skenario yang diturunkan dari kode: deposit 1.000 USDC menghasilkan 125 treasury dan 875 mustahik. Pengaju berwenang dapat membuat proposal berlabel Amil senilai 875, memperoleh approval, lalu mengeksekusinya; jalur penarikan treasury 125 tetap terpisah. Ini melanggar janji alokasi untuk tujuh asnaf selain Amil, tanpa merusak aritmetika pembagian pool.

Keputusan yang diperlukan: pengeluaran Amil hanya lewat treasury atau lewat penyaluran dengan sumber pool eksplisit. Kebijakan ini harus berlaku juga pada ledger IDR dan laporan: kontrak belum punya pencatatan pengeluaran treasury IDR, sementara laporan membaca penyaluran berlabel AMIL sebagai realisasi hak amil. “Plafon maksimum” juga berbeda dari “selalu mengalokasikan tepat 12,5%”; dasar jenis dana dan kebijakan lembaga dibahas dalam riset 0003.

### C. Eksekusi IDR dan BAST belum terikat sebagaimana janji bukti penyaluran

`executeDisbursement(uint256)` dapat dipanggil siapa saja setelah quorum. Untuk USDC ia benar-benar mentransfer token; untuk IDR ia hanya mengurangi angka ledger. Event-nya mengulang CID pengajuan awal. CID BAST diserahkan sebagai metadata bertanda tangan kepada backend, bukan parameter/state/event kontrak. Bukti: [kontrak](../../sc/src/ZakatProtocolL1.sol), baris 238–267; [form BAST](../../frontend/src/features/governance/ExecuteBastModal.tsx), baris 43–45; [konfirmasi metadata](../../backend/src/governance-chain.ts), baris 48–52.

Jika janji produk adalah pengesahan settlement oleh Amil dengan bukti yang dapat diverifikasi independen, perlu aturan pengesah dan pengikatan bukti pada kontrak inti atau registry. Pencatatan CID tetap tidak membuktikan transfer bank benar; sumber pembayaran dan rekonsiliasi independen tetap diperlukan. Eksekusi permissionless USDC bukan otomatis kerentanan karena tujuan dan jumlah sudah ditentukan, tetapi semantik IDR tidak boleh disamakan dengan transfer token.

### D. Atestasi auditor belum divalidasi oleh kontrak

[Backend](../../backend/src/index.ts), baris 1231–1248 memverifikasi signature, lalu baris 1312–1319 mengirim transaksi bernilai nol ke alamat relayer sendiri dengan string audit/CID. Baris 1328 langsung menyimpan status diaudit tanpa menunggu receipt. Kontrak tidak memiliki fungsi/event atestasi atau anomaly flag seperti yang dibayangkan ADR-0006.

Transaksi tersebut dapat menambatkan data publik apabila akhirnya masuk blok, tetapi bukan atestasi yang role dan lifecycle-nya ditegakkan `ZakatProtocolL1`. Backend dapat memperbaiki konfirmasi, status pending, dan idempotensi. Pilot telah memilih registry terpisah untuk paket laporan periode melalui ADR-0022. Penyesuaian atestasi penyaluran lama tetap perlu ditentukan bila alur vault tersebut dilanjutkan; atestasi laporan dan penyaluran memiliki objek berbeda.

## 3. Temuan penting yang tidak otomatis membutuhkan redeploy

| Temuan | Bukti lokal | Arah perbaikan |
| --- | --- | --- |
| Orang sama dapat memperoleh hash baru setiap pengajuan. | [CreateProposalModal](../../frontend/src/features/governance/CreateProposalModal.tsx):64–73 membuat salt acak per submit; kontrak hanya mengenali pasangan hash/periode yang sama. | Definisikan identitas penerima dan cakupan klaim per lembaga/program/periode; kelola pengenal stabil dan privasinya. Solidity tidak dapat menyimpulkan dua hash berarti orang yang sama. Input pengaju berwenang tetap bagian batas kepercayaan. |
| Upload audit JSON masih mengembalikan CID sintetis saat Pinata gagal. | [ipfs.ts](../../backend/src/ipfs.ts):444–485 membuat `QmAudit...` tanpa pembatasan mode tes. | Gagal secara eksplisit; simpan status hanya setelah bukti sungguhan tersedia. |
| Hash NIK tidak melindungi scan identitas atau BAST yang diunggah terbuka. | [ipfs.ts](../../backend/src/ipfs.ts):33–52 mengirim binary langsung ke Pinata. | Tetapkan redaksi, akses, dan bila perlu enkripsi dokumen; simpan commitment publik. IPFS sendiri tidak mengenkripsi isi, lihat riset 0003. |
| Mirror kehilangan unit native USDC dan identitas event. | [indexer.ts](../../backend/src/indexer.ts):143; [db/index.ts](../../backend/src/db/index.ts):1165–1205. | Kerjakan cakupan #67: integer native, chain/contract/txHash/logIndex, idempotensi, dan backfill berbukti. Raw amount sudah tersedia dalam event kontrak. |
| Heuristik unit USDC juga salah pada batas jumlah kecil. | [db/index.ts](../../backend/src/db/index.ts):1180 memakai `> 1e6`; [ledger-rows.ts](../../backend/src/ledger-rows.ts):41–43 memakai `< 1e6`. | Deposit tepat 1 USDC raw dapat dibaca sebagai 1.000.000 USDC; proposal raw di bawah 1 USDC dikalikan lagi. Ini kesimpulan cabang kode, belum kasus end-to-end yang direproduksi sesi ini. Gunakan unit eksplisit, bukan tebakan dari besar angka. |
| Waktu persetujuan belum tersimpan. | [governance-chain.ts](../../backend/src/governance-chain.ts):67–69 sudah membaca timestamp blok; ADR-0018 mencatat kolom waktu DPS belum tersedia. | Simpan timestamp/hash blok dan backfill. Tidak perlu menambahkan timestamp event Solidity hanya untuk mengisi gap ini. |
| Jenis dana belum mengalir ke laporan. | [schema.ts](../../backend/src/db/schema.ts):17–31; [period-report.ts](../../backend/src/period-report.ts):253; [merkle.ts](../../backend/src/merkle.ts):17. | Intake/schema/mapper perlu jenis dana eksplisit. Jika jenis dana harus ikut dibuktikan, versi leaf dapat mengikatnya; kontrak penyimpan root opaque tidak otomatis harus berubah. Pemisahan pool custody adalah keputusan berbeda. |
| Safe historis dan UI tidak cukup membuktikan Safe aktif. | [safe.ts](../../backend/src/safe.ts):25–70 memakai layanan Ethereum Sepolia dan fallback threshold; [DpsSafeApprovalCard](../../frontend/src/features/governance/DpsSafeApprovalCard.tsx):36,97 memakai transaksi wallet/link alamat lain. | Verifikasi akun DPS, owner dan threshold pada chain aktif. Kuorum owner Safe adalah otorisasi satu akun, bukan dua approval protokol; lihat sumber Safe dalam riset 0003. |

## 4. Tracker dan bukti pengujian

Pembacaan langsung GitHub pada fase riset menemukan issue terbuka #55 dan #61–#67. Komentar #55 mengakui implementasi lokal, batas bukti, dan pemisahan pekerjaan native USDC ke [#67](https://github.com/tawf-labs/zkt-hackathon/issues/67). Publikasi/verifikasi produksi dilacak di [#66](https://github.com/tawf-labs/zkt-hackathon/issues/66). Beberapa tiket #62–#65 masih terbuka walaupun kode dan catatan implementasinya sudah ada; label terbuka tidak cukup untuk menyimpulkan fitur belum dibuat. Issue lama tidak diubah oleh analisis ini. Setelah pengguna meminta `to-spec` dan `to-tickets`, [spec #68](https://github.com/tawf-labs/tawf-zakat/issues/68) diterbitkan sebagai dasar pekerjaan pilot.

Perintah dari `sc/`:

```bash
forge test --match-contract 'ZakatProtocolL1.*'
```

Hasil: **23 lulus, 0 gagal**, termasuk fuzz 256 run. Ini baseline dua suite kontrak aktif, bukan keseluruhan repo atau audit deployment. Tes approval Auditor yang lulus merupakan bukti ketidaksesuaian spec. Skenario lain di atas berasal dari inspeksi kode, kecuali disebutkan berbeda. Tidak ada transaksi, deployment, migrasi, atau perubahan kode aplikasi.

Kontrak memakai constructor dan tidak menyediakan mekanisme upgrade proxy. Perubahan logic inti memerlukan deployment baru; registry pendamping mungkin dapat ditambahkan tanpa mengganti inti, tetapi tidak memperbaiki aturan approval/pool pada inti lama. Kebutuhan migrasi harus mengikuti keadaan chain yang diperiksa saat implementasi, bukan menganggap manifest zero-state tetap benar selamanya.

## 5. Frontier keputusan untuk wawancara

**Sudah disepakati:** pengguna mengikuti kedua rekomendasi dan menjelaskan bahwa ketidaksesuaian muncul karena beberapa bagian terlewat selama pembaruan proyek. [ADR-0020](../adr/0020-institutional-pilot-evidence-and-reconciliation.md) mencatat:

1. **Q1 — Target terdekat:** pilot lembaga untuk rekonsiliasi dan kesiapan audit.
2. **Q2 — Peran kontrak:** mengikat bukti transaksi lembaga; kebutuhan vault USDC dinilai sebagai alur tersendiri, dengan kendali dana pada lembaga.

**Putaran kedua juga diterima pengguna:** [ADR-0021](../adr/0021-period-evidence-institutional-endorsement-and-private-sources.md) mencatat pilihan Q3–Q5 berikut. Pengguna sekaligus meminta seluruh dokumen riset dibaca untuk memastikan desain mengikuti tujuan proyek.

3. **Q3 — Unit bukti utama:** laporan periode beserta snapshot data sumber dan hasil rekonsiliasi. Penelusuran transaksi mengikuti rincian yang memang tersedia.
4. **Q4 — Kewenangan pengesahan:** lembaga mengesahkan catatan dan auditor memberi hasil pemeriksaan terpisah; ZKT menjalankan layanan teknis.
5. **Q5 — Keterbukaan bukti:** ringkasan, status pemeriksaan, dan sidik digital dokumen terbuka; berkas identitas/rincian bank terbatas bagi pihak berwenang.

**Putaran ketiga diterima pengguna:** [ADR-0022](../adr/0022-append-only-report-evidence-registry.md) mencatat Q6–Q8.

6. **Q6 — Koreksi setelah penerbitan:** versi baru yang menunjuk versi lama, disertai alasan dan pengesah; bukti versi lama tetap dipertahankan.
7. **Q7 — Pemeriksaan yang menemukan selisih:** sumber dan temuan tetap disimpan dengan status jelas; draf ditolak tetap tidak dapat ditandatangani sebagai laporan lolos. Menyimpan bukti pemeriksaan tidak sama dengan mengesahkan draf yang gagal.
8. **Q8 — Bentuk kontrak pilot:** registry bukti laporan terpisah dari vault, untuk identitas paket, pengesahan, dan kaitan atestasi. Ini belum keputusan deployment atau izin menutup temuan vault.

**Putaran keempat diterima pengguna:** ADR-0022 diperluas dengan gerbang penerbitan Q9.

9. **Q9 — Penegakan penerbitan pada kontrak:** pengesahan lembaga dan pernyataan `LOLOS` bertanda tangan layanan validator wajib atas paket yang sama. Kontrak memeriksa otorisasi keduanya; perhitungan dapat diulang dari snapshot, tetapi kebenaran perhitungan tetap bergantung pada layanan, bukan dihitung seluruhnya oleh Solidity. Pengguna menerima rekomendasi ini setelah batas kepercayaannya dijelaskan. Alternatif registry dengan pengesahan lembaga saja tidak dipilih.

[Rancangan registry](../design/period-evidence-registry.md) merangkai Q1–Q9 serta memisahkan keputusan arsitektur dari detail terbuka yang harus diselesaikan sebelum tiket implementasi siap dikerjakan.

**Prasyarat cabang selanjutnya:**

- Setelah unit bukti jelas: sumber settlement fiat, konsistensi snapshot, koreksi dan riwayat, cakupan atestasi serta identitas laporan/lembaga. Kebutuhan snapshot diterima melalui ADR-0021; skema, retensi, dan pelaksanaan migrasi belum ditentukan.
- Setelah kewenangan dan akses jelas: pemegang kunci dan role, kebutuhan gasless, signature EOA/Safe, distribusi bukti privat, retensi, dan pemulihan akses.
- Setelah kebutuhan sumber jelas: jenis dana, periodisasi, identitas mustahik dan batas pemeriksaan klaim ganda yang relevan untuk data tersebut.
- Registry terpisah dan dua pengesahan sudah dipilih: format paket/signature, pengikatan deployment dan sumber historis, serta tes terhadap jaminan produk perlu dirinci. Pemilihan registry tidak memutuskan migrasi vault.

### Fakta tambahan untuk Q3–Q5

Inspeksi lanjutan terhadap laporan periode menemukan bahwa fitur saat ini menghitung angka dan menyediakan unduhan teks, tetapi belum menghasilkan paket bukti bertanda tangan:

- [Route laporan](../../backend/src/routes/period-report.ts):162 membaca donations, proposals, dan stage events melalui query terpisah pada tiap permintaan; belum ada snapshot konsisten atau pengikatan ke hasil rekonsiliasi.
- Respons belum membawa identitas lembaga, identitas/revisi laporan, hash sumber, versi perhitungan/validator, signature, atau receipt anchor. Lihat [tipe laporan](../../frontend/src/features/periodReport/types.ts):102,141.
- `canSign` hanya membuka jalan unduh bagi vonis lolos. [Hook laporan](../../frontend/src/features/periodReport/usePeriodReport.ts):79 membuat berkas teks; [dokumen laporan](../../frontend/src/features/periodReport/reportDocument.ts):84 berisi angka, narasi, dan jejak, tanpa source rows/manifest atau signature institusional.
- [Getter DB](../../backend/src/db/index.ts):903–930,969–987 menangkap kegagalan baca dan dapat mengembalikan daftar kosong. Pembuktian kelak harus membedakan data kosong yang berhasil dibaca dari kegagalan mengambil sumber.
- Menyimpan snapshot atau riwayat adalah perluasan nyata terhadap ADR-0018 keputusan 13 dan ADR-0017 keputusan 9 bila hasil rekonsiliasi ikut disimpan. Inti perhitungan murni dapat dipertahankan.

Fakta ini berasal dari pembacaan kode, bukan pengujian baru. Q3 sudah dipilih sebagai kebutuhan; fitur paket bukti belum tersedia.

Kosakata yang perlu dipertegas selama wawancara: **alokasi hak amil / realisasi hak amil**, **persetujuan DPS / kuorum owner Safe**, **transfer USDC / pengesahan settlement IDR**, **hash bukti / kebenaran kejadian**, **atestasi penyaluran / opini audit laporan**, dan **periode bantuan / periode pelaporan**. Istilah yang disepakati masuk glossary; hanya trade-off arsitektur yang benar-benar diputuskan menjadi ADR.

## 6. Penelusuran Seluruh Riset ke Kebutuhan Pilot

Seluruh empat catatan dalam `docs/research/` dibaca pada tindak lanjut ini: 0001 (indexer), 0002 (pelaporan BAZNAS, seluruh 13 bagian dan lampiran), 0003 (sumber primer kontrak), dan 0004 (temuan implementasi serta wawancara). Pembacaan dokumen tidak berarti seluruh sumber eksternal dalam riset 0002 telah diverifikasi ulang. Pasal 18, 20, dan 22 PerBAZNAS 1/2023 diperiksa langsung kembali pada [PDF resmi](https://peraturan.go.id/files/peraturan-baznas-no-1-tahun-2023.pdf).

| Dasar riset | Implikasi untuk rancangan | Letak pekerjaan |
| --- | --- | --- |
| 0002 §5: angka berbeda antar-tabel dan versi publikasi; §12 mengakui penyebab selisih belum dipastikan. | Bekukan sumber, cakupan, dan cut-off setiap paket; tampilkan selisih tanpa menyimpulkan penyebab atau kecurangan. | Snapshot dan rekonsiliasi backend; identitas/hash paket dalam calon registry. |
| 0002 §3.6 dan §5.3: tanggung jawab data dan perubahan setelah pelaporan. | Pengesahan lembaga perlu terikat pada paket tertentu; koreksi perlu dapat ditelusuri. | Tanda tangan dan identitas paket; kebijakan versi diterima melalui Q6/ADR-0022. |
| 0002 §6 dan §10.6: pengawasan berjalan, pemeriksaan ex-post, dan audit resmi berbeda cakupan. | Pemeriksaan auditor mengacu ke paket yang tepat; pengesahan sumber, vonis angka, dan opini auditor tidak digabung menjadi satu label kebenaran. | Domain, registry yang dipilih melalui Q8, serta penyajian status. |
| 0002 §9 dan §10.4: AI menyusun draf, angka diperiksa deterministik. | Pertahankan mesin murni dan penolakan draf. Versi aturan dan data harus dapat diketahui pemeriksa. | Perhitungan, validator, dan paket hasil; hash kontrak sendiri tidak menjalankan ulang aritmetika. |
| 0002 §10.1 revisi dan §10.7: posisi produk mendahulukan pembuktian serta rekonsiliasi atas sistem lembaga yang sudah ada. | Gunakan data lembaga sebagai masukan; donasi melalui vault bukan prasyarat bukti periode. Generator laporan berguna sebagai keluaran dari sumber yang dapat ditelusuri. | Intake/mapping, rekonsiliasi, laporan; fitur yang sudah dibangun tetap dapat dipakai. |
| 0002 §3.5 dan §12: host-to-host merupakan jalur yang disebut aturan, tetapi akses API dan format ekspor nyata belum terbukti tersedia bagi proyek. | Mulai dari masukan terstruktur yang didukung; periksa sampel sebelum menyatakan kompatibilitas berkas SiMBA atau integrasi langsung. | Adapter backend/frontend, bukan alasan menambah fungsi custody. |
| 0003 §4 dan keputusan Q5: CID publik tidak menjadikan berkas privat. | Pisahkan ringkasan publik dari sumber terbatas; akses berkas dan pemulihan akses harus dirancang. | Penyimpanan dan otorisasi; commitment publik tidak boleh dianggap kontrol akses. |
| 0001 dan pemeriksaan ulang: receipt, canonical history, checkpoint, dan idempotensi menentukan keandalan mirror. | Anchor harus sesuai receipt yang benar-benar diperiksa; status dan data dapat dipulihkan setelah kegagalan indexing atau reorg. | Indexer/database dan pembacaan registry; bukan otomatis migrasi framework. |

**Pembagian tugas sesudah Q8 diterima:** kontrak bukti memverifikasi otorisasi dan mengikat identitas paket/pengesah/atestasi; backend mempertahankan sumber dan melakukan perhitungan yang dapat diulang; antarmuka menunjukkan bukti sesuai kewenangan pembaca. Data mentah, narasi AI, dan perhitungan laporan tidak perlu dipindahkan seluruhnya ke Solidity.

**Batas pembuktian yang harus dibawa ke spec:** signature dan hash membuktikan pihak yang menyatakan serta isi yang diikat. Keduanya tidak dengan sendirinya membuktikan pembayaran bank, kelengkapan sumber, atau bahwa hasil validator telah dihitung dengan benar. Rancangan harus menjelaskan siapa yang bertanggung jawab atas hasil pemeriksaan dan bagaimana pihak berwenang menghitung ulang dari snapshot; jangan memberi label validasi independen hanya karena suatu hash sudah tercatat. Q9 menerima penegakan dua pengesahan pada kontrak dengan kepercayaan pada layanan validator tetap dinyatakan.

### Fakta tambahan untuk Q9

Pemeriksaan read-only menemukan OpenZeppelin lokal 5.5.0 menyediakan `EIP712`, `SignatureChecker` untuk EOA/ERC-1271, dan `Nonces`; Solidity repo 0.8.31 memenuhi versi compiler yang diperlukan. Primitif ini tidak otomatis menetapkan dua role wajib, canonical encoding paket, atau deadline.

[Validator](../../backend/src/report-validator.ts):120 membandingkan draf terhadap angka input dan :208–221 mempercayai `figures.amilShare.withinCeiling`. Ia belum membuktikan snapshot, rekonsiliasi, kelengkapan sumber, atau identitas lembaga. `claims: []` tanpa angka rupiah juga tidak otomatis ditolak apabila invariant lolos. Spec penerbitan perlu menetapkan cakupan wajib secara eksplisit; pernyataan lolos tidak boleh dijelaskan sebagai jaminan lengkapnya seluruh laporan.

Typed-data [backend](../../backend/src/index.ts):37–63 dan [frontend](../../frontend/src/lib/contracts.ts):295–347 masih mengikat vault dan belum membawa paket/revisi/nonce/deadline. Helper backend memakai utilitas `verifyTypedData` EOA-only; dukungan Safe memerlukan jalur pemeriksaan akun kontrak. Helper role lama backend :78–103 dapat fallback ke DB meskipun pembacaan role live bernilai false; jangan menyalinnya menjadi sumber otorisasi registry. Fakta tambahan ini berasal dari pembacaan kode lokal tanpa tes baru atau pemeriksaan chain.

Klaim implementasi lama pada riset 0002 §6.4, §8.2, dan §10.7 telah dikoreksi terhadap bukti kode. Riset 0001 juga diberi sumber primer dan batas atas klaim isolasi proses serta pemulihan reorg. Hipotesis lapangan dan data pasar tidak dipromosikan menjadi fakta hanya karena keputusan pilot sudah diambil.
