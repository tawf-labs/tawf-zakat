import { describe, it, expect } from "bun:test";
import app from "../src/index";

describe("Public Transparency Audit Trail & Verifiable Proof Explorer (Ticket #30)", () => {
  it("should execute full lifecycle: intake -> approval quorum -> BAST pinning -> execution -> public audit trail inspection", async () => {
    // 1. Intake Proposal with Salted Privacy Hash
    const intakeRes = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: "Program Beasiswa Santri Yatim Fisabilillah",
          asnafCategory: 7, // Fisabilillah
          amount: 2500000,
          currencyType: 0, // IDR
          beneficiaryName: "Ahmad Santri",
          beneficiaryNIK: "3201018899000005",
          locationCity: "Bogor",
          assessmentSummary: "Santri berprestasi penghafal Al-Qur'an dari keluarga pra-sejahtera.",
          periodId: 202608,
        }),
      })
    );

    expect(intakeRes.status).toBe(200);
    const intakeData = await intakeRes.json();
    const proposalId = intakeData.proposal.proposalId;
    const proposalCID = intakeData.proposal.ipfsProofCID;
    const beneficiaryHash = intakeData.proposal.beneficiaryHash;

    expect(proposalCID).toBeDefined();
    expect(beneficiaryHash).toBeDefined();
    expect(intakeData.onChainParams).toBeDefined();

    // 2. Sync On-Chain Transaction Hash
    await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/sync-tx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalIdOnChain: proposalId,
          txHash: "0xaaaa1111222233334444555566667777888899990000bbbbccccddddeeeeffff",
        }),
      })
    );

    // 3. Multi-Sig Approval by Dewan Pengawas Syariah (DPS)
    const approveRes = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approverRole: "Dewan Pengawas Syariah (DPS)",
          txHash: "0xbbbb2222333344445555666677778888999900001111ccccddddeeeeffffaaaa",
        }),
      })
    );
    const approveData = await approveRes.json();
    expect(approveData.proposal.status).toBe("Approved");
    expect(approveData.proposal.approvalCount).toBe(2);

    // 4. Amil Uploads BAST Receipt to IPFS
    const bastRes = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/bast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankReferenceNumber: "TRX-BSI-E2E-20260829",
          disbursementChannel: "BANK_TRANSFER",
          signedByAmil: "Ustadz H. Lukman Hakim",
          bastDocumentFileName: "bast_beasiswa_santri.pdf",
          photoEvidenceFileName: "foto_penyerahan_beasiswa.jpg",
        }),
      })
    );
    const bastData = await bastRes.json();
    const bastCID = bastData.disbursementReceiptCID;
    expect(bastCID).toBeDefined();

    // 5. Execute Disbursement
    const execRes = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: "0xcccc3333444455556666777788889999000011112222ddddeeeeffffaaaabbbb",
        }),
      })
    );
    const execData = await execRes.json();
    expect(execData.proposal.status).toBe("Executed");

    // 6. Public Transparency & Audit Trail Verification
    const auditRes = await app.fetch(new Request("http://localhost:3001/api/proposals"));
    const auditData = await auditRes.json();
    const verifiedProposal = auditData.proposals.find((p: any) => p.proposalId === proposalId);

    expect(verifiedProposal).toBeDefined();
    expect(verifiedProposal.status).toBe("Executed");
    expect(verifiedProposal.ipfsProofCID).toBe(proposalCID);
    expect(verifiedProposal.disbursementReceiptCID).toBe(bastCID);
    expect(verifiedProposal.asnafLabel).toBe("Fisabilillah");
    expect(verifiedProposal.beneficiaryHash).toBe(beneficiaryHash);
  });
});
