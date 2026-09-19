import { useEffect, useState } from "react";
import { AlertCircle, Plus, RefreshCw, Shield } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import {
  fetchPackageAuditFindings,
} from "./auditFindingClient";
import type { AuditFinding } from "../../../../shared/audit-findings";
import {
  FindingScopeBadge,
  FindingSeverityBadge,
  FindingStatusBadge,
} from "./AuditFindingBadge";
import { AuditFindingDetailModal } from "./AuditFindingDetailModal";
import { CreateAuditFindingModal } from "./CreateAuditFindingModal";

interface PackageAuditFindingsSectionProps {
  preparationId: string;
  packageId: string;
  requests: PrivateRequests;
}

export function PackageAuditFindingsSection({
  preparationId,
  packageId,
  requests,
}: PackageAuditFindingsSectionProps) {
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  async function loadFindings() {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchPackageAuditFindings(requests, preparationId, packageId);
      setFindings(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat temuan untuk paket ini.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFindings();
  }, [preparationId, packageId, requests]);

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-amber-600" />
          <h4 className="text-sm font-bold text-stone-900">
            Temuan Pemeriksaan & Tindak Lanjut ({findings.length})
          </h4>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateModalOpen(true)}
            className="text-xs"
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Catat Temuan Baru
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={loadFindings}
            disabled={loading}
            className="text-xs"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded bg-red-50 p-2.5 text-xs text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <p className="text-xs text-stone-500 py-2 text-center">Memuat temuan audit paket ini…</p>
      )}

      {!loading && findings.length === 0 && (
        <p className="text-xs text-stone-500 py-2 text-center">
          Belum ada temuan yang dicatat auditor untuk versi paket ini.
        </p>
      )}

      {!loading && findings.length > 0 && (
        <ul className="space-y-2">
          {findings.map((f) => (
            <li
              key={f.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white p-3 text-xs shadow-sm hover:border-stone-300 transition"
            >
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] text-stone-400">{f.id}</span>
                  <FindingStatusBadge status={f.status} />
                  <FindingSeverityBadge severity={f.severity} />
                  <FindingScopeBadge scope={f.scope} />
                </div>
                <div className="font-semibold text-stone-900 truncate">{f.title}</div>
                <div className="text-stone-500 text-[11px] truncate">
                  Oleh {f.auditorName} · {f.events?.length ?? 0} peristiwa
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedFindingId(f.id)}
                className="text-xs"
              >
                Detail
              </Button>
            </li>
          ))}
        </ul>
      )}

      {selectedFindingId && (
        <AuditFindingDetailModal
          findingId={selectedFindingId}
          requests={requests}
          onClose={() => setSelectedFindingId(null)}
          onUpdated={loadFindings}
        />
      )}

      {createModalOpen && (
        <CreateAuditFindingModal
          isOpen={createModalOpen}
          requests={requests}
          preparationId={preparationId}
          packageId={packageId}
          onClose={() => setCreateModalOpen(false)}
          onCreated={loadFindings}
        />
      )}
    </div>
  );
}
