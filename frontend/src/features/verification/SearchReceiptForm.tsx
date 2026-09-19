import React, { useState, useEffect } from "react";
import { Search, Loader2, Lock } from "lucide-react";
import { Input } from "../../components/ui/Input";
import { useContributionLookup } from "./contributionApi";
import { LookupAlert } from "./LookupAlert";
import { CertificateCard } from "./CertificateCard";
import { OwnerReceiptCheck } from "./OwnerReceiptCheck";
import {
  DonorOtpAccess,
  DonorContributionView,
  getStoredDonorSession,
  clearStoredDonorSession,
} from "../donor";

interface SearchReceiptFormProps {
  initialTrxId?: string;
}

export function SearchReceiptForm({ initialTrxId = "" }: SearchReceiptFormProps) {
  const [input, setInput] = useState(initialTrxId);
  const [submittedId, setSubmittedId] = useState(initialTrxId.trim());
  const lookup = useContributionLookup(submittedId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = input.trim();
    if (cleanId === submittedId) lookup.refetch();
    else setSubmittedId(cleanId);
  };

  const result = lookup.isFetching ? undefined : lookup.data;
  const activeContributionId =
    result?.lookupStatus === "FOUND"
      ? result.contribution.contributionId || result.contribution.trxId
      : "";

  const [donorSession, setDonorSession] = useState<string | null>(null);

  useEffect(() => {
    if (activeContributionId) {
      setDonorSession(getStoredDonorSession(activeContributionId));
    } else {
      setDonorSession(null);
    }
  }, [activeContributionId]);

  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <form onSubmit={handleSubmit} className="rounded-3xl border border-[#dbe7dd] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <h3 className="font-serif text-xl font-bold text-[#17332c]">Telusuri Kontribusi Anda</h3>
          <p className="text-xs text-[#5e7a70] mt-1">
            Masukkan referensi penelusuran kontribusi (nomor transaksi) untuk melihat status pencatatannya.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="w-full flex-1">
            <Input
              aria-label="Referensi kontribusi"
              placeholder="Contoh: TRX-20260824-001 atau USDC-A1B2C3D4"
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
          <span>Nama dan nominal donatur tidak ditampilkan pada pencarian publik.</span>
        </p>
      </form>

      {result && result.lookupStatus !== "FOUND" && <LookupAlert status={result.lookupStatus} />}

      {result?.lookupStatus === "FOUND" && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <CertificateCard contribution={result.contribution} />

          {/* Accountless donor access via OTP */}
          {donorSession ? (
            <DonorContributionView
              contributionId={activeContributionId}
              sessionToken={donorSession}
              onLoggedOut={() => {
                clearStoredDonorSession(activeContributionId);
                setDonorSession(null);
              }}
            />
          ) : (
            <DonorOtpAccess
              contributionId={activeContributionId}
              hasContact={Boolean(result.contribution.hasContact)}
              initialContactMasked={result.contribution.contactMasked}
              onAuthenticated={(token) => {
                setDonorSession(token);
              }}
            />
          )}

          <OwnerReceiptCheck key={result.contribution.trxId} contribution={result.contribution} />
        </div>
      )}
    </div>
  );
}
