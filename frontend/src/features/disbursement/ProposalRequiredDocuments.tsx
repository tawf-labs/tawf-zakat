import { useState } from "react";
import { CheckCircle2, Circle, Search } from "lucide-react";
import type { Beneficiary, DisbursementPolicy, ProposalDocument } from "./disbursementClient";

export type RequiredDocument = { key: string; label: string; done: boolean; beneficiaryId: string | null };

/** The documents the institution's policy will ask for at submission, and which are already attached. */
export function requiredDocuments(policy: Pick<DisbursementPolicy, "requireProposalLetter" | "requireIdentityDoc" | "requireAlternativeIdProof" | "requireGuardianProof">,
  beneficiaries: Beneficiary[], documents: Pick<ProposalDocument, "category" | "beneficiaryId">[]): RequiredDocument[] {
  const items: RequiredDocument[] = [];
  if (policy.requireProposalLetter) {
    items.push({ key: "letter", label: "Surat permohonan (umum untuk seluruh pengajuan)", done: documents.some((d) => d.category === "PROPOSAL_LETTER"), beneficiaryId: null });
  }
  const byBeneficiary = new Map<string, Pick<ProposalDocument, "category">[]>();
  for (const d of documents) {
    if (d.beneficiaryId) byBeneficiary.set(d.beneficiaryId, [...(byBeneficiary.get(d.beneficiaryId) ?? []), d]);
  }
  beneficiaries.forEach((b, index) => {
    const own = byBeneficiary.get(b.id) ?? [];
    const name = b.name || `Penerima ${index + 1}`;
    if (policy.requireIdentityDoc && b.identityBasis.kind === "NIK") {
      items.push({ key: `id:${b.id}`, label: `KTP/KK untuk ${name}`, done: own.some((d) => d.category === "BENEFICIARY_IDENTITY" || d.category === "PROPOSAL_LETTER"), beneficiaryId: b.id });
    }
    if (policy.requireAlternativeIdProof && b.identityBasis.kind === "ALTERNATIVE") {
      items.push({ key: `alt:${b.id}`, label: `Bukti identitas alternatif untuk ${name}`, done: own.some((d) => d.category === "ALTERNATIVE_IDENTITY_PROOF"), beneficiaryId: b.id });
    }
    if (policy.requireGuardianProof && b.guardian) {
      items.push({ key: `guardian:${b.id}`, label: `Surat kuasa/perwalian untuk ${name}`, done: own.some((d) => d.category === "REPRESENTATION_PROOF"), beneficiaryId: b.id });
    }
  });
  return items;
}

/**
 * A large roster means a large checklist (one line per mustahik's KTP/KK). The
 * attached ones need no action, so the progress is summarised and only the
 * gaps are listed — searchable and in a bounded scroll box.
 */
export function ProposalRequiredDocuments({ items }: { items: RequiredDocument[] }) {
  const [query, setQuery] = useState("");
  if (!items.length) {
    return <p className="text-xs text-stone-500">Kebijakan lembaga tidak mewajibkan dokumen tertentu untuk pengajuan ini.</p>;
  }
  const missing = items.filter((item) => !item.done);
  const done = items.length - missing.length;
  const percent = Math.round((done / items.length) * 100);
  const recipients = new Set(items.flatMap((item) => (item.beneficiaryId ? [item.beneficiaryId] : [])));
  const incomplete = new Set(missing.flatMap((item) => (item.beneficiaryId ? [item.beneficiaryId] : [])));
  const needle = query.trim().toLowerCase();
  const shown = needle ? missing.filter((item) => item.label.toLowerCase().includes(needle)) : missing;

  return (
    <div aria-label="Dokumen yang wajib dilampirkan" className="space-y-3 text-xs">
      <div className="space-y-1.5">
        <p className="flex flex-wrap items-center gap-1.5 font-semibold text-stone-800">
          {missing.length ? <Circle aria-hidden className="h-3.5 w-3.5 shrink-0 text-amber-600" /> : <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
          Dokumen wajib: {done} dari {items.length} terlampir
          {recipients.size > 0 && (
            <span className="font-normal text-stone-600">· {recipients.size - incomplete.size} dari {recipients.size} penerima lengkap</span>
          )}
        </p>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={done}
          aria-label="Kelengkapan dokumen wajib"
          className="h-2 overflow-hidden rounded-full bg-stone-200"
        >
          <div className={`h-full rounded-full ${missing.length ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${percent}%` }} />
        </div>
      </div>

      {missing.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-amber-900">Belum dilampirkan ({missing.length})</p>
            {missing.length > 5 && (
              <label className="relative ml-auto w-full sm:w-64">
                <span className="sr-only">Cari dokumen yang belum dilampirkan</span>
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari nama penerima…"
                  className="w-full rounded-lg border border-stone-300 bg-white py-1.5 pl-8 pr-2 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </label>
            )}
          </div>
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50/60 p-2">
            {shown.map((item) => (
              <li key={item.key} className="flex items-start gap-1.5 text-amber-900">
                <Circle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{item.label}</span>
              </li>
            ))}
            {shown.length === 0 && <li className="text-stone-500">Tidak ada yang cocok dengan “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
