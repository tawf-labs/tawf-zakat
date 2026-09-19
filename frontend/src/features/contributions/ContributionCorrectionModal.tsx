import { useId, useState } from "react";
import { Edit3, Info, AlertTriangle } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import {
  correctContribution,
  formatNominal,
  type ContributionRecord,
  type CorrectionType,
} from "./contributionClient";
import { errorMessage, useOperationIds } from "./contributionUi";

const fieldClass = "w-full text-sm border border-stone-300 rounded-lg p-2 focus:ring-1 focus:outline-none";
const labelClass = "block font-semibold uppercase text-stone-600 mb-1";

export function ContributionCorrectionModal({
  requests,
  target,
  onDone,
  onClose,
  onError,
}: {
  requests: PrivateRequests;
  target: ContributionRecord;
  onDone: (updated: ContributionRecord) => void;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const typeId = useId();
  const amountId = useId();
  const reasonId = useId();
  const proofId = useId();

  const [correctionType, setCorrectionType] = useState<CorrectionType>("AMOUNT");
  const [amountExact, setAmountExact] = useState(target.amountExact);
  const [reason, setReason] = useState("");
  const [sourceProofRef, setSourceProofRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const operations = useOperationIds();

  const submit = async () => {
    if (!reason.trim()) {
      onError("Alasan koreksi wajib diisi.");
      return;
    }
    if (correctionType === "AMOUNT") {
      if (!amountExact.trim() || !/^\d+$/.test(amountExact.trim()) || amountExact.trim() === "0") {
        onError("Nominal baru harus berupa bilangan bulat positif.");
        return;
      }
      if (amountExact.trim() === target.amountExact) {
        onError("Nominal baru harus berbeda dari nominal saat ini.");
        return;
      }
    }

    setSubmitting(true);
    onError(null);
    try {
      const intentKey = `correct-${target.id}-v${target.version}-${correctionType}-${amountExact}-${reason}-${sourceProofRef}`;
      const operationId = operations.mint(intentKey);

      const res = await correctContribution(requests, target.id, {
        expectedVersion: target.version,
        correctionType,
        amountExact: correctionType === "AMOUNT" ? amountExact.trim() : undefined,
        reason: reason.trim(),
        sourceProofRef: sourceProofRef.trim() || undefined,
        operationId,
      });

      onDone(res.contribution);
    } catch (err) {
      onError(errorMessage(err, "Gagal mencatat koreksi kontribusi."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Koreksi Kontribusi"
        className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-stone-200"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-1.5">
              <Edit3 className="w-5 h-5 text-amber-600" />
              <span>Koreksi Kontribusi</span>
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              Kontribusi: <code>{target.id}</code> (Versi Saat Ini: V{target.version} ·{" "}
              {formatNominal(target.amountExact, target.currencyUnit)})
            </p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 font-bold" aria-label="Tutup">
            ✕
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <label htmlFor={typeId} className={labelClass}>
              Jenis Koreksi
            </label>
            <select
              id={typeId}
              value={correctionType}
              onChange={(e) => setCorrectionType(e.target.value as CorrectionType)}
              className={fieldClass}
            >
              <option value="AMOUNT">Koreksi Nominal (Penyesuaian Nilai Penerimaan)</option>
              <option value="DUPLICATE">Koreksi Data Ganda (Pencatatan Berulang / Void)</option>
            </select>
          </div>

          {correctionType === "AMOUNT" ? (
            <div>
              <label htmlFor={amountId} className={labelClass}>
                Nominal Baru ({target.currencyUnit})
              </label>
              <input
                id={amountId}
                type="text"
                value={amountExact}
                onChange={(e) => setAmountExact(e.target.value)}
                placeholder="Misal: 400000"
                className={fieldClass}
              />
              <span className="text-[11px] text-stone-500 mt-1 block">
                Nominal pasti tanpa pemisah ribuan. Nominal saat ini: {formatNominal(target.amountExact, target.currencyUnit)}.
              </span>
            </div>
          ) : (
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong>Pencatatan Ganda (DUPLICATE):</strong> Kontribusi akan dinolkan (Rp 0) dan ditandai duplikat.
                Tindakan ini <strong>tidak memicu refund</strong> atau arus kas keluar (AC04, AC12).
              </div>
            </div>
          )}

          <div>
            <label htmlFor={reasonId} className={labelClass}>
              Alasan Koreksi <span className="text-rose-600">*</span>
            </label>
            <textarea
              id={reasonId}
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Koreksi selisih pencatatan mutasi bank BCA tanggal 15 Maret 2026"
              className={fieldClass}
            />
          </div>

          <div>
            <label htmlFor={proofId} className={labelClass}>
              Nomor Bukti Sumber Koreksi (Opsional)
            </label>
            <input
              id={proofId}
              type="text"
              value={sourceProofRef}
              onChange={(e) => setSourceProofRef(e.target.value)}
              placeholder="Contoh: REK-KORAN-REV-01"
              className={fieldClass}
            />
          </div>

          <div className="p-3 bg-stone-50 rounded-lg border border-stone-200 text-stone-600 flex items-start gap-2 text-[11px]">
            <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <strong>Integritas Data (AC10, AC19):</strong> Koreksi akan menaikkan versi kontribusi dari V
              {target.version} ke V{target.version + 1}. Data lama tetap tersimpan sebagai rekam jejak. Penyaluran
              aktual yang sudah terjadi tidak ditimpa; jika terjadi selisih (shortfall), alokasi baru akan diblokir
              sampai selisih diselesaikan.
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button size="sm" onClick={submit} disabled={submitting || !reason.trim()}>
            {submitting ? "Menyimpan Koreksi…" : "Simpan Koreksi"}
          </Button>
        </div>
      </div>
    </div>
  );
}
