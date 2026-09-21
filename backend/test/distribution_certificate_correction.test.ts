/**
 * Correction and dispute of issued distribution certificates over authenticated HTTP, real
 * signatures, SQL and a local EVM (Spec #100, Issue #112).
 *
 * Upstream disbursement state (program, approved proposal, activity, realization) is seeded
 * directly through the real stores rather than the full proposal examination/decision HTTP
 * pipeline, which is already covered by other suites; this suite's own HTTP surface is the
 * certificate routes themselves.
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { createPublicClient, createWalletClient, http, keccak256, hashTypedData, toHex, type Hex } from "viem";
import { certificateCommitment } from "../src/certificate-content";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createContributionStore } from "../src/contribution-store";
import { createActivityStore } from "../src/activity-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { createRegistryChain } from "../src/registry-chain";
import { createCertificateStore } from "../src/certificate-store";
import { createCertificateChain } from "../src/certificate-chain";
import { reportRegistryAbi } from "../../shared/report-registry-abi";
import { certificateNftAbi } from "../../shared/certificate-nft-abi";
import { certificationTypedData } from "../../shared/certificate-nft";

const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const institution = "lpz-sinar-amanah";
const officerId = "off-cert-officer";
const readerAccount = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
let readerToken: string;
const rpcUrl = "http://127.0.0.1:18612";
const rpc = createPublicClient({ chain: foundry, pollingInterval: 25, transport: http(rpcUrl, { retryCount: 0, timeout: 500 }) });
const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });

let node: ReturnType<typeof Bun.spawn>;
let database: TestWorkspaceDatabase;
let registryAddress: Hex;
let certificateAddress: Hex;
let token: string;
let rejectBroadcast = false;
let mutateRpc: ((method: string, response: any) => any) | null = null;
let proxy: ReturnType<typeof Bun.serve>;
let sequence = 0;

const request = (path: string, body?: unknown, auth = token) => app.fetch(new Request(`http://localhost/api/${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
async function json(path: string, body?: unknown, status = body === undefined ? 200 : 201) {
  const response = await request(path, body);
  const result = await response.json();
  expect({ status: response.status, error: result.error }).toEqual({ status, error: undefined });
  return result;
}

const serviceBudget = { maxWei: "1000000000000000000", gasLimit: "1500000", maxFeePerGas: "2000000000" };
function configure(budget = serviceBudget) {
  const handle = database.handle();
  const store = createWorkspaceStore(handle);
  const disbursement = createDisbursementStore(handle);
  const contributions = createContributionStore(handle);
  const activities = createActivityStore(handle);
  const mandateChain = createRegistryChain({ rpcUrl: String(proxy.url), chainId: 31337, address: registryAddress, requiredConfirmations: 2, privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" });
  const certificateStore = createCertificateStore({ execute: (q) => handle.execute(q), transaction: (run) => handle.transaction((tx) => run({ execute: (q) => tx.execute(q) })) });
  const certificateChain = createCertificateChain({ rpcUrl: String(proxy.url), chainId: 31337, address: certificateAddress, requiredConfirmations: 2, privateKey: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", budget }, mandateChain);
  configureWorkspace({
    store, disbursement, contributions, activities,
    certificateStore, certificateChain,
    files: undefined as any, ethCall: mandateChain.accountSignatureCall,
    now: () => Math.floor(Date.now() / 1000), challengeTtlSeconds: 300, sessionTtlSeconds: 3600,
  });
  return { store, disbursement, activities, contributions };
}

/** A fresh approved proposal, activity and one evidence-complete realization, seeded directly
 * through the real stores. Returns identities the certificate routes then operate on. */
