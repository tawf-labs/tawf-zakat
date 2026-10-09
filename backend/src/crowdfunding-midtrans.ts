import { verifyMidtransSignature } from "./midtrans";

export class CampaignGatewayError extends Error {
  constructor(public code: "NOT_FOUND" | "UNAVAILABLE") { super(code === "NOT_FOUND" ? "Sandbox order not created" : "Sandbox gateway unavailable"); }
}
export interface CampaignGateway {
  create(id: string, amount: number, donorName: string): Promise<{ token: string; redirectUrl: string }>;
  status(id: string): Promise<Record<string, any>>;
  verify(body: Record<string, any>): boolean;
}
// Key prefix alone is not authoritative: sandbox can accept unprefixed keys.
// The transport and redirect origins below remain sandbox-only; no production fallback.
const validServerKey = (key: string) => /^(?:SB-)?Mid-server-\S+$/.test(key) && !key.includes("TESTKEY");
export function crowdfundingGatewayFromEnv(): CampaignGateway | null {
  const key = process.env.MIDTRANS_SERVER_KEY?.trim();
  if (process.env.NODE_ENV === "test" || process.env.MIDTRANS_IS_PRODUCTION === "true" || !key || !validServerKey(key)) return null;
  return createSandboxCampaignGateway(key);
}

/** Injectable transport for sandbox contract tests; runtime wiring remains fail-closed. */
export function createSandboxCampaignGateway(key: string, transport: typeof fetch = fetch): CampaignGateway {
  if (!validServerKey(key)) throw new Error("A valid Midtrans server key is required for the sandbox endpoint");
  const headers = { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`, "Content-Type": "application/json" };
  async function request(url: string, body?: unknown) {
    try {
      const response = await transport(url, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, redirect: "error", signal: AbortSignal.timeout(10000) });
      const data = await response.json() as Record<string, any>;
      // Only an authenticated status response explicitly reporting not-created permits re-creation.
      if (!body && (response.status === 404 || response.ok) && String(data.status_code) === "404") throw new CampaignGatewayError("NOT_FOUND");
      if (!response.ok) throw new CampaignGatewayError("UNAVAILABLE");
      return data;
    } catch (error) {
      if (error instanceof CampaignGatewayError) throw error;
      throw new CampaignGatewayError("UNAVAILABLE");
    }
  }
  return {
    async create(id, amount, donorName) {
      const data = await request("https://app.sandbox.midtrans.com/snap/v1/transactions", { transaction_details: { order_id: id, gross_amount: amount }, customer_details: { first_name: donorName } });
      if (typeof data.token !== "string" || typeof data.redirect_url !== "string" || new URL(data.redirect_url).origin !== "https://app.sandbox.midtrans.com") throw new Error("Invalid sandbox checkout");
      return { token: data.token, redirectUrl: data.redirect_url };
    },
    status: id => request(`https://api.sandbox.midtrans.com/v2/${encodeURIComponent(id)}/status`),
    verify: body => [body.order_id, body.status_code, body.gross_amount, body.signature_key].every(v => typeof v === "string") && verifyMidtransSignature(body.order_id, body.status_code, body.gross_amount, key, body.signature_key),
  };
}
