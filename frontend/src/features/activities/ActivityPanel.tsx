import { useCallback, useEffect, useState } from "react";
import { AlertCircle, FolderPlus, Layers, RefreshCw, Search } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { errorMessage } from "../contributions/contributionUi";
import { FUNDING_RECORD_DISCLAIMER, listActivities, type DistributionActivity } from "./activityClient";
import { ActivityTable } from "./ActivityTable";
import { ActivityDetailModal } from "./ActivityDetailModal";
import { CreateActivityModal } from "./CreateActivityModal";

export function ActivityPanel({ requests, canManage }: { requests: PrivateRequests; canManage: boolean }) {
  const [activities, setActivities] = useState<DistributionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setActivities(await listActivities(requests));
    } catch (err) {
      setError(errorMessage(err, "Gagal memuat kegiatan penyaluran."));
    } finally {
      setLoading(false);
    }
  }, [requests]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? activities.filter((a) => [a.name, a.id, a.proposalId, a.description ?? ""].some((f) => f.toLowerCase().includes(q)))
    : activities;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-stone-100 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-6 w-6 text-emerald-700" />
            <h2 className="text-lg font-bold text-stone-900">Kegiatan Penyaluran & Alokasi Kontribusi</h2>
          </div>
          <p className="mt-1 text-xs text-stone-600">
            Setiap kegiatan mengikuti satu versi pengajuan yang disahkan. Kontribusi yang disahkan lembaga dialokasikan
            secara eksplisit; sisa yang belum dialokasikan tetap terlihat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Muat Ulang
          </Button>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <FolderPlus className="h-4 w-4 mr-1.5" />
              Buat Kegiatan
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5 text-xs text-stone-600 flex items-start gap-2.5">
        <AlertCircle className="h-4 w-4 text-stone-500 shrink-0 mt-0.5" />
        <p className="text-[11px] leading-relaxed">
          {FUNDING_RECORD_DISCLAIMER} Sisa kontribusi yang belum dialokasikan tidak berpindah otomatis.
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-stone-400" />
        <input
          type="text"
          aria-label="Cari kegiatan"
          placeholder="Cari nama kegiatan, pengajuan, id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-1.5 text-sm border border-stone-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
        />
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {filtered.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-stone-300 rounded-xl bg-stone-50/50">
          <Layers className="mx-auto h-8 w-8 text-stone-400" />
          <h4 className="mt-2 text-sm font-semibold text-stone-900">Belum ada kegiatan penyaluran</h4>
          <p className="mt-1 text-xs text-stone-500 max-w-md mx-auto">
            Kegiatan dibuat dari pengajuan bantuan yang telah disahkan (APPROVED).
          </p>
        </div>
      ) : (
        <ActivityTable activities={filtered} onOpen={setOpenedId} />
      )}

      {creating && (
        <CreateActivityModal
          requests={requests}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void refresh();
          }}
        />
      )}
      {openedId && <ActivityDetailModal activityId={openedId} requests={requests} onClose={() => setOpenedId(null)} />}
    </div>
  );
}
