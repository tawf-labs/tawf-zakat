import type { PrivateRequests } from "./privateRequests";
import { useEffect, useState, type FormEvent } from "react";
import { ClipboardList, FileJson, Sheet } from "lucide-react";
import { Button } from "../../components/ui/Button";
import {
  EvidenceRequestError,
  fetchInternalSources,
  prepareEvidence,
  downloadSourceTemplate,
  previewTabularSource,
  listEvidenceDrafts,
  getEvidenceDraft,
  saveEvidenceDraft,
  deleteEvidenceDraft,
  freezeEvidenceDraft,
  type EvidenceIssue,
  type InternalSourceStream,
  type TabularPreviewResult,
  sourceTemplateFileName,
  type EvidenceDraftSummary,
  type SourceScope,
  type TabularUpload,
} from "./evidenceClient";
import { describeChainScope, describeSourceStatus, formatRupiah, roleLabel } from "./evidenceText";

type Side = "CLAIM" | "SOURCE";
const SIDES: Side[] = ["CLAIM", "SOURCE"];
const sideName = (side: Side) => side === "CLAIM" ? "Sisi klaim" : "Sisi sumber";
const inputClass = "mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-sm text-stone-900 focus:border-[#0F3D30] focus:ring-1 focus:ring-[#0F3D30]";
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const USDC_DEPOSIT_STREAM = "USDC_DEPOSITS";
const DISBURSEMENT_REALIZATION_STREAM = "DISBURSEMENT_REALIZATIONS";

function example(side: Side, scopeUnit: string, scopeLevel: string) {
  return JSON.stringify({
    manifest: {
      label: sideName(side), origin: "PASTE", scopeUnit, scopeLevel,
      fundTypes: ["ZAKAT"], balanceSheet: "ON", currencyUnit: "IDR",
      period: { kind: "AKHIR_TAHUN", year: 2024 },
      cutOff: "2025-02-11T00:00:00.000Z", format: "baris-ledger", mappingVersion: "1",
      transactionDetail: "NOT_AVAILABLE",
    },
    status: "READ",
    rows: [{ key: "contoh-1", bucket: "ZAKAT", balanceSheet: "ON",
      value: { amount: side === "CLAIM" ? "1500000000" : "1200000000", unit: "IDR" } }],
  }, null, 2);
}

async function attachment(file: File, role: Side) {
  if (!file.size || file.size > MAX_FILE_BYTES) {
    throw new Error(`${sideName(role)}: berkas harus berisi data dan paling besar 5 MiB.`);
  }
  const contentBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error(`${sideName(role)}: berkas gagal dibaca. Pilih ulang berkasnya.`));
    reader.readAsDataURL(file);
  });
  return { role, fileName: file.name, mimeType: file.type || "application/octet-stream", contentBase64 };
}

