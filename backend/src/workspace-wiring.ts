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
import { createPublicClient, http, type Hex } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { CONTRACT_CONFIG } from "./config";
import { createWorkspaceStore } from "./tenancy-store";
import { createEvidenceStore } from "./evidence-store";
import { startProposalPreviewMaintenance } from "./proposal-preview-maintenance";
import { createDisbursementStore } from "./disbursement-store";
import { createContributionStore } from "./contribution-store";
import { createActivityStore } from "./activity-store";
import { createEncryptedFileStore, evidenceKeyFromEnv } from "./evidence-files";
import { configureWorkspace, nowInSeconds } from "./workspace-runtime";
import { AmilRulesSchema } from "./report-package";
import { startRegistryRecovery } from "./registry-recovery";
import { registryFromEnvironment } from "./registry-wiring";
import { createInternalLedgerReader } from "./internal-ledger-reader";
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
  configureWorkspace({
    registry,
    reportAmilRules,
    store,
    evidence,
    disbursement,
    contributions,
    activities,
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
    .then(() => registry?.store.ensureSchema())
    .then(() => {
      if (registry) startRegistryRecovery(registry);
      if (files)
        startProposalPreviewMaintenance(disbursement, files, nowInSeconds);
      console.log("Workspace tenancy and evidence schema ready");
    })
    .catch((error) => console.error("Workspace schema failed:", error));
}
