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
import { attestationTypedData, evidenceTypedData } from "../../shared/report-registry";

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
  expect((await json(`${path}/${old.id}`)).intent.signingAuthority).toBe("STALE");
  expect((await request(path, { retryId: old.id, digest: saved.digest })).status).toBe(409);
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
  await store.upsertMembership({ institutionId: institution, account: account.address, role: "ADMIN" });
  expect((await request("workspace/members/revoke", { account: reader.address })).status).toBe(200);
  await store.upsertMembership({ institutionId: institution, account: account.address, role: "OFFICER" });
  expect((await request(examinationPath, undefined, readerToken)).status).toBe(401);
  expect((await request(filePath, undefined, readerToken)).status).toBe(401);
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


// ---- Ticket #75: corrections publish a successor version without overwriting history ----

const manifestOf = () => frozen.snapshot.sides[0].manifest;
async function correctionPreparation(claim: string, source: string, label: string) {
  const manifest = manifestOf();
  return (await json("evidence", {
    files: [{ role: "SOURCE", fileName: "koreksi.txt", mimeType: "text/plain", contentBase64: Buffer.from(`sumber ${label} ${claim}/${source}`).toString("base64") }],
    label, period: manifest.period, currencyUnit: "IDR", balanceSheetScope: "ON",
    claim: { manifest, rows: [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: claim, unit: "IDR" } }] },
    source: { manifest, rows: [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: source, unit: "IDR" } }] },
  })).preparation;
}
async function frozenVersion(preparationId: string, body: Record<string, unknown>) {
  const base = `evidence/${preparationId}/reports`;
  const review = await json(`${base}/review`);
  const draft = (await json(base, { mode: "HUMAN", ...body, disclosure: review.disclosure,
    draft: { narrative: "Selisih dilaporkan sesuai sumber.", claims: review.figures.map((f: any) => ({ name: f.name, amount: f.value.amount, unit: f.value.unit })) } })).package;
  return (await json(`${base}/${draft.id}/freeze`, {})).package;
}
const publicationPath = (saved: any) => `evidence/${saved.preparationId}/reports/${saved.id}/publication`;
async function publishVersion(saved: any, retryId: string) {
  const path = publicationPath(saved);
  const intent = (await json(path, { retryId, digest: saved.digest })).intent;
  const signature = await account.signTypedData(evidenceTypedData(intent.domain, intent.authorization));
  await json(`${path}/${intent.id}/submit`, { signature }, 200);
  await rpc.request({ method: "evm_mine" as any });
  return { path, intent, signature };
}

let correctedReport: string;
let firstVersion: any;
let correctedVersion: any;

it("publishes a correction that succeeds the official version and keeps the superseded one readable", async () => {
  correctedReport = `koreksi-${crypto.randomUUID()}`;
  const first = await correctionPreparation("200", "100", "Versi pertama");
  firstVersion = await frozenVersion(first.id, { reportId: correctedReport, version: "1" });
  const original = await publishVersion(firstVersion, "koreksi-versi-1");
  expect((await json(`${original.path}/version`)).version.versionState).toBe("VERSI_RESMI_TERKINI");

  // A correction is prepared from a new snapshot; the review shows what changes before anything is saved.
  const second = await correctionPreparation("200", "150", "Snapshot koreksi");
  const preview = (await json(`evidence/${second.id}/reports/correction?predecessor=${firstVersion.id}`)).correction;
  expect(preview.predecessor.version).toBe("1");
  expect(preview.predecessor.digest).toBe(firstVersion.digest);
  expect(preview.samePreparation).toBe(false);
  expect(preview.reasonRequired).toBe(true);
  expect(preview.sources.map((s: any) => s.role)).toEqual(["CLAIM", "SOURCE"]);
  expect(preview.sources.every((s: any) => s.state === "TETAP")).toBe(true);
  const delta = preview.changes.find((c: any) => c.name === "rekonsiliasi.selisih");
  expect(delta.before.amount).toBe("100");
  expect(delta.after.amount).toBe("50");
  expect(delta.state).toBe("BERUBAH");
  expect(preview.changes.some((c: any) => c.state === "TETAP")).toBe(true);

  // A reason is required, and the predecessor must be another frozen version of the same report.
  expect((await request(`evidence/${second.id}/reports`, { reportId: correctedReport, version: "2", mode: "HUMAN", predecessor: firstVersion.id, draft: { narrative: "x", claims: [] } })).status).toBe(400);
  expect((await request(`evidence/${second.id}/reports`, { reportId: "laporan-lain", version: "2", mode: "HUMAN", predecessor: firstVersion.id, correctionReason: "salah", draft: { narrative: "x", claims: [] } })).status).toBe(400);

  correctedVersion = await frozenVersion(second.id, { reportId: correctedReport, version: "2", predecessor: firstVersion.id, correctionReason: "Angka sumber diperbaiki setelah rekonsiliasi bank." });
  expect(correctedVersion.predecessor).toBe(firstVersion.id);
  const corrected = await publishVersion(correctedVersion, "koreksi-versi-2");

  const now = (await json(`${corrected.path}/version`)).version;
  expect(now.publication).toBe("PUBLISHED");
  expect(now.versionState).toBe("VERSI_RESMI_TERKINI");
  expect(now.predecessor).toBe(firstVersion.id);
  expect(now.correctionReason).toContain("Angka sumber diperbaiki");
  // The version it succeeded stays published under its own identity, now marked as superseded.
  const superseded = (await json(`${original.path}/version`)).version;
  expect(superseded.publication).toBe("PUBLISHED");
  expect(superseded.versionState).toBe("DIGANTIKAN_KOREKSI");
  expect(superseded.officialPackageId).toBe(correctedVersion.id);
  // Neither version borrows the other's audit state.
  expect(now.attestations.entries).toEqual([]);
  expect(now.attestations.subject.packageId).toBe(correctedVersion.id);
  expect(superseded.attestations.subject.packageId).toBe(firstVersion.id);
  expect(superseded.attestations.state).toBe("NOT_EXAMINED");

  const history = (await json(`${corrected.path}/history`)).history;
  expect(history.map((entry: any) => entry.version)).toEqual(["2", "1"]);
  expect(history[0].correctionReason).toContain("Angka sumber diperbaiki");
  expect(history[0].predecessor).toBe(firstVersion.id);
  expect(history[1].predecessor).toBeNull();
  expect(history[1].correctionReason).toBeNull();
  expect(history[0].endorsements.institution.toLowerCase()).toBe(account.address.toLowerCase());
  expect(history[0].endorsements.validator.toLowerCase()).toBe(validator.address.toLowerCase());
  expect(Number(history[0].anchor.blockTimestamp)).toBeGreaterThan(0);
  expect(history[0].anchor.transactionHash).toBe(corrected.intent.transactionHash ?? history[0].anchor.transactionHash);
  expect(history[1].anchor.transactionHash).not.toBe(history[0].anchor.transactionHash);
  // Reading the same line from the superseded version gives the same history.
  expect((await json(`${original.path}/history`)).history).toEqual(history);

  // The superseded package, its snapshot and its files are untouched by the correction.
  const old = (await json(`evidence/${firstVersion.preparationId}/reports/${firstVersion.id}`)).package;
  expect(old.digest).toBe(firstVersion.digest);
  expect(old.figures).toEqual(firstVersion.figures);
  const bundle = await (await request(`evidence/${firstVersion.preparationId}/reports/${firstVersion.id}/examination`)).json();
  const { verifyExamination } = await import("../src/report-verifier");
  const checked = await verifyExamination(bundle);
  expect(checked.recomputed.reconciliation.netDelta.amount).toBe("100");
  expect(checked.version.superseded).toBe(true);
  expect(checked.version.official).toBe(false);
  expect(checked.version.line.map((v: any) => v.version)).toEqual(["2", "1"]);
}, 30000);

