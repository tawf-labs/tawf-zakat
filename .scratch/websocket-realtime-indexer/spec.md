# Real-Time WebSocket Architecture & Invalidation Pipeline (ADR-0011)

## Overview
Transform the application from periodic HTTP polling (`setInterval` in React components) to an ultra-low latency, event-driven architecture using native Bun + Hono WebSockets, a centralized backend event broadcaster, and automated client-side invalidation triggers.

## Architecture

```
                                  ┌────────────────────────┐
                                  │  Sepolia L1 Blockchain │
                                  └───────────┬────────────┘
                                              │
                                              ▼ (getLogs / Indexed Events)
┌───────────────────────┐         ┌────────────────────────┐
│ Midtrans / API Caller │────────▶│  Backend Indexer & API │
└───────────────────────┘         └───────────┬────────────┘
                                              │
                                              ▼ (eventBus.broadcast)
                                  ┌────────────────────────┐
                                  │   WebSocket Bus (/ws)  │
                                  └───────────┬────────────┘
                                              │
                                              ▼ (Thin Invalidation Ping)
                                  ┌────────────────────────┐
                                  │   React Web3 Clients   │
                                  │ (Sonner Toast + Refetch)│
                                  └────────────────────────┘
```

## Ticket Breakdown
1. **01 — Backend Bun + Hono WebSocket Server & Event Bus**:
   - Create `backend/src/ws.ts` with `createBunWebSocket` and connection registry.
   - Implement `eventBus.broadcast(event: RealtimeEvent)`.
   - Wire event broadcaster into `IndexerEngine`, `proposals` endpoints, and `Midtrans` webhook.
   - Add unit/integration tests for WebSocket connections and event broadcasting.

2. **02 — Frontend WebSocket Client Context & Cache Invalidation**:
   - Create `frontend/src/lib/WebSocketContext.tsx` with auto-reconnect, status indicator, and typed event listeners.
   - Replace 5s/8s polling loops in `GovernanceSection.tsx`, `TransparencyDashboard.tsx`, and `DonateSection.tsx` with real-time event triggers.
   - Display instantaneous Sonner Toasts when transactions confirm or proposals change state.

3. **03 — VPS Nginx & Docker Compose Deployment Setup**:
   - Create `deploy/nginx.conf` with proper `Upgrade: websocket` and `Connection: "Upgrade"` headers for `/ws` path.
   - Create `docker-compose.yml` and `Dockerfile` for production containerized deployment.
