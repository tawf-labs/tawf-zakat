# ZKT — Kampanye Infak dan Bukti Pengelolaan Dana

> **Cakupan aktif:** penggalangan infak publik yang diperiksa operator, pembayaran Midtrans **sandbox**, dan bukti pencatatan kampanye pada blockchain; ruang kerja lembaga yang sudah ada tetap terpisah. Lihat [CONTEXT.md](CONTEXT.md) untuk istilah dan batas tanggung jawab.
>
> **Bukan layanan produksi siap menerima dana:** pengujian sandbox tidak membuktikan izin PUB, legalitas penyelenggara, kepatuhan syariah, atau realisasi bantuan. Pencatatan blockchain tidak memverifikasi kebenaran cerita maupun saldo bank. Kontrak registry kampanye baru perlu dikonfigurasi dan dideploy tersendiri sebelum UI boleh menampilkan konfirmasi rantai.
>
## Menjalankan kampanye infak sandbox

Prasyarat: Bun 1.4.2+, PostgreSQL lokal/pengujian, dan Foundry untuk pengujian kontrak. Jangan mengarahkan migrasi percobaan ke database produksi. Modul crowdfunding memakai penyimpanan terpisah dari ruang kerja lembaga; seluruh mutasi dan antrean blockchain disimpan atomik dalam satu aggregate PostgreSQL. Desain ini untuk MVP bervolume kecil, bukan klaim kapasitas produksi.

Konfigurasi backend melalui environment lokal yang tidak di-commit:

- `CROWDFUNDING_DATABASE_URL`: koneksi PostgreSQL pengujian; wajib untuk API kampanye. Tidak ada migrasi otomatis atau fallback data sementara ketika database belum tersedia.
- `CAMPAIGN_DOCUMENT_KEY`: kunci acak 32 byte dalam bentuk 64 karakter hex untuk enkripsi dokumen privat. Simpan aman dan cadangkan terpisah dari database; kehilangan kunci membuat dokumen tidak dapat dibaca.
- `CAMPAIGN_FILE_DIR` (opsional, bawaan `.campaign-files`): direktori di server tempat berkas kampanye disimpan — foto sampul, dokumen pendukung, dan lampiran kabar/laporan. Isinya sudah terenkripsi dengan `CAMPAIGN_DOCUMENT_KEY`; baris database hanya menyimpan metadata. Cadangkan direktori ini bersama database: kehilangan salah satunya membuat berkas tidak terbaca. Untuk instalasi lama, jalankan `bun run crowdfunding:externalize-files` sekali untuk memindahkan berkas yang masih tersimpan di dalam baris database.
- `MIDTRANS_SERVER_KEY`: server key yang diterima akun Midtrans pada endpoint sandbox. Awalan key saja bukan bukti environment: key berawalan `Mid-server-...` maupun `SB-Mid-server-...` dapat diperiksa, tetapi seluruh request dan redirect tetap dibatasi ke sandbox; tidak ada fallback production. `MIDTRANS_IS_PRODUCTION` harus tidak aktif. Gagal menghubungi gateway tidak diganti pembayaran mock.
- `CAMPAIGN_REGISTRY_ADDRESS`, `CAMPAIGN_CHAIN_RPC_URL`, `CAMPAIGN_CHAIN_ID`, `CAMPAIGN_RECORDER_PRIVATE_KEY`: registry dan akun pencatat khusus. Adapter hanya menerima chain lokal `31337` atau Arbitrum Sepolia `421614`. Kunci pencatat tidak dikirim ke browser. Tanpa konfigurasi ini, UI menyatakan blockchain belum dikonfigurasi dan antrean tetap tersimpan.

Setelah memilih database pengujian dan menyetel environment:

```bash
cd backend
bun install
bun run crowdfunding:migrate
# Set CROWDFUNDING_OPERATOR_NAME, CROWDFUNDING_OPERATOR_EMAIL,
# dan CROWDFUNDING_OPERATOR_PASSWORD melalui pengelola secret/environment lokal.
bun run crowdfunding:operator
bun run dev
```

Operator dibuat lewat CLI, bukan pilihan peran pada formulir pendaftaran. Password minimal 12 karakter. CLI menolak promosi otomatis alamat email yang sudah terdaftar. Registrasi publik hanya menghasilkan akun penggalang individu/organisasi; kepemilikan email belum diverifikasi lewat OTP, dan pemeriksaan identitas kampanye tetap tugas petugas.

