import { createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const SEPOLIA_RPC = process.env.SEPOLIA_RPC_URL || "https://sepolia.gateway.tenderly.co";
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY || "";
const JWT_SECRET = process.env.JWT_SECRET || "tawf-sharia-relayer-dev";

const sessionStore = new Map<string, { code: string; expiresAt: number }>();

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "TAWF-SC-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function createSession(adminAddress: string, bundleId: string): Promise<string> {
  const code = generateCode();
  sessionStore.set(code, {
    code,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });
  return code;
}

export async function verifySessionCode(code: string): Promise<string | null> {
  const session = sessionStore.get(code);
  if (!session || Date.now() > session.expiresAt) {
    sessionStore.delete(code);
    return null;
  }
  sessionStore.delete(code);
  return await signJWT({ role: "sharia-council", iat: Date.now(), exp: Date.now() + 24 * 60 * 60 * 1000 });
}

async function signJWT(payload: Record<string, unknown>): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${header}.${body}`);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, data))));
  return `${header}.${body}.${sig}`;
}

export function verifyJWT(token: string): Record<string, unknown> | null {
  try {
    const [, body] = token.split(".");
    return JSON.parse(atob(body));
  } catch {
    return null;
  }
}

export function getRelayerClient() {
  if (!RELAYER_KEY) throw new Error("RELAYER_PRIVATE_KEY not set");
  const account = privateKeyToAccount(RELAYER_KEY as `0x${string}`);
  return {
    publicClient: createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) }),
    walletClient: createWalletClient({ chain: sepolia, transport: http(SEPOLIA_RPC), account }),
    account,
  };
}
