/**
 * Donor and amil tracing of one distribution activity from the same sources (Spec #100, Ticket #114).
 *
 * This module only reads and projects. Allocation, proving, minting, realization and report
 * snapshots keep their owners; nothing here recomputes a figure from NFT or proof counts.
 *
 * Every track is either `OK` with data or `UNAVAILABLE` with the reason, so a failed read is never
 * shown as zero or as a successful status. The tracks (delivery, funds, confirmation, distribution
 * certificate, plus the contribution proof on the donor side) are kept apart: one being complete
 * says nothing about the others.
 */
import type { ActivityAccountabilitySummary } from "./activity";
import { ActivityNotFoundError } from "./activity-store";
import type { RealizationRecord } from "./disbursement";
import type { WorkspaceRuntime } from "./workspace-runtime";
import type { DonorSession } from "./donor-access";
import type { Unavailable, Track, ConfirmationCounts, DeliveryHeadline, OpenItem, CertificateLineView, CertificateTrack, ActivityTrackView, DonorTraceActivity, DonorTrace, Difference, FrozenSource, AmilTrace } from "../../shared/activity-trace";
export type * from "../../shared/activity-trace";
import { createCertificateIssuance } from "./certificate-issuance";
import { createRestrictedDocuments } from "./restricted-documents";
import { DISBURSEMENT_REALIZATION_FORMAT } from "./realization-source";
import { z } from "zod";
import { DocumentError } from "./restricted-documents";

// Validate the allowlisted projection we consume; arbitrary file JSON is not a domain object.
const provenanceTraceSchema = z.object({
  format: z.literal("tawf.realization.provenance"), version: z.literal(2),
  role: z.enum(["CLAIM", "SOURCE"]), institutionId: z.string(),
  cutOff: z.iso.datetime(), frozenAt: z.number().int().nonnegative(),
  activityTrace: z.discriminatedUnion("available", [
    z.object({ available: z.literal(false), reason: z.string().min(1) }),
    z.object({ available: z.literal(true), coverage: z.string(), disclaimer: z.string(),
      realizationsWithoutActivity: z.array(z.string()), contributionsWithoutDonor: z.number().int().nonnegative(),
      activities: z.array(z.object({
        activityId: z.string(), proposalVersion: z.number().int().positive(),
        allocatedByUnit: z.record(z.string(), z.string().regex(/^\d+$/)),
        realizationIds: z.array(z.string()),
        allocations: z.array(z.object({ allocationId: z.string(), contributionId: z.string(),
          contributionVersion: z.number().int().positive(), amountExact: z.string().regex(/^\d+$/), currencyUnit: z.string() })),
      })),
    }),
  ]),
});
import { PROVENANCE_FILE_NAMES } from "../../shared/realization-provenance";

const unavailable = (reason: string): Unavailable => ({ status: "UNAVAILABLE", reason });
const ok = <T>(data: T): Track<T> => ({ status: "OK", data });

/** What a reader may and may not conclude, stated with the projection rather than beside it. */
export const TRACE_CLAIM_LIMITS = {
  pooled:
    "Dana dari banyak kontribusi digabung pada kegiatan ini. Kontribusi Anda tidak dinyatakan membiayai paket atau penerima tertentu, dan donatur lain tidak ditampilkan.",
  receipt:
    "Receipt ZK membuktikan catatan kontribusi termasuk dalam batch yang disahkan lembaga. Receipt bukan bukti fisik bahwa bantuan diterima penerima.",
  certificate:
    "NFT tahap menyatakan lembaga mengesahkan realisasi yang dibekukan pada tahap itu. NFT bukan laporan periode dua pengesahan dan tidak menjamin isinya masih berlaku.",
  report:
    "Angka rekap berasal dari catatan kegiatan dan snapshot laporan yang sama. Snapshot historis tidak menggantikan status kegiatan terkini.",
} as const;

// ---------------------------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------------------------

/** Counts as the realization records state them; a status that is not CONFIRMED or DISPUTED is unconfirmed. */
export function confirmationCounts(realizations: readonly Pick<RealizationRecord, "confirmationStatus">[]): ConfirmationCounts {
  let confirmed = 0;
  let disputed = 0;
  for (const r of realizations) {
    if (r.confirmationStatus === "CONFIRMED") confirmed += 1;
    else if (r.confirmationStatus === "DISPUTED") disputed += 1;
  }
  return { total: realizations.length, confirmed, disputed, unconfirmed: realizations.length - confirmed - disputed };
}

