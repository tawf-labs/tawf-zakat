/**
 * Custody recovery of issued distribution certificates over authenticated HTTP, real
 * signatures, SQL and a local EVM (Spec #100, Issue #113).
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
const rpcUrl = "http://127.0.0.1:18622";
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
let clockOffset = 0;

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
    now: () => Math.floor(Date.now() / 1000) + clockOffset, challengeTtlSeconds: 300, sessionTtlSeconds: 3600,
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
  if (occupied) throw new Error("Port 18622 sudah digunakan; hentikan fixture Anvil lama sebelum menjalankan suite.");
  node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", "18622", "--silent"], { stdout: "ignore", stderr: "pipe" });
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

import { recoveryTypedData } from "../../shared/certificate-nft";

const mine = () => rpc.request({ method: "evm_mine" as any });
const baseOf = (activityId: string, id: string) => `workspace/activities/${activityId}/certificates/${id}`;
const sign = (prepared: any) => account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));
const signRecovery = (prepared: any) => account.signTypedData(recoveryTypedData(prepared.domain, prepared.recovery));
const publicOf = async (certificateId: string, version?: string) => {
  const response = await request(`public/certificates/${institution}/${certificateId}${version ? `/versions/${version}` : ""}`, undefined, "");
  return { status: response.status, body: await response.json() };
};
let opSequence = 0;
const operation = () => ({ id: `op-recovery-${++opSequence}`, account: account.address, requestHash: `h-${opSequence}` });
const newCustodian = (n: number) => privateKeyToAccount(keccak256(toHex(`custodian-${n}-${Date.now()}`))).address;
const designate = async (custodian: Hex) => rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({
  address: certificateAddress, abi: certificateNftAbi, functionName: "setCustodian", args: [institution, custodian] }) });
const holderOf = (tokenId: bigint) => rpc.readContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "ownerOf", args: [tokenId] });
const recoveriesPath = (seed: { activityId: string; certificateId: string }) => `${baseOf(seed.activityId, seed.certificateId)}/recoveries`;
const attempts = () => database.rowCount("certificate_attempts");

async function issueFirst() {
  const seed = await seedCertifiableActivity(configure());
  const base = baseOf(seed.activityId, seed.certificateId);
  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  await json(`${base}/submit`, { institutionId: institution, signature: await sign(prepared) }, 200);
  await mine();
  expect((await json(base)).certificate.observation.state).toBe("CONFIRMED");
  return seed;
}
const prepareRecovery = (seed: { activityId: string; certificateId: string }, decisionRef = "SK/PEMULIHAN/001", status = 201) =>
  json(recoveriesPath(seed), { institutionId: institution, decisionRef }, status);
const submitRecovery = async (seed: { activityId: string; certificateId: string }, recovery: any, signature?: Hex) =>
  request(`${recoveriesPath(seed)}/${recovery.id}/submit`, { institutionId: institution, signature: signature ?? await signRecovery(recovery) });

async function grantRecoveryMandate() {
  const now = Math.floor(Date.now() / 1000);
  await database.handle().execute(sql`INSERT INTO operational_mandates (id, institution_id, officer_id, account_address, function, scope_type, program_id, valid_from, valid_until, assignment_ref, nominal_limit, version, is_active, created_at, updated_at, created_by)
    VALUES ('mandate-recover-cert', ${institution}, ${officerId}, ${account.address.toLowerCase()}, 'RECOVER_CERTIFICATE_CUSTODY', 'ALL_PROGRAMS', NULL, ${now - 1000}, ${now + 100000}, 'SK-recover-1', NULL, 1, true, ${now}, ${now}, 'system')
    ON CONFLICT DO NOTHING`);
}

it("refuses recovery without its own mandate, without a new designated custodian, and to anyone without authority", async () => {
  const seed = await issueFirst();
  // Holding the issuing mandate is not a basis to recover custody.
  const noMandate = await request(recoveriesPath(seed), { institutionId: institution, decisionRef: "SK/PEMULIHAN/001" });
  expect(noMandate.status).toBe(403);
  expect((await noMandate.json()).error).toMatch(/mandat/i);
  await grantRecoveryMandate();
  // A reader has no operational mandate at all; another institution's context is refused outright.
  expect((await request(recoveriesPath(seed), { institutionId: institution, decisionRef: "SK/1" }, readerToken)).status).toBe(403);
  expect((await request(recoveriesPath(seed), { institutionId: "institusi-lain", decisionRef: "SK/PEMULIHAN/001" })).status).toBeGreaterThanOrEqual(400);
  // A basis must be recorded.
  for (const decisionRef of ["", "ab", "x".repeat(201), undefined]) expect((await request(recoveriesPath(seed), { institutionId: institution, decisionRef })).status).toBe(400);
  // Holder is already the resolved custodian: nothing to recover.
  const same = await request(recoveriesPath(seed), { institutionId: institution, decisionRef: "SK/PEMULIHAN/001" });
  expect(same.status).toBe(409);
  expect((await same.json()).error).toMatch(/sudah sama/);
  expect(await database.handle().execute(sql`SELECT 1 FROM certificate_recoveries`).then((r: any) => (r.rows ?? r).length)).toBe(0);
  await designate(account.address); // leave the designation as it was for later tests
});

it("recovers to the newly designated custodian by replacement, keeping issuer, content, history and the old token", async () => {
  await grantRecoveryMandate();
  const seed = await issueFirst();
  const before = (await publicOf(seed.certificateId)).body.certificate;
  const oldToken = BigInt(before.tokenId);
  const custodian = newCustodian(1);
  await designate(custodian);

  // The service reads the target from the chain: it is not caller-chosen.
  const line = (await json(`${baseOf(seed.activityId, seed.certificateId)}/history`)).line;
  expect(line.custody).toMatchObject({ recoveryNeeded: true, resolvedCustodian: custodian });
  const prepared = (await prepareRecovery(seed)).recovery;
  expect(prepared).toMatchObject({ certificateId: seed.certificateId, version: "1", decisionRef: "SK/PEMULIHAN/001", previousCustodian: account.address, observation: { state: "PREPARED" } });
  expect(prepared.recovery.newCustodian).toBe(custodian);
  expect(JSON.stringify(prepared)).not.toMatch(/0x8b3a350c|0xac0974be/);
  // Idempotent while valid; a different basis for the same target is a conflict.
  expect((await prepareRecovery(seed)).recovery.id).toBe(prepared.id);
  expect((await request(recoveriesPath(seed), { institutionId: institution, decisionRef: "SK/LAIN/002" })).status).toBe(409);

  const signature = await signRecovery(prepared);
  const submitted = await submitRecovery(seed, prepared, signature);
  expect(submitted.status).toBe(200);
  expect((await submitted.json()).recovery.observation.state).toBe("SUBMITTED");
  const included = (await json(`${recoveriesPath(seed)}/${prepared.id}`)).recovery;
  expect(included.observation.state).toBe("INCLUDED");
  await mine();
  const confirmed = (await json(`${recoveriesPath(seed)}/${prepared.id}`)).recovery;
  expect(confirmed.observation.state).toBe("CONFIRMED");
  const newToken = BigInt(confirmed.observation.tokenId);
  expect(newToken).toBeGreaterThan(oldToken);

  const after = (await publicOf(seed.certificateId)).body.certificate;
  expect(after).toMatchObject({ tokenId: newToken.toString(), version: "1", validity: "CURRENT", custodian: custodian, issuer: before.issuer, contentDigest: before.contentDigest });
  expect(after.totals).toEqual(before.totals);
  expect(after.custody).toEqual({ current: true, recoveryReason: "CUSTODY_RECOVERY", tokens: [
    { tokenId: oldToken.toString(), holder: account.address, status: "REPLACED" },
    { tokenId: newToken.toString(), holder: custodian, status: "ACTIVE" },
  ] });
  // The old token is untouched: same holder, same issuer and commitment, still locked.
  expect(await holderOf(oldToken)).toBe(account.address);
  expect(await rpc.readContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "contentDigestOf", args: [oldToken] })).toBe(before.contentDigest);
  expect(await rpc.readContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "locked", args: [newToken] })).toBe(true);
  // No transfer door: not even the previous holder or the new custodian's own address can move it.
  await expect(rpc.simulateContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "transferFrom", account, args: [account.address, custodian, oldToken] })).rejects.toThrow();
  // Replays: the same signed endorsement, and a second recovery, are settled or refused.
  expect((await (await submitRecovery(seed, prepared, signature)).json()).recovery.observation.state).toBe("CONFIRMED");
  const replay = await request(recoveriesPath(seed), { institutionId: institution, decisionRef: "SK/PEMULIHAN/001" });
  expect(replay.status).toBe(409);
  await expect(rpc.simulateContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "recoverCustody", account,
    args: [{ ...prepared.recovery, authorityEpoch: BigInt(prepared.recovery.authorityEpoch), deadline: BigInt(prepared.recovery.deadline) }, signature] })).rejects.toThrow();

  await designate(account.address);
});

it("keeps history readable after recovery and lets the line be corrected and recovered again", async () => {
  await grantRecoveryMandate();
  const seed = await issueFirst();
  const first = (await publicOf(seed.certificateId)).body.certificate;
  const custodian = newCustodian(2);
  await designate(custodian);
  const prepared = (await prepareRecovery(seed)).recovery;
  await submitRecovery(seed, prepared); await mine();

  // A dispute and its correction after recovery: predecessor is the ACTIVE token, chain and store agree.
  await seed.stores.disbursement.recordDispute(institution, seed.proposalId, seed.realizationId,
    { complainantType: "BENEFICIARY", subject: "AMOUNT", reason: "Jumlah berbeda", disputedAmountIdr: "100000" },
    { officerId: "off-other" }, Math.floor(Date.now() / 1000), operation());
  const correction = (await json(`${baseOf(seed.activityId, seed.certificateId)}/correct`, { institutionId: institution, reason: "DISPUTE_DISCLOSURE", note: "Sengketa dicantumkan", expectedPredecessorVersion: "1" })).certificate;
  await json(`${baseOf(seed.activityId, correction.id)}/submit`, { institutionId: institution, signature: await sign(correction) }, 200);
  await mine();
  const head = (await publicOf(seed.certificateId)).body.certificate;
  expect(head).toMatchObject({ version: "2", custodian, custody: { current: true } });
  const old = (await publicOf(seed.certificateId, "1")).body.certificate;
  expect(old).toMatchObject({ validity: "SUPERSEDED", contentDigest: first.contentDigest, issuer: first.issuer, custodian });
  expect(old.custody.tokens.map((t: any) => t.status)).toEqual(["REPLACED", "ACTIVE"]);
  expect(old.history.map((h: any) => [h.version, h.validity])).toEqual([["1", "SUPERSEDED"], ["2", "DISPUTED"]]);

  // The institution rotates its custodian again: the v2 head is now the one to recover.
  const another = newCustodian(3);
  await designate(another);
  expect((await publicOf(seed.certificateId)).body.certificate.custody.current).toBe(false);
  const second = (await prepareRecovery(seed, "SK/PEMULIHAN/003")).recovery;
  expect(second.version).toBe("2");
  await submitRecovery(seed, second); await mine();
  expect((await publicOf(seed.certificateId)).body.certificate).toMatchObject({ version: "2", custodian: another, custody: { current: true } });
  await designate(account.address);
});

it("voids an endorsement when the designated custodian, the mandate or the official version changes, and never revives it", async () => {
  await grantRecoveryMandate();
  const seed = await issueFirst();
  const first = newCustodian(4);
  await designate(first);
  const prepared = (await prepareRecovery(seed)).recovery;
  const signature = await signRecovery(prepared);
  const attemptsBefore = await attempts();

  // The institution designates someone else before the endorsement is used.
  await designate(newCustodian(5));
  expect((await json(`${recoveriesPath(seed)}/${prepared.id}`)).recovery.signingAuthority).toBe("STALE");
  const late = await submitRecovery(seed, prepared, signature);
  expect(late.status).toBe(409);
  expect((await late.json()).error).toMatch(/tidak lagi sah/);
  expect((await request(`${recoveriesPath(seed)}/${prepared.id}/retry`, { institutionId: institution })).status).toBe(409);
  // Designating the first custodian again does not make the old endorsement live: it stays void.
  await designate(first);
  expect((await json(`${recoveriesPath(seed)}/${prepared.id}`)).recovery).toMatchObject({ signingAuthority: "STALE", voided: true });
  expect((await submitRecovery(seed, prepared, signature)).status).toBe(409);
  expect(await attempts()).toBe(attemptsBefore);
  expect(await holderOf(BigInt((await publicOf(seed.certificateId)).body.certificate.tokenId))).toBe(account.address);

  // A fresh preparation gets a new identity and works; revoking the signatory then voids that one too.
  const fresh = (await prepareRecovery(seed)).recovery;
  expect(fresh.id).not.toBe(prepared.id);
  const freshSignature = await signRecovery(fresh);
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registryAddress, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, false] }) });
  try {
    expect((await submitRecovery(seed, fresh, freshSignature)).status).toBe(409);
    expect((await request(recoveriesPath(seed), { institutionId: institution, decisionRef: "SK/PEMULIHAN/009" })).status).toBe(403);
  } finally {
    await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registryAddress, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, true] }) });
  }
  // Re-enabling the signatory bumps its epoch, so the pre-revocation endorsement stays unusable.
  expect((await submitRecovery(seed, fresh, freshSignature)).status).toBe(409);
  expect(await attempts()).toBe(attemptsBefore);
  await designate(account.address);
});

it("retains the signed bytes when the broadcast acknowledgement is lost and retries them without a second recovery", async () => {
  await grantRecoveryMandate();
  const seed = await issueFirst();
  await designate(newCustodian(6));
  const prepared = (await prepareRecovery(seed)).recovery;
  const signature = await signRecovery(prepared);
  const attemptsBefore = await attempts();
  mutateRpc = (method, body) => method === "eth_sendRawTransaction" ? { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "acknowledgement lost" } } : body;
  try { expect((await submitRecovery(seed, prepared, signature)).status).toBe(503); }
  finally { mutateRpc = null; }
  await database.reopen(); configure();
  // The wallet's late answer for a different signature cannot replace what is stored.
  const otherSignature = (await account.signMessage({ message: "late wallet response" })) as Hex;
  expect((await submitRecovery(seed, prepared, otherSignature)).status).toBe(409);
  const recovered = (await json(`${recoveriesPath(seed)}/${prepared.id}`)).recovery;
  expect(recovered.observation.state).toBe("INCLUDED");
  const retried = (await json(`${recoveriesPath(seed)}/${prepared.id}/retry`, { institutionId: institution }, 200)).recovery;
  expect(retried.transactionHash).toBe(recovered.transactionHash);
  expect(await attempts()).toBe(attemptsBefore + 1);
  await mine();
  expect((await publicOf(seed.certificateId)).body.certificate.custody.current).toBe(true);
  await designate(account.address);
});

it("shows a stale holder honestly and withholds recovery from a reorged endorsement's success", async () => {
  await grantRecoveryMandate();
  const seed = await issueFirst();
  await designate(newCustodian(7));
  expect((await publicOf(seed.certificateId)).body.certificate.custody.current).toBe(false);
  const prepared = (await prepareRecovery(seed)).recovery;
  const snapshot = await rpc.request({ method: "evm_snapshot" as any });
  await submitRecovery(seed, prepared);
  expect((await json(`${recoveriesPath(seed)}/${prepared.id}`)).recovery.observation.state).toBe("INCLUDED");
  await rpc.request({ method: "evm_revert" as any, params: [snapshot] as any });
  const reorged = (await json(`${recoveriesPath(seed)}/${prepared.id}`)).recovery;
  expect(reorged.observation.state).toBe("NONCANONICAL");
  expect((await publicOf(seed.certificateId)).body.certificate.custody.current).toBe(false);
  await json(`${recoveriesPath(seed)}/${prepared.id}/retry`, { institutionId: institution }, 200);
  await mine();
  expect((await publicOf(seed.certificateId)).body.certificate.custody.current).toBe(true);
  await designate(account.address);
});

it("keeps the historical verifier failing closed if a recovered token's issuer or commitment were tampered offchain", async () => {
  await grantRecoveryMandate();
  const seed = await issueFirst();
  await designate(newCustodian(8));
  const prepared = (await prepareRecovery(seed)).recovery;
  await submitRecovery(seed, prepared); await mine();
  const handle = database.handle();
  const store = createCertificateStore({ execute: (q) => handle.execute(q), transaction: (run) => handle.transaction((tx) => run({ execute: (q) => tx.execute(q) })) });
  const original = (await store.get(institution, seed.certificateId))!;
  const forged = structuredClone(original);
  forged.certification.signer = registryAddress;
  forged.certificationDigest = hashTypedData(certificationTypedData(forged.domain, forged.certification));
  try {
    await handle.execute(sql`UPDATE certificate_intents SET intent=${JSON.stringify(forged)} WHERE institution_id=${institution} AND id=${seed.certificateId}`);
    expect((await publicOf(seed.certificateId)).status).toBe(503);
  } finally {
    await handle.execute(sql`UPDATE certificate_intents SET intent=${JSON.stringify(original)} WHERE institution_id=${institution} AND id=${seed.certificateId}`);
  }
  expect((await publicOf(seed.certificateId)).status).toBe(200);
  // A tampered recovery record is refused rather than trusted.
  await handle.execute(sql`UPDATE certificate_recoveries SET intent=replace(intent, ${prepared.decisionRef}, 'SK/DIUBAH') WHERE institution_id=${institution} AND id=${prepared.id}`);
  expect((await request(`${recoveriesPath(seed)}/${prepared.id}`)).status).toBe(503);
  await designate(account.address);
});

it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser smoke: stale endorsement is refused, a fresh recovery is signed, and the verifier shows old and replacement tokens", async () => {
  await grantRecoveryMandate();
  const seed = await issueFirst();
  const first = newCustodian(20);
  await designate(first);
  const built = await Bun.build({ entrypoints: [new URL("../../frontend/test/certificate-smoke.tsx", import.meta.url).pathname], target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "http://127.0.0.1:18624" }) } });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const bundle = await built.outputs[0]!.text();
  const cssProcess = Bun.spawn(["bun", "test/build-smoke-css.ts"], { cwd: new URL("../../frontend", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" });
  const css = await new Response(cssProcess.stdout).text();
  if (await cssProcess.exited !== 0) throw new Error(await new Response(cssProcess.stderr).text());
  const server = Bun.serve({ hostname: "127.0.0.1", port: 18624, async fetch(req) {
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
    await page.goto("http://127.0.0.1:18624");
    await page.getByLabel("Kegiatan penyaluran").selectOption(seed.activityId);
    await page.getByLabel("Identitas sertifikat").fill(seed.certificateId);
    await page.getByRole("button", { name: "Mulai persiapan sertifikat" }).click();
    await page.getByRole("alert").filter({ hasText: "tidak ada token yang dipindahkan" }).waitFor();
    // The form takes a decision reference only: there is no field to choose a target address.
    expect(await page.getByLabel(/Dasar keputusan lembaga/).count()).toBe(1);
    expect(await page.getByLabel(/alamat|address/i).count()).toBe(0);
    await page.getByLabel(/Dasar keputusan lembaga/).fill("SK/PEMULIHAN/UI-1");
    await page.getByRole("button", { name: "Siapkan pemulihan" }).click();
    const sign = page.getByRole("button", { name: "Tandatangani dan terbitkan token pengganti" });
    await sign.waitFor({ timeout: 8000 }).catch(async (error: Error) => { throw new Error(`${error.message}\n${(await page.locator("body").innerText()).slice(-900)}`); });
    expect(await sign.isDisabled()).toBe(true);
    await page.getByLabel(/Saya telah meninjau pengendali baru/).check();

    // The institution designates a different custodian before signing: the endorsement is void.
    const second = newCustodian(21);
    await designate(second);
    await sign.click();
    await page.getByRole("alert").filter({ hasText: "tidak lagi sah" }).waitFor();
    expect(await page.getByText("Pengesahan ini sudah tidak sah.").count()).toBe(1);
    await page.getByRole("button", { name: "Mulai persiapan baru" }).click();
    await page.getByLabel(/Dasar keputusan lembaga/).fill("SK/PEMULIHAN/UI-2");
    await page.getByRole("button", { name: "Siapkan pemulihan" }).click();
    await page.getByText(second, { exact: false }).first().waitFor();
    await page.getByLabel(/Saya telah meninjau pengendali baru/).check();
    await sign.click();
    await page.getByText("Transaksi diajukan", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Periksa status pemulihan" }).click();
    await page.getByText("Pemulihan tercatat dalam blok", { exact: false }).waitFor();
    await mine();
    await page.getByRole("button", { name: "Periksa status pemulihan" }).click();
    await page.getByText("Token pengganti terbit ke pengendali baru", { exact: false }).waitFor();

    const verifier = page.getByRole("main");
    await verifier.getByLabel("ID Sertifikat", { exact: true }).fill(seed.certificateId);
    await verifier.getByRole("button", { name: "Periksa", exact: true }).click();
    const custody = verifier.getByRole("region", { name: "Pemegang token" });
    await custody.waitFor();
    const text = await custody.textContent();
    expect(text).toContain("digantikan (riwayat)");
    expect(text).toContain("aktif");
    expect(text).toContain("Pemegang sesuai dengan pengendali institusi saat ini");
    expect(text?.toLowerCase()).toContain(second.toLowerCase());
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: new URL("../../.scratch/issue113-custody-recovery-browser.png", import.meta.url).pathname, fullPage: true });
    expect(errors).toEqual([]);
  } finally { await browser.close(); await server.stop(true); await designate(account.address); }
}, 90000);
