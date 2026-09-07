import { useEffect, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { getApiBaseUrl, ZAKAT_PROTOCOL_L1_ADDRESS } from "../lib/contracts";

export function DeploymentGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "pending" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    fetch(`${getApiBaseUrl()}/health`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Backend unavailable");
        const body = await response.json();
        setState(body.deploymentPending || body.contractAddress?.toLowerCase() !== ZAKAT_PROTOCOL_L1_ADDRESS.toLowerCase() ? "pending" : "ready");
      }).catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [retry]);
  if (state === "ready") return children;
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-20" role="status">
      <h1 className="text-2xl font-semibold">{state === "loading" ? "Memeriksa koneksi" : state === "pending" ? "Menunggu Deployment Baru" : "Backend Belum Tersedia"}</h1>
      <p className="mt-3 text-sm">{state === "pending" ? "Testing manual dinonaktifkan sementara. Konfigurasi kontrak baru belum aktif." : state === "error" ? "Koneksi ke layanan belum berhasil." : "Status lingkungan sedang diperiksa."}</p>
      <button type="button" title="Periksa kembali" disabled={state === "loading"} onClick={() => setRetry(value => value + 1)} className="mt-5 inline-flex items-center gap-2 border rounded px-3 py-2 text-sm disabled:opacity-50">
        <RefreshCw className="h-4 w-4" /> Periksa Kembali
      </button>
    </main>
  );
}