async function seedCertifiableActivity(stores: ReturnType<typeof configure>, includeUnevidenced = false) {
  sequence += 1;
  const proposalId = `prop-cert-${sequence}`;
  const activityId = `act-cert-${sequence}`;
  const beneficiaryId = `ben-cert-${sequence}`;
  const aidLineId = `aid-cert-${sequence}`;
  const now = Math.floor(Date.now() / 1000);
  const handle = database.handle();
  const programId = `prog-cert-${sequence}`;
  await handle.execute(sql`INSERT INTO programs (id, institution_id, name, purpose, fund_type, scope, status, created_by, created_at, updated_at)
    VALUES (${programId}, ${institution}, 'Program Sertifikat', 'Bantuan', 'ZAKAT', 'Tahun 2026', 'ACTIVE', ${account.address.toLowerCase()}, ${now}, ${now})`);
  const aidLines = [{ id: aidLineId, beneficiaryId, aidType: "Bantuan tunai", period: "2026-03",
    value: { kind: "MONEY", amountRequestedIdr: "1000000", amountApprovedIdr: "1000000" } }];
  await handle.execute(sql`INSERT INTO proposal_drafts (id, institution_id, program_id, created_by, purpose, beneficiaries_json, aid_lines_json, version, status, created_at, updated_at)
    VALUES (${proposalId}, ${institution}, ${programId}, ${account.address.toLowerCase()}, 'Penyaluran sertifikat', '[]', ${JSON.stringify(aidLines)}, 1, 'APPROVED', ${now}, ${now})`);

  await stores.activities.createActivity(institution, { id: activityId, proposalId, name: "Kegiatan Sertifikat" },
    { id: `op-activity-${sequence}`, account: account.address, requestHash: "seed" }, { account: account.address, officerId }, now);

  const { records } = await stores.disbursement.recordRealizations(institution, proposalId,
    { items: [{ aidLineId, beneficiaryId, paymentRecipient: null, method: "BANK_TRANSFER", amountIdr: includeUnevidenced ? "400000" : "1000000", reportedAt: now, notes: null }], batchGroupId: null, expectedVersion: 1 },
    { id: `op-realization-${sequence}`, account: account.address, requestHash: "seed" }, { account: account.address, officerId }, now);
  await handle.execute(sql`UPDATE disbursement_realizations SET evidence_status = 'EVIDENCE_COMPLETE' WHERE id = ${records[0]!.id}`);

  if (includeUnevidenced) {
    await stores.disbursement.recordRealizations(institution, proposalId,
      { items: [{ aidLineId, beneficiaryId, paymentRecipient: null, method: "BANK_TRANSFER", amountIdr: "600000", reportedAt: now, notes: null }], batchGroupId: null, expectedVersion: 1 },
      { id: `op-unevidenced-${sequence}`, account: account.address, requestHash: "seed" }, { account: account.address, officerId }, now);
  }
  return { activityId, certificateId: `cert-${sequence}`, proposalId, realizationId: records[0]!.id, stores };
}

beforeAll(async () => {
  let occupied = false;
  try { await rpc.getChainId(); occupied = true; } catch { /* The isolated fixture must own this port. */ }
  if (occupied) throw new Error("Port 18612 sudah digunakan; hentikan fixture Anvil lama sebelum menjalankan suite.");
  node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", "18612", "--silent"], { stdout: "ignore", stderr: "pipe" });
  const cleanup = () => { if (node && node.exitCode === null) node.kill(); };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { await rpc.getChainId(); ready = true; break; } catch { await Bun.sleep(100); }
  }
  if (!ready) throw new Error("Local Anvil did not start");

  const registryArtifact = await Bun.file(new URL("../../sc/out/ReportEvidenceRegistry.sol/ReportEvidenceRegistry.json", import.meta.url)).json();
  const registryDeployment = await wallet.deployContract({ abi: reportRegistryAbi, bytecode: registryArtifact.bytecode.object, args: [account.address] });
  registryAddress = (await rpc.waitForTransactionReceipt({ hash: registryDeployment })).contractAddress!;
  for (const args of [
    { functionName: "enrollInstitution", args: [institution, account.address] },
    { functionName: "setSignatory", args: [institution, account.address, true] },
  ] as const) await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registryAddress, abi: reportRegistryAbi, ...args } as any) });

  const certificateArtifact = await Bun.file(new URL("../../sc/out/DistributionCertificateNFT.sol/DistributionCertificateNFT.json", import.meta.url)).json();
  const certificateDeployment = await wallet.deployContract({ abi: certificateNftAbi, bytecode: certificateArtifact.bytecode.object, args: [registryAddress] });
  certificateAddress = (await rpc.waitForTransactionReceipt({ hash: certificateDeployment })).contractAddress!;

  proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const body = await req.json();
    if (rejectBroadcast && body.method === "eth_sendRawTransaction") return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "transport refused before broadcast" } });
    const result = await (await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    return Response.json(mutateRpc ? await mutateRpc(body.method, result) : result);
  } });

  database = await createTestWorkspaceDatabase();
  const stores = configure();
  await stores.store.ensureSchema();
  await stores.disbursement.ensureSchema();
  await stores.contributions.ensureSchema();
  await stores.activities.ensureSchema();
  const certStore = createCertificateStore({ execute: (q) => database.handle().execute(q), transaction: (run) => database.handle().transaction((tx) => run({ execute: (q) => tx.execute(q) })) });
  await certStore.ensureSchema();

  for (const inst of SYNTHETIC_INSTITUTIONS) await stores.store.upsertInstitution(institutionRecordOf(inst));
  const handle = database.handle();
  const now = Math.floor(Date.now() / 1000);
  await handle.execute(sql`INSERT INTO officer_profiles (id, institution_id, display_name, is_active) VALUES (${officerId}, ${institution}, 'Petugas Sertifikat', true)`);
  await handle.execute(sql`INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active) VALUES (${institution}, ${account.address.toLowerCase()}, 'OFFICER', ${officerId}, true)`);
  await handle.execute(sql`INSERT INTO operational_mandates (id, institution_id, officer_id, account_address, function, scope_type, program_id, valid_from, valid_until, assignment_ref, nominal_limit, version, is_active, created_at, updated_at, created_by)
    VALUES ('mandate-issue-cert', ${institution}, ${officerId}, ${account.address.toLowerCase()}, 'ISSUE_CERTIFICATES', 'ALL_PROGRAMS', NULL, ${now - 1000}, ${now + 100000}, 'SK-cert-1', NULL, 1, true, ${now}, ${now}, 'system')`);

  for (const other of ["off-other", "off-examiner"]) {
    await handle.execute(sql`INSERT INTO officer_profiles (id, institution_id, display_name, is_active) VALUES (${other}, ${institution}, ${other}, true)`);
  }
  await handle.execute(sql`INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active) VALUES (${institution}, ${readerAccount.address.toLowerCase()}, 'READER', NULL, true)`);
  const readerChallenge = await json("workspace/challenge", { institutionId: institution, account: readerAccount.address });
  readerToken = (await json("workspace/session", { nonce: readerChallenge.challenge.nonce, signature: await readerAccount.signTypedData(readerChallenge.typedData) })).token;

  const challenge = await json("workspace/challenge", { institutionId: institution, account: account.address });
  token = (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await account.signTypedData(challenge.typedData) })).token;
}, 30000);

