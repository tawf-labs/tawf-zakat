import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import type { PrivateRequests } from "./privateRequests";
import { useCertificateIssuance } from "./useCertificateIssuance";
import { listActivities, type DistributionActivity } from "../activities/activityClient";

const STATE_LABELS: Record<string, string> = {
  PREPARED: "Pengesahan disiapkan; belum dikirim",
  SUBMITTED: "Transaksi diajukan; belum terbukti masuk blok",
  INCLUDED: "Sertifikat tercatat dalam blok; konfirmasi belum cukup",
  CONFIRMED: "Sertifikat terbit; tingkat konfirmasi tercapai",
  REVERTED: "Transaksi gagal; sertifikat belum terbit",
  INVALID_EVENT: "Event tidak cocok; penerbitan tidak diakui",
  NONCANONICAL: "Blok berubah; penerbitan perlu diperiksa ulang",
};

type Props = { requests: PrivateRequests; institutionId: string; canManage: boolean };

/** Prepare → endorse (sign) → mint a distribution-stage certificate NFT (Spec #100, #111). */
export function CertificateIssuancePanel({ requests, institutionId, canManage }: Props) {
  const [activities, setActivities] = useState<DistributionActivity[]>([]);
  const [activityId, setActivityId] = useState("");
  const [certificateId, setCertificateId] = useState("");
  const [started, setStarted] = useState<{ activityId: string; certificateId: string } | null>(null);

  useEffect(() => {
    listActivities(requests)
      .then((list) => { setActivities(list); setActivityId((current) => current || list[0]?.id || ""); })
      .catch(() => setActivities([]));
  }, [requests]);

  if (!canManage) return null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Sertifikat tahap distribusi</h3>
      <p className="text-sm text-stone-600">
        Membekukan realisasi dan konfirmasi kegiatan penyaluran ke satu sertifikat, lalu menerbitkan
        NFT resmi ke akun lembaga setelah pengesahan. Bagian yang belum terkonfirmasi atau
        diperselisihkan tetap ditandai demikian, tidak dinyatakan final.
      </p>

      {!started && (
        <div className="space-y-3 rounded-xl border border-stone-100 p-4">
          <label className="block text-sm">
            Kegiatan penyaluran
            <select className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm" value={activityId} onChange={(e) => setActivityId(e.target.value)}>
              <option value="">Pilih kegiatan</option>
              {activities.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}
            </select>
          </label>
          <label className="block text-sm">
            Identitas sertifikat
            <input className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono" placeholder="mis. cert-tahap-1"
              value={certificateId} onChange={(e) => setCertificateId(e.target.value.trim())} />
          </label>
          <Button disabled={!activityId || !certificateId} onClick={() => setStarted({ activityId, certificateId })}>
            Mulai persiapan sertifikat
          </Button>
        </div>
      )}

      {started && (
        <CertificateFlow key={`${started.activityId}:${started.certificateId}:${requests.contextId}`}
          requests={requests} institutionId={institutionId} activityId={started.activityId} certificateId={started.certificateId}
          onReset={() => setStarted(null)} />
      )}
    </section>
  );
}

