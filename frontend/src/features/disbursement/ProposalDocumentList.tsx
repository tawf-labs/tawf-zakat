import { Download, FileText, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { Beneficiary, ProposalDocument, ProposalDocumentCategory } from "./disbursementClient";

export const CATEGORY_LABELS: Record<ProposalDocumentCategory, string> = {
  PROPOSAL_LETTER: "Surat Permohonan",
  BENEFICIARY_IDENTITY: "KTP/KK",
  ALTERNATIVE_IDENTITY_PROOF: "Identitas Alternatif",
  REPRESENTATION_PROOF: "Kuasa/Perwalian",
  PAYMENT_RECIPIENT_PROOF: "Rekening/Kuasa",
  BENEFICIARY_ROSTER: "Berkas Impor Daftar Penerima",
  OTHER: "Pendukung Lain",
};

const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

export function ProposalDocumentList({ documents, beneficiaries, readOnly, onDownload, onDelete }: {
  documents: ProposalDocument[]; beneficiaries: Beneficiary[]; readOnly: boolean;
  onDownload: (doc: ProposalDocument) => void; onDelete: (id: string) => void;
}) {
  if (!documents.length) return <p className="text-xs text-stone-500">Belum ada dokumen yang dilampirkan.</p>;
  return (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500 font-medium">
                <th className="pb-2">Kategori</th>
                <th className="pb-2">Nama Berkas</th>
                <th className="pb-2">Penerima</th>
                <th className="pb-2">Ukuran</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {documents.map((doc) => {
                const targetBen = beneficiaries.find((b) => b.id === doc.beneficiaryId);
                return (
                  <tr key={doc.id} className="hover:bg-stone-50">
                    <td className="py-2.5 pr-2">
                      <span className="inline-block rounded bg-stone-100 px-2 py-0.5 font-medium text-stone-700">
                        {CATEGORY_LABELS[doc.category] ?? doc.category}
                      </span>
                    </td>
                    <td className="py-2.5 pr-2 font-medium text-stone-900 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                      <span className="truncate max-w-[200px]" title={doc.fileName}>
                        {doc.fileName}
                      </span>
                    </td>
                    <td className="py-2.5 pr-2 text-stone-600">
                      {targetBen ? targetBen.name : "—"}
                    </td>
                    <td className="py-2.5 pr-2 text-stone-500">
                      {formatSize(doc.sizeBytes)}
                    </td>
                    <td className="py-2.5 pr-2">
                      <Badge variant={doc.storageStatus === "STORED" ? "success" : "danger"}>
                        {doc.storageStatus === "STORED" ? "Tersimpan" : "Gagal"}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-right space-x-1 whitespace-nowrap">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onDownload(doc)}
                        title="Unduh dan periksa integritas dokumen"
                        className="h-7 px-2 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                      >
                        <Download className="h-3.5 w-3.5 mr-1" /> Unduh
                      </Button>
                      {!readOnly && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(doc.id)}
                          title="Hapus dokumen"
                          className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
  );
}
