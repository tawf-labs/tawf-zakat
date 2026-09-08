import { mkdtemp, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import { createReportEndorsement } from "../src/report-endorsement";
import { afterAll, beforeAll, expect, it } from "bun:test";
import { createPublicClient, createWalletClient, http, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createEvidenceStore } from "../src/evidence-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { createRegistryStore } from "../src/registry-store";
import { createRegistryChain } from "../src/registry-chain";
import { reportRegistryAbi } from "../../shared/report-registry-abi";
import { evidenceTypedData } from "../../shared/report-registry";

// Published local Anvil key. This suite never accepts a network URL from the environment.
const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const validatorKey = `0x${"0".repeat(60)}5678` as Hex;
const validator = privateKeyToAccount(validatorKey);
const institution = "lpz-sinar-amanah";
const rpcUrl = "http://127.0.0.1:18572";
const rpc = createPublicClient({ chain: foundry, transport: http(rpcUrl, { retryCount: 0, timeout: 500 }) });
const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });
let node: ReturnType<typeof Bun.spawn>;
let fileDirectory: string;
let files: PrivateFileStore;
let validatorAvailable = true;
let database: TestWorkspaceDatabase;
let registry: Hex;
let token: string;
let packagePath: string;
let frozen: any;
let rejectBroadcast = false;
let mutateRpc: ((method: string, response: any) => any) | null = null;
let proxy: ReturnType<typeof Bun.serve>;
let receiptIntent: any;
let receiptSignature: Hex;

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
async function configure(clockOffset = 0) {
  const store = createWorkspaceStore(database.handle());
  const evidence = createEvidenceStore(database.handle());
  const registryStore = createRegistryStore(database.handle());
  await store.ensureSchema(); await evidence.ensureSchema(); await registryStore.ensureSchema();
  const chain = createRegistryChain({ rpcUrl: String(proxy.url), chainId: 31337, address: registry, requiredConfirmations: 2, privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" });
  configureWorkspace({ store, evidence, files, registry: { store: registryStore, chain, endorsement: validatorAvailable ? createReportEndorsement(validatorKey) : undefined }, now: () => Math.floor(Date.now() / 1000) + clockOffset, challengeTtlSeconds: 300, sessionTtlSeconds: 3600,
    ethCall: chain.accountSignatureCall });
  return store;
}
beforeAll(async () => {
  node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", "18572", "--silent"], { stdout: "ignore", stderr: "pipe" });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    try { await rpc.getChainId(); ready = true; break; } catch { await Bun.sleep(100); }
  }
  if (!ready) throw new Error("Local Anvil did not start");
  const artifact = await Bun.file(new URL("../../sc/out/ReportEvidenceRegistry.sol/ReportEvidenceRegistry.json", import.meta.url)).json();
  const deployment = await wallet.deployContract({ abi: reportRegistryAbi, bytecode: artifact.bytecode.object, args: [account.address] });
  registry = (await rpc.waitForTransactionReceipt({ hash: deployment })).contractAddress!;
  for (const args of [
    { functionName: "setValidator", args: [validator.address, true] },
    { functionName: "enrollInstitution", args: [institution, account.address] },
    { functionName: "setSignatory", args: [institution, account.address, true] },
  ] as const) await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, ...args } as any) });
  proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const body = await req.json();
    if (rejectBroadcast && body.method === "eth_sendRawTransaction") return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "transport refused before broadcast" } });
    const result = await (await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    return Response.json(mutateRpc ? mutateRpc(body.method, result) : result);
  } });
  fileDirectory = await mkdtemp(join(tmpdir(), "publication-files-"));
  files = createEncryptedFileStore({ directory: fileDirectory, key: Buffer.alloc(32, 73) });
  database = await createTestWorkspaceDatabase();
  const store = await configure();
  for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
  await store.upsertMembership({ institutionId: institution, account: account.address, role: "OFFICER" });
  const challenge = await json("workspace/challenge", { institutionId: institution, account: account.address });
  token = (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await account.signTypedData(challenge.typedData) })).token;
  const manifest = { label: "Local source", origin: "PASTE", scopeUnit: "Riau", scopeLevel: "PROVINSI", fundTypes: ["ZAKAT"], balanceSheet: "ON", currencyUnit: "IDR", period: { kind: "AKHIR_TAHUN", year: 2024 }, cutOff: "2025-02-11T00:00:00.000Z", format: "baris-ledger", mappingVersion: "1", transactionDetail: "PRESENT" };
  const preparation = (await json("evidence", { files: [{ role: "SOURCE", fileName: "synthetic.txt", mimeType: "text/plain", contentBase64: Buffer.from("synthetic private source").toString("base64") }], label: "Local gap", period: manifest.period, currencyUnit: "IDR", balanceSheetScope: "ON", claim: { manifest, rows: [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "200", unit: "IDR" } }] }, source: { manifest, rows: [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "100", unit: "IDR" } }] } })).preparation;
  const base = `evidence/${preparation.id}/reports`;
  const draft = (await json(base, { reportId: "local-2024", version: "1", mode: "HUMAN", draft: { narrative: "Temuan belum diperbaiki.", claims: [] } })).package;
  frozen = (await json(`${base}/${draft.id}/freeze`, {})).package;
  packagePath = `${base}/${frozen.id}/recording`;
}, 30000);
afterAll(async () => { resetWorkspace(); if (database) await database.close(); proxy?.stop(true); node?.kill(); if (fileDirectory) await rm(fileDirectory, { recursive: true, force: true }); });
it("records rejected evidence through API, signature, local EVM and durable receipt history", async () => {
  expect(frozen.verdict.outcome).toBe("DITOLAK");
  const intent = (await json(packagePath, { retryId: "first-review", digest: frozen.digest })).intent;
  expect(intent.authorization.packageId).toBe(frozen.id);
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  receiptIntent = intent; receiptSignature = signature;
  const result = await json(`${packagePath}/${intent.id}/submit`, { signature }, 200);
  expect(result.intent.observation.state).toBe("SUBMITTED");
  const included = (await json(`${packagePath}/${intent.id}`)).intent;
  expect(included.observation.state).toBe("INCLUDED");
  expect(included.observation.logIndex).toBeNumber();
  await rpc.request({ method: "evm_mine" as any });
  await database.reopen(); await configure();
  const confirmed = (await json(`${packagePath}/${intent.id}`)).intent;
  expect(confirmed.observation.state).toBe("CONFIRMED");
  expect(confirmed.observation.blockHash).toBe(included.observation.blockHash);
  const retry = (await json(packagePath, { retryId: "first-review", digest: frozen.digest })).intent;
  expect(retry.authorization).toEqual(intent.authorization);
  await json(`${packagePath}/${intent.id}/submit`, { signature }, 200);
  expect(await database.rowCount("registry_attempts")).toBe(1);
  expect(await rpc.readContract({ address: registry, abi: reportRegistryAbi, functionName: "evidenceDigest", args: [institution, frozen.id] })).toBe(frozen.digest);
  expect((await request(packagePath, { retryId: "first-review", digest: keccak256(toHex("changed")) })).status).toBe(409);
  expect((await request(`${packagePath}/${intent.id}/submit`, { signature, status: "CONFIRMED" })).status).toBe(400);
}, 15000);