it("refuses a wrong predecessor, a second first version and a signature made for another version", async () => {
  const preparation = await correctionPreparation("300", "300", "Pendahulu salah");
  const wrongPredecessor = await frozenVersion(preparation.id, { reportId: correctedReport, version: "9",
    predecessor: firstVersion.id, correctionReason: "Menyusul versi yang sudah digantikan." });
  const stale = await request(publicationPath(wrongPredecessor), { retryId: "pendahulu-lama", digest: wrongPredecessor.digest });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error).toContain("bukan versi resmi terkini");

  // A cross-report predecessor never reaches the registry: the package boundary refuses it first.
  const crossReport = await request(`evidence/${preparation.id}/reports`, { reportId: correctedReport, version: "10", mode: "HUMAN",
    predecessor: publicPackage.id, correctionReason: "Pendahulu dari laporan lain.", draft: { narrative: "x", claims: [] } });
  expect(crossReport.status).toBe(400);
  // A package that really belongs to another institution is not visible as a predecessor at all.
  const outsider = privateKeyToAccount(`0x${"0".repeat(63)}7`);
  const otherStore = createWorkspaceStore(database.handle());
  await otherStore.upsertMembership({ institutionId: "lpz-baitul-maal", account: outsider.address, role: "OFFICER" });
  const otherChallenge = await json("workspace/challenge", { institutionId: "lpz-baitul-maal", account: outsider.address });
  const otherToken = (await json("workspace/session", { nonce: otherChallenge.challenge.nonce, signature: await outsider.signTypedData(otherChallenge.typedData) })).token;
  const manifest = manifestOf();
  const otherPreparation = (await (await request("evidence", { label: "Lembaga lain", period: manifest.period, currencyUnit: "IDR", balanceSheetScope: "ON",
    claim: { manifest: { ...manifest, institutionId: "lpz-baitul-maal" }, rows: [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "10", unit: "IDR" } }] },
    source: { manifest: { ...manifest, institutionId: "lpz-baitul-maal" }, rows: [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "10", unit: "IDR" } }] } }, otherToken)).json()).preparation;
  const otherBase = `evidence/${otherPreparation.id}/reports`;
  const otherDraft = await (await request(otherBase, { reportId: "laporan-lembaga-lain", version: "1", mode: "HUMAN", draft: { narrative: "Draf lembaga lain.", claims: [] } }, otherToken)).json();
  const otherFrozen = await (await request(`${otherBase}/${otherDraft.package.id}/freeze`, {}, otherToken)).json();
  const foreign = await request(`evidence/${preparation.id}/reports`, { reportId: correctedReport, version: "11", mode: "HUMAN",
    predecessor: otherFrozen.package.id, correctionReason: "Pendahulu lembaga lain.", draft: { narrative: "x", claims: [] } });
  expect(foreign.status).toBe(400);
  expect((await foreign.json()).error).toContain("Pendahulu tidak ditemukan dalam lembaga ini");
  // The other institution still reads its own package; nothing here leaked across the boundary.
  expect((await (await request(`${otherBase}/${otherFrozen.package.id}`, undefined, otherToken)).json()).package.digest).toBe(otherFrozen.package.digest);

  // A correction that reuses a published version label is refused with an actionable reason, not a bare revert.
  const reusedLabel = await frozenVersion(preparation.id, { reportId: correctedReport, version: "1",
    predecessor: correctedVersion.id, correctionReason: "Label versi diulang." });
  const collision = await request(publicationPath(reusedLabel), { retryId: "label-terpakai", digest: reusedLabel.digest });
  expect(collision.status).toBe(409);
  expect((await collision.json()).error).toContain("sudah dipakai versi resmi lain");

  // A report that already has an official version cannot receive a second first version.
  const second = await frozenVersion(preparation.id, { reportId: correctedReport, version: "12" });
  const root = await request(publicationPath(second), { retryId: "akar-kedua", digest: second.digest });
  expect(root.status).toBe(409);
  expect((await root.json()).error).toContain("sudah memiliki versi resmi");

  // The institution signature accepted for version 1 does not authorize the correction.
  const path = publicationPath(correctedVersion);
  const replay = await request(`${path}/${(await json(`${path}`)).intents[0].id}/submit`, { signature: await account.signTypedData(evidenceTypedData(
    { name: "Tawf Report Evidence", version: "1", chainId: 31337, verifyingContract: registry },
    { ...(await json(`${publicationPath(firstVersion)}`)).intents[0].authorization })) });
  expect(replay.status).toBe(409);
  expect((await json(`${publicationPath(correctedVersion)}/version`)).version.versionState).toBe("VERSI_RESMI_TERKINI");
});

