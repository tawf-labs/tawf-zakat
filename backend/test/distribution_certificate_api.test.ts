/**
 * Distribution-stage certificate issuance over authenticated HTTP, real signatures and a local
 * EVM (Spec #100, Issue #111).
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
const rpcUrl = "http://127.0.0.1:18602";
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
  return { activityId, certificateId: `cert-${sequence}` };
}

beforeAll(async () => {
  let occupied = false;
  try { await rpc.getChainId(); occupied = true; } catch { /* The isolated fixture must own this port. */ }
  if (occupied) throw new Error("Port 18602 sudah digunakan; hentikan fixture Anvil lama sebelum menjalankan suite.");
  node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", "18602", "--silent"], { stdout: "ignore", stderr: "pipe" });
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

  const challenge = await json("workspace/challenge", { institutionId: institution, account: account.address });
  token = (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await account.signTypedData(challenge.typedData) })).token;
}, 30000);

afterAll(async () => {
  resetWorkspace();
  await proxy?.stop(true);
  try { if (database) await database.close(); }
  finally { if (node && node.exitCode === null) { node.kill(); await node.exited; } }
});

it("prepares, endorses, mints and confirms a distribution certificate through HTTP, signature and local EVM", async () => {
  const stores = configure();
  const { activityId, certificateId } = await seedCertifiableActivity(stores);
  const base = `workspace/activities/${activityId}/certificates/${certificateId}`;

  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  expect(prepared.certification.activityId).toBe(activityId);
  expect(prepared.certification.certificateId).toBe(certificateId);
  expect(prepared.observation.state).toBe("PREPARED");

  const signature = await account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));
  const submitted = (await json(`${base}/submit`, { institutionId: institution, signature }, 200)).certificate;
  expect(submitted.observation.state).toBe("SUBMITTED");

  const included = (await json(base)).certificate;
  expect(included.observation.state).toBe("INCLUDED");
  await rpc.request({ method: "evm_mine" as any });
  await database.reopen(); configure();
  const confirmed = (await json(base)).certificate;
  expect(confirmed.observation.state).toBe("CONFIRMED");
  expect(confirmed.observation.tokenId).toBe("1");

  const publicView = await (await request(`public/certificates/${institution}/${certificateId}`, undefined, "")).json();
  expect(publicView.success).toBe(true);
  expect(publicView.certificate.custodian.toLowerCase()).toBe(account.address.toLowerCase());
  expect(publicView.certificate.issuer.toLowerCase()).toBe(account.address.toLowerCase());
  expect(publicView.certificate.totals).toEqual({ confirmedCount: 0, disputedCount: 0, unconfirmedCount: 1, totalRealizedIdr: "1000000" });

  const retried = (await json(`${base}/submit`, { institutionId: institution, signature }, 200)).certificate;
  expect(retried.transactionHash).toBe(submitted.transactionHash);
  expect(await database.rowCount("certificate_attempts")).toBe(1);
});

it("endorses totals for only the frozen realization scope, excluding unevidenced handovers", async () => {
  const { activityId, certificateId } = await seedCertifiableActivity(configure(), true);
  const base = `workspace/activities/${activityId}/certificates/${certificateId}`;
  const prepared = await json(`${base}/prepare`, { institutionId: institution });
  expect(prepared.contentTotals).toEqual({ confirmedCount: 0, disputedCount: 0, unconfirmedCount: 1, totalRealizedIdr: "400000" });
  await database.reopen(); configure();
  expect((await json(base)).contentTotals).toEqual(prepared.contentTotals);
});

