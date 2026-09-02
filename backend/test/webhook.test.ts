import { describe, expect, it } from "bun:test";
import app from "../src/index";
import crypto from "crypto";

describe("Webhook Settlement & Payment Simulator API (Ticket #19)", () => {
  const testServerKey = process.env.MIDTRANS_SERVER_KEY || "SB-Mid-server-TESTKEY12345";

  it("POST /api/webhooks/payment should verify signature and mark donation PAID", async () => {
    // 1. Create a donation
    const createRes = await app.fetch(
      new Request("http://localhost:3001/api/donations/fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorName: "Muzakki Webhook",
          isAnonymous: false,
          amountIDR: 2000000,
        }),
      })
    );
    const { invoice } = await createRes.json();
    const trxId = invoice.trxId;
    const amountStr = "2000000.00";

    // 2. Generate valid Midtrans signature
    const statusCode = "200";
    const rawSignature = `${trxId}${statusCode}${amountStr}${testServerKey}`;
    const signatureKey = crypto.createHash("sha512").update(rawSignature).digest("hex");

    const webhookPayload = {
      order_id: trxId,
      status_code: statusCode,
      gross_amount: amountStr,
      signature_key: signatureKey,
      transaction_status: "settlement",
      payment_type: "qris",
      settlement_time: new Date().toISOString(),
    };

    // 3. Send Webhook
    const webhookRes = await app.fetch(
      new Request("http://localhost:3001/api/webhooks/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      })
    );

    expect(webhookRes.status).toBe(200);
    const webhookBody = await webhookRes.json();
    expect(webhookBody.success).toBe(true);
    expect(webhookBody.status).toBe("PAID");

    // 4. Verify via status endpoint
    const statusRes = await app.fetch(
      new Request(`http://localhost:3001/api/donations/status/${trxId}`)
    );
    const statusBody = await statusRes.json();
    expect(statusBody.donation.status).toBe("PAID");
    expect(statusBody.donation.paidAt).toBeDefined();
  });

  it("POST /api/webhooks/payment should reject webhook with invalid signature", async () => {
    // 1. Create a donation
    const createRes = await app.fetch(
      new Request("http://localhost:3001/api/donations/fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorName: "Fake Payment Tester",
          isAnonymous: false,
          amountIDR: 500000,
        }),
      })
    );
    const { invoice } = await createRes.json();
    const trxId = invoice.trxId;

    // 2. Send Webhook with bogus signature
    const webhookPayload = {
      order_id: trxId,
      status_code: "200",
      gross_amount: "500000.00",
      signature_key: "bogus_signature_invalid_fake_123",
      transaction_status: "settlement",
      payment_type: "qris",
    };

    const webhookRes = await app.fetch(
      new Request("http://localhost:3001/api/webhooks/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      })
    );

    expect(webhookRes.status).toBe(401);
    const webhookBody = await webhookRes.json();
    expect(webhookBody.error).toBeDefined();

    // Verify donation remains PENDING
    const statusRes = await app.fetch(
      new Request(`http://localhost:3001/api/donations/status/${trxId}`)
    );
    const statusBody = await statusRes.json();
    expect(statusBody.donation.status).toBe("PENDING");
  });

  it("POST /api/webhooks/payment should be idempotent on duplicate calls", async () => {
    // 1. Create donation
    const createRes = await app.fetch(
      new Request("http://localhost:3001/api/donations/fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorName: "Idempotent Tester",
          isAnonymous: false,
          amountIDR: 1000000,
        }),
      })
    );
    const { invoice } = await createRes.json();
    const trxId = invoice.trxId;
    const amountStr = "1000000.00";

    const statusCode = "200";
    const signatureKey = crypto
      .createHash("sha512")
      .update(`${trxId}${statusCode}${amountStr}${testServerKey}`)
      .digest("hex");

    const payload = {
      order_id: trxId,
      status_code: statusCode,
      gross_amount: amountStr,
      signature_key: signatureKey,
      transaction_status: "settlement",
    };

    // First call -> 200
    const res1 = await app.fetch(
      new Request("http://localhost:3001/api/webhooks/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
    expect(res1.status).toBe(200);

    // Second duplicate call -> 200
    const res2 = await app.fetch(
      new Request("http://localhost:3001/api/webhooks/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.success).toBe(true);
  });

  it("POST /api/webhooks/simulator should simulate payment instantly", async () => {
    const createRes = await app.fetch(
      new Request("http://localhost:3001/api/donations/fiat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          donorName: "Simulated Muzakki",
          isAnonymous: false,
          amountIDR: 3000000,
        }),
      })
    );
    const { invoice } = await createRes.json();
    const trxId = invoice.trxId;

    const simRes = await app.fetch(
      new Request("http://localhost:3001/api/webhooks/simulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trxId }),
      })
    );

    expect(simRes.status).toBe(200);
    const simBody = await simRes.json();
    expect(simBody.success).toBe(true);
    expect(simBody.donation.status).toBe("PAID");
  });
});
