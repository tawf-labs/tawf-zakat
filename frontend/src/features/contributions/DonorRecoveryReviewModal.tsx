import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, ShieldCheck, X, XCircle } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  decideRecoveryRequest,
  type ContributionRecord,
  type DonorRecoveryRequestRecord,
} from "./contributionClient";
import { errorMessage, useOperationIds } from "./contributionUi";

type DonorRecoveryReviewModalProps = {
  requests: PrivateRequests;
  record: DonorRecoveryRequestRecord | null;
  onClose: () => void;
  onDecided: (updatedContrib: ContributionRecord) => void;
};

export function DonorRecoveryReviewModal({
  requests,
  record,
  onClose,
  onDecided,
}: DonorRecoveryReviewModalProps) {
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (record) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [record, onClose]);

  if (!record) return null;

  const isPending = record.status === "PENDING";

  const handleDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPending) return;
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-recovery-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-stone-200 p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup peninjauan"
          className="absolute top-6 right-6 text-stone-400 hover:text-stone-700 p-1.5 rounded-full hover:bg-stone-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>

        <div className="flex items-start gap-3.5 pr-8">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0 text-emerald-800">
            <ShieldCheck className="w-5 h-5" aria-hidden />
          </div>
          <div>
            <h3 id="review-recovery-modal-title" className="font-serif text-lg font-bold text-stone-900">
              Pemeriksaan Pemulihan Kontak Donatur
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              Periksa dasar hubungan dan bukti transaksi sebelum memutuskan persetujuan pemulihan kontak.
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {/* Contribution Data */}
          <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-2.5">
            <div className="font-semibold text-stone-800 flex items-center gap-1.5 border-b border-stone-200 pb-2">
              <FileText className="w-3.5 h-3.5 text-stone-500" />
              <span>Data Kontribusi Tercatat</span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">Referensi Sumber:</span>
              <span className="font-mono font-bold text-stone-800">
                {record.contribution?.sourceReference}
              </span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">Nominal & Kanal:</span>
              <span className="font-mono text-stone-700">
                {record.contribution?.amountExact
                  ? `Rp ${Number(record.contribution.amountExact).toLocaleString("id-ID")}`
                  : "-"}{" "}
                ({record.contribution?.sourceChannel})
              </span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">Kontak Saat Ini:</span>
              <span className="font-mono text-stone-600">
                {record.contribution?.currentContact || (
                  <span className="italic text-stone-400">Belum ada kontak terdaftar</span>
                )}
              </span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">Versi Kontribusi:</span>
              <span className="font-mono text-stone-600">Versi {record.contribution?.version}</span>
            </div>
          </div>

          {/* Recovery Request Data */}
          <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200/70 space-y-2.5">
            <div className="font-semibold text-emerald-900 flex items-center gap-1.5 border-b border-emerald-200 pb-2">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>Klaim Pemohon</span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">Nama Pemohon:</span>
              <span className="font-medium text-stone-800">
                {record.donorName || <span className="text-stone-400 italic">(Tidak dicantumkan)</span>}
              </span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">Kontak Baru Diajukan:</span>
              <span className="font-mono font-bold text-emerald-800">
                {record.requestedContact}
              </span>
            </div>
            <div>
              <span className="text-stone-400 block text-[10px]">Dasar Hubungan / Bukti:</span>
              <p className="text-stone-700 mt-0.5 leading-relaxed bg-white p-2 rounded-lg border border-emerald-100 text-[11px]">
                {record.evidenceBasis}
              </p>
            </div>
          </div>
        </div>

        {!isPending ? (
          <div
            className={`p-4 rounded-2xl border text-xs space-y-1.5 ${
              record.status === "APPROVED"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}
          >
            <div className="font-bold flex items-center gap-1.5">
              {record.status === "APPROVED" ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  <span>Permohonan Telah Disetujui</span>
                </>
              ) : (
                <>
                  <XCircle className="w-4 h-4 text-rose-700" />
                  <span>Permohonan Telah Ditolak</span>
                </>
              )}
            </div>
            <p className="leading-relaxed">Alasan: {record.decisionReason || "-"}</p>
            <p className="text-[11px] text-stone-500 font-mono">
              Diputuskan oleh: {record.decidedByAccount || "-"} pada{" "}
              {record.decidedAt
                ? new Date(record.decidedAt * 1000).toLocaleString("id-ID")
                : "-"}
            </p>
          </div>
        ) : (
          <form onSubmit={handleDecision} className="space-y-4 pt-2 border-t border-stone-200">
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
        )}
      </div>
    </div>
  );
}
