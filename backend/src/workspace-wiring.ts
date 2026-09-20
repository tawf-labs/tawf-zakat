/**
 * Wiring the workspace to a real deployment (Spec #68, ticket #69).
 *
 * Kept apart from `./workspace-runtime`, which holds only the shape, so that
 * importing the routes never drags a database driver or an RPC client into a
 * test process. This module is imported once, by the server entry point.
 *
 * It configures nothing in three cases, and each is a deliberate silence rather
 * than a degraded mode:
 *
 * - under test, where the test binds its own isolated database;
 * - with no `DATABASE_URL`, where there is nowhere durable to keep a session;
 * - while `DEPLOYMENT_PENDING`, where the deployment is mid-reset.
 *
 * In all three the routes answer 503. Nothing falls back to memory, because a
 * workspace whose memberships evaporate on restart is worse than one that is
 * plainly closed.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createPublicClient, createWalletClient, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, foundry } from "viem/chains";
import { CONTRACT_CONFIG } from "./config";
import { createWorkspaceStore } from "./tenancy-store";
import { createEvidenceStore } from "./evidence-store";
import { startProposalPreviewMaintenance } from "./proposal-preview-maintenance";
import { createDisbursementStore } from "./disbursement-store";
import { createContributionStore } from "./contribution-store";
import { createActivityStore } from "./activity-store";
import { createAuditFindingStore } from "./audit-finding-store";
import { createDonorAccessStore } from "./donor-access-store";
import { donorOtpKeyFromEnv } from "./donor-access";
import { donorEmailTransportFromEnv } from "./email-transport";
import { randomBytes } from "node:crypto";
import { createEncryptedFileStore, evidenceKeyFromEnv } from "./evidence-files";
import { configureWorkspace, nowInSeconds } from "./workspace-runtime";
import { AmilRulesSchema } from "./report-package";
import { startRegistryRecovery } from "./registry-recovery";
import { registryFromEnvironment } from "./registry-wiring";
import { createInternalLedgerReader } from "./internal-ledger-reader";
import { createZkBatchStore } from "./zk-batch-store";
import { createZkProofService } from "./zk-proof-service";
import type { EthCall } from "./account-signature";

/** Five minutes to sign a challenge; eight hours of workspace before signing in again. */
const CHALLENGE_TTL_SECONDS = 300;
const SESSION_TTL_SECONDS = 8 * 60 * 60;

/** Where restricted source documents are kept, as ciphertext. */
const EVIDENCE_FILE_DIRECTORY = process.env.EVIDENCE_FILE_DIR ?? ".evidence-files";