it("refuses mismatched receipts, events and known noncanonical blocks through the HTTP boundary", async () => {
  const path = `${packagePath}/${receiptIntent.id}`;
  const variants: [string, (method: string, body: any) => any][] = [
    ["REVERTED", (method, body) => { if (method === "eth_getTransactionReceipt") body.result.status = "0x0"; return body; }],
    ["INVALID_EVENT", (method, body) => { if (method === "eth_getTransactionReceipt") body.result.logs = []; return body; }],
    ["INVALID_EVENT", (method, body) => { if (method === "eth_getTransactionReceipt") body.result.logs[0].address = account.address; return body; }],
    ["INVALID_EVENT", (method, body) => { if (method === "eth_getTransactionReceipt") body.result.logs[0].topics[3] = keccak256(toHex("wrong action authorization")); return body; }],
    ["NONCANONICAL", (method, body) => { if (method === "eth_getBlockByNumber") body.result.hash = keccak256(toHex("replacement block")); return body; }],
  ];
  try {
    for (const [state, mutate] of variants) {
      mutateRpc = mutate;
      expect((await json(path)).intent.observation.state).toBe(state);
      mutateRpc = null;
      expect((await json(path)).intent.observation.state).toBe("CONFIRMED");
    }
    mutateRpc = (method, body) => method === "eth_getTransactionReceipt" ? { ...body, result: null } : body;
    expect((await json(path)).intent.observation.state).toBe("SUBMITTED");
    mutateRpc = (method, body) => method === "eth_chainId" ? { ...body, result: "0x1" } : body;
    expect((await request(path)).status).toBe(503);
  } finally { mutateRpc = null; }
  expect((await json(path)).intent.observation.state).toBe("CONFIRMED");
});

async function freshPackage(passing = false, reportId = "local-2024", wrong = false) {
  const base = packagePath.split(`/${frozen.id}/recording`)[0]!;
  const review = await json(`${base}/review`);
  const draft = (await json(base, { reportId, version: "1", mode: "HUMAN",
    draft: { narrative: "Selisih dilaporkan sesuai sumber.", claims: passing ? review.figures.map((f: any) => ({ name: f.name, amount: wrong ? "999999999" : f.value.amount, unit: f.value.unit })) : [] },
    disclosure: review.disclosure })).package;
  const saved = (await json(`${base}/${draft.id}/freeze`, {})).package;
  return { saved, path: `${base}/${saved.id}/recording` };
}

it("rechecks chain authority and rejects changed, expired and malformed signatures without relaying", async () => {
  const { saved, path } = await freshPackage(true);
  expect(saved.verdict.outcome).toBe("LOLOS");
  const intent = (await json(path, { retryId: "passing-review", digest: saved.digest })).intent;
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  expect((await request(`${path}/${intent.id}/submit`, { signature: "0x1234" })).status).toBe(409);
  const changed = await account.signTypedData(evidenceTypedData(intent.domain, { ...intent.authorization, digest: keccak256(toHex("substituted")) }));
  expect((await request(`${path}/${intent.id}/submit`, { signature: changed })).status).toBe(409);
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, false] }) });
  expect((await request(path, { retryId: "unauthorized-review", digest: saved.digest })).status).toBe(403);
  expect((await request(`${path}/${intent.id}/submit`, { signature })).status).toBe(409);
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, true] }) });
  expect((await request(`${path}/${intent.id}/submit`, { signature })).status).toBe(409);
  const fresh = (await json(path, { retryId: "new-mandate-review", digest: saved.digest })).intent;
  const freshSignature = await account.signTypedData(evidenceTypedData(fresh.domain, fresh.authorization));
  await json(`${path}/${fresh.id}/submit`, { signature: freshSignature }, 200);
  expect((await json(`${path}/${fresh.id}`)).intent.observation.state).toBe("INCLUDED");
  expect(await database.rowCount("registry_attempts")).toBe(2);
});