/**
 * "All packages handed over" is a statement about delivery only. It never hides what is still
 * open around it: unaccounted advances, disputes, unconfirmed receipts, a certificate not yet
 * published, or a source that could not be read.
 */
export function deliveryHeadline(input: {
  accountability: Pick<
    ActivityAccountabilitySummary,
    | "unitSummaries" | "totalCommittedAidIdr" | "isRemainderClosed" | "hasOutstandingAccountability"
    | "hasUnvaluedGoods" | "totalContributionShortfall" | "totalOverCommitmentIdr"
  >;
  recordedRealizations: number;
  confirmation: ConfirmationCounts | null;
  publicationPending: boolean | null;
  sourceGaps: boolean;
}): { headline: DeliveryHeadline; openItems: OpenItem[] } {
  const a = input.accountability;
  const everyUnitDelivered = a.unitSummaries.every((u) => BigInt(u.remaining) <= 0n);
  const nothingCommitted = BigInt(a.totalCommittedAidIdr) === 0n;
  const delivered = input.recordedRealizations > 0 && everyUnitDelivered && nothingCommitted;

  const open: OpenItem[] = [];
  if (a.hasOutstandingAccountability) open.push("COSTS_UNACCOUNTED");
  if (a.hasUnvaluedGoods && !a.isRemainderClosed) open.push("GOODS_UNVALUED");
  if (BigInt(a.totalContributionShortfall) > 0n) open.push("CONTRIBUTION_SHORTFALL");
  if (BigInt(a.totalOverCommitmentIdr) > 0n) open.push("OVER_COMMITMENT");
  if (input.confirmation && input.confirmation.disputed > 0) open.push("DISPUTE_OPEN");
  if (input.confirmation && input.confirmation.unconfirmed > 0) open.push("CONFIRMATION_PENDING");
  if (input.publicationPending) open.push("PUBLICATION_PENDING");
  if (input.sourceGaps) open.push("SOURCE_UNAVAILABLE");

  if (input.recordedRealizations === 0) return { headline: "NOT_STARTED", openItems: open };
  if (!delivered) return { headline: "IN_PROGRESS", openItems: open };
  return { headline: open.length ? "DELIVERED_WITH_OPEN_ITEMS" : "DELIVERED_AND_SETTLED", openItems: open };
}

// ---------------------------------------------------------------------------------------------
// Activity track, shared by donor and amil
// ---------------------------------------------------------------------------------------------

type Services = Pick<
  WorkspaceRuntime,
  "activities" | "disbursement" | "certificateStore" | "certificateChain" | "now"
>;

const failure = (error: unknown, message: string): Unavailable => {
  console.error("[trace]", message, error);
  return unavailable(message);
};

