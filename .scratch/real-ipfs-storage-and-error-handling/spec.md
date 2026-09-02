# Spec: Real Pinata IPFS Storage, Dedicated Gateway & Strict Sharia Error Handling

- **Status:** Ready for Agent
- **Date:** 2026-09-01
- **Domain:** Decentralized Storage, IPFS Pinning, Dedicated Gateway, Multipart Uploads, Error Handling

---

## Problem Statement
In zakat distribution governance, critical evidence documents (pre-approval dossiers, scanned BAST agreements, handover photos, and official audit certificates) must be accessible to DPS supervisors, independent auditors, and the public.
Previously:
1. Binary files were represented by dummy strings in JSON without real multipart upload to decentralized IPFS.
2. If Pinata API failed or encountered network issues, fallback local CIDs were generated silently, risking broken links on Sepolia L1.
3. Public gateway links relied on `ipfs.io`, which can experience rate limits or latency in Indonesia.

---

## Solution
1. **Real Multipart File Uploads**:
   - Backend `POST /api/ipfs/upload-file` accepts `multipart/form-data` and pins binary files directly to Pinata using `pinFileToIPFS`.
   - Returns real IPFS CID (`Qm...`) and dedicated gateway URL.
2. **Dedicated Pinata Gateway Integration**:
   - Gateway base URL configured as: `https://white-lazy-marten-351.mypinata.cloud/ipfs/`.
   - Frontend provides multi-gateway fallback (`gateway.pinata.cloud`, `ipfs.io`, `dweb.link`).
3. **Strict Validation & Reversion (Zero Broken Links)**:
   - Backend returns HTTP 502/503 on IPFS upload errors, preventing corrupted records from ever reaching Sepolia L1.
4. **Interactive File Pickers & UI Feedback**:
   - Amil can drag-and-drop or select real PDF/JPG files for BAST documents and delivery photos.
   - Auditor can upload official audit certificates.
   - Proposal intake allows attaching sanitized verification documents.

---

## User Stories
1. As an **Amil Lapangan**, I want to upload a real scanned BAST PDF and handover photo during disbursement realization, so that physical evidence is permanently archived on IPFS.
2. As a **Dewan Pengawas Syariah (DPS)** member, I want to view the pre-approval dossier on the dedicated high-speed gateway (`white-lazy-marten-351.mypinata.cloud`), so that I can audit mustahik eligibility without loading delays.
3. As an **Independent Auditor**, I want to upload my signed KAP audit certificate PDF when issuing an attestation, so that my formal certification is publicly verifiable.
4. As an **Amil or Auditor**, I want clear error feedback if IPFS upload fails, so that I can retry without corrupting on-chain state.
5. As a **Muzakki or Public Observer**, I want to open IPFS documents seamlessly in the Transparency Explorer with automatic gateway fallback if one gateway is slow.

---

## Implementation Decisions
1. **Backend IPFS Engine (`backend/src/ipfs.ts`)**:
   - Add `uploadFileToIPFS(fileBuffer: Buffer | Blob, fileName: string, mimeType?: string)` using `https://api.pinata.cloud/pinning/pinFileToIPFS`.
   - Update `DEDICATED_GATEWAY_URL = "https://white-lazy-marten-351.mypinata.cloud/ipfs"`.
   - Update all JSON upload functions (`uploadProposalDossierToIPFS`, `uploadDisbursementReceiptToIPFS`, `uploadAuditReportToIPFS`) to throw meaningful descriptive errors when Pinata upload fails if strict mode is enabled.
2. **Backend API Endpoints (`backend/src/index.ts`)**:
   - Add `POST /api/ipfs/upload-file` accepting multipart form data.
   - Add `GET /api/ipfs/gateway` returning active gateway configurations.
3. **Frontend Integration**:
   - Update `GovernanceSection.tsx` to handle file drag-and-drop / upload for BAST, Intake, and Audit Certificate.
   - Update `TransparencyDashboard.tsx` to use the dedicated gateway with fallback switcher.
4. **Error Handling & Feedback**:
   - Integrate with `useTxToast` and `errorHandler.ts` to surface clear messages for IPFS network timeouts.

---

## Testing Decisions
- **Backend Tests**: Verify `POST /api/ipfs/upload-file` with mock and live buffers; verify JSON pinning to Pinata with real JWT.
- **Frontend Build**: Verify clean compilation of file upload forms and gateway links.
