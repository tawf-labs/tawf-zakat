import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { formatQuantity } from "../../lib/reporting";
import type { DecisionReviewData } from "./disbursementClient";

const check = (ok: boolean | undefined) => (ok ? "Terpenuhi" : "Belum terpenuhi");

function Notice({ tone, title, children }: { tone: "amber" | "sky" | "red"; title: string; children: React.ReactNode }) {
  const Icon = tone === "amber" ? AlertTriangle : tone === "sky" ? Info : ShieldAlert;
  const styles = {
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    sky: "border-sky-300 bg-sky-50 text-sky-900",
    red: "border-red-300 bg-red-50 text-red-900",
  }[tone];
  return <div className={`flex items-start gap-2.5 rounded-lg border p-3 text-xs ${styles}`}>
    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
    <div><p className="font-semibold">{title}</p><p className="leading-relaxed">{children}</p></div>
  </div>;
}

/** Everything the official reviews before deciding: context, examination result, and who records what. */
export function DecisionReviewSummary({ review, signerAccount }: { review: DecisionReviewData; signerAccount: string }) {
  const { draft, program, examination, operator } = review;
  const checklist = examination.checklist;
  const ceiling = program?.referenceCeiling;
  return <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs">
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div><dt className="text-stone-500">Program</dt><dd className="font-semibold">{program?.name ?? "Tanpa program"}</dd></div>
      <div><dt className="text-stone-500">Versi pengajuan</dt><dd className="font-semibold">v{draft.version}</dd></div>
      <div><dt className="text-stone-500">Periode bantuan</dt><dd>{draft.aidPeriod?.start} s/d {draft.aidPeriod?.end}</dd></div>
      <div><dt className="text-stone-500">Pagu referensi</dt>
        <dd>{ceiling ? formatQuantity({ amount: ceiling, unit: "IDR" }) : "Tidak ditetapkan"}</dd></div>
    </dl>

    <section aria-label="Hasil pemeriksaan" className="rounded-lg border border-stone-200 bg-white p-3">
      <h4 className="mb-1 font-semibold text-stone-900">Hasil pemeriksaan</h4>
      <ul className="grid grid-cols-1 gap-1 md:grid-cols-3">
        <li>Administrasi: {check(checklist?.administrativeChecksOk)}</li>
        <li>Kelayakan penerima: {check(checklist?.eligibilityChecksOk)}</li>
        <li>Identitas alternatif: {checklist?.alternativeIdReviewed ? "Ditelaah" : "Belum ditelaah"}</li>
      </ul>
      {examination.notes && <p className="mt-1"><strong>Catatan pemeriksa:</strong> {examination.notes}</p>}
    </section>

    <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div><dt className="text-stone-500">Operator (petugas yang mencatat)</dt>
        <dd className="font-semibold">{operator.name}</dd><dd className="font-mono text-[11px]">{operator.account}</dd></div>
      <div><dt className="text-stone-500">Akun pengesah</dt>
        <dd className="font-mono text-[11px]">{signerAccount}</dd>
        {review.mandate && <dd>Mandat: {review.mandate.assignmentRef}</dd>}</div>
    </dl>

    <Notice tone="amber" title="Pagu referensi program">{review.referenceCeilingWarning}</Notice>
    <Notice tone="sky" title="Cakupan pengesahan">{review.quorumStatement}</Notice>
    {review.refusalReason && <Notice tone="red" title="Pengesahan belum dapat dilakukan">{review.refusalReason}</Notice>}
  </div>;
}