it("retains a durable attempt when broadcast acknowledgement is lost, and retries identical bytes", async () => {
  const { saved, path } = await freshPackage();
  const intent = (await json(path, { retryId: "lost-response", digest: saved.digest })).intent;
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  mutateRpc = (method, body) => method === "eth_sendRawTransaction" ? { jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "acknowledgement lost" } } : body;
  try { expect((await request(`${path}/${intent.id}/submit`, { signature })).status).toBe(503); }
  finally { mutateRpc = null; }
  await database.reopen(); await configure();
  const recovered = (await json(`${path}/${intent.id}`)).intent;
  expect(recovered.observation.state).toBe("INCLUDED");
  const repeated = (await json(`${path}/${intent.id}/submit`, { signature }, 200)).intent;
  expect(repeated.transactionHash).toBe(recovered.transactionHash);
  expect(await database.rowCount("registry_attempts")).toBe(3);
});

it("supports institutional ERC-1271 preparation and real wallet validation through HTTP", async () => {
  const { saved, path } = await freshPackage();
  const artifact = await Bun.file(new URL("../../sc/out/ReportEvidenceRegistry.t.sol/RegistryWallet.json", import.meta.url)).json();
  const deployed = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [account.address] });
  const contractAccount = (await rpc.waitForTransactionReceipt({ hash: deployed })).contractAddress!;
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, contractAccount, true] }) });
  const store = createWorkspaceStore(database.handle());
  await store.upsertMembership({ institutionId: institution, account: contractAccount, role: "ADMIN" });
  const oldToken = token;
  try {
    const challenge = await json("workspace/challenge", { institutionId: institution, account: contractAccount });
    token = (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await account.signTypedData(challenge.typedData) })).token;
    const intent = (await json(path, { retryId: "contract-wallet", digest: saved.digest })).intent;
    expect(intent.accountKind).toBe("ERC1271");
    expect(intent.authorization.signer.toLowerCase()).toBe(contractAccount.toLowerCase());
    const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
    await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: contractAccount, abi: artifact.abi, functionName: "setMode", args: [2] }) });
    expect((await request(`${path}/${intent.id}/submit`, { signature })).status).toBe(409);
    await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: contractAccount, abi: artifact.abi, functionName: "setMode", args: [0] }) });
    await json(`${path}/${intent.id}/submit`, { signature }, 200);
    expect((await json(`${path}/${intent.id}`)).intent.observation.state).toBe("INCLUDED");
    const bundle = await (await request(path.replace(/recording$/, "examination"))).json();
    const { verifyExamination } = await import("../src/report-verifier");
    expect((await verifyExamination(bundle)).contractSignatures).toBe("REQUIRES_RPC");
    expect((await verifyExamination(bundle, { rpcUrl, chainId: 31337, registry })).ok).toBe(true);
  } finally { token = oldToken; }
});

it("withdraws inclusion after a local reorg, then rebroadcasts the same authorization", async () => {
  const { saved, path } = await freshPackage();
  const intent = (await json(path, { retryId: "reorganized", digest: saved.digest })).intent;
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  const snapshot = await rpc.request({ method: "evm_snapshot" as any });
  await json(`${path}/${intent.id}/submit`, { signature }, 200);
  const included = (await json(`${path}/${intent.id}`)).intent;
  expect(included.observation.state).toBe("INCLUDED");
  await rpc.request({ method: "evm_revert" as any, params: [snapshot] as any });
  expect((await json(`${path}/${intent.id}`)).intent.observation.state).toBe("NONCANONICAL");
  await json(`${path}/${intent.id}/submit`, { signature }, 200);
  const restored = (await json(`${path}/${intent.id}`)).intent;
  expect(restored.observation.state).toBe("INCLUDED");
  expect(restored.transactionHash).toBe(included.transactionHash);
});

it("rejects expired authorization at submission without spending another relayer nonce", async () => {
  const { saved, path } = await freshPackage();
  const intent = (await json(path, { retryId: "expires", digest: saved.digest })).intent;
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  const snapshot = await rpc.request({ method: "evm_snapshot" as any });
  const count = await database.rowCount("registry_attempts");
  try {
    await rpc.request({ method: "evm_increaseTime" as any, params: [700] as any });
    await rpc.request({ method: "evm_mine" as any });
    expect((await request(`${path}/${intent.id}/submit`, { signature })).status).toBe(409);
    expect(await database.rowCount("registry_attempts")).toBe(count);
  } finally { await rpc.request({ method: "evm_revert" as any, params: [snapshot] as any }); }
});

it("recovers an unbroadcast durable transaction in a new session without another wallet signature", async () => {
  const { saved, path } = await freshPackage();
  const intent = (await json(path, { retryId: "before-broadcast-crash", digest: saved.digest })).intent;
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  rejectBroadcast = true;
  try { expect((await request(`${path}/${intent.id}/submit`, { signature })).status).toBe(503); }
  finally { rejectBroadcast = false; }
  await database.reopen(); await configure();
  const history = await json(path);
  expect(history.intents[0].observation.state).toBe("SUBMITTED");
  expect(history.intents[0].authorization).toEqual(intent.authorization);
  expect((await request(`${path}/${intent.id}/retry`, { digest: "changed" })).status).toBe(400);
  await json(`${path}/${intent.id}/retry`, {}, 200);
  expect((await json(`${path}/${intent.id}`)).intent.observation.state).toBe("INCLUDED");
});

