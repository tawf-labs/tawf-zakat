import type { PrivateRequests } from "./privateRequests";
import { useState } from "react";
import { useRecording, usePublication } from "./useRegistryInteraction";
import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "../../components/ui/Button";
import { evidenceTypedData } from "../../../../shared/report-registry";
import type { SavedReportPackage } from "./evidenceClient";
import { conclusionLabel, formatBlockInstant, VERSION_STATE_LABELS } from "./evidenceText";
import { AttestationPanel } from "./AttestationPanel";

const labels = {
  PREPARED: "Pengesahan disiapkan; belum dikirim", SUBMITTED: "Sudah dikirim; belum terbukti tercatat",
  INCLUDED: "Bukti sudah tercatat; menunggu konfirmasi cukup", CONFIRMED: "Bukti tercatat dan terkonfirmasi",
  REVERTED: "Pengiriman gagal; bukti tidak tercatat", INVALID_EVENT: "Catatan tidak cocok; pencatatan tidak diakui",
  NONCANONICAL: "Catatan publik berubah; pencatatan perlu diperiksa ulang",
};
const publicationLabels = { ...labels,
  INCLUDED: "Penerbitan sudah tercatat; menunggu konfirmasi", CONFIRMED: "Laporan terbit dan terkonfirmasi",
  REVERTED: "Pengiriman gagal; laporan belum terbit", INVALID_EVENT: "Catatan tidak cocok; penerbitan tidak diakui",
  NONCANONICAL: "Catatan publik berubah; penerbitan perlu diperiksa ulang",
};
type Props = { saved: SavedReportPackage; preparationId: string; requests: PrivateRequests; publication?: boolean; onCorrect?: (packageId: string) => void };
export function RecordingPanel(props: Props) {
  return props.publication ? <PublicationTaskPanel {...props} /> : <RecordingTaskPanel {...props} />;
}
function PublicationTaskPanel(props: Props) {
  const interaction = usePublication(props);
  return <RecordingView {...props} interaction={interaction} />;
}
function RecordingTaskPanel(props: Props) {
  const interaction = useRecording(props);
  return <RecordingView {...props} interaction={interaction} />;
}
function RecordingView({ saved, preparationId, requests, publication = false, onCorrect, interaction }: Props & { interaction: ReturnType<typeof useRecording> }) {
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { intent, history, reviewed, signature, statusUnavailable, lineUnavailable, task } = interaction;
  const [walletError, setError] = useState<string | null>(null);
  const error = interaction.error ?? walletError;
  const preparing = interaction.busy === "prepare", submitting = interaction.busy === "submit", retrying = interaction.busy === "retry", checking = interaction.busy === "check";
  const version = interaction.view?.version ?? null, versionLine = interaction.view?.history ?? null;
  const prepare = task.prepare, submit = task.submit, retry = task.retry, check = task.refresh, readLine = task.refresh;
  const setReviewed = task.review, setSignature = task.signature;
  const locked = interaction.loading || submitting || preparing || switching || retrying;
  const sent = intent && ["SUBMITTED", "INCLUDED", "CONFIRMED"].includes(intent.observation.state);
  return <section className="space-y-3 rounded border p-3">
    <h5 className="font-semibold">{publication ? "Penerbitan laporan" : "Pengesahan pencatatan bukti"}</h5>
    <p className="text-sm">{publication ? "Penerbitan memerlukan pengesahan lembaga dan pemeriksaan otomatis layanan untuk paket yang sama. Sistem memeriksa pernyataan layanan itu; hasil hitungan bergantung pada layanan dan sumber bank, bukan pembuktian matematis penuh. Pendapat auditor (atestasi) diperiksa terpisah dan dibaca per versi." : "Saya mengesahkan pencatatan paket ini beserta temuannya. Tindakan ini belum menerbitkan laporan, menyatakan sumber benar, atau memberikan opini auditor."}</p>
    <details><summary>Cakupan sumber dan temuan paket beku</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ snapshot: saved.snapshot, reconciliation: saved.reconciliation, disclosure: saved.disclosure, policy: saved.policy }, null, 2)}</pre></details>
    {history.length > 0 && <label className="block text-sm">Riwayat pengesahan paket<select className="block w-full rounded border p-2" value={intent?.id ?? ""} disabled={locked || checking} onChange={e => {
      task.select(e.target.value);
    }}><option value="">Pilih percobaan</option>{history.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>}
    {!intent && <Button disabled={locked || !address} onClick={prepare}>{preparing ? "Memeriksa kewenangan…" : publication ? "Minta pengesahan validator" : "Siapkan pengesahan pencatatan"}</Button>}
    {intent && <>
      <p className="text-sm">Periode kewenangan {intent.authorization.authorityEpoch} · {intent.signingAuthority === "HISTORICAL" ? "Wewenang saat pencatatan dulu; bukan izin untuk tindakan baru." : intent.signingAuthority === "STALE" ? "Wewenang berubah. Mulai tinjauan baru." : "Wewenang Anda dicek ulang sebelum penandatanganan."}</p>
      <p role="status">{statusUnavailable ? "Status pencatatan belum dapat dipastikan" : (publication ? publicationLabels : labels)[intent.observation.state]}</p>
      <p className="text-xs">Konfirmasi: {statusUnavailable ? "belum diketahui" : intent.observation.confirmations} / {intent.observation.requiredConfirmations}. {publication ? `Laporan ${saved.reportId} · versi ${saved.version}` : "Pengesahan ini hanya untuk pencatatan bukti."}</p>
      <p className="text-xs">Kebijakan {intent.observation.confirmationPolicy}. Konfirmasi yang tercapai belum berarti pencatatan sudah final di jaringan induk (Ethereum). {intent.domain.chainId === 31337 ? "Jaringan uji lokal, data percobaan." : intent.domain.chainId === 421614 ? "Arbitrum Sepolia (jaringan uji, bukan uang sungguhan)." : "Pastikan jaringan sudah benar sebelum menandatangani."}</p>
      <p className="break-all text-xs">Jaringan {intent.domain.chainId} · Alamat pencatatan {intent.domain.verifyingContract} <button onClick={() => navigator.clipboard.writeText(intent.domain.verifyingContract)}>Salin alamat pencatatan</button><br />Pengesah {intent.authorization.signer} <button onClick={() => navigator.clipboard.writeText(intent.authorization.signer)}>Salin akun</button><br />Berlaku sampai {new Date(Number(intent.authorization.deadline) * 1000).toLocaleString()}</p>
      {publication && <p className="text-sm">Pengesahan lembaga: {intent.transactionHash ? "lihat status penerimaan transaksi" : "menunggu tanda tangan"}. Pemeriksaan otomatis: {intent.validator ? `pernyataan LOLOS tersedia dari ${intent.validator.authorization.signer}; wewenang dicek ulang saat pengiriman` : "belum tersedia"}. Auditor: {version?.attestations?.entries.length ? version.attestations.entries.map(note => conclusionLabel(note.conclusion)).join(", ") : "belum diperiksa"}.</p>}
      {publication && intent.validator && <details><summary>Pernyataan layanan pemeriksa (detail teknis)</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(intent.validator, null, 2)}</pre></details>}
      <details><summary>Parameter pengesahan yang akan ditandatangani</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(evidenceTypedData(intent.domain, intent.authorization), (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}</pre></details>
      <Button variant="outline" onClick={() => navigator.clipboard.writeText(JSON.stringify(evidenceTypedData(intent.domain, intent.authorization), (_, value) => typeof value === "bigint" ? value.toString() : value))}>Salin data pengesahan untuk wallet</Button>
      {intent.transactionHash && <p className="break-all text-xs">Transaksi {intent.transactionHash}<br />Blok {intent.observation.blockNumber ?? "belum tersedia"} · {intent.observation.blockHash} · Log {intent.observation.logIndex ?? "belum tersedia"}</p>}
      <Button variant="outline" disabled={checking || locked} onClick={check}>{checking ? "Memeriksa receipt…" : "Periksa status chain"}</Button>
      {intent.transactionHash && ["SUBMITTED", "NONCANONICAL"].includes(intent.observation.state) && <Button disabled={locked || checking || intent.authorization.signer.toLowerCase() !== address?.toLowerCase()} onClick={retry}>{retrying ? "Mengirim ulang transaksi…" : "Kirim ulang transaksi tersimpan"}</Button>}
      {!sent && <>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} disabled={locked} onChange={e => setReviewed(e.target.checked)} />Saya telah meninjau isi, cakupan sumber, temuan, ringkasan digital, tujuan, dan parameter pengesahan di atas.</label>
        {intent.accountKind === "ERC1271" && <label className="block text-sm">Tanda tangan akun bersama lembaga atas parameter ini (hasil persetujuan beberapa pihak)<textarea className="block w-full rounded border p-2 font-mono text-xs" value={signature} disabled={locked} onChange={e => setSignature(e.target.value.trim())} /><span className="text-xs">Sistem memeriksa tanda tangan ini saat pengiriman. Salin parameter di atas ke alur penandatanganan akun bersama bila dompet digital tidak dapat menandatangani langsung.</span></label>}
        {chainId !== intent.domain.chainId ? <Button disabled={locked} onClick={() => switchChainAsync({ chainId: intent.domain.chainId }).catch(() => setError("Ganti jaringan di dompet digital ke jaringan yang dipakai lembaga."))}>{switching ? "Mengganti jaringan…" : "Ganti ke jaringan yang benar"}</Button>
          : <Button disabled={locked || !reviewed || !address || statusUnavailable} onClick={submit}>{submitting ? "Memproses pengesahan…" : signature ? "Kirim ulang pengesahan yang sama" : publication ? "Tandatangani penerbitan laporan" : "Tandatangani pencatatan bukti"}</Button>}
        <Button variant="outline" disabled={locked || checking} onClick={() => { task.newReview(); }}>Mulai tinjauan pengesahan baru</Button>
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
          <p className="text-xs">Atestasi auditor versi ini: {entry.attestations.entries.length === 0 ? "belum diperiksa"
            : entry.attestations.entries.map(note => conclusionLabel(note.conclusion)).join(", ")}. Atestasi versi lain tidak berlaku di sini.</p>
        </li>)}</ol>}
      </>}
    </section>}
    {publication && version?.publication === "PUBLISHED" && <AttestationPanel key={`${saved.id}:${requests.contextId}:${address}`} saved={saved} preparationId={preparationId} requests={requests}
      recorded={version.attestations?.entries ?? null} basis={version.attestations?.basis ?? null} onRecorded={() => void readLine()} />}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
