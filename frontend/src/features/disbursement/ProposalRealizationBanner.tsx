import { RealizationSummaryMetrics } from "./RealizationSummaryMetrics";
import { compareDecimalStrings } from "../../../../shared/exact-decimal";
import { useRealizationOverview, useInvalidateRealizations } from "./useRealizationQueries";
import { useState } from "react";
import { AlertTriangle, Banknote, Coins, Edit3, FileCheck, FileSpreadsheet, PlusCircle, XCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";
import {
  DISBURSEMENT_METHOD_LABELS,
  downloadRealizationDocument,
  REALIZATION_DOCUMENT_TYPE_LABELS,
  type ConfirmationStatus,
  type DisbursementRealization,
  type ProposalDraft,
  type RealizationDocument,
} from "./disbursementClient";
import { RecordRealizationModal } from "./RecordRealizationModal";
import { RealizationEvidenceModal, evidencedIdr } from "./RealizationEvidenceModal";
import { RecipientConfirmationModal } from "./RecipientConfirmationModal";
import { RealizationDisputeModal } from "./RealizationDisputeModal";
import { AdvancesAndExpensesModal } from "./AdvancesAndExpensesModal";
import { ProposalRevisionModal } from "./ProposalRevisionModal";
import { ProposalCancellationModal } from "./ProposalCancellationModal";
import { ProposalClosureModal } from "./ProposalClosureModal";
import { RevisionWorkflowBanner } from "./RevisionWorkflowBanner";
import { BeneficiaryRosterChangeModal } from "./BeneficiaryRosterChangeModal";

type Open =
  | { kind: "record" }
  | { kind: "advances" }
  | { kind: "revision" }
  | { kind: "reupload" }
  | { kind: "cancel" }
  | { kind: "closeRemainder" }
  | { kind: "evidence" | "confirm" | "dispute"; realization: DisbursementRealization }
  | null;

const CONFIRMATION_TEXT: Record<ConfirmationStatus, string> = {
  UNCONFIRMED: "Belum dikonfirmasi penerima",
  CONFIRMED: "Dikonfirmasi",
  DISPUTED: "Diperselisihkan, konfirmasi ditahan",
};

/**
 * Staged IDR realization of an approved proposal. Disbursement progress, evidence completeness
 * and recipient confirmation are shown separately; none of them implies the others or an audit opinion.
 */
export function ProposalRealizationBanner({
  requests,
  draft,
  onDraftUpdated,
}: {
  requests: PrivateRequests;
  draft: ProposalDraft;
  onDraftUpdated?: (draft: ProposalDraft) => void;
}) {
  const [downloadError, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const approved = draft.status === "APPROVED";
  const { loaded, error: loadError } = useRealizationOverview(requests, draft.id, approved);
  const reload = useInvalidateRealizations(requests);
  const error = downloadError ?? loadError?.message;
  if (!approved) return null;
  const beneficiaryName = (realization: DisbursementRealization) =>
    draft.beneficiaries.find((b) => b.id === realization.beneficiaryId)?.name ?? "Penerima manfaat";

  async function download(document_: RealizationDocument) {
    try {
      const url = URL.createObjectURL(await downloadRealizationDocument(requests, draft.id, document_.id));
      requests.assertCurrent();
      const link = document.createElement("a");
      link.href = url;
      link.download = document_.fileName;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Berkas bukti tidak dapat diunduh atau tidak cocok dengan hash yang tercatat.");
    }
  }

  const summary = loaded?.summary;
  const hasRemainingGoods = summary?.lines.some((l) => l.kind === "GOODS" && l.quantityRemaining && compareDecimalStrings(l.quantityRemaining, "0") > 0);
  const canRecord = summary && (summary.totalRemainingIdr !== "0" || hasRemainingGoods);
  const canCancel = loaded && loaded.realizations.length === 0;
  const canCloseRemainder = loaded && loaded.realizations.length > 0 && canRecord;

  return <section aria-labelledby={`realization-${draft.id}`} className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-stone-800 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <Coins className="mt-0.5 h-5 w-5 text-emerald-600" />
        <div>
          <h3 id={`realization-${draft.id}`} className="font-bold text-stone-900">Realisasi penyaluran</h3>
          {loaded && <p className="text-xs text-stone-600">{loaded.notice}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="flex items-center gap-1.5" disabled={!loaded}
          onClick={() => setOpen({ kind: "advances" })}>
          <Banknote className="h-4 w-4" /> Uang muka & biaya
        </Button>
        <Button type="button" variant="outline" size="sm" className="flex items-center gap-1.5 text-blue-700 hover:text-blue-800" disabled={!loaded || !!draft.activeRevisionId}
          onClick={() => setOpen({ kind: "revision" })}>
          <Edit3 className="h-4 w-4" /> Ajukan revisi
        </Button>
        <Button type="button" variant="outline" size="sm" className="flex items-center gap-1.5 text-emerald-700 hover:text-emerald-800" disabled={!loaded || !!draft.activeRevisionId}
          onClick={() => setOpen({ kind: "reupload" })}>
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Revisi pengajuan dari berkas
        </Button>
        {canCancel && (
          <Button type="button" variant="outline" size="sm" className="flex items-center gap-1.5 text-red-600 hover:text-red-700"
            onClick={() => setOpen({ kind: "cancel" })}>
            <XCircle className="h-4 w-4" /> Batalkan
          </Button>
        )}
        {canCloseRemainder && (
          <Button type="button" variant="outline" size="sm" className="flex items-center gap-1.5 text-amber-700 hover:text-amber-800"
            onClick={() => setOpen({ kind: "closeRemainder" })}>
            <FileCheck className="h-4 w-4" /> Tutup sisa
          </Button>
        )}
        <Button type="button" size="sm" className="flex items-center gap-1.5" disabled={!canRecord}
          onClick={() => setOpen({ kind: "record" })}>
          <PlusCircle className="h-4 w-4" /> Catat realisasi
        </Button>
      </div>
    </div>

    <RevisionWorkflowBanner requests={requests} proposal={draft} onDraftUpdated={(d) => { onDraftUpdated?.(d); reload(); }} />

    {draft.heldAidLineIds && draft.heldAidLineIds.length > 0 && (
      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
        <p>Sebanyak {draft.heldAidLineIds.length} rincian bantuan sedang ditahan dari realisasi karena ada revisi aktif. Baris lainnya tetap dapat disalurkan.</p>
      </div>
    )}

    {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

    {summary && <RealizationSummaryMetrics summary={summary} />}

    {loaded && (loaded.realizations.length === 0
      ? <p className="rounded-xl border border-dashed border-stone-200 p-4 text-center text-stone-600">Belum ada realisasi yang dicatat.</p>
      : <ul className="space-y-2" aria-label="Kejadian realisasi">
        {[...loaded.realizations].reverse().map((realization) => {
          const evidence = loaded.documents.filter((doc) =>
            doc.realizationId === realization.id || doc.allocations.some((allocation) => allocation.realizationId === realization.id));
          const evidenced = evidencedIdr(realization, loaded.documents);
          const isGoods = realization.quantity != null;
          const amountOrQtyText = isGoods
            ? `${realization.quantity} ${realization.unit}`
            : formatIdrAmount(realization.amountIdr ?? "0");
          const confirmable = (realization.method === "CASH" || realization.method === "GOODS_HANDOVER") && realization.confirmationStatus === "UNCONFIRMED";
          return <li key={realization.id} className="space-y-2 rounded-xl border border-stone-200 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-stone-900">{beneficiaryName(realization)} · {amountOrQtyText}</p>
              <p className="text-xs text-stone-600">{DISBURSEMENT_METHOD_LABELS[realization.method]}{realization.batchGroupId ? " · penyerahan kelompok" : ""}</p>
            </div>
            <p className="text-xs text-stone-600">
              {realization.paymentRecipient
                ? `Dibayarkan ke ${realization.paymentRecipient.name} (${realization.paymentRecipient.relation})`
                : "Diterima langsung penerima manfaat"}
              {" · "}kejadian {new Date(realization.reportedAt * 1000).toLocaleDateString("id-ID")}
              {" · "}dicatat {new Date(realization.recordedAt * 1000).toLocaleString("id-ID")} oleh {realization.operatorAccount.slice(0, 10)}…
            </p>
            <p className="flex flex-wrap gap-2 text-xs">
              <span className={`rounded px-2 py-0.5 font-semibold ${realization.evidenceStatus === "EVIDENCE_COMPLETE" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                {realization.evidenceStatus === "EVIDENCE_COMPLETE"
                  ? "Bukti lengkap"
                  : isGoods
                  ? "Bukti belum lengkap"
                  : `Bukti belum lengkap · berbukti ${formatIdrAmount(evidenced.toString())}`}
              </span>
              <span className={`rounded px-2 py-0.5 font-semibold ${realization.confirmationStatus === "DISPUTED" ? "bg-red-100 text-red-900" : "bg-stone-100 text-stone-800"}`}>
                {realization.method === "CASH" || realization.method === "GOODS_HANDOVER"
                  ? CONFIRMATION_TEXT[realization.confirmationStatus]
                  : realization.confirmationStatus === "DISPUTED"
                  ? CONFIRMATION_TEXT.DISPUTED
                  : "Dibuktikan dengan bukti pembayaran"}
                {realization.confirmationMethod === "OTP" ? " (OTP)" : realization.confirmationMethod === "BAST_EXAMINED" ? " (BAST diperiksa)" : ""}
              </span>
            </p>
            {evidence.length > 0 && <ul className="space-y-1 text-xs">
              {evidence.map((doc) => <li key={doc.id} className="flex flex-wrap items-center gap-2">
                <span>{REALIZATION_DOCUMENT_TYPE_LABELS[doc.documentType]}: {doc.fileName}
                  {doc.allocations.length > 1 ? ` · kelompok ${doc.allocations.length} penerima` : ""}</span>
                <button type="button" aria-label={`Unduh ${doc.fileName}`} className="font-semibold text-emerald-800 underline" onClick={() => void download(doc)}>Unduh</button>
              </li>)}
            </ul>}
            <div className="flex flex-wrap gap-2">
              {realization.evidenceStatus !== "EVIDENCE_COMPLETE" && <Button type="button" variant="outline" size="sm"
                onClick={() => setOpen({ kind: "evidence", realization })}>Lengkapi bukti</Button>}
              {confirmable && <Button type="button" variant="outline" size="sm"
                onClick={() => setOpen({ kind: "confirm", realization })}>Konfirmasi penerimaan</Button>}
              <Button type="button" variant="outline" size="sm" onClick={() => setOpen({ kind: "dispute", realization })}>Keberatan</Button>
            </div>
          </li>;
        })}
      </ul>)}

    {loaded && open?.kind === "record" && <RecordRealizationModal requests={requests} draft={draft} summary={loaded.summary} notice={loaded.notice}
      isOpen onClose={() => setOpen((current) => (current?.kind === "record" ? null : current))}
      onRecorded={(records, _summary, addEvidence) => {
        reload();
        if (addEvidence && records[0]) setTimeout(() => setOpen({ kind: "evidence", realization: records[0]! }));
      }} />}
    {loaded && open?.kind === "evidence" && <RealizationEvidenceModal requests={requests} proposalId={draft.id} realization={open.realization}
      realizations={loaded.realizations} documents={loaded.documents} beneficiaryName={beneficiaryName}
      isOpen onClose={() => setOpen(null)} onUploaded={reload} />}
    {open?.kind === "confirm" && <RecipientConfirmationModal requests={requests} proposalId={draft.id} realization={open.realization}
      beneficiaryName={beneficiaryName(open.realization)} beneficiary={draft.beneficiaries.find((b) => b.id === open.realization.beneficiaryId)} isOpen onClose={() => setOpen(null)} onChanged={reload} />}
    {open?.kind === "dispute" && <RealizationDisputeModal requests={requests} proposalId={draft.id} realization={open.realization}
      beneficiaryName={beneficiaryName(open.realization)} isOpen onClose={() => setOpen(null)} onChanged={reload} />}
    {open?.kind === "advances" && <AdvancesAndExpensesModal requests={requests} proposalId={draft.id}
      isOpen onClose={() => setOpen(null)} onChanged={reload} />}
    {loaded && open?.kind === "revision" && (
      <ProposalRevisionModal
        requests={requests}
        proposal={draft}
        realizations={loaded.realizations}
        isOpen
        onClose={() => setOpen(null)}
        onProposed={(newDraft) => {
          onDraftUpdated?.(newDraft);
          reload();
        }}
      />
    )}
    {open?.kind === "reupload" && loaded && (
      <BeneficiaryRosterChangeModal
        requests={requests}
        proposal={draft}
        isOpen
        onClose={() => setOpen(null)}
        onAppliedDraft={(newDraft) => {
          onDraftUpdated?.(newDraft);
          reload();
        }}
        onAppliedRevision={(_rev, newDraft) => {
          onDraftUpdated?.(newDraft);
          reload();
        }}
      />
    )}
    {open?.kind === "cancel" && (
      <ProposalCancellationModal
        requests={requests}
        proposal={draft}
        isOpen
        onClose={() => setOpen(null)}
        onCancelled={(newDraft) => {
          onDraftUpdated?.(newDraft);
          reload();
        }}
      />
    )}
    {open?.kind === "closeRemainder" && (
      <ProposalClosureModal
        requests={requests}
        proposal={draft}
        isOpen
        onClose={() => setOpen(null)}
        onClosed={(newDraft) => {
          onDraftUpdated?.(newDraft);
          reload();
        }}
      />
    )}
  </section>;
}
