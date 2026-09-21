import { z } from "zod";
import { createCertificateChain } from "./certificate-chain";
import { createCertificateStore } from "./certificate-store";
import type { RegistryChain } from "./registry-chain";
import type { CertificateDatabase } from "./certificate-store";

/** No vault defaults: all certificate deployment inputs must be explicitly supplied. Requires an
 * already-configured report registry: `mandateChain` is the certificate contract's own
 * `mandateSource`, read but never written by this ticket. */
export function certificateFromEnvironment(db: CertificateDatabase, mandateChain: RegistryChain | undefined) {
  // Explicit service-funded lifetime ceiling: reservations persist after confirmation/revert.
  // These variables never authorize deductions from donor contributions.
  const keys = ["CERTIFICATE_NFT_RPC_URL", "CERTIFICATE_NFT_CHAIN_ID", "CERTIFICATE_NFT_ADDRESS", "CERTIFICATE_NFT_RELAYER_KEY", "CERTIFICATE_NFT_CONFIRMATIONS", "CERTIFICATE_NFT_BUDGET_WEI", "CERTIFICATE_NFT_GAS_LIMIT", "CERTIFICATE_NFT_MAX_FEE_PER_GAS"] as const;
  if (keys.every((key) => !process.env[key])) return undefined;
  if (!mandateChain) throw new Error("CERTIFICATE_NFT_* memerlukan REPORT_REGISTRY_* yang sudah dikonfigurasi sebagai sumber mandat.");
  const config = z.object({
    rpcUrl: z.url(), chainId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine((a) => !/^0x0{40}$/.test(a)),
    privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/), requiredConfirmations: z.coerce.number().int().positive().max(10000),
    budget: z.object({ maxWei: z.string(), gasLimit: z.string(), maxFeePerGas: z.string() }),
  }).safeParse({
    rpcUrl: process.env.CERTIFICATE_NFT_RPC_URL, chainId: process.env.CERTIFICATE_NFT_CHAIN_ID,
    address: process.env.CERTIFICATE_NFT_ADDRESS, privateKey: process.env.CERTIFICATE_NFT_RELAYER_KEY,
    requiredConfirmations: process.env.CERTIFICATE_NFT_CONFIRMATIONS,
    budget: { maxWei: process.env.CERTIFICATE_NFT_BUDGET_WEI, gasLimit: process.env.CERTIFICATE_NFT_GAS_LIMIT, maxFeePerGas: process.env.CERTIFICATE_NFT_MAX_FEE_PER_GAS },
  });
  if (!config.success) throw new Error("Konfigurasi CERTIFICATE_NFT_* harus lengkap dan sah.");
  return {
    store: createCertificateStore(db),
    chain: createCertificateChain({ ...config.data, address: config.data.address as `0x${string}`, privateKey: config.data.privateKey as `0x${string}` }, mandateChain),
  };
}
