import { useEffect, useState } from "react";
import { Clock, FileCheck, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  listExaminerQueue,
  listRevisionQueue,
  type ProposalDraftSummary,
} from "./disbursementClient";
import { ProposalExaminationModal } from "./ProposalExaminationModal";

export function ExaminationQueuePanel({
  requests,
  onOpenDraft,
}: {
  requests: PrivateRequests;
  onOpenDraft?: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"examiner" | "revision">("examiner");
  const [examinerQueue, setExaminerQueue] = useState<ProposalDraftSummary[]>([]);
  const [revisionQueue, setRevisionQueue] = useState<ProposalDraftSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal examination state
  const [examiningProposalId, setExaminingProposalId] = useState<string | null>(null);

  const loadQueues = async () => {
    setLoading(true);
    setError(null);
    try {
      const [exList, revList] = await Promise.all([
        listExaminerQueue(requests),
        listRevisionQueue(requests),
      ]);
      setExaminerQueue(exList);
      setRevisionQueue(revList);
    } catch (e: any) {
      setError(e.message ?? "Gagal memuat antrean pemeriksaan.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueues();
  }, [requests]);

  const currentList = activeTab === "examiner" ? examinerQueue : revisionQueue;

  const formatDate = (epochSec?: number | null) => {
    if (!epochSec) return "—";
    return new Date(epochSec * 1000).toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  return (
    <div className="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-3">
        <div className="flex items-center gap-2">
          <FileCheck className="h-5 w-5 text-emerald-700" />
          <h3 className="text-sm font-bold text-stone-900">
            Antrean Pemeriksaan & Revisi Penyaluran
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={loadQueues}
            disabled={loading}
            className="h-8 text-xs text-stone-600"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Segarkan
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
          {error}
        </p>
      )}

      {/* Tabs */}
      <div className="flex border-b border-stone-200 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab("examiner")}
          className={`pb-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "examiner"
              ? "border-emerald-600 text-emerald-700 font-semibold"
              : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          <Clock className="h-3.5 w-3.5" />
          Antrean Pemeriksa
          <span className="ml-1 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">
            {examinerQueue.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("revision")}
          className={`pb-2.5 px-3 border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "revision"
              ? "border-amber-600 text-amber-700 font-semibold"
              : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Antrean Revisi Amil
          <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">
            {revisionQueue.length}
          </span>
        </button>
      </div>

      {/* List content */}
      {loading ? (
        <div className="py-8 text-center text-xs text-stone-500">Memuat antrean…</div>
      ) : currentList.length === 0 ? (
        <div className="py-8 text-center text-xs text-stone-500">
          {activeTab === "examiner"
            ? "Tidak ada pengajuan yang menunggu pemeriksaan saat ini."
            : "Tidak ada pengajuan yang dikembalikan untuk revisi."}
        </div>
      ) : (
        <div className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {currentList.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3.5 hover:bg-stone-50 text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-stone-900">
                    {item.purpose || "(Tanpa Tujuan)"}
                  </span>
                  <Badge
                    variant={
                      item.status === "SUBMITTED"
                        ? "info"
                        : item.status === "UNDER_EXAMINATION"
                        ? "warning"
                        : "danger"
                    }
                  >
                    {item.status === "SUBMITTED"
                      ? "Menunggu Pemeriksaan"
                      : item.status === "UNDER_EXAMINATION"
                      ? "Sedang Diperiksa"
                      : "Perlu Revisi"}
                  </Badge>
                  <span className="text-stone-400">· v{item.version}</span>
                </div>
                <p className="text-stone-500">
                  Asal: <strong>{item.originOfRequest || "—"}</strong> · {item.beneficiaryCount} penerima manfaat
                </p>
                <p className="text-[11px] text-stone-400">
                  Diajukan: {formatDate(item.submittedAt || item.updatedAt)}
                </p>
              </div>

              <div>
                {activeTab === "examiner" ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setExaminingProposalId(item.id)}
                    className="h-8 text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
                  >
                    <FileCheck className="h-3.5 w-3.5 mr-1.5" />
                    Periksa Kelayakan
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onOpenDraft?.(item.id)}
                    className="h-8 text-xs text-amber-800 border-amber-300 hover:bg-amber-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    Buka Draf Revisi
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Examination Modal */}
      {examiningProposalId && (
        <ProposalExaminationModal
          requests={requests}
          proposalId={examiningProposalId}
          isOpen={Boolean(examiningProposalId)}
          onClose={() => setExaminingProposalId(null)}
          onActionCompleted={loadQueues}
        />
      )}
    </div>
  );
}
