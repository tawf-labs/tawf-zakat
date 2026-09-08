import { getApiBaseUrl } from "../../lib/contracts";
import { RecordingPanel } from "./RecordingPanel";
import { verifyReportCommitment } from "./reportCommitment";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { freezeReport, listReports, readReport, reviewReport, saveReport } from "./evidenceClient";
import type { ReportReview, SavedReportPackage } from "./evidenceClient";
import { formatQuantity } from "../../lib/reporting";

export function ReportPackageForm({ preparationId, token, canPrepare, commitmentSalt }: { preparationId: string; token: string; canPrepare: boolean; commitmentSalt: string }) {
  const [review, setReview] = useState<ReportReview | null>(null);
  const [saved, setSaved] = useState<SavedReportPackage | null>(null);
  const [history, setHistory] = useState<{ id: string }[]>([]);
  const [reportId, setReportId] = useState("");
  const [version, setVersion] = useState("1");
  const [predecessor, setPredecessor] = useState("");
  const [reason, setReason] = useState("");
  const [narrative, setNarrative] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [disclosed, setDisclosed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([reviewReport(preparationId, token), listReports(preparationId, token)]).then(([next, list]) => {
      if (cancelled) return;
      setReview(next); setHistory(list.packages);
      setAmounts(Object.fromEntries(next.figures.map(f => [f.name, f.value.amount])));
    }).catch(() => { if (!cancelled) setError("Review paket tidak dapat dimuat."); });
    return () => { cancelled = true; };
  }, [preparationId, token]);

  async function act(label: string, task: () => Promise<void>) {
    setPending(label); setError(null);
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "Permintaan gagal."); }
    finally { setPending(null); }
  }
  async function acceptSaved(next: SavedReportPackage) {
    const { digest, ...body } = next;
    if (!await verifyReportCommitment(body, commitmentSalt, digest)) throw new Error("Digest paket tidak cocok; review dihentikan.");
    setSaved(next);
  }
  async function save(mode: "HUMAN" | "AI") {
    if (!review) return;
    const result = await saveReport(preparationId, token, {
      reportId, version, predecessor: predecessor || null, correctionReason: reason || null, mode,
      ...(mode === "HUMAN" ? { draft: { narrative, claims: review.figures.map(f => ({ name: f.name, amount: amounts[f.name] ?? "", unit: f.value.unit })) } } : {}),
      disclosure: disclosed ? review.disclosure : null,
    });
    await acceptSaved(result.package);
    setHistory((await listReports(preparationId, token)).packages);
  }
  async function download() {
    if (!saved) return;
    // Every download rechecks the reader's current authorization.
    const current = (await readReport(preparationId, saved.id, token)).package;
    await acceptSaved(current);
    const blob = new Blob([`DRAF — BELUM DITERBITKAN\nLaporan ${saved.reportId}, versi ${saved.version}\nPaket ${saved.id}\nDigest ${saved.digest}\nVonis ${saved.verdict.outcome}\n\n${saved.draft?.narrative ?? "Draf tidak tersedia"}\n\n${JSON.stringify(saved, null, 2)}`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `draf-${saved.id}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function downloadExamination() {
    if (!saved) return;
    const response = await fetch(`${getApiBaseUrl()}/api/evidence/${preparationId}/reports/${saved.id}/examination`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("Paket pemeriksaan tidak tersedia atau akses sudah berakhir.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = `examination-${saved.id}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="mt-5 space-y-3 rounded-xl border border-stone-200 p-4">
    <h4 className="font-semibold">Laporan dari snapshot</h4>
    <p className="text-xs text-stone-600">Angka dan sumber terikat pada snapshot ini. Unduhan draf belum merupakan penerbitan laporan.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!review ? <p>Memuat angka dan cakupan…</p> : <>
      <p className="text-xs">Kebijakan pemeriksaan: {review.policy.id}</p>
      <ul className="list-disc space-y-1 pl-5 text-xs">{review.limitations.map((note, i) => <li key={i}>{note}</li>)}</ul>
      {review.blockers.map((note, i) => <p key={i} className="text-sm text-red-700">{note}</p>)}
      <fieldset disabled={!!pending || !canPrepare} className="space-y-3 disabled:opacity-70">
        <label className="block text-sm">Identitas laporan<input className="block w-full rounded border p-2" value={reportId} onChange={e => setReportId(e.target.value)} /></label>
        <label className="block text-sm">Versi<input className="block w-full rounded border p-2" value={version} onChange={e => setVersion(e.target.value)} /></label>
        <label className="block text-sm">ID paket pendahulu (khusus koreksi)<input className="block w-full rounded border p-2" value={predecessor} onChange={e => setPredecessor(e.target.value)} /></label>
        <label className="block text-sm">Alasan koreksi<input className="block w-full rounded border p-2" value={reason} onChange={e => setReason(e.target.value)} /></label>
        <div className="space-y-2">{review.figures.map(f => <label key={f.name} className="block text-xs">
          {f.label}: {formatQuantity(f.value)}. Klaim ({f.value.unit === "USDC_6DP" ? "satuan minor USDC, 6 desimal" : "rupiah penuh"})
          <input className="mt-1 block w-full rounded border p-2 font-mono" value={amounts[f.name] ?? ""} onChange={e => setAmounts({ ...amounts, [f.name]: e.target.value })} />
        </label>)}</div>
        <label className="block text-sm">Narasi draf<textarea rows={5} className="block w-full rounded border p-2" value={narrative} onChange={e => setNarrative(e.target.value)} /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={disclosed} onChange={e => setDisclosed(e.target.checked)} />Saya menyertakan seluruh sumber, temuan, dan batas pemeriksaan di atas sebagai bagian laporan.</label>
        {canPrepare && <div className="flex flex-wrap gap-2">
          <Button disabled={!!pending || !reportId || !narrative} onClick={() => act("Memeriksa draf…", () => save("HUMAN"))}>Simpan dan periksa draf</Button>
          <Button variant="outline" disabled={!!pending || !reportId} onClick={() => act("Menyusun draf AI…", () => save("AI"))}>Susun dengan AI</Button>
        </div>}
      </fieldset>
    </>}
    {pending && <p role="status">{pending}</p>}
    <label className="block text-sm">Paket tersimpan<select className="block w-full rounded border p-2" disabled={!!pending} value={saved?.id ?? ""} onChange={e => { const id = e.target.value; if (id) void act("Membuka paket…", async () => { await acceptSaved((await readReport(preparationId, id, token)).package); }); }}>
      <option value="">Pilih paket untuk review</option>{history.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
    </select></label>
    {saved && <div className="space-y-2 border-t pt-3">
      <p className="font-semibold">{saved.reportId} · versi {saved.version} · {saved.verdict.outcome} · {saved.status === "FROZEN" ? "Dibekukan" : "Draf tersimpan"}</p>
      <p role="status">{saved.status === "FROZEN" && saved.verdict.outcome === "LOLOS" ? "Paket beku siap ditinjau. Pencatatan bukti dan penerbitan memerlukan pengesahan berbeda." : "Draf ditolak tetap dapat dicatat sebagai bukti setelah dibekukan; belum siap untuk pengesahan penerbitan."}</p>
      <p className="text-xs">Commitment paket cocok dengan isi yang ditampilkan.</p>
      <p className="break-all text-xs">Paket {saved.id}<br />Digest {saved.digest}</p>
      {saved.aiUnavailable && <p role="alert">{saved.aiUnavailable}</p>}
      <p className="whitespace-pre-wrap text-sm">{saved.draft?.narrative}</p>
      <ul className="space-y-1 text-xs">{saved.draft?.claims.map((claim, i) => <li key={i}>{claim.name}: {claim.value ? formatQuantity(claim.value) : claim.statedAmount}</li>)}</ul>
      {canPrepare && saved.draft && <Button variant="outline" disabled={!!pending} onClick={() => {
        setReportId(saved.reportId); setVersion(saved.version); setPredecessor(saved.predecessor ?? ""); setReason(saved.correctionReason ?? "");
        setNarrative(saved.draft!.narrative); setAmounts(Object.fromEntries(saved.draft!.claims.map(c => [c.name, c.value?.amount ?? c.statedAmount ?? ""]))); setDisclosed(false);
      }}>Salin draf ke formulir untuk perbaikan</Button>}
      <ul className="list-disc pl-5 text-xs">{saved.limitations.map((note, i) => <li key={i}>{note}</li>)}</ul>
      {saved.verdict.prerequisites.map((note, i) => <p key={i} className="text-sm text-red-700">{note}</p>)}
      {saved.verdict.findings.map((f, i) => <p key={i} className="text-sm text-red-700">{f.message}{f.expected && ` Diharapkan: ${formatQuantity(f.expected)}.`}{f.claimed && ` Diklaim: ${formatQuantity(f.claimed)}.`}</p>)}
      {saved.status === "FROZEN" && <RecordingPanel publication key={`publication:${saved.id}:${token}`} saved={saved} preparationId={preparationId} token={token} />}
      {saved.status === "FROZEN" && <RecordingPanel key={`${saved.id}:${token}`} saved={saved} preparationId={preparationId} token={token} />}
      <div className="flex flex-wrap gap-2">
        {canPrepare && saved.status !== "FROZEN" && <Button disabled={!!pending} onClick={() => act("Membekukan paket…", async () => { await acceptSaved((await freezeReport(preparationId, saved.id, token)).package); setHistory((await listReports(preparationId, token)).packages); })}>Bekukan paket untuk review pengesahan</Button>}
        <Button variant="outline" disabled={!!pending} onClick={() => act("Memeriksa akses unduhan…", download)}>Unduh draf terbatas</Button>
        <Button variant="outline" disabled={!!pending} onClick={() => act("Menyiapkan paket pemeriksaan…", downloadExamination)}>Unduh paket pemeriksaan terbatas</Button>
        {saved.status === "FROZEN" && <a className="text-sm underline" href={`/transparansi/laporan?packageId=${encodeURIComponent(saved.id)}`} target="_blank" rel="noreferrer">Buka ringkasan publik versi terbit</a>}
      </div>
    </div>}
  </section>;
}
