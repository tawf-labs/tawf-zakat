# Spec: Real-Time Transparency Dashboard, USDC Neon DB Persistence & Multi-Sig Governance Synchronization

**GitHub Issue:** [#22](https://github.com/tawf-labs/tawf-zakat/issues/22)

## Problem Statement

While the core Sepolia L1 smart contracts, Neon PostgreSQL database schemas, and Midtrans Sandbox Snap payments are fully operational, three key synchronization gaps prevent a seamless end-to-end user experience:
1. The Transparency Dashboard displays partially static figures rather than reading real-time settled L1 balances from Ethereum Sepolia smart contract vaults.
2. Web3 USDC donations execute directly on-chain via MetaMask, but their transaction hashes, commitment hashes (for Mode Hamba Allah), and donation records are not persisted to Neon DB or verified via private digital receipts.
3. Multi-Sig Governance proposals created by Amil and independent approvals (DPS/Auditor) reside solely in ephemeral client React state rather than being synced with on-chain proposal states in Neon DB.

## Solution

Implement full-stack real-time synchronization across the 3 remaining modules:
1. **Live On-Chain Balance Sync in Transparency Dashboard**: Viem Public Client queries Sepolia Smart Contract (`0x72b60a0C37a78dF62295F88294E790083089f665`) for `totalCollectedUSDC`, `mustahikVaultUSDC`, `amilTreasuryUSDC`, `totalCollectedIDR`, `mustahikVaultIDR`, and `amilTreasuryIDR`, combined with pending queue indicators.
2. **USDC Inflow Persistence & Cryptographic Receipt Generation**: Provide `POST /api/donations/usdc` in the backend and call it from the frontend upon MetaMask transaction receipt confirmation, supporting Mode Hamba Allah via `commitmentHash = Keccak256(wallet + salt + amount)` and generating a digital receipt with secret salt for independent verification.
3. **Multi-Sig Governance Persistence**: Wire proposal creation and multi-sig approvals/executions to Neon DB (`disbursement_proposals` table) via `POST /api/proposals` and `POST /api/proposals/:id/approve` using an On-Chain-First workflow.

## User Stories

1. As a public auditor or community member, I want the Transparency Dashboard to read live vault balances directly from the Ethereum Sepolia smart contract, so that I have absolute mathematical proof of all locked and distributed funds.
2. As a public auditor, I want to see both on-chain settled L1 balances and pending unbatched fiat queue metrics side-by-side, so that I can monitor daily liquidity in real-time.
3. As a Web3 donor, I want my USDC donation transaction to be recorded in the official protocol ledger (Neon DB) upon on-chain confirmation, so that my donation is accounted for in protocol reports.
4. As a Web3 donor choosing "Mode Hamba Allah", I want my identity and wallet address masked in public records and secured with a Commitment Hash, so that my privacy and sincere intention (ikhlas) are protected.
5. As a Web3 donor, I want to receive a Digital Receipt with a Secret Salt for my USDC donation, so that I can independently verify my contribution in the Verifier tab without revealing my private identity.
6. As an Amil officer, I want newly proposed disbursement plans to be persisted to Neon DB with their on-chain `proposalIdOnChain` and IPFS proof CID, so that proposals persist across page refreshes and server restarts.
7. As a Shariah Board member (DPS) or Auditor, I want to view all open proposals from Neon DB and sign on-chain approvals, with my approval count and status updated in real-time.
8. As an Amil officer, I want to execute approved proposals on-chain once the 2-of-3 quorum is reached, updating the proposal status to `Executed` across both the smart contract and Neon DB.

## Implementation Decisions

- **Module 1: `TransparencyDashboard.tsx` & `web3Client.ts`**:
  - Use Viem `publicClient.readContract` to read live contract fields from Sepolia (`0x72b60a0C37a78dF62295F88294E790083089f665`):
    - `totalCollectedIDR()`, `mustahikVaultIDR()`, `amilTreasuryIDR()`, `totalDisbursedIDR()`
    - `totalCollectedUSDC()`, `mustahikVaultUSDC()`, `amilTreasuryUSDC()`, `totalDisbursedUSDC()`
  - Combine with backend `GET /api/batches` and unbatched queue stats.
- **Module 2: `POST /api/donations/usdc` in `backend/src/index.ts` & `db/index.ts`**:
  - Accepts payload `{ trxId, txHash, donorAddress, donorName, isAnonymous, amountUSDC, salt, commitmentHash }`.
  - Maps to `donations` table with `paymentMethod = 'USDC'`, `status = 'PAID'`.
  - Frontend triggers `POST /api/donations/usdc` upon `waitForTransactionReceipt` success and renders the Digital Receipt with Secret Salt.
- **Module 3: `POST /api/proposals` and `POST /api/proposals/:id/approve` in `backend/src/index.ts` & `GovernanceSection.tsx`**:
  - Amil creates proposal on-chain first (`proposeDisbursement`), obtains `proposalIdOnChain`, then saves metadata & IPFS CID to Neon DB.
  - Signers approve on-chain (`approveDisbursement`), then update `approvalCount` and `status` in Neon DB.
  - Execution on-chain (`executeDisbursement`) updates status to `Executed` and sets `executedAt`.

## Testing Decisions

- Unit and integration tests for `POST /api/donations/usdc` verifying database insertion and status `PAID`.
- Unit and integration tests for `POST /api/proposals`, `GET /api/proposals`, and approval updates.
- End-to-end typecheck and build validation for frontend live balance hooks and governance UI.
- All tests will assert on external HTTP/database behavior and on-chain contract state.

## Out of Scope

- Mainnet deployment gas subsidies (Sepolia testnet only).
- Automated fiat bank payout disbursements (mock escrow accounting only).

## Further Notes

- Respects single-context layout and ADRs.
- Uses Sepolia smart contract `0x72b60a0C37a78dF62295F88294E790083089f665`.
