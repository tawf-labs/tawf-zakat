import { useEffect, useState } from "react";
import { AlertCircle, Layers, X } from "lucide-react";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "../workspace/privateRequests";
import { allocateContribution, FUNDING_RECORD_DISCLAIMER, listActivities, type DistributionActivity } from "../activities/activityClient";
import { formatNominal, fundTypeLabel, type ContributionRecord } from "./contributionClient";
import { errorMessage, useOperationIds } from "./contributionUi";

const fieldClass =
  "mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white";

/** Allocates part of an endorsed contribution to one activity, against the version on screen. */
export function AllocationModal({
  contribution,
  requests,
  onClose,
  onAllocated,
}: {
  contribution: ContributionRecord;
  requests: PrivateRequests;
  onClose: () => void;
  onAllocated: () => void;
}) {
  const [activities, setActivities] = useState<DistributionActivity[] | null>(null);
  const [activityId, setActivityId] = useState("");
  const available = contribution.unallocatedAmount ?? "0";
  const [amount, setAmount] = useState(available);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operations = useOperationIds();

  useEffect(() => {
    let cancelled = false;
    listActivities(requests)
      .then((list) => {
        if (cancelled) return;
        const sameUnit = list.filter((a) => a.currencyUnit === contribution.currencyUnit);
        setActivities(sameUnit);
        setActivityId(sameUnit[0]?.id ?? "");
      })
      .catch((err) => !cancelled && setError(errorMessage(err, "Gagal memuat daftar kegiatan.")));
    return () => {
      cancelled = true;
    };
  }, [requests, contribution.currencyUnit]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountExact = amount.trim();
    if (!/^\d+$/.test(amountExact) || BigInt(amountExact) === 0n) {
      return setError("Nominal alokasi harus berupa angka bulat positif tanpa desimal.");
    }
    if (BigInt(amountExact) > BigInt(available)) {
      return setError(`Nominal melebihi sisa kontribusi yang tersedia (${formatNominal(available, contribution.currencyUnit)}).`);
    }
    const input = { activityId, amountExact, reason: reason.trim(), expectedVersion: contribution.version };
    const intent = `allocate:${contribution.id}:${JSON.stringify(input)}`;
    setBusy(true);
    setError(null);
    try {
      await allocateContribution(requests, contribution.id, { ...input, operationId: operations.operationFor(intent) });
      operations.settle(intent);
      onAllocated();
    } catch (err) {
      setError(errorMessage(err, "Gagal mengalokasikan kontribusi."));
    } finally {
      setBusy(false);
    }
  };

  const shortfall = contribution.shortfallAmount && contribution.shortfallAmount !== "0" ? contribution.shortfallAmount : null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label="Alokasikan kontribusi" className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-stone-200 px-6 py-4 bg-stone-50/80">
          <h3 className="flex items-center gap-2 text-base font-bold text-stone-900">
            <Layers className="h-5 w-5 text-emerald-700" />
            Alokasikan Kontribusi ke Kegiatan
          </h3>
          <button onClick={onClose} aria-label="Tutup" className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-200 hover:text-stone-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4 text-xs">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 grid grid-cols-2 gap-2">
            <div className="col-span-2 flex justify-between text-stone-600">
              <span className="font-mono text-stone-900">{contribution.id}</span>
              <span>{fundTypeLabel(contribution.fundType)} · {contribution.purpose || "tanpa batasan peruntukan"}</span>
            </div>
            <div>Total: <strong>{formatNominal(contribution.amountExact, contribution.currencyUnit)}</strong></div>
            <div className="text-emerald-700">Sisa tersedia: <strong>{formatNominal(available, contribution.currencyUnit)}</strong></div>
            {shortfall && (
              <div className="col-span-2 text-red-700">
                Selisih: alokasi melebihi kontribusi sebesar {formatNominal(shortfall, contribution.currencyUnit)}. Alokasi baru ditahan sampai lembaga menyelesaikannya.
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <label className="block font-semibold text-stone-700">
            Kegiatan penyaluran <span className="text-red-500">*</span>
            {activities === null ? (
              <div className="py-2 font-normal text-stone-500">Memuat kegiatan…</div>
            ) : activities.length === 0 ? (
              <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-3 font-normal text-amber-800">Belum ada kegiatan dengan mata uang yang sama.</div>
            ) : (
              <select value={activityId} onChange={(e) => setActivityId(e.target.value)} className={fieldClass}>
                {activities.map((act) => (
                  <option key={act.id} value={act.id}>
                    {act.name} — sisa kebutuhan {formatNominal(act.unallocatedNeed, act.currencyUnit)}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="block font-semibold text-stone-700">
            Nominal (unit minor) <span className="text-red-500">*</span>
            <input required value={amount} onChange={(e) => setAmount(e.target.value)} className={`${fieldClass} font-mono`} />
          </label>

          <label className="block font-semibold text-stone-700">
            Alasan alokasi <span className="text-red-500">*</span>
            <input required value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} placeholder="Contoh: Tahap I penyaluran sembako" />
          </label>

          <p className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-[11px] text-stone-600 leading-relaxed">
            Jenis dana dan peruntukan mengikuti kontribusi. {FUNDING_RECORD_DISCLAIMER}
          </p>

          <div className="flex justify-end gap-2 pt-2 border-t border-stone-200">
            <Button variant="outline" type="button" onClick={onClose} disabled={busy}>Batal</Button>
            <Button type="submit" disabled={busy || !activityId || !reason.trim() || available === "0"}>
              {busy ? "Memproses…" : "Konfirmasi Alokasi"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
