# 03 — Public Transparency Explorer with Auditor WTP Badges & Verification Explorer

## Parent
#31 (Spec: Production-Ready DPS Safe.global Multi-Sig Queue & Ex-Post Auditor Attestation Engine)

## What to build
Public Transparency Dashboard and Merkle Verifier display verified "Audited & Certified (WTP)" badges alongside each historical disbursement. Donors and public observers can inspect the full 4-stage audit trail: Pre-Approval Intake Dossier, Safe DPS multi-sig signers, Bank BAST proof, and the Auditor's certified report on IPFS, with filtering by audit certification status and end-to-end integration tests.

## Blocked by
#33 (02 — Independent Auditor Attestation Engine & On-Chain Certification)

## Acceptance criteria
- [ ] Public Transparency Dashboard displays Auditor Attestation status badge (WTP / Audited / Pending) and audit report IPFS link.
- [ ] Filter by Audit Status works smoothly alongside Asnaf and Currency filters.
- [ ] Modal displays the complete 4-stage verifiable proof chain (Intake -> DPS Safe Signers -> BAST Bank Receipt -> Auditor Attestation).
- [ ] Comprehensive E2E test suite validates the full lifecycle from intake to auditor certification.
