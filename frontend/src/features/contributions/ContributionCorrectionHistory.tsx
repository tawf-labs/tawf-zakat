import { Edit3 } from "lucide-react";
import { formatNominal, type ContributionCorrection, type CurrencyUnit } from "./contributionClient";
import { at } from "./contributionUi";

export function ContributionCorrectionHistory({ corrections, currencyUnit }: {
  corrections: ContributionCorrection[]; currencyUnit: CurrencyUnit;
}) {
  if (!corrections.length) return null;
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-stone-900 flex items-center gap-1.5">
        <Edit3 className="w-4 h-4 text-amber-600" />
        <span>Riwayat Koreksi Nominal & Versi ({corrections.length})</span>
      </h4>
      <div className="space-y-2">
        {corrections.map((cor) => (
          <div
            key={cor.id}
            className="text-xs p-3 rounded-xl border border-amber-200 bg-amber-50/40 space-y-1.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-stone-900 flex flex-wrap items-center gap-2">
                <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-mono text-[10px]">
                  V{cor.fromVersion} → V{cor.toVersion}
                </span>
                <span>Jenis: {cor.correctionType}</span>
              </div>
              <span className="text-[11px] text-stone-400">{at(cor.createdAt)}</span>
            </div>
            <div className="text-stone-700">
              <span className="font-medium">Perubahan Nominal:</span>{" "}
              <span className="font-mono line-through text-stone-400">
                {formatNominal(cor.fromAmountExact, currencyUnit)}
              </span>{" "}
              →{" "}
              <span className="font-mono font-bold text-amber-900">
                {formatNominal(cor.toAmountExact, currencyUnit)}
              </span>
            </div>
            <div className="text-stone-600 italic">"{cor.reason}"</div>
            {cor.sourceProofRef && (
              <div className="text-stone-500 text-[11px]">
                Referensi Bukti: <code className="bg-white px-1 py-0.5 rounded border">{cor.sourceProofRef}</code>
              </div>
            )}
            <div className="text-stone-400 text-[11px] font-mono break-all">Oleh: {cor.actorAccount}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
