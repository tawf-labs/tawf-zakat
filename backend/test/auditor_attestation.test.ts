import { describe, it, expect } from "bun:test";
import app from "../src/index";

describe("Independent Auditor Attestation Engine & On-Chain Certification (Ticket #33)", () => {
  it("should record auditor attestation with WTP opinion and pin audit report to IPFS", async () => {
    // 1. First intake a proposal
    const intakeRes = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: "Bantuan Modal Usaha Asnaf Miskin",
          asnafCategory: 2, // Miskin
          amount: 5000000,
          currencyType: 0,
          beneficiaryName: "Ibu Maryam",
          beneficiaryNIK: "3171019988770001",
          locationCity: "Jakarta Selatan",
          assessmentSummary: "Pedagang gorengan keliling membutuhkan modal bahan pokok.",
          periodId: 202608,
        }),
      })
    );
    expect(intakeRes.status).toBe(200);
    const intakeData = await intakeRes.json();
    const proposalId = intakeData.proposal.proposalId;

    // 2. Approve & Execute
    await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approverRole: "Dewan Pengawas Syariah (DPS)" }),
      })
    );

    await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/bast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankReferenceNumber: "TRX-BSI-AUDIT-001",
          disbursementChannel: "BANK_TRANSFER",
          signedByAmil: "Amil Lapangan",
        }),
      })
    );

    await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: "0x9999888877776666555544443333222211110000aaaabbbbccccddddeeeeffff" }),
      })
    );

    // 3. Auditor submits Attestation (Wajar Tanpa Pengecualian / WTP)
    const attestRes = await app.fetch(
      new Request("http://localhost:3001/api/audit/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          auditorName: "Kantor Akuntan Publik (KAP) Sharia Trust",
          auditorAddress: "0xAuditorAddress1234567890abcdef",
          auditOpinion: "WTP", // Wajar Tanpa Pengecualian
          auditNotes: "Penyaluran sesuai standar PSAK 109, mutasi bank cocok dengan BAST dan tidak ditemukan double claim.",
          auditCertFileName: "opini_audit_psak109_maryam.pdf",
          auditTxHash: "0xattesttx11223344556677889900aabbccddeeff11223344556677889900aabbccdd",
        }),
      })
    );

    expect(attestRes.status).toBe(200);
    const attestData = await attestRes.json();
    expect(attestData.success).toBe(true);
    expect(attestData.auditReportCID).toBeDefined();
    expect(attestData.proposal.auditStatus).toBe("AUDITED_WTP");
    expect(attestData.proposal.auditOpinion).toBe("WTP");

    // 4. Verify in Audit Overview
    const overviewRes = await app.fetch(new Request("http://localhost:3001/api/audit/overview"));
    expect(overviewRes.status).toBe(200);
    const overviewData = await overviewRes.json();
    expect(overviewData.success).toBe(true);
    expect(overviewData.totalAudited).toBeGreaterThanOrEqual(1);
    expect(overviewData.wtpRatePercentage).toBeDefined();
  }, 15000);
});
