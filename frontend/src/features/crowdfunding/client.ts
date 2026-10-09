import { getApiBaseUrl } from "../../lib/contracts";

export type User = {
  id: string;
  name: string;
  email: string;
  kind: "INDIVIDUAL" | "ORGANIZATION";
  organizationName?: string;
  role: "FUNDRAISER" | "OPERATOR";
};
export type Campaign = {
  id: string;
  title: string;
  summary: string;
  story: string;
  category: string;
  targetAmount: number;
  endsAt: string;
  coverImageUrl?: string;
  status: string;
  version: number;
  organizer: { name: string; kind: string; organizationName?: string };
  collectedAmount: number;
  donationCount: number;
  createdAt: string;
  updatedAt: string;
  chainStatus: string;
  chainTxHash?: string;
  history?: unknown[];
  updates?: unknown[];
  beneficiaryName?: string;
  relationship?: string;
  budgetPlan?: string;
  distributionPlan?: string;
  consent?: boolean;
  documents?: { id: string; name: string }[];
  reviewNotes?: unknown;
};
export type Payment = {
  id: string;
  token?: string;
  redirectUrl?: string;
  status: string;
  amount: number;
  accessToken?: string;
};
const TOKEN_KEY = "zkt.crowdfunding.session";
export const sessionToken = () =>
  typeof window === "undefined" ? null : sessionStorage.getItem(TOKEN_KEY);
export const saveSession = (token: string | null) =>
  token
    ? sessionStorage.setItem(TOKEN_KEY, token)
    : sessionStorage.removeItem(TOKEN_KEY);
export function apiUrl(path: string) {
  return `${getApiBaseUrl()}/api/crowdfunding${path}`;
}
export class CrowdfundingApiError extends Error {
  constructor(
    message: string,
    public payment?: Payment,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    paymentToken?: string;
    public?: boolean;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const token = options.public ? null : sessionToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.paymentToken) headers["X-Payment-Token"] = options.paymentToken;
  const response = await fetch(apiUrl(path), {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Layanan belum memberikan respons yang valid. Silakan coba lagi.",
    );
  }
  if (!response.ok || data.success === false)
    throw new CrowdfundingApiError(
      typeof data.error === "string"
        ? data.error
        : "Permintaan tidak dapat diproses.",
      data.payment,
    );
  return data as T;
}
export const money = (amount: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
export const categories: Record<string, string> = {
  HEALTH: "Kesehatan",
  EDUCATION: "Pendidikan",
  HUMANITARIAN: "Kemanusiaan",
  COMMUNITY: "Komunitas",
};
export const statusLabel: Record<string, string> = {
  DRAFT: "Draf",
  SUBMITTED: "Dalam review",
  REVISION_REQUESTED: "Perlu revisi",
  APPROVED: "Disetujui",
  PUBLISHED: "Terbit",
  SUSPENDED: "Ditangguhkan",
  CLOSED: "Ditutup",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
};
export function safePaymentUrl(value?: string) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" &&
      url.hostname === "app.sandbox.midtrans.com"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function readable(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value))
    return value.map(readable).filter(Boolean).join("\n");
  if (typeof value === "object")
    return Object.entries(value)
      .filter(([key]) => !/token|password|base64/i.test(key))
      .map(([key, item]) => `${key}: ${readable(item)}`)
      .join("\n");
  return String(value);
}
