/**
 * The browser's half of a workspace session (Spec #68, ticket #69).
 *
 * Pure on purpose: no `fetch`, no React, no wallet. What it decides is where a
 * session is kept, whether the one on hand is still worth sending, and how the
 * server's refusal is put to the person who hit it.
 *
 * The token lives in `sessionStorage`, never `localStorage`: it should die with
 * the tab rather than outlive the person who opened it. It is keyed by API
 * origin and account, so switching wallets or pointing at a different API can
 * never surface somebody else's session.
 *
 * None of this is the access control. Every gate is the API's - hiding a button
 * here changes nothing about what a request is allowed to do (see
 * `backend/src/routes/workspace.ts`). What the capabilities do here is stop the
 * interface offering an action it already knows the server will refuse.
 */

export type WorkspaceRole = "ADMIN" | "OFFICER" | "READER";

export type StoredSession = {
  token: string;
  institutionId: string;
  role: WorkspaceRole;
  /** Unix seconds. */
  expiresAt: number;
};

export const sessionStorageKey = (apiBaseUrl: string, account: string): string =>
  `tawf-workspace:${apiBaseUrl}:${account.toLowerCase()}`;

export function isSessionUsable(session: StoredSession | null, nowSeconds: number): boolean {
  if (!session || typeof session.token !== "string" || session.token === "") return false;
  return Number.isFinite(session.expiresAt) && nowSeconds <= session.expiresAt;
}

/**
 * The server's refusal vocabulary, in the words an Amil should read.
 *
 * Deliberately says nothing the caller had no right to learn: an account that
 * belongs to another institution is told it is not a member of *this* one, and
 * never which one it does belong to.
 */
const REFUSALS: Record<string, string> = {
  "no-membership": "Akun wallet ini belum terdaftar pada ruang kerja lembaga.",
  "membership-inactive": "Keanggotaan akun ini sudah dinonaktifkan oleh administrator lembaga.",
  "cross-institution": "Permintaan menyebut lembaga lain daripada lembaga sesi Anda.",
  expired: "Tantangan masuk sudah kedaluwarsa. Ulangi proses masuk untuk mendapat tantangan baru.",
  replayed: "Tantangan itu sudah pernah dipakai. Ulangi proses masuk.",
  "not-yet-valid": "Tantangan belum berlaku. Periksa jam pada perangkat Anda.",
  "unknown-challenge": "Tantangan tidak dikenal server. Ulangi proses masuk.",
  "signature-rejected": "Tanda tangan tidak sah untuk akun tersebut.",
  "malformed-signature": "Tanda tangan tidak terbaca. Ulangi penandatanganan di wallet.",
  forbidden: "Peran Anda pada lembaga ini tidak berwenang melakukan tindakan tersebut.",
  unauthenticated: "Sesi ruang kerja sudah berakhir. Silakan masuk kembali.",
};

export const describeRefusal = (reason: string): string =>
  REFUSALS[reason] ?? "Permintaan ditolak server. Coba masuk kembali.";

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
