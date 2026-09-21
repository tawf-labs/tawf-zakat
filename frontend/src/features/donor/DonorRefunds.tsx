import type { RefundStatus } from "../../../../shared/contribution-lifecycle";
import { formatNominal, type CurrencyUnit } from "../contributions/contributionClient";
import type { DonorTrace } from "../traceability/traceClient";
import { Notice } from "./DonorNotice";

const REFUND_LABELS: Record<RefundStatus, string> = {
  DECIDED: "Pengembalian diputuskan; belum dibayar",
  PAID: "Pengembalian sudah dibayar",
  CANCELLED: "Keputusan pengembalian dibatalkan",
};

/** A decision is not an outgoing payment. Private payment evidence stays with the institution. */
export function DonorRefunds({ refunds }: { refunds: DonorTrace["refunds"] }) {
  return (
    <section aria-label="Pengembalian kontribusi" className="space-y-2">
      <h5 className="text-sm font-semibold text-tawf-green">Pengembalian kontribusi</h5>
      {refunds.status === "UNAVAILABLE" ? (
        <Notice tone="warning">{refunds.reason}</Notice>
      ) : refunds.data.length === 0 ? (
        <p className="text-xs text-tawf-muted">Belum ada keputusan pengembalian.</p>
      ) : (
        <ul className="space-y-2">
          {refunds.data.map((refund) => (
            <li key={refund.id} className="rounded-xl border border-tawf-green-10 p-3 text-xs space-y-1">
              <p className="font-semibold text-tawf-green">{REFUND_LABELS[refund.status]}</p>
              <p>{formatNominal(refund.amountExact, refund.currencyUnit as CurrencyUnit)}</p>
              <p className="text-tawf-muted">Diputuskan pada {new Date(refund.decidedAt * 1000).toLocaleDateString("id-ID")}.</p>
              {refund.status === "PAID" && refund.paidAt !== null && (
                <p className="text-tawf-muted">Dibayar pada {new Date(refund.paidAt * 1000).toLocaleDateString("id-ID")}.</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
