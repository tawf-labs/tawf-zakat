import { useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  CheckCircle2,
  Clock,
  DollarSign,
  Edit3,
  History,
  Paperclip,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import {
  channelLabel,
  formatNominal,
  fundTypeLabel,
  STATUS_MEANINGS,
  uploadContributionDocument,
  type ContributionCorrection,
  type ContributionDocument,
  type ContributionEvent,
  type ContributionHistory,
  type ContributionRecord,
  type ContributionRefund,
  type ProofValidity,
} from "./contributionClient";
import { ContributionStatusBadge } from "./ContributionStatusBadge";
import { ContributionAllocations } from "./ContributionAllocations";
import { errorMessage, fileToBase64 } from "./contributionUi";
import { ShortfallAlertBanner } from "./ShortfallAlertBanner";
import { ContributionCorrectionModal } from "./ContributionCorrectionModal";
import { RefundDecisionModal } from "./RefundDecisionModal";
import { RefundPaymentModal } from "./RefundPaymentModal";

export type ContributionDetail = {
  record: ContributionRecord;
  history: ContributionHistory[];
  documents: ContributionDocument[];
  corrections?: ContributionCorrection[];
  refunds?: ContributionRefund[];
  events?: ContributionEvent[];
  proofValidity?: { status: ProofValidity; notes: string };
};

const at = (seconds: number) => new Date(seconds * 1000).toLocaleString("id-ID");

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <span className="text-stone-500 font-medium">{label}</span>
      <div className={`font-semibold text-stone-900 mt-0.5 ${mono ? "font-mono" : ""}`}>{children}</div>
    </div>
  );
}

