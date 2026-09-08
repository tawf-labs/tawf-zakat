import { expect, it } from "bun:test";
import { hashTypedData, keccak256, toHex } from "viem";
import { evidenceTypedData, type RecordingIntent } from "../../../../shared/report-registry";
import { createRecordingTask, createPublicationTask, createAttestationTask, type InteractionPorts } from "./registryInteraction";
import type { SavedReportPackage } from "./evidenceClient";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const account = `0x${"11".repeat(20)}` as const;
function fixture(publication = false) {
  const saved = { id: "p1", institutionId: "i", reportId: "r", version: "1", digest: keccak256(toHex("package")), predecessor: null, verdict: { outcome: "LOLOS" }, policy: { id: "policy" } } as SavedReportPackage;
  const domain = { name: "Tawf Report Evidence", version: "1", chainId: 31337, verifyingContract: `0x${"22".repeat(20)}` as const };
  const authorization = { action: keccak256(toHex(publication ? "PUBLISH_REPORT" : "RECORD_EVIDENCE")), institutionId: "i", reportId: "r", version: "1", packageId: "p1", predecessor: "", digest: saved.digest as `0x${string}`, policy: "policy", outcome: "LOLOS", signer: account, authorityEpoch: "1", nonce: keccak256(toHex("nonce")), deadline: "2000" };
  let intent: RecordingIntent = { id: "attempt", domain, authorization, authorizationDigest: hashTypedData(evidenceTypedData(domain, authorization)),
    accountKind: "EOA", signingAuthority: "CURRENT", observation: { state: "PREPARED", confirmations: 0, requiredConfirmations: 2, confirmationPolicy: "test" } };
  let signer: InteractionPorts["sign"] = async () => "0x1234";
  let delayed: Promise<unknown> | null = null;
  let unavailable = false;
  let official = "p1";
  let scheduled: (() => void) | null = null;
  const calls: { path: string; body: any }[] = [];
  const ports: InteractionPorts = { saved, preparationId: "prep", account, chainId: 31337, now: () => 1000,
    sign: data => signer(data), storage: { getItem: () => null, setItem() {}, removeItem() {} },
    schedule: task => { scheduled = task; return () => { scheduled = null; }; },
    requests: { contextId: "https://api.test:account:1", assertCurrent() {}, blob: async () => new Blob(),
      async json<T>(path: string, init?: RequestInit): Promise<T> {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ path, body });
        if (delayed) await delayed;
        if (unavailable) throw new TypeError("Network unavailable");
        if (path.endsWith("?view=versions")) return { version: { officialPackageId: official }, history: [{ packageId: official, official: true }] } as T;
        if (path.endsWith("/submit") || path.endsWith("/retry")) return { intent: { ...intent, transactionHash: keccak256(toHex("transaction")), observation: { ...intent.observation, state: "SUBMITTED" } } } as T;
        if (body) return { intent } as T;
        if (path.endsWith("/attempt")) return { intent } as T;
        return { intents: [intent] } as T;
      } } };
  const task = publication ? createPublicationTask(ports) : createRecordingTask(ports);
  return { task, calls, sign: (next: typeof signer) => { signer = next; }, change: (patch: Partial<RecordingIntent>) => { intent = { ...intent, ...patch }; },
    delay: (promise: Promise<unknown> | null) => { delayed = promise; }, unavailable: () => { unavailable = true; }, official: (id: string) => { official = id; }, tick: () => scheduled?.() };
}
it("ignores wallet answers after the task context is disposed", async () => {
  const f = fixture(); await f.task.start(); f.task.review(true);
  const waiting = deferred<void>(), signature = deferred<string>();
  f.sign(async () => { waiting.resolve(); return signature.promise; });
  const submit = f.task.submit(); await waiting.promise; f.task.dispose(); signature.resolve("0x1234"); await submit;
  expect(f.calls.filter(c => c.path.endsWith("/submit"))).toHaveLength(0);
});
it("rechecks live authority after the wallet answers and clears acknowledgement", async () => {
  const f = fixture(); await f.task.start(); f.task.review(true);
  f.sign(async () => { f.change({ signingAuthority: "STALE" }); return "0x1234"; });
  await f.task.submit();
  expect(f.calls.filter(c => c.path.endsWith("/submit"))).toHaveLength(0);
  expect(f.task.getSnapshot().reviewed).toBe(false);
});
it("rejects a changed domain before asking the wallet", async () => {
  const f = fixture(); await f.task.start(); f.task.review(true);
  let signed = false; f.sign(async () => { signed = true; return "0x1234"; });
  const original = f.task.getSnapshot().intent!;
  f.change({ domain: { ...original.domain, verifyingContract: `0x${"33".repeat(20)}` } });
  await f.task.submit(); expect(signed).toBe(false); expect(f.task.getSnapshot().reviewed).toBe(false);
});
it("uses the durable retry endpoint without signing or adding parameters", async () => {
  const f = fixture(); await f.task.start();
  f.sign(async () => { throw new Error("Must not sign"); });
  await f.task.retry();
  expect(f.calls.at(-1)).toMatchObject({ path: expect.stringContaining("/attempt/retry"), body: {} });
});
it("serializes status requests and ignores late status errors from disposed tasks", async () => {
  const f = fixture(); await f.task.start(); const pending = deferred<void>(); f.delay(pending.promise);
  const before = f.calls.length; const a = f.task.refresh(), b = f.task.refresh();
  expect(f.calls.length - before).toBe(1);
  f.task.dispose(); f.unavailable(); pending.resolve(); await Promise.all([a, b]);
  expect(f.task.getSnapshot().error).toBe(null);
});
it("refreshes the official line even when a confirmed receipt does not change", async () => {
  const f = fixture(true); f.change({ signingAuthority: "HISTORICAL", observation: { state: "CONFIRMED", confirmations: 3, requiredConfirmations: 2, confirmationPolicy: "test" } });
  await f.task.start(); expect(f.task.getSnapshot().view?.version.officialPackageId).toBe("p1");
  f.official("p2"); await f.task.refresh();
  expect(f.task.getSnapshot().intent?.observation.state).toBe("CONFIRMED");
  expect(f.task.getSnapshot().view?.version.officialPackageId).toBe("p2");
});

