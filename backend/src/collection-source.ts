/** Rupiah collection source for period reports (#134). No donor identity enters the ledger. */
import { canonicalJson } from "../../shared/canonical-json";
import { COLLECTION_PROVENANCE_FILE_NAMES } from "../../shared/collection-provenance";
import type { ContributionRecord, ContributionCorrection, ContributionRefund } from "./contribution";
import type { ContributionStore, StoredContributionHistory, StoredContributionDocument } from "./contribution-store";
import type { ReadSide, SubmittedSide } from "./evidence-source";
import { periodBounds } from "./ledger-rows";
import { JENIS_DANA } from "./reconciliation";
import type { RealizationScope } from "./realization-source";
import type { SubmittedFile } from "./routes/evidence-preparation";

export const CONTRIBUTION_COLLECTION_STREAM = "CONTRIBUTION_COLLECTION";

export type CollectionRecord = {
  contribution: ContributionRecord;
  corrections: ContributionCorrection[];
  refunds: ContributionRefund[];
  history: StoredContributionHistory[];
  documents: StoredContributionDocument[];
};

/** Any missing relation or concurrent change fails the whole read, never an invented zero. */
export async function readCollectionRecords(store: ContributionStore, institutionId: string): Promise<CollectionRecord[]> {
  const contributions = await store.listContributions(institutionId, { currencyUnit: "IDR" });
  return Promise.all(contributions.sort((a, b) => a.id.localeCompare(b.id)).map(async (contribution) => {
    const [corrections, refunds, history, documents] = await Promise.all([
      store.listCorrections(institutionId, contribution.id), store.listRefunds(institutionId, contribution.id),
      store.getHistory(institutionId, contribution.id), store.listDocuments(institutionId, contribution.id),
    ]);
    const current = await store.getContribution(institutionId, contribution.id);
    if (!current || current.version !== contribution.version || current.updatedAt !== contribution.updatedAt) {
      throw new Error("Kontribusi berubah saat sumber laporan dibaca; muat ulang.");
    }
    return { contribution, corrections, refunds, history, documents };
  }));
}

