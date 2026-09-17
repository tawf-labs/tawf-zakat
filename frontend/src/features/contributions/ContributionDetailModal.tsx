import { useState } from "react";
import { History, Paperclip, Receipt } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import {
  channelLabel,
  formatNominal,
  fundTypeLabel,
  STATUS_MEANINGS,
  uploadContributionDocument,
  type ContributionDocument,
  type ContributionHistory,
  type ContributionRecord,
} from "./contributionClient";
import { ContributionStatusBadge } from "./ContributionStatusBadge";
import { errorMessage, fileToBase64 } from "./contributionUi";

export type ContributionDetail = {
  record: ContributionRecord;
  history: ContributionHistory[];
  documents: ContributionDocument[];
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
  const { record } = detail;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Detail kontribusi ${record.id}`}
        className="bg-white rounded-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto space-y-6 shadow-xl border border-stone-200"
      >
        <div className="flex items-start justify-between border-b border-stone-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-700" />
              <h3 className="text-lg font-bold text-stone-900">Detail Kontribusi: {record.id}</h3>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <ContributionStatusBadge status={record.status} />
              <span className="text-xs text-stone-500 font-mono">Versi {record.version}</span>
            </div>
            <div className="mt-1 text-xs text-stone-600">{STATUS_MEANINGS[record.status]}</div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700 font-bold p-1 text-lg" aria-label="Tutup">
            ✕
          </button>
        </div>

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

        <DocumentSection requests={requests} detail={detail} canManage={canManage} onChanged={onReload} onError={onError} />

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

        <div className="flex justify-end pt-3 border-t border-stone-200">
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>
    </div>
  );
}
