import { CheckCircle2, Clock, ShieldCheck, X } from "lucide-react";
import { Badge } from "../../components/ui/Badge";
import type { ContributionStatus } from "./contributionClient";

export function ContributionStatusBadge({ status }: { status: ContributionStatus }) {
  switch (status) {
    case "RECEIVED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <span>Diterima</span>
        </span>
      );
    case "RECONCILED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
          <span>Terekonsiliasi</span>
        </span>
      );
    case "ENDORSED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Disahkan Pejabat</span>
        </span>
      );
    case "REJECTED":
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200">
          <X className="w-3.5 h-3.5 text-rose-600" />
          <span>Ditolak</span>
        </span>
      );
    default:
      return <Badge>{status}</Badge>;
  }
}
