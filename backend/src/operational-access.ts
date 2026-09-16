import type { AidLine } from "./disbursement";
import { checkOperationalMandate, type OperationalFunction } from "./operational-mandate";
import type { SessionRecord } from "./tenancy-store";
import type { WorkspaceRuntime } from "./workspace-runtime";

export class OperationalAccessDenied extends Error {}

export function requestedIdr(aidLines: AidLine[]): bigint {
  return aidLines.reduce((total, line) => total +
    (line.value.kind === "MONEY" && /^\d+$/.test(line.value.amountRequestedIdr)
      ? BigInt(line.value.amountRequestedIdr) : 0n), 0n);
}

/** Resolve the authenticated person once; every target still needs its own scope check. */
export async function operationalActor(runtime: WorkspaceRuntime, session: Pick<SessionRecord, "account" | "institutionId">) {
  const officer = await runtime.store.getOfficerForAccount(session.account, session.institutionId);
  if (!officer?.isActive) {
    throw new OperationalAccessDenied("Profil petugas belum lengkap atau nonaktif. Tindakan yang memerlukan mandat ditahan.");
  }
  const now = runtime.now();
  const mandates = await runtime.store.activeMandatesForOfficer(session.institutionId, officer.id, now);
  return {
    officer,
    allows(fn: OperationalFunction, target: { programId?: string | null; nominalAmount?: bigint | null }) {
      return checkOperationalMandate(mandates, { fn, ...target, now, account: session.account }).allowed;
    },
    require(fn: OperationalFunction, target: { programId?: string | null; nominalAmount?: bigint | null } = {}) {
      const result = checkOperationalMandate(mandates, { fn, ...target, now, account: session.account });
      if (!result.allowed) throw new OperationalAccessDenied(result.reason);
      return result.mandate;
    },
  };
}
