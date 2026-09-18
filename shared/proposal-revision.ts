/**
 * Proposal revision rules — one pure core, two callers (ADR-0017 §1).
 *
 * The delta between an in-force proposal version and its proposed successor, and the floor
 * that stops a revised entitlement from dropping below what has already been realized, are
 * the same rules whether the amil sees them previewed in the browser or the server binds
 * them into a stored revision. They live here so a fix to either applies to both.
 *
 * The module is structural on purpose: it names only the fields it reads, so the backend's
 * `AidLine` / `Beneficiary` and the frontend's mirrored types both satisfy it without
 * either side importing the other's module.
 */

import { addDecimalStrings, compareDecimalStrings } from "./exact-decimal";
import { canonicalJson } from "./canonical-json";

export type RevisableBeneficiary = { id: string };

export type RevisableAidValue =
  | { kind: "MONEY"; amountRequestedIdr: string; amountApprovedIdr?: string | null }
  | {
      kind: "GOODS";
      unit: string;
      quantityRequested: string;
      quantityApproved?: string | null;
    };

export type RevisableAidLine = {
  id: string;
  beneficiaryId: string;
  value: RevisableAidValue;
};

/** Only the realized figures the floor rule reads; one of the two amounts is always null. */
export type RevisionRealization = {
  aidLineId: string;
  amountIdr?: string | null;
  quantity?: string | null;
};

export type RevisionDelta<T> = {
  added: T[];
  removed: T[];
  modified: Array<{ before: T; after: T }>;
  unchanged: T[];
};

export type RevisionDeltaResult<B, L> = {
  beneficiaries: RevisionDelta<B>;
  aidLines: RevisionDelta<L>;
  /** Added, modified and removed lines: withheld from realization until the revision is settled. */
  heldAidLineIds: string[];
  /** Untouched lines keep following the approval in force. */
  unchangedAidLineIds: string[];
};

export type ProposalVersionContent<B, L> = { beneficiaries: B[]; aidLines: L[] };

/** Key order must not decide whether two records count as equal. */
const sameContent = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

function diffById<T extends { id: string }>(previous: T[], revised: T[]): RevisionDelta<T> {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const revisedById = new Map(revised.map((item) => [item.id, item]));

  const added: T[] = [];
  const modified: Array<{ before: T; after: T }> = [];
  const unchanged: T[] = [];

  for (const item of revised) {
    const before = previousById.get(item.id);
    if (!before) added.push(item);
    else if (!sameContent(before, item)) modified.push({ before, after: item });
    else unchanged.push(item);
  }

  const removed = previous.filter((item) => !revisedById.has(item.id));
  return { added, removed, modified, unchanged };
}

export function calculateRevisionDelta<B extends RevisableBeneficiary, L extends RevisableAidLine>(
  previous: ProposalVersionContent<B, L>,
  revised: ProposalVersionContent<B, L>
): RevisionDeltaResult<B, L> {
  const beneficiaries = diffById(previous.beneficiaries, revised.beneficiaries);
  const aidLines = diffById(previous.aidLines, revised.aidLines);

  return {
    beneficiaries,
    aidLines,
    heldAidLineIds: [
      ...aidLines.added.map((line) => line.id),
      ...aidLines.modified.map((change) => change.after.id),
      ...aidLines.removed.map((line) => line.id),
    ],
    unchangedAidLineIds: aidLines.unchanged.map((line) => line.id),
  };
}

/** What each aid line has already been disbursed, in its own unit. */
export function accumulateRealizedPerLine(realizations: RevisionRealization[]): {
  idr: Map<string, bigint>;
  quantity: Map<string, string>;
} {
  const idr = new Map<string, bigint>();
  const quantity = new Map<string, string>();
  for (const realization of realizations) {
    if (realization.amountIdr != null) {
      idr.set(realization.aidLineId, (idr.get(realization.aidLineId) ?? 0n) + BigInt(realization.amountIdr));
    }
    if (realization.quantity != null) {
      const running = quantity.get(realization.aidLineId) ?? "0";
      quantity.set(realization.aidLineId, addDecimalStrings(running, realization.quantity));
    }
  }
  return { idr, quantity };
}

