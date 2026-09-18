/**
 * Beneficiary re-upload diff rules — pure core for re-uploading rosters (Spec #86, Ticket #97, ADR-0017 §1).
 *
 * Computes exact diffs between baseline proposal data and an uploaded roster:
 * added, modified (with field-level before/after), removed, unchanged rows,
 * unit totals before and after, floor rule validation for approved proposals,
 * and stable line ID preservation.
 */

import { canonicalJson } from "./canonical-json";
import { addDecimalStrings } from "./exact-decimal";
import {
  calculateRevisionDelta,
  validateRevisionFloor,
  type RevisableAidLine,
  type RevisableBeneficiary,
  type RevisionDelta,
  type RevisionFloorVerdict,
  type RevisionRealization,
} from "./proposal-revision";

export type RosterBeneficiary = RevisableBeneficiary & {
  name: string; asnaf: string; addressOrScope: string;
  identityBasis: { kind: string; value?: string; description?: string };
  guardian?: { name: string; relationship: string } | null;
  paymentRecipient?: { name: string; relation: string } | null;
  contact?: { phone?: string | null; email?: string | null; relation?: string | null } | null;
};
export type RosterAidLine = RevisableAidLine & {
  aidType: string; period: string; evidenceReference?: string | null;
  value: RevisableAidLine["value"] & { valuedAmountIdr?: string | null; valuationBasis?: string | null };
};

const requestedLine = <L extends RosterAidLine>(line: L) => {
  const { amountApprovedIdr: _money, quantityApproved: _goods, ...value } = line.value as L["value"] & { amountApprovedIdr?: string | null; quantityApproved?: string | null };
  return { ...line, value };
};

/** Approval belongs to the same recipient and unchanged material, never just a line id. */
export function preserveRosterApprovals<B extends RosterBeneficiary, L extends RosterAidLine>(
  previous: { beneficiaries: B[]; aidLines: L[] }, revised: { beneficiaries: B[]; aidLines: L[] }
): L[] {
  const oldLines = new Map(previous.aidLines.map(line => [line.id, line]));
  const oldPeople = new Map(previous.beneficiaries.map(person => [person.id, person]));
  const people = new Map(revised.beneficiaries.map(person => [person.id, person]));
  return revised.aidLines.map(line => {
    const before = oldLines.get(line.id);
    return before && canonicalJson(oldPeople.get(before.beneficiaryId) ?? null) === canonicalJson(people.get(line.beneficiaryId) ?? null)
      && canonicalJson(requestedLine(before)) === canonicalJson(requestedLine(line)) ? before : line;
  });
}

function aidValueLabel(line: RosterAidLine): string {
  return line.value.kind === "MONEY" ? `Rp${line.value.amountApprovedIdr ?? line.value.amountRequestedIdr}`
    : `${line.value.quantityApproved ?? line.value.quantityRequested} ${line.value.unit}`;
}

export type DiffStatus = "ADDED" | "MODIFIED" | "REMOVED" | "UNCHANGED";

export type FieldDiff = {
  field: string;
  label: string;
  before: string;
  after: string;
};

export type RosterChangeCounts = {
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
};

export type RosterChangeRowDetail = {
  aidLineId: string;
  beneficiaryId: string;
  status: DiffStatus;
  name: string;
  asnaf: string;
  aidType: string;
  unit: string;
  valueBefore: string | null;
  valueAfter: string | null;
  changes: FieldDiff[];
};

export type RosterChangeDiffResult<B extends RosterBeneficiary, L extends RosterAidLine> = {
  proposalId: string;
  baseVersion: number;
  fileInfo: {
    fileName: string;
    fileSha256: string;
    format: "xlsx" | "csv";
  };
  beneficiaries: RevisionDelta<B>;
  aidLines: RevisionDelta<L>;
  beneficiaryCounts: RosterChangeCounts;
  aidLineCounts: RosterChangeCounts;
  totalsBefore: Record<string, string>;
  totalsAfter: Record<string, string>;
  isIdentical: boolean;
  heldAidLineIds: string[];
  unchangedAidLineIds: string[];
  rowDetails: RosterChangeRowDetail[];
  floorVerdict?: RevisionFloorVerdict;
  canApply: boolean;
};

