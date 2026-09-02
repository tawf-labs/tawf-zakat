# ADR-0007: Clean Smart Contract Redeployment (Pristine 0-State) and Safe Multi-Sig Threshold Quorum Synchronization

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Tawf Labs Core Engineering & Sharia Governance Architecture Team
- **Consulted:** Safe.global (Gnosis Safe) Smart Account Protocol, Ethereum Sepolia EVM, Neon PostgreSQL

---

## 1. Context and Problem Statement

During live testnet integration with Ethereum Sepolia and Safe.global multi-sig accounts (`0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1`), three critical synchronization friction points were diagnosed:

1. **Role Authorization Revert (`Unauthorized` / Safe Error `GS013`)**:
   - Smart contract `ZakatProtocolL1.sol` enforces role-based access control. Safe account addresses must be explicitly granted `SHARIA_SUPERVISOR_ROLE`, `DEFAULT_ADMIN_ROLE`, and `RELAYER_ROLE` on L1 to execute proposal creation and multi-sig approvals without reverting.
2. **Proposal ID Off-Chain/On-Chain Mismatch**:
   - Initial database seeds populated mock proposal IDs (e.g. `#3929` or auto-increment `#201`), while the Sepolia smart contract maintains its own sequential counter (`proposalCounter = ++counter`). When Safe attempted to call `approveDisbursement(201)`, the call reverted with `ProposalNotFound` because `#201` had never been proposed on-chain.
3. **Premature Quorum UI Status Transition**:
   - When the first of two Safe owners confirmed a transaction in the Safe queue, the off-chain status prematurely transitioned to "Approved (Kuorum 2/3)", even though the multisig transaction had not met its 2-of-2 threshold and remained unexecuted on the blockchain.

---

## 2. Decision

We executed a comprehensive system-wide reset and synchronization:

### A. Pristine Smart Contract Redeployment (Zero-State)
- Redeployed `ZakatProtocolL1` on **Ethereum Sepolia** at:
  - **Contract Address**: [`0x6014542ce8f759946aa6f3f9af54fb91685065a5`](https://sepolia.etherscan.io/address/0x6014542ce8f759946aa6f3f9af54fb91685065a5)
  - **Initial State**: 0 Batches, 0 Proposals (`proposalCounter: 0`, `mustahikVaultIDR: 0`).
- Pre-granted the institutional Safe DPS address (`0xb4E4253e2aFfdC0710Cb9394b8C4E935F11B00f1`) all operational roles:
  - `SHARIA_SUPERVISOR_ROLE = true`
  - `DEFAULT_ADMIN_ROLE = true`
  - `RELAYER_ROLE = true`

### B. Clean Database Slate (Zero-Seed)
- Completely truncated Neon PostgreSQL tables (`donations`, `merkle_batches`, `disbursement_proposals`) and reset auto-increment sequences to `1`.
- Disabled auto-seeding on backend server startup to prevent artificial mock ID pollution.
- All subsequent proposals created in the DApp start synchronously from **Proposal ID #1** on both database and smart contract.

### C. Safe Multi-Sig Threshold Lifecycle Tracking
- Enhanced the backend (`backend/src/safe.ts` and `backend/src/index.ts`) with `getSafeTransactionDetails(safeTxHash)` querying the official Sepolia Safe Transaction Service.
- Added database tracking fields: `safe_status`, `safe_confirmations_count`, and `safe_confirmations_required`.
- Updated DApp UI (`GovernanceSection.tsx`) to display real-time threshold progress:
  - **1 of 2 Signatures**: Renders `⏳ Menunggu Tanda Tangan ke-2 Safe DPS (1/2 Ustadz)` with amil disbursement locked.
  - **2 of 2 Signatures & Executed**: Transitions to `Kuorum 2/3 Tercapai (Approved)` and unlocks disbursement execution.

---

## 3. Consequences

### Positive
- **100% Elimination of `GS013` Errors**: All proposal approvals and disbursements match exact on-chain IDs and authorized roles.
- **True Multisig Integrity**: Prevents single-signer bypass; full 2-of-2 Safe quorum is strictly enforced before funds or approvals unlock.
- **Clean Audit Trail**: Starting from index 1 provides a clean, sequential, and transparent history for demo evaluators and external auditors.

### Negative / Trade-offs
- Test proposals from previous contracts are purged and must be initiated fresh on the new contract.
