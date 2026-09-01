# Spec: Embedded Indexer, Public Role Governance Panel, and Unified Syariah Error Decoding

## Problem Statement

As the Zakat Transparency Protocol (ZAKAT-L1) deploys on Ethereum Sepolia and interacts with real-world users (Muzakki, Amil, Dewan Pengawas Syariah, and Independent Auditors), four systemic operational challenges exist:

1. **State Desynchronization & Untracked Inflow**:
   - Direct Web3 USDC deposits (`depositUSDC`) and off-platform multi-sig approvals performed directly on Safe.global bypass off-chain relayer endpoints. Without an active on-chain event indexer, the Neon PostgreSQL database lags behind L1 state, creating discrepancies between on-chain balances and off-chain accounting ledgers.
2. **Opaque Governance Roster & Lack of Role Administration UI**:
   - While the smart contract relies on OpenZeppelin `AccessControl` (`DEFAULT_ADMIN_ROLE`, `SHARIA_SUPERVISOR_ROLE`, `AUDITOR_ROLE`, `RELAYER_ROLE`), there is no public-facing interface where community members can audit the active roster of Sharia scholars (DPS) and licensed auditors. Furthermore, the Amil Admin has no intuitive DApp interface to grant or revoke operational roles on-chain.
3. **Cryptic EVM Revert Messages & Confusing User Feedback**:
   - When contract transactions revert (e.g. `DoubleClaimDetected`, `InsufficientVaultBalance`, `QuorumNotMet`, `Unauthorized`), users and amil staff receive raw hex codes or technical errors. There is no automated translation layer to express failures in human-readable, Sharia-compliant terminology.
4. **Missing Transaction Lifecycle Notifications & Brittle Error Boundaries**:
   - Users submitting transactions lack clear visual feedback across transaction states (Submitted ➔ Mined on Sepolia ➔ Explorer Link). Unhandled frontend runtime errors can cause full-page crashes rather than graceful recovery states.

## Solution

A complete three-tier upgrade delivering:

1. **Embedded Viem Event Indexer Engine**:
   - A background poller embedded in the Bun API server that queries Ethereum Sepolia RPC every 10 seconds in chunked 1,000-block intervals starting from deployment block `#11569000`.
   - Automatically synchronizes `USDCDeposited` into the unified `donations` ledger table (`paymentMethod = 'USDC'`, `status = 'SETTLED_ONCHAIN'`).
   - Synchronizes proposal lifecycle events (`DisbursementProposed`, `DisbursementApproved`, `DisbursementExecuted`, `DisbursementCancelled`) to PostgreSQL.
   - Synchronizes `RoleGranted` and `RoleRevoked` events to an active `role_members` registry table.
   - Exposes public APIs: `GET /api/indexer/status`, `GET /api/events`, and `GET /api/governance/roles`.
2. **Public Role Governance & Administration Panel (`/admin/roles`)**:
   - A dedicated page in TanStack Router providing a **Public Transparency View** of all active keyholders.
   - Visual badging of the Sharia Supervisory Board Safe Multi-Sig contract (`0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1`) with direct Safe.global links.
   - **Admin Execution Mode**: Connected admin wallets can invoke `grantRole` and `revokeRole` directly on Sepolia with real-time pre-flight checks and Sonner transaction feedback.
3. **Unified Syariah Error Decoding & Sonner UX Feedback System**:
   - Integrated `<Toaster richColors position="top-right" closeButton />` from `sonner` in root layout.
   - Custom `decodeContractError()` converting contract reverts (`DoubleClaimDetected` ➔ *"Mustahik ini sudah menerima hak zakat pada periode berjalan"*, `InsufficientVaultBalance` ➔ *"Saldo kas mustahik tidak mencukupi"*, etc.) into friendly Indonesian terms.
   - Reusable `useTxToast()` helper providing automated progress indicators with direct clickable links to Sepolia Etherscan.
   - Global React `<ErrorBoundary>` providing graceful fallback recovery cards in the Soft Syariah design theme.

## User Stories