it("fails public verification closed when frozen content or salt changes despite a confirmed mint", async () => {
  const { activityId, certificateId } = await seedCertifiableActivity(configure());
  const base = `workspace/activities/${activityId}/certificates/${certificateId}`;
  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  const signature = await account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));
  await json(`${base}/submit`, { institutionId: institution, signature }, 200);
  await rpc.request({ method: "evm_mine" as any });
  const publicPath = `public/certificates/${institution}/${certificateId}`;
  expect((await json(publicPath)).certificate.observation.state).toBe("CONFIRMED");
  const handle = database.handle();
  const store = createCertificateStore({ execute: (q) => handle.execute(q), transaction: (run) => handle.transaction((tx) => run({ execute: (q) => tx.execute(q) })) });
  const original = (await store.content(institution, certificateId))!;
  const changed = JSON.parse(original.canonical);
  changed.totals.confirmedCount = 99;
  for (const [canonical, salt] of [[JSON.stringify(changed), original.salt], [original.canonical, `0x${"00".repeat(32)}`], ["", original.salt]]) {
    await handle.execute(sql`UPDATE certificate_intents SET content_canonical=${canonical!}, content_salt=${salt!} WHERE institution_id=${institution} AND id=${certificateId}`);
    const response = await request(publicPath, undefined, "");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.certificate).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(original.salt);
    expect((await request(base)).status).toBe(503);
  }
  await handle.execute(sql`UPDATE certificate_intents SET content_canonical=${original.canonical}, content_salt=${original.salt} WHERE institution_id=${institution} AND id=${certificateId}`);
  expect((await json(publicPath)).certificate.observation.state).toBe("CONFIRMED");
});

it("checks content digest and issuer against the minted chain evidence even when local bindings are internally consistent", async () => {
  const { activityId, certificateId } = await seedCertifiableActivity(configure());
  const base = `workspace/activities/${activityId}/certificates/${certificateId}`;
  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  const signature = await account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));
  await json(`${base}/submit`, { institutionId: institution, signature }, 200);
  await rpc.request({ method: "evm_mine" as any });
  const publicPath = `public/certificates/${institution}/${certificateId}`;
  expect((await json(publicPath)).certificate.observation.state).toBe("CONFIRMED");
  const handle = database.handle();
  const store = createCertificateStore({ execute: (q) => handle.execute(q), transaction: (run) => handle.transaction((tx) => run({ execute: (q) => tx.execute(q) })) });
  const originalContent = (await store.content(institution, certificateId))!;
  const originalIntent = (await store.get(institution, certificateId))!;
  const changed = JSON.parse(originalContent.canonical);
  changed.realizations[0].amountIdr = "2000000";
  changed.totals.totalRealizedIdr = "2000000";
  for (const mutation of [
    { canonical: JSON.stringify(changed), signer: originalIntent.certification.signer },
    { canonical: originalContent.canonical, signer: registryAddress },
  ]) {
    const forged = structuredClone(originalIntent);
    forged.certification.digest = certificateCommitment(new TextEncoder().encode(mutation.canonical), originalContent.salt) as Hex;
    forged.certification.signer = mutation.signer;
    forged.certificationDigest = hashTypedData(certificationTypedData(forged.domain, forged.certification));
    try {
      await handle.execute(sql`UPDATE certificate_intents SET content_canonical=${mutation.canonical},intent=${JSON.stringify(forged)} WHERE institution_id=${institution} AND id=${certificateId}`);
      const response = await request(publicPath, undefined, "");
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.error).toMatch(/tidak cocok dengan bukti chain/);
      expect(body.certificate).toBeUndefined();
    } finally {
      await handle.execute(sql`UPDATE certificate_intents SET content_canonical=${originalContent.canonical},intent=${JSON.stringify(originalIntent)} WHERE institution_id=${institution} AND id=${certificateId}`);
    }
  }
  expect((await json(publicPath)).certificate.contentDigest).toBe(originalIntent.certification.digest);
});

it("refuses publication before signing or spending when the service budget is exhausted", async () => {
  const { activityId, certificateId } = await seedCertifiableActivity(configure({ ...serviceBudget, maxWei: "1" }));
  const base = `workspace/activities/${activityId}/certificates/${certificateId}`;
  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  const signature = await account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));
  const attemptsBefore = await database.rowCount("certificate_attempts");
  try {
    const response = await request(`${base}/submit`, { institutionId: institution, signature });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/anggaran/i);
    expect(await database.rowCount("certificate_attempts")).toBe(attemptsBefore);
    expect((await json(base)).certificate.observation.state).toBe("PREPARED");
    expect(await rpc.readContract({ address: certificateAddress, abi: certificateNftAbi, functionName: "certificateVersionToken", args: [institution, certificateId, "1"] })).toBe(0n);
  } finally { configure(); }
});

