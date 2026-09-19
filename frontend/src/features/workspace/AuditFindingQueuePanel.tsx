import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { AccessContextChanged, type PrivateRequests } from "./privateRequests";
import { fetchAuditQueues } from "./auditFindingClient";
import { FindingScopeBadge, FindingSeverityBadge, FindingStatusBadge } from "./AuditFindingBadge";
import { AuditFindingDetailModal } from "./AuditFindingDetailModal";
import type { AuditFindingQueues, AuditFindingView } from "../../../../shared/audit-findings";

const QUEUES = {
  amil: {
    label: "Perlu tanggapan amil",
    empty: "Tidak ada temuan yang menunggu tanggapan amil.",
    explain: "Temuan baru, permintaan klarifikasi lanjutan, dan temuan yang menunggu versi koreksi laporan.",
  },
  auditor: {
    label: "Perlu ditelaah auditor",
    empty: "Tidak ada tanggapan yang menunggu telaah.",
    explain: "Tanggapan amil pada temuan yang ditugaskan kepada auditor. Hanya auditor tersebut yang menetapkan tindak lanjut atau menutupnya.",
  },
} as const;

/** Who has to act next, per queue. Readers outside the examination see statuses only. */
export function AuditFindingQueuePanel({ requests }: { requests: PrivateRequests }) {
  const [queues, setQueues] = useState<AuditFindingQueues | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<keyof typeof QUEUES>("amil");
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await fetchAuditQueues(requests);
      setQueues(next);
      setTab(current => (next.viewer === "AUDITOR" && current === "amil" && next.amilActionQueue.length === 0 ? "auditor" : current));
    } catch (cause) {
      if (!(cause instanceof AccessContextChanged)) setError(cause instanceof Error ? cause.message : "Antrean temuan belum dapat dibaca.");
    }
  }, [requests]);
  useEffect(() => { void load(); }, [load]);

  const list: AuditFindingView[] = queues ? (tab === "amil" ? queues.amilActionQueue : queues.auditorReviewQueue) : [];

  return (
    <section aria-labelledby="audit-queue-title" className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="audit-queue-title" className="text-base font-bold text-stone-900">Temuan pemeriksaan & tindak lanjut</h3>
          {queues?.viewer === "STATUS_ONLY" && <p className="text-xs text-stone-600">Anda melihat status. Uraian dan tanggapan hanya untuk pihak pemeriksaan.</p>}
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()}>Muat ulang</Button>
      </div>

      <div role="tablist" aria-label="Antrean temuan" className="flex flex-wrap gap-2 border-b border-stone-200">
        {(Object.keys(QUEUES) as (keyof typeof QUEUES)[]).map(key => {
          const count = queues ? (key === "amil" ? queues.amilActionQueue.length : queues.auditorReviewQueue.length) : 0;
          return (
            <button key={key} type="button" role="tab" id={`audit-tab-${key}`} aria-selected={tab === key} aria-controls="audit-queue-list"
              onClick={() => setTab(key)}
              className={`border-b-2 px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-emerald-600 ${tab === key ? "border-emerald-700 text-emerald-900" : "border-transparent text-stone-600"}`}>
              {QUEUES[key].label} ({count})
            </button>
          );
        })}
      </div>

      <div id="audit-queue-list" role="tabpanel" aria-labelledby={`audit-tab-${tab}`} className="space-y-3">
        <p className="text-xs text-stone-600">{QUEUES[tab].explain}</p>
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700">
            <span>{error}</span><Button size="sm" variant="outline" onClick={() => void load()}>Coba lagi</Button>
          </div>
        )}
        {!queues && !error && <p role="status" className="text-sm text-stone-600">Memuat antrean…</p>}
        {queues && list.length === 0 && <p className="text-sm text-stone-600">{QUEUES[tab].empty}</p>}
        <ul className="space-y-2">
          {list.map(f => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 p-4">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <FindingStatusBadge status={f.status} /><FindingSeverityBadge severity={f.severity} /><FindingScopeBadge scope={f.scope} />
                </div>
                <p className="font-semibold text-stone-900">{f.detail === "FULL" ? f.title : `Temuan ${f.id.slice(0, 11)}`}</p>
                <p className="text-xs text-stone-600">Laporan {f.reportId} versi {f.reportVersion} · paket <span className="font-mono">{f.packageId.slice(0, 12)}</span> · diperbarui {new Date(f.updatedAt * 1000).toLocaleDateString("id-ID")}</p>
              </div>
              <Button size="sm" onClick={() => setSelected(f.id)}>Buka</Button>
            </li>
          ))}
        </ul>
      </div>

      {selected && <AuditFindingDetailModal findingId={selected} requests={requests} onClose={() => setSelected(null)} onUpdated={() => void load()} />}
    </section>
  );
}
