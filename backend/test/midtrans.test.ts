import { describe, expect, it } from "bun:test";
import { chargeQRIS, verifyMidtransSignature } from "../src/midtrans";
import crypto from "crypto";

describe("Midtrans Service & Signature Verifier", () => {
  const mockServerKey = "SB-Mid-server-TESTKEY12345";

  it("should verify valid Midtrans SHA-512 signature", () => {
    const orderId = "TRX-20260826-1001";
    const statusCode = "200";
    const grossAmount = "1000000.00";
    
    // Expected signature: SHA512(orderId + statusCode + grossAmount + serverKey)
    const raw = `${orderId}${statusCode}${grossAmount}${mockServerKey}`;
    const validSignature = crypto.createHash("sha512").update(raw).digest("hex");

    const isValid = verifyMidtransSignature(
      orderId,
      statusCode,
      grossAmount,
      mockServerKey,
      validSignature
    );

    expect(isValid).toBe(true);
  });

  it("should reject invalid Midtrans signature", () => {
    const orderId = "TRX-20260826-1001";
    const statusCode = "200";
    const grossAmount = "1000000.00";
    const invalidSignature = "invalid_signature_hash_12345";

    const isValid = verifyMidtransSignature(
      orderId,
      statusCode,
      grossAmount,
      mockServerKey,
      invalidSignature
    );

    expect(isValid).toBe(false);
  });

  it("chargeQRIS should generate a valid dynamic QRIS payload in sandbox mock mode", async () => {
    const trxId = "TRX-20260826-9999";
    const amountIDR = 500000;
    const donorName = "Muzakki Test";

    const chargeResult = await chargeQRIS(trxId, amountIDR, donorName);

    expect(chargeResult).toBeDefined();
    expect(chargeResult.trxId).toBe(trxId);
    expect(chargeResult.amountIDR).toBe(amountIDR);
    expect(chargeResult.qrString).toBeDefined();
    expect(chargeResult.qrString.length).toBeGreaterThan(10);
    expect(chargeResult.qrUrl).toBeDefined();
  });
});
