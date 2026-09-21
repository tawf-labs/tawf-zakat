import { createPublicClient, createWalletClient, custom, http, isAddress, parseTransaction, zeroAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, foundry } from "viem/chains";

/** No inherited vault/RPC defaults and no implicit public-chain relay. */
export function zkNetworkFromEnvironment(env: Record<string, string | undefined> = process.env) {
  const keys = ["ZK_RPC_URL", "ZK_REGISTRY_ADDRESS", "ZK_RELAY_PRIVATE_KEY", "ZK_CHAIN_ID"] as const;
  if (keys.every(key => env[key] === undefined)) return undefined;
  const invalid = () => new Error("Konfigurasi jaringan ZK harus lengkap dan sah.");
  const rpcUrl = env.ZK_RPC_URL;
  const registry = env.ZK_REGISTRY_ADDRESS;
  const key = env.ZK_RELAY_PRIVATE_KEY;
  if (!rpcUrl || !registry || !key || !isAddress(registry) || registry.toLowerCase() === zeroAddress || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw invalid();
  let url: URL;
  try { url = new URL(rpcUrl); } catch { throw invalid(); }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const chainId = env.ZK_CHAIN_ID ?? (loopback ? "31337" : undefined);
  if (chainId !== "31337" && chainId !== "421614") throw invalid();
  if ((chainId === "31337" && !loopback) ||
      !["http:", "https:"].includes(url.protocol) || (!loopback && url.protocol !== "https:")) throw invalid();
  const chain = chainId === "31337" ? foundry : arbitrumSepolia;
  let account: ReturnType<typeof privateKeyToAccount>;
  try { account = privateKeyToAccount(key as Hex); } catch { throw invalid(); }
  const upstream = http(rpcUrl, { retryCount: 0 })({ chain });
  // Never cache this: a restarted node or changed proxy must not inherit approval.
  // Redact upstream errors, which may contain authenticated RPC URLs.
  const assertChain = async () => {
    let actual: unknown;
    try { actual = await upstream.request({ method: "eth_chainId" }); }
    catch { throw new Error("RPC ZK tidak dapat diverifikasi."); }
    if (typeof actual !== "string" || !/^0x[0-9a-fA-F]+$/.test(actual) || BigInt(actual) !== BigInt(chain.id)) {
      throw new Error("Chain RPC ZK tidak sesuai konfigurasi.");
    }
    return actual;
  };
  // Guard all reads too: receipt reconciliation cannot certify another chain.
  const transport = custom({ async request({ method, params }) {
    const actual = await assertChain();
    if (method === "eth_chainId") return actual;
    if (method === "eth_sendRawTransaction") {
      const raw = (params as [Hex])[0];
      if (parseTransaction(raw).chainId !== chain.id) throw new Error("Chain transaksi ZK tidak sesuai konfigurasi.");
    }
    try { return await upstream.request({ method, params } as Parameters<typeof upstream.request>[0]); }
    catch { throw new Error("Permintaan RPC ZK gagal."); }
  } }, { retryCount: 0 });
  const client = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ chain, transport, account });
  const guardedWallet = wallet.extend(() => ({
    // viem can sign a fully prepared transaction offline: transport checks alone
    // are insufficient. Pin the signed chain and check RPC immediately before it.
    async signTransaction(request: Parameters<typeof wallet.signTransaction>[0] & { chainId?: number }) {
      await assertChain();
      if ((request.chainId !== undefined && request.chainId !== chain.id) ||
          (request.chain && request.chain.id !== chain.id)) throw new Error("Chain transaksi ZK tidak sesuai konfigurasi.");
      return wallet.signTransaction({ ...request, chain, chainId: chain.id });
    },
  }));
  return { zkRegistryAddress: registry as Hex, zkPublicClient: client, zkWalletClient: guardedWallet };
}
