import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import app from "../src/index";
import { eventBus } from "../src/ws";

describe("Native Bun + Hono WebSocket Server & Event Bus (ADR-0011)", () => {
  let server: any;
  const testPort = 3099;

  beforeAll(() => {
    // Start test server on dedicated testPort
    server = Bun.serve({
      port: testPort,
      fetch: app.fetch,
      websocket: (app as any).websocket,
    });
  });

  afterAll(() => {
    server.stop(true);
    eventBus.clear();
  });

  it("should establish WebSocket connection and receive CONNECTED handshake", async () => {
    const ws = new WebSocket(`ws://localhost:${testPort}/ws`);

    const handshakePromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Handshake timeout")), 3000);
      ws.onmessage = (event) => {
        clearTimeout(timeout);
        const data = JSON.parse(event.data.toString());
        resolve(data);
      };
      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };
    });

    const handshake = await handshakePromise;
    expect(handshake.type).toBe("CONNECTED");
    expect(handshake.data.clientId).toBeDefined();
    expect(eventBus.getClientCount()).toBeGreaterThanOrEqual(1);

    ws.close();
  });

  it("should reply with HEARTBEAT upon receiving PING frame", async () => {
    const ws = new WebSocket(`ws://localhost:${testPort}/ws`);

    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    const pongPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Pong timeout")), 3000);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data.toString());
        if (data.type === "HEARTBEAT") {
          clearTimeout(timeout);
          resolve(data);
        }
      };
    });

    ws.send(JSON.stringify({ type: "PING" }));
    const pong = await pongPromise;

    expect(pong.type).toBe("HEARTBEAT");
    expect(pong.data.pong).toBe(true);

    ws.close();
  });

  it("should broadcast real-time events to connected clients via eventBus", async () => {
    const ws = new WebSocket(`ws://localhost:${testPort}/ws`);

    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    const eventPromise = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Event broadcast timeout")), 3000);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data.toString());
        if (msg.type === "PROPOSAL_CREATED") {
          clearTimeout(timeout);
          resolve(msg);
        }
      };
    });

    // Broadcast test event
    const broadcastResult = eventBus.broadcast("PROPOSAL_CREATED", {
      proposalId: 999,
      asnafLabel: "Fisabilillah",
      amount: 5000000,
    });

    expect(broadcastResult.deliveredCount).toBeGreaterThanOrEqual(1);

    const receivedEvent = await eventPromise;
    expect(receivedEvent.type).toBe("PROPOSAL_CREATED");
    expect(receivedEvent.data.proposalId).toBe(999);
    expect(receivedEvent.data.asnafLabel).toBe("Fisabilillah");
    expect(receivedEvent.timestamp).toBeDefined();

    ws.close();
  });
});
