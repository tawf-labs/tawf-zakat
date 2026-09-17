import { useId, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import {
  endorseContribution,
  formatNominal,
  reconcileContribution,
  type ContributionRecord,
} from "./contributionClient";
import { errorMessage, useOperationIds } from "./contributionUi";

type DecisionProps = {
  requests: PrivateRequests;
  target: ContributionRecord;
  onDone: (updated: ContributionRecord) => void;
  onClose: () => void;
  onError: (message: string | null) => void;
};

const fieldClass = "w-full text-sm border border-stone-300 rounded-lg p-2 focus:ring-1 focus:outline-none";
const labelClass = "block font-semibold uppercase text-stone-600 mb-1";

function DecisionShell({
  icon,
  title,
  target,
  onClose,
  children,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  target: ContributionRecord;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl border border-stone-200">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-stone-900 flex items-center gap-1.5">
              {icon}
              <span>{title}</span>
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              Kontribusi: <code>{target.id}</code> ({formatNominal(target.amountExact, target.currencyUnit)})
            </p>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 font-bold" aria-label="Tutup">
            ✕
          </button>
        </div>
        <div className="space-y-3 text-xs">{children}</div>
        <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">{footer}</div>
      </div>
    </div>
  );
}

/**
 * Submits one decision against the version the officer was looking at. The intent key
 * carries the content, so a retry reuses its operationId and an edit starts a new one.
 */
function useDecision<P>(
  target: ContributionRecord,
  kind: string,
  send: (payload: P & { operationId: string }) => Promise<ContributionRecord>,
  { onDone, onError }: Pick<DecisionProps, "onDone" | "onError">,
  failure: string
) {
  const [busy, setBusy] = useState(false);
  const operations = useOperationIds();
  const submit = async (payload: P) => {
    setBusy(true);
    onError(null);
    const intent = `${kind}:${target.id}:${JSON.stringify(payload)}`;
    try {
      const updated = await send({ ...payload, operationId: operations.operationFor(intent) });
      operations.settle(intent);
      onDone(updated);
    } catch (err) {
      onError(errorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, submit };
}

export function ReconcileModal({ requests, target, onDone, onClose, onError }: DecisionProps) {
  const [proofRef, setProofRef] = useState("");
  const [notes, setNotes] = useState("");
  const id = useId();
  const { busy, submit } = useDecision<{ expectedVersion: number; proofRef: string; notes?: string }>(
    target,
    "reconcile",
    (payload) =>
      reconcileContribution(requests, target.id, payload),
    { onDone, onError },
    "Gagal merekonsiliasi kontribusi."
  );

  return (
    <DecisionShell
      icon={<CheckCircle2 className="w-5 h-5 text-blue-600" />}
      title="Rekonsiliasi Kontribusi"
      target={target}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            onClick={() =>
              submit({ expectedVersion: target.version, proofRef: proofRef.trim(), notes: notes.trim() || undefined })
            }
            disabled={busy || !proofRef.trim()}
            className="bg-blue-700 hover:bg-blue-800"
          >
            {busy ? "Menyimpan…" : "Rekonsiliasi"}
          </Button>
        </>
      }
    >
      <div>
        <label htmlFor={`${id}-proof`} className={labelClass}>Referensi Bukti Bank / Koran Rekening *</label>
        <input
          id={`${id}-proof`}
          type="text"
          required
          placeholder="Contoh: Statement-BCA-202410-001 / QRIS Settlement Ref"
          value={proofRef}
          onChange={(e) => setProofRef(e.target.value)}
          className={`${fieldClass} focus:ring-blue-500`}
        />
      </div>
      <div>
        <label htmlFor={`${id}-notes`} className={labelClass}>Catatan Rekonsiliasi (Opsional)</label>
        <textarea
          id={`${id}-notes`}
          rows={2}
          placeholder="Sesuai mutasi rekening giro amil..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`${fieldClass} focus:ring-blue-500`}
        />
      </div>
    </DecisionShell>
  );
}

export function EndorseModal({ requests, target, onDone, onClose, onError }: DecisionProps) {
  const [notes, setNotes] = useState("");
  const id = useId();
  const { busy, submit } = useDecision<{ expectedVersion: number; notes?: string }>(
    target,
    "endorse",
    (payload) => endorseContribution(requests, target.id, payload),
    { onDone, onError },
    "Gagal mengesahkan kontribusi."
  );

  return (
    <DecisionShell
      icon={<ShieldCheck className="w-5 h-5 text-emerald-600" />}
      title="Pengesahan Pejabat Lembaga"
      target={target}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button
            onClick={() => submit({ expectedVersion: target.version, notes: notes.trim() || undefined })}
            disabled={busy}
            className="bg-emerald-700 hover:bg-emerald-800"
          >
            {busy ? "Mengesahkan…" : "Sahkan Kontribusi"}
          </Button>
        </>
      }
    >
      <div className="p-3 bg-emerald-50 rounded-lg text-emerald-800 border border-emerald-200">
        Pengesahan mengonfirmasi bahwa kontribusi terekonsiliasi ini sah dan siap dimasukkan ke dalam batch bukti
        periodik lembaga.
      </div>
      <p className="text-stone-500">
        Pengesahan dicatat atas mandat ENDORSE_CONTRIBUTIONS aktif milik akun Anda; mandat tidak dipilih secara manual.
      </p>
      <div>
        <label htmlFor={`${id}-notes`} className={labelClass}>Catatan Pengesahan (Opsional)</label>
        <textarea
          id={`${id}-notes`}
          rows={2}
          placeholder="Disahkan untuk batch periodik Q4..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={`${fieldClass} focus:ring-emerald-500`}
        />
      </div>
    </DecisionShell>
  );
}
