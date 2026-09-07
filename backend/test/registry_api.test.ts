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
const institution = "lpz-sinar-amanah";
const rpcUrl = "http://127.0.0.1:18572";
const rpc = createPublicClient({ chain: foundry, transport: http(rpcUrl, { retryCount: 0, timeout: 500 }) });
const wallet = createWalletClient({ account, chain: foundry, transport: http(rpcUrl) });
let node: ReturnType<typeof Bun.spawn>;
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
async function configure() {
  const store = createWorkspaceStore(database.handle());
  const evidence = createEvidenceStore(database.handle());
  const registryStore = createRegistryStore(database.handle());
  await store.ensureSchema(); await evidence.ensureSchema(); await registryStore.ensureSchema();
  const chain = createRegistryChain({ rpcUrl: String(proxy.url), chainId: 31337, address: registry, requiredConfirmations: 2, privateKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" });
  configureWorkspace({ store, evidence, registry: { store: registryStore, chain }, now: () => Math.floor(Date.now() / 1000), challengeTtlSeconds: 300, sessionTtlSeconds: 3600,
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
    { functionName: "enrollInstitution", args: [institution, account.address] },
    { functionName: "setSignatory", args: [institution, account.address, true] },
  ] as const) await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, ...args } as any) });
  proxy = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const body = await req.json();
    if (rejectBroadcast && body.method === "eth_sendRawTransaction") return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "transport refused before broadcast" } });
    const result = await (await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    return Response.json(mutateRpc ? mutateRpc(body.method, result) : result);
  } });
  database = await createTestWorkspaceDatabase();
  const store = await configure();
  for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
  await store.upsertMembership({ institutionId: institution, account: account.address, role: "OFFICER" });
  const challenge = await json("workspace/challenge", { institutionId: institution, account: account.address });
  token = (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await account.signTypedData(challenge.typedData) })).token;
  const manifest = { label: "Local source", origin: "PASTE", scopeUnit: "Riau", scopeLevel: "PROVINSI", fundTypes: ["ZAKAT"], balanceSheet: "ON", currencyUnit: "IDR", period: { kind: "AKHIR_TAHUN", year: 2024 }, cutOff: "2025-02-11T00:00:00.000Z", format: "baris-ledger", mappingVersion: "1", transactionDetail: "PRESENT" };
  const preparation = (await json("evidence", { label: "Local gap", period: manifest.period, currencyUnit: "IDR", balanceSheetScope: "ON", claim: { manifest, rows: [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "200", unit: "IDR" } }] }, source: { manifest, rows: [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "100", unit: "IDR" } }] } })).preparation;
  const base = `evidence/${preparation.id}/reports`;
  const draft = (await json(base, { reportId: "local-2024", version: "1", mode: "HUMAN", draft: { narrative: "Temuan belum diperbaiki.", claims: [] } })).package;
  frozen = (await json(`${base}/${draft.id}/freeze`, {})).package;
  packagePath = `${base}/${frozen.id}/recording`;
}, 30000);
afterAll(async () => { resetWorkspace(); if (database) await database.close(); proxy?.stop(true); node?.kill(); });
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

async function freshPackage(passing = false) {
  const base = packagePath.split(`/${frozen.id}/recording`)[0]!;
  const review = await json(`${base}/review`);
  const draft = (await json(base, { reportId: "local-2024", version: "1", mode: "HUMAN",
    draft: { narrative: "Selisih dilaporkan sesuai sumber.", claims: passing ? review.figures.map((f: any) => ({ name: f.name, amount: f.value.amount, unit: f.value.unit })) : [] },
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

it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser smoke: reviews rejected package, signs, recovers history and notices a later reorg", async () => {
  const { saved, path } = await freshPackage();
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
    await page.getByRole('button', { name: 'Siapkan pengesahan pencatatan' }).click();
    const sign = page.getByRole('button', { name: 'Tandatangani pencatatan bukti' });
    await sign.waitFor();
    expect(await sign.isDisabled()).toBe(true);
    await page.getByText('Cakupan sumber dan temuan paket beku', { exact: true }).click();
    expect(await page.locator('body').innerText()).toContain('DITOLAK');
    await page.getByLabel('Saya telah meninjau isi, cakupan sumber, temuan, digest, tujuan, dan parameter pengesahan di atas.').check();
    const snapshot = await rpc.request({ method: 'evm_snapshot' as any });
    await sign.click();
    await page.getByText('Bukti tercatat dalam blok; konfirmasi belum cukup', { exact: true }).waitFor();
    await rpc.request({ method: 'evm_mine' as any });
    await page.getByText('Bukti tercatat; tingkat konfirmasi tercapai', { exact: true }).waitFor();
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    await page.getByLabel('Paket tersimpan').selectOption(saved.id);
    await page.getByText('Bukti tercatat; tingkat konfirmasi tercapai', { exact: true }).waitFor();
    await rpc.request({ method: 'evm_revert' as any, params: [snapshot] as any });
    await page.getByText('Blok berubah; pencatatan perlu diperiksa ulang', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Kirim ulang transaksi tersimpan' }).click();
    await page.getByText('Bukti tercatat dalam blok; konfirmasi belum cukup', { exact: true }).waitFor();
    await page.screenshot({ path: '/tmp/ticket72-browser-smoke.png', fullPage: true });
  } finally { await browser.close(); server.stop(true); }
}, 60000);
