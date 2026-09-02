# 03 — Disbursement Execution, Multi-Unit Settlement & BAST Pipeline

**GitHub Issue:** [#29](https://github.com/tawf-labs/tawf-zakat/issues/29)
**Parent Issue:** [#26](https://github.com/tawf-labs/tawf-zakat/issues/26)

**What to build:** An end-to-end disbursement and proof recording engine for approved proposals. For USDC proposals, the contract releases real tokens to the beneficiary's wallet address. For Fiat IDR proposals, Amil transfers funds from Escrow Bank and uploads signed BAST receipts and blurred delivery photos to IPFS (`disbursementReceiptCID`), followed by on-chain `executeDisbursement` transaction to adjust the L1 ledger and lock `hasReceivedZakat[beneficiaryHash][periodId]` against double-claiming.

**Blocked by:** 02 — Multi-Sig Governance Approval & Role Review Portal ([#28](https://github.com/tawf-labs/tawf-zakat/issues/28))

**Status:** ready-for-agent

- [ ] Amil interface displays all `Approved` proposals ready for physical or on-chain execution.
- [ ] For USDC payouts, `executeDisbursement` transfers USDC tokens from the contract vault directly to the recipient address and updates `totalDisbursedUSDC` and `mustahikVaultUSDC`.
- [ ] For Fiat IDR payouts, Amil can upload scanned BAST receipts and photos via `POST /api/proposals/:id/bast`, pinning a structured receipt JSON to IPFS.
- [ ] Amil executes IDR disbursement on-chain, updating `mustahikVaultIDR` and `totalDisbursedIDR` while associating the final IPFS CID.
- [ ] Smart contract strictly enforces anti-double claim by verifying `hasReceivedZakat[beneficiaryHash][periodId]` is false before execution and setting it to true upon execution.
- [ ] Attempted double disbursement with the same `beneficiaryHash` and `periodId` reverts with `DoubleClaimDetected`.
- [ ] Neon DB record is updated to `EXECUTED` with `executedTxHash`, `executedAt`, and `disbursementReceiptCID`.