afterAll(async () => {
  resetWorkspace();
  await proxy?.stop(true);
  try { if (database) await database.close(); }
  finally { if (node && node.exitCode === null) { node.kill(); await node.exited; } }
});

const mine = () => rpc.request({ method: "evm_mine" as any });
const baseOf = (seed: { activityId: string }, id: string) => `workspace/activities/${seed.activityId}/certificates/${id}`;
const sign = (prepared: any) => account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));
const publicOf = async (certificateId: string, version?: string) => {
  const response = await request(`public/certificates/${institution}/${certificateId}${version ? `/versions/${version}` : ""}`, undefined, "");
  return { status: response.status, body: await response.json() };
};
let opSequence = 0;
const operation = () => ({ id: `op-correction-${++opSequence}`, account: account.address, requestHash: `h-${opSequence}` });

/** Issue version 1 through HTTP and confirm it on the local chain. */
async function issueFirst() {
  const seed = await seedCertifiableActivity(configure());
  const base = baseOf(seed, seed.certificateId);
  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  await json(`${base}/submit`, { institutionId: institution, signature: await sign(prepared) }, 200);
  await mine();
  expect((await json(base)).certificate.observation.state).toBe("CONFIRMED");
  return { ...seed, base, first: prepared };
}
async function dispute(seed: Awaited<ReturnType<typeof issueFirst>>) {
  return (await seed.stores.disbursement.recordDispute(institution, seed.proposalId, seed.realizationId,
    { complainantType: "BENEFICIARY", subject: "AMOUNT", reason: "Jumlah diterima berbeda", disputedAmountIdr: "100000" },
    { officerId: "off-other" }, Math.floor(Date.now() / 1000), operation())).dispute;
}
async function resolve(seed: Awaited<ReturnType<typeof issueFirst>>, disputeId: string) {
  await seed.stores.disbursement.examineDispute(institution, seed.proposalId, seed.realizationId, disputeId,
    { outcome: "RESOLVED", notes: "Selisih dijelaskan" }, { account: account.address, officerId: "off-examiner" }, Math.floor(Date.now() / 1000), operation());
}
async function correct(seed: { activityId: string; certificateId: string }, reason: string, note = "Koreksi sesuai sumber", status = 201) {
  return json(`${baseOf(seed, seed.certificateId)}/correct`, { institutionId: institution, reason, note }, status);
}
async function endorse(seed: { activityId: string }, prepared: any) {
  return json(`${baseOf(seed, prepared.id)}/submit`, { institutionId: institution, signature: await sign(prepared) }, 200);
}

