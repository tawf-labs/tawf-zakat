import { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { ExaminationChecklist } from "./disbursementClient";

export function ProposalExaminationChecklist({ hasAlternative, hasWarnings, disabled, onReady, onReturn }: {
  hasAlternative: boolean; hasWarnings: boolean; disabled: boolean;
  onReady: (checklist: ExaminationChecklist) => void; onReturn: (reason: string) => void;
}) {
  const [administrativeChecksOk, setAdmin] = useState(false);
  const [eligibilityChecksOk, setEligibility] = useState(false);
  const [alternativeIdReviewed, setAlternative] = useState(false);
  const [exceptions, setExceptions] = useState("");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState(false);
  const canReady = administrativeChecksOk && eligibilityChecksOk && (!hasAlternative || alternativeIdReviewed)
    && (!hasWarnings || Boolean(exceptions.trim()));
  return <fieldset disabled={disabled} className="space-y-3 text-xs">
    <legend className="mb-2 font-semibold">Hasil pemeriksaan kelayakan</legend>
    <label className="flex gap-2"><input type="checkbox" checked={administrativeChecksOk} onChange={e => setAdmin(e.target.checked)} />Administrasi lengkap dan sesuai</label>
    <label className="flex gap-2"><input type="checkbox" checked={eligibilityChecksOk} onChange={e => setEligibility(e.target.checked)} />Kelayakan asnaf dan kebutuhan memenuhi syarat</label>
    {hasAlternative && <label className="flex gap-2"><input type="checkbox" checked={alternativeIdReviewed} onChange={e => setAlternative(e.target.checked)} />Identitas alternatif telah ditelaah</label>}
    {hasWarnings && <label className="block">Hasil telaah dan alasan pengecualian bantuan berulang
      <textarea value={exceptions} onChange={e => setExceptions(e.target.value)} className="mt-1 block w-full rounded border p-2" rows={3} />
    </label>}
    <label className="block">Catatan kesimpulan pemeriksa
      <textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 block w-full rounded border p-2" rows={2} />
    </label>
    {returning ? <div className="space-y-2 rounded border border-amber-300 p-3">
      <label className="block">Alasan pengembalian untuk revisi
        <textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} className="mt-1 block w-full rounded border p-2" rows={3} />
      </label>
      <Button type="button" variant="outline" size="sm" onClick={() => setReturning(false)}>Batal</Button>{" "}
      <Button type="button" size="sm" disabled={!reason.trim()} onClick={() => onReturn(reason.trim())}>Konfirmasi Kembalikan untuk Revisi</Button>
    </div> : <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setReturning(true)}>Kembalikan untuk Revisi</Button>
      <Button type="button" size="sm" disabled={!canReady} onClick={() => onReady({
        administrativeChecksOk, eligibilityChecksOk, alternativeIdReviewed, notes: notes.trim(),
        recurringAidExceptions: exceptions.split("\n").map(line => line.trim()).filter(Boolean),
      })}>Nyatakan Siap Diputus</Button>
    </div>}
  </fieldset>;
}
