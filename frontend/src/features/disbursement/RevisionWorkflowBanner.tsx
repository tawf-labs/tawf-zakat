import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Clock, Edit3, FileSignature, Loader2, RotateCcw, Send, Undo2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  listProposalRevisions,
  markRevisionReady,
  returnRevision,
  startRevisionExamination,
  withdrawRevision,
  type ProposalDraft,
  type ProposalRevisionRecord,
  type ProposalRevisionStatus,
} from "./disbursementClient";
import { RevisionDecisionModal } from "./RevisionDecisionModal";
import { RevisionDeltaReview } from "./RevisionDeltaReview";

const REVISION_STATUS_LABELS: Record<ProposalRevisionStatus, { label: string; tone: string }> = {
  SUBMITTED: { label: "Menunggu Pemeriksaan", tone: "bg-blue-100 text-blue-900 border-blue-200" },
  UNDER_EXAMINATION: { label: "Sedang Diperiksa", tone: "bg-indigo-100 text-indigo-900 border-indigo-200" },
  REVISION_REQUIRED: { label: "Perlu Perbaikan Amil", tone: "bg-amber-100 text-amber-900 border-amber-200" },
  READY_FOR_DECISION: { label: "Siap Diputus", tone: "bg-emerald-100 text-emerald-900 border-emerald-200" },
  APPROVED: { label: "Revisi Disetujui", tone: "bg-emerald-100 text-emerald-900 border-emerald-300" },
  REJECTED: { label: "Revisi Ditolak", tone: "bg-red-100 text-red-900 border-red-200" },
  WITHDRAWN: { label: "Revisi Ditarik", tone: "bg-stone-100 text-stone-700 border-stone-200" },
};