it("shows a dispute raised after mint on the covered scope, but never a missing document alone", async () => {
  const seed = await issueFirst();
  const original = await publicOf(seed.certificateId);
  expect(original.body.certificate).toMatchObject({ version: "1", validity: "CURRENT", scope: { sourceStatus: "MATCHES", disputedCount: 0, changedCount: 0 }, replacement: { state: "NONE" } });

  // Incomplete evidence is not a dispute and does not by itself change what the certificate claims.
  await database.handle().execute(sql`UPDATE disbursement_realizations SET evidence_status='EVIDENCE_PENDING' WHERE id=${seed.realizationId}`);
  expect((await publicOf(seed.certificateId)).body.certificate.validity).toBe("CURRENT");
  await database.handle().execute(sql`UPDATE disbursement_realizations SET evidence_status='EVIDENCE_COMPLETE' WHERE id=${seed.realizationId}`);

  const raised = await dispute(seed);
  const disputed = (await publicOf(seed.certificateId)).body.certificate;
  expect(disputed).toMatchObject({ validity: "DISPUTED", scope: { sourceStatus: "DISPUTED", disputedCount: 1 } });
  // The token, its frozen totals and its content binding are exactly what was minted.
  expect(disputed.totals).toEqual(original.body.certificate.totals);
  expect(disputed.contentDigest).toBe(original.body.certificate.contentDigest);
  expect(disputed.tokenId).toBe(original.body.certificate.tokenId);
  expect(JSON.stringify(disputed)).not.toContain(seed.realizationId);

  await resolve(seed, raised.id);
  expect((await publicOf(seed.certificateId)).body.certificate).toMatchObject({ validity: "CURRENT", scope: { sourceStatus: "MATCHES" } });
});

it("refuses a correction without a supported reason, a note, or any change in the source", async () => {
  const seed = await issueFirst();
  const path = `${baseOf(seed, seed.certificateId)}/correct`;
  expect((await request(path, { institutionId: institution, reason: "BECAUSE", note: "x" })).status).toBe(400);
  expect((await request(path, { institutionId: institution, reason: "SOURCE_CORRECTION", note: "  " })).status).toBe(400);
  const unchanged = await request(path, { institutionId: institution, reason: "SOURCE_CORRECTION", note: "tanpa perubahan" });
  expect(unchanged.status).toBe(409);
  expect((await unchanged.json()).error).toMatch(/tidak berbeda/);
  expect(await database.handle().execute(sql`SELECT 1 FROM certificate_intents WHERE certificate_id=${seed.certificateId}`).then((r: any) => (r.rows ?? r).length)).toBe(1);
  // A dispute must exist to be disclosed.
  await database.handle().execute(sql`UPDATE disbursement_realizations SET amount_idr='900000', version=version+1 WHERE id=${seed.realizationId}`);
  const noDispute = await request(path, { institutionId: institution, reason: "DISPUTE_DISCLOSURE", note: "tidak ada sengketa" });
  expect(noDispute.status).toBe(409);
  expect((await noDispute.json()).error).toMatch(/sengketa/i);
});

it("issues a linked replacement NFT, keeps the old token readable and never lets the predecessor read as current meanwhile", async () => {
  const seed = await issueFirst();
  const v1 = await publicOf(seed.certificateId);
  const token1 = v1.body.certificate.tokenId as string;
  const token2 = (BigInt(token1) + 1n).toString();
  const raised = await dispute(seed);

  const draft = await correct(seed, "DISPUTE_DISCLOSURE", "Sengketa jumlah diterima");
  const prepared = draft.certificate;
  expect(prepared).toMatchObject({ id: `${seed.certificateId}@2`, certification: { version: "2", predecessor: "1", certificateId: seed.certificateId } });
  expect(draft.contentTotals).toEqual({ confirmedCount: 0, disputedCount: 1, unconfirmedCount: 0, totalRealizedIdr: "1000000" });
  expect(draft.line).toMatchObject({ headVersion: "1", correctionAllowed: true, scope: { sourceStatus: "DISPUTED" } });
  // Idempotent while fresh: the same reason and note return the same preparation.
  expect((await correct(seed, "DISPUTE_DISCLOSURE", "Sengketa jumlah diterima")).certificate.id).toBe(prepared.id);
  // An unsigned draft is not public and does not yet move the official line.
  expect((await publicOf(seed.certificateId)).body.certificate).toMatchObject({ version: "1", validity: "DISPUTED", replacement: { state: "NONE" } });
  expect(JSON.stringify((await publicOf(seed.certificateId)).body)).not.toContain("Sengketa jumlah diterima");

  const submitted = (await endorse(seed, prepared)).certificate;
  expect(submitted.observation.state).toBe("SUBMITTED");
  // Endorsed and mined once, but below the confirmation depth: neither version is "current".
  const pending = (await publicOf(seed.certificateId)).body.certificate;
  expect(pending).toMatchObject({ version: "2", observation: { state: "INCLUDED" }, predecessor: { version: "1", tokenId: token1 }, correction: { reason: "DISPUTE_DISCLOSURE" } });
  expect(pending.validity).not.toBe("CURRENT");
  expect(pending.history.map((h: any) => [h.version, h.validity, h.replacement])).toEqual([
    ["1", "REPLACEMENT_PENDING", "INCLUDED_PENDING_CONFIRMATION"], ["2", "DISPUTED", "NONE"],
  ]);
  expect((await publicOf(seed.certificateId, "1")).body.certificate.validity).toBe("REPLACEMENT_PENDING");

  await mine();
  const replaced = (await publicOf(seed.certificateId)).body.certificate;
  expect(replaced).toMatchObject({ version: "2", tokenId: token2, validity: "DISPUTED", scope: { sourceStatus: "DISPUTED", disputedCount: 1 }, totals: { disputedCount: 1 } });
  // The historical version: same token, content commitment and totals; marked superseded, not erased.
  const old = (await publicOf(seed.certificateId, "1")).body.certificate;
  expect(old).toMatchObject({ version: "1", tokenId: token1, validity: "SUPERSEDED", replacement: { state: "CONFIRMED", version: "2", tokenId: token2 } });
  expect(old.contentDigest).toBe(v1.body.certificate.contentDigest);
  expect(old.totals).toEqual(v1.body.certificate.totals);
  expect(old.issuer).toBe(v1.body.certificate.issuer);
  expect(await rpc.readContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "successorOf", args: [BigInt(token1)] })).toBe(BigInt(token2));
  expect(await rpc.readContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "predecessorOf", args: [BigInt(token2)] })).toBe(BigInt(token1));

  // Resolving the dispute is a further source change; the disclosed version is corrected in turn.
  await resolve(seed, raised.id);
  expect((await publicOf(seed.certificateId)).body.certificate.validity).toBe("SOURCE_CHANGED");
  const third = (await correct(seed, "SOURCE_CORRECTION", "Sengketa selesai")).certificate;
  expect(third.certification).toMatchObject({ version: "3", predecessor: "2" });
  await endorse(seed, third); await mine(); await mine();
  const final = (await publicOf(seed.certificateId)).body.certificate;
  expect(final).toMatchObject({ version: "3", validity: "CURRENT", totals: { disputedCount: 0, unconfirmedCount: 1 } });
  expect(final.history.map((h: any) => [h.version, h.validity])).toEqual([["1", "SUPERSEDED"], ["2", "SUPERSEDED"], ["3", "CURRENT"]]);
  // Restart: everything is re-derived from SQL and the chain.
  await database.reopen(); configure();
  expect((await publicOf(seed.certificateId)).body.certificate.history).toEqual(final.history);
  expect((await publicOf(seed.certificateId, "1")).body.certificate.totals).toEqual(v1.body.certificate.totals);
});

