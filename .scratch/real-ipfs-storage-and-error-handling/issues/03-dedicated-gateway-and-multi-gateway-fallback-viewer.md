# Issue 03: Dedicated Gateway & Multi-Gateway Fallback Viewer

## Description
Update `TransparencyDashboard.tsx`, `GovernanceSection.tsx`, and public proof links to use the dedicated Pinata gateway (`https://white-lazy-marten-351.mypinata.cloud/ipfs/${cid}`) by default, with automatic fallback handling if any gateway times out. Provide a visual gateway indicator so users know they are viewing high-speed decentralized proofs.

## Blocked by
- 01 — Backend Real Multipart File Upload & Dedicated Gateway Integration
- 02 — Frontend Real File Upload UI for Proposal, BAST, and Audit

## Acceptance criteria
- [x] All IPFS links point to `https://white-lazy-marten-351.mypinata.cloud/ipfs/${cid}`.
- [x] In the Public Transparency Explorer and Governance modal, clicking "Buka Dossier" / "Buka BAST" / "Laporan IPFS" opens the dedicated gateway URL.
- [x] Helper utility `getIpfsUrl(cid, gateway?)` centralized in frontend and backend.
- [x] Full end-to-end testing verified.