it("lets at most one of two competing corrections become official, and the loser reprepares", async () => {
  const winnerSource = await correctionPreparation("400", "400", "Koreksi bersaing A");
  const loserSource = await correctionPreparation("500", "500", "Koreksi bersaing B");
  const winner = await frozenVersion(winnerSource.id, { reportId: correctedReport, version: "3a", predecessor: correctedVersion.id, correctionReason: "Koreksi A." });
  const loser = await frozenVersion(loserSource.id, { reportId: correctedReport, version: "3b", predecessor: correctedVersion.id, correctionReason: "Koreksi B." });
  // Both are endorsed while the same version is still official.
  const winnerIntent = (await json(publicationPath(winner), { retryId: "bersaing-a", digest: winner.digest })).intent;
  const loserIntent = (await json(publicationPath(loser), { retryId: "bersaing-b", digest: loser.digest })).intent;
  const loserSignature = await account.signTypedData(evidenceTypedData(loserIntent.domain, loserIntent.authorization));
  const attempts = await database.rowCount("registry_attempts");
  await json(`${publicationPath(winner)}/${winnerIntent.id}/submit`, { signature: await account.signTypedData(evidenceTypedData(winnerIntent.domain, winnerIntent.authorization)) }, 200);
  await rpc.request({ method: "evm_mine" as any });

  const conflict = await request(`${publicationPath(loser)}/${loserIntent.id}/submit`, { signature: loserSignature });
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).error).toContain("bukan versi resmi terkini");
  // The refusal happens before the relayer signs anything, so there is nothing to rebroadcast either.
  const retried = await request(`${publicationPath(loser)}/${loserIntent.id}/retry`, {});
  expect(retried.status).toBe(409);
  expect((await retried.json()).error).toContain("Belum ada transaksi tersimpan");
  expect((await json(`${publicationPath(loser)}/version`)).version.publication).toBe("NOT_PUBLISHED");
  expect(await database.rowCount("registry_attempts")).toBe(attempts + 1);

  // The winner's retry is the same logical publication, not a second successor.
  const repeated = (await json(`${publicationPath(winner)}/${winnerIntent.id}/retry`, {}, 200)).intent;
  await database.reopen(); await configure();
  const official = (await json(`${publicationPath(winner)}/version`)).version;
  expect(official.versionState).toBe("VERSI_RESMI_TERKINI");
  expect(repeated.transactionHash).toBe(official.anchor.transactionHash);
  expect((await json(`${publicationPath(winner)}/history`)).history.map((e: any) => e.version)).toEqual(["3a", "2", "1"]);

  // The loser's package and findings stay readable as a submission that never became a version.
  const stillReadable = (await json(`evidence/${loser.preparationId}/reports/${loser.id}`)).package;
  expect(stillReadable.digest).toBe(loser.digest);
  expect((await json(`${publicationPath(loser)}/version`)).version.versionState).toBe("BUKAN_VERSI_RESMI");
  expect((await json(`${publicationPath(loser)}/history`)).history.some((e: any) => e.packageId === loser.id)).toBe(false);

  // Reprepared against the version that actually won, the loser publishes once.
  const reprepared = await frozenVersion(loserSource.id, { reportId: correctedReport, version: "4", predecessor: winner.id, correctionReason: "Koreksi B disiapkan ulang terhadap versi terkini." });
  await publishVersion(reprepared, "bersaing-b-ulang");
  const line = (await json(`${publicationPath(reprepared)}/history`)).history;
  expect(line.map((e: any) => e.version)).toEqual(["4", "3a", "2", "1"]);
  expect(line.every((e: any, index: number) => index === 0 ? e.official : !e.official)).toBe(true);
}, 30000);

it("separates the official version from a superseded one in public summaries and exports", async () => {
  const supersededSummary = (await (await request(`public/reports/${firstVersion.id}`, undefined, "")).json()).summary;
  expect(supersededSummary.publication.state).toBe("PUBLISHED");
  expect(supersededSummary.version.state).toBe("DIGANTIKAN_KOREKSI");
  expect(supersededSummary.version.supersededByPackageId).toBe(correctedVersion.id);
  expect(supersededSummary.version.predecessorPackageId).toBeNull();
  expect(supersededSummary.attestations.state).toBe("NOT_EXAMINED");
  expect(supersededSummary.attestations.entries).toEqual([]);
  expect(supersededSummary.history[0].official).toBe(true);
  expect(supersededSummary.history.at(-1).packageId).toBe(firstVersion.id);
  // Institution-authored free text never reaches the public line.
  const serialized = JSON.stringify(supersededSummary);
  expect(serialized).not.toContain("Angka sumber diperbaiki");
  expect(serialized).not.toContain(correctedReport);
  expect(supersededSummary.history[0].correctionReason).toBe("TERBATAS_BAGI_PEMBACA_BERWENANG");
  expect(Number(supersededSummary.history[0].anchor.blockTimestamp)).toBeGreaterThan(0);

  const correctionSummary = (await (await request(`public/reports/${correctedVersion.id}`, undefined, "")).json()).summary;
  expect(correctionSummary.version.predecessorPackageId).toBe(firstVersion.id);
  expect(correctionSummary.version.supersededByPackageId).not.toBeNull();
  expect(correctionSummary.content.commitment).toBe(correctedVersion.digest);
  expect(correctionSummary.summaryDigest).not.toBe(supersededSummary.summaryDigest);

  // The authorized export of the corrected version verifies its own line against the real registry.
  const bundle = await (await request(`evidence/${correctedVersion.preparationId}/reports/${correctedVersion.id}/examination`)).json();
  const { verifyExamination } = await import("../src/report-verifier");
  const result = await verifyExamination(bundle, { rpcUrl, chainId: 31337, registry });
  expect(result.ok).toBe(true);
  expect(result.version.predecessor).toBe(firstVersion.id);
  expect(result.version.correction).toBe(true);
  for (const forge of [
    (line: any[]) => { line[line.length - 1].predecessor = "dibuat-buat"; },
    (line: any[]) => { line[1].predecessor = "dibuat-buat"; },
    (line: any[]) => { line.splice(1, 1); },
  ]) {
    const forged = structuredClone(bundle);
    forge(forged.officialLine);
    await expect(verifyExamination(forged)).rejects.toThrow("satu garis resmi");
  }
  const relabelled = structuredClone(bundle);
  relabelled.officialLine = relabelled.officialLine.filter((e: any) => e.packageId !== firstVersion.id);
  await expect(verifyExamination(relabelled, { rpcUrl, chainId: 31337, registry })).rejects.toThrow();
}, 20000);