it("lets only one of two competing corrections win the same official line", async () => {
  const seed = await issueFirst();
  await dispute(seed);
  const a = (await correct(seed, "DISPUTE_DISCLOSURE", "Koreksi A")).certificate;
  const b = (await correct(seed, "SOURCE_CORRECTION", "Koreksi B")).certificate;
  expect([a.certification.version, b.certification.version]).toEqual(["2", "3"]);
  expect([a.certification.predecessor, b.certification.predecessor]).toEqual(["1", "1"]);
  const attemptsBefore = await database.rowCount("certificate_attempts");
  const signatures = [await sign(a), await sign(b)];
  const responses = await Promise.all([a, b].map((p, i) => request(`${baseOf(seed, p.id)}/submit`, { institutionId: institution, signature: signatures[i] })));
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await database.rowCount("certificate_attempts")).toBe(attemptsBefore + 1);
  const winner = responses.findIndex((r) => r.status === 200);
  const loser = [a, b][1 - winner]!;
  await mine();
  expect((await publicOf(seed.certificateId)).body.certificate.version).toBe([a, b][winner]!.certification.version);
  // The loser cannot be forced through later either, by API or by the contract itself.
  expect((await request(`${baseOf(seed, loser.id)}/submit`, { institutionId: institution, signature: signatures[1 - winner] })).status).toBe(409);
  await expect(rpc.simulateContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "issueCertificate", account,
    args: [{ ...loser.certification, authorityEpoch: BigInt(loser.certification.authorityEpoch), deadline: BigInt(loser.certification.deadline) }, signatures[1 - winner]] })).rejects.toThrow(/WrongPredecessor/);
  const history = (await publicOf(seed.certificateId)).body.certificate.history;
  expect(history.filter((h: any) => h.validity !== "SUPERSEDED")).toHaveLength(1);
});

it("does not trust a chain successor that this institution's records cannot vouch for", async () => {
  const seed = await issueFirst();
  await dispute(seed);
  const prepared = (await correct(seed, "DISPUTE_DISCLOSURE", "Koreksi resmi")).certificate;
  // A valid signatory bypasses the service and mints its own successor directly on the contract.
  const rogue = { ...prepared.certification, version: "rogue", digest: keccak256(toHex("other content")), nonce: keccak256(toHex("rogue nonce")) };
  const rogueSignature = await account.signTypedData(certificationTypedData(prepared.domain, rogue));
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "issueCertificate",
    args: [{ ...rogue, authorityEpoch: BigInt(rogue.authorityEpoch), deadline: BigInt(rogue.deadline) }, rogueSignature] }) });
  await mine();

  const old = (await publicOf(seed.certificateId, "1")).body.certificate;
  expect(old.validity).toBe("REPLACEMENT_PENDING");
  expect(old.replacement.state).toBe("UNVERIFIED_CHAIN_SUCCESSOR");
  // The official head is a version this institution never prepared: verification is withheld, not guessed.
  const head = await publicOf(seed.certificateId);
  expect(head.status).toBe(503);
  expect(head.body.certificate).toBeUndefined();
  // The service's own correction can no longer be submitted against the moved line.
  expect((await request(`${baseOf(seed, prepared.id)}/submit`, { institutionId: institution, signature: await sign(prepared) })).status).toBe(409);
  expect((await request(`${baseOf(seed, seed.certificateId)}/correct`, { institutionId: institution, reason: "DISPUTE_DISCLOSURE", note: "lagi" })).status).toBe(409);
});

