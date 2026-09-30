import { useMemo, useState } from "react";
import { AlertCircle, ChevronDown, Table2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { ProposalStatus, RecurringAidWarning } from "./disbursementClient";
import type { RowFlag } from "./SpreadsheetGrid";

type MatchedProposal = {
  proposalId: string;
  programName: string;
  period: string;
  status: ProposalStatus;
  names: string[];
};

/**
 * The server sends one warning per (recipient × earlier proposal) pair, so a
 * roster that overlaps a few earlier proposals yields hundreds of near-identical
 * sentences. What the officer needs is the matrix behind them: which earlier
 * proposals, and who in this one they share.
 */
export function groupRecurringWarnings(warnings: RecurringAidWarning[]): MatchedProposal[] {
  const groups = new Map<string, MatchedProposal & { seen: Set<string> }>();
  for (const w of warnings) {
    let group = groups.get(w.matchedProposalId);
    if (!group) {
      group = { proposalId: w.matchedProposalId, programName: w.matchedProgramName, period: w.matchedPeriod, status: w.matchedStatus, names: [], seen: new Set() };
      groups.set(w.matchedProposalId, group);
    }
    if (!group.seen.has(w.beneficiaryId)) {
      group.seen.add(w.beneficiaryId);
      group.names.push(w.beneficiaryName || "Tanpa nama");
    }
  }
  return [...groups.values()]
    .map(({ seen: _seen, ...group }) => group)
    .sort((a, b) => b.names.length - a.names.length);
}

/** Row markers for the recipient grid: "2×" plus the earlier proposals as a tooltip. */
export function recurringFlags(warnings: RecurringAidWarning[], statusLabel: (status: ProposalStatus) => string): Map<string, RowFlag> {
  // Keyed by earlier proposal so a repeated pair counts once.
  const lines = new Map<string, Map<string, string>>();
  for (const w of warnings) {
    const matched = lines.get(w.beneficiaryId) ?? new Map<string, string>();
    matched.set(w.matchedProposalId, `${w.matchedProgramName} · ${w.matchedPeriod} · ${statusLabel(w.matchedStatus)}`);
    lines.set(w.beneficiaryId, matched);
  }
  return new Map(
    [...lines].map(([id, matched]) => [id, { badge: `${matched.size}×`, detail: `Pernah menerima bantuan:\n${[...matched.values()].join("\n")}` }]),
  );
}

export function RecurringAidWarnings({ warnings, statusLabel, onShowInTable }: {
  warnings: RecurringAidWarning[];
  statusLabel: (status: ProposalStatus) => string;
  onShowInTable: () => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupRecurringWarnings(warnings), [warnings]);
  const recipients = useMemo(() => new Set(warnings.map((w) => w.beneficiaryId)).size, [warnings]);
  if (warnings.length === 0) return null;

  return (
    <section aria-label="Peringatan bantuan berulang" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-bold">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-700" />
          {recipients} penerima pernah menerima bantuan · {warnings.length} kecocokan dari {groups.length} pengajuan lain
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onShowInTable} className="text-xs">
            <Table2 className="mr-1.5 h-3.5 w-3.5" /> Lihat di tabel
          </Button>
          <Button type="button" variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="text-xs text-amber-900">
            Rincian <ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </div>
      </div>
      <p className="mt-1 text-amber-800">Periksa kesesuaian kebijakan bantuan berulang sebelum menyetujui.</p>
      {open && (
        <ul className="mt-2 max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {groups.map((group) => (
            <li key={group.proposalId}>
              <details className="rounded-lg border border-amber-200 bg-white/70 px-3 py-2">
                <summary className="cursor-pointer font-semibold">
                  {group.programName} · {group.period} · {statusLabel(group.status)} — {group.names.length} penerima
                </summary>
                <p className="mt-1.5 max-h-40 overflow-y-auto leading-relaxed text-amber-950">{group.names.join(", ")}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