1. As a Muzakki making a direct USDC zakat transfer on Sepolia, I want the protocol's database to automatically register my on-chain donation without requiring manual submission, so that the public transparency ledger immediately reflects my contribution.
2. As a Public Observer, I want to visit `/admin/roles` to inspect the exact Ethereum addresses authorized as Dewan Pengawas Syariah (DPS) and Independent Auditors, so that I can verify institutional integrity and prevent phantom governance.
3. As a Public Observer, I want to see a clear badge indicating that the DPS account is a multi-signature smart contract with a link to Safe.global, so that I know Sharia decisions cannot be unilateral.
4. As an Amil Super Administrator (`DEFAULT_ADMIN_ROLE`), I want to connect my wallet to `/admin/roles` and grant `AUDITOR_ROLE` or `SHARIA_SUPERVISOR_ROLE` to newly appointed board members through an on-chain transaction form, so that governance access is kept up to date.
5. As an Amil Super Administrator, I want to revoke access from retired committee members with a single confirmation dialog, so that compromised or inactive keys are immediately removed from the protocol.
6. As a non-admin visitor to `/admin/roles`, I want the grant/revoke buttons to be disabled with clear educational tooltips explaining that only the Admin can alter roles, so that I understand protocol security rules without encountering failed transactions.
7. As an Amil submitting a disbursement proposal, if I accidentally input a duplicate beneficiary NIK for the same period, I want to see an immediate toast stating *"Mustahik ini sudah menerima hak zakat pada periode berjalan (Pencegahan Double-Claim Aktif)"* instead of a cryptic EVM error code, so that I can correct the record.
8. As a DPS Scholar approving a proposal, I want to see a rich toast notification tracking transaction progress (*"Mengirim transaksi ke Sepolia L1..."* ➔ *"Persetujuan Berhasil! Lihat di Etherscan"*), so that I have immediate confirmation that my signature is recorded on L1.
9. As a Donor or Amil, if a transaction is rejected in my MetaMask wallet, I want to see a gentle notification stating *"Transaksi dibatalkan di wallet oleh pengguna"*, so that I understand no gas fee was spent and no state was changed.
10. As a Developer/System Administrator, I want to query `GET /api/indexer/status` to check the current block height, sync lag, and indexed event count, so that I can monitor indexer health and uptime.
11. As a User experiencing a localized UI rendering error, I want the application to show a clean Sharia-styled recovery card with a *"Muat Ulang Komponen"* button instead of a blank white screen, so that my overall session remains uninterrupted.

## Implementation Decisions

1. **Indexer Architecture**:
   - Embedded background worker inside `backend/src/indexer.ts` executed on server initialization.
   - Polling cadence: 10 seconds; Chunk size: 1,000 blocks per RPC call.
   - Start checkpoint: Block `#11569000` (Sepolia deployment).
   - Checkpoint storage: PostgreSQL table `indexer_state` with fields `id`, `last_indexed_block`, `last_sync_at`, `status`.
2. **Database Schema Additions**:
   - `onchain_events`: `id` (serial), `tx_hash` (text), `block_number` (integer), `event_name` (text), `contract_address` (text), `args_json` (text), `timestamp` (timestamp).
   - `role_members`: `id` (serial), `role_hash` (text), `role_name` (text), `account_address` (text), `is_active` (boolean), `granted_at_block` (integer), `revoked_at_block` (integer), `tx_hash` (text).
3. **Role Management Page (`/admin/roles`)**:
   - TanStack Router file-based route at `frontend/src/routes/admin/roles.tsx`.
   - Reads active members from backend endpoint `GET /api/governance/roles` and verifies wallet admin status via `useReadContract(hasRole)`.
   - Executes `grantRole` and `revokeRole` via Wagmi `useWriteContract`.
4. **Toast UX & Syariah Error Decoding System**:
   - Single root `<Toaster />` from `sonner` in `frontend/src/routes/__root.tsx`.
   - Translation utility `decodeContractError(error)` matching known custom error selectors (`0x...`) and revert error strings.
   - Global `<ErrorBoundary>` wrapping children inside `__root.tsx`.

## Testing Decisions

1. **Backend Indexer & API Seam Testing**:
   - Write integration tests in `backend/test/indexer.test.ts` verifying:
     - Checkpoint block retrieval and storage in `indexer_state`.
     - Event parsing and insertion into `onchain_events` and `role_members`.
     - Auto-sync of `USDCDeposited` into `donations` table.
     - HTTP responses for `/api/indexer/status`, `/api/events`, and `/api/governance/roles`.
2. **Frontend Build & Typecheck Verification**:
   - Verify that all new components, routes, and hooks pass strict TypeScript typechecking and Vite production build (`bun run build`).
3. **Behavioral Testing of Error Decoder**:
   - Test `decodeContractError` against all contract revert names, simulation failures, and user rejection errors to guarantee proper translation into Indonesian.

## Out of Scope

- Writing custom Subgraphs on The Graph hosted service (embedded backend Viem poller is utilized for complete zero-dependency local and cloud control).
- Automatic batching of role grants (roles are granted individually on-chain per institutional security policy).

## Further Notes

- Aligns directly with [ADR-0008](file:///home/harkon666/Dev/langit/zkt-hackathon/docs/adr/0008-embedded-indexer-role-governance-and-ux-error-handling.md) and [CONTEXT.md](file:///home/harkon666/Dev/langit/zkt-hackathon/CONTEXT.md).
