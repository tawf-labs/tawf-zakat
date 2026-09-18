import { useMemo, useState } from "react";
import { Edit3, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import { Input } from "../../components/ui/Input";
import { formatIdrAmount } from "../workspace/mandateLabels";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  proposeRevision,
  type AidLine,
  type Beneficiary,
  type DisbursementRealization,
  type ProposalDraft,
  type ProposalRevisionDelta,
  type ProposalRevisionRecord,
} from "./disbursementClient";
import { accumulateRealizedPerLine, calculateRevisionDelta, validateRevisionFloor } from "../../../../shared/proposal-revision";
import { compareDecimalStrings } from "../../../../shared/exact-decimal";
import { RevisionDeltaReview } from "./RevisionDeltaReview";

export function ProposalRevisionModal({
  requests,
  proposal,
  realizations,
  isOpen,
  onClose,
  onProposed,
}: {
  requests: PrivateRequests;
  proposal: ProposalDraft;
  realizations: DisbursementRealization[];
  isOpen: boolean;
  onClose: () => void;
  onProposed: (draft: ProposalDraft, revision: ProposalRevisionRecord) => void;
}) {
  const [reason, setReason] = useState("");
  const [beneficiaries] = useState<Beneficiary[]>(() =>
    JSON.parse(JSON.stringify(proposal.beneficiaries))
  );
  const [aidLines, setAidLines] = useState<AidLine[]>(() =>
    JSON.parse(JSON.stringify(proposal.aidLines))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same core the server binds the stored revision to, so the preview cannot disagree
  // with the verdict (ADR-0017 §1).
  const delta = useMemo<ProposalRevisionDelta>(
    () =>
      calculateRevisionDelta(
        { beneficiaries: proposal.beneficiaries, aidLines: proposal.aidLines },
        { beneficiaries, aidLines }
      ),
    [proposal, beneficiaries, aidLines]
  );

  const realized = useMemo(() => accumulateRealizedPerLine(realizations), [realizations]);

  const floor = useMemo(
    () => validateRevisionFloor(proposal.aidLines, aidLines, realizations),
    [proposal.aidLines, aidLines, realizations]
  );

  async function handleSubmit() {
    if (!reason.trim()) {
      setError("Alasan revisi wajib diisi.");
      return;
    }
    if (!floor.ok) {
      setError(floor.error);
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      const res = await proposeRevision(requests, proposal.id, {
        reason: reason.trim(),
        beneficiaries,
        aidLines,
        expectedVersion: proposal.version,
        operationId: crypto.randomUUID(),
      });
      onProposed(res.draft, res.revision);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Gagal mengajukan revisi.");
    } finally {
      setSubmitting(false);
    }
  }

  function addAidLine() {
    if (beneficiaries.length === 0) return;
    const newId = `aid-${crypto.randomUUID().slice(0, 8)}`;
    setAidLines((prev) => [
      ...prev,
      {
        id: newId,
        beneficiaryId: beneficiaries[0]?.id || "",
        aidType: "Bantuan Baru",
        period: "2026-Q1",
        value: { kind: "MONEY", amountRequestedIdr: "1000000", amountApprovedIdr: null },
      },
    ]);
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" showCloseButton={!submitting}>
        <DialogTitle className="flex items-center gap-2 text-stone-900">
          <Edit3 className="h-5 w-5 text-blue-600" />
          Ajukan Revisi Pengajuan yang Disetujui
        </DialogTitle>
        <DialogDescription>
          Sesuaikan data penerima atau hak bantuan. Hak bantuan tidak dapat dikurangi di bawah jumlah yang telah terealisasi (Aturan Floor). Baris yang diubah akan ditahan dari realisasi hingga revisi disahkan.
        </DialogDescription>

        <div className="space-y-5 py-2 text-xs text-stone-800">
          <label className="block space-y-1 font-medium text-stone-700">Alasan Pengajuan Revisi *
            <textarea
              disabled={submitting}
              rows={2}
              className="w-full rounded-md border border-stone-300 p-2 text-xs text-stone-900 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
              placeholder="Contoh: Penyesuaian kebutuhan mustahik berdasarkan verifikasi lapangan lanjutan..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-stone-900">Rincian Hak Bantuan ({aidLines.length} baris)</h4>
              <Button type="button" variant="outline" size="sm" onClick={addAidLine} className="gap-1 text-xs">
                <Plus className="h-3.5 w-3.5" /> Tambah Baris
              </Button>
            </div>

            <div className="space-y-2">
              {aidLines.map((line, idx) => {
                const realizedIdr = realized.idr.get(line.id) ?? 0n;
                const realizedQty = realized.quantity.get(line.id) ?? "0";

                return (
                  <div key={line.id} className="rounded-lg border border-stone-200 bg-stone-50/50 p-3 space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                      <div>
                        <label className="block font-medium text-[11px] text-stone-600">Penerima Manfaat</label>
                        <select
                          disabled={submitting}
                          value={line.beneficiaryId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAidLines((prev) =>
                              prev.map((l, i) => (i === idx ? { ...l, beneficiaryId: val } : l))
                            );
                          }}
                          className="mt-0.5 w-full rounded border border-stone-300 bg-white p-1 text-xs"
                        >
                          {beneficiaries.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} ({b.asnaf})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block font-medium text-[11px] text-stone-600">Jenis Bantuan</label>
                        <Input
                          disabled={submitting}
                          value={line.aidType}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAidLines((prev) =>
                              prev.map((l, i) => (i === idx ? { ...l, aidType: val } : l))
                            );
                          }}
                          className="mt-0.5 text-xs"
                        />
                      </div>

                      <div>
                        <label className="block font-medium text-[11px] text-stone-600">Periode</label>
                        <Input
                          disabled={submitting}
                          value={line.period}
                          onChange={(e) => {
                            const val = e.target.value;
                            setAidLines((prev) =>
                              prev.map((l, i) => (i === idx ? { ...l, period: val } : l))
                            );
                          }}
                          className="mt-0.5 text-xs"
                        />
                      </div>

                      <div className="flex items-end justify-between gap-2">
                        <div className="flex-1">
                          {line.value.kind === "MONEY" ? (
                            <div>
                              <label className="block font-medium text-[11px] text-stone-600">
                                Nominal (IDR)
                                {realizedIdr > 0n && (
                                  <span className="text-amber-700"> (Min: {formatIdrAmount(realizedIdr.toString())})</span>
                                )}
                              </label>
                              <Input
                                disabled={submitting}
                                value={line.value.amountRequestedIdr}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setAidLines((prev) =>
                                    prev.map((l, i) =>
                                      i === idx && l.value.kind === "MONEY"
                                        ? { ...l, value: { ...l.value, amountRequestedIdr: val, amountApprovedIdr: val } }
                                        : l
                                    )
                                  );
                                }}
                                className="mt-0.5 text-xs"
                              />
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <div>
                                <label className="block font-medium text-[11px] text-stone-600">
                                  Kuantitas {compareDecimalStrings(realizedQty, "0") > 0 && `(Min: ${realizedQty})`}
                                </label>
                                <Input
                                  disabled={submitting}
                                  value={line.value.quantityRequested}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setAidLines((prev) =>
                                      prev.map((l, i) =>
                                        i === idx && l.value.kind === "GOODS"
                                          ? { ...l, value: { ...l.value, quantityRequested: val, quantityApproved: val } }
                                          : l
                                      )
                                    );
                                  }}
                                  className="mt-0.5 text-xs"
                                />
                              </div>
                              <div className="w-16">
                                <label className="block font-medium text-[11px] text-stone-600">Satuan</label>
                                <Input
                                  disabled={submitting}
                                  value={line.value.unit}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setAidLines((prev) =>
                                      prev.map((l, i) =>
                                        i === idx && l.value.kind === "GOODS"
                                          ? { ...l, value: { ...l.value, unit: val } }
                                          : l
                                      )
                                    );
                                  }}
                                  className="mt-0.5 text-xs"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={submitting || (line.value.kind === "MONEY" ? realizedIdr > 0n : compareDecimalStrings(realizedQty, "0") > 0)}
                          onClick={() => setAidLines((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {(realizedIdr > 0n || compareDecimalStrings(realizedQty, "0") > 0) && (
                      <p className="text-[11px] text-amber-700">
                        * Baris ini telah terealisasi sebagian (
                        {line.value.kind === "MONEY"
                          ? formatIdrAmount(realizedIdr.toString())
                          : `${realizedQty} ${(line.value as { unit: string }).unit}`}
                        ). Hak tidak boleh dihapus atau diturunkan di bawah nilai ini.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-stone-900">Tinjauan Perubahan (Delta)</h4>
            <RevisionDeltaReview delta={delta} />
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
            disabled={submitting}
            onClick={() => void handleSubmit()}
            className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit3 className="h-4 w-4" />}
            {submitting ? "Mengajukan Revisi..." : "Kirim Pengajuan Revisi"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
