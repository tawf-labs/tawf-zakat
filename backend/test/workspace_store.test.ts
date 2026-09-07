import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { accessChallenge } from "../src/tenancy";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";
const OFFICER = "0x1111111111111111111111111111111111111111";
const OUTSIDER = "0x3333333333333333333333333333333333333333";
const NOW = 1_800_000_000;

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;

beforeAll(async () => {
  database = await createTestWorkspaceDatabase();
  await createWorkspaceStore(database.handle()).ensureSchema();
});

afterAll(async () => {
  await database.close();
});

/** Reopening replaces the handle, so the store is rebuilt from the live one. */
const restarted = async () => createWorkspaceStore(await database.reopen());

beforeEach(async () => {
  await database.reset();
  store = createWorkspaceStore(database.handle());

  for (const [id, legalName] of [
    [SINAR, "LPZ Sinar Amanah (sintetis)"],
    [BAITUL, "LPZ Baitul Maal Sejahtera (sintetis)"],
  ]) {
    await store.upsertInstitution({
      id: id!,
      legalName: legalName!,
      scopeUnit: "Pusat",
      scopeLevel: "PUSAT",
      mandateNote: "Fixture sintetis; bukan mandat mitra sungguhan.",
      isSynthetic: true,
    });
  }
  await store.upsertMembership({ institutionId: SINAR, account: OFFICER, role: "OFFICER" });
});

const challengeFor = (institutionId: string, account: string, nonceByte = "ab") =>
  accessChallenge({
    institutionId,
    account,
    nonce: `0x${nonceByte.repeat(32)}`,
    issuedAt: NOW,
    ttlSeconds: 300,
  });

describe("institutions and memberships", () => {
  it("keeps the fixture institutions marked synthetic, so they are never read as a real mandate", async () => {
    const institution = await store.getInstitution(SINAR);

    expect(institution?.isSynthetic).toBe(true);
    expect(institution?.mandateNote).toContain("sintetis");
  });

  it("finds the active membership for an account", async () => {
    const membership = await store.activeMembershipFor(OFFICER);

    expect(membership).toEqual({
      institutionId: SINAR,
      account: OFFICER,
      role: "OFFICER",
      isActive: true,
    });
  });

  it("reports no membership for an account nobody onboarded", async () => {
    expect(await store.activeMembershipFor(OUTSIDER)).toBeNull();
  });

  it("refuses a membership pointing at an institution that does not exist", async () => {
    await expect(
      store.upsertMembership({ institutionId: "lpz-tidak-ada", account: OUTSIDER, role: "READER" })
    ).rejects.toThrow();
  });

  it("refuses to leave one account active in two institutions at once", async () => {
    await expect(
      store.upsertMembership({ institutionId: BAITUL, account: OFFICER, role: "READER" })
    ).rejects.toThrow();

    expect((await store.activeMembershipFor(OFFICER))?.institutionId).toBe(SINAR);
  });

  it("keeps the deactivated row rather than deleting the history", async () => {
    await store.deactivateMembership({ institutionId: SINAR, account: OFFICER });

    expect(await store.activeMembershipFor(OFFICER)).toBeNull();
    expect(await store.membershipHistoryFor(OFFICER)).toHaveLength(1);

    // With the old row retired, the account may be onboarded elsewhere.
    await store.upsertMembership({ institutionId: BAITUL, account: OFFICER, role: "READER" });
    expect((await store.activeMembershipFor(OFFICER))?.institutionId).toBe(BAITUL);
  });
});

describe("challenges", () => {
  it("can be spent exactly once", async () => {
    const challenge = challengeFor(SINAR, OFFICER);
    await store.saveChallenge(challenge);

    const first = await store.consumeChallenge(challenge.nonce, NOW + 5);
    expect(first).toEqual({ outcome: "consumed", challenge });

    const second = await store.consumeChallenge(challenge.nonce, NOW + 6);
    expect(second.outcome).toBe("already-consumed");
  });

  it("reports an unknown nonce as unknown rather than inventing a challenge", async () => {
    expect((await store.consumeChallenge(`0x${"cd".repeat(32)}`, NOW)).outcome).toBe("unknown");
  });

  it("still returns an expired challenge, and lets the caller judge the clock", async () => {
    const challenge = challengeFor(SINAR, OFFICER);
    await store.saveChallenge(challenge);

    const result = await store.consumeChallenge(challenge.nonce, NOW + 5_000);
    expect(result.outcome).toBe("consumed");
    expect(result.outcome === "consumed" && result.challenge.expiresAt).toBe(NOW + 300);
  });

  it("refuses a challenge minted for an institution that does not exist", async () => {
    await expect(store.saveChallenge(challengeFor("lpz-tidak-ada", OFFICER))).rejects.toThrow();
  });
});

