import { ReportPackageForm } from "./ReportPackageForm";
import { useEffect, useState } from "react";
import { AlertTriangle, FileWarning, FileText, Lock, RefreshCw, ScrollText } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import { EvidencePreparationForm } from "./EvidencePreparationForm";
import { WorkspaceRequestError } from "./workspaceClient";
import { Button } from "../../components/ui/Button";
import { formatQuantity } from "../../lib/reporting";
import { bucketLabel, DISCREPANCY_LABELS } from "../reconciliation/format";
import {
  downloadEvidenceFile,
  fetchEvidencePreparation,
  listEvidencePreparations,
  type EvidenceFile,
  type EvidencePreparation,
  type EvidenceSummary,
} from "./evidenceClient";
import {
  describeCommitment,
  describeFileStatus,
  describeOutcome,
  describeSourceStatus,
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
      {source.status === "READ" && source.rows.length > 0 && (
        <details className="mt-3 text-xs text-stone-700">
          <summary className="cursor-pointer font-semibold">Baris sumber tersimpan ({source.rows.length})</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr>{["Identitas", "Jenis dana", "Posisi", "Nilai", "Hak amil"].map((title) => <th key={title} className="p-2">{title}</th>)}</tr></thead>
              <tbody>{source.rows.map((row, index) => <tr key={index} className="border-t border-stone-100">
                <td className="p-2">{row.key}{row.label && <span className="block">{row.label}</span>}{row.isDeclaredTotal && <span className="block">Total deklarasi</span>}</td>
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
  token,
}: {
  preparationId: string;
  file: EvidenceFile;
  token: string;
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
      const blob = await downloadEvidenceFile(preparationId, file, token);
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
  token,
}: {
  preparation: EvidencePreparation;
  commitmentVerified: boolean;
  token: string;
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

      {preparation.files.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
            Berkas sumber ({preparation.publicSummary.files.stored} dari{" "}
            {preparation.publicSummary.files.total} tersimpan)
          </h4>
          <ul className="mt-2 space-y-2">
            {preparation.files.map((file) => (
              <FileRow key={file.id} preparationId={preparation.id} file={file} token={token} />
            ))}
          </ul>
        </section>
      )}

      <p className="border-t border-stone-100 pt-3 text-xs text-stone-500">
        Commitment <span className="font-mono">{preparation.commitment.slice(0, 18)}…</span> (
        {preparation.commitmentScheme}). Pencatatan bukti di rantai, pengesahan lembaga, dan atestasi auditor adalah tindakan terpisah yang belum tersedia pada rilis ini.
      </p>
    </div>
  );
}

export function EvidencePackagePanel({ token, canPrepare, scopeUnit, scopeLevel }: {
  token: string; canPrepare: boolean; scopeUnit: string; scopeLevel: string;
}) {
  const [summaries, setSummaries] = useState<EvidenceSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    preparation: EvidencePreparation;
    commitmentVerified: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listEvidencePreparations(token).then(({ preparations }) => {
      if (!cancelled) { setSummaries(preparations); setError(null); }
    }).catch((caught) => {
      if (!cancelled) { setSummaries([]); setError(caught instanceof Error ? caught.message : "Daftar snapshot tidak dapat dibaca."); }
    });
    return () => { cancelled = true; };
  }, [token, refresh]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    fetchEvidencePreparation(openId, token)
      .then((next) => {
        if (!cancelled) setDetail(next);
      })
      .catch((caught: any) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(caught?.message ?? "Paket bukti tidak dapat dibuka.");
      });
    return () => {
      cancelled = true;
    };
  }, [openId, token, refresh]);

  if (summaries === null) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-600">
        Memuat paket bukti…
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          <ScrollText className="h-4 w-4" /> Snapshot sumber dan hasil rekonsiliasi ({summaries.length})
        </h3>
        <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>
          <RefreshCw className="mr-2 h-4 w-4" /> Muat ulang
        </Button>
      </header>

      {canPrepare && <EvidencePreparationForm token={token} scopeUnit={scopeUnit} scopeLevel={scopeLevel}
        onSaved={(id) => { setSavedId(id); setOpenId(id); setRefresh((value) => value + 1); }} />}
      {savedId && <p role="status" className="mt-3 text-sm text-emerald-800">Snapshot tersimpan: {savedId}. Hasil pemeriksaan dapat dibuka di bawah.</p>}

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {summaries.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-600">
          Belum ada snapshot yang dibekukan pada ruang kerja ini.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {summaries.map((summary) => {
            const outcome = describeOutcome(summary.outcome, summary.findingCount);
            const isOpen = openId === summary.id;
            return (
              <li key={summary.id} className="rounded-xl border border-stone-200">
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : summary.id)}
                  className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                      <FileText className="h-4 w-4 shrink-0 text-stone-400" />
                      <span className="truncate">{summary.label}</span>
                    </span>
                    <span className="mt-1 block text-xs text-stone-500">
                      {summary.periodKind} {summary.periodYear} · {summary.currencyUnit} ·{" "}
                      <span className="font-mono">{summary.id}</span>
                    </span>
                  </span>
                  <Badge>{outcome.label}</Badge>
                </button>

                {isOpen && (
                  <div className="border-t border-stone-100 p-4">
                    {detail && detail.preparation.id === summary.id ? (
                      <>
                      <PreparationDetail
                        preparation={detail.preparation}
                        commitmentVerified={detail.commitmentVerified}
                        token={token}
                      />
                      <ReportPackageForm key={`${summary.id}:${token}`} preparationId={summary.id} token={token} canPrepare={canPrepare} commitmentSalt={detail.preparation.commitmentSalt} />
                      </>
                    ) : detailError ? (
                      <p role="alert" className="text-sm text-red-700">{detailError} Gunakan Muat ulang untuk mencoba lagi.</p>
                    ) : (
                      <p className="text-sm text-stone-600">Membuka snapshot…</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
