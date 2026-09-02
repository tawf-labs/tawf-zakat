# 03 — Public Role Governance & Administration Panel (`/admin/roles`)

## Parent
Spec: Embedded Indexer, Public Role Governance Panel, and Unified Syariah Error Decoding

## What to build
A dedicated `/admin/roles` frontend page in TanStack Router providing a dual-mode experience: **Public Transparency Mode** allowing any visitor to audit the active roster of Admin, Safe Multi-Sig DPS (`0xb4E4...00f1`), Auditor, and Relayer keyholders; and **Admin Execution Mode** allowing connected admin wallets to perform on-chain `grantRole` and `revokeRole` transactions with pre-flight checks, Wagmi contract execution, and rich Sonner toast feedback with Indonesian Syariah error decoding.

## Blocked by
- 01 — Embedded Viem Event Indexer Engine & Database Multi-Table Persistence
- 02 — Unified Syariah Error Decoding, Toast UX (Sonner), and Error Boundary

## Acceptance criteria
- [x] Route `/admin/roles` created and linked in the primary Navbar.
- [x] Roster grid renders 4 cards: `DEFAULT_ADMIN_ROLE`, `SHARIA_SUPERVISOR_ROLE`, `AUDITOR_ROLE`, `RELAYER_ROLE` populated via indexer API and verified on-chain.
- [x] Special indicator & link for the Safe.global Sharia Supervisory Board account (`0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1`).
- [x] Grant Role form allows entering an address, selecting a role, and executing `grantRole` on Sepolia L1.
- [x] Revoke Role dialog allows confirming and executing `revokeRole` on Sepolia L1.
- [x] Non-admin wallets receive disabled action buttons with clear explanatory tooltips.
- [x] All transaction interactions trigger Sonner toasts and Indonesian error decoding.
- [x] Frontend builds cleanly with zero errors.
