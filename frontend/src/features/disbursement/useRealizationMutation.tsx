import type { PrivateRequests } from "../workspace/privateRequests";
import { Button } from "../../components/ui/Button";
import { useInvalidateRealizations } from "./useRealizationQueries";
import { useRetryableOperation } from "./useRetryableOperation";

/** Keeps the exact payload and identity until a durable result or definitive refusal arrives. */
export function useRealizationMutation<T extends { operationId: string }, R>(
  requests: PrivateRequests, send: (payload: T) => Promise<R>, onSaved: (payload: T, result: R) => void
) {
  const invalidate = useInvalidateRealizations(requests);
  const operation = useRetryableOperation(async (payload: T) => ({ payload, result: await send(payload) }),
    "Hasil penyimpanan belum diketahui. Kirim ulang penyimpanan yang sama untuk memeriksa hasil tanpa mencatat ganda.");
  async function submit(build: (id: string) => T) {
    const saved = await operation.run(build);
    if (saved) onSaved(saved.payload, saved.result);
    invalidate();
  }
  return { ...operation, submit, retry: () => submit(() => { throw new Error("Tidak ada penyimpanan tertunda."); }) };
}

export function MutationFeedback({ operation }: { operation: {
  state: string; error: string | null; retry: () => Promise<void>;
} }) {
  return <div className="space-y-2 text-xs">
    <p role="status">{operation.state === "UNKNOWN" ? "Hasil penyimpanan belum diketahui"
      : operation.state === "SAVING" ? "Menyimpan…" : operation.state === "SAVED" ? "Tersimpan" : "Belum tersimpan"}</p>
    {operation.error && <p role="alert" className="rounded-md bg-red-50 p-2 text-red-700">{operation.error}</p>}
    {operation.state === "UNKNOWN" && <Button type="button" size="sm" onClick={() => void operation.retry()}>Kirim ulang penyimpanan</Button>}
  </div>;
}
