import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, HelpCircle, Loader2, Send, X } from "lucide-react";
import {
  getDonorRecoveryStatusByReference,
  submitDonorRecoveryRequest,
  type PublicDonorRecoveryStatus,
} from "./donorClient";
import { Notice } from "./DonorNotice";

type DonorRecoveryModalProps = {
  reference: string;
  isOpen: boolean;
  onClose: () => void;
  onRecoveryApproved?: () => void;
};

export function DonorRecoveryModal({
  reference,
  isOpen,
  onClose,
  onRecoveryApproved,
}: DonorRecoveryModalProps) {
  const [donorName, setDonorName] = useState("");
  const [requestedContact, setRequestedContact] = useState("");
  const [evidenceBasis, setEvidenceBasis] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const [existingStatus, setExistingStatus] = useState<PublicDonorRecoveryStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  useEffect(() => {
    if (!isOpen || !reference) return;
    setError(null);
    setSuccessNotice(null);
    setLoadingStatus(true);
    getDonorRecoveryStatusByReference(reference)
      .then((status) => {
        setExistingStatus(status);
        if (status?.status === "APPROVED" && onRecoveryApproved) {
          onRecoveryApproved();
        }
      })
      .finally(() => setLoadingStatus(false));
  }, [isOpen, reference, onRecoveryApproved]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);

    if (!requestedContact.trim().includes("@")) {
      setError("Kontak baru harus berupa alamat email yang sah.");
      return;
    }
    if (evidenceBasis.trim().length < 5) {
      setError("Mohon jelaskan dasar hubungan atau bukti kepemilikan kontribusi (minimal 5 karakter).");
      return;
    }

    setSubmitting(true);
    const result = await submitDonorRecoveryRequest({
      reference,
      requestedContact: requestedContact.trim(),
      donorName: donorName.trim() || undefined,
      evidenceBasis: evidenceBasis.trim(),
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSuccessNotice("Permohonan pemulihan akses berhasil diajukan dan sedang menunggu pemeriksaan petugas.");
    setExistingStatus({
      id: result.requestId,
      status: "PENDING",
      requestedContactMasked: result.requestedContactMasked,
      decisionReason: null,
      createdAt: result.createdAt,
      decidedAt: null,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-xl border border-tawf-green-10 p-6 sm:p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup jendela pemulihan"
          className="absolute top-6 right-6 text-tawf-muted hover:text-tawf-green p-1.5 rounded-full hover:bg-stone-100 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>

        <div className="flex items-start gap-3.5 pr-8">
          <div className="w-10 h-10 rounded-2xl bg-[#1b765e]/10 flex items-center justify-center shrink-0 text-tawf-green">
            <HelpCircle className="w-5 h-5" aria-hidden />
          </div>
          <div>
            <h3 id="recovery-modal-title" className="font-serif text-lg font-bold text-tawf-green">
              Pemulihan Kontak & Akses Donatur
            </h3>
            <p className="text-xs text-tawf-muted mt-1">
              Petugas lembaga akan memeriksa bukti hubungan Anda dengan kontribusi ini sebelum memperbarui kontak pengiriman kode OTP.
            </p>
          </div>
        </div>

        {loadingStatus ? (
          <div className="py-8 flex justify-center items-center gap-2 text-xs text-tawf-muted">
            <Loader2 className="w-4 h-4 animate-spin text-tawf-green" /> Memeriksa status permohonan...
          </div>
        ) : existingStatus && existingStatus.status === "PENDING" ? (
          <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5 space-y-3">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-xs">
              <Clock className="w-4 h-4" />
              <span>Permohonan Sedang Diperiksa</span>
            </div>
            <p className="text-xs text-amber-900/80 leading-relaxed">
              Permohonan pemulihan kontak Anda ({existingStatus.requestedContactMasked}) telah diterima dan sedang menunggu pemeriksaan petugas lembaga.
              Nomor referensi saja tidak cukup mengalihkan kontak tanpa pembuktian yang sah.
            </p>
            <p className="text-[11px] text-amber-700">
              ID Permohonan: <span className="font-mono">{existingStatus.id}</span>
            </p>
          </div>
        ) : existingStatus && existingStatus.status === "APPROVED" ? (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 space-y-3">
            <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs">
              <CheckCircle2 className="w-4 h-4" />
              <span>Akses Telah Dipulihkan</span>
            </div>
            <p className="text-xs text-emerald-900/80 leading-relaxed">
              Kontak untuk kontribusi ini telah diperbarui ({existingStatus.requestedContactMasked}). Seluruh sesi dan kode lama telah dicabut.
              Silakan tutup jendela ini dan klik &ldquo;Kirim Kode OTP&rdquo; untuk membuka kontribusi Anda.
            </p>
            <button
              type="button"
              onClick={() => {
                if (onRecoveryApproved) onRecoveryApproved();
                onClose();
              }}
              className="w-full py-2.5 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              Tutup & Masuk Melalui OTP
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {existingStatus && existingStatus.status === "REJECTED" && (
              <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 space-y-2">
                <div className="flex items-center gap-2 text-rose-800 font-bold text-xs">
                  <AlertCircle className="w-4 h-4" />
                  <span>Permohonan Sebelumnya Ditolak</span>
                </div>
                <p className="text-xs text-rose-900/80 leading-relaxed">
                  Alasan petugas: {existingStatus.decisionReason || "Bukti hubungan belum mencukupi."}
                </p>
                <p className="text-[11px] text-rose-700">
                  Anda dapat mengajukan permohonan baru dengan melengkapi dasar hubungan dan bukti transaksi.
                </p>
              </div>
            )}

            {error && <Notice tone="error">{error}</Notice>}
            {successNotice && <Notice tone="info">{successNotice}</Notice>}

            <div className="space-y-1.5">
              <label htmlFor="recovery-ref" className="block text-xs font-medium text-tawf-green">
                Referensi Kontribusi
              </label>
              <input
                id="recovery-ref"
                type="text"
                readOnly
                value={reference}
                className="w-full bg-stone-100 border border-tawf-green-10 rounded-xl px-3.5 py-2 text-xs font-mono text-stone-700"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="recovery-name" className="block text-xs font-medium text-tawf-green">
                Nama Donatur / Pemohon (Opsional)
              </label>
              <input
                id="recovery-name"
                type="text"
                value={donorName}
                onChange={(e) => setDonorName(e.target.value)}
                placeholder="Contoh: Ahmad Abdullah"
                className="w-full bg-white border border-tawf-green-10 rounded-xl px-3.5 py-2 text-xs text-tawf-green focus:outline-hidden focus:ring-2 focus:ring-[#1b765e]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="recovery-contact" className="block text-xs font-medium text-tawf-green">
                Alamat Email Kontak Baru <span className="text-rose-600">*</span>
              </label>
              <input
                id="recovery-contact"
                type="email"
                required
                value={requestedContact}
                onChange={(e) => setRequestedContact(e.target.value)}
                placeholder="donatur@contoh.id"
                className="w-full bg-white border border-tawf-green-10 rounded-xl px-3.5 py-2 text-xs text-tawf-green focus:outline-hidden focus:ring-2 focus:ring-[#1b765e]"
              />
              <p className="text-[11px] text-tawf-muted">
                Kode OTP berikutnya hanya akan dikirim ke alamat email ini setelah disahkan.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="recovery-evidence" className="block text-xs font-medium text-tawf-green">
                Dasar Hubungan & Bukti Kontribusi <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="recovery-evidence"
                required
                rows={3}
                value={evidenceBasis}
                onChange={(e) => setEvidenceBasis(e.target.value)}
                placeholder="Jelaskan bukti transfer bank, nomor referensi rekening asal, waktu transfer, atau bukti slip setoran yang cocok dengan kontribusi ini."
                className="w-full bg-white border border-tawf-green-10 rounded-xl px-3.5 py-2 text-xs text-tawf-green focus:outline-hidden focus:ring-2 focus:ring-[#1b765e] resize-none"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2.5">
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
                className="px-6 py-2 rounded-full bg-tawf-green hover:bg-tawf-green-light disabled:opacity-50 text-tawf-sand text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Ajukan Pemulihan</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
