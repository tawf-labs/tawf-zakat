import { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import type { ContributionDetailResponse, ContributionRefund } from "./contributionClient";
import { ContributionStatusBadge } from "./ContributionStatusBadge";
import { ContributionAllocations } from "./ContributionAllocations";
import { ShortfallAlertBanner } from "./ShortfallAlertBanner";
import { ContributionCorrectionModal } from "./ContributionCorrectionModal";
import { RefundDecisionModal } from "./RefundDecisionModal";
import { RefundPaymentModal } from "./RefundPaymentModal";
import { ContributionDocuments } from "./ContributionDocuments";
import { ContributionRecordSummary } from "./ContributionRecordSummary";
import { ContributionCorrectionHistory } from "./ContributionCorrectionHistory";
import { ContributionRefundHistory } from "./ContributionRefundHistory";
import { ContributionAuditHistory } from "./ContributionAuditHistory";

export type ContributionDetail = ContributionDetailResponse;

export function ContributionDetailModal({ requests, detail, canManage, onReload, onClose, onError }: {
  requests: PrivateRequests; detail: ContributionDetail; canManage: boolean;
  onReload: () => void; onClose: () => void; onError: (message: string | null) => void;
}) {
  const { contribution: record, corrections = [], refunds = [], capabilities: { canCorrect } } = detail;
  const { proofValidity } = record;
  const [showCorrection, setShowCorrection] = useState(false);
  const [showDecision, setShowDecision] = useState(false);
  const [payment, setPayment] = useState<ContributionRefund | null>(null);
  const changed = () => {
    setShowCorrection(false);
    setShowDecision(false);
    setPayment(null);
    onReload();
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={`Detail kontribusi ${record.id}`}
        className="bg-white rounded-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto space-y-6 shadow-xl border border-stone-200">
        <div className="flex items-start justify-between border-b border-stone-200 pb-4">
          <div>
            <h3 className="text-lg font-bold text-stone-900">Detail Kontribusi: {record.id}</h3>
            <div className="mt-2 flex gap-2 items-center flex-wrap text-xs">
              <ContributionStatusBadge status={record.status} />
              <span>Versi {record.version}</span>
              <span className={proofValidity.status === "CURRENT" ? "text-emerald-800" : "text-amber-800"}>
                {proofValidity.label}
              </span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Tutup" className="text-stone-500">✕</button>
        </div>
        <ShortfallAlertBanner shortfallAmount={record.shortfallAmount ?? "0"} currencyUnit={record.currencyUnit}
          allocatedAmount={record.allocatedAmount} amountExact={record.amountExact} />
        {record.status !== "REJECTED" && (
          <div className="flex gap-2 flex-wrap">
            {canCorrect && <Button size="sm" variant="outline" onClick={() => setShowCorrection(true)}>Koreksi Kontribusi</Button>}
            {canManage && <Button size="sm" variant="outline" onClick={() => setShowDecision(true)}>Keputusan Pengembalian</Button>}
            {!canCorrect && <p className="text-xs text-stone-500">Koreksi harus disahkan petugas dengan kewenangan pengesahan kontribusi.</p>}
          </div>
        )}
        <ContributionRecordSummary record={record} />
        <ContributionCorrectionHistory corrections={corrections} currencyUnit={record.currencyUnit} />
        <ContributionRefundHistory refunds={refunds} currencyUnit={record.currencyUnit} canManage={canManage} onPay={setPayment} />
        <ContributionAllocations requests={requests} record={record} />
        <ContributionDocuments requests={requests} detail={detail} canManage={canManage} onChanged={onReload} onError={onError} />
        <ContributionAuditHistory history={detail.history} />
        <div className="flex justify-end border-t border-stone-200 pt-3"><Button variant="outline" onClick={onClose}>Tutup</Button></div>
      </div>
      {showCorrection && <ContributionCorrectionModal requests={requests} target={record} onDone={changed}
        onClose={() => setShowCorrection(false)} onError={onError} />}
      {showDecision && <RefundDecisionModal requests={requests} target={record} refunds={refunds} onDone={changed}
        onClose={() => setShowDecision(false)} onError={onError} />}
      {payment && <RefundPaymentModal requests={requests} contributionId={record.id} refund={payment}
        currencyUnit={record.currencyUnit} onDone={changed} onClose={() => setPayment(null)} onError={onError} />}
    </div>
  );
}
