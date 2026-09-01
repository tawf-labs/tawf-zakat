# Issue 01: Backend EIP-712 Signature Verification & Relayer On-Chain Sponsorship

## Description
Upgrade `POST /api/audit/attest` in `backend/src/index.ts` to require and verify a cryptographic EIP-712 signature against the connected `auditorAddress` and `AUDITOR_ROLE` whitelist. Embed the verified signature in the IPFS audit dossier, broadcast an on-chain verification transaction to Sepolia L1 sponsored by the Relayer, and persist the real `audit_tx_hash` and `audit_report_cid` in PostgreSQL.

## Blocked by
None — can start immediately.

## Acceptance criteria
- [x] `POST /api/audit/attest` validates `signature` using Viem `verifyTypedData` matching the EIP-712 domain and `AuditorAttestation` struct.
- [x] Rejects requests with invalid or forged signatures with HTTP 401 Unauthorized.
- [x] Injects `auditorSignature` and `auditorAddress` into the IPFS audit metadata pinned via Pinata.
- [x] Relayer broadcasts on-chain transaction or event to Sepolia L1 with gas sponsorship.
- [x] Neon DB `disbursement_proposals` table updated with `audit_status = 'AUDITED_WTP'`, `audit_opinion`, `audit_report_cid`, `audit_tx_hash`, `audited_at`.
- [x] Automated integration test passing in `backend/test/auditor_attestation.test.ts`.
