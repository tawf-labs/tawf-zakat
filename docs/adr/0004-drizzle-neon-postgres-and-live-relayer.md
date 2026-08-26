# ADR 0004: Drizzle ORM, Neon PostgreSQL Persistence, and Live On-Chain Relayer

## Status
Accepted

## Context
Pada fase MVP awal, backend Bun Hono menggunakan struktur data in-memory (`Map`) di `store.ts` untuk mencatat kuitansi donasi, secret salt, batch Merkle, dan proposal penyaluran. Meskipun fungsional untuk pengujian cepat, data hilang saat server restart dan relayer settlement belum terhubung secara otomatis ke smart contract L1 yang telah dideploy di Ethereum Sepolia (`0x72b60a0C37a78dF62295F88294E790083089f665`).

## Decision
Kami memutuskan untuk mengimplementasikan lapisan persistensi data produksi dan relayer otomatis dengan spesifikasi:
1. **Database & ORM**: Menggunakan **Drizzle ORM** dan **Neon PostgreSQL** (`@neondatabase/serverless` / `postgres`) pada runtime Bun backend.
2. **Skema Relasional**:
   - `donations`: `id`, `trxId` (unique), `donorName`, `isAnonymous`, `amountIDR`, `salt`, `batchId` (FK), `createdAt`.
   - `merkle_batches`: `id`, `batchNumber`, `merkleRoot`, `totalAmountIDR`, `itemCount`, `txHash`, `status` (*pending* / *settled_onchain*), `settledAt`.
   - `disbursement_proposals`: `id`, `proposalIdOnChain`, `currencyType`, `amount`, `asnafCategory`, `beneficiaryName`, `beneficiaryNIKMasked`, `beneficiaryHash`, `ipfsProofCID`, `periodId`, `status` (*Pending / Approved / Executed / Cancelled*), `cancelReason`, `approvedBy`, `createdAt`, `executedAt`.
3. **On-Chain Relayer Engine**:
   - Modul `backend/src/relayer.ts` menggunakan Viem `walletClient` dengan private key Relayer untuk memanggil `recordFiatBatchSettlement` pada smart contract Sepolia.
   - Endpoint `POST /api/relayer/settle-batch` untuk memicu agregasi batch dan broadcast transaksi L1 nyata.
4. **Live Web3 Wallet Interaction (Frontend)**:
   - Mengintegrasikan Viem browser provider (`window.ethereum`) pada komponen frontend (`DonateSection.tsx`, `GovernanceSection.tsx`, `TransparencyDashboard.tsx`) untuk memicu transaksi MetaMask nyata di Ethereum Sepolia.

## Consequences
### Positif:
- Seluruh data donasi, kuitansi, secret salt, dan proposal tersimpan permanen di Neon PostgreSQL.
- Transaksi agregasi batch fiat benar-benar tercatat on-chain di Sepolia L1 dengan link Etherscan nyata.
- Pengguna dan penandatangan Multi-Sig dapat berinteraksi langsung menggunakan dompet Web3 (MetaMask/Rabby).

### Negatif:
- Memerlukan konfigurasi `DATABASE_URL` (Neon Postgres) dan `PRIVATE_KEY` (Relayer) pada environment backend.
