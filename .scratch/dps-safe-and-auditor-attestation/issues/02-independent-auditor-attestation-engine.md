# 02 — Independent Auditor Attestation Engine & On-Chain Certification

## Parent
#31 (Spec: Production-Ready DPS Safe.global Multi-Sig Queue & Ex-Post Auditor Attestation Engine)

## What to build
Independent Auditors (KAP / BAZNAS Auditor) have a dedicated Auditor Workspace to review historical disbursements without participating in pre-disbursement voting. Auditors can inspect dual IPFS evidence (Pre-Approval Dossier + Post-Disbursement BAST and bank reference) and issue an on-chain Cryptographic Attestation (WTP / Anomaly Flag) with an attached audit report pinned to Pinata IPFS.

## Blocked by
#32 (01 — Safe.global DPS Multi-Sig Queue Integration & Real-Time Pending Signature Tracker)

## Acceptance criteria
- [ ] Auditor Workspace UI displays list of executed disbursements ready for inspection.
- [ ] Dual-evidence inspector renders both IPFS CIDs, bank references, and beneficiary salted hash verification.
- [ ] `POST /api/audit/attest` endpoint records auditor attestation, notes, opinion (`WTP` / `DISPUTED`), and pins structured audit report to IPFS.
- [ ] Smart contract / backend records auditor attestation event and state on Sepolia L1.
- [ ] Integration tests verify auditor submission, IPFS audit report pinning, and role protection.