for (const publication of [false, true]) it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(publication ? "browser smoke: publishes with two endorsements and detects a later reorg" : "browser smoke: reviews rejected package, signs, recovers history and notices a later reorg", async () => {
  const { saved, path } = await freshPackage(publication, `browser-${crypto.randomUUID()}`);
  const preparationId = path.split('/')[1]!;
  const preparation = await json(`evidence/${preparationId}`);
  const result = await Bun.build({ entrypoints: [new URL('../../frontend/test/registry-smoke.tsx', import.meta.url).pathname], target: 'browser', define: { 'import.meta.env': JSON.stringify({ VITE_API_BASE_URL: 'http://127.0.0.1:18573' }) } });
  if (!result.success) throw new Error(result.logs.join('\n'));
  const bundle = await result.outputs[0]!.text();
  const server = Bun.serve({ hostname: '127.0.0.1', port: 18573, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/') return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname === '/smoke.js') return new Response(bundle, { headers: { 'Content-Type': 'application/javascript' } });
    if (url.pathname === '/smoke-config') return Response.json({ preparationId, token, canPrepare: true, commitmentSalt: preparation.preparation.commitmentSalt });
    if (url.pathname === '/wallet-rpc') {
      const { method, params } = await req.json();
      if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return Response.json([account.address]);
      if (method === 'eth_chainId') return Response.json('0x7a69');
      if (method === 'eth_signTypedData_v4') return Response.json(await account.signTypedData(JSON.parse(params[1])));
      if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return Response.json([{ parentCapability: 'eth_accounts' }]);
      return Response.json(null);
    }
    return app.fetch(req);
  } });
  const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
  const browser = await chromium.launch({ ...(process.env.REGISTRY_BROWSER_EXECUTABLE ? { executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE } : {}), headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (error: Error) => console.error('Browser:', error.message));
    await page.goto('http://127.0.0.1:18573');
    await page.getByLabel('Paket tersimpan').selectOption(saved.id);
    const panel = page.getByRole('heading', { name: publication ? 'Penerbitan laporan' : 'Pengesahan pencatatan bukti', exact: true }).locator('..');
    await panel.getByRole('button', { name: publication ? 'Minta pengesahan validator' : 'Siapkan pengesahan pencatatan' }).click();
    const sign = panel.getByRole('button', { name: publication ? 'Tandatangani penerbitan laporan' : 'Tandatangani pencatatan bukti' });
    await sign.waitFor();
    expect(await sign.isDisabled()).toBe(true);
    await panel.getByText('Cakupan sumber dan temuan paket beku', { exact: true }).click();
    expect(await page.locator('body').innerText()).toContain(publication ? 'LOLOS' : 'DITOLAK');
    await panel.getByLabel('Saya telah meninjau isi, cakupan sumber, temuan, digest, tujuan, dan parameter pengesahan di atas.').check();
    const snapshot = await rpc.request({ method: 'evm_snapshot' as any });
    await sign.click();
    await panel.getByText(publication ? 'Penerbitan masuk blok; menunggu konfirmasi' : 'Bukti tercatat dalam blok; konfirmasi belum cukup', { exact: true }).waitFor();
    await rpc.request({ method: 'evm_mine' as any });
    await panel.getByText(publication ? 'Laporan terbit; tingkat konfirmasi tercapai' : 'Bukti tercatat; tingkat konfirmasi tercapai', { exact: true }).waitFor();
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByLabel('Paket tersimpan').selectOption(saved.id);
    await panel.getByText(publication ? 'Laporan terbit; tingkat konfirmasi tercapai' : 'Bukti tercatat; tingkat konfirmasi tercapai', { exact: true }).waitFor();
    await rpc.request({ method: 'evm_revert' as any, params: [snapshot] as any });
    await panel.getByText(publication ? 'Blok berubah; penerbitan perlu diperiksa ulang' : 'Blok berubah; pencatatan perlu diperiksa ulang', { exact: true }).waitFor();
    await panel.getByRole('button', { name: 'Kirim ulang transaksi tersimpan' }).click();
    await panel.getByText(publication ? 'Penerbitan masuk blok; menunggu konfirmasi' : 'Bukti tercatat dalam blok; konfirmasi belum cukup', { exact: true }).waitFor();
    await page.screenshot({ path: `/tmp/ticket73-browser-${publication ? 'publication' : 'recording'}.png`, fullPage: true });
  } finally { await browser.close(); server.stop(true); }
}, 60000);


