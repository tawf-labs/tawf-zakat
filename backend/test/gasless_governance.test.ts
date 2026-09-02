import { describe, it, expect } from "bun:test";
import app, {
  GOVERNANCE_EIP712_DOMAIN,
  GOVERNANCE_EIP712_TYPES,
} from "../src/index";
import { dbService } from "../src/db/index";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";

const AUDITOR_ROLE_HASH = "0x3003ae5751e460db709762380ceeb0a0a748c8f2a9e2fe711468f692be74570c";

describe("Universal Gasless EIP-712 Governance Engine for Amil & DPS (Ticket #50 & ADR-0015)", () => {
  const amilAccount = privateKeyToAccount(generatePrivateKey());
  const dpsAccount = privateKeyToAccount(generatePrivateKey());
  const unauthorizedAccount = privateKeyToAccount(generatePrivateKey());

  it("1. Gasless Propose: Amil creates proposal via EIP-712 signature", async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const beneficiaryHash: Hex = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const amount = 3500000;
    const currencyType = 0; // IDR
    const asnafCategory = 1; // Fakir
    const ipfsProofCID = "ipfs://QmSamplePreApprovalDossier123";
    const periodId = 202608;
    const usdcRecipient = "0x0000000000000000000000000000000000000000";

    // Valid EIP-712 Signature by Amil
    const signature = await amilAccount.signTypedData({
      domain: GOVERNANCE_EIP712_DOMAIN,
      types: GOVERNANCE_EIP712_TYPES,
      primaryType: "AmilProposal",
      message: {
        currencyType,
        amount: BigInt(amount),
        asnafCategory,
        beneficiaryHash,
        ipfsProofCID,
        periodId: BigInt(periodId),
        usdcRecipient,
        timestamp: BigInt(timestamp),
      },
    });

    // Test Invalid signature rejection
    const invalidSignature = "0x" + "1".repeat(130);
    const rejectRes = await app.fetch(
      new Request("http://localhost:3001/api/governance/gasless-propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currencyType,
          amount,
          asnafCategory,
          beneficiaryHash,
          ipfsProofCID,
          periodId,
          usdcRecipient,
          timestamp,
          signature: invalidSignature,
          signerAddress: amilAccount.address,
          programTitle: "Program Modal Usaha Mustahik Gasless",
          beneficiaryName: "Pak Rahmat",
          beneficiaryNIK: "3271018899000002",
        }),
      })
    );
    expect(rejectRes.status).toBe(400);

    // Test Valid gasless proposal creation
    const proposeRes = await app.fetch(
      new Request("http://localhost:3001/api/governance/gasless-propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currencyType,
          amount,
          asnafCategory,
          beneficiaryHash,
          ipfsProofCID,
          periodId,
          usdcRecipient,
          timestamp,
          signature,
          signerAddress: amilAccount.address,
          programTitle: "Program Modal Usaha Mustahik Gasless",
          beneficiaryName: "Pak Rahmat",
          beneficiaryNIK: "3271018899000002",
        }),
      })
    );

    expect(proposeRes.status).toBe(200);
    const proposeData = await proposeRes.json();
    expect(proposeData.success).toBe(true);
    expect(proposeData.proposalId).toBeDefined();
    expect(proposeData.proposal.status).toBe("Pending");
    expect(proposeData.txHash).toBeDefined();
  }, 30000);

  it("2. Gasless Approve: DPS approves proposal via EIP-712 signature", async () => {
    // 1. Create a proposal first
    const intakeRes = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: "Bantuan Pangan Fakir Miskin",
          asnafCategory: 1,
          amount: 2000000,
          currencyType: 0,
          beneficiaryName: "Ibu Siti",
          beneficiaryNIK: "3271017766550003",
          locationCity: "Bandung",
          assessmentSummary: "Bantuan sembako lansia",
          periodId: 202608,
        }),
      })
    );
    const intakeData = await intakeRes.json();
    const proposalId = intakeData.proposal.proposalId;

    // 2. DPS EIP-712 Signature
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await dpsAccount.signTypedData({
      domain: GOVERNANCE_EIP712_DOMAIN,
      types: GOVERNANCE_EIP712_TYPES,
      primaryType: "DpsApproval",
      message: {
        proposalId: BigInt(proposalId),
        decision: "APPROVED",
        notes: "Memenuhi kriteria Asnaf Fakir sesuai fatwa DSN-MUI.",
        timestamp: BigInt(timestamp),
      },
    });

    const approveRes = await app.fetch(
      new Request("http://localhost:3001/api/governance/gasless-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          decision: "APPROVED",
          notes: "Memenuhi kriteria Asnaf Fakir sesuai fatwa DSN-MUI.",
          timestamp,
          signature,
          signerAddress: dpsAccount.address,
        }),
      })
    );

    expect(approveRes.status).toBe(200);
    const approveData = await approveRes.json();
    expect(approveData.success).toBe(true);
    expect(approveData.proposal.status).toBe("Approved");
    expect(approveData.txHash).toBeDefined();
  }, 30000);

  it("3. Gasless Execute: Amil executes approved proposal via EIP-712 signature", async () => {
    // 1. Create and Approve proposal
    const intakeRes = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: "Beasiswa Anak Yatim & Dhuafa",
          asnafCategory: 2,
          amount: 1500000,
          currencyType: 0,
          beneficiaryName: "Ahmad",
          beneficiaryNIK: "3271016655440004",
          locationCity: "Depok",
          periodId: 202608,
        }),
      })
    );
    const intakeData = await intakeRes.json();
    const proposalId = intakeData.proposal.proposalId;

    await app.fetch(
      new Request(`http://localhost:3001/api/proposals/${proposalId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approverRole: "Dewan Pengawas Syariah (DPS)" }),
      })
    );

    // 2. Amil signs execution EIP-712
    const timestamp = Math.floor(Date.now() / 1000);
    const disbursementReceiptCID = "ipfs://QmDisbursementBASTVerifiedReceipt";
    const signature = await amilAccount.signTypedData({
      domain: GOVERNANCE_EIP712_DOMAIN,
      types: GOVERNANCE_EIP712_TYPES,
      primaryType: "AmilExecution",
      message: {
        proposalId: BigInt(proposalId),
        disbursementReceiptCID,
        timestamp: BigInt(timestamp),
      },
    });

    const executeRes = await app.fetch(
      new Request("http://localhost:3001/api/governance/gasless-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          disbursementReceiptCID,
          timestamp,
          signature,
          signerAddress: amilAccount.address,
        }),
      })
    );

    expect(executeRes.status).toBe(200);
    const execData = await executeRes.json();
    expect(execData.success).toBe(true);
    expect(execData.proposal.status).toBe("Executed");
    expect(execData.txHash).toBeDefined();
  }, 30000);

  it("4. Gasless Cancel: DPS/Amil cancels proposal via EIP-712 signature", async () => {
    // 1. Create proposal
    const intakeRes = await app.fetch(
      new Request("http://localhost:3001/api/proposals/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programTitle: "Pengajuan Ditolak Syariah",
          asnafCategory: 1,
          amount: 1000000,
          currencyType: 0,
          beneficiaryName: "Fulan",
          beneficiaryNIK: "3271015544330005",
          locationCity: "Bogor",
          periodId: 202608,
        }),
      })
    );
    const intakeData = await intakeRes.json();
    const proposalId = intakeData.proposal.proposalId;

    // 2. Sign cancellation EIP-712
    const timestamp = Math.floor(Date.now() / 1000);
    const reason = "Dokumen verifikasi tidak valid / double claim terdeteksi.";
    const signature = await dpsAccount.signTypedData({
      domain: GOVERNANCE_EIP712_DOMAIN,
      types: GOVERNANCE_EIP712_TYPES,
      primaryType: "ProposalCancellation",
      message: {
        proposalId: BigInt(proposalId),
        reason,
        timestamp: BigInt(timestamp),
      },
    });

    const cancelRes = await app.fetch(
      new Request("http://localhost:3001/api/governance/gasless-cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          reason,
          timestamp,
          signature,
          signerAddress: dpsAccount.address,
        }),
      })
    );

    expect(cancelRes.status).toBe(200);
    const cancelData = await cancelRes.json();
    expect(cancelData.success).toBe(true);
    expect(cancelData.proposal.status).toBe("Cancelled");
    expect(cancelData.txHash).toBeDefined();
  }, 30000);

  it("5. Full End-to-End Gasless Multi-Party Lifecycle: Propose -> Approve -> Execute -> Attest WTP", async () => {
    const auditorAccount = privateKeyToAccount(generatePrivateKey());

    // Phase 1: Amil Gasless Propose
    const t1 = Math.floor(Date.now() / 1000);
    const benHash: Hex = "0x9876543210abcdef9876543210abcdef9876543210abcdef9876543210abcdef";
    const sigPropose = await amilAccount.signTypedData({
      domain: GOVERNANCE_EIP712_DOMAIN,
      types: GOVERNANCE_EIP712_TYPES,
      primaryType: "AmilProposal",
      message: {
        currencyType: 0,
        amount: 5000000n,
        asnafCategory: 2,
        beneficiaryHash: benHash,
        ipfsProofCID: "ipfs://QmFullE2EDossier",
        periodId: 202609n,
        usdcRecipient: "0x0000000000000000000000000000000000000000",
        timestamp: BigInt(t1),
      },
    });

    const res1 = await app.fetch(
      new Request("http://localhost:3001/api/governance/gasless-propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currencyType: 0,
          amount: 5000000,
          asnafCategory: 2,
          beneficiaryHash: benHash,
          ipfsProofCID: "ipfs://QmFullE2EDossier",
          periodId: 202609,
          timestamp: t1,
          signature: sigPropose,
          signerAddress: amilAccount.address,
          programTitle: "Program Bantuan Usaha Mikro Asnaf Miskin",
          beneficiaryName: "Ibu Nurhayati",
          beneficiaryNIK: "3171012345670009",
        }),
      })
    );
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    const proposalId = data1.proposalId;
    expect(data1.proposal.status).toBe("Pending");

    // Phase 2: DPS Gasless Approve
    const t2 = Math.floor(Date.now() / 1000);
    const sigApprove = await dpsAccount.signTypedData({
      domain: GOVERNANCE_EIP712_DOMAIN,
      types: GOVERNANCE_EIP712_TYPES,
      primaryType: "DpsApproval",
      message: {
        proposalId: BigInt(proposalId),
        decision: "APPROVED",
        notes: "Survei dan dokumen kelayakan asnaf lengkap & sesuai PSAK 109.",
        timestamp: BigInt(t2),
      },
    });

    const res2 = await app.fetch(
      new Request("http://localhost:3001/api/governance/gasless-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          decision: "APPROVED",
          notes: "Survei dan dokumen kelayakan asnaf lengkap & sesuai PSAK 109.",
          timestamp: t2,
          signature: sigApprove,
          signerAddress: dpsAccount.address,
        }),
      })
    );
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.proposal.status).toBe("Approved");

    // Phase 3: Amil Gasless Execute with BAST
    const t3 = Math.floor(Date.now() / 1000);
    const bastCID = "ipfs://QmBASTE2EVerifiedReceiptCID";
    const sigExec = await amilAccount.signTypedData({
      domain: GOVERNANCE_EIP712_DOMAIN,
      types: GOVERNANCE_EIP712_TYPES,
      primaryType: "AmilExecution",
      message: {
        proposalId: BigInt(proposalId),
        disbursementReceiptCID: bastCID,
        timestamp: BigInt(t3),
      },
    });

    const res3 = await app.fetch(
      new Request("http://localhost:3001/api/governance/gasless-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          disbursementReceiptCID: bastCID,
          timestamp: t3,
          signature: sigExec,
          signerAddress: amilAccount.address,
        }),
      })
    );
    expect(res3.status).toBe(200);
    const data3 = await res3.json();
    expect(data3.proposal.status).toBe("Executed");

    // Phase 4: Independent Auditor Gasless WTP Attestation
    // Auditor identity must be onboarded (AUDITOR_ROLE + registry profile) before attesting.
    await dbService.grantRoleMember(AUDITOR_ROLE_HASH, "AUDITOR_ROLE", auditorAccount.address);
    await dbService.upsertAuditorProfile({
      accountAddress: auditorAccount.address,
      name: "KAP Sharia Trust & Public Auditor",
      kapLicenseNumber: "AP.1234",
      licenseProofCID: "ipfs://QmLicenseProofE2ETest",
      registeredBy: "0xTestAdmin0000000000000000000000000000",
    });

    const laiDocumentCID = "ipfs://QmLaiDocumentE2ETest";
    const financialStatementsCID = "ipfs://QmFinancialStatementsE2ETest";
    const t4 = Math.floor(Date.now() / 1000);
    const sigAttest = await auditorAccount.signTypedData({
      domain: GOVERNANCE_EIP712_DOMAIN,
      types: GOVERNANCE_EIP712_TYPES,
      primaryType: "AuditorAttestation",
      message: {
        proposalId: BigInt(proposalId),
        beneficiaryHash: benHash,
        amountIDR: 5000000n,
        auditOpinion: "WTP",
        standard: "PSAK 109 & Fikih BAZNAS",
        auditorName: "KAP Sharia Trust & Public Auditor",
        laiDocumentCID,
        financialStatementsCID,
        timestamp: BigInt(t4),
      },
    });

    const res4 = await app.fetch(
      new Request("http://localhost:3001/api/governance/attest-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proposalId,
          auditOpinion: "WTP",
          laiDocumentCID,
          financialStatementsCID,
          timestamp: t4,
          signature: sigAttest,
          auditorAddress: auditorAccount.address,
        }),
      })
    );
    expect(res4.status).toBe(200);
    const data4 = await res4.json();
    expect(data4.success).toBe(true);
    expect(data4.proposal.auditStatus).toBe("AUDITED_WTP");
  }, 30000);
});

