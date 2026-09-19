import { useId, useState } from "react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { correctContribution, formatNominal, type ContributionRecord, type CorrectionType } from "./contributionClient";
import { errorMessage, useOperationIds, useActionError } from "./contributionUi";
import { ContributionActionDialog, contributionFieldClass as fieldClass } from "./ContributionActionDialog";

export function ContributionCorrectionModal({ requests, target, onDone, onClose, onError }: {
  requests: PrivateRequests; target: ContributionRecord; onDone: (updated: ContributionRecord) => void;
  onClose: () => void; onError: (message: string | null) => void;
}) {
  const id = useId();
  const { error, reportError } = useActionError(onError);
  const [correctionType, setCorrectionType] = useState<CorrectionType>("AMOUNT");
  const [amountExact, setAmountExact] = useState(target.amountExact);
  const [reason, setReason] = useState("");
  const [sourceProofRef, setSourceProofRef] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const operations = useOperationIds();
  const submit = async () => {
    if (submitting) return;
    if (reason.trim().length < 5 || !sourceProofRef.trim()) {
      reportError("Alasan koreksi minimal 5 karakter dan bukti sumber wajib diisi.");
      return;
    }
    if (correctionType === "AMOUNT" && (!/^[1-9]\d*$/.test(amountExact.trim()) || amountExact.trim() === target.amountExact)) {
      reportError("Nominal baru harus positif dan berbeda dari nominal saat ini.");
      return;
    }
    const input = { expectedVersion: target.version, correctionType,
      amountExact: correctionType === "AMOUNT" ? amountExact.trim() : undefined,
      reason: reason.trim(), sourceProofRef: sourceProofRef.trim() };
    const intent = JSON.stringify([target.id, input]);
    setSubmitting(true);
    reportError(null);
    try {
      const result = await correctContribution(requests, target.id, { ...input, operationId: operations.operationFor(intent) });
      operations.settle(intent);
      onDone(result.contribution);
    } catch (error) {
      reportError(errorMessage(error, "Gagal menyimpan koreksi kontribusi."));
    } finally { setSubmitting(false); }
  };
  return (
    <ContributionActionDialog error={error} title="Koreksi Kontribusi" submitting={submitting} onSubmit={submit} onClose={onClose}
      disabled={reason.trim().length < 5 || !sourceProofRef.trim()} submitLabel="Sahkan Koreksi"
      summary={<>Versi {target.version} · {formatNominal(target.amountExact, target.currencyUnit)}</>}>
      <label className="block" htmlFor={`${id}-type`}>Jenis Koreksi</label>
      <select id={`${id}-type`} value={correctionType} onChange={e => setCorrectionType(e.target.value as CorrectionType)} className={fieldClass}>
        <option value="AMOUNT">Koreksi nominal penerimaan</option><option value="DUPLICATE">Koreksi pencatatan ganda</option>
      </select>
      {correctionType === "AMOUNT" ? <>
        <label className="block" htmlFor={`${id}-amount`}>Nominal Baru ({target.currencyUnit})</label>
        <input id={`${id}-amount`} value={amountExact} onChange={e => setAmountExact(e.target.value)} className={fieldClass} />
      </> : <p className="p-3 bg-amber-50 text-amber-900 rounded-lg">
        Catatan ganda dikeluarkan dari dana yang tersedia. Nominal lama dan riwayat tetap disimpan. Tidak ada pengembalian uang.
      </p>}
      <label className="block" htmlFor={`${id}-reason`}>Alasan Koreksi (Wajib)</label>
      <textarea id={`${id}-reason`} rows={2} value={reason} onChange={e => setReason(e.target.value)} className={fieldClass} />
      <label className="block" htmlFor={`${id}-proof`}>Nomor Bukti Sumber Koreksi (Wajib)</label>
      <input id={`${id}-proof`} value={sourceProofRef} onChange={e => setSourceProofRef(e.target.value)} className={fieldClass} />
      <p className="p-3 bg-stone-50 rounded-lg text-stone-600">
        Anda mengesahkan koreksi versi {target.version + 1}. Riwayat dan penyaluran terdahulu tetap disimpan.
        Jika timbul selisih, petugas kegiatan perlu menyelesaikannya sebelum menambah alokasi.
      </p>
    </ContributionActionDialog>
  );
}
