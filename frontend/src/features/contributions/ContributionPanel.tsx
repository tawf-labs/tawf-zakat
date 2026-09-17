import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Plus, Receipt, RefreshCw } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import {
  commitImportDraft,
  discardImportDraft,
  getContribution,
  getImportDraft,
  listContributions,
  listImportDrafts,
  type ContributionImportDraft,
  type ContributionRecord,
} from "./contributionClient";
import { errorMessage, useOperationIds } from "./contributionUi";
import { ContributionList, ContributionSummary, type ContributionFilters } from "./ContributionList";
import { ManualContributionForm } from "./ManualContributionForm";
import { TabularImportPanel } from "./TabularImportPanel";
import { ImportDraftList, ImportDraftModal, type OpenedDraft } from "./ImportDrafts";
import { ContributionDetailModal, type ContributionDetail } from "./ContributionDetailModal";
import { EndorseModal, ReconcileModal } from "./ContributionDecisionModals";
import { AllocationModal } from "./AllocationModal";

type Tab = "list" | "create" | "import" | "drafts";

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`pb-3 text-sm font-medium transition-colors border-b-2 flex items-center gap-1.5 ${
        active ? "border-emerald-600 text-emerald-700 font-semibold" : "border-transparent text-stone-500 hover:text-stone-800"
      }`}
    >
      {children}
    </button>
  );
}

