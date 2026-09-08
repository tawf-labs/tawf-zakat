import { hashTypedData, keccak256, toHex } from "viem";
import { attestationTypedData, evidenceTypedData, type AttestationIntent, type RecordingIntent } from "../../../../shared/report-registry";
import type { SavedReportPackage } from "./evidenceClient";
import { AccessContextChanged, type PrivateRequests } from "./privateRequests";

type Intent = RecordingIntent | AttestationIntent;
type Kind = "recording" | "publication" | "attestation";
export type AttestationInput = { scope: string; conclusion: string; predecessor: string | null; evidence: { fileName: string; mimeType: string; contentBase64: string }[] };
export type InteractionPorts = {
  requests: PrivateRequests; saved: SavedReportPackage; preparationId: string; account: string | undefined; chainId: number | undefined;
  sign: (payload: any) => Promise<string>; now: () => number;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  schedule: (task: () => void, milliseconds: number) => () => void;
};
export type PublicationView = { version: { versionState: string; publication: string; predecessor: string | null; correctionReason: string | null;
  officialVersion: string | null; officialPackageId: string | null; attestations: VersionAttestations }; history: VersionHistoryEntry[] };
type VersionAttestations = { state: string; entries: { id: string; auditor: string; scope: string; conclusion: string; evidenceCommitment: string; predecessor: string | null; mandate: string }[]; basis: string };
type VersionHistoryEntry = { packageId: string; version: string; official: boolean; predecessor: string | null; correctionReason: string | null;
  endorsements: { institution: string; validator: string }; attestations: VersionAttestations;
  anchor: { transactionHash?: string; state: string; blockNumber?: string; blockTimestamp?: string; confirmations: number; requiredConfirmations: number } | null };
type State<T extends Intent> = { intent: T | null; history: T[]; loading: boolean; busy: "prepare" | "submit" | "retry" | "check" | null;
  reviewed: boolean; signature: string; error: string | null; statusUnavailable: boolean; view: PublicationView | null; lineUnavailable: boolean };
const attestation = (intent: Intent): intent is AttestationIntent => "statement" in intent;
const material = (intent: Intent) => JSON.stringify(attestation(intent)
  ? [intent.id, intent.domain, intent.statement, intent.statementDigest, intent.evidence, intent.accountKind]
  : [intent.id, intent.domain, intent.authorization, intent.authorizationDigest, intent.validator, intent.accountKind]);

