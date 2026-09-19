import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertCircle, HelpCircle, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { fileToBase64, useOperationIds } from "../contributions/contributionUi";
import { AccessContextChanged } from "./privateRequests";
import { outcomeUnknown } from "./auditFindingClient";
import { AUDIT_ATTACHMENT_MAX_BYTES, type AuditFindingFileInput } from "../../../../shared/audit-findings";

/** A dialog that takes focus when it opens, closes on Escape and returns focus when it closes. */
export function AuditDialog({ title, onClose, children, footer, wide }: {
  title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/60 p-4">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`my-8 w-full ${wide ? "max-w-3xl" : "max-w-2xl"} rounded-2xl border border-stone-200 bg-white shadow-2xl focus:outline-none`}>
        <header className="flex items-start justify-between gap-3 border-b border-stone-200 p-5">
          <h2 id={titleId} className="text-lg font-bold text-stone-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Tutup" className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-emerald-600">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-5 p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-stone-200 p-4">{footer}</footer>}
      </div>
    </div>
  );
}

export type FileDraft = AuditFindingFileInput & { sizeBytes: number };

export const asFileInputs = (drafts: FileDraft[]): AuditFindingFileInput[] =>
  drafts.map(({ fileName, mimeType, contentBase64 }) => ({ fileName, mimeType, contentBase64 }));

/** A labelled, keyboard-reachable file picker with the chosen files listed beneath it. */
export function FileField({ label, hint, files, onChange, disabled }: {
  label: string; hint: string; files: FileDraft[]; onChange: (files: FileDraft[]) => void; disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState("");
  async function add(file: File | undefined) {
    if (!file) return;
    if (file.size > AUDIT_ATTACHMENT_MAX_BYTES) { setError(`Berkas ${file.name} melebihi 10 MB.`); return; }
    try {
      onChange([...files, { fileName: file.name, mimeType: file.type || "application/octet-stream", contentBase64: await fileToBase64(file), sizeBytes: file.size }]);
      setError("");
    } catch { setError(`Berkas ${file.name} tidak dapat dibaca.`); }
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-stone-700">{label}</label>
      <input id={id} type="file" disabled={disabled} aria-describedby={`${id}-hint`}
        onChange={e => { void add(e.target.files?.[0]); e.target.value = ""; }}
        className="block w-full text-xs file:mr-3 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold" />
      <p id={`${id}-hint`} className="text-xs text-stone-500">{hint}</p>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((file, index) => (
            <li key={`${file.fileName}-${index}`} className="flex items-center justify-between rounded bg-stone-100 px-2.5 py-1 text-xs">
              <span className="truncate">{file.fileName}</span>
              <button type="button" disabled={disabled} className="text-red-700 hover:underline" onClick={() => onChange(files.filter((_, i) => i !== index))}>
                Hapus
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Outcome = { kind: "refused"; message: string } | { kind: "unknown" } | null;

/**
 * One write at a time, with a stable operation id per intent. When the result is
 * unknown the id is kept, so trying again replays the recorded result instead of
 * writing twice; a refusal or success settles it.
 */
export function useAuditWrite() {
  const operations = useOperationIds();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  async function run<T>(intent: string, perform: (operationId: string) => Promise<T>): Promise<T | null> {
    setPending(true);
    setOutcome(null);
    try {
      const result = await perform(operations.operationFor(intent));
      operations.settle(intent);
      return result;
    } catch (error) {
      if (error instanceof AccessContextChanged) return null;
      if (outcomeUnknown(error)) setOutcome({ kind: "unknown" });
      else {
        operations.settle(intent);
        setOutcome({ kind: "refused", message: error instanceof Error ? error.message : "Permintaan ditolak." });
      }
      return null;
    } finally {
      setPending(false);
    }
  }
  return { pending, outcome, run, clear: () => setOutcome(null) };
}

export function WriteOutcome({ outcome, onReload }: { outcome: Outcome; onReload?: () => void }) {
  if (!outcome) return null;
  if (outcome.kind === "refused") {
    return (
      <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{outcome.message}</span>
      </div>
    );
  }
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-start gap-2">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Hasilnya belum diketahui: koneksi atau server terputus sebelum jawaban diterima. Muat ulang riwayat untuk melihat apakah sudah tercatat. Mengirim ulang isi yang sama tidak akan mencatat dua kali.</span>
      </p>
      {onReload && <Button size="sm" variant="outline" onClick={onReload}>Muat ulang riwayat</Button>}
    </div>
  );
}
