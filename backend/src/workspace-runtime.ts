/**
 * What the workspace routes need from the outside world (Spec #68, ticket #69).
 *
 * Three things are not decidable inside a pure function: where rows are kept,
 * what the clock says, and what a contract account answers. They are gathered
 * here so the routes take them as one value rather than reaching for a global
 * database handle, an ambient `Date.now()` and a network client each.
 *
 * That is also what lets the API tests be honest. A test replaces the store
 * with an isolated PostgreSQL, the clock with a variable it advances, and the
 * `eth_call` transport with a stub - and replaces nothing else. The signature
 * arithmetic, the challenge rules, the tenant resolution and every gate run for
 * real, because those are the things under test.
 *
 * When nothing is configured the routes say so with a 503. There is deliberately
 * no in-memory fallback: a workspace that appeared to work without a database
 * would report sessions and memberships that vanish on restart.
 */

import type { EthCall } from "./account-signature";
import type { WorkspaceStore } from "./tenancy-store";
import type { EvidenceStore } from "./evidence-store";
import type { PrivateFileStore } from "./evidence-files";
import type { DisbursementStore } from "./disbursement-store";

export type RecipientMessageTransport = {
  send(message: { to: string; body: string }): Promise<void>;
  /** Whether this channel can reach the contact at all (e.g. email only). Absent means any. */
  canDeliver?(to: string): boolean;
};

export type WorkspaceRuntime = {
  registry?: import("./registry-recording").RegistryRuntime;
  store: WorkspaceStore;
  ethCall: EthCall;
  /** Unix seconds. */
  now: () => number;
  challengeTtlSeconds: number;
  sessionTtlSeconds: number;
  /**
   * Evidence packages (Spec #68, ticket #70). Optional, and absent means
   * absent: the evidence routes answer 503 rather than keeping a preparation
   * somewhere it will not survive a restart.
   */
  evidence?: EvidenceStore;
  /**
   * Where restricted source documents are kept. Without a configured key there
   * is nowhere to put them that is not plaintext, so the routes refuse the
   * upload instead of storing one.
   */
  files?: PrivateFileStore;
  /**
   * Delivers one-time confirmation codes to a recipient's contact (ticket #94).
   * Optional, and absent means absent: OTP confirmation answers 503 and the
   * officer falls back to a BAST examined by another officer. The code is never
   * returned to the caller, so nothing else can stand in for this transport.
   */
  messages?: RecipientMessageTransport;
  reportAmilRules?: import("./report-package").AmilRule[];
  /**
   * This deployment's own deposit ledger and indexed events (ticket #79).
   * Optional, and absent means absent: the internal source path answers that it
   * is unavailable rather than building a side out of nothing.
   */
  internalLedger?: import("./internal-usdc-source").InternalLedgerReader;
  /**
   * Program bantuan and Pengajuan drafts (Spec #86, ticket #89). Optional,
   * and absent means absent: the disbursement routes answer 503 rather than
   * keeping a program somewhere it will not survive a restart.
   */
  disbursement?: DisbursementStore;
  /**
   * Institutional contributions and tabular import drafts (Spec #100, ticket #102).
   * Optional, and absent means absent: the contribution routes answer 503 rather
   * than keeping a contribution somewhere it will not survive a restart.
   */
  contributions?: import("./contribution-store").ContributionStore;
  /**
   * Distribution activities and contribution allocations (Spec #100, ticket #103).
   * Optional, and absent means absent: the activity routes answer 503 rather
   * than keeping an activity somewhere it will not survive a restart.
   */
  activities?: import("./activity-store").ActivityStore;
  /**
   * Auditor findings and their append-only history (Issue #99). Optional, and
   * absent means absent: the finding routes answer 503.
   */
  auditFindings?: import("./audit-finding-store").AuditFindingStore;
  /**
   * Accountless donor access via OTP and bounded sessions (Spec #100, Ticket #104).
   * Optional, and absent means absent: the donor routes answer 503.
   */
  donorAccess?: import("./donor-access-store").DonorAccessStore;
  /**
   * Delivers donor OTP codes (ticket #104), kept apart from `messages` so the
   * recipient confirmation channel of #94 is not changed by it. Optional, and
   * absent means absent: the page says no channel is available.
   */
  donorMessages?: RecipientMessageTransport;
  /**
   * ZK Contribution Batch store and Merkle tree management (Spec #100, Issue #108).
   */
  zkPublications?: import("./zk-publication-store").ZkPublicationStore;
  zkBudget?: import("./zk-publication-store").ZkBudget;
  zkNotifications?: { send(event: { operationId: string; status: string }): Promise<void> };
  zkBatches?: import("./zk-batch-store").ZkBatchStore;
  /**
   * ZK Prover service for real Groth16 witness and proof generation (Issue #108).
   */
  zkProver?: import("./zk-proof-service").ZkProofService;
  zkRegistryAddress?: `0x${string}`;
  zkWalletClient?: any;
  zkPublicClient?: any;
};

let runtime: WorkspaceRuntime | null = null;

export const configureWorkspace = (next: WorkspaceRuntime): void => {
  runtime = next;
};

export const resetWorkspace = (): void => {
  runtime = null;
};

export const workspaceRuntime = (): WorkspaceRuntime | null => runtime;

export const nowInSeconds = (): number => Math.floor(Date.now() / 1000);
