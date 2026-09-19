import { getApiBaseUrl } from "../../lib/contracts";
import type {
  ContributionStatus,
  CurrencyUnit,
  JenisDana,
  SourceChannel,
} from "../contributions/contributionClient";

/**
 * Accountless donor access client (Ticket #104, Spec #100).
 *
 * The types mirror `backend/src/donor-access.ts`. A donor starts from the
 * reference on their receipt; the contribution ID is only learned once a code
 * has been verified, and the session token travels only in the Authorization
 * header, never in a URL.
 */

export type DonorSessionRecord = {
  token: string;
  contributionId: string;
  /** Unix seconds. */
  expiresAt: number;
};

export type DonorOtpChallenge = {
  challengeId: string;
  expiresAt: number;
  resendAvailableAt: number;
};

export type DonorContribution = {
  id: string;
  institutionId: string;
  sourceChannel: SourceChannel;
  sourceReference: string;
  currencyUnit: CurrencyUnit;
  amountExact: string;
  fundType: JenisDana;
  purpose: string;
  receivedAt: number;
  donorName: string | null;
  donorContactMasked: string | null;
  status: ContributionStatus;
  reconciledAt: number | null;
  endorsedAt: number | null;
  /** No ZK pipeline exists yet (#108). */
  zkProof: { status: "NOT_AVAILABLE" };
};

export type DonorActivityAllocation = {
  allocationId: string;
  activityId: string;
  amountExact: string;
  currencyUnit: CurrencyUnit;
  fundType: JenisDana;
  purpose: string;
  reason: string;
  allocatedAt: number;
  activity: {
    id: string;
    name: string;
    description: string | null;
    targetAmount: string;
    targetIsPartial: boolean;
    currencyUnit: CurrencyUnit;
    status: "ACTIVE";
    pooled: { totalAllocatedAmount: string; allocationCount: number };
  };
};

/** The server no longer honours this session: expired, revoked or never valid. */
export class DonorSessionEndedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DonorSessionEndedError";
  }
}

export type DonorResult<T> = ({ ok: true } & T) | { ok: false; error: string; retryAt?: number; remainingAttempts?: number };

const NETWORK_ERROR = "Jaringan tidak terhubung. Periksa koneksi Anda.";
const STORAGE_KEY_PREFIX = "zkt_donor_session_";

export const nowInSeconds = () => Math.floor(Date.now() / 1000);

/** The stored session for this reference, or null once it has expired. */
export function readDonorSession(reference: string, now = nowInSeconds()): DonorSessionRecord | null {
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${reference}`);
    if (!raw) return null;
    const record = JSON.parse(raw) as DonorSessionRecord;
    if (typeof record?.token !== "string" || typeof record.expiresAt !== "number" || record.expiresAt <= now) {
      clearDonorSession(reference);
      return null;
    }
    return record;
  } catch {
    return null;
  }
}

export function saveDonorSession(reference: string, record: DonorSessionRecord): void {
  try {
    window.sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${reference}`, JSON.stringify(record));
  } catch {
    // Without storage the session lasts as long as the page.
  }
}

export function clearDonorSession(reference: string): void {
  try {
    window.sessionStorage.removeItem(`${STORAGE_KEY_PREFIX}${reference}`);
  } catch {
    // Nothing was stored.
  }
}

async function send<T>(path: string, init: RequestInit): Promise<DonorResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/donor${path}`, init);
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      error: data.error || `Permintaan gagal (${res.status}).`,
      retryAt: data.retryAt,
      remainingAttempts: data.remainingAttempts,
    };
  }
  return { ok: true, ...data };
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** Whether this deployment can deliver a code at all. */
export async function fetchDonorChannel(): Promise<boolean> {
  const result = await send<{ available: boolean }>("/channel", {});
  if (!result.ok) throw new Error(result.error);
  return result.available;
}

export const requestDonorOtp = (reference: string) =>
  send<DonorOtpChallenge>("/otp-challenge", postJson({ reference }));

export const verifyDonorOtp = (challengeId: string, otpCode: string) =>
  send<{ sessionToken: string; expiresAt: number; contributionId: string }>(
    "/session",
    postJson({ challengeId, otpCode })
  );

async function readPrivate<T>(path: string, token: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/donor${path}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    throw new DonorSessionEndedError(data.error || "Sesi donatur tidak berlaku lagi.");
  }
  if (!res.ok) throw new Error(data.error || `Permintaan gagal (${res.status}).`);
  return data as T;
}

export const fetchDonorContribution = async (session: DonorSessionRecord) =>
  (await readPrivate<{ contribution: DonorContribution }>(
    `/contributions/${encodeURIComponent(session.contributionId)}`,
    session.token
  )).contribution;

export const fetchDonorAllocations = async (session: DonorSessionRecord) =>
  (await readPrivate<{ allocations: DonorActivityAllocation[] }>(
    `/contributions/${encodeURIComponent(session.contributionId)}/allocations`,
    session.token
  )).allocations;

/** Revokes the session on the server; the caller forgets it locally regardless. */
export async function endDonorSession(token: string): Promise<void> {
  await send("/session", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
}