async function readCertificateTrack(runtime: Services, institutionId: string, activityId: string): Promise<Track<CertificateTrack>> {
  if (!runtime.certificateStore || !runtime.certificateChain || !runtime.activities || !runtime.disbursement) {
    return unavailable("Layanan sertifikat tahap distribusi belum dikonfigurasi pada deployment ini.");
  }
  try {
    const issuance = createCertificateIssuance(
      runtime, { store: runtime.certificateStore, chain: runtime.certificateChain },
      runtime.activities, runtime.disbursement, institutionId,
    );
    const intents = await runtime.certificateStore.list(institutionId, activityId);
    const ids = [...new Set(intents.map((i) => i.certification.certificateId))];
    // Every certificate line, and `line()`/`publicSummary()` within one line, reads the chain
    // independently: sequential awaits here serialized a donor's /trace request behind every
    // certificate line an activity has. Promise.all keeps `ids`' order in `lines`.
    const lines: CertificateLineView[] = await Promise.all(ids.map(async (certificateId) => {
      const [lifecycle, summary] = await Promise.all([issuance.line(certificateId), issuance.publicSummary(certificateId)]);
      const latest = lifecycle.versions.at(-1);
      if (!latest) throw new Error("Certificate line has no issuance version");
      const reason = {
        PREPARED: "Sertifikat disiapkan, belum diterbitkan.",
        SUBMITTED: "Transaksi penerbitan dikirim; menunggu hasil chain.",
        INCLUDED: "Penerbitan tercatat; menunggu kecukupan konfirmasi.",
        CONFIRMED: null,
        REVERTED: "Transaksi penerbitan gagal di chain; sertifikat dari percobaan ini belum terbit.",
        INVALID_EVENT: "Bukti penerbitan tidak sesuai; status sertifikat belum dapat disahkan.",
        NONCANONICAL: "Bukti penerbitan tidak lagi berada pada chain kanonik; verifikasi ulang diperlukan.",
      }[latest.observationState];
      return {
        certificateId,
        issuance: { state: latest.observationState, reason },
        published: summary && {
          version: summary.version,
          issuer: summary.issuer,
          contentDigest: summary.contentDigest,
          verifierPath: `/sertifikat?institutionId=${encodeURIComponent(institutionId)}&certificateId=${encodeURIComponent(certificateId)}&version=${encodeURIComponent(summary.version)}`,
          validity: summary.validity ?? null,
          observationState: summary.observation.state,
          replacementState: summary.replacement?.state ?? null,
          scopeStatus: summary.scope?.sourceStatus ?? null,
          totals: {
            confirmedCount: summary.totals.confirmedCount,
            disputedCount: summary.totals.disputedCount,
            unconfirmedCount: summary.totals.unconfirmedCount,
          },
        },
      };
    }));
    const pendingCount = lines.filter((l) => l.published?.validity !== "CURRENT").length;
    return ok({ lines, pendingCount });
  } catch (error) {
    return failure(error, "Status NFT distribusi tidak dapat diperiksa. Muat ulang sebelum menyimpulkan.");
  }
}

export async function readActivityTrack(
  runtime: Services, institutionId: string, activityId: string,
): Promise<ActivityTrackView | null> {
  if (!runtime.activities) return null;
  let detail;
  try {
    detail = await runtime.activities.getActivity(institutionId, activityId, false);
  } catch (error) {
    if (error instanceof ActivityNotFoundError) return null;
    throw error;
  }
  if (!detail) return null;
  const observedAt = runtime.now();
  const a = detail.accountability;

  let realizations: RealizationRecord[] | null = null;
  let realizationsFailure: Unavailable = unavailable("Penyimpanan realisasi penyaluran belum dikonfigurasi pada deployment ini.");
  if (runtime.disbursement) {
    try {
      realizations = await runtime.disbursement.getProposalRealizations(institutionId, detail.proposalId);
    } catch (error) {
      realizationsFailure = failure(error, "Catatan realisasi tidak dapat dibaca; jumlah tidak ditampilkan sebagai nol.");
    }
  }

  const confirmation: Track<ConfirmationCounts> = realizations ? ok(confirmationCounts(realizations)) : realizationsFailure;
  const certificates = await readCertificateTrack(runtime, institutionId, activityId);

  const recorded = realizations?.length ?? 0;
  const publicationPending =
    certificates.status === "OK"
      ? certificates.data.lines.length === 0 ? recorded > 0 : certificates.data.pendingCount > 0
      : null;
  const summary: ActivityTrackView["summary"] = realizations
    ? ok(deliveryHeadline({
        accountability: a, recordedRealizations: recorded,
        confirmation: confirmation.status === "OK" ? confirmation.data : null,
        publicationPending, sourceGaps: certificates.status === "UNAVAILABLE",
      }))
    : realizationsFailure;

  return {
    identity: {
      activityId: detail.id, proposalId: detail.proposalId, proposalVersion: detail.proposalVersion,
      activityVersion: detail.version, name: detail.name, currencyUnit: detail.currencyUnit, observedAt,
    },
    distribution: realizations
      ? ok({
          proposalStatus: a.proposalStatus, isRemainderClosed: a.isRemainderClosed, recordedRealizations: recorded,
          unitSummaries: a.unitSummaries, committedAidIdr: a.totalCommittedAidIdr, hasUnvaluedGoods: a.hasUnvaluedGoods,
        })
      : realizationsFailure,
    funds: ok({
      currencyUnit: a.currencyUnit, totalAllocatedAmount: a.totalAllocatedAmount,
      totalRealizedMoneyIdr: a.totalRealizedMoneyIdr, totalExpensesIdr: a.totalExpensesIdr,
      totalAdvancesIdr: a.totalAdvancesIdr, unaccountedAdvancesIdr: a.unaccountedAdvancesIdr,
      totalCommittedAidIdr: a.totalCommittedAidIdr, totalContributionShortfall: a.totalContributionShortfall,
      totalOverCommitmentIdr: a.totalOverCommitmentIdr, availabilityStatus: a.availabilityStatus,
      availabilityReason: a.availabilityReason,
    }),
    confirmation,
    certificates,
    summary,
  };
}