export function buildCollectionSide(scope: RealizationScope, records: CollectionRecord[]) {
  const role = scope.role ?? "SOURCE";
  const bounds = periodBounds(scope.period);
  const from = Math.floor(bounds.from.getTime() / 1000);
  const to = Math.floor(bounds.to.getTime() / 1000);
  const cutoff = Math.floor(Date.parse(scope.cutOff) / 1000);
  if (!Number.isFinite(cutoff)) throw new Error("Batas data penghimpunan tidak sah.");
  const rows: ReadSide["rows"] = [];
  const included = [];
  const excludedAfterCutOff: string[] = [];
  for (const { contribution: c, corrections, refunds, history, documents } of records) {
    if (c.institutionId !== scope.institution.id) throw new Error("Cakupan kontribusi tidak cocok.");
    if (c.currencyUnit !== "IDR" || c.receivedAt < from || c.receivedAt >= to) continue;
    if (c.receivedAt > cutoff || c.createdAt > cutoff) { excludedAfterCutOff.push(c.id); continue; }
    // Restore the amount/status known at the cutoff, not the current corrected row.
    let amount = c.amountExact;
    let status = c.status;
    let version = c.version;
    for (const correction of [...corrections].sort((a, b) => b.toVersion - a.toVersion)) {
      if (correction.createdAt > cutoff) amount = correction.fromAmountExact;
    }
    for (const change of [...history].sort((a, b) => b.id - a.id)) {
      if (change.occurredAt > cutoff) {
        status = change.fromStatus;
        if (change.action !== "DECIDE_REFUND") version = Math.min(version, change.version - 1);
      }
    }
    if (!/^\d+$/.test(amount) || !JENIS_DANA.includes(c.fundType)) throw new Error("Nilai atau jenis dana kontribusi tidak sah.");
    const paidRefunds = refunds.filter(r => r.status === "PAID" && r.paidAt !== null && r.paidAt <= cutoff && r.updatedAt <= cutoff);
    const paid = paidRefunds.reduce((sum, r) => sum + BigInt(r.amountExact), 0n);
    // Same effective funding rule as donor/activity tracing: rejected backs nothing,
    // only paid refunds reduce it, and a correction below paid refunds floors at zero.
    const gross = status === "REJECTED" ? 0n : BigInt(amount);
    const net = gross > paid ? gross - paid : 0n;
    rows.push({ key: c.id, bucket: c.fundType, flow: "COLLECTION", balanceSheet: "ON", amount: net.toString(), unit: "IDR",
      amilAmount: null, label: `Kontribusi #${c.id}`, isDeclaredTotal: false });
    included.push({ contributionId: c.id, version, status, fundType: c.fundType, sourceChannel: c.sourceChannel,
      sourceReference: c.sourceReference, receivedAt: c.receivedAt, recordedAt: c.createdAt, amountExact: amount,
      paidRefundIdr: paid.toString(), effectiveAmountIdr: net.toString(),
      corrections: corrections.filter(r => r.createdAt <= cutoff), refunds: paidRefunds,
      documents: documents.filter(d => d.createdAt <= cutoff).map(d => ({ id: d.id, fileName: d.fileName,
        contentSha256: d.contentSha256, storageStatus: d.storageStatus, createdAt: d.createdAt })),
    });
  }
  const totalIdr = rows.reduce((sum, row) => sum + BigInt(row.amount), 0n).toString();
  const byFundType = JENIS_DANA.map(fundType => ({ fundType,
    amountIdr: rows.filter(r => r.bucket === fundType).reduce((sum, r) => sum + BigInt(r.amount), 0n).toString() }));
  const coverageNotes = [
    "Penghimpunan Rupiah berasal dari catatan kontribusi lembaga, bukan rekening koran independen. Koreksi dan pengembalian yang sudah dibayar dihitung hingga batas data; keputusan pengembalian yang belum dibayar tidak mengurangi penghimpunan.",
    ...(excludedAfterCutOff.length ? [`${excludedAfterCutOff.length} kontribusi dalam periode dicatat sesudah batas data; belum terperiksa pada snapshot ini, bukan tidak ada.`] : []),
  ];
  const side: ReadSide = { status: "READ", rows, manifest: {
    role, label: "Penghimpunan Rupiah", origin: "INTERNAL_LEDGER", flows: ["COLLECTION"], institutionId: scope.institution.id,
    scopeUnit: scope.institution.scopeUnit, scopeLevel: scope.institution.scopeLevel, fundTypes: [...JENIS_DANA],
    balanceSheet: "ON", currencyUnit: "IDR", period: scope.period, cutOff: scope.cutOff,
    format: "internal-contribution-collection", mappingVersion: "internal-contribution-collection-1",
    transactionDetail: "PRESENT", note: coverageNotes.join(" "),
  } };
  const provenance = { format: "tawf.collection.provenance", version: 1, role, institutionId: scope.institution.id,
    period: scope.period, cutOff: scope.cutOff, totals: { totalIdr, byFundType }, contributions: included, excludedAfterCutOff };
  const provenanceFile: SubmittedFile = { role, fileName: COLLECTION_PROVENANCE_FILE_NAMES[role], mimeType: "application/json",
    bytes: new TextEncoder().encode(canonicalJson(provenance)) };
  return { side, provenance, provenanceFile, coverageNotes, preview: { totalIdr, byFundType, afterCutOff: excludedAfterCutOff.length } };
}

/** Keep realization format/provenance intact for locks and historical tracing. */
export function withCollection(realization: SubmittedSide, collection: ReadSide): ReadSide {
  if (realization.status !== "READ") throw new Error("Sumber realisasi belum dapat dibaca.");
  return { ...realization, rows: [...realization.rows.map(row => ({ ...row, flow: "DISTRIBUTION" as const })), ...collection.rows],
    manifest: { ...realization.manifest, fundTypes: [...JENIS_DANA], flows: ["COLLECTION", "DISTRIBUTION"],
      mappingVersion: `${realization.manifest.mappingVersion}+collection-1`,
      note: `${realization.manifest.note ?? ""} ${collection.manifest.note ?? ""}`.trim() } };
}
