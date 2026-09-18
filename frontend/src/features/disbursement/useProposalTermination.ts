import { useRef, useState } from "react";
import { useSignTypedData } from "wagmi";
import type { PrivateRequests } from "../workspace/privateRequests";
import { WorkspaceRequestError } from "../workspace/privateRequests";
import {
  cancelProposal,
  closeProposalRemainder,
  createCancelProposalChallenge,
  createCloseRemainderChallenge,
  readFileBase64,
  signableTypedData,
  uploadDecisionDocument,
  type ProposalClosureRecord,
  type ProposalDecision,
  type ProposalDraft,
  type ProposalTerminationDecision,
} from "./disbursementClient";

/**
 * Cancellation and remainder closure are two distinct decisions that travel the same road:
 * upload the SK, bind it into an EIP-712 challenge, sign, then submit. They share this hook
 * so neither can drift from the contract the server enforces.
 */
export type TerminationKind = "CANCEL" | "CLOSE_REMAINDER";

export type TerminationForm = {
  decisionReference: string;
  decisionDate: string;
  /** Required by the server for both kinds; never silently defaulted. */
  reason: string;
  notes: string;
  documentFile: File | null;
};

const COPY: Record<TerminationKind, { missingReference: string; missingReason: string; failed: string }> = {
  CANCEL: {
    missingReference: "Nomor SK pembatalan wajib diisi.",
    missingReason: "Alasan pembatalan wajib diisi.",
    failed: "Gagal membatalkan pengajuan.",
  },
  CLOSE_REMAINDER: {
    missingReference: "Nomor SK penutupan sisa wajib diisi.",
    missingReason: "Alasan penutupan sisa wajib diisi.",
    failed: "Gagal menutup sisa hak pengajuan.",
  },
};

export function useProposalTermination(
  kind: TerminationKind,
  requests: PrivateRequests,
  proposal: ProposalDraft,
  signerAccount: string,
  onTerminated: (draft: ProposalDraft, decision: ProposalDecision, closure: ProposalClosureRecord | null) => void
) {
  const [form, setForm] = useState<TerminationForm>({
    decisionReference: "",
    decisionDate: new Date().toISOString().slice(0, 10),
    reason: "",
    notes: "",
    documentFile: null,
  });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  // A signed submission is resent unchanged, with its operation id, until its outcome is known,
  // so an identical retry reads back the committed decision instead of making a second one.
  const pending = useRef<ProposalTerminationDecision | null>(null);
  const uploaded = useRef<{ file: File; id: string } | null>(null);
  const { signTypedDataAsync } = useSignTypedData();

  const copy = COPY[kind];

  async function send(input: ProposalTerminationDecision) {
    try {
      const result =
        kind === "CANCEL"
          ? { ...(await cancelProposal(requests, proposal.id, input)), closure: null }
          : await closeProposalRemainder(requests, proposal.id, input);
      requests.assertCurrent();
      pending.current = null;
      setUnknown(false);
      onTerminated(result.draft, result.decision, result.closure ?? null);
    } catch (failure) {
      const refused = failure instanceof WorkspaceRequestError && failure.status >= 400 && failure.status < 500;
      if (refused) pending.current = null;
      setUnknown(!refused);
      setError(
        refused
          ? failure.message
          : "Hasil keputusan belum diketahui. Periksa ulang untuk membaca hasil yang tersimpan sebelum menandatangani lagi."
      );
    }
  }

  async function submit() {
    if (processing) return;
    if (!form.decisionReference.trim()) return setError(copy.missingReference);
    if (!form.decisionDate) return setError("Tanggal penetapan SK wajib diisi.");
    if (!form.reason.trim()) return setError(copy.missingReason);
    if (!pending.current && !form.documentFile) return setError("Unggah berkas SK / berita acara keputusan.");
    if (!signerAccount) {
      return setError("Dompet belum terhubung. Hubungkan akun pengesah untuk menandatangani keputusan.");
    }

    setProcessing(true);
    setError(null);
    try {
      if (!pending.current) {
        const expectedVersion = proposal.version;
        const file = form.documentFile!;
        if (uploaded.current?.file !== file) {
          const document = await uploadDecisionDocument(requests, proposal.id, {
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            contentBase64: await readFileBase64(file),
            expectedVersion,
          });
          uploaded.current = { file, id: document.id };
        }

        const intent = {
          signerAccount,
          decisionReference: form.decisionReference.trim(),
          decisionDate: form.decisionDate,
          decisionDocumentId: uploaded.current.id,
          reason: form.reason.trim(),
          notes: form.notes.trim() || null,
          expectedVersion,
        };

        const createChallenge = kind === "CANCEL" ? createCancelProposalChallenge : createCloseRemainderChallenge;
        const { challenge, typedData } = await createChallenge(requests, proposal.id, intent);
        const signature = await signTypedDataAsync(signableTypedData(typedData) as never);

        pending.current = {
          ...intent,
          signerAccount: challenge.signerAccount,
          mandateId: challenge.mandateId,
          nonce: challenge.nonce,
          signature,
          operationId: crypto.randomUUID(),
        };
      }
      await send(pending.current);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : copy.failed);
    } finally {
      setProcessing(false);
    }
  }

  return {
    form,
    processing,
    error,
    unknown,
    submit,
    update: (patch: Partial<TerminationForm>) => setForm((prev) => ({ ...prev, ...patch })),
  };
}
