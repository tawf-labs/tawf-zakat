# 02 — Frontend WebSocket Client Context & Cache Invalidation

## Context
The React frontend should maintain an active WebSocket connection, receive real-time invalidation pings, display live notifications, and refresh data instantaneously when relevant blockchain/database events happen.

## Dependencies
- 01 — Backend Bun + Hono WebSocket Server & Event Bus

## Acceptance criteria
- [ ] `frontend/src/lib/WebSocketContext.tsx` provides React context and `useWebSocket` hook with auto-reconnect (exponential backoff).
- [ ] Visual indicator / connection badge in navigation or footer showing live WS status (🟢 Realtime Connected).
- [ ] `GovernanceSection.tsx` refetches proposals immediately upon receiving `PROPOSAL_*` or `AUDIT_*` events.
- [ ] `TransparencyDashboard.tsx` refetches balances and batches upon `MERKLE_BATCH_SETTLED` or `ONCHAIN_EVENT_INDEXED`.
- [ ] `DonateSection.tsx` updates QRIS payment status automatically upon receiving `DONATION_PAID` without tight polling loops.
- [ ] Global live toasts (Sonner) notifying users when on-chain actions occur.
- [ ] Production build passes with zero TypeScript errors.
