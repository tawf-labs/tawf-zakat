import type { ReactNode } from "react";
import { AlertCircle, Award, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { AuthorityManagement } from "./useAuthorityManagement";

export function AuthorityManagementFrame({ label, title, createLabel, creating, toggle, state, error, children }: {
  label: string; title: string; createLabel: string; creating: boolean; toggle: () => void;
  state: AuthorityManagement; error?: Error | null; children: ReactNode;
}) {
  const isMandate = label.toLowerCase().includes("mandat");

  return <section aria-label={label} className="rounded-2xl border border-[#dbe7dd] bg-white p-6 shadow-xs">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone-100 pb-5">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/80 p-2.5 text-[#1b765e]">
          {isMandate ? <Award className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
        </div>
        <div>
          <h3 className="font-serif text-lg font-semibold text-[#17332c]">{title}</h3>
          <p className="mt-0.5 text-xs text-stone-600">
            {isMandate
              ? "Kewenangan formal perorangan amil yang disahkan dengan SK dan batas nominal."
              : "Daftar alamat wallet lembaga resmi yang dapat digunakan untuk menandatangani bukti publik."}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={state.busy} onClick={() => void state.reload()}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 text-stone-500 ${state.busy ? "animate-spin" : ""}`} />
          Muat ulang
        </Button>
        <Button size="sm" disabled={state.busy} onClick={toggle}>
          {creating ? "Batal" : createLabel}
        </Button>
      </div>
    </div>

    {state.message && (
      <div role="status" className="mt-4 flex items-center gap-2.5 rounded-xl border border-emerald-200/90 bg-emerald-50/90 p-3.5 text-sm text-emerald-900 shadow-2xs">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
        <span>{state.message}</span>
      </div>
    )}

    {(state.error || error) && (
      <div role="alert" className="mt-4 flex items-center gap-2.5 rounded-xl border border-red-200/90 bg-red-50/90 p-3.5 text-sm text-red-900 shadow-2xs">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
        <span>{state.error || error?.message}</span>
      </div>
    )}

    <div className="mt-5 space-y-3.5">{children}</div>
  </section>;
}
