/** #115: synthetic inputs, real HTTP, PostgreSQL (PGlite), encrypted files and local EVM.
 * No report, finding, publication or attestation rows are seeded. Only institutional
 * onboarding/mandates are fixtures; this is not evidence of a real-world pilot.
 */
import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import app from "../src/index";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createEvidenceStore } from "../src/evidence-store";
import { createDisbursementStore } from "../src/disbursement-store";
import { createContributionStore } from "../src/contribution-store";
import { createActivityStore } from "../src/activity-store";
import { createAuditFindingStore } from "../src/audit-finding-store";
import { createRegistryStore } from "../src/registry-store";
import { createRegistryBudgetStore } from "../src/registry-budget";
import { createRegistryChain } from "../src/registry-chain";
import { createReportEndorsement } from "../src/report-endorsement";
import { createEncryptedFileStore } from "../src/evidence-files";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { reportRegistryAbi } from "../../shared/report-registry-abi";
import { attestationTypedData, evidenceTypedData } from "../../shared/report-registry";

// Public Anvil keys only; never use environment-provided RPCs or signing keys.
const amil = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const auditor = privateKeyToAccount(`0x${"11".repeat(32)}`);
const validatorKey = `0x${"22".repeat(32)}` as Hex;
const validator = privateKeyToAccount(validatorKey);
const institution = "lpz-sinar-amanah";
const documents = (text: string) => [{ fileName: "synthetic.txt", mimeType: "text/plain", contentBase64: Buffer.from(text).toString("base64") }];
const reportPath = (saved: any) => `evidence/${saved.preparationId}/reports/${saved.id}`;

