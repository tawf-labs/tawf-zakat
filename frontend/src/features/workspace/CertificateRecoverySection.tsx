import { useEffect, useState } from "react";
import { useAccount, useSignTypedData, useSwitchChain } from "wagmi";
import { Button } from "../../components/ui/Button";
import { recoveryTypedData, type CustodyRecoveryIntent } from "../../../../shared/certificate-nft";
import { getRecovery, listRecoveries, prepareRecovery, sendRecovery, type CertificateLineStatus } from "./certificateClient";
import type { PrivateRequests } from "./privateRequests";

const STATE_LABELS: Record<string, string> = {
  PREPARED: "Pengesahan pemulihan disiapkan; belum dikirim",
  SUBMITTED: "Transaksi diajukan; belum terbukti masuk blok",
  INCLUDED: "Pemulihan tercatat dalam blok; konfirmasi belum cukup",
  CONFIRMED: "Token pengganti terbit ke pengendali baru",
  REVERTED: "Transaksi gagal; pemegang belum berubah",
  INVALID_EVENT: "Event tidak cocok; pemulihan tidak diakui",
  NONCANONICAL: "Blok berubah; pemulihan perlu diperiksa ulang",
};

type Props = { requests: PrivateRequests; institutionId: string; activityId: string; line: CertificateLineStatus; disabled: boolean };

/** Recovery by replacement issuance: the holder differs from the institution's resolved custodian,
 * so an authorized signatory endorses a replacement token. Nothing is transferred and the target is
 * read from the contract; this panel never accepts an address. */
export function CertificateRecoverySection({ requests, institutionId, activityId, line, disabled }: Props) {
  const { address, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const [decisionRef, setDecisionRef] = useState("");
  const [recovery, setRecovery] = useState<CustodyRecoveryIntent | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const custody = line.custody;

  useEffect(() => {
    let alive = true;
    listRecoveries(requests, activityId, line.certificateId)
      .then((all) => { if (alive) setRecovery(all.filter((r) => r.signingAuthority !== "STALE").at(-1) ?? null); })
      .catch(() => { /* Recovery needs its own mandate; without it the section simply offers nothing. */ });
    return () => { alive = false; };
  }, [requests, activityId, line.certificateId]);

  if (!custody?.recoveryNeeded && !recovery) return null;

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await task(); }
    catch (failure) { setError(`${failure instanceof Error ? failure.message : "Permintaan ditolak."} Hasil belum dapat dipastikan; periksa status sebelum mengulang.`); }
    finally { setBusy(null); }
  }
  const refresh = () => run("check", async () => { if (recovery) setRecovery(await getRecovery(requests, activityId, line.certificateId, recovery.id)); });
  const prepare = () => run("prepare", async () => { setRecovery(await prepareRecovery(requests, institutionId, activityId, line.certificateId, decisionRef)); setReviewed(false); });
  const submit = () => run("submit", async () => {
    if (!recovery) return;
    // Re-read first: a stale endorsement must not be signed, and a late wallet answer must not revive one.
    const fresh = await getRecovery(requests, activityId, line.certificateId, recovery.id);
    setRecovery(fresh);
    if (fresh.signingAuthority !== "CURRENT" || fresh.recovery.signer.toLowerCase() !== address?.toLowerCase()) {
      throw new Error("Pemulihan tidak lagi sah atau milik akun lain. Mulai persiapan baru.");
    }
    const signature = await signTypedDataAsync(recoveryTypedData(fresh.domain, fresh.recovery) as any);
    setRecovery(await sendRecovery(requests, "submit", institutionId, activityId, line.certificateId, fresh.id, signature));
  });
  const retry = () => run("retry", async () => { if (recovery) setRecovery(await sendRecovery(requests, "retry", institutionId, activityId, line.certificateId, recovery.id)); });
  const locked = disabled || busy !== null;

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Pemulihan pemegang sertifikat</h4>
      {custody?.recoveryNeeded && (
        <p role="alert" className="text-xs text-amber-800">
          Token resmi dipegang {custody.holder}, sedangkan pengendali institusi pada kontrak kini {custody.resolvedCustodian}.
          Pemulihan menerbitkan token pengganti ke pengendali tersebut; token lama, penerbit dan isi tidak berubah dan tidak ada token yang dipindahkan.
        </p>
      )}
      {!recovery && (
        <div className="space-y-2">
          <label className="block text-xs">
            Dasar keputusan lembaga (mis. nomor surat keputusan)
            <input className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" maxLength={200} value={decisionRef}
              disabled={locked} onChange={(event) => setDecisionRef(event.target.value)} />
          </label>
          <Button size="sm" disabled={locked || decisionRef.trim().length < 3} onClick={() => void prepare()}>
            {busy === "prepare" ? "Menyiapkan pemulihan…" : "Siapkan pemulihan"}
          </Button>
        </div>
      )}
      {recovery && (
        <div className="space-y-2 text-xs">
          <p role="status">{STATE_LABELS[recovery.observation.state] ?? recovery.observation.state}
            {recovery.signingAuthority === "STALE" && " · Pengesahan ini sudah tidak sah."}</p>
          <p className="break-all text-stone-500">
            Pemegang lama {recovery.previousCustodian}<br />Pengendali baru {recovery.recovery.newCustodian}<br />
            Dasar keputusan {recovery.decisionRef}
            {recovery.observation.tokenId && <><br />Token pengganti #{recovery.observation.tokenId}</>}
            {recovery.transactionHash && <><br />Transaksi {recovery.transactionHash}</>}
          </p>
          <Button variant="outline" size="sm" disabled={locked} onClick={() => void refresh()}>Periksa status pemulihan</Button>
          {["SUBMITTED", "NONCANONICAL"].includes(recovery.observation.state) && recovery.transactionHash && (
            <Button variant="outline" size="sm" disabled={locked} onClick={() => void retry()}>Kirim ulang transaksi tersimpan</Button>
          )}
          {recovery.observation.state === "PREPARED" && recovery.signingAuthority === "CURRENT" && (
            <>
              <label className="flex gap-2">
                <input type="checkbox" checked={reviewed} disabled={locked} onChange={(event) => setReviewed(event.target.checked)} />
                Saya telah meninjau pengendali baru, dasar keputusan, dan bahwa tidak ada token yang dipindahkan.
              </label>
              {chainId !== recovery.domain.chainId ? (
                <Button disabled={locked} onClick={() => void switchChainAsync({ chainId: recovery.domain.chainId })}>Ganti ke jaringan kontrak sertifikat</Button>
              ) : (
                <Button disabled={locked || !reviewed || !address} onClick={() => void submit()}>
                  {busy === "submit" ? "Memproses pengesahan…" : "Tandatangani dan terbitkan token pengganti"}
                </Button>
              )}
            </>
          )}
          {recovery.signingAuthority === "STALE" && recovery.observation.state === "PREPARED" && (
            <Button size="sm" disabled={locked} onClick={() => { setRecovery(null); setReviewed(false); }}>Mulai persiapan baru</Button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
