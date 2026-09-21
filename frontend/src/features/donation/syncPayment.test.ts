import { describe, expect, it } from "bun:test";
import { syncPaymentUntilPaid } from "./syncPayment";

const reply = (status: string) => new Response(JSON.stringify({ success: true, contribution: { status } }), { status: 200 });
const noWait = { intervalMs: 0, sleep: async () => {} };

describe("syncPaymentUntilPaid", () => {
  it("keeps asking the sync route until the payment is settled", async () => {
    const seen: string[] = [];
    const answers = ["PENDING", "PENDING", "PAID"];
    const fetchImpl = async (url: string) => { seen.push(url); return reply(answers.shift()!); };
    expect(await syncPaymentUntilPaid("TRX-1", { baseUrl: "http://api", fetchImpl, ...noWait })).toBe("PAID");
    expect(seen).toEqual(Array(3).fill("http://api/api/donations/status/TRX-1"));
  });

  it("treats a batched payment as settled too", async () => {
    expect(await syncPaymentUntilPaid("TRX-1", { baseUrl: "", fetchImpl: async () => reply("BATCHED"), ...noWait })).toBe("PAID");
  });

  it("survives a failing request and an error status", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      if (calls === 2) return new Response("{}", { status: 503 });
      return reply("PAID");
    };
    expect(await syncPaymentUntilPaid("TRX-1", { baseUrl: "", fetchImpl, ...noWait })).toBe("PAID");
    expect(calls).toBe(3);
  });

  it("gives up after the allowed attempts", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return reply("PENDING"); };
    expect(await syncPaymentUntilPaid("TRX-1", { baseUrl: "", fetchImpl, maxAttempts: 4, ...noWait })).toBe("TIMEOUT");
    expect(calls).toBe(4);
  });

  it("stops as soon as it is aborted", async () => {
    const controller = new AbortController();
    let calls = 0;
    const fetchImpl = async () => { calls += 1; controller.abort(); return reply("PENDING"); };
    expect(await syncPaymentUntilPaid("TRX-1", { baseUrl: "", fetchImpl, signal: controller.signal, ...noWait })).toBe("ABORTED");
    expect(calls).toBe(1);
  });

  it("encodes the reference in the URL", async () => {
    let seen = "";
    await syncPaymentUntilPaid("TRX 1/2", { baseUrl: "", fetchImpl: async (url: string) => { seen = url; return reply("PAID"); }, ...noWait });
    expect(seen).toBe("/api/donations/status/TRX%201%2F2");
  });
});
