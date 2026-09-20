import { Button } from "../../components/ui/Button";
import type { Operation } from "./contributionBatchTypes";

const states: Record<string, string> = {
  QUEUED: "Menunggu proses", PROVING: "Membuat bukti", SUBMITTING: "Mengirim transaksi", PENDING: "Menunggu konfirmasi",
  CONFIRMED: "Terkonfirmasi", RETRY: "Perlu dicoba lagi", BUDGET_EXHAUSTED: "Anggaran layanan habis",
  BLOCKED: "Pemrosesan ditahan", REVERTED: "Transaksi gagal", UNCONFIRMED: "Belum terkonfirmasi saat ini",
};

export function BatchPublicationStatus({ operations, busy, retrying, active, onRetry }: {
  operations: Operation[]; busy: boolean; retrying: boolean; active: boolean; onRetry: () => Promise<void>;
}) {
  return <>
    <ul aria-live="polite" className="space-y-2">{operations.map(op => <li key={op.id} className="border rounded p-3 break-all">
      <p>{op.contributionId ? `Receipt ${op.contributionId}` : "Pengesahan root"}: <strong>{states[op.status] ?? "Status belum tersedia"}</strong></p>
      {op.error && <p>{op.error}</p>}
      {op.txHash && <details><summary>Referensi transaksi</summary><code>{op.txHash}</code></details>}
    </li>)}</ul>
    {active && operations.some(op => ["RETRY", "BLOCKED", "BUDGET_EXHAUSTED", "UNCONFIRMED", "REVERTED"].includes(op.status)) &&
      <Button disabled={busy} onClick={() => void onRetry()}>{retrying ? "Menjadwalkan…" : "Coba proses lagi"}</Button>}
  </>;
}
