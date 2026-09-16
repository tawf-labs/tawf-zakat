import { Trash2 } from "lucide-react";
import type { Beneficiary, ProposalIssue } from "./disbursementClient";
import { issuesFor, IssueList } from "./ProposalIssues";

export function BeneficiaryCard({
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
        <button type="button" onClick={onRemove} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-stone-500 hover:text-red-600 focus-visible:outline-2" aria-label="Hapus penerima">
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

        <PaymentRecipientFields beneficiary={beneficiary} onChange={onChange} />
      </div>

      <IssueList issues={rowIssues} />
    </article>
  );
}


function PaymentRecipientFields({ beneficiary, onChange }: { beneficiary: Beneficiary; onChange: (value: Beneficiary) => void }) {
  return <>
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
  </>;
}
