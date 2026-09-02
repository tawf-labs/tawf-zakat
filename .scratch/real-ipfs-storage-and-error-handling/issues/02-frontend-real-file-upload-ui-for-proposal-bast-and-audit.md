# Issue 02: Frontend Real File Upload UI for Proposal, BAST, and Audit

## Description
Upgrade frontend forms in `GovernanceSection.tsx` to support real file selection and drag-and-drop:
1. Proposal Intake Modal: Attach real verification documents (e.g. SKTM PDF, assessment note).
2. BAST Execution Modal: Upload real scanned BAST agreement PDF and delivery photo.
3. Auditor Attestation Modal: Upload official signed KAP certificate PDF.
Before submitting the parent action, the UI uploads the binary files to `POST /api/ipfs/upload-file`, retrieves their genuine CIDs, and embeds them into the metadata.

## Blocked by
- 01 — Backend Real Multipart File Upload & Dedicated Gateway Integration

## Acceptance criteria
- [x] File input controls for BAST scan PDF and handover photo in BAST execution modal.
- [x] File input control for audit certificate PDF in Auditor Attestation modal.
- [x] Upload progress indicator with file size and type validation on the client.
- [x] Toast notification and error decoding if file upload fails.
- [x] Clean build with zero TypeScript errors.
