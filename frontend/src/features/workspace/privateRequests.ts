export type SessionEnd = "EXPIRED" | "REVOKED" | "UNKNOWN";
export class WorkspaceRequestError extends Error {
  constructor(message: string, readonly reason: string | null, readonly status: number,
    readonly sessionEnd: SessionEnd | null = null, readonly issues: unknown[] = []) { super(message); }
}
export class AccessContextChanged extends Error {
  constructor() { super("Konteks akses sudah berubah. Muat ulang ruang kerja."); }
}
export type PrivateRequests = {
  readonly contextId: string;
  assertCurrent(): void;
  json<T = any>(path: string, init?: RequestInit): Promise<T>;
  blob(path: string, init?: RequestInit): Promise<Blob>;
};

export function responseError(status: number, payload: any) {
  return new WorkspaceRequestError(typeof payload?.error === "string" ? payload.error : `Permintaan gagal (HTTP ${status}).`,
    typeof payload?.reason === "string" ? payload.reason : null, status,
    ["EXPIRED", "REVOKED", "UNKNOWN"].includes(payload?.sessionEnd) ? payload.sessionEnd : null,
    Array.isArray(payload?.issues) ? payload.issues : []);
}

/** Created by the access owner; the credential never becomes a component prop. */
export function createPrivateRequests(options: {
  origin: string; token: string; contextId: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  assertCurrent: () => void; denied: (error: WorkspaceRequestError) => void;
}): PrivateRequests {
  async function request(path: string, init: RequestInit | undefined, bytes: boolean) {
    options.assertCurrent();
    if (!path.startsWith("/api/") || new URL(`${options.origin}${path}`).origin !== new URL(options.origin).origin) {
      throw new Error("Permintaan privat harus menuju API ruang kerja ini.");
    }
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${options.token}`);
    if (init?.body !== undefined) headers.set("Content-Type", "application/json");
    const response = await options.fetch(`${options.origin}${path}`, { ...init, headers, cache: "no-store" });
    options.assertCurrent();
    if (bytes && response.ok) {
      const blob = await response.blob();
      options.assertCurrent();
      return blob;
    }
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    options.assertCurrent();
    if (!response.ok || payload?.success === false) {
      const error = responseError(response.status, payload);
      options.denied(error);
      throw error;
    }
    if (payload === null && response.status !== 204) throw responseError(response.status, null);
    return payload;
  }
  return { contextId: options.contextId, assertCurrent: options.assertCurrent,
    json: <T>(path: string, init?: RequestInit) => request(path, init, false) as Promise<T>,
    blob: (path, init) => request(path, init, true) as Promise<Blob> };
}