it("keeps the predecessor non-current while a successor is pending, reorged or failed", async () => {
  const seed = await issueFirst();
  await dispute(seed);
  const prepared = (await correct(seed, "DISPUTE_DISCLOSURE", "Koreksi dengan reorg")).certificate;
  const snapshot = await rpc.request({ method: "evm_snapshot" as any });
  await endorse(seed, prepared);
  expect((await publicOf(seed.certificateId, "1")).body.certificate.replacement.state).toBe("INCLUDED_PENDING_CONFIRMATION");

  await rpc.request({ method: "evm_revert" as any, params: [snapshot] as any });
  // The successor block is gone: v1 is again the chain head but must not become current again.
  const reorged = (await publicOf(seed.certificateId)).body.certificate;
  expect(reorged).toMatchObject({ version: "1", validity: "REPLACEMENT_PENDING", replacement: { state: "NONCANONICAL_PENDING" } });
  expect(reorged.scope.sourceStatus).toBe("DISPUTED");
  // Same signed bytes go out again and settle the line.
  await json(`${baseOf(seed, prepared.id)}/retry`, { institutionId: institution }, 200);
  await mine();
  expect((await publicOf(seed.certificateId, "1")).body.certificate.validity).toBe("SUPERSEDED");

  // A publication failure is a failure of the successor, never a restoration of the predecessor.
  const failing = await issueFirst();
  await dispute(failing);
  const next = (await correct(failing, "DISPUTE_DISCLOSURE", "Koreksi gagal")).certificate;
  await endorse(failing, next);
  mutateRpc = (method, body) => { if (method === "eth_getTransactionReceipt" && body.result) body.result.status = "0x0"; return body; };
  try {
    const old = (await publicOf(failing.certificateId, "1")).body.certificate;
    expect(old).toMatchObject({ validity: "REPLACEMENT_FAILED", replacement: { state: "FAILED" } });
    expect(old.validity).not.toBe("CURRENT");
    const line = (await json(`${baseOf(failing, failing.certificateId)}/history`)).line;
    expect(line.versions.find((v: any) => v.version === "2")).toMatchObject({ replacement: "NONE", observationState: "REVERTED", endorsed: true });
  } finally { mutateRpc = null; }
});

it("lets a reader follow the history but not correct on behalf of the institution", async () => {
  const seed = await issueFirst();
  await dispute(seed);
  const intentsBefore = await database.rowCount("certificate_intents");
  const path = `${baseOf(seed, seed.certificateId)}/history`;
  const read = await request(path, undefined, readerToken);
  expect(read.status).toBe(200);
  const line = (await read.json()).line;
  expect(line).toMatchObject({ certificateId: seed.certificateId, headVersion: "1", scope: { sourceStatus: "DISPUTED" } });
  expect(line.versions).toHaveLength(1);
  for (const suffix of ["correct", "prepare", "submit", "retry"]) {
    const denied = await request(`${baseOf(seed, seed.certificateId)}/${suffix}`, { institutionId: institution, reason: "DISPUTE_DISCLOSURE", note: "x", signature: "0x00" }, readerToken);
    expect(denied.status).toBe(403);
  }
  expect(await database.rowCount("certificate_intents")).toBe(intentsBefore);
  expect((await publicOf(seed.certificateId)).body.certificate.validity).toBe("DISPUTED");
});

it("does not let a proposal revision or a remainder closure overwrite realizations or issue a certificate", async () => {
  const seed = await issueFirst();
  const intentsBefore = await database.rowCount("certificate_intents");
  const attemptsBefore = await database.rowCount("certificate_attempts");
  await database.handle().execute(sql`UPDATE proposal_drafts SET version = version + 1 WHERE id=${seed.proposalId}`);
  const summary = (await publicOf(seed.certificateId)).body.certificate;
  expect(summary).toMatchObject({ validity: "CURRENT", scope: { sourceStatus: "MATCHES" }, totals: { totalRealizedIdr: "1000000" } });
  expect(await database.rowCount("certificate_intents")).toBe(intentsBefore);
  expect(await database.rowCount("certificate_attempts")).toBe(attemptsBefore);
  expect(await rpc.readContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "latestCertificateVersion", args: [institution, seed.certificateId] })).toBe("1");
});

