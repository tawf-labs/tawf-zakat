import { useState } from "react";
import { Award, Calendar, FileText, Layers, Loader2, Pencil, RotateCcw, UserCheck, XCircle } from "lucide-react";
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

    {mandates.isPending && (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-stone-500">
        <Loader2 className="h-4 w-4 animate-spin text-[#1b765e]" />
        <span>Memuat mandat…</span>
      </div>
    )}

    {mandates.data?.map(mandate => (
      <div key={mandate.id} className="rounded-2xl border border-stone-200/90 bg-stone-50/40 p-5 hover:border-emerald-300/80 transition-all shadow-2xs space-y-3.5">
        {editing?.id === mandate.id ? <MandateForm key={editing.id} initial={editing} officers={officers.data ?? []} busy={state.busy}
          cancel={() => setEditing(null)} submit={async (values, version) => {
            if (await state.run(() => updateMandate(requests, mandate.id, {
              expectedVersion: version!, scopeType: values.scopeType, programId: values.programId,
              validFrom: values.validFrom, validUntil: values.validUntil, assignmentRef: values.assignmentRef,
              nominalLimit: values.nominalLimit,
            }), "Perubahan mandat operasional tersimpan.")) setEditing(null);
          }} /> : <>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200/60 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="rounded-lg bg-emerald-100/90 p-1.5 text-[#1b765e]">
                  <Award className="h-4 w-4" />
                </div>
                <h4 className="font-semibold text-base text-[#17332c]">{OPERATIONAL_FUNCTION_LABELS[mandate.function]?.label ?? mandate.function}</h4>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-stone-600 pl-0.5">
                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>Penerima:</span>
                <span className="font-bold text-stone-800">{officers.data?.find(o => o.id === mandate.officerId)?.displayName ?? mandate.officerId}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                mandate.isActive
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200/80"
                  : "bg-amber-50 text-amber-800 border-amber-200"
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${mandate.isActive ? "bg-emerald-600" : "bg-amber-500"}`} />
                {mandate.isActive ? "Aktif" : "Dicabut"}
              </span>
              <Button size="sm" variant="outline" disabled={state.busy} onClick={() => setEditing(mandate)}>
                <Pencil className="mr-1 h-3 w-3 text-stone-500" />
                Ubah
              </Button>
              <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void changeState(mandate)}>
                {mandate.isActive ? (
                  <>
                    <XCircle className="mr-1 h-3 w-3 text-amber-600" />
                    Cabut
                  </>
                ) : (
                  <>
                    <RotateCcw className="mr-1 h-3 w-3 text-emerald-600" />
                    Aktifkan kembali
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-stone-200/80 bg-white p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#17332c]">
              <FileText className="h-4 w-4 text-[#1b765e]" />
              <span>SK: {mandate.assignmentRef} · {formatIdrAmount(mandate.nominalLimit)}</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-stone-100/90 px-2.5 py-1 text-xs font-medium text-stone-700 border border-stone-200/70">
              <Layers className="h-3.5 w-3.5 text-stone-500" />
              <span>{mandate.scopeType === "SPECIFIC_PROGRAM" ? `Program (${mandate.programId})` : "Semua program lembaga"}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-stone-500 pl-1">
            <Calendar className="h-3.5 w-3.5 text-stone-400" />
            <span>Masa berlaku:</span>
            <span className="font-medium text-stone-700">{formatTimestamp(mandate.validFrom)} – {formatTimestamp(mandate.validUntil)}</span>
          </div>
        </>}
      </div>
    ))}

    {mandates.data?.length === 0 && (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400">
          <Award className="h-6 w-6" />
        </div>
        <h4 className="mt-3 text-sm font-semibold text-stone-900">Belum ada mandat operasional.</h4>
        <p className="mt-1 text-xs text-stone-500">Terbitkan mandat untuk memberikan kewenangan kepada petugas.</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreating(true)}>
          <Award className="mr-1.5 h-3.5 w-3.5 text-stone-500" />
          Terbitkan Mandat Pertama
        </Button>
      </div>
    )}
  </AuthorityManagementFrame>;
}
