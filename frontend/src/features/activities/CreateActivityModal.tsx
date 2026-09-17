import { useState } from "react";
import { AlertCircle, FolderPlus, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { errorMessage, useOperationIds } from "../contributions/contributionUi";
import { createActivity, type DistributionActivity } from "./activityClient";

const fieldClass =
  "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-500";

export function CreateActivityModal({
  requests,
  onClose,
  onCreated,
}: {
  requests: PrivateRequests;
  onClose: () => void;
  onCreated: (activity: DistributionActivity) => void;
}) {
  const [proposalId, setProposalId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operations = useOperationIds();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = { proposalId: proposalId.trim(), name: name.trim() || undefined, description: description.trim() || undefined };
    if (!input.proposalId) return setError("ID pengajuan wajib diisi.");

    // Same content, same operationId: a retry after a lost response replays instead of creating twice.
    const intent = `create-activity:${JSON.stringify(input)}`;
    setBusy(true);
    setError(null);
    try {
      const activity = await createActivity(requests, { ...input, operationId: operations.operationFor(intent) });
      operations.settle(intent);
      onCreated(activity);
    } catch (err) {
      setError(errorMessage(err, "Gagal membuat kegiatan penyaluran."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label="Buat kegiatan penyaluran" className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 bg-stone-50/80">
          <h3 className="flex items-center gap-2 text-base font-bold text-stone-900">
            <FolderPlus className="h-5 w-5 text-emerald-700" />
            Buat Kegiatan Penyaluran
          </h3>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <p className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900">
            Kegiatan hanya dapat dibuat dari pengajuan yang telah disahkan (<strong>APPROVED</strong>), satu kegiatan untuk
            setiap versi pengajuan. Target dihitung dari rincian bantuan pengajuan.
          </p>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <label className="block text-xs font-semibold text-stone-700">
            ID pengajuan yang disahkan <span className="text-red-500">*</span>
            <input required value={proposalId} onChange={(e) => setProposalId(e.target.value)} className={`${fieldClass} mt-1 font-mono`} placeholder="prop-…" />
          </label>
          <label className="block text-xs font-semibold text-stone-700">
            Nama kegiatan (opsional)
            <input value={name} onChange={(e) => setName(e.target.value)} className={`${fieldClass} mt-1`} placeholder="Kosongkan untuk memakai tujuan pengajuan" />
          </label>
          <label className="block text-xs font-semibold text-stone-700">
            Keterangan (opsional)
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={`${fieldClass} mt-1`} />
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
            <Button variant="outline" type="button" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" disabled={busy || !proposalId.trim()}>{busy ? "Memproses…" : "Buat Kegiatan"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
