import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, CheckCircle2, FileSignature, RotateCcw, Save, Undo2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  getInstitutionPolicy,
  submitProposalDraft,
  withdrawProposal,
  type DisbursementPolicy,
  type ProposalDecision,
  type ProposalDraft,
  type ProposalStatus,
  type ProposalTotals,
  type RecurringAidWarning,
} from "./disbursementClient";
import { ProposalDetails, ProposalSummary } from "./ProposalSections";
import { ProposalRoster } from "./ProposalRoster";
import { ProposalDocumentManager } from "./ProposalDocumentManager";
import { useProposalDraft, type EditorNavigation } from "./useProposalDraft";
import { BeneficiaryImportModal } from "./BeneficiaryImportModal";
import { BeneficiaryImportNotice } from "./BeneficiaryImportNotice";
import { ProposalBeneficiaryListModal } from "./ProposalBeneficiaryListModal";
import { useBeneficiaryImport } from "./useBeneficiaryImport";
import { ProposalDecisionModal } from "./ProposalDecisionModal";
import { ProposalDecisionBanner } from "./ProposalDecisionBanner";
import { ProposalRealizationBanner } from "./ProposalRealizationBanner";
import { RecurringAidWarnings, recurringFlags } from "./RecurringAidWarnings";
import { ProposalPublishControl } from "./ProposalPublishControl";
import { COST_STATUSES, OperationalCostsTab, useCostDrafts } from "./OperationalCostsTab";

const STATUS_BADGES: Record<ProposalStatus, { variant: "success" | "warning" | "danger" | "info" | "neutral"; label: string }> = {
  DRAFT: { variant: "neutral", label: "Draf Pengajuan" },
  SUBMITTED: { variant: "info", label: "Menunggu Pemeriksaan" },
  UNDER_EXAMINATION: { variant: "info", label: "Sedang Diperiksa" },
  REVISION_REQUIRED: { variant: "warning", label: "Perlu Revisi Amil" },
  READY_FOR_DECISION: { variant: "success", label: "Siap Diputus" },
  APPROVED: { variant: "success", label: "Disetujui Lembaga" },
  REJECTED: { variant: "danger", label: "Ditolak Lembaga" },
  WITHDRAWN: { variant: "neutral", label: "Ditarik" },
  CANCELLED: { variant: "neutral", label: "Dibatalkan" },
  REMAINDER_CLOSED: { variant: "neutral", label: "Sisa Ditutup" },
};

/** Says exactly where a locked proposal stands, instead of one message that fits several states. */
/** Roster rows added, removed or edited since the last save (recipients and aid lines together). */
function countChangedRows(saved: ProposalDraft, draft: ProposalDraft): number {
  const diff = (before: { id: string }[], after: { id: string }[]) => {
    const previous = new Map(before.map((row) => [row.id, row]));
    let count = 0;
    for (const row of after) {
      const old = previous.get(row.id);
      if (old !== row && JSON.stringify(old) !== JSON.stringify(row)) count++;
      previous.delete(row.id);
    }
    return count + previous.size;
  };
  return diff(saved.beneficiaries, draft.beneficiaries) + diff(saved.aidLines, draft.aidLines);
}

function readOnlyMessage(status: ProposalDraft["status"]): string {
  switch (status) {
    case "SUBMITTED": return "Pengajuan sudah diajukan dan menunggu pemeriksa memulai pemeriksaan.";
    case "UNDER_EXAMINATION": return "Pengajuan sedang diperiksa. Pemeriksa akan menyatakannya siap diputus atau mengembalikannya untuk revisi.";
    case "READY_FOR_DECISION": return "Pemeriksaan selesai. Pengajuan menunggu keputusan pengesah.";
    case "APPROVED": return "Pengajuan sudah disahkan. Langkah berikutnya: buat kegiatan penyaluran dari pengajuan ini.";
    case "REJECTED": return "Pengajuan ditolak dan tidak dapat diubah.";
    default: return "Pengajuan tidak dapat diubah pada status ini.";
  }
}

