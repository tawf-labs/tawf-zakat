import { CheckCircle2, Clock, Filter, HelpCircle, XCircle } from "lucide-react";
import {
  type DonorRecoveryRequestRecord,
  type DonorRecoveryStatus,
} from "./contributionClient";

type DonorRecoveryTableProps = {
  requests: DonorRecoveryRequestRecord[];
  onSelect: (req: DonorRecoveryRequestRecord) => void;
  statusFilter: "ALL" | DonorRecoveryStatus;
  onFilterChange: (status: "ALL" | DonorRecoveryStatus) => void;
};

export function DonorRecoveryTable({
  requests,
  onSelect,
  statusFilter,
  onFilterChange,
}: DonorRecoveryTableProps) {
  const filtered = requests.filter(
    (r) => statusFilter === "ALL" || r.status === statusFilter
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-stone-200">
        <div className="flex items-center gap-2 text-xs text-stone-600 font-medium">
          <Filter className="w-3.5 h-3.5 text-stone-400" />
          <span>Filter Status:</span>
          <div className="flex gap-1">
            {(["ALL", "PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
              <button
                key={s}
                onClick={() => onFilterChange(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                  statusFilter === s
                    ? "bg-emerald-700 text-white font-semibold"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {s === "ALL"
                  ? "Semua"
                  : s === "PENDING"
                  ? "Menunggu Pemeriksaan"
                  : s === "APPROVED"
                  ? "Disetujui"
                  : "Ditolak"}
              </button>
            ))}
          </div>
        </div>
        <span className="text-xs text-stone-500">
          Menampilkan {filtered.length} dari {requests.length} permohonan
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-2xl border border-stone-200 text-stone-500 space-y-2">
          <HelpCircle className="w-8 h-8 mx-auto text-stone-400" />
          <p className="text-sm font-medium">Belum ada permohonan pemulihan kontak.</p>
          <p className="text-xs text-stone-400">
            Permohonan dari donatur yang kehilangan akses atau memiliki kontak keliru akan muncul di sini.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-2xl border border-stone-200 shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-50 text-stone-600 font-semibold border-b border-stone-200">
              <tr>
                <th className="py-3 px-4">Waktu Pengajuan</th>
                <th className="py-3 px-4">Referensi Kontribusi</th>
                <th className="py-3 px-4">Pemohon</th>
                <th className="py-3 px-4">Kontak Baru Diajukan</th>
                <th className="py-3 px-4">Dasar Hubungan / Bukti</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 text-stone-700">
              {filtered.map((req) => (
                <tr key={req.id} className="hover:bg-stone-50/70 transition-colors">
                  <td className="py-3 px-4 whitespace-nowrap text-stone-500">
                    {new Date(req.createdAt * 1000).toLocaleString("id-ID", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-mono font-semibold text-stone-800">
                      {req.contribution?.sourceReference || req.contributionId}
                    </span>
                    <div className="text-[10px] text-stone-400 font-mono">
                      {req.contribution?.amountExact
                        ? `Rp ${Number(req.contribution.amountExact).toLocaleString("id-ID")}`
                        : ""}
                    </div>
                  </td>
                  <td className="py-3 px-4 font-medium text-stone-800">
                    {req.donorName || <span className="text-stone-400 italic">(Tanpa Nama)</span>}
                  </td>
                  <td className="py-3 px-4 font-mono text-emerald-800">
                    {req.requestedContact}
                  </td>
                  <td className="py-3 px-4 max-w-xs truncate" title={req.evidenceBasis}>
                    {req.evidenceBasis}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {req.status === "PENDING" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                        <Clock className="w-3 h-3" /> Menunggu
                      </span>
                    ) : req.status === "APPROVED" ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                        <CheckCircle2 className="w-3 h-3" /> Disetujui
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800">
                        <XCircle className="w-3 h-3" /> Ditolak
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSelect(req)}
                      className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-emerald-50 hover:text-emerald-800 text-stone-700 font-medium transition-colors cursor-pointer"
                    >
                      {req.status === "PENDING" ? "Periksa" : "Rincian"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