it("atomically admits only one mint at the budget boundary and retains its reservation across restart and reorg", async () => {
  const stores = configure();
  const first = await seedCertifiableActivity(stores);
  const second = await seedCertifiableActivity(stores);
  const bases = [first, second].map(({ activityId, certificateId }) => `workspace/activities/${activityId}/certificates/${certificateId}`);
  const prepared = await Promise.all(bases.map(async (base) => (await json(`${base}/prepare`, { institutionId: institution })).certificate));
  const signatures = await Promise.all(prepared.map((p) => account.signTypedData(certificationTypedData(p.domain, p.certification))));
  const attemptsBefore = await database.rowCount("certificate_attempts");
  const bounded = { ...serviceBudget, maxWei: ((BigInt(attemptsBefore) + 1n) * 3000000000000000n).toString() };
  configure(bounded);
  const snapshot = await rpc.request({ method: "evm_snapshot" as any });
  try {
    const responses = await Promise.all(bases.map((base, i) => request(`${base}/submit`, { institutionId: institution, signature: signatures[i] })));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 503]);
    const winner = responses.findIndex((r) => r.status === 200);
    const loser = 1 - winner;
    const issued = (await responses[winner]!.json()).certificate;
    const transaction = await rpc.getTransaction({ hash: issued.transactionHash });
    expect(transaction.gas).toBe(1500000n);
    expect(transaction.maxFeePerGas).toBe(2000000000n);
    expect(transaction.maxPriorityFeePerGas).toBe(0n);
    expect((await responses[loser]!.json()).error).toMatch(/anggaran/i);
    expect(await database.rowCount("certificate_attempts")).toBe(attemptsBefore + 1);
    await rpc.request({ method: "evm_mine" as any });
    expect((await json(bases[winner]!)).certificate.observation.state).toBe("CONFIRMED");
    await database.reopen(); configure(bounded);
    expect((await json(`${bases[winner]}/retry`, { institutionId: institution }, 200)).certificate.transactionHash).toBe(issued.transactionHash);
    expect((await request(`${bases[loser]}/submit`, { institutionId: institution, signature: signatures[loser] })).status).toBe(503);
    await rpc.request({ method: "evm_revert" as any, params: [snapshot] as any });
    expect((await json(bases[winner]!)).certificate.observation.state).toBe("NONCANONICAL");
    expect((await request(`${bases[loser]}/submit`, { institutionId: institution, signature: signatures[loser] })).status).toBe(503);
    expect((await json(`${bases[winner]}/retry`, { institutionId: institution }, 200)).certificate.transactionHash).toBe(issued.transactionHash);
    expect(await database.rowCount("certificate_attempts")).toBe(attemptsBefore + 1);
  } finally { configure(); }
});

