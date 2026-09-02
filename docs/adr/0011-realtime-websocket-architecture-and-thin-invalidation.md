# ADR-0011: Real-Time WebSocket Architecture, Event-Driven Invalidation, and VPS Deployment

## Status
Accepted

## Context
Previously, the frontend synced data by running client-side interval polling (5 to 8-second `setInterval` loops for proposals, Safe multisig queue status, Midtrans QRIS payment status, and transparency metrics).

While straightforward for local development, client polling causes several issues in production:
1. **Unnecessary Network & CPU Load**: If 100 concurrent users view the portal, ~4,800 redundant HTTP requests/minute are fired at the backend and PostgreSQL database with largely unchanged responses.
2. **Latency Gap**: On-chain indexer discoveries or API-triggered status changes are delayed by up to 8 seconds before becoming visible to users.
3. **VPS Resource Efficiency**: When running the backend on a self-hosted Linux VPS, keeping idle HTTP polling threads active wastes compute cycles compared to an event-driven push architecture.

## Decision
1. **Native Bun + Hono WebSocket Server (`/ws`)**:
   - Utilize Bun's native C++ WebSocket engine (`createBunWebSocket` in Hono) on route `/ws`.
   - Maintain a lightweight in-memory client connection set with automatic heartbeat (ping/pong) and channel multiplexing.

2. **Centralized Backend Event Broadcaster (`eventBus`)**:
   - Introduce an internal `eventBus.broadcast(event)` helper called by:
     - **Indexer Engine**: Broadcasts `ONCHAIN_EVENT_INDEXED`, `MERKLE_BATCH_SETTLED`, `PROPOSAL_STATE_CHANGED`.
     - **API Mutation Handlers**: Broadcasts `PROPOSAL_CREATED`, `PROPOSAL_APPROVED`, `PROPOSAL_EXECUTED`, `PROPOSAL_CANCELLED`, `AUDIT_ATTESTED`.
     - **Payment Webhook Handlers**: Broadcasts `DONATION_PAID`.

3. **Thin Invalidation Trigger Strategy (Web3 Standard)**:
   - WebSocket payload delivers lightweight event descriptors (< 200 bytes) with event type, timestamp, and entity IDs rather than large payload dumps.
   - Frontend React components listen to the global WebSocket stream, display real-time live toasts (Sonner), and trigger precise cache refetches without full page reloads.

4. **VPS Deployment Readiness (Nginx & Docker Compose)**:
   - Provide standard reverse proxy configuration in `nginx.conf` supporting `Upgrade: websocket` and `Connection "Upgrade"`.
   - Include `docker-compose.yml` defining production containerization for backend and frontend services.

## Consequences

### Positive
- **Instant UI Reaction**: Sub-100ms updates when transactions confirm on-chain or proposals receive approvals.
- **Zero Waste on Idle**: Zero database queries when no blockchain or donation activity is happening.
- **Scalable on VPS**: Bun's native WebSocket engine comfortably handles tens of thousands of concurrent connections with minimal RAM usage.

### Negative / Trade-offs
- Reverse proxies (Nginx/Caddy) must have WebSocket upgrade headers explicitly configured (provided in `nginx.conf`).
- Client needs auto-reconnection logic if temporary network interruptions occur (handled by `useWebSocket` hook with exponential backoff).