it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: publishes a first version, corrects it from the UI and reads both versions", async () => {
  const reportId = `demo-koreksi-${crypto.randomUUID()}`;
  const preparation = await correctionPreparation("700", "700", "Demo koreksi");
  const first = await frozenVersion(preparation.id, { reportId, version: "1" });
  await publishVersion(first, "demo-koreksi-1");
  const prep = await json(`evidence/${preparation.id}`);
  const bundles: Record<string, string> = {};
  for (const [name, file] of [["public", "public-report-smoke.tsx"], ["private", "registry-smoke.tsx"]]) {
    const built = await Bun.build({ entrypoints: [new URL(`../../frontend/test/${file}`, import.meta.url).pathname], target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "http://127.0.0.1:18575" }) } });
    if (!built.success) throw new Error(built.logs.join("\n"));
    bundles[name!] = await built.outputs[0]!.text();
  }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 18575, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/public-demo" || path === "/") return new Response(`<div id="root"></div><script type="module" src="/${path === "/public-demo" ? "public" : "private"}.js"></script>`, { headers: { "Content-Type": "text/html" } });
    if (path === "/public.js" || path === "/private.js") return new Response(bundles[path.slice(1, -3)], { headers: { "Content-Type": "text/javascript" } });
    if (path === "/smoke-config") return Response.json({ preparationId: preparation.id, token, canPrepare: true, commitmentSalt: prep.preparation.commitmentSalt });
    if (path === "/wallet-rpc") {
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
    await page.goto("http://127.0.0.1:18575/");
    await page.getByLabel("Paket tersimpan").selectOption(first.id);
    const publicationPanel = page.getByRole("heading", { name: "Penerbitan laporan", exact: true }).locator("..");
    await publicationPanel.getByText("Paket ini: Versi resmi terkini.").waitFor();

    // The correction starts from the published version and is reviewed before anything is saved.
    await publicationPanel.getByRole("button", { name: "Mulai koreksi dari versi ini" }).click();
    await page.getByRole("heading", { name: "Perubahan terhadap versi 1" }).waitFor();
    expect(await page.getByLabel("Versi", { exact: true }).inputValue()).toBe("");
    expect(await page.locator("body").innerText()).toContain("Pengesahan versi pendahulu tidak berlaku untuk koreksi ini");
    const save = page.getByRole("button", { name: "Simpan dan periksa draf" });
    await page.getByLabel("Narasi draf").fill("Koreksi narasi setelah rekonsiliasi ulang.");
    await page.getByLabel("Versi", { exact: true }).fill("2");
    expect(await save.isDisabled()).toBe(true);
    await page.getByLabel(/Alasan koreksi/).fill("Narasi versi pertama keliru; angka sumber tetap sama.");
    await page.getByLabel("Saya menyertakan seluruh sumber, temuan, dan batas pemeriksaan di atas sebagai bagian laporan.").check();
    await save.click();
    await page.getByText("· versi 2 · LOLOS · Draf tersimpan").waitFor();
    await page.getByRole("button", { name: "Bekukan paket untuk review pengesahan" }).click();
    await page.getByText("· versi 2 · LOLOS · Dibekukan").waitFor();

    await publicationPanel.getByRole("button", { name: "Minta pengesahan validator" }).click();
    await publicationPanel.getByLabel("Saya telah meninjau isi, cakupan sumber, temuan, digest, tujuan, dan parameter pengesahan di atas.").check();
    await publicationPanel.getByRole("button", { name: "Tandatangani penerbitan laporan" }).click();
    await publicationPanel.getByText("Penerbitan masuk blok; menunggu konfirmasi", { exact: true }).waitFor();
    await rpc.request({ method: "evm_mine" as any });
    await publicationPanel.getByText("Laporan terbit; tingkat konfirmasi tercapai", { exact: true }).waitFor();
    await publicationPanel.getByText("Versi 2 · resmi terkini", { exact: true }).waitFor();
    await publicationPanel.getByText("Versi 1 · digantikan", { exact: true }).waitFor();
    expect(await publicationPanel.innerText()).toContain("Narasi versi pertama keliru");
    await page.screenshot({ path: "/tmp/ticket75-browser-correction.png", fullPage: true });

    // Both versions stay readable to a public reader, each under its own identity.
    await page.goto(`http://127.0.0.1:18575/public-demo?packageId=${first.id}`);
    await page.getByText("Digantikan oleh koreksi yang lebih baru", { exact: true }).waitFor();
    await page.getByText("Versi yang digantikan · halaman ini", { exact: true }).waitFor();
    expect(await page.locator("body").innerText()).not.toContain("Narasi versi pertama keliru");
    await page.screenshot({ path: "/tmp/ticket75-public-superseded.png", fullPage: true });
  } finally { await browser.close(); server.stop(true); }
}, 90000);


// ---- Ticket #76: auditor attestations recorded against one version identity ----

const auditorKey = `0x${"0".repeat(60)}9abc` as Hex;
const auditor = privateKeyToAccount(auditorKey);
const attestationPath = (saved: any) => `evidence/${saved.preparationId}/reports/${saved.id}/attestation`;
const workingPaper = (text: string) => [{ fileName: "kertas-kerja.txt", mimeType: "text/plain", contentBase64: Buffer.from(text).toString("base64") }];
async function auditorSession() {
  const store = createWorkspaceStore(database.handle());
  await store.upsertMembership({ institutionId: institution, account: auditor.address, role: "READER" });
  const challenge = await json("workspace/challenge", { institutionId: institution, account: auditor.address });
  return (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await auditor.signTypedData(challenge.typedData) })).token;
}
async function auditorJson(path: string, body?: unknown, status = body === undefined ? 200 : 201) {
  const response = await request(path, body, auditorToken);
  const result = await response.json();
  expect({ status: response.status, error: result.error }).toEqual({ status, error: undefined });
  return result;
}
async function attestVersion(saved: any, token: string, body: Record<string, unknown>) {
  const path = attestationPath(saved);
  const intent = (await (await request(path, { packageDigest: saved.digest, scope: "REKONSILIASI_PERIODE", evidence: workingPaper("kertas kerja"), ...body }, token)).json()).intent;
  const signature = await auditor.signTypedData(attestationTypedData(intent.domain, intent.statement));
  const sent = await request(`${path}/${intent.id}/submit`, { signature }, token);
  expect(sent.status).toBe(200);
  await rpc.request({ method: "evm_mine" as any });
  return { path, intent, signature };
}