it("publishes one official version using recomputed validator endorsement and both real signatures", async () => {
  const { saved, path: recording } = await freshPackage(true);
  const path = recording.replace(/recording$/, "publication");
  const intent = (await json(path, { retryId: "publication-first", digest: saved.digest })).intent;
  expect(intent.validator.authorization.outcome).toBe("LOLOS");
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  await json(`${path}/${intent.id}/submit`, { signature }, 200);
  expect((await json(`${path}/${intent.id}`)).intent.observation.state).toBe("INCLUDED");
  await rpc.request({ method: "evm_mine" as any });
  await database.reopen(); await configure();
  const confirmed = (await json(`${path}/${intent.id}`)).intent;
  expect(confirmed.observation.state).toBe("CONFIRMED");
  expect((await json(path, { retryId: intent.id, digest: saved.digest })).intent.authorization).toEqual(intent.authorization);
  const version = (await json(`${path}/version`)).version;
  expect(version.publication).toBe("PUBLISHED");
  expect(version.auditor).toBe("NOT_EXAMINED");
  expect(version.packageId).toBe(saved.id);
  expect(version.reportId).toBe(saved.reportId);
  expect((await json(`${path}/${intent.id}/retry`, {}, 200)).intent.transactionHash).toBe(confirmed.transactionHash);
}, 15000);


it("validator refuses wrong drafts, missing claims, unavailable files and outage without losing evidence", async () => {
  for (const [passing, wrong] of [[false, false], [true, true]]) {
    const { saved, path } = await freshPackage(passing, crypto.randomUUID(), wrong);
    const publication = path.replace(/recording$/, "publication");
    const response = await request(publication, { retryId: crypto.randomUUID(), digest: saved.digest });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Validator menolak");
    expect((await json(publication)).intents).toEqual([]);
    expect((await json(path.replace(/\/recording$/, ""))).package.verdict.outcome).toBe("DITOLAK");
  }
  const { saved, path } = await freshPackage(true, "outage-report");
  const publication = path.replace(/recording$/, "publication");
  validatorAvailable = false; await configure();
  expect((await request(publication, { retryId: "outage", digest: saved.digest })).status).toBe(503);
  validatorAvailable = true; await configure();
  await rename(fileDirectory, `${fileDirectory}-unavailable`);
  try { expect((await request(publication, { retryId: "missing-file", digest: saved.digest })).status).toBe(409); }
  finally { await rename(`${fileDirectory}-unavailable`, fileDirectory); }
  expect((await json(publication, { retryId: "outage", digest: saved.digest })).intent.validator.authorization.outcome).toBe("LOLOS");
});

it("publication rechecks validator at execution, verifies events and recovers after a real reorg", async () => {
  const { saved, path: recording } = await freshPackage(true, "reorg-publication");
  const path = recording.replace(/recording$/, "publication");
  const old = (await json(path, { retryId: "revoked-publication", digest: saved.digest })).intent;
  const signature = await account.signTypedData(evidenceTypedData(old.domain, old.authorization));
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setValidator", args: [validator.address, false] }) });
  expect((await request(`${path}/${old.id}/submit`, { signature })).status).toBe(409);
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setValidator", args: [validator.address, true] }) });
  expect((await request(`${path}/${old.id}/submit`, { signature })).status).toBe(409);
  const intent = (await json(path, { retryId: "renewed-publication", digest: saved.digest })).intent;
  const signed = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  const snapshot = await rpc.request({ method: "evm_snapshot" as any });
  await json(`${path}/${intent.id}/submit`, { signature: signed }, 200);
  await rpc.request({ method: "evm_mine" as any });
  expect((await json(`${path}/version`)).version.publication).toBe("PUBLISHED");
  try {
    for (const mutate of [
      (m: string, b: any) => { if (m === "eth_getTransactionReceipt") b.result.status = "0x0"; return b; },
      (m: string, b: any) => { if (m === "eth_getTransactionReceipt") b.result.logs[0].topics[3] = keccak256(toHex("wrong")); return b; },
      (m: string, b: any) => { if (m === "eth_getTransactionReceipt") b.result.logs = []; return b; },
    ]) { mutateRpc = mutate; expect((await json(`${path}/version`)).version.publication).toBe("NOT_PUBLISHED"); }
  } finally { mutateRpc = null; }
  expect((await json(`${path}/version`)).version.publication).toBe("PUBLISHED");
  await rpc.request({ method: "evm_revert" as any, params: [snapshot] as any });
  expect((await json(`${path}/version`)).version.publication).toBe("NOT_PUBLISHED");
  await database.reopen(); await configure();
  await json(`${path}/${intent.id}/retry`, {}, 200);
  await rpc.request({ method: "evm_mine" as any });
  expect((await json(`${path}/version`)).version.publication).toBe("PUBLISHED");
}, 15000);


it("does not endorse a package whose mandatory source was never supplied", async () => {
  const manifest = frozen.snapshot.sides[0].manifest;
  const preparation = (await json("evidence", { label: "Missing mandatory source", period: manifest.period, currencyUnit: "IDR", balanceSheetScope: "ON",
    claim: { manifest, rows: [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "100", unit: "IDR" } }] },
    source: { manifest, status: "MISSING", detail: "Belum dikirim" } })).preparation;
  const base = `evidence/${preparation.id}/reports`;
  const review = await json(`${base}/review`);
  const draft = (await json(base, { reportId: "missing-source", version: "1", mode: "HUMAN", draft: { narrative: "Sumber belum tersedia.", claims: [] }, disclosure: review.disclosure })).package;
  const saved = (await json(`${base}/${draft.id}/freeze`, {})).package;
  const response = await request(`${base}/${saved.id}/publication`, { retryId: "missing-source", digest: saved.digest });
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain("Sumber wajib SOURCE tidak tersedia");
});

