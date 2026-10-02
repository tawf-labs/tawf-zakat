import type { PrivateRequests } from "./privateRequests";
import { RecoveryPanel } from "./RecoveryPanel";
import { ReportPackageForm } from "./ReportPackageForm";
import { useEffect, useState } from "react";
import { AlertTriangle, FileWarning, Lock } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { RealizationDrillDownCard } from "./RealizationDrillDownCard";
import { WorkspaceRequestError } from "./workspaceClient";
import { Button } from "../../components/ui/Button";
import { formatQuantity } from "../../lib/reporting";
import { bucketLabel, DISCREPANCY_LABELS } from "../reconciliation/format";
import {
  downloadEvidenceFile,
  fetchEvidencePreparation,
  type EvidenceFile,
  type EvidencePreparation,
} from "./evidenceClient";
import {
  describeChainScope,
  describeCommitment,
  describeFileStatus,
  describeOutcome,
  describeSourceStatus,
  describeUnverified,
  formatInstant,
  originLabel,
  positionLabel,
  roleLabel,
  transactionDetailLabel,
  type Described,
} from "./evidenceText";

/**
 * The institution's frozen preparations, reopened (Spec #68, ticket #70).
 *
 * Everything on this page comes from the stored snapshot, never from a fresh
 * reading of the working ledger - which is the whole point: reload it a month
 * later, after the institution's data has moved on, and it still shows what the
 * examination was actually run against.
 *
 * Three things it refuses to smooth over, because smoothing them over is how a
 * report starts lying:
 *
 * - A source that was missing or failed is shown as unexamined coverage, never
 *   as a period that held nothing.
 * - A file that failed to store is shown as failed, with the server's own
 *   reason, and gets no identifier and no download button.
 * - A commitment that no longer matches is announced at the top rather than
 *   quietly ignored.
 */

const TONE_CLASSES: Record<Described["tone"], string> = {
  neutral: "border-emerald-200 bg-emerald-50 text-emerald-900",
  finding: "border-amber-200 bg-amber-50 text-amber-900",
  unproven: "border-stone-300 bg-stone-100 text-stone-700",
};

function Note({ described }: { described: Described }) {
  return (
    <div className={`rounded-lg border p-3 text-sm ${TONE_CLASSES[described.tone]}`}>
      <p className="font-semibold">{described.label}</p>
      <p className="mt-1 opacity-90">{described.detail}</p>
    </div>
  );
}

