import { describe, it, expect } from "bun:test";
import app from "../src/index";
import { computeBeneficiaryHash } from "../src/ipfs";
import { keccak256, encodePacked } from "viem";

describe("Proposal Intake & Salted Hash Dossier Pipeline (Ticket #27)", () => {
  it("should validate required fields for proposal intake", async () => {
    const res = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Missing beneficiaryNIK and amount
          programTitle: "Bantuan Sembako",
          asnafCategory: 1, // Fakir
        }),
      })
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error).toBeDefined();
  });

  it("should compute collision-resistant salted hash matching canonical Keccak256 formula", () => {
    const nik = "3171012345670001";
    const name = "Suryanto";
    const salt = "secret_salt_xyz_2026";

    const computed = computeBeneficiaryHash(nik, name, salt);
    const expected = keccak256(
      encodePacked(["string", "string", "string"], [nik, name, salt])
    );

    expect(computed).toBe(expected);
    expect(computed.startsWith("0x")).toBe(true);
    expect(computed.length).toBe(66);
  });

  it("should intake proposal, generate salted hash, pin to IPFS, and return onchain params", async () => {
    const payload = {
      programTitle: "Modal Usaha UMKM Gerobak Berkah",
      asnafCategory: 2, // Miskin
      asnafLabel: "Miskin",
      amount: 5000000,
      currencyType: 0, // IDR
      beneficiaryName: "Ahmad Dahlan",
      beneficiaryNIK: "3201019876540002",
      locationCity: "Jakarta Timur",
      assessmentSummary: "Survei lapangan verified, SKTM kelurahan valid",
      periodId: 202608,
      evidenceFiles: [
        {
          fileName: "survey_kondisi_rumah.jpg",
          fileType: "image/jpeg",
          description: "Foto survei kelayakan kondisi tempat tinggal",
        },
      ],
    };

    const res = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.proposal).toBeDefined();
    expect(data.proposal.beneficiaryHash).toBeDefined();
    expect(data.proposal.beneficiaryNIKMasked).toBe("320101******0002");
    expect(data.proposal.ipfsProofCID).toBeDefined();
    expect(data.proposal.ipfsProofCID.startsWith("Qm")).toBe(true);
    expect(data.proposal.status).toBe("Pending");

    // Check onchain params payload for wallet execution
    expect(data.onChainParams).toBeDefined();
    expect(data.onChainParams.currencyType).toBe(0);
    expect(data.onChainParams.amount).toBe(5000000);
    expect(data.onChainParams.asnafCategory).toBe(2);
    expect(data.onChainParams.beneficiaryHash).toBe(data.proposal.beneficiaryHash);
    expect(data.onChainParams.ipfsProofCID).toBe(data.proposal.ipfsProofCID);
  });

  it("should sync onchain proposal ID and transaction hash", async () => {
    // First intake a proposal
    const intakeRes = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: "Beasiswa Anak Yatim",
          asnafCategory: 7, // Fisabilillah
          amount: 2500000,
          currencyType: 0,
          beneficiaryName: "Rian Pratama",
          beneficiaryNIK: "3172021122330004",
          locationCity: "Jakarta Selatan",
          periodId: 202608,
        }),
      })
    );

    const intakeData = await intakeRes.json();
    const proposalId = intakeData.proposal.proposalId;

    // Sync on-chain submission
    const syncRes = await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/sync-tx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalIdOnChain: 99,
          txHash: "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
        }),
      })
    );

    expect(syncRes.status).toBe(200);
    const syncData = await syncRes.json();
    expect(syncData.success).toBe(true);
    expect(syncData.proposal.proposalId).toBe(99);
    expect(syncData.proposal.txHash).toBe("0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890");
  });
});
