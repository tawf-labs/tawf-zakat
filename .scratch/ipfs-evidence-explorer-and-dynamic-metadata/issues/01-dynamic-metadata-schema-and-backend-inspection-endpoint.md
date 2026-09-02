## Parent
[GitHub Issue #45](https://github.com/tawf-labs/tawf-zakat/issues/45)

## What to build
Standardize the IPFS metadata structure with versioned dynamic schema `v1.1.0` (`schemaVersion`, `docType`, `attachments[]`, `location`, `shariaComplianceChecks`) and implement a unified backend inspection endpoint `GET /api/ipfs/inspect/:cid` that resolves IPFS data, detects MIME types, performs multi-gateway fallback cascades, and reconciles on-chain proposal and transaction metadata.

## Acceptance criteria
- [x] Define standardized TypeScript interfaces for `v1.1.0` IPFS metadata schemas in `backend/src/ipfs.ts` (`ProposalDossierMetadata`, `DisbursementReceiptMetadata`, `AuditorAttestationMetadata`).
- [x] Support dynamic multi-file `attachments[]` with name, mimeType, CID, description, and gateway URL.
- [x] Implement `GET /api/ipfs/inspect/:cid` in `backend/src/index.ts` with automatic MIME detection (JSON vs binary PDF/image).
- [x] Implement multi-gateway fallback cascade: Pinata Dedicated -> Cloudflare IPFS -> IPFS.io -> dweb.link.
- [x] Reconcile inspected CIDs against SQLite database proposals to return associated Proposal ID, Asnaf type, execution status, and Sepolia transaction hash.
- [x] Add comprehensive test suite in `backend/test/ipfs_evidence_inspector.test.ts` verifying parsing, gateway fallbacks, and on-chain proposal matching.

## Blocked by
- None — can start immediately.