export function describeBeneficiaryChanges(before: RosterBeneficiary, after: RosterBeneficiary): FieldDiff[] {
  const changes: FieldDiff[] = [];
  if (before.name !== after.name) {
    changes.push({ field: "name", label: "Nama", before: before.name ?? "-", after: after.name ?? "-" });
  }
  const beforeNik = before.identityBasis?.kind === "NIK" ? before.identityBasis.value : before.identityBasis?.description;
  const afterNik = after.identityBasis?.kind === "NIK" ? after.identityBasis.value : after.identityBasis?.description;
  if (beforeNik !== afterNik || before.identityBasis?.kind !== after.identityBasis?.kind) {
    changes.push({
      field: "identityBasis",
      label: "Identitas",
      before: beforeNik ? "Tersimpan (terbatas)" : "Tidak ada",
      after: afterNik ? "Diubah (terbatas)" : "Tidak ada",
    });
  }
  if (before.asnaf !== after.asnaf) {
    changes.push({ field: "asnaf", label: "Asnaf", before: before.asnaf ?? "-", after: after.asnaf ?? "-" });
  }
  if (before.addressOrScope !== after.addressOrScope) {
    changes.push({ field: "addressOrScope", label: "Alamat / Cakupan", before: before.addressOrScope ?? "-", after: after.addressOrScope ?? "-" });
  }
  const beforeGuardian = before.guardian ? `${before.guardian.name} (${before.guardian.relationship})` : null;
  const afterGuardian = after.guardian ? `${after.guardian.name} (${after.guardian.relationship})` : null;
  if (beforeGuardian !== afterGuardian) {
    changes.push({ field: "guardian", label: "Perwakilan / Wali", before: beforeGuardian ?? "Tidak ada", after: afterGuardian ?? "Tidak ada" });
  }
  const beforePayment = before.paymentRecipient ? `${before.paymentRecipient.name} (${before.paymentRecipient.relation})` : null;
  const afterPayment = after.paymentRecipient ? `${after.paymentRecipient.name} (${after.paymentRecipient.relation})` : null;
  if (beforePayment !== afterPayment) {
    changes.push({ field: "paymentRecipient", label: "Penerima Pembayaran", before: beforePayment ?? "Tidak ada", after: afterPayment ?? "Tidak ada" });
  }
  const beforeContact = before.contact ? `${before.contact.phone || ""} ${before.contact.email || ""} ${before.contact.relation || ""}`.trim() : null;
  const afterContact = after.contact ? `${after.contact.phone || ""} ${after.contact.email || ""} ${after.contact.relation || ""}`.trim() : null;
  if (beforeContact !== afterContact) {
    changes.push({ field: "contact", label: "Kontak", before: beforeContact ? "Tersimpan (terbatas)" : "Tidak ada", after: afterContact ? "Diubah (terbatas)" : "Tidak ada" });
  }
  return changes;
}

