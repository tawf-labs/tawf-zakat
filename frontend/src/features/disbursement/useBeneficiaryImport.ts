import { useEffect, useRef, useState } from "react";
import { saveBlob } from "../../lib/download";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  exportProposalBeneficiaries,
  listProposalDocuments,
  previewStoredBeneficiaryImport,
  uploadProposalDocument,
  type BeneficiaryImportPreviewResult,
  type ProposalDocument,
  type ProposalDraft,
  type TabularFormat,
} from "./disbursementClient";
import type { ImportContext, RosterSource } from "./BeneficiaryImportModal";

type ImportDialog = { initialPreview: BeneficiaryImportPreviewResult | null };

/**
 * Wires the roster importer into one draft editor. An applied import only
 * changes the unsaved draft; its source file is stored as a private proposal
 * document once that draft is saved, so the rows it rejected stay reviewable.
 */
export function useBeneficiaryImport({ requests, draft, setDraft, dirty, readOnly }: {
  requests: PrivateRequests;
  draft: ProposalDraft;
  setDraft: (draft: ProposalDraft) => void;
  dirty: boolean;
  readOnly: boolean;
}) {
  const [dialog, setDialog] = useState<ImportDialog | null>(null);
  const [pendingSource, setPendingSource] = useState<RosterSource | null>(null);
  const [storedRoster, setStoredRoster] = useState<ProposalDocument | null>(null);
  const [documentsRevision, setDocumentsRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const uploading = useRef(false);
  const saved = draft.version > 0;

  useEffect(() => {
    if (!saved) return;
    let current = true;
    listProposalDocuments(requests, draft.id)
      .then((documents) => {
        if (current) setStoredRoster(documents.filter((doc) => doc.category === "BENEFICIARY_ROSTER").at(-1) ?? null);
      })
      .catch(() => { if (current) setStoredRoster(null); });
    return () => { current = false; };
  }, [requests, draft.id, saved, documentsRevision]);

  useEffect(() => {
    if (!pendingSource || dirty || !saved || readOnly || uploading.current) return;
    uploading.current = true;
    uploadProposalDocument(requests, draft.id, { category: "BENEFICIARY_ROSTER", ...pendingSource })
      .then(() => {
        setPendingSource(null);
        setDocumentsRevision((value) => value + 1);
      })
      .catch((failure) => setError(failure instanceof Error ? failure.message : "Berkas impor gagal disimpan."))
      .finally(() => { uploading.current = false; });
  }, [requests, draft.id, pendingSource, dirty, saved, readOnly]);

  const context: ImportContext = {
    proposalId: draft.id,
    programId: draft.programId,
    sharedAidPeriod: draft.aidPeriod?.start && draft.aidPeriod.end ? `${draft.aidPeriod.start} s/d ${draft.aidPeriod.end}` : null,
    currentBeneficiaryCount: draft.beneficiaries.length,
  };

  return {
    dialog,
    context,
    pendingSource,
    storedRoster,
    documentsRevision,
    error,
    open: () => { if (!readOnly) setDialog({ initialPreview: null }); },
    close: () => setDialog(null),
    apply(preview: BeneficiaryImportPreviewResult, source: RosterSource | null) {
      if (readOnly) return;
      setDraft({ ...draft, beneficiaries: preview.beneficiaries, aidLines: preview.aidLines });
      if (source) setPendingSource(source);
    },
    async reopenStored() {
      if (!storedRoster) return;
      setError(null);
      try {
        setDialog({ initialPreview: await previewStoredBeneficiaryImport(requests, draft.id, storedRoster.id) });
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Pratinjau berkas impor tersimpan gagal dibuka.");
      }
    },
    async exportRoster(format: TabularFormat) {
      setError(null);
      try {
        saveBlob(`proposal-${draft.id}-beneficiaries.${format}`, await exportProposalBeneficiaries(requests, draft.id, format));
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Gagal mengekspor daftar penerima.");
      }
    },
  };
}
