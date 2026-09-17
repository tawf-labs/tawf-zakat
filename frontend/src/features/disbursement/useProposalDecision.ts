import { useEffect, useRef, useState } from "react";
import { useSignTypedData } from "wagmi";
import type { PrivateRequests } from "../workspace/privateRequests";
import { WorkspaceRequestError } from "../workspace/privateRequests";
import {
  createProposalDecisionChallenge,
  getProposalDecisionReview,
  readFileBase64,
  signableTypedData,
  submitProposalDecision,
  uploadDecisionDocument,
  type DecisionReviewData,
  type ProposalDecision,
  type ProposalDecisionAction,
  type ProposalDecisionIntent,
  type ProposalDraft,
  type SubmitDecisionInput,
} from "./disbursementClient";

export type DecisionForm = {
  action: ProposalDecisionAction;
  decisionReference: string;
  decisionDate: string;
  notes: string;
  rejectionReason: string;
  signerAccount: string;
  /** The SK or berita acara file; its hash is what the signature binds. */
  documentFile: File | null;
  /** Approved amount or quantity per aid line id. */
  approved: Record<string, string>;
};

function intentOf(form: DecisionForm, draft: ProposalDraft, decisionDocumentId: string): ProposalDecisionIntent {
  const approve = form.action === "APPROVE";
  return {
    action: form.action,
    decisionReference: form.decisionReference.trim(),
    decisionDate: form.decisionDate,
    decisionDocumentId,
    notes: form.notes.trim() || null,
    rejectionReason: approve ? null : form.rejectionReason.trim(),
    approvedAidLines: approve
      ? draft.aidLines.map((line) =>
          line.value.kind === "MONEY"
            ? { id: line.id, amountApprovedIdr: form.approved[line.id] || line.value.amountRequestedIdr }
            : { id: line.id, quantityApproved: form.approved[line.id] || line.value.quantityRequested })
      : [],
  };
}

export function useProposalDecision(requests: PrivateRequests, proposalId: string,
  onRecorded: (draft: ProposalDraft, decision: ProposalDecision) => void) {
  const [review, setReview] = useState<DecisionReviewData | null>(null);
  const [form, setForm] = useState<DecisionForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  // A signed submission is resent unchanged, with its operation id, until its outcome is known.
  const pending = useRef<SubmitDecisionInput | null>(null);
  // The file already stored for this version, so a re-signature does not upload it again.
  const uploaded = useRef<{ file: File; id: string } | null>(null);
  const { signTypedDataAsync } = useSignTypedData();

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    getProposalDecisionReview(requests, proposalId)
      .then((data) => {
        if (!current) return;
        setReview(data);
        setForm({
          action: "APPROVE", decisionReference: "", decisionDate: new Date().toISOString().slice(0, 10),
          notes: "", rejectionReason: "", signerAccount: data.availableSigners.personal, documentFile: null,
          approved: Object.fromEntries(data.draft.aidLines.map((line) =>
            [line.id, line.value.kind === "MONEY" ? line.value.amountRequestedIdr : line.value.quantityRequested])),
        });
      })
      .catch((failure) => { if (current) setError(failure instanceof Error ? failure.message : "Telaah keputusan gagal dimuat."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [requests, proposalId]);

  async function send(input: SubmitDecisionInput) {
    try {
      const result = await submitProposalDecision(requests, proposalId, input);
      requests.assertCurrent();
      pending.current = null;
      setUnknown(false);
      onRecorded(result.draft, result.decision);
    } catch (failure) {
      const refused = failure instanceof WorkspaceRequestError && failure.status >= 400 && failure.status < 500;
      if (refused) pending.current = null;
      setUnknown(!refused);
      setError(refused ? failure.message
        : "Hasil pengesahan belum diketahui. Periksa ulang untuk membaca hasil yang tersimpan sebelum menandatangani lagi.");
    }
  }

  async function submit() {
    if (!review || !form || processing) return;
    if (!form.decisionReference.trim() || !form.decisionDate) {
      setError("Rujukan dan tanggal keputusan lembaga wajib diisi.");
      return;
    }
    if (!pending.current && !form.documentFile) {
      setError("Unggah berkas SK / berita acara keputusan.");
      return;
    }
    if (form.action === "REJECT" && !form.rejectionReason.trim()) {
      setError("Alasan penolakan pengajuan wajib diisi.");
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      if (!pending.current) {
        const expectedVersion = review.draft.version;
        const file = form.documentFile!;
        if (uploaded.current?.file !== file) {
          const document = await uploadDecisionDocument(requests, proposalId, { fileName: file.name,
            mimeType: file.type || "application/octet-stream", contentBase64: await readFileBase64(file), expectedVersion });
          uploaded.current = { file, id: document.id };
        }
        const intent = intentOf(form, review.draft, uploaded.current.id);
        const { challenge, typedData } = await createProposalDecisionChallenge(requests, proposalId,
          { ...intent, signerAccount: form.signerAccount, expectedVersion });
        const signature = await signTypedDataAsync(signableTypedData(typedData) as never);
        pending.current = { ...intent, signerAccount: challenge.signerAccount, mandateId: challenge.mandateId,
          nonce: challenge.nonce, signature, expectedVersion, operationId: crypto.randomUUID() };
      }
      await send(pending.current);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Tanda tangan pengesahan gagal diminta.");
    } finally {
      setProcessing(false);
    }
  }

  return {
    review, form, loading, processing, error, unknown, submit,
    update: (patch: Partial<DecisionForm>) => setForm((prev) => (prev ? { ...prev, ...patch } : prev)),
  };
}
