# 02 — Multi-Sig Governance Approval & Role Review Portal

**GitHub Issue:** [#28](https://github.com/tawf-labs/tawf-zakat/issues/28)
**Parent Issue:** [#26](https://github.com/tawf-labs/tawf-zakat/issues/26)

**What to build:** An interactive review and authorization dashboard for the Sharia Supervisory Board (DPS) and Independent Auditors. Signers can inspect pending disbursement dossiers (including IPFS-hosted eligibility docs and Asnaf justifications), verify vault balances, cast on-chain approvals via `approveDisbursement` (supporting standard EOA wallets and Safe.global Smart Accounts), or cancel ineligible proposals via `cancelProposal`, with real-time status and quorum tracking synced to Neon DB.

**Blocked by:** 01 — Pre-Approval Intake & Salted Hash Dossier Pipeline ([#27](https://github.com/tawf-labs/tawf-zakat/issues/27))

**Status:** ready-for-agent

- [ ] DPS and Auditor signers can view all pending proposals with real-time on-chain and database state.
- [ ] Signers can open and preview IPFS proposal metadata and attached documents directly from the portal.
- [ ] Authorized DPS (`SHARIA_SUPERVISOR_ROLE`) and Auditor (`AUDITOR_ROLE`) accounts can submit on-chain approvals via `approveDisbursement(proposalId)`.
- [ ] ConnectKit and Wagmi handle transactions from standard EOA wallets and Safe.global multisig accounts seamlessly.
- [ ] Quorum transition is handled accurately: once approval count reaches 2-of-3, status changes to `Approved`.
- [ ] DPS or Amil admin can reject/cancel a pending proposal on-chain via `cancelProposal(...)` with a reason string.
- [ ] Database sync endpoint updates `approvalCount` and `status` in Neon DB upon confirmed transaction.