export function describeAidLineChanges(before: RosterAidLine, after: RosterAidLine): FieldDiff[] {
  const changes: FieldDiff[] = [];
  if (before.beneficiaryId !== after.beneficiaryId) {
    changes.push({ field: "beneficiaryId", label: "Penerima bantuan", before: "Penerima sebelumnya", after: "Penerima berbeda" });
  }
  if (before.aidType !== after.aidType) {
    changes.push({ field: "aidType", label: "Nama Bantuan", before: before.aidType ?? "-", after: after.aidType ?? "-" });
  }
  if (before.period !== after.period) {
    changes.push({ field: "period", label: "Periode", before: before.period ?? "-", after: after.period ?? "-" });
  }
  if (before.value?.kind !== after.value?.kind) {
    changes.push({ field: "value.kind", label: "Bentuk Bantuan", before: before.value?.kind ?? "-", after: after.value?.kind ?? "-" });
  }
  if (before.value?.kind === "MONEY" && after.value?.kind === "MONEY") {
    const bAmt = before.value.amountApprovedIdr ?? before.value.amountRequestedIdr;
    const aAmt = after.value.amountApprovedIdr ?? after.value.amountRequestedIdr;
    if (bAmt !== aAmt) {
      changes.push({ field: "amountIdr", label: "Nominal Uang (IDR)", before: `Rp${bAmt}`, after: `Rp${aAmt}` });
    }
  }
  if (before.value?.kind === "GOODS" && after.value?.kind === "GOODS") {
    const bQty = before.value.quantityApproved ?? before.value.quantityRequested;
    const aQty = after.value.quantityApproved ?? after.value.quantityRequested;
    if (bQty !== aQty || before.value.unit !== after.value.unit) {
      changes.push({ field: "quantity", label: "Kuantitas Barang", before: `${bQty} ${before.value.unit}`, after: `${aQty} ${after.value.unit}` });
    }
    if (before.value.valuedAmountIdr !== after.value.valuedAmountIdr) {
      changes.push({ field: "valuedAmountIdr", label: "Valuasi IDR Barang", before: before.value.valuedAmountIdr ? `Rp${before.value.valuedAmountIdr}` : "-", after: after.value.valuedAmountIdr ? `Rp${after.value.valuedAmountIdr}` : "-" });
    }
    if (before.value.valuationBasis !== after.value.valuationBasis) {
      changes.push({ field: "valuationBasis", label: "Dasar Valuasi Barang", before: before.value.valuationBasis ?? "-", after: after.value.valuationBasis ?? "-" });
    }
  }
  if (before.evidenceReference !== after.evidenceReference) {
    changes.push({ field: "evidenceReference", label: "Referensi Bukti", before: before.evidenceReference ?? "-", after: after.evidenceReference ?? "-" });
  }
  return changes;
}

export function calculateTotalsByUnit(aidLines: RosterAidLine[]): Record<string, string> {
  const totals: Record<string, string> = {};
  for (const line of aidLines) {
    if (!line?.value) continue;
    if (line.value.kind === "MONEY") {
      const amount = line.value.amountApprovedIdr ?? line.value.amountRequestedIdr;
      if (amount && /^\d+$/.test(amount)) {
        totals.IDR = addDecimalStrings(totals.IDR ?? "0", amount);
      }
    } else if (line.value.kind === "GOODS") {
      const qty = line.value.quantityApproved ?? line.value.quantityRequested;
      const unit = line.value.unit || "Item";
      const key = `${line.aidType || "Barang"}:${unit}`;
      if (qty && /^\d+(\.\d+)?$/.test(qty)) {
        totals[key] = addDecimalStrings(totals[key] ?? "0", qty);
      }
    }
  }
  return totals;
}

