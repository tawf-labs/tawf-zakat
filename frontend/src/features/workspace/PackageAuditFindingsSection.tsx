import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { AccessContextChanged, type PrivateRequests } from "./privateRequests";
import { fetchPackageAuditFindings } from "./auditFindingClient";
import { FindingScopeBadge, FindingSeverityBadge, FindingStatusBadge } from "./AuditFindingBadge";
import { AuditFindingDetailModal } from "./AuditFindingDetailModal";
import { CreateAuditFindingModal } from "./CreateAuditFindingModal";
import type { AuditFindingView, AuditFindingViewerRole } from "../../../../shared/audit-findings";

type Props = {
  preparationId: string;
  packageId: string;
  packageDigest: string;
  reportId: string;
  reportVersion: string;
  requests: PrivateRequests;
  onStartCorrection?: (packageId: string) => void;
};

/** Findings recorded against one frozen version, as this reader may see them. */
export function PackageAuditFindingsSection({ preparationId, packageId, packageDigest, reportId, reportVersion, requests, onStartCorrection }: Props) {
  const [findings, setFindings] = useState<AuditFindingView[] | null>(null);
  const [viewer, setViewer] = useState<AuditFindingViewerRole>("STATUS_ONLY");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const result = await fetchPackageAuditFindings(requests, preparationId, packageId);
      setViewer(result.viewer);
      setFindings(result.findings);
    } catch (cause) {
      if (!(cause instanceof AccessContextChanged)) setError(cause instanceof Error ? cause.message : "Temuan versi ini belum dapat dibaca.");
    }
  }, [requests, preparationId, packageId]);
  useEffect(() => { void load(); }, [load]);

  return (
    <section aria-label={`Temuan pemeriksaan versi ${reportVersion}`} className="space-y-3 rounded-xl border border-stone-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900">Temuan pemeriksaan versi {reportVersion} ({findings?.length ?? "…"})</h4>
        <div className="flex gap-2">
          {viewer === "AUDITOR" && <Button size="sm" variant="outline" onClick={() => setCreating(true)}>Catat temuan</Button>}
          <Button size="sm" variant="outline" onClick={() => void load()}>Muat ulang</Button>
        </div>
      </div>
      {viewer === "STATUS_ONLY" && findings && findings.length > 0 && (
        <p className="text-xs text-stone-600">Anda melihat status temuan per versi. Uraian dan tanggapan hanya untuk pihak pemeriksaan.</p>
      )}
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700">
          <span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>Coba lagi</Button>
        </div>
      )}
      {findings?.length === 0 && <p className="text-xs text-stone-600">Belum ada temuan untuk versi ini. Tidak adanya temuan bukan opini audit.</p>}
      {findings && findings.length > 0 && (
        <ul className="space-y-2">
          {findings.map(f => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 p-3 text-xs">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <FindingStatusBadge status={f.status} /><FindingSeverityBadge severity={f.severity} /><FindingScopeBadge scope={f.scope} />
                </div>
                <p className="truncate font-semibold text-stone-900">{f.detail === "FULL" ? f.title : `Temuan ${f.id.slice(0, 11)}`}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setSelected(f.id)}>Buka</Button>
            </li>
          ))}
        </ul>
      )}
      {selected && <AuditFindingDetailModal findingId={selected} requests={requests} onClose={() => setSelected(null)} onUpdated={() => void load()}
        onStartCorrection={onStartCorrection && (id => { setSelected(null); onStartCorrection(id); })} />}
      {creating && <CreateAuditFindingModal requests={requests} preparationId={preparationId} packageId={packageId} packageDigest={packageDigest}
        reportId={reportId} reportVersion={reportVersion} onClose={() => setCreating(false)}
        onCreated={finding => { setCreating(false); void load(); setSelected(finding.id); }} />}
    </section>
  );
}
