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
  return <section aria-label="Bukti keaslian catatan" className="rounded-3xl border border-[#dbe7dd] bg-white p-6 space-y-3 text-sm text-[#17332c]">
    <h3 className="font-semibold">Bukti keaslian catatan</h3>
    <p>Memeriksa apakah catatan ini benar-benar masuk daftar penerimaan yang sudah disahkan lembaga dan tidak diubah sesudahnya. Ini bukan bukti bahwa uang sudah masuk ke bank atau bantuan sudah diserahkan.</p>
    {result && <div aria-live="polite" className="space-y-2 break-all">
      <p className="font-semibold">{check.isFetching ? "Sedang memeriksa catatan publik…" :
        result.status === "VERIFIED" && result.onChainConfirmed ? "Keaslian catatan terkonfirmasi di catatan publik" :
        result.status === "PENDING_REPROOF" ? "Bukti lama masih sah — menunggu pemeriksaan baru karena catatan dikoreksi" :
        result.status === "SUPERSEDED" ? "Bukti lama — catatan ini sudah diubah atau digantikan" :
        result.status === "UNCONFIRMED" ? "Hasil di catatan publik belum dapat dikonfirmasi saat ini" :
        result.status === "NOT_AVAILABLE" ? "Bukti keaslian belum tersedia" : `Status bukti: ${result.status}`}</p>

      {result.mathematicalValidity && (
        <div className="rounded-lg bg-stone-50 border p-3 space-y-1">
          <p><strong>Keaslian bukti:</strong> {result.mathematicalValidity === "VALID" ? "Sah pada daftar terbaru" : result.mathematicalValidity === "VALID_HISTORICAL" ? "Sah pada daftar sebelumnya" : "Belum Terverifikasi"}</p>
          <p><strong>Masih berlaku:</strong> {result.businessValidity === "CURRENT" ? "Ya, masih berlaku" : result.businessValidity === "PENDING_REPROOF" ? "Menunggu pemeriksaan baru (catatan telah dikoreksi)" : result.businessValidity === "SUPERSEDED" ? "Sudah digantikan versi baru" : "Menunggu Konfirmasi"}</p>
          {result.explanation && <p className="text-xs text-stone-600 mt-1">{result.explanation}</p>}
        </div>
      )}

      <p>Disahkan oleh lembaga{result.institutionId ? ` ${result.institutionId}` : ""}.</p>
      {result.endorsedBy && <p>Akun petugas pengesahan: <code>{result.endorsedBy}</code></p>}
      {result.txHash && <p>Nomor transaksi pemeriksaan: <code>{result.txHash}</code></p>}
      {result.chainBusinessValidity === "UNKNOWN" && <p className="text-xs">Hasil pemeriksaan tersimpan di catatan publik; apakah masih berlaku juga dicek ke catatan lembaga.</p>}
      {result.registryAddress && <p>Alamat catatan publik: <code>{result.registryAddress}</code></p>}
      {result.version != null && <p>Versi kuitansi: {result.version}</p>}

      {result.history && result.history.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold">Riwayat Verifikasi ({result.history.length} catatan)</summary>
          <ul className="mt-1 space-y-1 border-t pt-1">
            {result.history.map((h, i) => (
              <li key={i} className="text-stone-600">
                Kelompok #{h.batchId} (v{h.batchVersion}) — Status: {h.status} {h.txHash ? `— Transaksi: ${h.txHash.slice(0, 10)}...` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>}
    {check.isFetched && !result && <p role="alert">Pemeriksaan belum tersedia. Gunakan ID kontribusi pada kuitansi; nomor referensi bank tidak dipakai untuk pemeriksaan publik.</p>}
    <button type="button" disabled={check.isFetching} onClick={() => void check.refetch()} className="rounded-xl border border-[#dbe7dd] px-4 py-2 disabled:opacity-50">
      {check.isFetching ? "Memeriksa…" : "Periksa keaslian catatan"}
    </button>
    <p className="text-xs">Pemeriksaan boleh diulang kapan saja, gratis, dan tanpa dompet digital.</p>
  </section>;
}
