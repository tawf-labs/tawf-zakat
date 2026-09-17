import { FileSignature, Loader2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import type { ProposalDecision, ProposalDraft } from "./disbursementClient";
import { DecisionAidLinesTable } from "./DecisionAidLinesTable";
import { DecisionFormFields } from "./DecisionFormFields";
import { DecisionReviewSummary } from "./DecisionReviewSummary";
import { useProposalDecision } from "./useProposalDecision";

export function ProposalDecisionModal({ requests, proposalId, isOpen, onClose, onDecisionRecorded }: {
  requests: PrivateRequests;
  proposalId: string;
  isOpen: boolean;
  onClose: () => void;
  onDecisionRecorded: (draft: ProposalDraft, decision: ProposalDecision) => void;
}) {
  const decision = useProposalDecision(requests, proposalId, (draft, record) => {
    onDecisionRecorded(draft, record);
    onClose();
  });
  const { review, form, processing, unknown } = decision;
  const locked = processing || unknown;
  const disabled = !review?.canDecide || locked;

  return <Dialog open={isOpen} onOpenChange={open => { if (!open && !locked) onClose(); }}>
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" showCloseButton={!locked}>
      <DialogTitle className="flex items-center gap-2 text-stone-900">
        <FileSignature className="h-5 w-5 text-emerald-700" />
        Keputusan Lembaga atas Pengajuan
      </DialogTitle>
      <DialogDescription>
        Telaah hasil pemeriksaan, catat rujukan SK atau berita acara pleno, lalu sahkan pencatatannya dengan akun pengesah.
      </DialogDescription>

      {decision.loading ? <p className="flex items-center gap-2 py-8 text-sm text-stone-600">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat telaah keputusan…
      </p> : review && form && <div className="space-y-5 text-sm text-stone-800">
        <DecisionReviewSummary review={review} signerAccount={form.signerAccount} />
        <DecisionAidLinesTable draft={review.draft} form={form} disabled={disabled} onChange={decision.update} />
        <DecisionFormFields review={review} form={form} disabled={disabled} onChange={decision.update} />
      </div>}

      {decision.error && <p role="alert" className={`rounded-lg border p-3 text-xs ${unknown
        ? "border-amber-300 bg-amber-50 text-amber-900" : "border-red-300 bg-red-50 text-red-900"}`}>{decision.error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button type="button" variant="ghost" disabled={locked} onClick={onClose}>Tutup</Button>
        <Button type="button" disabled={!review?.canDecide || processing} onClick={() => void decision.submit()}
          className={`gap-2 ${form?.action === "REJECT" ? "bg-red-700 hover:bg-red-800" : ""}`}>
          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
          {unknown ? "Periksa hasil pengesahan"
            : processing ? "Menunggu tanda tangan…"
            : form?.action === "REJECT" ? "Tanda tangani penolakan" : "Tanda tangani pengesahan"}
        </Button>
      </div>
    </DialogContent>
  </Dialog>;
}