Di terminal lain:

```bash
cd frontend
bun install
PORT=3000 VITE_API_BASE_URL=http://localhost:3001 bun run dev
```

Buka `http://localhost:3000/` atau `/kampanye` untuk halaman publik, `/galang-dana` untuk penggalang, dan `/kelola-kampanye` untuk operator. Tidak ada kampanye fiktif yang otomatis diterbitkan. Buat proposal, unggah bukti privat, ajukan, lalu masuk sebagai operator untuk memeriksa versi, meminta revisi/menyetujui, dan menerbitkannya. Dokumen dibatasi PDF/JPEG/PNG maksimal 2 MiB per berkas. Foto sampul kampanye diunggah sebagai berkas JPEG/PNG (maksimal 2 MiB) dari halaman pengelolaan setelah draf disimpan; foto baru tampil ke publik setelah versi proposalnya diterbitkan.

Checkout membuka halaman resmi Midtrans sandbox. Browser hanya memeriksa status yang dikonfirmasi backend. Endpoint notifikasi khusus kampanye adalah `/api/crowdfunding/midtrans/notification`; endpoint lama `/api/webhooks/payment` juga meneruskan order kampanye berawalan `CF-` ke pemeriksaan yang sama. Gunakan URL HTTPS API yang dapat dijangkau Midtrans saat menguji notifikasi eksternal. Localhost saja tidak dapat menerima webhook dari layanan luar. Sandbox tidak memodelkan biaya operasional/pemrosesan nyata atau transfer ke penerima manfaat.

Jika pembuatan checkout terganggu, gunakan pemulihan pembayaran yang sama: backend memeriksa status Midtrans terlebih dahulu dan tidak membuat ID pesanan baru untuk hasil yang masih ambigu. Jika pesanan sudah ada tetapi tautan checkout tidak dapat dipulihkan, pemeriksaan di sisi merchant mungkin diperlukan. Akses pembayaran donatur disimpan per tab browser, bukan akun donatur; penutupan tab atau hilangnya respons jaringan sebelum token diterima belum memiliki pemulihan lintas perangkat.

Operator dapat membuka kembali kampanye yang sudah disetujui/terbit untuk revisi material. Donasi baru dijeda, halaman publik mempertahankan isi versi terakhir yang diterbitkan, dan perubahan harus diajukan, diperiksa, disetujui, lalu diterbitkan kembali. Checkout yang sudah diterbitkan sebelum jeda masih dapat dibayar; penerimaan yang dikonfirmasi tetap dicatat. Rincian anggaran publik dan alur pencairan/penyaluran crowdfunding belum tersedia; ruang kerja penyaluran lembaga lama bukan pengganti otomatis fitur tersebut.

**Donatur & doa.** Formulir donasi menerima doa opsional (maksimal 280 karakter). Halaman detail kampanye menampilkan bagian “Donatur & Doa”: hanya donasi yang sudah terkonfirmasi, terbaru lebih dulu, dengan nominal yang selalu tampil; donatur anonim tampil sebagai “Hamba Allah” dan namanya tidak dikirim ke browser. Doa tampil tanpa pemeriksaan; operator dapat menyembunyikan teks doa dari tampilan kampanye di `/kelola-kampanye`, sedangkan donasinya tetap tercantum. Daftar diambil berhalaman dari `GET /api/crowdfunding/campaigns/:id/donors`.

**Verifikasi donasi kampanye.** Panel pembayaran menampilkan kode bukti donasi (referensi pesanan `CF-…`) dan tautan ke `/verifikasi`. Halaman itu memakai satu kolom pencarian untuk receipt kontribusi lembaga maupun kode donasi kampanye, dibedakan dari awalan `CF-`. Hasil pemeriksaan kampanye memuat status, nominal, tanggal, dan kampanye tujuan, tanpa nama donatur atau doa. Bagian “Tercatat di blockchain” (hash transaksi dan sidik data) hanya muncul setelah pencatatan donasi itu terkonfirmasi; status menunggu atau gagal tidak ditampilkan. Ini bukan bukti ZK seperti receipt lembaga, melainkan satu komitmen per donasi, dan statusnya dibaca dari catatan server tanpa pemeriksaan RPC langsung. `/verifikasi?trxId=CF-…` tidak tertahan gerbang deployment lembaga; membuka `/verifikasi` tanpa kode kampanye tetap mengikuti gerbang itu. Data diambil dari `GET /api/crowdfunding/receipts/:reference`.

