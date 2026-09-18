import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import { useAccount } from "wagmi";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import type { PrivateRequests } from "../workspace/privateRequests";
import type { ProposalDecision, ProposalDraft } from "./disbursementClient";
import { useProposalTermination } from "./useProposalTermination";

export function ProposalCancellationModal({
  requests,
  proposal,
  isOpen,
  onClose,
  onCancelled,
}: {
  requests: PrivateRequests;
  proposal: ProposalDraft;
  isOpen: boolean;
  onClose: () => void;
  onCancelled: (draft: ProposalDraft, decision: ProposalDecision) => void;
}) {
  const { address } = useAccount();
  const signerAccount = address || "";

  const { form, processing: submitting, error, unknown, submit, update } = useProposalTermination(
    "CANCEL",
    requests,
    proposal,
    signerAccount,
    (draft, decision) => {
      onCancelled(draft, decision);
      onClose();
    }
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-w-lg" showCloseButton={!submitting}>
        <DialogTitle className="flex items-center gap-2 text-stone-900">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          Batalkan Pengajuan
        </DialogTitle>
        <DialogDescription>
          Pembatalan hanya dapat dilakukan untuk pengajuan yang belum memiliki realisasi penyaluran. Keputusan ini memerlukan SK dan pengesahan kriptografis.
        </DialogDescription>

        <div className="space-y-4 py-2 text-xs text-stone-800">
          <label className="block space-y-1 font-medium text-stone-700">Nomor SK Pembatalan *
            <Input
              disabled={submitting}
              className="text-xs"
              placeholder="Contoh: SK-BATAL-001/DIR/2026"
              value={form.decisionReference}
              onChange={(e) => update({ decisionReference: e.target.value })}
            />
          </label>

          <label className="block space-y-1 font-medium text-stone-700">Tanggal Penetapan SK *
            <Input
              disabled={submitting}
              type="date"
              className="text-xs"
              value={form.decisionDate}
              onChange={(e) => update({ decisionDate: e.target.value })}
            />
          </label>

          <label className="block space-y-1 font-medium text-stone-700">Berkas Dokumen SK Pembatalan *
            <input
              disabled={submitting}
              type="file"
              className="block w-full text-xs text-stone-700"
              onChange={(e) => update({ documentFile: e.target.files?.[0] ?? null })}
            />
            <span className="block text-[11px] font-normal text-stone-500">Berkas ini akan ditandatangani dan dikunci secara permanen.</span>
          </label>

          <label className="block space-y-1 font-medium text-stone-700">Alasan Pembatalan *
            <textarea
              disabled={submitting}
              rows={3}
              className="w-full rounded-md border border-stone-300 p-2 text-xs text-stone-900 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
              placeholder="Jelaskan dasar pembatalan pengajuan ini..."
              value={form.reason}
              onChange={(e) => update({ reason: e.target.value })}
            />
            <span className="block text-[11px] font-normal text-stone-500">Alasan ini ikut ditandatangani dan tersimpan pada riwayat keputusan.</span>
          </label>

          <label className="block space-y-1 font-medium text-stone-700">Catatan Tambahan
            <textarea
              disabled={submitting}
              rows={2}
              className="w-full rounded-md border border-stone-300 p-2 text-xs text-stone-900 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
              placeholder="Opsional."
              value={form.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </label>

          <div className="rounded-lg bg-stone-50 p-2.5">
            <p className="font-semibold text-stone-700">Akun Pengesah:</p>
            <p className="font-mono text-[11px] text-stone-600">{signerAccount || "Belum terhubung"}</p>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700">
              {error}
            </p>
          )}

          {unknown && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900">
              Tanda tangan sudah dibuat. Kirim ulang keputusan yang sama untuk membaca hasil yang tersimpan; ini tidak
              membuat keputusan kedua.
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
            onClick={() => void submit()}
            className="gap-2 bg-red-600 hover:bg-red-700 text-white"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            {submitting ? "Memproses Tanda Tangan..." : unknown ? "Kirim Ulang Keputusan" : "Tanda Tangani Pembatalan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
