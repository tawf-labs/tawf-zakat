import React, { useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import type { LedgerTextIssue } from "./ledgerText";
import { isSupportedLedgerFile, unsupportedFileMessage } from "./reconciliationTools";

interface LedgerSideEditorProps {
  title: string;
  hint: string;
  label: string;
  onLabelChange: (label: string) => void;
  text: string;
  onTextChange: (text: string) => void;
  entryCount: number;
  declaredTotalCount: number;
  issues: LedgerTextIssue[];
  actions?: React.ReactNode;
}

const ACCEPTED_FILE_TYPES = ".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values";

export function LedgerSideEditor({
  title,
  hint,
  label,
  onLabelChange,
  text,
  onTextChange,
  entryCount,
  declaredTotalCount,
  issues,
  actions,
}: LedgerSideEditorProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!isSupportedLedgerFile(file)) {
      setFileError(unsupportedFileMessage(file));
      setLoadedFileName(null);
      return;
    }
    setFileError(null);
    const text = await file.text();
    onTextChange(text);
    setLoadedFileName(file.name);
    if (!label.trim() || label.startsWith("Rekap Laporan") || label.startsWith("Laporan Kinerja")) {
      onLabelChange(file.name.replace(/\.[^.]+$/, ""));
    }
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

      <label className="mt-4 block text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
        Nama laporan
      </label>
      <input
        type="text"
        value={label}
        onChange={(event) => onLabelChange(event.target.value)}
        className="mt-1.5 w-full rounded-xl border border-[#dbe7dd] bg-[#f9fbf9] px-3 py-2 text-sm text-[#17332c] outline-none focus:border-[#1b765e]"
        placeholder="Rekap Laporan Zakat Wilayah Riau 2024"
      />

      <div className="mt-4 flex items-end justify-between gap-3">
        <label className="block text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">
          Data laporan
        </label>
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
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        rows={10}
        spellCheck={false}
        className="mt-1.5 w-full resize-y rounded-xl border border-[#dbe7dd] bg-[#f9fbf9] px-3 py-2 font-mono text-[12px] leading-relaxed text-[#17332c] outline-none focus:border-[#1b765e]"
        placeholder={"PZ-1401;BAZNAS Kab. Kampar;Zakat;on;1.500.000.000\nPZ-1471;BAZNAS Kota Pekanbaru;Infak/Sedekah;on;240.000.000\nGRAND TOTAL;Total tercetak;-;on;1.740.000.000"}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5e7a70]">
        <span>
          {entryCount} entri terbaca
          {declaredTotalCount > 0 ? ` - ${declaredTotalCount} baris total` : ""}
          {loadedFileName ? ` - dari ${loadedFileName}` : ""}
        </span>
        {actions}
      </div>

      {fileError && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-relaxed text-red-800">
          {fileError}
        </p>
      )}

      {issues.length > 0 && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {issues.length} baris belum terbaca
          </p>
          <ul className="mt-1.5 space-y-1 text-xs text-amber-900">
            {issues.slice(0, 6).map((issue) => (
              <li key={`${issue.line}-${issue.message}`}>{issue.message}</li>
            ))}
            {issues.length > 6 && <li>...dan {issues.length - 6} baris lainnya.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
