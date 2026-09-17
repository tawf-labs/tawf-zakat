import { Trash2 } from "lucide-react";
import type { AidLine, Beneficiary, ProposalIssue } from "./disbursementClient";
import { issuesFor, IssueList } from "./ProposalIssues";

export function AidLineRow({
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
          aria-label={`Penerima rincian ${index + 1}`}
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
          aria-label={`Jenis bantuan ${index + 1}`}
          placeholder="Jenis bantuan"
          value={line.aidType}
          onChange={(e) => onChange({ ...line, aidType: e.target.value })}
        />
        <input
          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
          aria-label={`Periode rincian ${index + 1}`}
          placeholder="Periode (mis. 2026-Q1)"
          value={line.period}
          onChange={(e) => onChange({ ...line, period: e.target.value })}
        />
        <select
          className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
          aria-label={`Bentuk bantuan rincian ${index + 1}`}
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
        <button type="button" onClick={onRemove} className="min-h-11 min-w-11 rounded-lg text-stone-500 hover:text-red-600 focus-visible:outline-2" aria-label="Hapus rincian">
          <Trash2 className="mx-auto h-4 w-4" />
        </button>
      </div>

      {line.value.kind === "MONEY" ? (
        <input
          className="mt-2 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
          aria-label={`Jumlah rupiah ${index + 1}`}
          placeholder="Jumlah rupiah (bulat, tanpa titik/koma)"
          value={line.value.amountRequestedIdr}
          onChange={(e) => onChange({ ...line, value: { ...line.value, kind: "MONEY", amountRequestedIdr: e.target.value } as AidLine["value"] })}
        />
      ) : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
            aria-label={`Jumlah barang ${index + 1}`}
          placeholder="Jumlah"
            value={line.value.quantityRequested}
            onChange={(e) => onChange({ ...line, value: { ...line.value, kind: "GOODS", quantityRequested: e.target.value } as AidLine["value"] })}
          />
          <input
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
            aria-label={`Satuan barang ${index + 1}`}
          placeholder="Satuan (mis. kg beras)"
            value={line.value.unit}
            onChange={(e) => onChange({ ...line, value: { ...line.value, kind: "GOODS", unit: e.target.value } as AidLine["value"] })}
          />
          <input
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
            aria-label={`Nilai IDR barang ${index + 1}`}
          placeholder="Nilai IDR (opsional)"
            value={line.value.valuedAmountIdr ?? ""}
            onChange={(e) =>
              onChange({ ...line, value: { ...line.value, kind: "GOODS", valuedAmountIdr: e.target.value || null } as AidLine["value"] })
            }
          />
          <label className="text-xs sm:col-span-3">
            Dasar estimasi nilai barang (wajib jika nilai IDR diisi)
            <input className="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5"
              aria-label={`Dasar valuasi barang ${index + 1}`}
              placeholder="Sumber/rujukan dan perhitungan, mis. penawaran pemasok: 10 kg × Rp15.000"
              value={line.value.valuationBasis ?? ""}
              onChange={(e) => onChange({ ...line, value: { ...line.value, valuationBasis: e.target.value || null } as AidLine["value"] })} />
            Estimasi pengajuan; biaya aktual dicatat terpisah pada uang muka & biaya.
          </label>
        </div>
      )}
      <input
        className="mt-2 w-full rounded-lg border border-stone-300 px-2 py-1.5 text-xs"
        aria-label={`Referensi bukti ${index + 1}`}
        placeholder="Referensi bukti (catatan nomor surat; unggah dokumennya pada lampiran)"
        value={line.evidenceReference ?? ""}
        onChange={(e) => onChange({ ...line, evidenceReference: e.target.value || null })}
      />
      <IssueList issues={rowIssues} />
    </div>
  );
}

