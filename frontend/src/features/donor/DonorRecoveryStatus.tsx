import type { PublicDonorRecoveryStatus } from "./donorClient";

export function DonorRecoveryStatus({ status, onNewRequest, onContinue }: {
  status: PublicDonorRecoveryStatus;
  onNewRequest: () => void;
  onContinue: () => void;
}) {
  const pending = status.status === "PENDING";
  const approved = status.status === "APPROVED";
  return (
    <section aria-live="polite" className="rounded-2xl bg-stone-50 border border-stone-200 p-5 space-y-3 text-xs">
      <h4 className="font-bold">{pending ? "Permohonan Sedang Diperiksa" : approved ? "Akses Telah Dipulihkan" : "Permohonan Sebelumnya Ditolak"}</h4>
      <p>{pending
        ? `Permohonan untuk kontak ${status.requestedContactMasked} sedang menunggu pemeriksaan petugas lembaga.`
        : approved
          ? `Kontak telah diperbarui (${status.requestedContactMasked}). Seluruh sesi dan kode lama telah dicabut. Anda dapat meminta OTP baru.`
          : "Permohonan belum dapat disetujui. Hubungi petugas lembaga atau ajukan kembali dengan melengkapi bukti hubungan."}</p>
      {pending && <p>ID Permohonan: <span className="font-mono">{status.id}</span></p>}
      {approved && <button type="button" onClick={onContinue} className="block w-full py-2.5 rounded-full bg-emerald-700 text-white font-bold">
        Tutup & Masuk Melalui OTP
      </button>}
      {!pending && <button type="button" onClick={onNewRequest} className="block w-full py-2.5 rounded-full border border-stone-300 font-semibold">
        Ajukan Pemulihan Baru
      </button>}
    </section>
  );
}
