import { z } from "zod";
import { createCertificateChain } from "./certificate-chain";
import { createCertificateStore } from "./certificate-store";
import type { RegistryChain } from "./registry-chain";
import type { CertificateDatabase } from "./certificate-store";

/** No vault defaults: all certificate deployment inputs must be explicitly supplied. Requires an
 * already-configured report registry: `mandateChain` is the certificate contract's own
 * `mandateSource`, read but never written by this ticket. */
export function certificateFromEnvironment(db: CertificateDatabase, mandateChain: RegistryChain | undefined) {
  const keys = ["CERTIFICATE_NFT_RPC_URL", "CERTIFICATE_NFT_CHAIN_ID", "CERTIFICATE_NFT_ADDRESS", "CERTIFICATE_NFT_RELAYER_KEY", "CERTIFICATE_NFT_CONFIRMATIONS"] as const;
  if (keys.every((key) => !process.env[key])) return undefined;
  if (!mandateChain) throw new Error("CERTIFICATE_NFT_* memerlukan REPORT_REGISTRY_* yang sudah dikonfigurasi sebagai sumber mandat.");
  const config = z.object({
    rpcUrl: z.url(), chainId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine((a) => !/^0x0{40}$/.test(a)),
    privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/), requiredConfirmations: z.coerce.number().int().positive().max(10000),
  }).safeParse({
    rpcUrl: process.env.CERTIFICATE_NFT_RPC_URL, chainId: process.env.CERTIFICATE_NFT_CHAIN_ID,
    address: process.env.CERTIFICATE_NFT_ADDRESS, privateKey: process.env.CERTIFICATE_NFT_RELAYER_KEY,
    requiredConfirmations: process.env.CERTIFICATE_NFT_CONFIRMATIONS,
  });
  if (!config.success) throw new Error("Konfigurasi CERTIFICATE_NFT_* harus lengkap dan sah.");
  return {
    store: createCertificateStore(db),
    chain: createCertificateChain({ ...config.data, address: config.data.address as `0x${string}`, privateKey: config.data.privateKey as `0x${string}` }, mandateChain),
  };
}
