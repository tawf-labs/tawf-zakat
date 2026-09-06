import React from "react";
import { AlertTriangle } from "lucide-react";
import type { LedgerTextIssue } from "./ledgerText";

const PREVIEW_LIMIT = 6;

/** Unreadable rows, named by line so they can be fixed one at a time. */
export function LedgerIssueList({ issues }: { issues: LedgerTextIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" />
        {issues.length} baris belum terbaca
      </p>
      <ul className="mt-1.5 space-y-1 text-xs text-amber-900">
        {issues.slice(0, PREVIEW_LIMIT).map((issue) => (
          <li key={`${issue.line}-${issue.message}`}>{issue.message}</li>
        ))}
        {issues.length > PREVIEW_LIMIT && (
          <li>...dan {issues.length - PREVIEW_LIMIT} baris lainnya.</li>
        )}
      </ul>
    </div>
  );
}
