# Spec: Universal IPFS Evidence Explorer & Dynamic Metadata Schema

## Problem Statement

Stakeholders across the Zakat lifecycle (Independent KAP Auditors, Sharia Supervisory Board / DPS members, Amil operators, and public donors) currently face high cognitive friction when auditing aid distribution proofs stored on IPFS. 

Navigating raw IPFS gateways requires downloading raw files, manually deciphering JSON data trees, and opening external block explorers to check whether an IPFS CID or salted beneficiary hash matches the Sepolia L1 smart contract. Furthermore, existing IPFS metadata schemas lack versioning, support for multiple attachments (e.g. BAST PDF + photos + bank mutation receipts), structured geographical tags, and explicit Sharia compliance validation records.

## Solution

Build a **Universal IPFS Evidence Explorer (`/transparansi/bukti`) and Dynamic Metadata Schema (`v1.1.0`)** that:
1. Standardizes all IPFS metadata with `schemaVersion: "1.1.0"`, `docType` discriminators, dynamic multi-file `attachments[]`, geographical tags (`location`), and `shariaComplianceChecks`.
2. Delivers a dedicated, deep-linkable public route `/transparansi/bukti?cid=Qm...` and universal interactive modal/drawer across all tables in `/transparansi` and `/tata-kelola`.
3. Implements a **Split-View Visualizer** displaying document/image previews alongside human-readable metadata, expandable raw JSON trees, and an on-chain cryptographic integrity seal.
4. Provides a backend accelerated endpoint `GET /api/ipfs/inspect/:cid` with MIME detection, multi-gateway fallback (Pinata $\rightarrow$ Cloudflare $\rightarrow$ IPFS.io $\rightarrow$ dweb.link), and automated on-chain proposal reconciliation.

---

## User Stories

1. As an **Independent Auditor (KAP)**, I want to paste or click any IPFS CID to view the complete evidentiary package (BAST PDF, bank transfer slip, and photos) in one screen, so that I can certify PSAK 109 compliance without raw JSON tools.
2. As a **DPS (Dewan Pengawas Syariah) Member**, I want to inspect mustahik survey dossiers and verified Sharia criteria checklists before signing 2-of-3 Safe Global multisig approvals, so that I am confident aid matches the 8 Asnaf rules.
3. As an **Amil Operator**, I want to upload multi-file evidence bundles (e.g., SKTM scan + physical handover photos + signed BAST) with automatic audit watermarking, so that the dossier is permanently archived to Pinata IPFS under standard `v1.1.0`.
4. As a **Public Donor / Muzakki**, I want to click "Lihat Bukti Penyaluran" on any disbursement in the transparency center to see authentic proof of impact without needing Web3 knowledge or IPFS software.
5. As an **Auditor**, I want the platform to automatically verify whether the CID and `beneficiaryHash` in the metadata match the immutable Sepolia L1 contract state, so that I can guarantee the document has not been tampered with.
6. As a **User on a restricted network**, I want the document viewer to automatically fall back across multiple IPFS gateways (Pinata $\rightarrow$ Cloudflare $\rightarrow$ IPFS.io $\rightarrow$ dweb.link) if one gateway is slow or throttled, so that I never encounter broken files.
7. As a **User sharing an audit record**, I want to copy a direct link (`/transparansi/bukti?cid=Qm...`) or download the original file, so that I can reference it in formal audit reports.
8. As a **Technical Auditor**, I want to toggle between "Tampilan Manusiawi" and "Raw JSON Tree View", so that I can inspect the exact underlying JSON payload.

---

## Implementation Decisions

### 1. Metadata Schema Standardization (`v1.1.0`)
- Defined in backend and frontend shared contracts with `schemaVersion: "1.1.0"`.
- Supports 4 standardized document types:
  - `PROPOSAL_DOSSIER`: Mustahik intake, survey assessment, disguised identity, SKTM attachments.
  - `BAST_RECEIPT`: Handover certificate, bank transfer reference, signed BAST PDF, distribution photos.
  - `AUDITOR_ATTESTATION`: Ex-post audit opinion (WTP/WDP/DISPUTED), KAP findings, PSAK 109 checklist.
  - `CUSTOM_EVIDENCE`: General supporting documentation.
- Dynamic `attachments` array:
  ```json
  "attachments": [
    {
      "name": "BAST_Fakir_Miskin.pdf",
      "fileType": "application/pdf",
      "cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
      "description": "Berita Acara Serah Terima ditandatangani Amil & Mustahik",
      "url": "https://white-lazy-marten-351.mypinata.cloud/ipfs/QmXoy..."
    }
  ]
  ```

### 2. Backend Inspection API (`backend/src/ipfs.ts` & `backend/src/index.ts`)
- Implement `GET /api/ipfs/inspect/:cid`:
  - Fetches content via Pinata Dedicated Gateway with multi-gateway fallback.
  - Detects content type (JSON metadata vs binary PDF/image).
  - Queries local database and event logs to attach matching Proposal ID, DPS Safe status, and Sepolia transaction hash.
- Update `POST /api/ipfs/upload-file` and JSON pinning utilities to enforce `v1.1.0` schema validation.

### 3. Frontend Universal Evidence Inspector (`src/features/evidence/` & `routes/transparansi/bukti.tsx`)
- New Feature Slice: `src/features/evidence/`:
  - `EvidenceViewer.tsx`: Main split-view container with CID search input, quick proposal selector, and share buttons.
  - `DocumentPreviewer.tsx`: High-performance PDF and image previewer with multi-gateway cascade and zoom/fullscreen controls.
  - `MetadataInspectorCard.tsx`: Structured cards for Asnaf, Beneficiary Hash, Nominal, Bank Reference, and Sharia Checklist.
  - `RawJsonTree.tsx`: Syntax-highlighted, copyable raw JSON tree.
  - `OnChainIntegrityBadge.tsx`: Cryptographic proof matcher comparing CID and hash to Sepolia L1 state.
  - `index.ts`: Public barrel export.
- Dedicated Route: `routes/transparansi/bukti.tsx` supporting `?cid=...` search parameter.
- Reusable Modal/Drawer: `UniversalEvidenceModal.tsx` mounted globally or in `/transparansi` and `/tata-kelola` tables.

---

## Testing Decisions

- **Good Test Criteria**: Test external behavior through HTTP requests and client leaf/hash computations rather than internal variables.
- **Backend API Tests (`backend/test/ipfs_evidence_inspector.test.ts`)**:
  - Test `GET /api/ipfs/inspect/:cid` returns parsed `v1.1.0` metadata and reconciles with on-chain proposal records.
  - Test multi-gateway fallback resiliency when primary gateway fails.
  - Test multi-file attachment upload and CID generation.
- **Frontend Build & Route Verification**:
  - Run `tsr generate` and `bun run build` to verify route tree integrity and type safety.

---

## Out of Scope

- Client-side end-to-end PGP key encryption for private files (unnecessary since data is public and privacy is safeguarded by salted hashing and redacting PII).
- Custom mobile app APK generation (responsive web PWA is sufficient).

---

## Further Notes

- Complies with Indonesian Law No. 27/2022 on Personal Data Protection (UU PDP) through salted NIK hashing.
- Follows BAZNAS and PSAK 109 Sharia audit standards.
