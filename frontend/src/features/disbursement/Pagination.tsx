import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Shared paging for proposal lists that can be bulk-populated (CSV import,
 * bulk document matching) into the hundreds. Rendering every row/card at once
 * means hundreds of heavy form elements mounted together — a long scroll, and
 * for rows that each also render an O(n)-option picker, an O(n^2) blowup that
 * visibly freezes the page. Paging keeps one page's worth mounted at a time.
 */
export const LIST_PAGE_SIZE = 10;

export function usePage(itemCount: number, pageSize: number = LIST_PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(itemCount / pageSize));
  const clamped = Math.min(page, pageCount - 1);
  return { page: clamped, pageCount, setPage };
}

export function pageOf<T>(items: T[], page: number, pageSize: number = LIST_PAGE_SIZE): { item: T; index: number }[] {
  const start = page * pageSize;
  return items.slice(start, start + pageSize).map((item, j) => ({ item, index: start + j }));
}

export function Pager({ page, pageCount, onChange, label }: { page: number; pageCount: number; onChange: (page: number) => void; label: string }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 pt-1 text-xs text-stone-600">
      <span>{label}: halaman {page + 1} dari {pageCount}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
          aria-label="Halaman sebelumnya"
          className="rounded-lg border border-stone-300 p-1.5 disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={page >= pageCount - 1}
          onClick={() => onChange(page + 1)}
          aria-label="Halaman berikutnya"
          className="rounded-lg border border-stone-300 p-1.5 disabled:opacity-40"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
