import { useCallback, useEffect, useState } from "react";
import { Download, Lock } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { AccessContextChanged, type PrivateRequests } from "./privateRequests";
import {
  downloadAuditAttachment,
  fetchAuditFindingDetail,
  submitAmilFindingResponse,
  submitAuditorFindingFollowup,
  submitAuditorHandover,
  submitNoteCorrection,
} from "./auditFindingClient";
import { asFileInputs, AuditDialog, FileField, useAuditWrite, WriteOutcome, type FileDraft } from "./auditFindingForm";
import { FindingScopeBadge, FindingSeverityBadge, FindingStatusBadge } from "./AuditFindingBadge";
import {
  AUDIT_CLAIM_BOUNDARIES,
  AUDITOR_FOLLOWUP_ACTIONS,
  AUDITOR_FOLLOWUP_ACTION_LABELS,
  type AuditFinding,
  type AuditFindingEvent,
  type AuditFindingView,
  type AuditorFollowupAction,
} from "../../../../shared/audit-findings";

type Props = {
  findingId: string;
  requests: PrivateRequests;
  onClose: () => void;
  onUpdated: () => void;
  /** Opens a correction draft that names this finding's version as its predecessor. */
  onStartCorrection?: (packageId: string) => void;
};

const field = "mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/30";
const short = (account: string) => `${account.slice(0, 8)}…${account.slice(-4)}`;
const when = (seconds: number) => new Date(seconds * 1000).toLocaleString("id-ID");

const EVENT_LABELS: Record<AuditFindingEvent["eventType"], string> = {
  FINDING_CREATED: "Temuan dicatat",
  AMIL_RESPONSE: "Tanggapan amil",
  AUDITOR_FOLLOWUP: "Tindak lanjut auditor",
  AUDITOR_CLOSED: "Ditutup auditor",
  NOTE_CORRECTION: "Koreksi catatan",
  AUDITOR_HANDOVER: "Serah terima auditor",
};

export function AuditFindingDetailModal({ findingId, requests, onClose, onUpdated, onStartCorrection }: Props) {
  const [finding, setFinding] = useState<AuditFindingView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setFinding(await fetchAuditFindingDetail(requests, findingId));
    } catch (error) {
      if (!(error instanceof AccessContextChanged)) setLoadError(error instanceof Error ? error.message : "Temuan belum dapat dibaca.");
    }
  }, [requests, findingId]);
  useEffect(() => { void load(); }, [load]);

  const applied = (updated: AuditFinding | null, message: string) => {
    if (!updated) return false;
    setFinding(updated);
    setNotice(message);
    onUpdated();
    return true;
  };

  return (
    <AuditDialog wide onClose={onClose} title={finding?.detail === "FULL" ? finding.title : "Temuan pemeriksaan"}
      footer={<Button variant="outline" onClick={onClose}>Tutup</Button>}>
      {!finding && !loadError && <p role="status" className="text-sm text-stone-600">Memuat riwayat temuan…</p>}
      {loadError && (
        <div role="alert" className="space-y-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <p>{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>Coba lagi</Button>
        </div>
      )}
      {finding && (
        <>
          <section aria-label="Identitas versi" className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <FindingStatusBadge status={finding.status} />
              <FindingSeverityBadge severity={finding.severity} />
              <FindingScopeBadge scope={finding.scope} />
            </div>
            <p className="text-xs text-stone-700">
              Laporan <strong>{finding.reportId}</strong> versi <strong>{finding.reportVersion}</strong> · paket <span className="font-mono">{finding.packageId}</span> · digest <span className="font-mono">{finding.packageDigest.slice(0, 18)}…</span> · revisi riwayat {finding.revision}
            </p>
          </section>

          <details className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
            <summary className="cursor-pointer font-semibold">Apa yang tidak dinyatakan temuan ini</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">{AUDIT_CLAIM_BOUNDARIES.map(line => <li key={line}>{line}</li>)}</ul>
          </details>

          {finding.detail === "STATUS_ONLY"
            ? <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-700">Uraian, tanggapan dan lampiran hanya dapat dibaca amil yang menangani pemeriksaan dan auditor dengan mandat aktif. Anda melihat status temuan untuk versi ini.</p>
            : <FullFinding finding={finding} requests={requests} applied={applied} reload={load} onStartCorrection={onStartCorrection} />}

          {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
        </>
      )}
    </AuditDialog>
  );
}

