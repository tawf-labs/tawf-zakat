import { useEffect, useState } from "react";
import { AlertCircle, ArrowRightLeft, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { formatNominal } from "../contributions/contributionClient";
import { errorMessage, useOperationIds } from "../contributions/contributionUi";
import {
  listActivities,
  reallocateAllocation,
  type ActivityDetail,
  type DistributionActivity,
} from "./activityClient";

const fieldClass =
  "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-500";

export function ReallocateModal({
  requests,
  sourceActivity,
  onClose,
  onReallocated,
}: {
  requests: PrivateRequests;
  sourceActivity: ActivityDetail;
  onClose: () => void;
  onReallocated: () => void;
}) {
  const [activities, setActivities] = useState<DistributionActivity[]>([]);
  const [targetActivityId, setTargetActivityId] = useState("");
  const activeAllocations = sourceActivity.allocations.filter((a) => a.status === "ACTIVE");
  const [sourceAllocationId, setSourceAllocationId] = useState(activeAllocations[0]?.id ?? "");
  const [amountExact, setAmountExact] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operations = useOperationIds();

  useEffect(() => {
    let cancelled = false;
    listActivities(requests)
      .then((list) => {
        if (!cancelled) {
          const others = list.filter((a) => a.id !== sourceActivity.id);
          setActivities(others);
          if (others.length > 0 && !targetActivityId) {
            setTargetActivityId(others[0].id);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err, "Gagal memuat daftar kegiatan tujuan."));
      });
    return () => {
      cancelled = true;
    };
  }, [requests, sourceActivity.id]);

  const selectedAlloc = activeAllocations.find((a) => a.id === sourceAllocationId);
  const selectedTarget = activities.find((a) => a.id === targetActivityId);
  const availableBalance = sourceActivity.accountability?.availableForReallocation ?? "0";

  // Pre-fill amount if empty and available balance > 0
  useEffect(() => {
    if (!amountExact && selectedAlloc && BigInt(availableBalance) > 0n) {
      const allocAmt = BigInt(selectedAlloc.amountExact);
      const avail = BigInt(availableBalance);
      const prefill = allocAmt < avail ? allocAmt : avail;
      setAmountExact(prefill.toString());
    }
  }, [selectedAlloc, availableBalance]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetActivityId) return setError("Kegiatan tujuan wajib dipilih.");
    if (!sourceAllocationId) return setError("Alokasi sumber wajib dipilih.");
    if (!amountExact || !/^\d+$/.test(amountExact.trim()) || BigInt(amountExact.trim()) <= 0n) {
      return setError("Nominal pengalihan wajib berupa angka bulat lebih dari 0.");
    }
    if (!reason.trim()) {
      return setError("Alasan pengalihan wajib diisi agar keputusan lembaga dapat dipertanggungjawabkan.");
    }

    const requestedAmt = BigInt(amountExact.trim());
    if (requestedAmt > BigInt(availableBalance)) {
      return setError(
        `Nominal pengalihan (${formatNominal(requestedAmt.toString(), sourceActivity.currencyUnit)}) melebihi sisa dana yang dapat dialihkan (${formatNominal(availableBalance, sourceActivity.currencyUnit)}).`
      );
    }
    if (selectedAlloc && requestedAmt > BigInt(selectedAlloc.amountExact)) {
      return setError(
        `Nominal pengalihan melebihi nominal alokasi sumber (${formatNominal(selectedAlloc.amountExact, selectedAlloc.currencyUnit)}).`
      );
    }

    if (!selectedTarget) return setError("Kegiatan tujuan belum dimuat. Muat ulang sebelum mencoba lagi.");

    const payload = {
      targetActivityId,
      sourceAllocationId,
      amountExact: amountExact.trim(),
      reason: reason.trim(),
      expectedVersion: sourceActivity.version,
      // Both sides are checked: a target edited since this list loaded is refused too.
      expectedTargetActivityVersion: selectedTarget.version,
    };

    const intent = `reallocate:${sourceActivity.id}:${JSON.stringify(payload)}`;
    setBusy(true);
    setError(null);
    try {
      await reallocateAllocation(requests, sourceActivity.id, {
        ...payload,
        operationId: operations.operationFor(intent),
      });
      operations.settle(intent);
      onReallocated();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Gagal mengesahkan pengalihan alokasi."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pengalihan alokasi kegiatan"
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 bg-stone-50/80">
          <h3 className="flex items-center gap-2 text-base font-bold text-stone-900">
            <ArrowRightLeft className="h-5 w-5 text-emerald-700" />
            Pengalihan Alokasi Kegiatan
          </h3>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-xs text-emerald-900 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-emerald-950">Sisa Dana Tersedia Kegiatan Sumber:</span>
              <span className="font-bold text-sm text-emerald-700">
                {formatNominal(availableBalance, sourceActivity.currencyUnit)}
              </span>
            </div>
            <p className="text-xs text-emerald-800 leading-relaxed">
              Dana yang dapat dialihkan adalah sisa setelah biaya aktual dan kewajiban kegiatan diperhitungkan.
            </p>
          </div>

          <div>
            <label htmlFor="sourceAllocationId" className="block text-xs font-semibold text-stone-700 mb-1">
              Alokasi Sumber
            </label>
            {activeAllocations.length === 0 ? (
              <p className="text-xs text-red-600">Tidak ada alokasi aktif yang dapat dialihkan pada kegiatan ini.</p>
            ) : (
              <select
                id="sourceAllocationId"
                value={sourceAllocationId}
                onChange={(e) => setSourceAllocationId(e.target.value)}
                className={fieldClass}
                disabled={busy}
              >
                {activeAllocations.map((alloc) => (
                  <option key={alloc.id} value={alloc.id}>
                    {alloc.fundType} - {formatNominal(alloc.amountExact, alloc.currencyUnit)} (Ref: {alloc.contributionId})
                  </option>
                ))}
              </select>
            )}
            {selectedAlloc && (
              <p className="mt-1 text-xs text-stone-500">
                Jenis Dana: <strong>{selectedAlloc.fundType}</strong>
                {selectedAlloc.purpose && ` • Peruntukan: "${selectedAlloc.purpose}"`}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="targetActivityId" className="block text-xs font-semibold text-stone-700 mb-1">
              Kegiatan Tujuan
            </label>
            {activities.length === 0 ? (
              <p className="text-xs text-stone-500">Tidak ada kegiatan lain yang tersedia di ruang kerja ini.</p>
            ) : (
              <select
                id="targetActivityId"
                value={targetActivityId}
                onChange={(e) => setTargetActivityId(e.target.value)}
                className={fieldClass}
                disabled={busy}
              >
                {activities.map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.name} (Program {act.programFundType})
                  </option>
                ))}
              </select>
            )}
            {selectedTarget && (
              <p className="mt-1 text-xs text-stone-500">
                Program Kegiatan Tujuan: <strong>{selectedTarget.programFundType}</strong>
              </p>
            )}
          </div>

          <div>
            <label htmlFor="amountExact" className="block text-xs font-semibold text-stone-700 mb-1">
              Nominal Pengalihan ({sourceActivity.currencyUnit})
            </label>
            <input
              id="amountExact"
              type="text"
              inputMode="numeric"
              value={amountExact}
              onChange={(e) => setAmountExact(e.target.value)}
              placeholder="Contoh: 100000"
              className={fieldClass}
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor="reallocateReason" className="block text-xs font-semibold text-stone-700 mb-1">
              Alasan Pengalihan (Keputusan Lembaga)
            </label>
            <textarea
              id="reallocateReason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Contoh: Pengalihan sisa alokasi kegiatan yang telah selesai ke program bantuan darurat pangan."
              className={fieldClass}
              disabled={busy}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-stone-200 pt-4">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy || activeAllocations.length === 0 || activities.length === 0 || BigInt(availableBalance) <= 0n}
            >
              {busy ? "Memproses…" : "Sahkan Pengalihan"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