export function ProposalDraftForm({
  requests,
  initial,
  initialSummary,
  onSaved,
  onNavigationChange,
}: {
  requests: PrivateRequests;
  initial: ProposalDraft;
  initialSummary: ProposalTotals | null;
  onSaved: (draft: ProposalDraft, summary: ProposalTotals) => void;
  onNavigationChange: (state: EditorNavigation) => void;
}) {
  const editor = useProposalDraft(requests, initial, initialSummary, onSaved, onNavigationChange);
  const { draft, saved, setDraft, acceptSaved, dirty, saving, unknown, summary, error: saveError, save } = editor;

  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionIssues, setSubmissionIssues] = useState<{ field: string; message: string }[]>([]);
  const [recurringWarnings, setRecurringWarnings] = useState<RecurringAidWarning[]>([]);
  const [onlyRecurring, setOnlyRecurring] = useState(false);
  const costDrafts = useCostDrafts();
  const [costsFocus, setCostsFocus] = useState(0);
  const recurringRowFlags = useMemo(
    () => recurringFlags(recurringWarnings, (status) => STATUS_BADGES[status]?.label ?? status),
    [recurringWarnings],
  );

  // Withdrawal state
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);

  const [showDecisionModal, setShowDecisionModal] = useState(false);
  const [recordedDecision, setRecordedDecision] = useState<ProposalDecision | null>(null);
  const [showBeneficiaryList, setShowBeneficiaryList] = useState(false);

  // Which path a complete draft takes is the institution's policy: publish on its own
  // internal decision (ADR-0041), or submit for in-app examination and decision.
  // An unreadable policy falls back to submission, which is never the weaker control.
  const [policy, setPolicy] = useState<DisbursementPolicy | "unavailable" | null>(null);
  useEffect(() => {
    let current = true;
    getInstitutionPolicy(requests)
      .then((loaded) => { if (current) setPolicy(loaded); })
      .catch(() => { if (current) setPolicy("unavailable"); });
    return () => { current = false; };
  }, [requests]);
  const decidesOutsideApp = policy !== null && policy !== "unavailable" && policy.decisionOutsideApp;

  const isReadOnly =
    draft.status === "SUBMITTED" ||
    draft.status === "UNDER_EXAMINATION" ||
    draft.status === "READY_FOR_DECISION" ||
    draft.status === "APPROVED" ||
    draft.status === "REJECTED" ||
    draft.status === "WITHDRAWN" ||
    draft.status === "CANCELLED" ||
    draft.status === "REMAINDER_CLOSED";

  const rosterImport = useBeneficiaryImport({ requests, draft, setDraft, dirty, readOnly: isReadOnly });

  const handleSubmit = async () => {
    if (dirty) {
      setSubmissionError("Simpan draf terlebih dahulu sebelum mengajukan untuk pemeriksaan.");
      return;
    }

    setSubmitting(true);
    setSubmissionError(null);
    setSubmissionIssues([]);
    setRecurringWarnings([]);

    try {
      const res = await submitProposalDraft(
        requests,
        draft.id,
        draft.version,
        crypto.randomUUID()
      );
      acceptSaved(res.draft);
      if (res.warnings && res.warnings.length > 0) {
        setRecurringWarnings(res.warnings);
      }
      if (summary) {
        onSaved(res.draft, summary);
      }
    } catch (err: any) {
      setSubmissionError(err.message ?? "Gagal mengajukan draf untuk pemeriksaan.");
      if (Array.isArray(err.issues)) {
        setSubmissionIssues(err.issues);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    if (!withdrawReason.trim()) {
      setSubmissionError("Alasan penarikan pengajuan wajib diisi.");
      return;
    }

    setWithdrawing(true);
    setSubmissionError(null);
    try {
      const updated = await withdrawProposal(
        requests,
        draft.id,
        draft.version,
        crypto.randomUUID(),
        withdrawReason.trim()
      );
      acceptSaved(updated);
      setShowWithdrawDialog(false);
      setWithdrawReason("");
      if (summary) {
        onSaved(updated, summary);
      }
    } catch (err: any) {
      setSubmissionError(err.message ?? "Gagal menarik pengajuan.");
    } finally {
      setWithdrawing(false);
    }
  };

  const changedRows = dirty ? countChangedRows(saved, draft) : 0;
  const statusText = unknown
    ? "Hasil penyimpanan belum diketahui"
    : saving
    ? "Menyimpan…"
    : dirty
    ? `Belum tersimpan${changedRows ? ` · ${changedRows} baris berubah` : ""}${draft.version ? ` · berdasarkan versi ${draft.version}` : ""}`
    : `Draf tersimpan · versi ${draft.version}`;

  // Ctrl+S saves the draft. The deferred call lets an open grid cell commit (on blur) and
  // re-render first, so the save carries the value that was being typed.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (isReadOnly) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      setTimeout(() => saveRef.current(), 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isReadOnly]);

  const statusBadge = (
    <span
      role="status"
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
        dirty || unknown
          ? "bg-amber-100 text-amber-900"
          : "bg-emerald-100 text-emerald-900"
      }`}
    >
      {statusText}
    </span>
  );
  const saveButton = (
    <Button type="button" disabled={saving} onClick={save} className="mr-2" title="Simpan draf (Ctrl+S)">
      <Save className="mr-2 h-4 w-4" />{" "}
      {saving ? "Menyimpan…" : unknown ? "Periksa penyimpanan" : "Simpan draf"}
    </Button>
  );

  return (
    <div className="space-y-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
      {/* Header status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_BADGES[draft.status].variant}>{STATUS_BADGES[draft.status].label}</Badge>
          {statusBadge}
        </div>

        {/* Withdrawal action if in queue */}
        {(draft.status === "SUBMITTED" || draft.status === "UNDER_EXAMINATION") && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowWithdrawDialog(true)}
            className="text-stone-600 hover:text-stone-900"
          >
            <Undo2 className="h-3.5 w-3.5 mr-1.5" />
            Tarik Pengajuan
          </Button>
        )}
      </div>

      {/* Revision notice if returned */}
      {draft.status === "REVISION_REQUIRED" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 space-y-1">
          <p className="font-bold flex items-center gap-1.5 text-amber-950">
            <RotateCcw className="h-4 w-4 text-amber-700" />
            Pengajuan Dikembalikan untuk Revisi
          </p>
          <p className="mt-1">
            <strong>Catatan Pemeriksa:</strong>{" "}
            {draft.revisionReason || "Mohon periksa kembali kelengkapan dokumen atau rincian mustahik."}
          </p>
          <p className="text-[11px] text-amber-800 pt-1">
            Silakan perbaiki data atau lampiran di bawah, simpan draf (akan menaikkan versi pengajuan), lalu klik "Ajukan untuk Pemeriksaan" kembali.
          </p>
        </div>
      )}

      {/* Ready for decision banner */}
      {draft.status === "READY_FOR_DECISION" && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-900 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold flex items-center gap-1.5 text-emerald-950 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              Pengajuan Telah Memenuhi Syarat & Siap Diputus
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => setShowDecisionModal(true)}
              className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5"
            >
              <FileSignature className="h-3.5 w-3.5" />
              Tinjau & Putuskan
            </Button>
          </div>
          {draft.examinationNotes && (
            <p className="mt-1">
              <strong>Catatan Pemeriksa:</strong> {draft.examinationNotes}
            </p>
          )}
        </div>
      )}

      <ProposalDecisionBanner requests={requests} draft={draft} recorded={recordedDecision} />
      <ProposalRealizationBanner requests={requests} draft={draft} onDraftUpdated={setDraft}
        onOpenCosts={() => setCostsFocus((n) => n + 1)} />

      <RecurringAidWarnings
        warnings={recurringWarnings}
        statusLabel={(status) => STATUS_BADGES[status]?.label ?? status}
        onShowInTable={() => {
          setOnlyRecurring(true);
          document.getElementById("proposal-roster")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />

      {/* Form fields */}
      <fieldset disabled={saving || unknown || isReadOnly} className="min-w-0 space-y-4">
        <legend className="sr-only">Pengajuan penyaluran</legend>
        <ProposalDetails draft={draft} setDraft={setDraft} />
      </fieldset>
      {/* Outside the fieldset: a read-only roster must still be searchable, scrollable and copyable. */}
      <ProposalRoster
        draft={draft}
        setDraft={setDraft}
        readOnly={isReadOnly}
        locked={saving || unknown}
        onOpenImport={isReadOnly ? undefined : rosterImport.open}
        onExport={draft.version > 0 ? rosterImport.exportRoster : undefined}
        saveControl={isReadOnly ? undefined : <>{statusBadge}{saveButton}</>}
        recurring={recurringRowFlags.size > 0 ? { flags: recurringRowFlags, only: onlyRecurring, onOnlyChange: setOnlyRecurring } : undefined}
        costs={(COST_STATUSES as readonly string[]).includes(draft.status) ? {
          focus: costsFocus,
          render: (expanded) => <OperationalCostsTab requests={requests} proposalId={draft.id} expanded={expanded} drafts={costDrafts} />,
        } : undefined}
      />
      {!isReadOnly && draft.version > 0 && <Button type="button" variant="outline" disabled={dirty || saving || unknown} onClick={() => setShowBeneficiaryList(true)}>
        Perbarui daftar penerima dari berkas
      </Button>}
      <BeneficiaryImportNotice
        pendingSource={rosterImport.pendingSource}
        storedRoster={rosterImport.storedRoster}
        onReopen={rosterImport.reopenStored}
      />
      {rosterImport.error && <p role="alert" className="text-xs text-red-700">{rosterImport.error}</p>}

      {/* Proposal Document Manager */}
      {draft.version > 0 && <ProposalDocumentManager
        key={rosterImport.documentsRevision}
        requests={requests}
        proposalId={draft.id}
        beneficiaries={draft.beneficiaries}
        aidLines={draft.aidLines}
        readOnly={isReadOnly}
        proposalVersion={draft.version}
      />}

      {/* Totals & Issues */}
      {!dirty && !unknown && <ProposalSummary summary={summary} />}

      {/* Error messages */}
      {(saveError || submissionError) && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700 space-y-1">
          <p className="font-semibold">{saveError || submissionError}</p>
          {submissionIssues.length > 0 && (
            <ul className="list-disc pl-4 mt-1 space-y-0.5">
              {submissionIssues.map((issue, idx) => (
                <li key={idx}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Actions footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3">
        <div>
          {!isReadOnly && saveButton}
        </div>

        <div>
          {!isReadOnly && draft.version > 0 && decidesOutsideApp && (
            <ProposalPublishControl
              requests={requests}
              draft={draft}
              disabled={dirty || submitting}
              onPublished={(published, decision, warnings) => {
                setSubmissionError(null);
                setSubmissionIssues([]);
                acceptSaved(published);
                setRecordedDecision(decision);
                setRecurringWarnings(warnings);
                if (summary) onSaved(published, summary);
              }}
              onFailed={(message, issues) => {
                setSubmissionError(message);
                setSubmissionIssues(issues);
              }}
            />
          )}
          {!isReadOnly && draft.version > 0 && policy && !decidesOutsideApp && (
            <Button
              type="button"
              variant="primary"
              disabled={submitting || dirty}
              onClick={handleSubmit}
              title={dirty ? "Simpan draf terlebih dahulu sebelum mengajukan" : "Kirim pengajuan ke antrean pemeriksa"}
              className="bg-emerald-700 hover:bg-emerald-800 text-white inline-flex items-center gap-1.5"
            >
              <ArrowUpRight className="h-4 w-4" />
              {submitting ? "Memverifikasi & Mengajukan…" : "Ajukan untuk Pemeriksaan"}
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-stone-500">
        {!isReadOnly
          ? decidesOutsideApp
            ? "Draf dapat disimpan berkali-kali. Terbitkan setelah lembaga memutuskan lewat proses internalnya (mis. rapat pengurus); kelengkapan daftar penerima dan dokumen wajib diperiksa otomatis, lalu pengajuan langsung siap menerima donasi dan disalurkan."
            : "Draf dapat disimpan berkali-kali. Saat diajukan, kelengkapan administrasi dan dokumen wajib akan diverifikasi secara otomatis sebelum masuk antrean pemeriksaan."
          : readOnlyMessage(draft.status)}
      </p>

      {/* Withdrawal dialog */}
      {showWithdrawDialog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl space-y-3 text-xs">
            <h4 className="text-sm font-bold text-stone-900">Tarik Pengajuan Penyaluran</h4>
            <p className="text-stone-600">
              Pengajuan yang ditarik akan keluar dari antrean pemeriksaan. Masukkan alasan penarikan pengajuan:
            </p>
            <textarea
              value={withdrawReason}
              onChange={(e) => setWithdrawReason(e.target.value)}
              placeholder="Contoh: Pemohon membatalkan permohonan / data duplikat…"
              rows={3}
              className="w-full rounded-md border border-stone-300 p-2 text-xs text-stone-900"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={withdrawing}
                onClick={() => setShowWithdrawDialog(false)}
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={withdrawing || !withdrawReason.trim()}
                onClick={handleWithdraw}
              >
                {withdrawing ? "Menarik…" : "Konfirmasi Tarik"}
              </Button>
            </div>
          </div>
        </div>
      )}
      {showDecisionModal && (
        <ProposalDecisionModal
          requests={requests}
          proposalId={draft.id}
          isOpen={showDecisionModal}
          onClose={() => setShowDecisionModal(false)}
          onDecisionRecorded={(updatedDraft, rec) => {
            acceptSaved(updatedDraft);
            setRecordedDecision(rec);
            if (summary) onSaved(updatedDraft, summary);
          }}
        />
      )}
      {rosterImport.dialog && (
        <BeneficiaryImportModal
          requests={requests}
          context={rosterImport.context}
          initialPreview={rosterImport.dialog.initialPreview}
          onClose={rosterImport.close}
          onApply={rosterImport.apply}
        />
      )}
      {showBeneficiaryList && (
        <ProposalBeneficiaryListModal
          requests={requests}
          proposal={draft}
          isOpen={showBeneficiaryList}
          onClose={() => setShowBeneficiaryList(false)}
          onAppliedDraft={(updatedDraft) => {
            acceptSaved(updatedDraft);
            setShowBeneficiaryList(false);
          }}
          onAppliedRevision={(_revision, updatedDraft) => {
            acceptSaved(updatedDraft);
            setShowBeneficiaryList(false);
          }}
        />
      )}
    </div>
  );
}
