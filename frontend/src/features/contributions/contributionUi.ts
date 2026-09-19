import { useRef, useState } from "react";
import type { TabularRow } from "./contributionClient";

/** A cell of an invalid row, looked up under the header spellings the importer accepts. */
export function rawCell(row: TabularRow, ...headers: string[]): string {
  for (const header of headers) {
    if (row.raw?.[header]) return row.raw[header];
  }
  return "-";
}

/** `datetime-local` value for a unix-second timestamp, in the browser's zone. */
export function toLocalInput(seconds: number): string {
  const d = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export const errorMessage = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback;

/**
 * One operationId per intent, kept until it succeeds, so a retry of the same request
 * replays the stored result instead of recording twice. The intent key should include
 * the request content: changed content is a new operation.
 */
export function useOperationIds() {
  const ids = useRef(new Map<string, string>());
  return {
    operationFor(intent: string): string {
      let id = ids.current.get(intent);
      if (!id) {
        id = crypto.randomUUID();
        ids.current.set(intent, id);
      }
      return id;
    },
    settle(intent: string) {
      ids.current.delete(intent);
    },
  };
}

export const at = (seconds: number) => new Date(seconds * 1000).toLocaleString("id-ID");

/** Keep action errors visible inside the active modal as well as the parent panel. */
export function useActionError(onError: (message: string | null) => void) {
  const [error, setError] = useState<string | null>(null);
  return { error, reportError(message: string | null) { setError(message); onError(message); } };
}