function InternalSourcePanel({ stream }: { stream: InternalSourceStream }) {
  const scope = stream.chainScope ? describeChainScope(stream.chainScope) : null;
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-700">
      {stream.reason && <p className="text-stone-600">{stream.reason}</p>}
      {scope && (
        <p>
          <span className="font-semibold">{scope.label}.</span> {scope.detail}
        </p>
      )}
      <ul className="space-y-2">
        {stream.sides.map((side) => {
          const status = describeSourceStatus(side.status, side.rowCount, side.detail);
          return (
            <li key={side.role} className="rounded border border-stone-200 p-2">
              <p className="font-semibold text-stone-900">
                {roleLabel(side.role)} · {status.label}
              </p>
              <p className="mt-1 text-stone-600">{status.detail}</p>
              {side.unverified.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold">
                    Belum terverifikasi ({side.unverified.length})
                  </summary>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {side.unverified.slice(0, 20).map((record) => (
                      <li key={record.reference}>
                        <span className="font-mono">{record.reference}</span>: {record.reason}
                      </li>
                    ))}
                  </ul>
                  {side.unverified.length > 20 && (
                    <p className="mt-1">
                      Menampilkan 20 dari {side.unverified.length}; seluruhnya tersimpan dalam paket.
                    </p>
                  )}
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function EvidencePreparationForm({ requests, scopeUnit, scopeLevel, onSaved }: {
  requests: PrivateRequests;
  scopeUnit: string;
  scopeLevel: string;
  onSaved: (id: string) => void;
}) {
  const [label, setLabel] = useState("");
  const [year, setYear] = useState("2024");
  const [periodKind, setPeriodKind] = useState("AKHIR_TAHUN");
  const [unit, setUnit] = useState("IDR");
  const [position, setPosition] = useState("ON");
  const [editors, setEditors] = useState<Record<Side, string>>({ CLAIM: "", SOURCE: "" });
  const [files, setFiles] = useState<Partial<Record<Side, File>>>({});
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<EvidenceIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<Side | null>(null);
  const [internal, setInternal] = useState<Record<Side, boolean>>({ CLAIM: false, SOURCE: false });
  const [availableStreams, setAvailableStreams] = useState<InternalSourceStream[]>([]);
  const [stream, setStream] = useState<InternalSourceStream | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Tabular Source Import, Realization Source & Drafts State (Spec #86, Ticket #88, Ticket #98)
  const [sourceImportMode, setSourceImportMode] = useState<"TABULAR" | "REALIZATIONS" | "MANUAL_JSON">("TABULAR");
  const [realizationCutOff, setRealizationCutOff] = useState<string>("");
  // `datetime-local` gives a local wall-clock time; the server takes an instant.
  const realizationSource = () => ({
    internal: {
      stream: DISBURSEMENT_REALIZATION_STREAM,
      cutOff: (realizationCutOff ? new Date(realizationCutOff) : new Date()).toISOString(),
    },
  });
  const [tabularFile, setTabularFile] = useState<TabularUpload | null>(null);
  const [tabularPreview, setTabularPreview] = useState<TabularPreviewResult | null>(null);
  const [tabularLoading, setTabularLoading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState<string | null>(null);

  // Drafts management
  const [draftsList, setDraftsList] = useState<EvidenceDraftSummary[]>([]);
  const [selectedDraftId, setSelectedDraftId] = useState<string>("");
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftFeedback, setDraftFeedback] = useState<string | null>(null);

  // Load drafts on mount
  const refreshDrafts = () => {
    listEvidenceDrafts(requests)
      .then((res) => setDraftsList(res.drafts))
      .catch(() => {});
  };

  useEffect(() => {
    refreshDrafts();
  }, [requests]);

  useEffect(() => {
    let current = true;
    const parsedYear = Number(year);
    if (!Number.isInteger(parsedYear)) return;
    setStreamError(null);
    fetchInternalSources(requests, { kind: periodKind, year: parsedYear })
      .then((payload) => {
        if (current) {
          setAvailableStreams(payload.streams);
          const usdc = payload.streams.find((s) => s.stream === USDC_DEPOSIT_STREAM);
          setStream(usdc ?? payload.streams[0] ?? null);
        }
      })
      .catch((caught) => {
        if (!current) return;
        setStream(null);
        setAvailableStreams([]);
        setStreamError(
          caught instanceof Error
            ? `Sumber internal tidak dapat dibaca: ${caught.message}`
            : "Sumber internal tidak dapat dibaca."
        );
      });
    return () => {
      current = false;
    };
  }, [requests, periodKind, year]);

  /** The preparation a preview is checked against; never guessed by the server. */
  const sourceScope = (): SourceScope => ({
    period: { kind: periodKind, year: Number(year) },
    currencyUnit: unit,
    balanceSheetScope: position,
  });

  const handleDownloadTemplate = async (format: "xlsx" | "csv") => {
    setDownloadingTemplate(format);
    setError(null);
    try {
      const blob = await downloadSourceTemplate(requests, format);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = sourceTemplateFileName(format);
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err?.message || "Gagal mengunduh template sumber laporan.");
    } finally {
      setDownloadingTemplate(null);
    }
  };

  const handleTabularFileSelected = async (file?: File) => {
    if (!file) return;
    setTabularLoading(true);
    setError(null);
    setIssues([]);
    try {
      if (!file.size || file.size > MAX_FILE_BYTES) {
        throw new Error("Berkas spreadsheet harus berisi data dan paling besar 5 MiB.");
      }

      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Gagal membaca berkas spreadsheet."));
        reader.readAsDataURL(file);
      });

      const preview = await previewTabularSource(requests, file.name, contentBase64, sourceScope());
      setTabularFile({ fileName: file.name, contentBase64 });
      setTabularPreview(preview);
      setSourceImportMode("TABULAR");

      // Populate default claim template if claim editor is still empty
      if (!editors.CLAIM) {
        setEditors((prev) => ({
          ...prev,
          CLAIM: example("CLAIM", scopeUnit, scopeLevel),
        }));
      }
    } catch (err: any) {
      setError(err?.message || "Gagal membaca berkas spreadsheet. Periksa format dan isi berkas.");
      if (err instanceof EvidenceRequestError) setIssues(err.issues);
    } finally {
      setTabularLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    setDraftSaving(true);
    setError(null);
    setDraftFeedback(null);
    try {
      let claimPayload: any = null;
      if (internal.CLAIM) {
        claimPayload = { internal: { stream: USDC_DEPOSIT_STREAM } };
      } else if (editors.CLAIM.trim()) {
        try {
          claimPayload = JSON.parse(editors.CLAIM);
        } catch {
          claimPayload = { raw: editors.CLAIM };
        }
      }

      const draftPayload = {
        id: selectedDraftId || undefined,
        label: label.trim() || "Draf Sumber Laporan",
        period: { kind: periodKind, year: Number(year) },
        currencyUnit: unit,
        balanceSheetScope: position,
        claim: claimPayload,
        source: sourceImportMode === "REALIZATIONS"
          ? realizationSource()
          : sourceImportMode === "MANUAL_JSON" && editors.SOURCE.trim()
          ? (function() { try { return JSON.parse(editors.SOURCE); } catch { return { raw: editors.SOURCE }; } })()
          : undefined,
        sourceTable: sourceImportMode === "TABULAR" && tabularFile ? tabularFile : undefined,
        issues: tabularPreview ? tabularPreview.issues : [],
      };

      const res = await saveEvidenceDraft(requests, draftPayload as any);
      setSelectedDraftId(res.draft.id);
      setDraftFeedback(`Draf berhasil disimpan pada ${new Date().toLocaleTimeString("id-ID")}.`);
      refreshDrafts();
    } catch (err: any) {
      setError(err?.message || "Gagal menyimpan draf.");
    } finally {
      setDraftSaving(false);
    }
  };

  const handleSelectDraft = async (draftId: string) => {
    setSelectedDraftId(draftId);
    setError(null);
    setDraftFeedback(null);
    if (!draftId) return;

    try {
      setBusy(true);
      const res = await getEvidenceDraft(draftId, requests);
      const draft = res.draft;
      setLabel(draft.label);
      setPeriodKind(draft.periodKind);
      setYear(String(draft.periodYear));
      setUnit(draft.currencyUnit);
      setPosition(draft.balanceSheetScope);

      if (draft.claimData) {
        if (draft.claimData.internal) {
          setInternal((prev) => ({ ...prev, CLAIM: true }));
        } else {
          setInternal((prev) => ({ ...prev, CLAIM: false }));
          setEditors((prev) => ({
            ...prev,
            CLAIM: typeof draft.claimData === "string" ? draft.claimData : JSON.stringify(draft.claimData, null, 2),
          }));
        }
      }

      if (draft.sourceData?.tabular) {
        // The workbook stays on the server; what comes back is the rows read from it.
        // Freezing this draft needs no re-upload, so `tabularFile` stays empty and the
        // draft's own source is used instead.
        setSourceImportMode("TABULAR");
        setTabularFile(null);
        setTabularPreview(res.sourcePreview);
        if (res.previewUnavailable) setError(res.previewUnavailable);
      } else if (draft.sourceData?.side) {
        setSourceImportMode("MANUAL_JSON");
        setEditors((prev) => ({
          ...prev,
          SOURCE: JSON.stringify(draft.sourceData!.side, null, 2),
        }));
      }
      setDraftFeedback(`Draf "${draft.label}" berhasil dimuat.`);
    } catch (err: any) {
      setError(err?.message || "Gagal memuat draf yang dipilih.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteCurrentDraft = async () => {
    if (!selectedDraftId) return;
    try {
      setBusy(true);
      await deleteEvidenceDraft(selectedDraftId, requests);
      setSelectedDraftId("");
      setDraftFeedback("Draf berhasil dihapus.");
      refreshDrafts();
    } catch (err: any) {
      setError(err?.message || "Gagal menghapus draf.");
    } finally {
      setBusy(false);
    }
  };

  const uploadJson = async (side: Side, file?: File) => {
    if (!file) return;
    setReading(side);
    setError(null);
    try {
      if (!file.size || file.size > MAX_FILE_BYTES) throw new Error("Ledger harus berisi data dan paling besar 5 MiB.");
      const text = await file.text();
      JSON.parse(text);
      setEditors((current) => ({ ...current, [side]: text }));
      setFiles((current) => ({ ...current, [side]: file }));
    } catch {
      setError(`${sideName(side)}: unggahan gagal dibaca. Gunakan JSON sesuai contoh, paling besar 5 MiB. Masukan sebelumnya tetap dipertahankan.`);
    } finally {
      setReading(null);
    }
  };

  /**
   * True when the source of record is the workbook the server holds for this draft,
   * rather than a file picked in this session. Freezing then goes through the draft,
   * which reads that workbook back and freezes it with the rows it produced.
   */
  const freezesStoredDraft = sourceImportMode === "TABULAR" && !tabularFile && selectedDraftId !== "";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setIssues([]);

    // Validation for Tabular Import Mode
    if (sourceImportMode === "TABULAR" && !freezesStoredDraft) {
      if (!tabularFile) {
        setError("Sisi sumber: Unggah berkas spreadsheet XLSX atau CSV terlebih dahulu.");
        setBusy(false);
        return;
      }
      if (tabularPreview && tabularPreview.invalidCount > 0) {
        setError(
          `Sisi sumber: Draf belum dapat dibekukan karena masih terdapat ${tabularPreview.invalidCount} baris yang bermasalah. Perbaiki berkas atau simpan sebagai draf.`
        );
        setBusy(false);
        return;
      }
    }

    try {
      if (freezesStoredDraft) {
        const { preparation } = await freezeEvidenceDraft(selectedDraftId, requests);
        onSaved(preparation.id);
        return;
      }

      const parsed = {} as Record<Side, unknown>;

      // Claim side resolution
      if (internal.CLAIM) {
        parsed.CLAIM = { internal: { stream: USDC_DEPOSIT_STREAM } };
      } else {
        try {
          parsed.CLAIM = JSON.parse(editors.CLAIM);
        } catch {
          throw new Error("Sisi klaim: JSON belum sah. Periksa tanda kutip, koma, dan kurung sesuai contoh.");
        }
      }

      // Source side resolution
      if (sourceImportMode === "REALIZATIONS") {
        parsed.SOURCE = realizationSource();
      } else if (sourceImportMode === "MANUAL_JSON") {
        if (internal.SOURCE) {
          parsed.SOURCE = { internal: { stream: USDC_DEPOSIT_STREAM } };
        } else {
          try {
            parsed.SOURCE = JSON.parse(editors.SOURCE);
          } catch {
            throw new Error("Sisi sumber: JSON belum sah. Periksa tanda kutip, koma, dan kurung sesuai contoh.");
          }
        }
      }

      const attachments = await Promise.all(
        SIDES.flatMap((side) => (files[side] ? [attachment(files[side]!, side)] : []))
      );

      const payload: any = {
        label,
        period: { kind: periodKind, year: Number(year) },
        currencyUnit: unit,
        balanceSheetScope: position,
        claim: parsed.CLAIM,
        files: attachments,
      };

      if (sourceImportMode === "TABULAR" && tabularFile) {
        payload.sourceTable = tabularFile;
      } else {
        payload.source = parsed.SOURCE;
      }

      const { preparation } = await prepareEvidence(requests, payload);
      onSaved(preparation.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Persiapan gagal disimpan.");
      if (caught instanceof EvidenceRequestError) setIssues(caught.issues);
    } finally {
      setBusy(false);
    }
  };

  const isFreezeBlocked =
    sourceImportMode === "TABULAR" &&
    ((!tabularFile && !freezesStoredDraft) ||
      (tabularPreview !== null && tabularPreview.invalidCount > 0));

  return (
    <form onSubmit={submit} className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3">
        <div>
          <h4 className="font-semibold text-stone-900">Siapkan Snapshot Sumber & Rekonsiliasi</h4>
          <p className="text-xs text-stone-600">
            Impor spreadsheet XLSX/CSV sumber laporan atau gunakan JSON. Sumber dibekukan menjadi snapshot kanonikal yang tak dapat dimutasi.
          </p>
        </div>

        {/* Drafts Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {draftsList.length > 0 && (
            <select
              aria-label="Pilih draf tersimpan"
              value={selectedDraftId}
              onChange={(e) => void handleSelectDraft(e.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-900"
            >
              <option value="">-- Buka Draf Tersimpan ({draftsList.length}) --</option>
              {draftsList.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label} (v{d.version} · {d.issueCount > 0 ? `${d.issueCount} isu` : "0 isu"})
                </option>
              ))}
            </select>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleSaveDraft()}
            disabled={busy || draftSaving}
          >
            {draftSaving ? "Menyimpan Draf…" : "💾 Simpan Draf"}
          </Button>

          {selectedDraftId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleDeleteCurrentDraft()}
              disabled={busy}
              className="text-red-700 hover:bg-red-50"
            >
              Hapus Draf
            </Button>
          )}
        </div>
      </div>

      {draftFeedback && (
        <div role="status" className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 flex items-center justify-between">
          <span>✓ {draftFeedback}</span>
          <button type="button" onClick={() => setDraftFeedback(null)} className="text-emerald-600 hover:text-emerald-900">✕</button>
        </div>
      )}

      <fieldset disabled={busy || reading !== null} className="mt-4 space-y-4">
        <label className="block text-sm">
          Nama persiapan
          <input
            required
            value={label}
            placeholder="mis. Rekonsiliasi Zakat Akhir Tahun 2024"
            onChange={(e) => setLabel(e.target.value)}
            className={inputClass}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">
            Periode
            <select value={periodKind} onChange={(e) => setPeriodKind(e.target.value)} className={inputClass}>
              <option value="AKHIR_TAHUN">Akhir tahun</option>
              <option value="SEMESTER">Semester pertama</option>
            </select>
          </label>
          <label className="text-sm">
            Tahun
            <input
              required
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            Unit mata uang
            <select value={unit} onChange={(e) => setUnit(e.target.value)} className={inputClass}>
              <option value="IDR">Rupiah (IDR)</option>
              <option value="USDC_6DP">USDC (6 desimal)</option>
            </select>
          </label>
          <label className="text-sm">
            Cakupan posisi neraca
            <select value={position} onChange={(e) => setPosition(e.target.value)} className={inputClass}>
              <option value="ON">On balance sheet</option>
              <option value="OFF">Off balance sheet</option>
              <option value="BOTH">Kedua posisi</option>
            </select>
          </label>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {/* SISI KLAIM */}
          <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <h5 className="font-semibold text-stone-800">1. Sisi Klaim (Ledger Organisasi)</h5>
              <span className="rounded bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">Klaim</span>
            </div>

            <label className="flex items-start gap-2 text-sm text-stone-800">
              <input
                type="checkbox"
                className="mt-1"
                checked={internal.CLAIM}
                onChange={(e) => setInternal((current) => ({ ...current, CLAIM: e.target.checked }))}
              />
              <span>
                Pakai sumber internal: deposit USDC on-chain
                <span className="block text-xs text-stone-600">
                  Dibaca server dari event terindeks dan ledger internal, dalam satuan minor USDC yang presisi.
                </span>
              </span>
            </label>

            {internal.CLAIM && streamError && (
              <p role="alert" className="rounded bg-amber-50 p-2 text-xs text-amber-900">{streamError}</p>
            )}
            {internal.CLAIM && stream && <InternalSourcePanel stream={stream} />}

            {!internal.CLAIM && (
              <>
                <details className="text-xs text-stone-600">
                  <summary className="cursor-pointer font-medium text-stone-700 hover:text-stone-900">
                    Contoh format klaim JSON (data sintetis)
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-stone-100 p-2">{example("CLAIM", scopeUnit, scopeLevel)}</pre>
                </details>
                <label className="block text-sm">
                  Unggah klaim JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="mt-1 block w-full text-xs"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      void uploadJson("CLAIM", file);
                    }}
                  />
                </label>
                <label className="block text-sm">
                  Tempel atau perbaiki ledger klaim dan manifest
                  <textarea
                    required
                    spellCheck={false}
                    rows={12}
                    value={editors.CLAIM}
                    className={`${inputClass} font-mono text-xs`}
                    onChange={(e) => setEditors((current) => ({ ...current, CLAIM: e.target.value }))}
                  />
                </label>
              </>
            )}
          </div>

          {/* SISI SUMBER (XLSX/CSV Tabular Import, Realisasi Internal & Manual JSON) */}
          <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2">
              <h5 className="font-semibold text-stone-800">2. Sisi Sumber Laporan (Evidence Source)</h5>
              
              {/* Mode switch */}
              <div className="flex rounded-lg bg-stone-100 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setSourceImportMode("REALIZATIONS")}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    sourceImportMode === "REALIZATIONS"
                      ? "bg-white text-[#0F3D30] shadow-sm"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  <ClipboardList className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  Realisasi Penyaluran
                </button>
                <button
                  type="button"
                  onClick={() => setSourceImportMode("TABULAR")}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    sourceImportMode === "TABULAR"
                      ? "bg-white text-[#0F3D30] shadow-sm"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  <Sheet className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  Impor Spreadsheet
                </button>
                <button
                  type="button"
                  onClick={() => setSourceImportMode("MANUAL_JSON")}
                  className={`rounded-md px-2.5 py-1 font-medium transition ${
                    sourceImportMode === "MANUAL_JSON"
                      ? "bg-white text-[#0F3D30] shadow-sm"
                      : "text-stone-600 hover:text-stone-900"
                  }`}
                >
                  <FileJson className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                  Tempel JSON Manual
                </button>
              </div>
            </div>

            {sourceImportMode === "REALIZATIONS" && (
              <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/30 p-4 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h6 className="font-semibold text-emerald-950">Sumber Realisasi Penyaluran Lembaga (Spec #86 / Ticket #98)</h6>
                    <p className="mt-0.5 text-stone-600">
                      Membekukan seluruh realisasi uang & barang yang dicatat hingga batas cut-off beserta versi pengajuan,
                      penerima, dan dokumen serah terima ke dalam berkas penelusuran terenkripsi yang ikut dibekukan dalam paket.
                    </p>
                  </div>
                  <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-800">
                    DISBURSEMENT_REALIZATIONS
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block font-medium text-stone-800">
                      Batas Akhir Cut-off Realisasi
                      <input
                        type="datetime-local"
                        value={realizationCutOff}
                        onChange={(e) => setRealizationCutOff(e.target.value)}
                        className={`${inputClass} text-xs`}
                      />
                    </label>
                    <p className="mt-1 text-[11px] text-stone-500">
                      Kosongkan untuk memakai batas waktu penyiapan sekarang. Realisasi yang dicatat setelah batas cut-off
                      dinyatakan belum terperiksa pada snapshot ini, bukan tidak ada.
                    </p>
                  </div>
                  <div className="rounded-md border border-stone-200 bg-white p-2.5">
                    <p className="font-medium text-stone-800">Prinsip Integritas & Audit:</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-stone-600">
                      <li><strong>AC07:</strong> Uang muka petugas & biaya pengadaan dipisahkan tanpa double-counting.</li>
                      <li><strong>Barang Terpisah:</strong> Kuantitas barang tidak dikonversi ke Rp0.</li>
                      <li><strong>Snapshot Permanen:</strong> Revisi pengajuan di masa depan tidak mengubah snapshot yang telah dibekukan.</li>
                    </ul>
                  </div>
                </div>

                {/* Candidate stream preview */}
                {(() => {
                  const relStream = availableStreams.find((s) => s.stream === DISBURSEMENT_REALIZATION_STREAM);
                  if (!relStream) return null;
                  return <InternalSourcePanel stream={relStream} />;
                })()}
              </div>
            )}

            {sourceImportMode === "TABULAR" ? (
              <div className="space-y-3">
                {/* Template Download Buttons */}
                <div className="rounded-lg border border-emerald-200/60 bg-emerald-50/40 p-3">
                  <p className="text-xs font-medium text-emerald-900">Template Sumber Laporan Resmi (v1):</p>
                  <p className="mt-0.5 text-[11px] text-emerald-700">
                    Memuat lembar petunjuk, format kolom resmi, tipe data teks, dan contoh data sintetis.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => void handleDownloadTemplate("xlsx")}
                      disabled={downloadingTemplate !== null}
                    >
                      {downloadingTemplate === "xlsx" ? "Mengunduh…" : "📥 Unduh Template XLSX (Utama)"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDownloadTemplate("csv")}
                      disabled={downloadingTemplate !== null}
                    >
                      {downloadingTemplate === "csv" ? "Mengunduh…" : "📥 Unduh Template CSV (Alternatif)"}
                    </Button>
                  </div>
                </div>

                {/* Upload Spreadsheet Box */}
                <div>
                  <label className="block text-sm font-medium text-stone-800">
                    Unggah Berkas Spreadsheet (XLSX / CSV)
                    <input
                      type="file"
                      accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                      disabled={tabularLoading}
                      className="mt-1.5 block w-full rounded-lg border border-stone-300 bg-stone-50 p-2 text-xs text-stone-900 file:mr-3 file:rounded-md file:border-0 file:bg-[#0F3D30] file:px-3 file:py-1 file:text-xs file:font-medium file:text-white hover:file:bg-[#1A5242]"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        void handleTabularFileSelected(file);
                      }}
                    />
                  </label>
                  <p className="mt-1 text-[11px] text-stone-500">
                    Maksimal 5 MiB, 5.000 baris, 50 kolom. Formula dan makro (.xlsm) ditolak secara ketat demi keamanan.
                  </p>
                </div>

                {tabularLoading && (
                  <p className="rounded bg-stone-100 p-2 text-center text-xs text-stone-600 animate-pulse">
                    Membaca dan memetakan spreadsheet…
                  </p>
                )}

                {/* Live Preview Panel */}
                {tabularPreview && (
                  <div className="space-y-2.5 rounded-lg border border-stone-200 bg-stone-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-stone-900">
                        Pratinjau Impor: {tabularPreview.fileName} ({tabularPreview.format.toUpperCase()})
                      </span>
                      {tabularPreview.isPartial ? (
                        <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          ⚠️ Total Parsial (belum lengkap)
                        </span>
                      ) : (
                        <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          ✓ 100% Valid ({tabularPreview.validCount} baris)
                        </span>
                      )}
                    </div>

                    {/* Metric Cards */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
                      <div className="rounded bg-white p-2 border border-stone-200">
                        <span className="text-stone-500">Total Baris:</span>
                        <p className="font-semibold text-stone-900">{tabularPreview.totalRows}</p>
                      </div>
                      <div className="rounded bg-white p-2 border border-stone-200">
                        <span className="text-stone-500">Baris Valid:</span>
                        <p className="font-semibold text-emerald-700">{tabularPreview.validCount}</p>
                      </div>
                      <div className="rounded bg-white p-2 border border-stone-200">
                        <span className="text-stone-500">Bermasalah:</span>
                        <p className={`font-semibold ${tabularPreview.invalidCount > 0 ? "text-red-600" : "text-stone-900"}`}>
                          {tabularPreview.invalidCount}
                        </p>
                      </div>
                      <div className="rounded bg-white p-2 border border-stone-200">
                        <span className="text-stone-500">Total Valid:</span>
                        <p className="font-semibold text-stone-900 truncate" title={`Rp ${formatRupiah(tabularPreview.calculableTotal)}`}>
                          Rp {formatRupiah(tabularPreview.calculableTotal)}
                        </p>
                      </div>
                    </div>

                    {/* Table View of Rows */}
                    <div className="max-h-64 overflow-y-auto rounded border border-stone-200 bg-white">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-stone-100 text-stone-700 border-b border-stone-200">
                          <tr>
                            <th className="p-1.5 w-10">No</th>
                            <th className="p-1.5">Key</th>
                            <th className="p-1.5">Jenis Dana</th>
                            <th className="p-1.5">Posisi</th>
                            <th className="p-1.5 text-right">Nominal</th>
                            <th className="p-1.5">Status / Masalah</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100">
                          {tabularPreview.allRowsPreview.slice(0, 100).map((r) => (
                            <tr
                              key={r.rowNumber}
                              className={r.isValid ? "hover:bg-stone-50" : "bg-red-50/70 text-red-950 font-medium"}
                            >
                              <td className="p-1.5 text-stone-500">{r.rowNumber}</td>
                              <td className="p-1.5 font-mono">{r.row?.key ?? r.rawCells.key ?? r.rawCells.identitas_entri ?? "-"}</td>
                              <td className="p-1.5">{r.row?.bucket ?? r.rawCells.jenis_dana ?? "-"}</td>
                              <td className="p-1.5">{r.row?.balanceSheet ?? r.rawCells.posisi_neraca ?? "-"}</td>
                              <td className="p-1.5 text-right font-mono">
                                {r.row ? formatRupiah(r.row.amount) : (r.rawCells.nilai ?? r.rawCells.amount ?? "-")}
                              </td>
                              <td className="p-1.5">
                                {r.isValid ? (
                                  <span className="text-emerald-700">✓ Sah</span>
                                ) : (
                                  <span className="text-red-700" title={r.issues.map((i) => i.message).join(", ")}>
                                    ⚠️ {r.issues[0]?.message ?? "Baris tidak valid"}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {tabularPreview.allRowsPreview.length > 100 && (
                        <p className="p-2 text-center text-[11px] text-stone-500 bg-stone-50 border-t border-stone-200">
                          Menampilkan 100 dari {tabularPreview.allRowsPreview.length} baris; seluruhnya tersimpan dalam draf dan snapshot.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : sourceImportMode === "MANUAL_JSON" ? (
              /* Manual JSON Editor (Fallback / Advanced) */
              <div className="space-y-3">
                <details className="text-xs text-stone-600">
                  <summary className="cursor-pointer font-medium text-stone-700 hover:text-stone-900">
                    Contoh format JSON sumber (data sintetis)
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-stone-100 p-2">{example("SOURCE", scopeUnit, scopeLevel)}</pre>
                </details>
                <label className="block text-sm">
                  Unggah ledger JSON
                  <input
                    type="file"
                    accept=".json,application/json"
                    className="mt-1 block w-full text-xs"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      void uploadJson("SOURCE", file);
                    }}
                  />
                </label>
                <label className="block text-sm">
                  Tempel atau perbaiki ledger sumber dan manifest
                  <textarea
                    required={sourceImportMode === "MANUAL_JSON"}
                    spellCheck={false}
                    rows={12}
                    value={editors.SOURCE}
                    className={`${inputClass} font-mono text-xs`}
                    onChange={(e) => setEditors((current) => ({ ...current, SOURCE: e.target.value }))}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </div>

        {/* Supporting Documents (Lampiran Bukti Fisik / SK) */}
        <div className="rounded-lg border border-stone-200 bg-white p-3 space-y-2">
          <h5 className="font-semibold text-xs text-stone-800 uppercase tracking-wide">
            Dokumen Asli Pendukung (Opsional, Maksimal 5 MiB per berkas)
          </h5>
          <div className="grid gap-3 sm:grid-cols-2">
            {SIDES.map((side) => (
              <div key={side} className="space-y-1">
                <label className="block text-xs font-medium text-stone-700">
                  Lampiran {sideName(side)}:
                  <input
                    type="file"
                    className="mt-1 block w-full text-xs"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      setFiles((current) => ({ ...current, [side]: file }));
                    }}
                  />
                </label>
                {files[side] && (
                  <div className="flex items-center justify-between gap-2 text-xs bg-stone-50 p-1.5 rounded">
                    <span className="break-all truncate">📎 {files[side]!.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFiles((current) => ({ ...current, [side]: undefined }))}
                    >
                      Lepas
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Action Button & Freeze Guard Notice */}
        <div className="pt-2">
          <Button
            type="submit"
            disabled={busy || reading !== null || isFreezeBlocked}
            className="w-full sm:w-auto"
          >
            {busy
              ? "Membekukan dan merekonsiliasi…"
              : reading
              ? "Membaca unggahan…"
              : "🔒 Bekukan Snapshot, Rekonsiliasi, dan Simpan"}
          </Button>

          {isFreezeBlocked && (
            <p className="mt-2 text-xs font-medium text-amber-800">
              ⚠️ Tombol bekukan dinonaktifkan:{" "}
              {!tabularFile
                ? "Unggah berkas spreadsheet sumber laporan terlebih dahulu."
                : `Draf hanya dapat dibekukan jika 0 baris bermasalah (terdapat ${tabularPreview?.invalidCount ?? 0} baris yang perlu diperbaiki). Anda tetap dapat menyimpan sebagai draf.`}
            </p>
          )}
        </div>
      </fieldset>

      {/* Error & Issues Alert */}
      {error && (
        <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 border border-red-200">
          <p className="font-semibold">{error}</p>
          {issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-700">
              {issues.map((issue, index) => (
                <li key={index}>
                  {issue.side && `${sideName(issue.side)} · `}
                  {issue.rowIndex !== null && `${issue.scope === "total" ? "Total" : "Baris"} ${issue.rowIndex + 1} · `}
                  {issue.field}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
