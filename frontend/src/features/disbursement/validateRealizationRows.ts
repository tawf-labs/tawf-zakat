import { compareDecimalStrings } from "../../../../shared/exact-decimal";
import { formatIdrAmount } from "../workspace/mandateLabels";
import type { ProposalRealizationSummary } from "./disbursementClient";
import type { RealizationRow } from "./RealizationRecipientRows";

export function validateRealizationRows(rows: RealizationRow[], summary: ProposalRealizationSummary): string | null {
  const lineOf = (id: string) => summary.lines.find((line) => line.aidLineId === id);
  const chosen = new Set<string>();
  for (const row of rows) {
    const line = lineOf(row.aidLineId);
    if (!line) return "Pilih rincian bantuan untuk setiap baris.";
    if (chosen.has(row.aidLineId)) return `${line.beneficiaryName} dipilih lebih dari sekali.`;
    chosen.add(row.aidLineId);
    if (line.kind === "GOODS") {
      if (!row.quantity || !/^\d+(\.\d+)?$/.test(row.quantity.trim()) || compareDecimalStrings(row.quantity.trim(), "0") <= 0) {
        return `Jumlah barang untuk ${line.beneficiaryName} harus berupa angka lebih dari nol.`;
      }
      if (line.quantityRemaining && compareDecimalStrings(row.quantity.trim(), line.quantityRemaining) > 0) {
        return `Jumlah barang untuk ${line.beneficiaryName} melebihi sisa hak ${line.quantityRemaining} ${line.unit}.`;
      }
    } else {
      if (!/^\d+$/.test(row.amountIdr) || BigInt(row.amountIdr) <= 0n) return `Nominal untuk ${line.beneficiaryName} harus rupiah bulat lebih dari nol.`;
      if (BigInt(row.amountIdr) > BigInt(line.amountRemainingIdr ?? "0")) return `Nominal untuk ${line.beneficiaryName} melebihi sisa hak ${formatIdrAmount(line.amountRemainingIdr ?? "0")}.`;
    }
  }
  return null;
}
