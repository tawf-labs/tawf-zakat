import { useState } from "react";

export function ReceiptProofReference({ label, value }: { label: string; value: string }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  return <div>
    <dt>{label}</dt>
    <dd className="space-y-1">
      <code className="select-all">{value}</code>
      <button type="button" onClick={() => void copy()} aria-label={`Salin ${label}`}
        className="ml-2 rounded border border-tawf-green-10 px-2 py-1 text-tawf-green">
        {copyStatus === "copied" ? "Tersalin" : "Salin"}
      </button>
      {copyStatus === "failed" && <p role="status">Tidak dapat menyalin. Pilih teks untuk menyalin secara manual.</p>}
    </dd>
  </div>;
}
