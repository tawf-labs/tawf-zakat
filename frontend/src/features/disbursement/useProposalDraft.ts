import { useEffect, useRef, useState } from "react";
import { WorkspaceRequestError, type PrivateRequests } from "../workspace/privateRequests";
import { saveProposalDraft, type ProposalDraft, type ProposalDraftInput, type ProposalTotals } from "./disbursementClient";

export type EditorNavigation = { dirty: boolean; pending: boolean };

/** One mounted editor owns one draft and retains an uncertain operation until replay succeeds. */
export function useProposalDraft(requests: PrivateRequests, initial: ProposalDraft, initialSummary: ProposalTotals | null,
  onSaved: (draft: ProposalDraft, summary: ProposalTotals) => void,
  onNavigationChange: (state: EditorNavigation) => void) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [summary, setSummary] = useState(initialSummary);
  const [saving, setSaving] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<ProposalDraftInput | null>(null);
  const inFlight = useRef(false);
  const dirty = draft.version === 0 || JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    onNavigationChange({ dirty, pending: saving || unknown });
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || saving || unknown) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving, unknown, onNavigationChange]);

  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    pending.current ??= {
      id: draft.id, expectedVersion: draft.version, operationId: crypto.randomUUID(),
      programId: draft.programId, originOfRequest: draft.originOfRequest, purpose: draft.purpose,
      aidPeriod: draft.aidPeriod, personInCharge: draft.personInCharge,
      beneficiaries: draft.beneficiaries, aidLines: draft.aidLines,
    };
    try {
      const result = await saveProposalDraft(requests, pending.current);
      requests.assertCurrent();
      pending.current = null;
      setUnknown(false);
      setDraft(result.draft);
      setSaved(result.draft);
      setSummary(result.summary);
      onSaved(result.draft, result.summary);
    } catch (error) {
      // A 4xx refusal is definitive. Transport/5xx failures may follow a committed write.
      const refused = error instanceof WorkspaceRequestError && error.status >= 400 && error.status < 500;
      if (refused) pending.current = null;
      setUnknown(!refused);
      setError(refused ? error.message : "Hasil penyimpanan belum diketahui. Coba lagi untuk memeriksa penyimpanan yang sama.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return { draft, setDraft, summary, dirty, saving, unknown, error, save };
}