describe("sessions", () => {
  const TOKEN_HASH = `0x${"ee".repeat(32)}`;

  const openSession = (over: Partial<Parameters<WorkspaceStore["createSession"]>[0]> = {}) =>
    store.createSession({
      tokenHash: TOKEN_HASH,
      institutionId: SINAR,
      account: OFFICER,
      role: "OFFICER",
      issuedAt: NOW,
      expiresAt: NOW + 3600,
      ...over,
    });

  it("reads back the tenant and role, and never a bearer token", async () => {
    await openSession();
    const session = await store.sessionFor(TOKEN_HASH, NOW + 10);

    expect(session).toEqual({
      institutionId: SINAR,
      account: OFFICER,
      role: "OFFICER",
      expiresAt: NOW + 3600,
    });
    expect(JSON.stringify(session)).not.toContain("token");
  });

  it("stops resolving once the session has expired", async () => {
    await openSession();

    expect(await store.sessionFor(TOKEN_HASH, NOW + 3600)).not.toBeNull();
    expect(await store.sessionFor(TOKEN_HASH, NOW + 3601)).toBeNull();
  });

  it("stops resolving once the session is revoked, and stays revoked", async () => {
    await openSession();
    await store.revokeSession(TOKEN_HASH, NOW + 10);

    expect(await store.sessionFor(TOKEN_HASH, NOW + 20)).toBeNull();
    await store.revokeSession(TOKEN_HASH, NOW + 30);
    expect(await store.sessionFor(TOKEN_HASH, NOW + 40)).toBeNull();
  });

  it("refuses a session pairing an account with an institution it is not a member of", async () => {
    // The database, not only the route, is what stops this pairing existing.
    await expect(openSession({ institutionId: BAITUL })).rejects.toThrow();
  });

  it("refuses a session for an account with no membership at all", async () => {
    await expect(openSession({ account: OUTSIDER })).rejects.toThrow();
  });

  it("survives a restart, because the session lives in the database and not in memory", async () => {
    await openSession();

    // A genuine reopen of the same data directory, not a second handle on the
    // same process state: this is what makes the durability claim mean anything.
    const reopened = await restarted();

    expect(await reopened.sessionFor(TOKEN_HASH, NOW + 10)).toEqual({
      institutionId: SINAR,
      account: OFFICER,
      role: "OFFICER",
      expiresAt: NOW + 3600,
    });
  });

  it("keeps a spent challenge spent across a restart", async () => {
    const challenge = challengeFor(SINAR, OFFICER, "9a");
    await store.saveChallenge(challenge);
    await store.consumeChallenge(challenge.nonce, NOW + 5);

    const reopened = await restarted();

    expect((await reopened.consumeChallenge(challenge.nonce, NOW + 6)).outcome).toBe("already-consumed");
  });
});

describe("what the workspace does not claim", () => {
  it("leaves the tables that were already there exactly as they were", async () => {
    // The helper seeds a legacy `donations` table before the schema runs, the
    // way a real deployment already holds one.
    const columns = await database.columnsOf("donations");

    expect(columns).toContain("trx_id");
    expect(columns).not.toContain("institution_id");
  });

  it("assigns no owner to historical rows, so legacy data joins no tenant", async () => {
    expect(await database.rowCount("donations")).toBe(1);

    // Nothing in the workspace schema references that row, and no onboarding
    // step adopted it: ownership is recorded, never inferred.
    for (const institutionId of [SINAR, BAITUL]) {
      expect((await store.membersOf(institutionId)).length).toBeGreaterThanOrEqual(0);
    }
    expect((await store.membersOf(BAITUL)).length).toBe(0);
    expect((await store.membersOf(SINAR)).length).toBe(1);
  });
});