**Antrean operator.** `/kelola-kampanye` membuka daftar kerja, bukan daftar semua kampanye: proposal yang menunggu review, kampanye disetujui yang belum terbit, dan laporan realisasi yang menunggu pemeriksaan, diurutkan dari yang paling lama menunggu. Tab berangka menyaring per jenis pekerjaan; “Semua kampanye” adalah arsip yang bisa dicari dan disaring per status. Setelah keputusan yang menuntaskan pekerjaan pada satu kampanye, item antrean berikutnya terbuka otomatis. Daftar diambil dari `GET /api/crowdfunding/review/queue`, yang hanya memuat ringkasan tanpa material privat; daftar masih dikirim utuh dan dipotong di browser (40 baris per tampilan), belum berhalaman di server.

**Kabar & laporan realisasi.** Setelah kampanye terbit (termasuk setelah ditutup), penggalang dapat menulis kabar atau laporan realisasi dari bagian “Kabar & Laporan” di `/galang-dana`, dengan hingga 5 lampiran. **Kabar** terbit langsung saat penggalang menerbitkannya, tanpa pemeriksaan operator; lampirannya hanya foto JPEG/PNG yang ikut tampil ke publik. **Laporan realisasi** diajukan lebih dulu: operator memeriksa, lalu menerbitkan, meminta perbaikan, atau menolak, dan lampirannya privat secara bawaan — berkas tampil ke publik hanya jika penggalang mengusulkannya **dan** operator mencentangnya saat menerbitkan. Halaman detail kampanye menandai kabar sebagai “ditulis penggalang” dan laporan sebagai “diperiksa operator”. Catatan yang sudah terbit tidak dapat diubah; perbaikannya adalah laporan koreksi yang menggantikan catatan lama, dan operator dapat menarik catatan dengan alasan yang tetap tampil. Halaman publik membedakan dana terkumpul, nominal yang dilaporkan digunakan (hanya laporan realisasi yang sedang terbit; total tidak boleh melebihi donasi terkonfirmasi), dan sisanya. Angka itu pernyataan penggalang yang diperiksa operator terhadap lampiran, bukan saldo rekening atau bukti bantuan diterima. Kabar dan laporan **belum** dicatat ke registry blockchain.

Pemeriksaan lokal (tanpa pembayaran atau broadcast publik):

```bash
cd backend
bun run typecheck
NODE_ENV=test bun test
# Integrasi Chromium → frontend → API → PGlite; hanya gateway berupa fixture.
NODE_ENV=test CROWDFUNDING_BROWSER=1 bun test test/crowdfunding_browser.test.ts
NODE_ENV=test CROWDFUNDING_BROWSER=1 bun test test/crowdfunding_updates_browser.test.ts
cd ../frontend
bun run typecheck
bun run build
cd ../sc
forge test --match-contract CampaignEvidenceRegistryTest
```

