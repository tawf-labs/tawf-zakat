import { DollarSign, CheckCircle2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { formatNominal, type ContributionRefund, type CurrencyUnit } from "./contributionClient";
import { at } from "./contributionUi";

export function ContributionRefundHistory({ refunds, currencyUnit, canManage, onPay }: {
  refunds: ContributionRefund[]; currencyUnit: CurrencyUnit; canManage: boolean;
  onPay: (refund: ContributionRefund) => void;
}) {
  if (!refunds.length) return null;
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-stone-900 flex items-center gap-1.5">
        <DollarSign className="w-4 h-4 text-indigo-600" />
        <span>Pengembalian Dana ({refunds.length})</span>
      </h4>
      <div className="space-y-2">
        {refunds.map((ref) => (
          <div
            key={ref.id}
            className={`text-xs p-3.5 rounded-xl border space-y-2 ${
              ref.status === "PAID"
                ? "border-emerald-200 bg-emerald-50/40"
                : "border-amber-200 bg-amber-50/40"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-stone-900 flex flex-wrap items-center gap-2">
                <code className="text-stone-700">{ref.id}</code>
                <span className="font-bold text-stone-900">
                  {formatNominal(ref.amountExact, currencyUnit)}
                </span>
                <span
                  className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                    ref.status === "PAID"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {ref.status === "PAID" ? "Sudah dibayarkan" : "Menunggu pembayaran"}
                </span>
              </div>
              {ref.status === "DECIDED" && canManage && (
                <Button
                  size="sm"
                  onClick={() => onPay(ref)}
                  className="text-xs bg-emerald-700 hover:bg-emerald-800 text-white"
                >
                  Catat Pembayaran
                </Button>
              )}
            </div>

            <div className="text-stone-700 space-y-1">
              <div>
                <span className="font-medium">Alasan:</span> {ref.reason}
              </div>
              <div>
                <span className="font-medium">Dasar Kebijakan Lembaga:</span> {ref.policyBasis}
              </div>
              <div className="text-stone-500 text-[11px] font-mono break-all">
                Diputuskan oleh: {ref.decidedBy} ({at(ref.decidedAt)})
              </div>
            </div>

            {ref.status === "PAID" && (
              <div className="pt-2 border-t border-emerald-200 text-emerald-900 text-xs space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                  <span>Realisasi Pembayaran Selesai</span>
                </div>
                <div>
                  Referensi Bukti Transfer:{" "}
                  <code className="bg-white px-1.5 py-0.5 rounded border border-emerald-300">
                    {ref.paymentProofRef}
                  </code>
                </div>
                {ref.paidAt && <div>Waktu Pembayaran: {at(ref.paidAt)}</div>}
                {ref.paymentNotes && <div>Catatan: {ref.paymentNotes}</div>}
                <div className="text-stone-500 text-[11px] font-mono break-all">Dibayarkan oleh: {ref.paidBy}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
