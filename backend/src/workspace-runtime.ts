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
  reportAmilRules?: import("./report-package").AmilRule[];
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
