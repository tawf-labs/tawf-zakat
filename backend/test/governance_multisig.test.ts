import { describe, it, expect } from "bun:test";
import app from "../src/index";

describe("Multi-Sig Governance Approval & Role Review Portal (Ticket #28)", () => {
  it("should list pending proposals with IPFS proof CIDs and Asnaf labels", async () => {
    const res = await app.fetch(new Request("http://localhost:3001/api/proposals"));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(Array.isArray(data.proposals)).toBe(true);
    expect(data.proposals.length).toBeGreaterThan(0);

    const first = data.proposals[0];
    expect(first.proposalId).toBeDefined();
    expect(first.status).toBeDefined();
    expect(first.ipfsProofCID).toBeDefined();
    expect(first.asnafLabel).toBeDefined();
  });

  it("should approve a pending proposal, update approval count, and transition status to Approved upon quorum", async () => {
    // 1. Create a fresh proposal
    const intakeRes = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: "Bantuan Sembako Fakir",
          asnafCategory: 1, // Fakir
          amount: 1500000,
          currencyType: 0,
          beneficiaryName: "Ibu Maryam",
          beneficiaryNIK: "3173014455660007",
          locationCity: "Jakarta Barat",
          periodId: 202608,
        }),
      })
    );
    const intakeData = await intakeRes.json();
    const proposalId = intakeData.proposal.proposalId;

    // 2. Approve by Dewan Pengawas Syariah (DPS)
    const approveRes = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approverRole: "Dewan Pengawas Syariah (DPS)",
          txHash: "0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff",
        }),
      })
    );

    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.success).toBe(true);
    expect(approveData.proposal.approvalCount).toBe(2);
    expect(approveData.proposal.status).toBe("Approved");
    expect(approveData.proposal.approvedBy).toContain("Dewan Pengawas Syariah (DPS)");
  });

  it("should cancel a pending proposal with reason string", async () => {
    // 1. Create a proposal to cancel
    const intakeRes = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: "Program Invalid",
          asnafCategory: 6, // Gharimin
          amount: 4000000,
          currencyType: 0,
          beneficiaryName: "Bpk. Target Batal",
          beneficiaryNIK: "3174029988770009",
          locationCity: "Jakarta Pusat",
          periodId: 202608,
        }),
      })
    );
    const intakeData = await intakeRes.json();
    const proposalId = intakeData.proposal.proposalId;

    // 2. Cancel proposal
    const cancelRes = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cancellerRole: "Dewan Pengawas Syariah (DPS)",
          cancelReason: "Tidak memenuhi kriteria asnaf gharimin syariah",
          txHash: "0x9999888877776666555544443333222211110000ffffeeeeddddccccbbbbaaaa",
        }),
      })
    );

    expect(cancelRes.status).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.success).toBe(true);
    expect(cancelData.proposal.status).toBe("Cancelled");
    expect(cancelData.proposal.cancelReason).toBe("Tidak memenuhi kriteria asnaf gharimin syariah");
  });
});
