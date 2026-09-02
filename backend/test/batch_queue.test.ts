import { describe, expect, it } from "bun:test";
import app from "../src/index";

describe("Merkle Batch Settlement Queue for PAID Donations (Ticket #20)", () => {
  it("Relayer should only batch PAID donations and mark them BATCHED", async () => {
    // 1. Create Donation A (will be PAID)
    const resA = await app.fetch(
      new Request("http://localhost:3001/api/donations/fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorName: "Muzakki Paid",
          isAnonymous: false,
          amountIDR: 1500000,
        }),
      })
    );
    const { invoice: invoiceA } = await resA.json();

    // 2. Create Donation B (remains PENDING)
    const resB = await app.fetch(
      new Request("http://localhost:3001/api/donations/fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorName: "Muzakki Pending Unpaid",
          isAnonymous: false,
          amountIDR: 500000,
        }),
      })
    );
    const { invoice: invoiceB } = await resB.json();

    // 3. Mark Donation A as PAID via simulator
    await app.fetch(
      new Request("http://localhost:3001/api/webhooks/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trxId: invoiceA.trxId }),
      })
    );

    // 4. Trigger Batch Settlement
    const batchRes = await app.fetch(
      new Request("http://localhost:3001/api/relayer/settle-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(batchRes.status).toBe(200);
    const batchBody = await batchRes.json();
    expect(batchBody.success).toBe(true);
    expect(batchBody.merkleRoot.startsWith("0x")).toBe(true);

    // 5. Verify Donation A is now BATCHED
    const statusResA = await app.fetch(
      new Request(`http://localhost:3001/api/donations/status/${invoiceA.trxId}`)
    );
    const statusBodyA = await statusResA.json();
    expect(statusBodyA.donation.status).toBe("BATCHED");
    expect(statusBodyA.donation.batchId).toBeDefined();

    // 6. Verify Donation B is still PENDING
    const statusResB = await app.fetch(
      new Request(`http://localhost:3001/api/donations/status/${invoiceB.trxId}`)
    );
    const statusBodyB = await statusResB.json();
    expect(statusBodyB.donation.status).toBe("PENDING");
  });
});
