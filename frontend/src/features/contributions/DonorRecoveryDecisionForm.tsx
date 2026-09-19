import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { decideRecoveryRequest, type ContributionRecord, type DonorRecoveryRequestRecord } from "./contributionClient";
import { errorMessage, useOperationIds } from "./contributionUi";

export function DonorRecoveryDecisionForm({ requests, record, onClose, onDecided }: {
  requests: PrivateRequests; record: DonorRecoveryRequestRecord;
  onClose: () => void; onDecided: (contribution: ContributionRecord) => void;
}) {
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED">("APPROVED");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operations = useOperationIds();

  useEffect(() => {
    if (!record) return;
    setDecision("APPROVED");
    setReason("");
    setError(null);
  }, [record]);

  const handleDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (reason.trim().length < 5) {
      setError("Alasan keputusan wajib diisi (minimal 5 karakter).");
      return;
    }

    setSubmitting(true);
    const intent = `recovery-decision:${record.id}:${decision}`;
    try {
      const res = await decideRecoveryRequest(requests, record.id, {
        decision,
        reason: reason.trim(),
        expectedContributionVersion: record.contribution.version,
        operationId: operations.operationFor(intent),
      });
      operations.settle(intent);
      setSubmitting(false);
      onDecided(res.contribution);
    } catch (err) {
      setSubmitting(false);
      setError(errorMessage(err, "Gagal memproses keputusan pemulihan kontak."));
    }
  };

  return (
    <form onSubmit={handleDecision} className="space-y-4 pt-2 border-t border-stone-200">
      {error && <p role="alert" className="text-xs text-rose-800">{error}</p>}
      <div className="space-y-2">
        <label className="block text-xs font-semibold text-stone-800">
          Keputusan Petugas
        </label>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
            <input
              type="radio"
              name="decision"
              value="APPROVED"
              checked={decision === "APPROVED"}
              onChange={() => setDecision("APPROVED")}
              className="text-emerald-600 focus:ring-emerald-500"
            />
            <span>Setujui Pemulihan Kontak</span>
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer">
            <input
              type="radio"
              name="decision"
              value="REJECTED"
              checked={decision === "REJECTED"}
              onChange={() => setDecision("REJECTED")}
              className="text-rose-600 focus:ring-rose-500"
            />
            <span>Tolak Permohonan</span>
          </label>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="decision-reason" className="block text-xs font-semibold text-stone-800">
          Alasan Keputusan <span className="text-rose-600">*</span>
        </label>
        <textarea
          id="decision-reason"
          required
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={
            decision === "APPROVED"
              ? "Contoh: Bukti mutasi m-banking cocok dengan rekening koran lembaga nomor ref 998877."
              : "Contoh: Bukti tidak memuat nama pengirim yang cocok dengan mutasi bank."
          }
          className="w-full bg-white border border-stone-300 rounded-xl px-3.5 py-2 text-xs text-stone-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-600 resize-none"
        />
      </div>

      {decision === "APPROVED" && (
        <p className="text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
          Persetujuan akan memperbarui kontak kontribusi ke{" "}
          <span className="font-mono font-bold">{record.requestedContact}</span>, menaikkan versi
          kontribusi, dan mencabut seketika semua sesi aktif serta kode OTP lama.
        </p>
      )}

      <div className="flex justify-end gap-2.5 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2 rounded-full border border-stone-300 text-stone-600 hover:bg-stone-50 text-xs font-semibold cursor-pointer"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={`px-6 py-2 rounded-full text-white text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer ${
            decision === "APPROVED"
              ? "bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50"
              : "bg-rose-700 hover:bg-rose-800 disabled:opacity-50"
          }`}
        >
          {submitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : decision === "APPROVED" ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <XCircle className="w-3.5 h-3.5" />
          )}
          <span>{decision === "APPROVED" ? "Setujui & Perbarui Kontak" : "Tolak Permohonan"}</span>
        </button>
      </div>
    </form>
  );
}
