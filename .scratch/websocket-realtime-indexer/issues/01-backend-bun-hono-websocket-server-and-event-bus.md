# 01 — Backend Bun + Hono WebSocket Server & Event Bus

## Context
Web3 indexers and API mutations need a fast, low-overhead way to push state change notifications to all connected clients without polling the database or Sepolia RPC repeatedly.

## Dependencies
None — can start immediately.

## Acceptance criteria
- [ ] `backend/src/ws.ts` exports Hono Bun WebSocket handler on route `/ws`.
- [ ] Client connection lifecycle managed cleanly (connect, disconnect, ping/pong heartbeats).
- [ ] `eventBus.broadcast({ type, data, timestamp })` delivers JSON messages to all active client sockets.
- [ ] Indexer engine triggers `eventBus.broadcast` upon discovering on-chain logs (`USDCDeposited`, `DisbursementProposed`, `DisbursementApproved`, `DisbursementExecuted`, `DisbursementCancelled`, `FiatBatchSettled`, `RoleGranted`, `RoleRevoked`).
- [ ] Proposal and audit API endpoints trigger `eventBus.broadcast` upon intake, approval, execution, cancellation, and WTP attestation.
- [ ] Automated tests pass in `backend/test/websocket.test.ts`.
