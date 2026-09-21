import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";

type Props = {
  draft: boolean;
  busy: boolean;
  submitting: boolean;
  onCorrect: (reason: string, sourceProofRef: string) => Promise<void>;
};

export function BatchCorrectionForm({ draft, busy, submitting, onCorrect }: Props) {
  const [reason, setReason] = useState("");
  const [source, setSource] = useState("");
  const id = useId();
  return <details className="border rounded-lg p-3 text-sm space-y-2 mt-4">
    <summary className="font-medium cursor-pointer">{draft ? "Perbarui draf daftar" : "Koreksi kelompok ini"}</summary>
    <p className="text-xs text-stone-600">{draft
      ? "Jika sumber berubah, buat draf daftar pengganti untuk diperiksa dan disahkan kembali. Draf lama tetap tersimpan. Pencatatan yang sudah terkirim harus diselesaikan dahulu."
      : "Buat versi penerus setelah kontribusi dikoreksi atau dana dikembalikan. Semua kuitansi anggota yang masih sah perlu dibuktikan ulang; kuitansi lama tetap tersimpan sebagai riwayat."}</p>
    <form className="space-y-2 pt-2" onSubmit={event => {
      event.preventDefault();
      if (!busy && reason.trim() && source.trim()) void onCorrect(reason.trim(), source.trim());
    }}>
      <div>
        <label htmlFor={`${id}-reason`} className="block text-xs font-semibold text-stone-700">Alasan koreksi</label>
        <input id={`${id}-reason`} required value={reason} disabled={busy} onChange={e => setReason(e.target.value)}
          placeholder="Koreksi nominal sesuai rekening koran" className="w-full border rounded p-2 text-sm" />
      </div>
      <div>
        <label htmlFor={`${id}-source`} className="block text-xs font-semibold text-stone-700">Referensi bukti sumber</label>
        <input id={`${id}-source`} required value={source} disabled={busy} onChange={e => setSource(e.target.value)}
          placeholder="REF-CORR-2026-09-001" className="w-full border rounded p-2 text-sm" />
      </div>
      <Button type="submit" disabled={busy || !reason.trim() || !source.trim()}>
        {submitting ? "Menyiapkan koreksi…" : draft ? "Siapkan draf pengganti" : "Siapkan kelompok koreksi"}
      </Button>
    </form>
  </details>;
}
