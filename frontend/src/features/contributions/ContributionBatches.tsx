import { useEffect, useState } from "react";
import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import { listContributions, formatNominal, type ContributionRecord } from "./contributionClient";

import type { Batch } from "./contributionBatchTypes";
import { BatchCorrectionForm } from "./BatchCorrectionForm";
import { BatchHistory } from "./BatchHistory";

import type { Operation } from "./contributionBatchTypes";
import { BatchPublicationStatus } from "./BatchPublicationStatus";
import { BatchEndorsementForm } from "./BatchEndorsementForm";

export function ContributionBatches({ requests }: { requests: PrivateRequests }) {
  const [records, setRecords] = useState<ContributionRecord[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [cutoff, setCutoff] = useState(() => new Date().toISOString().slice(0, 16));
  const [detail, setDetail] = useState<{ batch: Batch; operations: Operation[] } | null>(null);
  const [history, setHistory] = useState<Batch[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    requests.assertCurrent(); setDetail(result);
    const hist = await requests.json<{ history: Batch[] }>(`${base}/${encodeURIComponent(id)}/history`).catch(() => ({ history: [] }));
    requests.assertCurrent(); setHistory(hist.history ?? []);
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
      <div className="flex items-center gap-2">
        <h4 className="font-semibold">Review snapshot (Batch #{detail.batch.batchNumber} v{detail.batch.version})</h4>
        <span className={`text-xs px-2 py-0.5 rounded font-medium ${detail.batch.status === "SUPERSEDED" ? "bg-amber-100 text-amber-800" : detail.batch.status === "ENDORSED" ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-800"}`}>
          {detail.batch.status === "SUPERSEDED" ? "Digantikan (Superseded)" : detail.batch.status}
        </span>
      </div>
      {detail.batch.predecessorBatchId && (
        <p className="text-xs bg-stone-50 border p-2 rounded">
          <strong>Koreksi dari batch:</strong> {detail.batch.predecessorBatchId} | <strong>Alasan:</strong> {detail.batch.correctionReason} | <strong>Bukti sumber:</strong> {detail.batch.sourceProofRef}
        </p>
      )}
      {detail.batch.status === "SUPERSEDED" && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 p-2 rounded">
          Batch ini telah digantikan oleh batch koreksi penerus dan tidak lagi berlaku sebagai batch resmi aktif.
        </p>
      )}
      <p>{detail.batch.itemCount} kontribusi · Cutoff {new Date(detail.batch.cutoff * 1000).toISOString()} · {formatNominal(detail.batch.totalAmountExact, detail.batch.currencyUnit)}</p>
      <ul className="text-sm break-all">{detail.batch.items.map(item => <li key={item.contributionId}>{item.contributionId}</li>)}</ul>
      <details><summary>Identitas snapshot</summary><code className="break-all">{detail.batch.merkleRoot}</code></details>
      {["DRAFT", "ENDORSED"].includes(detail.batch.status) && (!detail.batch.endorsedBy || detail.operations.some(op => op.status === "BLOCKED")) &&
        <BatchEndorsementForm key={`endorse-${detail.batch.id}`} busy={!!busy} submitting={busy === "endorse"} previouslyEndorsed={!!detail.batch.endorsedBy}
          onEndorse={() => run("endorse", async () => {
            await requests.json(`${base}/${encodeURIComponent(detail.batch.id)}/endorse`, {
              method: "POST", body: JSON.stringify({ snapshotRoot: detail.batch.merkleRoot }),
            });
            await load(detail.batch.id);
          })} />}
      <BatchPublicationStatus operations={detail.operations} busy={!!busy} retrying={busy === "retry"}
        active={["DRAFT", "ENDORSED"].includes(detail.batch.status)} onRetry={() => run("retry", async () => {
          await requests.json(`${base}/${encodeURIComponent(detail.batch.id)}/retry`, { method: "POST", body: "{}" });
          await load(detail.batch.id);
        })} />
      {["DRAFT", "ENDORSED"].includes(detail.batch.status) && <BatchCorrectionForm key={`correct-${detail.batch.id}`}
        draft={detail.batch.status === "DRAFT"} busy={!!busy} submitting={busy === "correct"}
        onCorrect={(reason, sourceProofRef) => run("correct", async () => {
          const res = await requests.json<{ batch: Batch }>(`${base}/${encodeURIComponent(detail.batch.id)}/correct`, {
            method: "POST", body: JSON.stringify({ expectedBatchVersion: detail.batch.version, reason, sourceProofRef }),
          });
          const list = await requests.json<{ batches: Batch[] }>(base);
          requests.assertCurrent(); setBatches(list.batches);
          await load(res.batch.id);
        })} />}
      <BatchHistory batches={history} selected={detail.batch} busy={!!busy}
        onSelect={id => run("open-hist", () => load(id))} />

    </section>}
  </section>;
}
