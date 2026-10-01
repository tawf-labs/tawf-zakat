import { useId, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { publishProposalDraft, type ProposalDecision, type ProposalDraft, type RecurringAidWarning } from "./disbursementClient";

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * Publishes a complete proposal straight to approved for an institution that decides
 * through its own internal process (ADR-0041). The amil cites that decision; nothing
 * is examined or signed in the app.
 */
export function ProposalPublishControl({ requests, draft, disabled, onPublished, onFailed }: {
  requests: PrivateRequests;
  draft: Pick<ProposalDraft, "id" | "version">;
  disabled: boolean;
  onPublished: (draft: ProposalDraft, decision: ProposalDecision, warnings: RecurringAidWarning[]) => void;
  onFailed: (message: string, issues: { field: string; message: string }[]) => void;
}) {
  const id = useId();
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(today);
  const [publishing, setPublishing] = useState(false);

  async function publish() {
    if (!reference.trim() || publishing) return;
    setPublishing(true);
    try {
      const res = await publishProposalDraft(requests, draft.id, {
        expectedVersion: draft.version, operationId: crypto.randomUUID(),
        decisionReference: reference.trim(), decisionDate: date,
      });
      onPublished(res.draft, res.decision, res.warnings ?? []);
    } catch (err: any) {
      onFailed(err?.message ?? "Gagal menerbitkan pengajuan.", Array.isArray(err?.issues) ? err.issues : []);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      <div>
        <label htmlFor={`${id}-reference`} className="block font-medium text-stone-700">Rujukan keputusan internal</label>
        <input
          id={`${id}-reference`}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="mis. Rapat pengurus 28 Sep 2026"
          maxLength={200}
          className="w-64 rounded-md border border-stone-300 p-2"
        />
      </div>
      <div>
        <label htmlFor={`${id}-date`} className="block font-medium text-stone-700">Tanggal keputusan</label>
        <input id={`${id}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)}
          className="rounded-md border border-stone-300 p-2" />
      </div>
      <Button
        type="button"
        variant="primary"
        disabled={disabled || publishing || !reference.trim() || !date}
        onClick={() => void publish()}
        title={disabled ? "Simpan draf terlebih dahulu sebelum menerbitkan" : "Terbitkan pengajuan agar siap menerima donasi dan disalurkan"}
        className="bg-emerald-700 hover:bg-emerald-800 text-white inline-flex items-center gap-1.5"
      >
        <Send className="h-4 w-4" />
        {publishing ? "Memeriksa kelengkapan & menerbitkan…" : "Terbitkan Pengajuan"}
      </Button>
    </div>
  );
}
