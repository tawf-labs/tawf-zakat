import { AlertTriangle } from "lucide-react";
import type { ProposalIssue } from "./disbursementClient";

export const issuesFor = (issues: ProposalIssue[], scope: ProposalIssue["scope"], rowIndex: number | null) =>
  issues.filter((issue) => issue.scope === scope && issue.rowIndex === rowIndex);

export function IssueList({ issues }: { issues: ProposalIssue[] }) {
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

