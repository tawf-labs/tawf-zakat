import { createReportEndorsement } from "./report-endorsement";
import { z } from "zod";
import { createRegistryChain } from "./registry-chain";
import { createRegistryStore } from "./registry-store";
import type { EvidenceDatabase } from "./evidence-store";

/** No vault defaults: all registry deployment inputs must be explicitly supplied. */
export function registryFromEnvironment(db: EvidenceDatabase) {
  const keys = ["REPORT_REGISTRY_RPC_URL", "REPORT_REGISTRY_CHAIN_ID", "REPORT_REGISTRY_ADDRESS", "REPORT_REGISTRY_RELAYER_KEY", "REPORT_REGISTRY_CONFIRMATIONS"] as const;
  if (keys.every(key => !process.env[key])) return undefined;
  const config = z.object({
    rpcUrl: z.url(), chainId: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(a => !/^0x0{40}$/.test(a)),
    privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/), requiredConfirmations: z.coerce.number().int().positive().max(10000),
  }).safeParse({ rpcUrl: process.env.REPORT_REGISTRY_RPC_URL, chainId: process.env.REPORT_REGISTRY_CHAIN_ID,
    address: process.env.REPORT_REGISTRY_ADDRESS, privateKey: process.env.REPORT_REGISTRY_RELAYER_KEY,
    requiredConfirmations: process.env.REPORT_REGISTRY_CONFIRMATIONS });
  if (!config.success) throw new Error("Konfigurasi REPORT_REGISTRY_* harus lengkap dan sah.");
  const validatorKey = process.env.REPORT_REGISTRY_VALIDATOR_KEY;
  if (validatorKey && !/^0x[0-9a-fA-F]{64}$/.test(validatorKey)) throw new Error("REPORT_REGISTRY_VALIDATOR_KEY tidak sah.");
  return { endorsement: validatorKey ? createReportEndorsement(validatorKey as `0x${string}`) : undefined, store: createRegistryStore(db), chain: createRegistryChain({ ...config.data, address: config.data.address as `0x${string}`, privateKey: config.data.privateKey as `0x${string}` }) };
}
