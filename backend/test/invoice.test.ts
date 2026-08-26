import { describe, expect, it } from "bun:test";
import app from "../src/index";

describe("Fiat Invoice Generation & Status API (Ticket #18)", () => {
  it("POST /api/donations/fiat should create a PENDING invoice with QRIS data", async () => {
    const payload = {
      donorName: "Fulan bin Fulan",
      isAnonymous: false,
      amountIDR: 1500000,
    };

    const res = await app.fetch(
      new Request("http://localhost:3001/api/donations/fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.invoice).toBeDefined();
    expect(body.invoice.trxId.startsWith("TRX-")).toBe(true);
    expect(body.invoice.status).toBe("PENDING");
    expect(body.invoice.amountIDR).toBe(1500000);
    expect(body.invoice.qrString).toBeDefined();
    expect(body.invoice.qrUrl).toBeDefined();
    expect(body.invoice.salt).toBeDefined();
  });

  it("GET /api/donations/status/:trxId should return current invoice state", async () => {
    // 1. Create invoice
    const createRes = await app.fetch(
      new Request("http://localhost:3001/api/donations/fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorName: "Ahmad",
          isAnonymous: true,
          amountIDR: 750000,
        }),
      })
    );
    const createBody = await createRes.json();
    const trxId = createBody.invoice.trxId;

    // 2. Query status
    const statusRes = await app.fetch(
      new Request(`http://localhost:3001/api/donations/status/${trxId}`)
    );
    expect(statusRes.status).toBe(200);
    const statusBody = await statusRes.json();
    expect(statusBody.success).toBe(true);
    expect(statusBody.donation.trxId).toBe(trxId);
    expect(statusBody.donation.status).toBe("PENDING");
    expect(statusBody.donation.donorName).toBe("Hamba Allah");
    expect(statusBody.donation.amountIDR).toBe(750000);
  });

  it("GET /api/donations/status/:trxId should return 404 for non-existent transaction", async () => {
    const res = await app.fetch(
      new Request("http://localhost:3001/api/donations/status/TRX-NONEXISTENT-999")
    );
    expect(res.status).toBe(404);
  });
});