let auditorToken: string;
let attestedVersion: any;

it("records an auditor conclusion against one version without touching its endorsement", async () => {
  auditorToken = await auditorSession();
  attestedVersion = firstVersion;
  const path = attestationPath(attestedVersion);
  // Reader membership opens the page; it does not grant the right to attest.
  const unmandated = await request(path, { retryId: "tanpa-mandat", packageDigest: attestedVersion.digest, scope: "REKONSILIASI_PERIODE", conclusion: "WAJAR_TANPA_PENGECUALIAN", evidence: workingPaper("x") }, auditorToken);
  expect(unmandated.status).toBe(403);
  expect((await unmandated.json()).error).toContain("Keanggotaan pembaca tidak memberi hak atestasi");

  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setAuditor", args: [institution, auditor.address, true, "Surat penugasan 2026/01"] }) });
  // A conclusion the caller did not choose from the recorded vocabulary is refused outright.
  expect((await request(path, { retryId: "karangan", packageDigest: attestedVersion.digest, scope: "REKONSILIASI_PERIODE", conclusion: "SUDAH DIAUDIT PENUH", evidence: workingPaper("x") }, auditorToken)).status).toBe(400);
  expect((await request(path, { retryId: "digest-salah", packageDigest: keccak256(toHex("lain")), scope: "REKONSILIASI_PERIODE", conclusion: "WAJAR_TANPA_PENGECUALIAN", evidence: workingPaper("x") }, auditorToken)).status).toBe(409);

  const { intent } = await attestVersion(attestedVersion, auditorToken, { retryId: "atestasi-pertama", conclusion: "WAJAR_DENGAN_PENGECUALIAN" });
  expect(intent.statement.version).toBe("1");
  expect(intent.evidence.files[0].contentSha256).toBeString();
  expect(JSON.stringify(intent)).not.toContain("storageRefs");
  const paperPath = `${path}/${intent.id}/files/${intent.evidence.files[0].id}`;
  const paper = await request(paperPath, undefined, auditorToken);
  expect(paper.status).toBe(200);
  expect(await paper.text()).toBe("kertas kerja");
  expect((await request(paperPath, undefined, token)).status).toBe(404);
  expect((await request(paperPath, undefined, "")).status).toBe(401);

  const version = (await json(`${publicationPath(attestedVersion)}/version`)).version;
  expect(version.attestations.state).toBe("ATTESTED");
  expect(version.attestations.entries).toHaveLength(1);
  expect(version.attestations.entries[0].conclusion).toBe("WAJAR_DENGAN_PENGECUALIAN");
  expect(version.attestations.entries[0].auditor.toLowerCase()).toBe(auditor.address.toLowerCase());
  expect(version.attestations.entries[0].mandate).toBe("Surat penugasan 2026/01");
  expect(version.attestations.basis).toContain("bukan bukti independensi");
  // The institution's own publication is untouched by anything an auditor says.
  expect(version.publication).toBe("PUBLISHED");
  expect(version.digest).toBe(attestedVersion.digest);
  expect((await json(`evidence/${attestedVersion.preparationId}/reports/${attestedVersion.id}`)).package.digest).toBe(attestedVersion.digest);
}, 20000);

it("keeps each version's attestations separate and refuses a foreign or unpublished subject", async () => {
  // The corrected version of the same report starts with its own empty list.
  const corrected = (await json(`${publicationPath(correctedVersion)}/version`)).version;
  expect(corrected.attestations.state).toBe("NOT_EXAMINED");
  expect(corrected.attestations.entries).toEqual([]);
  expect(corrected.version).not.toBe((await json(`${publicationPath(attestedVersion)}/version`)).version.version);
  // Reading the line shows the opinion on exactly one version, addressed by version identity.
  const history = (await json(`${publicationPath(correctedVersion)}/history`)).history;
  expect(history.filter((e: any) => e.attestations.entries.length > 0).map((e: any) => e.version)).toEqual(["1"]);

  // A package that was never published as a version cannot be attested.
  const draftOnly = await frozenVersion((await correctionPreparation("900", "900", "Belum terbit")).id, { reportId: `belum-terbit-${crypto.randomUUID()}`, version: "1" });
  const refused = await request(attestationPath(draftOnly), { retryId: "belum-terbit", packageDigest: draftOnly.digest, scope: "REKONSILIASI_PERIODE", conclusion: "WAJAR_TANPA_PENGECUALIAN", evidence: workingPaper("x") }, auditorToken);
  expect(refused.status).toBe(409);
  expect((await refused.json()).error).toContain("belum menjadi versi terbit");
}, 20000);

