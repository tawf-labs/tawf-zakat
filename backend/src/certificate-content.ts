/**
 * Frozen content for a distribution-stage certificate (Spec #100, ticket #111).
 *
 * A certificate freezes one activity's realizations and their confirmation state at
 * the moment an officer prepares it, so an endorsement signs exactly what a reader
 * later verifies. Confirmed and disputed/unconfirmed realizations are always kept as
 * separate counts here, never merged into one total: the acceptance criteria for
 * #111 require that an unconfirmed part never reads as final.
 *
 * Pure module: no database, no network, no clock beyond the `frozenAt` it is given.
 */

import { canonicalJson } from "../../shared/canonical-json";
import { commitmentFor, newCommitmentSalt, sha256Hex } from "./evidence-snapshot";
import type { DistributionActivityRecord } from "./activity";
import type { RealizationRecord } from "./disbursement";

export const CERTIFICATE_CONTENT_FORMAT = "tawf.distribution.certificate" as const;
export const CERTIFICATE_CONTENT_VERSION = 1 as const;

export type CertificateRealizationLine = {
  realizationId: string;
  method: string;
  amountIdr: string | null;
  quantity: string | null;
  unit: string | null;
  evidenceStatus: string;
  confirmationStatus: string;
  confirmationMethod: string | null;
  realizationVersion: number;
};

export type CertificateTotals = {
  confirmedCount: number;
  disputedCount: number;
  unconfirmedCount: number;
  totalRealizedIdr: string;
  goods: Array<{ unit: string; totalQuantity: string; count: number }>;
};

export type CertificateContent = {
  format: typeof CERTIFICATE_CONTENT_FORMAT;
  version: typeof CERTIFICATE_CONTENT_VERSION;
  institutionId: string;
  activityId: string;
  certificateId: string;
  certificateVersion: string;
  proposalId: string;
  proposalVersion: number;
  activityName: string;
  programFundType: string;
  targetAmount: string;
  currencyUnit: string;
  frozenAt: number;
  realizations: CertificateRealizationLine[];
  totals: CertificateTotals;
};

const addIdr = (a: string, b: string): string => (BigInt(a) + BigInt(b)).toString();

export function totalsOf(realizations: RealizationRecord[]): CertificateTotals {
  const goods = new Map<string, { totalQuantity: string; count: number }>();
  let totalRealizedIdr = "0";
  let confirmedCount = 0;
  let disputedCount = 0;
  let unconfirmedCount = 0;
  for (const r of realizations) {
    if (r.confirmationStatus === "CONFIRMED") confirmedCount++;
    else if (r.confirmationStatus === "DISPUTED") disputedCount++;
    else unconfirmedCount++;
    if (r.amountIdr) totalRealizedIdr = addIdr(totalRealizedIdr, r.amountIdr);
    if (r.unit && r.quantity) {
      const existing = goods.get(r.unit) ?? { totalQuantity: "0", count: 0 };
      goods.set(r.unit, { totalQuantity: addIdr(existing.totalQuantity, r.quantity), count: existing.count + 1 });
    }
  }
  return {
    confirmedCount,
    disputedCount,
    unconfirmedCount,
    totalRealizedIdr,
    goods: [...goods.entries()].map(([unit, v]) => ({ unit, ...v })).sort((a, b) => a.unit.localeCompare(b.unit)),
  };
}

/** Only a realized, confirmed or disputed handover belongs on a certificate; a realization
 * with neither evidence nor a confirmation attempt yet is not part of what is being endorsed. */
export const isCertifiableRealization = (r: RealizationRecord): boolean =>
  r.evidenceStatus === "EVIDENCE_COMPLETE" || r.confirmationStatus !== "UNCONFIRMED";

export function freezeCertificateContent(input: {
  activity: DistributionActivityRecord;
  activityId: string;
  certificateId: string;
  certificateVersion: string;
  realizations: RealizationRecord[];
  frozenAt: number;
}): { content: CertificateContent; canonical: string; bytes: Uint8Array } {
  const realizations: CertificateRealizationLine[] = input.realizations
    .filter(isCertifiableRealization)
    .map((r) => ({
      realizationId: r.id,
      method: r.method,
      amountIdr: r.amountIdr,
      quantity: r.quantity,
      unit: r.unit,
      evidenceStatus: r.evidenceStatus,
      confirmationStatus: r.confirmationStatus,
      confirmationMethod: r.confirmationMethod,
      realizationVersion: r.version,
    }))
    .sort((a, b) => a.realizationId.localeCompare(b.realizationId));

  const content: CertificateContent = {
    format: CERTIFICATE_CONTENT_FORMAT,
    version: CERTIFICATE_CONTENT_VERSION,
    institutionId: input.activity.institutionId,
    activityId: input.activityId,
    certificateId: input.certificateId,
    certificateVersion: input.certificateVersion,
    proposalId: input.activity.proposalId,
    proposalVersion: input.activity.proposalVersion,
    activityName: input.activity.name,
    programFundType: input.activity.programFundType,
    targetAmount: input.activity.targetAmount,
    currencyUnit: input.activity.currencyUnit,
    frozenAt: input.frozenAt,
    realizations,
    totals: totalsOf(input.realizations),
  };

  const canonical = canonicalJson(content);
  return { content, canonical, bytes: new TextEncoder().encode(canonical) };
}

export const parseCertificateContent = (canonical: string): CertificateContent =>
  JSON.parse(canonical) as CertificateContent;

/** The commitment bound into the on-chain `Certification.digest`; salt stays server-side. */
export function certificateCommitment(bytes: Uint8Array, salt: string): string {
  return commitmentFor(bytes, salt);
}

export { newCommitmentSalt, sha256Hex };
