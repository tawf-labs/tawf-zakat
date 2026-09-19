import { FileText, ShieldCheck } from "lucide-react";
import type { DonorRecoveryRequestRecord } from "./contributionClient";

export function DonorRecoveryDetails({ record }: { record: DonorRecoveryRequestRecord }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      {/* Contribution Data */}
      <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 space-y-2.5">
        <div className="font-semibold text-stone-800 flex items-center gap-1.5 border-b border-stone-200 pb-2">
          <FileText className="w-3.5 h-3.5 text-stone-500" />
          <span>Data Kontribusi Tercatat</span>
        </div>
        <div>
          <span className="text-stone-400 block text-[10px]">Referensi Sumber:</span>
          <span className="font-mono font-bold text-stone-800">
            {record.contribution?.sourceReference}
          </span>
        </div>
        <div>
          <span className="text-stone-400 block text-[10px]">Nominal & Kanal:</span>
          <span className="font-mono text-stone-700">
            {record.contribution?.amountExact
              ? `Rp ${Number(record.contribution.amountExact).toLocaleString("id-ID")}`
              : "-"}{" "}
            ({record.contribution?.sourceChannel})
          </span>
        </div>
        <div>
          <span className="text-stone-400 block text-[10px]">Kontak Saat Ini:</span>
          <span className="font-mono text-stone-600">
            {record.contribution?.currentContact || (
              <span className="italic text-stone-400">Belum ada kontak terdaftar</span>
            )}
          </span>
        </div>
        <div>
          <span className="text-stone-400 block text-[10px]">Versi Kontribusi:</span>
          <span className="font-mono text-stone-600">Versi {record.contribution?.version}</span>
        </div>
      </div>

      {/* Recovery Request Data */}
      <div className="p-4 rounded-2xl bg-emerald-50/50 border border-emerald-200/70 space-y-2.5">
        <div className="font-semibold text-emerald-900 flex items-center gap-1.5 border-b border-emerald-200 pb-2">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
          <span>Klaim Pemohon</span>
        </div>
        <div>
          <span className="text-stone-400 block text-[10px]">Nama Pemohon:</span>
          <span className="font-medium text-stone-800">
            {record.donorName || <span className="text-stone-400 italic">(Tidak dicantumkan)</span>}
          </span>
        </div>
        <div>
          <span className="text-stone-400 block text-[10px]">Kontak Baru Diajukan:</span>
          <span className="font-mono font-bold text-emerald-800">
            {record.requestedContact}
          </span>
        </div>
        <div>
          <span className="text-stone-400 block text-[10px]">Dasar Hubungan / Bukti:</span>
          <p className="text-stone-700 mt-0.5 leading-relaxed bg-white p-2 rounded-lg border border-emerald-100 text-[11px]">
            {record.evidenceBasis}
          </p>
        </div>
      </div>
    </div>
  );
}
