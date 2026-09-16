import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { OPERATIONAL_FUNCTION_LABELS } from "./mandateLabels";
import type { OfficerWithAccounts, OperationalFunction, OperationalMandate, MandateScopeType, grantMandate } from "./workspaceClient";

type MandateValues = Parameters<typeof grantMandate>[1];
const localTime = (seconds: number) => {
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
};
const fieldClass = "mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-sm";

/** An edit retains the exact version the user opened, even if the list refreshes. */
export function MandateForm({ initial, officers, busy, submit, cancel }: {
  initial?: OperationalMandate; officers: OfficerWithAccounts[]; busy: boolean;
  submit: (values: MandateValues, version?: number) => Promise<void>; cancel: () => void;
}) {
  const [opened] = useState(initial);
  const [id] = useState(() => initial?.id ?? crypto.randomUUID());
  const [officerId, setOfficerId] = useState(initial?.officerId ?? officers.find(o => o.isActive)?.id ?? "");
  const [fn, setFn] = useState<OperationalFunction>(initial?.function ?? "PREPARE_PROPOSALS");
  const [scopeType, setScope] = useState<MandateScopeType>(initial?.scopeType ?? "ALL_PROGRAMS");
  const [programId, setProgram] = useState(initial?.programId ?? "");
  const [assignmentRef, setRef] = useState(initial?.assignmentRef ?? "");
  const [nominalLimit, setLimit] = useState(initial?.nominalLimit ?? "");
  const [validFrom, setFrom] = useState(() => localTime(initial?.validFrom ?? Math.floor(Date.now() / 1000)));
  const [validUntil, setUntil] = useState(() => localTime(initial?.validUntil ?? Math.floor(Date.now() / 1000) + 365 * 86400));
  const prefix = `mandate-${id}`;
  return <form className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/30 p-4" onSubmit={e => {
    e.preventDefault();
    void submit({ id, officerId, function: fn, scopeType, programId: scopeType === "SPECIFIC_PROGRAM" ? programId.trim() : null,
      assignmentRef: assignmentRef.trim(), nominalLimit: nominalLimit || null,
      validFrom: Math.floor(new Date(validFrom).getTime() / 1000), validUntil: Math.floor(new Date(validUntil).getTime() / 1000),
    }, opened?.version);
  }}>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label htmlFor={`${prefix}-officer`} className="text-xs">Pilih Petugas Penerima Mandat *
        <select id={`${prefix}-officer`} required disabled={!!initial} className={fieldClass} value={officerId} onChange={e => setOfficerId(e.target.value)}>
          <option value="">Pilih petugas</option>
          {officers.map(o => <option key={o.id} value={o.id} disabled={!o.isActive}>{o.displayName}</option>)}
        </select>
      </label>
      <label htmlFor={`${prefix}-function`} className="text-xs">Fungsi Operasional *
        <select id={`${prefix}-function`} disabled={!!initial} className={fieldClass} value={fn} onChange={e => setFn(e.target.value as OperationalFunction)}>
          {(Object.keys(OPERATIONAL_FUNCTION_LABELS) as OperationalFunction[]).map(f => <option key={f} value={f}>{OPERATIONAL_FUNCTION_LABELS[f].label}</option>)}
        </select>
      </label>
      <label htmlFor={`${prefix}-ref`} className="text-xs">Nomor SK / Surat Tugas *
        <input id={`${prefix}-ref`} required className={fieldClass} value={assignmentRef} onChange={e => setRef(e.target.value)} />
      </label>
      <label htmlFor={`${prefix}-limit`} className="text-xs">Batas Nominal Rupiah (Opsional)
        <input id={`${prefix}-limit`} inputMode="numeric" pattern="[0-9]*" className={fieldClass} value={nominalLimit} onChange={e => setLimit(e.target.value)} />
      </label>
      <label htmlFor={`${prefix}-scope`} className="text-xs">Cakupan Program
        <select id={`${prefix}-scope`} className={fieldClass} value={scopeType} onChange={e => setScope(e.target.value as MandateScopeType)}>
          <option value="ALL_PROGRAMS">Semua Program Bantuan Lembaga</option><option value="SPECIFIC_PROGRAM">Program Spesifik Tertentu</option>
        </select>
      </label>
      {scopeType === "SPECIFIC_PROGRAM" && <label htmlFor={`${prefix}-program`} className="text-xs">ID Program Bantuan *
        <input id={`${prefix}-program`} required className={fieldClass} value={programId} onChange={e => setProgram(e.target.value)} />
      </label>}
      <label htmlFor={`${prefix}-from`} className="text-xs">Mulai berlaku
        <input id={`${prefix}-from`} required type="datetime-local" step="1" className={fieldClass} value={validFrom} onChange={e => setFrom(e.target.value)} />
      </label>
      <label htmlFor={`${prefix}-until`} className="text-xs">Berlaku sampai
        <input id={`${prefix}-until`} required type="datetime-local" step="1" min={validFrom} className={fieldClass} value={validUntil} onChange={e => setUntil(e.target.value)} />
      </label>
    </fieldset>
    <div className="flex gap-2">
      <Button type="submit" size="sm" disabled={busy}>{busy ? "Menyimpan…" : initial ? "Simpan" : "Terbitkan Mandat Sekarang"}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={cancel}>Batal</Button>
    </div>
  </form>;
}
