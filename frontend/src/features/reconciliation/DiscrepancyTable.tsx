import React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/Table";
import { Badge } from "../../components/ui/Badge";
import {
  bucketLabel,
  deltaDirection,
  DISCREPANCY_LABELS,
  formatMoney,
  formatSignedMoney,
} from "./format";
import type { WireDiscrepancy } from "./types";

const KIND_VARIANTS: Record<string, "warning" | "info" | "neutral" | "success"> = {
  AMOUNT_MISMATCH: "warning",
  MISSING_IN_CLAIM: "info",
  MISSING_IN_SOURCE: "info",
  BUCKET_TOTAL_MISMATCH: "warning",
  GRAND_TOTAL_MISMATCH: "warning",
  DUPLICATE_KEY: "neutral",
};

interface DiscrepancyTableProps {
  discrepancies: WireDiscrepancy[];
  claimLabel: string;
  sourceLabel: string;
  emptyMessage: string;
}

export function DiscrepancyTable({
  discrepancies,
  claimLabel,
  sourceLabel,
  emptyMessage,
}: DiscrepancyTableProps) {
  if (discrepancies.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-[#dbe7dd] bg-[#f9fbf9] px-4 py-6 text-center text-sm text-[#5e7a70]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pengelola Zakat</TableHead>
          <TableHead>Jenis dana</TableHead>
          <TableHead>Jenis selisih</TableHead>
          <TableHead className="text-right">{claimLabel}</TableHead>
          <TableHead className="text-right">{sourceLabel}</TableHead>
          <TableHead className="text-right">Selisih</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {discrepancies.map((discrepancy) => (
          <TableRow key={`${discrepancy.kind}-${discrepancy.key}-${discrepancy.bucket}`}>
            <TableCell>
              <span className="font-semibold text-[#17332c]">
                {discrepancy.label || discrepancy.key}
              </span>
              <span className="mt-0.5 block font-mono text-[11px] text-[#5e7a70]">
                {discrepancy.key}
              </span>
            </TableCell>
            <TableCell>
              <span className="text-[#17332c]">{bucketLabel(discrepancy.bucket)}</span>
            </TableCell>
            <TableCell>
              <Badge variant={KIND_VARIANTS[discrepancy.kind] ?? "neutral"}>
                {DISCREPANCY_LABELS[discrepancy.kind]}
              </Badge>
              <span className="mt-1 block text-[11px] text-[#5e7a70]">
                {deltaDirection(discrepancy.kind, discrepancy.delta.amount)}
              </span>
            </TableCell>
            <TableCell className="text-right font-mono text-[13px]">
              {discrepancy.claimValue ? formatMoney(discrepancy.claimValue) : "-"}
            </TableCell>
            <TableCell className="text-right font-mono text-[13px]">
              {discrepancy.sourceValue ? formatMoney(discrepancy.sourceValue) : "-"}
            </TableCell>
            <TableCell
              className={`text-right font-mono text-[13px] font-bold ${
                discrepancy.delta.amount.startsWith("-") ? "text-sky-700" : "text-amber-700"
              }`}
            >
              {formatSignedMoney(discrepancy.delta)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
