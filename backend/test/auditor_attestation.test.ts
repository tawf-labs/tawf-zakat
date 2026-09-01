import { describe, it, expect } from "bun:test";
import app, { AUDITOR_EIP712_DOMAIN, AUDITOR_EIP712_TYPES } from "../src/index";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";

describe("Independent Auditor Attestation Engine & On-Chain Certification (Ticket #33 & ADR-0009)", () => {
  it("should record auditor attestation with EIP-712 cryptographic signature and verify authorship", async () => {
    // 1. Setup a test Auditor Account
    const auditorPrivateKey = generatePrivateKey();
    const auditorAccount = privateKeyToAccount(auditorPrivateKey);

    // 2. Intake proposal
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
    const beneficiaryHash = intakeData.proposal.beneficiaryHash;

    // 3. Approve & Execute
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

    // 4. Generate valid EIP-712 signature from Auditor Wallet
    const messageTimestamp = Math.floor(Date.now() / 1000);
    const signature = await auditorAccount.signTypedData({
      domain: AUDITOR_EIP712_DOMAIN,
      types: AUDITOR_EIP712_TYPES,
      primaryType: "AuditorAttestation",
      message: {
        proposalId: BigInt(proposalId),
        beneficiaryHash: beneficiaryHash as Hex,
        amountIDR: 5000000n,
        auditOpinion: "WTP",
        standard: "PSAK 109 / SAS 109 & BAZNAS Sharia Compliance Standard",
        auditorName: "Kantor Akuntan Publik (KAP) Sharia Trust",
        timestamp: BigInt(messageTimestamp),
      },
    });

    // 5. Test Invalid/Forged Signature Rejection
    const invalidSignature = "0x" + "9".repeat(130);
    const rejectRes = await app.fetch(
      new Request("http://localhost:3001/api/audit/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          auditorName: "Kantor Akuntan Publik (KAP) Sharia Trust",
          auditorAddress: auditorAccount.address,
          auditOpinion: "WTP",
          signature: invalidSignature,
          messageTimestamp,
        }),
      })
    );
    expect(rejectRes.status).toBe(401);

    // 6. Test Valid EIP-712 Attestation Submission
    const attestRes = await app.fetch(
      new Request("http://localhost:3001/api/audit/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          auditorName: "Kantor Akuntan Publik (KAP) Sharia Trust",
          auditorAddress: auditorAccount.address,
          auditOpinion: "WTP",
          auditNotes: "Penyaluran sesuai standar PSAK 109, mutasi bank cocok dengan BAST.",
          auditCertFileName: "opini_audit_psak109_maryam.pdf",
          signature,
          messageTimestamp,
        }),
      })
    );

    expect(attestRes.status).toBe(200);
    const attestData = await attestRes.json();
    expect(attestData.success).toBe(true);
    expect(attestData.isCryptographicallySigned).toBe(true);
    expect(attestData.auditorSignature).toBe(signature);
    expect(attestData.auditReportCID).toBeDefined();
    expect(attestData.auditTxHash).toBeDefined();
    expect(attestData.proposal.auditStatus).toBe("AUDITED_WTP");
  }, 20000);
});
