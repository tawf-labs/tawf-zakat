import React from "react";
import { Download, FilterX } from "lucide-react";
import { bucketLabel, DISCREPANCY_LABELS } from "./format";
import { hasActiveFilters, type DiscrepancyFilters } from "./reconciliationTools";
import type { DiscrepancyKind } from "./types";

interface DiscrepancyFilterBarProps {
  buckets: string[];
  kinds: DiscrepancyKind[];
  filters: DiscrepancyFilters;
  onFiltersChange: (filters: DiscrepancyFilters) => void;
  shownCount: number;
  totalCount: number;
  onExport: () => void;
}

const chipClass = (active: boolean): string =>
  `cursor-pointer rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
    active
      ? "border-[#1b765e] bg-[#1b765e] text-white"
      : "border-[#dbe7dd] bg-white text-[#5e7a70] hover:border-[#1b765e]/50"
  }`;

export function DiscrepancyFilterBar({
  buckets,
  kinds,
  filters,
  onFiltersChange,
  shownCount,
  totalCount,
  onExport,
}: DiscrepancyFilterBarProps) {
  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  const isFiltered = hasActiveFilters(filters);

  return (
    <div className="space-y-3 rounded-2xl border border-[#dbe7dd] bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
          Jenis dana
        </span>
        {buckets.map((bucket) => (
          <button
            key={bucket}
            type="button"
            className={chipClass(filters.buckets.includes(bucket))}
            onClick={() => onFiltersChange({ ...filters, buckets: toggle(filters.buckets, bucket) })}
          >
            {bucketLabel(bucket)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
          Jenis selisih
        </span>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            className={chipClass(filters.kinds.includes(kind))}
            onClick={() => onFiltersChange({ ...filters, kinds: toggle(filters.kinds, kind) })}
          >
            {DISCREPANCY_LABELS[kind]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#dbe7dd] pt-3">
        <span className="text-xs text-[#5e7a70]">
          Menampilkan {shownCount} dari {totalCount} selisih.
        </span>
        <div className="flex items-center gap-2">
          {isFiltered && (
            <button
              type="button"
              onClick={() => onFiltersChange({ buckets: [], kinds: [] })}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#dbe7dd] px-3 py-1 text-[11px] font-semibold text-[#5e7a70] transition-colors hover:bg-[#f4f8f3]"
            >
              <FilterX className="h-3 w-3" />
              Bersihkan filter
            </button>
          )}
          <button
            type="button"
            onClick={onExport}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#1b765e] px-3 py-1 text-[11px] font-semibold text-[#1b765e] transition-colors hover:bg-[#f4f8f3]"
          >
            <Download className="h-3 w-3" />
            Unduh hasil
          </button>
        </div>
      </div>
    </div>
  );
}
