import { hashTypedData, keccak256, toHex } from "viem";
import { certificationTypedData, ISSUE_CERTIFICATE, type CertificateIssuanceIntent } from "../../../../shared/certificate-nft";
import { prepareCertificate, submitCertificate, retryCertificate, getCertificate, type CertificateContentTotals, type CertificateLineStatus, type CertificateStatus } from "./certificateClient";
import { AccessContextChanged, type PrivateRequests } from "./privateRequests";

export type CertificatePorts = {
  requests: PrivateRequests; institutionId: string; activityId: string; certificateId: string;
  account: string | undefined; chainId: number | undefined;
  sign: (payload: any) => Promise<string>; now: () => number;
  schedule: (task: () => void, milliseconds: number) => () => void;
};
type State = {
  intent: CertificateIssuanceIntent | null; contentTotals: CertificateContentTotals; line: CertificateLineStatus | null; loading: boolean;
  busy: "prepare" | "submit" | "retry" | "check" | null;
  reviewed: boolean; signature: string; error: string | null; statusUnavailable: boolean;
};
/** A successor version is addressed as `<certificateId>@<version>`; the signed statement names the bare id. */
const bareCertificateId = (id: string) => id.split("@")[0]!;
const material = (intent: CertificateIssuanceIntent) => JSON.stringify([intent.id, intent.domain, intent.certification, intent.certificationDigest, intent.accountKind]);

/** One certificate identity per instance, unlike `registryInteraction.ts`'s history-of-packages
 * shape: the officer names the certificate up front, so there is nothing to select afterward. */
export function createCertificateTask(ports: CertificatePorts) {
  let state: State = { intent: null, contentTotals: null, line: null, loading: true, busy: null, reviewed: false, signature: "", error: null, statusUnavailable: false };
  let generation = 0, disposed = false;
  let cancel: (() => void) | null = null;
  let refreshing: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
  const current = (started = generation) => { ports.requests.assertCurrent(); if (disposed || generation !== started) throw new AccessContextChanged(); };
  function install(next: CertificateIssuanceIntent, contentTotals?: CertificateContentTotals, line?: CertificateLineStatus | null) {
    const changed = !state.intent || material(next) !== material(state.intent);
    const stale = next.signingAuthority === "STALE" || next.signingAuthority === "UNAVAILABLE";
    publish({ intent: next, ...(contentTotals !== undefined ? { contentTotals } : {}), ...(line ? { line } : {}), statusUnavailable: next.signingAuthority === "UNAVAILABLE",
      ...(changed || stale ? { reviewed: false, signature: "" } : {}) });
  }
  const installStatus = (status: CertificateStatus) => install(status.certificate, status.contentTotals, status.line);
  function validate(intent: CertificateIssuanceIntent) {
    const c = intent.certification;
    const typedDigest = hashTypedData(certificationTypedData(intent.domain, c));
    if (!ports.account || c.signer.toLowerCase() !== ports.account.toLowerCase() || intent.domain.chainId !== ports.chainId
      || c.institutionId !== ports.institutionId || c.activityId !== ports.activityId || c.certificateId !== bareCertificateId(ports.certificateId)
      || c.action !== keccak256(toHex(ISSUE_CERTIFICATE)) || typedDigest !== intent.certificationDigest) {
      throw new Error("Sertifikat berbeda dari versi, jaringan, atau akun yang ditinjau.");
    }
    if (BigInt(c.deadline) < BigInt(ports.now())) throw new Error("Pengesahan kedaluwarsa. Mulai persiapan baru.");
  }
  async function fresh(intent: CertificateIssuanceIntent, started: number) {
    const status = await getCertificate(ports.requests, ports.activityId, intent.id);
    current(started);
    const next = status.certificate;
    if (material(next) !== material(intent) || next.signingAuthority !== "CURRENT") {
      installStatus(status); publish({ reviewed: false, signature: "" });
      throw new Error("Isi atau kewenangan berubah. Tinjau ulang sebelum menandatangani.");
    }
    validate(next); return next;
  }
  async function operation(busy: NonNullable<State["busy"]>, run: (started: number) => Promise<void>) {
    if (state.busy || state.loading) return;
    const started = generation;
    try { current(started); publish({ busy, error: null }); await run(started); }
    catch (error) {
      try { current(started); } catch { return; }
      publish({ error: `${error instanceof Error ? error.message : "Permintaan ditolak."}${busy === "submit" || busy === "retry" ? " Hasil pengiriman belum dapat dipastikan. Periksa status sebelum mencoba lagi." : ""}`,
        ...(busy === "check" || busy === "submit" || busy === "retry" ? { statusUnavailable: true } : {}) });
    } finally { if (!disposed && generation === started) publish({ busy: null }); }
  }
  function refresh() {
    if (refreshing) return refreshing;
    refreshing = operation("check", async (started) => {
      if (!state.intent) return;
      const status = await getCertificate(ports.requests, ports.activityId, state.intent.id);
      current(started); installStatus(status);
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
        const existing = await getCertificate(ports.requests, ports.activityId, ports.certificateId).catch(() => null);
        current(started);
        if (existing) installStatus(existing);
      } catch (error) { if (!disposed && generation === started) publish({ error: error instanceof Error ? error.message : "Status belum dapat diperiksa." }); }
      finally { if (!disposed && generation === started) { publish({ loading: false }); poll(); } }
    },
    dispose() { disposed = true; generation++; cancel?.(); cancel = null; },
    review(checked: boolean) { current(); publish({ reviewed: checked, ...(!checked ? { signature: "" } : {}) }); },
    prepare() { return operation("prepare", async (started) => {
      const status = await prepareCertificate(ports.requests, ports.institutionId, ports.activityId, ports.certificateId);
      current(started); installStatus(status);
    }); },
    submit() { return operation("submit", async (started) => {
      const intent = state.intent; if (!intent || !state.reviewed) return;
      await fresh(intent, started); current(started);
      const reviewedMaterial = material(intent);
      const signed = state.signature || await ports.sign(certificationTypedData(intent.domain, intent.certification));
      current(started);
      if (!state.reviewed || !state.intent || material(state.intent) !== reviewedMaterial) throw new Error("Tinjauan sudah berubah.");
      await fresh(intent, started); current(started);
      publish({ signature: signed });
      const next = await submitCertificate(ports.requests, ports.institutionId, ports.activityId, intent.id, signed);
      current(started); install(next);
    }); },
    retry() { return operation("retry", async (started) => {
      const intent = state.intent; if (!intent) return;
      if (intent.certification.signer.toLowerCase() !== ports.account?.toLowerCase()) throw new Error("Percobaan milik akun lain.");
      const next = await retryCertificate(ports.requests, ports.institutionId, ports.activityId, intent.id);
      current(started); install(next);
    }); },
    refresh,
  };
}
export type CertificateTask = ReturnType<typeof createCertificateTask>;
