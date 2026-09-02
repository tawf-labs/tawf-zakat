# Spec: End-to-End Multi-Sig Zakat Disbursement Pipeline with Hybrid Safe Signers and Dual-Receipt IPFS Evidence

**GitHub Issue:** [#26](https://github.com/tawf-labs/tawf-zakat/issues/26)

## Problem Statement

Muzakki (donors), auditors, and the public currently lack an end-to-end transparent mechanism to track how zakat funds are allocated, verified by Sharia authorities, and distributed to verified mustahik (beneficiaries). Specifically:
1. **Lack of Sharia Governance & Multi-Sig Transparency**: Before zakat funds are released, there is no integrated portal for the Sharia Supervisory Board (DPS) and Independent Auditors to review beneficiary dossiers, verify 8-Asnaf eligibility, and sign multi-sig authorizations.
2. **Privacy vs Anti-Corruption Paradox (UU PDP vs Fake Beneficiaries)**: Publishing full beneficiary identity (NIK) on-chain exposes vulnerable mustahik to doxxing and violates privacy laws, whereas omitting identity altogether allows malicious operators to disburse to fictitious recipients or claim duplicate payouts.
3. **Missing Proof of Disbursement (BAST)**: After disbursement, there is no tamper-proof repository connecting physical handover receipts (Berita Acara Serah Terima / BAST), bank transfer proof, and photos to immutable on-chain event logs across both Fiat (IDR) and Crypto (USDC) streams.

## Solution

Build an end-to-end Zakat Disbursement & Governance Pipeline that satisfies BAZNAS regulatory standards, Sharia requirements (8 Asnaf), and EVM L1 multi-sig execution:
1. **Two-Stage Intake & Dual-Receipt IPFS Pipeline**:
   - **Pre-Approval Stage**: Amil inputs the mustahik dossier. The system computes `beneficiaryHash = keccak256(abi.encodePacked(nik, fullName, secretSalt))` and pins structured `Proposal Metadata JSON` (with disguised PII and verification attachments) to IPFS (`proposalMetadataCID`).
   - **Post-Disbursement Stage**: Once approved and disbursed (either USDC transfer on-chain or Fiat Escrow transfer off-chain), Amil uploads the signed BAST receipt, bank transfer slip, and blurred handover photos to IPFS (`disbursementReceiptCID`).
2. **Hybrid Multi-Sig 2-of-3 Governance**:
   - Smart contract enforces that all disbursements require approvals from at least 2 out of 3 distinct roles: Operational Amil, Sharia Supervisor (DPS), and Independent Auditor.
   - Role holders can sign directly via standard EOA wallets or institutional **Safe.global Smart Accounts** (Gnosis Safe 2-of-3) connected through WalletConnect / Safe Apps.
   - Smart contract automatically enforces the 12.5% maximum Amil invariant ceiling (`MAX_AMIL_BPS = 1250`) and locks `hasReceivedZakat[beneficiaryHash][periodId]` to eliminate double claims.
3. **Unified Governance & Transparency Dashboard**:
   - Frontend provides dedicated views for Proposal Submission (Amil), Sharia & Audit Review (DPS/Auditor), Execution & BAST Upload (Amil), and Public Verifiable Records (Muzakki/Public).

## User Stories

1. As an Amil officer, I want to submit a new disbursement proposal through a structured form specifying the 8-Asnaf category, amount, currency (IDR/USDC), and supporting eligibility documents, so that the assistance program is properly documented.
2. As an Amil officer, I want the system to automatically generate a cryptographic `beneficiaryHash` using a secure salt, so that the mustahik's NIK is protected from public doxxing while remaining unique.
3. As an Amil officer, I want the proposal dossier to be pinned as a structured JSON object to IPFS (`proposalMetadataCID`), so that DPS and Auditor can inspect immutable proof before voting.
4. As an Amil officer, I want to create the on-chain proposal transaction on Sepolia L1 and have it synced to Neon DB, so that the proposal becomes actionable across the platform.
5. As a Sharia Supervisor (DPS), I want to see a list of pending disbursement proposals with their Asnaf classifications, requested amounts, and IPFS-hosted eligibility documents, so that I can evaluate their compliance with Islamic jurisprudence.
6. As a Sharia Supervisor (DPS), I want to approve or reject a proposal using my connected wallet (EOA or Safe.global Smart Account), so that my authorization is recorded as an immutable on-chain event.
7. As an Independent Auditor, I want to review the protocol's available vault balances and proposal budget before approving, so that funds are not over-committed.
8. As an Independent Auditor, I want to approve the proposal on-chain, so that once 2 out of 3 approvals are reached, the proposal status transitions to `Approved`.
9. As an Amil officer, I want to execute an approved USDC proposal on-chain, so that the smart contract automatically transfers tokens from the custodial vault to the beneficiary's wallet address.
10. As an Amil officer, I want to disburse fiat IDR funds from the Bank Escrow to the mustahik and upload the signed BAST (Berita Acara Serah Terima) and delivery photo to IPFS (`disbursementReceiptCID`), so that post-distribution proof is permanently recorded.
11. As an Amil officer, I want to execute the approved IDR proposal on-chain with the BAST CID, so that the L1 ledger accounting balances (`mustahikVaultIDR` and `totalDisbursedIDR`) are updated.
12. As a smart contract, I want to verify that `hasReceivedZakat[beneficiaryHash][periodId]` is false before releasing funds and set it to true upon execution, so that double claims and duplicate beneficiary fraud are mathematically impossible.
13. As a Sharia Supervisor or Amil Admin, I want to cancel a pending proposal with a documented reason if the mustahik is found ineligible, so that locked allocations are freed.
14. As a Muzakki (donor), I want to explore all executed disbursements in the Public Transparency Dashboard, view the Asnaf distribution breakdown, and inspect IPFS BAST receipts and Etherscan transaction links, so that I have complete confidence my zakat reached those in need.

## Implementation Decisions

### Modules to be Built / Enhanced:
- **Backend Governance API (`backend/src/`)**:
  - `POST /api/proposals`: Intake proposal form data, calculate `beneficiaryHash`, upload structured `Proposal Metadata JSON` to IPFS, and insert into `disbursement_proposals` table.
  - `GET /api/proposals`: Return all proposals with filtering by status (`Pending`, `Approved`, `Executed`, `Cancelled`), asnaf category, and currency type.
  - `POST /api/proposals/:id/bast`: Upload BAST document, bank slip, and delivery photos to IPFS, generate `disbursementReceiptCID`, and link to the proposal record.
  - `POST /api/proposals/:id/sync-tx`: Sync on-chain status changes (`proposeDisbursement`, `approveDisbursement`, `executeDisbursement`, `cancelProposal`) with Neon DB.
- **Database Schema (`disbursement_proposals` table in Neon PostgreSQL)**:
  - Fields: `id`, `proposalIdOnChain`, `currencyType` (0=IDR, 1=USDC), `amount`, `asnafCategory` (1-8), `beneficiaryHash`, `disguisedName`, `proposalMetadataCID`, `disbursementReceiptCID`, `periodId`, `usdcRecipient`, `approvalCount`, `status` (`PENDING`, `APPROVED`, `EXECUTED`, `CANCELLED`), `proposedBy`, `executedTxHash`, `createdAt`, `executedAt`.
- **Smart Contract Governance (`ZakatProtocolL1.sol` on Sepolia L1)**:
  - Retain and leverage the live multi-sig functions (`proposeDisbursement`, `approveDisbursement`, `cancelProposal`, `executeDisbursement`).
  - Ensure role compatibility with both EOA and Safe.global multi-sig contract addresses.
- **Frontend Governance & Disbursement Portal (`frontend/src/`)**:
  - `GovernanceSection.tsx`: Tabbed governance portal featuring:
    - Tab 1: *Ajukan Proposal Bantuan* (Amil Submission Form with document uploader and estimated disbursement preview).
    - Tab 2: *Meja Verifikasi & Approval* (DPS & Auditor Review Table with IPFS dossier preview and One-Click Sign / Approve action).
    - Tab 3: *Eksekusi Penyaluran & BAST* (Amil Execution Table with BAST upload and L1 settlement trigger).
    - Tab 4: *Audit Trail & Bukti Penyaluran* (Public Transparency Table with IPFS BAST viewer and Etherscan links).

## Testing Decisions

- **Testing Philosophy**: Test external behavior through public API contracts, smart contract transactions, and rendered UI workflows, rather than mocking internal helper functions.
- **Modules to be Tested**:
  1. **Backend Integration Tests (`backend/test/` via Bun Test)**:
     - Test `POST /api/proposals` validation, `beneficiaryHash` calculation, and IPFS mock/live upload.
     - Test `GET /api/proposals` filtering and status transitions.
     - Test `POST /api/proposals/:id/bast` receipt attachment.
  2. **Smart Contract Tests (`sc/test/` via Foundry `forge test`)**:
     - Test 2-of-3 quorum requirement (1 approval fails to execute, 2 approvals execute successfully).
     - Test anti-double claim check (`DoubleClaimDetected` error on duplicate `beneficiaryHash` + `periodId`).
     - Test multi-unit ledger balance deduction for IDR and real token transfer for USDC.
     - Test invariant lock preventing non-role callers from approving or proposing.
  3. **Frontend Typecheck & Build Validation (`bun run build`)**:
     - Verify full TypeScript type-safety across Viem client hooks, Wagmi mutations, and TanStack Start route components.

## Out of Scope

- Automated direct bank disbursement via banking APIs (simulated via Escrow Bank transfer + BAST receipt).
- ZK Snark proofs for beneficiary identity (using Salted Keccak256 hash as agreed).
- Multi-chain deployment to Arbitrum mainnet (Ethereum Sepolia L1 is the primary testnet network).

## Further Notes

- Aligns with ADR-0002, ADR-0003, ADR-0004, and ADR-0005.
- Complies with BAZNAS 8-Asnaf framework and Indonesian Personal Data Protection (UU PDP) regulations.
