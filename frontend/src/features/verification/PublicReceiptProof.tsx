import { useQuery } from "@tanstack/react-query";
import { getPublicReceiptVerification } from "../donor/donorClient";

/** Public verification never loads donor details or requests a wallet signature. */
export function PublicReceiptProof({ reference }: { reference: string }) {
  const check = useQuery({
    queryKey: ["receipt-proof", reference],
    queryFn: () => getPublicReceiptVerification(reference),
    enabled: false,
    retry: false,
  });
  const result = check.data;
  return <section aria-label="Bukti keanggotaan kontribusi" className="rounded-3xl border border-[#dbe7dd] bg-white p-6 space-y-3 text-sm text-[#17332c]">
    <h3 className="font-semibold">Bukti keanggotaan kontribusi</h3>
    <p>Memeriksa apakah catatan ini termasuk batch yang disahkan lembaga. Bukti ini tidak menyatakan pembayaran bank atau penyerahan bantuan telah terjadi.</p>
    {result && <div aria-live="polite" className="space-y-2 break-all">
      <p className="font-semibold">{check.isFetching ? "Sedang memeriksa hasil EVM…" :
        result.status === "VERIFIED" && result.onChainConfirmed ? "Bukti ZK terkonfirmasi di EVM" :
        result.status === "PENDING_REPROOF" ? "Bukti historis valid — menunggu reproof pada batch baru" :
        result.status === "SUPERSEDED" ? "Bukti historis — kontribusi telah berubah/digantikan" :
        result.status === "UNCONFIRMED" ? "Hasil EVM belum dapat dikonfirmasi saat ini" :
        result.status === "NOT_AVAILABLE" ? "Bukti ZK belum tersedia" : `Status bukti: ${result.status}`}</p>

      {result.mathematicalValidity && (
        <div className="rounded-lg bg-stone-50 border p-3 space-y-1">
          <p><strong>Validitas Matematis:</strong> {result.mathematicalValidity === "VALID" ? "Sah pada root terakhir tercatat" : result.mathematicalValidity === "VALID_HISTORICAL" ? "Sah pada Root Historis" : "Belum Terverifikasi"}</p>
          <p><strong>Validitas Bisnis:</strong> {result.businessValidity === "CURRENT" ? "Berlaku Penuh (Aktif)" : result.businessValidity === "PENDING_REPROOF" ? "Menunggu Reproof (Batch Telah Dikoreksi)" : result.businessValidity === "SUPERSEDED" ? "Digantikan (Superseded)" : "Menunggu Konfirmasi"}</p>
          {result.explanation && <p className="text-xs text-stone-600 mt-1">{result.explanation}</p>}
        </div>
      )}

      <p>Sumber pengesahan: batch lembaga{result.institutionId ? ` ${result.institutionId}` : ""}.</p>
      {result.endorsedBy && <p>Akun petugas pengesahan: <code>{result.endorsedBy}</code></p>}
      {result.txHash && <p>Transaksi hasil verifikasi: <code>{result.txHash}</code></p>}
      {result.chainBusinessValidity === "UNKNOWN" && <p className="text-xs">Chain menyimpan hasil verifikasi; keberlakuan saat ini juga diperiksa terhadap sumber lembaga.</p>}
      {result.registryAddress && <p>Registry EVM: <code>{result.registryAddress}</code></p>}
      {result.version != null && <p>Versi receipt: {result.version}</p>}

      {result.history && result.history.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold">Riwayat Verifikasi ({result.history.length} catatan)</summary>
          <ul className="mt-1 space-y-1 border-t pt-1">
            {result.history.map((h, i) => (
              <li key={i} className="text-stone-600">
                Batch #{h.batchId} (v{h.batchVersion}) — Status: {h.status} {h.txHash ? `— Tx: ${h.txHash.slice(0, 10)}...` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>}
    {check.isFetched && !result && <p role="alert">Pemeriksaan belum tersedia. Gunakan ID kontribusi pada kuitansi; referensi bank tidak digunakan sebagai referensi proof publik.</p>}
    <button type="button" disabled={check.isFetching} onClick={() => void check.refetch()} className="rounded-xl border border-[#dbe7dd] px-4 py-2 disabled:opacity-50">
      {check.isFetching ? "Memeriksa…" : "Periksa bukti ZK"}
    </button>
    <p className="text-xs">Pemeriksaan dapat diulang tanpa transaksi dan tanpa wallet.</p>
  </section>;
}
