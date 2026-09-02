# ADR-0006: Separation of Powers — Pre-Disbursement DPS Sharia Approval via Safe.global & Ex-Post Independent Auditor Attestation

- **Status:** Accepted
- **Date:** 2026-08-29
- **Deciders:** Tawf Labs Core Architecture Team
- **Consulted:** Sharia Governance Standards (BAZNAS, DSN-MUI, PSAK 109 / SAS 109)

---

## 1. Context and Problem Statement

In the initial iteration, disbursement proposals used a flat 2-of-3 counter where Amil, Dewan Pengawas Syariah (DPS), and Auditor were treated symmetrically as peers in voting before funds were released.

However, in professional Sharia accounting and regulatory governance (BAZNAS & DSN-MUI regulations):
1. **Audit Independence Principle (Separation of Powers)**:
   An external/independent auditor must never vote or sign off on operational disbursements *ex-ante* (before execution). Doing so creates an irreconcilable conflict of interest, stripping the auditor of independence during annual post-disbursement audits.
2. **Role of Dewan Pengawas Syariah (DPS)**:
   DPS is an internal collegial council of Sharia scholars (typically 3 to 5 scholars) responsible for verifying that beneficiaries strictly meet the 8 Asnaf criteria under Islamic jurisprudence before funds can be released.
3. **Role of Auditor**:
   The Auditor operates *ex-post* (after disbursement) by cross-referencing bank escrow records, BAST proofs on IPFS, and anti-double claim invariants, then issuing an on-chain Attestation / Audit Opinion (Wajar Tanpa Pengecualian / WTP).

---

## 2. Decision

We separate the governance lifecycle into two distinct stages:

### Stage A: Pre-Disbursement Approval (Amil Proposal + DPS Multi-Sig Veto)
1. **Amil (Operational)** submits the proposal with disguised name, salted NIK hash (UU PDP), and intake assessment dossier to IPFS.
2. **Dewan Pengawas Syariah (DPS)** reviews the IPFS dossier and submits cryptographic approvals.
   - The DPS is represented on-chain by an institutional **Safe.global Multisig Account** (e.g., 2-of-3 internal scholar signatures).
   - Approval by the DPS is a mandatory precondition (*Sharia Veto*) before any disbursement can occur.
   - Live pending multi-sig signatures are tracked via the Safe Transaction API queue.

### Stage B: Disbursement & BAST Generation
1. Once DPS approval is confirmed on-chain, Amil executes the payout:
   - For USDC: Direct smart contract vault transfer to beneficiary address.
   - For IDR: Bank transfer from Escrow + digital BAST & receipt upload to Pinata IPFS.

### Stage C: Ex-Post Independent Auditor Attestation
1. Auditor inspects historical settled batches and disbursements with their dual IPFS proofs (Pre-Approval Dossier + Post-Disbursement BAST).
2. Auditor signs an on-chain **Cryptographic Attestation** (Audit Opinion / Stamp) certifying compliance with accounting standards (PSAK 109) and absence of double-claims.
3. If discrepancies or fraudulent claims are detected, Auditor can trigger an on-chain Anomaly Flag.

---

## 3. Consequences

### Positive
- **100% Sharia & Regulatory Compliance**: Conforms directly to BAZNAS and DSN-MUI institutional governance structures.
- **Zero Conflict of Interest**: Preserves strict independence for external auditors.
- **Production-Ready Dynamic Scaling**: DPS members can be updated, rotated, or expanded inside their Safe.global account without redeploying the core protocol contracts.
- **Real-Time Visibility**: Donors and public observers can track pending multi-sig approvals and post-audit attestations.

### Negative / Trade-offs
- Requires integration with the Safe Transaction Service API to display real-time pending multi-sig progress in the dApp interface.
