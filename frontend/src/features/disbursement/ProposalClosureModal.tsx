import { useEffect, useState } from "react";
import { CheckCircle2, FileCheck, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { formatIdrAmount } from "../workspace/mandateLabels";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  getProposalRealizationSummary,
  type ProposalClosureRecord,
  type ProposalDecision,
  type ProposalDraft,
  type ProposalRealizationSummary,
} from "./disbursementClient";
import { useProposalTermination } from "./useProposalTermination";

export function ProposalClosureModal({
  requests,
  proposal,
  isOpen,
  onClose,
  onClosed,
}: {
  requests: PrivateRequests;
  proposal: ProposalDraft;
  isOpen: boolean;
  onClose: () => void;
  onClosed: (draft: ProposalDraft, decision: ProposalDecision, closure: ProposalClosureRecord) => void;
}) {
  const { address } = useAccount();
  const signerAccount = address || "";

  const [summary, setSummary] = useState<ProposalRealizationSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const { form, processing: submitting, error, unknown, submit, update } = useProposalTermination(
    "CLOSE_REMAINDER",
    requests,
    proposal,
    signerAccount,
    (draft, decision, closure) => {
      if (closure) onClosed(draft, decision, closure);
      onClose();
    }
  );

  useEffect(() => {
    if (!isOpen) return;
    let current = true;
    setLoadingSummary(true);
    getProposalRealizationSummary(requests, proposal.id)
      .then((res) => {
        if (current) setSummary(res.summary);
      })
      .catch((err) => {
        if (current) setSummaryError(err instanceof Error ? err.message : "Gagal memuat ringkasan sisa.");
      })
      .finally(() => {
        if (current) setLoadingSummary(false);
      });
    return () => {
      current = false;
    };
  }, [requests, proposal.id, isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-w-lg" showCloseButton={!submitting}>
        <DialogTitle className="flex items-center gap-2 text-stone-900">
          <FileCheck className="h-5 w-5 text-amber-700" />
          Tutup Sisa Hak Pengajuan
        </DialogTitle>
        <DialogDescription>
          Tutup sisa hak bantuan yang tidak lagi disalurkan secara resmi dengan rujukan SK direksi/pimpinan dan tanda tangan kriptografis.
        </DialogDescription>

        <div className="space-y-4 py-2 text-xs text-stone-800">
          {loadingSummary ? (
            <p className="flex items-center gap-2 py-4 text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat sisa hak bantuan...
            </p>
          ) : summary ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-1">
              <p className="font-semibold text-amber-950">Sisa Hak yang Akan Ditutup:</p>
              <p className="text-xs text-amber-900">
                Total IDR: <span className="font-bold">{formatIdrAmount(summary.totalRemainingIdr)}</span>
              </p>
              {summary.lines
                .filter((l) => l.kind === "GOODS" && l.quantityRemaining && l.quantityRemaining !== "0")
                .map((l) => (
                  <p key={l.aidLineId} className="text-xs text-amber-900">
                    Barang ({l.aidType}): <span className="font-bold">{l.quantityRemaining} {l.unit}</span>
                  </p>
                ))}
            </div>
          ) : null}

          <label className="block space-y-1 font-medium text-stone-700">Nomor SK Penutupan Sisa *
            <Input
              disabled={submitting}
              className="text-xs"
              placeholder="Contoh: SK-TUTUP-005/DIR/2026"
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

          <label className="block space-y-1 font-medium text-stone-700">Berkas Dokumen SK Penutupan Sisa *
            <input
              disabled={submitting}
              type="file"
              className="block w-full text-xs text-stone-700"
              onChange={(e) => update({ documentFile: e.target.files?.[0] ?? null })}
            />
            <span className="block text-[11px] font-normal text-stone-500">Berkas ini akan ditandatangani dan dikunci ke rantai audit.</span>
          </label>

          <label className="block space-y-1 font-medium text-stone-700">Alasan Penutupan Sisa *
            <textarea
              disabled={submitting}
              rows={3}
              className="w-full rounded-md border border-stone-300 p-2 text-xs text-stone-900 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
              placeholder="Contoh: Periode program berakhir dan penerima menolak sisa bantuan..."
              value={form.reason}
              onChange={(e) => update({ reason: e.target.value })}
            />
            <span className="block text-[11px] font-normal text-stone-500">Alasan ini ikut ditandatangani dan tersimpan pada riwayat keputusan.</span>
          </label>

          <label className="block space-y-1 font-medium text-stone-700">Catatan Tambahan
            <textarea
              disabled={submitting}
              rows={2}
              className="w-full rounded-md border border-stone-300 p-2 text-xs text-stone-900 focus:border-amber-600 focus:outline-none focus:ring-1 focus:ring-amber-600"
              placeholder="Opsional."
              value={form.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </label>

          <p className="rounded-lg border border-stone-200 bg-stone-50 p-2.5 text-[11px] text-stone-600">
            Menutup sisa hanya menghentikan hak yang belum disalurkan. Tindakan ini tidak memindahkan alokasi ke penerima
            lain, tidak membuat refund, dan tidak mencatat penyerahan apa pun. Pengalihan alokasi dan refund mengikuti
            siklus kontribusi, bukan tombol ini.
          </p>

          <div className="rounded-lg bg-stone-50 p-2.5">
            <p className="font-semibold text-stone-700">Akun Pengesah:</p>
            <p className="font-mono text-[11px] text-stone-600">{signerAccount || "Belum terhubung"}</p>
          </div>

          {(error || summaryError) && (
            <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs text-red-700">
              {error ?? summaryError}
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
            disabled={submitting || !signerAccount || loadingSummary}
            onClick={() => void submit()}
            className="gap-2 bg-amber-700 hover:bg-amber-800 text-white"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {submitting ? "Memproses Tanda Tangan..." : unknown ? "Kirim Ulang Keputusan" : "Tanda Tangani Penutupan Sisa"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
