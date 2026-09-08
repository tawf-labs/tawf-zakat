import { useEffect, useRef, useState } from "react";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { hashTypedData, keccak256, toHex } from "viem";
import { Button } from "../../components/ui/Button";
import { evidenceTypedData, type RecordingIntent } from "../../../../shared/report-registry";
import type { SavedReportPackage } from "./evidenceClient";
import { recordingRequest } from "./recordingClient";
import { formatBlockInstant, VERSION_STATE_LABELS } from "./evidenceText";

const labels = {
  PREPARED: "Pengesahan disiapkan; belum dikirim", SUBMITTED: "Transaksi diajukan; belum terbukti masuk blok",
  INCLUDED: "Bukti tercatat dalam blok; konfirmasi belum cukup", CONFIRMED: "Bukti tercatat; tingkat konfirmasi tercapai",
  REVERTED: "Transaksi gagal; bukti tidak tercatat", INVALID_EVENT: "Event tidak cocok; pencatatan tidak diakui",
  NONCANONICAL: "Blok berubah; pencatatan perlu diperiksa ulang",
};
const publicationLabels = { ...labels,
  INCLUDED: "Penerbitan masuk blok; menunggu konfirmasi", CONFIRMED: "Laporan terbit; tingkat konfirmasi tercapai",
  REVERTED: "Transaksi gagal; laporan belum terbit", INVALID_EVENT: "Event tidak cocok; penerbitan tidak diakui",
  NONCANONICAL: "Blok berubah; penerbitan perlu diperiksa ulang",
};
type PublishedVersion = { versionState: string; publication: string; predecessor: string | null;
  correctionReason: string | null; officialVersion: string | null; officialPackageId: string | null };
type VersionHistoryEntry = { packageId: string; version: string; official: boolean; predecessor: string | null;
  correctionReason: string | null; endorsements: { institution: string; validator: string };
  attestations: { state: string; entries: unknown[] };
  anchor: { transactionHash?: string; state: string; blockNumber?: string; blockTimestamp?: string; confirmations: number; requiredConfirmations: number } | null };

