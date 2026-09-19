import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileCheck,
  FileText,
  Lock,
  MessageSquare,
  Shield,
  Upload,
  X,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { PrivateRequests } from "./privateRequests";
import {
  downloadAuditAttachment,
  fetchAuditFindingDetail,
  submitAmilFindingResponse,
  submitAuditorFindingFollowup,
  type AmilFindingResponseInput,
  type AuditorFindingFollowupInput,
} from "./auditFindingClient";
import type { AuditFinding, AuditFindingEvent } from "../../../../shared/audit-findings";
import {
  FindingScopeBadge,
  FindingSeverityBadge,
  FindingStatusBadge,
} from "./AuditFindingBadge";

interface AuditFindingDetailModalProps {
  findingId: string | null;
  requests: PrivateRequests;
  onClose: () => void;
  onUpdated: () => void;
}

type FileDraft = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  sizeBytes: number;
};

export function AuditFindingDetailModal({
  findingId,
  requests,
  onClose,
  onUpdated,
}: AuditFindingDetailModalProps) {
  const [finding, setFinding] = useState<AuditFinding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Amil response form state
  const [amilNote, setAmilNote] = useState("");
  const [amilFiles, setAmilFiles] = useState<FileDraft[]>([]);

  // Auditor follow-up form state
  const [auditorAction, setAuditorAction] = useState<
    "MINTA_KLARIFIKASI_LANJUTAN" | "BUTUH_KOREKSI_LAPORAN" | "SELESAI_DITUTUP"
  >("MINTA_KLARIFIKASI_LANJUTAN");
  const [auditorNote, setAuditorNote] = useState("");
  const [auditorFiles, setAuditorFiles] = useState<FileDraft[]>([]);

  useEffect(() => {
    if (!findingId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAuditFindingDetail(requests, findingId)
      .then((data) => {
        if (!cancelled) {
          setFinding(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Gagal memuat detail temuan.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [findingId, requests]);

  async function handleFileRead(
    e: React.ChangeEvent<HTMLInputElement>,
    onAdd: (draft: FileDraft) => void
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setActionError(`Berkas ${file.name} melebihi batas ukuran 10MB.`);
      return;
    }

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      onAdd({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64: base64,
        sizeBytes: file.size,
      });
      setActionError(null);
    } catch {
      setActionError(`Gagal membaca berkas ${file.name}.`);
    }
    e.target.value = "";
  }

  async function handleDownload(attachmentId: string, fileName: string) {
    if (!findingId) return;
    try {
      const blob = await downloadAuditAttachment(requests, findingId, attachmentId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengunduh lampiran.");
    }
  }

  async function handleSubmitAmilResponse(e: React.FormEvent) {
    e.preventDefault();
    if (!findingId || !amilNote.trim()) return;

    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const input: AmilFindingResponseInput = {
        note: amilNote.trim(),
        attachments: amilFiles.map((f) => ({
          fileName: f.fileName,
          mimeType: f.mimeType,
          contentBase64: f.contentBase64,
        })),
      };
      const updated = await submitAmilFindingResponse(requests, findingId, input);
      setFinding(updated);
      setAmilNote("");
      setAmilFiles([]);
      setActionSuccess("Tanggapan amil berhasil dicatat.");
      onUpdated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengirim tanggapan.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitAuditorFollowup(e: React.FormEvent) {
    e.preventDefault();
    if (!findingId || !auditorNote.trim()) return;

    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const input: AuditorFindingFollowupInput = {
        action: auditorAction,
        note: auditorNote.trim(),
        workingPapers: auditorFiles.map((f) => ({
          fileName: f.fileName,
          mimeType: f.mimeType,
          contentBase64: f.contentBase64,
        })),
      };
      const updated = await submitAuditorFindingFollowup(requests, findingId, input);
      setFinding(updated);
      setAuditorNote("");
      setAuditorFiles([]);
      setActionSuccess("Tindak lanjut auditor berhasil dicatat.");
      onUpdated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mencatat tindak lanjut.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!findingId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-finding-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-900/60 p-4 backdrop-blur-sm"
    >
      <div className="relative my-8 w-full max-w-3xl rounded-2xl border border-stone-200 bg-white shadow-2xl">
        {/* Header */}
        <header className="flex items-start justify-between border-b border-stone-200 p-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-stone-500">{finding?.id || findingId}</span>
              {finding && (
                <>
                  <FindingStatusBadge status={finding.status} />
                  <FindingSeverityBadge severity={finding.severity} />
                  <FindingScopeBadge scope={finding.scope} />
                </>
              )}
            </div>
            <h2 id="audit-finding-modal-title" className="text-xl font-bold text-stone-900">
              {finding ? finding.title : "Memuat Temuan Audit…"}
            </h2>
            {finding && (
              <p className="text-xs text-stone-600">
                Terikat pada laporan: <span className="font-semibold text-stone-800">{finding.reportId}</span> (versi {finding.version}) · Digest:{" "}
                <span className="font-mono">{finding.packageDigest.slice(0, 16)}…</span>
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            aria-label="Tutup modal"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Modal Body */}
        <div className="max-h-[75vh] overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="py-12 text-center text-stone-500">
              <Clock className="mx-auto h-8 w-8 animate-spin text-stone-400" />
              <p className="mt-2 text-sm">Memuat catatan pemeriksaan…</p>
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          {finding && (
            <>
              {/* Linked Targets (If any) */}
              {(finding.targetProposalId || finding.targetRealizationId || finding.targetDocumentId) && (
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs space-y-1">
                  <span className="font-semibold text-stone-700 uppercase tracking-wider text-[10px]">
                    Objek Pemeriksaan Tertarget:
                  </span>
                  <div className="flex flex-wrap gap-4 text-stone-600">
                    {finding.targetProposalId && (
                      <div>
                        Proposal: <span className="font-mono text-stone-900">{finding.targetProposalId}</span>
                        {finding.targetProposalVersion && ` (v${finding.targetProposalVersion})`}
                      </div>
                    )}
                    {finding.targetRealizationId && (
                      <div>
                        Realisasi: <span className="font-mono text-stone-900">{finding.targetRealizationId}</span>
                      </div>
                    )}
                    {finding.targetDocumentId && (
                      <div>
                        Dokumen: <span className="font-mono text-stone-900">{finding.targetDocumentId}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Timeline (Append-Only Event Log) */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500 flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Riwayat Pemeriksaan & Tanggapan (Append-Only)
                </h3>

                <div className="space-y-4 relative before:absolute before:inset-0 before:left-3 before:w-0.5 before:bg-stone-200">
                  {(finding.events ?? []).map((event: AuditFindingEvent, idx: number) => {
                    const isAuditor = event.actorRole === "AUDITOR";
                    return (
                      <div key={event.id || idx} className="relative pl-8 space-y-2">
                        {/* Dot indicator */}
                        <div
                          className={`absolute left-1.5 top-1.5 h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-white ${
                            isAuditor ? "bg-amber-500" : "bg-emerald-600"
                          }`}
                        />

                        {/* Event Card */}
                        <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2">
                            <div className="flex items-center gap-2 text-xs">
                              <Badge variant={isAuditor ? "warning" : "success"}>
                                {isAuditor ? "Auditor" : "Amil"}
                              </Badge>
                              <span className="font-semibold text-stone-900">{event.actorName}</span>
                              <span className="font-mono text-stone-400">({event.actorAccount.slice(0, 8)}…)</span>
                            </div>
                            <span className="text-xs text-stone-500">
                              {new Date(event.createdAt * 1000).toLocaleString("id-ID")}
                            </span>
                          </div>

                          <p className="text-sm text-stone-800 whitespace-pre-wrap">{event.note}</p>

                          {/* Resulting status transition */}
                          <div className="pt-1 text-xs text-stone-500 flex items-center gap-1.5">
                            <span>Status setelah aksi:</span>
                            <FindingStatusBadge status={event.resultingStatus} />
                          </div>

                          {/* Event Attachments */}
                          {event.attachments && event.attachments.length > 0 && (
                            <div className="mt-3 pt-2 border-t border-stone-100 space-y-2">
                              <span className="text-xs font-semibold text-stone-500 flex items-center gap-1">
                                <FileText className="h-3.5 w-3.5" /> Berkas Lampiran ({event.attachments.length})
                              </span>
                              <ul className="space-y-1.5">
                                {event.attachments.map((att) => (
                                  <li
                                    key={att.id}
                                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      {att.isOwnerOnly ? (
                                        <Lock className="h-4 w-4 shrink-0 text-amber-600" />
                                      ) : (
                                        <FileCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                                      )}
                                      <div className="truncate">
                                        <span className="font-medium text-stone-900">{att.fileName}</span>
                                        <span className="ml-2 text-stone-400">
                                          ({(att.sizeBytes / 1024).toFixed(1)} KB)
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {att.isOwnerOnly && (
                                        <Badge variant="warning">Owner-Only</Badge>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleDownload(att.id, att.fileName)}
                                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                                      >
                                        <Download className="h-3.5 w-3.5" /> Unduh
                                      </button>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Status Alert Banner */}
              {actionError && (
                <div role="alert" className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">
                  <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
                  <span>{actionError}</span>
                </div>
              )}

              {actionSuccess && (
                <div role="status" className="flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  <span>{actionSuccess}</span>
                </div>
              )}

              {/* Action Form: Amil Response */}
              {finding.status !== "DITUTUP_AUDITOR" && (
                <div className="rounded-xl border border-stone-200 bg-stone-50/50 p-5 space-y-4">
                  <div className="border-b border-stone-200 pb-2">
                    <h4 className="text-sm font-bold text-stone-900 flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-emerald-700" />
                      Tanggapan Tim Amil (Pihak Yang Diperiksa)
                    </h4>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Berikan klarifikasi, bukti perbaikan, atau berkas pendukung atas temuan auditor ini.
                    </p>
                  </div>

                  <form onSubmit={handleSubmitAmilResponse} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-700">
                        Catatan / Penjelasan Amil <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        rows={3}
                        value={amilNote}
                        onChange={(e) => setAmilNote(e.target.value)}
                        placeholder="Tuliskan klarifikasi atau langkah tindak lanjut yang telah diambil…"
                        className="mt-1 block w-full rounded-lg border border-stone-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
                        required
                        disabled={submitting}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-700">Lampiran Bukti (Opsional)</label>
                      <div className="mt-1 flex items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50">
                          <Upload className="h-3.5 w-3.5" /> Pilih Berkas
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => handleFileRead(e, (d) => setAmilFiles((prev) => [...prev, d]))}
                            disabled={submitting}
                          />
                        </label>
                        <span className="text-xs text-stone-400">Maks. 10MB per berkas</span>
                      </div>

                      {amilFiles.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {amilFiles.map((f, i) => (
                            <li
                              key={i}
                              className="flex items-center justify-between rounded bg-stone-100 px-2.5 py-1 text-xs text-stone-700"
                            >
                              <span className="truncate">{f.fileName}</span>
                              <button
                                type="button"
                                onClick={() => setAmilFiles((prev) => prev.filter((_, idx) => idx !== i))}
                                className="text-red-600 hover:text-red-800"
                              >
                                Hapus
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <Button type="submit" disabled={submitting || !amilNote.trim()}>
                      {submitting ? "Mengirim Tanggapan…" : "Kirim Tanggapan Amil"}
                    </Button>
                  </form>
                </div>
              )}

              {/* Action Form: Auditor Followup & Closure */}
              {finding.status !== "DITUTUP_AUDITOR" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-5 space-y-4">
                  <div className="border-b border-amber-200 pb-2">
                    <h4 className="text-sm font-bold text-amber-900 flex items-center gap-2">
                      <Shield className="h-4 w-4 text-amber-700" />
                      Tindak Lanjut & Keputusan Auditor Independen
                    </h4>
                    <p className="text-xs text-stone-500 mt-0.5">
                      Hanya auditor yang berwenang yang dapat menindaklanjuti atau menutup temuan. Amil tidak dapat menutup temuan sendiri.
                    </p>
                  </div>

                  <form onSubmit={handleSubmitAuditorFollowup} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-stone-700">
                        Aksi Keputusan Auditor <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={auditorAction}
                        onChange={(e) => setAuditorAction(e.target.value as any)}
                        className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2.5 text-sm focus:border-amber-500 focus:outline-none"
                        disabled={submitting}
                      >
                        <option value="MINTA_KLARIFIKASI_LANJUTAN">
                          Minta Klarifikasi Lanjutan (Tetap Terbuka / Ditindaklanjuti)
                        </option>
                        <option value="BUTUH_KOREKSI_LAPORAN">
                          Butuh Koreksi Laporan (Draf Koreksi Diperlukan)
                        </option>
                        <option value="SELESAI_DITUTUP">
                          Selesai & Tutup Temuan (Temuan Ditutup Penuh)
                        </option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-700">
                        Catatan Tindak Lanjut / Alasan Penutupan <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        rows={3}
                        value={auditorNote}
                        onChange={(e) => setAuditorNote(e.target.value)}
                        placeholder="Tuliskan evaluasi atas tanggapan amil atau dasar penutupan temuan…"
                        className="mt-1 block w-full rounded-lg border border-stone-300 p-2.5 text-sm focus:border-amber-500 focus:outline-none"
                        required
                        disabled={submitting}
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-stone-700">
                        Kertas Kerja Auditor Tambahan (Privat - Hanya Pemeriksa)
                      </label>
                      <div className="mt-1 flex items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50">
                          <Upload className="h-3.5 w-3.5" /> Pilih Kertas Kerja
                          <input
                            type="file"
                            className="hidden"
                            onChange={(e) => handleFileRead(e, (d) => setAuditorFiles((prev) => [...prev, d]))}
                            disabled={submitting}
                          />
                        </label>
                        <span className="text-xs text-stone-400">Tersimpan privat (Owner-Only)</span>
                      </div>

                      {auditorFiles.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {auditorFiles.map((f, i) => (
                            <li
                              key={i}
                              className="flex items-center justify-between rounded bg-amber-100/50 px-2.5 py-1 text-xs text-amber-900"
                            >
                              <span className="truncate">{f.fileName}</span>
                              <button
                                type="button"
                                onClick={() => setAuditorFiles((prev) => prev.filter((_, idx) => idx !== i))}
                                className="text-red-600 hover:text-red-800"
                              >
                                Hapus
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <Button
                      type="submit"
                      variant="outline"
                      className="border-amber-600 text-amber-900 hover:bg-amber-100"
                      disabled={submitting || !auditorNote.trim()}
                    >
                      {submitting ? "Memproses Tindak Lanjut…" : "Simpan Tindak Lanjut Auditor"}
                    </Button>
                  </form>
                </div>
              )}

              {finding.status === "DITUTUP_AUDITOR" && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  <span>
                    Temuan audit ini telah dinyatakan selesai dan ditutup oleh auditor independen. Riwayat pemeriksaan tersimpan secara permanen (append-only) dan tidak dapat diubah lagi.
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-end border-t border-stone-200 p-4">
          <Button variant="outline" onClick={onClose}>
            Tutup
          </Button>
        </footer>
      </div>
    </div>
  );
}
