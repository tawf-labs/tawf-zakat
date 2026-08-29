# Spec: Production-Ready DPS Safe.global Multi-Sig Queue & Ex-Post Auditor Attestation Engine

## Problem Statement

In institutional Islamic charitable governance (BAZNAS, DSN-MUI, and PSAK 109 / SAS 109 Sharia Accounting standards):
1. **Auditor Conflict of Interest**: External auditors must never participate in pre-disbursement voting. Voting on daily cash releases strips auditors of their professional independence when conducting post-disbursement audits.
2. **Collegial DPS Membership Dynamics**: Dewan Pengawas Syariah (DPS) operates as a collegial committee of multiple Sharia scholars (typically 3 to 5 scholars). Their voting occurs inside an institutional Safe.global Multisig Account (requiring 2-of-3 internal scholar signatures).
3. **Multi-Sig Visibility Gap**: When an initial DPS scholar signs a proposal in Safe.global, the transaction sits in the off-chain Safe Transaction Service queue until the threshold is met. Donors and amil administrators currently cannot see whether a proposal is actively being reviewed or pending additional scholar signatures.
4. **Lack of Independent Attestation**: Auditors need a dedicated portal to inspect dual-receipt IPFS evidence (intake dossier + bank transfer BAST), verify anti-double claim invariants, and submit verifiable on-chain Audit Opinions (Attestations) certifying compliance.

## Solution

A production-grade, three-tier separation-of-powers governance and audit system:
1. **Pre-Disbursement Veto by DPS Safe.global**:
   - Amil submits proposal with salted privacy hash (UU PDP) and intake dossier to IPFS.
   - Institutional Safe.global DPS account reviews and approves on-chain.
2. **Real-time Safe Multi-Sig Queue Tracking**:
   - Integration with the Safe Transaction Service API to track pending signatures in real time (e.g. `1/2 Signatures - Waiting for Scholar 2`).
3. **Disbursement & BAST Receipt Generation**:
   - Upon confirmed DPS quorum, Amil executes payout (USDC transfer on-chain or Bank transfer from Escrow) and uploads signed digital BAST to Pinata IPFS.
4. **Ex-Post Auditor Attestation Workspace**:
   - Independent Auditors inspect historical disbursements and dual IPFS receipts.
   - Auditors publish on-chain Cryptographic Attestations (Wajar Tanpa Pengecualian / WTP or Anomaly Flag).
   - Public Transparency Dashboard displays verified audit stamps alongside historical records.

## User Stories

1. As a Head of the Dewan Pengawas Syariah (DPS), I want to view all pending zakat disbursement proposals along with their IPFS assessment dossiers, so that I can evaluate whether the beneficiary qualifies under the 8 Asnaf categories.
2. As a DPS Sharia Scholar, I want to sign a proposal approval using my personal hardware wallet or MetaMask connected to our institutional Safe.global multisig account, so that our council's approval is cryptographically verified.
3. As an Amil Administrator, I want to see the real-time status of our proposal in the Safe.global multi-sig queue (including which scholars have signed and how many signatures remain), so that I know when funds are ready for disbursement.
4. As a second DPS Scholar, I want to see pending multi-sig transactions in our dApp governance portal, so that I can provide the final required signature to meet the 2-of-3 threshold without leaving the portal.
5. As a Beneficiary Care Officer (Amil), I want the system to unlock the disbursement button only after the DPS Safe.global quorum has been fully validated on-chain, so that no funds can ever be released without Sharia authorization.
6. As an Amil Operations Officer, I want to input bank transfer reference numbers and upload scanned BAST receipts to Pinata IPFS upon bank execution, so that physical cash delivery is permanently documented.
7. As an Independent Auditor (KAP / BAZNAS Auditor), I want a dedicated Auditor Workspace to review historical disbursement batches without being pressured into operational sign-offs, so that my professional audit independence is preserved.
8. As an Independent Auditor, I want to compare pre-approval intake dossiers against post-disbursement BAST receipts and bank transaction hashes, so that I can detect any discrepancies or phantom beneficiaries.
9. As an Independent Auditor, I want to issue an on-chain Cryptographic Attestation (Audit Stamp WTP) with an attached audit report IPFS CID, so that donors and regulators have immutable proof of institutional compliance.
10. As a Muzakki (Zakat Donor), I want to see auditor certification badges and dual IPFS links on the public transparency dashboard, so that I have 100% confidence that my zakat was distributed according to Islamic law.
11. As a Public Observer, I want to filter the audit trail by Asnaf category and audit status (Audited WTP vs Pending Audit), so that I can inspect the distribution of charitable funds across Indonesia.

## Implementation Decisions

1. **Separation of Powers Architecture**:
   - Pre-disbursement approval is exclusively restricted to the operational Amil and the institutional DPS Safe account (`SHARIA_SUPERVISOR_ROLE`).
   - Post-disbursement auditing is handled via an independent Auditor Attestation engine.
2. **Safe Transaction API Client**:
   - Backend/Frontend service connects to `https://safe-transaction-sepolia.safe.global/api/v1/safes/{safeAddress}/multisig-transactions/` to poll and display pending multi-sig transactions, confirmations list, and execution status.
3. **Auditor Attestation Schema & Endpoints**:
   - `POST /api/audit/attest`: Records auditor attestation, audit opinion ("WTP" / "Dispute"), notes, and audit report IPFS CID.
   - `GET /api/audit/overview`: Returns institutional audit metrics, audited percentage, and unverified disbursement items.
4. **Smart Contract Auditor Attestation Registry**:
   - Support for `attestDisbursement(proposalId, auditReportCID, isClean)` to record auditor stamp directly on Ethereum Sepolia L1.
5. **Auditor Attestation Workspace Component**:
   - Dedicated UI tab in the dashboard for licensed auditors to review, verify, and stamp disbursements with live Web3 signatures.

## Testing Decisions

1. **Seam Testing via Backend API & Relayer**:
   - Test suite tests the full lifecycle through HTTP boundary (`/api/proposals`, `/api/audit/attest`, `/api/proposals/:id/bast`).
   - Mocking Safe Transaction API responses to simulate `1/2 confirmations` progressing to `2/2 confirmations`.
2. **Smart Contract Role & Invariant Testing**:
   - Verify that non-auditor accounts cannot submit audit attestations.
   - Verify that proposals without DPS approval cannot be executed.
3. **End-to-End Governance & Audit Test**:
   - Simulated full flow: Proposal Intake ➔ Safe DPS Signatures (1/2 ➔ 2/2) ➔ Execution with BAST ➔ Auditor Attestation.

## Out of Scope

- Automated bank API withdrawal (requires Indonesian Central Bank BI-FAST corporate host-to-host license; manual reference input + BAST upload is used for production-grade escrow).
- Deploying custom ZK circuits on Midnight network (deferred until Midnight testnet reaches mainnet stability; EVM Sepolia + Pinata IPFS is the active production runtime).

## Further Notes

- Aligns with ADR-0005 and ADR-0006.
- Compatible with W3C DID and Verifiable Credential specifications if integrated with `tawf-did` in the future.
