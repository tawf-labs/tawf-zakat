import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { Program, ProposalDraftSummary } from "./disbursementClient";
import { FUND_TYPE_LABELS } from "./CreateProgramForm";
import { formatIdrAmount } from "../workspace/mandateLabels";
import type { ProposalStatus } from "./disbursementClient";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  DRAFT: "Draf, belum diajukan", SUBMITTED: "Diajukan", UNDER_EXAMINATION: "Sedang diperiksa", REVISION_REQUIRED: "Perlu revisi",
  READY_FOR_DECISION: "Menunggu keputusan", APPROVED: "Disahkan", REJECTED: "Ditolak", WITHDRAWN: "Ditarik",
  CANCELLED: "Dibatalkan", REMAINDER_CLOSED: "Sisa ditutup",
};

export function ProgramDetails({ program, onArchive }: { program: Program; onArchive: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
      <div>
        <p className="font-semibold text-stone-900">{program.name}</p>
        <p className="mt-1 text-xs text-stone-600">{FUND_TYPE_LABELS[program.fundType]} · {program.scope}</p>
        {program.referenceCeiling && <p className="mt-1 text-xs text-amber-800">
          Pagu referensi: {formatIdrAmount(program.referenceCeiling)} (acuan, bukan saldo bank terverifikasi)
        </p>}
      </div>
      <div className="flex items-center gap-2">
        <Badge>{program.status === "ACTIVE" ? "Aktif" : "Arsip"}</Badge>
        {program.status === "ACTIVE" && <Button type="button" variant="outline" onClick={onArchive}>Arsipkan</Button>}
      </div>
    </div>
  );
}

export function ProposalList({ drafts, onOpen, onNew }: {
  drafts: ProposalDraftSummary[]; onOpen: (id: string) => void; onNew: () => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-stone-900">Draf pengajuan ({drafts.length})</h4>
        <Button type="button" variant="outline" onClick={onNew}>Pengajuan baru</Button>
      </div>
      <ul className="mt-3 space-y-2">
        {drafts.map(draft => <li key={draft.id}>
          <button type="button" onClick={() => onOpen(draft.id)} className="flex min-h-11 w-full items-center justify-between rounded-lg border border-stone-200 bg-white px-3 py-2 text-left text-sm hover:border-emerald-300">
            <span className="min-w-0 truncate">{draft.purpose || "(tanpa tujuan)"} · {draft.originOfRequest || "(asal belum diisi)"}</span>
            <span className="ml-3 flex shrink-0 items-center gap-2 text-xs text-stone-500">
              <Badge>{PROPOSAL_STATUS_LABELS[draft.status] ?? draft.status}</Badge>
              {draft.beneficiaryCount} penerima{draft.issueCount > 0 ? ` · ${draft.issueCount} masalah` : ""}
              <span aria-hidden className="text-emerald-800">Buka ›</span>
            </span>
          </button>
        </li>)}
      </ul>
      {!drafts.length && <p className="text-xs text-stone-500">Belum ada draf pengajuan pada program ini.</p>}
      {drafts.length > 0 && <p className="mt-2 text-xs text-stone-500">Klik salah satu baris untuk membuka, melengkapi dokumen, dan mengajukannya.</p>}
    </section>
  );
}