export type RevisionFloorVerdict = { ok: true } | { ok: false; error: string; aidLineId: string };

/**
 * A revised entitlement may not fall below what the beneficiary has already received, and a
 * realized line may not be deleted, handed to someone else, or switched between money and goods.
 */
export function validateRevisionFloor(
  previousAidLines: RevisableAidLine[],
  revisedAidLines: RevisableAidLine[],
  realizations: RevisionRealization[]
): RevisionFloorVerdict {
  const realized = accumulateRealizedPerLine(realizations);
  const previousById = new Map(previousAidLines.map((line) => [line.id, line]));
  const revisedById = new Map(revisedAidLines.map((line) => [line.id, line]));

  const refuse = (aidLineId: string, error: string): RevisionFloorVerdict => ({ ok: false, error, aidLineId });

  for (const [aidLineId, realizedIdr] of realized.idr) {
    if (realizedIdr <= 0n) continue;
    const revised = revisedById.get(aidLineId);
    if (!revised) {
      return refuse(
        aidLineId,
        `Rincian bantuan '${aidLineId}' telah memiliki realisasi sebesar Rp${realizedIdr} dan tidak dapat dihapus.`
      );
    }
    const previous = previousById.get(aidLineId);
    if (previous && revised.beneficiaryId !== previous.beneficiaryId) {
      return refuse(
        aidLineId,
        `Penerima manfaat pada baris '${aidLineId}' tidak dapat diubah karena telah memiliki realisasi.`
      );
    }
    if (revised.value.kind !== "MONEY") {
      return refuse(
        aidLineId,
        `Bentuk bantuan pada baris '${aidLineId}' tidak dapat diubah menjadi barang karena telah memiliki realisasi uang.`
      );
    }
    const revisedAmount = revised.value.amountApprovedIdr ?? revised.value.amountRequestedIdr;
    if (BigInt(revisedAmount) < realizedIdr) {
      return refuse(
        aidLineId,
        `Hak bantuan revisi pada baris '${aidLineId}' (Rp${revisedAmount}) tidak boleh turun di bawah realisasi yang sudah tercatat (Rp${realizedIdr}).`
      );
    }
  }

  for (const [aidLineId, realizedQuantity] of realized.quantity) {
    if (compareDecimalStrings(realizedQuantity, "0") <= 0) continue;
    const revised = revisedById.get(aidLineId);
    if (!revised) {
      return refuse(
        aidLineId,
        `Rincian bantuan barang '${aidLineId}' telah memiliki realisasi sebesar ${realizedQuantity} dan tidak dapat dihapus.`
      );
    }
    const previous = previousById.get(aidLineId);
    if (previous && revised.beneficiaryId !== previous.beneficiaryId) {
      return refuse(
        aidLineId,
        `Penerima manfaat pada baris barang '${aidLineId}' tidak dapat diubah karena telah memiliki realisasi.`
      );
    }
    if (revised.value.kind !== "GOODS") {
      return refuse(
        aidLineId,
        `Bentuk bantuan pada baris '${aidLineId}' tidak dapat diubah menjadi uang karena telah memiliki realisasi barang.`
      );
    }
    if (previous && previous.value.kind === "GOODS" && revised.value.unit !== previous.value.unit) {
      return refuse(
        aidLineId,
        `Satuan barang pada baris '${aidLineId}' ('${revised.value.unit}') tidak boleh diubah dari satuan yang telah terealisasi ('${previous.value.unit}').`
      );
    }
    const revisedQuantity = revised.value.quantityApproved ?? revised.value.quantityRequested;
    if (compareDecimalStrings(revisedQuantity, realizedQuantity) < 0) {
      return refuse(
        aidLineId,
        `Kuantitas barang revisi pada baris '${aidLineId}' (${revisedQuantity}) tidak boleh turun di bawah realisasi yang sudah tercatat (${realizedQuantity}).`
      );
    }
  }

  return { ok: true };
}