Tes browser memerlukan Playwright di frontend dan Chromium lokal; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` dapat dipakai untuk memilih executable selain `/usr/bin/chromium`.

Regresi driver PostgreSQL nyata tersedia di `backend/test/crowdfunding-postgres.test.ts`. Aktifkan dengan `NODE_ENV=test` dan `CROWDFUNDING_POSTGRES_TEST_URL` yang menunjuk PostgreSQL lokal. Tes memakai tabel TEMP di dalam transaksi, tidak mengubah tabel aplikasi, dan memeriksa agar aggregate JSON tetap berupa object setelah penulisan serta rollback.

Registry baru: `sc/src/CampaignEvidenceRegistry.sol`. Administrator dan pencatat harus berbeda. Script `sc/script/DeployCampaignEvidenceRegistry.s.sol` tetap dibatasi ke chain lokal. Deployment testnet terpisah memakai `backend/src/scripts/deploy-campaign-registry.ts`: default dry-run, broadcast hanya dengan `--broadcast`, chain wajib Arbitrum Sepolia `421614`, batas pengeluaran deployer 0,001 ETH testnet termasuk pengisian saldo gas pencatat, dan menolak deployment ulang bila alamat/jurnal sudah ada. Jangan menaruh private key pada argumen CLI.

**Snapshot deployment 9 Oktober 2026:** registry kampanye di Arbitrum Sepolia adalah [`0x45239b7e7db0cdddd25dcdd3bf88f31acd1dbcba`](https://sepolia.arbiscan.io/address/0x45239b7e7db0cdddd25dcdd3bf88f31acd1dbcba). Receipt deploy, peran admin/pencatat, kecocokan bytecode, dan satu pencatatan sintetis sudah diperiksa pada saat deployment. Detail transaksi tersimpan di [`docs/deployments/2026-10-09-campaign-registry-arbitrum-sepolia.json`](docs/deployments/2026-10-09-campaign-registry-arbitrum-sepolia.json). Ini snapshot historis, bukan pengganti pemeriksaan RPC terkini. Catatan sintetis bukan donasi atau bukti penyaluran. Registry lembaga lama tidak diganti.

Konfigurasi lokal disimpan di `backend/.env`: `CAMPAIGN_REGISTRY_ADDRESS`, `CAMPAIGN_CHAIN_ID`, `CAMPAIGN_CHAIN_RPC_URL`, dan `CAMPAIGN_RECORDER_PRIVATE_KEY`. Restart backend setelah mengubah environment. Backend memproses antrean bukti ketika registry dikonfigurasi dan `DEPLOYMENT_PENDING` tidak aktif; akun pencatat memerlukan saldo ETH testnet untuk gas. Deployment registry tidak membuktikan izin penggalangan, pembayaran terkonfirmasi, atau bantuan diterima.

## Dokumentasi historis protokol zakat

> Klaim alamat deployment, framework, dan status ZK di bawah bukan konfigurasi kampanye infak aktif. Frontend aktif berada di `frontend/` (TanStack Start/React), backend di `backend/` (Bun/Hono); jangan memakai perintah `cd fe` di bagian historis untuk menjalankan aplikasi aktif. Untuk snapshot deployment lembaga, lihat `docs/deployments/` dan ADR terkait; snapshot bukan pemeriksaan RPC terkini.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.31-blue.svg)](https://soliditylang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.1.1-black.svg)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Noir](https://img.shields.io/badge/Noir-1.0.0--beta.21-purple.svg)](https://noir-lang.org/)

Privacy-preserving zakat donations using UltraHONK zero-knowledge proofs on Ethereum Sepolia. Donors contribute zakat with cryptographic anonymity while maintaining verifiable Sharia compliance and institutional accountability.

> **⚠️ ZK verification status — read before evaluating this repo.**
> The circuits are real, compile, and produce valid proofs off-chain. **On-chain
> proof verification is not deployed.** The deployed `HonkVerifier` is a
> fail-closed stub returning `false`, so `donateZK` / `donateZKPrivate` revert;
> `Groth16Verifier` is likewise a fail-closed placeholder. The blocker is code
> size: the Barretenberg-generated verifier is 33,880 bytes of deployed
> bytecode against the EIP-170 limit of 24,576, so it cannot be deployed as a
> single contract. Donations work; the ZK privacy tier does not yet.
> See `sc/src/DAO/verifiers/HonkVerifier.sol` and `security-analysis-corrections.md`.

- **Testnet**: [donate.tawf.foundation](https://donate.tawf.foundation)
- **Live Sepolia Protocol Contract**: [`0x6014542ce8f759946aa6f3f9af54fb91685065a5`](https://sepolia.etherscan.io/address/0x6014542ce8f759946aa6f3f9af54fb91685065a5)
- **Multi-Sig Safe DPS Address**: [`0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1`](https://app.safe.global/home?safe=sep:0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1)
- **Settlement Merkle Root Verifier**: SHA-256 in-browser / WebAssembly
- **Zero-Knowledge Privacy Proofs**: Groth16 SnarkJS circuit over BN254

---

## 🚀 Deployed Contracts & Live Infrastruktur (Sepolia L1)

| Komponen | Alamat Kontrak / Link | Deskripsi |
|---|---|---|
| **ZakatProtocolL1** | `0x6014542ce8f759946aa6f3f9af54fb91685065a5` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x6014542ce8f759946aa6f3f9af54fb91685065a5) |
| **Circle USDC (Sepolia)** | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238) |
| **Deployer / Admin / Relayer** | `0x5e9B652C4E8a013f6fAb69F0b55377c408B59968` | [View on Sepolia Etherscan](https://sepolia.etherscan.io/address/0x5e9B652C4E8a013f6fAb69F0b55377c408B59968) |

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Deployed Contracts (Sepolia)](#deployed-contracts-sepolia)
- [Quick Start](#quick-start)
- [Circuit Performance](#circuit-performance)
- [Project Structure](#project-structure)
- [Smart Contract Architecture](#smart-contract-architecture)
- [ZK Pipeline](#zk-pipeline)
- [Frontend Features](#frontend-features)
- [Testing](#testing)
- [Benchmarks](#benchmarks)
- [Paper](#paper)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Overview

ZKT addresses a critical gap in blockchain-based zakat systems: all existing platforms expose complete donor-recipient transaction records on public ledgers, violating Islamic principles of dignity preservation (nafs protection in maqasid al-shariah).

**Key features:**
- **Noir circuit** (29 ACIR opcodes) encoding nisab + hawl + pedersen nullifier verification
- **UltraHONK proofs** generated via Barretenberg v5.0.0-nightly (270ms avg), off-chain
- **On-chain verification is NOT live** — see the status note below
- **Solidity contracts** deployed on Ethereum Sepolia testnet (chain 11155111)
- **Next.js 16** frontend with wagmi/XellarKit wallet connectivity
- **Privacy tier toggle** supporting Public and Private donation modes

## Architecture

```
Donor Frontend (Next.js 16 + wagmi/XellarKit)
    │  wallet connect, tier select, private inputs
    ▼