function DocumentSection({
  requests,
  detail,
  canManage,
  onChanged,
  onError,
}: {
  requests: PrivateRequests;
  detail: ContributionDetail;
  canManage: boolean;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [category, setCategory] = useState("BUKTI_TRANSFER");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    onError(null);
    try {
      await uploadContributionDocument(requests, detail.record.id, {
        category,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64: await fileToBase64(file),
      });
      setFile(null);
      onChanged();
    } catch (err) {
      onError(errorMessage(err, "Gagal mengunggah dokumen."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-stone-900 flex items-center gap-1.5">
        <Paperclip className="w-4 h-4 text-emerald-700" />
        <span>Dokumen Pendukung ({detail.documents.length})</span>
      </h4>

      {detail.documents.length === 0 ? (
        <div className="text-xs text-stone-500 italic p-3 bg-stone-50 rounded-lg">
          Belum ada dokumen pendukung (rekening koran, struk, tangkapan layar) yang dilampirkan.
        </div>
      ) : (
        <div className="space-y-1.5">
          {detail.documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between text-xs p-2.5 rounded-lg border border-stone-200 bg-stone-50"
            >
              <div>
                <div className="font-semibold text-stone-900">{doc.fileName}</div>
                <div className="text-stone-500 text-[11px]">
                  {doc.category} · {(doc.sizeBytes / 1024).toFixed(1)} KB · SHA256:{" "}
                  <span className="font-mono">{doc.contentSha256.slice(0, 10)}…</span>
                </div>
              </div>
              <Badge variant={doc.storageStatus === "STORED" ? "success" : "danger"}>{doc.storageStatus}</Badge>
            </div>
          ))}
        </div>
      )}

      {canManage && (
        <>
          <p className="text-[11px] text-stone-500">
            Melampirkan dokumen tidak mengubah status: pencocokan sumber tetap dilakukan terpisah.
          </p>
          <div className="flex items-center gap-2 pt-2 border-t border-stone-100">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Kategori dokumen"
              className="text-xs border border-stone-300 rounded px-2 py-1.5 bg-white"
            >
              <option value="BUKTI_TRANSFER">Bukti Transfer</option>
              <option value="REKENING_KORAN">Rekening Koran</option>
              <option value="STRUK_PEMBAYARAN">Struk / Resi Pembayaran</option>
              <option value="DOKUMEN_LAIN">Lainnya</option>
            </select>
            <input
              type="file"
              aria-label="Berkas dokumen pendukung"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="text-xs"
            />
            <Button size="sm" onClick={upload} disabled={!file || uploading} className="text-xs">
              {uploading ? "Mengunggah…" : "Lampirkan"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function ContributionDetailModal({
  requests,
  detail,
  canManage,
  onReload,
  onClose,
  onError,
}: {
  requests: PrivateRequests;
  detail: ContributionDetail;
  canManage: boolean;
  onReload: () => void;
  onClose: () => void;
  onError: (message: string | null) => void;
}) {
  const { record, corrections = [], refunds = [], proofValidity } = detail;
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [showRefundDecisionModal, setShowRefundDecisionModal] = useState(false);
  const [activePaymentRefund, setActivePaymentRefund] = useState<ContributionRefund | null>(null);

  const hasShortfall = Boolean(record.shortfallAmount && Number(record.shortfallAmount) > 0);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Detail kontribusi ${record.id}`}
        className="bg-white rounded-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto space-y-6 shadow-xl border border-stone-200"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-stone-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-700" />
              <h3 className="text-lg font-bold text-stone-900">Detail Kontribusi: {record.id}</h3>
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <ContributionStatusBadge status={record.status} />
              <span className="text-xs text-stone-500 font-mono bg-stone-100 px-2 py-0.5 rounded">
                Versi Bisnis: V{record.version}
              </span>
              {proofValidity && (
                <span
                  className={`text-xs px-2 py-0.5 rounded font-semibold ${
                    proofValidity.status === "CURRENT"
                      ? "bg-emerald-100 text-emerald-800"
                      : proofValidity.status === "SUPERSEDED"
                      ? "bg-amber-100 text-amber-800 border border-amber-300"
                      : "bg-rose-100 text-rose-800"
                  }`}
                  title={proofValidity.notes}
                >
                  Bukti: {proofValidity.status}
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-stone-600">{STATUS_MEANINGS[record.status]}</div>
            {proofValidity?.status === "SUPERSEDED" && (
              <div className="mt-1 text-[11px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200">
                <strong>Catatan Keberlakuan Bukti (AC19):</strong> {proofValidity.notes}
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 font-bold p-1 text-lg" aria-label="Tutup">
            ✕
          </button>
        </div>

        {/* Shortfall Alert Banner if discrepancy exists */}
        {hasShortfall && (
          <ShortfallAlertBanner
            shortfallAmount={record.shortfallAmount!}
            currencyUnit={record.currencyUnit}
            allocatedAmount={record.allocatedAmount}
            amountExact={record.amountExact}
          />
        )}

        {/* Action Toolbar for Authorized Officers */}
        {canManage && record.status !== "REJECTED" && (
          <div className="flex items-center gap-2 bg-stone-50 p-3 rounded-xl border border-stone-200 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCorrectionModal(true)}
              className="text-xs flex items-center gap-1.5"
            >
              <Edit3 className="w-3.5 h-3.5 text-amber-600" />
              <span>Koreksi Kontribusi (US-41)</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowRefundDecisionModal(true)}
              className="text-xs flex items-center gap-1.5"
            >
              <ArrowDownLeft className="w-3.5 h-3.5 text-indigo-600" />
              <span>Keputusan Refund (US-44, AC03)</span>
            </Button>
          </div>
        )}

        {/* Main Grid Info */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs bg-stone-50 p-4 rounded-xl">
          <Field label="Nomor Referensi Sumber" mono>
            {record.sourceReference}
          </Field>
          <Field label="Kanal Sumber">{channelLabel(record.sourceChannel)}</Field>
          <Field label="Nominal Pasti">{formatNominal(record.amountExact, record.currencyUnit)}</Field>
          <Field label="Jenis Dana">{fundTypeLabel(record.fundType)}</Field>
          <Field label="Nama Donor">{record.donorName || "Hamba Allah"}</Field>
          <Field label="Kontak Donor">{record.donorContact || "-"}</Field>
          <Field label="Tujuan / Peruntukan">{record.purpose}</Field>
          <Field label="Waktu Diterima">{at(record.receivedAt)}</Field>
          <Field label="Kelayakan Batch">{record.unqualifiedReason || "Layak masuk batch kontribusi."}</Field>
        </div>

        {/* Endorsement and Reconciliation Details */}
        {(record.reconciledAt || record.endorsedAt) && (
          <div className="rounded-xl border border-stone-200 p-4 space-y-2 text-xs">
            <h4 className="font-semibold text-stone-800">Status Pengesahan & Bukti</h4>
            {record.reconciledAt && (
              <div className="text-stone-600">
                <span className="font-medium text-stone-900">Rekonsiliasi:</span> Direkonsiliasi pada {at(record.reconciledAt)}{" "}
                oleh <code>{record.reconciledBy}</code> (Bukti: <code>{record.reconciliationProofRef}</code>)
              </div>
            )}
            {record.endorsedAt && (
              <div className="text-stone-600">
                <span className="font-medium text-stone-900">Pengesahan Pejabat:</span> Disahkan pada {at(record.endorsedAt)}{" "}
                oleh <code>{record.endorsedBy}</code> (Mandat: <code>{record.endorsementMandateId}</code>)
              </div>
            )}
          </div>
        )}

        {/* Corrections History (Spec #100, Issue #106) */}
        {corrections.length > 0 && (
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
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-stone-900 flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-900 font-mono text-[10px]">
                        V{cor.fromVersion} → V{cor.toVersion}
                      </span>
                      <span>Jenis: {cor.correctionType}</span>
                    </div>
                    <span className="text-[11px] text-stone-400">{at(cor.correctedAt)}</span>
                  </div>
                  <div className="text-stone-700">
                    <span className="font-medium">Perubahan Nominal:</span>{" "}
                    <span className="font-mono line-through text-stone-400">
                      {formatNominal(cor.fromAmountExact, record.currencyUnit)}
                    </span>{" "}
                    →{" "}
                    <span className="font-mono font-bold text-amber-900">
                      {formatNominal(cor.toAmountExact, record.currencyUnit)}
                    </span>
                  </div>
                  <div className="text-stone-600 italic">"{cor.reason}"</div>
                  {cor.sourceProofRef && (
                    <div className="text-stone-500 text-[11px]">
                      Referensi Bukti: <code className="bg-white px-1 py-0.5 rounded border">{cor.sourceProofRef}</code>
                    </div>
                  )}
                  <div className="text-stone-400 text-[11px] font-mono">Oleh: {cor.correctedBy}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Refunds (Keputusan & Realisasi Pembayaran) */}
        {refunds.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-stone-900 flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-indigo-600" />
              <span>Pengembalian Dana / Refund ({refunds.length})</span>
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
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-stone-900 flex items-center gap-2">
                      <code className="text-stone-700">{ref.id}</code>
                      <span className="font-bold text-stone-900">
                        {formatNominal(ref.amountExact, record.currencyUnit)}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                          ref.status === "PAID"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {ref.status === "PAID" ? "SUDAH DIBAYARKAN (PAID)" : "DIPUTUSKAN / MENUNGGU PEMBAYARAN"}
                      </span>
                    </div>
                    {ref.status === "DECIDED" && canManage && (
                      <Button
                        size="sm"
                        onClick={() => setActivePaymentRefund(ref)}
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
                    <div className="text-stone-500 text-[11px] font-mono">
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
                      <div className="text-stone-500 text-[11px] font-mono">Dibayarkan oleh: {ref.paidBy}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Allocations Section */}
        <ContributionAllocations requests={requests} record={record} />

        {/* Documents Section */}
        <DocumentSection
          requests={requests}
          detail={detail}
          canManage={canManage}
          onChanged={onReload}
          onError={onError}
        />

        {/* Audit History */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-stone-900 flex items-center gap-1.5">
            <History className="w-4 h-4 text-stone-600" />
            <span>Riwayat Audit ({detail.history.length})</span>
          </h4>
          <div className="space-y-2">
            {detail.history.map((hist) => (
              <div
                key={hist.id}
                className="text-xs p-3 rounded-xl border border-stone-200 bg-stone-50/50 flex flex-col md:flex-row md:items-center justify-between gap-2"
              >
                <div>
                  <div className="font-semibold text-stone-900 flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded bg-stone-200 font-mono text-[10px]">V{hist.version}</span>
                    <span>Tindakan: {hist.action}</span>
                    <span className="text-stone-400">→</span>
                    <span className="text-emerald-800 font-medium">{hist.toStatus}</span>
                  </div>
                  <div className="text-stone-500 font-mono text-[11px] mt-0.5">
                    Oleh: {hist.actorAccount} {hist.actorOfficerId && `(${hist.actorOfficerId})`}
                  </div>
                  {hist.notes && <div className="text-stone-600 mt-1 italic">"{hist.notes}"</div>}
                </div>
                <div className="text-[11px] text-stone-400 whitespace-nowrap">{at(hist.occurredAt)}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-stone-200">
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>

      {/* Child Modals */}
      {showCorrectionModal && (
        <ContributionCorrectionModal
          requests={requests}
          target={record}
          onDone={async () => {
            setShowCorrectionModal(false);
            onReload();
          }}
          onClose={() => setShowCorrectionModal(false)}
          onError={onError}
        />
      )}

      {showRefundDecisionModal && (
        <RefundDecisionModal
          requests={requests}
          target={record}
          onDone={async () => {
            setShowRefundDecisionModal(false);
            onReload();
          }}
          onClose={() => setShowRefundDecisionModal(false)}
          onError={onError}
        />
      )}

      {activePaymentRefund && (
        <RefundPaymentModal
          requests={requests}
          contributionId={record.id}
          refund={activePaymentRefund}
          currencyUnit={record.currencyUnit}
          onDone={async () => {
            setActivePaymentRefund(null);
            onReload();
          }}
          onClose={() => setActivePaymentRefund(null)}
          onError={onError}
        />
      )}
    </div>
  );
}
