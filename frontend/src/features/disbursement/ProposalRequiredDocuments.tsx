import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { getInstitutionPolicy, type Beneficiary, type DisbursementPolicy, type ProposalDocument } from "./disbursementClient";

export type RequiredDocument = { key: string; label: string; done: boolean };

/** The documents the institution's policy will ask for at submission, and which are already attached. */
export function requiredDocuments(policy: Pick<DisbursementPolicy, "requireProposalLetter" | "requireIdentityDoc" | "requireAlternativeIdProof" | "requireGuardianProof">,
  beneficiaries: Beneficiary[], documents: Pick<ProposalDocument, "category" | "beneficiaryId">[]): RequiredDocument[] {
  const items: RequiredDocument[] = [];
  if (policy.requireProposalLetter) {
    items.push({ key: "letter", label: "Surat permohonan (umum untuk seluruh pengajuan)", done: documents.some((d) => d.category === "PROPOSAL_LETTER") });
  }
  beneficiaries.forEach((b, index) => {
    const own = documents.filter((d) => d.beneficiaryId === b.id);
    const name = b.name || `Penerima ${index + 1}`;
    if (policy.requireIdentityDoc && b.identityBasis.kind === "NIK") {
      items.push({ key: `id:${b.id}`, label: `KTP/KK untuk ${name}`, done: own.some((d) => d.category === "BENEFICIARY_IDENTITY" || d.category === "PROPOSAL_LETTER") });
    }
    if (policy.requireAlternativeIdProof && b.identityBasis.kind === "ALTERNATIVE") {
      items.push({ key: `alt:${b.id}`, label: `Bukti identitas alternatif untuk ${name}`, done: own.some((d) => d.category === "ALTERNATIVE_IDENTITY_PROOF") });
    }
    if (policy.requireGuardianProof && b.guardian) {
      items.push({ key: `guardian:${b.id}`, label: `Surat kuasa/perwalian untuk ${name}`, done: own.some((d) => d.category === "REPRESENTATION_PROOF") });
    }
  });
  return items;
}

export function ProposalRequiredDocuments({ requests, beneficiaries, documents }: {
  requests: PrivateRequests; beneficiaries: Beneficiary[]; documents: ProposalDocument[];
}) {
  const [policy, setPolicy] = useState<DisbursementPolicy | null>(null);
  useEffect(() => {
    let disposed = false;
    getInstitutionPolicy(requests).then((value) => { if (!disposed) setPolicy(value); }).catch(() => undefined);
    return () => { disposed = true; };
  }, [requests]);
  if (!policy) return null;
  const items = requiredDocuments(policy, beneficiaries, documents);
  if (!items.length) return null;
  const missing = items.filter((item) => !item.done).length;
  return (
    <div aria-label="Dokumen yang wajib dilampirkan" className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs">
      <p className="font-semibold text-stone-800">
        Dokumen wajib sebelum diajukan {missing ? `(${missing} belum dilampirkan)` : "(lengkap)"}
      </p>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.key} className={`flex items-start gap-1.5 ${item.done ? "text-emerald-800" : "text-amber-800"}`}>
            {item.done ? <CheckCircle2 aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Circle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <span>{item.label}{item.done ? " — sudah dilampirkan" : " — belum dilampirkan"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
