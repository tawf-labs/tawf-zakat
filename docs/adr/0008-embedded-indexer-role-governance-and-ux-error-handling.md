# ADR-0008: Embedded Backend Event Indexer, Public Role Governance Panel, and Unified Syariah Error Decoding

- **Status:** Accepted
- **Date:** 2026-09-01
- **Deciders:** Tawf Labs Core Engineering, Sharia Governance & UX Team
- **Consulted:** Ethereum Sepolia EVM, Bun + Hono API, Drizzle ORM + Neon PostgreSQL, TanStack Router + Sonner

---

## 1. Context and Problem Statement

As the Zakat Transparency Protocol (ZAKAT-L1) scales its operational and governance capabilities on Ethereum Sepolia, three critical engineering requirements emerged:

1. **State Desynchronization & Inflow Automation**:
   - Off-chain PostgreSQL and on-chain EVM states diverged when direct USDC donations occurred (`USDCDeposited`) or when multi-sig actions were executed externally via Safe.global UI without passing through the frontend relayer.
2. **Opaque Governance Membership & Role Administration**:
   - The smart contract utilizes OpenZeppelin `AccessControl` (`DEFAULT_ADMIN_ROLE`, `SHARIA_SUPERVISOR_ROLE`, `AUDITOR_ROLE`, `RELAYER_ROLE`), but lacked a public web interface where community members can audit the active roster of Sharia scholars (DPS) and independent auditors, or where the Amil Admin can grant/revoke operational roles on-chain.
3. **Cryptic Error Feedback & Fragile UX**:
   - Raw EVM revert strings/hex data (e.g. `DoubleClaimDetected`, `QuorumNotMet`, `UserRejectedRequestError`) cause user confusion among non-technical donors and amil staff. Missing global notification toasts and error boundaries left users without clear transaction lifecycle feedback.

---

## 2. Decision

We implemented a three-tier architecture upgrade across backend, database, and frontend:

### A. Embedded Viem Event Indexer Engine
- **Engine Type**: Embedded background polling engine in the Bun API server (`backend/src/indexer.ts`), querying Sepolia RPC every 10 seconds with chunked block batching (max 1,000 blocks per loop) from contract deployment block `#11569000`.
- **Database Schema Extensions** (`backend/src/db/schema.ts`):
  - `indexer_state`: Tracks `last_indexed_block` and health timestamp.
  - `onchain_events`: Immutable append-only event log (`tx_hash`, `block_number`, `event_name`, `args_json`, `timestamp`).
  - `role_members`: Live active roster of role holders (`role_hash`, `role_name`, `account_address`, `is_active`, `granted_at_block`, `revoked_at_block`).
- **Automated Bookkeeping**:
  - Automatically records `USDCDeposited` into the unified `donations` table (`payment_method = 'USDC'`, `status = 'SETTLED_ONCHAIN'`).
  - Automatically updates proposal lifecycle states on `DisbursementProposed`, `DisbursementApproved`, `DisbursementExecuted`, and `DisbursementCancelled`.
- **Public API Endpoints**:
  - `GET /api/indexer/status`: Indexer sync health and last block.
  - `GET /api/events`: Searchable on-chain event stream.
  - `GET /api/governance/roles`: Active role assignments.

### B. Public Role Governance & Administration Panel (`/admin/roles`)
- **Route**: Dedicated TanStack Router page at `/admin/roles` accessible from the top navigation bar.
- **Roster & Safe Multisig Badging**:
  - Displays cards for all 4 roles with active address rosters.
  - Automatically identifies and badges the Sharia Supervisory Board Safe Multi-Sig contract (`0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1`), providing direct links to Safe.global web app.
- **Dual-Mode UX (Public Audit vs Admin Execution)**:
  - **Public Mode (Read-Only)**: Anyone can inspect who holds governance keys (Anti-Corruption transparency).
  - **Admin Mode (On-Chain Execution)**: Connected wallets with `DEFAULT_ADMIN_ROLE` can invoke `grantRole` and `revokeRole` directly via Wagmi with real-time pre-flight checks and Sonner feedback.

### C. Unified Syariah Error Decoding & Sonner UX Feedback System
- **Sonner Toast System**: Configured `<Toaster richColors position="top-right" closeButton />` in root layout (`__root.tsx`) with helper `useTxToast()`.
- **Contract Error Decoder** (`frontend/src/lib/errorHandler.ts`):
  - Translates EVM reverts into human-friendly Indonesian Sharia terms (`DoubleClaimDetected` $\rightarrow$ *"Mustahik ini sudah menerima hak zakat pada periode berjalan"*, `QuorumNotMet` $\rightarrow$ *"Penyaluran memerlukan minimal 2 persetujuan dari DPS & Auditor"*, `InsufficientVaultBalance` $\rightarrow$ *"Saldo kas mustahik tidak mencukupi"*).
- **React Error Boundary**: Added at layout level to gracefully catch rendering crashes with one-click recovery.

---

## 3. Consequences

### Positive
- **Guaranteed Zero-Drift Sync**: Database automatically stays in sync with on-chain events regardless of where transactions originate.
- **Auditable Sharia Separation of Powers**: Full visibility over who governs the protocol at any block height.
- **Superior User Experience**: Instant, clear, and reassuring transaction feedback with direct Sepolia Etherscan verification links.

### Negative / Trade-offs
- Embedded polling consumes minimal Sepolia RPC bandwidth; mitigated by chunked ranges and indexed state checkpoints.
