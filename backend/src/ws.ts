import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";

export type RealtimeEventType =
  | "CONNECTED"
  | "HEARTBEAT"
  | "ONCHAIN_EVENT_INDEXED"
  | "DONATION_RECEIVED"
  | "DONATION_PAID"
  | "PROPOSAL_CREATED"
  | "PROPOSAL_APPROVED"
  | "PROPOSAL_EXECUTED"
  | "PROPOSAL_CANCELLED"
  | "AUDIT_ATTESTED"
  | "AUDITOR_REGISTERED"
  | "MERKLE_BATCH_SETTLED"
  | "ROLE_MEMBERS_CHANGED";

export interface RealtimeEvent<T = any> {
  type: RealtimeEventType;
  data?: T;
  timestamp: string;
}

// Active connected clients set
const activeSockets = new Set<any>();

export const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

export const eventBus = {
  /**
   * Broadcast typed event to all connected WebSocket clients
   */
  broadcast<T = any>(type: RealtimeEventType, data?: T): { deliveredCount: number; totalClients: number } {
    const payload: RealtimeEvent<T> = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    const message = JSON.stringify(payload);

    let deliveredCount = 0;
    for (const ws of activeSockets) {
      try {
        if (ws.readyState === 1 || ws.readyState === WebSocket.OPEN || ws.readyState === undefined) {
          ws.send(message);
          deliveredCount++;
        }
      } catch (err) {
        console.warn("[WebSocket] Error sending message to client socket:", err);
        activeSockets.delete(ws);
      }
    }
    return { deliveredCount, totalClients: activeSockets.size };
  },

  /**
   * Return number of currently active WebSocket connections
   */
  getClientCount(): number {
    return activeSockets.size;
  },

  /**
   * Clear all client references (used for test isolation)
   */
  clear() {
    activeSockets.clear();
  },
};

/**
 * Creates the WebSocket route handler for Hono
 */
export function createWebSocketHandler() {
  return upgradeWebSocket((c) => {
    const clientId = `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    return {
      onOpen(_event, ws) {
        activeSockets.add(ws);
        // Send initial connection handshake
        try {
          ws.send(
            JSON.stringify({
              type: "CONNECTED",
              data: {
                clientId,
                serverTime: new Date().toISOString(),
                protocol: "ZakatProtocol Realtime WebSocket v1.0",
              },
              timestamp: new Date().toISOString(),
            })
          );
        } catch (err) {
          console.warn("[WebSocket] Failed to send CONNECTED handshake:", err);
        }
      },

      onMessage(event, ws) {
        try {
          const raw = typeof event.data === "string" ? event.data : event.data.toString();
          const parsed = JSON.parse(raw);

          // Heartbeat ping from client
          if (parsed.type === "PING") {
            ws.send(
              JSON.stringify({
                type: "HEARTBEAT",
                data: { pong: true, timestamp: Date.now() },
                timestamp: new Date().toISOString(),
              })
            );
          }
        } catch {
          // Ignore malformed text frames
        }
      },

      onClose(_event, ws) {
        activeSockets.delete(ws);
      },

      onError(_event, ws) {
        activeSockets.delete(ws);
      },
    };
  });
}