it("fails the whole line closed when any historical version's frozen content is altered", async () => {
  const seed = await issueFirst();
  await dispute(seed);
  const prepared = (await correct(seed, "DISPUTE_DISCLOSURE", "Koreksi untuk uji integritas")).certificate;
  await endorse(seed, prepared); await mine();
  const handle = database.handle();
  const store = createCertificateStore({ execute: (q) => handle.execute(q), transaction: (run) => handle.transaction((tx) => run({ execute: (q) => tx.execute(q) })) });
  const original = (await store.content(institution, seed.certificateId))!;
  const changed = JSON.parse(original.canonical); changed.totals.confirmedCount = 7;
  try {
    await handle.execute(sql`UPDATE certificate_intents SET content_canonical=${JSON.stringify(changed)} WHERE institution_id=${institution} AND id=${seed.certificateId}`);
    for (const path of [seed.certificateId, `${seed.certificateId}/versions/2`, `${seed.certificateId}/versions/1`]) {
      const response = await request(`public/certificates/${institution}/${path}`, undefined, "");
      expect(response.status).toBe(503);
      expect((await response.json()).certificate).toBeUndefined();
    }
  } finally {
    await handle.execute(sql`UPDATE certificate_intents SET content_canonical=${original.canonical} WHERE institution_id=${institution} AND id=${seed.certificateId}`);
  }
  expect((await publicOf(seed.certificateId)).status).toBe(200);
});

it("refuses a correction from an account whose signatory mandate has lapsed", async () => {
  const seed = await issueFirst();
  await dispute(seed);
  const prepared = (await correct(seed, "DISPUTE_DISCLOSURE", "Sebelum pencabutan")).certificate;
  const signature = await sign(prepared);
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registryAddress, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, false] }) });
  try {
    expect((await request(`${baseOf(seed, prepared.id)}/submit`, { institutionId: institution, signature })).status).toBe(409);
    expect((await request(`${baseOf(seed, seed.certificateId)}/correct`, { institutionId: institution, reason: "DISPUTE_DISCLOSURE", note: "sesudah pencabutan" })).status).toBe(403);
  } finally {
    await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registryAddress, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, true] }) });
  }
  // Re-enabling bumps the epoch, so the pre-revocation endorsement stays unusable.
  expect((await request(`${baseOf(seed, prepared.id)}/submit`, { institutionId: institution, signature })).status).toBe(409);
});

it("hands the single signed-successor slot to another correction only when the holder failed for good", async () => {
  const handle = database.handle();
  const store = createCertificateStore({ execute: (q) => handle.execute(q), transaction: (run) => handle.transaction((tx) => run({ execute: (q) => tx.execute(q) })) });
  const policy = { scope: "slot-test", maxWei: "1000", reservationWei: "1" };
  const build = (nonce: number) => async () => ({ raw: `0x${nonce}` as Hex, hash: keccak256(toHex(`slot-${nonce}`)), signature: "0x00" as Hex, nonce });
  const line = { certificateId: "slot-line", predecessor: "1" };
  await store.reserve(institution, "slot-line@2", "slot-deployment", 0, policy, build(0), { ...line, reclaimable: [] });
  await expect(store.reserve(institution, "slot-line@3", "slot-deployment", 0, policy, build(1), { ...line, reclaimable: [] })).rejects.toThrow(/Koreksi lain/);
  expect(await store.attempt(institution, "slot-line@3")).toBeNull();
  // The same intent retrying is not a competitor; a reverted holder is replaced.
  expect((await store.reserve(institution, "slot-line@2", "slot-deployment", 0, policy, build(2), { ...line, reclaimable: [] })).nonce).toBe(0);
  await store.reserve(institution, "slot-line@3", "slot-deployment", 0, policy, build(1), { ...line, reclaimable: ["slot-line@2"] });
  expect(await store.successorClaim(institution, "slot-line", "1")).toBe("slot-line@3");
  // A holder that never stored signed bytes never blocks.
  await handle.execute(sql`INSERT INTO certificate_successor_claims(institution_id,certificate_id,predecessor,intent_id) VALUES (${institution},'slot-idle','1','slot-idle@2')`);
  await store.reserve(institution, "slot-idle@3", "slot-deployment", 0, policy, build(3), { certificateId: "slot-idle", predecessor: "1", reclaimable: [] });
  expect(await store.successorClaim(institution, "slot-idle", "1")).toBe("slot-idle@3");
});

