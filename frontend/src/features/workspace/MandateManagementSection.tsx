import { useEffect, useState, useRef } from "react";
import { ShieldCheck, Plus, RefreshCw, Trash2, Edit2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import {
  fetchMandates,
  grantMandate,
  updateMandate,
  revokeMandate,
  fetchOfficers,
  type OperationalMandate,
  type OperationalFunction,
  type MandateScopeType,
  type OfficerWithAccounts,
} from "./workspaceClient";
import {
  OPERATIONAL_FUNCTION_LABELS,
  SCOPE_TYPE_LABELS,
  formatIdrAmount,
  formatTimestamp,
} from "./mandateLabels";

interface MandateManagementSectionProps {
  requests: PrivateRequests;
}

const FUNCTIONS: OperationalFunction[] = [
  "MANAGE_PROGRAMS",
  "PREPARE_PROPOSALS",
  "EXAMINE_PROPOSALS",
  "APPROVE_DECISIONS",
  "RECORD_REALIZATION",
  "HANDLE_REPORT_EXAMINATION",
];

export function MandateManagementSection({ requests }: MandateManagementSectionProps) {
  const [mandates, setMandates] = useState<OperationalMandate[]>([]);
  const [officers, setOfficers] = useState<OfficerWithAccounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Granting form state
  const [creating, setCreating] = useState(false);
  const [officerId, setOfficerId] = useState("");
  const [fn, setFn] = useState<OperationalFunction>("PREPARE_PROPOSALS");
  const [scopeType, setScopeType] = useState<MandateScopeType>("ALL_PROGRAMS");
  const [programId, setProgramId] = useState("");
  const [assignmentRef, setAssignmentRef] = useState("");
  const [nominalLimit, setNominalLimit] = useState("");
  const [validDays, setValidDays] = useState("365");

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRef, setEditRef] = useState("");
  const [editLimit, setEditLimit] = useState("");
  const [editActive, setEditActive] = useState(true);

  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [mandateList, officerList] = await Promise.all([
        fetchMandates(requests),
        fetchOfficers(requests),
      ]);
      setMandates(mandateList);
      setOfficers(officerList);
      if (officerList.length > 0 && !officerId) {
        setOfficerId(officerList[0].id);
      }
    } catch (err: any) {
      setError(err?.message || "Gagal memuat daftar mandat operasional.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!officerId || !assignmentRef.trim()) return;

    setSubmitting(true);
    setError(null);
    setStatusMessage(null);

    const now = Math.floor(Date.now() / 1000);
    const days = parseInt(validDays, 10) || 365;
    const validUntil = now + days * 86400;

    try {
      await grantMandate(requests, {
        officerId,
        function: fn,
        scopeType,
        programId: scopeType === "SPECIFIC_PROGRAM" ? programId.trim() : null,
        validFrom: now,
        validUntil,
        assignmentRef: assignmentRef.trim(),
        nominalLimit: nominalLimit.trim() ? nominalLimit.trim() : null,
      });

      setStatusMessage("Mandat operasional berhasil diterbitkan.");
      setCreating(false);
      setAssignmentRef("");
      setNominalLimit("");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Gagal menerbitkan mandat operasional.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveEdit(id: string) {
    setSubmitting(true);
    setError(null);
    try {
      await updateMandate(requests, id, {
        assignmentRef: editRef.trim(),
        nominalLimit: editLimit.trim() ? editLimit.trim() : null,
        isActive: editActive,
      });
      setStatusMessage("Perubahan mandat operasional tersimpan.");
      setEditingId(null);
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Gagal memperbarui mandat.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm("Apakah Anda yakin ingin mencabut mandat operasional ini?")) return;
    setSubmitting(true);
    setError(null);
    try {
      await revokeMandate(requests, id);
      setStatusMessage("Mandat operasional telah dicabut.");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Gagal mencabut mandat.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs" aria-label="Manajemen Mandat Operasional">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <ShieldCheck className="h-5 w-5 text-[#1b765e]" />
            Pengelolaan Mandat Operasional Lembaga
          </h3>
          <p className="mt-0.5 text-xs text-stone-500">
            Pemberian, pembaruan, dan pencabutan mandat fungsi penyaluran kepada petugas lembaga (SK penugasan, batas nominal, cakupan).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            title="Muat ulang daftar mandat"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>

          <Button
            size="sm"
            onClick={() => setCreating(!creating)}
            disabled={officers.length === 0}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {creating ? "Batal" : "Terbitkan Mandat"}
          </Button>
        </div>
      </div>

      {statusMessage && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800 border border-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          {statusMessage}
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-800 border border-red-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
          {error}
        </div>
      )}

      {/* Granting Form */}
      {creating && (
        <form onSubmit={handleGrant} className="mt-4 rounded-xl border border-[#1b765e]/30 bg-[#f4f8f3]/60 p-4 space-y-4">
          <h4 className="text-sm font-semibold text-stone-900">Formulir Penerbitan Mandat Operasional</h4>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="mandate-officer" className="block text-xs font-medium text-stone-700">
                Pilih Petugas Penerima Mandat *
              </label>
              <select
                id="mandate-officer"
                value={officerId}
                onChange={(e) => setOfficerId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs"
                required
              >
                {officers.map((off) => (
                  <option key={off.id} value={off.id}>
                    {off.displayName} ({off.id}) {off.isActive ? "" : "[Nonaktif]"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="mandate-function" className="block text-xs font-medium text-stone-700">
                Fungsi Operasional *
              </label>
              <select
                id="mandate-function"
                value={fn}
                onChange={(e) => setFn(e.target.value as OperationalFunction)}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs"
                required
              >
                {FUNCTIONS.map((f) => (
                  <option key={f} value={f}>
                    {OPERATIONAL_FUNCTION_LABELS[f]?.label || f}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-stone-500">
                {OPERATIONAL_FUNCTION_LABELS[fn]?.description}
              </p>
            </div>

            <div>
              <label htmlFor="mandate-assignment-ref" className="block text-xs font-medium text-stone-700">
                Nomor SK / Surat Tugas *
              </label>
              <input
                id="mandate-assignment-ref"
                type="text"
                value={assignmentRef}
                onChange={(e) => setAssignmentRef(e.target.value)}
                placeholder="Contoh: SK/2026/PENYALURAN/014"
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs"
                required
              />
            </div>

            <div>
              <label htmlFor="mandate-nominal-limit" className="block text-xs font-medium text-stone-700">
                Batas Nominal Rupiah (Opsional)
              </label>
              <input
                id="mandate-nominal-limit"
                type="text"
                pattern="[0-9]*"
                value={nominalLimit}
                onChange={(e) => setNominalLimit(e.target.value.replace(/\D/g, ""))}
                placeholder="Kosongkan jika tanpa batas"
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs"
              />
              {nominalLimit && (
                <p className="mt-1 text-[11px] text-stone-600 font-medium">
                  {formatIdrAmount(nominalLimit)}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="mandate-scope-type" className="block text-xs font-medium text-stone-700">
                Cakupan Program
              </label>
              <select
                id="mandate-scope-type"
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value as MandateScopeType)}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs"
              >
                <option value="ALL_PROGRAMS">Semua Program Bantuan Lembaga</option>
                <option value="SPECIFIC_PROGRAM">Program Spesifik Tertentu</option>
              </select>
            </div>

            {scopeType === "SPECIFIC_PROGRAM" && (
              <div>
                <label htmlFor="mandate-program-id" className="block text-xs font-medium text-stone-700">
                  ID Program Bantuan *
                </label>
                <input
                  id="mandate-program-id"
                  type="text"
                  value={programId}
                  onChange={(e) => setProgramId(e.target.value)}
                  placeholder="UUID program bantuan"
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs"
                  required
                />
              </div>
            )}

            <div>
              <label htmlFor="mandate-valid-days" className="block text-xs font-medium text-stone-700">
                Masa Berlaku Mandat
              </label>
              <select
                id="mandate-valid-days"
                value={validDays}
                onChange={(e) => setValidDays(e.target.value)}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs"
              >
                <option value="30">30 Hari</option>
                <option value="90">90 Hari (1 Triwulan)</option>
                <option value="180">180 Hari (Semester)</option>
                <option value="365">1 Tahun (365 Hari)</option>
                <option value="730">2 Tahun</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button disabled={submitting || !assignmentRef.trim()} type="submit" size="sm">
              {submitting ? "Menerbitkan…" : "Terbitkan Mandat Sekarang"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setCreating(false)}
            >
              Batal
            </Button>
          </div>
        </form>
      )}

      {/* Mandate List Table */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-stone-200 text-stone-500">
              <th className="pb-2 font-medium">Petugas</th>
              <th className="pb-2 font-medium">Fungsi Operasional</th>
              <th className="pb-2 font-medium">Rujukan SK</th>
              <th className="pb-2 font-medium">Cakupan & Batas</th>
              <th className="pb-2 font-medium">Masa Berlaku</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium text-right">Tindakan</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {mandates.map((mandate) => {
              const officer = officers.find((o) => o.id === mandate.officerId);
              const isEditing = editingId === mandate.id;

              return (
                <tr key={mandate.id} className="hover:bg-stone-50/50">
                  <td className="py-3 pr-2">
                    <span className="font-semibold text-stone-900 block">
                      {officer?.displayName || mandate.officerId}
                    </span>
                    <span className="text-[10px] font-mono text-stone-400">{mandate.officerId}</span>
                  </td>

                  <td className="py-3 pr-2">
                    <span className="font-medium text-[#17332c] block">
                      {OPERATIONAL_FUNCTION_LABELS[mandate.function]?.label || mandate.function}
                    </span>
                    <span className="text-[10px] text-stone-500 font-mono">{mandate.function}</span>
                  </td>

                  <td className="py-3 pr-2">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editRef}
                        onChange={(e) => setEditRef(e.target.value)}
                        className="rounded border p-1 text-xs w-full"
                      />
                    ) : (
                      <span className="font-medium text-stone-800">{mandate.assignmentRef}</span>
                    )}
                  </td>

                  <td className="py-3 pr-2">
                    {isEditing ? (
                      <input
                        type="text"
                        placeholder="Limit (Rp)"
                        value={editLimit}
                        onChange={(e) => setEditLimit(e.target.value.replace(/\D/g, ""))}
                        className="rounded border p-1 text-xs w-full"
                      />
                    ) : (
                      <div>
                        <span className="block text-stone-700">
                          {mandate.scopeType === "SPECIFIC_PROGRAM"
                            ? `Program: ${mandate.programId?.slice(0, 8)}…`
                            : "Semua Program"}
                        </span>
                        <span className="text-[11px] text-stone-500">
                          {formatIdrAmount(mandate.nominalLimit)}
                        </span>
                      </div>
                    )}
                  </td>

                  <td className="py-3 pr-2 text-[11px] text-stone-600">
                    {formatTimestamp(mandate.validFrom)} – {formatTimestamp(mandate.validUntil)}
                  </td>

                  <td className="py-3 pr-2">
                    {isEditing ? (
                      <label className="flex items-center gap-1 text-[11px]">
                        <input
                          type="checkbox"
                          checked={editActive}
                          onChange={(e) => setEditActive(e.target.checked)}
                        />
                        Aktif
                      </label>
                    ) : (
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          mandate.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {mandate.isActive ? "Aktif" : "Dicabut"}
                      </span>
                    )}
                  </td>

                  <td className="py-3 text-right whitespace-nowrap">
                    {isEditing ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => handleSaveEdit(mandate.id)}
                          disabled={submitting}
                        >
                          Simpan
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setEditingId(null)}
                        >
                          Batal
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => {
                            setEditingId(mandate.id);
                            setEditRef(mandate.assignmentRef);
                            setEditLimit(mandate.nominalLimit || "");
                            setEditActive(mandate.isActive);
                          }}
                        >
                          <Edit2 className="h-3 w-3 mr-1" />
                          Ubah
                        </Button>
                        {mandate.isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[11px] text-red-600 hover:bg-red-50"
                            onClick={() => handleRevoke(mandate.id)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Cabut
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {mandates.length === 0 && !loading && (
          <p className="py-6 text-center text-xs text-stone-500">
            Belum ada mandat operasional yang diterbitkan untuk lembaga ini.
          </p>
        )}
      </div>
    </section>
  );
}