/** Three tasks share this private lifecycle; their signing material remains distinct. */
function interaction<T extends Intent>(kind: Kind, ports: InteractionPorts) {
  let state: State<T> = { intent: null, history: [], loading: true, busy: null, reviewed: false, signature: "", error: null, statusUnavailable: false, view: null, lineUnavailable: false };
  let generation = 0, disposed = false, historyLoaded = false;
  let retryId: string = crypto.randomUUID();
  let cancel: (() => void) | null = null;
  let refreshing: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const path = `/api/evidence/${ports.preparationId}/reports/${ports.saved.id}/${kind}`;
  const key = `tawf-${kind}:${ports.requests.contextId.replace(/:[^:]+$/, "")}:${path}`;
  const publish = (patch: Partial<State<T>>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
  const current = (started = generation) => { ports.requests.assertCurrent(); if (disposed || generation !== started) throw new AccessContextChanged(); };
  const storage = (id: string | null) => { try { if (id) ports.storage.setItem(key, id); else ports.storage.removeItem(key); } catch { /* Optional retry selection; backend history remains authoritative. */ } };
  function install(next: T) {
    const changed = !state.intent || material(next) !== material(state.intent);
    const stale = next.signingAuthority === "STALE" || next.signingAuthority === "UNAVAILABLE";
    publish({ intent: next, history: [...state.history.filter(i => i.id !== next.id), next], statusUnavailable: next.signingAuthority === "UNAVAILABLE",
      ...(changed || stale ? { reviewed: false, signature: "" } : {}) });
  }
  async function json<R>(suffix = "", body?: unknown): Promise<R> {
    return ports.requests.json<R>(path + suffix, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
  }
  async function line(started: number) {
    if (kind !== "publication") return;
    try { const view = await json<PublicationView>("?view=versions"); current(started); publish({ view, lineUnavailable: false }); }
    catch (error) { current(started); publish({ view: null, lineUnavailable: true }); throw error; }
  }
  async function fresh(intent: T, started: number) {
    const next = (await json<{ intent: T }>(`/${intent.id}`)).intent;
    current(started);
    if (material(next) !== material(intent) || next.signingAuthority !== "CURRENT") {
      install(next); publish({ reviewed: false, signature: "" });
      throw new Error("Material atau kewenangan berubah. Tinjau ulang pengesahan sebelum menandatangani.");
    }
    validate(next); return next;
  }
  function validate(intent: T) {
    if ((kind === "attestation") !== attestation(intent)) throw new Error("Jenis pengesahan tidak cocok.");
    const s = ports.saved;
    const a = attestation(intent) ? intent.statement : intent.authorization;
    const signer = attestation(intent) ? intent.statement.auditor : intent.authorization.signer;
    const digest = attestation(intent) ? intent.statement.packageDigest : intent.authorization.digest;
    const typedDigest = attestation(intent) ? hashTypedData(attestationTypedData(intent.domain, intent.statement)) : hashTypedData(evidenceTypedData(intent.domain, intent.authorization));
    if (!ports.account || signer.toLowerCase() !== ports.account.toLowerCase() || intent.domain.chainId !== ports.chainId
      || a.packageId !== s.id || digest !== s.digest || a.institutionId !== s.institutionId || a.reportId !== s.reportId || a.version !== s.version
      || a.action !== keccak256(toHex(kind === "attestation" ? "ATTEST_REPORT" : kind === "publication" ? "PUBLISH_REPORT" : "RECORD_EVIDENCE"))
      || typedDigest !== (attestation(intent) ? intent.statementDigest : intent.authorizationDigest)) throw new Error("Pengesahan berbeda dari versi, jaringan, atau akun yang ditinjau.");
    if (BigInt(a.deadline) < BigInt(ports.now())) throw new Error("Pengesahan kedaluwarsa. Mulai tinjauan baru.");
    if (!attestation(intent)) {
      if (intent.authorization.predecessor !== (s.predecessor ?? "") || intent.authorization.policy !== s.policy.id || intent.authorization.outcome !== s.verdict.outcome) throw new Error("Pengikatan paket tidak cocok.");
      if (kind === "publication") {
        const v = intent.validator;
        if (!v || v.authorization.signer.toLowerCase() === signer.toLowerCase() || v.authorization.action !== keccak256(toHex("VALIDATE_REPORT"))
          || v.authorization.outcome !== "LOLOS" || hashTypedData(evidenceTypedData(intent.domain, v.authorization)) !== v.authorizationDigest
          || ["institutionId", "reportId", "version", "packageId", "predecessor", "digest", "policy", "outcome", "deadline"].some(key => v.authorization[key as keyof typeof v.authorization] !== intent.authorization[key as keyof typeof intent.authorization])) throw new Error("Pengesahan validator tidak cocok.");
      }
    }
  }
  async function operation(busy: NonNullable<State<T>["busy"]>, run: (started: number) => Promise<void>) {
    if (state.busy || state.loading) return;
    const started = generation;
    try { current(started); publish({ busy, error: null }); await run(started); }
    catch (error) {
      try { current(started); } catch { return; }
      publish({ error: `${error instanceof Error ? error.message : "Permintaan ditolak."}${busy === "submit" || busy === "retry" ? " Hasil pengiriman belum dapat dipastikan. Periksa status sebelum mencoba lagi." : ""}`,
        ...(busy === "check" || busy === "submit" || busy === "retry" ? { statusUnavailable: true, ...(kind === "publication" ? { view: null, lineUnavailable: true } : {}) } : {}) });
    } finally { if (!disposed && generation === started) publish({ busy: null }); }
  }
  async function loadHistory(started: number) {
        const { intents } = await json<{ intents: T[] }>(); current(started);
        let cached: string | null = null; try { cached = ports.storage.getItem(key); } catch { /* Optional. */ }
        const selected = intents.find(i => i.id === cached) ?? (kind === "attestation" ? intents.at(-1) : intents.find(i => ["CONFIRMED", "INCLUDED", "SUBMITTED"].includes(i.observation.state)) ?? intents.at(-1));
        publish({ history: intents });
        retryId = selected?.id ?? cached ?? retryId;
        if (selected) install(selected);
        historyLoaded = true;
        if (!selected) publish({ statusUnavailable: false });
  }
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = operation("check", async started => {
      if (!historyLoaded) await loadHistory(started);
      if (state.intent) { const next = (await json<{ intent: T }>(`/${state.intent.id}`)).intent; current(started); install(next); }
      await line(started);
    }).finally(() => { refreshing = null; });
    return refreshing;
  }
  function poll() {
    cancel = ports.schedule(() => { void refresh().finally(() => { if (!disposed) poll(); }); }, 4000);
  }
  return {
    getSnapshot: () => state,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    async start() {
      disposed = false;
      const started = generation;
      try {
        await loadHistory(started);
        await line(started);
      } catch (error) { if (!disposed && generation === started) publish({ statusUnavailable: true, error: error instanceof Error ? error.message : "Riwayat belum dapat diperiksa." }); }
      finally { if (!disposed && generation === started) { publish({ loading: false }); poll(); } }
    },
    dispose() { disposed = true; generation++; cancel?.(); cancel = null; },
    review(checked: boolean) { current(); publish({ reviewed: checked, ...(!checked ? { signature: "" } : {}) }); },
    signature(value: string) { current(); publish({ signature: value }); },
    select(id: string) {
      current(); generation++; const selected = state.history.find(i => i.id === id); if (!selected) return;
      retryId = id; storage(id); publish({ intent: selected, reviewed: false, signature: "", busy: null, statusUnavailable: true }); void refresh();
    },
    newReview() { current(); generation++; retryId = crypto.randomUUID(); storage(null); publish({ intent: null, signature: "", reviewed: false, busy: null, statusUnavailable: false, error: null }); },
    prepare(input?: AttestationInput) { return operation("prepare", async started => {
      storage(retryId);
      const body = kind === "attestation" ? { retryId, packageDigest: ports.saved.digest, ...input } : { retryId, digest: ports.saved.digest };
      const next = (await json<{ intent: T }>("", body)).intent; current(started); install(next);
    }); },
    submit() { return operation("submit", async started => {
      const intent = state.intent; if (!intent || !state.reviewed) return;
      await fresh(intent, started); current(started);
      const reviewedMaterial = material(intent);
      const signed = state.signature || await ports.sign(attestation(intent) ? attestationTypedData(intent.domain, intent.statement) : evidenceTypedData(intent.domain, intent.authorization));
      current(started);
      if (!state.reviewed || !state.intent || material(state.intent) !== reviewedMaterial) throw new Error("Tinjauan sudah berubah.");
      await fresh(intent, started); current(started);
      publish({ signature: signed });
      const next = (await json<{ intent: T }>(`/${intent.id}/submit`, { signature: signed })).intent; current(started); install(next);
      await line(started);
    }); },
    retry() { return operation("retry", async started => {
      const intent = state.intent; if (!intent) return;
      const signer = attestation(intent) ? intent.statement.auditor : intent.authorization.signer;
      if (signer.toLowerCase() !== ports.account?.toLowerCase()) throw new Error("Percobaan milik akun lain.");
      const next = (await json<{ intent: T }>(`/${intent.id}/retry`, {})).intent; current(started); install(next); await line(started);
    }); },
    refresh,
  };
}
export const createRecordingTask = (ports: InteractionPorts) => { const task = interaction<RecordingIntent>("recording", ports); return { ...task, prepare: () => task.prepare() }; };
export const createPublicationTask = (ports: InteractionPorts) => { const task = interaction<RecordingIntent>("publication", ports); return { ...task, prepare: () => task.prepare() }; };
export const createAttestationTask = (ports: InteractionPorts) => { const task = interaction<AttestationIntent>("attestation", ports); return { ...task, prepare: (input: AttestationInput) => task.prepare(input) }; };
