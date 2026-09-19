import { useState } from "react";
import { submitDonorRecoveryRequest, type PublicDonorRecoveryStatus } from "./donorClient";
import { Notice } from "./DonorNotice";

export function DonorRecoveryForm({ reference, onSubmitted, onClose }: {
  reference: string;
  onSubmitted: (status: PublicDonorRecoveryStatus) => void;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const evidenceBasis = String(data.get("evidenceBasis") ?? "").trim();
    if (evidenceBasis.length < 5) {
      setError("Mohon jelaskan dasar hubungan atau bukti kepemilikan kontribusi (minimal 5 karakter).");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await submitDonorRecoveryRequest({
      reference, evidenceBasis,
      requestedContact: String(data.get("requestedContact") ?? "").trim(),
      donorName: String(data.get("donorName") ?? "").trim() || undefined,
    });
    setSubmitting(false);
    if (!result.ok) { setError(result.error); return; }
    onSubmitted({ id: result.requestId, status: "PENDING", requestedContactMasked: result.requestedContactMasked,
      createdAt: result.createdAt, decidedAt: null });
  }
  const inputClass = "w-full bg-white border border-tawf-green-10 rounded-xl px-3.5 py-2 text-xs text-tawf-green focus:outline-hidden focus:ring-2 focus:ring-[#1b765e]";
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="space-y-1.5">
        <label htmlFor="recovery-ref" className="block text-xs">Referensi Kontribusi</label>
        <input id="recovery-ref" readOnly value={reference} className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="recovery-name" className="block text-xs">Nama Donatur / Pemohon (Opsional)</label>
        <input id="recovery-name" name="donorName" placeholder="Contoh: Ahmad Abdullah" className={inputClass} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="recovery-contact" className="block text-xs">Alamat Email Kontak Baru *</label>
        <input id="recovery-contact" name="requestedContact" type="email" required placeholder="donatur@contoh.id" className={inputClass} />
        <p className="text-[11px] text-tawf-muted">Kode OTP berikutnya hanya akan dikirim ke alamat email ini setelah disahkan.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="recovery-evidence" className="block text-xs">Dasar Hubungan & Bukti Kontribusi *</label>
        <textarea id="recovery-evidence" name="evidenceBasis" required rows={3} className={inputClass}
          placeholder="Jelaskan bukti transfer bank, rekening asal, waktu transfer, atau slip setoran yang cocok dengan kontribusi ini." />
      </div>
      <div className="flex justify-end gap-2.5">
        <button type="button" onClick={onClose} className="px-5 py-2 rounded-full border text-xs">Batal</button>
        <button type="submit" disabled={submitting} className="px-6 py-2 rounded-full bg-tawf-green text-tawf-sand text-xs font-bold disabled:opacity-50">
          {submitting ? "Mengirim..." : "Ajukan Pemulihan"}
        </button>
      </div>
    </form>
  );
}