it("preserves an attested report and finding while publishing and independently attesting its correction", async () => {
  const scratch = new URL("../../.scratch/", import.meta.url);
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(join(fileURLToPath(scratch), "audit-correction-"));
  let db: PGlite | undefined;
  let node: ReturnType<typeof Bun.spawn> | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let reservation: ReturnType<typeof Bun.serve> | undefined;
  try {
    // Reserve an OS-assigned port, then release it for Anvil; Anvil startup must succeed.
    reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = reservation.port!;
    await reservation.stop(true);
    reservation = undefined;
    const rpcUrl = `http://127.0.0.1:${port}`;
    const rpc = createPublicClient({ chain: foundry, pollingInterval: 25, transport: http(rpcUrl, { retryCount: 0, timeout: 500 }) });
    const wallet = createWalletClient({ account: amil, chain: foundry, transport: http(rpcUrl) });
    node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", String(port), "--silent"], { stdout: "ignore", stderr: "pipe" });
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (node.exitCode !== null) throw new Error("Isolated Anvil exited before startup");
      try { await rpc.getChainId(); ready = true; break; } catch { await Bun.sleep(100); }
    }
    if (!ready) throw new Error("Isolated Anvil did not start");
    const artifact = await Bun.file(new URL("../../sc/out/ReportEvidenceRegistry.sol/ReportEvidenceRegistry.json", import.meta.url)).json();
    const registry = (await rpc.waitForTransactionReceipt({ hash: await wallet.deployContract({ abi: reportRegistryAbi, bytecode: artifact.bytecode.object, args: [amil.address] }) })).contractAddress!;
    for (const action of [
      { functionName: "enrollInstitution", args: [institution, amil.address] },
      { functionName: "setSignatory", args: [institution, amil.address, true] },
      { functionName: "setValidator", args: [validator.address, true] },
      { functionName: "setAuditor", args: [institution, auditor.address, true, "Synthetic audit mandate #115"] },
    ]) await rpc.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: registry, abi: reportRegistryAbi, ...action } as any) });
    const fileDirectory = join(directory, "files");
    async function configure() {
      db = new PGlite(join(directory, "postgres"));
      const handle = drizzle(db);
      const privateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
      const budgetConfig = { maxWei: 10n ** 20n, gasLimit: 5_000_000n, maxFeePerGas: 2_000_000_000n }; // Isolated Anvil only.
      const budget = createRegistryBudgetStore(handle, budgetConfig, `31337:${registry.toLowerCase()}:${privateKeyToAccount(privateKey).address.toLowerCase()}`);
      await budget.ensureSchema();
      const chain = createRegistryChain({ rpcUrl, chainId: 31337, address: registry, requiredConfirmations: 2, privateKey, budgetConfig, budget });
      const store = createWorkspaceStore(handle);
      const evidence = createEvidenceStore(handle);
      const disbursement = createDisbursementStore(handle);
      const contributions = createContributionStore(handle);
      const activities = createActivityStore(handle);
      const auditFindings = createAuditFindingStore(handle);
      const registryStore = createRegistryStore(handle);
      for (const service of [store, evidence, disbursement, contributions, activities, auditFindings, registryStore]) await service.ensureSchema();
      configureWorkspace({ store, evidence, disbursement, contributions, activities, auditFindings,
        files: createEncryptedFileStore({ directory: fileDirectory, key: Buffer.alloc(32, 115) }),
        registry: { store: registryStore, chain, endorsement: createReportEndorsement(validatorKey) },
        ethCall: chain.accountSignatureCall, now: () => Math.floor(Date.now() / 1000), challengeTtlSeconds: 300, sessionTtlSeconds: 3600 });
      return store;
    }
    const store = await configure();
    for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
    await store.upsertMembership({ institutionId: institution, account: auditor.address, role: "READER" });
    await store.upsertMembership({ institutionId: institution, account: validator.address, role: "ADMIN" });
    const now = Math.floor(Date.now() / 1000);
    const officer = await store.createOfficerProfile({ institutionId: institution, displayName: "Synthetic amil", account: amil.address, role: "OFFICER", actor: validator.address, now });
    await store.grantMandate({ institutionId: institution, actor: validator.address, now, mandate: { officerId: officer.id, accountAddress: amil.address, function: "HANDLE_REPORT_EXAMINATION", scopeType: "ALL_PROGRAMS", validFrom: now - 60, validUntil: now + 3600, assignmentRef: "Synthetic assignment #115" } });
    server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: req => app.fetch(req) });
    const request = (path: string, body?: unknown, token = "") => fetch(new URL(`api/${path}`, server!.url), {
      method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    async function json(path: string, body?: unknown, token = "", status = body === undefined ? 200 : 201) {
      const response = await request(path, body, token);
      const result = await response.json();
      expect({ path, status: response.status, error: result.error }).toEqual({ path, status, error: undefined });
      return result;
    }
    async function signIn(account: typeof amil) {
      const challenge = await json("workspace/challenge", { institutionId: institution, account: account.address });
      return (await json("workspace/session", { nonce: challenge.challenge.nonce, signature: await account.signTypedData(challenge.typedData) })).token as string;
    }
    const amilToken = await signIn(amil);
    const auditorToken = await signIn(auditor);
    async function freeze(version: string, source: string, predecessor?: string) {
      const manifest = { label: "Synthetic institutional source", origin: "PASTE", scopeUnit: "Riau", scopeLevel: "PROVINSI", fundTypes: ["ZAKAT"], balanceSheet: "ON", currencyUnit: "IDR", period: { kind: "AKHIR_TAHUN", year: 2024 }, cutOff: "2025-02-11T00:00:00.000Z", format: "baris-ledger", mappingVersion: "1", transactionDetail: "PRESENT" };
      const rows = (amount: string) => [{ key: "a", bucket: "ZAKAT", balanceSheet: "ON", value: { amount, unit: "IDR" } }];
      const preparation = (await json("evidence", { files: documents(`synthetic private source ${source}`).map(f => ({ ...f, role: "SOURCE" })), label: `Synthetic version ${version}`, period: manifest.period, currencyUnit: "IDR", balanceSheetScope: "ON", claim: { manifest, rows: rows("200") }, source: { manifest, rows: rows(source) } }, amilToken)).preparation;
      const base = `evidence/${preparation.id}/reports`;
      const review = await json(`${base}/review`, undefined, amilToken);
      const draft = (await json(base, { reportId: "audit-correction-115", version, mode: "HUMAN", ...(predecessor ? { predecessor, correctionReason: "Koreksi angka sumber sesuai tindak lanjut auditor." } : {}), disclosure: review.disclosure,
        draft: { narrative: "Selisih dinyatakan sesuai sumber sintetis.", claims: review.figures.map((f: any) => ({ name: f.name, amount: f.value.amount, unit: f.value.unit })) } }, amilToken)).package;
      const frozen = (await json(`${base}/${draft.id}/freeze`, {}, amilToken)).package;
      expect(frozen.status).toBe("FROZEN");
      expect(frozen.verdict.outcome).toBe("LOLOS");
      return frozen;
    }
    async function publish(saved: any) {
      const path = `${reportPath(saved)}/publication`;
      const intent = (await json(path, { retryId: `publish-${saved.version}`, digest: saved.digest }, amilToken)).intent;
      expect(intent.validator.authorization.outcome).toBe("LOLOS");
      expect(intent.validator.signature).toMatch(/^0x[0-9a-f]+$/i);
      await json(`${path}/${intent.id}/submit`, { signature: await amil.signTypedData(evidenceTypedData(intent.domain, intent.authorization)) }, amilToken, 200);
      await rpc.request({ method: "evm_mine" as any });
      expect((await json(`${path}/${intent.id}`, undefined, amilToken)).intent.observation.state).toBe("CONFIRMED");
      const version = (await json(`${path}/version`, undefined, amilToken)).version;
      expect(version.publication).toBe("PUBLISHED");
      const history = (await json(`${path}/history`, undefined, amilToken)).history;
      expect(history[0].endorsements.institution.toLowerCase()).toBe(amil.address.toLowerCase());
      expect(history[0].endorsements.validator.toLowerCase()).toBe(validator.address.toLowerCase());
      return version;
    }
    const privatePapers: { path: string; text: string }[] = [];
    async function attest(saved: any, conclusion: string) {
      const path = `${reportPath(saved)}/attestation`;
      const intent = (await json(path, { retryId: `audit-${saved.version}`, packageDigest: saved.digest, scope: "REKONSILIASI_PERIODE", conclusion, evidence: documents(`private audit paper ${saved.version}`) }, auditorToken)).intent;
      expect(intent.statement.version).toBe(saved.version);
      await json(`${path}/${intent.id}/submit`, { signature: await auditor.signTypedData(attestationTypedData(intent.domain, intent.statement)) }, auditorToken, 200);
      await rpc.request({ method: "evm_mine" as any });
      const receipt = (await json(`${path}/${intent.id}`, undefined, auditorToken)).intent;
      expect(receipt.observation.state).toBe("CONFIRMED");
      expect(receipt.observation.blockHash).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(receipt.observation.logIndex).toBeNumber();
      const version = (await json(`${reportPath(saved)}/publication/version`, undefined, auditorToken)).version;
      expect(version.attestations.state).toBe("ATTESTED");
      expect(version.attestations.entries).toHaveLength(1);
      expect(version.attestations.entries[0].conclusion).toBe(conclusion);
      const paper = `${path}/${intent.id}/files/${intent.evidence.files[0].id}`;
      privatePapers.push({ path: paper, text: `private audit paper ${saved.version}` });
      expect(await (await request(paper, undefined, auditorToken)).text()).toBe(`private audit paper ${saved.version}`);
      expect((await request(paper, undefined, amilToken)).status).toBe(404);
      return version.attestations;
    }
    const original = await freeze("1", "100");
    await publish(original);
    const oldAttestations = await attest(original, "WAJAR_DENGAN_PENGECUALIAN");
    const finding = (await json(`${reportPath(original)}/findings`, { operationId: "finding-115", packageDigest: original.digest, scope: "REALISASI", severity: "TEMUAN_MATERIAL", title: "Angka sumber perlu koreksi", description: "Sumber sintetis memerlukan pembetulan.", workingPapers: documents("private finding paper") }, auditorToken)).finding;
    const findingPath = `evidence/audit-findings/${finding.id}`;
    const response = (await json(`${findingPath}/responses`, { operationId: "response-115", expectedRevision: 1, note: "Sumber diperiksa kembali.", attachments: documents("private amil response") }, amilToken, 200)).finding;
    expect(response).toMatchObject({ status: "DITANGGAPI", revision: 2 });
    const findingPaperPath = `${findingPath}/attachments/${finding.events[0].attachments[0].id}`;
    const responsePaperPath = `${findingPath}/attachments/${response.events[1].attachments[0].id}`;
    privatePapers.push(
      { path: findingPaperPath, text: "private finding paper" },
      { path: responsePaperPath, text: "private amil response" },
    );
    expect((await request(`${findingPath}/follow-ups`, { operationId: "forbidden-115", expectedRevision: 2, action: "SELESAI_DITUTUP", note: "Amil tidak boleh menutup sendiri." }, amilToken)).status).toBe(403);
    const followup = (await json(`${findingPath}/follow-ups`, { operationId: "followup-115", expectedRevision: 2, action: "BUTUH_KOREKSI_LAPORAN", note: "Terbitkan koreksi angka sumber." }, auditorToken, 200)).finding;
    expect(followup).toMatchObject({ status: "MENUNGGU_KOREKSI_LAPORAN", revision: 3 });
    const corrected = await freeze("2", "150", original.id);
    expect(corrected.digest).not.toBe(original.digest);
    const publishedCorrection = await publish(corrected);
    expect(publishedCorrection).toMatchObject({ predecessor: original.id, versionState: "VERSI_RESMI_TERKINI" });
    expect(publishedCorrection.attestations).toMatchObject({ state: "NOT_EXAMINED", entries: [] });
    expect(publishedCorrection.attestations.subject.packageId).toBe(corrected.id);
    expect((await json(`${reportPath(corrected)}/findings`, undefined, auditorToken)).findings).toEqual([]);
    const linked = (await json(findingPath, undefined, auditorToken)).finding;
    expect(linked.events).toEqual(followup.events);
    expect(linked.corrections).toContainEqual({ packageId: corrected.id, preparationId: corrected.preparationId, reportVersion: "2", status: "FROZEN" });
    const newAttestations = await attest(corrected, "WAJAR_TANPA_PENGECUALIAN");
    expect(newAttestations.entries[0]).not.toEqual(oldAttestations.entries[0]);

    // Close and reopen the actual SQL database and recreate the encrypted file store.
    resetWorkspace();
    await db!.close(); db = undefined;
    await configure();
    for (const paper of privatePapers) {
      const downloaded = await request(paper.path, undefined, auditorToken);
      expect(downloaded.status).toBe(200);
      expect(await downloaded.text()).toBe(paper.text);
      expect((await request(paper.path)).status).toBe(401);
    }
    expect((await request(findingPaperPath, undefined, amilToken)).status).toBe(403);
    const amilResponse = await request(responsePaperPath, undefined, amilToken);
    expect(amilResponse.status).toBe(200);
    expect(await amilResponse.text()).toBe("private amil response");
    expect((await json(`${reportPath(original)}`, undefined, amilToken)).package).toEqual(original);
    const oldVersion = (await json(`${reportPath(original)}/publication/version`, undefined, amilToken)).version;
    expect(oldVersion).toMatchObject({ publication: "PUBLISHED", versionState: "DIGANTIKAN_KOREKSI", digest: original.digest, officialPackageId: corrected.id });
    expect(oldVersion.attestations).toEqual(oldAttestations);
    expect((await json(`${reportPath(corrected)}/publication/version`, undefined, amilToken)).version.attestations).toEqual(newAttestations);
    expect((await json(findingPath, undefined, auditorToken)).finding).toEqual(linked);
    expect((await json(`${reportPath(original)}/findings`, undefined, auditorToken)).findings.map((f: any) => f.id)).toEqual([finding.id]);
    const history = (await json(`${reportPath(corrected)}/publication/history`, undefined, amilToken)).history;
    expect(history.map((v: any) => v.version)).toEqual(["2", "1"]);
    expect(history.map((v: any) => v.attestations.entries.length)).toEqual([1, 1]);
    // Real encrypted bytes, not a file-store stub returning the uploaded plaintext.
    const encrypted = (await readdir(fileDirectory, { recursive: true })).filter(name => name.endsWith(".bin"));
    expect(encrypted.length).toBeGreaterThanOrEqual(6);
    for (const name of encrypted) {
      const bytes = await readFile(join(fileDirectory, name));
      for (const plaintext of ["synthetic private source", "private audit paper", "private finding paper", "private amil response"]) expect(bytes.includes(Buffer.from(plaintext))).toBe(false);
    }
  } finally {
    resetWorkspace();
    try { await reservation?.stop(true); await server?.stop(true); }
    finally {
      try { await db?.close(); }
      finally {
        try { if (node && node.exitCode === null) { node.kill(); await node.exited; } }
        finally { await rm(directory, { recursive: true, force: true }); }
      }
    }
  }
}, 60000);
