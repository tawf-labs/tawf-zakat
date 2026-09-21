import { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import { grantMandate, updateMandate, revokeMandate, type OperationalMandate } from "./workspaceClient";
import { OPERATIONAL_FUNCTION_LABELS, formatIdrAmount, formatTimestamp } from "./mandateLabels";
import { useAuthorityManagement, useAuthorityOfficers, useMandates } from "./useAuthorityManagement";
import { AuthorityManagementFrame } from "./AuthorityManagementFrame";
import { MandateForm } from "./MandateForm";

export function MandateManagementSection({ requests }: { requests: PrivateRequests }) {
  const mandates = useMandates(requests);
  const officers = useAuthorityOfficers(requests);
  const state = useAuthorityManagement(requests);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<OperationalMandate | null>(null);
  async function changeState(mandate: OperationalMandate) {
    const activate = !mandate.isActive;
    if (!window.confirm(activate ? "Aktifkan kembali mandat berdasarkan konfigurasi terbaru ini?" : "Cabut mandat operasional ini?")) return;
    await state.run(() => activate
      ? updateMandate(requests, mandate.id, { expectedVersion: mandate.version, isActive: true })
      : revokeMandate(requests, mandate.id, mandate.version), activate ? "Mandat diaktifkan kembali." : "Mandat operasional telah dicabut.");
  }
  return <AuthorityManagementFrame label="Manajemen Mandat Operasional" title="Pengelolaan Mandat Operasional Lembaga"
    createLabel="Terbitkan Mandat" creating={creating} toggle={() => setCreating(!creating)} state={state} error={mandates.error || officers.error}>
    {creating && officers.data && <MandateForm officers={officers.data} busy={state.busy} cancel={() => setCreating(false)} submit={async values => {
      if (await state.run(() => grantMandate(requests, values), "Mandat operasional berhasil diterbitkan.")) setCreating(false);
    }} />}
    {mandates.isPending && <p>Memuat mandat…</p>}
    {mandates.data?.map(mandate => <div key={mandate.id} className="rounded-xl border border-stone-200 p-4">
      {editing?.id === mandate.id ? <MandateForm key={editing.id} initial={editing} officers={officers.data ?? []} busy={state.busy}
        cancel={() => setEditing(null)} submit={async (values, version) => {
          if (await state.run(() => updateMandate(requests, mandate.id, {
            expectedVersion: version!, scopeType: values.scopeType, programId: values.programId,
            validFrom: values.validFrom, validUntil: values.validUntil, assignmentRef: values.assignmentRef,
            nominalLimit: values.nominalLimit,
          }), "Perubahan mandat operasional tersimpan.")) setEditing(null);
        }} /> : <>
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h4 className="font-semibold">{OPERATIONAL_FUNCTION_LABELS[mandate.function]?.label ?? mandate.function}</h4>
            <p className="text-sm">{officers.data?.find(o => o.id === mandate.officerId)?.displayName ?? mandate.officerId}</p>
            <p className="text-xs">{mandate.isActive ? "Aktif" : "Dicabut"} · Versi {mandate.version}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={state.busy} onClick={() => setEditing(mandate)}>Ubah</Button>
            <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void changeState(mandate)}>{mandate.isActive ? "Cabut" : "Aktifkan kembali"}</Button>
          </div>
        </div>
        <p className="mt-3 text-sm">SK: {mandate.assignmentRef} · {formatIdrAmount(mandate.nominalLimit)}</p>
        <p className="text-xs text-stone-600">{formatTimestamp(mandate.validFrom)} – {formatTimestamp(mandate.validUntil)}</p>
        <p className="text-xs text-stone-600">{mandate.scopeType === "SPECIFIC_PROGRAM" ? `Program (${mandate.programId})` : "Semua program lembaga"}</p>
      </>}
    </div>)}
    {mandates.data?.length === 0 && <p className="text-sm text-stone-500">Belum ada mandat operasional.</p>}
  </AuthorityManagementFrame>;
}
