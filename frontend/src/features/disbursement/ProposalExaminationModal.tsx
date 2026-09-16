import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import type { PrivateRequests } from "../workspace/privateRequests";
import { ProposalDocumentManager } from "./ProposalDocumentManager";
import { ProposalExaminationDetails } from "./ProposalExaminationDetails";
import { ProposalExaminationChecklist } from "./ProposalExaminationChecklist";
import { useProposalExamination } from "./useProposalExamination";

export function ProposalExaminationModal({ requests, proposalId, isOpen, onClose, onActionCompleted }: {
  requests: PrivateRequests; proposalId: string; isOpen: boolean; onClose: () => void; onActionCompleted: () => void;
}) {
  const review = useProposalExamination(requests, proposalId, onActionCompleted, onClose);
  const { draft, warnings, processing, unknown } = review;
  return <Dialog open={isOpen} onOpenChange={open => { if (!open && !processing && !unknown) onClose(); }}>
    <DialogContent className="max-w-3xl" showCloseButton={!processing && !unknown}>
      <DialogTitle>Pemeriksaan Kelayakan Pengajuan Penyaluran</DialogTitle>
      <DialogDescription>Telaah penerima, bantuan, dan dokumen pada versi pengajuan yang sama.</DialogDescription>
      {review.error && <p role="alert" className="text-sm text-red-700">{review.error}</p>}
      {review.loading ? <p>Memuat rincian pengajuan…</p> : draft && <>
        <ProposalExaminationDetails draft={draft} warnings={warnings} />
        <ProposalDocumentManager requests={requests} proposalId={draft.id} beneficiaries={draft.beneficiaries} readOnly proposalVersion={draft.version} />
        {draft.status === "SUBMITTED" && <Button type="button" variant="outline" disabled={processing || unknown}
          onClick={() => review.act({ kind: "start" })}>Mulai Pemeriksaan</Button>}
        <ProposalExaminationChecklist key={`${draft.id}:${draft.version}`} disabled={processing || unknown}
          hasAlternative={draft.beneficiaries.some(b => b.identityBasis.kind === "ALTERNATIVE")}
          hasWarnings={warnings.length > 0} onReady={checklist => review.act({ kind: "ready", checklist })}
          onReturn={reason => review.act({ kind: "return", reason })} />
      </>}
      {unknown && <Button type="button" disabled={processing} onClick={review.retry}>Periksa hasil tindakan</Button>}
      <Button type="button" variant="ghost" disabled={processing || unknown} onClick={onClose}>Tutup</Button>
    </DialogContent>
  </Dialog>;
}