function SourceCard({ source }: { source: EvidencePreparation["sources"][number] }) {
  const status = describeSourceStatus(source.status, source.status === "READ" ? source.rowCount : null, source.detail);
  const { manifest } = source;

  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            {roleLabel(source.role)}
          </p>
          <h4 className="truncate text-sm font-semibold text-stone-900">{manifest.label}</h4>
        </div>
        <Badge>{status.label}</Badge>
      </header>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-stone-600 sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt>Asal</dt>
          <dd className="text-right text-stone-800">{originLabel(manifest.origin)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Cakupan</dt>
          <dd className="text-right text-stone-800">
            {manifest.scopeUnit} · {manifest.scopeLevel}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Jenis dana</dt>
          <dd className="text-right text-stone-800">
            {manifest.fundTypes.map(bucketLabel).join(", ")}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Posisi neraca</dt>
          <dd className="text-right text-stone-800">{positionLabel(manifest.balanceSheet)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Cut-off</dt>
          <dd className="text-right font-mono text-stone-800">{formatInstant(manifest.cutOff)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Format · pemetaan</dt>
          <dd className="text-right text-stone-800">
            {manifest.format} · v{manifest.mappingVersion}
          </dd>
        </div>
        <div className="flex justify-between gap-3 sm:col-span-2">
          <dt>Rincian transaksi</dt>
          <dd className="text-right text-stone-800">
            {transactionDetailLabel(manifest.transactionDetail)}
          </dd>
        </div>
      </dl>

      <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-600">{status.detail}</p>
      {manifest.chainScope && <div className="mt-3"><Note described={describeChainScope(manifest.chainScope)} /></div>}
      {source.unverified.length > 0 && (
        <details className="mt-3 text-xs text-stone-700">
          <summary className="cursor-pointer font-semibold">
            {describeUnverified(source.unverified.length).label}
          </summary>
          <p className="mt-1 text-stone-600">{describeUnverified(source.unverified.length).detail}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {source.unverified.map((record) => (
              <li key={record.reference}>
                <span className="font-mono">{record.reference}</span>: {record.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      {source.status === "READ" && source.rows.length > 0 && (
        <details className="mt-3 text-xs text-stone-700">
          <summary className="cursor-pointer font-semibold">Baris sumber tersimpan ({source.rows.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr>{["Identitas", "Jenis dana", "Posisi", "Nilai", "Hak amil"].map((title) => <th key={title} className="p-2">{title}</th>)}</tr></thead>
              <tbody>{source.rows.map((row, index) => <tr key={index} className="border-t border-stone-100">
                <td className="p-2">{row.key}{row.label && <span className="block">{row.label}</span>}{row.isDeclaredTotal && <span className="block">Total deklarasi</span>}
                  {row.origin && <span className="block font-mono text-[11px] text-stone-500">
                    tx {row.origin.txHash.slice(0, 10)}… · log {row.origin.logIndex} ·{" "}
                    {row.origin.blockNumber === null ? "blok tidak dicatat sisi ini" : `blok ${row.origin.blockNumber}`}
                  </span>}
                </td>
                <td className="p-2">{bucketLabel(row.bucket)}</td>
                <td className="p-2">{positionLabel(row.balanceSheet)}</td>
                <td className="whitespace-nowrap p-2 font-mono">{formatQuantity({ amount: row.amount, unit: row.unit })}</td>
                <td className="whitespace-nowrap p-2 font-mono">{row.amilAmount === null ? "—" : formatQuantity({ amount: row.amilAmount, unit: row.unit })}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </article>
  );
}

function FileRow({
  preparationId,
  file,
  requests,
}: {
  preparationId: string;
  file: EvidenceFile;
  requests: PrivateRequests;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const status: Described = unavailable ? {
    label: "Tidak tersedia",
    detail: "Berkas pernah tersimpan, tetapi pengambilan terakhir gagal. Hubungi operator atau coba unduh ulang.",
    tone: "unproven",
  } : describeFileStatus(file.storageStatus, file.failureReason);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const blob = await downloadEvidenceFile(preparationId, file, requests);
      setUnavailable(false);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (caught: any) {
      if (caught instanceof WorkspaceRequestError && caught.status === 409) setUnavailable(true);
      setError(caught?.message ?? "Berkas tidak dapat diunduh.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-stone-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm text-stone-800">
          {file.storageStatus === "STORED" ? (
            <Lock className="h-4 w-4 shrink-0 text-emerald-700" />
          ) : (
            <FileWarning className="h-4 w-4 shrink-0 text-stone-500" />
          )}
          <span className="truncate">{file.fileName}</span>
          <Badge>{status.label}</Badge>
        </span>

        {/* No download for a file that is not there, and no stand-in identifier. */}
        {file.storageStatus === "STORED" && (
          <Button variant="outline" disabled={busy} onClick={download}>
            {busy ? "Mengunduh…" : "Unduh"}
          </Button>
        )}
      </div>

      <p className="mt-2 text-xs text-stone-600">{status.detail}</p>
      {file.contentSha256 && (
        <p className="mt-1 truncate font-mono text-[11px] text-stone-500">
          SHA-256 isi: {file.contentSha256}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

function PreparationDetail({
  preparation,
  commitmentVerified,
  requests,
}: {
  preparation: EvidencePreparation;
  commitmentVerified: boolean;
  requests: PrivateRequests;
}) {
  const outcome = describeOutcome(preparation.outcome, preparation.findings.length);
  const commitment = describeCommitment(commitmentVerified);

  return (
    <div className="space-y-4">
      <Note described={outcome} />
      {!commitmentVerified && <Note described={commitment} />}

      {preparation.result && (
        <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-stone-600">Selisih bersih</span>
            <span className="font-mono text-base text-stone-900">
              {formatQuantity(preparation.result.netDelta)}
            </span>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            {preparation.result.entryCounts.matched} entri cocok ·{" "}
            {preparation.result.entryCounts.claim} entri sisi klaim ·{" "}
            {preparation.result.entryCounts.source} entri sisi sumber
          </p>
          <p className="mt-2 text-xs text-stone-500">
            Cakupan: {positionLabel(preparation.snapshot.balanceSheetScope)} · Toleransi: {formatQuantity(preparation.snapshot.tolerance)}
          </p>
        </div>
      )}

      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
          Sumber dan cakupan
        </h4>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          {preparation.sources.map((source) => (
            <SourceCard key={source.role} source={source} />
          ))}
        </div>
      </section>

      {preparation.snapshot.coverageNotes.length > 0 && (
        <section className="rounded-xl border border-stone-300 bg-stone-50 p-4">
          <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-600">
            <AlertTriangle className="h-4 w-4" /> Batas pemeriksaan
          </h4>
          <ul className="mt-2 space-y-2 text-xs text-stone-700">
            {preparation.snapshot.coverageNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      {preparation.findings.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Temuan tersimpan ({preparation.findings.length})
          </h4>
          <ul className="mt-2 space-y-2">
            {preparation.findings.map((finding) => (
              <li
                key={finding.ordinal}
                className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {DISCREPANCY_LABELS[finding.kind as keyof typeof DISCREPANCY_LABELS] ?? finding.kind}
                    {" · "}
                    <span className="font-mono">{finding.key}</span>
                  </span>
                  <span className="font-mono">
                    {formatQuantity({ amount: finding.deltaAmount, unit: finding.deltaUnit })}
                  </span>
                </div>
                <p className="mt-1 text-xs opacity-80">
                  {bucketLabel(finding.bucket)}
                  {finding.claimAmount && finding.sourceAmount
                    ? ` · klaim ${finding.claimAmount} vs sumber ${finding.sourceAmount}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RealizationDrillDownCard preparationId={preparation.id} requests={requests} />

      {preparation.files.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Berkas sumber ({preparation.publicSummary.files.stored} dari{" "}
            {preparation.publicSummary.files.total} tersimpan)
          </h4>
          <ul className="mt-2 space-y-2">
            {preparation.files.map((file) => (
              <FileRow key={file.id} preparationId={preparation.id} file={file} requests={requests} />
            ))}
          </ul>
        </section>
      )}

      <p className="border-t border-stone-100 pt-3 text-xs text-stone-500">
        Commitment <span className="font-mono">{preparation.commitment.slice(0, 18)}…</span> (
        {preparation.commitmentScheme}). Pencatatan bukti dan pengesahan lembaga tersedia pada paket laporan beku di bawah. Penerbitan laporan dan atestasi auditor merupakan tindakan terpisah.
      </p>
    </div>
  );
}

/**
 * Everything one locked data set holds for an examiner, as the old evidence page
 * showed it: manifests and cut-off, findings, frozen realizations, files with their
 * SHA-256, the commitment, registry recovery and the report package form. Moved
 * behind *Detail teknis* by ADR-0043; nothing here was removed.
 */
export function PreparationTechnicalDetail({ preparationId, requests, canPrepare }: {
  preparationId: string; requests: PrivateRequests; canPrepare: boolean;
}) {
  const [detail, setDetail] = useState<{ preparation: EvidencePreparation; commitmentVerified: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchEvidencePreparation(preparationId, requests)
      .then((next) => { if (!cancelled) setDetail(next); })
      .catch((caught: any) => { if (!cancelled) setError(caught?.message ?? "Data laporan tidak dapat dibuka."); });
    return () => { cancelled = true; };
  }, [preparationId, requests]);

  if (error) return <p role="alert" className="text-sm text-red-700">{error}</p>;
  if (!detail) return <p className="text-sm text-stone-600">Membuka data laporan…</p>;
  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-500">
        {detail.preparation.label} · <span className="font-mono">{detail.preparation.id}</span>
      </p>
      <PreparationDetail preparation={detail.preparation} commitmentVerified={detail.commitmentVerified} requests={requests} />
      <RecoveryPanel key={`recovery:${preparationId}:${requests.contextId}`} requests={requests} preparationId={preparationId} canRecover={canPrepare} />
      <ReportPackageForm key={`${preparationId}:${requests.contextId}`} preparationId={preparationId} requests={requests} canPrepare={canPrepare} commitmentSalt={detail.preparation.commitmentSalt} />
    </div>
  );
}
