import { useState } from "react";
import { Plus, Trash2, Save, AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  emptyProposalDraft,
  newAidLine,
  newBeneficiary,
  saveProposalDraft,
  type AidLine,
  type Beneficiary,
  type Program,
  type ProposalDraft,
  type ProposalIssue,
  type ProposalTotals,
} from "./disbursementClient";

/**
 * The manual form for one Pengajuan draft (Spec #86, ticket #89).
 *
 * Susunan: Program dan tujuan; Penerima dan bantuan; Periksa dan ajukan
 * (submitting for review is the next slice, so this form only ever saves a
 * draft). Saving never refuses because the draft is incomplete - only the
 * issue list grows; that is the whole point of a draft.
 */

const issuesFor = (issues: ProposalIssue[], scope: ProposalIssue["scope"], rowIndex: number | null) =>
  issues.filter((issue) => issue.scope === scope && issue.rowIndex === rowIndex);

function IssueList({ issues }: { issues: ProposalIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-red-700">
      {issues.map((issue, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}

function BeneficiaryCard({
  beneficiary,
  index,
  issues,
  onChange,
  onRemove,
}: {
  beneficiary: Beneficiary;
  index: number;
  issues: ProposalIssue[];
  onChange: (next: Beneficiary) => void;
  onRemove: () => void;
}) {
  const rowIssues = issuesFor(issues, "recipient", index);
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-stone-900">Penerima {index + 1}</h4>
        <button type="button" onClick={onRemove} className="text-stone-400 hover:text-red-600" aria-label="Hapus penerima">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-stone-600">
          Nama
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={beneficiary.name}
            onChange={(e) => onChange({ ...beneficiary, name: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Asnaf
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={beneficiary.asnaf}
            onChange={(e) => onChange({ ...beneficiary, asnaf: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
          Alamat/cakupan
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={beneficiary.addressOrScope}
            onChange={(e) => onChange({ ...beneficiary, addressOrScope: e.target.value })}
          />
        </label>

        <label className="flex items-center gap-2 text-xs font-medium text-stone-600 sm:col-span-2">
          <input
            type="checkbox"
            checked={beneficiary.identityBasis.kind === "ALTERNATIVE"}
            onChange={(e) =>
              onChange({
                ...beneficiary,
                identityBasis: e.target.checked
                  ? { kind: "ALTERNATIVE", description: "" }
                  : { kind: "NIK", value: "" },
              })
            }
          />
          Tanpa NIK (anak/wali atau identitas alternatif)
        </label>

        {beneficiary.identityBasis.kind === "NIK" ? (
          <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
            NIK (16 digit)
            <input
              className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
              value={beneficiary.identityBasis.value}
              maxLength={16}
              onChange={(e) => onChange({ ...beneficiary, identityBasis: { kind: "NIK", value: e.target.value } })}
            />
          </label>
        ) : (
          <>
            <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
              Dasar identitas alternatif
              <input
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                placeholder="mis. Surat keterangan RT, belum memiliki KTP"
                value={beneficiary.identityBasis.description}
                onChange={(e) =>
                  onChange({ ...beneficiary, identityBasis: { kind: "ALTERNATIVE", description: e.target.value } })
                }
              />
            </label>
            <label className="block text-xs font-medium text-stone-600">
              Nama wali/perwakilan
              <input
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                value={beneficiary.guardian?.name ?? ""}
                onChange={(e) =>
                  onChange({ ...beneficiary, guardian: { name: e.target.value, relationship: beneficiary.guardian?.relationship ?? "" } })
                }
              />
            </label>
            <label className="block text-xs font-medium text-stone-600">
              Hubungan
              <input
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                value={beneficiary.guardian?.relationship ?? ""}
                onChange={(e) =>
                  onChange({ ...beneficiary, guardian: { name: beneficiary.guardian?.name ?? "", relationship: e.target.value } })
                }
              />
            </label>
          </>
        )}

        <label className="flex items-center gap-2 text-xs font-medium text-stone-600 sm:col-span-2">
          <input
            type="checkbox"
            checked={beneficiary.paymentRecipient !== null}
            onChange={(e) =>
              onChange({ ...beneficiary, paymentRecipient: e.target.checked ? { name: "", relation: "" } : null })
            }
          />
          Penerima pembayaran berbeda dari penerima manfaat (mis. sekolah/penyedia)
        </label>
        {beneficiary.paymentRecipient && (
          <>
            <label className="block text-xs font-medium text-stone-600">
              Nama penerima pembayaran
              <input
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                value={beneficiary.paymentRecipient.name}
                onChange={(e) =>
                  onChange({ ...beneficiary, paymentRecipient: { name: e.target.value, relation: beneficiary.paymentRecipient?.relation ?? "" } })
                }
              />
            </label>
            <label className="block text-xs font-medium text-stone-600">
              Hubungan dengan penerima manfaat
              <input
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                value={beneficiary.paymentRecipient.relation}
                onChange={(e) =>
                  onChange({ ...beneficiary, paymentRecipient: { name: beneficiary.paymentRecipient?.name ?? "", relation: e.target.value } })
                }
              />
            </label>
          </>
        )}
      </div>

      <IssueList issues={rowIssues} />
    </article>
  );
}

function AidLineRow({
  line,
  index,
  beneficiaries,
  issues,
  onChange,
  onRemove,
}: {
  line: AidLine;
  index: number;
  beneficiaries: Beneficiary[];
  issues: ProposalIssue[];
  onChange: (next: AidLine) => void;
  onRemove: () => void;
}) {
  const rowIssues = issuesFor(issues, "aidLine", index);
  return (
    <div className="rounded-lg border border-stone-200 p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
        <select
          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs sm:col-span-1"
          value={line.beneficiaryId}
          onChange={(e) => onChange({ ...line, beneficiaryId: e.target.value })}
        >
          <option value="">Pilih penerima…</option>
          {beneficiaries.map((b, i) => (
            <option key={b.id || i} value={b.id}>
              {b.name || `Penerima ${i + 1}`}
            </option>
          ))}
        </select>
        <input
          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
          placeholder="Jenis bantuan"
          value={line.aidType}
          onChange={(e) => onChange({ ...line, aidType: e.target.value })}
        />
        <input
          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
          placeholder="Periode (mis. 2026-Q1)"
          value={line.period}
          onChange={(e) => onChange({ ...line, period: e.target.value })}
        />
        <select
          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
          value={line.value.kind}
          onChange={(e) =>
            onChange({
              ...line,
              value:
                e.target.value === "GOODS"
                  ? { kind: "GOODS", unit: "", quantityRequested: "", quantityApproved: null, valuedAmountIdr: null }
                  : { kind: "MONEY", amountRequestedIdr: "", amountApprovedIdr: null },
            })
          }
        >
          <option value="MONEY">Uang (IDR)</option>
          <option value="GOODS">Barang</option>
        </select>
        <button type="button" onClick={onRemove} className="text-stone-400 hover:text-red-600" aria-label="Hapus rincian">
          <Trash2 className="mx-auto h-4 w-4" />
        </button>
      </div>

      {line.value.kind === "MONEY" ? (
        <input
          className="mt-2 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
          placeholder="Jumlah rupiah (bulat, tanpa titik/koma)"
          value={line.value.amountRequestedIdr}
          onChange={(e) => onChange({ ...line, value: { ...line.value, kind: "MONEY", amountRequestedIdr: e.target.value } as AidLine["value"] })}
        />
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
            placeholder="Jumlah"
            value={line.value.quantityRequested}
            onChange={(e) => onChange({ ...line, value: { ...line.value, kind: "GOODS", quantityRequested: e.target.value } as AidLine["value"] })}
          />
          <input
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
            placeholder="Satuan (mis. kg beras)"
            value={line.value.unit}
            onChange={(e) => onChange({ ...line, value: { ...line.value, kind: "GOODS", unit: e.target.value } as AidLine["value"] })}
          />
          <input
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
            placeholder="Nilai IDR (opsional)"
            value={line.value.valuedAmountIdr ?? ""}
            onChange={(e) =>
              onChange({ ...line, value: { ...line.value, kind: "GOODS", valuedAmountIdr: e.target.value || null } as AidLine["value"] })
            }
          />
        </div>
      )}
      <IssueList issues={rowIssues} />
    </div>
  );
}

export function ProposalDraftForm({
  requests,
  program,
  initial,
  onSaved,
}: {
  requests: PrivateRequests;
  program: Program;
  initial: ProposalDraft | null;
  onSaved: (draft: ProposalDraft, summary: ProposalTotals) => void;
}) {
  const [draft, setDraft] = useState<ProposalDraft>(initial ?? emptyProposalDraft(program));
  const [summary, setSummary] = useState<ProposalTotals | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const proposalIssues = issuesFor(draft.issues, "proposal", null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { draft: saved, summary: nextSummary } = await saveProposalDraft(requests, {
        id: draft.id || undefined,
        expectedVersion: draft.version || undefined,
        programId: program.id,
        originOfRequest: draft.originOfRequest,
        purpose: draft.purpose,
        aidPeriod: draft.aidPeriod,
        personInCharge: draft.personInCharge,
        beneficiaries: draft.beneficiaries,
        aidLines: draft.aidLines,
      });
      setDraft(saved);
      setSummary(nextSummary);
      onSaved(saved, nextSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draf gagal disimpan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            draft.version === 0
              ? "border border-amber-300 bg-amber-100 text-amber-900"
              : "border border-emerald-300 bg-emerald-100 text-emerald-850"
          }`}
        >
          {draft.version === 0 ? "Belum tersimpan" : `Draf server · versi ${draft.version}`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-stone-600">
          Asal permohonan
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.originOfRequest}
            onChange={(e) => setDraft({ ...draft, originOfRequest: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Penanggung jawab pengajuan
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.personInCharge}
            onChange={(e) => setDraft({ ...draft, personInCharge: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600 sm:col-span-2">
          Tujuan pengajuan
          <input
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.purpose}
            onChange={(e) => setDraft({ ...draft, purpose: e.target.value })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Periode bantuan mulai
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.aidPeriod?.start ?? ""}
            onChange={(e) => setDraft({ ...draft, aidPeriod: { start: e.target.value, end: draft.aidPeriod?.end ?? "" } })}
          />
        </label>
        <label className="block text-xs font-medium text-stone-600">
          Periode bantuan selesai
          <input
            type="date"
            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            value={draft.aidPeriod?.end ?? ""}
            onChange={(e) => setDraft({ ...draft, aidPeriod: { start: draft.aidPeriod?.start ?? "", end: e.target.value } })}
          />
        </label>
      </div>
      <IssueList issues={proposalIssues} />

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">
            Penerima ({draft.beneficiaries.length}) dan rincian bantuan ({draft.aidLines.length})
          </h3>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDraft({ ...draft, beneficiaries: [...draft.beneficiaries, newBeneficiary()] })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Tambah penerima
          </Button>
        </div>

        <div className="mt-3 space-y-3">
          {draft.beneficiaries.map((b, i) => (
            <BeneficiaryCard
              key={i}
              beneficiary={b}
              index={i}
              issues={draft.issues}
              onChange={(next) =>
                setDraft({ ...draft, beneficiaries: draft.beneficiaries.map((row, j) => (j === i ? next : row)) })
              }
              onRemove={() => setDraft({ ...draft, beneficiaries: draft.beneficiaries.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-900">Rincian bantuan</h3>
          <Button
            type="button"
            variant="outline"
            disabled={draft.beneficiaries.length === 0}
            onClick={() => setDraft({ ...draft, aidLines: [...draft.aidLines, newAidLine(draft.beneficiaries[0]?.id ?? "")] })}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Tambah rincian
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {draft.aidLines.map((line, i) => (
            <AidLineRow
              key={i}
              line={line}
              index={i}
              beneficiaries={draft.beneficiaries}
              issues={draft.issues}
              onChange={(next) => setDraft({ ...draft, aidLines: draft.aidLines.map((row, j) => (j === i ? next : row)) })}
              onRemove={() => setDraft({ ...draft, aidLines: draft.aidLines.filter((_, j) => j !== i) })}
            />
          ))}
        </div>
      </section>

      <section aria-label="Dokumen pengajuan" className="rounded-lg border border-dashed border-stone-300 bg-white p-3 text-xs text-stone-500">
        <h3 className="text-sm font-semibold text-stone-700">Dokumen pengajuan</h3>
        <p className="mt-1">
          Belum tersedia pada irisan ini. Lampiran dokumen pengajuan akan mengikuti akses dokumen
          terbatas yang sudah ada, pada irisan berikutnya.
        </p>
      </section>

      {summary && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <p>
            {summary.uniqueBeneficiaryCount} penerima unik · {summary.aidLineCount} baris bantuan
            {summary.isPartial ? " · sebagian nilai belum diketahui" : ""}
          </p>
          <ul className="mt-1 space-y-0.5">
            {Object.entries(summary.totalsByUnit).map(([unit, amount]) => (
              <li key={unit}>
                {unit}: {amount}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <Button type="button" disabled={saving} onClick={save}>
        <Save className="mr-2 h-4 w-4" /> {saving ? "Menyimpan…" : "Simpan draf"}
      </Button>
      <p className="text-xs text-stone-500">
        Draf boleh disimpan meski belum lengkap. Pengiriman untuk pemeriksaan disediakan pada irisan berikutnya.
      </p>
    </div>
  );
}
