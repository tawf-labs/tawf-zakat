import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { base64Of } from "./beneficiaryFile";
import { Button } from "../../components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/Dialog";
import { formatIdrAmount } from "../workspace/mandateLabels";
import type { PrivateRequests } from "../workspace/privateRequests";
import {
  applyProposalBeneficiaryList,
  readProposalBeneficiaryListResult,
  recoverProposalBeneficiaryList,
  type ApplyProposalBeneficiaryListInput,
  type ProposalBeneficiaryListResult,
  previewProposalBeneficiaryList,
  type ProposalBeneficiaryListPreviewResponse,
  type ProposalDocument,
  type ProposalDraft,
  type ProposalRevisionRecord,
} from "./disbursementClient";
import { BeneficiaryImportSteps } from "./BeneficiaryImportSteps";
import {
  AccessContextChanged,
  WorkspaceRequestError,
} from "../workspace/privateRequests";

export function ProposalBeneficiaryListModal({
  requests,
  proposal,
  isOpen,
  onClose,
  onAppliedDraft,
  onAppliedRevision,
}: {
  requests: PrivateRequests;
  proposal: ProposalDraft;
  isOpen: boolean;
  onClose: () => void;
  onAppliedDraft: (draft: ProposalDraft, document?: ProposalDocument) => void;
  onAppliedRevision: (
    revision: ProposalRevisionRecord,
    draft: ProposalDraft,
    document?: ProposalDocument,
  ) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPendingUnknown, setIsPendingUnknown] = useState(false);
  const [previewResult, setPreviewResult] =
    useState<ProposalBeneficiaryListPreviewResponse | null>(null);
  const [reason, setReason] = useState("");
  const operationIdRef = useRef<string>(crypto.randomUUID());

  const isApproved = proposal.status === "APPROVED";
  const mode = isApproved
    ? {
        title: "Revisi pengajuan dari daftar penerima",
        action: "Ajukan Revisi dari Berkas",
        description:
          "Perubahan penerima dan hak bantuan menunggu pemeriksaan serta persetujuan kembali.",
      }
    : {
        title: "Perbarui daftar penerima pengajuan",
        action: "Terapkan Perubahan ke Draf",
        description:
          "Periksa perubahan daftar penerima sebelum menyimpannya ke draf pengajuan.",
      };
  const generation = useRef(0);
  const pendingInput = useRef<ApplyProposalBeneficiaryListInput | null>(null);
  // Keep only the opaque operation reference across remount/account changes, never private rows or reason.
  const recoveryKey = `tawf-roster:${requests.contextId.replace(/:[^:]+$/, "")}:${proposal.id}`;
  const [recoveryRequired, setRecoveryRequired] = useState(false);
  async function recoverPreviousOperation(attempt = generation.current) {
    const operationId = sessionStorage.getItem(recoveryKey);
    if (!operationId) return;
    setRecoveryRequired(true);
    setLoading(true);
    try {
      const durable = await recoverProposalBeneficiaryList(
        requests,
        proposal.id,
        operationId,
      );
      if (attempt !== generation.current) return;
      requests.assertCurrent();
      sessionStorage.removeItem(recoveryKey);
      setRecoveryRequired(false);
      if (!("pending" in durable)) {
        acceptResult(durable);
        return;
      }
      if (durable.version !== proposal.version)
        setError(
          "Versi pengajuan berubah. Tutup dialog dan muat ulang pengajuan.",
        );
    } catch (error) {
      if (
        attempt === generation.current &&
        !(error instanceof AccessContextChanged)
      )
        setError(
          "Hasil operasi sebelumnya belum dapat dibaca. Periksa kembali sebelum mengunggah berkas baru.",
        );
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    generation.current++;
    setPreviewResult(null);
    setError(null);
    setIsPendingUnknown(false);
    pendingInput.current = null;
    if (isOpen) void recoverPreviousOperation(generation.current);
    return () => {
      generation.current++;
    };
  }, [requests.contextId, proposal.id, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setPreviewResult(null);
      setError(null);
      setIsPendingUnknown(false);
      setReason("");
      operationIdRef.current = crypto.randomUUID();
    }
  }, [isOpen]);

  async function handleFile(file: File) {
    const attempt = ++generation.current;
    setLoading(true);
    setError(null);
    setPreviewResult(null);
    setIsPendingUnknown(false);
    try {
      const contentBase64 = await base64Of(file);
      const res = await previewProposalBeneficiaryList(requests, proposal.id, {
        fileName: file.name,
        contentBase64,
      });
      if (attempt !== generation.current) return;
      requests.assertCurrent();
      pendingInput.current = null;
      operationIdRef.current = crypto.randomUUID();
      setPreviewResult(res);
    } catch (err: unknown) {
      if (
        attempt === generation.current &&
        !(err instanceof AccessContextChanged)
      )
        setError(
          err instanceof Error ? err.message : "Gagal membaca daftar penerima.",
        );
    } finally {
      if (attempt === generation.current) setLoading(false);
    }
  }

  function acceptResult(result: ProposalBeneficiaryListResult) {
    requests.assertCurrent();
    sessionStorage.removeItem(recoveryKey);
    if (result.revision)
      onAppliedRevision(result.revision, result.draft, result.document);
    else onAppliedDraft(result.draft, result.document);
    onClose();
  }

  async function handleApply() {
    if (
      !previewResult?.diff.canApply ||
      (isApproved && !previewResult.diff.isIdentical && !reason.trim())
    )
      return;
    const attempt = generation.current;
    const input = pendingInput.current ?? {
      previewId: previewResult.previewId,
      expectedVersion: previewResult.diff.baseVersion,
      operationId: operationIdRef.current,
      ...(isApproved && !previewResult.diff.isIdentical
        ? { reason: reason.trim() }
        : {}),
    };
    pendingInput.current = input;
    setSubmitting(true);
    setError(null);
    try {
      sessionStorage.setItem(recoveryKey, input.operationId);
      if (isPendingUnknown) {
        const durable = await readProposalBeneficiaryListResult(
          requests,
          proposal.id,
          input,
        );
        if (attempt !== generation.current) return;
        if (!("pending" in durable)) {
          acceptResult(durable);
          return;
        }
        if (durable.version !== input.expectedVersion)
          throw new Error(
            "Versi pengajuan berubah. Tutup dialog dan muat ulang pengajuan.",
          );
      }
      const result = await applyProposalBeneficiaryList(
        requests,
        proposal.id,
        input,
      );
      if (attempt === generation.current) acceptResult(result);
    } catch (err) {
      if (attempt !== generation.current || err instanceof AccessContextChanged)
        return;
      const unknown =
        !(err instanceof WorkspaceRequestError) || err.status >= 500;
      setIsPendingUnknown(unknown);
      setError(
        unknown
          ? "Hasil penyimpanan belum diketahui. Periksa hasil tersimpan sebelum mencoba kembali."
          : err.message,
      );
      if (!unknown) {
        pendingInput.current = null;
        sessionStorage.removeItem(recoveryKey);
      }
    } finally {
      if (attempt === generation.current) setSubmitting(false);
    }
  }

  const diff = previewResult?.diff;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !submitting) onClose();
      }}
    >
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-y-auto"
        showCloseButton={!submitting}
      >
        <DialogTitle className="flex items-center gap-2 text-stone-900 text-base font-semibold">
          <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
          {mode.title}
        </DialogTitle>
        <DialogDescription className="text-xs text-stone-600">
          {mode.description} Versi dasar: {proposal.version}.
        </DialogDescription>

        <div className="space-y-6 py-2 text-xs text-stone-800">
          <fieldset
            disabled={submitting || isPendingUnknown || recoveryRequired}
          >
            <BeneficiaryImportSteps
              requests={requests}
              loading={loading}
              onFile={handleFile}
              onError={setError}
            />
          </fieldset>
          {recoveryRequired && (
            <Button
              type="button"
              onClick={() => void recoverPreviousOperation()}
              disabled={loading}
            >
              Periksa hasil operasi sebelumnya
            </Button>
          )}
          {previewResult?.warnings.map((warning) => (
            <p key={warning} role="status" className="text-amber-800">
              {warning}
            </p>
          ))}
          {previewResult?.preview.issues.map((issue, index) => (
            <p key={index} role="alert" className="text-rose-800">
              {issue.rowNumber ? `Baris ${issue.rowNumber}: ` : ""}
              {issue.column ? `${issue.column}: ` : ""}
              {issue.message}
            </p>
          ))}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 space-y-1"
            >
              <p className="flex items-center gap-1.5 font-bold text-rose-900">
                <AlertCircle className="h-4 w-4 text-rose-600" /> Gagal
                Memproses
              </p>
              <p>{error}</p>
              {isPendingUnknown && (
                <p className="text-[11px] text-rose-700">
                  Operasi akan menggunakan ID yang sama saat dicoba lagi untuk
                  mencegah pembuatan data ganda.
                </p>
              )}
            </div>
          )}

          {diff && (
            <div className="space-y-5 rounded-2xl border border-stone-200 bg-stone-50/50 p-4">
              {/* Summary Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800 border border-emerald-200">
                  +{diff.aidLineCounts.added} Baris Ditambah (
                  {diff.beneficiaryCounts.added} Penerima)
                </span>
                <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800 border border-amber-200">
                  ~{diff.aidLineCounts.modified} Baris Diubah (
                  {diff.beneficiaryCounts.modified} Penerima)
                </span>
                <span className="rounded-full bg-rose-100 px-3 py-1 font-semibold text-rose-800 border border-rose-200">
                  -{diff.aidLineCounts.removed} Baris Dihapus (
                  {diff.beneficiaryCounts.removed} Penerima)
                </span>
                <span className="rounded-full bg-stone-100 px-3 py-1 font-semibold text-stone-700 border border-stone-300">
                  ={diff.aidLineCounts.unchanged} Baris Tidak Berubah (
                  {diff.beneficiaryCounts.unchanged} Penerima)
                </span>
              </div>

              {diff.isIdentical && (
                <div
                  role="status"
                  className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 flex items-center gap-2"
                >
                  <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
                  Berkas identik dengan daftar pengajuan saat ini. Tidak ada
                  baris yang berubah atau identitas baru yang dibuat.
                </div>
              )}

              {/* Totals Before vs After Comparison */}
              <div className="rounded-xl border border-stone-200 bg-white p-4 space-y-2">
                <h4 className="font-semibold text-stone-900 text-xs">
                  Perbandingan Total Hak Bantuan per Satuan
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {Object.keys({
                    ...diff.totalsBefore,
                    ...diff.totalsAfter,
                  }).map((unit) => {
                    const before = diff.totalsBefore[unit] ?? "0";
                    const after = diff.totalsAfter[unit] ?? "0";
                    const isMoney = unit === "IDR";
                    const labelBefore = isMoney
                      ? formatIdrAmount(before)
                      : `${before} ${unit.split(":")[1] || unit}`;
                    const labelAfter = isMoney
                      ? formatIdrAmount(after)
                      : `${after} ${unit.split(":")[1] || unit}`;
                    const isChanged = before !== after;

                    return (
                      <div
                        key={unit}
                        className={`rounded-lg border p-2.5 text-xs ${isChanged ? "border-amber-200 bg-amber-50/40" : "border-stone-200 bg-stone-50/40"}`}
                      >
                        <p className="font-semibold text-stone-700">
                          {isMoney ? "Uang Tunai (IDR)" : unit}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5 text-stone-900">
                          <span className="text-stone-500 line-through">
                            {labelBefore}
                          </span>
                          <ArrowRight className="h-3 w-3 text-stone-400" />
                          <span
                            className={
                              isChanged
                                ? "font-bold text-amber-900"
                                : "font-medium"
                            }
                          >
                            {labelAfter}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Floor rule violation alert */}
              {diff.floorVerdict && !diff.floorVerdict.ok && (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-xs text-rose-900 space-y-1"
                >
                  <p className="flex items-center gap-1.5 font-bold text-rose-900">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />{" "}
                    Perubahan bertentangan dengan realisasi tercatat
                  </p>
                  <p>{diff.floorVerdict.error}</p>
                  <p className="text-[11px] text-rose-700">
                    Perubahan tidak dapat diterapkan karena melanggar realisasi
                    yang telah tercatat.
                  </p>
                </div>
              )}

              {/* Row Diff Details Table */}
              <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
                <div className="border-b border-stone-200 bg-stone-50 px-4 py-2.5">
                  <h4 className="font-semibold text-stone-900 text-xs">
                    Rincian Perubahan per Baris
                  </h4>
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-stone-100">
                  {diff.rowDetails.map((row, idx) => (
                    <div
                      key={`${row.aidLineId}-${idx}`}
                      className="p-3 text-xs space-y-1 hover:bg-stone-50/50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              row.status === "ADDED"
                                ? "bg-emerald-100 text-emerald-800"
                                : row.status === "MODIFIED"
                                  ? "bg-amber-100 text-amber-800"
                                  : row.status === "REMOVED"
                                    ? "bg-rose-100 text-rose-800"
                                    : "bg-stone-100 text-stone-600"
                            }`}
                          >
                            {row.status === "ADDED" && "+ TAMBAH"}
                            {row.status === "MODIFIED" && "~ UBAH"}
                            {row.status === "REMOVED" && "- HAPUS"}
                            {row.status === "UNCHANGED" && "= TETAP"}
                          </span>
                          <span className="font-semibold text-stone-900">
                            {row.name}
                          </span>
                          <span className="text-stone-400">({row.asnaf})</span>
                        </div>
                        <div className="text-stone-600 font-medium">
                          {row.status === "REMOVED" ? (
                            <span className="text-rose-700 line-through">
                              {row.valueBefore}
                            </span>
                          ) : row.status === "ADDED" ? (
                            <span className="text-emerald-700 font-bold">
                              {row.valueAfter}
                            </span>
                          ) : row.status === "MODIFIED" ? (
                            <span className="text-amber-900">
                              {row.valueBefore} → {row.valueAfter}
                            </span>
                          ) : (
                            <span>{row.valueAfter}</span>
                          )}
                        </div>
                      </div>

                      {/* Field-level changes */}
                      {row.changes.length > 0 && row.status !== "REMOVED" && (
                        <div className="ml-6 mt-1 flex flex-wrap gap-2 text-[11px] text-stone-600">
                          {row.changes.map((ch, chIdx) => (
                            <span
                              key={chIdx}
                              className="rounded bg-amber-50 px-2 py-0.5 border border-amber-200 text-amber-900"
                            >
                              <span className="font-medium text-amber-700">
                                {ch.label}:
                              </span>{" "}
                              {ch.before} → {ch.after}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Revision Reason field (if approved proposal) */}
              {isApproved && !diff.isIdentical && (
                <div className="space-y-1.5 pt-2">
                  <label
                    htmlFor="beneficiary-list-revision-reason"
                    className="block text-xs font-semibold text-stone-800"
                  >
                    Alasan Pengajuan Revisi *
                  </label>
                  <input
                    id="beneficiary-list-revision-reason"
                    type="text"
                    disabled={submitting || isPendingUnknown}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Contoh: Penyesuaian penerima dan kuantitas bantuan sesuai hasil survei lapangan terbaru"
                    className="w-full rounded-lg border border-stone-300 px-3 py-2 text-xs text-stone-900 placeholder:text-stone-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                  <p className="text-[11px] text-stone-500">
                    Alasan revisi akan dicatat pada riwayat keputusan dan diikat
                    pada penandatanganan pengesahan revisi.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-stone-200 bg-stone-50 px-6 py-4 rounded-b-2xl">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={submitting}
          >
            Batal
          </Button>
          {diff && (
            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              disabled={
                !diff.canApply ||
                submitting ||
                loading ||
                (isApproved && !diff.isIdentical && !reason.trim())
              }
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {isPendingUnknown ? "Mencoba Ulang..." : "Menerapkan..."}
                </>
              ) : isPendingUnknown ? (
                <>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Coba Lagi (Hasil Belum Diketahui)
                </>
              ) : (
                <>
                  {diff.isIdentical
                    ? "Konfirmasi tanpa perubahan"
                    : mode.action}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
