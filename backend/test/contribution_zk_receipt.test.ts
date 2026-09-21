/**
 * Integration & Acceptance Tests for Real ZK Groth16 Receipt Proofs (Spec #100, Issue #108).
 *
 * Covers:
 * - AC01: Pinned Circom/Groth16 BN254 circuit membership proof.
 * - AC02: Snapshot batch and Poseidon Merkle root formed from genuine contributions (#102).
 * - AC03: Witness isolation: donor amount, salt, purpose, and Merkle siblings stay private.
 * - AC04: Authorized officer API generates real Groth16 proof and executes EVM verifier.
 * - AC05: Zero-cost public verification view call without leaking donor PII.
 * - AC06: Attacker unendorsed root rejection on-chain (UnauthorizedBatchRoot).
 * - AC07: Statement manipulation and tampered proof rejection.
 * - AC08: Only ENDORSED contributions can enter an authorized batch.
 * - AC17: Mathematical vs Business Separation on smart contract.
 * - AC18: Idempotency of proof verification and on-chain recording.
 * - AC20: Honest status reporting without fabricated or simulated proofs.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import app from "../src/index";
import { createZkPublicationStore } from "../src/zk-publication-store";
import { runZkPublication } from "../src/zk-publication";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createContributionStore, type ContributionStore } from "../src/contribution-store";
import { createDonorAccessStore, type DonorAccessStore } from "../src/donor-access-store";
import { createZkBatchStore, contributionContext, type ZkBatchStore } from "../src/zk-batch-store";
import { createZkProofService, type ZkProofService } from "../src/zk-proof-service";
import { configureWorkspace, resetWorkspace, workspaceRuntime, type RecipientMessageTransport } from "../src/workspace-runtime";
import { type EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { CONTRIBUTION_SCHEMA_STATEMENTS } from "../src/contribution-store";
import { DONOR_ACCESS_SCHEMA_STATEMENTS } from "../src/donor-access-store";
import { DISBURSEMENT_SCHEMA_STATEMENTS } from "../src/disbursement-store";
import { ACTIVITY_SCHEMA_STATEMENTS } from "../src/activity-store";
import { ZK_BATCH_SCHEMA_STATEMENTS } from "../src/zk-batch-store";

const ANVIL_PORT = 18596;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const BASE_WORKSPACE = "http://localhost:3001/api/workspace";
const BASE_DONOR = "http://localhost:3001/api/donor";
const BASE_PUBLIC = "http://localhost:3001/api/public";

const SINAR = "lpz-sinar-amanah";
const deployer = privateKeyToAccount(`0x${"d1".repeat(32)}` as Hex);
const adminSinar = privateKeyToAccount(`0x${"a1".repeat(32)}` as Hex);
const amilSinar = privateKeyToAccount(`0x${"b1".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
let clock = NOW;
const OTP_KEY = Buffer.alloc(32, 9);

let anvilProc: any;
let database: TestWorkspaceDatabase;
let workspaceStore: WorkspaceStore;
let contributionStore: ContributionStore;
let donorAccessStore: DonorAccessStore;
let zkBatchStore: ZkBatchStore;
let zkProofService: ZkProofService;
let publications: ReturnType<typeof createZkPublicationStore>;

let publicClient: any;
let walletClient: any;
let verifierAddress: Hex;
let registryAddress: Hex;
let tracerContributionId: string;
let tracerBatch: any;
let tracerToken: string;

let outbox: Array<{ to: string; body: string }> = [];
const messageTransport: RecipientMessageTransport = {
  async send(msg) {
    outbox.push(msg);
  },
};
const ethCall: EthCall = async () => "0x";

async function signInWorkspace(
  account: { address: string; signTypedData: (payload: any) => Promise<Hex> },
  institutionId: string
): Promise<string> {
  const challengeRes = await app.fetch(
    new Request(`${BASE_WORKSPACE}/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ institutionId, account: account.address }),
    })
  );
  const { challenge, typedData } = await challengeRes.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: {
      ...typedData.message,
      nonce: challenge.nonce,
      issuedAt: BigInt(challenge.issuedAt),
      expiresAt: BigInt(challenge.expiresAt),
    },
  });
  const sessionRes = await app.fetch(
    new Request(`${BASE_WORKSPACE}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        institutionId,
        account: account.address,
        nonce: challenge.nonce,
        signature,
      }),
    })
  );
  const body = await sessionRes.json();
  return body.token;
}

describe("Satu receipt dengan proof ZK nyata hingga EVM (Issue #108)", () => {
  beforeAll(async () => {
    // 1. Start isolated Anvil process
    const anvilBin = existsSync(`${homedir()}/.config/.foundry/bin/anvil`)
      ? `${homedir()}/.config/.foundry/bin/anvil`
      : "anvil";

    anvilProc = Bun.spawn([anvilBin, "--host", "127.0.0.1", "--port", String(ANVIL_PORT), "--silent"], {
      stdout: "ignore",
      stderr: "pipe",
    });

    publicClient = createPublicClient({
      chain: foundry,
      transport: http(RPC_URL),
    });

    walletClient = createWalletClient({
      account: deployer,
      chain: foundry,
      transport: http(RPC_URL),
    });

    // Wait for anvil to be ready
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try {
        await publicClient.getChainId();
        ready = true;
        break;
      } catch {
        await Bun.sleep(100);
      }
    }
    if (!ready) throw new Error("Gagal memulai local Anvil pada port " + ANVIL_PORT);

    // Fund deployer account
    await publicClient.request({
      method: "anvil_setBalance" as any,
      params: [deployer.address, "0x56bc75e2d63100000"] as any, // 100 ETH
    });

    // 2. Deploy Groth16Verifier.sol
    const verifierArtifact = await Bun.file(
      join(__dirname, "../../sc/out/Groth16Verifier.sol/Groth16Verifier.json")
    ).json();

    const verifierDeployHash = await walletClient.deployContract({
      abi: verifierArtifact.abi,
      bytecode: verifierArtifact.bytecode.object,
    });
    const verifierReceipt = await publicClient.waitForTransactionReceipt({ hash: verifierDeployHash });
    verifierAddress = verifierReceipt.contractAddress!;
    expect(verifierAddress).toBeDefined();

    // 3. Deploy ContributionProofRegistry.sol
    const registryArtifact = await Bun.file(
      join(__dirname, "../../sc/out/ContributionProofRegistry.sol/ContributionProofRegistry.json")
    ).json();

    const registryDeployHash = await walletClient.deployContract({
      abi: registryArtifact.abi,
      bytecode: registryArtifact.bytecode.object,
      args: [verifierAddress, deployer.address],
    });
    const registryReceipt = await publicClient.waitForTransactionReceipt({ hash: registryDeployHash });
    registryAddress = registryReceipt.contractAddress!;
    expect(registryAddress).toBeDefined();
    console.log("Local deployment measurements:", JSON.stringify({
      verifierRuntimeBytes: (verifierArtifact.deployedBytecode.object.length - 2) / 2,
      registryRuntimeBytes: (registryArtifact.deployedBytecode.object.length - 2) / 2,
      verifierDeploymentGas: verifierReceipt.gasUsed.toString(), registryDeploymentGas: registryReceipt.gasUsed.toString(),
    }));

    // Enroll institution on the registry
    await walletClient.writeContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "enrollInstitution",
      args: [SINAR, deployer.address],
    });

    // 4. Setup Isolated PostgreSQL Database
    database = await createTestWorkspaceDatabase(process.env.DONOR_ACCESS_TEST_DATABASE_URL);
    const handle = database.handle();

    workspaceStore = createWorkspaceStore(handle);
    contributionStore = createContributionStore(handle);
    donorAccessStore = createDonorAccessStore(handle, OTP_KEY);
    zkBatchStore = createZkBatchStore(handle);
    zkProofService = createZkProofService();

    // Install schemas
    await workspaceStore.ensureSchema();
    for (const stmt of DISBURSEMENT_SCHEMA_STATEMENTS) await handle.execute(sql.raw(stmt));
    for (const stmt of CONTRIBUTION_SCHEMA_STATEMENTS) await handle.execute(sql.raw(stmt));
    for (const stmt of ACTIVITY_SCHEMA_STATEMENTS) await handle.execute(sql.raw(stmt));
    for (const stmt of DONOR_ACCESS_SCHEMA_STATEMENTS) await handle.execute(sql.raw(stmt));
    for (const stmt of ZK_BATCH_SCHEMA_STATEMENTS) await handle.execute(sql.raw(stmt));

    publications = createZkPublicationStore(handle);
    await publications.ensureSchema();

    // Configure runtime
    configureWorkspace({
      store: workspaceStore,
      contributions: contributionStore,
      donorAccess: donorAccessStore,
      zkBatches: zkBatchStore,
      zkPublications: publications,
      zkBudget: { id: "local-pilot", maxAttempts: 100, maxWei: "1000000000000000000", gasLimit: "700000", maxFeePerGas: "2000000000", confirmations: 1 },
      zkProver: zkProofService,
      zkRegistryAddress: registryAddress,
      zkWalletClient: walletClient,
      zkPublicClient: publicClient,
      donorMessages: messageTransport,
      ethCall,
      now: () => clock,
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });

    // Seed institution and officers
    for (const inst of SYNTHETIC_INSTITUTIONS) {
      await workspaceStore.upsertInstitution(institutionRecordOf(inst));
    }
    // Seed officer profiles and memberships
    await handle.execute(sql`
      INSERT INTO officer_profiles (id, institution_id, display_name, is_active)
      VALUES ('off-sinar-admin', ${SINAR}, 'Admin Sinar', true),
             ('off-sinar-amil', ${SINAR}, 'Amil Sinar', true);
    `);
    await handle.execute(sql`
      INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active)
      VALUES (${SINAR}, ${adminSinar.address.toLowerCase()}, 'ADMIN', 'off-sinar-admin', true),
             (${SINAR}, ${amilSinar.address.toLowerCase()}, 'OFFICER', 'off-sinar-amil', true);
    `);

    // Grant mandates
    await handle.execute(sql`
      INSERT INTO operational_mandates (
        id, institution_id, officer_id, account_address, function, scope_type,
        program_id, valid_from, valid_until, assignment_ref, nominal_limit, version, is_active, created_at, updated_at, created_by
      ) VALUES (
        'mandate-sinar-record', ${SINAR}, 'off-sinar-amil', ${amilSinar.address.toLowerCase()},
        'RECORD_CONTRIBUTIONS', 'ALL_PROGRAMS', null, ${NOW - 1000}, ${NOW + 100000}, 'SK-AMIL-01', null, 1, true, ${NOW}, ${NOW}, ${adminSinar.address.toLowerCase()}
      ), (
        'mandate-sinar-endorse', ${SINAR}, 'off-sinar-amil', ${amilSinar.address.toLowerCase()},
        'ENDORSE_CONTRIBUTIONS', 'ALL_PROGRAMS', null, ${NOW - 1000}, ${NOW + 100000}, 'SK-DIR-01', null, 1, true, ${NOW}, ${NOW}, ${adminSinar.address.toLowerCase()}
      );
    `);
  }, 60000);

  afterAll(async () => {
    resetWorkspace();
    if (database) await database.close();
    if (anvilProc && anvilProc.exitCode === null) {
      anvilProc.kill();
      await anvilProc.exited;
    }
  });

  it("completes full tracer: contribution recording, Poseidon batching, real Groth16 proof, EVM verification, donor view, and zero-cost check", async () => {
    const amilToken = await signInWorkspace(amilSinar, SINAR);
    tracerToken = amilToken;

    // Step 1: Record a genuine contribution (#102)
    const recordRes = await app.fetch(
      new Request(`${BASE_WORKSPACE}/contributions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${amilToken}`,
        },
        body: JSON.stringify({
          institutionId: SINAR,
          operationId: "op-record-001",
          sourceChannel: "BANK_TRANSFER",
          sourceReference: "BCA-TRACER-108-001",
          currencyUnit: "IDR",
          amountExact: "5000000",
          fundType: "FITRAH",
          purpose: "Zakat Fitrah 1447H",
          receivedAt: NOW - 3600,
          donorName: "Hamba Allah",
          donorContact: "donatur-108@example.org",
        }),
      })
    );
    if (recordRes.status !== 201) {
      console.error("POST /contributions failed:", await recordRes.json());
    }
    expect(recordRes.status).toBe(201);
    const { contribution } = await recordRes.json();
    const contributionId = contribution.id;
    tracerContributionId = contributionId;
    expect(contributionId).toBeDefined();
    expect(contribution.status).toBe("RECEIVED");
    const noProof = await (await app.fetch(new Request(`${BASE_PUBLIC}/receipt-verification/${contributionId}`))).json();
    expect(noProof.verification.status).toBe("NOT_AVAILABLE");

    // Step 2: AC08 - Attempting to batch a non-endorsed contribution must fail
    const prematureBatchRes = await app.fetch(
      new Request(`${BASE_WORKSPACE}/contribution-batches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${amilToken}`,
        },
        body: JSON.stringify({
          institutionId: SINAR,
          contributionIds: [contributionId],
          fundType: "FITRAH",
          currencyUnit: "IDR",
        }),
      })
    );
    expect(prematureBatchRes.status).toBe(400);
    const prematureJson = await prematureBatchRes.json();
    expect(prematureJson.error).toContain("ENDORSED");

    // Step 3: Reconcile and Endorse contribution (#102)
    const reconcileRes = await app.fetch(
      new Request(`${BASE_WORKSPACE}/contributions/${contributionId}/reconcile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${amilToken}`,
        },
        body: JSON.stringify({
          institutionId: SINAR,
          expectedVersion: 1,
          operationId: "reconcile-001",
          proofRef: "MUTASI-BCA-TRACER-001",
          notes: "Rekonsiliasi mutasi rekening bank BCA verified",
        }),
      })
    );
    if (reconcileRes.status !== 200) {
      console.error("POST /reconcile failed:", await reconcileRes.json());
    }
    expect(reconcileRes.status).toBe(200);

    const endorseRes = await app.fetch(
      new Request(`${BASE_WORKSPACE}/contributions/${contributionId}/endorse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${amilToken}`,
        },
        body: JSON.stringify({
          institutionId: SINAR,
          expectedVersion: 2,
          operationId: "endorse-001",
        }),
      })
    );
    expect(endorseRes.status).toBe(200);

    // Step 4: Create ZK Contribution Batch (AC02, AC03)
    const createBatchRes = await app.fetch(
      new Request(`${BASE_WORKSPACE}/contribution-batches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${amilToken}`,
        },
        body: JSON.stringify({
          institutionId: SINAR,
          contributionIds: [contributionId],
          fundType: "FITRAH",
          currencyUnit: "IDR",
        }),
      })
    );
    const createBatchJson = await createBatchRes.json();
    if (createBatchRes.status !== 201) {
      console.error("POST /contribution-batches failed:", createBatchJson);
    }
    expect(createBatchRes.status).toBe(201);
    const { batch } = createBatchJson;
    tracerBatch = batch;
    expect(batch.id).toBeDefined();
    expect(batch.status).toBe("DRAFT");
    expect(batch.merkleRoot).toBeDefined();
    expect(batch.merkleRoot.startsWith("0x")).toBe(true);
    expect(batch.items.length).toBe(1);
    expect(batch.items[0].receiptCommitment).toBeDefined();

    // Step 5: Endorse Batch and Register Root onchain (AC08)
    const endorseBatchRes = await app.fetch(
      new Request(`${BASE_WORKSPACE}/contribution-batches/${batch.id}/endorse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${amilToken}`,
        },
        body: JSON.stringify({
          institutionId: SINAR, snapshotRoot: batch.merkleRoot,
        }),
      })
    );
    expect(endorseBatchRes.status).toBe(200);
    const { batch: endorsedBatch } = await endorseBatchRes.json();
    expect(endorsedBatch.status).toBe("ENDORSED");
    expect(endorsedBatch.txHash).toBeDefined();

    // Verify on EVM contract that root was indeed endorsed
    const instKey = keccak256(Buffer.from(SINAR));
    const onChainBatch = await publicClient.readContract({
      address: registryAddress,
      abi: (await Bun.file(join(__dirname, "../../sc/out/ContributionProofRegistry.sol/ContributionProofRegistry.json")).json()).abi,
      functionName: "batches",
      args: [instKey, BigInt(batch.batchNumber)],
    });
    expect(onChainBatch[0]).toBe(batch.merkleRoot); // root
    expect(onChainBatch[4]).toBe(true); // exists

    // Real failures through the same authorized API, before any receipt succeeds.
    const runtime = workspaceRuntime()!;
    const processRequest = () => new Request(`${BASE_WORKSPACE}/contribution-batches/${batch.id}/proofs/${contributionId}/process`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${amilToken}` }, body: JSON.stringify({ institutionId: SINAR }),
    });
    try {
      configureWorkspace({ ...runtime, zkPublicClient: undefined });
      expect((await app.fetch(processRequest())).status).toBe(503);
      expect(await zkBatchStore.getReceiptProof(contributionId)).toBeNull();
      configureWorkspace({ ...runtime, zkProver: createZkProofService({ wasmPath: "/missing-private-artifact" }) });
      const failed = await app.fetch(processRequest());
      expect(failed.status).toBe(202);
      const failureText = await failed.text();
      expect(failureText).not.toContain("missing-private-artifact");
      expect(JSON.parse(failureText).proofRecord.status).toBe("RETRY");
      configureWorkspace(runtime);
      const originalCode = await publicClient.getBytecode({ address: verifierAddress });
      await publicClient.request({ method: "anvil_setCode", params: [verifierAddress, "0x60006000f3"] });
      try {
        await expect(zkProofService.assertDeployment(publicClient, registryAddress)).rejects.toThrow("Kode verifier");
        expect((await app.fetch(processRequest())).status).toBe(202);
      } finally { await publicClient.request({ method: "anvil_setCode", params: [verifierAddress, originalCode] }); }
    } finally { configureWorkspace(runtime); }

    await runZkPublication(runtime, `root:${batch.id}`); // refresh root after verifier outage

    // Step 6: Generate Real Groth16 Proof and Verify on EVM (AC01, AC04, AC18)
    const publicationBefore = (await publications.list(SINAR, batch.id)).find(p => p.contributionId === contributionId)!;
    const nonceBefore = await publicClient.getTransactionCount({ address: deployer.address });
    const responses = await Promise.all([app.fetch(processRequest()), app.fetch(processRequest())]);
    const results = await Promise.all(responses.map(async response => ({ status: response.status, body: await response.json() })));
    // Either request can acquire the publication lease. A response observes the
    // final state, so both may report 201 without creating a second publication.
    expect(results.some(result => result.status === 201)).toBe(true);
    for (const result of results) expect([200, 201, 202]).toContain(result.status);
    const { proofRecord } = results.find(result => result.status === 201)!.body;
    for (const result of results) {
      if (result.status === 202) {
        expect(result.body.operation.id).toBe(publicationBefore.id);
        expect(["QUEUED", "PROVING", "SUBMITTING", "PENDING"]).toContain(result.body.proofRecord.status);
      } else {
        expect(result.body.proofRecord).toEqual(proofRecord);
      }
    }
    expect(proofRecord.status).toBe("VERIFIED");
    expect(proofRecord.txHash).toBeDefined();
    expect(proofRecord.blockNumber).toBeGreaterThan(0);
    expect(proofRecord.verifiedAt).toBeGreaterThan(0);
    console.log("Receipt verification gas:", (await publicClient.getTransactionReceipt({ hash: proofRecord.txHash })).gasUsed.toString());

    // Step 7: AC18 - Idempotency: repeating process returns existing verified proof without revert
    const repeatProcessRes = await app.fetch(
      new Request(`${BASE_WORKSPACE}/contribution-batches/${batch.id}/proofs/${contributionId}/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${amilToken}`,
        },
        body: JSON.stringify({
          institutionId: SINAR,
        }),
      })
    );
    expect(repeatProcessRes.status).toBe(200);
    const repeatJson = await repeatProcessRes.json();
    expect(repeatJson.proofRecord.status).toBe("VERIFIED");
    expect(repeatJson.proofRecord.txHash).toBe(proofRecord.txHash);
    const receiptPublications = (await publications.list(SINAR, batch.id)).filter(p => p.contributionId === contributionId);
    expect(receiptPublications).toHaveLength(1);
    expect(receiptPublications[0]!.id).toBe(publicationBefore.id);
    expect(receiptPublications[0]!.status).toBe("CONFIRMED");
    expect(receiptPublications[0]!.txHash).toBe(proofRecord.txHash);
    expect(receiptPublications[0]!.attempts).toBe(publicationBefore.attempts + 1);
    // The concurrent calls plus the idempotent repeat spend exactly one nonce.
    expect(await publicClient.getTransactionCount({ address: deployer.address })).toBe(nonceBefore + 1);

    // Step 8: Donor Access View (Ticket #104 & Issue #108)
    // Donors view their contribution via OTP without seeing private witness or Merkle siblings
    const challengeRes = await app.fetch(
      new Request(`${BASE_DONOR}/otp-challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: "BCA-TRACER-108-001" }),
      })
    );
    expect(challengeRes.status).toBe(201);
    const { challengeId } = await challengeRes.json();

    // Extract OTP code from captured notification outbox
    const otpCode = outbox[outbox.length - 1]?.body.match(/\b(\d{6})\b/)?.[1];
    expect(otpCode).toBeDefined();

    const sessionRes = await app.fetch(
      new Request(`${BASE_DONOR}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId, otpCode: otpCode! }),
      })
    );
    expect(sessionRes.status).toBe(201);
    const sessionJson = await sessionRes.json();
    const verifiedSessionToken = sessionJson.sessionToken;
    expect(verifiedSessionToken).toBeDefined();

    // Read donor contribution detail
    const donorViewRes = await app.fetch(
      new Request(`${BASE_DONOR}/contributions/${contributionId}`, {
        headers: { Authorization: `Bearer ${verifiedSessionToken}` },
      })
    );
    expect(donorViewRes.status).toBe(200);
    const { contribution: donorContrib } = await donorViewRes.json();
    expect(donorContrib.zkProof.status).toBe("VERIFIED");
    expect(donorContrib.zkProof.batchRoot).toBe(batch.merkleRoot);
    expect(donorContrib.zkProof.receiptCommitment).toBe(batch.items[0].receiptCommitment);
    expect(donorContrib.zkProof.txHash).toBe(proofRecord.txHash);
    // Crucially: witness secrets are not present in zkProof detail
    expect((donorContrib.zkProof as any).amount).toBeUndefined();
    expect((donorContrib.zkProof as any).salt).toBeUndefined();
    expect((donorContrib.zkProof as any).pathElements).toBeUndefined();

    // Step 9: Zero-Cost Public Verification View Call (AC05, AC18)
    const publicVerificationRes = await app.fetch(
      new Request(`${BASE_PUBLIC}/receipt-verification/${contributionId}`)
    );
    expect(publicVerificationRes.status).toBe(200);
    const { verification } = await publicVerificationRes.json();
    expect(verification.status).toBe("VERIFIED");
    expect(verification.onChainConfirmed).toBe(true);
    expect(verification.batchRoot).toBe(batch.merkleRoot);
    expect(verification.receiptCommitment).toBe(batch.items[0].receiptCommitment);
    expect(verification.txHash).toBe(proofRecord.txHash);
    // Must NOT leak donor name, amount, or contact to public verifier (AC15)
    expect((verification as any).donorName).toBeUndefined();
    expect((verification as any).amount).toBeUndefined();
    expect((verification as any).donorContact).toBeUndefined();
    expect((verification as any).salt).toBeUndefined();
  }, 120000);

  it("rejects proof verification against unendorsed attacker root (AC06, AC07)", async () => {
    // Generate valid witness for a contribution
    const witness = await zkBatchStore.getBatchItemWitness(
      SINAR,
      "zk-batch-lpz-sinar-amanah-1",
      "zk-batch-lpz-sinar-amanah-1-item-0" // fallback or any item
    );

    // Attacker constructs a fake batch root
    const attackerBatchRoot = "0x" + "bb".repeat(32);

    const registryArtifact = await Bun.file(
      join(__dirname, "../../sc/out/ContributionProofRegistry.sol/ContributionProofRegistry.json")
    ).json();

    const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    const instKeyField = BigInt(keccak256(Buffer.from(SINAR))) % SNARK_FIELD;
    const contribHashField = contributionContext("contrib-attacker", 1, 1, 1);

    // Test 1: Trying to verify against batch 999 (non-existent) must revert with BatchNotFound (AC06)
    let revertedNotFound = false;
    try {
      await walletClient.writeContract({
        address: registryAddress,
        abi: registryArtifact.abi,
        functionName: "verifyAndRecordReceiptProof",
        args: [
          SINAR,
          999n, // non-existent batch ID
          1n,
          "contrib-attacker",
          1n, // fundType
          [0n, 0n],
          [[0n, 0n], [0n, 0n]],
          [0n, 0n],
          [BigInt(attackerBatchRoot) % SNARK_FIELD, 0n, instKeyField, contribHashField, 1n],
        ],
      });
    } catch (err: any) {
      revertedNotFound = true;
      expect(err.message || String(err)).toContain("BatchNotFound");
    }
    expect(revertedNotFound).toBe(true);

    // Test 2: Tampered batch root against existing endorsed batch 1 must revert with UnauthorizedBatchRoot (AC06)
    let revertedUnauthorizedRoot = false;
    try {
      await walletClient.writeContract({
        address: registryAddress,
        abi: registryArtifact.abi,
        functionName: "verifyAndRecordReceiptProof",
        args: [
          SINAR,
          1n, // existing endorsed batch
          1n,
          "contrib-attacker",
          1n,
          [0n, 0n],
          [[0n, 0n], [0n, 0n]],
          [0n, 0n],
          [BigInt(attackerBatchRoot) % SNARK_FIELD, 0n, instKeyField, contribHashField, 1n], // attacker root != real batch root
        ],
      });
    } catch (err: any) {
      revertedUnauthorizedRoot = true;
      expect(err.message || String(err)).toContain("UnauthorizedBatchRoot");
    }
    expect(revertedUnauthorizedRoot).toBe(true);

    // Test 3: Manipulated public statement binding (wrong institution) reverts with InvalidStatementBinding (AC07)
    let revertedStatement = false;
    try {
      await walletClient.writeContract({
        address: registryAddress,
        abi: registryArtifact.abi,
        functionName: "verifyAndRecordReceiptProof",
        args: [
          SINAR,
          1n,
          1n,
          "contrib-attacker",
          1n,
          [0n, 0n],
          [[0n, 0n], [0n, 0n]],
          [0n, 0n],
          [BigInt(attackerBatchRoot) % SNARK_FIELD, 0n, 12345n, contribHashField, 1n], // wrong instKey
        ],
      });
    } catch (err: any) {
      revertedStatement = true;
      expect(err.message || String(err)).toContain("InvalidStatementBinding");
    }
    expect(revertedStatement).toBe(true);
  });
  it("persists the publication queue and prevents duplicate workers from claiming it", async () => {
    const first = await publications.acquire("local-pilot", clock);
    expect(first).not.toBeNull();
    expect(await publications.acquire("local-pilot", clock)).toBeNull();
    await publications.release("local-pilot", first!);
    expect(await publications.acquire("local-pilot", clock)).not.toBeNull();
    // A crashed worker's lease expires; its stale token cannot release its successor.
    const successor = await publications.acquire("local-pilot", clock + 301);
    expect(successor).not.toBeNull();
    await publications.release("local-pilot", first!);
    expect(await publications.acquire("local-pilot", clock + 301)).toBeNull();
    await publications.release("local-pilot", successor!);
  });

  it("rejects version, receipt, purpose and amount manipulation with a real proof", async () => {
    const witness = (await zkBatchStore.getBatchItemWitness(SINAR, tracerBatch.id, tracerContributionId))!;
    const proof = await zkProofService.generateProof(witness);
    const artifact = await Bun.file(join(__dirname, "../../sc/out/ContributionProofRegistry.sol/ContributionProofRegistry.json")).json();
    const proofArgs = [proof.calldata.a.map(BigInt), proof.calldata.b.map(r => r.map(BigInt)), proof.calldata.c.map(BigInt), proof.publicSignals.map(BigInt)];
    for (const [id, version] of [[tracerContributionId, witness.version + 1], ["another-receipt", witness.version]] as const) {
      await expect(publicClient.simulateContract({ address: registryAddress, abi: artifact.abi, functionName: "verifyAndRecordReceiptProof",
        account: deployer.address, args: [SINAR, BigInt(tracerBatch.batchNumber), BigInt(version), id, BigInt(witness.fundType), ...proofArgs],
      })).rejects.toThrow("InvalidStatementBinding");
    }
    await expect(zkProofService.generateProof({ ...witness, amount: "1" })).rejects.toThrow("Gagal menghasilkan proof");
    await expect(zkProofService.generateProof({ ...witness, purposeHash: "1" })).rejects.toThrow("Gagal menghasilkan proof");
    const verifierArtifact = await Bun.file(join(__dirname, "../../sc/out/Groth16Verifier.sol/Groth16Verifier.json")).json();
    const nonce = await publicClient.getTransactionCount({ address: deployer.address });
    const recovered = await zkProofService.verifyAndRecordOnChain({ institutionId: SINAR, batchIdNumber: tracerBatch.batchNumber,
      version: witness.version, contributionId: tracerContributionId, fundType: witness.fundType, proof,
      registryAddress, walletClient, publicClient,
    });
    const stored = await zkBatchStore.getReceiptProof(tracerContributionId, witness.version);
    expect(recovered.txHash).toBe(stored!.txHash as Hex);
    expect(recovered.blockNumber).toBe(stored!.blockNumber!);
    expect(await publicClient.getTransactionCount({ address: deployer.address })).toBe(nonce);
    const alteredSignals = proof.publicSignals.map(BigInt);
    alteredSignals[1] += 1n;
    expect(await publicClient.readContract({ address: verifierAddress, abi: verifierArtifact.abi, functionName: "verifyProof",
      args: [...proofArgs.slice(0, 3), alteredSignals],
    })).toBe(false);
  }, 30000);

  it("public rechecks are read-only, unambiguous and honest when RPC cannot confirm", async () => {
    const nonce = await publicClient.getTransactionCount({ address: deployer.address });
    const runtime = workspaceRuntime()!;
    const request = () => new Request(`${BASE_PUBLIC}/receipt-verification/${tracerContributionId}`);
    // The failed attempt in another batch is not allowed to overwrite official verification.
    configureWorkspace({ ...runtime, zkPublicClient: undefined });
    try {
      const result = await (await app.fetch(request())).json();
      expect(result.verification.onChainConfirmed).toBe(false);
      expect(result.verification.checkStatus).toBe("UNAVAILABLE");
      expect(result.verification.status).toBe("UNCONFIRMED");
    } finally { configureWorkspace(runtime); }
    const stored = (await zkBatchStore.getReceiptProof(tracerContributionId, 3))!;
    const head = await publicClient.getBlockNumber({ cacheTime: 0 });
    configureWorkspace({ ...runtime, zkBudget: { ...runtime.zkBudget!, confirmations: Number(head) - stored.blockNumber! + 2 } });
    try {
      const inspect = async () => (await (await app.fetch(new Request(`${BASE_WORKSPACE}/contribution-batches/${tracerBatch.id}`, {
        headers: { Authorization: `Bearer ${tracerToken}` },
      }))).json()).operations.find((op: any) => op.contributionId === tracerContributionId);
      expect((await (await app.fetch(request())).json()).verification.onChainConfirmed).toBe(false);
      expect((await inspect()).status).toBe("UNCONFIRMED");
      await publicClient.request({ method: "evm_mine" });
      expect((await (await app.fetch(request())).json()).verification.onChainConfirmed).toBe(true);
      expect((await inspect()).status).toBe("CONFIRMED");
    } finally { configureWorkspace(runtime); }
    expect((await app.fetch(new Request(`${BASE_PUBLIC}/receipt-verification/BCA-TRACER-108-001`))).status).toBe(404);
    const wrongBatch = await app.fetch(new Request(`${BASE_WORKSPACE}/contribution-batches/not-your-batch/proofs/${tracerContributionId}?institutionId=${SINAR}`, {
      headers: { Authorization: `Bearer ${tracerToken}` },
    }));
    expect(wrongBatch.status).toBe(404);
    await app.fetch(request()); await app.fetch(request());
    expect(await publicClient.getTransactionCount({ address: deployer.address })).toBe(nonce);
  });

  it("automates several receipts with a budget gate, durable pending transaction, restart, duplicate workers and reorg", async () => {
    const post = (path: string, body: any) => app.fetch(new Request(`${BASE_WORKSPACE}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tracerToken}` },
      body: JSON.stringify({ institutionId: SINAR, ...body }),
    }));
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await post("/contributions", { operationId: `multi-${i}`, sourceChannel: "BANK_TRANSFER", sourceReference: `MULTI-${i}`,
        currencyUnit: "IDR", amountExact: "125000", fundType: "FITRAH", purpose: "Bantuan", receivedAt: NOW - 100,
        donorName: "Private donor", donorContact: "private@example.org" });
      expect(res.status).toBe(201);
      const id = (await res.json()).contribution.id;
      ids.push(id);
      expect((await post(`/contributions/${id}/reconcile`, { expectedVersion: 1, operationId: `match-${i}`, proofRef: `MUTASI-${i}` })).status).toBe(200);
      expect((await post(`/contributions/${id}/endorse`, { expectedVersion: 2, operationId: `approve-${i}` })).status).toBe(200);
    }
    const made = await post("/contribution-batches", { contributionIds: ids, currencyUnit: "IDR", fundType: "FITRAH", cutoff: NOW });
    expect(made.status).toBe(201);
    const batch = (await made.json()).batch;
    expect(batch.cutoff).toBe(NOW);
    expect((await post(`/contribution-batches/${batch.id}/endorse`, { snapshotRoot: "0x00" })).status).toBe(409);
    let runtime = workspaceRuntime()!;
    configureWorkspace({ ...runtime, zkBudget: { ...runtime.zkBudget!, maxAttempts: 0 } });
    const gated = await (await post(`/contribution-batches/${batch.id}/endorse`, { snapshotRoot: batch.merkleRoot })).json();
    expect(gated.operations.find((p: any) => !p.contributionId).status).toBe("BUDGET_EXHAUSTED");
    const count = await database.rowCount("contributions");
    configureWorkspace(runtime);
    await post(`/contribution-batches/${batch.id}/retry`, {});
    await runZkPublication(runtime); // root
    // Reorg must also recover the nonce consumed by the failed attempt.
    const chainSnapshot = await publicClient.request({ method: "evm_snapshot" });
    // A mined out-of-gas transaction is durable history, and retry reserves a new attempt.
    const revertId = `receipt:${ids[2]}:3`;
    await runZkPublication({ ...runtime, zkBudget: { ...runtime.zkBudget!, gasLimit: "100000" } }, revertId);
    const reverted = (await publications.list(SINAR, batch.id)).find(p => p.id === revertId)!;
    expect(reverted.status).toBe("REVERTED");
    await post(`/contribution-batches/${batch.id}/retry`, {});
    // A failed budget reservation must not erase the previous signed attempt.
    await runZkPublication({ ...runtime, zkBudget: { ...runtime.zkBudget!, maxAttempts: 0 } }, revertId);
    expect((await publications.list(SINAR, batch.id)).find(p => p.id === revertId)!.status).toBe("BUDGET_EXHAUSTED");
    await post(`/contribution-batches/${batch.id}/retry`, {});
    await publicClient.request({ method: "evm_setAutomine", params: [false] });
    try {
      await runZkPublication({ ...runtime, zkPublicClient: { ...publicClient,
        async sendRawTransaction(args: any) { await publicClient.sendRawTransaction(args); throw new Error("Connection lost after broadcast"); },
      } });
      const pending = (await publications.list(SINAR, batch.id)).find(p => p.status === "PENDING")!;
      expect(pending.rawTransaction).toBeTruthy();
      expect(pending.txHash).toBe(keccak256(pending.rawTransaction!));
      expect(pending.artifactId).toContain(registryAddress.toLowerCase());
      const db = await database.reopen();
      workspaceStore = createWorkspaceStore(db); contributionStore = createContributionStore(db);
      donorAccessStore = createDonorAccessStore(db, OTP_KEY); zkBatchStore = createZkBatchStore(db);
      publications = createZkPublicationStore(db);
      runtime = { ...runtime, store: workspaceStore, contributions: contributionStore, donorAccess: donorAccessStore,
        zkBatches: zkBatchStore, zkPublications: publications };
      configureWorkspace(runtime);
      expect((await publications.list(SINAR, batch.id)).find(p => p.id === pending.id)!.rawTransaction).toBe(pending.rawTransaction);
      await publicClient.request({ method: "evm_mine" });
      await database.handle().execute(sql`UPDATE operational_mandates SET is_active = false WHERE id = 'mandate-sinar-endorse'`);
      await Promise.all([runZkPublication(runtime), runZkPublication(runtime)]);
      expect((await publications.list(SINAR, batch.id)).find(p => p.id === pending.id)!.status).toBe("CONFIRMED");
      await database.handle().execute(sql`UPDATE operational_mandates SET is_active = true, version = version + 1 WHERE id = 'mandate-sinar-endorse'`);
      await runZkPublication(runtime);
      expect((await publications.list(SINAR, batch.id)).some(p => p.status === "BLOCKED")).toBe(true);
      expect((await post(`/contribution-batches/${batch.id}/endorse`, { snapshotRoot: batch.merkleRoot })).status).toBe(200);
    } finally { await publicClient.request({ method: "evm_setAutomine", params: [true] }); }
    const notifications: any[] = [];
    runtime = { ...runtime, zkNotifications: { async send(event) { notifications.push(event); } } };
    configureWorkspace(runtime);
    for (let i = 0; i < 3; i++) await runZkPublication(runtime);
    expect((await publications.list(SINAR, batch.id)).every(p => p.status === "CONFIRMED")).toBe(true);
    expect(notifications.length).toBeGreaterThan(0);
    expect(Object.keys(notifications[0]).sort()).toEqual(["operationId", "status"]);
    const nonce = await publicClient.getTransactionCount({ address: deployer.address });
    for (const id of ids) {
      const view = await (await app.fetch(new Request(`${BASE_PUBLIC}/receipt-verification/${id}`))).json();
      expect(view.verification.onChainConfirmed).toBe(true);
      expect(JSON.stringify(view)).not.toMatch(/Private donor|private@example|125000|pathElements|salt/);
      await post(`/contribution-batches/${batch.id}/proofs/${id}/process`, {});
    }
    expect(await publicClient.getTransactionCount({ address: deployer.address })).toBe(nonce);
    expect(await database.rowCount("contributions")).toBe(count);
    await publicClient.request({ method: "evm_revert", params: [chainSnapshot] });
    const check = await (await app.fetch(new Request(`${BASE_WORKSPACE}/contribution-batches/${batch.id}?institutionId=${SINAR}`, {
      headers: { Authorization: `Bearer ${tracerToken}` },
    }))).json();
    expect(check.operations.filter((p: any) => p.contributionId).every((p: any) => p.status === "UNCONFIRMED")).toBe(true);
    expect((await (await app.fetch(new Request(`${BASE_PUBLIC}/receipt-verification/${ids[0]}`))).json()).verification.onChainConfirmed).toBe(false);
    await post(`/contribution-batches/${batch.id}/retry`, {});
    const beforeRecovery = (await publications.list(SINAR, batch.id)).find(p => p.id === revertId)!;
    const nonceBeforeRecovery = await publicClient.getTransactionCount({ address: deployer.address });
    // Replays spend the existing reservation, and still require current authority.
    const recoveryRuntime = { ...runtime, zkBudget: { ...runtime.zkBudget!, maxAttempts: 0, maxWei: "0" } };
    await database.handle().execute(sql`UPDATE operational_mandates SET is_active = false WHERE id = 'mandate-sinar-endorse'`);
    await runZkPublication(recoveryRuntime);
    expect(await publicClient.getTransactionCount({ address: deployer.address })).toBe(nonceBeforeRecovery);
    await database.handle().execute(sql`UPDATE operational_mandates SET is_active = true WHERE id = 'mandate-sinar-endorse'`);
    await Promise.all([runZkPublication(recoveryRuntime), runZkPublication(recoveryRuntime)]);
    expect(await publicClient.getTransactionCount({ address: deployer.address })).toBe(nonceBeforeRecovery + 1);
    expect((await publicClient.getTransactionReceipt({ hash: reverted.txHash })).status).toBe("reverted");
    const afterRecovery = (await publications.list(SINAR, batch.id)).find(p => p.id === revertId)!;
    expect(afterRecovery.txHash).toBe(beforeRecovery.txHash);
    expect(afterRecovery.attempts).toBe(beforeRecovery.attempts);
    for (let i = 0; i < 5; i++) await runZkPublication(recoveryRuntime);
    expect((await publications.list(SINAR, batch.id)).every(p => p.status === "CONFIRMED")).toBe(true);
    expect(await database.rowCount("contributions")).toBe(count);
    for (const id of ids) expect((await (await app.fetch(new Request(`${BASE_PUBLIC}/receipt-verification/${id}`))).json()).verification.onChainConfirmed).toBe(true);
  }, 60000);

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: reviews exact batch, processes automatically, shows pending and retries on desktop/mobile", async () => {
    const built = await Bun.build({ entrypoints: [new URL("../../frontend/test/contribution-batch-smoke.tsx", import.meta.url).pathname], target: "browser" });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const bundle = await built.outputs[0]!.text();
    const cssProcess = Bun.spawn(["bun", "test/build-smoke-css.ts"], { cwd: join(__dirname, "../../frontend"), stdout: "pipe", stderr: "pipe" });
    const css = await new Response(cssProcess.stdout).text();
    expect(await cssProcess.exited).toBe(0);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
      if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
      if (path === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
      return app.fetch(req);
    } });
    const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
    const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
    let runtime = workspaceRuntime()!;
    try {
      for (const width of [1280, 390]) {
        const call = (path: string, body: any) => app.fetch(new Request(`${BASE_WORKSPACE}${path}`, { method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tracerToken}` }, body: JSON.stringify({ institutionId: SINAR, ...body }) }));
        const recorded = await call("/contributions", { operationId: `browser-${width}`, sourceChannel: "CASH", sourceReference: `BROWSER-${width}`,
          currencyUnit: "IDR", amountExact: "200000", fundType: "FITRAH", purpose: "Bantuan", receivedAt: NOW - 100 });
        const id = (await recorded.json()).contribution.id;
        await call(`/contributions/${id}/reconcile`, { expectedVersion: 1, operationId: `browser-match-${width}`, proofRef: `CASH-${width}` });
        await call(`/contributions/${id}/endorse`, { expectedVersion: 2, operationId: `browser-endorse-${width}` });
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(10000);
        const errors: string[] = []; page.on("pageerror", (e: Error) => errors.push(e.message));
        await page.addInitScript((token: string) => sessionStorage.setItem("workspace-test-token", token), tracerToken);
        await page.goto(server.url.toString());
        // Use the fixture's source cutoff rather than the wall clock of the browser.
        await page.getByLabel("Batas waktu penerimaan (UTC)").fill(new Date(NOW * 1000).toISOString().slice(0, 16));
        await page.getByLabel(new RegExp(`BROWSER-${width}`)).check();
        await page.getByRole("button", { name: "Tinjau daftar penerimaan" }).click();
        const review = page.getByRole("region", { name: "Tinjau daftar penerimaan" });
        await review.getByText("1 kontribusi", { exact: false }).waitFor();
        await page.getByLabel("Saya sudah memeriksa daftar kontribusi dan batas waktu penerimaan ini.").check();
        configureWorkspace({ ...runtime, zkBudget: { ...runtime.zkBudget!, maxAttempts: 0 } });
        await page.getByRole("button", { name: "Sahkan daftar dan proses otomatis" }).click();
        await review.getByText("Anggaran layanan habis", { exact: true }).waitFor();
        configureWorkspace(runtime);
        await page.getByRole("button", { name: "Coba proses lagi" }).click();
        await review.getByText("Menunggu proses", { exact: true }).first().waitFor();
        await runZkPublication(runtime); // root
        await publicClient.request({ method: "evm_setAutomine", params: [false] });
        try {
          await runZkPublication(runtime);
          await review.getByText("Menunggu konfirmasi", { exact: true }).waitFor();
          await publicClient.request({ method: "evm_mine" });
          await runZkPublication(runtime);
          await review.getByText("Terkonfirmasi", { exact: true }).nth(1).waitFor();
        } finally { await publicClient.request({ method: "evm_setAutomine", params: [true] }); }
        expect(errors).toHaveLength(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: `/tmp/issue109-batch-${width}.png`, fullPage: true });
        await page.close();
      }
    } finally { configureWorkspace(runtime); await browser.close(); server.stop(true); }
  }, 60000);

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: donor opens real verified receipt and rechecks without transactions on desktop and mobile", async () => {
    const built = await Bun.build({ entrypoints: [new URL("../../frontend/test/verification-smoke.tsx", import.meta.url).pathname], target: "browser",
      define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const bundle = await built.outputs[0]!.text();
    const cssProcess = Bun.spawn(["bun", "test/build-smoke-css.ts"], { cwd: join(__dirname, "../../frontend"), stdout: "pipe", stderr: "pipe" });
    const css = await new Response(cssProcess.stdout).text();
    expect(await cssProcess.exited).toBe(0);
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
      if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
      if (path === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
      return app.fetch(req);
    } });
    const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
    const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
    const nonce = await publicClient.getTransactionCount({ address: deployer.address });
    try {
      for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
        clock += 61;
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(10000);
        const errors: string[] = [];
        page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.goto(`${server.url}?trxId=${tracerContributionId}`);
        await page.getByRole("button", { name: "Periksa keaslian catatan", exact: true }).click();
        await page.getByText("Keaslian catatan terkonfirmasi di catatan publik", { exact: true }).waitFor();
        expect(await page.getByText("Hamba Allah", { exact: true }).count()).toBe(0);
        await page.getByRole("button", { name: "Kirim Kode OTP" }).click();
        await page.getByLabel(/Masukkan 6 digit kode/).waitFor();
        const code = outbox.at(-1)!.body.match(/\b(\d{6})\b/)![1];
        await page.getByLabel(/Masukkan 6 digit kode/).fill(code);
        // A stored VERIFIED receipt must not appear confirmed when the initial check fails.
        const proofUrl = "**/api/public/receipt-verification/**";
        await page.route(proofUrl, (route: any) => route.abort());
        await page.getByRole("button", { name: "Verifikasi", exact: true }).click();
        await page.getByRole("heading", { name: "Kontribusi Anda" }).waitFor();
        const panel = page.getByRole("region", { name: "Bukti kontribusi Anda", exact: true });
        const confirmed = panel.getByText("Keaslian catatan terkonfirmasi", { exact: true });
        const unconfirmed = panel.getByText("Keaslian belum dapat dikonfirmasi saat ini", { exact: true });
        await panel.getByRole("alert").waitFor();
        await unconfirmed.waitFor();
        expect(await confirmed.count()).toBe(0);
        expect(await panel.locator("details").getAttribute("open")).toBeNull();
        await panel.locator("summary").click();
        expect(await panel.getByText("Transaksi hasil verifikasi", { exact: true }).count()).toBe(1);
        expect(await panel.locator("code").allTextContents()).toContain(
          (await zkBatchStore.getReceiptProof(tracerContributionId))!.txHash,
        );
        await panel.locator("summary").click();
        await page.unroute(proofUrl);
        const response = page.waitForResponse((r: any) => r.url().includes("/receipt-verification/"));
        await page.getByRole("button", { name: "Periksa ulang bukti", exact: true }).click();
        expect((await (await response).json()).verification.onChainConfirmed).toBe(true);
        expect(await page.getByText("Pemeriksaan belum tersedia. Coba lagi nanti.").count()).toBe(0);
        await confirmed.waitFor();
        expect(await panel.locator("details").getAttribute("open")).toBeNull();
        // Network failure and HTTP failure both remove a previously green badge.
        for (const failure of ["network", "http"]) {
          await page.route(proofUrl, (route: any) => failure === "network" ? route.abort() :
            route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false }) }));
          await panel.getByRole("button", { name: "Periksa ulang bukti", exact: true }).click();
          await panel.getByRole("alert").waitFor();
          await unconfirmed.waitFor();
          expect(await confirmed.count()).toBe(0);
          await page.unroute(proofUrl);
          await panel.getByRole("button", { name: "Periksa ulang bukti", exact: true }).click();
          await confirmed.waitFor();
          expect(await panel.getByRole("alert").count()).toBe(0);
        }
        expect(errors).toHaveLength(0);
        expect(await publicClient.getTransactionCount({ address: deployer.address })).toBe(nonce);
        await page.screenshot({ path: `/tmp/issue108-receipt-${viewport.width}.png`, fullPage: true });
        await page.close();
      }
    } finally { await browser.close(); server.stop(true); }
  }, 60000);

});
