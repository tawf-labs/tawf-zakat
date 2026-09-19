import { CheckCircle2, XCircle } from "lucide-react";
import type { DonorRecoveryRequestRecord } from "./contributionClient";

export function DonorRecoveryDecision({ record }: { record: DonorRecoveryRequestRecord }) {
  return (
    <div
      className={`p-4 rounded-2xl border text-xs space-y-1.5 ${
        record.status === "APPROVED"
          ? "bg-emerald-50 border-emerald-200 text-emerald-900"
          : "bg-rose-50 border-rose-200 text-rose-900"
      }`}
    >
      <div className="font-bold flex items-center gap-1.5">
        {record.status === "APPROVED" ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
            <span>Permohonan Telah Disetujui</span>
          </>
        ) : (
          <>
            <XCircle className="w-4 h-4 text-rose-700" />
            <span>Permohonan Telah Ditolak</span>
          </>
        )}
      </div>
      <p className="leading-relaxed">Alasan: {record.decisionReason || "-"}</p>
      <p className="text-[11px] text-stone-500 font-mono">
        Diputuskan oleh: {record.decidedByAccount || "-"} pada{" "}
        {record.decidedAt
          ? new Date(record.decidedAt * 1000).toLocaleString("id-ID")
          : "-"}
      </p>
    </div>
  );
}