it("appends a follow-up from the same auditor and refuses another auditor's record", async () => {
  const path = attestationPath(attestedVersion);
  const first = (await json(`${publicationPath(attestedVersion)}/version`)).version.attestations.entries[0];
  await attestVersion(attestedVersion, auditorToken, { retryId: "tindak-lanjut", conclusion: "WAJAR_TANPA_PENGECUALIAN", scope: "TINDAK_LANJUT_TEMUAN", predecessor: first.id, evidence: workingPaper("kertas kerja lanjutan") });
  const entries = (await json(`${publicationPath(attestedVersion)}/version`)).version.attestations.entries;
  expect(entries).toHaveLength(2);
  // The earlier conclusion is still readable exactly as it was signed.
  expect(entries.map((e: any) => e.conclusion)).toEqual(["WAJAR_DENGAN_PENGECUALIAN", "WAJAR_TANPA_PENGECUALIAN"]);
  expect(entries[1].predecessor).toBe(first.id);
  expect(entries[0].predecessor).toBeNull();

  // A second auditor cannot follow up on the first auditor's record.
  const other = privateKeyToAccount(`0x${"0".repeat(60)}def0` as Hex);
  const store = createWorkspaceStore(database.handle());
  await store.upsertMembership({ institutionId: institution, account: other.address, role: "READER" });
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setAuditor", args: [institution, other.address, true, "Surat penugasan kedua"] }) });
  const challenge = await json("workspace/challenge", { institutionId: institution, account: other.address });
  const otherToken = (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await other.signTypedData(challenge.typedData) })).token;
  const hijack = await request(path, { retryId: "rebut", packageDigest: attestedVersion.digest, scope: "TINDAK_LANJUT_TEMUAN", conclusion: "WAJAR_TANPA_PENGECUALIAN", predecessor: first.id, evidence: workingPaper("x") }, otherToken);
  expect(hijack.status).toBe(409);
  expect((await hijack.json()).error).toContain("catatan auditor ini sendiri");
  expect((await json(`${publicationPath(attestedVersion)}/version`)).version.attestations.entries).toHaveLength(2);

  // An unsigned draft conclusion belongs to its auditor; membership does not open it to everyone.
  const draft = (await auditorJson(path, { retryId: "draf-privat", packageDigest: attestedVersion.digest, scope: "REKONSILIASI_PERIODE", conclusion: "TIDAK_MENYATAKAN_PENDAPAT", evidence: workingPaper("kertas kerja privat") })).intent;
  expect((await request(`${path}/${draft.id}`, undefined, otherToken)).status).toBe(404);
  expect((await request(`${path}/${draft.id}`, undefined, token)).status).toBe(404);
  expect(JSON.stringify(await (await request(path, undefined, otherToken)).json())).not.toContain("kertas-kerja.txt");
  expect((await auditorJson(`${path}/${draft.id}`)).intent.statement.conclusion).toBe("TIDAK_MENYATAKAN_PENDAPAT");
  // Accepted conclusions stay readable to everyone, because they come from the registry.
  expect((await json(`${publicationPath(attestedVersion)}/version`)).version.attestations.entries).toHaveLength(2);
}, 20000);

it("keeps one logical attestation across retry, reload and a rejected broadcast", async () => {
  const path = attestationPath(attestedVersion);
  const prepared = (await auditorJson(path, { retryId: "durable", packageDigest: attestedVersion.digest, scope: "SUMBER_DAN_KOMITMEN", conclusion: "TIDAK_MENYATAKAN_PENDAPAT", evidence: workingPaper("kertas kerja durable") })).intent;
  // The same retry identity returns the same statement rather than signing a second one.
  const again = (await auditorJson(path, { retryId: "durable", packageDigest: attestedVersion.digest, scope: "SUMBER_DAN_KOMITMEN", conclusion: "TIDAK_MENYATAKAN_PENDAPAT", evidence: workingPaper("berbeda") })).intent;
  expect(again.statement).toEqual(prepared.statement);
  const signature = await auditor.signTypedData(attestationTypedData(prepared.domain, prepared.statement));

  rejectBroadcast = true;
  try { expect((await request(`${path}/${prepared.id}/submit`, { signature }, auditorToken)).status).toBe(503); }
  finally { rejectBroadcast = false; }
  const attempts = await database.rowCount("registry_attempts");
  await database.reopen(); await configure();
  await auditorJson(`${path}/${prepared.id}/retry`, {}, 200);
  await rpc.request({ method: "evm_mine" as any });
  expect((await auditorJson(`${path}/${prepared.id}`)).intent.observation.state).toBe("CONFIRMED");
  // Retrying a confirmed attestation is the same logical action, not a third conclusion.
  expect((await auditorJson(`${path}/${prepared.id}/retry`, {}, 200)).intent.transactionHash).toBe((await auditorJson(`${path}/${prepared.id}`)).intent.transactionHash);
  expect(await database.rowCount("registry_attempts")).toBe(attempts);
  expect((await json(`${publicationPath(attestedVersion)}/version`)).version.attestations.entries).toHaveLength(3);
}, 20000);

it("does not mark a version audited when evidence storage fails or the event is wrong", async () => {
  const path = attestationPath(attestedVersion);
  const before = (await json(`${publicationPath(attestedVersion)}/version`)).version.attestations.entries.length;
  // A store that cannot write: its root is a regular file, so every put throws.
  const working = files;
  const blocked = join(fileDirectory, "bukan-direktori");
  await Bun.write(blocked, "x");
  files = createEncryptedFileStore({ directory: blocked, key: Buffer.alloc(32, 73) });
  await configure();
  try {
    const failed = await request(path, { retryId: "bukti-gagal", packageDigest: attestedVersion.digest, scope: "REKONSILIASI_PERIODE", conclusion: "WAJAR_TANPA_PENGECUALIAN", evidence: workingPaper("tidak tersimpan") }, auditorToken);
    expect(failed.status).toBe(409);
    expect((await failed.json()).error).toContain("gagal disimpan");
  } finally { files = working; await configure(); }
  expect((await request(`${path}/bukti-gagal`, undefined, auditorToken)).status).toBe(404);
  expect((await json(`${publicationPath(attestedVersion)}/version`)).version.attestations.entries).toHaveLength(before);

  // A receipt whose event does not match is never read back as an attestation.
  const { intent } = await attestVersion(attestedVersion, auditorToken, { retryId: "event-salah", conclusion: "TIDAK_WAJAR" });
  try {
    mutateRpc = (method, body) => { if (method === "eth_getTransactionReceipt") body.result.logs = []; return body; };
    expect((await auditorJson(`${path}/${intent.id}`)).intent.observation.state).toBe("INVALID_EVENT");
  } finally { mutateRpc = null; }
  expect((await auditorJson(`${path}/${intent.id}`)).intent.observation.state).toBe("CONFIRMED");
  // An unfavourable conclusion is shown as it was signed, never softened.
  const entries = (await json(`${publicationPath(attestedVersion)}/version`)).version.attestations.entries;
  expect(entries.map((e: any) => e.conclusion)).toContain("TIDAK_WAJAR");
}, 25000);

