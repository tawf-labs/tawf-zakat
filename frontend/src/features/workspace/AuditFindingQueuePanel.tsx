import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Clock,
  FileSearch,
  Inbox,
  RefreshCw,
  Search,
  Shield,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import {
  fetchAuditQueues,
  type AuditFindingQueues,
} from "./auditFindingClient";
import type { AuditFinding } from "../../../../shared/audit-findings";
import {
  FindingScopeBadge,
  FindingSeverityBadge,
  FindingStatusBadge,
} from "./AuditFindingBadge";
import { AuditFindingDetailModal } from "./AuditFindingDetailModal";

interface AuditFindingQueuePanelProps {
  requests: PrivateRequests;
}

export function AuditFindingQueuePanel({ requests }: AuditFindingQueuePanelProps) {
  const [queues, setQueues] = useState<AuditFindingQueues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"amil" | "auditor">("amil");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);

  async function loadQueues() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAuditQueues(requests);
      setQueues(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat antrean temuan audit.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQueues();
  }, [requests]);

  const currentList = activeTab === "amil" ? queues?.amilActionQueue || [] : queues?.auditorReviewQueue || [];

  const filteredList = currentList.filter((f: AuditFinding) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      f.title.toLowerCase().includes(q) ||
      f.description.toLowerCase().includes(q) ||
      f.reportId.toLowerCase().includes(q) ||
      f.id.toLowerCase().includes(q)
    );
  });

  const amilCount = queues?.amilActionQueue.length || 0;
  const auditorCount = queues?.auditorReviewQueue.length || 0;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-bold text-stone-900">
            <FileSearch className="h-5 w-5 text-emerald-700" />
            Pemeriksaan & Tindak Lanjut Temuan Audit
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            Pengelolaan temuan auditor, tanggapan tim amil, dan penutupan pemeriksaan berjejak permanen (Issue #99).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadQueues} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Muat Ulang
          </Button>
        </div>
      </header>

      {/* Tabs / Queue Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("amil")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "amil"
                ? "border-emerald-600 text-emerald-800 bg-emerald-50/50"
                : "border-transparent text-stone-600 hover:text-stone-900 hover:bg-stone-50"
            }`}
          >
            <Clock className="h-4 w-4 text-emerald-600" />
            <span>Antrean Tindak Lanjut Amil</span>
            {amilCount > 0 && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                {amilCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("auditor")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === "auditor"
                ? "border-amber-600 text-amber-900 bg-amber-50/50"
                : "border-transparent text-stone-600 hover:text-stone-900 hover:bg-stone-50"
            }`}
          >
            <Shield className="h-4 w-4 text-amber-600" />
            <span>Antrean Tinjauan Auditor</span>
            {auditorCount > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                {auditorCount}
              </span>
            )}
          </button>
        </div>

        {/* Search bar */}
        <div className="relative pb-2 sm:pb-0">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-stone-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari temuan / laporan…"
            className="rounded-lg border border-stone-300 pl-8 pr-3 py-1.5 text-xs focus:border-emerald-500 focus:outline-none w-48 sm:w-60"
          />
        </div>
      </div>

      {/* Queue Description Info */}
      <div className="rounded-xl border border-stone-100 bg-stone-50 p-3 text-xs text-stone-600 flex items-start gap-2">
        {activeTab === "amil" ? (
          <>
            <Clock className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              <strong>Menunggu Tindak Lanjut Amil:</strong> Temuan yang baru dibuka oleh auditor (<code>OPEN</code>) atau temuan yang membutuhkan klarifikasi / perbaikan lanjutan (<code>DITINDAKLANJUTI</code>). Tim amil dapat memberikan penjelasan dan melampirkan berkas bukti.
            </span>
          </>
        ) : (
          <>
            <Shield className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>Menunggu Tinjauan Auditor:</strong> Temuan yang telah dijawab atau diklarifikasi oleh tim amil (<code>DITANGGAPI</code>). Hanya auditor berwenang yang dapat menindaklanjuti lebih lanjut atau menutup temuan (<code>DITUTUP_AUDITOR</code>).
            </span>
          </>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div role="alert" className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="py-12 text-center text-stone-500 space-y-2">
          <RefreshCw className="mx-auto h-6 w-6 animate-spin text-stone-400" />
          <p className="text-sm">Memuat antrean temuan audit…</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredList.length === 0 && (
        <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50/50 p-8 text-center space-y-2">
          <Inbox className="mx-auto h-10 w-10 text-stone-300" />
          <h4 className="text-sm font-semibold text-stone-700">
            {searchQuery ? "Tidak ada temuan yang cocok" : "Antrean ini bersih"}
          </h4>
          <p className="text-xs text-stone-500 max-w-md mx-auto">
            {searchQuery
              ? `Tidak ditemukan temuan dengan kata kunci "${searchQuery}". Coba kata kunci lain.`
              : activeTab === "amil"
              ? "Tidak ada temuan auditor yang membutuhkan tanggapan amil saat ini."
              : "Tidak ada tanggapan amil yang menunggu tinjauan atau penutupan auditor saat ini."}
          </p>
        </div>
      )}

      {/* Findings Cards List */}
      {!loading && filteredList.length > 0 && (
        <ul className="space-y-3">
          {filteredList.map((finding: AuditFinding) => {
            const events = finding.events ?? [];
            const lastEvent = events[events.length - 1];
            return (
              <li
                key={finding.id}
                className="group rounded-xl border border-stone-200 bg-white p-5 shadow-sm transition hover:border-stone-300 hover:shadow"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0 max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-stone-400">{finding.id}</span>
                      <FindingStatusBadge status={finding.status} />
                      <FindingSeverityBadge severity={finding.severity} />
                      <FindingScopeBadge scope={finding.scope} />
                    </div>

                    <h4 className="text-base font-bold text-stone-900 group-hover:text-emerald-800 transition">
                      {finding.title}
                    </h4>

                    <p className="text-xs text-stone-600 line-clamp-2">{finding.description}</p>

                    {/* Metadata bindings */}
                    <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-stone-500">
                      <span>
                        Laporan: <strong className="text-stone-800">{finding.reportId}</strong> (v{finding.version})
                      </span>
                      <span>·</span>
                      <span>
                        Pemeriksa: <strong className="text-stone-800">{finding.auditorName}</strong>
                      </span>
                      {lastEvent && (
                        <>
                          <span>·</span>
                          <span className="text-stone-400">
                            Aksi terakhir: {lastEvent.actorName} (
                            {new Date(lastEvent.createdAt * 1000).toLocaleDateString("id-ID")})
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <Button
                      size="sm"
                      onClick={() => setSelectedFindingId(finding.id)}
                      className="whitespace-nowrap"
                    >
                      Buka Detail
                      <ArrowRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                    <span className="text-[10px] text-stone-400 font-mono">
                      {events.length} riwayat peristiwa
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Detail Modal */}
      {selectedFindingId && (
        <AuditFindingDetailModal
          findingId={selectedFindingId}
          requests={requests}
          onClose={() => setSelectedFindingId(null)}
          onUpdated={() => {
            loadQueues();
          }}
        />
      )}
    </section>
  );
}
