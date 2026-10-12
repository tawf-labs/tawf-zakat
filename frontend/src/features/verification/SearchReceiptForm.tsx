import React, { useState } from "react";
import { Search, Loader2, Lock } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { useContributionLookup } from "./contributionApi";
import { LookupAlert } from "./LookupAlert";
import { PublicReceiptProof } from "./PublicReceiptProof";
import { CertificateCard } from "./CertificateCard";
import { OwnerReceiptCheck } from "./OwnerReceiptCheck";
import { DonorAccessPanel } from "../donor";
import { isCampaignReference, useCampaignReceiptLookup } from "./campaignReceiptApi";
import { CampaignReceiptCard } from "./CampaignReceiptCard";

interface SearchReceiptFormProps {
  initialTrxId?: string;
}

export function SearchReceiptForm({ initialTrxId = "" }: SearchReceiptFormProps) {
  const [input, setInput] = useState(initialTrxId);
  const [submittedId, setSubmittedId] = useState(initialTrxId.trim());
  // One search box for both kinds of record; the reference prefix tells them apart.
  const campaign = isCampaignReference(submittedId);
  const contributionLookup = useContributionLookup(campaign ? "" : submittedId);
  const campaignLookup = useCampaignReceiptLookup(campaign ? submittedId : "");
  const lookup = campaign ? campaignLookup : contributionLookup;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = input.trim();
    if (cleanId === submittedId) lookup.refetch();
    else setSubmittedId(cleanId);
  };

  const result = contributionLookup.isFetching || campaign ? undefined : contributionLookup.data;
  const campaignResult = campaignLookup.isFetching || !campaign ? undefined : campaignLookup.data;

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <form onSubmit={handleSubmit} className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">Telusuri Kontribusi Anda</h3>
          <p className="text-xs text-[#5e7a70] mt-1">
            Masukkan nomor transaksi kontribusi atau kode bukti donasi kampanye untuk melihat status pencatatannya.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full flex-1">
            <Input
              aria-label="Referensi kontribusi"
              placeholder="Contoh: TRX-20260824-001 atau kode donasi kampanye CF-…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              leftAddon={<Search className="w-4 h-4 text-[#5e7a70]" />}
            />
          </div>
          <button
            type="submit"
            disabled={lookup.isFetching || !input.trim()}
            className="w-full sm:w-auto px-7 py-3 rounded-xl bg-[#17332c] hover:bg-[#1b765e] disabled:opacity-50 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
          >
            {lookup.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Cek Status</span>
          </button>
        </div>

        <p className="flex items-center gap-1.5 text-[11px] text-[#5e7a70]">
          <Lock className="w-3.5 h-3.5 text-[#1b765e]" />
          <span>Nama donatur tidak ditampilkan pada pencarian publik.</span>
        </p>
      </form>

      {result && result.lookupStatus !== "FOUND" && <LookupAlert status={result.lookupStatus} />}
      {campaignResult && campaignResult.lookupStatus !== "FOUND" && <LookupAlert status={campaignResult.lookupStatus} />}
      {campaignResult?.lookupStatus === "FOUND" && (
        <div className="animate-in fade-in duration-300">
          <CampaignReceiptCard receipt={campaignResult.receipt} />
        </div>
      )}

      {result?.lookupStatus === "FOUND" && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <CertificateCard contribution={result.contribution} />

          {/* Accountless donor access via OTP (#104); keyed so a new record never inherits an old session. */}
          {result.contribution.recordKind === "INSTITUTION_CONTRIBUTION" && (
            <>
              <PublicReceiptProof key={`proof-${result.contribution.trxId}`} reference={result.contribution.trxId} />
              <DonorAccessPanel key={result.contribution.trxId} reference={result.contribution.trxId} />
            </>
          )}

          {result.contribution.recordKind === "ONLINE_DONATION" && (
            <OwnerReceiptCheck key={result.contribution.trxId} contribution={result.contribution} />
          )}
        </div>
      )}
    </div>
  );
}