it("rechecks mandatory files before first relay even after validator endorsement", async () => {
  const { saved, path: recording } = await freshPackage(true, "files-after-endorsement");
  const path = recording.replace(/recording$/, "publication");
  expect((await request(path, { retryId: "forged", digest: saved.digest, outcome: "LOLOS", withinCeiling: true })).status).toBe(400);
  const intent = (await json(path, { retryId: "files-later", digest: saved.digest })).intent;
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  await rename(fileDirectory, `${fileDirectory}-unavailable`);
  try { expect((await request(`${path}/${intent.id}/submit`, { signature })).status).toBe(409); }
  finally { await rename(`${fileDirectory}-unavailable`, fileDirectory); }
  expect((await json(`${path}/${intent.id}`)).intent.observation.state).toBe("PREPARED");
  await json(`${path}/${intent.id}/submit`, { signature }, 200);
});


it("requires available files for pending rebroadcast but preserves included receipt recovery", async () => {
  const { saved, path: recording } = await freshPackage(true, "pending-files");
  const path = recording.replace(/recording$/, "publication");
  const intent = (await json(path, { retryId: "pending-files", digest: saved.digest })).intent;
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  rejectBroadcast = true;
  try { expect((await request(`${path}/${intent.id}/submit`, { signature })).status).toBe(503); }
  finally { rejectBroadcast = false; }
  await rename(fileDirectory, `${fileDirectory}-unavailable`);
  try { expect((await request(`${path}/${intent.id}/retry`, {})).status).toBe(409); }
  finally { await rename(`${fileDirectory}-unavailable`, fileDirectory); }
  await json(`${path}/${intent.id}/retry`, {}, 200);
  await rename(fileDirectory, `${fileDirectory}-unavailable`);
  try { expect((await json(`${path}/${intent.id}/retry`, {}, 200)).intent.observation.state).toBe("INCLUDED"); }
  finally { await rename(`${fileDirectory}-unavailable`, fileDirectory); }
});

let publicPackage: any;
let examinationPath: string;
it("opens a published summary anonymously while keeping the same-version examination export private", async () => {
  const { saved, path: recording } = await freshPackage(true, "private-report-label-NIK-1234567890123456");
  const publication = recording.replace(/recording$/, "publication");
  publicPackage = saved;
  examinationPath = recording.replace(/recording$/, "examination");
  expect((await request(`public/reports/${saved.id}`, undefined, "")).status).toBe(404);
  const intent = (await json(publication, { retryId: "public-summary", digest: saved.digest })).intent;
  await json(`${publication}/${intent.id}/submit`, { signature: await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization)) }, 200);
  await rpc.request({ method: "evm_mine" as any });
  const response = await request(`public/reports/${saved.id}`, undefined, "");
  expect(response.status).toBe(200);
  const summary = (await response.json()).summary;
  expect(summary.publication.state).toBe("PUBLISHED");
  expect(summary.validator.outcome).toBe("LOLOS");
  expect(summary.auditor).toBe("NOT_EXAMINED");
  expect(summary.content.findings.netDelta.amount).toBe("100");
  expect(summary.files.available).toBe(1);
  expect(summary.network.chainId).toBe(31337);
  expect(summary.network.name).toContain("lokal");
  expect(JSON.stringify(summary)).not.toContain(saved.reportId);
  for (const secret of ["synthetic private source", "synthetic.txt", "commitmentSalt", "storageRef", "contentBase64", "narrative"]) expect(JSON.stringify(summary)).not.toContain(secret);
  expect((await request(examinationPath, undefined, "")).status).toBe(401);
  const exported = await request(examinationPath);
  expect(exported.status).toBe(200);
  expect(exported.headers.get("Cache-Control")).toContain("no-store");
  expect(exported.headers.get("Vary")).toContain("Authorization");
  const bundle = await exported.json();
  expect(JSON.parse(bundle.packageCanonical).id).toBe(saved.id);
  expect(bundle.files[0].contentBase64).toBe(Buffer.from("synthetic private source").toString("base64"));
});

it("exports and reimports with the real local verifier, rejecting changed files, amounts, policies and signatures", async () => {
  const bundle = await (await request(examinationPath)).json();
  const target = join(fileDirectory, "examination.json");
  const run = async (value: any) => {
    await Bun.write(target, JSON.stringify(value));
    const proc = Bun.spawn(["bun", new URL("../src/scripts/verify-report.ts", import.meta.url).pathname, target], { stdout: "pipe", stderr: "pipe" });
    return { code: await proc.exited, output: await new Response(proc.stdout).text() };
  };
  const valid = await run(bundle);
  expect(valid.code).toBe(0);
  const result = JSON.parse(valid.output);
  expect(result.commitments).toBe("MATCH");
  expect(result.recomputed.verdict.outcome).toBe("LOLOS");
  expect(result.chain).toBe("NOT_CHECKED_OFFLINE");
  for (const mutate of [
    (b: any) => { b.files[0].contentBase64 = Buffer.from("substituted bank source").toString("base64"); },
    (b: any) => { const p = JSON.parse(b.packageCanonical); p.figures[0].value.amount = "999999999999999999999999999999999"; b.packageCanonical = JSON.stringify(p); },
    (b: any) => { const p = JSON.parse(b.packageCanonical); p.policy.id = "other-policy"; b.packageCanonical = JSON.stringify(p); },
    (b: any) => { b.proofs[0].signature = `0x${"00".repeat(65)}`; },
  ]) {
    const changed = structuredClone(bundle); mutate(changed);
    expect((await run(changed)).code).not.toBe(0);
  }
});

