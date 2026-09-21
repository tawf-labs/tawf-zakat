import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { deleteProposalDocument, downloadProposalFile, listProposalDocuments,
  type Beneficiary, type ProposalDocument } from "./disbursementClient";
import { ProposalDocumentList } from "./ProposalDocumentList";
import { ProposalDocumentUpload } from "./ProposalDocumentUpload";
import { ProposalRequiredDocuments } from "./ProposalRequiredDocuments";

export function ProposalDocumentManager({ requests, proposalId, beneficiaries, readOnly = false,
  proposalVersion, onDocumentsChanged }: {
  requests: PrivateRequests; proposalId: string; beneficiaries: Beneficiary[]; readOnly?: boolean;
  proposalVersion?: number; onDocumentsChanged?: () => void;
}) {
  const [documents, setDocuments] = useState<ProposalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const version = readOnly ? proposalVersion : undefined;
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    listProposalDocuments(requests, proposalId, version).then(list => {
      if (current) setDocuments(list);
    }).catch(failure => {
      if (current) setError(failure.message);
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [requests, proposalId, version, revision]);
  function changed() {
    setRevision(value => value + 1);
    onDocumentsChanged?.();
  }
  async function remove(id: string) {
    if (readOnly || !window.confirm("Hapus lampiran dokumen ini?")) return;
    try {
      await deleteProposalDocument(requests, proposalId, id);
      changed();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Dokumen gagal dihapus."); }
  }
  async function download(doc: ProposalDocument) {
    try {
      const blob = await downloadProposalFile(requests, proposalId, doc.id, version);
      requests.assertCurrent();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = doc.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Dokumen tidak dapat diunduh."); }
  }
  return (
    <section aria-label="Lampiran dokumen pengajuan" className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4" />Dokumen dan Lampiran Terbatas</h4>
      <p className="text-xs text-stone-500">Berkas terlindungi dan hanya dapat diakses pihak berwenang.</p>
      <details className="text-xs text-stone-500"><summary>Detail perlindungan berkas</summary>
        Berkas disimpan terenkripsi AES-256-GCM dan diperiksa integritasnya saat diunduh.
      </details>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {!readOnly && !loading && !error && <ProposalRequiredDocuments requests={requests} beneficiaries={beneficiaries} documents={documents} />}
      {!readOnly && <ProposalDocumentUpload requests={requests} proposalId={proposalId} beneficiaries={beneficiaries} onUploaded={changed} />}
      {loading ? <p className="text-xs">Memuat dokumen…</p> : !error &&
        <ProposalDocumentList documents={documents} beneficiaries={beneficiaries} readOnly={readOnly} onDownload={download} onDelete={remove} />}
    </section>
  );
}
