import { ShieldCheck, ShieldAlert } from "lucide-react";
import { formatQuantity } from "../../lib/reporting";
import type { WireAmilShare } from "./types";

const row = (label: string, value: string) => (
  <div key={label}>
    <dt className="text-[11px] font-bold uppercase tracking-wider text-[#5e7a70]">{label}</dt>
    <dd className="mt-0.5 font-mono text-sm font-semibold text-[#17332c] tabular-nums">{value}</dd>
  </div>
);

/** The 12,5% ceiling the contract locks, checked again at report level. */
export function AmilCeilingCard({ amilShare }: { amilShare: WireAmilShare }) {
  const within = amilShare.withinCeiling;

  return (
    <div
      className={
        within
          ? "rounded-2xl border border-[#dbe7dd] bg-white p-5 shadow-xs md:p-6"
          : "rounded-2xl border-2 border-red-300 bg-red-50 p-5 shadow-xs md:p-6"
      }
    >
      <div className="flex items-center gap-2.5">
        {within ? (
          <ShieldCheck className="h-5 w-5 text-emerald-600" />
        ) : (
          <ShieldAlert className="h-5 w-5 text-red-600" />
        )}
        <h3 className="font-serif text-lg font-bold text-[#17332c]">Hak Amil</h3>
      </div>

      <p className={within ? "mt-1 text-xs text-[#5e7a70]" : "mt-1 text-xs text-red-800"}>
        {within
          ? "Porsi hak amil berada di dalam plafon 12,5% yang dikunci smart contract."
          : "Porsi hak amil melampaui plafon 12,5%. Laporan periode ini tidak dapat ditandatangani sampai selisihnya dijelaskan."}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {row("Pengumpulan", formatQuantity(amilShare.collected))}
        {row("Plafon", formatQuantity(amilShare.ceiling))}
        {row("Terpakai", formatQuantity(amilShare.actual))}
        {row(
          "Porsi",
          formatQuantity(amilShare.actualRatio) +
            " dari " +
            formatQuantity(amilShare.ceilingRatio)
        )}
      </dl>
    </div>
  );
}
