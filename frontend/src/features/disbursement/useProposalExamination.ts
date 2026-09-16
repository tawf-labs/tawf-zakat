import { useEffect, useRef, useState } from "react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { WorkspaceRequestError } from "../workspace/privateRequests";
import { getProposalDraft, getProposalVersion, startProposalExamination, returnProposalForRevision,
  markProposalReady, type ExaminationChecklist, type ProposalDraft, type RecurringAidWarning } from "./disbursementClient";

type Action = { kind: "start" } | { kind: "return"; reason: string } | { kind: "ready"; checklist: ExaminationChecklist };
export function useProposalExamination(requests: PrivateRequests, proposalId: string, onCompleted: () => void, onClose: () => void) {
  const [draft, setDraft] = useState<ProposalDraft | null>(null);
  const [warnings, setWarnings] = useState<RecurringAidWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const pending = useRef<{ action: Action; id: string; version: number } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setDraft(null);
    setError(null);
    async function load() {
      try {
        const { draft: active } = await getProposalDraft(requests, proposalId);
        const frozen = await getProposalVersion(requests, proposalId, active.version);
        if (current) {
          setDraft({ ...active, ...frozen.data });
          setWarnings(frozen.recurringWarnings);
        }
      } catch (failure) {
        if (current) setError(failure instanceof Error ? failure.message : "Rincian pemeriksaan gagal dimuat.");
      } finally { if (current) setLoading(false); }
    }
    void load();
    return () => { current = false; };
  }, [requests, proposalId]);
  async function act(action: Action) {
    if (!draft || inFlight.current) return;
    pending.current ??= { action, id: crypto.randomUUID(), version: draft.version };
    const operation = pending.current;
    inFlight.current = true;
    setProcessing(true);
    setError(null);
    try {
      const args = [requests, proposalId, operation.version, operation.id] as const;
      const updated = operation.action.kind === "start" ? await startProposalExamination(...args)
        : operation.action.kind === "return" ? await returnProposalForRevision(...args, operation.action.reason)
        : await markProposalReady(...args, operation.action.checklist);
      requests.assertCurrent();
      pending.current = null;
      setUnknown(false);
      setDraft(updated);
      onCompleted();
      if (operation.action.kind !== "start") onClose();
    } catch (failure) {
      const refused = failure instanceof WorkspaceRequestError && failure.status >= 400 && failure.status < 500;
      if (refused) pending.current = null;
      setUnknown(!refused);
      setError(refused ? failure.message : "Hasil tindakan belum diketahui. Periksa ulang tindakan yang sama.");
    } finally {
      inFlight.current = false;
      setProcessing(false);
    }
  }
  return { draft, warnings, loading, processing, error, unknown, act,
    retry: () => { if (pending.current) void act(pending.current.action); } };
}
