/**
 * Integration & Acceptance Tests for Batch Corrections & ZK Receipt Validity (Spec #100, Issue #110).
 *
 * Covers:
 * - AC01: Policy for unchanged members when correcting a member; view when reproof is pending
 *         (no assumption that old receipts are automatically current).
 * - AC02: Endorsement of batch correction binds source, reason, predecessor, and successor;
 *         competing corrections do not branch or create two official versions.
 * - AC03: Historical batch/receipt, proof, and transaction outcomes remain inspectable.
 *         Separation of mathematical validity (VALID_HISTORICAL vs VALID) from business validity (SUPERSEDED, PENDING_REPROOF, CURRENT).
 * - AC04: Nominal correction or actual refund payment (PAID) triggers new official version;
 *         refund decision (DECIDED) does not claim money returned.
 * - AC05: Failure in successor publication does not falsely make predecessor appear current;
 *         retries do not duplicate receipts or transactions.
 * - AC06: Real proof / EVM execution with Groth16, Anvil, and contracts.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import app from "../src/index";
import { createZkPublicationStore } from "../src/zk-publication-store";
import { runZkPublication, inspectPublications } from "../src/zk-publication";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createContributionStore, type ContributionStore } from "../src/contribution-store";
import { createDonorAccessStore, type DonorAccessStore } from "../src/donor-access-store";
import { createZkBatchStore, type ZkBatchStore } from "../src/zk-batch-store";
import { createZkProofService, CONTRIBUTION_PROOF_REGISTRY_ABI, type ZkProofService } from "../src/zk-proof-service";
import { configureWorkspace, resetWorkspace, workspaceRuntime, type RecipientMessageTransport } from "../src/workspace-runtime";
import { type EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { CONTRIBUTION_SCHEMA_STATEMENTS } from "../src/contribution-store";
import { DONOR_ACCESS_SCHEMA_STATEMENTS } from "../src/donor-access-store";
import { DISBURSEMENT_SCHEMA_STATEMENTS } from "../src/disbursement-store";
import { ACTIVITY_SCHEMA_STATEMENTS } from "../src/activity-store";
import { ZK_BATCH_SCHEMA_STATEMENTS } from "../src/zk-batch-store";

const ANVIL_PORT = 18597; // Dedicated port to avoid collision with port 18596
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const BASE_WORKSPACE = "http://localhost:3001/api/workspace";
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

describe("Batch Corrections & ZK Receipt Validity (Issue #110)", () => {
  beforeAll(async () => {
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

    await publicClient.request({
      method: "anvil_setBalance" as any,
      params: [deployer.address, "0x56bc75e2d63100000"] as any, // 100 ETH
    });

    const verifierArtifact = await Bun.file(
      join(__dirname, "../../sc/out/Groth16Verifier.sol/Groth16Verifier.json")
    ).json();

    const verifierDeployHash = await walletClient.deployContract({
      abi: verifierArtifact.abi,
      bytecode: verifierArtifact.bytecode.object,
    });
    const verifierReceipt = await publicClient.waitForTransactionReceipt({ hash: verifierDeployHash });
    verifierAddress = verifierReceipt.contractAddress!;

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

    await walletClient.writeContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "enrollInstitution",
      args: [SINAR, deployer.address],
    });

    database = await createTestWorkspaceDatabase(process.env.DONOR_ACCESS_TEST_DATABASE_URL);
    const handle = database.handle();

    workspaceStore = createWorkspaceStore(handle);
    contributionStore = createContributionStore(handle);
    donorAccessStore = createDonorAccessStore(handle, OTP_KEY);
    zkBatchStore = createZkBatchStore(handle);
    zkProofService = createZkProofService();

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

    // Seed institutions
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
  });

  afterAll(async () => {
    resetWorkspace();
    if (anvilProc) {
      try {
        anvilProc.kill();
      } catch {}
    }
    if (database) await database.close();
  });

  it.each(["amount", "duplicate", "repeat", "legacy", "pending", "concurrent"])("%s: End-to-end: corrects member, successor batch endorsements, and separates mathematical vs business validity (AC01, AC02, AC03, AC06)", async (scenario) => {
    const handle = database.handle();
    const token = await signInWorkspace(amilSinar, SINAR);

    const runtime = {
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
    };
    configureWorkspace(runtime);

    const post = async (path: string, body: any) => {
      const res = await app.fetch(
        new Request(`${BASE_WORKSPACE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        })
      );
      return { status: res.status, json: await res.json() };
    };

    const get = async (path: string) => {
      const res = await app.fetch(
        new Request(`${BASE_WORKSPACE}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      return { status: res.status, json: await res.json() };
    };

    const getPublic = async (path: string) => {
      const res = await app.fetch(new Request(`${BASE_PUBLIC}${path}`));
      return { status: res.status, json: await res.json() };
    };

    const createAndEndorse = async (ref: string, amount: string, name: string) => {
      ref = `${scenario}-${ref}`;
      const rec = await post("/contributions", {
        institutionId: SINAR,
        operationId: `op-${ref}`,
        sourceChannel: "BANK_TRANSFER",
        sourceReference: ref,
        currencyUnit: "IDR",
        amountExact: amount,
        fundType: "FITRAH",
        purpose: "Zakat Fitrah",
        receivedAt: clock - 3600,
        donorName: name,
        donorContact: `${ref.toLowerCase()}@example.org`,
      });
      expect(rec.status).toBe(201);
      const c = rec.json.contribution;
      const recon = await post(`/contributions/${c.id}/reconcile`, {
        institutionId: SINAR,
        expectedVersion: c.version,
        operationId: `recon-${ref}`,
        proofRef: `PROOF-${ref}`,
        notes: "Reconciled",
      });
      expect(recon.status).toBe(200);
      const reconciled = recon.json.contribution;
      const end = await post(`/contributions/${c.id}/endorse`, {
        institutionId: SINAR,
        expectedVersion: reconciled.version,
        operationId: `end-${ref}`,
      });
      expect(end.status).toBe(200);
      return end.json.contribution;
    };

    // 1. Create 3 contributions
    const contribA = await createAndEndorse("ISSUE-110-A", "1500000", "Muzakki A");
    const contribB = await createAndEndorse("ISSUE-110-B", "2500000", "Muzakki B");
    const contribC = await createAndEndorse("ISSUE-110-C", "3500000", "Muzakki C");

    const unpublished = (await getPublic(`/receipt-verification/${contribB.id}`)).json.verification;
    expect(unpublished.businessValidity).toBe("PENDING");
    expect(unpublished.mathematicalValidity).toBe("UNVERIFIED");

    // 2. Create Batch 1
    const b1Res = await post("/contribution-batches", {
      contributionIds: [contribA.id, contribB.id, contribC.id],
      fundType: "FITRAH",
      currencyUnit: "IDR",
      cutoff: clock,
    });
    expect(b1Res.status).toBe(201);
    const batch1 = b1Res.json.batch;
    expect(batch1.version).toBe(1);
    expect(batch1.batchNumber).toBeGreaterThan(0);

    // 3. Endorse Batch 1 & Publish Root
    const end1Res = await post(`/contribution-batches/${batch1.id}/endorse`, {
      snapshotRoot: batch1.merkleRoot,
    });
    expect(end1Res.status).toBe(200);
    const b1Ops = await publications.list(SINAR, batch1.id);
    expect(b1Ops.find((p) => p.id === `root:${batch1.id}`)?.status).toBe("CONFIRMED");

    // 4. Prove receipt for Member B (unchanged member) on Batch 1
    const pB1Res = await post(`/contribution-batches/${batch1.id}/proofs/${contribB.id}/process`, {});
    expect(pB1Res.status).toBe(201);
    expect(pB1Res.json.proofRecord.status).toBe("VERIFIED");

    // Check public receipt verification for Member B on Batch 1
    const verifB1 = await getPublic(`/receipt-verification/${contribB.id}`);
    expect(verifB1.status).toBe(200);
    expect(verifB1.json.verification.status).toBe("VERIFIED");
    expect(verifB1.json.verification.mathematicalValidity).toBe("VALID");
    expect(verifB1.json.verification.businessValidity).toBe("CURRENT");
    expect(verifB1.json.verification.isCurrent).toBe(true);
    expect(verifB1.json.verification.chainBusinessValidity).toBe("UNKNOWN");

    const originalA = await post(`/contribution-batches/${batch1.id}/proofs/${contribA.id}/process`, {});
    expect(originalA.status).toBe(201);
    expect(originalA.json.proofRecord.status).toBe("VERIFIED");

    // 5. Correct Member A nominal
    const corrRes = await post(`/contributions/${contribA.id}/correct`, {
      expectedVersion: contribA.version,
      operationId: `op-correct-A-01-${scenario}`,
      correctionType: scenario === "duplicate" ? "DUPLICATE" : "AMOUNT",
      amountExact: "1200000",
      reason: "Koreksi nominal donatur A sesuai slip transfer",
      sourceProofRef: "REF-SLIP-001",
    });
    expect(corrRes.status).toBe(200);
    const correctedA = corrRes.json.contribution;
    expect(correctedA.version).toBe(contribA.version + 1);
    expect(correctedA.status).toBe(scenario === "duplicate" ? "REJECTED" : "ENDORSED");

    // 6. Create Replacement Batch (Batch 2, version 2)
    const replacementInput = {
      expectedBatchVersion: 1,
      reason: "Penyesuaian nominal Muzakki A",
      sourceProofRef: "AUDIT-BATCH-CORR-01",
    };
    const raceCorrections = async () => {
      const sendBoth = () => Promise.all([
        post(`/contribution-batches/${batch1.id}/correct`, replacementInput),
        post(`/contribution-batches/${batch1.id}/correct`, {
          ...replacementInput, reason: "Koreksi bersaing dari sumber kedua", sourceProofRef: "COMPETING-SOURCE",
        }),
      ]);
      if (!process.env.DONOR_ACCESS_TEST_DATABASE_URL) return sendBoth();
      // A separate real PostgreSQL transaction holds the institution lock until both
      // HTTP requests are waiting on it. This guarantees overlap across connections.
      let release!: () => void;
      let ready!: () => void;
      const locked = new Promise<void>(resolve => { ready = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const blocker = handle.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM institutions WHERE id = ${SINAR} FOR UPDATE`);
        ready();
        await gate;
      });
      await Promise.race([locked, blocker]);
      const requests = sendBoth();
      try {
        let waiters = 0;
        for (let attempt = 0; attempt < 100 && waiters < 2; attempt++) {
          const result = await handle.execute(sql`SELECT count(*) AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%SELECT id FROM institutions%'`);
          waiters = Number((Array.isArray(result) ? result : result.rows)[0].waiting);
          if (waiters < 2) await Bun.sleep(20);
        }
        expect(waiters).toBe(2);
      } finally {
        release();
        await blocker;
        await requests;
      }
      return requests;
    };
    const competitors = scenario === "concurrent"
      ? await raceCorrections()
      : [await post(`/contribution-batches/${batch1.id}/correct`, replacementInput)];
    if (scenario === "concurrent") {
      expect(competitors.map(result => result.status).sort()).toEqual([201, 409]);
      expect((await get(`/contribution-batches/${batch1.id}/history`)).json.history.length).toBe(2);
    }
    const repRes = competitors.find(result => result.status === 201)!;
    expect(repRes.status).toBe(201);
    let batch2 = repRes.json.batch;
    expect(batch2.version).toBe(2);
    expect(batch2.batchNumber).toBe(batch1.batchNumber);
    expect(batch2.predecessorBatchId).toBe(batch1.id);
    expect(["Penyesuaian nominal Muzakki A", "Koreksi bersaing dari sumber kedua"]).toContain(batch2.correctionReason);
    expect(batch2.sourceProofRef).toBe(batch2.correctionReason === replacementInput.reason ? replacementInput.sourceProofRef : "COMPETING-SOURCE");

    // Verify Batch 1 is now marked SUPERSEDED
    const b1After = await get(`/contribution-batches/${batch1.id}`);
    expect(b1After.json.batch.status).toBe("SUPERSEDED");

    // 7. Test AC02: Competing corrections rejection
    // Attempting a second correction from Batch 1 must be rejected (409)
    const compRes = await post(`/contribution-batches/${batch1.id}/correct`, {
      expectedBatchVersion: 1,
      reason: "Koreksi kedua bersaing",
      sourceProofRef: "AUDIT-BATCH-CORR-COMPETING",
    });
    expect(compRes.status).toBe(409);
    expect(compRes.json.error).toContain("koreksi bersaing");

    // Attempting a correction from Batch 2 with stale expectedBatchVersion 1 must be rejected (409)
    const staleRes = await post(`/contribution-batches/${batch2.id}/correct`, {
      expectedBatchVersion: 1,
      reason: "Koreksi dengan versi usang",
      sourceProofRef: "AUDIT-STALE",
    });
    expect(staleRes.status).toBe(409);
    expect(staleRes.json.error).toContain("stale version");

    if (scenario === "repeat") {
      runtime.zkBudget.maxAttempts = 0;
      await post(`/contribution-batches/${batch2.id}/endorse`, { snapshotRoot: batch2.merkleRoot });
      expect((await publications.list(SINAR, batch2.id)).some(op => op.status === "BUDGET_EXHAUSTED")).toBe(true);
      runtime.zkBudget.maxAttempts = 100;
      const correction = await post(`/contributions/${contribA.id}/correct`, {
        expectedVersion: correctedA.version, operationId: "repeat-correction-A",
        correctionType: "AMOUNT", amountExact: "1100000", reason: "Second source correction",
        sourceProofRef: "SECOND-SOURCE",
      });
      expect(correction.status).toBe(200);
      expect((await post(`/contribution-batches/${batch2.id}/endorse`, { snapshotRoot: batch2.merkleRoot })).status).toBe(409);
      const refreshed = await post(`/contribution-batches/${batch2.id}/correct`, {
        expectedBatchVersion: batch2.version, reason: "Refresh stale draft", sourceProofRef: "SECOND-SOURCE",
      });
      expect(refreshed.status).toBe(201);
      expect(refreshed.json.batch.version).toBe(2);
      expect(refreshed.json.batch.id).not.toBe(batch2.id);
      expect((await get(`/contribution-batches/${batch2.id}`)).json.batch.status).toBe("ABANDONED");
      expect((await post(`/contribution-batches/${batch2.id}/endorse`, { snapshotRoot: batch2.merkleRoot })).status).toBe(409);
      expect((await post(`/contribution-batches/${batch2.id}/retry`, {})).status).toBe(409);
      expect(refreshed.json.batch.replacesDraftId).toBe(batch2.id);
      batch2 = refreshed.json.batch;
    }
    if (scenario === "legacy") {
      // Model an existing #109 receipt without the newly introduced history table rows.
      await handle.execute(sql`DELETE FROM zk_contribution_receipt_proof_history WHERE contribution_id = ${contribB.id}`);
    }

    if (scenario === "pending") {
      await publicClient.request({ method: "evm_setAutomine", params: [false] });
      try {
        await post(`/contribution-batches/${batch2.id}/endorse`, { snapshotRoot: batch2.merkleRoot });
        const pending = (await publications.list(SINAR, batch2.id)).find(op => !op.contributionId)!;
        expect(pending.status).toBe("PENDING");
        expect(pending.rawTransaction).toBeTruthy();
        const refused = await post(`/contribution-batches/${batch2.id}/correct`, {
          expectedBatchVersion: 2, reason: "Must not replace signed snapshot", sourceProofRef: "PENDING-SOURCE",
        });
        expect(refused.status).toBe(400);
        expect(refused.json.error).toContain("ditandatangani");
        await publicClient.request({ method: "evm_mine" });
        await runZkPublication(runtime, pending.id);
        expect((await publications.list(SINAR, batch2.id)).find(op => op.id === pending.id)!.txHash).toBe(pending.txHash);
      } finally {
        await publicClient.request({ method: "evm_setAutomine", params: [true] });
      }
    }

    // 8. Endorse Batch 2 and publish root on-chain
    const end2Res = await post(`/contribution-batches/${batch2.id}/endorse`, {
      snapshotRoot: batch2.merkleRoot,
    });
    expect(end2Res.status).toBe(200);

    await runZkPublication(runtime, `root:${batch2.id}`);
    const b2Ops = await publications.list(SINAR, batch2.id);
    expect(b2Ops.find((p) => p.id === `root:${batch2.id}`)?.status).toBe("CONFIRMED");

    // 9. Inspect public verification for UNCHANGED Member B BEFORE Reproof (AC01, AC03)
    // Mathematical validity is VALID_HISTORICAL, but business validity is PENDING_REPROOF (not automatically current)
    const verifBPending = await getPublic(`/receipt-verification/${contribB.id}`);
    expect(verifBPending.status).toBe(200);
    expect(verifBPending.json.verification.status).toBe("PENDING_REPROOF");
    expect(verifBPending.json.verification.mathematicalValidity).toBe("VALID_HISTORICAL");
    expect(verifBPending.json.verification.businessValidity).toBe("PENDING_REPROOF");
    expect(verifBPending.json.verification.isCurrent).toBe(false);
    expect(verifBPending.json.verification.chainBusinessValidity).toBe("SUPERSEDED");
    expect(verifBPending.json.verification.explanation).toContain("reproof");

    // 10. Reproof Member B on Batch 2 (AC01)
    const reproofRes = await post(`/contribution-batches/${batch2.id}/proofs/${contribB.id}/process`, {});
    expect(reproofRes.status).toBe(201);
    expect(reproofRes.json.proofRecord.status).toBe("VERIFIED");
    expect(reproofRes.json.proofRecord.batchId).toBe(batch2.id);

    // 11. Inspect public verification for Member B AFTER Reproof (AC01, AC03)
    // Now both mathematical and business validity are CURRENT
    const verifBCurrent = await getPublic(`/receipt-verification/${contribB.id}`);
    expect(verifBCurrent.status).toBe(200);
    expect(verifBCurrent.json.verification.status).toBe("VERIFIED");
    expect(verifBCurrent.json.verification.mathematicalValidity).toBe("VALID");
    expect(verifBCurrent.json.verification.businessValidity).toBe("CURRENT");
    expect(verifBCurrent.json.verification.isCurrent).toBe(true);
    // History contains both verifications
    expect(verifBCurrent.json.verification.history.length).toBe(2);
    const historicalReceipt = await get(`/contribution-batches/${batch1.id}/proofs/${contribB.id}`);
    expect(historicalReceipt.json.proofRecord.batchId).toBe(batch1.id);
    expect(historicalReceipt.json.proofRecord.txHash).toBe(pB1Res.json.proofRecord.txHash);
    expect(historicalReceipt.json.proofRecord.proof).toEqual(pB1Res.json.proofRecord.proof);
    await zkBatchStore.ensureSchema();
    await zkBatchStore.ensureSchema();
    expect((await getPublic(`/receipt-verification/${contribB.id}`)).json.verification.history.length).toBe(2);

    // The changed member must also have a real, version-bound successor receipt.
    const beforeReproofA = (await getPublic(`/receipt-verification/${contribA.id}`)).json.verification;
    expect(beforeReproofA.businessValidity).toBe("SUPERSEDED");
    expect(beforeReproofA.mathematicalValidity).toBe("VALID_HISTORICAL");
    const nextA = await post(`/contribution-batches/${batch2.id}/proofs/${contribA.id}/process`, {});
    if (scenario === "duplicate") {
      expect(nextA.status).toBe(404);
    } else {
      expect(nextA.status).toBe(201);
      expect(nextA.json.proofRecord.status).toBe("VERIFIED");
      const latestA = (await get(`/contributions/${contribA.id}`)).json.contribution;
      expect(nextA.json.proofRecord.version).toBe(latestA.version);
      expect(nextA.json.proofRecord.txHash).not.toBe(originalA.json.proofRecord.txHash);
      const nowA = (await getPublic(`/receipt-verification/${contribA.id}`)).json.verification;
      expect(nowA.businessValidity).toBe("CURRENT");
      expect(nowA.onChainConfirmed).toBe(true);
      const chainA = await publicClient.readContract({ address: registryAddress,
        abi: CONTRIBUTION_PROOF_REGISTRY_ABI, functionName: "getReceiptVerificationWithBatch",
        args: [SINAR, contribA.id, BigInt(latestA.version)] });
      expect(chainA[0]).toBe(true);
      expect(chainA[2]).toBe(2n);
      expect(chainA[3]).toBe(batch2.merkleRoot);
      const nonce = await publicClient.getTransactionCount({ address: deployer.address });
      const retriedA = await post(`/contribution-batches/${batch2.id}/proofs/${contribA.id}/process`, {});
      expect(retriedA.json.proofRecord.txHash).toBe(nextA.json.proofRecord.txHash);
      expect(await publicClient.getTransactionCount({ address: deployer.address })).toBe(nonce);
    }
    const oldA = await get(`/contribution-batches/${batch1.id}/proofs/${contribA.id}`);
    expect(oldA.json.proofRecord.proof).toEqual(originalA.json.proofRecord.proof);
    expect(oldA.json.proofRecord.txHash).toBe(originalA.json.proofRecord.txHash);

    // 12. Check Batch History / Lineage API (AC03)
    const histRes = await get(`/contribution-batches/${batch2.id}/history`);
    expect(histRes.status).toBe(200);
    expect(histRes.json.history.length).toBe(scenario === "repeat" ? 3 : 2);
    expect(histRes.json.history[0].version).toBe(1);
    expect(histRes.json.history[0].status).toBe("SUPERSEDED");
    expect(histRes.json.history[1].version).toBe(2);
    expect(histRes.json.history.find((b: any) => b.id === batch2.id).status).toBe("ENDORSED");
    expect(histRes.json.history[1].predecessorBatchId).toBe(batch1.id);
  }, 60000); // real Groth16 proofs: 3.5-7s per scenario, above the 5s default

  it("Refund decision preserves receipt and actual payment leads to a real successor proof (AC04)", async () => {
    const handle = database.handle();
    const token = await signInWorkspace(amilSinar, SINAR);

    const post = async (path: string, body: any) => {
      const res = await app.fetch(
        new Request(`${BASE_WORKSPACE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        })
      );
      return { status: res.status, json: await res.json() };
    };

    const get = async (path: string) => {
      const res = await app.fetch(
        new Request(`${BASE_WORKSPACE}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      return { status: res.status, json: await res.json() };
    };

    const createAndEndorse = async (ref: string, amount: string, name: string) => {
      const rec = await post("/contributions", {
        institutionId: SINAR,
        operationId: `op-${ref}`,
        sourceChannel: "BANK_TRANSFER",
        sourceReference: ref,
        currencyUnit: "IDR",
        amountExact: amount,
        fundType: "FITRAH",
        purpose: "Zakat Fitrah",
        receivedAt: clock - 3600,
        donorName: name,
        donorContact: `${ref.toLowerCase()}@example.org`,
      });
      expect(rec.status).toBe(201);
      const c = rec.json.contribution;
      const recon = await post(`/contributions/${c.id}/reconcile`, {
        institutionId: SINAR,
        expectedVersion: c.version,
        operationId: `recon-${ref}`,
        proofRef: `PROOF-${ref}`,
        notes: "Reconciled",
      });
      expect(recon.status).toBe(200);
      const reconciled = recon.json.contribution;
      const end = await post(`/contributions/${c.id}/endorse`, {
        institutionId: SINAR,
        expectedVersion: reconciled.version,
        operationId: `end-${ref}`,
      });
      expect(end.status).toBe(200);
      return end.json.contribution;
    };

    // Create a contribution
    const contrib = await createAndEndorse("ISSUE-110-REFUND-01", "500000", "Muzakki Refund");

    const initial = await post("/contribution-batches", {
      contributionIds: [contrib.id], fundType: "FITRAH", currencyUnit: "IDR", cutoff: clock,
    });
    expect(initial.status).toBe(201);
    const batch = initial.json.batch;
    expect((await post(`/contribution-batches/${batch.id}/endorse`, { snapshotRoot: batch.merkleRoot })).status).toBe(200);
    const initialProof = await post(`/contribution-batches/${batch.id}/proofs/${contrib.id}/process`, {});
    expect(initialProof.status).toBe(201);
    const verify = async () => (await (await app.fetch(new Request(`${BASE_PUBLIC}/receipt-verification/${contrib.id}`))).json()).verification;
    expect((await verify()).businessValidity).toBe("CURRENT");

    // 1. Refund Decision (DECIDED)
    const decRes = await post(`/contributions/${contrib.id}/refunds`, {
      expectedVersion: contrib.version,
      operationId: "op-refund-decide-01",
      amountExact: "500000",
      reason: "Permintaan pengembalian donatur",
      policyBasis: "Kebijakan pengembalian dana donatur pasal 4",
    });
    expect(decRes.status).toBe(201);
    const refund = decRes.json.refund;
    expect(refund.status).toBe("DECIDED");

    // Verify contribution status is STILL ENDORSED after DECIDED (decision alone does not refund money)
    const contribAfterDec = await get(`/contributions/${contrib.id}`);
    expect(contribAfterDec.json.contribution.status).toBe("ENDORSED");
    expect(contribAfterDec.json.contribution.version).toBe(contrib.version);
    expect((await verify()).businessValidity).toBe("CURRENT");
    expect((await verify()).txHash).toBe(initialProof.json.proofRecord.txHash);

    // 2. Refund Payment Execution (PAID)
    const payRes = await post(`/contributions/${contrib.id}/refunds/${refund.id}/pay`, {
      operationId: "op-refund-pay-01",
      paymentProofRef: "REF-BANK-TRANSFER-99",
      paidAt: clock,
    });
    expect(payRes.status).toBe(200);
    expect(payRes.json.refund.status).toBe("PAID");

    // After actual payment (PAID), contribution is refunded
    const contribAfterPay = await get(`/contributions/${contrib.id}`);
    expect(contribAfterPay.json.contribution.version).toBeGreaterThan(contrib.version);
    expect((await verify()).businessValidity).toBe("SUPERSEDED");
    const replacement = await post(`/contribution-batches/${batch.id}/correct`, {
      expectedBatchVersion: 1, reason: "Pengembalian sudah dibayar", sourceProofRef: "REF-BANK-TRANSFER-99",
    });
    expect(replacement.status).toBe(201);
    const successor = replacement.json.batch;
    expect((await post(`/contribution-batches/${successor.id}/endorse`, { snapshotRoot: successor.merkleRoot })).status).toBe(200);
    const newProof = await post(`/contribution-batches/${successor.id}/proofs/${contrib.id}/process`, {});
    expect(newProof.status).toBe(201);
    expect(newProof.json.proofRecord.status).toBe("VERIFIED");
    expect(newProof.json.proofRecord.version).toBe(contribAfterPay.json.contribution.version);
    expect(newProof.json.proofRecord.txHash).not.toBe(initialProof.json.proofRecord.txHash);
    const current = await verify();
    expect(current.businessValidity).toBe("CURRENT");
    expect(current.onChainConfirmed).toBe(true);
    expect(current.batchRoot).toBe(successor.merkleRoot);
    const oldProof = await get(`/contribution-batches/${batch.id}/proofs/${contrib.id}`);
    expect(oldProof.json.proofRecord.proof).toEqual(initialProof.json.proofRecord.proof);
    const nonce = await publicClient.getTransactionCount({ address: deployer.address });
    const repeatedPayment = await post(`/contributions/${contrib.id}/refunds/${refund.id}/pay`, {
      operationId: "op-refund-pay-01", paymentProofRef: "REF-BANK-TRANSFER-99", paidAt: clock,
    });
    expect(repeatedPayment.status).toBe(200);
    expect((await get(`/contributions/${contrib.id}`)).json.contribution.version).toBe(contribAfterPay.json.contribution.version);
    const repeatedProof = await post(`/contribution-batches/${successor.id}/proofs/${contrib.id}/process`, {});
    expect(repeatedProof.json.proofRecord.txHash).toBe(newProof.json.proofRecord.txHash);
    expect(await publicClient.getTransactionCount({ address: deployer.address })).toBe(nonce);

  });

  it("Successor publication failure does not restore predecessor batch as current, and retries are idempotent (AC05)", async () => {
    const handle = database.handle();
    const token = await signInWorkspace(amilSinar, SINAR);

    const post = async (path: string, body: any) => {
      const res = await app.fetch(
        new Request(`${BASE_WORKSPACE}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        })
      );
      return { status: res.status, json: await res.json() };
    };

    const get = async (path: string) => {
      const res = await app.fetch(
        new Request(`${BASE_WORKSPACE}${path}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      );
      return { status: res.status, json: await res.json() };
    };

    const getPublic = async (path: string) => {
      const res = await app.fetch(new Request(`${BASE_PUBLIC}${path}`));
      return { status: res.status, json: await res.json() };
    };

    const createAndEndorse = async (ref: string, amount: string, name: string) => {
      const rec = await post("/contributions", {
        institutionId: SINAR,
        operationId: `op-${ref}`,
        sourceChannel: "BANK_TRANSFER",
        sourceReference: ref,
        currencyUnit: "IDR",
        amountExact: amount,
        fundType: "FITRAH",
        purpose: "Zakat Fitrah",
        receivedAt: clock - 3600,
        donorName: name,
        donorContact: `${ref.toLowerCase()}@example.org`,
      });
      const c = rec.json.contribution;
      const recon = await post(`/contributions/${c.id}/reconcile`, {
        institutionId: SINAR,
        expectedVersion: c.version,
        operationId: `recon-${ref}`,
        proofRef: `PROOF-${ref}`,
        notes: "Reconciled",
      });
      const reconciled = recon.json.contribution;
      const end = await post(`/contributions/${c.id}/endorse`, {
        institutionId: SINAR,
        expectedVersion: reconciled.version,
        operationId: `end-${ref}`,
      });
      return end.json.contribution;
    };

    const c1 = await createAndEndorse("ISSUE-110-FAIL-1", "1000000", "Donor 1");
    const c2 = await createAndEndorse("ISSUE-110-FAIL-2", "2000000", "Donor 2");

    // 1. Create and endorse initial Batch
    const bInitRes = await post("/contribution-batches", {
      contributionIds: [c1.id, c2.id],
      fundType: "FITRAH",
      currencyUnit: "IDR",
      cutoff: clock,
    });
    const bInit = bInitRes.json.batch;
    await post(`/contribution-batches/${bInit.id}/endorse`, { snapshotRoot: bInit.merkleRoot });

    const receiptBefore = await post(`/contribution-batches/${bInit.id}/proofs/${c2.id}/process`, {});
    expect(receiptBefore.status).toBe(201);

    // 2. Correct c1
    const corrC1 = await post(`/contributions/${c1.id}/correct`, {
      expectedVersion: c1.version,
      operationId: "op-corr-c1-fail",
      correctionType: "AMOUNT",
      amountExact: "800000",
      reason: "Koreksi nominal",
      sourceProofRef: "REF-FAIL-01",
    });

    // 3. Create replacement Batch (v2)
    const bSuccRes = await post(`/contribution-batches/${bInit.id}/correct`, {
      expectedBatchVersion: bInit.version,
      reason: "Koreksi batch penerus gagal publikasi",
      sourceProofRef: "REF-AUDIT-FAIL",
    });
    expect(bSuccRes.status).toBe(201);
    const bSucc = bSuccRes.json.batch;
    expect(bSucc.version).toBe(2);

    // Predecessor must be SUPERSEDED immediately upon replacement batch creation
    const bInitCheck = await get(`/contribution-batches/${bInit.id}`);
    expect(bInitCheck.json.batch.status).toBe("SUPERSEDED");

    // Attempting publication under exhausted budget / simulation
    workspaceRuntime()!.zkBudget!.maxAttempts = 0;
    await post(`/contribution-batches/${bSucc.id}/endorse`, { snapshotRoot: bSucc.merkleRoot });

    // Successor publication failed due to budget, so successor batch remains DRAFT
    const bSuccCheckAfterFail = await get(`/contribution-batches/${bSucc.id}`);
    expect(bSuccCheckAfterFail.json.batch.status).toBe("DRAFT");

    // Verify: failure in successor publication does NOT falsely restore predecessor to current
    const bInitAfterFail = await get(`/contribution-batches/${bInit.id}`);
    expect(bInitAfterFail.json.batch.status).toBe("SUPERSEDED");
    expect(await zkBatchStore.batchIsCurrent(SINAR, bInit.id)).toBe(false);

    const independent = await publicClient.readContract({ address: registryAddress,
      abi: CONTRIBUTION_PROOF_REGISTRY_ABI, functionName: "getReceiptVerificationWithBatch",
      args: [SINAR, c2.id, BigInt(c2.version)] });
    expect(independent[0]).toBe(true); // Mathematical verification is retained.
    expect(independent[7]).toBe(true); // Only latest REGISTERED root, never business-current.
    expect(independent[8]).toBe(0); // BusinessValidity.UNKNOWN even if successor cannot publish.
    const publicStatus = await app.fetch(new Request(`${BASE_PUBLIC}/receipt-verification/${c2.id}`));
    const publicResult = (await publicStatus.json()).verification;
    expect(publicResult.businessValidity).toBe("PENDING_REPROOF");
    expect(publicResult.isCurrent).toBe(false);
    expect(publicResult.chainBusinessValidity).toBe("UNKNOWN");

    // Correction records remain durable
    const hist = await zkBatchStore.getBatchHistory(SINAR, bSucc.id);
    expect(hist.length).toBe(2);
    expect(hist[0].id).toBe(bInit.id);
    expect(hist[1].id).toBe(bSucc.id);

    // Restore budget and retry
    workspaceRuntime()!.zkBudget!.maxAttempts = 100;
    await post(`/contribution-batches/${bSucc.id}/retry`, {});
    await runZkPublication(workspaceRuntime()!, `root:${bSucc.id}`);
    const bSuccAfterRetry = await get(`/contribution-batches/${bSucc.id}`);
    expect(bSuccAfterRetry.json.batch.status).toBe("ENDORSED");

    // Verify retry did not duplicate history or batch items
    const histAfterRetry = await zkBatchStore.getBatchHistory(SINAR, bSucc.id);
    expect(histAfterRetry.length).toBe(2);
  });

  it("Direct EVM contract: enforces sequential batch versions and rejection of competing roots (AC02, AC06)", async () => {
    const instKey = keccak256(Buffer.from(SINAR));
    const batchId = 99n;
    const rootV1 = `0x${"11".repeat(32)}` as Hex;
    const rootV2A = `0x${"22".repeat(32)}` as Hex;
    const rootV2B = `0x${"33".repeat(32)}` as Hex;
    const rootV3 = `0x${"44".repeat(32)}` as Hex;

    const registryArtifact = await Bun.file(
      join(__dirname, "../../sc/out/ContributionProofRegistry.sol/ContributionProofRegistry.json")
    ).json();

    // 1. Initial version 1 succeeds
    const tx1 = await walletClient.writeContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "endorseBatchRoot",
      args: [SINAR, batchId, 1n, rootV1],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx1 });

    const batchAfter1 = await publicClient.readContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "batches",
      args: [instKey, batchId],
    });
    expect(batchAfter1[0]).toBe(rootV1);
    expect(batchAfter1[1]).toBe(1n);
    expect(batchAfter1[4]).toBe(true);

    // 2. Skipping version (e.g. going from v1 directly to v3) must revert
    let skipFailed = false;
    try {
      await walletClient.writeContract({
        address: registryAddress,
        abi: registryArtifact.abi,
        functionName: "endorseBatchRoot",
        args: [SINAR, batchId, 3n, rootV3],
      });
    } catch {
      skipFailed = true;
    }
    expect(skipFailed).toBe(true);

    // 3. Successor version 2 succeeds
    const tx2 = await walletClient.writeContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "endorseBatchRoot",
      args: [SINAR, batchId, 2n, rootV2A],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx2 });

    const batchAfter2 = await publicClient.readContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "batches",
      args: [instKey, batchId],
    });
    expect(batchAfter2[0]).toBe(rootV2A);
    expect(batchAfter2[1]).toBe(2n);

    // 4. Competing correction (trying to endorse a different root for version 2) must revert
    let competingFailed = false;
    try {
      await walletClient.writeContract({
        address: registryAddress,
        abi: registryArtifact.abi,
        functionName: "endorseBatchRoot",
        args: [SINAR, batchId, 2n, rootV2B],
      });
    } catch {
      competingFailed = true;
    }
    expect(competingFailed).toBe(true);

    // 5. Check batchesByRoot stores historical root v1 and current root v2
    const histV1 = await publicClient.readContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "batchesByRoot",
      args: [instKey, rootV1],
    });
    expect(histV1[0]).toBe(rootV1);
    expect(histV1[1]).toBe(1n); // version 1
    expect(histV1[4]).toBe(true); // exists

    const currV2 = await publicClient.readContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "batchesByRoot",
      args: [instKey, rootV2A],
    });
    expect(currV2[0]).toBe(rootV2A);
    expect(currV2[1]).toBe(2n); // version 2
    expect(currV2[4]).toBe(true); // exists

    // 6. Check isLatestRegisteredBatchRoot view
    const isV1Current = await publicClient.readContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "isLatestRegisteredBatchRoot",
      args: [SINAR, batchId, rootV1],
    });
    expect(isV1Current).toBe(false);

    const isV2Current = await publicClient.readContract({
      address: registryAddress,
      abi: registryArtifact.abi,
      functionName: "isLatestRegisteredBatchRoot",
      args: [SINAR, batchId, rootV2A],
    });
    expect(isV2Current).toBe(true);
  });
  it("retains batch lineage and historical receipt proofs after database restart", async () => {
    const before = await zkBatchStore.listBatches(SINAR);
    const historicalBatch = before.find(batch => batch.status === "SUPERSEDED" && batch.items.length > 1)!;
    const member = historicalBatch.items[1].contributionId;
    const witness = await zkBatchStore.getBatchItemWitness(SINAR, historicalBatch.id, member);
    const beforeProof = await zkBatchStore.getReceiptProof(member, witness!.version, historicalBatch.id);
    expect(beforeProof?.status).toBe("VERIFIED");
    const previousRuntime = workspaceRuntime()!;
    const db = await database.reopen();
    workspaceStore = createWorkspaceStore(db);
    contributionStore = createContributionStore(db);
    donorAccessStore = createDonorAccessStore(db, OTP_KEY);
    zkBatchStore = createZkBatchStore(db);
    publications = createZkPublicationStore(db);
    configureWorkspace({ ...previousRuntime, store: workspaceStore, contributions: contributionStore,
      donorAccess: donorAccessStore, zkBatches: zkBatchStore, zkPublications: publications });
    expect(await zkBatchStore.getReceiptProof(member, witness!.version, historicalBatch.id)).toEqual(beforeProof);
    expect((await zkBatchStore.getBatchHistory(SINAR, historicalBatch.id)).length).toBeGreaterThan(1);
    const token = await signInWorkspace(amilSinar, SINAR);
    const response = await app.fetch(new Request(`${BASE_WORKSPACE}/contribution-batches/${historicalBatch.id}/proofs/${member}`, {
      headers: { Authorization: `Bearer ${token}` },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).proofRecord.txHash).toBe(beforeProof!.txHash);
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: compares real receipt before and after correction on desktop/mobile", async () => {
    const built = await Bun.build({
      entrypoints: [new URL("../../frontend/test/contribution-correction-smoke.tsx", import.meta.url).pathname], target: "browser",
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
    const token = await signInWorkspace(amilSinar, SINAR);
    const post = async (path: string, body: any) => {
      const response = await app.fetch(new Request(`${BASE_WORKSPACE}${path}`, { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
      expect(response.ok).toBe(true);
      return response.json();
    };
    try {
      for (const width of [1280, 390]) {
        const members = [];
        for (const member of ["A", "B"]) {
          const ref = `CORRECTION-BROWSER-${width}-${member}`;
          const created = await post("/contributions", { institutionId: SINAR, operationId: ref,
            sourceChannel: "CASH", sourceReference: ref, currencyUnit: "IDR", amountExact: "500000",
            fundType: "FITRAH", purpose: "Bantuan", receivedAt: NOW - 100 });
          const id = created.contribution.id;
          await post(`/contributions/${id}/reconcile`, { expectedVersion: 1, operationId: `${ref}-match`, proofRef: ref });
          const endorsed = await post(`/contributions/${id}/endorse`, { expectedVersion: 2, operationId: `${ref}-endorse` });
          members.push(endorsed.contribution);
        }
        const { batch } = await post("/contribution-batches", { contributionIds: members.map(m => m.id), fundType: "FITRAH", currencyUnit: "IDR", cutoff: NOW });
        await post(`/contribution-batches/${batch.id}/endorse`, { snapshotRoot: batch.merkleRoot });
        await post(`/contribution-batches/${batch.id}/proofs/${members[1].id}/process`, {});
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        page.setDefaultTimeout(15000);
        const errors: string[] = [];
        page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.addInitScript((value: string) => sessionStorage.setItem("workspace-test-token", value), token);
        await page.goto(`${server.url}?reference=${members[1].id}`);
        const check = page.getByRole("button", { name: "Periksa bukti ZK", exact: true });
        await check.click();
        await page.getByText("Bukti ZK terkonfirmasi di EVM", { exact: true }).waitFor();
        await post(`/contributions/${members[0].id}/correct`, { expectedVersion: members[0].version,
          operationId: `browser-correct-${width}`, correctionType: "AMOUNT", amountExact: "400000",
          reason: "Sumber dikoreksi", sourceProofRef: `SOURCE-${width}` });
        await check.click();
        await page.getByText("Bukti historis valid — menunggu reproof pada batch baru", { exact: true }).waitFor();
        await page.getByRole("button", { name: `Buka ${batch.id}`, exact: true }).click();
        const review = page.getByRole("region", { name: "Review snapshot", exact: true });
        await review.getByText("Koreksi batch ini", { exact: true }).click();
        await review.getByLabel("Alasan koreksi", { exact: true }).fill("Nominal sesuai sumber terbaru");
        await review.getByLabel("Referensi bukti sumber", { exact: true }).fill(`SOURCE-${width}`);
        await review.getByRole("button", { name: "Siapkan batch koreksi", exact: true }).click();
        await review.getByRole("heading", { name: `Review snapshot (Batch #${batch.batchNumber} v2)`, exact: true }).waitFor();
        await review.getByLabel("Saya telah memeriksa populasi dan cutoff snapshot ini.").check();
        await review.getByRole("button", { name: "Sahkan snapshot dan proses otomatis", exact: true }).click();
        await review.getByText("Terkonfirmasi", { exact: true }).waitFor();
        const successor = (await zkBatchStore.getBatchHistory(SINAR, batch.id)).find(b => b.version === 2)!;
        await post(`/contribution-batches/${successor.id}/proofs/${members[1].id}/process`, {});
        await check.click();
        await page.getByText("Bukti ZK terkonfirmasi di EVM", { exact: true }).waitFor();
        await page.getByText("Riwayat Verifikasi (2 catatan)", { exact: true }).click();
        expect(await page.getByText("Batch #undefined", { exact: false }).count()).toBe(0);
        expect(errors).toHaveLength(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: `/tmp/issue110-correction-${width}.png`, fullPage: true });
        await page.close();
      }
    } finally { await browser.close(); server.stop(true); }
  }, 60000);

});