it("shows actual conclusions on the public summary of the attested version only", async () => {
  const attested = (await (await request(`public/reports/${attestedVersion.id}`, undefined, "")).json()).summary;
  expect(attested.attestations.state).toBe("ATTESTED");
  expect(attested.attestations.entries.map((e: any) => e.conclusion)).toContain("TIDAK_WAJAR");
  expect(attested.attestations.basis).toContain("bukan bukti independensi");
  expect(attested.auditor).toBe("ATTESTED");
  const line = attested.history.find((entry: any) => entry.packageId === attestedVersion.id);
  expect(line.attestations.count).toBe(attested.attestations.count);
  expect(attested.history.find((entry: any) => entry.packageId === correctedVersion.id).attestations.count).toBe(0);
  // Nothing an auditor said changes what the institution published.
  expect(attested.publication.state).toBe("PUBLISHED");
  expect(attested.validator.outcome).toBe("LOLOS");
  const correctedSummary = (await (await request(`public/reports/${correctedVersion.id}`, undefined, "")).json()).summary;
  expect(correctedSummary.attestations.state).toBe("NOT_EXAMINED");
  expect(correctedSummary.auditor).toBe("NOT_EXAMINED");
}, 20000);

it("refuses a revoked mandate, another account's signature and a stale authority epoch", async () => {
  const path = attestationPath(attestedVersion);
  const prepared = (await auditorJson(path, { retryId: "dicabut", packageDigest: attestedVersion.digest, scope: "REKONSILIASI_PERIODE", conclusion: "WAJAR_TANPA_PENGECUALIAN", evidence: workingPaper("kertas kerja dicabut") })).intent;
  const signature = await auditor.signTypedData(attestationTypedData(prepared.domain, prepared.statement));
  // A signature from an account that is not the named auditor never reaches the relayer.
  const foreign = await account.signTypedData(attestationTypedData(prepared.domain, prepared.statement));
  expect((await request(`${path}/${prepared.id}/submit`, { signature: foreign }, auditorToken)).status).toBe(409);
  expect((await request(`${path}/${prepared.id}/submit`, { signature }, token)).status).toBe(404);

  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setAuditor", args: [institution, auditor.address, false, "dicabut"] }) });
  expect((await request(`${path}/${prepared.id}/submit`, { signature }, auditorToken)).status).toBe(409);
  // Reactivating raises the epoch, so the outstanding material stays invalid and a new review is needed.
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setAuditor", args: [institution, auditor.address, true, "Surat penugasan 2026/02"] }) });
  expect((await request(`${path}/${prepared.id}/submit`, { signature }, auditorToken)).status).toBe(409);
  const renewed = (await auditorJson(path, { retryId: "mandat-baru", packageDigest: attestedVersion.digest, scope: "REKONSILIASI_PERIODE", conclusion: "WAJAR_TANPA_PENGECUALIAN", evidence: workingPaper("kertas kerja mandat baru") })).intent;
  expect(renewed.statement.authorityEpoch).not.toBe(prepared.statement.authorityEpoch);
  const oldNotes = (await json(`${publicationPath(attestedVersion)}/version`)).version.attestations.entries;
  expect(oldNotes[0].mandate).toBe("Surat penugasan 2026/01");
  await auditorJson(`${path}/${renewed.id}/submit`, { signature: await auditor.signTypedData(attestationTypedData(renewed.domain, renewed.statement)) }, 200);
}, 25000);

it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: an auditor signs a conclusion on one version and both readers see it", async () => {
  const reportId = `demo-atestasi-${crypto.randomUUID()}`;
  const preparation = await correctionPreparation("800", "800", "Demo atestasi");
  const version = await frozenVersion(preparation.id, { reportId, version: "1" });
  await publishVersion(version, "demo-atestasi-1");
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setAuditor", args: [institution, auditor.address, true, "Surat penugasan demo"] }) });
  const prep = await json(`evidence/${preparation.id}`);
  const readerToken = await auditorSession();
  const bundles: Record<string, string> = {};
  for (const [name, file] of [["public", "public-report-smoke.tsx"], ["private", "registry-smoke.tsx"]]) {
    const built = await Bun.build({ entrypoints: [new URL(`../../frontend/test/${file}`, import.meta.url).pathname], target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "http://127.0.0.1:18576" }) } });
    if (!built.success) throw new Error(built.logs.join("\n"));
    bundles[name!] = await built.outputs[0]!.text();
  }
  const server = Bun.serve({ hostname: "127.0.0.1", port: 18576, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/public-demo" || path === "/") return new Response(`<div id="root"></div><script type="module" src="/${path === "/public-demo" ? "public" : "private"}.js"></script>`, { headers: { "Content-Type": "text/html" } });
    if (path === "/public.js" || path === "/private.js") return new Response(bundles[path.slice(1, -3)], { headers: { "Content-Type": "text/javascript" } });
    if (path === "/smoke-config") return Response.json({ preparationId: preparation.id, token: readerToken, canPrepare: false, commitmentSalt: prep.preparation.commitmentSalt });
    if (path === "/wallet-rpc") {
      const { method, params } = await req.json();
      if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([auditor.address]);
      if (method === "eth_chainId") return Response.json("0x7a69");
      if (method === "eth_signTypedData_v4") return Response.json(await auditor.signTypedData(JSON.parse(params[1])));
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
    await page.goto("http://127.0.0.1:18576/");
    await page.getByLabel("Paket tersimpan").selectOption(version.id);
    const panel = page.getByRole("heading", { name: "Atestasi auditor", exact: true }).locator("..");
    await panel.getByText("Belum diperiksa.", { exact: true }).waitFor();
    expect(await panel.innerText()).toContain("bukan bukti independensi");

    await panel.getByLabel("Kesimpulan").selectOption("TIDAK_WAJAR");
    await panel.getByLabel("Bukti pemeriksaan (kertas kerja)").setInputFiles({ name: "kertas-kerja.txt", mimeType: "text/plain", buffer: Buffer.from("Kertas kerja pemeriksaan.".repeat(12000)) });
    const prepareButton = panel.getByRole("button", { name: "Siapkan atestasi untuk versi ini" });
    await page.route("**/attestation", async (route: any) => {
      if (route.request().method() === "POST") await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Bukti gagal disimpan; coba lagi." }) });
      else await route.continue();
    });
    await prepareButton.click();
    await panel.getByRole("alert").filter({ hasText: "Bukti gagal disimpan" }).waitFor();
    expect(await prepareButton.isEnabled()).toBe(true);
    await page.unroute("**/attestation");
    await prepareButton.click();
    const sign = panel.getByRole("button", { name: "Tandatangani atestasi versi ini" });
    await sign.waitFor();
    await page.reload();
    await page.getByLabel("Paket tersimpan").selectOption(version.id);
    await sign.waitFor();
    expect(await sign.isDisabled()).toBe(true);
    await panel.getByLabel("Saya telah meninjau identitas versi, digest, lingkup, kesimpulan, dan bukti pemeriksaan di atas.").check();
    await sign.click();
    await panel.getByText("Atestasi masuk blok; konfirmasi belum cukup", { exact: true }).waitFor();
    await rpc.request({ method: "evm_mine" as any });
    await panel.getByText("Atestasi tercatat pada versi ini", { exact: true }).waitFor();
    // The recorded list re-reads itself, so the version stops saying it was never examined.
    await panel.getByText("Tidak wajar (TIDAK_WAJAR)", { exact: true }).waitFor();
    expect(await panel.innerText()).not.toContain("Belum diperiksa.");
    await page.screenshot({ path: "/tmp/ticket76-browser-attestation.png", fullPage: true });

    // The unfavourable conclusion reaches a public reader as it was signed.
    await page.goto(`http://127.0.0.1:18576/public-demo?packageId=${version.id}`);
    await page.getByText("Tidak wajar (TIDAK_WAJAR) · Rekonsiliasi periode (REKONSILIASI_PERIODE)", { exact: true }).waitFor();
    expect(await page.locator("body").innerText()).toContain("bukan bukti independensi");
    await page.screenshot({ path: "/tmp/ticket76-public-attestation.png", fullPage: true });
  } finally { await browser.close(); server.stop(true); }
}, 90000);

