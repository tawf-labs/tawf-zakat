/** #114: one real HTTP/SQL/encrypted-file/Groth16/local-EVM/browser journey.
 * Only institution mandates and the upstream approved proposal are seeded. No proof, mint,
 * evidence-completeness, trace, or verifier success is manufactured by this fixture.
 * Uses the existing global-runtime reset convention; browser coverage is opt-in via
 * REGISTRY_BROWSER_MODULE/REGISTRY_BROWSER_EXECUTABLE (HTTP and real engines always run).
 */
import { afterAll, beforeAll, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createContributionStore } from "../src/contribution-store";
import { createActivityStore } from "../src/activity-store";
import { createDonorAccessStore } from "../src/donor-access-store";
import { createEvidenceStore } from "../src/evidence-store";
import { createEncryptedFileStore } from "../src/evidence-files";
import { createZkBatchStore } from "../src/zk-batch-store";
import { createZkPublicationStore } from "../src/zk-publication-store";
import { createZkProofService } from "../src/zk-proof-service";
import { createCertificateStore } from "../src/certificate-store";
import { createCertificateChain } from "../src/certificate-chain";
import { createRegistryChain } from "../src/registry-chain";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { certificationTypedData } from "../../shared/certificate-nft";
import { DISBURSEMENT_REALIZATION_STREAM } from "../src/realization-source";

// Public Anvil development key, never a secret or a public-network signing credential.
const key = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const account = privateKeyToAccount(key);
const institutionId = "lpz-sinar-amanah";
const rpcUrl = "http://127.0.0.1:18624";
const rpc = createPublicClient({ chain: foundry, pollingInterval: 25, transport: http(rpcUrl, { retryCount: 0, timeout: 1000 }) });
const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });
const now = Math.floor(Date.now() / 1000);
const period = { kind: "AKHIR_TAHUN", year: new Date(now * 1000).getUTCFullYear() };
const activityId = "act-journey-114", proposalId = "prop-journey-114";
const certificateId = "cert-journey-114";
const certBase = `workspace/activities/${activityId}/certificates/${certificateId}`;
let database: TestWorkspaceDatabase;
let node: ReturnType<typeof Bun.spawn> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
let directory: string;
let token = "", donorToken = "", mine = "";
let bundle = "", css = "";
const outbox: string[] = [];
const budget = { maxWei: "1000000000000000000", gasLimit: "1500000", maxFeePerGas: "2000000000" };

async function call(path: string, body?: unknown, auth = token) {
  return fetch(new URL(`/api/${path}`, server!.url), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(path: string, body?: unknown, status = body === undefined ? 200 : 201, auth = token): Promise<any> {
  const response = await call(path, body, auth);
  const value = await response.json();
  if (response.status !== status) throw new Error(`${path}: expected ${status}, got ${response.status}: ${JSON.stringify(value)}`);
  return value;
}
const mutation = (body: object) => ({ institutionId, operationId: crypto.randomUUID(), ...body });
async function deploy(name: string, args: any[] = []) {
  const artifact = await Bun.file(new URL(`../../sc/out/${name}.sol/${name}.json`, import.meta.url)).json();
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args });
  const receipt = await rpc.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  return { address: receipt.contractAddress! as Hex, abi: artifact.abi };
}
async function transact(contract: Awaited<ReturnType<typeof deploy>>, functionName: string, args: any[]) {
  const hash = await wallet.writeContract({ ...contract, functionName, args });
  expect((await rpc.waitForTransactionReceipt({ hash })).status).toBe("success");
}

