import { useState } from "react";
import { CheckCircle2, FileSignature, Loader2, XCircle } from "lucide-react";
import { useAccount, useSignTypedData } from "wagmi";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  createRevisionDecisionChallenge,
  readFileBase64,
  signableTypedData,
  submitRevisionDecision,
  uploadDecisionDocument,
  type ProposalDecision,
  type ProposalDraft,
  type ProposalRevisionRecord,
} from "./disbursementClient";
import { RevisionDeltaReview } from "./RevisionDeltaReview";

export function RevisionDecisionModal({
  requests,
  proposal,
  revision,
  isOpen,
  onClose,
  onDecided,
}: {
  requests: PrivateRequests;
  proposal: ProposalDraft;
  revision: ProposalRevisionRecord;
  isOpen: boolean;
  onClose: () => void;
  onDecided: (draft: ProposalDraft, revision: ProposalRevisionRecord, decision: ProposalDecision) => void;
}) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const [action, setAction] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [decisionReference, setDecisionReference] = useState("");
  const [decisionDate, setDecisionDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signerAccount = address || "";

  async function handleDecide() {
    if (!decisionReference.trim()) {
      setError("Nomor SK / Berita Acara keputusan wajib diisi.");
      return;
    }
    if (!decisionDate) {
      setError("Tanggal penetapan keputusan wajib diisi.");
      return;
    }
    if (!documentFile) {
      setError("Berkas dokumen SK keputusan revisi wajib diunggah.");
      return;
    }
    if (action === "REJECT" && !rejectionReason.trim()) {
      setError("Alasan penolakan revisi wajib diisi jika menolak.");
      return;
    }
    if (!signerAccount) {
      setError("Dompet belum terhubung. Hubungkan akun pengesah untuk menandatangani keputusan revisi.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      // 1. Upload decision document
      const base64 = await readFileBase64(documentFile);
      const doc = await uploadDecisionDocument(requests, proposal.id, {
        fileName: documentFile.name,
        mimeType: documentFile.type || "application/pdf",
        contentBase64: base64,
        expectedVersion: proposal.version,
      });

      // 2. Request EIP-712 challenge
      const { challenge, typedData } = await createRevisionDecisionChallenge(
        requests,
        proposal.id,
        revision.id,
        {
          signerAccount,
          action,
          decisionReference: decisionReference.trim(),
          decisionDate,
          decisionDocumentId: doc.id,
          rejectionReason: action === "REJECT" ? rejectionReason.trim() : null,
        }
      );

      // 3. Sign EIP-712 challenge
      const signature = await signTypedDataAsync(signableTypedData(typedData));

      // 4. Submit revision decision
      const result = await submitRevisionDecision(requests, proposal.id, revision.id, {
        nonce: challenge.nonce,
        signature,
        operationId: crypto.randomUUID(),
        notes: notes.trim() || null,
        rejectionReason: action === "REJECT" ? rejectionReason.trim() : null,
      });

      onDecided(result.draft, result.revision, result.decision);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Gagal mencatat keputusan revisi.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" showCloseButton={!submitting}>
        <DialogTitle className="flex items-center gap-2 text-stone-900">
          <FileSignature className="h-5 w-5 text-emerald-700" />
          Keputusan Lembaga atas Revisi #{revision.revisionNumber}
        </DialogTitle>
        <DialogDescription>
          Telaah perubahan hak bantuan yang diajukan, catat nomor SK pleno direksi, dan sahkan dengan tanda tangan kriptografis EIP-712.
        </DialogDescription>

        <div className="space-y-4 py-2 text-xs text-stone-800">
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
            <p className="font-semibold text-stone-700">Alasan Revisi oleh Amil:</p>
            <p className="mt-1 italic text-stone-900">"{revision.reason}"</p>
            {revision.examinationNotes && (
              <p className="mt-2 text-[11px] text-stone-600">
                <span className="font-semibold">Catatan Pemeriksa:</span> {revision.examinationNotes}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-stone-900">Rincian Perubahan yang Diajukan:</h4>
            <RevisionDeltaReview delta={revision.delta} />
          </div>

          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
            <div role="radiogroup" aria-label="Aksi Keputusan" className="flex gap-4">
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="revDecisionAction"
                  checked={action === "APPROVE"}
                  onChange={() => setAction("APPROVE")}
                />
                <span className="text-emerald-800 font-bold">Setujui Revisi</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="revDecisionAction"
                  checked={action === "REJECT"}
                  onChange={() => setAction("REJECT")}
                />
                <span className="text-red-800 font-bold">Tolak Revisi</span>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1 font-medium text-stone-700">Nomor SK / Berita Acara *
                <Input
                  disabled={submitting}
                  className="text-xs"
                  placeholder="Contoh: SK-REV-001/DIR/2026"
                  value={decisionReference}
                  onChange={(e) => setDecisionReference(e.target.value)}
                />
              </label>

              <label className="block space-y-1 font-medium text-stone-700">Tanggal Penetapan *
                <Input
                  disabled={submitting}
                  type="date"
                  className="text-xs"
                  value={decisionDate}
                  onChange={(e) => setDecisionDate(e.target.value)}
                />
              </label>
            </div>

            <label className="block space-y-1 font-medium text-stone-700">Berkas Dokumen SK *
              <input
                disabled={submitting}
                type="file"
                className="block w-full text-xs text-stone-700"
                onChange={(e) => setDocumentFile(e.target.files?.[0] ?? null)}
              />
              <span className="block text-[11px] font-normal text-stone-500">Berkas SK ini dikunci oleh tanda tangan pengesahan.</span>
            </label>

            {action === "REJECT" && (
              <label className="block space-y-1 font-medium text-red-700">Alasan Penolakan Revisi *
                <textarea
                  disabled={submitting}
                  rows={2}
                  className="w-full rounded-md border border-red-300 p-2 text-xs text-stone-900 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
                  placeholder="Jelaskan alasan penolakan revisi..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </label>
            )}

            <label className="block space-y-1 font-medium text-stone-700">Catatan Keputusan (Opsional)
              <textarea
                disabled={submitting}
                rows={2}
                className="w-full rounded-md border border-stone-300 p-2 text-xs text-stone-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                placeholder="Catatan tambahan keputusan..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            <div className="rounded-lg bg-stone-50 p-2.5">
              <p className="font-semibold text-stone-700">Akun Pengesah:</p>
              <p className="font-mono text-[11px] text-stone-600">{signerAccount || "Belum terhubung"}</p>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" disabled={submitting} onClick={onClose}>
            Batal
          </Button>
          <Button
            type="button"
            disabled={submitting || !signerAccount}
            onClick={() => void handleDecide()}
            className={`gap-2 text-white ${action === "APPROVE" ? "bg-emerald-700 hover:bg-emerald-800" : "bg-red-700 hover:bg-red-800"}`}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : action === "APPROVE" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            {submitting ? "Memproses Tanda Tangan..." : action === "APPROVE" ? "Tanda Tangani Pengesahan Revisi" : "Tanda Tangani Penolakan Revisi"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
