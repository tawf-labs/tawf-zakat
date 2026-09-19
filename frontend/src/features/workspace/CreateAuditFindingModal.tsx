import { useState } from "react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import { createAuditFinding, type CreateAuditFindingInput } from "./auditFindingClient";
import { asFileInputs, AuditDialog, FileField, useAuditWrite, WriteOutcome, type FileDraft } from "./auditFindingForm";
import {
  AUDIT_FINDING_SCOPES,
  AUDIT_FINDING_SCOPE_LABELS,
  AUDIT_FINDING_SEVERITIES,
  AUDIT_FINDING_SEVERITY_LABELS,
  type AuditFinding,
  type AuditFindingScope,
  type AuditFindingSeverity,
} from "../../../../shared/audit-findings";

type Props = {
  requests: PrivateRequests;
  preparationId: string;
  packageId: string;
  packageDigest: string;
  reportId: string;
  reportVersion: string;
  onClose: () => void;
  onCreated: (finding: AuditFinding) => void;
};

const field = "mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30";
const orNull = (value: string) => value.trim() || null;

export function CreateAuditFindingModal({ requests, preparationId, packageId, packageDigest, reportId, reportVersion, onClose, onCreated }: Props) {
  const [scope, setScope] = useState<AuditFindingScope>("DOKUMEN_BUKTI");
  const [severity, setSeverity] = useState<AuditFindingSeverity>("TEMUAN_RINGAN");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [proposalId, setProposalId] = useState("");
  const [proposalVersion, setProposalVersion] = useState("");
  const [realizationId, setRealizationId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [disputeId, setDisputeId] = useState("");
  const [workingPapers, setWorkingPapers] = useState<FileDraft[]>([]);
  const [sharedFiles, setSharedFiles] = useState<FileDraft[]>([]);
  const write = useAuditWrite();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const input: Omit<CreateAuditFindingInput, "operationId"> = {
      packageDigest, scope, severity, title: title.trim(), description: description.trim(),
      targets: {
        proposalId: orNull(proposalId), proposalVersion: proposalVersion ? Number(proposalVersion) : null,
        realizationId: orNull(realizationId), documentId: orNull(documentId), disputeId: orNull(disputeId),
      },
      workingPapers: asFileInputs(workingPapers), sharedFiles: asFileInputs(sharedFiles),
    };
    const finding = await write.run(`create:${JSON.stringify(input)}`, operationId =>
      createAuditFinding(requests, preparationId, packageId, { ...input, operationId }));
    if (finding) onCreated(finding);
  }

  return (
    <AuditDialog title="Catat temuan pemeriksaan" onClose={onClose}>
      <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-700">
        Temuan terikat pada laporan <strong>{reportId}</strong> versi <strong>{reportVersion}</strong>, paket <span className="font-mono">{packageId}</span>, digest <span className="font-mono">{packageDigest.slice(0, 18)}…</span>. Jika versi tersimpan berbeda dari yang Anda tinjau, pencatatan ditolak.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-xs font-medium text-stone-700">Lingkup
            <select className={field} value={scope} onChange={e => setScope(e.target.value as AuditFindingScope)} disabled={write.pending}>
              {AUDIT_FINDING_SCOPES.map(s => <option key={s} value={s}>{AUDIT_FINDING_SCOPE_LABELS[s]}</option>)}
            </select>
          </label>
          <label className="block text-xs font-medium text-stone-700">Tingkat
            <select className={field} value={severity} onChange={e => setSeverity(e.target.value as AuditFindingSeverity)} disabled={write.pending}>
              {AUDIT_FINDING_SEVERITIES.map(s => <option key={s} value={s}>{AUDIT_FINDING_SEVERITY_LABELS[s]}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-xs font-medium text-stone-700">Judul temuan
          <input className={field} value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} disabled={write.pending} />
        </label>
        <label className="block text-xs font-medium text-stone-700">Uraian dan kriteria pemeriksaan
          <textarea className={field} rows={4} value={description} onChange={e => setDescription(e.target.value)} required maxLength={5000} disabled={write.pending} />
        </label>

        <fieldset className="space-y-2 rounded-lg border border-stone-200 p-3">
          <legend className="px-1 text-xs font-semibold text-stone-700">Rujukan operasional (opsional)</legend>
          <p className="text-xs text-stone-600">Menautkan tidak mengubah jumlah, status penerimaan, sengketa atau keputusan lembaga. Rujukan harus ada pada lembaga ini.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs text-stone-700">ID pengajuan<input className={field} value={proposalId} onChange={e => setProposalId(e.target.value)} disabled={write.pending} /></label>
            <label className="block text-xs text-stone-700">Versi pengajuan<input className={field} type="number" min={1} value={proposalVersion} onChange={e => setProposalVersion(e.target.value)} disabled={write.pending} /></label>
            <label className="block text-xs text-stone-700">ID realisasi<input className={field} value={realizationId} onChange={e => setRealizationId(e.target.value)} disabled={write.pending} /></label>
            <label className="block text-xs text-stone-700">ID dokumen<input className={field} value={documentId} onChange={e => setDocumentId(e.target.value)} disabled={write.pending} /></label>
            <label className="block text-xs text-stone-700 sm:col-span-2">ID sengketa penerimaan<input className={field} value={disputeId} onChange={e => setDisputeId(e.target.value)} disabled={write.pending} /></label>
          </div>
        </fieldset>

        <FileField label="Kertas kerja auditor (privat)" hint="Hanya dapat dibuka oleh Anda sebagai pengunggah, termasuk setelah pergantian auditor. Maks. 10 MB per berkas."
          files={workingPapers} onChange={setWorkingPapers} disabled={write.pending} />
        <FileField label="Berkas untuk amil (dibagikan dalam pemeriksaan)" hint="Dapat dibuka amil yang menangani pemeriksaan dan auditor yang ditugaskan."
          files={sharedFiles} onChange={setSharedFiles} disabled={write.pending} />

        <WriteOutcome outcome={write.outcome} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={write.pending || !title.trim() || !description.trim()}>
            {write.pending ? "Mencatat…" : write.outcome?.kind === "unknown" ? "Kirim ulang isi yang sama" : "Catat temuan"}
          </Button>
        </div>
      </form>
    </AuditDialog>
  );
}
