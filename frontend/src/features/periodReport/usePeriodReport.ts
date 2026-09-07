import { useCallback, useState } from "react";
import {
  fetchPeriodFigures,
  requestPeriodDraft,
  PeriodReportRequestError,
} from "./periodReportClient";
import { buildReportDocument, reportFileName } from "./reportDocument";
import { downloadText } from "../../lib/download";
import { canSign } from "./verdictText";
import type { PeriodReportResponse, ReportingPeriod } from "./types";

/**
 * Everything the period report screen does, so the components only lay it out:
 * which period is chosen, the figures for it, asking for a draft, and getting a
 * passing report out as a file.
 *
 * Choosing a period drops any draft already on screen. A narrative written for
 * one period must never be left sitting above another period's figures.
 */
export function usePeriodReport() {
  const currentYear = new Date().getFullYear();

  const [period, setPeriodState] = useState<ReportingPeriod>({
    kind: "AKHIR_TAHUN",
    year: currentYear,
  });
  const [response, setResponse] = useState<PeriodReportResponse | null>(null);
  const [draftRequested, setDraftRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingFigures, setIsLoadingFigures] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);

  const run = useCallback(
    async (
      request: (period: ReportingPeriod) => Promise<PeriodReportResponse>,
      forPeriod: ReportingPeriod,
      setBusy: (busy: boolean) => void
    ) => {
      setBusy(true);
      setError(null);
      try {
        setResponse(await request(forPeriod));
      } catch (caught) {
        setResponse(null);
        setError(
          caught instanceof PeriodReportRequestError
            ? caught.message
            : "Laporan periode gagal diambil. Periksa koneksi ke server."
        );
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const loadFigures = useCallback(
    (forPeriod: ReportingPeriod = period) =>
      run(fetchPeriodFigures, forPeriod, setIsLoadingFigures),
    [period, run]
  );

  const draftNarrative = useCallback(() => {
    setDraftRequested(true);
    return run(requestPeriodDraft, period, setIsDrafting);
  }, [period, run]);

  const setPeriod = useCallback((next: ReportingPeriod) => {
    setPeriodState(next);
    setResponse(null);
    setError(null);
    setDraftRequested(false);
  }, []);

  const figures = response?.figures ?? null;
  const draft = response?.draft ?? null;
  const verdict = response?.verdict ?? null;

  const download = useCallback(() => {
    if (!figures) return;
    // The second lock: anything that did not pass the validator yields no file.
    const text = buildReportDocument(figures, draft, verdict);
    if (!text) return;
    downloadText(reportFileName(figures.period), text);
  }, [figures, draft, verdict]);

  return {
    period,
    setPeriod,
    figures,
    draft,
    verdict,
    // `/verify` also reports "no draft was sent", which is not an outage - only
    // a draft that was actually asked for can be unavailable.
    draftUnavailable: draftRequested ? (response?.draftUnavailable ?? null) : null,
    draftRequested,
    error,
    isLoadingFigures,
    isDrafting,
    isBusy: isLoadingFigures || isDrafting,
    loadFigures,
    draftNarrative,
    signable: canSign(verdict),
    download,
  };
}
