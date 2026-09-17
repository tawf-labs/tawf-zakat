import { useState } from "react";
import { CheckCircle2, Eye, Receipt, Search, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import {
  channelLabel,
  formatNominal,
  fundTypeLabel,
  type ContributionImportDraft,
  type ContributionRecord,
  type ContributionStatus,
  type CurrencyUnit,
} from "./contributionClient";
import { ContributionStatusBadge } from "./ContributionStatusBadge";

export type ContributionFilters = { status: ContributionStatus | "ALL"; currencyUnit: CurrencyUnit | "ALL" };

const sumOf = (records: ContributionRecord[], unit: CurrencyUnit) =>
  records
    .filter((c) => c.currencyUnit === unit && c.status !== "REJECTED")
    .reduce((total, c) => total + BigInt(c.amountExact || "0"), 0n)
    .toString();

export function ContributionSummary({
  contributions,
  drafts,
}: {
  contributions: ContributionRecord[];
  drafts: ContributionImportDraft[];
}) {
  const countOf = (status: ContributionStatus) => contributions.filter((c) => c.status === status).length;
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
        <span className="text-xs font-medium uppercase tracking-wider text-stone-500">Total Diterima (IDR)</span>
        <div className="mt-1 text-lg font-bold text-stone-900">{formatNominal(sumOf(contributions, "IDR"), "IDR")}</div>
        <span className="text-xs text-stone-500">Nominal pasti satuan rupiah</span>
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
        <span className="text-xs font-medium uppercase tracking-wider text-stone-500">Total Diterima (USDC)</span>
        <div className="mt-1 text-lg font-bold text-stone-900">
          {formatNominal(sumOf(contributions, "USDC_6DP"), "USDC_6DP")}
        </div>
        <span className="text-xs text-stone-500">Mata uang terpisah, tanpa konversi</span>
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
        <span className="text-xs font-medium uppercase tracking-wider text-stone-500">Status Siklus</span>
        <div className="mt-2 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800">
            {countOf("RECEIVED")} Baru
          </span>
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800">
            {countOf("RECONCILED")} Rekonsiliasi
          </span>
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800">
            {countOf("ENDORSED")} Disahkan
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
        <span className="text-xs font-medium uppercase tracking-wider text-stone-500">Draf Impor Tabular</span>
        <div className="mt-1 text-lg font-bold text-stone-900">{drafts.length} Draf</div>
        <span className="text-xs text-stone-500">Tidak mempengaruhi total penerimaan</span>
      </div>
    </div>
  );
}

export function ContributionList({
  contributions,
  filters,
  onFiltersChange,
  canManage,
  onOpen,
  onReconcile,
  onEndorse,
}: {
  contributions: ContributionRecord[];
  filters: ContributionFilters;
  onFiltersChange: (filters: ContributionFilters) => void;
  canManage: boolean;
  onOpen: (id: string) => void;
  onReconcile: (record: ContributionRecord) => void;
  onEndorse: (record: ContributionRecord) => void;
}) {
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const visible = q
    ? contributions.filter((c) =>
        [c.sourceReference, c.id, c.donorName ?? "", c.purpose].some((value) => value.toLowerCase().includes(q))
      )
    : contributions;

  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
            <input
              type="text"
              placeholder="Cari ref, donor, id..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-stone-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <select
            value={filters.status}
            onChange={(e) => onFiltersChange({ ...filters, status: e.target.value as ContributionFilters["status"] })}
            className="text-sm border border-stone-300 rounded-lg px-3 py-1.5 bg-white text-stone-700 focus:outline-none"
          >
            <option value="ALL">Semua Status</option>
            <option value="RECEIVED">Diterima (Baru)</option>
            <option value="RECONCILED">Terekonsiliasi</option>
            <option value="ENDORSED">Disahkan</option>
            <option value="REJECTED">Ditolak</option>
          </select>

          <select
            value={filters.currencyUnit}
            onChange={(e) =>
              onFiltersChange({ ...filters, currencyUnit: e.target.value as ContributionFilters["currencyUnit"] })
            }
            className="text-sm border border-stone-300 rounded-lg px-3 py-1.5 bg-white text-stone-700 focus:outline-none"
          >
            <option value="ALL">Semua Mata Uang</option>
            <option value="IDR">Rupiah (IDR)</option>
            <option value="USDC_6DP">USDC (6 DP)</option>
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-stone-300 rounded-xl bg-stone-50/50">
          <Receipt className="mx-auto h-8 w-8 text-stone-400" />
          <h4 className="mt-2 text-sm font-semibold text-stone-900">Belum ada kontribusi</h4>
          <p className="mt-1 text-xs text-stone-500">
            Penerimaan kontribusi dapat dicatat manual atau diimpor melalui berkas Excel / CSV.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200">
          <table className="w-full text-left text-sm text-stone-700">
            <thead className="bg-stone-50 text-xs font-semibold uppercase text-stone-500 border-b border-stone-200">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sumber & Referensi</th>
                <th className="px-4 py-3">Nominal Pasti</th>
                <th className="px-4 py-3">Jenis Dana</th>
                <th className="px-4 py-3">Donor</th>
                <th className="px-4 py-3">Waktu Terima</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {visible.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50/70 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="whitespace-nowrap">
                      <ContributionStatusBadge status={c.status} />
                    </div>
                    {c.unqualifiedReason && (
                      <div className="mt-1 max-w-[14rem] text-[11px] text-stone-500">{c.unqualifiedReason}</div>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="font-semibold text-stone-900 font-mono text-xs">{c.sourceReference}</div>
                    <div className="text-xs text-stone-500">{channelLabel(c.sourceChannel)}</div>
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap">
                    <span className="font-semibold text-stone-900">{formatNominal(c.amountExact, c.currencyUnit)}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-block text-xs bg-stone-100 text-stone-800 px-2 py-0.5 rounded">
                      {fundTypeLabel(c.fundType)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="text-xs font-medium text-stone-900">
                      {c.donorName || <span className="text-stone-400 italic">Hamba Allah</span>}
                    </div>
                    {c.donorContact && <div className="text-[11px] text-stone-500">{c.donorContact}</div>}
                  </td>
                  <td className="px-4 py-3.5 whitespace-nowrap text-xs text-stone-500">
                    {new Date(c.receivedAt * 1000).toLocaleString("id-ID")}
                  </td>
                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button variant="outline" size="sm" onClick={() => onOpen(c.id)} className="text-xs px-2.5 py-1">
                        <Eye className="w-3.5 h-3.5 mr-1" />
                        Detail
                      </Button>

                      {canManage && c.status === "RECEIVED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onReconcile(c)}
                          className="text-xs px-2.5 py-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          Rekonsiliasi
                        </Button>
                      )}

                      {canManage && c.status === "RECONCILED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onEndorse(c)}
                          className="text-xs px-2.5 py-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 mr-1" />
                          Sahkan
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