it("checks reader membership, institution and expiry on each export and source retrieval", async () => {
  const reader = privateKeyToAccount(`0x${"0".repeat(63)}2`);
  const stranger = privateKeyToAccount(`0x${"0".repeat(63)}3`);
  const store = createWorkspaceStore(database.handle());
  async function session(who: typeof reader, institutionId: string) {
    await store.upsertMembership({ institutionId, account: who.address, role: "READER" });
    const c = await json("workspace/challenge", { institutionId, account: who.address });
    return (await json("workspace/session", { nonce: c.challenge.nonce, signature: await who.signTypedData(c.typedData) })).token;
  }
  const readerToken = await session(reader, institution);
  const otherToken = await session(stranger, "lpz-baitul-maal");
  const filePath = `evidence/${publicPackage.preparationId}/files/${publicPackage.snapshot.files[0].id}`;
  for (const path of [examinationPath, filePath]) {
    const allowed = await request(path, undefined, readerToken);
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("Cache-Control")).toContain("no-store");
    expect((await request(path, undefined, otherToken)).status).toBe(404);
    expect((await request(`${path}?token=${readerToken}`, undefined, "")).status).toBe(401);
  }
  await configure(4000);
  try { expect((await request(examinationPath, undefined, readerToken)).status).toBe(401); }
  finally { await configure(); }
  await store.deactivateMembership({ institutionId: institution, account: reader.address });
  expect((await request(examinationPath, undefined, readerToken)).status).toBe(403);
  await store.upsertMembership({ institutionId: institution, account: reader.address, role: "READER" });
  const { hashToken } = await import("../src/workspace-session");
  await store.revokeSession(hashToken(readerToken), Math.floor(Date.now() / 1000));
  expect((await request(examinationPath, undefined, readerToken)).status).toBe(401);
});

it("reports later missing files and a noncanonical block without replacing the published snapshot", async () => {
  const original = await (await request(`public/reports/${publicPackage.id}`, undefined, "")).json();
  await rename(fileDirectory, `${fileDirectory}-unavailable`);
  try {
    const summary = (await (await request(`public/reports/${publicPackage.id}`, undefined, "")).json()).summary;
    expect(summary.files.available).toBe(0); expect(summary.files.missing).toBe(1);
    expect(summary.publication.state).toBe("PUBLISHED");
    const bundle = await (await request(examinationPath)).json();
    expect(bundle.files[0].state).toBe("MISSING");
    expect(bundle.files[0].contentBase64).toBeUndefined();
    expect(bundle.packageDigest).toBe(publicPackage.digest);
    expect(summary.summaryDigest).toBe(original.summary.summaryDigest);
  } finally { await rename(`${fileDirectory}-unavailable`, fileDirectory); }
  mutateRpc = (m, b) => { if (m === "eth_getBlockByNumber") b.result.hash = keccak256(toHex("reorganized public block")); return b; };
  try {
    const summary = (await (await request(`public/reports/${publicPackage.id}`, undefined, "")).json()).summary;
    expect(summary.publication.state).toBe("NOT_PUBLISHED");
    expect(summary.anchor.state).toBe("NONCANONICAL");
    expect(summary.anchor.transactionHash).toBe(original.summary.anchor.transactionHash);
  } finally { mutateRpc = null; }
});

it("verifies the actual canonical receipt against an independently chosen local deployment", async () => {
  const bundle = await (await request(examinationPath)).json();
  const { verifyExamination } = await import("../src/report-verifier");
  const result = await verifyExamination(bundle, { rpcUrl, chainId: 31337, registry });
  expect(result.ok).toBe(true);
  expect(result.chain).toBe("CANONICAL_RECEIPTS_CHECKED");
  await expect(verifyExamination(bundle, { rpcUrl, chainId: 1, registry })).rejects.toThrow();
  const changed = structuredClone(bundle); changed.proofs[0].signature = `0x${"00".repeat(65)}`;
  await expect(verifyExamination(changed, { rpcUrl, chainId: 31337, registry })).rejects.toThrow();
});

it("preserves very large figures but excludes free-text identities from public content", async () => {
  const secret = "NIK-1234567890123456 BANK-987654321";
  const manifest = { ...publicPackage.snapshot.sides[0].manifest, scopeLevel: secret, scopeUnit: secret, label: secret, transactionDetail: "NOT_AVAILABLE" };
  const amount = "900719925474099312345678901234567890";
  const preparation = (await json("evidence", { label: secret, period: manifest.period, currencyUnit: "IDR", balanceSheetScope: "ON",
    claim: { manifest, rows: [{ key: secret, label: secret, bucket: "ZAKAT", balanceSheet: "ON", value: { amount, unit: "IDR" } }] },
    source: { manifest, rows: [{ key: secret, label: secret, bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "0", unit: "IDR" } }] } })).preparation;
  const base = `evidence/${preparation.id}/reports`;
  const review = await json(`${base}/review`);
  const draft = (await json(base, { reportId: secret, version: secret, mode: "HUMAN", draft: { narrative: secret, claims: review.figures.map((f: any) => ({ name: f.name, ...f.value })) }, disclosure: review.disclosure })).package;
  const saved = (await json(`${base}/${draft.id}/freeze`, {})).package;
  const path = `${base}/${saved.id}/publication`;
  const intent = (await json(path, { retryId: "big-public", digest: saved.digest })).intent;
  await json(`${path}/${intent.id}/submit`, { signature: await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization)) }, 200);
  await rpc.request({ method: "evm_mine" as any });
  const response = await request(`public/reports/${saved.id}`, undefined, "");
  expect(response.status).toBe(200);
  const serialized = await response.text();
  expect(serialized).not.toContain(secret);
  expect(JSON.parse(serialized).summary.content.findings.netDelta.amount).toBe(amount);
  expect(JSON.parse(serialized).summary.content.limitations).toContain("TRANSACTION_DETAIL_UNAVAILABLE");
  const bundle = await (await request(`${base}/${saved.id}/examination`)).json();
  const { verifyExamination } = await import("../src/report-verifier");
  const result = await verifyExamination(bundle);
  expect(result.ok).toBe(true);
  expect(result.recomputed.reconciliation.netDelta.amount).toBe(amount);
});

