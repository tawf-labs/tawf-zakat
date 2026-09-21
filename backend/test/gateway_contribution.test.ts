/**
 * A settled online payment (Midtrans) becomes a RECEIVED contribution in the
 * institution's ledger without a person typing it in. The recorder is the
 * system, never a fabricated officer, and nothing skips reconciliation or
 * endorsement: only humans move a contribution past RECEIVED.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore } from "../src/tenancy-store";
import { createContributionStore, type ContributionStore } from "../src/contribution-store";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { GATEWAY_ACTOR, fundTypeOf, recordSettledDonation, rememberGatewayIntent } from "../src/gateway-contribution";

const INSTITUTION = "lpz-sinar-amanah";
const NOW = 1_800_000_000;
let database: TestWorkspaceDatabase;
let store: ContributionStore;

const donation = (overrides: Record<string, unknown> = {}) => ({
  trxId: "TRX-20260921-1234", amountIDR: 250000, donorName: "Muzaki Sintetis", isAnonymous: false,
  paidAt: "2027-01-15T08:00:00.000Z", ...overrides,
});
const intent = (overrides: Record<string, unknown> = {}) => ({
  trxId: "TRX-20260921-1234", institutionId: INSTITUTION, zakatType: "Zakat Maal", donorContact: "donor@example.test",
  ...overrides,
});

describe("gateway contribution", () => {
  beforeAll(async () => {
    database = await createTestWorkspaceDatabase(process.env.DONOR_ACCESS_TEST_DATABASE_URL);
    const workspace = createWorkspaceStore(database.handle());
    await workspace.ensureSchema();
    store = createContributionStore(database.handle());
    await store.ensureSchema();
    for (const institution of SYNTHETIC_INSTITUTIONS) await workspace.upsertInstitution(institutionRecordOf(institution));
  });
  beforeEach(async () => {
    await database.handle().execute(sql`DELETE FROM gateway_donation_intents`);
    await database.handle().execute(sql`DELETE FROM contribution_history`);
    await database.handle().execute(sql`DELETE FROM contributions`);
  });
  afterAll(async () => { if (database) await database.close(); });

  it("records a RECEIVED QRIS contribution attributed to the system, with the donor's contact", async () => {
    await rememberGatewayIntent(store, intent(), NOW);
    expect(await recordSettledDonation(store, donation(), NOW)).toBe("RECORDED");

    const [record] = await store.listContributions(INSTITUTION);
    expect(record).toMatchObject({
      sourceChannel: "QRIS", sourceReference: "TRX-20260921-1234", currencyUnit: "IDR", amountExact: "250000",
      fundType: "ZAKAT", status: "RECEIVED", donorName: "Muzaki Sintetis", donorContact: "donor@example.test",
    });
    expect(record.receivedAt).toBe(Date.parse("2027-01-15T08:00:00.000Z") / 1000);
    const history = await store.getHistory(INSTITUTION, record.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ action: "RECORD", actorAccount: GATEWAY_ACTOR.account, actorOfficerId: null });
  });

  it("never advances past RECEIVED: reconciliation and endorsement stay with people", async () => {
    await rememberGatewayIntent(store, intent(), NOW);
    await recordSettledDonation(store, donation(), NOW);
    const [record] = await store.listContributions(INSTITUTION);
    expect(record.status).toBe("RECEIVED");
    expect(record.reconciledBy ?? null).toBeNull();
    expect(record.endorsedBy ?? null).toBeNull();
  });

  it("is idempotent: the webhook and the status poll may both report the same payment", async () => {
    await rememberGatewayIntent(store, intent(), NOW);
    expect(await recordSettledDonation(store, donation(), NOW)).toBe("RECORDED");
    expect(await recordSettledDonation(store, donation(), NOW + 5)).toBe("DUPLICATE");
    expect(await store.listContributions(INSTITUTION)).toHaveLength(1);
  });

  it("does nothing when no institution was chosen for the payment", async () => {
    expect(await recordSettledDonation(store, donation(), NOW)).toBe("NO_INTENT");
    expect(await store.listContributions(INSTITUTION)).toHaveLength(0);
  });

  it("keeps the first intent when the same invoice is registered twice", async () => {
    await rememberGatewayIntent(store, intent({ zakatType: "Zakat Fitrah" }), NOW);
    await rememberGatewayIntent(store, intent({ zakatType: "Kurban" }), NOW + 1);
    await recordSettledDonation(store, donation(), NOW);
    expect((await store.listContributions(INSTITUTION))[0].fundType).toBe("FITRAH");
  });

  it("accepts a payment with no contact and stays reachable through recovery later", async () => {
    await rememberGatewayIntent(store, intent({ donorContact: null }), NOW);
    expect(await recordSettledDonation(store, donation(), NOW)).toBe("RECORDED");
    expect((await store.listContributions(INSTITUTION))[0].donorContact ?? null).toBeNull();
  });

  it("maps the donation categories to fund types", () => {
    expect(fundTypeOf("Zakat Maal")).toBe("ZAKAT");
    expect(fundTypeOf("Zakat Fitrah")).toBe("FITRAH");
    expect(fundTypeOf("Infaq")).toBe("INFAK_SEDEKAH");
    expect(fundTypeOf("Sedekah")).toBe("INFAK_SEDEKAH");
    expect(fundTypeOf("Kurban")).toBe("KURBAN");
    expect(fundTypeOf("Zakat Penghasilan")).toBe("ZAKAT");
    expect(fundTypeOf("sesuatu yang tidak dikenal")).toBe("ZAKAT");
  });
});