beforeAll(async () => {
  // Fail rather than share an existing node or silently substitute for the real prover.
  createZkProofService().assertArtifacts();
  let occupied = false;
  try { await rpc.getChainId(); occupied = true; } catch { /* owned port must be free */ }
  if (occupied) throw new Error("Journey Anvil port 18624 is already occupied");
  node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", "18624", "--silent"], { stdout: "ignore", stderr: "pipe" });
  let ready = false;
  for (let i = 0; i < 50; i++) { try { await rpc.getChainId(); ready = true; break; } catch { await Bun.sleep(100); } }
  if (!ready) throw new Error("Journey Anvil did not start");
  const report = await deploy("ReportEvidenceRegistry", [account.address]);
  await transact(report, "enrollInstitution", [institutionId, account.address]);
  await transact(report, "setSignatory", [institutionId, account.address, true]);
  const nft = await deploy("DistributionCertificateNFT", [report.address]);
  const verifier = await deploy("Groth16Verifier");
  const registry = await deploy("ContributionProofRegistry", [verifier.address, account.address]);
  await transact(registry, "enrollInstitution", [institutionId, account.address]);

  database = await createTestWorkspaceDatabase();
  const db = database.handle();
  const store = createWorkspaceStore(db), disbursement = createDisbursementStore(db);
  const contributions = createContributionStore(db), activities = createActivityStore(db);
  const donorAccess = createDonorAccessStore(db, Buffer.alloc(32, 114));
  const evidence = createEvidenceStore(db), zkBatches = createZkBatchStore(db), zkPublications = createZkPublicationStore(db);
  const certificateStore = createCertificateStore({ execute: q => db.execute(q), transaction: run => db.transaction(tx => run({ execute: q => tx.execute(q) })) });
  for (const source of [store, disbursement, contributions, activities, donorAccess, evidence, zkBatches, zkPublications, certificateStore]) await source.ensureSchema();
  const scratch = new URL("../../.scratch/", import.meta.url).pathname;
  await mkdir(scratch, { recursive: true });
  directory = await mkdtemp(join(scratch, "issue114-journey-"));
  const files = createEncryptedFileStore({ directory, key: Buffer.alloc(32, 114) });
  const mandateChain = createRegistryChain({ rpcUrl, chainId: 31337, address: report.address, requiredConfirmations: 2, privateKey: key });
  configureWorkspace({
    store, disbursement, contributions, activities, donorAccess, evidence, files, zkBatches, zkPublications,
    zkProver: createZkProofService(), zkRegistryAddress: registry.address, zkWalletClient: wallet, zkPublicClient: rpc,
    zkBudget: { id: "journey-local", ...budget, maxAttempts: 20, confirmations: 1 },
    certificateStore, certificateChain: createCertificateChain({ rpcUrl, chainId: 31337, address: nft.address, requiredConfirmations: 2, privateKey: key, budget }, mandateChain),
    donorMessages: { async send(message) { outbox.push(message.body); } },
    ethCall: mandateChain.accountSignatureCall, now: () => now, challengeTtlSeconds: 300, sessionTtlSeconds: 3600,
  });
  for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
  await db.execute(sql`INSERT INTO officer_profiles (id, institution_id, display_name, is_active) VALUES ('off-journey', ${institutionId}, 'Amil Journey', true)`);
  await db.execute(sql`INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active) VALUES (${institutionId}, ${account.address.toLowerCase()}, 'OFFICER', 'off-journey', true)`);
  for (const fn of ["RECORD_CONTRIBUTIONS", "ENDORSE_CONTRIBUTIONS", "ALLOCATE_CONTRIBUTIONS", "RECORD_REALIZATION", "ISSUE_CERTIFICATES"]) {
    await db.execute(sql`INSERT INTO operational_mandates (id, institution_id, officer_id, account_address, function, scope_type, valid_from, valid_until, assignment_ref, version, is_active, created_at, updated_at, created_by)
      VALUES (${`mandate-${fn}`}, ${institutionId}, 'off-journey', ${account.address.toLowerCase()}, ${fn}, 'ALL_PROGRAMS', ${now - 1000}, ${now + 100000}, 'SK-114', 1, true, ${now}, ${now}, 'system')`);
  }
  const lines = [
    { id: "money", beneficiaryId: "ben-private", aidType: "Santunan", period: String(period.year), value: { kind: "MONEY", amountRequestedIdr: "1000000", amountApprovedIdr: "1000000" } },
    { id: "goods", beneficiaryId: "ben-private", aidType: "Beras", period: String(period.year), value: { kind: "GOODS", unit: "kg", quantityRequested: "10", quantityApproved: "10", valuedAmountIdr: null, valuationBasis: null } },
  ];
  await db.execute(sql`INSERT INTO programs (id, institution_id, name, purpose, fund_type, scope, status, created_by, created_at, updated_at)
    VALUES ('prog-journey', ${institutionId}, 'Program campuran', 'Bantuan', 'ZAKAT', 'Nasional', 'ACTIVE', ${account.address.toLowerCase()}, ${now}, ${now})`);
  await db.execute(sql`INSERT INTO proposal_drafts (id, institution_id, program_id, created_by, purpose, beneficiaries_json, aid_lines_json, version, status, created_at, updated_at)
    VALUES (${proposalId}, ${institutionId}, 'prog-journey', ${account.address.toLowerCase()}, 'Bantuan', '[]', ${JSON.stringify(lines)}, 1, 'APPROVED', ${now}, ${now})`);
  await db.execute(sql`INSERT INTO proposal_versions (proposal_id, version, institution_id, status, data_json, created_at)
    VALUES (${proposalId}, 1, ${institutionId}, 'APPROVED', ${JSON.stringify({ programId: "prog-journey", purpose: "Bantuan", aidLines: lines, beneficiaries: [{ id: "ben-private", name: "Penerima Privat", asnaf: "Fakir", identityBasis: { kind: "NIK", value: "3201123456780001" } }] })}, ${now})`);
  await activities.createActivity(institutionId, { id: activityId, proposalId, name: "Kegiatan campuran journey" },
    { id: "op-activity", account: account.address, requestHash: "seed" }, { account: account.address, officerId: "off-journey" }, now);
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 255, fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
    if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    if (path === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
    if (path === "/bootstrap") return Response.json({ workspaceToken: token, activityId, donorSession: { token: donorToken, contributionId: mine, expiresAt: now + 3600 } });
    return app.fetch(req);
  } });
  const challenge = await json("workspace/challenge", { institutionId, account: account.address });
  token = (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await account.signTypedData(challenge.typedData) })).token;
}, 60_000);