it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser smoke: old version, dispute status and confirmed replacement, with history kept, on laptop and phone widths", async () => {
  const seed = await issueFirst();
  await dispute(seed);
  const token1 = (await publicOf(seed.certificateId)).body.certificate.tokenId as string;
  const result = await Bun.build({ entrypoints: [new URL("../../frontend/test/certificate-smoke.tsx", import.meta.url).pathname], target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "http://127.0.0.1:18614" }) } });
  if (!result.success) throw new Error(result.logs.join("\n"));
  const bundle = await result.outputs[0]!.text();
  const cssProcess = Bun.spawn(["bun", "test/build-smoke-css.ts"], { cwd: new URL("../../frontend", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" });
  const css = await new Response(cssProcess.stdout).text();
  if (await cssProcess.exited !== 0) throw new Error(await new Response(cssProcess.stderr).text());
  const server = Bun.serve({ hostname: "127.0.0.1", port: 18614, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
    if (url.pathname === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
    if (url.pathname === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    if (url.pathname === "/smoke-config") return Response.json({ token, institutionId: institution });
    if (url.pathname === "/wallet-rpc") {
      const { method, params } = await req.json();
      if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([account.address]);
      if (method === "eth_chainId") return Response.json("0x7a69");
      if (method === "eth_signTypedData_v4") return Response.json(await account.signTypedData(JSON.parse(params[1])));
      if (method === "wallet_requestPermissions" || method === "wallet_getPermissions") return Response.json([{ parentCapability: "eth_accounts" }]);
      return Response.json(null);
    }
    return app.fetch(req);
  } });
  const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
  const browser = await chromium.launch({ ...(process.env.REGISTRY_BROWSER_EXECUTABLE ? { executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE } : {}), headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.goto("http://127.0.0.1:18614");
    await page.getByLabel("Kegiatan penyaluran").selectOption(seed.activityId);
    await page.getByLabel("Identitas sertifikat").fill(seed.certificateId);
    await page.getByRole("button", { name: "Mulai persiapan sertifikat" }).click();

    // Officer sees the issued version, the dispute on its scope, and that it is not shown as current.
    const versions = page.getByRole("list", { name: "Riwayat versi sertifikat" });
    await versions.waitFor();
    expect(await versions.textContent()).toContain("Diperselisihkan");
    await page.getByRole("alert").filter({ hasText: "sedang diperselisihkan" }).waitFor();
    await page.getByLabel("Alasan koreksi").selectOption("DISPUTE_DISCLOSURE");
    await page.getByLabel("Catatan koreksi").fill("Sengketa jumlah diterima dicantumkan");
    await page.getByRole("button", { name: "Siapkan versi pengganti" }).click();
    const sign = page.getByRole("button", { name: "Tandatangani dan terbitkan sertifikat" });
    await sign.waitFor();
    expect(await page.getByText(`${seed.certificateId}@2`).count()).toBeGreaterThan(0);
    await page.getByLabel("Saya telah meninjau cakupan realisasi, totalnya, dan parameter pengesahan di atas.").check();
    await sign.click();
    await page.getByText("Sertifikat tercatat dalam blok", { exact: false }).waitFor();
    await mine();
    await page.getByRole("status").filter({ hasText: "Sertifikat terbit; tingkat konfirmasi tercapai" }).waitFor();

    // Public verifier: the replacement is official, the old version stays readable as superseded.
    const verifier = page.getByRole("main");
    await verifier.getByLabel("ID Sertifikat", { exact: true }).fill(seed.certificateId);
    await verifier.getByRole("button", { name: "Periksa", exact: true }).click();
    await verifier.getByRole("heading", { name: /^Sertifikat #/ }).waitFor();
    const history = verifier.getByRole("region", { name: "Riwayat versi" });
    expect(await history.textContent()).toContain("Telah digantikan");
    expect(await verifier.getByText(/Menggantikan versi 1/).count()).toBe(1);
    await verifier.getByRole("button", { name: "Lihat versi 1", exact: true }).first().click();
    await verifier.getByRole("heading", { name: `Sertifikat #${token1}`, exact: true }).waitFor();
    expect(await verifier.getByRole("status", { name: "Status keberlakuan" }).textContent()).toContain("Telah digantikan");
    expect(await verifier.getByText("Terkonfirmasi", { exact: true }).count()).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await verifier.getByRole("button", { name: "Kembali ke versi resmi terkini" }).click();
    await verifier.getByRole("heading", { name: `Sertifikat #${(BigInt(token1) + 1n).toString()}`, exact: true }).waitFor();
    expect(await verifier.getByRole("region", { name: "Riwayat versi" }).textContent()).toContain(`token #${token1}`);
    // With the real stylesheet, nothing may force sideways scrolling at phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: new URL("../../.scratch/issue112-certificate-correction-browser.png", import.meta.url).pathname, fullPage: true });
    expect(errors).toEqual([]);
  } finally { await browser.close(); await server.stop(true); }
}, 90000);
