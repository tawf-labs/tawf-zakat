import { useMemo, useState } from "react";
import { Download, FileText, Search, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { Beneficiary, ProposalDocument, ProposalDocumentCategory } from "./disbursementClient";

export const CATEGORY_LABELS: Record<ProposalDocumentCategory, string> = {
  PROPOSAL_LETTER: "Surat Permohonan",
  RECIPIENT_VERIFICATION: "Berita Acara Verifikasi Penerima",
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
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<ProposalDocumentCategory | "">("");
  const [status, setStatus] = useState<ProposalDocument["storageStatus"] | "">("");
  const names = useMemo(() => new Map(beneficiaries.map((b) => [b.id, b.name])), [beneficiaries]);
  const categories = useMemo(() => [...new Set(documents.map((doc) => doc.category))], [documents]);
  if (!documents.length) return <p className="text-xs text-stone-500">Belum ada dokumen yang dilampirkan.</p>;

  const needle = query.trim().toLowerCase();
  const shown = documents.filter((doc) =>
    (!category || doc.category === category) &&
    (!status || doc.storageStatus === status) &&
    (!needle || [doc.fileName, names.get(doc.beneficiaryId ?? "") ?? "", CATEGORY_LABELS[doc.category] ?? doc.category]
      .some((text) => text.toLowerCase().includes(needle))));
  const filtered = Boolean(needle || category || status);
  const select = "rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1 sm:max-w-xs">
          <span className="sr-only">Cari berkas</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama berkas atau penerima…"
            className="w-full rounded-lg border border-stone-300 bg-white py-1.5 pl-8 pr-2 text-xs focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </label>
        {categories.length > 1 && (
          <select aria-label="Saring kategori" value={category} onChange={(e) => setCategory(e.target.value as ProposalDocumentCategory | "")} className={select}>
            <option value="">Semua kategori</option>
            {categories.map((value) => <option key={value} value={value}>{CATEGORY_LABELS[value] ?? value}</option>)}
          </select>
        )}
        {documents.some((doc) => doc.storageStatus === "FAILED") && (
          <select aria-label="Saring status" value={status} onChange={(e) => setStatus(e.target.value as ProposalDocument["storageStatus"] | "")} className={select}>
            <option value="">Semua status</option>
            <option value="STORED">Tersimpan</option>
            <option value="FAILED">Gagal</option>
          </select>
        )}
        <span className="text-xs text-stone-500" aria-live="polite">
          {filtered ? `${shown.length} dari ${documents.length} berkas` : `${documents.length} berkas`}
        </span>
      </div>
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-stone-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-stone-50">
              <tr className="text-stone-500 font-medium">
                <th className="border-b border-stone-200 px-3 py-2">Kategori</th>
                <th className="border-b border-stone-200 px-3 py-2">Nama Berkas</th>
                <th className="border-b border-stone-200 px-3 py-2">Penerima</th>
                <th className="border-b border-stone-200 px-3 py-2">Ukuran</th>
                <th className="border-b border-stone-200 px-3 py-2">Status</th>
                <th className="border-b border-stone-200 px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {shown.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-stone-500">Tidak ada berkas yang cocok dengan pencarian/filter.</td></tr>
              )}
              {shown.map((doc) => {
                const targetName = doc.beneficiaryId ? names.get(doc.beneficiaryId) : undefined;
                return (
                  <tr key={doc.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2.5">
                      <span className="inline-block rounded bg-stone-100 px-2 py-0.5 font-medium text-stone-700">
                        {CATEGORY_LABELS[doc.category] ?? doc.category}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-stone-900">
                      <span className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                        <span className="truncate max-w-[200px]" title={doc.fileName}>
                          {doc.fileName}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-stone-600">
                      {targetName || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-stone-500">
                      {formatSize(doc.sizeBytes)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={doc.storageStatus === "STORED" ? "success" : "danger"}>
                        {doc.storageStatus === "STORED" ? "Tersimpan" : "Gagal"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right space-x-1 whitespace-nowrap">
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
    </div>
  );
}
