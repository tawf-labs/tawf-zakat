import React, { useMemo, useState } from "react";
import { AlertOctagon, PlayCircle, Sparkles } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { LedgerSideEditor } from "./LedgerSideEditor";
import { ReconciliationSummary } from "./ReconciliationSummary";
import { DiscrepancyTable } from "./DiscrepancyTable";
import { bucketsUsed, parseLedgerText } from "./ledgerText";
import {
  runInterInstitutionReconciliation,
  ReconciliationRequestError,
} from "./reconciliationClient";
import {
  LPZN_2024_CLAIM_LABEL,
  LPZN_2024_CLAIM_TEXT,
  LPZN_2024_SOURCE_LABEL,
  LPZN_2024_SOURCE_TEXT,
} from "./lpznDemo";
import { isEntryLevelKind, type ReconciliationReport, type ReportingPeriod } from "./types";

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3];

export function ReconciliationWorkbench() {
  const [periodKind, setPeriodKind] = useState<ReportingPeriod["kind"]>("AKHIR_TAHUN");
  const [year, setYear] = useState<number>(CURRENT_YEAR - 1);

  const [claimLabel, setClaimLabel] = useState("Rekap Laporan Zakat Wilayah");
  const [claimText, setClaimText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("Laporan Kinerja Pengelola Zakat");
  const [sourceText, setSourceText] = useState("");

  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const claim = useMemo(() => parseLedgerText(claimText, claimLabel), [claimText, claimLabel]);
  const source = useMemo(() => parseLedgerText(sourceText, sourceLabel), [sourceText, sourceLabel]);

  const canRun =
    !isRunning &&
    claim.side.entries.length + (claim.side.declaredTotals?.length ?? 0) > 0 &&
    source.side.entries.length + (source.side.declaredTotals?.length ?? 0) > 0;

  const entryGaps = useMemo(
    () => (report ? report.discrepancies.filter((d) => isEntryLevelKind(d.kind)) : []),
    [report]
  );
  const totalFindings = useMemo(
    () => (report ? report.discrepancies.filter((d) => !isEntryLevelKind(d.kind)) : []),
    [report]
  );

  const loadLpznDemo = () => {
    setClaimLabel(LPZN_2024_CLAIM_LABEL);
    setClaimText(LPZN_2024_CLAIM_TEXT);
    setSourceLabel(LPZN_2024_SOURCE_LABEL);
    setSourceText(LPZN_2024_SOURCE_TEXT);
    setPeriodKind("AKHIR_TAHUN");
    setYear(2024);
    setReport(null);
    setError(null);
  };

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const result = await runInterInstitutionReconciliation({
        claim: claim.side,
        source: source.side,
        options: {
          period: { kind: periodKind, year },
          allowedBuckets: bucketsUsed(claim.side, source.side),
        },
      });
      setReport(result);
    } catch (caught) {
      setReport(null);
      setError(
        caught instanceof ReconciliationRequestError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Rekonsiliasi gagal dijalankan."
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Reporting period */}
      <div className="flex flex-col gap-4 rounded-2xl border border-[#dbe7dd] bg-white p-5 shadow-xs sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
              Periode pelaporan
            </label>
            <select
              value={periodKind}
              onChange={(event) => setPeriodKind(event.target.value as ReportingPeriod["kind"])}
              className="mt-1.5 rounded-xl border border-[#dbe7dd] bg-[#f9fbf9] px-3 py-2 text-sm text-[#17332c] outline-none focus:border-[#1b765e]"
            >
              <option value="SEMESTER">Semester (1 Januari-30 Juni)</option>
              <option value="AKHIR_TAHUN">Akhir tahun (1 Januari-31 Desember)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
              Tahun
            </label>
            <select
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="mt-1.5 rounded-xl border border-[#dbe7dd] bg-[#f9fbf9] px-3 py-2 text-sm text-[#17332c] outline-none focus:border-[#1b765e]"
            >
              {YEAR_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={loadLpznDemo} type="button">
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Muat contoh LPZN 2024
        </Button>
      </div>

      {/* The two sides */}
      <div className="grid gap-6 lg:grid-cols-2">
        <LedgerSideEditor
          title="Rekap yang Anda susun"
          hint="Laporan Zakat Wilayah - angka yang akan Anda kirim ke BAZNAS pusat."
          label={claimLabel}
          onLabelChange={setClaimLabel}
          text={claimText}
          onTextChange={setClaimText}
          entryCount={claim.side.entries.length}
          declaredTotalCount={claim.side.declaredTotals?.length ?? 0}
          issues={claim.issues}
        />
        <LedgerSideEditor
          title="Laporan yang mendasarinya"
          hint="Laporan Kinerja dari Pengelola Zakat kabupaten/kota di wilayah Anda."
          label={sourceLabel}
          onLabelChange={setSourceLabel}
          text={sourceText}
          onTextChange={setSourceText}
          entryCount={source.side.entries.length}
          declaredTotalCount={source.side.declaredTotals?.length ?? 0}
          issues={source.issues}
        />
      </div>

      <div className="rounded-2xl border border-[#dbe7dd] bg-[#f4f8f3] px-5 py-4 text-xs leading-relaxed text-[#5e7a70]">
        <strong className="text-[#17332c]">Format satu baris:</strong> kode PZ; nama PZ; jenis dana;
        posisi neraca; jumlah. Pemisah boleh titik koma, koma, atau tab. Kolom posisi neraca boleh
        dikosongkan (dianggap <em>on balance sheet</em>). Baris yang diawali{" "}
        <code className="rounded bg-white px-1 py-0.5">TOTAL</code> atau{" "}
        <code className="rounded bg-white px-1 py-0.5">GRAND TOTAL</code> diperlakukan sebagai total
        yang dideklarasikan, sehingga penjumlahan di dalam rekap Anda sendiri ikut diperiksa.
      </div>

      <div className="flex justify-center">
        <Button size="lg" onClick={run} disabled={!canRun} type="button">
          <PlayCircle className="mr-2 h-4 w-4" />
          {isRunning ? "Merekonsiliasi..." : "Jalankan rekonsiliasi"}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-bold text-red-900">Rekonsiliasi ditolak</p>
            <p className="mt-1 text-sm leading-relaxed text-red-800">{error}</p>
          </div>
        </div>
      )}

      {report && (
        <div className="space-y-6">
          <ReconciliationSummary
            report={report}
            visibleEntryGaps={entryGaps}
            totalFindingCount={totalFindings.length}
            filtered={false}
          />

          <section className="space-y-3">
            <h3 className="font-serif text-xl font-bold text-[#17332c]">
              Rincian selisih per entri
            </h3>
            <p className="text-sm text-[#5e7a70]">
              Terurut dari selisih terbesar. Setiap baris menunjuk Pengelola Zakat, jenis dana, dan
              nilai rupiahnya - itulah yang menentukan kabupaten mana yang perlu dihubungi.
            </p>
            <DiscrepancyTable
              discrepancies={entryGaps}
              claimLabel={report.claimLabel}
              sourceLabel={report.sourceLabel}
              emptyMessage="Tidak ada selisih per entri."
            />
          </section>

          {totalFindings.length > 0 && (
            <section className="space-y-3">
              <h3 className="font-serif text-xl font-bold text-[#17332c]">
                Selisih pada total yang dideklarasikan
              </h3>
              <p className="text-sm text-[#5e7a70]">
                Ini bukan selisih antar-lembaga, melainkan penjumlahan di dalam satu laporan yang
                tidak konsisten dengan rinciannya sendiri.
              </p>
              <DiscrepancyTable
                discrepancies={totalFindings}
                claimLabel="Total tercetak"
                sourceLabel="Jumlah rincian"
                emptyMessage="Semua total konsisten dengan rinciannya."
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
