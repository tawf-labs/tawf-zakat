import { compareDecimalStrings } from "../../../../shared/exact-decimal";
import { Plus, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "../../components/ui/Button";
import { formatIdrAmount } from "../workspace/mandateLabels";
import type { ProposalRealizationSummary } from "./disbursementClient";

export type RealizationRow = {
  key: string;
  aidLineId: string;
  amountIdr: string;
  quantity?: string;
  unit?: string;
};

export function RealizationRecipientRows({ id, rows, setRows, summary }: {
  id: string; rows: RealizationRow[]; setRows: Dispatch<SetStateAction<RealizationRow[]>>; summary: ProposalRealizationSummary;
}) {
  const open = summary.lines.filter((line) =>
    line.kind === "GOODS"
      ? (line.quantityRemaining != null && compareDecimalStrings(line.quantityRemaining, "0") > 0)
      : (BigInt(line.amountRemainingIdr ?? "0") > 0n)
  );
  const lineOf = (aidLineId: string) => summary.lines.find((line) => line.aidLineId === aidLineId);
  const updateRow = (key: string, patch: Partial<RealizationRow>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));

  return <div className="space-y-2">
    <p className="font-semibold">Penerima manfaat dan nominal / kuantitas</p>
    {rows.map((row, index) => {
      const line = lineOf(row.aidLineId);
      const isGoods = line?.kind === "GOODS";
      return (
        <div key={row.key} className="grid grid-cols-1 gap-2 rounded-lg border border-stone-200 p-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
          <label className="block text-xs font-semibold" htmlFor={`${id}-line-${row.key}`}>
            Rincian bantuan {rows.length > 1 ? index + 1 : ""}
            <select id={`${id}-line-${row.key}`} value={row.aidLineId} className="mt-1 w-full rounded-lg border border-stone-300 p-2 text-sm font-normal"
              onChange={(event) => {
                const selected = lineOf(event.target.value);
                if (selected?.kind === "GOODS") {
                  updateRow(row.key, {
                    aidLineId: event.target.value,
                    amountIdr: "",
                    quantity: selected.quantityRemaining ?? "",
                    unit: selected.unit ?? "",
                  });
                } else {
                  updateRow(row.key, {
                    aidLineId: event.target.value,
                    amountIdr: selected?.amountRemainingIdr ?? "",
                    quantity: "",
                    unit: "",
                  });
                }
              }}>
              {open.map((l) => (
                <option key={l.aidLineId} value={l.aidLineId}>
                  {l.beneficiaryName} · {l.aidType} · sisa {l.kind === "GOODS" ? `${l.quantityRemaining} ${l.unit}` : formatIdrAmount(l.amountRemainingIdr ?? "0")}
                </option>
              ))}
            </select>
          </label>
          {isGoods ? (
            <label className="block text-xs font-semibold" htmlFor={`${id}-qty-${row.key}`}>
              Jumlah ({line?.unit ?? "Satuan"})
              <input id={`${id}-qty-${row.key}`} inputMode="decimal" value={row.quantity ?? ""}
                className="mt-1 w-full rounded-lg border border-stone-300 p-2 font-mono text-sm font-normal"
                placeholder={line?.quantityRemaining ?? "0"}
                onChange={(event) => updateRow(row.key, { quantity: event.target.value.replace(/[^0-9.]/g, "") })} />
            </label>
          ) : (
            <label className="block text-xs font-semibold" htmlFor={`${id}-amount-${row.key}`}>
              Nominal (Rp)
              <input id={`${id}-amount-${row.key}`} inputMode="numeric" value={row.amountIdr}
                className="mt-1 w-full rounded-lg border border-stone-300 p-2 font-mono text-sm font-normal"
                onChange={(event) => updateRow(row.key, { amountIdr: event.target.value.replace(/\D/g, "") })} />
            </label>
          )}
          {rows.length > 1 && <Button type="button" variant="outline" size="sm" aria-label={`Hapus baris ${index + 1}`}
            onClick={() => setRows((current) => current.filter((other) => other.key !== row.key))}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      );
    })}
    {rows.length < open.length && <Button type="button" variant="outline" size="sm" className="flex items-center gap-1"
      onClick={() => {
        const next = open.find((line) => !rows.some((row) => row.aidLineId === line.aidLineId));
        if (next) {
          if (next.kind === "GOODS") {
            setRows((current) => [...current, { key: crypto.randomUUID(), aidLineId: next.aidLineId, amountIdr: "", quantity: next.quantityRemaining ?? "", unit: next.unit ?? "" }]);
          } else {
            setRows((current) => [...current, { key: crypto.randomUUID(), aidLineId: next.aidLineId, amountIdr: next.amountRemainingIdr ?? "" }]);
          }
        }
      }}><Plus className="h-4 w-4" /> Tambah penerima (penyerahan kelompok)</Button>}
    {rows.length > 1 && <p className="text-xs text-stone-600">Baris-baris ini dicatat sebagai satu kelompok penyerahan. Satu BAST kelompok kemudian dialokasikan ke setiap penerima.</p>}
  </div>;
}
