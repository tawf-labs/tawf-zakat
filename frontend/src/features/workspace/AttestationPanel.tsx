import type { PrivateRequests } from "./privateRequests";
import { useEffect, useRef, useState } from "react";
import { hashTypedData, keccak256, toHex } from "viem";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { Button } from "../../components/ui/Button";
import { attestationTypedData, type AttestationIntent } from "../../../../shared/report-registry";
import type { SavedReportPackage } from "./evidenceClient";
import { recordingRequest } from "./recordingClient";
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
  PREPARED: "Atestasi disiapkan; belum dikirim", SUBMITTED: "Transaksi diajukan; belum terbukti masuk blok",
  INCLUDED: "Atestasi masuk blok; konfirmasi belum cukup", CONFIRMED: "Atestasi tercatat pada versi ini",
  REVERTED: "Transaksi gagal; atestasi tidak tercatat", INVALID_EVENT: "Event tidak cocok; atestasi tidak diakui",
  NONCANONICAL: "Blok berubah; atestasi perlu diperiksa ulang",
};

export type VersionAttestation = { id: string; auditor: string; scope: string; conclusion: string;
  evidenceCommitment: string; predecessor: string | null; mandate: string };

export function AttestationPanel({ saved, preparationId, requests, recorded, basis, onRecorded }: {
  saved: SavedReportPackage; preparationId: string; requests: PrivateRequests;
  recorded: VersionAttestation[] | null; basis: string | null; onRecorded?: () => void;
}) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [history, setHistory] = useState<AttestationIntent[]>([]);
  const [loading, setLoading] = useState(true);
  const [intent, setIntent] = useState<AttestationIntent | null>(null);
  const [scope, setScope] = useState<string>(SCOPES[0]!.value);
  const [conclusion, setConclusion] = useState<string>("");
  const [predecessor, setPredecessor] = useState("");
  const [evidence, setEvidence] = useState<{ fileName: string; mimeType: string; contentBase64: string }[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [contractSignature, setContractSignature] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const retryId = useRef<string>(crypto.randomUUID());
  const path = `${preparationId}/reports/${saved.id}/attestation`;
  const cacheKey = `tawf-attestation:${path}:${address?.toLowerCase()}`;
  const contextRef = useRef("");
  contextRef.current = `${path}:${requests.contextId}:${address}:${chainId}:${intent?.id}`;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setIntent(null); setHistory([]); setReviewed(false); setContractSignature("");
    recordingRequest<{ intents: AttestationIntent[] }>(path, requests).then(({ intents }) => {
      if (cancelled) return;
      setHistory(intents);
      const cached = sessionStorage.getItem(cacheKey);
      const selected = cached ? intents.find(item => item.id === cached) : intents.at(-1);
      retryId.current = selected?.id ?? cached ?? crypto.randomUUID();
      setIntent(selected ?? null); setStatusUnavailable(false);
    }).catch(() => { if (!cancelled) { setStatusUnavailable(true); setError("Riwayat atestasi belum dapat diperiksa."); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, requests, cacheKey]);

  useEffect(() => {
    if (!intent) return;
    const timer = setInterval(() => { void check(); }, 4000);
    return () => clearInterval(timer);
  }, [intent, path, requests]);
  // A confirmed note changes what the version says it was examined against, so the list is re-read once.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!intent) return;
    const observed = `${intent.id}:${intent.observation.state}`;
    if (announced.current === observed) return;
    announced.current = observed;
    onRecorded?.();
  }, [intent?.id, intent?.observation.state]);

  async function act(label: string, task: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await task(); setStatusUnavailable(false); }
    catch (caught) { if (alive.current) { setError(caught instanceof Error ? caught.message : "Permintaan atestasi ditolak."); } }
    finally { if (alive.current) setBusy(null); }
  }
  async function check() {
    if (!intent) return;
    const checkingContext = contextRef.current;
    try {
      const next = await recordingRequest<{ intent: AttestationIntent }>(`${path}/${intent.id}`, requests);
      if (alive.current && contextRef.current === checkingContext) { setIntent(next.intent); setStatusUnavailable(next.intent.signingAuthority === "UNAVAILABLE");
        if (next.intent.signingAuthority === "STALE" || next.intent.signingAuthority === "UNAVAILABLE") { setContractSignature(""); setReviewed(false); }
      }
    } catch { if (alive.current) setStatusUnavailable(true); }
  }
  async function attach(list: FileList | null) {
    const files = Array.from(list ?? []);
    setEvidence([]);
    await act("Membaca bukti pemeriksaan…", async () => {
    setEvidence(await Promise.all(files.map(async file => ({
      fileName: file.name, mimeType: file.type || "application/octet-stream",
      contentBase64: base64(new Uint8Array(await file.arrayBuffer())),
    }))));
    });
  }
  const prepare = () => act("Menyimpan bukti dan memeriksa kewenangan…", async () => {
    sessionStorage.setItem(cacheKey, retryId.current);
    const next = await recordingRequest<{ intent: AttestationIntent }>(path, requests, {
      retryId: retryId.current, packageDigest: saved.digest, scope, conclusion,
      predecessor: predecessor || null, evidence,
    });
    if (alive.current) { setIntent(next.intent); setHistory(items => [...items.filter(item => item.id !== next.intent.id), next.intent]); setReviewed(false); }
  });
  const sign = () => act("Memproses atestasi…", async () => {
    if (!intent || !address || !reviewed) return;
    const signingContext = contextRef.current;
    const statement = intent.statement;
    if (statement.auditor.toLowerCase() !== address.toLowerCase() || statement.packageId !== saved.id
      || statement.packageDigest !== saved.digest || intent.domain.chainId !== chainId
      || statement.institutionId !== saved.institutionId || statement.reportId !== saved.reportId || statement.version !== saved.version
      || statement.action !== keccak256(toHex("ATTEST_REPORT"))
      || hashTypedData(attestationTypedData(intent.domain, statement)) !== intent.statementDigest) {
      throw new Error("Atestasi berbeda dari versi atau akun yang ditinjau.");
    }
    if (BigInt(statement.deadline) < BigInt(Math.floor(Date.now() / 1000))) throw new Error("Atestasi kedaluwarsa. Mulai tinjauan baru.");
    const fresh = await recordingRequest<{ intent: AttestationIntent }>(`${path}/${intent.id}`, requests);
    if (fresh.intent.signingAuthority !== "CURRENT") {
      setIntent(fresh.intent); setContractSignature("");
      throw new Error("Otoritas auditor berubah atau tidak dapat dibaca. Mulai tinjauan atestasi baru.");
    }
    const signature = contractSignature || await signTypedDataAsync(attestationTypedData(intent.domain, statement));
    if (!alive.current || contextRef.current !== signingContext) return;
    setContractSignature(signature);
    const next = await recordingRequest<{ intent: AttestationIntent }>(`${path}/${intent.id}/submit`, requests, { signature });
    if (alive.current) setIntent(next.intent);
  });

  const sent = intent && ["SUBMITTED", "INCLUDED", "CONFIRMED"].includes(intent.observation.state);
  const mine = (recorded ?? []).filter(note => note.auditor.toLowerCase() === address?.toLowerCase());
  return <section className="space-y-3 rounded border p-3">
    <h5 className="font-semibold">Atestasi auditor</h5>
    <p className="text-sm">Atestasi adalah pendapat atas satu versi, dicatat di samping versi tersebut. Ia tidak mengubah angka paket, pengesahan lembaga, atau vonis validator.</p>
    {basis && <p className="text-sm">{basis}</p>}

    <div className="text-xs">
      <p className="font-semibold">Kesimpulan tercatat pada versi ini</p>
      {!recorded ? <p role="status">Belum dapat dibaca dari registry.</p>
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
        const selected = history.find(item => item.id === e.target.value);
        if (selected) { setIntent(selected); retryId.current = selected.id; sessionStorage.setItem(cacheKey, selected.id); setReviewed(false); setContractSignature(""); }
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
      <p className="text-xs">{evidence.length === 0 ? "Bukti pemeriksaan wajib dilampirkan. Bukti disimpan terbatas dan hanya commitment-nya tercatat pada registry." : `${evidence.length} berkas akan disimpan dan di-commit sebelum penandatanganan.`}</p>
      <Button disabled={!!busy || !conclusion || evidence.length === 0 || !address} onClick={prepare}>Siapkan atestasi untuk versi ini</Button>
    </fieldset>}

    {intent && <div className="space-y-2 text-sm">
      <p role="status">{statusUnavailable ? "Status chain belum dapat dipastikan" : states[intent.observation.state]}</p>
      <p className="text-xs">Konfirmasi: {intent.observation.confirmations} / {intent.observation.requiredConfirmations}. Kebijakan {intent.observation.confirmationPolicy}.</p>
      <p className="text-xs">Kesimpulan yang akan ditandatangani: {conclusionLabel(intent.statement.conclusion)} · lingkup {scopeLabel(intent.statement.scope)}.</p>
      <p className="text-sm">Masa kewenangan {intent.statement.authorityEpoch} · {intent.signingAuthority === "HISTORICAL" ? "Otoritas historis pada blok penerimaan; bukan izin atestasi baru." : intent.signingAuthority === "STALE" ? "Mandat berubah. Mulai tinjauan atestasi baru." : "Mandat live diperiksa ulang sebelum signing."}</p>
      <p className="break-all text-xs">Commitment bukti pemeriksaan {intent.statement.evidenceCommitment}<br />Berkas: {intent.evidence.files.map(file => file.fileName).join(", ")}</p>
      {intent.evidence.files.map(file => <Button key={file.id} variant="outline" disabled={!!busy} onClick={() => act("Mengunduh bukti pemeriksaan…", async () => {
        const blob = await requests.blob(`/api/evidence/${path}/${intent.id}/files/${file.id}`);
        requests.assertCurrent();
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
          <span className="text-xs">Registry memeriksa ERC-1271 saat pengiriman. Salin parameter di atas ke alur penandatanganan akun kontrak jika wallet tidak dapat menandatangani langsung.</span></label>}
        {chainId !== intent.domain.chainId
          ? <Button disabled={!!busy || switching} onClick={() => switchChainAsync({ chainId: intent.domain.chainId }).catch(() => setError("Ganti jaringan di wallet ke chain registry."))}>{switching ? "Mengganti jaringan…" : "Ganti ke jaringan registry"}</Button>
          : <Button disabled={!!busy || switching || loading || !reviewed || !address || statusUnavailable} onClick={sign}>Tandatangani atestasi versi ini</Button>}
      </>}
      {!["SUBMITTED", "INCLUDED"].includes(intent.observation.state) && <Button variant="outline" disabled={!!busy || statusUnavailable} onClick={() => {
        retryId.current = crypto.randomUUID(); sessionStorage.setItem(cacheKey, retryId.current); setIntent(null); setReviewed(false); setContractSignature(""); setEvidence([]);
      }}>Mulai tinjauan atestasi baru</Button>}
      {intent.transactionHash && ["SUBMITTED", "NONCANONICAL"].includes(intent.observation.state) &&
        <Button disabled={!!busy} onClick={() => act("Mengirim ulang transaksi tersimpan…", async () => {
          const next = await recordingRequest<{ intent: AttestationIntent }>(`${path}/${intent.id}/retry`, requests, {});
          if (alive.current) setIntent(next.intent);
        })}>Kirim ulang transaksi tersimpan</Button>}
    </div>}
    {busy && <p role="status">{busy}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