Off-Chain Proving (Noir + Barretenberg v5.0.0-nightly)
    │  nargo compile → nargo execute → bb prove UltraHONK
    │  29 ACIR opcodes, 270ms avg prove, 10ms avg verify, 8,384 bytes proof
    ▼
Ethereum Sepolia (Solidity contracts)
    │  ZKTCore.donate() → PoolManager.donate()
    │  → DonationReceiptNFT.mint() → receipt SBT to donor
    ▼
Donor receives soulbound NFT receipt (proof of zakat payment)
```

The intended ZK path — `HonkVerifier.verify() → ZKTCore.donateZK() →
NullifierRegistry.spend()` — is wired end to end in code but **inert**: the
deployed verifier returns `false`, so `donateZK` reverts. Only the public
donation path above is functional today.

## Deployed Contracts (Ethereum Sepolia, chain 11155111)

V10 deployment. These are the addresses the frontend actually uses — they match
`fe/lib/abi.ts` and `sc/broadcast/V10Deploy.s.sol/11155111/run-latest.json`.
(The table here previously listed V9 addresses, none of which the app used.)

**ZK layer** — redeployed by `sc/script/V10Deploy.s.sol`:

Redeployed 2026-07-26 at block 11350675 (tx `0xef7cd594…` for ZKTCore).

| Contract | Address |
|----------|---------|
| ZKTCore | `0x28Eb1b95dFf00B2f876eaE24024B4e501710A287` |
| ShariaReviewManager | `0x3A968cDc9CFC2f3aDFab4733415943E12B72a953` |
| PrivateDonationPool | `0xe8908AD46ecC4A7F7e0e634BEB0e696bd497c846` |
| HonkVerifier | `0x1696c9e54c425760cF0E46181CE91A57A0ca8369` |
| Groth16Verifier | `0x7702B20B7302A82E3Cb09aAe7A72bb19A2d5Db84` |
| NullifierRegistry | `0x49a8C624c52A6A3F88Cc0073834dEf9b11326B56` |

Both verifiers report `isOperational() == false` and reject every proof.

**DAO layer (tawf-gov)** — deployed separately, unchanged by ZK-layer redeploys:

| Contract | Address |
|----------|---------|
| TawfPassport | `0x68A39923A1b80F3d48B4bd60FBe4187Ff2B0a38e` |
| TawfReputation | `0xEBc9637933575Aa3b047Dc19C4dE3706F03DC32c` |
| MockIDRX | `0x23A48A17ea36627ACF4Ce349C14d17c7e7F90BCE` |
| VotingNFT | `0xEb44b1409F34944cd137DD522e8FE9dD41533D33` |
| DonationReceiptNFT | `0x536a7249113E2f2c06a6E85acDa9B54dc79F5e58` |
| ProposalManager | `0x37f87a1913a8efAE70a39850f8c9e2C63AeC556B` |
| VotingManager | `0x4B6600f35592A83770A610a038c012186471143a` |
| MilestoneManager | `0xb0Fa6d4a2038ed85c9d16664BeeD169858D5f183` |
| ParticipationTracker | `0xA2313195cB23cC0AeB28E94f43DFBE0Fdc3d2e37` |
| PoolManager | `0x10bE98A362c18d690BEd51069F8D0c847cf2092A` |
| ZakatEscrowManager | `0x3534105fD0338dAF5Faa0BC97c760Fe861bd052e` |

Public donations are verified working end to end on Sepolia. The `donateZK`
benchmark recorded in `benchmarks/sepolia-donatezk-gas.txt` ran against the V9
`ZKVerifier`, which accepted any input without a pairing check — that
transaction is real but proves nothing cryptographically.

## Quick Start

### Prerequisites

- Node.js v22+, pnpm
- Foundry (forge + cast)
- Noir/nargo v1.0.0-beta.21+

### Frontend

```bash
cd fe
pnpm install
pnpm dev       # http://localhost:3000
pnpm build     # production build
```

### Smart Contracts

```bash
cd sc
forge build
forge test      # 44 tests passing
```

### ZK Circuit

```bash
cd noir-circuits/zkat_eligibility
nargo test      # 3 tests passing
nargo compile   # compile to ACIR
nargo execute   # generate witness
```

## Circuit Performance

All benchmarks run on a 16-core Linux machine with Barretenberg v5.0.0-nightly.

| Metric | Value |
|--------|-------|
| ACIR opcodes | 29 |
| Brillig opcodes | 44 |
| Expression width | 4 (Bounded) |
| Proof generation (avg) | 270 ms |
| Proof generation (min) | 239.0 ms |
| Proof generation (max) | 263.0 ms |
| Proof verification (avg) | 10 ms |
| Proof size | 8,384 bytes |
| Verification key size | 1,888 bytes |

On-chain gas consumption (Foundry gas report):

| Function | Gas (avg) |
|----------|-----------|
| `ZKTCore.donate()` | 490,187 |
| `ZKTCore.donateZK()` (e2e) | 721,345 |
| `ZKTCore.castVote()` | 132,909 |
| `ZKTCore.deploy` | 5,538,881 |
| `ZakatEscrowManager.donate()` | 30,884 |

## Project Structure

```
├── fe/                           # Next.js 16 frontend
│   ├── app/                      # App router pages (campaigns, zakat, dashboard, dao)
│   ├── components/
│   │   ├── donations/            # DonationDialog (public + private toggle)
│   │   ├── providers/            # Web3Provider (wagmi + XellarKit)
│   │   ├── shared/               # CampaignCard, ZakatCertificateModal
│   │   └── ui/                   # shadcn/ui components
│   ├── hooks/
│   │   ├── usePrivateDonation.ts # ZK donation pipeline
│   │   └── useWallet.ts          # Wallet state + donate()
│   └── lib/
│       ├── abi.ts                # All 16 contract addresses + ABIs
│   └── aztec-private-donation.ts  # Proof generation pipeline
│
├── sc/                           # Solidity smart contracts
│   ├── src/DAO/
│   │   ├── ZKTCore.sol           # Main orchestrator (v8, donateZK, donate, castVote)
│   │   ├── NullifierRegistry.sol # Nullifier tracking for double-donation prevention
│   │   ├── core/                 # ProposalManager, VotingManager, ShariaReviewManager,
│   │   │                          PoolManager, ZakatEscrowManager, MilestoneManager
│   │   └── verifiers/
│   │       └── HonkVerifier.sol  # IHonkVerifier interface
│   ├── src/tokens/               # MockIDRX, DonationReceiptNFT, VotingNFT, OrganizerNFT
│   ├── src/participants/         # ParticipationTracker
│   ├── script/
│   │   ├── DeployZKT.s.sol       # Full deployment script (16 contracts)
│   │   └── GenerateZKProof.mjs   # Off-chain proof generator
│   └── test/                     # Foundry tests (26 passing)
│
├── noir-circuits/
│   └── zkat_eligibility/         # Noir circuit (nisab + hawl + pedersen nullifier)
│
├── docs/diagrams/                # PlantUML sources + generated PNGs (6 diagrams)
├── benchmarks/                   # UltraHONK prove/verify logs, Forge gas reports
│
├── zk-private-zakat.tex          # IEEE conference paper (ICIMTech 2026)
└── zk-private-zakat.pdf          # Compiled PDF (6 pages, 33 references)
```

## Smart Contract Architecture

The system follows a modular architecture with ZKTCore as the central orchestrator:

```
ZKTCore (v8)
  ├── ZKVerifier           # verifies UltraHONK proofs (hash anchoring)
  ├── NullifierRegistry    # prevents double-donation (flat mapping)
  ├── ZakatEscrowManager   # fund custody + pool accounting (30-day timelock)
  ├── DonationReceiptNFT   # soulbound receipt SBT (IPFS metadata)
  ├── ProposalManager      # community proposal lifecycle
  ├── VotingManager        # tiered voting (VotingNFT-based)
  ├── ShariaReviewManager  # Sharia council review (Groth16 verifier)
  ├── PoolManager          # general donation pools
  └── MilestoneManager     # milestone-based fund release
