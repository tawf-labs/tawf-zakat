import { useState } from "react";
import type { CertificateLookup } from "./usePublicCertificate";

interface Props {
  initialInstitutionId: string;
  initialCertificateId: string;
  onEdit: () => void;
  onVerify: (lookup: CertificateLookup) => void;
}

export function CertificateSearchForm({ initialInstitutionId, initialCertificateId, onEdit, onVerify }: Props) {
  const [institutionId, setInstitutionId] = useState(initialInstitutionId);
  const [certificateId, setCertificateId] = useState(initialCertificateId);

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (institutionId.trim() && certificateId.trim()) {
          onVerify({ institutionId: institutionId.trim(), certificateId: certificateId.trim() });
        }
      }}
    >
      <label className="flex-1 text-sm">
        ID Lembaga
        <input
          className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
          value={institutionId}
          onChange={(event) => { setInstitutionId(event.target.value); onEdit(); }}
        />
      </label>
      <label className="flex-1 text-sm">
        ID Sertifikat
        <input
          className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
          value={certificateId}
          onChange={(event) => { setCertificateId(event.target.value); onEdit(); }}
        />
      </label>
      <button type="submit" className="rounded-full bg-[#0F3D30] px-6 py-2.5 text-xs font-medium uppercase tracking-wider text-[#F9F6F0]">
        Periksa
      </button>
    </form>
  );
}