export function RecordingPanel({ saved, preparationId, token, publication = false, onCorrect }: { saved: SavedReportPackage; preparationId: string; token: string; publication?: boolean; onCorrect?: (packageId: string) => void }) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [intent, setIntent] = useState<RecordingIntent | null>(null);
  const [history, setHistory] = useState<RecordingIntent[]>([]);
  const [retrying, setRetrying] = useState(false);
  const checkingRef = useRef(false);
  const [reviewed, setReviewed] = useState(false);
  const [signature, setSignature] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [version, setVersion] = useState<PublishedVersion | null>(null);
  const [versionLine, setVersionLine] = useState<VersionHistoryEntry[] | null>(null);
  const [lineUnavailable, setLineUnavailable] = useState(false);
  const retryId = useRef<string>(crypto.randomUUID());
  const path = `${preparationId}/reports/${saved.id}/${publication ? "publication" : "recording"}`;
  const cacheKey = `tawf-recording:${path}:${address?.toLowerCase()}`;
  const alive = useRef(true);
  const contextRef = useRef("");
  contextRef.current = `${address}:${chainId}:${token}:${saved.id}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    recordingRequest<{ intents: RecordingIntent[] }>(path, token).then(({ intents }) => {
      if (cancelled) return;
      setHistory(intents);
      const id = sessionStorage.getItem(cacheKey);
      const selected = intents.find(item => item.id === id)
        ?? intents.find(item => ["CONFIRMED", "INCLUDED", "SUBMITTED"].includes(item.observation.state))
        ?? intents.at(-1);
      if (selected) { retryId.current = selected.id; setIntent(selected); }
      setStatusUnavailable(false);
    }).catch(() => { if (!cancelled) { setStatusUnavailable(true); setError("Riwayat pencatatan belum dapat diperiksa."); } });
    return () => { cancelled = true; };
  }, [cacheKey, path, token]);
  async function check() {
    if (!intent || checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      const next = (await recordingRequest(`${path}/${intent.id}`, token)).intent;
      if (alive.current) { setIntent(next); setStatusUnavailable(false); setError(null); }
    } catch { if (alive.current) { setStatusUnavailable(true); setError("Status chain tidak tersedia; keberhasilan belum dapat dipastikan."); } }
    finally { checkingRef.current = false; if (alive.current) setChecking(false); }
  }
  useEffect(() => {
    if (!intent || !["SUBMITTED", "INCLUDED", "CONFIRMED"].includes(intent.observation.state)) return;
    const timer = setInterval(() => { void check(); }, 4000);
    return () => clearInterval(timer);
  }, [intent, path, token]);
  // Version identity and the official line are read from the registry, never from the numbering on screen.
  async function readLine() {
    if (!publication) return;
    try {
      const [current, line] = await Promise.all([
        recordingRequest<{ version: PublishedVersion }>(`${path}/version`, token),
        recordingRequest<{ history: VersionHistoryEntry[] }>(`${path}/history`, token),
      ]);
      if (alive.current) { setVersion(current.version); setVersionLine(line.history); setLineUnavailable(false); }
    } catch { if (alive.current) { setLineUnavailable(true); setVersion(null); setVersionLine(null); } }
  }
  useEffect(() => { void readLine(); }, [path, token, intent?.observation.state]);
  async function prepare() {
    setPreparing(true); setError(null);
    try {
      sessionStorage.setItem(cacheKey, retryId.current);
      const next = (await recordingRequest(path, token, { retryId: retryId.current, digest: saved.digest })).intent;
      if (alive.current) { setIntent(next); setHistory(previous => [...previous.filter(item => item.id !== next.id), next]); setStatusUnavailable(false); setReviewed(false); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Persiapan ditolak."); }
    finally { if (alive.current) setPreparing(false); }
  }
  async function submit() {
    if (!intent || !address || !reviewed) return;
    const signingContext = contextRef.current;
    setSubmitting(true); setError(null);
    try {
      const a = intent.authorization;
      if (a.action !== keccak256(toHex(publication ? "PUBLISH_REPORT" : "RECORD_EVIDENCE")) || a.packageId !== saved.id || a.digest !== saved.digest
        || a.institutionId !== saved.institutionId || a.reportId !== saved.reportId || a.version !== saved.version
        || a.predecessor !== (saved.predecessor ?? "") || a.outcome !== saved.verdict.outcome || a.policy !== saved.policy.id
        || a.signer.toLowerCase() !== address.toLowerCase() || intent.domain.chainId !== chainId
        || hashTypedData(evidenceTypedData(intent.domain, a)) !== intent.authorizationDigest) throw new Error("Pengesahan berbeda dari paket atau akun yang ditinjau.");
      if (BigInt(a.deadline) < BigInt(Math.floor(Date.now() / 1000))) throw new Error("Pengesahan kedaluwarsa. Mulai tinjauan baru secara eksplisit.");
      if (publication) {
        const v = intent.validator;
        if (!v || v.authorization.signer.toLowerCase() === a.signer.toLowerCase()
          || v.authorization.action !== keccak256(toHex("VALIDATE_REPORT")) || v.authorization.outcome !== "LOLOS"
          || hashTypedData(evidenceTypedData(intent.domain, v.authorization)) !== v.authorizationDigest
          || ["institutionId", "reportId", "version", "packageId", "predecessor", "digest", "policy", "outcome", "deadline"].some(key => v.authorization[key as keyof typeof a] !== a[key as keyof typeof a])) throw new Error("Pengesahan validator tidak cocok.");
      }
      const signed = signature || await signTypedDataAsync(evidenceTypedData(intent.domain, a));
      if (!alive.current || contextRef.current !== signingContext) return;
      setSignature(signed);
      const next = await recordingRequest(`${path}/${intent.id}/submit`, token, { signature: signed });
      if (alive.current) { setIntent(next.intent); setStatusUnavailable(false); }
    } catch (caught) {
      // The server's own reason matters here: a losing correction must be told to reprepare, not just to retry.
      const reason = caught instanceof Error && caught.message ? ` ${caught.message}` : "";
      if (alive.current) { setStatusUnavailable(true); setError(`Tanda tangan atau pengiriman ditolak.${reason} Periksa status chain sebelum mencoba lagi; parameter pengesahan tetap sama.`); }
    }
    finally { if (alive.current) setSubmitting(false); }
  }
  async function retry() {
    if (!intent) return;
    setRetrying(true); setError(null);
    try {
      const result = await recordingRequest(`${path}/${intent.id}/retry`, token, {});
      if (alive.current) { setIntent(result.intent); setStatusUnavailable(false); }
    } catch { if (alive.current) { setStatusUnavailable(true); setError("Pengiriman ulang belum dapat dipastikan. Periksa status; byte transaksi tetap tersimpan."); } }
    finally { if (alive.current) setRetrying(false); }
  }
  const locked = submitting || preparing || switching || retrying;
  const sent = intent && ["SUBMITTED", "INCLUDED", "CONFIRMED"].includes(intent.observation.state);
  return <section className="space-y-3 rounded border p-3">
    <h5 className="font-semibold">{publication ? "Penerbitan laporan" : "Pengesahan pencatatan bukti"}</h5>
    <p className="text-sm">{publication ? "Penerbitan memerlukan pengesahan lembaga dan layanan validator untuk paket yang sama. Kontrak memverifikasi pernyataan layanan; perhitungan bergantung pada layanan dan sumber bank, bukan komputasi trustless. Atestasi auditor: belum diperiksa." : "Saya mengesahkan pencatatan paket ini beserta temuannya. Tindakan ini belum menerbitkan laporan, menyatakan sumber benar, atau memberikan opini auditor."}</p>
    <details><summary>Cakupan sumber dan temuan paket beku</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ snapshot: saved.snapshot, reconciliation: saved.reconciliation, disclosure: saved.disclosure, policy: saved.policy }, null, 2)}</pre></details>
    {history.length > 0 && <label className="block text-sm">Riwayat pengesahan paket<select className="block w-full rounded border p-2" value={intent?.id ?? ""} disabled={locked || checking} onChange={e => {
      const selected = history.find(item => item.id === e.target.value);
      if (selected) { setIntent(selected); setSignature(""); setReviewed(false); setStatusUnavailable(true); sessionStorage.setItem(cacheKey, selected.id); }
    }}><option value="">Pilih percobaan</option>{history.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>}
    {!intent && <Button disabled={locked || !address} onClick={prepare}>{preparing ? "Memeriksa kewenangan…" : publication ? "Minta pengesahan validator" : "Siapkan pengesahan pencatatan"}</Button>}
    {intent && <>
      <p role="status">{statusUnavailable ? "Status chain belum dapat dipastikan" : (publication ? publicationLabels : labels)[intent.observation.state]}</p>
      <p className="text-xs">Konfirmasi: {statusUnavailable ? "belum diketahui" : intent.observation.confirmations} / {intent.observation.requiredConfirmations}. {publication ? `Laporan ${saved.reportId} · versi ${saved.version}` : "Pengesahan ini hanya untuk pencatatan bukti."}</p>
      <p className="text-xs">Kebijakan {intent.observation.confirmationPolicy}. Kedalaman blok ini bukan finalitas settlement L1. {intent.domain.chainId === 31337 ? "EVM lokal, data uji." : intent.domain.chainId === 421614 ? "Arbitrum Sepolia, testnet." : "Periksa jaringan deployment sebelum menandatangani."}</p>
      <p className="break-all text-xs">Chain {intent.domain.chainId} · Registry {intent.domain.verifyingContract} <button onClick={() => navigator.clipboard.writeText(intent.domain.verifyingContract)}>Salin registry</button><br />Pengesah {intent.authorization.signer} <button onClick={() => navigator.clipboard.writeText(intent.authorization.signer)}>Salin akun</button><br />Berlaku sampai {new Date(Number(intent.authorization.deadline) * 1000).toLocaleString()}</p>
      {publication && <p className="text-sm">Pengesahan lembaga: {intent.transactionHash ? "lihat status penerimaan transaksi" : "menunggu tanda tangan"}. Validator: {intent.validator ? `pernyataan LOLOS tersedia dari ${intent.validator.authorization.signer}; kewenangan diperiksa kembali saat eksekusi` : "belum tersedia"}. Auditor: belum diperiksa.</p>}
      {publication && intent.validator && <details><summary>Pernyataan layanan validator</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(intent.validator, null, 2)}</pre></details>}
      <details><summary>Parameter pengesahan yang akan ditandatangani</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(evidenceTypedData(intent.domain, intent.authorization), (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}</pre></details>
      <Button variant="outline" onClick={() => navigator.clipboard.writeText(JSON.stringify(evidenceTypedData(intent.domain, intent.authorization), (_, value) => typeof value === "bigint" ? value.toString() : value))}>Salin data pengesahan untuk wallet</Button>
      {intent.transactionHash && <p className="break-all text-xs">Transaksi {intent.transactionHash}<br />Blok {intent.observation.blockNumber ?? "belum tersedia"} · {intent.observation.blockHash} · Log {intent.observation.logIndex ?? "belum tersedia"}</p>}
      <Button variant="outline" disabled={checking || locked} onClick={check}>{checking ? "Memeriksa receipt…" : "Periksa status chain"}</Button>
      {intent.transactionHash && ["SUBMITTED", "NONCANONICAL"].includes(intent.observation.state) && <Button disabled={locked || checking || intent.authorization.signer.toLowerCase() !== address?.toLowerCase()} onClick={retry}>{retrying ? "Mengirim ulang transaksi…" : "Kirim ulang transaksi tersimpan"}</Button>}
      {!sent && <>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={locked} onChange={e => setReviewed(e.target.checked)} />Saya telah meninjau isi, cakupan sumber, temuan, digest, tujuan, dan parameter pengesahan di atas.</label>
        {intent.accountKind === "ERC1271" && <label className="block text-sm">Tanda tangan akun kontrak atas parameter ini (dari alur persetujuan lembaga)<textarea className="block w-full rounded border p-2 font-mono text-xs" value={signature} disabled={locked} onChange={e => setSignature(e.target.value.trim())} /><span className="text-xs">Registry memeriksa ERC-1271 saat pengiriman. Salin parameter di atas ke alur penandatanganan akun kontrak jika wallet tidak dapat menandatangani langsung.</span></label>}
        {chainId !== intent.domain.chainId ? <Button disabled={locked} onClick={() => switchChainAsync({ chainId: intent.domain.chainId }).catch(() => setError("Ganti jaringan di wallet ke chain registry."))}>{switching ? "Mengganti jaringan…" : "Ganti ke jaringan registry"}</Button>
          : <Button disabled={locked || !reviewed || !address || statusUnavailable} onClick={submit}>{submitting ? "Memproses pengesahan…" : signature ? "Kirim ulang pengesahan yang sama" : publication ? "Tandatangani penerbitan laporan" : "Tandatangani pencatatan bukti"}</Button>}
        <Button variant="outline" disabled={locked || checking || statusUnavailable} onClick={() => { retryId.current = crypto.randomUUID(); sessionStorage.removeItem(cacheKey); setIntent(null); setSignature(""); setReviewed(false); }}>Mulai tinjauan pengesahan baru</Button>
      </>}
    </>}
    {publication && <section className="space-y-2 border-t pt-3 text-sm">
      <h6 className="font-semibold">Versi resmi dan riwayat koreksi</h6>
      {lineUnavailable ? <p role="alert">Riwayat versi belum dapat dibaca dari registry. Status resmi belum dapat dipastikan.</p> : <>
        <p role="status">Paket ini: {version ? VERSION_STATE_LABELS[version.versionState] ?? "perlu diperiksa" : "belum diperiksa"}.
          {version?.correctionReason && ` Alasan koreksi: ${version.correctionReason}`}</p>
        {version?.officialPackageId && version.officialPackageId !== saved.id && <p>Versi resmi terkini kini paket {version.officialPackageId}. Penomoran pada layar bukan sumber kewenangan.</p>}
        {onCorrect && version?.versionState === "VERSI_RESMI_TERKINI" && <Button variant="outline" onClick={() => onCorrect(saved.id)}>Mulai koreksi dari versi ini</Button>}
        {versionLine && versionLine.length === 0 && <p>Laporan ini belum memiliki versi resmi.</p>}
        {versionLine && versionLine.length > 0 && <ol className="list-none space-y-2">{versionLine.map(entry => <li key={entry.packageId} className="rounded border p-2">
          <p className="font-semibold">Versi {entry.version} {entry.official ? "· resmi terkini" : "· digantikan"}</p>
          <p className="break-all text-xs">Paket {entry.packageId}{entry.predecessor ? <><br />Menyusul paket {entry.predecessor}</> : <><br />Versi pertama; tidak menyusul versi lain.</>}</p>
          <p className="text-xs">Alasan koreksi: {entry.correctionReason ?? "—"}</p>
          <p className="break-all text-xs">Pengesah lembaga {entry.endorsements.institution}<br />Validator {entry.endorsements.validator}</p>
          <p className="break-all text-xs">{entry.anchor ? <>Pencatatan {formatBlockInstant(entry.anchor.blockTimestamp)} · blok {entry.anchor.blockNumber} · konfirmasi {entry.anchor.confirmations}/{entry.anchor.requiredConfirmations}<br />Transaksi {entry.anchor.transactionHash}</> : "Receipt penerbitan tidak tersimpan pada ruang kerja ini."}</p>
          <p className="text-xs">Atestasi auditor versi ini: {entry.attestations.entries.length === 0 ? "belum diperiksa" : `${entry.attestations.entries.length} tercatat`}. Atestasi versi lain tidak berlaku di sini.</p>
        </li>)}</ol>}
      </>}
    </section>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
