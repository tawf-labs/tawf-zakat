# Issue 01: Backend Real Multipart File Upload & Dedicated Gateway Integration

## Description
Implement `uploadFileToIPFS` in `backend/src/ipfs.ts` using Pinata's `pinFileToIPFS` API. Create endpoint `POST /api/ipfs/upload-file` in `backend/src/index.ts` to accept real binary files (`multipart/form-data`) and return the real CID and dedicated gateway URL (`https://white-lazy-marten-351.mypinata.cloud/ipfs/${cid}`). Ensure strict error handling that throws descriptive errors instead of silent mock fallbacks when Pinata fails.

## Blocked by
None — can start immediately.

## Acceptance criteria
- [x] `uploadFileToIPFS` pins binary buffers/blobs to Pinata using `https://api.pinata.cloud/pinning/pinFileToIPFS`.
- [x] Dedicated gateway `https://white-lazy-marten-351.mypinata.cloud/ipfs/` used as the default gateway URL in responses.
- [x] `POST /api/ipfs/upload-file` accepts `multipart/form-data` with file size and type validation (PDF, JPG, PNG, max 10MB).
- [x] Strict error handling in `uploadProposalDossierToIPFS`, `uploadDisbursementReceiptToIPFS`, and `uploadAuditReportToIPFS` with descriptive error messages when Pinata API fails.
- [x] Automated tests passing in `backend/test/ipfs_real.test.ts`.
