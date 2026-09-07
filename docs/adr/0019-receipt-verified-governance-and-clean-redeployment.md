# ADR-0019: Receipt-Verified Governance and Clean Redeployment

- Status: Accepted for manual-test reset
- Date: 2026-09-08
- Supersedes: ADR-0015 for proposal, approval, cancellation and execution transport

## Evidence

Proposal 4 was Executed in PostgreSQL while the active Arbitrum Sepolia contract
still reported Pending with one approval. The gasless broadcaster sent calldata
to its own wallet, not to the protocol; it also fabricated a hash on failure.
Legacy mutation endpoints accepted unverified status changes. The audit panel
included Approved proposals. Binary IPFS uploads could return a fake QmFile CID.

## Decision

Manual governance uses wallet transactions calling the actual contract functions.
The backend confirms a successful, canonical receipt containing the requested
event from the configured contract and proposal ID before persisting current
chain state. Offchain metadata must be signed by that transaction's sender.
Legacy mutation/gasless endpoints return 410 and cannot mutate the ledger.
RPC verification failures do not certify a proposal as ready for audit.

Wallet users now need Arbitrum Sepolia ETH for governance gas. This deliberately
replaces ADR-0015's universal gasless promise until contract-supported delegated
authorization exists. A signed message or relayer self-transfer is not a contract
state transition. This decision does not certify the separate auditor anchoring
implementation or constitute a smart contract security audit.

Only confirmed Executed proposals enter the audit queue. UI personas and the
historical deployer address do not confer roles. Live binary uploads fail closed
without a successful Pinata upload; synthetic CIDs are restricted to tests.

Reset backs up PostgreSQL, empties all seven application tables transactionally,
restarts sequences and creates no seed rows. DEPLOYMENT_PENDING blocks application
API access and both embedded/standalone indexing. Checkpoints are keyed by chain
and contract; indexing starts at the configured deployment block, including its
constructor events. Activation requires matching frontend/backend addresses and
the new deployment block. A database reset cannot erase the old contract.

## Limits

The old contract permits auditor pre-approval and permissionless execution;
changing the frontend does not change those Solidity authorization rules.
Redeployment does not itself fix that policy discrepancy with ADR-0006. Review
the contract separately before treating this as production governance.

The full legacy test suite contains tests for retired simulated endpoints; those
are not evidence of valid onchain behavior. Receipt verification and retirement
have dedicated regression tests. No new live contract was deployed as part of
the database reset.
