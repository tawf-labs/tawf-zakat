# ADR-0005: Hybrid Safe.global Signer Architecture and Dual-Receipt IPFS Disbursement Pipeline

- **Status**: Accepted
- **Date**: 2026-08-29
- **Deciders**: User, Antigravity

## Context and Problem Statement

Disbursement of zakat funds (87.5% mustahik pool) must comply with both Islamic Sharia standards (BAZNAS 8-Asnaf framework) and strict anti-corruption governance. 
Key challenges include:
1. **Multi-Sig Execution**: How multi-party signers (Amil, DPS/Sharia Supervisor, Auditor) authorize disbursements safely on EVM testnet/mainnet, and whether to use standard Safe.global (Gnosis Safe) accounts or purely custom logic.
2. **Privacy vs Verification (Anti-Doxxing & Anti-Double Claim)**: How to verify genuine beneficiaries (NIK) without public doxxing, in compliance with Indonesian Data Protection Law (UU PDP).
3. **Evidence Verifiability (Proof of Disbursement)**: How to guarantee that disbursed funds reached legitimate beneficiaries using decentralized storage (IPFS) across two currencies (Fiat IDR escrow vs USDC custody).

## Decision Drivers

- **Sharia & Regulatory Invariance**: Absolute enforcement of the 8 Asnaf categories and the 12.5% maximum Amil cut (`MAX_AMIL_BPS = 1250`).
- **Signer Interoperability**: Support for institutional signers (e.g., Safe Multisig wallets operated by Amil or Auditor boards) as role holders on Ethereum Sepolia / Arbitrum.
- **Privacy Preservation**: NIK must never be published in plaintext on-chain.
- **End-to-End Auditability**: Verifiable proof both *before* approval (Assessment/Eligibility Metadata) and *after* fund distribution (BAST / Delivery Receipt).

## Decision Outcome

Chosen Architecture: **Hybrid Safe.global Signer Model + Two-Stage Dual-Receipt IPFS Pipeline**.

### 1. Hybrid Multi-Sig Architecture
- Smart contract `ZakatProtocolL1.sol` remains the core domain engine enforcing Sharia invariants, Asnaf category validation, and `beneficiaryHash` mapping.
- Role holders (`DEFAULT_ADMIN_ROLE`, `SHARIA_SUPERVISOR_ROLE`, `AUDITOR_ROLE`) can be standard EOAs or **Safe.global Smart Accounts** (e.g. 2-of-3 internal Amil Safe or Institutional DPS Safe) connected via WalletConnect or Safe Apps.

### 2. Privacy-Preserving Beneficiary Hashing
- `beneficiaryHash = keccak256(abi.encodePacked(nik, fullName, secretSalt))`.
- Secret salt is secured in backend vault / authorized amil database; only 32-byte hash is recorded on-chain in `hasReceivedZakat[beneficiaryHash][periodId]`.

### 3. Two-Stage Intake & Dual-Receipt IPFS Workflow
- **Stage 1 (Pre-Approval Intake)**: Amil submits proposal with masked details. Backend uploads structured `Proposal Metadata JSON` and supporting documents to IPFS (`proposalMetadataCID`), then Amil calls `proposeDisbursement(...)` on L1.
- **Stage 2 (Approval & Quorum)**: DPS and Auditor inspect `proposalMetadataCID` and call `approveDisbursement(proposalId)`.
- **Stage 3 (Execution & BAST Receipt)**:
  - **For USDC**: Smart contract transfers USDC directly to `usdcRecipient`.
  - **For Fiat IDR**: Amil transfers fiat via Escrow Bank, uploads signed BAST and disbursement photos to IPFS (`disbursementReceiptCID`), then calls `executeDisbursement(proposalId)` to settle the IDR ledger state.

## Pros and Cons

### Pros
- Enables institutional Safe wallet signers without losing custom domain rules (12.5% invariant, 8 asnaf, double claim prevention).
- Zero PII leakage on public blockchain while guaranteeing anti-double claim integrity.
- Comprehensive end-to-end proof trail for muzakki and public audits.

### Cons
- Requires managing IPFS pinning and metadata synchronization between off-chain database and L1 events.