it("accounts pre-budget signed transactions on upgrade and fails closed on corrupt legacy bytes", async () => {
  const old = await seedCertifiableActivity(configure());
  const oldBase = `workspace/activities/${old.activityId}/certificates/${old.certificateId}`;
  const oldIntent = (await json(`${oldBase}/prepare`, { institutionId: institution })).certificate;
  await json(`${oldBase}/submit`, { institutionId: institution, signature: await account.signTypedData(certificationTypedData(oldIntent.domain, oldIntent.certification)) }, 200);
  const next = await seedCertifiableActivity(configure());
  const base = `workspace/activities/${next.activityId}/certificates/${next.certificateId}`;
  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  const signature = await account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));
  const attemptsBefore = await database.rowCount("certificate_attempts");
  let handle = database.handle();
  const result = await handle.execute<{ raw: string }>(sql`SELECT raw FROM certificate_attempts WHERE institution_id=${institution} AND intent_id=${old.certificateId}`);
  const original = ("rows" in result ? result.rows : result)[0]!.raw;
  // Emulate an existing database upgraded from #111 before the accounting columns existed.
  await handle.execute(sql`UPDATE certificate_attempts SET budget_scope=NULL,reserved_wei=NULL`);
  await handle.execute(sql`DELETE FROM certificate_service_budgets`);
  await handle.execute(sql`UPDATE certificate_attempts SET raw='0x' WHERE institution_id=${institution} AND intent_id=${old.certificateId}`);
  await database.reopen(); configure(); handle = database.handle();
  try {
    const corrupt = await request(`${base}/submit`, { institutionId: institution, signature });
    expect(corrupt.status).toBe(503);
    expect((await corrupt.json()).error).toMatch(/transaksi lama/i);
    expect(await database.rowCount("certificate_attempts")).toBe(attemptsBefore);
  } finally {
    await handle.execute(sql`UPDATE certificate_attempts SET raw=${original} WHERE institution_id=${institution} AND intent_id=${old.certificateId}`);
  }
  configure({ ...serviceBudget, maxWei: (BigInt(attemptsBefore) * 3000000000000000n).toString() });
  try {
    expect((await request(`${base}/submit`, { institutionId: institution, signature })).status).toBe(503);
    expect(await database.rowCount("certificate_attempts")).toBe(attemptsBefore);
    configure({ ...serviceBudget, maxWei: ((BigInt(attemptsBefore) + 1n) * 3000000000000000n).toString() });
    expect((await request(`${base}/submit`, { institutionId: institution, signature })).status).toBe(200);
    expect(await database.rowCount("certificate_attempts")).toBe(attemptsBefore + 1);
    // Backfill is idempotent: a reopened store must not count the old signatures twice.
    await database.reopen(); configure();
    expect((await json(`${base}/retry`, { institutionId: institution }, 200)).certificate.transactionHash).toBeDefined();
  } finally { configure(); }
});

it("refuses a certificate signed after the signatory mandate is revoked", async () => {
  const stores = configure();
  const { activityId, certificateId } = await seedCertifiableActivity(stores);
  const base = `workspace/activities/${activityId}/certificates/${certificateId}`;
  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  const signature = await account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));

  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registryAddress, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, false] }) });
  expect((await request(`${base}/submit`, { institutionId: institution, signature })).status).toBe(409);
  // The intent already exists for this certificateId; re-preparing re-reviews it rather than
  // re-checking chain authority from scratch, so a revoked mandate surfaces as stale (409).
  expect((await request(`${base}/prepare`, { institutionId: institution })).status).toBe(409);

  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registryAddress, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, true] }) });
  expect((await request(`${base}/submit`, { institutionId: institution, signature })).status).toBe(409);
});

it("retains a durable attempt when broadcast acknowledgement is lost, and retries identical bytes", async () => {
  const stores = configure();
  const { activityId, certificateId } = await seedCertifiableActivity(stores);
  const base = `workspace/activities/${activityId}/certificates/${certificateId}`;
  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  const signature = await account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));
  const attemptsBefore = await database.rowCount("certificate_attempts");

  mutateRpc = (method, body) => method === "eth_sendRawTransaction" ? { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "acknowledgement lost" } } : body;
  try { expect((await request(`${base}/submit`, { institutionId: institution, signature })).status).toBe(503); }
  finally { mutateRpc = null; }

  await database.reopen(); configure();
  const recovered = (await json(base)).certificate;
  expect(recovered.observation.state).toBe("INCLUDED");
  const repeated = (await json(`${base}/submit`, { institutionId: institution, signature }, 200)).certificate;
  expect(repeated.transactionHash).toBe(recovered.transactionHash);
  // One durable attempt row for this certificate's intent, however many times submit is retried.
  expect(await database.rowCount("certificate_attempts")).toBe(attemptsBefore + 1);
});

it("detects a non-canonical block and recovers once the receipt is confirmed again", async () => {
  const stores = configure();
  const { activityId, certificateId } = await seedCertifiableActivity(stores);
  const base = `workspace/activities/${activityId}/certificates/${certificateId}`;
  const prepared = (await json(`${base}/prepare`, { institutionId: institution })).certificate;
  const signature = await account.signTypedData(certificationTypedData(prepared.domain, prepared.certification));
  await json(`${base}/submit`, { institutionId: institution, signature }, 200);

  mutateRpc = (method, body) => { if (method === "eth_getBlockByNumber") body.result.hash = keccak256(toHex("replacement block")); return body; };
  try { expect((await json(base)).certificate.observation.state).toBe("NONCANONICAL"); }
  finally { mutateRpc = null; }
  expect((await json(base)).certificate.observation.state).toBe("INCLUDED");
});

