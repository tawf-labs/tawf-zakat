import { useId, useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { uploadProposalDocument, type Beneficiary, type ProposalDocumentCategory } from "./disbursementClient";
import { CATEGORY_LABELS } from "./ProposalDocumentList";

export function ProposalDocumentUpload({ requests, proposalId, beneficiaries, onUploaded }: {
  requests: PrivateRequests; proposalId: string; beneficiaries: Beneficiary[]; onUploaded: () => void;
}) {
  const id = useId();
  const [category, setCategory] = useState<ProposalDocumentCategory>("PROPOSAL_LETTER");
  const [beneficiaryId, setBeneficiaryId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || uploading) return;
    if (!file.size || file.size > 10 * 1024 * 1024) {
      setError("Pilih berkas tidak kosong dengan ukuran maksimal 10 MB.");
      return;
    }
    const form = event.currentTarget;
    setUploading(true);
    setError(null);
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]);
        reader.onerror = () => reject(new Error("Berkas tidak dapat dibaca."));
        reader.readAsDataURL(file);
      });
      await uploadProposalDocument(requests, proposalId, {
        category, beneficiaryId: beneficiaryId || null,
        fileName: file.name, mimeType: file.type || "application/octet-stream", contentBase64,
      });
      requests.assertCurrent();
      setFile(null);
      form.reset();
      onUploaded();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Dokumen gagal diunggah.");
    } finally { setUploading(false); }
  }
  return (
    <form onSubmit={upload} className="space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs">
      <fieldset disabled={uploading} className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-medium">Unggah Dokumen Baru</legend>
        <div><label htmlFor={`${id}-category`}>Kategori Dokumen</label>
          <select id={`${id}-category`} value={category} onChange={e => setCategory(e.target.value as ProposalDocumentCategory)} className="block w-full rounded border p-2">
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div><label htmlFor={`${id}-beneficiary`}>Penerima Manfaat (Opsional)</label>
          <select id={`${id}-beneficiary`} value={beneficiaryId} onChange={e => setBeneficiaryId(e.target.value)} className="block w-full rounded border p-2">
            <option value="">Umum / Seluruh Pengajuan</option>
            {beneficiaries.map(b => <option key={b.id} value={b.id}>{b.name || "Penerima tanpa nama"}</option>)}
          </select>
        </div>
        <div><label htmlFor={`${id}-file`}>Pilih Berkas (Maks. 10 MB)</label>
          <input id={`${id}-file`} type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} className="block w-full" />
        </div>
      </fieldset>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      <Button type="submit" size="sm" disabled={uploading || !file}>{uploading ? "Mengunggah…" : "Unggah Dokumen"}</Button>
    </form>
  );
}