it("prepares scoped authority transactions, checks live roles and exposes canonical receipts", async () => {
  const path = "workspace/authority";
  const snapshot = (await json(path)).authority;
  expect(snapshot.administrator.toLowerCase()).toBe(account.address.toLowerCase());
  const change = { action: "SIGNATORY", account: validator.address, active: false };
  const prepared = (await json(`${path}/prepare`, change)).transaction;
  expect(prepared.actor.toLowerCase()).toBe(account.address.toLowerCase());
  expect(prepared.scope).toBe(institution);
  const hash = await wallet.sendTransaction({ to: prepared.to, data: prepared.data });
  await rpc.waitForTransactionReceipt({ hash });
  const receipt = (await json(`${path}/receipt/${hash}`)).receipt;
  expect(receipt.events).toContainEqual(expect.objectContaining({ event: "AuthorityChanged", args: expect.objectContaining({ actor: account.address, active: false }) }));
  const history = await json(`${path}/history`);
  expect(history.events.some((event: any) => event.transactionHash === hash)).toBe(true);
  const accepted = await json(`${path}/prepare`, { action: "PROPOSE_ADMINISTRATOR", account: validator.address });
  await rpc.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: accepted.transaction.to, data: accepted.transaction.data }) });
  expect((await request(`${path}/prepare`, { action: "ACCEPT_ADMINISTRATOR" })).status).toBe(503);
  mutateRpc = (method, response) => method === "eth_call" ? { jsonrpc: "2.0", id: response.id, error: { code: -32000, message: "unavailable" } } : response;
  expect((await request(`${path}/prepare`, change)).status).toBe(503);
  mutateRpc = null;
});

it("keeps a published version readable after rotation and marks pending signing material stale", async () => {
  const { saved, path } = await freshPackage(true);
  const prepared = (await json(path, { retryId: "rotation-demo", digest: saved.digest })).intent;
  const signed = await account.signTypedData(evidenceTypedData(prepared.domain, prepared.authorization));
  const before = await (await request(`public/reports/${publicPackage.id}`, undefined, "")).json();
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, false] }) });
  await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, functionName: "setSignatory", args: [institution, account.address, true] }) });
  expect((await json(`${path}/${prepared.id}`)).intent.signingAuthority).toBe("STALE");
  expect((await request(`${path}/${prepared.id}/submit`, { signature: signed })).status).toBe(409);
  const after = await (await request(`public/reports/${publicPackage.id}`, undefined, "")).json();
  expect(after.summary.content.packageId).toBe(publicPackage.id);
  expect(after.summary.content).toEqual(before.summary.content);
  expect(after.summary.summaryDigest).toBe(before.summary.summaryDigest);
  expect(after.summary.publication.state).toBe("PUBLISHED");
  expect(after.summary.publication.observation.blockHash).toBe(before.summary.publication.observation.blockHash);
  expect((await request(`public/reports/${publicPackage.id}`, undefined, "")).status).toBe(200);
});

it("returns proposals, cancellation and A-to-B-to-A acceptance authority epochs through the API", async () => {
  const successorWallet = createWalletClient({ account: validator, chain: foundry, transport: http(rpcUrl) });
  const send = async (who: typeof wallet | typeof successorWallet, functionName: string, args: unknown[]) => {
    await rpc.waitForTransactionReceipt({ hash: await who.writeContract({ address: registry, abi: reportRegistryAbi, functionName, args } as any) });
  };
  const fromBlock = await rpc.getBlockNumber({ cacheTime: 0 });
  await rpc.request({ method: "anvil_setBalance" as any, params: [validator.address, "0x56bc75e2d63100000"] as any });
  await send(wallet, "proposeAdministrator", [institution, "0x0000000000000000000000000000000000000000"]);
  await send(wallet, "proposeAdministrator", [institution, validator.address]);
  await send(successorWallet, "acceptAdministrator", [institution]);
  await send(successorWallet, "proposeAdministrator", [institution, account.address]);
  await send(wallet, "acceptAdministrator", [institution]);
  const history = (await json(`workspace/authority/history?fromBlock=${fromBlock}`)).events;
  expect(history).toContainEqual(expect.objectContaining({ event: "AdministratorProposed", administrator: account.address, successor: "0x0000000000000000000000000000000000000000", administratorEpoch: "1" }));
  expect(history).toContainEqual(expect.objectContaining({ event: "AdministratorAccepted", previous: validator.address, previousEpoch: "2", administrator: account.address, administratorEpoch: "3" }));
  expect(history).toContainEqual(expect.objectContaining({ event: "AuthorityChanged", account: account.address, actor: account.address, active: true, epoch: "3", actorEpoch: "3" }));
});
