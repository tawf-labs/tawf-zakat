import React, { useState } from "react";
import { AlertOctagon, Blocks, DatabaseZap } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { InternalReportResult } from "./InternalReportResult";
import { internalPeriodLabel } from "./reconciliationTools";
import {
  runInternalReconciliation,
  ReconciliationRequestError,
} from "./reconciliationClient";
import type { CurrencyUnit, InternalReconciliationResponse } from "./types";

const UNIT_LABELS: Record<CurrencyUnit, string> = {
  IDR: "Rupiah (jalur fiat)",
  USDC_6DP: "USDC (jalur on-chain)",
};

/**
 * Ex-post check for the Auditor Independen: is this database a faithful mirror
 * of the chain? Nothing is uploaded - the server builds both sides itself.
 */
export function InternalModePanel() {
  const [result, setResult] = useState<InternalReconciliationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [checkedAt, setCheckedAt] = useState(new Date());

  const run = async () => {
    setIsRunning(true);
    setError(null);
    try {
      setResult(await runInternalReconciliation());
      setCheckedAt(new Date());
    } catch (caught) {
      setResult(null);
      setError(
        caught instanceof ReconciliationRequestError || caught instanceof Error
          ? caught.message
          : "Rekonsiliasi internal gagal dijalankan."
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[#dbe7dd] bg-white p-6 shadow-xs md:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <h3 className="flex items-center gap-2 font-serif text-xl font-bold text-[#17332c]">
            <DatabaseZap className="h-5 w-5 text-[#1b765e]" />
            Mode internal: basis data versus ledger on-chain
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-[#5e7a70]">
            Memeriksa apakah catatan PostgreSQL protokol ini benar-benar cermin dari event
            on-chain yang terindeks - batch settlement Merkle beserta donasi di dalamnya, dan
            proposal penyaluran. Anda tidak perlu mengunggah apa pun.
          </p>
        </div>
        <Button onClick={run} disabled={isRunning} type="button">
          {isRunning ? "Memeriksa..." : "Jalankan pemeriksaan"}
        </Button>
      </div>

      {error && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#dbe7dd] bg-[#f4f8f3] px-4 py-3">
            <Blocks className="h-4 w-4 text-[#1b765e]" />
            <span className="text-sm text-[#17332c]">
              Berlaku sampai blok{" "}
              <strong className="font-mono">{result.lastIndexedBlock.toLocaleString("id-ID")}</strong>
            </span>
            <span className="text-xs text-[#5e7a70]">
              (diperiksa dari blok {result.blockRange.fromBlock.toLocaleString("id-ID")} sampai{" "}
              {result.blockRange.toBlock.toLocaleString("id-ID")})
            </span>
            {result.indexerStatus && <Badge variant="neutral">{result.indexerStatus}</Badge>}
          </div>

          <p className="text-sm font-semibold text-[#5e7a70]">{internalPeriodLabel(result.period)}</p>
          {result.scopeWarning && <p className="text-sm text-amber-800">{result.scopeWarning}</p>}

          {(Object.keys(UNIT_LABELS) as CurrencyUnit[]).map((unit) => (
            <InternalReportResult key={unit} result={result} unit={unit} label={UNIT_LABELS[unit]} checkedAt={checkedAt} />
          ))}
        </div>
      )}
    </section>
  );
}