export function ContributionPanel({ requests, canManage }: { requests: PrivateRequests; canManage: boolean }) {
  const [activeTab, setActiveTab] = useState<Tab>("list");
  const [contributions, setContributions] = useState<ContributionRecord[]>([]);
  const [drafts, setDrafts] = useState<ContributionImportDraft[]>([]);
  const [filters, setFilters] = useState<ContributionFilters>({ status: "ALL", currencyUnit: "ALL" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [detail, setDetail] = useState<ContributionDetail | null>(null);
  const [reconcileTarget, setReconcileTarget] = useState<ContributionRecord | null>(null);
  const [endorseTarget, setEndorseTarget] = useState<ContributionRecord | null>(null);
  const [allocatingContribution, setAllocatingContribution] = useState<ContributionRecord | null>(null);
  const [openedDraft, setOpenedDraft] = useState<OpenedDraft | null>(null);
  const operations = useOperationIds();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    // Loaded separately: an endorser may read contributions without the recording mandate
    // that import drafts require, and that refusal must not empty the contribution list.
    const [list, draftList] = await Promise.allSettled([
      listContributions(requests, {
        status: filters.status === "ALL" ? undefined : filters.status,
        currencyUnit: filters.currencyUnit === "ALL" ? undefined : filters.currencyUnit,
      }),
      listImportDrafts(requests),
    ]);
    if (list.status === "fulfilled") setContributions(list.value);
    else setError(errorMessage(list.reason, "Gagal memuat data kontribusi."));
    setDrafts(draftList.status === "fulfilled" ? draftList.value : []);
    setLoading(false);
  }, [requests, filters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openDetail = async (id: string) => {
    try {
      setError(null);
      const loaded = await getContribution(requests, id);
      setDetail({ record: loaded.contribution, history: loaded.history, documents: loaded.documents });
    } catch (e) {
      setError(errorMessage(e, "Gagal membuka detail kontribusi."));
    }
  };

  const decisionDone = (message: string, close: () => void) => async (updated: ContributionRecord) => {
    setSuccessMessage(message.replace("{id}", updated.id));
    close();
    await refresh();
    if (detail?.record.id === updated.id) await openDetail(updated.id);
  };

  const openDraft = async (id: string) => {
    setError(null);
    try {
      const loaded = await getImportDraft(requests, id);
      setOpenedDraft({ draft: loaded.draft, rows: loaded.rows });
    } catch (e) {
      setError(errorMessage(e, "Gagal membuka detail draf."));
    }
  };

  const commitDraft = async (draftId: string) => {
    if (!window.confirm("Komit baris yang valid menjadi kontribusi DITERIMA (RECEIVED)?")) return;
    setError(null);
    const intent = `commit:${draftId}`;
    try {
      const res = await commitImportDraft(requests, draftId, operations.operationFor(intent));
      operations.settle(intent);
      setSuccessMessage(
        `Berhasil mengimpor ${res.committedCount} kontribusi. (${res.ignoredInvalidRows} baris tidak valid diabaikan).`
      );
      if (openedDraft?.draft.id === draftId) setOpenedDraft(null);
      setActiveTab("list");
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Gagal mengomit draf impor."));
    }
  };

  const discardDraft = async (draftId: string) => {
    if (!window.confirm("Buang draf impor ini? Tindakan ini tidak dapat dibatalkan.")) return;
    setError(null);
    try {
      await discardImportDraft(requests, draftId);
      setSuccessMessage("Draf impor telah dibuang.");
      if (openedDraft?.draft.id === draftId) setOpenedDraft(null);
      await refresh();
    } catch (e) {
      setError(errorMessage(e, "Gagal membuang draf impor."));
    }
  };

  const draftActions = { canManage, onCommit: commitDraft, onDiscard: discardDraft };

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="h-6 w-6 text-emerald-700" />
            <h2 className="text-xl font-bold text-stone-900 tracking-tight">Penerimaan Kontribusi & Pengesahan Sumber</h2>
          </div>
          <p className="mt-1 text-sm text-stone-600">
            Pencatatan donasi di luar rantai (Transfer Bank, QRIS, dll.), rekonsiliasi rekening koran, dan pengesahan
            pejabat untuk inklusi batch laporan.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="flex items-center gap-1 text-stone-700">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          <span>Segarkan</span>
        </Button>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-bold ml-2" aria-label="Tutup">
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div role="status" className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />
          <div className="flex-1">{successMessage}</div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-500 hover:text-emerald-700 font-bold ml-2"
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
      )}

      <ContributionSummary contributions={contributions} drafts={drafts} />

      <div className="flex border-b border-stone-200 mt-6 gap-6">
        <TabButton active={activeTab === "list"} onClick={() => setActiveTab("list")}>
          Daftar Kontribusi ({contributions.length})
        </TabButton>
        {canManage && (
          <>
            <TabButton active={activeTab === "create"} onClick={() => setActiveTab("create")}>
              <Plus className="h-4 w-4" />
              <span>Catat Manual</span>
            </TabButton>
            <TabButton active={activeTab === "import"} onClick={() => setActiveTab("import")}>
              <FileSpreadsheet className="h-4 w-4" />
              <span>Impor Tabular (XLSX/CSV)</span>
            </TabButton>
          </>
        )}
        <TabButton active={activeTab === "drafts"} onClick={() => setActiveTab("drafts")}>
          Draf Impor ({drafts.length})
        </TabButton>
      </div>

      {activeTab === "list" && (
        <ContributionList
          contributions={contributions}
          filters={filters}
          onFiltersChange={setFilters}
          canManage={canManage}
          onOpen={openDetail}
          onReconcile={setReconcileTarget}
          onEndorse={setEndorseTarget}
          onAllocate={setAllocatingContribution}
        />
      )}

      {activeTab === "create" && (
        <ManualContributionForm
          requests={requests}
          onError={setError}
          onCancel={() => setActiveTab("list")}
          onRecorded={async (created) => {
            setSuccessMessage(`Kontribusi ${created.id} berhasil dicatat.`);
            setActiveTab("list");
            await refresh();
          }}
        />
      )}

      {activeTab === "import" && (
        <TabularImportPanel
          requests={requests}
          onError={setError}
          onDraftSaved={async () => {
            setSuccessMessage("Draf impor berhasil disimpan tanpa membuat dana penerimaan.");
            setActiveTab("drafts");
            await refresh();
          }}
        />
      )}

      {activeTab === "drafts" && <ImportDraftList drafts={drafts} onOpen={openDraft} {...draftActions} />}

      {detail && (
        <ContributionDetailModal
          requests={requests}
          detail={detail}
          canManage={canManage}
          onReload={() => openDetail(detail.record.id)}
          onClose={() => setDetail(null)}
          onError={setError}
        />
      )}

      {reconcileTarget && (
        <ReconcileModal
          requests={requests}
          target={reconcileTarget}
          onError={setError}
          onClose={() => setReconcileTarget(null)}
          onDone={decisionDone("Kontribusi {id} berhasil direkonsiliasi.", () => setReconcileTarget(null))}
        />
      )}

      {endorseTarget && (
        <EndorseModal
          requests={requests}
          target={endorseTarget}
          onError={setError}
          onClose={() => setEndorseTarget(null)}
          onDone={decisionDone("Kontribusi {id} berhasil disahkan oleh pejabat.", () => setEndorseTarget(null))}
        />
      )}

      {allocatingContribution && (
        <AllocationModal
          requests={requests}
          contribution={allocatingContribution}
          onClose={() => setAllocatingContribution(null)}
          onAllocated={async () => {
            setSuccessMessage(`Kontribusi ${allocatingContribution.id} berhasil dialokasikan.`);
            setAllocatingContribution(null);
            await refresh();
          }}
        />
      )}

      {openedDraft && <ImportDraftModal opened={openedDraft} onClose={() => setOpenedDraft(null)} {...draftActions} />}
    </div>
  );
}
