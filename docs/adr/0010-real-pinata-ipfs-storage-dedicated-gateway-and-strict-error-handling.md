# ADR-0010: Real Pinata IPFS Storage, Dedicated Gateway, and Strict Governance Error Handling

## Status
Accepted

## Context
In the zakat disbursement lifecycle, three crucial documents must be preserved immutably for Sharia compliance and public accountability:
1. **Pre-Approval Dossier**: Sharia justification, disguised recipient profile, and assessment notes reviewed by the Dewan Pengawas Syariah (DPS).
2. **Disbursement Delivery Receipt (BAST)**: Signed bank transfer proofs, recipient handover photos, and operational logs.
3. **Independent Auditor Attestation**: Professional audit opinion (WTP/PSAK 109) and signed certification.

Previously, if Pinata upload was unavailable or simulated, deterministic fallback hashes were generated locally, and binary proofs (scanned PDFs, photos) were referenced by mock string filenames rather than uploaded as real decentralized binary blobs. Furthermore, public gateways like `ipfs.io` can experience ISP rate-limiting or latency.

## Decision
1. **Real Multipart File Uploads (`pinFileToIPFS`)**:
   - Introduce `POST /api/ipfs/upload-file` in the backend using Pinata's `pinFileToIPFS` API.
   - Frontend provides real file pickers and drag-and-drop zones for BAST scans, transfer receipts, and audit certificates, receiving genuine CIDs (`Qm...`) before embedding them into parent metadata JSON.

2. **Dedicated Fast Gateway**:
   - Set primary IPFS gateway to the user's dedicated gateway: `https://white-lazy-marten-351.mypinata.cloud/ipfs/`.
   - Maintain multi-gateway fallback list (`gateway.pinata.cloud`, `ipfs.io`, `dweb.link`, `cloudflare-ipfs.com`) with automated failover in the UI viewer.

3. **Strict Validation & Reversion Policy (Non-Repudiation)**:
   - For on-chain governance integrity, IPFS upload failures will return HTTP 502/503 errors and abort proposal creation or BAST settlement.
   - No mock or broken CIDs will ever be permanently written to the smart contract on Sepolia L1.

4. **Privacy & Sanitization**:
   - Enforce client-side sanitization guidelines for identity documents (masked NIK, pseudonymized recipient names, salted hashing) to comply with data privacy regulations (UU PDP).

## Consequences

### Positive
- Genuine decentralized document preservation: Anyone can inspect and verify actual scanned BAST documents and audit reports via IPFS.
- Sub-second loading speeds via the dedicated Pinata gateway (`white-lazy-marten-351.mypinata.cloud`).
- 100% data integrity on Sepolia L1 smart contracts without broken or fake hash references.

### Negative / Trade-offs
- Proposal intake and BAST submission require active internet connectivity and valid Pinata credentials (guaranteed via `.env` configuration).
