import { useId, useRef, useState } from "react";
import { FileText, RefreshCw } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import { previewTabularImport, saveImportDraft, type CurrencyUnit, type TabularPreview } from "./contributionClient";
import { errorMessage, fileToBase64 } from "./contributionUi";
import { ImportRowsTable, ImportTotals } from "./ImportRowsTable";

type ReadFile = { fileName: string; contentBase64: string; preview: TabularPreview };

export function TabularImportPanel({
  requests,
  onDraftSaved,
  onError,
}: {
  requests: PrivateRequests;
  onDraftSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const [unit, setUnit] = useState<CurrencyUnit>("IDR");
  const [read, setRead] = useState<ReadFile | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const id = useId();

  const clearFile = () => {
    setRead(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const choose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPreviewLoading(true);
    setRead(null);
    onError(null);
    try {
      const contentBase64 = await fileToBase64(file);
      const preview = await previewTabularImport(requests, file.name, contentBase64, unit);
      setRead({ fileName: file.name, contentBase64, preview });
    } catch (err) {
      onError(errorMessage(err, "Gagal membaca berkas spreadsheet."));
    } finally {
      setPreviewLoading(false);
    }
  };

  // The server re-reads the same file rather than trusting the preview it produced.
  const save = async () => {
    if (!read) return;
    setSaving(true);
    onError(null);
    try {
      await saveImportDraft(requests, {
        fileName: read.fileName,
        currencyUnit: read.preview.currencyUnit,
        contentBase64: read.contentBase64,
      });
      clearFile();
      onDraftSaved();
    } catch (err) {
      onError(errorMessage(err, "Gagal menyimpan draf impor."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-5 space-y-5">
      <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-4">
        <h3 className="text-sm font-semibold text-stone-900">Pratinjau Impor Berkas Tabular (XLSX / CSV)</h3>
        <p className="mt-1 text-xs text-stone-600">
          Pratinjau mempertahankan baris yang tidak valid dengan koordinat sel dan baris (US-32). Menyimpan draf impor{" "}
          <strong>tidak akan</strong> mencatat dana diterima sampai draf dikomit (AC08).
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-4 items-start">
        <div className="w-full md:w-64">
          <label htmlFor={`${id}-unit`} className="block text-xs font-semibold uppercase text-stone-600 mb-1">Satuan Mata Uang Berkas</label>
          <select
            id={`${id}-unit`}
            value={unit}
            onChange={(e) => {
              // A preview belongs to the unit it was read under; changing the unit asks for the file again.
              setUnit(e.target.value as CurrencyUnit);
              clearFile();
            }}
            className="w-full text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white text-stone-800 focus:outline-none"
          >
            <option value="IDR">Rupiah (IDR)</option>
            <option value="USDC_6DP">USDC (6 Decimal Places)</option>
          </select>
        </div>

        <div className="flex-1 w-full">
          <label htmlFor={`${id}-file`} className="block text-xs font-semibold uppercase text-stone-600 mb-1">Pilih Berkas XLSX atau CSV</label>
          <input
            id={`${id}-file`}
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,.xls"
            onChange={choose}
            disabled={previewLoading}
            className="w-full text-sm border border-stone-300 rounded-lg p-1.5 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
          />
        </div>
      </div>

      {previewLoading && (
        <div className="py-8 text-center text-sm text-stone-500 flex items-center justify-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin text-emerald-600" />
          <span>Membaca dan memetakan baris spreadsheet…</span>
        </div>
      )}

      {read && (
        <div className="space-y-4 border-t border-stone-200 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-stone-50 border border-stone-200">
            <ImportTotals {...read.preview} />
            <Button variant="outline" onClick={save} disabled={saving} className="text-xs">
              <FileText className="w-3.5 h-3.5 mr-1" />
              Simpan Draf Impor
            </Button>
          </div>
          <ImportRowsTable rows={read.preview.rows} currencyUnit={read.preview.currencyUnit} />
        </div>
      )}
    </div>
  );
}
