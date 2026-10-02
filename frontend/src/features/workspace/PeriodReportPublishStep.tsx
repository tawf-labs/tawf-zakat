import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "../../components/ui/Button";
import type { PrivateRequests } from "./privateRequests";
import type { SavedReportPackage } from "./evidenceClient";
import { usePublication } from "./useRegistryInteraction";

/**
 * Langkah 5: sahkan dan terbitkan (ADR-0043, #131).
 *
 * One button over the existing publication relay: it asks the validator service for
 * its endorsement, has the institution's endorsing account sign, and relays the
 * transaction. The relay keeps every attempt and its retry, so a failure or a page
 * reload never sends a second, different publication. Digests, retry ids and the
 * signed parameters stay under *Detail teknis*.
 */

const SENT = ["SUBMITTED", "INCLUDED"];
const FAILED = ["REVERTED", "INVALID_EVENT"];

export function PeriodReportPublishStep({ saved, preparationId, requests, onPublished }: {
  saved: SavedReportPackage; preparationId: string; requests: PrivateRequests; onPublished: () => void;
}) {
  const { address, chainId } = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { intent, loading, busy, error, task } = usePublication({ saved, preparationId, requests });
  const [endorsed, setEndorsed] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const announced = useRef(false);
  const state = intent?.observation.state ?? null;

  useEffect(() => {
    if (state === "CONFIRMED" && !announced.current) { announced.current = true; onPublished(); }
  }, [state, onPublished]);

  const wrongChain = intent !== null && chainId !== intent.domain.chainId;
  const stale = intent !== null && (intent.signingAuthority === "STALE" || FAILED.includes(state!));

  async function endorseAndPublish() {
    setWalletError(null);
    if (stale) task.newReview();
    if (!task.getSnapshot().intent) await task.prepare();
    const prepared = task.getSnapshot().intent;
    if (!prepared || prepared.domain.chainId !== chainId) return;
    task.review(true);
    await task.submit();
  }

  const working = loading || busy !== null || switching;
  const label = busy === "prepare" ? "Meminta pemeriksaan layanan…" : busy === "submit" ? "Menunggu tanda tangan…" : "Sahkan dan terbitkan";

  return (
    <section aria-label="Sahkan dan terbitkan" className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
      {state === "CONFIRMED" ? (
        <div role="status" className="flex items-start gap-3 text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Terbit</p>
            <p className="text-sm">Laporan versi {saved.version} sudah terbit dan tercatat di registry.</p>
            <a className="text-sm underline" href={`/transparansi/laporan?packageId=${encodeURIComponent(saved.id)}`} target="_blank" rel="noreferrer">
              Lihat ringkasan publik
            </a>
          </div>
        </div>
      ) : state && SENT.includes(state) ? (
        <div role="status" className="flex items-start gap-3 text-stone-800">
          <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Menunggu konfirmasi</p>
            <p className="text-sm">Pengesahan sudah dikirim. Halaman ini memeriksa statusnya sendiri; laporan terbit setelah registry mengonfirmasi.</p>
            {state === "SUBMITTED" && intent?.authorization.signer.toLowerCase() === address?.toLowerCase() && (
              <Button type="button" variant="outline" size="sm" className="mt-2" disabled={working} onClick={() => void task.retry()}>
                Kirim ulang pengesahan yang sama
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {state && FAILED.includes(state) && (
            <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Penerbitan sebelumnya gagal; laporan belum terbit. Sahkan ulang untuk mencoba lagi.</p>
          )}
          {state === "NONCANONICAL" && (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Catatan penerbitan berubah di jaringan. Kirim ulang pengesahan yang sama.</p>
          )}
          <label className="flex gap-2 text-sm text-stone-800">
            <input type="checkbox" checked={endorsed} disabled={working} onChange={(e) => setEndorsed(e.target.checked)} />
            Saya mengesahkan penerbitan laporan ini atas nama lembaga, dengan angka, narasi, dan batas pemeriksaan di atas.
          </label>
          <p className="text-xs text-stone-600">
            Dompet akun pengesah lembaga akan meminta tanda tangan. Layanan pemeriksa otomatis ikut mengesahkan paket yang sama.
          </p>
          <div className="flex flex-wrap gap-2">
            {wrongChain ? (
              <Button type="button" disabled={working} onClick={() => switchChainAsync({ chainId: intent!.domain.chainId })
                .catch(() => setWalletError("Ganti jaringan di dompet ke jaringan yang dipakai lembaga."))}>
                {switching ? "Mengganti jaringan…" : "Ganti ke jaringan lembaga"}
              </Button>
            ) : state === "NONCANONICAL" ? (
              <Button type="button" disabled={working} onClick={() => void task.retry()}>Kirim ulang pengesahan yang sama</Button>
            ) : (
              <Button type="button" disabled={working || !endorsed || !address} onClick={() => void endorseAndPublish()}>
                <ShieldCheck className="mr-2 h-4 w-4" /> {label}
              </Button>
            )}
          </div>
        </>
      )}

      {(error || walletError) && <p role="alert" className="text-sm text-red-700">{walletError ?? error}</p>}

      <details className="text-xs text-stone-600">
        <summary className="cursor-pointer select-none font-semibold uppercase tracking-wide">Detail teknis</summary>
        <dl className="mt-2 space-y-1 break-all">
          <div><dt className="inline font-semibold">Paket </dt><dd className="inline font-mono">{saved.id}</dd></div>
          <div><dt className="inline font-semibold">Digest </dt><dd className="inline font-mono">{saved.digest}</dd></div>
          {intent && <div><dt className="inline font-semibold">Percobaan pengesahan </dt><dd className="inline font-mono">{intent.id} · {state}</dd></div>}
          {intent?.transactionHash && <div><dt className="inline font-semibold">Transaksi </dt><dd className="inline font-mono">{intent.transactionHash}</dd></div>}
          {intent && <div><dt className="inline font-semibold">Pengesah </dt><dd className="inline font-mono">{intent.authorization.signer}</dd></div>}
        </dl>
      </details>
    </section>
  );
}
