import type { ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import type { AuthorityManagement } from "./useAuthorityManagement";

export function AuthorityManagementFrame({ label, title, createLabel, creating, toggle, state, error, children }: {
  label: string; title: string; createLabel: string; creating: boolean; toggle: () => void;
  state: AuthorityManagement; error?: Error | null; children: ReactNode;
}) {
  return <section aria-label={label} className="rounded-2xl border border-stone-200 bg-white p-6 shadow-xs">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 pb-4">
      <h3 className="text-base font-semibold text-stone-900">{title}</h3>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.reload()}>Muat ulang</Button>
        <Button size="sm" disabled={state.busy} onClick={toggle}>{creating ? "Batal" : createLabel}</Button>
      </div>
    </div>
    {state.message && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{state.message}</p>}
    {(state.error || error) && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error || error?.message}</p>}
    <div className="mt-4 space-y-3">{children}</div>
  </section>;
}