// ---------------------------------------------------------------------------------------------
// Donor projection
// ---------------------------------------------------------------------------------------------

export async function buildDonorTrace(runtime: WorkspaceRuntime, session: DonorSession): Promise<DonorTrace> {
  const store = runtime.donorAccess!;
  const [contribution, allocations, changes] = await Promise.all([
    store.getDonorContribution(session),
    store.getDonorAllocations(session),
    store.getDonorReallocations(session),
  ]);

  const activities: DonorTraceActivity[] = [];
  for (const allocation of allocations) {
    let track: ActivityTrackView | Unavailable;
    try {
      track = (await readActivityTrack(runtime, session.institutionId, allocation.activityId)) ?? unavailable("Kegiatan tidak ditemukan.");
    } catch (error) {
      track = failure(error, "Progres kegiatan tidak dapat dibaca. Ini bukan berarti kegiatan belum berjalan.");
    }
    activities.push({
      allocationId: allocation.allocationId,
      allocatedAmountExact: allocation.amountExact,
      currencyUnit: allocation.currencyUnit,
      fundType: allocation.fundType,
      allocatedAt: allocation.allocatedAt,
      allocatedAgainstVersion: allocation.contributionVersion,
      allocationBasis: allocation.contributionVersion < contribution.version ? "BEFORE_CORRECTION" : "CURRENT",
      pooledAllocationCount: allocation.activity.pooled.allocationCount,
      track,
    });
  }

  let refunds: Track<import("../../shared/activity-trace").DonorRefund[]> = unavailable("Penyimpanan pengembalian kontribusi belum dikonfigurasi.");
  if (runtime.contributions) {
    try {
      refunds = ok((await runtime.contributions.listRefunds(session.institutionId, session.contributionId)).map((r) => ({
        id: r.id, status: r.status, amountExact: r.amountExact, currencyUnit: r.currencyUnit,
        decidedAt: r.decidedAt, paidAt: r.paidAt,
      })));
    } catch (error) {
      refunds = failure(error, "Riwayat pengembalian tidak dapat dibaca; ini bukan berarti belum ada pengembalian.");
    }
  }
  const proofVersion = contribution.zkProof.version;
  return {
    contribution: {
      id: contribution.id,
      version: contribution.version,
      status: contribution.status,
      receivedAt: contribution.receivedAt,
      corrections: contribution.corrections,
      proof: contribution.zkProof,
      proofMatchesContributionVersion: proofVersion === undefined ? null : proofVersion === contribution.version,
    },
    activities,
    changes,
    refunds,
    claimLimits: TRACE_CLAIM_LIMITS,
    receiptVerifierPath: `/api/public/receipt-verification/${encodeURIComponent(contribution.id)}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Amil recap: current activity state beside the report snapshots that froze it
// ---------------------------------------------------------------------------------------------

export function differencesFromCurrent(
  frozen: { proposalVersion: number; allocatedByUnit: Record<string, string>; realizationCount: number },
  current: { proposalVersion: number; currencyUnit: string; totalAllocatedAmount: string; recordedRealizations: number | null },
): Difference[] {
  const out: Difference[] = [];
  if (frozen.proposalVersion !== current.proposalVersion) out.push("PROPOSAL_VERSION");
  if ((frozen.allocatedByUnit[current.currencyUnit] ?? "0") !== current.totalAllocatedAmount) out.push("ALLOCATED_TOTAL");
  if (current.recordedRealizations !== null && frozen.realizationCount !== current.recordedRealizations) out.push("REALIZATION_COUNT");
  return out;
}

async function readFrozenSources(runtime: WorkspaceRuntime, institutionId: string, track: ActivityTrackView): Promise<Track<FrozenSource[]>> {
  if (!runtime.evidence) return unavailable("Penyimpanan bukti laporan belum dikonfigurasi pada deployment ini.");
  try {
    const documents = createRestrictedDocuments(runtime.evidence, runtime.files);
    const sources: FrozenSource[] = [];
    const current = {
      proposalVersion: track.identity.proposalVersion,
      currencyUnit: track.identity.currencyUnit,
      totalAllocatedAmount: track.funds.status === "OK" ? track.funds.data.totalAllocatedAmount : "0",
      recordedRealizations: track.distribution.status === "OK" ? track.distribution.data.recordedRealizations : null,
    };
    for (const summary of await runtime.evidence.listPreparations(institutionId)) {
      const stored = await runtime.evidence.getPreparation(institutionId, summary.id);
      if (!stored) continue;
      for (const side of stored.sides) {
        if (side.manifest.origin !== "INTERNAL_LEDGER" || side.manifest.format !== DISBURSEMENT_REALIZATION_FORMAT) continue;
        const role = side.manifest.role;
        if (side.status !== "READ") {
          sources.push({ status: side.status === "FAILED" ? "FAILED" : "UNAVAILABLE", preparationId: summary.id, label: summary.label, role,
            reason: side.detail || "Sumber realisasi tidak tersedia; cakupan kegiatan belum dapat diperiksa." });
          continue;
        }
        const file = stored.files.find((f) => f.role === role && f.fileName === PROVENANCE_FILE_NAMES[role]);
        if (!file) {
          sources.push({ status: "UNAVAILABLE", preparationId: summary.id, label: summary.label, role, reason: "Berkas penelusuran realisasi tidak ada dalam paket ini." });
          continue;
        }
        let bytes: Uint8Array;
        try {
          bytes = (await documents.read({ institutionId, preparationId: summary.id }, file.id)).bytes;
        } catch (error) {
          const corrupt = error instanceof DocumentError && (error.reason === "CORRUPT" || error.reason === "BINDING");
          const missing = error instanceof DocumentError && (error.reason === "MISSING" || error.reason === "NOT_FOUND");
          sources.push({ status: corrupt ? "FAILED" : "UNAVAILABLE", preparationId: summary.id, label: summary.label, role,
            reason: corrupt ? "Integritas berkas penelusuran realisasi rusak." : missing
              ? "Berkas penelusuran realisasi tidak ditemukan dalam penyimpanan."
              : "Berkas penelusuran realisasi belum dapat dibaca; rincian tidak ditampilkan sebagai kosong." });
          continue;
        }
        let provenance: z.infer<typeof provenanceTraceSchema>;
        try {
          provenance = provenanceTraceSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
          if (provenance.role !== role || provenance.institutionId !== institutionId) throw new Error("Scope mismatch");
        } catch {
          sources.push({ status: "FAILED", preparationId: summary.id, label: summary.label, role, reason: "Format atau struktur berkas penelusuran realisasi tidak sah." });
          continue;
        }
        if (!provenance.activityTrace.available) {
          sources.push({ status: "UNAVAILABLE", preparationId: summary.id, label: summary.label, role, reason: provenance.activityTrace.reason });
          continue;
        }
        const frozenActivity = provenance.activityTrace.activities.find((x) => x.activityId === track.identity.activityId);
        if (!frozenActivity) continue;
        const frozen = {
          proposalVersion: frozenActivity.proposalVersion,
          allocatedByUnit: frozenActivity.allocatedByUnit,
          allocationCount: frozenActivity.allocations.length,
          realizationCount: frozenActivity.realizationIds.length,
        };
        sources.push({
          status: "READ", preparationId: summary.id, label: summary.label, role, commitment: summary.commitment,
          periodKind: summary.periodKind, periodYear: summary.periodYear, cutOff: provenance.cutOff,
          frozenAt: provenance.frozenAt, currentness: "HISTORICAL_SNAPSHOT", frozen,
          differsFromCurrent: differencesFromCurrent(frozen, current),
        });
      }
    }
    return ok(sources);
  } catch (error) {
    return failure(error, "Sumber laporan tidak dapat dibaca. Ini tidak berarti belum ada laporan.");
  }
}

export async function buildAmilTrace(runtime: WorkspaceRuntime, institutionId: string, activityId: string): Promise<AmilTrace | null> {
  const activity = await readActivityTrack(runtime, institutionId, activityId);
  if (!activity) return null;
  return {
    activity,
    reportSources: await readFrozenSources(runtime, institutionId, activity),
    claimLimits: { report: TRACE_CLAIM_LIMITS.report, certificate: TRACE_CLAIM_LIMITS.certificate },
  };
}
