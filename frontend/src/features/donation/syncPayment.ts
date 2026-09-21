/**
 * Ask the backend to check a Midtrans payment until it is settled.
 *
 * The webhook is the fast path, but it cannot reach a local or misconfigured
 * backend, and the public lookup never calls Midtrans by design. The sync route
 * is the one that does, so the payer's own page keeps asking it.
 */
export type PaymentSync = "PAID" | "TIMEOUT" | "ABORTED";

export type PaymentSyncOptions = {
  baseUrl: string;
  fetchImpl?: (url: string) => Promise<Response>;
  intervalMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
};

const SETTLED = new Set(["PAID", "BATCHED"]);

export async function syncPaymentUntilPaid(trxId: string, options: PaymentSyncOptions): Promise<PaymentSync> {
  const { baseUrl, fetchImpl = (url: string) => fetch(url), intervalMs = 5000, maxAttempts = 60, signal,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options;
  const url = `${baseUrl}/api/donations/status/${encodeURIComponent(trxId)}`;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) return "ABORTED";
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as { contribution?: { status?: string } } | null;
        if (body?.contribution?.status && SETTLED.has(body.contribution.status)) return "PAID";
      }
    } catch { /* offline or a failed request: try again */ }
    if (signal?.aborted) return "ABORTED";
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }
  return "TIMEOUT";
}