export function RevisionWorkflowBanner({
  requests,
  proposal,
  onDraftUpdated,
}: {
  requests: PrivateRequests;
  proposal: ProposalDraft;
  onDraftUpdated: (draft: ProposalDraft) => void;
}) {
  const [revisions, setRevisions] = useState<ProposalRevisionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Return revision modal state
  const [showReturnInput, setShowReturnInput] = useState(false);
  const [returnReason, setReturnReason] = useState("");

  // Ready modal state
  const [showReadyInput, setShowReadyInput] = useState(false);
  const [readyNotes, setReadyNotes] = useState("");
  const [readyChecks, setReadyChecks] = useState({ administrative: false, eligibility: false, alternativeId: false });

  // Withdraw input state
  const [showWithdrawInput, setShowWithdrawInput] = useState(false);
  const [withdrawReasonText, setWithdrawReasonText] = useState("");

  // Decision modal state
  const [showDecisionModal, setShowDecisionModal] = useState(false);

  useEffect(() => {
    let current = true;
    setLoading(true);
    listProposalRevisions(requests, proposal.id)
      .then((data) => {
        if (current) setRevisions(data);
      })
      .catch(() => {
        if (current) setRevisions([]);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [requests, proposal.id, proposal.activeRevisionId, proposal.version]);

  const activeRevision = revisions.find((r) => r.id === proposal.activeRevisionId) || revisions[0];

  if (loading || (!activeRevision && revisions.length === 0)) {
    return null;
  }

  const currentRev = activeRevision;
  const statusInfo = REVISION_STATUS_LABELS[currentRev.status] || {
    label: currentRev.status,
    tone: "bg-stone-100 text-stone-800 border-stone-200",
  };

  async function handleStartExam() {
    try {
      setActionLoading(true);
      setActionError(null);
      const updated = await startRevisionExamination(requests, proposal.id, currentRev.id, {
        operationId: crypto.randomUUID(),
      });
      setRevisions((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Gagal memulai pemeriksaan.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReturn() {
    if (!returnReason.trim()) {
      setActionError("Alasan pengembalian revisi wajib diisi.");
      return;
    }
    try {
      setActionLoading(true);
      setActionError(null);
      const updated = await returnRevision(requests, proposal.id, currentRev.id, {
        reason: returnReason.trim(),
        operationId: crypto.randomUUID(),
      });
      setRevisions((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setShowReturnInput(false);
      setReturnReason("");
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Gagal mengembalikan revisi.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReady() {
    try {
      setActionLoading(true);
      setActionError(null);
      const updated = await markRevisionReady(requests, proposal.id, currentRev.id, {
        notes: readyNotes.trim() || undefined,
        operationId: crypto.randomUUID(),
        // The revision goes through the same examination gate as the proposal it replaces.
        checklist: {
          administrativeChecksOk: readyChecks.administrative,
          eligibilityChecksOk: readyChecks.eligibility,
          alternativeIdReviewed: readyChecks.alternativeId,
          recurringAidExceptions: [],
          notes: readyNotes.trim(),
        },
      });
      setRevisions((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setShowReadyInput(false);
      setReadyNotes("");
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Gagal menandai siap diputus.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleWithdraw() {
    if (!withdrawReasonText.trim()) {
      setActionError("Alasan penarikan revisi wajib diisi.");
      return;
    }
    try {
      setActionLoading(true);
      setActionError(null);
      const result = await withdrawRevision(requests, proposal.id, currentRev.id, {
        reason: withdrawReasonText.trim(),
        operationId: crypto.randomUUID(),
      });
      setRevisions((prev) => prev.map((r) => (r.id === result.revision.id ? result.revision : r)));
      onDraftUpdated(result.draft);
      setShowWithdrawInput(false);
      setWithdrawReasonText("");
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Gagal menarik revisi.");
    } finally {
      setActionLoading(false);
    }
  }

  const isTerminal =
    currentRev.status === "APPROVED" ||
    currentRev.status === "REJECTED" ||
    currentRev.status === "WITHDRAWN";

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-xs text-stone-800 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Edit3 className="h-4 w-4 text-blue-700" />
          <h4 className="font-bold text-stone-900">
            Revisi Pengajuan #{currentRev.revisionNumber} (Target Versi {currentRev.toVersion})
          </h4>
          <span className={`rounded-full border px-2.5 py-0.5 font-semibold text-[11px] ${statusInfo.tone}`}>
            {statusInfo.label}
          </span>
        </div>

        <button
          type="button"
          className="flex items-center gap-1 font-semibold text-blue-800 hover:text-blue-900 text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Sembunyikan Rincian" : "Lihat Perubahan"}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <p className="text-stone-700">
        <span className="font-semibold">Alasan Revisi:</span> "{currentRev.reason}"
      </p>

      {expanded && (
        <div className="space-y-3 pt-2">
          <RevisionDeltaReview delta={currentRev.delta} />
        </div>
      )}

      {actionError && (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2 text-red-700 text-xs">
          {actionError}
        </p>
      )}

      {/* Action Dialogs inline */}
      {showReturnInput && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
          <label className="block font-semibold text-amber-950">Catatan Perbaikan untuk Amil *</label>
          <textarea
            rows={2}
            className="w-full rounded border border-amber-300 p-2 text-xs"
            placeholder="Jelaskan hal-hal yang perlu diperbaiki..."
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowReturnInput(false)}>Batal</Button>
            <Button size="sm" className="bg-amber-700 hover:bg-amber-800 text-white" disabled={actionLoading} onClick={() => void handleReturn()}>
              {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
              Kirim Perbaikan
            </Button>
          </div>
        </div>
      )}

      {showReadyInput && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 space-y-2">
          <p className="font-semibold text-emerald-950">Checklist Pemeriksaan Versi Revisi *</p>
          <label className="flex items-start gap-2 text-xs text-emerald-950">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={readyChecks.administrative}
              onChange={(e) => setReadyChecks((prev) => ({ ...prev, administrative: e.target.checked }))}
            />
            Pemeriksaan administrasi versi revisi lengkap dan sesuai.
          </label>
          <label className="flex items-start gap-2 text-xs text-emerald-950">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={readyChecks.eligibility}
              onChange={(e) => setReadyChecks((prev) => ({ ...prev, eligibility: e.target.checked }))}
            />
            Kelayakan asnaf dan kebutuhan pada versi revisi memenuhi syarat.
          </label>
          <label className="flex items-start gap-2 text-xs text-emerald-950">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={readyChecks.alternativeId}
              onChange={(e) => setReadyChecks((prev) => ({ ...prev, alternativeId: e.target.checked }))}
            />
            Identitas alternatif penerima yang berubah sudah ditelaah.
          </label>

          <label className="block font-semibold text-emerald-950">Catatan Telaah (Opsional)</label>
          <textarea
            rows={2}
            className="w-full rounded border border-emerald-300 p-2 text-xs"
            placeholder="Catatan telaah kelayakan perubahan..."
            value={readyNotes}
            onChange={(e) => setReadyNotes(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowReadyInput(false)}>Batal</Button>
            <Button
              size="sm"
              className="bg-emerald-700 hover:bg-emerald-800 text-white"
              disabled={actionLoading || !readyChecks.administrative || !readyChecks.eligibility}
              onClick={() => void handleReady()}
            >
              {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
              Nyatakan Siap Diputus
            </Button>
          </div>
        </div>
      )}

      {showWithdrawInput && (
        <div className="rounded-lg border border-stone-300 bg-stone-100 p-3 space-y-2">
          <label className="block font-semibold text-stone-900">Alasan Penarikan Revisi *</label>
          <textarea
            rows={2}
            className="w-full rounded border border-stone-300 p-2 text-xs"
            placeholder="Jelaskan alasan penarikan pengajuan revisi ini..."
            value={withdrawReasonText}
            onChange={(e) => setWithdrawReasonText(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowWithdrawInput(false)}>Batal</Button>
            <Button size="sm" className="bg-stone-700 hover:bg-stone-800 text-white" disabled={actionLoading} onClick={() => void handleWithdraw()}>
              {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5 mr-1" />}
              Tarik Revisi
            </Button>
          </div>
        </div>
      )}

      {/* Action Buttons Toolbar */}
      {!isTerminal && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(currentRev.status === "SUBMITTED" || currentRev.status === "REVISION_REQUIRED") && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={actionLoading}
                onClick={() => void handleStartExam()}
                className="gap-1.5"
              >
                <Clock className="h-3.5 w-3.5 text-indigo-600" /> Mulai Pemeriksaan
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={actionLoading}
                onClick={() => setShowWithdrawInput(true)}
                className="gap-1.5 text-stone-600"
              >
                <Undo2 className="h-3.5 w-3.5" /> Tarik Revisi
              </Button>
            </>
          )}

          {currentRev.status === "UNDER_EXAMINATION" && (
            <>
              <Button
                type="button"
                size="sm"
                className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5"
                disabled={actionLoading}
                onClick={() => setShowReadyInput(true)}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Siap Diputus
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={actionLoading}
                onClick={() => setShowReturnInput(true)}
                className="gap-1.5 text-amber-700 hover:text-amber-800"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Kembalikan untuk Perbaikan
              </Button>
            </>
          )}

          {currentRev.status === "READY_FOR_DECISION" && (
            <Button
              type="button"
              size="sm"
              className="bg-emerald-700 hover:bg-emerald-800 text-white gap-1.5"
              onClick={() => setShowDecisionModal(true)}
            >
              <FileSignature className="h-3.5 w-3.5" /> Putuskan Revisi Lembaga
            </Button>
          )}
        </div>
      )}

      <details className="rounded-lg border border-stone-200 p-3">
        <summary className="cursor-pointer font-semibold">
          Riwayat revisi pengajuan
        </summary>
        <ol aria-label="Riwayat revisi pengajuan" className="mt-3 space-y-3">
          {revisions.map((revision) => (
            <li
              key={revision.id}
              className="break-words border-t border-stone-200 pt-2"
            >
              <p>
                Versi {revision.fromVersion} → {revision.toVersion}:{" "}
                {REVISION_STATUS_LABELS[revision.status].label}
              </p>
              <p>{revision.reason}</p>
            </li>
          ))}
        </ol>
      </details>

      {showDecisionModal && (
        <RevisionDecisionModal
          requests={requests}
          proposal={proposal}
          revision={currentRev}
          isOpen
          onClose={() => setShowDecisionModal(false)}
          onDecided={(newDraft, decidedRev) => {
            setRevisions((prev) => prev.map((r) => (r.id === decidedRev.id ? decidedRev : r)));
            onDraftUpdated(newDraft);
          }}
        />
      )}
    </section>
  );
}
