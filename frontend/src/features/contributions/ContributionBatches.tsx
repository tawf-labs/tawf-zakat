import { useEffect, useState } from "react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import { listContributions, formatNominal, type CurrencyUnit, type ContributionRecord } from "./contributionClient";

type Batch = { id: string; status: string; merkleRoot: string; cutoff: number; itemCount: number;
  currencyUnit: CurrencyUnit; totalAmountExact: string; endorsedBy: string | null; items: { contributionId: string }[] };
type Operation = { id: string; contributionId: string | null; status: string; error: string | null; txHash: string | null; attempts: number };
const states: Record<string, string> = {
  QUEUED: "Menunggu proses", PROVING: "Membuat bukti", SUBMITTING: "Mengirim transaksi", PENDING: "Menunggu konfirmasi",
  CONFIRMED: "Terkonfirmasi", RETRY: "Perlu dicoba lagi", BUDGET_EXHAUSTED: "Anggaran layanan habis",
  BLOCKED: "Pemrosesan ditahan", REVERTED: "Transaksi gagal", UNCONFIRMED: "Belum terkonfirmasi saat ini",
};

export function ContributionBatches({ requests }: { requests: PrivateRequests }) {
  const [records, setRecords] = useState<ContributionRecord[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [cutoff, setCutoff] = useState(() => new Date().toISOString().slice(0, 16));
  const [detail, setDetail] = useState<{ batch: Batch; operations: Operation[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const base = "/api/workspace/contribution-batches";
  useEffect(() => {
    let disposed = false;
    setRecords([]); setBatches([]); setSelected([]); setDetail(null); setError(null);
    Promise.all([listContributions(requests), requests.json<{ batches: Batch[] }>(base)]).then(([r, b]) => {
      if (!disposed) { setRecords(r); setBatches(b.batches); }
    }).catch(() => { if (!disposed) setError("Daftar batch belum dapat dimuat."); });
    return () => { disposed = true; };
  }, [requests]);
  useEffect(() => {
    if (!detail) return;
    let disposed = false;
    const timer = setInterval(() => {
      requests.json<{ batch: Batch; operations: Operation[] }>(`${base}/${encodeURIComponent(detail.batch.id)}`).then(result => {
        if (!disposed) { setDetail(result); setError(null); }
      }).catch(() => {
        if (!disposed) { setError("Status terbaru belum tersedia."); setDetail(previous => previous && ({ ...previous,
          operations: previous.operations.map(op => op.status === "CONFIRMED" ? { ...op, status: "UNCONFIRMED" } : op) })); }
      });
    }, 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, [requests, detail?.batch.id]);
  const cutoffSeconds = Math.floor(Date.parse(`${cutoff}:00Z`) / 1000);
  const reason = (r: ContributionRecord) => r.status !== "ENDORSED" ? "Belum disahkan sebagai sumber sah" :
    r.receivedAt > cutoffSeconds ? "Sesudah cutoff" : null;
  const eligible = records.filter(r => !reason(r));
  const run = async (name: string, action: () => Promise<void>) => {
    setBusy(name); setError(null);
    try { await action(); requests.assertCurrent(); }
    catch { try { requests.assertCurrent(); setError("Tindakan belum selesai. Periksa kewenangan, snapshot dan status layanan, lalu coba lagi."); } catch { /* Context owner clears the panel. */ } }
    finally { try { requests.assertCurrent(); setBusy(null); } catch { /* Old session. */ } }
  };
  const load = async (id: string) => {
    const result = await requests.json<{ batch: Batch; operations: Operation[] }>(`${base}/${encodeURIComponent(id)}`);
    requests.assertCurrent(); setDetail(result); setAcknowledged(false);
  };
  return <section aria-label="Batch bukti kontribusi" className="mt-6 space-y-4">
    <h3 className="text-lg font-semibold">Batch bukti kontribusi</h3>
    <p className="text-sm text-stone-600">Bukti penerimaan tetap tersedia selama proof diproses. Biaya berasal dari anggaran layanan, tanpa memotong kontribusi atau meminta gas donatur.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <label className="block">Cutoff penerimaan (UTC)
      <input type="datetime-local" value={cutoff} onChange={e => { setCutoff(e.target.value); setSelected([]); }} className="block border rounded p-2" />
    </label>
    <p>Populasi {records.length} catatan · Layak {eligible.length} · Tidak layak {records.length - eligible.length}</p>
    <p className="text-sm">Pilih hingga 16 kontribusi dengan jenis dana dan mata uang sama. Draf unggahan belum menjadi sumber yang disahkan.</p>
    <ul className="space-y-2">{records.map(r => <li key={r.id} className="rounded border p-3 break-words">
      <label className="flex gap-2 items-start"><input type="checkbox" checked={selected.includes(r.id)} disabled={!!busy || !!reason(r) || (!selected.includes(r.id) && selected.length >= 16)}
        onChange={e => setSelected(old => e.target.checked ? [...old, r.id] : old.filter(id => id !== r.id))} />
        <span>{r.sourceReference} · {r.fundType} · {formatNominal(r.amountExact, r.currencyUnit)}<br />{reason(r) ?? "Layak dipilih"}</span>
      </label>
    </li>)}</ul>
    <Button disabled={!!busy || !selected.length || !Number.isFinite(cutoffSeconds)} onClick={() => run("create", async () => {
      const first = records.find(r => r.id === selected[0])!;
      const result = await requests.json<{ batch: Batch }>(base, { method: "POST", body: JSON.stringify({
        contributionIds: selected, fundType: first.fundType, currencyUnit: first.currencyUnit, cutoff: cutoffSeconds,
      }) });
      requests.assertCurrent(); setBatches(old => [...old, result.batch]); await load(result.batch.id);
    })}>{busy === "create" ? "Menyiapkan snapshot…" : "Tinjau snapshot batch"}</Button>
    <div className="flex flex-wrap gap-2">{batches.map(b => <Button key={b.id} variant="outline" disabled={!!busy}
      onClick={() => run("open", () => load(b.id))}>Buka {b.id}</Button>)}</div>
    {detail && <section aria-label="Review snapshot" className="rounded-xl border p-4 space-y-3">
      <h4 className="font-semibold">Review snapshot</h4>
      <p>{detail.batch.itemCount} kontribusi · Cutoff {new Date(detail.batch.cutoff * 1000).toISOString()} · {formatNominal(detail.batch.totalAmountExact, detail.batch.currencyUnit)}</p>
      <ul className="text-sm break-all">{detail.batch.items.map(item => <li key={item.contributionId}>{item.contributionId}</li>)}</ul>
      <details><summary>Identitas snapshot</summary><code className="break-all">{detail.batch.merkleRoot}</code></details>
      {(!detail.batch.endorsedBy || detail.operations.some(op => op.status === "BLOCKED")) && <>
        <label className="flex gap-2"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />Saya telah memeriksa populasi dan cutoff snapshot ini.</label>
        <Button disabled={!!busy || !acknowledged} onClick={() => run("endorse", async () => {
          await requests.json(`${base}/${encodeURIComponent(detail.batch.id)}/endorse`, { method: "POST", body: JSON.stringify({ snapshotRoot: detail.batch.merkleRoot }) });
          await load(detail.batch.id);
        })}>{busy === "endorse" ? "Mengesahkan…" : (detail.batch.endorsedBy ? "Sahkan ulang snapshot" : "Sahkan snapshot dan proses otomatis")}</Button>
      </>}
      <ul aria-live="polite" className="space-y-2">{detail.operations.map(op => <li key={op.id} className="border rounded p-3 break-all">
        <p>{op.contributionId ? `Receipt ${op.contributionId}` : "Pengesahan root"}: <strong>{states[op.status] ?? "Status belum tersedia"}</strong></p>
        {op.error && <p>{op.error}</p>}
        {op.txHash && <details><summary>Referensi transaksi</summary><code>{op.txHash}</code></details>}
      </li>)}</ul>
      {detail.operations.some(op => ["RETRY", "BLOCKED", "BUDGET_EXHAUSTED", "UNCONFIRMED", "REVERTED"].includes(op.status)) &&
        <Button disabled={!!busy} onClick={() => run("retry", async () => {
          await requests.json(`${base}/${encodeURIComponent(detail.batch.id)}/retry`, { method: "POST", body: "{}" }); await load(detail.batch.id);
        })}>{busy === "retry" ? "Menjadwalkan…" : "Coba proses lagi"}</Button>}
    </section>}
  </section>;
}