afterAll(async () => {
  resetWorkspace();
  server?.stop(true);
  try { await database?.close(); }
  finally {
    if (node && node.exitCode === null) { node.kill(); await node.exited; }
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

it("follows the same mixed, pooled activity through real proof, staged NFT, historic evidence and donor/amil browser", async () => {
  async function contribute(id: string, amountExact: string, donorName: string) {
    await json("workspace/contributions", mutation({ id, sourceChannel: "BANK_TRANSFER", sourceReference: `TRX-${id}`, currencyUnit: "IDR", amountExact, fundType: "ZAKAT", purpose: "Bantuan", receivedAt: now - 100, donorName, donorContact: `${id}@example.org` }));
    await json(`workspace/contributions/${id}/reconcile`, mutation({ expectedVersion: 1, proofRef: `MUTASI-${id}` }), 200);
    const endorsed = await json(`workspace/contributions/${id}/endorse`, mutation({ expectedVersion: 2 }), 200);
    await json(`workspace/contributions/${id}/allocate`, mutation({ activityId, amountExact, expectedVersion: endorsed.contribution.version, reason: "Bantuan pooled" }), 200);
    return endorsed.contribution;
  }
  mine = "contrib-journey-mine";
  const contribution = await contribute(mine, "600000", "Donatur Satu");
  const { challengeId } = await json("donor/otp-challenge", { reference: mine });
  donorToken = (await json("donor/session", { challengeId, otpCode: outbox.at(-1)!.match(/\b(\d{6})\b/)![1] })).sessionToken;
  const donorTrace = async () => (await json(`donor/contributions/${mine}/trace`, undefined, 200, donorToken)).trace;
  const amilTrace = async () => (await json(`workspace/activities/${activityId}/trace`)).trace;
  async function sameSources() {
    const donor = await donorTrace(), amil = await amilTrace();
    for (const track of ["funds", "distribution", "confirmation", "certificates", "summary"]) expect(donor.activities[0].track[track]).toEqual(amil.activity[track]);
    for (const secret of ["Donatur Dua", "contrib-journey-other@example.org", "ben-private", "storageRef", "pathElements"]) expect(JSON.stringify(donor)).not.toContain(secret);
    return { donor, amil };
  }
  const realizations = (await json(`workspace/proposals/${proposalId}/realizations`, mutation({ expectedVersion: 1, items: [
    { aidLineId: "money", beneficiaryId: "ben-private", method: "CASH", amountIdr: "400000", reportedAt: now },
    { aidLineId: "goods", beneficiaryId: "ben-private", method: "GOODS_HANDOVER", quantity: "4", unit: "kg", reportedAt: now },
  ] }))).records;
  expect(realizations).toHaveLength(2);
  const realization = realizations[0];
  const evidenceText = "BAST sintetis journey #114 — penerimaan uang 400000";
  const uploaded = await json(`workspace/proposals/${proposalId}/realizations/${realization.id}/documents`, mutation({
    documentType: "RECEIPT_OR_BAST", fileName: "bast-114.txt", mimeType: "text/plain", contentBase64: Buffer.from(evidenceText).toString("base64"),
    allocations: [{ realizationId: realization.id, amountIdr: "400000" }],
  }));
  expect(uploaded.realizations[0].evidenceStatus).toBe("EVIDENCE_COMPLETE");
  const documentPath = `workspace/proposals/${proposalId}/realization-documents/${uploaded.document.id}`;
  const evidenceResponse = await call(documentPath);
  expect(evidenceResponse.status).toBe(200);
  expect(await evidenceResponse.text()).toBe(evidenceText);
  expect((await call(documentPath, undefined, donorToken)).status).toBe(401);

  const cutOff = new Date(now * 1000).toISOString();
  const preparation = (await json("evidence", {
    label: "Paket historis journey", period, currencyUnit: "IDR", balanceSheetScope: "ON",
    claim: { manifest: { label: "Buku besar", origin: "PASTE", scopeUnit: "NASIONAL", scopeLevel: "PUSAT", fundTypes: ["ZAKAT"], balanceSheet: "ON", currencyUnit: "IDR", period, cutOff, format: "baris-ledger", mappingVersion: "1", transactionDetail: "PRESENT" }, status: "READ", rows: [{ key: "claim", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "400000", unit: "IDR" } }] },
    source: { internal: { stream: DISBURSEMENT_REALIZATION_STREAM, cutOff } },
  })).preparation;
  await contribute("contrib-journey-other", "400000", "Donatur Dua");
  const { donor, amil } = await sameSources();
  expect(donor.activities[0]).toMatchObject({ allocatedAmountExact: "600000", pooledAllocationCount: 2 });
  expect(amil.activity.funds.data.totalAllocatedAmount).toBe("1000000");
  expect(amil.activity.summary.data.headline).toBe("IN_PROGRESS");
  expect(amil.activity.funds.data.totalRealizedMoneyIdr).toBe("400000");
  expect(amil.activity.distribution.data.unitSummaries).toEqual(expect.arrayContaining([
    expect.objectContaining({ unit: "kg", realized: "4", remaining: "6" }),
  ]));
  expect(amil.reportSources.data).toHaveLength(1);
  expect(amil.reportSources.data[0]).toMatchObject({ preparationId: preparation.id, commitment: preparation.commitment, currentness: "HISTORICAL_SNAPSHOT", frozen: { allocatedByUnit: { IDR: "600000" }, realizationCount: 2 }, differsFromCurrent: ["ALLOCATED_TOTAL"] });
  expect((await call(`donor/contributions/contrib-journey-other/trace`, undefined, donorToken)).status).toBe(403);
  expect((await call(`donor/contributions/${mine}/trace`, undefined, "")).status).toBe(401);

  const batch = (await json("workspace/contribution-batches", { institutionId, contributionIds: [mine, "contrib-journey-other"], fundType: "ZAKAT", currencyUnit: "IDR" })).batch;
  await json(`workspace/contribution-batches/${batch.id}/endorse`, { institutionId, snapshotRoot: batch.merkleRoot }, 200);
  const proof = (await json(`workspace/contribution-batches/${batch.id}/proofs/${mine}/process`, { institutionId })).proofRecord;
  expect(proof.status).toBe("VERIFIED");
  expect((await rpc.getTransactionReceipt({ hash: proof.txHash })).status).toBe("success");
  const publicProof = (await json(`public/receipt-verification/${mine}`, undefined, 200, "")).verification;
  expect(publicProof).toMatchObject({ onChainConfirmed: true, mathematicalValidity: "VALID", businessValidity: "CURRENT" });
  for (const secret of ["Donatur Satu", '"amountExact"', '"amountIdr"', '"salt"', '"pathElements"']) expect(JSON.stringify(publicProof)).not.toContain(secret);

  const prepared = (await json(`${certBase}/prepare`, { institutionId })).certificate;
  expect(prepared.observation.state).toBe("PREPARED");
  const pending = await sameSources();
  expect(pending.amil.activity.certificates.data).toMatchObject({ pendingCount: 1, lines: [{ certificateId, issuance: { state: "PREPARED" }, published: null }] });
  // Match the existing suite's optional browser dependency; real engines always execute.
  let browser: any;
  try {
    let page: any, donorPanel: any;
    const errors: string[] = [];
    if (process.env.REGISTRY_BROWSER_MODULE) {
      const build = Bun.spawn(["bun", "build", new URL("../../frontend/test/activity-trace-smoke.tsx", import.meta.url).pathname, "--target", "browser"], { stdout: "pipe", stderr: "pipe" });
      bundle = await new Response(build.stdout).text();
      if (await build.exited) throw new Error(await new Response(build.stderr).text());
      const style = Bun.spawn(["bun", new URL("../../frontend/test/build-smoke-css.ts", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
      css = await new Response(style.stdout).text();
      if (await style.exited) throw new Error(await new Response(style.stderr).text());
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE);
      browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.setDefaultTimeout(15_000);
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.goto(String(server!.url));
      donorPanel = page.getByTestId("donor");
      await donorPanel.getByText("Bagian Anda", { exact: false }).waitFor();
      await page.getByTestId("amil").getByRole("heading", { name: "Status kegiatan terkini" }).waitFor();
      await donorPanel.getByText(/Publikasi NFT.*tertunda|NFT.*belum terbit|Publikasi.*belum/).first().waitFor();
    }

    await json(`${certBase}/submit`, { institutionId, signature: await account.signTypedData(certificationTypedData(prepared.domain, prepared.certification)) }, 200);
    await rpc.request({ method: "evm_mine" as any });
    expect((await json(certBase)).certificate.observation.state).toBe("CONFIRMED");
    const publicNft = (await json(`public/certificates/${institutionId}/${certificateId}`, undefined, 200, "")).certificate;
    expect(publicNft).toMatchObject({ validity: "CURRENT", version: "1", totals: { totalRealizedIdr: "400000" } });
    expect(publicNft.issuer.toLowerCase()).toBe(account.address.toLowerCase());
    expect(publicNft.contentDigest).toMatch(/^0x[0-9a-f]{64}$/);
    const published = (await sameSources()).donor.activities[0].track.certificates.data.lines[0].published;
    expect(published).toMatchObject({ issuer: publicNft.issuer, contentDigest: publicNft.contentDigest, version: "1", validity: "CURRENT" });
    const verifierLink = new URL(published.verifierPath, server!.url);
    expect(verifierLink.pathname).toBe("/sertifikat");
    expect(verifierLink.searchParams.get("institutionId")).toBe(institutionId);
    expect(verifierLink.searchParams.get("certificateId")).toBe(certificateId);
    expect(verifierLink.searchParams.get("version")).toBe("1");

    await json(`workspace/proposals/${proposalId}/realizations/${realization.id}/disputes`, mutation({ complainantType: "BENEFICIARY", subject: "AMOUNT", reason: "Jumlah diterima berbeda", disputedAmountIdr: "100000" }));
    const disputed = (await json(`public/certificates/${institutionId}/${certificateId}`, undefined, 200, "")).certificate;
    expect(disputed.validity).toBe("DISPUTED");
    expect(disputed.contentDigest).toBe(publicNft.contentDigest);
    const replacement = (await json(`${certBase}/correct`, { institutionId, expectedPredecessorVersion: "1", reason: "DISPUTE_DISCLOSURE", note: "Sengketa jumlah diterima" })).certificate;
    await json(`workspace/activities/${activityId}/certificates/${replacement.id}/submit`, { institutionId, signature: await account.signTypedData(certificationTypedData(replacement.domain, replacement.certification)) }, 200);
    await rpc.request({ method: "evm_mine" as any });
    expect((await json(`workspace/activities/${activityId}/certificates/${replacement.id}`)).certificate.observation.state).toBe("CONFIRMED");
    const old = (await json(`public/certificates/${institutionId}/${certificateId}/versions/1`, undefined, 200, "")).certificate;
    expect(old.validity).toBe("SUPERSEDED");
    expect(old.contentDigest).toBe(publicNft.contentDigest);

    await json(`workspace/contributions/${mine}/correct`, mutation({ expectedVersion: contribution.version, correctionType: "AMOUNT", amountExact: "500000", reason: "Koreksi nominal sumber", sourceProofRef: "MUTASI-CORRECTED" }), 200);
    const historical = (await json(`public/receipt-verification/${mine}`, undefined, 200, "")).verification;
    expect(historical.mathematicalValidity).toBe("VALID");
    expect(historical.businessValidity).toBe("SUPERSEDED");
    const final = await sameSources();
    expect(final.donor.activities[0].allocationBasis).toBe("BEFORE_CORRECTION");
    expect(final.amil.activity.confirmation.data.disputed).toBe(1);
    expect(final.amil.reportSources.data[0].commitment).toBe(preparation.commitment);
    if (page) {
      const reload = donorPanel.getByRole("button", { name: "Muat ulang penelusuran" });
      await reload.focus(); await page.keyboard.press("Enter");
      await donorPanel.getByText("Ada sengketa penyerahan").waitFor();
      const amilPanel = page.getByTestId("amil");
      await amilPanel.getByRole("button", { name: "Muat ulang penelusuran" }).focus();
      await page.keyboard.press("Enter");
      await amilPanel.getByText("Ada sengketa penyerahan").waitFor();
      const latest = final.donor.activities[0].track.certificates.data.lines[0].published;
      for (const panel of [donorPanel, amilPanel]) {
        await panel.getByText(latest.issuer, { exact: true }).waitFor();
        await panel.getByText(latest.contentDigest, { exact: true }).waitFor();
        expect(await panel.getByRole("link", { name: "Periksa sertifikat versi 2" }).getAttribute("href")).toBe(latest.verifierPath);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect(await page.content()).not.toContain("Donatur Dua");
      expect(errors).toEqual([]);
    }
    console.log(`#114 real journey: 2 contributions, 2 mixed partial realizations, encrypted BAST + frozen provenance, 1 real Groth16 proof, 2 local NFT versions, donor/amil HTTP; browser ${page ? "390px + keyboard verified" : "NOT RUN (set REGISTRY_BROWSER_MODULE)"}`);
  } finally { await browser?.close(); }
}, 180_000);
