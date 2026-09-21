import { useQuery } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { getPublicReceiptVerification, type DonorContribution, type DonorZkProofStatus } from "./donorClient";
import { ReceiptProofReference } from "./ReceiptProofReference";

const STATUS_LABELS: Record<DonorZkProofStatus, string> = {
  VERIFIED: "Keaslian catatan terkonfirmasi",
  UNCONFIRMED: "Keaslian belum dapat dikonfirmasi saat ini",
  NOT_AVAILABLE: "Bukti keaslian belum tersedia",
  PENDING: "Menunggu pemeriksaan keaslian",
  PROVING: "Pemeriksaan keaslian sedang diproses",
  FAILED: "Pemeriksaan keaslian gagal",
  SUPERSEDED: "Bukti versi lama",
  PENDING_REPROOF: "Menunggu pemeriksaan ulang karena catatan dikoreksi",
};

export function DonorReceiptProof({ contribution }: { contribution: DonorContribution }) {
  const check = useQuery({
    queryKey: ["donor-receipt-proof", contribution.id, contribution.version],
    queryFn: () => getPublicReceiptVerification(contribution.id),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  // SQL describes history. Only a successful current check can confirm validity.
  const result = !check.isFetching && !check.isError ? check.data : null;
  const historical = contribution.zkProof;
  let status: DonorZkProofStatus = result?.status ?? historical.status;
  if (status === "VERIFIED" && (!result?.onChainConfirmed || result.version !== contribution.version)) {
    status = "UNCONFIRMED";
  }
  const unavailable = !check.isFetching && (check.isError || check.data === null);
  const proof = result ?? historical;
  const txHash = proof.txHash ?? historical.txHash;

  return <section aria-label="Bukti kontribusi Anda" className="space-y-3 text-sm">
    <p aria-live="polite" className={`inline-block rounded-full border px-3 py-1.5 font-semibold ${
      status === "VERIFIED" ? "border-emerald-200 bg-emerald-50 text-emerald-800" :
      "border-amber-200 bg-amber-50 text-amber-800"
    }`}>
      {check.isFetching ? "Memeriksa bukti…" : STATUS_LABELS[status]}
    </p>
    <p className="text-xs text-tawf-muted">Yang dibuktikan: catatan kontribusi Anda masuk daftar yang sudah disahkan lembaga dan tidak diubah diam-diam. Ini bukan bukti uang sudah masuk bank atau bantuan sudah diserahkan.</p>
    {unavailable && <p role="alert" className="text-amber-800">Pemeriksaan belum tersedia. Coba lagi nanti.</p>}
    {status === "UNCONFIRMED" && !check.isFetching && <p className="text-xs text-tawf-muted">
      Hasil historis tetap tersimpan; keberlakuan bukti saat ini belum dapat dikonfirmasi.
    </p>}
    <button type="button" disabled={check.isFetching} onClick={() => void check.refetch()}
      className="inline-flex items-center gap-2 rounded-xl border border-tawf-green-10 px-3 py-2 text-tawf-green disabled:opacity-50">
      <RefreshCw aria-hidden className={`h-3 w-3 ${check.isFetching ? "animate-spin" : ""}`} />
      {check.isFetching ? "Memeriksa…" : "Periksa ulang bukti"}
    </button>
    <p className="text-xs text-tawf-muted">Pemeriksaan boleh diulang kapan saja, gratis, dan tanpa dompet digital.</p>
    <details className="group rounded-2xl border border-tawf-green-10 bg-[#f4f8f3]/60">
      <summary className="flex cursor-pointer items-center justify-between p-4 text-xs font-semibold text-tawf-green">
        Rincian teknis pembuktian
        <ChevronDown aria-hidden className="h-4 w-4 group-open:rotate-180" />
      </summary>
      <div className="space-y-3 px-4 pb-4 text-xs text-tawf-muted">
        <p>Bukti keanggotaan Groth16 (BN254), diperiksa oleh Solidity verifier pada EVM. Referensi berikut merupakan catatan historis, terpisah dari konfirmasi saat ini.</p>
        <dl className="space-y-2 break-all">
          {proof.batchRoot && <ReceiptProofReference label="Merkle Batch Root (Poseidon)" value={proof.batchRoot} />}
          {proof.receiptCommitment && <ReceiptProofReference label="Komitmen receipt" value={proof.receiptCommitment} />}
          {txHash && <ReceiptProofReference label="Transaksi hasil verifikasi" value={txHash} />}
          {proof.batchNumber != null && <div><dt>Nomor batch</dt><dd>{proof.batchNumber}</dd></div>}
          {proof.version != null && <div><dt>Versi receipt</dt><dd>{proof.version}</dd></div>}
          {proof.blockNumber != null && <div><dt>Blok EVM</dt><dd>{proof.blockNumber}</dd></div>}
          {proof.verifiedAt != null && <div><dt>Waktu verifikasi historis</dt><dd>{new Date(proof.verifiedAt * 1000).toLocaleString("id-ID")}</dd></div>}
        </dl>
      </div>
    </details>
  </section>;
}
