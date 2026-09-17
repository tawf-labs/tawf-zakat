import { useRef, useState, type ReactNode } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { saveBlob } from "../../lib/download";
import type { PrivateRequests } from "../workspace/privateRequests";
import { beneficiaryTemplateFileName, downloadBeneficiaryTemplate, type TabularFormat } from "./disbursementClient";

function Step({ number, title, description, children }: { number: number; title: string; description: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">{number}</span>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-700">{title}</h4>
      </div>
      <p className="text-xs text-stone-600">{description}</p>
      {children}
    </div>
  );
}

export function BeneficiaryImportSteps({
  requests,
  loading,
  onFile,
  onError,
}: {
  requests: PrivateRequests;
  loading: boolean;
  onFile: (file: File) => void;
  onError: (message: string) => void;
}) {
  const [downloading, setDownloading] = useState<TabularFormat | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function downloadTemplate(format: TabularFormat) {
    setDownloading(format);
    try {
      saveBlob(beneficiaryTemplateFileName(format), await downloadBeneficiaryTemplate(requests, format));
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Gagal mengunduh template daftar penerima.");
    } finally {
      setDownloading(null);
    }
  }

  const templateButton = (format: TabularFormat, label: string) => (
    <Button type="button" variant="outline" size="sm" disabled={downloading !== null}
      onClick={() => downloadTemplate(format)} className="flex-1 text-xs">
      <Download className="mr-1.5 h-3.5 w-3.5" />
      {downloading === format ? "Mengunduh…" : label}
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Step number={1} title="Unduh Template Resmi"
        description="Gunakan template terversi (XLSX atau CSV UTF-8) yang memuat instruksi NIK teks, asnaf, dan rincian bantuan.">
        <div className="flex gap-2">
          {templateButton("xlsx", "Template XLSX")}
          {templateButton("csv", "Alternatif CSV")}
        </div>
      </Step>
      <Step number={2} title="Unggah Berkas Tabular"
        description="Pilih berkas XLSX atau CSV yang telah diisi untuk divalidasi dan diperiksa pratinjaunya.">
        <input
          type="file"
          ref={fileInput}
          accept=".xlsx,.csv"
          aria-label="Berkas daftar penerima"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onFile(file);
          }}
        />
        <Button type="button" size="sm" disabled={loading} onClick={() => fileInput.current?.click()} className="w-full text-xs">
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {loading ? "Membaca & Memvalidasi…" : "Pilih Berkas Spreadsheet"}
        </Button>
      </Step>
    </div>
  );
}
