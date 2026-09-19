import { AlertTriangle, ShieldAlert } from "lucide-react";
import { formatNominal, type CurrencyUnit } from "./contributionClient";

export function ShortfallAlertBanner({
  shortfallAmount,
  currencyUnit,
  allocatedAmount,
  amountExact,
}: {
  shortfallAmount: string;
  currencyUnit: CurrencyUnit;
  allocatedAmount?: string;
  amountExact: string;
}) {
  if (!shortfallAmount || shortfallAmount === "0") return null;

  return (
    <div
      role="alert"
      className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-950 space-y-2 shadow-sm"
    >
      <div className="flex items-center gap-2 font-bold text-sm text-amber-900">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
        <span>Selisih Lebih Alokasi: {formatNominal(shortfallAmount, currencyUnit)}</span>
      </div>

      <p className="text-xs text-amber-800 leading-relaxed">
        Nominal tercatat (sebelum pengembalian atau pembatalan catatan){" "}
        <span className="font-semibold">{formatNominal(amountExact, currencyUnit)}</span>, dengan total alokasi yang
        sudah ditetapkan mencapai{" "}
        <span className="font-semibold">{formatNominal(allocatedAmount || "0", currencyUnit)}</span>.
      </p>

      <div className="bg-white/80 rounded-lg p-3 text-xs space-y-1.5 border border-amber-200">
        <div className="flex items-start gap-1.5 text-stone-700">
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-stone-900">Pihak Bertanggung Jawab:</span> Amil / Pejabat Operasional
            Kegiatan Penyaluran terkait.
          </div>
        </div>
        <ul className="list-disc list-inside text-stone-600 space-y-1 pl-1 text-[11px]">
          <li>
            <strong>Penyaluran aktual tidak ditimpa:</strong> Realisasi bantuan yang sudah disalurkan kepada penerima
            manfaat tetap sah dan dipertahankan.
          </li>
          <li>
            <strong>Alokasi baru diblokir:</strong> Penambahan alokasi baru yang memperburuk selisih ditolak otomatis
            oleh sistem hingga selisih diselesaikan.
          </li>
          <li>
            <strong>Privasi terjaga:</strong> Rincian donor dan nominal tetap terbatas pada pihak berwenang internal
            lembaga dan tidak diekspos ke publik.
          </li>
        </ul>
      </div>
    </div>
  );
}
