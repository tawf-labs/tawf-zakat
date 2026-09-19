import { useUnsavedReport } from "./useWorkspaceAccess";
import type { PrivateRequests } from "./privateRequests";
import { RecordingPanel } from "./RecordingPanel";
import { PackageAuditFindingsSection } from "./PackageAuditFindingsSection";
import { verifyReportCommitment } from "./reportCommitment";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { freezeReport, listReports, readReport, reviewCorrection, reviewReport, saveReport } from "./evidenceClient";
import type { ChangeState, CorrectionReview, ReportReview, SavedReportPackage } from "./evidenceClient";
import { formatQuantity } from "../../lib/reporting";

const CHANGE_LABELS: Record<ChangeState, string> = {
  TETAP: "Tidak berubah", BERUBAH: "Berubah",
  DITAMBAHKAN: "Baru pada koreksi", TIDAK_LAGI_TERSEDIA: "Tidak lagi didukung snapshot",
};

export function ReportPackageForm({ preparationId, requests, canPrepare, commitmentSalt }: { preparationId: string; requests: PrivateRequests; canPrepare: boolean; commitmentSalt: string }) {
  const [review, setReview] = useState<ReportReview | null>(null);
  const [saved, setSaved] = useState<SavedReportPackage | null>(null);
  const [history, setHistory] = useState<{ id: string }[]>([]);




  const [correction, setCorrection] = useState<CorrectionReview | null>(null);

  const draft = useUnsavedReport(preparationId, requests);
  const { reportId, version, predecessor, reason, narrative, amounts } = draft.value;
  const setReportId = (reportId: string) => draft.change({ reportId });
  const setVersion = (version: string) => draft.change({ version });
  const setPredecessor = (predecessor: string) => draft.change({ predecessor });
  const setReason = (reason: string) => draft.change({ reason });
  const setNarrative = (narrative: string) => draft.change({ narrative });
  const setAmounts = (amounts: Record<string, string>) => draft.change({ amounts });
  const [disclosed, setDisclosed] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([reviewReport(preparationId, requests), listReports(preparationId, requests)]).then(([next, list]) => {
      if (cancelled) return;
      setReview(next); setHistory(list.packages);
      if (!draft.restored) setAmounts(Object.fromEntries(next.figures.map(f => [f.name, f.value.amount])));
    }).catch(() => { if (!cancelled) setError("Review paket tidak dapat dimuat."); });
    return () => { cancelled = true; };
  }, [preparationId, requests]);

  async function act(label: string, task: () => Promise<void>) {
    setPending(label); setError(null);
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : "Permintaan gagal."); }
    finally { setPending(null); }
  }
  async function acceptSaved(next: SavedReportPackage) {
    const { digest, ...body } = next;
    if (!await verifyReportCommitment(body, commitmentSalt, digest)) throw new Error("Digest paket tidak cocok; review dihentikan.");
    requests.assertCurrent();
    setSaved(next);
  }
  /** A correction is reviewed against the version it succeeds before anything new is saved. */
  async function loadCorrection(id: string) {
    setCorrection(null);
    const { correction: next } = await reviewCorrection(preparationId, id, requests);
    setPredecessor(id);
    setReportId(next.predecessor.reportId);
    setVersion("");
    setCorrection(next);
  }
  async function save(mode: "HUMAN" | "AI") {
    if (!review) return;
    const result = await saveReport(preparationId, requests, {
      reportId, version, predecessor: predecessor || null, correctionReason: reason || null, mode,
      ...(mode === "HUMAN" ? { draft: { narrative, claims: review.figures.map(f => ({ name: f.name, amount: amounts[f.name] ?? "", unit: f.value.unit })) } } : {}),
      disclosure: disclosed ? review.disclosure : null,
    });
    await acceptSaved(result.package);
    setHistory((await listReports(preparationId, requests)).packages);
  }
  async function download() {
    if (!saved) return;
    // Every download rechecks the reader's current authorization.
    const current = (await readReport(preparationId, saved.id, requests)).package;
    await acceptSaved(current);
    const blob = new Blob([`DRAF — BELUM DITERBITKAN\nLaporan ${saved.reportId}, versi ${saved.version}\nPaket ${saved.id}\nDigest ${saved.digest}\nVonis ${saved.verdict.outcome}\n\n${saved.draft?.narrative ?? "Draf tidak tersedia"}\n\n${JSON.stringify(saved, null, 2)}`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `draf-${saved.id}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function downloadExamination() {
    if (!saved) return;
    const blob = await requests.blob(`/api/evidence/${preparationId}/reports/${saved.id}/examination`);
    requests.assertCurrent();
    const url = URL.createObjectURL(blob);
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
        <label className="block text-sm">ID paket pendahulu (khusus koreksi)<input className="block w-full rounded border p-2" value={predecessor} onChange={e => { setPredecessor(e.target.value); setCorrection(null); }} /></label>
        {predecessor && <Button variant="outline" disabled={!!pending} onClick={() => act("Membuka versi pendahulu…", () => loadCorrection(predecessor.trim()))}>Tinjau sumber dan perubahan koreksi</Button>}
        <label className="block text-sm">Alasan koreksi{predecessor ? " (wajib)" : ""}<input className="block w-full rounded border p-2" value={reason} onChange={e => setReason(e.target.value)} /></label>
        {predecessor && !reason.trim() && <p role="alert" className="text-sm text-red-700">Koreksi memerlukan alasan sebelum dapat disimpan.</p>}
        <div className="space-y-2">{review.figures.map(f => <label key={f.name} className="block text-xs">
          {f.label}: {formatQuantity(f.value)}. Klaim ({f.value.unit === "USDC_6DP" ? "satuan minor USDC, 6 desimal" : "rupiah penuh"})
          <input className="mt-1 block w-full rounded border p-2 font-mono" value={amounts[f.name] ?? ""} onChange={e => setAmounts({ ...amounts, [f.name]: e.target.value })} />
        </label>)}</div>
        <label className="block text-sm">Narasi draf<textarea rows={5} className="block w-full rounded border p-2" value={narrative} onChange={e => setNarrative(e.target.value)} /></label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={disclosed} onChange={e => setDisclosed(e.target.checked)} />Saya menyertakan seluruh sumber, temuan, dan batas pemeriksaan di atas sebagai bagian laporan.</label>
        {correction && <section className="space-y-2 rounded border p-3 text-xs">
          <h5 className="text-sm font-semibold">Perubahan terhadap versi {correction.predecessor.version}</h5>
          <p>Pendahulu {correction.predecessor.id} · vonis {correction.predecessor.outcome} · commitment snapshot {correction.predecessor.snapshotCommitment.slice(0, 18)}…</p>
          <p>{correction.samePreparation
            ? "Koreksi ini memakai snapshot yang sama; angka tidak akan berubah kecuali draf diubah."
            : "Koreksi ini memakai snapshot baru. Snapshot dan berkas versi pendahulu tetap tersimpan apa adanya."}</p>
          <ul className="space-y-1">{correction.sources.map(source => <li key={source.role}>
            Sisi {source.role === "CLAIM" ? "klaim" : "sumber"}: {CHANGE_LABELS[source.state]}.
            {source.before && source.after && source.state === "BERUBAH" && ` Cut-off ${source.before.cutOff} → ${source.after.cutOff}; status ${source.before.status} → ${source.after.status}; asal ${source.before.origin} → ${source.after.origin}.`}
          </li>)}</ul>
          <table className="w-full text-left"><thead><tr>{["Angka", "Versi pendahulu", "Koreksi", "Status"].map(h => <th key={h} className="p-1">{h}</th>)}</tr></thead>
            <tbody>{correction.changes.map(change => <tr key={change.name} className="border-t">
              <td className="p-1">{change.label}</td>
              <td className="p-1 font-mono">{change.before ? formatQuantity(change.before) : "—"}</td>
              <td className="p-1 font-mono">{change.after ? formatQuantity(change.after) : "—"}</td>
              <td className="p-1">{CHANGE_LABELS[change.state]}</td>
            </tr>)}</tbody></table>
          <p>Temuan: {correction.findingCount.before ?? "—"} menjadi {correction.findingCount.after ?? "—"}.</p>
          {correction.blockers.map((note, i) => <p key={i} className="text-red-700">{note}</p>)}
          <p>Pengesahan versi pendahulu tidak berlaku untuk koreksi ini; keduanya memerlukan pengesahan lembaga dan validator baru.</p>
        </section>}
        {canPrepare && <div className="flex flex-wrap gap-2">
          <Button disabled={!!pending || !reportId || !narrative || (!!predecessor && !reason.trim())} onClick={() => act("Memeriksa draf…", () => save("HUMAN"))}>Simpan dan periksa draf</Button>
          <Button variant="outline" disabled={!!pending || !reportId || (!!predecessor && !reason.trim())} onClick={() => act("Menyusun draf AI…", () => save("AI"))}>Susun dengan AI</Button>
        </div>}
      </fieldset>
    </>}
    {pending && <p role="status">{pending}</p>}
    <label className="block text-sm">Paket tersimpan<select className="block w-full rounded border p-2" disabled={!!pending} value={saved?.id ?? ""} onChange={e => { const id = e.target.value; if (id) void act("Membuka paket…", async () => { await acceptSaved((await readReport(preparationId, id, requests)).package); }); }}>
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
        setNarrative(saved.draft!.narrative); setAmounts(Object.fromEntries(saved.draft!.claims.map(c => [c.name, c.value?.amount ?? c.statedAmount ?? ""]))); setDisclosed(false); setCorrection(null);
      }}>Salin draf ke formulir untuk perbaikan</Button>}
      <ul className="list-disc pl-5 text-xs">{saved.limitations.map((note, i) => <li key={i}>{note}</li>)}</ul>
      {saved.verdict.prerequisites.map((note, i) => <p key={i} className="text-sm text-red-700">{note}</p>)}
      {saved.verdict.findings.map((f, i) => <p key={i} className="text-sm text-red-700">{f.message}{f.expected && ` Diharapkan: ${formatQuantity(f.expected)}.`}{f.claimed && ` Diklaim: ${formatQuantity(f.claimed)}.`}</p>)}
      {saved.status === "FROZEN" && <RecordingPanel publication key={`publication:${saved.id}:${requests.contextId}`} saved={saved} preparationId={preparationId} requests={requests}
        onCorrect={canPrepare ? id => void act("Membuka versi pendahulu…", () => loadCorrection(id)) : undefined} />}
      {saved.status === "FROZEN" && <RecordingPanel key={`${saved.id}:${requests.contextId}`} saved={saved} preparationId={preparationId} requests={requests} />}
      {saved.status === "FROZEN" && <PackageAuditFindingsSection key={`findings:${saved.id}:${requests.contextId}`} preparationId={preparationId} packageId={saved.id}
        packageDigest={saved.digest} reportId={saved.reportId} reportVersion={saved.version} requests={requests}
        onStartCorrection={canPrepare ? id => void act("Membuka versi pendahulu…", () => loadCorrection(id)) : undefined} />}
      <div className="flex flex-wrap gap-2">
        {canPrepare && saved.status !== "FROZEN" && <Button disabled={!!pending} onClick={() => act("Membekukan paket…", async () => { await acceptSaved((await freezeReport(preparationId, saved.id, requests)).package); setHistory((await listReports(preparationId, requests)).packages); })}>Bekukan paket untuk review pengesahan</Button>}
        <Button variant="outline" disabled={!!pending} onClick={() => act("Memeriksa akses unduhan…", download)}>Unduh draf terbatas</Button>
        <Button variant="outline" disabled={!!pending} onClick={() => act("Menyiapkan paket pemeriksaan…", downloadExamination)}>Unduh paket pemeriksaan terbatas</Button>
        {saved.status === "FROZEN" && <a className="text-sm underline" href={`/transparansi/laporan?packageId=${encodeURIComponent(saved.id)}`} target="_blank" rel="noreferrer">Buka ringkasan publik versi terbit</a>}
      </div>
    </div>}
  </section>;
}
