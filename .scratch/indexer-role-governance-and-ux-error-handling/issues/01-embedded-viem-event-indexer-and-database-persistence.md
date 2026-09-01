# 01 — Embedded Viem Event Indexer Engine & Database Multi-Table Persistence

## Parent
Spec: Embedded Indexer, Public Role Governance Panel, and Unified Syariah Error Decoding

## What to build
A robust background worker embedded in the Bun API backend that polls Ethereum Sepolia event logs (`USDCDeposited`, `DisbursementProposed`, `DisbursementApproved`, `DisbursementExecuted`, `DisbursementCancelled`, `RoleGranted`, `RoleRevoked`) starting from block `#11569000`. The engine writes checkpoints to `indexer_state`, populates `onchain_events` and `role_members`, auto-synchronizes USDC donations into `donations`, and exposes public HTTP endpoints `GET /api/indexer/status`, `GET /api/events`, and `GET /api/governance/roles`.

## Blocked by
None — can start immediately.

## Acceptance criteria
- [x] Drizzle schema extended with `indexer_state`, `onchain_events`, and `role_members` tables.
- [x] Background polling engine runs every 10 seconds in chunked 1,000-block intervals without exceeding RPC rate limits.
- [x] `USDCDeposited` event auto-populates the unified `donations` table with status `SETTLED_ONCHAIN`.
- [x] Role events (`RoleGranted`, `RoleRevoked`) update `role_members` to maintain an active roster.
- [x] Proposal lifecycle events (`DisbursementProposed`, `DisbursementApproved`, etc.) automatically update `disbursement_proposals`.
- [x] Endpoints `GET /api/indexer/status`, `GET /api/events`, and `GET /api/governance/roles` return accurate data.
- [x] Comprehensive unit and integration tests pass via `bun test backend/test/indexer.test.ts`.
