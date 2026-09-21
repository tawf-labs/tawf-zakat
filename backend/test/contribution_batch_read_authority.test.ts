/**
 * Two-person separation: the endorser must be able to READ the batch snapshot
 * (the endorse route demands the exact snapshot root) without also holding the
 * RECORD_CONTRIBUTIONS mandate. Found in the local pilot dry run, where an
 * ENDORSE-only officer got 403 on the batch list.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createContributionStore, CONTRIBUTION_SCHEMA_STATEMENTS } from "../src/contribution-store";
import { createZkBatchStore, ZK_BATCH_SCHEMA_STATEMENTS } from "../src/zk-batch-store";
import { DISBURSEMENT_SCHEMA_STATEMENTS } from "../src/disbursement-store";
import { ACTIVITY_SCHEMA_STATEMENTS } from "../src/activity-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const BASE = "http://localhost:3001/api/workspace";
const SINAR = "lpz-sinar-amanah";
const NOW = 1_800_000_000;
const admin = privateKeyToAccount(`0x${"a2".repeat(32)}` as Hex);
const recorder = privateKeyToAccount(`0x${"b2".repeat(32)}` as Hex);
const endorser = privateKeyToAccount(`0x${"c2".repeat(32)}` as Hex);
const bystander = privateKeyToAccount(`0x${"d2".repeat(32)}` as Hex);
let database: TestWorkspaceDatabase;

async function signIn(account: typeof admin): Promise<string> {
  const challengeRes = await app.fetch(new Request(`${BASE}/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institutionId: SINAR, account: account.address }),
  }));
  const { challenge, typedData } = await challengeRes.json();
  const signature = await account.signTypedData({ ...typedData, message: { ...typedData.message, nonce: challenge.nonce } });
  const session = await app.fetch(new Request(`${BASE}/session`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institutionId: SINAR, account: account.address, nonce: challenge.nonce, signature }),
  }));
  return (await session.json()).token;
}

const get = async (token: string, path: string) => app.fetch(new Request(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }));

describe("contribution batch read authority", () => {
  beforeAll(async () => {
    database = await createTestWorkspaceDatabase(process.env.DONOR_ACCESS_TEST_DATABASE_URL);
    const handle = database.handle();
    const workspaceStore = createWorkspaceStore(handle);
    await workspaceStore.ensureSchema();
    for (const statement of [...DISBURSEMENT_SCHEMA_STATEMENTS, ...CONTRIBUTION_SCHEMA_STATEMENTS, ...ACTIVITY_SCHEMA_STATEMENTS, ...ZK_BATCH_SCHEMA_STATEMENTS]) await handle.execute(sql.raw(statement));
    configureWorkspace({
      store: workspaceStore, contributions: createContributionStore(handle), zkBatches: createZkBatchStore(handle),
      ethCall: async () => "0x", now: () => NOW, challengeTtlSeconds: 300, sessionTtlSeconds: 3600,
    });
    for (const institution of SYNTHETIC_INSTITUTIONS) await workspaceStore.upsertInstitution(institutionRecordOf(institution));
    await handle.execute(sql`INSERT INTO officer_profiles (id, institution_id, display_name, is_active) VALUES
      ('off-admin', ${SINAR}, 'Admin', true), ('off-recorder', ${SINAR}, 'Recorder', true),
      ('off-endorser', ${SINAR}, 'Endorser', true), ('off-bystander', ${SINAR}, 'Bystander', true)`);
    await handle.execute(sql`INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active) VALUES
      (${SINAR}, ${admin.address.toLowerCase()}, 'ADMIN', 'off-admin', true),
      (${SINAR}, ${recorder.address.toLowerCase()}, 'OFFICER', 'off-recorder', true),
      (${SINAR}, ${endorser.address.toLowerCase()}, 'OFFICER', 'off-endorser', true),
      (${SINAR}, ${bystander.address.toLowerCase()}, 'OFFICER', 'off-bystander', true)`);
    const grant = (id: string, officer: string, account: string, fn: string) => handle.execute(sql`INSERT INTO operational_mandates
      (id, institution_id, officer_id, account_address, function, scope_type, program_id, valid_from, valid_until, assignment_ref, nominal_limit, version, is_active, created_at, updated_at, created_by)
      VALUES (${id}, ${SINAR}, ${officer}, ${account.toLowerCase()}, ${fn}, 'ALL_PROGRAMS', null, ${NOW - 1000}, ${NOW + 100000}, 'SK-TEST', null, 1, true, ${NOW}, ${NOW}, ${admin.address.toLowerCase()})`);
    await grant("m-record", "off-recorder", recorder.address, "RECORD_CONTRIBUTIONS");
    await grant("m-endorse", "off-endorser", endorser.address, "ENDORSE_CONTRIBUTIONS");
  });

  afterAll(async () => {
    resetWorkspace();
    if (database) await database.close();
  });

  it("lets an ENDORSE-only officer list batches, alongside a RECORD-only officer", async () => {
    expect((await get(await signIn(recorder), "/contribution-batches")).status).toBe(200);
    expect((await get(await signIn(endorser), "/contribution-batches")).status).toBe(200);
  });

  it("lets an ENDORSE-only officer read one batch and still 404s an unknown id", async () => {
    expect((await get(await signIn(endorser), "/contribution-batches/missing")).status).toBe(404);
  });

  it("still refuses an officer with neither mandate", async () => {
    expect((await get(await signIn(bystander), "/contribution-batches")).status).toBe(403);
  });
});
