import { useId, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/Dialog";
import { WorkspaceRequestError, type PrivateRequests } from "../workspace/privateRequests";
import {
  BAST_BATCH_OUTCOME_LABELS,
  verifyBastBatchBySecondOfficer,
  type BastBatchOutcome,
  type DisbursementRealization,
} from "./disbursementClient";

const failureText = (failure: unknown, fallback: string) =>
  failure instanceof WorkspaceRequestError && failure.status < 500
    ? failure.message
    : `${fallback} Hasilnya belum diketahui; muat ulang status realisasi sebelum mencoba lagi.`;

/**
 * Confirms every member of one group handover in a single click - the pace a large roster
 * (a hundred sembako recipients in one serah terima) needs. One shared BAST examination, one
 * click; each member still gets its own outcome afterward. Never presented as one undifferentiated
 * success: a member already confirmed, disputed, still short of evidence, or recorded by this
 * same officer is named, not folded into the count.
 */
export function BatchConfirmationModal({ requests, proposalId, batchGroupId, members, beneficiaryName, isOpen, onClose, onChanged }: {
  requests: PrivateRequests;
  proposalId: string;
  batchGroupId: string;
  members: DisbursementRealization[];
  beneficiaryName: (realization: DisbursementRealization) => string;
  isOpen: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const id = useId();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<BastBatchOutcome[] | null>(null);

  const nameOf = (outcome: BastBatchOutcome) =>
    beneficiaryName(members.find((m) => m.id === outcome.realizationId) ?? members[0]!);

  async function confirmAll() {
    setBusy(true);
    setError(null);
    try {
      const result = await verifyBastBatchBySecondOfficer(requests, proposalId, batchGroupId, { notes: notes.trim() });
      setOutcomes(result.outcomes);
      onChanged();
    } catch (failure) {
      setError(failureText(failure, "Konfirmasi kelompok gagal dicatat."));
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open={isOpen} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" showCloseButton={!busy}>
      <DialogTitle>Konfirmasi kelompok (BAST)</DialogTitle>
      <DialogDescription>
        Satu pemeriksaan BAST untuk {members.length} penerima dalam penyerahan kelompok ini. Pemeriksa harus petugas
        selain pencatat realisasi. Setiap anggota tetap diperiksa dan dilaporkan sendiri - yang sudah terkonfirmasi,
        diperselisihkan, atau belum lengkap buktinya tidak ikut lolos begitu saja.
      </DialogDescription>

      {!outcomes ? <form className="space-y-3 text-sm" onSubmit={(event) => { event.preventDefault(); void confirmAll(); }}>
        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-stone-200 p-2 text-xs text-stone-700">
          {members.map((member) => <li key={member.id}>{beneficiaryName(member)}</li>)}
        </ul>
        <label className="block text-xs font-semibold" htmlFor={`${id}-notes`}>
          Hasil pemeriksaan tanda terima / BAST
          <textarea id={`${id}-notes`} rows={3} value={notes} disabled={busy} required
            className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal" onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-stone-100 pt-3">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>Batal</Button>
          <Button type="submit" size="sm" disabled={busy || !notes.trim()}>
            {busy ? "Memeriksa…" : `Konfirmasi semua (${members.length})`}
          </Button>
        </div>
      </form> : <div className="space-y-3 text-sm">
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
          {outcomes.filter((o) => o.state === "CONFIRMED").length} dari {outcomes.length} baru terkonfirmasi.
        </p>
        <ul className="space-y-1 text-xs">
          {outcomes.map((outcome) => <li key={outcome.realizationId} className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 px-2 py-1.5">
            <span>{nameOf(outcome)}</span>
            <span className={`rounded px-2 py-0.5 font-semibold ${outcome.state === "CONFIRMED" ? "bg-emerald-100 text-emerald-900" : outcome.state === "DISPUTED" ? "bg-red-100 text-red-900" : "bg-stone-100 text-stone-700"}`}>
              {BAST_BATCH_OUTCOME_LABELS[outcome.state]}
            </span>
          </li>)}
        </ul>
        <div className="flex justify-end border-t border-stone-100 pt-3">
          <Button type="button" size="sm" onClick={onClose}>Tutup</Button>
        </div>
      </div>}
    </DialogContent>
  </Dialog>;
}
