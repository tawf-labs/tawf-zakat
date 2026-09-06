import React, { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { LedgerIssueList } from "./LedgerIssueList";
import type { BucketDimension, LedgerTextResult } from "./ledgerText";
import { isSupportedLedgerFile, unsupportedFileMessage } from "./reconciliationTools";

export type LedgerSideDraft = { label: string; text: string; dimension: BucketDimension };

interface LedgerSideEditorProps {
  title: string;
  hint: string;
  draft: LedgerSideDraft;
  onDraftChange: (draft: LedgerSideDraft) => void;
  parsed: LedgerTextResult;
}

const ACCEPTED_FILE_TYPES = ".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values";

const fieldClass =
  "mt-1.5 w-full rounded-xl border border-[#dbe7dd] bg-[#f9fbf9] px-3 py-2 text-sm text-[#17332c] outline-none focus:border-[#1b765e]";
const labelClass = "block text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]";

export function LedgerSideEditor({
  title,
  hint,
  draft,
  onDraftChange,
  parsed,
}: LedgerSideEditorProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);

  const patch = (change: Partial<LedgerSideDraft>) => onDraftChange({ ...draft, ...change });

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedLedgerFile(file)) {
      setFileError(unsupportedFileMessage(file));
      setLoadedFileName(null);
      return;
    }
    setFileError(null);
    patch({ text: await file.text(), label: file.name.replace(/\.[^.]+$/, "") });
    setLoadedFileName(file.name);
  };

  return (
    <div className="flex flex-col rounded-2xl border border-[#dbe7dd] bg-white p-5 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-serif text-lg font-bold text-[#17332c]">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[#5e7a70]">{hint}</p>
        </div>
        <FileSpreadsheet className="mt-1 h-5 w-5 shrink-0 text-[#1b765e]" />
      </div>

      <label className={`mt-4 ${labelClass}`}>Nama laporan</label>
      <input
        type="text"
        value={draft.label}
        onChange={(event) => patch({ label: event.target.value })}
        className={fieldClass}
        placeholder="Rekap Laporan Zakat Wilayah Riau 2024"
      />

      <label className={`mt-4 ${labelClass}`}>Dimensi kolom jenis dana</label>
      <select
        value={draft.dimension}
        onChange={(event) => patch({ dimension: event.target.value as BucketDimension })}
        className={fieldClass}
      >
        <option value="JENIS_DANA">Jenis dana BAZNAS (Zakat, Fitrah, Infak/Sedekah, Kurban, DSKL)</option>
        <option value="BEBAS">Bebas - dimensi lain, misalnya jenis Pengelola Zakat</option>
      </select>

      <div className="mt-4 flex items-end justify-between gap-3">
        <label className={labelClass}>Data laporan</label>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#dbe7dd] px-3 py-1 text-[11px] font-semibold text-[#1b765e] transition-colors hover:bg-[#f4f8f3]"
        >
          <Upload className="h-3 w-3" />
          Unggah berkas
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_FILE_TYPES}
          className="hidden"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <textarea
        value={draft.text}
        onChange={(event) => patch({ text: event.target.value })}
        rows={10}
        spellCheck={false}
        className={`${fieldClass} resize-y font-mono text-[12px] leading-relaxed`}
        placeholder={"PZ-1401;BAZNAS Kab. Kampar;Zakat;on;1.500.000.000\nGRAND TOTAL;Total tercetak;-;on;1.500.000.000"}
      />

      <p className="mt-2 text-[11px] text-[#5e7a70]">
        {parsed.side.entries.length} entri terbaca
        {parsed.side.declaredTotals?.length
          ? ` - ${parsed.side.declaredTotals.length} baris total`
          : ""}
        {loadedFileName ? ` - dari ${loadedFileName}` : ""}
      </p>

      {fileError && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800">
          {fileError}
        </p>
      )}

      <LedgerIssueList issues={parsed.issues} />
    </div>
  );
}
