import { useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/Tabs";
import { deleteProposalDocument, downloadProposalFile, getInstitutionPolicy, listProposalDocuments,
  type AidLine, type Beneficiary, type DisbursementPolicy, type ProposalDocument } from "./disbursementClient";
import { ProposalDocumentList } from "./ProposalDocumentList";
import { ProposalDocumentUpload } from "./ProposalDocumentUpload";
import { ProposalRequiredDocuments, requiredDocuments } from "./ProposalRequiredDocuments";
import { BeneficiaryIdentityBulkUpload } from "./BeneficiaryIdentityBulkUpload";

export function ProposalDocumentManager({ requests, proposalId, beneficiaries, aidLines = [], readOnly = false,
  proposalVersion, onDocumentsChanged }: {
  requests: PrivateRequests; proposalId: string; beneficiaries: Beneficiary[]; aidLines?: AidLine[]; readOnly?: boolean;
  proposalVersion?: number; onDocumentsChanged?: () => void;
}) {
  const [documents, setDocuments] = useState<ProposalDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [policy, setPolicy] = useState<DisbursementPolicy | "unavailable" | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const version = readOnly ? proposalVersion : undefined;
  useEffect(() => {
    if (readOnly) return;
    let disposed = false;
    getInstitutionPolicy(requests)
      .then((value) => { if (!disposed) setPolicy(value); })
      .catch(() => { if (!disposed) setPolicy("unavailable"); });
    return () => { disposed = true; };
  }, [requests, readOnly]);
  const required = useMemo(
    () => (policy && policy !== "unavailable" ? requiredDocuments(policy, beneficiaries, documents) : []),
    [policy, beneficiaries, documents],
  );
  const missing = required.filter((item) => !item.done).length;
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
  const fileList = loading
    ? <p className="text-xs">Memuat dokumen…</p>
    : !error && <ProposalDocumentList documents={documents} beneficiaries={beneficiaries} readOnly={readOnly} onDownload={download} onDelete={remove} />;
  return (
    <section aria-label="Lampiran dokumen pengajuan" className="space-y-4 rounded-xl border border-stone-200 bg-white p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4" />Dokumen dan Lampiran Terbatas</h4>
      <p className="text-xs text-stone-500">Berkas terlindungi dan hanya dapat diakses pihak berwenang.</p>
      <details className="text-xs text-stone-500"><summary>Detail perlindungan berkas</summary>
        Berkas disimpan terenkripsi AES-256-GCM dan diperiksa integritasnya saat diunduh.
      </details>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
      {readOnly ? fileList : (
        // One panel at a time: the checklist, the upload tools and the file table each grow with the roster.
        <Tabs value={tab ?? (loading || !policy || missing > 0 ? "status" : "files")} onValueChange={setTab} className="space-y-3">
          <TabsList>
            <TabsTrigger value="status">
              Kelengkapan
              {policy && policy !== "unavailable" && required.length > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 text-[10px] ${missing ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>
                  {missing ? `${missing} belum` : "lengkap"}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="upload">Unggah</TabsTrigger>
            <TabsTrigger value="files">Berkas ({documents.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="status" className="mt-0">
            {loading || policy === null
              ? <p className="text-xs text-stone-500">Memuat kelengkapan dokumen…</p>
              : policy === "unavailable"
                ? <p className="text-xs text-stone-500">Kebijakan dokumen lembaga tidak dapat dimuat; kelengkapan akan diperiksa saat pengajuan.</p>
                : !error && <ProposalRequiredDocuments items={required} />}
          </TabsContent>
          <TabsContent value="upload" className="mt-0 space-y-4">
            {beneficiaries.length > 1 && (
              <BeneficiaryIdentityBulkUpload
                requests={requests}
                proposalId={proposalId}
                beneficiaries={beneficiaries}
                aidLines={aidLines}
                onUploaded={changed}
              />
            )}
            <ProposalDocumentUpload requests={requests} proposalId={proposalId} beneficiaries={beneficiaries} onUploaded={changed} />
          </TabsContent>
          <TabsContent value="files" className="mt-0">{fileList}</TabsContent>
        </Tabs>
      )}
    </section>
  );
}
