import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, ArrowRight, FileSpreadsheet, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { previewBeneficiaryImport, type BeneficiaryImportPreviewResult } from "./disbursementClient";
import { BeneficiaryImportSteps } from "./BeneficiaryImportSteps";
import { BeneficiaryImportSummary } from "./BeneficiaryImportSummary";
import { BeneficiaryImportTable } from "./BeneficiaryImportTable";

/** The uploaded file itself, kept so it can be stored privately with the draft. */
export type RosterSource = { fileName: string; mimeType: string; contentBase64: string };

export type ImportContext = {
  proposalId: string;
  programId: string | null;
  sharedAidPeriod: string | null;
  currentBeneficiaryCount: number;
};

async function base64Of(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Rendered only while open, so closing it discards the previous preview. */
export function BeneficiaryImportModal({
  requests,
  context,
  initialPreview = null,
  onClose,
  onApply,
}: {
  requests: PrivateRequests;
  context: ImportContext;
  initialPreview?: BeneficiaryImportPreviewResult | null;
  onClose: () => void;
  onApply: (preview: BeneficiaryImportPreviewResult, source: RosterSource | null) => void;
}) {
  const [preview, setPreview] = useState(initialPreview);
  const [source, setSource] = useState<RosterSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function readFile(file: File) {
    setLoading(true);
    setError(null);
    setPreview(null);
    setConfirmingReplace(false);
    try {
      const contentBase64 = await base64Of(file);
      const result = await previewBeneficiaryImport(requests, {
        fileName: file.name,
        contentBase64,
        proposalId: context.proposalId,
        programId: context.programId,
        sharedAidPeriod: context.sharedAidPeriod,
      });
      setSource({ fileName: file.name, mimeType: file.type || "application/octet-stream", contentBase64 });
      setPreview(result);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Gagal membaca berkas spreadsheet.");
    } finally {
      setLoading(false);
    }
  }

  function apply() {
    if (!preview?.canApply) return;
    if (context.currentBeneficiaryCount > 0 && !confirmingReplace) {
      setConfirmingReplace(true);
      return;
    }
    onApply(preview, source);
    onClose();
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="import-beneficiaries-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <h3 id="import-beneficiaries-title" className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" /> Impor Daftar Penerima (XLSX / CSV)
          </h3>
          <button type="button" onClick={onClose} aria-label="Tutup dialog impor"
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <BeneficiaryImportSteps requests={requests} loading={loading} onFile={readFile} onError={setError} />
          {error && (
            <div role="alert" className="space-y-1 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
              <p className="flex items-center gap-1.5 font-bold text-rose-900">
                <AlertCircle className="h-4 w-4 text-rose-600" /> Gagal Memproses Berkas
              </p>
              <p>{error}</p>
            </div>
          )}
          {preview && <>
            <BeneficiaryImportSummary preview={preview} />
            <BeneficiaryImportTable rows={preview.allRowsPreview} />
          </>}
        </div>

        <div className="space-y-2 rounded-b-2xl border-t border-stone-200 bg-stone-50 px-6 py-4">
          {confirmingReplace && (
            <p role="alert" className="flex items-center gap-1.5 text-xs text-amber-900">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              Daftar penerima saat ini ({context.currentBeneficiaryCount} penerima) akan diganti seluruhnya oleh hasil impor.
            </p>
          )}
          <div className="flex items-center justify-between">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Batal</Button>
            {preview && (
              <Button type="button" size="sm" onClick={apply} disabled={!preview.canApply}
                className="bg-emerald-600 text-white hover:bg-emerald-700">
                {confirmingReplace
                  ? "Ya, ganti daftar penerima"
                  : `Terapkan ke Draf Pengajuan (${preview.uniqueBeneficiaryCount} Penerima)`}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