export function installWorkspaceRuntime(): void {
  const databaseUrl = process.env.NODE_ENV === "test" ? undefined : process.env.DATABASE_URL;
  if (!databaseUrl || process.env.DEPLOYMENT_PENDING === "true") return;

  const db = drizzle(postgres(databaseUrl, { max: 5 }));
  const store = createWorkspaceStore(db);

  const rpc = createPublicClient({ chain: arbitrumSepolia, transport: http(CONTRACT_CONFIG.RPC_URL) });
  // The whole ERC-1271 rule lives in `account-signature`; this only carries the
  // call. A failure here is a refusal there, never an approval.
  const ethCall: EthCall = async ({ to, data }) => {
    const { data: returned } = await rpc.call({ to: to as Hex, data });
    return returned ?? "0x";
  };

  const evidence = createEvidenceStore(db);
  const disbursement = createDisbursementStore(db);
  const contributions = createContributionStore(db);
  const activities = createActivityStore(db);
  const auditFindings = createAuditFindingStore(db);
  // Codes are stored as HMACs under this key. Without a configured key a
  // per-process one is used: codes then die with the process (15 minutes at
  // most) and cannot be checked by another instance, but nothing is weakened.
  const donorOtpKey = donorOtpKeyFromEnv();
  if (!donorOtpKey) {
    console.warn(
      "DONOR_OTP_KEY belum disetel: kode OTP donatur memakai kunci sementara proses ini " +
        "dan tidak berlaku setelah restart atau pada instance lain."
    );
  }
  const donorAccess = createDonorAccessStore(db, donorOtpKey ?? randomBytes(32));
  const donorMessages = donorEmailTransportFromEnv();
  if (!donorMessages) {
    console.warn("RESEND_API_KEY/DONOR_OTP_EMAIL_FROM belum disetel: pengiriman kode OTP donatur tidak tersedia.");
  }

  // No key, no file store. The routes then record every offered document as
  // FAILED with that reason, which is the truth - rather than writing an
  // institution's identity documents to disk in the clear.
  const key = evidenceKeyFromEnv();
  if (!key) {
    console.warn(
      "EVIDENCE_FILE_KEY belum disetel: dokumen terbatas tidak akan disimpan. " +
        "Snapshot dan hasil rekonsiliasi tetap tersimpan."
    );
  }

  // Server-only onboarding configuration; HTTP callers cannot supply policy flags.
  const reportAmilRules = AmilRulesSchema.parse(JSON.parse(process.env.REPORT_AMIL_RULES_JSON ?? "[]"));
  const registry = registryFromEnvironment(db);
  const files = key
    ? createEncryptedFileStore({ directory: EVIDENCE_FILE_DIRECTORY, key })
    : undefined;
  const zkBatches = createZkBatchStore(db);
  const zkProver = createZkProofService();
  // This tracer is deliberately limited to a local EVM. No implicit production relay.
  const zkRpcUrl = process.env.ZK_RPC_URL;
  const zkRegistryAddress = process.env.ZK_REGISTRY_ADDRESS;
  const zkRelayKey = process.env.ZK_RELAY_PRIVATE_KEY;
  let zkChain = {};
  if (zkRpcUrl && zkRegistryAddress && zkRelayKey) {
    const url = new URL(zkRpcUrl);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !isAddress(zkRegistryAddress)) {
      throw new Error("ZK tracer memerlukan RPC lokal dan alamat registry yang sah.");
    }
    zkChain = {
      zkRegistryAddress,
      zkPublicClient: createPublicClient({ chain: foundry, transport: http(zkRpcUrl) }),
      zkWalletClient: createWalletClient({ chain: foundry, transport: http(zkRpcUrl), account: privateKeyToAccount(zkRelayKey as Hex) }),
    };
  }
  configureWorkspace({
    ...zkChain,
    registry,
    reportAmilRules,
    store,
    evidence,
    disbursement,
    contributions,
    activities,
    auditFindings,
    donorAccess,
    zkBatches,
    zkProver,
    ...(donorMessages ? { donorMessages } : {}),
    // The same chain, contract and indexer key the indexer writes under, so a
    // package names the deployment it was actually read from.
    internalLedger: createInternalLedgerReader(db, {
      chainId: CONTRACT_CONFIG.CHAIN_ID,
      contract: CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS.toLowerCase(),
      indexerKey: `${CONTRACT_CONFIG.CHAIN_ID}:${CONTRACT_CONFIG.ZAKAT_PROTOCOL_L1_ADDRESS.toLowerCase()}`,
    }),
    ...(files ? { files } : {}),
    // Institutional contract accounts are checked on the explicitly configured registry chain.
    ethCall: registry?.chain.accountSignatureCall ?? ethCall,
    now: nowInSeconds,
    challengeTtlSeconds: CHALLENGE_TTL_SECONDS,
    sessionTtlSeconds: SESSION_TTL_SECONDS,
  });

  // Additive and idempotent; it creates this ticket's tables and alters none
  // that already exist. Failure is logged, not swallowed into a fake success.
  store
    .ensureSchema()
    .then(() => evidence.ensureSchema())
    .then(() => disbursement.ensureSchema())
    .then(() => contributions.ensureSchema())
    .then(() => activities.ensureSchema())
    .then(() => auditFindings.ensureSchema())
    .then(() => donorAccess.ensureSchema())
    .then(() => zkBatches.ensureSchema())
    .then(() => registry?.store.ensureSchema())
    .then(() => {
      if (registry) startRegistryRecovery(registry);
      if (files)
        startProposalPreviewMaintenance(disbursement, files, nowInSeconds);
      console.log("Workspace tenancy, evidence and ZK batch schema ready");
    })
    .catch((error) => console.error("Workspace schema failed:", error));
}
