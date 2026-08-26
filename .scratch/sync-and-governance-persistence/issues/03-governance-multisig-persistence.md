# 03 — On-Chain Multi-Sig Governance Persistence & Quorum State Machine

**GitHub Issue:** [#25](https://github.com/tawf-labs/tawf-zakat/issues/25)
**Parent:** [#22](https://github.com/tawf-labs/tawf-zakat/issues/22)

**What to build:**
Persist disbursement proposals and 2-of-3 multi-sig signatures to Neon DB (`disbursement_proposals` table) via an On-Chain-First workflow. Amil creates proposal on-chain, uploads metadata to IPFS, and saves to Neon DB (`POST /api/proposals`). Approvers (DPS / Auditor) sign on-chain and update approval counts in DB (`POST /api/proposals/:id/approve`), transitioning proposal status (`Pending` -> `Approved` -> `Executed`).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Backend exposes `POST /api/proposals`, `GET /api/proposals`, and `POST /api/proposals/:id/approve` backed by Drizzle Neon DB.
- [ ] Frontend Governance form submits on-chain transaction `proposeDisbursement`, gets `proposalIdOnChain`, and posts proposal metadata to backend.
- [ ] Approving a proposal triggers on-chain `approveDisbursement` and syncs signature list to database.
- [ ] Executing a proposal triggers on-chain `executeDisbursement` and updates DB status to `Executed`.
- [ ] Unit & integration tests pass for proposal creation, retrieval, and approval lifecycle.
