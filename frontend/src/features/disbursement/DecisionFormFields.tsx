import { Input } from "../../components/ui/Input";
import type { DecisionReviewData } from "./disbursementClient";
import type { DecisionForm } from "./useProposalDecision";

const textarea = "w-full rounded-md border border-stone-300 p-2 text-xs text-stone-900 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";

export function DecisionFormFields({ review, form, disabled, onChange }: {
  review: DecisionReviewData;
  form: DecisionForm;
  disabled: boolean;
  onChange: (patch: Partial<DecisionForm>) => void;
}) {
  const signers = [
    { account: review.availableSigners.personal, label: "Akun pribadi pejabat" },
    ...review.availableSigners.institutional.map(account => ({ account: account.accountAddress, label: account.label })),
  ];
  return <fieldset disabled={disabled} className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 text-xs">
    <legend className="px-1 font-semibold uppercase tracking-wider text-stone-900">Keputusan lembaga</legend>

    <div role="radiogroup" aria-label="Keputusan" className="flex gap-3">
      {(["APPROVE", "REJECT"] as const).map(action => <label key={action} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2.5 ${
        form.action === action ? "border-stone-900 bg-stone-50 font-semibold" : "border-stone-200"}`}>
        <input type="radio" name="decisionAction" checked={form.action === action} onChange={() => onChange({ action })} />
        {action === "APPROVE" ? "Setujui pengajuan" : "Tolak pengajuan"}
      </label>)}
    </div>

    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <label className="block font-medium text-stone-700">Nomor SK / berita acara pleno *
        <Input className="mt-1 text-xs" placeholder="Contoh: SK-014/DIR/IX/2026" value={form.decisionReference}
          onChange={e => onChange({ decisionReference: e.target.value })} />
      </label>
      <label className="block font-medium text-stone-700">Tanggal penetapan *
        <Input className="mt-1 text-xs" type="date" value={form.decisionDate} onChange={e => onChange({ decisionDate: e.target.value })} />
      </label>
    </div>

    <label className="block font-medium text-stone-700">Berkas SK / berita acara *
      <input type="file" className="mt-1 block w-full text-xs" onChange={e => onChange({ documentFile: e.target.files?.[0] ?? null })} />
      <span className="font-normal text-stone-500">Isi berkas ini dikunci oleh tanda tangan pengesahan.</span>
    </label>

    {form.action === "REJECT" && <label className="block font-medium text-red-700">Alasan penolakan *
      <textarea rows={2} className={`mt-1 ${textarea}`} value={form.rejectionReason}
        onChange={e => onChange({ rejectionReason: e.target.value })} />
    </label>}
    <label className="block font-medium text-stone-700">Catatan keputusan (opsional)
      <textarea rows={2} className={`mt-1 ${textarea}`} value={form.notes} onChange={e => onChange({ notes: e.target.value })} />
    </label>

    <div role="radiogroup" aria-label="Akun pengesah" className="space-y-2">
      <p className="font-medium text-stone-700">Akun pengesah</p>
      {signers.map(signer => <label key={signer.account} className="flex cursor-pointer items-center gap-2">
        <input type="radio" name="signerAccount" checked={form.signerAccount === signer.account}
          onChange={() => onChange({ signerAccount: signer.account })} />
        <span>{signer.label}</span><span className="font-mono text-[11px] text-stone-500">{signer.account}</span>
      </label>)}
    </div>
  </fieldset>;
}
