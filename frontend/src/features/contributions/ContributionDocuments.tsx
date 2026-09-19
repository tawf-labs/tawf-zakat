import { useState } from "react";
import { Paperclip } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { PrivateRequests } from "../workspace/privateRequests";
import type { ContributionDetail } from "./ContributionDetailModal";
import { uploadContributionDocument } from "./contributionClient";
import { errorMessage, fileToBase64 } from "./contributionUi";

export function ContributionDocuments({
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
      await uploadContributionDocument(requests, detail.contribution.id, {
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
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 pt-2 border-t border-stone-100">
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
              className="text-xs w-full min-w-0 sm:flex-1"
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
