import React, { useState } from "react";
import { AlertCircle, FileText, Shield, Upload, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import {
  createAuditFinding,
  type CreateAuditFindingInput,
} from "./auditFindingClient";
import {
  AUDIT_FINDING_SCOPES,
  AUDIT_FINDING_SCOPE_LABELS,
  AUDIT_FINDING_SEVERITIES,
  AUDIT_FINDING_SEVERITY_LABELS,
  type AuditFindingScope,
  type AuditFindingSeverity,
} from "../../../../shared/audit-findings";

interface CreateAuditFindingModalProps {
  isOpen: boolean;
  requests: PrivateRequests;
  preparationId: string;
  packageId: string;
  onClose: () => void;
  onCreated: () => void;
}

type FileDraft = {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  sizeBytes: number;
};

export function CreateAuditFindingModal({
  isOpen,
  requests,
  preparationId,
  packageId,
  onClose,
  onCreated,
}: CreateAuditFindingModalProps) {
  const [scope, setScope] = useState<AuditFindingScope>("SUMBER_DATA");
  const [severity, setSeverity] = useState<AuditFindingSeverity>("TEMUAN_RINGAN");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [targetProposalId, setTargetProposalId] = useState("");
  const [targetProposalVersion, setTargetProposalVersion] = useState<number | "">("");
  const [targetRealizationId, setTargetRealizationId] = useState("");
  const [targetDocumentId, setTargetDocumentId] = useState("");

  const [workingPapers, setWorkingPapers] = useState<FileDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleFileRead(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError(`Berkas ${file.name} melebihi batas 10MB.`);
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

      setWorkingPapers((prev) => [
        ...prev,
        {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64: base64,
          sizeBytes: file.size,
        },
      ]);
      setError(null);
    } catch {
      setError(`Gagal membaca berkas ${file.name}.`);
    }
    e.target.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      setError("Judul dan deskripsi temuan wajib diisi.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const input: CreateAuditFindingInput = {
        scope,
        severity,
        title: title.trim(),
        description: description.trim(),
        targetProposalId: targetProposalId.trim() || null,
        targetProposalVersion: targetProposalVersion !== "" ? Number(targetProposalVersion) : null,
        targetRealizationId: targetRealizationId.trim() || null,
        targetDocumentId: targetDocumentId.trim() || null,
        workingPapers: workingPapers.map((wp) => ({
          fileName: wp.fileName,
          mimeType: wp.mimeType,
          contentBase64: wp.contentBase64,
        })),
      };

      await createAuditFinding(requests, preparationId, packageId, input);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mencatat temuan.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-audit-finding-title"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-900/60 p-4 backdrop-blur-sm"
    >
      <div className="relative my-8 w-full max-w-2xl rounded-2xl border border-stone-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-stone-200 p-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-amber-600" />
            <h2 id="create-audit-finding-title" className="text-lg font-bold text-stone-900">
              Catat Temuan Pemeriksaan Baru
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-600"
            aria-label="Tutup form"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div role="alert" className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">
                Lingkup Temuan (Scope) <span className="text-red-500">*</span>
              </label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as AuditFindingScope)}
                className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
                disabled={submitting}
              >
                {AUDIT_FINDING_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {AUDIT_FINDING_SCOPE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">
                Tingkat Keparahan (Severity) <span className="text-red-500">*</span>
              </label>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as AuditFindingSeverity)}
                className="mt-1 block w-full rounded-lg border border-stone-300 bg-white p-2.5 text-sm focus:border-amber-500 focus:outline-none"
                disabled={submitting}
              >
                {AUDIT_FINDING_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {AUDIT_FINDING_SEVERITY_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">
              Judul Temuan <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Selisih Rekening Koran Bank Penampung dengan Mutasi Masuk"
              className="mt-1 block w-full rounded-lg border border-stone-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
              required
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">
              Deskripsi & Catatan Pemeriksaan <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Jelaskan fakta pemeriksaan, perbedaan angka/dokumen yang ditemukan, dan implikasi bagi laporan keuangan…"
              className="mt-1 block w-full rounded-lg border border-stone-300 p-2.5 text-sm focus:border-emerald-500 focus:outline-none"
              required
              disabled={submitting}
            />
          </div>

          {/* Optional target references */}
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-600">
              Objek Tertarget (Opsional - Jika Spesifik Pada Objek Tertentu)
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-stone-700 font-medium">Target Proposal ID</label>
                <input
                  type="text"
                  value={targetProposalId}
                  onChange={(e) => setTargetProposalId(e.target.value)}
                  placeholder="prop-..."
                  className="mt-1 block w-full rounded border border-stone-300 bg-white p-2"
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="block text-stone-700 font-medium">Target Versi Proposal</label>
                <input
                  type="number"
                  value={targetProposalVersion}
                  onChange={(e) => setTargetProposalVersion(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="1"
                  className="mt-1 block w-full rounded border border-stone-300 bg-white p-2"
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="block text-stone-700 font-medium">Target Realisasi ID</label>
                <input
                  type="text"
                  value={targetRealizationId}
                  onChange={(e) => setTargetRealizationId(e.target.value)}
                  placeholder="real-..."
                  className="mt-1 block w-full rounded border border-stone-300 bg-white p-2"
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="block text-stone-700 font-medium">Target Dokumen ID</label>
                <input
                  type="text"
                  value={targetDocumentId}
                  onChange={(e) => setTargetDocumentId(e.target.value)}
                  placeholder="doc-..."
                  className="mt-1 block w-full rounded border border-stone-300 bg-white p-2"
                  disabled={submitting}
                />
              </div>
            </div>
          </div>

          {/* Working papers */}
          <div>
            <label className="block text-xs font-semibold text-stone-700 uppercase tracking-wider">
              Kertas Kerja Pemeriksa (Privat - Owner-Only)
            </label>
            <div className="mt-1 flex items-center gap-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50">
                <Upload className="h-3.5 w-3.5" /> Pilih Kertas Kerja
                <input type="file" className="hidden" onChange={handleFileRead} disabled={submitting} />
              </label>
              <span className="text-xs text-stone-400">Berkas tidak dapat diunduh oleh pihak selain auditor</span>
            </div>

            {workingPapers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {workingPapers.map((f, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs text-amber-900"
                  >
                    <span className="truncate flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-amber-700" />
                      {f.fileName} ({(f.sizeBytes / 1024).toFixed(1)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={() => setWorkingPapers((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-red-600 hover:text-red-800"
                    >
                      Hapus
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-stone-200 pt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Batal
            </Button>
            <Button type="submit" disabled={submitting || !title.trim() || !description.trim()}>
              {submitting ? "Mencatat Temuan…" : "Catat Temuan Audit"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
