import { describe, it, expect } from "bun:test";
import app from "../src/index";
import { dbService } from "../src/db/index";

describe("Web3 USDC Inflow & Multi-Sig Governance Persistence (Tickets #24, #25)", () => {
  it("POST /api/donations/usdc should persist a USDC donation to Neon DB with status PAID", async () => {
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

  it("POST /api/proposals should record a new disbursement proposal", async () => {
    const proposalId = Math.floor(1000 + Math.random() * 9000);
    const payload = {
      proposalId,
      currencyType: 0,
      amount: 4500000,
      asnafCategory: 6,
      asnafLabel: "Fisabilillah",
      beneficiaryName: "Pesantren Al-Ikhlas",
      beneficiaryNIKMasked: "320101******0099",
      beneficiaryHash: "0x4455667788990011223344556677889900112233445566778899001122334455",
      ipfsProofCID: "QmTestCID123456789abcdef",
      periodId: 202608,
      txHash: "0xaaabbbcccdddeeefff000111222333444555666777888999aaabbbcccdddeeefff",
    };

    const res = await app.fetch(
      new Request("http://localhost:3001/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.proposal.proposalId).toBe(proposalId);
    expect(body.proposal.status).toBe("Pending");
    expect(body.proposal.approvalCount).toBe(1);

    // Verify GET /api/proposals contains the proposal
    const listRes = await app.fetch(new Request("http://localhost:3001/api/proposals"));
    const listBody = await listRes.json();
    expect(listBody.proposals.some((p: any) => p.proposalId === proposalId)).toBe(true);
  });

  it("POST /api/proposals/:id/approve should update approval count and status to Approved", async () => {
    const proposalId = Math.floor(10000 + Math.random() * 9000);
    await dbService.recordProposal({
      proposalId,
      currencyType: 0,
      amount: 3000000,
      asnafCategory: 0,
      asnafLabel: "Fakir",
      beneficiaryName: "Pak Slamet",
      beneficiaryNIKMasked: "317101******0044",
      beneficiaryHash: "0x1234123412341234123412341234123412341234123412341234123412341234",
      ipfsProofCID: "QmSlametProofCID",
      periodId: 202608,
      approvalCount: 1,
      approvedBy: ["Amil Internal (Pengusul)"],
      status: "Pending",
    });

    const res = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approverRole: "Dewan Pengawas Syariah (DPS)",
          txHash: "0xapprvtx123456",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.proposal.approvalCount).toBe(2);
    expect(body.proposal.status).toBe("Approved");
  });

  it("POST /api/proposals/:id/execute should mark proposal as Executed", async () => {
    const proposalId = Math.floor(20000 + Math.random() * 9000);
    await dbService.recordProposal({
      proposalId,
      currencyType: 0,
      amount: 5000000,
      asnafCategory: 1,
      asnafLabel: "Miskin",
      beneficiaryName: "Ibu Siti",
      beneficiaryNIKMasked: "317101******0055",
      beneficiaryHash: "0x5678567856785678567856785678567856785678567856785678567856785678",
      ipfsProofCID: "QmSitiProofCID",
      periodId: 202608,
      approvalCount: 2,
      approvedBy: ["Amil Internal (Pengusul)", "Dewan Pengawas Syariah (DPS)"],
      status: "Approved",
    });

    const res = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: "0xexecutetx987654",
        }),
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.proposal.status).toBe("Executed");
  });
});
