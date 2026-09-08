import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { getApiBaseUrl } from "../../lib/contracts";

import type { FileAvailability, RecoveryFileStatus, RecoveryStatus } from "../../../../shared/registry-recovery";
import type { RecordingObservation } from "../../../../shared/report-registry";
const fileLabels: Record<FileAvailability, string> = { AVAILABLE: "Tersedia dan hash cocok", MISSING: "Berkas hilang", CORRUPT: "Berkas rusak atau tidak cocok", UNAVAILABLE: "Berkas belum tersedia" };
const transactionLabels: Record<RecordingObservation["state"], string> = { PREPARED: "Belum dikirim", SUBMITTED: "Diajukan; belum terbukti masuk blok", INCLUDED: "Masuk blok; menunggu konfirmasi", CONFIRMED: "Tingkat konfirmasi tercapai", NONCANONICAL: "Blok berubah; perlu pemeriksaan ulang", REVERTED: "Transaksi gagal", INVALID_EVENT: "Event tidak cocok" };

/** Backup bytes must match the committed source; the server decides, never this form. */
export function RecoveryPanel({ token, preparationId, canRecover }: { token: string; preparationId: string; canRecover: boolean }) {
  const [recovery, setRecovery] = useState<RecoveryStatus | null>(null);
  const [files, setFiles] = useState<RecoveryFileStatus[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [chainError, setChainError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function request(path: string, body?: unknown) {
    const response = await fetch(`${getApiBaseUrl()}/api/workspace/recovery${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Pemeriksaan belum selesai.");
    return result;
  }
  async function inspect() {
    setBusy(true); setError(null); setChainError(null); setRecovery(null); setFiles(null);
    try {
      // Files can be checked even when the chain cannot be reached.
      setFiles((await request(`/files?preparationId=${encodeURIComponent(preparationId)}`)).files);
      try { setRecovery((await request("", canRecover ? {} : undefined)).recovery); }
      catch (error) { setChainError(error instanceof Error ? error.message : "Status chain belum dapat diperiksa."); }
    } catch (error) { setError(error instanceof Error ? error.message : "Status belum dapat dipastikan."); }
    finally { setBusy(false); }
  }
  async function restore(id: string, file: File) {
    setBusy(true); setError(null);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("Backup paling besar 10 MiB.");
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]!);
        reader.onerror = () => reject(new Error("Backup tidak dapat dibaca.")); reader.readAsDataURL(file);
      });
      const result = await request("/files", { preparationId, fileId: id, contentBase64 });
      setFiles(current => current?.map(item => item.id === id ? result.file : item) ?? null);
    } catch (error) { setError(error instanceof Error ? error.message : "Pemulihan belum berhasil."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border p-4">
    <h4 className="font-semibold">Pemeriksaan dan pemulihan bukti</h4>
    <p className="text-sm">Periksa status terbaru dan ketersediaan berkas. Backup harus berisi sumber yang sama dengan bukti tersimpan.</p>
    <Button variant="outline" disabled={busy} onClick={() => void inspect()}>{busy ? "Memeriksa atau memulihkan…" : "Periksa pemulihan dan berkas"}</Button>
    <p className="text-xs">Konfirmasi blok bukan finalitas settlement L1.</p>
    {!recovery && <p role="status">Status chain belum dapat dipastikan.</p>}
    {chainError && <p role="alert">{chainError}</p>}
    {recovery && <>
      <p role="status">{recovery.state === "CURRENT" ? "Status sesuai blok saat pemeriksaan." : recovery.state === "CATCHING_UP" ? "Pemeriksaan tersimpan; blok baru menunggu putaran berikutnya." : "Perlu pemeriksaan ulang; status terakhir belum memastikan keadaan terbaru."}</p>
      <p className="text-xs">Diperiksa {recovery.checkpoint ? new Date(recovery.checkpoint.checkedAt).toLocaleString("id-ID") : "belum pernah"}. Kebijakan {recovery.confirmationPolicy}: {recovery.requiredConfirmations} konfirmasi blok, bukan finalitas settlement L1.</p>
      <details><summary>Riwayat pemeriksaan transaksi lembaga</summary>
        <p className="text-xs">Catatan lama dipertahankan sebagai riwayat. Status tindakan terbaru tersedia pada panel pencatatan, penerbitan, atau atestasi.</p>
        {recovery.observations.map((item, index) => <p key={index} className="break-all text-xs">{item.intentId}: {transactionLabels[item.observation.state] ?? "Perlu pemeriksaan ulang"} · {item.transactionHash}</p>)}
      </details>
    </>}
    {files?.map(file => <div key={file.id} className="space-y-1 border-t pt-2 text-sm">
      <p>{fileLabels[file.availability] ?? "Belum diperiksa"} · {file.id}</p>
      {canRecover && file.availability !== "AVAILABLE" && file.contentSha256 && <label className="block">Pulihkan backup berkas {file.id}
        <input type="file" disabled={busy} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void restore(file.id, selected); }} />
      </label>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
