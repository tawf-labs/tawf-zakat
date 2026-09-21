/**
 * Online payment to ledger, over the real HTTP handlers: an invoice remembers its
 * institution, fund type and contact; a signature-verified settlement records a
 * RECEIVED contribution; anything unverified records nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createContributionStore, CONTRIBUTION_SCHEMA_STATEMENTS, type ContributionStore } from "../src/contribution-store";
import { createDonorAccessStore, DONOR_ACCESS_SCHEMA_STATEMENTS } from "../src/donor-access-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const INSTITUTION = "lpz-sinar-amanah";
const SERVER_KEY = "test-server-key-not-a-secret";
const NOW = 1_800_000_000;
let database: TestWorkspaceDatabase;
let contributions: ContributionStore;
const saved = { key: process.env.MIDTRANS_SERVER_KEY, institution: process.env.GATEWAY_INSTITUTION_ID };

const post = (path: string, body: unknown) => app.fetch(new Request(`http://localhost:3001${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));
const signature = (orderId: string, code: string, gross: string, key = SERVER_KEY) =>
  createHash("sha512").update(`${orderId}${code}${gross}${key}`).digest("hex");
const invoice = async (extra: Record<string, unknown> = {}) => {
  const response = await post("/api/donations/fiat", { amountIDR: 250000, zakatType: "Zakat Maal", donorName: "Muzaki Uji", ...extra });
  return { status: response.status, body: await response.json() };
};
const settle = (trxId: string, overrides: Record<string, unknown> = {}) => post("/api/webhooks/payment", {
  order_id: trxId, status_code: "200", gross_amount: "250000.00", transaction_status: "settlement",
  settlement_time: "2027-01-15T08:00:00.000Z", signature_key: signature(trxId, "200", "250000.00"), ...overrides,
});

describe("gateway webhook to ledger", () => {
  beforeAll(async () => {
    database = await createTestWorkspaceDatabase(process.env.DONOR_ACCESS_TEST_DATABASE_URL);
    const workspace = createWorkspaceStore(database.handle());
    await workspace.ensureSchema();
    contributions = createContributionStore(database.handle());
    await contributions.ensureSchema();
    for (const statement of DONOR_ACCESS_SCHEMA_STATEMENTS) await database.handle().execute(sql.raw(statement));
    for (const institution of SYNTHETIC_INSTITUTIONS) await workspace.upsertInstitution(institutionRecordOf(institution));
    configureWorkspace({ store: workspace, contributions, donorAccess: createDonorAccessStore(database.handle(), Buffer.alloc(32, 9)), ethCall: async () => "0x", now: () => NOW, challengeTtlSeconds: 300, sessionTtlSeconds: 3600 });
  });
  beforeEach(async () => {
    process.env.GATEWAY_INSTITUTION_ID = INSTITUTION;
    delete process.env.MIDTRANS_SERVER_KEY; // no key: the invoice uses the offline mock instead of calling Midtrans
    await database.handle().execute(sql`DELETE FROM gateway_donation_intents`);
    await database.handle().execute(sql`DELETE FROM contribution_history`);
    await database.handle().execute(sql`DELETE FROM contributions`);
  });
  afterAll(async () => {
    resetWorkspace();
    for (const [name, value] of [["MIDTRANS_SERVER_KEY", saved.key], ["GATEWAY_INSTITUTION_ID", saved.institution]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    if (database) await database.close();
  });

  it("records a RECEIVED contribution from a signature-verified settlement, once", async () => {
    const { body } = await invoice({ donorContact: "donor@example.test" });
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    expect((await settle(body.trxId)).status).toBe(200);
    expect((await settle(body.trxId)).status).toBe(200); // Midtrans retries notifications

    const records = await contributions.listContributions(INSTITUTION);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      sourceChannel: "QRIS", sourceReference: body.trxId, amountExact: "250000", fundType: "ZAKAT",
      status: "RECEIVED", donorContact: "donor@example.test",
    });
    expect((await contributions.getHistory(INSTITUTION, records[0].id))[0]).toMatchObject({ actorAccount: "system:midtrans", actorOfficerId: null });
  });

  it("records nothing for a forged signature", async () => {
    const { body } = await invoice();
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    const response = await settle(body.trxId, { signature_key: signature(body.trxId, "200", "250000.00", "another-key") });
    expect(response.status).toBe(401);
    expect(await contributions.listContributions(INSTITUTION)).toHaveLength(0);
  });

  it("records nothing while no real server key is configured, even with the built-in demo key's signature", async () => {
    const { body } = await invoice();
    const forged = signature(body.trxId, "200", "250000.00", "SB-Mid-server-TESTKEY12345");
    await settle(body.trxId, { signature_key: forged });
    expect(await contributions.listContributions(INSTITUTION)).toHaveLength(0);
  });

  it("records nothing when the unauthenticated simulator marks a payment as paid", async () => {
    const { body } = await invoice();
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    await post("/api/webhooks/simulator", { trxId: body.trxId });
    expect(await contributions.listContributions(INSTITUTION)).toHaveLength(0);
  });

  it("records nothing when no institution is configured for online payments", async () => {
    delete process.env.GATEWAY_INSTITUTION_ID;
    const { body } = await invoice();
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    await settle(body.trxId);
    expect(await contributions.listContributions(INSTITUTION)).toHaveLength(0);
  });

  it("rejects a malformed donor email before creating an invoice", async () => {
    const { status } = await invoice({ donorContact: "bukan-email" });
    expect(status).toBe(400);
  });

  it("does not record a payment that was never settled", async () => {
    const { body } = await invoice();
    process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
    await settle(body.trxId, { transaction_status: "pending", signature_key: signature(body.trxId, "200", "250000.00") });
    expect(await contributions.listContributions(INSTITUTION)).toHaveLength(0);
  });

  describe("public lookup", () => {
    const lookup = async (reference: string) => (await (await app.fetch(new Request(`http://localhost:3001/api/public/contributions/${encodeURIComponent(reference)}`))).json()).contribution;

    it("shows the payment as an online donation until it reaches the ledger", async () => {
      const { body } = await invoice({ donorContact: "donor@example.test" });
      expect((await lookup(body.trxId)).recordKind).toBe("ONLINE_DONATION");
    });

    it("shows the ledger contribution, which offers OTP access, once the payment is recorded", async () => {
      const { body } = await invoice({ donorContact: "donor@example.test" });
      process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
      await settle(body.trxId);
      expect((await lookup(body.trxId)).recordKind).toBe("INSTITUTION_CONTRIBUTION");
    });

    it("keeps showing the online donation when the institution never recorded it", async () => {
      delete process.env.GATEWAY_INSTITUTION_ID;
      const { body } = await invoice();
      process.env.MIDTRANS_SERVER_KEY = SERVER_KEY;
      await settle(body.trxId);
      expect((await lookup(body.trxId)).recordKind).toBe("ONLINE_DONATION");
    });
  });
});
