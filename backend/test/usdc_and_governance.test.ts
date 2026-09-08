import { describe, it, expect } from "bun:test";
import app from "../src/index";
import { isolateProtocolStore } from "./helpers/protocol-fixture";
import { dbService } from "../src/db/index";

describe("USDC donation API in isolated memory", () => {
  isolateProtocolStore();
  it("POST /api/donations/usdc should record a USDC donation in the test store with status PAID", async () => {
    const payload = {
      trxId: `TRX-USDC-TEST-${Date.now()}`,
      txHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      donorAddress: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
      donorName: "Muzakki Web3",
      isAnonymous: false,
      amountUSDC: 250,
      salt: "salt_usdc_test123",
      commitmentHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    };

    const res = await app.fetch(
      new Request("http://localhost:3001/api/donations/usdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.donation.trxId).toBe(payload.trxId);
    expect(body.donation.status).toBe("PAID");
    expect(body.donation.paymentMethod).toBe("USDC");
    expect(body.donation.amountUSDC).toBe(250);

    // Verify retrieval from dbService
    const stored = await dbService.getDonationByTrxId(payload.trxId);
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("PAID");
    expect(stored?.paymentMethod).toBe("USDC");
  });

  it("POST /api/donations/usdc should support Mode Hamba Allah with masked name", async () => {
    const payload = {
      trxId: `TRX-USDC-ANON-${Date.now()}`,
      txHash: "0x9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef",
      donorAddress: "0x5e9B652C4E8a013f6fAb69F0b55377c408B59968",
      donorName: "John Doe",
      isAnonymous: true,
      amountUSDC: 500,
      salt: "salt_usdc_anon456",
      commitmentHash: "0x1122334455667788990011223344556677889900112233445566778899001122",
    };

    const res = await app.fetch(
      new Request("http://localhost:3001/api/donations/usdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.donation.donorName).toBe("Hamba Allah");
    expect(body.donation.isAnonymous).toBe(true);
  });

});