export function calculateRosterChangeDiff<B extends RosterBeneficiary, L extends RosterAidLine>(params: {
  proposalId: string;
  baseVersion: number;
  fileInfo: { fileName: string; fileSha256: string; format: "xlsx" | "csv" };
  previous: { beneficiaries: B[]; aidLines: L[] };
  revised: { beneficiaries: B[]; aidLines: L[] };
  realizations?: RevisionRealization[];
  isApproved?: boolean;
  hasFileIssues?: boolean;
}): RosterChangeDiffResult<B, L> {
  const delta = calculateRevisionDelta(params.previous, params.revised);

  const beneficiaryCounts: RosterChangeCounts = {
    added: delta.beneficiaries.added.length,
    modified: delta.beneficiaries.modified.length,
    removed: delta.beneficiaries.removed.length,
    unchanged: delta.beneficiaries.unchanged.length,
  };

  const aidLineCounts: RosterChangeCounts = {
    added: delta.aidLines.added.length,
    modified: delta.aidLines.modified.length,
    removed: delta.aidLines.removed.length,
    unchanged: delta.aidLines.unchanged.length,
  };

  const isIdentical = !params.hasFileIssues &&
    beneficiaryCounts.added === 0 &&
    beneficiaryCounts.modified === 0 &&
    beneficiaryCounts.removed === 0 &&
    aidLineCounts.added === 0 &&
    aidLineCounts.modified === 0 &&
    aidLineCounts.removed === 0;

  const totalsBefore = calculateTotalsByUnit(params.previous.aidLines);
  const totalsAfter = calculateTotalsByUnit(params.revised.aidLines);

  let floorVerdict: RevisionFloorVerdict | undefined;
  if (params.isApproved && params.realizations) {
    floorVerdict = validateRevisionFloor(params.previous.aidLines, params.revised.aidLines, params.realizations);
  }

  // Build row details for visual table inspection
  const prevBeneficiariesById = new Map(params.previous.beneficiaries.map((b) => [b.id, b]));
  const revBeneficiariesById = new Map(params.revised.beneficiaries.map((b) => [b.id, b]));
  const prevLinesById = new Map(params.previous.aidLines.map((l) => [l.id, l]));

  const rowDetails: RosterChangeRowDetail[] = [];

  // Active / revised lines
  for (const line of params.revised.aidLines) {
    const prevLine = prevLinesById.get(line.id);
    const revB = revBeneficiariesById.get(line.beneficiaryId);
    const prevB = prevLine ? prevBeneficiariesById.get(prevLine.beneficiaryId) : undefined;

    const changes: FieldDiff[] = [];
    let status: DiffStatus = "UNCHANGED";

    if (!prevLine) {
      status = "ADDED";
    } else {
      const lineChanges = describeAidLineChanges(prevLine, line);
      const bChanges = prevB && revB ? describeBeneficiaryChanges(prevB, revB) : [];
      changes.push(...lineChanges, ...bChanges);
      if (changes.length > 0) {
        status = "MODIFIED";
      }
    }

    const valueBefore = prevLine ? aidValueLabel(prevLine) : null;
    const valueAfter = aidValueLabel(line);

    rowDetails.push({
      aidLineId: line.id,
      beneficiaryId: line.beneficiaryId,
      status,
      name: revB?.name ?? "-",
      asnaf: revB?.asnaf ?? "-",
      aidType: line.aidType ?? "-",
      unit: line.value?.kind === "MONEY" ? "IDR" : (line.value?.unit ?? "Item"),
      valueBefore,
      valueAfter,
      changes,
    });
  }

  // Removed lines
  for (const removedLine of delta.aidLines.removed) {
    const prevB = prevBeneficiariesById.get(removedLine.beneficiaryId);
    const valueBefore = aidValueLabel(removedLine);

    rowDetails.push({
      aidLineId: removedLine.id,
      beneficiaryId: removedLine.beneficiaryId,
      status: "REMOVED",
      name: prevB?.name ?? "-",
      asnaf: prevB?.asnaf ?? "-",
      aidType: removedLine.aidType ?? "-",
      unit: removedLine.value?.kind === "MONEY" ? "IDR" : (removedLine.value?.unit ?? "Item"),
      valueBefore,
      valueAfter: null,
      changes: [{ field: "aidLine", label: "Rincian Bantuan", before: "Aktif", after: "Dihapus" }],
    });
  }

  const canApply = !params.hasFileIssues && (!floorVerdict || floorVerdict.ok);

  if (params.hasFileIssues) {
    delta.beneficiaries.removed = [];
    delta.aidLines.removed = [];
    beneficiaryCounts.removed = 0;
    aidLineCounts.removed = 0;
  }
  return {
    proposalId: params.proposalId,
    baseVersion: params.baseVersion,
    fileInfo: params.fileInfo,
    beneficiaries: delta.beneficiaries,
    aidLines: delta.aidLines,
    beneficiaryCounts,
    aidLineCounts,
    totalsBefore,
    totalsAfter,
    isIdentical,
    heldAidLineIds: delta.heldAidLineIds,
    unchangedAidLineIds: delta.unchangedAidLineIds,
    rowDetails: params.hasFileIssues ? rowDetails.filter(row => row.status !== "REMOVED") : rowDetails,
    floorVerdict,
    canApply,
  };
}
