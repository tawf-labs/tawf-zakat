import { useEffect } from "react";
import { Loader2, LogOut, ShieldCheck } from "lucide-react";
import { DonorSessionEndedError, type DonorSessionRecord } from "./donorClient";
import { useDonorAllocations, useDonorContribution } from "./donorQueries";
import { DonorContributionSummary } from "./DonorContributionSummary";
import { DonorAllocationList } from "./DonorAllocationList";
import { Notice } from "./DonorNotice";

type DonorContributionViewProps = {
  session: DonorSessionRecord;
  onLogout: () => void;
  /** The server refused the session; the panel forgets it and says why. */
  onSessionEnded: (message: string) => void;
};

export function DonorContributionView({ session, onLogout, onSessionEnded }: DonorContributionViewProps) {
  const contribution = useDonorContribution(session);
  const allocations = useDonorAllocations(session);

  const ended = [contribution.error, allocations.error].find((e) => e instanceof DonorSessionEndedError);
  useEffect(() => {
    if (ended) onSessionEnded(ended.message);
  }, [ended, onSessionEnded]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-tawf-green text-white p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-[#70bd9d]" aria-hidden />
          <div>
            <span className="text-[11px] uppercase tracking-wider text-[#70bd9d] font-bold block">Sesi Donatur Aktif</span>
            <span className="text-xs text-white/80">
              Berlaku sampai{" "}
              {new Date(session.expiresAt * 1000).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}{" "}
              dan hanya untuk kontribusi ini.
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          className="w-full sm:w-auto px-5 py-2 rounded-full border border-white/30 hover:bg-white/10 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2 cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden />
          <span>Tutup Sesi</span>
        </button>
      </div>

      {contribution.isPending ? (
        <div className="rounded-3xl border border-tawf-green-10 bg-white p-12 text-center shadow-sm">
          <Loader2 className="w-8 h-8 animate-spin text-tawf-green-light mx-auto" aria-hidden />
          <p className="text-sm font-medium text-tawf-green mt-4">Memuat rincian kontribusi Anda...</p>
        </div>
      ) : contribution.isError ? (
        <Notice tone="error">{contribution.error.message}</Notice>
      ) : (
        <>
          <DonorContributionSummary contribution={contribution.data} />
          <DonorAllocationList
            allocations={allocations.data}
            error={allocations.isError ? allocations.error.message : null}
          />
        </>
      )}
    </div>
  );
}
