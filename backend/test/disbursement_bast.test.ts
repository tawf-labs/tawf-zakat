import { describe, it, expect } from "bun:test";
import app from "../src/index";

describe("Disbursement Execution, Multi-Unit Settlement & BAST Pipeline (Ticket #29)", () => {
  it("should upload BAST receipt metadata to IPFS and attach CID to proposal", async () => {
    // 1. Create a proposal
    const intakeRes = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: "Bantuan Modal Usaha Gerobak Berkah",
          asnafCategory: 2, // Miskin
          amount: 3500000,
          currencyType: 0,
          beneficiaryName: "Pak Supardi",
          beneficiaryNIK: "3175051234560008",
          locationCity: "Jakarta Utara",
          periodId: 202608,
        }),
      })
    );
    const intakeData = await intakeRes.json();
    const proposalId = intakeData.proposal.proposalId;

    // 2. Approve to reach Quorum
    await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approverRole: "Dewan Pengawas Syariah (DPS)",
        }),
      })
    );

    // 3. Upload BAST receipt & delivery photos
    const bastRes = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/bast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankReferenceNumber: "TRX-BANK-20260829-994812",
          disbursementChannel: "BANK_TRANSFER",
          signedByAmil: "Ahmad Fauzi (Amil Lapangan)",
          bastDocumentFileName: "scan_bast_tanda_tangan_penerima.pdf",
          photoEvidenceFileName: "foto_serah_terima_tersamar.jpg",
        }),
      })
    );

    expect(bastRes.status).toBe(200);
    const bastData = await bastRes.json();
    expect(bastData.success).toBe(true);
    expect(bastData.disbursementReceiptCID).toBeDefined();
    expect(bastData.disbursementReceiptCID.startsWith("Qm")).toBe(true);
    expect(bastData.receiptMetadata).toBeDefined();
    expect(bastData.receiptMetadata.bankReferenceNumber).toBe("TRX-BANK-20260829-994812");

    // 4. Execute disbursement
    const execRes = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: "0x7777888899990000aaaabbbbccccddddeeeeffff111122223333444455556666",
        }),
      })
    );

    expect(execRes.status).toBe(200);
    const execData = await execRes.json();
    expect(execData.success).toBe(true);
    expect(execData.proposal.status).toBe("Executed");
    expect(execData.proposal.executedAt).toBeDefined();
  }, 30000);
});
