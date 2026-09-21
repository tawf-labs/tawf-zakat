import { AccessContextChanged, type PrivateRequests } from "./privateRequests";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAttestation } from "./useRegistryInteraction";
import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "../../components/ui/Button";
import { attestationTypedData } from "../../../../shared/report-registry";
import type { SavedReportPackage } from "./evidenceClient";
import { ATTESTATION_CONCLUSIONS as CONCLUSIONS, ATTESTATION_SCOPES as SCOPES, conclusionLabel, scopeLabel } from "./evidenceText";

/**
 * An auditor's examination note over one published version (Spec #68, ticket #76).
 *
 * The panel is deliberately unglamorous about what it proves. A recorded
 * mandate is an engagement the institution wrote down, not independence and not
 * a compliance certification, and it says so next to every conclusion. The
 * conclusions themselves come from a fixed list that includes the unfavourable
 * ones, so nothing here can present an adverse opinion as a clean one.
 *
 * Signing is gated on the version identity: the package, its digest and the
 * version label are shown, and the wallet signs exactly the statement the
 * server prepared for that identity - never a report id that would attach an
 * opinion to whichever version happens to be current.
 */
/** Chunked: spreading a real working paper into one argument list overflows the call stack. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
const states: Record<string, string> = {
  PREPARED: "Atestasi disiapkan; belum dikirim", SUBMITTED: "Sudah dikirim; belum terbukti tercatat",
  INCLUDED: "Atestasi sudah tercatat; menunggu konfirmasi cukup", CONFIRMED: "Atestasi tercatat pada versi ini",
  REVERTED: "Pengiriman gagal; atestasi tidak tercatat", INVALID_EVENT: "Catatan tidak cocok; atestasi tidak diakui",
  NONCANONICAL: "Catatan publik berubah; atestasi perlu diperiksa ulang",
};

export type VersionAttestation = { id: string; auditor: string; scope: string; conclusion: string;
  evidenceCommitment: string; predecessor: string | null; mandate: string };

export function AttestationPanel({ saved, preparationId, requests, recorded, basis, onRecorded }: {
  saved: SavedReportPackage; preparationId: string; requests: PrivateRequests;
  recorded: VersionAttestation[] | null; basis: string | null; onRecorded?: () => void;
}) {
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const interaction = useAttestation({ saved, preparationId, requests });
  const { history, loading, intent, reviewed, statusUnavailable, task } = interaction;
  const contractSignature = interaction.signature;
  const [scope, setScope] = useState<string>(SCOPES[0]!.value);
  const [conclusion, setConclusion] = useState<string>("");
  const [predecessor, setPredecessor] = useState("");
  const [evidence, setEvidence] = useState<{ fileName: string; mimeType: string; contentBase64: string }[]>([]);
  const [localBusy, setBusy] = useState<string | null>(null);
  const [localError, setError] = useState<string | null>(null);
  const busy = localBusy ?? interaction.busy;
  const error = localError ?? interaction.error;
  const setReviewed = task.review, setContractSignature = task.signature, check = task.refresh;
  const path = `${preparationId}/reports/${saved.id}/attestation`;
  useEffect(() => { onRecorded?.(); }, [intent?.id, intent?.observation.state]);
  const localGeneration = useRef(0);
  useLayoutEffect(() => { localGeneration.current++; setBusy(null); setError(null); setEvidence([]); return () => { localGeneration.current++; }; }, [task]);
  async function act(label: string, operation: (assertCurrent: () => void) => Promise<void>) {
    const started = ++localGeneration.current;
    const assertCurrent = () => { requests.assertCurrent(); if (started !== localGeneration.current) throw new AccessContextChanged(); };
    setBusy(label); setError(null);
    try { await operation(assertCurrent); assertCurrent(); }
    catch (error) { if (started === localGeneration.current) setError(error instanceof Error ? error.message : "Permintaan ditolak."); }
    finally { if (started === localGeneration.current) setBusy(null); }
  }
  async function attach(list: FileList | null) {
    const files = Array.from(list ?? []);
    setEvidence([]);
    await act("Membaca bukti pemeriksaan…", async assertCurrent => {
    const attachments = await Promise.all(files.map(async file => ({
      fileName: file.name, mimeType: file.type || "application/octet-stream",
      contentBase64: base64(new Uint8Array(await file.arrayBuffer())),
    })));
    assertCurrent(); setEvidence(attachments);
    });
  }
  const prepare = () => task.prepare({ scope, conclusion, predecessor: predecessor || null, evidence });
  const sign = task.submit;

  const sent = intent && ["SUBMITTED", "INCLUDED", "CONFIRMED"].includes(intent.observation.state);
  const mine = (recorded ?? []).filter(note => note.auditor.toLowerCase() === address?.toLowerCase());
  return <section className="space-y-3 rounded border p-3">
    <h5 className="font-semibold">Atestasi auditor (pendapat resmi auditor)</h5>
    <p className="text-sm">Atestasi adalah pendapat auditor atas satu versi laporan, dicatat di samping versi tersebut. Ia tidak mengubah angka di paket, pengesahan lembaga, atau hasil pemeriksaan otomatis layanan.</p>
    {basis && <p className="text-sm">{basis}</p>}

    <div className="text-xs">
      <p className="font-semibold">Kesimpulan tercatat pada versi ini</p>
      {!recorded ? <p role="status">Belum dapat dibaca dari pencatatan publik.</p>
        : recorded.length === 0 ? <p role="status">Belum diperiksa.</p>
        : <ul className="mt-1 space-y-2">{recorded.map(note => <li key={note.id} className="rounded border p-2">
            <p className="font-semibold">{conclusionLabel(note.conclusion)}</p>
            <p>Lingkup: {scopeLabel(note.scope)}</p>
            <p className="break-all">Auditor {note.auditor}<br />Dasar mandat: {note.mandate || "tidak tercatat"}</p>
            <p className="break-all">Commitment bukti pemeriksaan {note.evidenceCommitment}</p>
            <p className="break-all">{note.predecessor ? `Tindak lanjut dari catatan ${note.predecessor}` : "Catatan pertama; bukan tindak lanjut."}</p>
          </li>)}</ul>}
    </div>

    <p className="break-all text-xs">Versi yang akan diperiksa: laporan {saved.reportId} · versi {saved.version}<br />Paket {saved.id}<br />Digest {saved.digest}</p>

    {loading && <p role="status">Memuat riwayat atestasi…</p>}
    {history.length > 0 && <label className="block text-sm">Riwayat percobaan atestasi saya
      <select className="block w-full rounded border p-2" value={intent?.id ?? ""} disabled={!!busy || loading} onChange={e => {
        task.select(e.target.value);
      }}><option value="">Pilih percobaan</option>{history.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select>
    </label>}
    {!intent && <fieldset disabled={!!busy || loading || statusUnavailable} className="space-y-2 text-sm">
      <label className="block">Lingkup pemeriksaan
        <select className="block w-full rounded border p-2" value={scope} onChange={e => setScope(e.target.value)}>
          {SCOPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      <label className="block">Kesimpulan
        <select className="block w-full rounded border p-2" value={conclusion} onChange={e => setConclusion(e.target.value)}>
          <option value="">Pilih kesimpulan</option>
          {CONCLUSIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
      {mine.length > 0 && <label className="block">Tindak lanjut dari catatan saya (opsional)
        <select className="block w-full rounded border p-2" value={predecessor} onChange={e => setPredecessor(e.target.value)}>
          <option value="">Bukan tindak lanjut</option>
          {mine.map(note => <option key={note.id} value={note.id}>{conclusionLabel(note.conclusion)} · {note.id.slice(0, 18)}…</option>)}
        </select></label>}
      <label className="block">Bukti pemeriksaan (kertas kerja)
        <input type="file" multiple className="block w-full" onChange={e => void attach(e.target.files)} /></label>
      <p className="text-xs">{evidence.length === 0 ? "Bukti pemeriksaan wajib dilampirkan. Bukti disimpan terbatas; yang tercatat di pencatatan publik hanya sidik jari digitalnya." : `${evidence.length} berkas akan disimpan dan dikunci (sidik jarinya dicatat) sebelum penandatanganan.`}</p>
      <Button disabled={!!busy || !conclusion || evidence.length === 0 || !address} onClick={prepare}>Siapkan atestasi untuk versi ini</Button>
    </fieldset>}

    {intent && <div className="space-y-2 text-sm">
      <p role="status">{statusUnavailable ? "Status chain belum dapat dipastikan" : states[intent.observation.state]}</p>
      <p className="text-xs">Konfirmasi: {intent.observation.confirmations} / {intent.observation.requiredConfirmations}. Kebijakan {intent.observation.confirmationPolicy}.</p>
      <p className="text-xs">Kesimpulan yang akan ditandatangani: {conclusionLabel(intent.statement.conclusion)} · lingkup {scopeLabel(intent.statement.scope)}.</p>
      <p className="text-sm">Periode kewenangan {intent.statement.authorityEpoch} · {intent.signingAuthority === "HISTORICAL" ? "Wewenang saat pencatatan dulu; bukan izin atestasi baru." : intent.signingAuthority === "STALE" ? "Mandat berubah. Mulai tinjauan atestasi baru." : "Mandat Anda dicek ulang sebelum penandatanganan."}</p>
      <p className="break-all text-xs">Commitment bukti pemeriksaan {intent.statement.evidenceCommitment}<br />Berkas: {intent.evidence.files.map(file => file.fileName).join(", ")}</p>
      {intent.evidence.files.map(file => <Button key={file.id} variant="outline" disabled={!!busy} onClick={() => act("Mengunduh bukti pemeriksaan…", async assertCurrent => {
        const blob = await requests.blob(`/api/evidence/${path}/${intent.id}/files/${file.id}`);
        assertCurrent();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.href = url; link.download = file.fileName; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })}>Unduh {file.fileName}</Button>)}
      <details><summary>Parameter atestasi yang akan ditandatangani</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(attestationTypedData(intent.domain, intent.statement), (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}</pre></details>
      {intent.transactionHash && <p className="break-all text-xs">Transaksi {intent.transactionHash}<br />Blok {intent.observation.blockNumber ?? "belum tersedia"} · Log {intent.observation.logIndex ?? "belum tersedia"}</p>}
      <Button variant="outline" disabled={!!busy} onClick={() => void check()}>Periksa status chain</Button>
      {!sent && <>
        <label className="flex gap-2"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />Saya telah meninjau identitas versi, digest, lingkup, kesimpulan, dan bukti pemeriksaan di atas.</label>
        {intent.accountKind === "ERC1271" && <label className="block">Tanda tangan akun kontrak atas parameter ini (dari alur persetujuan auditor)
          <textarea className="block w-full rounded border p-2 font-mono text-xs" value={contractSignature} onChange={e => setContractSignature(e.target.value.trim())} />
          <span className="text-xs">Sistem memeriksa tanda tangan ini saat pengiriman. Salin parameter di atas ke alur penandatanganan akun bersama bila dompet digital tidak dapat menandatangani langsung.</span></label>}
        {chainId !== intent.domain.chainId
          ? <Button disabled={!!busy || switching} onClick={() => switchChainAsync({ chainId: intent.domain.chainId }).catch(() => setError("Ganti jaringan di dompet digital ke jaringan yang dipakai lembaga."))}>{switching ? "Mengganti jaringan…" : "Ganti ke jaringan yang benar"}</Button>
          : <Button disabled={!!busy || switching || loading || !reviewed || !address || statusUnavailable} onClick={sign}>Tandatangani atestasi versi ini</Button>}
      </>}
      {!["SUBMITTED", "INCLUDED"].includes(intent.observation.state) && <Button variant="outline" disabled={!!busy || statusUnavailable} onClick={() => {
        task.newReview(); setEvidence([]);
      }}>Mulai tinjauan atestasi baru</Button>}
      {intent.transactionHash && ["SUBMITTED", "NONCANONICAL"].includes(intent.observation.state) &&
        <Button disabled={!!busy} onClick={task.retry}>Kirim ulang transaksi tersimpan</Button>}
    </div>}
    {busy && <p role="status">{busy}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
