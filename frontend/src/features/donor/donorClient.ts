import { getApiBaseUrl } from "../../lib/contracts";

export interface DonorOtpChallengeResult {
  success: boolean;
  challengeId?: string;
  contactMasked?: string;
  expiresAt?: number;
  error?: string;
}

export interface DonorOtpVerifyResult {
  success: boolean;
  sessionToken?: string;
  expiresAt?: number;
  contributionId?: string;
  remainingAttempts?: number;
  error?: string;
}

export interface DonorContribution {
  id: string;
  institutionId: string;
  sourceChannel: string;
  sourceReference: string;
  currencyUnit: string;
  amountExact: string;
  fundType: string;
  purpose: string;
  receivedAt: number;
  donorName: string | null;
  donorContactMasked: string | null;
  status: string;
  reconciledAt: number | null;
  endorsedAt: number | null;
  zkProof: {
    status: "NOT_AVAILABLE" | "PENDING" | "VERIFIED";
  };
}

export interface DonorActivityAllocation {
  allocationId: string;
  activityId: string;
  amountExact: string;
  currencyUnit: string;
  fundType: string;
  purpose: string;
  reason: string;
  allocatedAt: number;
  activity: {
    id: string;
    name: string;
    description: string | null;
    targetAmount: string;
    targetIsPartial: boolean;
    currencyUnit: string;
    status: string;
    pooled: {
      totalAllocatedAmount: string;
      allocationCount: number;
    };
  };
}

const SESSION_STORAGE_KEY_PREFIX = "zkt_donor_session_";

export function getStoredDonorSession(contributionId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(`${SESSION_STORAGE_KEY_PREFIX}${contributionId}`);
  } catch {
    return null;
  }
}

export function saveDonorSession(contributionId: string, token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(`${SESSION_STORAGE_KEY_PREFIX}${contributionId}`, token);
  } catch {
    // Ignore storage errors
  }
}

export function clearStoredDonorSession(contributionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(`${SESSION_STORAGE_KEY_PREFIX}${contributionId}`);
  } catch {
    // Ignore storage errors
  }
}

export async function requestDonorOtp(contributionId: string): Promise<DonorOtpChallengeResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/donor/otp-challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contributionId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Gagal mengirim OTP (${res.status}).` };
    }
    return {
      success: true,
      challengeId: data.challengeId,
      contactMasked: data.contactMasked,
      expiresAt: data.expiresAt,
    };
  } catch {
    return { success: false, error: "Jaringan tidak terhubung. Periksa koneksi Anda." };
  }
}

export async function verifyDonorOtp(
  challengeId: string,
  otpCode: string
): Promise<DonorOtpVerifyResult> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/donor/otp-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challengeId, otpCode }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        success: false,
        error: data.error || "Verifikasi OTP gagal.",
        remainingAttempts: data.remainingAttempts,
      };
    }
    return {
      success: true,
      sessionToken: data.sessionToken,
      expiresAt: data.expiresAt,
      contributionId: data.contributionId,
    };
  } catch {
    return { success: false, error: "Jaringan tidak terhubung saat memverifikasi OTP." };
  }
}

export async function fetchDonorContribution(
  contributionId: string,
  sessionToken: string
): Promise<{ success: boolean; contribution?: DonorContribution; error?: string }> {
  try {
    const res = await fetch(
      `${getApiBaseUrl()}/api/donor/contributions/${encodeURIComponent(contributionId)}`,
      {
        headers: { Authorization: `Bearer ${sessionToken}` },
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Akses ditolak (${res.status}).` };
    }
    return { success: true, contribution: data.contribution };
  } catch {
    return { success: false, error: "Gagal mengambil data kontribusi donatur." };
  }
}

export async function fetchDonorAllocations(
  contributionId: string,
  sessionToken: string
): Promise<{ success: boolean; allocations?: DonorActivityAllocation[]; error?: string }> {
  try {
    const res = await fetch(
      `${getApiBaseUrl()}/api/donor/contributions/${encodeURIComponent(contributionId)}/allocations`,
      {
        headers: { Authorization: `Bearer ${sessionToken}` },
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `Akses ditolak (${res.status}).` };
    }
    return { success: true, allocations: data.allocations || [] };
  } catch {
    return { success: false, error: "Gagal mengambil alokasi kegiatan kontribusi." };
  }
}

export async function logoutDonor(sessionToken: string, contributionId?: string): Promise<void> {
  if (contributionId) {
    clearStoredDonorSession(contributionId);
  }
  try {
    await fetch(`${getApiBaseUrl()}/api/donor/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
  } catch {
    // Ignore network error on logout
  }
}