it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: anonymous public summary and authorized examination download reproduce the same figures", async () => {
  const reader = privateKeyToAccount(`0x${"0".repeat(63)}4`);
  const store = createWorkspaceStore(database.handle());
  await store.upsertMembership({ institutionId: institution, account: reader.address, role: "READER" });
  const challenge = await json("workspace/challenge", { institutionId: institution, account: reader.address });
  const readerToken = (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await reader.signTypedData(challenge.typedData) })).token;
  const prep = await json(`evidence/${publicPackage.preparationId}`);
  const bundles: Record<string, string> = {};
  for (const [name, file] of [["public", "public-report-smoke.tsx"], ["private", "registry-smoke.tsx"]]) {
    const built = await Bun.build({ entrypoints: [new URL(`../../frontend/test/${file}`, import.meta.url).pathname], target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "http://127.0.0.1:18574" }) } });
    if (!built.success) throw new Error(built.logs.join("\n"));
    bundles[name!] = await built.outputs[0]!.text();
  }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 18574, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/public-demo" || path === "/") return new Response(`<div id="root"></div><script type="module" src="/${path === "/public-demo" ? "public" : "private"}.js"></script>`, { headers: { "Content-Type": "text/html" } });
    if (path === "/public.js" || path === "/private.js") return new Response(bundles[path.slice(1, -3)], { headers: { "Content-Type": "text/javascript" } });
    if (path === "/smoke-config") return Response.json({ preparationId: publicPackage.preparationId, token: readerToken, canPrepare: false, commitmentSalt: prep.preparation.commitmentSalt });
    if (path === "/wallet-rpc") {
      const { method } = await req.json();
      return Response.json(method === "eth_chainId" ? "0x7a69" : [reader.address]);
    }
    return app.fetch(req);
  } });
  const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
  const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    const anonymousRequests: string[] = [];
    page.on("request", (r: any) => { if (r.url().includes("/api/")) anonymousRequests.push(r.headers().authorization ?? "ANONYMOUS"); });
    await page.goto(`http://127.0.0.1:18574/public-demo?packageId=${publicPackage.id}`);
    await page.getByText("Laporan terbit", { exact: true }).waitFor();
    expect(await page.locator("body").innerText()).toContain("100 IDR");
    expect(await page.locator("body").innerText()).not.toContain(publicPackage.reportId);
    expect(anonymousRequests.length).toBeGreaterThan(0);
    expect(anonymousRequests.every(value => value === "ANONYMOUS")).toBe(true);
    await page.screenshot({ path: "/tmp/ticket74-public-smoke.png", fullPage: true });
    await page.goto("http://127.0.0.1:18574/");
    await page.getByLabel("Paket tersimpan").selectOption(publicPackage.id);
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Unduh paket pemeriksaan terbatas" }).click();
    const target = join(fileDirectory, "browser-examination.json");
    await (await downloaded).saveAs(target);
    const runner = Bun.spawn(["bun", new URL("../src/scripts/verify-report.ts", import.meta.url).pathname, target], { stdout: "pipe", stderr: "pipe" });
    expect(await runner.exited).toBe(0);
    expect(JSON.parse(await new Response(runner.stdout).text()).recomputed.reconciliation.netDelta.amount).toBe("100");
    await store.deactivateMembership({ institutionId: institution, account: reader.address });
    await page.getByRole("button", { name: "Unduh paket pemeriksaan terbatas" }).click();
    await page.getByText("Paket pemeriksaan tidak tersedia atau akses sudah berakhir.", { exact: true }).waitFor();
  } finally { await browser.close(); server.stop(true); }
}, 60000);


it("distinguishes corrupted source bytes from missing files in the actual examination verifier", async () => {
  const record = await createEvidenceStore(database.handle()).getPreparation(institution, publicPackage.preparationId);
  const file = record!.files[0]!;
  const original = await files.get(file.storageRef!);
  await files.put({ institutionId: institution, preparationId: publicPackage.preparationId, fileId: file.id, bytes: new TextEncoder().encode("changed bank file") });
  try {
    const bundle = await (await request(examinationPath)).json();
    expect(bundle.files[0].state).toBe("INTEGRITY_FAILED");
    const { verifyExamination } = await import("../src/report-verifier");
    await expect(verifyExamination(bundle)).rejects.toThrow("Integritas berkas");
  } finally { await files.put({ institutionId: institution, preparationId: publicPackage.preparationId, fileId: file.id, bytes: original! }); }
});
