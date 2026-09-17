import { useState, useRef } from "react";
import {
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
  FileSpreadsheet,
  X,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  downloadBeneficiaryTemplate,
  previewBeneficiaryImport,
  type Beneficiary,
  type AidLine,
  type BeneficiaryImportPreviewResult,
} from "./disbursementClient";

export function BeneficiaryImportModal({
  isOpen,
  onClose,
  requests,
  defaultAidPeriod,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  requests: PrivateRequests;
  defaultAidPeriod?: string;
  onApply: (beneficiaries: Beneficiary[], aidLines: AidLine[]) => void;
}) {
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BeneficiaryImportPreviewResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleDownloadTemplate = async (format: "xlsx" | "csv") => {
    try {
      setDownloadingFormat(format);
      setError(null);
      const { blob, fileName } = await downloadBeneficiaryTemplate(requests, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || "Gagal mengunduh template penerima.");
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingPreview(true);
    setError(null);
    setPreview(null);

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const resultString = reader.result as string;
          const base64Content = resultString.split(",")[1] || resultString;
          const res = await previewBeneficiaryImport(requests, {
            fileName: file.name,
            contentBase64: base64Content,
            defaultAidPeriod,
          });
          setPreview(res);
        } catch (err: any) {
          setError(err.message || "Gagal membaca berkas spreadsheet.");
        } finally {
          setLoadingPreview(false);
        }
      };
      reader.onerror = () => {
        setError("Gagal membaca berkas lokal dari perangkat.");
        setLoadingPreview(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      setError(err.message || "Terjadi kesalahan saat memproses berkas.");
      setLoadingPreview(false);
    }
  };

  const handleApply = () => {
    if (!preview) return;
    onApply(preview.beneficiaries, preview.aidLines);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-beneficiaries-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
            <h3 id="import-beneficiaries-title" className="text-base font-semibold text-stone-900">
              Impor Daftar Penerima (XLSX / CSV)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog impor"
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Step 1 & 2 Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Step 1: Download template */}
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
                  1
                </span>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-700">
                  Unduh Template Resmi
                </h4>
              </div>
              <p className="text-xs text-stone-600">
                Gunakan template terversi (XLSX atau CSV UTF-8) yang memuat instruksi NIK teks, asnaf, dan rincian bantuan.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={downloadingFormat !== null}
                  onClick={() => handleDownloadTemplate("xlsx")}
                  className="flex-1 text-xs"
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {downloadingFormat === "xlsx" ? "Mengunduh…" : "Template XLSX"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={downloadingFormat !== null}
                  onClick={() => handleDownloadTemplate("csv")}
                  className="flex-1 text-xs"
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {downloadingFormat === "csv" ? "Mengunduh…" : "Alternatif CSV"}
                </Button>
              </div>
            </div>

            {/* Step 2: Upload file */}
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">
                  2
                </span>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-700">
                  Unggah Berkas Tabular
                </h4>
              </div>
              <p className="text-xs text-stone-600">
                Pilih berkas XLSX atau CSV yang telah diisi untuk divalidasi dan diperiksa pratinjaunya.
              </p>
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileSelected}
                  className="hidden"
                  id="beneficiary-file-input"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={loadingPreview}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full text-xs"
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  {loadingPreview ? "Membaca & Memvalidasi…" : "Pilih Berkas Spreadsheet"}
                </Button>
              </div>
            </div>
          </div>

          {/* Error display */}
          {error && (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-rose-900">
                <AlertCircle className="h-4 w-4 text-rose-600" />
                Gagal Memproses Berkas
              </div>
              <p>{error}</p>
            </div>
          )}

          {/* Preview Section */}
          {preview && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-200 pt-4">
                <h4 className="text-sm font-semibold text-stone-900">
                  Hasil Pembacaan: <span className="font-mono font-normal text-stone-700">{preview.fileName}</span>
                </h4>
                {preview.isPartial && (
                  <Badge variant="warning" className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Total Parsial (Belum Lengkap)
                  </Badge>
                )}
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center">
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <div className="text-xl font-bold text-stone-900">{preview.uniqueBeneficiaryCount}</div>
                  <div className="text-[11px] font-medium text-stone-500">Penerima Unik</div>
                </div>
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <div className="text-xl font-bold text-stone-900">{preview.aidLineCount}</div>
                  <div className="text-[11px] font-medium text-stone-500">Rincian Bantuan</div>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                  <div className="text-xl font-bold text-emerald-800">{preview.validRowsCount}</div>
                  <div className="text-[11px] font-medium text-emerald-700">Baris Valid</div>
                </div>
                <div
                  className={`rounded-xl border p-3 ${
                    preview.invalidRowsCount > 0
                      ? "border-rose-300 bg-rose-50/70"
                      : "border-stone-200 bg-stone-50"
                  }`}
                >
                  <div
                    className={`text-xl font-bold ${
                      preview.invalidRowsCount > 0 ? "text-rose-800" : "text-stone-900"
                    }`}
                  >
                    {preview.invalidRowsCount}
                  </div>
                  <div
                    className={`text-[11px] font-medium ${
                      preview.invalidRowsCount > 0 ? "text-rose-700" : "text-stone-500"
                    }`}
                  >
                    Baris Salah
                  </div>
                </div>
              </div>

              {/* Totals by Unit */}
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-xs">
                <div className="font-semibold text-stone-700 mb-1">Total Menurut Unit:</div>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(preview.totalsByUnit).map(([unit, total]) => (
                    <div key={unit} className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 border border-stone-200 font-mono">
                      <span className="font-semibold text-stone-900">{unit}:</span>
                      <span>{unit === "IDR" ? `Rp ${Number(total).toLocaleString("id-ID")}` : total}</span>
                    </div>
                  ))}
                  {Object.keys(preview.totalsByUnit).length === 0 && (
                    <span className="text-stone-400 italic">Belum ada total yang dapat dihitung.</span>
                  )}
                </div>
                {preview.isPartial && (
                  <p className="mt-2 text-[11px] text-amber-800">
                    * Total diberi label parsial karena terdapat baris keliru atau bantuan barang tanpa taksiran rupiah. Angka yang salah tidak diubah menjadi nol.
                  </p>
                )}
              </div>

              {/* Rows Preview Table */}
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-stone-600">
                  Pratinjau Seluruh Baris ({preview.allRowsPreview.length})
                </h5>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-stone-200 text-xs">
                  <table className="w-full border-collapse text-left" tabIndex={0} aria-label="Tabel pratinjau daftar penerima">
                    <thead className="sticky top-0 bg-stone-100 text-stone-600 font-semibold border-b border-stone-200">
                      <tr>
                        <th className="p-2 w-12 text-center">Baris</th>
                        <th className="p-2 w-20">Status</th>
                        <th className="p-2">Nama Penerima</th>
                        <th className="p-2">Identitas</th>
                        <th className="p-2">Asnaf</th>
                        <th className="p-2">Bantuan</th>
                        <th className="p-2">Kontak</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {preview.allRowsPreview.map((row) => (
                        <tr
                          key={row.rowNumber}
                          className={
                            row.isValid
                              ? "hover:bg-stone-50"
                              : "bg-rose-50/60 hover:bg-rose-50"
                          }
                        >
                          <td className="p-2 font-mono text-center text-stone-500">{row.rowNumber}</td>
                          <td className="p-2">
                            {row.isValid ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Sah
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                                <AlertCircle className="h-3.5 w-3.5" /> Salah
                              </span>
                            )}
                          </td>
                          <td className="p-2 font-medium text-stone-900">
                            {row.beneficiary?.name || row.rawCells.nama || <span className="text-stone-400 italic">(kosong)</span>}
                            {row.issues.length > 0 && (
                              <ul className="mt-1 space-y-0.5 text-[11px] text-rose-700">
                                {row.issues.map((iss, idx) => (
                                  <li key={idx} className={iss.isWarning ? "text-amber-700 font-medium" : "text-rose-700 font-medium"}>
                                    {iss.message}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="p-2 font-mono text-stone-700">
                            {row.beneficiary?.identityBasis.kind === "NIK"
                              ? row.beneficiary.identityBasis.value
                              : row.beneficiary?.identityBasis.description || row.rawCells.nik || "-"}
                          </td>
                          <td className="p-2 text-stone-700">{row.beneficiary?.asnaf || row.rawCells.asnaf || "-"}</td>
                          <td className="p-2 text-stone-700">
                            {row.aidLine ? (
                              row.aidLine.value.kind === "MONEY" ? (
                                `Rp ${Number(row.aidLine.value.amountRequestedIdr).toLocaleString("id-ID")}`
                              ) : (
                                `${row.aidLine.value.quantityRequested} ${row.aidLine.value.unit}`
                              )
                            ) : (
                              row.rawCells.nilai_idr || row.rawCells.jumlah_barang || "-"
                            )}
                          </td>
                          <td className="p-2 text-stone-600">
                            {row.beneficiary?.contact?.phone || row.rawCells.kontak_telepon || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-stone-200 bg-stone-50 px-6 py-4 rounded-b-2xl">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Batal
          </Button>

          {preview && (
            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              Terapkan ke Draf Pengajuan ({preview.uniqueBeneficiaryCount} Penerima)
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
