# ADR-0013: Universal IPFS Evidence Explorer and Dynamic Metadata Schema

## Status
Accepted

## Context
Tawf Zakat Protocol relies on decentralized, immutable IPFS storage (via Pinata Dedicated Gateways) to archive proposal dossiers, BAST (Berita Acara Serah Terima) receipts, and independent auditor attestations.

However, inspecting raw IPFS CIDs presents key challenges for stakeholders (Auditors, Sharia Supervisory Board / DPS members, Amil, and public donors):
1. **Raw JSON / Gateway Friction**: Opening raw CIDs in an IPFS gateway requires manual downloading, raw JSON parsing, and lacks human-readable visual context (photo proof, bank transfer slips, and SKTM documents).
2. **Static Metadata Schema**: The original metadata structure lacked versioning (`schemaVersion`), dynamic multi-attachment arrays (`attachments[]`), structured geographical tagging (`location`), and explicit Sharia compliance checklist items (`shariaComplianceChecks`).
3. **On-Chain Cryptographic Reconciliation**: Stakeholders lacked a unified single-screen inspector to verify whether an IPFS document and its salted beneficiary hash match the immutable L1 smart contract state without switching back and forth between block explorers and IPFS viewers.

## Decision
1. **Dynamic Metadata Schema Specification `v1.1.0`**:
   - Introduce `schemaVersion: "1.1.0"` across all pinned IPFS JSON documents.
   - Standardize `docType` discriminator (`PROPOSAL_DOSSIER`, `BAST_RECEIPT`, `AUDITOR_ATTESTATION`, `CUSTOM_EVIDENCE`).
   - Support `attachments: Array<{ name, fileType, cid, description, url }>` for multi-file bundles (PDFs, photos, bank mutation slips).
   - Add structured `location: { province, regencyCity, district }` for regional aid mapping.
   - Add `shariaComplianceChecks: { asnafVerified, amilCapCompliant, antiDoubleClaimPassed }`.

2. **Universal Evidence Inspector (`/transparansi/bukti` & Modal Drawer)**:
   - Provide a dedicated, publicly accessible deep-link route `/transparansi/bukti?cid=...` with query parameters.
   - Embed universal drawer triggers across all tables in `/transparansi` and `/tata-kelola`.
   - Implement **Split-View Visualizer**:
     - *Left/Top Panel*: Live interactive PDF viewer and image proof gallery with multi-gateway auto-fallback (Pinata $\rightarrow$ Cloudflare $\rightarrow$ IPFS.io $\rightarrow$ dweb.link).
     - *Right/Bottom Panel*: Human-formatted metadata card + expandable raw JSON tree.
     - *Cryptographic Integrity Seal*: Real-time verification that the IPFS document hash matches on-chain Sepolia L1 state.

3. **Backend Accelerated Inspector (`GET /api/ipfs/inspect/:cid`)**:
   - Provide server-side MIME type detection, IPFS data resolution, and instant reconciliation with database proposals and smart contract tx hashes.

4. **Privacy Protection (UU PDP No. 27/2022)**:
   - Ensure all beneficiary NIKs are salted before hashing (`beneficiaryHash`).
   - Apply automatic audit watermarks to sensitive evidentiary documents.

## Consequences
- **Positive**: Seamless, 1-click auditability for KAP auditors and DPS supervisors; eliminates raw JSON friction; future-proof multi-attachment support.
- **Negative**: Adds a dedicated route (`/transparansi/bukti`) and backend inspect endpoint that must handle gateway timeout cascades gracefully.