it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser smoke: prepares, endorses, mints and verifies a certificate end to end", async () => {
  const stores = configure();
  const { activityId, certificateId } = await seedCertifiableActivity(stores);
  const result = await Bun.build({ entrypoints: [new URL("../../frontend/test/certificate-smoke.tsx", import.meta.url).pathname], target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "http://127.0.0.1:18604" }) } });
  if (!result.success) throw new Error(result.logs.join("\n"));
  const bundle = await result.outputs[0]!.text();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 18604, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
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
    page.on("pageerror", (error: Error) => console.error("Browser:", error.message));
    await page.goto("http://127.0.0.1:18604");
    await page.getByLabel("Kegiatan penyaluran").selectOption(activityId);
    await page.getByLabel("Identitas sertifikat").fill(certificateId);
    await page.getByRole("button", { name: "Mulai persiapan sertifikat" }).click();
    await page.getByRole("button", { name: "Siapkan pengesahan sertifikat" }).click();
    const sign = page.getByRole("button", { name: "Tandatangani dan terbitkan sertifikat" });
    await sign.waitFor();
    expect(await sign.isDisabled()).toBe(true);
    await page.getByLabel("Saya telah meninjau cakupan realisasi, totalnya, dan parameter pengesahan di atas.").check();
    await sign.click();
    await page.getByText("Sertifikat tercatat dalam blok", { exact: false }).waitFor();
    await rpc.request({ method: "evm_mine" as any });
    await page.getByRole("status").filter({ hasText: "Sertifikat terbit; tingkat konfirmasi tercapai" }).waitFor();
    const publicVerifier = page.getByRole("main");
    await publicVerifier.getByLabel("ID Sertifikat", { exact: true }).fill(certificateId);
    await publicVerifier.getByRole("button", { name: "Periksa", exact: true }).click();
    await publicVerifier.getByRole("heading", { name: /^Sertifikat #/ }).waitFor();
    expect(await publicVerifier.getByText("CONFIRMED", { exact: true }).count()).toBe(1);

    // A real SQL corruption must not be displayed under yesterday's success badge.
    const handle = database.handle();
    const store = createCertificateStore({ execute: (q) => handle.execute(q), transaction: (run) => handle.transaction((tx) => run({ execute: (q) => tx.execute(q) })) });
    const original = (await store.content(institution, certificateId))!;
    try {
      await handle.execute(sql`UPDATE certificate_intents SET content_canonical='{}' WHERE institution_id=${institution} AND id=${certificateId}`);
      await publicVerifier.getByRole("button", { name: "Periksa", exact: true }).click();
      await publicVerifier.getByRole("alert").waitFor();
      expect(await publicVerifier.getByText("CONFIRMED", { exact: true }).count()).toBe(0);
      expect(await publicVerifier.getByRole("heading", { name: /^Sertifikat #/ }).count()).toBe(0);
    } finally {
      await handle.execute(sql`UPDATE certificate_intents SET content_canonical=${original.canonical} WHERE institution_id=${institution} AND id=${certificateId}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await publicVerifier.getByLabel("ID Sertifikat", { exact: true }).focus();
    await page.keyboard.press("Enter");
    await publicVerifier.getByText("CONFIRMED", { exact: true }).waitFor();
    expect(await publicVerifier.getByRole("alert").count()).toBe(0);
    await page.screenshot({ path: new URL("../../.scratch/issue111-certificate-browser.png", import.meta.url).pathname, fullPage: true });
  } finally { await browser.close(); await server.stop(true); }

  const publicView = await (await request(`public/certificates/${institution}/${certificateId}`, undefined, "")).json();
  expect(publicView.success).toBe(true);
  expect(publicView.certificate.observation.state).toBe("CONFIRMED");
}, 60000);