function FullFinding({ finding, requests, applied, reload, onStartCorrection }: {
  finding: AuditFinding; requests: PrivateRequests; reload: () => Promise<void>;
  applied: (updated: AuditFinding | null, message: string) => boolean;
  onStartCorrection?: (packageId: string) => void;
}) {
  const [downloadError, setDownloadError] = useState("");
  const correctedBy = new Map(finding.events.filter(e => e.correctsEventId).map(e => [e.correctsEventId!, e.seq]));
  const t = finding.targets;
  const targets = [
    t.proposalId && `Pengajuan ${t.proposalId}${t.proposalVersion ? ` v${t.proposalVersion}` : ""}`,
    t.realizationId && `Realisasi ${t.realizationId}`,
    t.documentId && `Dokumen ${t.documentId}`,
    t.disputeId && `Sengketa penerimaan ${t.disputeId}`,
  ].filter(Boolean);

  async function download(attachmentId: string, fileName: string) {
    setDownloadError("");
    try {
      const url = URL.createObjectURL(await downloadAuditAttachment(requests, finding.id, attachmentId));
      const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      if (!(error instanceof AccessContextChanged)) setDownloadError(error instanceof Error ? error.message : "Lampiran tidak dapat diunduh.");
    }
  }

  return (
    <>
      <p className="whitespace-pre-wrap text-sm text-stone-800">{finding.description}</p>
      <p className="text-xs text-stone-600">Auditor ditugaskan: <span className="font-mono">{short(finding.assignedAuditor)}</span></p>
      {targets.length > 0 && <p className="text-xs text-stone-700">Rujukan: {targets.join(" · ")}</p>}

      <CorrectionGuide finding={finding} onStartCorrection={onStartCorrection} />

      <section aria-label="Riwayat pemeriksaan" className="space-y-3">
        <h3 className="text-sm font-semibold text-stone-800">Riwayat (hanya bertambah)</h3>
        <ol className="space-y-3">
          {finding.events.map(event => (
            <li key={event.id} className="rounded-xl border border-stone-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">#{event.seq}</span>
                  <Badge variant={event.actorRole === "AUDITOR" ? "warning" : "success"}>{event.actorRole === "AUDITOR" ? "Auditor" : "Amil"}</Badge>
                  <strong className="text-stone-900">{EVENT_LABELS[event.eventType]}</strong>
                  <span>{event.actorName}</span>
                </span>
                <time>{when(event.createdAt)}</time>
              </div>
              {event.correctsEventId && <p className="mt-1 text-xs text-stone-600">Mengoreksi catatan #{finding.events.find(e => e.id === event.correctsEventId)?.seq}</p>}
              {event.eventType === "AUDITOR_HANDOVER" && (
                <p className="mt-1 text-xs text-stone-700">Ditugaskan kepada <span className="font-mono">{short(event.assignedAuditor!)}</span> · dasar penugasan: {event.assignmentRef}</p>
              )}
              {event.followupAction && <p className="mt-1 text-xs text-stone-700">Keputusan: {AUDITOR_FOLLOWUP_ACTION_LABELS[event.followupAction]}</p>}
              <p className="mt-2 whitespace-pre-wrap">{event.note}</p>
              {correctedBy.has(event.id) && <p className="mt-1 text-xs text-amber-800">Catatan ini dikoreksi pada #{correctedBy.get(event.id)}; teks aslinya tetap ditampilkan.</p>}
              {event.attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {event.attachments.map(file => (
                    <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-stone-50 px-2 py-1 text-xs">
                      <span className="flex items-center gap-1">
                        {file.access === "OWNER_ONLY" && <Lock className="h-3.5 w-3.5 text-amber-700" aria-label="Privat" />}
                        {file.fileName} ({(file.sizeBytes / 1024).toFixed(1)} KB)
                      </span>
                      <button type="button" className="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline" onClick={() => void download(file.id, file.fileName)}>
                        <Download className="h-3.5 w-3.5" /> Unduh
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {event.privateAttachmentCount > 0 && (
                <p className="mt-1 text-xs text-stone-500">{event.privateAttachmentCount} kertas kerja privat auditor (hanya pengunggah yang dapat membuka).</p>
              )}
            </li>
          ))}
        </ol>
        {downloadError && <p role="alert" className="text-sm text-red-700">{downloadError}</p>}
      </section>

      {finding.permissions.respond && <ResponseForm finding={finding} requests={requests} applied={applied} reload={reload} />}
      {finding.permissions.followUp && <FollowupForm finding={finding} requests={requests} applied={applied} reload={reload} />}
      {finding.permissions.followUp && <HandoverForm finding={finding} requests={requests} applied={applied} reload={reload} mode="GIVE" />}
      {finding.permissions.takeOver && <HandoverForm finding={finding} requests={requests} applied={applied} reload={reload} mode="TAKE" />}
      {finding.permissions.correctableEventIds.length > 0 && <CorrectionForm finding={finding} requests={requests} applied={applied} reload={reload} />}
      {finding.status === "DITUTUP_AUDITOR" && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Temuan ditutup auditor. Riwayat tetap dapat dibaca dan tidak dibuka kembali. Penutupan ini bukan opini audit atas laporan.</p>
      )}
    </>
  );
}

function CorrectionGuide({ finding, onStartCorrection }: { finding: AuditFinding; onStartCorrection?: (packageId: string) => void }) {
  if (finding.corrections.length) {
    return (
      <section aria-label="Versi koreksi" className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
        <p className="font-semibold">Versi koreksi tersedia</p>
        <ul className="mt-1 list-disc pl-5 text-xs">
          {finding.corrections.map(c => <li key={c.packageId}>Versi {c.reportVersion} · paket <span className="font-mono">{c.packageId}</span> · persiapan <span className="font-mono">{c.preparationId}</span></li>)}
        </ul>
        <p className="mt-1 text-xs">Versi koreksi memerlukan pengesahan dan pemeriksaannya sendiri; temuan dan opini versi ini tidak diwariskan.</p>
      </section>
    );
  }
  if (finding.status !== "MENUNGGU_KOREKSI_LAPORAN") return null;
  return (
    <section aria-label="Koreksi diperlukan" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p>Auditor meminta versi koreksi. Tanggapan tidak mengubah versi {finding.reportVersion}; sumber resmi diperbaiki melalui versi baru yang menyebut paket ini sebagai pendahulu.</p>
      {onStartCorrection
        ? <Button size="sm" variant="outline" onClick={() => onStartCorrection(finding.packageId)}>Siapkan versi koreksi dari paket ini</Button>
        : <p className="text-xs">Buka paket laporan ini dan isi ID pendahulu <span className="font-mono">{finding.packageId}</span>.</p>}
    </section>
  );
}

type FormProps = {
  finding: AuditFinding; requests: PrivateRequests; reload: () => Promise<void>;
  applied: (updated: AuditFinding | null, message: string) => boolean;
};

function ResponseForm({ finding, requests, applied, reload }: FormProps) {
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<FileDraft[]>([]);
  const write = useAuditWrite();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = { expectedRevision: finding.revision, note: note.trim(), attachments: asFileInputs(files) };
    const updated = await write.run(`respond:${finding.id}:${JSON.stringify(input)}`, operationId => submitAmilFindingResponse(requests, finding.id, { ...input, operationId }));
    if (applied(updated, "Tanggapan tercatat.")) { setNote(""); setFiles([]); }
  }
  return (
    <form onSubmit={submit} aria-label="Tanggapan amil" className="space-y-3 rounded-xl border border-emerald-200 p-4">
      <h3 className="text-sm font-semibold">Tanggapan amil</h3>
      <p className="text-xs text-stone-600">Tanggapan dan lampiran menjadi bukti pemeriksaan tambahan. Penyelesaian sengketa oleh lembaga tidak menutup temuan atas nama auditor.</p>
      <label className="block text-xs font-medium text-stone-700">Penjelasan
        <textarea className={field} rows={3} value={note} onChange={e => setNote(e.target.value)} required maxLength={5000} disabled={write.pending} />
      </label>
      <FileField label="Lampiran untuk pemeriksaan" hint="Dibagikan kepada auditor yang ditugaskan. Maks. 10 MB per berkas." files={files} onChange={setFiles} disabled={write.pending} />
      <WriteOutcome outcome={write.outcome} onReload={() => void reload()} />
      <Button type="submit" disabled={write.pending || !note.trim()}>{write.pending ? "Mengirim…" : "Kirim tanggapan"}</Button>
    </form>
  );
}

function FollowupForm({ finding, requests, applied, reload }: FormProps) {
  const [action, setAction] = useState<AuditorFollowupAction>("MINTA_KLARIFIKASI_LANJUTAN");
  const [note, setNote] = useState("");
  const [workingPapers, setWorkingPapers] = useState<FileDraft[]>([]);
  const [sharedFiles, setSharedFiles] = useState<FileDraft[]>([]);
  const write = useAuditWrite();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = { expectedRevision: finding.revision, action, note: note.trim(), workingPapers: asFileInputs(workingPapers), sharedFiles: asFileInputs(sharedFiles) };
    const updated = await write.run(`followup:${finding.id}:${JSON.stringify(input)}`, operationId => submitAuditorFindingFollowup(requests, finding.id, { ...input, operationId }));
    if (applied(updated, "Tindak lanjut tercatat.")) { setNote(""); setWorkingPapers([]); setSharedFiles([]); }
  }
  return (
    <form onSubmit={submit} aria-label="Tindak lanjut auditor" className="space-y-3 rounded-xl border border-amber-200 p-4">
      <h3 className="text-sm font-semibold">Tindak lanjut auditor</h3>
      <p className="text-xs text-stone-600">Tidak menerbitkan atestasi onchain. Pernyataan lanjutan atas versi memakai alur atestasi.</p>
      <label className="block text-xs font-medium text-stone-700">Keputusan
        <select className={field} value={action} onChange={e => setAction(e.target.value as AuditorFollowupAction)} disabled={write.pending}>
          {AUDITOR_FOLLOWUP_ACTIONS.map(a => <option key={a} value={a}>{AUDITOR_FOLLOWUP_ACTION_LABELS[a]}</option>)}
        </select>
      </label>
      <label className="block text-xs font-medium text-stone-700">Catatan
        <textarea className={field} rows={3} value={note} onChange={e => setNote(e.target.value)} required maxLength={5000} disabled={write.pending} />
      </label>
      <FileField label="Kertas kerja (privat)" hint="Hanya Anda yang dapat membuka." files={workingPapers} onChange={setWorkingPapers} disabled={write.pending} />
      <FileField label="Berkas untuk amil" hint="Dibagikan kepada amil yang menangani pemeriksaan." files={sharedFiles} onChange={setSharedFiles} disabled={write.pending} />
      <WriteOutcome outcome={write.outcome} onReload={() => void reload()} />
      <Button type="submit" disabled={write.pending || !note.trim()}>{write.pending ? "Menyimpan…" : "Simpan tindak lanjut"}</Button>
    </form>
  );
}

function HandoverForm({ finding, requests, applied, reload, mode }: FormProps & { mode: "GIVE" | "TAKE" }) {
  const [toAuditor, setToAuditor] = useState("");
  const [assignmentRef, setAssignmentRef] = useState("");
  const [note, setNote] = useState("");
  const write = useAuditWrite();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = { expectedRevision: finding.revision, assignmentRef: assignmentRef.trim(), note: note.trim(), toAuditor: mode === "GIVE" ? toAuditor.trim() : null };
    const updated = await write.run(`handover:${finding.id}:${JSON.stringify(input)}`, operationId => submitAuditorHandover(requests, finding.id, { ...input, operationId }));
    if (applied(updated, "Serah terima penugasan tercatat.")) { setToAuditor(""); setAssignmentRef(""); setNote(""); }
  }
  return (
    <details className="rounded-xl border border-stone-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold">{mode === "GIVE" ? "Serahkan ke auditor lain" : "Ambil alih penugasan"}</summary>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-xs text-stone-600">{mode === "GIVE"
          ? "Penerima harus memegang mandat auditor aktif pada registry. Kertas kerja privat Anda tetap hanya untuk Anda."
          : "Hanya dapat dilakukan bila mandat auditor yang ditugaskan sudah tidak aktif. Kertas kerja privat auditor sebelumnya tidak terbuka untuk Anda."}</p>
        {mode === "GIVE" && (
          <label className="block text-xs font-medium text-stone-700">Akun auditor penerima
            <input className={field} value={toAuditor} onChange={e => setToAuditor(e.target.value)} placeholder="0x…" required pattern="^0x[0-9a-fA-F]{40}$" disabled={write.pending} />
          </label>
        )}
        <label className="block text-xs font-medium text-stone-700">Dasar penugasan (nomor surat)
          <input className={field} value={assignmentRef} onChange={e => setAssignmentRef(e.target.value)} required maxLength={300} disabled={write.pending} />
        </label>
        <label className="block text-xs font-medium text-stone-700">Catatan serah terima
          <textarea className={field} rows={2} value={note} onChange={e => setNote(e.target.value)} required maxLength={2000} disabled={write.pending} />
        </label>
        <WriteOutcome outcome={write.outcome} onReload={() => void reload()} />
        <Button type="submit" variant="outline" disabled={write.pending || !assignmentRef.trim() || !note.trim()}>Catat serah terima</Button>
      </form>
    </details>
  );
}

function CorrectionForm({ finding, requests, applied, reload }: FormProps) {
  const correctable = finding.events.filter(e => finding.permissions.correctableEventIds.includes(e.id));
  const [eventId, setEventId] = useState(correctable[correctable.length - 1]?.id ?? "");
  const [note, setNote] = useState("");
  const write = useAuditWrite();
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = { expectedRevision: finding.revision, eventId, note: note.trim() };
    const updated = await write.run(`correct:${finding.id}:${JSON.stringify(input)}`, operationId => submitNoteCorrection(requests, finding.id, { ...input, operationId }));
    if (applied(updated, "Koreksi catatan tercatat; catatan asli tetap terbaca.")) setNote("");
  }
  return (
    <details className="rounded-xl border border-stone-200 p-4">
      <summary className="cursor-pointer text-sm font-semibold">Koreksi catatan saya</summary>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-xs text-stone-600">Koreksi ditambahkan ke riwayat; catatan asli tidak ditimpa dan status tidak berubah.</p>
        <label className="block text-xs font-medium text-stone-700">Catatan yang dikoreksi
          <select className={field} value={eventId} onChange={e => setEventId(e.target.value)} disabled={write.pending}>
            {correctable.map(e => <option key={e.id} value={e.id}>#{e.seq} {EVENT_LABELS[e.eventType]}: {e.note.slice(0, 60)}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-stone-700">Isi koreksi
          <textarea className={field} rows={2} value={note} onChange={e => setNote(e.target.value)} required maxLength={5000} disabled={write.pending} />
        </label>
        <WriteOutcome outcome={write.outcome} onReload={() => void reload()} />
        <Button type="submit" variant="outline" disabled={write.pending || !note.trim() || !eventId}>Catat koreksi</Button>
      </form>
    </details>
  );
}