```

**Access control**: Role-based (OpenZeppelin AccessControl) with ORGANIZER_ROLE, SHARIA_COUNCIL_ROLE, KYC_ORACLE_ROLE, and MINTER_ROLE.

**v8 E2E Flow** (all executed on-chain):
`createProposal → submitForCommunityVote → castVote → finalizeCommunityVote → createShariaReviewBundle → reviewProposal → finalizeShariaBundle → createCampaignPool → donateZK()`

## ZK Pipeline

The private donation flow:

```
1. Donor connects wallet (wagmi + XellarKit, Sepolia)
2. Selects privacy tier (Public/Private)
3. Provides amount + private eligibility inputs
4. Frontend calls /api/generate-proof → nargo execute → bb prove
5. UltraHONK proof generated (270ms avg, 8,384 bytes)
6. ZKTCore.donateZK() on Sepolia:
   → ZKVerifier.verify() → true
   → NullifierRegistry.spend() → nullifier marked spent
   → ZakatEscrowManager.donate() → fund transfer + pool accounting
   → DonationReceiptNFT.mint() → soulbound receipt SBT
7. Donor receives SBT receipt (proof of zakat payment)
```

## Frontend Features

- **Wallet connection**: wagmi + XellarKit (multi-wallet support)
- **Privacy tier toggle**: Public / Private switch with contextual notices
- **Quick amount buttons**: 10K, 50K, 100K, 500K IDRX
- **Campaign browsing**: Browse active zakat campaigns
- **Donation flow**: Two-step approval (IDRX.approve → ZKTCore.donate)
- **Certificate modal**: ZakatCertificateModal after successful donation
- **Dashboard**: Donor and organizer dashboards with transaction history
- **Chain enforcement**: Auto-switch to Sepolia with UI warning

## Testing

### Solidity (Foundry)

```bash
cd sc
forge test          # 44 tests passing
forge test --gas-report # full gas report
```

Key test suites:
- `ZKTCoreTest` — 11 tests (donation flow, voting, milestone management)
- `ShariaZKProofTest` — 22 tests (ZK proof submission, quorum verification, forgery regression)
- `CoreTeam.t.sol` — 8 tests (role management, access control)
- `TawfPassport.t.sol` — 3 tests (passport issuance)

### Noir Circuit

```bash
cd noir-circuits/zkat_eligibility
nargo test          # 3 tests (eligible, ineligible, hawl met)
```

### Frontend

```bash
cd fe
pnpm build          # production build verification
```

## Benchmarks

All benchmark logs are in `benchmarks/`:

| File | Content |
|------|---------|
| `ultrahonk-*.log` | 5 prove runs + 5 verify runs with timings |
| `forge-gas-*.log` | Complete Foundry gas report |
| `sepolia-donatezk-gas.txt` | Actual Sepolia tx gas used |

## Paper

The IEEE conference paper is at `zk-private-zakat.pdf` (6 pages, 33 references).

**Conference**: ICIMTech 2026 (International Conference on Information Management and Technology)

**Scope**: Blockchain Technologies and Fintech

**Section structure**: Introduction, Literature Review, Methodology, Results, Discussion, Conclusion

## Acknowledgments

- **pidi.id** — hackathon organizer
- **BINUS University** — Research Track program
- **Ethereum Jakarta** — technical support and guidance
- **Tawf Labs** — sharia consultation and research implementation

## License

Apache-2.0