it("does not submit a late wallet answer after a different intent is selected", async () => {
  const f = fixture(); await f.task.start(); f.task.review(true);
  const waiting = deferred<void>(), signature = deferred<string>();
  f.sign(async () => { waiting.resolve(); return signature.promise; });
  const submit = f.task.submit(); await waiting.promise;
  f.task.newReview(); signature.resolve("0x1234"); await submit;
  expect(f.calls.filter(c => c.path.endsWith("/submit"))).toHaveLength(0);
  expect(f.task.getSnapshot().reviewed).toBe(false);
});
it("reports network ambiguity after signing without claiming success", async () => {
  const f = fixture(); await f.task.start(); f.task.review(true);
  f.sign(async () => { f.unavailable(); return "0x1234"; });
  await f.task.submit();
  expect(f.task.getSnapshot()).toMatchObject({ statusUnavailable: true, error: expect.stringContaining("belum dapat dipastikan") });
  expect(f.calls.filter(c => c.path.endsWith("/submit"))).toHaveLength(0);
});
it("continues observing a confirmed transaction and detects a later reorg", async () => {
  const f = fixture(); f.change({ observation: { state: "CONFIRMED", confirmations: 4, requiredConfirmations: 2, confirmationPolicy: "test" } });
  await f.task.start();
  f.change({ observation: { state: "NONCANONICAL", confirmations: 0, requiredConfirmations: 2, confirmationPolicy: "test" } });
  f.tick(); await f.task.refresh();
  expect(f.task.getSnapshot().intent?.observation.state).toBe("NONCANONICAL");
});
it("withdraws the old official line when receipt refresh fails before reading the new view", async () => {
  const f = fixture(true); await f.task.start();
  expect(f.task.getSnapshot().view).not.toBeNull();
  f.unavailable(); await f.task.refresh();
  expect(f.task.getSnapshot()).toMatchObject({ view: null, lineUnavailable: true, statusUnavailable: true });
});
it("does not prepare while initial history is still loading", async () => {
  const f = fixture(); const pending = deferred<void>(); f.delay(pending.promise);
  const starting = f.task.start(); await f.task.prepare();
  expect(f.calls.filter(c => c.body !== undefined)).toHaveLength(0);
  pending.resolve(); await starting;
  expect(f.task.getSnapshot().intent?.id).toBe("attempt");
});
it("recovers auditor history through the task after the initial network failure", async () => {
  let available = false;
  const note = { id: "auditor-note", statement: { auditor: account }, signingAuthority: "CURRENT", observation: { state: "PREPARED" } };
  const task = createAttestationTask({
    saved: { id: "p", digest: "digest" } as SavedReportPackage, preparationId: "prep", account, chainId: 31337,
    sign: async () => { throw new Error("History never signs"); }, now: () => 1000,
    storage: { getItem: () => null, setItem() {}, removeItem() {} }, schedule: () => () => {},
    requests: { contextId: "test:1", assertCurrent() {}, blob: async () => new Blob(),
      json: async <T>(path: string) => {
        if (!available) throw new TypeError("Network unavailable");
        return (path.endsWith("/auditor-note") ? { intent: note } : { intents: [note] }) as T;
      } },
  });
  await task.start(); expect(task.getSnapshot().statusUnavailable).toBe(true);
  available = true; await task.refresh();
  expect(task.getSnapshot()).toMatchObject({ intent: { id: "auditor-note" }, statusUnavailable: false });
});