function CertificateFlow({ requests, institutionId, activityId, certificateId, onReset }: {
  requests: PrivateRequests; institutionId: string; activityId: string; certificateId: string; onReset: () => void;
}) {
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { intent, contentTotals, reviewed, error, statusUnavailable, loading, busy, task } = useCertificateIssuance({ requests, institutionId, activityId, certificateId });
  const preparing = busy === "prepare", submitting = busy === "submit", retrying = busy === "retry", checking = busy === "check";
  const locked = loading || preparing || submitting || retrying || switching;
  const sent = intent && ["SUBMITTED", "INCLUDED", "CONFIRMED"].includes(intent.observation.state);

  return (
    <div className="space-y-3 rounded-xl border border-stone-100 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Kegiatan {activityId} · Sertifikat {certificateId}</p>
        <Button variant="outline" size="sm" disabled={locked} onClick={onReset}>Ganti kegiatan/identitas</Button>
      </div>

      {!intent && (
        <Button disabled={locked || !address} onClick={() => task.prepare()}>
          {preparing ? "Membekukan cakupan…" : "Siapkan pengesahan sertifikat"}
        </Button>
      )}

      {intent && contentTotals && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
            <p className="font-semibold text-emerald-800">{contentTotals.confirmedCount}</p>
            <p className="text-emerald-700">Terkonfirmasi</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
            <p className="font-semibold text-amber-800">{contentTotals.unconfirmedCount}</p>
            <p className="text-amber-700">Belum terkonfirmasi</p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-2">
            <p className="font-semibold text-red-800">{contentTotals.disputedCount}</p>
            <p className="text-red-700">Diperselisihkan</p>
          </div>
        </div>
      )}
      {intent && contentTotals && (contentTotals.unconfirmedCount > 0 || contentTotals.disputedCount > 0) && (
        <p role="alert" className="text-xs text-amber-800">
          Sebagian realisasi belum terkonfirmasi atau sedang disengketakan. Bagian ini tetap dibekukan
          apa adanya dan tidak dinyatakan final oleh sertifikat ini.
        </p>
      )}

      {intent && (
        <>
          <p role="status" className="text-sm">
            {statusUnavailable ? "Status chain belum dapat dipastikan" : STATE_LABELS[intent.observation.state] ?? intent.observation.state}
            {" "}<Badge variant={intent.observation.state === "CONFIRMED" ? "success" : intent.observation.state === "REVERTED" ? "danger" : "info"}>{intent.observation.state}</Badge>
          </p>
          <p className="text-xs text-stone-600">
            Konfirmasi: {statusUnavailable ? "belum diketahui" : intent.observation.confirmations} / {intent.observation.requiredConfirmations}.
            {intent.observation.tokenId && ` Token #${intent.observation.tokenId}.`}
          </p>
          <p className="break-all text-xs text-stone-500">
            Chain {intent.domain.chainId} · Kontrak sertifikat {intent.domain.verifyingContract}<br />
            Pengesah {intent.certification.signer}<br />
            Berlaku sampai {new Date(Number(intent.certification.deadline) * 1000).toLocaleString()}
          </p>
          {intent.transactionHash && <p className="break-all text-xs text-stone-500">Transaksi {intent.transactionHash}</p>}

          <Button variant="outline" size="sm" disabled={checking || locked} onClick={() => task.refresh()}>
            {checking ? "Memeriksa…" : "Periksa status chain"}
          </Button>
          {intent.transactionHash && ["SUBMITTED", "NONCANONICAL"].includes(intent.observation.state) && (
            <Button variant="outline" size="sm" disabled={locked || checking || intent.certification.signer.toLowerCase() !== address?.toLowerCase()} onClick={() => task.retry()}>
              {retrying ? "Mengirim ulang…" : "Kirim ulang transaksi tersimpan"}
            </Button>
          )}

          {!sent && (
            <>
              <label className="flex gap-2 text-sm">
                <input type="checkbox" checked={reviewed} disabled={locked} onChange={(e) => task.review(e.target.checked)} />
                Saya telah meninjau cakupan realisasi, totalnya, dan parameter pengesahan di atas.
              </label>
              {chainId !== intent.domain.chainId ? (
                <Button disabled={locked} onClick={() => switchChainAsync({ chainId: intent.domain.chainId })}>
                  {switching ? "Mengganti jaringan…" : "Ganti ke jaringan kontrak sertifikat"}
                </Button>
              ) : (
                <Button disabled={locked || !reviewed || !address || statusUnavailable} onClick={() => task.submit()}>
                  {submitting ? "Memproses pengesahan…" : "Tandatangani dan terbitkan sertifikat"}
                </Button>
              )}
            </>
          )}
        </>
      )}

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
