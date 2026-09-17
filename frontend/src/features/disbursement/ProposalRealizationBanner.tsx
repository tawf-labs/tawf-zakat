import { useRealizationOverview, useInvalidateRealizations } from "./useRealizationQueries";
import { useState } from "react";
import { Banknote, Coins, PlusCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatIdrAmount } from "../workspace/mandateLabels";
import {
  DISBURSEMENT_METHOD_LABELS,
  downloadRealizationDocument,
  REALIZATION_DOCUMENT_TYPE_LABELS,
  REALIZATION_PROGRESS_LABELS,
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

type Open =
  | { kind: "record" }
  | { kind: "advances" }
  | { kind: "evidence" | "confirm" | "dispute"; realization: DisbursementRealization }
  | null;

const CONFIRMATION_TEXT: Record<ConfirmationStatus, string> = {
  UNCONFIRMED: "Belum dikonfirmasi penerima",
  CONFIRMED: "Dikonfirmasi",
  DISPUTED: "Diperselisihkan, konfirmasi ditahan",
};

const Metric = ({ label, value, detail }: { label: string; value: string; detail: string }) =>
  <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
    <dt className="text-xs text-stone-600">{label}</dt>
    <dd className="font-mono text-base font-bold text-stone-900">{value}</dd>
    <dd className="text-xs text-stone-600">{detail}</dd>
  </div>;

/**
 * Staged IDR realization of an approved proposal. Disbursement progress, evidence completeness
 * and recipient confirmation are shown separately; none of them implies the others or an audit opinion.
 */
export function ProposalRealizationBanner({ requests, draft }: { requests: PrivateRequests; draft: ProposalDraft }) {
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
  return <section aria-labelledby={`realization-${draft.id}`} className="space-y-4 rounded-2xl border border-emerald-200 bg-white p-4 text-sm text-stone-800 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2">
        <Coins className="mt-0.5 h-5 w-5 text-emerald-600" />
        <div>
          <h3 id={`realization-${draft.id}`} className="font-bold text-stone-900">Realisasi penyaluran IDR</h3>
          {loaded && <p className="text-xs text-stone-600">{loaded.notice}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" className="flex items-center gap-1.5" disabled={!loaded}
          onClick={() => setOpen({ kind: "advances" })}>
          <Banknote className="h-4 w-4" /> Uang muka & biaya
        </Button>
        <Button type="button" size="sm" className="flex items-center gap-1.5" disabled={!summary || summary.totalRemainingIdr === "0"}
          onClick={() => setOpen({ kind: "record" })}>
          <PlusCircle className="h-4 w-4" /> Catat realisasi
        </Button>
      </div>
    </div>

    {error && <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{error}</p>}

    {summary && <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="Hak disetujui" value={formatIdrAmount(summary.totalApprovedIdr)} detail={`${summary.approvedBeneficiaryCount} penerima manfaat`} />
      <Metric label="Tersalur (dilaporkan)" value={formatIdrAmount(summary.totalRealizedIdr)}
        detail={`${summary.realizedBeneficiaryCount} dari ${summary.approvedBeneficiaryCount} penerima · ${summary.paymentEventCount} kejadian pembayaran`} />
      <Metric label="Sisa hak" value={formatIdrAmount(summary.totalRemainingIdr)} detail={REALIZATION_PROGRESS_LABELS[summary.disbursementStatus]} />
      <Metric label="Kelengkapan bukti" value={summary.evidenceCompleteness === "EVIDENCE_COMPLETE" ? "Bukti lengkap" : "Bukti perlu dilengkapi"}
        detail={`${summary.pendingEvidenceCount} kejadian belum berbukti · ${formatIdrAmount(summary.totalPendingEvidenceIdr)}`} />
    </dl>}
    {summary && <p className="text-xs text-stone-600">
      Konfirmasi penerima: {summary.confirmedCount} dikonfirmasi · {summary.disputedCount} diperselisihkan. Status tersalur tidak berarti bukti lengkap atau opini audit.
    </p>}

    {loaded && (loaded.realizations.length === 0
      ? <p className="rounded-xl border border-dashed border-stone-200 p-4 text-center text-stone-600">Belum ada realisasi yang dicatat.</p>
      : <ul className="space-y-2" aria-label="Kejadian realisasi">
        {[...loaded.realizations].reverse().map((realization) => {
          const evidence = loaded.documents.filter((doc) =>
            doc.realizationId === realization.id || doc.allocations.some((allocation) => allocation.realizationId === realization.id));
          const evidenced = evidencedIdr(realization, loaded.documents);
          const confirmable = realization.method === "CASH" && realization.confirmationStatus === "UNCONFIRMED";
          return <li key={realization.id} className="space-y-2 rounded-xl border border-stone-200 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold text-stone-900">{beneficiaryName(realization)} · {formatIdrAmount(realization.amountIdr)}</p>
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
                {realization.evidenceStatus === "EVIDENCE_COMPLETE" ? "Bukti lengkap" : `Bukti belum lengkap · berbukti ${formatIdrAmount(evidenced.toString())}`}
              </span>
              <span className={`rounded px-2 py-0.5 font-semibold ${realization.confirmationStatus === "DISPUTED" ? "bg-red-100 text-red-900" : "bg-stone-100 text-stone-800"}`}>
                {realization.method === "CASH" ? CONFIRMATION_TEXT[realization.confirmationStatus]
                  : realization.confirmationStatus === "DISPUTED" ? CONFIRMATION_TEXT.DISPUTED : "Dibuktikan dengan bukti pembayaran"}
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
  </section>;
}
