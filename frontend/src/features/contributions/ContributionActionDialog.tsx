import type { ReactNode } from "react";
import { Button } from "../../components/ui/Button";

export const contributionFieldClass = "w-full text-sm border border-stone-300 rounded-lg p-2 focus:ring-1 focus:outline-none";

export function ContributionActionDialog({ title, summary, children, error, submitting, disabled, submitLabel, onSubmit, onClose }: {
  error?: string | null; title: string; summary: ReactNode; children: ReactNode; submitting: boolean; disabled?: boolean;
  submitLabel: string; onSubmit: () => void; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={title}
        className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl border border-stone-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-2">
          <div><h3 className="text-base font-bold text-stone-900">{title}</h3><div className="text-xs text-stone-500 mt-1">{summary}</div></div>
          <button onClick={onClose} disabled={submitting} aria-label="Tutup" className="text-stone-500">✕</button>
        </div>
        {error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        <div className="space-y-3 text-xs">{children}</div>
        <div className="flex justify-end gap-2 pt-3 border-t border-stone-200">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>Batal</Button>
          <Button size="sm" onClick={onSubmit} disabled={submitting || disabled}>{submitting ? "Menyimpan…" : submitLabel}</Button>
        </div>
      </div>
    </div>
  );
}
