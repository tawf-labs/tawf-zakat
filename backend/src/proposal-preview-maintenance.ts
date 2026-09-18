import type { PrivateFileStore } from "./evidence-files";
import type { DisbursementStore } from "./disbursement-store";

/** Only fixed event names, correlation IDs and SQLSTATE reach diagnostics, never source values. */
export function reportPrivateOperationFailure(
  operation: string,
  error: unknown,
): string {
  const incidentId = crypto.randomUUID();
  const cause =
    error instanceof Error && "cause" in error ? error.cause : error;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? String(cause.code)
      : "";
  console.error({
    event: "private-operation-failed",
    operation,
    incidentId,
    code: /^[A-Z0-9]{5}$/.test(code) ? code : "UNEXPECTED",
  });
  return incidentId;
}

export async function pruneProposalPreviews(
  store: DisbursementStore,
  files: PrivateFileStore,
  now: number,
) {
  await store.pruneProposalBeneficiaryListPreviews(now);
  if (!files.remove) throw new Error("Private file cleanup is unavailable");
  await store.pruneUncommittedProposalFiles(now, (ref) => files.remove!(ref));
}

export function startProposalPreviewMaintenance(
  store: DisbursementStore,
  files: PrivateFileStore,
  now: () => number,
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await pruneProposalPreviews(store, files, now());
    } catch (error) {
      reportPrivateOperationFailure("proposal-preview-maintenance", error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
