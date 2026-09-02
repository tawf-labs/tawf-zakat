import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";

export type WebSocketStatus = "connected" | "connecting" | "disconnected";

export interface RealtimeMessage<T = any> {
  type: string;
  data?: T;
  timestamp: string;
}

type EventCallback = (data: any) => void;

interface WebSocketContextType {
  status: WebSocketStatus;
  isConnected: boolean;
  subscribe: (eventType: string, callback: EventCallback) => () => void;
  send: (type: string, data?: any) => void;
}

const WebSocketContext = createContext<WebSocketContextType>({
  status: "disconnected",
  isConnected: false,
  subscribe: () => () => {},
  send: () => {},
});

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<WebSocketStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<string, Set<EventCallback>>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const getWsUrl = () => {
    if (typeof window === "undefined") return "ws://localhost:3001/ws";
    const host = window.location.hostname;
    // If running in development (port 5173 / 3000), point to backend on 3001
    if (window.location.port && window.location.port !== "80" && window.location.port !== "443") {
      return `ws://${host}:3001/ws`;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  };

  const connect = useCallback(() => {
    if (typeof window === "undefined") return;

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setStatus("connecting");
    const url = getWsUrl();

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("connected");
        reconnectAttemptsRef.current = 0;
        console.log("🟢 [WebSocket] Connected to ZakatProtocol Live Stream");
      };

      ws.onmessage = (event) => {
        try {
          const message: RealtimeMessage = JSON.parse(event.data);
          handleIncomingMessage(message);
        } catch (err) {
          console.warn("[WebSocket] Failed to parse message:", err);
        }
      };

      ws.onclose = () => {
        setStatus("disconnected");
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      setStatus("disconnected");
      scheduleReconnect();
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) return;

    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 15000);
    reconnectAttemptsRef.current += 1;

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  const handleIncomingMessage = (message: RealtimeMessage) => {
    const { type, data } = message;

    // 1. Trigger global Toast notifications for important events
    switch (type) {
      case "DONATION_PAID":
        toast.success("Donasi Zakat Terverifikasi!", {
          description: `Donasi sebesar Rp ${Number(data?.amountIDR || 0).toLocaleString("id-ID")} berhasil dibayar & tercatat di buku kas.`,
        });
        break;

      case "PROPOSAL_CREATED":
        toast.info("Proposal Zakat Baru Diajukan", {
          description: `Proposal #${data?.proposalId} (Asnaf: ${data?.asnafLabel || "Mustahik"}) telah masuk ke antrean persetujuan DPS.`,
        });
        break;

      case "PROPOSAL_APPROVED":
        if (data?.isQuorumMet) {
          toast.success("Kuorum Multi-Sig Terpenuhi!", {
            description: `Proposal #${data?.proposalId} telah disetujui kuorum DPS dan siap untuk dicairkan/BAST.`,
          });
        }
        break;

      case "PROPOSAL_EXECUTED":
        toast.success("Penyaluran Zakat Direalisasikan!", {
          description: `Proposal #${data?.proposalId} telah selesai disalurkan dan bukti BAST di-pin ke IPFS.`,
        });
        break;

      case "AUDIT_ATTESTED":
        toast.success("Atestasi Audit WTP Diterbitkan!", {
          description: `Proposal #${data?.proposalId} telah tersertifikasi WTP oleh ${data?.auditorName || "Auditor KAP"}.`,
        });
        break;

      case "MERKLE_BATCH_SETTLED":
        toast.success("Batch Zakat Selesai di Sepolia L1!", {
          description: `Batch #${data?.batchId} berisi ${data?.itemCount || 1} donasi berhasil diselesaikan di blockchain.`,
        });
        break;
    }

    // 2. Notify all registered event listeners
    const callbacks = listenersRef.current.get(type);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }

    // Also notify wildcard "*" listeners
    const wildcardCallbacks = listenersRef.current.get("*");
    if (wildcardCallbacks) {
      wildcardCallbacks.forEach((cb) => cb(message));
    }
  };

  const subscribe = useCallback((eventType: string, callback: EventCallback) => {
    if (!listenersRef.current.has(eventType)) {
      listenersRef.current.set(eventType, new Set());
    }
    listenersRef.current.get(eventType)!.add(callback);

    return () => {
      const callbacks = listenersRef.current.get(eventType);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          listenersRef.current.delete(eventType);
        }
      }
    };
  }, []);

  const send = useCallback((type: string, data?: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  useEffect(() => {
    connect();

    // Send heartbeat every 30 seconds to keep connection alive through NAT/proxies
    const heartbeatInterval = setInterval(() => {
      send("PING");
    }, 30000);

    return () => {
      clearInterval(heartbeatInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect, send]);

  return (
    <WebSocketContext.Provider
      value={{
        status,
        isConnected: status === "connected",
        subscribe,
        send,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  return useContext(WebSocketContext);
}
