/**
 * Donor and amil tracing of one activity from the same sources (Spec #100, Ticket #114).
 *
 * Runs through authenticated application HTTP (donor OTP session, operator workspace session)
 * over an isolated database, with allocations and realizations written by the real stores.
 * The certificate service is deliberately not configured here: that is the pending/failed
 * source case the projection has to state instead of turning into zero or success. The
 * configured chain path is covered by distribution_certificate_api.test.ts; the frozen report
 * snapshot path by disbursement_realization_source_api.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createContributionStore, CONTRIBUTION_SCHEMA_STATEMENTS } from "../src/contribution-store";
import { createActivityStore, ACTIVITY_SCHEMA_STATEMENTS, type ActivityStore } from "../src/activity-store";
import { createDisbursementStore, DISBURSEMENT_SCHEMA_STATEMENTS, type DisbursementStore } from "../src/disbursement-store";
import { createDonorAccessStore, DONOR_ACCESS_SCHEMA_STATEMENTS } from "../src/donor-access-store";
import { configureWorkspace, resetWorkspace, type RecipientMessageTransport } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { deliveryHeadline, differencesFromCurrent } from "../src/activity-trace";

const DONOR = "http://localhost:3001/api/donor";
const WORKSPACE = "http://localhost:3001/api/workspace";
const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";
const NOW = 1_800_000_000;
const amil = privateKeyToAccount(`0x${"b1".repeat(32)}` as Hex);
const admin = privateKeyToAccount(`0x${"a1".repeat(32)}` as Hex);

let database: TestWorkspaceDatabase;
let workspaceStore: WorkspaceStore;
let disbursement: DisbursementStore;
let activityStore: ActivityStore;
let clock = NOW;
let outbox: Array<{ to: string; body: string }> = [];
let failRealizationRead = false;
let sequence = 0;
const transport: RecipientMessageTransport = { async send(message) { outbox.push(message); } };

const call = (base: string, path: string, init: RequestInit = {}) => app.fetch(new Request(`${base}${path}`, init));
const authed = (token?: string): RequestInit => ({ headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function signIn(account: typeof amil, institutionId: string) {
  const { challenge, typedData } = await (await call(WORKSPACE, "/challenge", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institutionId, account: account.address }),
  })).json();
  const signature = await account.signTypedData({
    ...typedData,
    message: { ...typedData.message, nonce: challenge.nonce, issuedAt: BigInt(challenge.issuedAt), expiresAt: BigInt(challenge.expiresAt) },
  });
  const res = await call(WORKSPACE, "/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ institutionId, account: account.address, nonce: challenge.nonce, signature }),
  });
  return (await res.json()).token as string;
}

function configure() {
  const handle = database.handle();
  // A realization source that fails is the "source down" case: it must never read as zero.
  const flaky = new Proxy(disbursement, {
    get(target, prop, receiver) {
      if (prop === "getProposalRealizations" && failRealizationRead) return async () => { throw new Error("store down"); };
      return Reflect.get(target, prop, receiver);
    },
  });
  configureWorkspace({
    store: workspaceStore, disbursement: flaky, contributions: createContributionStore(handle), activities: activityStore,
    donorAccess: createDonorAccessStore(handle, Buffer.alloc(32, 7)), donorMessages: transport,
    ethCall: async () => "0x", now: () => clock, challengeTtlSeconds: 300, sessionTtlSeconds: 3600,
  });
}

beforeAll(async () => {
  database = await createTestWorkspaceDatabase();
  const handle = database.handle();
  workspaceStore = createWorkspaceStore(handle);
  disbursement = createDisbursementStore(handle);
  activityStore = createActivityStore(handle);
  await workspaceStore.ensureSchema();
  for (const statements of [DISBURSEMENT_SCHEMA_STATEMENTS, CONTRIBUTION_SCHEMA_STATEMENTS, ACTIVITY_SCHEMA_STATEMENTS, DONOR_ACCESS_SCHEMA_STATEMENTS]) {
    for (const statement of statements) await handle.execute(sql.raw(statement));
  }
});

let amilToken: string;
beforeEach(async () => {
  clock = NOW; outbox = []; failRealizationRead = false;
  await database.reset();
  configure();
  const db = database.handle();
  for (const inst of [SYNTHETIC_INSTITUTIONS[0], SYNTHETIC_INSTITUTIONS[1]]) {
    const r = institutionRecordOf(inst);
    await db.execute(sql`INSERT INTO institutions (id, legal_name, scope_unit, scope_level, mandate_note, is_synthetic)
      VALUES (${r.id}, ${r.legalName}, ${r.scopeUnit}, ${r.scopeLevel}, ${r.mandateNote}, true)`);
  }
  await db.execute(sql`INSERT INTO officer_profiles (id, institution_id, display_name, is_active)
    VALUES ('off-admin', ${SINAR}, 'Admin', true), ('off-amil', ${SINAR}, 'Amil', true)`);
  await db.execute(sql`INSERT INTO institution_memberships (institution_id, account_address, role, officer_id, is_active)
    VALUES (${SINAR}, ${admin.address.toLowerCase()}, 'ADMIN', 'off-admin', true),
           (${SINAR}, ${amil.address.toLowerCase()}, 'OFFICER', 'off-amil', true)`);
  amilToken = await signIn(amil, SINAR);
});

afterAll(async () => { resetWorkspace(); await database.close(); });

/** A program, approved proposal with one money line, and its activity, through the real activity store. */
async function seedActivity(approvedIdr = "1000000") {
  sequence += 1;
  const db = database.handle();
  const programId = `prog-${sequence}`, proposalId = `prop-${sequence}`, activityId = `act-${sequence}`;
  const line = { id: `line-${sequence}`, beneficiaryId: `ben-${sequence}`, aidType: "Bantuan tunai", period: "2026-03",
    value: { kind: "MONEY", amountRequestedIdr: approvedIdr, amountApprovedIdr: approvedIdr } };
  await db.execute(sql`INSERT INTO programs (id, institution_id, name, purpose, fund_type, scope, status, created_by, created_at, updated_at)
    VALUES (${programId}, ${SINAR}, 'Program', 'Bantuan', 'ZAKAT', 'Tahun 2026', 'ACTIVE', 'off-amil', ${NOW}, ${NOW})`);
  await db.execute(sql`INSERT INTO proposal_drafts (id, institution_id, program_id, created_by, purpose, beneficiaries_json, aid_lines_json, version, status, created_at, updated_at)
    VALUES (${proposalId}, ${SINAR}, ${programId}, 'off-amil', 'Penyaluran', '[]', ${JSON.stringify([line])}, 1, 'APPROVED', ${NOW}, ${NOW})`);
  await activityStore.createActivity(SINAR, { id: activityId, proposalId, name: "Kegiatan Bantuan" },
    { id: `op-act-${sequence}`, account: amil.address, requestHash: "seed" }, { account: amil.address, officerId: "off-amil" }, NOW);
  return { proposalId, activityId, line };
}

async function realize(seed: Awaited<ReturnType<typeof seedActivity>>, amountIdr: string) {
  sequence += 1;
  const { records } = await disbursement.recordRealizations(SINAR, seed.proposalId,
    { items: [{ aidLineId: seed.line.id, beneficiaryId: seed.line.beneficiaryId, paymentRecipient: null, method: "BANK_TRANSFER", amountIdr, reportedAt: NOW, notes: null }], batchGroupId: null, expectedVersion: 1 },
    { id: `op-real-${sequence}`, account: amil.address, requestHash: "seed" }, { account: amil.address, officerId: "off-amil" }, NOW);
  return records[0]!.id as string;
}

async function contribute(activityId: string | null, amountExact: string, donorName: string, contact: string) {
  sequence += 1;
  const id = `contrib-${sequence}`;
  const db = database.handle();
  await db.execute(sql`INSERT INTO contributions (id, institution_id, source_channel, source_reference, currency_unit, amount_exact, fund_type, purpose,
      received_at, donor_name, donor_contact, status, version, reconciled_at, endorsed_at, created_at, updated_at, created_by)
    VALUES (${id}, ${SINAR}, 'BANK_TRANSFER', ${`TRX-${id}`}, 'IDR', ${amountExact}, 'ZAKAT', 'Bantuan', ${NOW - 100}, ${donorName}, ${contact},
      'ENDORSED', 1, ${NOW}, ${NOW}, ${NOW}, ${NOW}, 'off-amil')`);
  if (activityId) {
    await db.execute(sql`INSERT INTO contribution_allocations (id, institution_id, contribution_id, activity_id, currency_unit, amount_exact, fund_type, purpose, reason,
        status, allocated_at, allocated_by, contribution_version, version, created_at, updated_at)
      VALUES (${`alloc-${id}`}, ${SINAR}, ${id}, ${activityId}, 'IDR', ${amountExact}, 'ZAKAT', 'Bantuan', 'Alokasi', 'ACTIVE', ${NOW}, 'off-amil', 1, 1, ${NOW}, ${NOW})`);
  }
  return id;
}

async function donorSession(contributionId: string) {
  const { challengeId } = await (await call(DONOR, "/otp-challenge", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference: contributionId }),
  })).json();
  const otpCode = outbox.at(-1)!.body.match(/\b(\d{6})\b/)![1];
  const { sessionToken } = await (await call(DONOR, "/session", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challengeId, otpCode }),
  })).json();
  return sessionToken as string;
}

const donorTrace = async (contributionId: string, token: string) => {
  const res = await call(DONOR, `/contributions/${contributionId}/trace`, authed(token));
  expect(res.status).toBe(200);
  return (await res.json()).trace;
};

describe("donor trace (Ticket #114)", () => {
  it("shows one contribution's own allocation with the shared progress, and no other donor", async () => {
    const seed = await seedActivity();
    const mine = await contribute(seed.activityId, "600000", "Donatur Satu", "081200000001");
    await contribute(seed.activityId, "400000", "Donatur Dua", "081200000002");
    await realize(seed, "400000");

    const trace = await donorTrace(mine, await donorSession(mine));
    expect(trace.contribution.id).toBe(mine);
    expect(trace.receiptVerifierPath).toBe(`/api/public/receipt-verification/${mine}`);
    expect(trace.activities).toHaveLength(1);
    const activity = trace.activities[0];
    expect(activity.allocatedAmountExact).toBe("600000");
    expect(activity.pooledAllocationCount).toBe(2);
    expect(activity.allocationBasis).toBe("CURRENT");
    expect(activity.track.funds.data.totalAllocatedAmount).toBe("1000000");
    expect(activity.track.distribution.data.recordedRealizations).toBe(1);
    expect(activity.track.summary.data.headline).toBe("IN_PROGRESS");
    expect(trace.claimLimits.pooled).toContain("tidak dinyatakan membiayai paket atau penerima tertentu");

    const text = JSON.stringify(trace);
    for (const secret of ["Donatur Dua", "081200000002", "TRX-", "ben-", "off-amil"]) expect(text).not.toContain(secret);
  });

  it("does not hide open items behind 'all delivered'; unreadable certificates are not success", async () => {
    const seed = await seedActivity();
    const mine = await contribute(seed.activityId, "1000000", "Donatur Satu", "081200000001");
    const realizationId = await realize(seed, "1000000");
    const token = await donorSession(mine);

    let { activities: [activity] } = await donorTrace(mine, token);
    expect(activity.track.summary.data.headline).toBe("DELIVERED_WITH_OPEN_ITEMS");
    expect(activity.track.summary.data.openItems).toContain("CONFIRMATION_PENDING");
    // Certificate service absent on this deployment: stated, never zero and never "terbit".
    expect(activity.track.certificates.status).toBe("UNAVAILABLE");
    expect(activity.track.summary.data.openItems).toContain("SOURCE_UNAVAILABLE");

    await database.handle().execute(sql`UPDATE disbursement_realizations SET confirmation_status = 'DISPUTED' WHERE id = ${realizationId}`);
    ({ activities: [activity] } = await donorTrace(mine, token));
    expect(activity.track.confirmation.data).toEqual({ total: 1, confirmed: 0, disputed: 1, unconfirmed: 0 });
    expect(activity.track.summary.data.openItems).toContain("DISPUTE_OPEN");
    // The dispute sits in its own track; the funds and delivery tracks are unchanged.
    expect(activity.track.distribution.data.recordedRealizations).toBe(1);
  });

  it("a failed realization read is UNAVAILABLE, not zero, and leaves the other tracks", async () => {
    const seed = await seedActivity();
    const mine = await contribute(seed.activityId, "1000000", "Donatur Satu", "081200000001");
    await realize(seed, "1000000");
    const token = await donorSession(mine);

    failRealizationRead = true;
    const { activities: [activity] } = await donorTrace(mine, token);
    for (const key of ["distribution", "confirmation", "summary"]) {
      expect(activity.track[key].status).toBe("UNAVAILABLE");
      expect(activity.track[key].reason).toBeString();
    }
    expect(activity.track.funds.status).toBe("OK");
    expect(activity.track.funds.data.totalAllocatedAmount).toBe("1000000");
  });

  it("marks an allocation made before a correction and lists a reallocation of the donor's own funds", async () => {
    const seed = await seedActivity();
    const other = await seedActivity();
    const mine = await contribute(seed.activityId, "1000000", "Donatur Satu", "081200000001");
    const db = database.handle();
    await db.execute(sql`UPDATE contributions SET version = 2 WHERE id = ${mine}`);
    await db.execute(sql`UPDATE contribution_allocations SET status = 'REALLOCATED', amount_exact = '1000000' WHERE contribution_id = ${mine}`);
    await db.execute(sql`INSERT INTO contribution_allocations (id, institution_id, contribution_id, activity_id, currency_unit, amount_exact, fund_type, purpose, reason,
        status, allocated_at, allocated_by, contribution_version, version, created_at, updated_at)
      VALUES ('alloc-target', ${SINAR}, ${mine}, ${other.activityId}, 'IDR', '1000000', 'ZAKAT', 'Bantuan', 'Alih', 'ACTIVE', ${NOW + 10}, 'off-amil', 1, 1, ${NOW}, ${NOW})`);
    await db.execute(sql`INSERT INTO reallocation_decisions (id, institution_id, source_activity_id, target_activity_id, source_allocation_id, target_allocation_id,
        contribution_id, amount_exact, fund_type, purpose, reason, decided_by_account, source_activity_version, target_activity_version,
        source_allocation_version, target_allocation_version, occurred_at, created_at)
      VALUES ('re-1', ${SINAR}, ${seed.activityId}, ${other.activityId}, ${`alloc-${mine}`}, 'alloc-target', ${mine}, '1000000', 'ZAKAT', 'Bantuan',
        'Sisa dialihkan', 'private-account', 1, 1, 1, 1, ${NOW + 10}, ${NOW + 10})`);

    const trace = await donorTrace(mine, await donorSession(mine));
    expect(trace.contribution.version).toBe(2);
    expect(trace.activities).toHaveLength(1);
    expect(trace.activities[0].allocationBasis).toBe("BEFORE_CORRECTION");
    expect(trace.changes).toEqual([{ kind: "REALLOCATED", amountExact: "1000000", currencyUnit: "IDR", toActivityName: "Kegiatan Bantuan", at: NOW + 10, reason: "Sisa dialihkan" }]);
    expect(JSON.stringify(trace)).not.toContain("private-account");
  });

  it("separates refund decisions from payments and scopes the safe history to this session", async () => {
    const mine = await contribute(null, "1000000", "Donatur Satu", "081200000001");
    const other = await contribute(null, "1000000", "Donatur Dua", "081200000002");
    const token = await donorSession(mine);
    expect((await donorTrace(mine, token)).refunds).toEqual({ status: "OK", data: [] });
    for (const id of [mine, other]) await database.handle().execute(sql`INSERT INTO contribution_refunds
      (id, institution_id, contribution_id, amount_exact, currency_unit, fund_type, reason, policy_basis, status, contribution_version, decided_at, decided_by, payment_proof_ref, payment_notes, created_at, updated_at)
      VALUES (${`refund-${id}`}, ${SINAR}, ${id}, '200000', 'IDR', 'ZAKAT', 'private-reason', 'private-policy', 'DECIDED', 1, ${NOW}, 'private-operator', 'private-proof', 'private-notes', ${NOW}, ${NOW})`);
    const expected = { id: `refund-${mine}`, status: "DECIDED", amountExact: "200000", currencyUnit: "IDR", decidedAt: NOW, paidAt: null };
    expect((await donorTrace(mine, token)).refunds).toEqual({ status: "OK", data: [expected] });
    await database.handle().execute(sql`UPDATE contribution_refunds SET status = 'PAID', paid_at = ${NOW + 10} WHERE contribution_id = ${mine}`);
    const trace = await donorTrace(mine, token);
    expect(trace.refunds).toEqual({ status: "OK", data: [{ ...expected, status: "PAID", paidAt: NOW + 10 }] });
    expect(JSON.stringify(trace)).not.toContain("private-");
    expect(JSON.stringify(trace)).not.toContain(`refund-${other}`);
    await database.handle().execute(sql`ALTER TABLE contribution_refunds RENAME TO unavailable_refunds`);
    try { expect((await donorTrace(mine, token)).refunds.status).toBe("UNAVAILABLE"); }
    finally { await database.handle().execute(sql`ALTER TABLE unavailable_refunds RENAME TO contribution_refunds`); }
  });

  it("is confined to the session's own contribution and requires a session", async () => {
    const seed = await seedActivity();
    const first = await contribute(seed.activityId, "300000", "Donatur Satu", "081200000001");
    const second = await contribute(seed.activityId, "300000", "Donatur Satu", "081200000001");
    const token = await donorSession(first);

    expect((await call(DONOR, `/contributions/${second}/trace`, authed(token))).status).toBe(403);
    expect((await call(DONOR, `/contributions/${first}/trace`)).status).toBe(401);
    // An operator session is not a donor session.
    expect((await call(DONOR, `/contributions/${first}/trace`, authed(amilToken))).status).toBe(401);
    const denied = await (await call(DONOR, `/contributions/${second}/trace`, authed(token))).text();
    expect(denied).not.toContain("Kegiatan Bantuan");
  });
});

describe("amil recap (Ticket #114)", () => {
  it("serves the same activity tracks as the donor, from the workspace session", async () => {
    const seed = await seedActivity();
    const mine = await contribute(seed.activityId, "600000", "Donatur Satu", "081200000001");
    await realize(seed, "400000");

    const res = await call(WORKSPACE, `/activities/${seed.activityId}/trace`, authed(amilToken));
    expect(res.status).toBe(200);
    const { trace } = await res.json();
    const donor = await donorTrace(mine, await donorSession(mine));

    // Same identity, version and figures: nothing recomputed by the amil view.
    const { observedAt: _a, ...amilIdentity } = trace.activity.identity;
    const { observedAt: _d, ...donorIdentity } = donor.activities[0].track.identity;
    expect(amilIdentity).toEqual(donorIdentity);
    expect(trace.activity.funds).toEqual(donor.activities[0].track.funds);
    expect(trace.activity.distribution).toEqual(donor.activities[0].track.distribution);
    expect(trace.activity.confirmation).toEqual(donor.activities[0].track.confirmation);
    // No evidence store here: stated as unavailable, not as "no report sources".
    expect(trace.reportSources.status).toBe("UNAVAILABLE");
    expect(trace.claimLimits.report).toContain("Snapshot historis tidak menggantikan status kegiatan terkini");
    // Donor identity does not travel with the recap.
    expect(JSON.stringify(trace)).not.toContain("Donatur Satu");
  });

  it("refuses without a session, another institution and an unknown activity", async () => {
    const seed = await seedActivity();
    expect((await call(WORKSPACE, `/activities/${seed.activityId}/trace`)).status).toBe(401);
    const cross = await call(WORKSPACE, `/activities/${seed.activityId}/trace?institutionId=${BAITUL}`, authed(amilToken));
    expect(cross.status).not.toBe(200);
    expect((await call(WORKSPACE, `/activities/act-unknown/trace`, authed(amilToken))).status).toBe(404);
  });
});

describe("browser (Ticket #114)", () => {
  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "donor and amil screens read the same tracks, keep pending sources visible and recover by keyboard on a phone",
    async () => {
      const seed = await seedActivity();
      const mine = await contribute(seed.activityId, "600000", "Donatur Satu", "081200000001");
      await contribute(seed.activityId, "400000", "Donatur Dua", "081200000002");
      const realizationId = await realize(seed, "1000000");
      await database.handle().execute(sql`UPDATE disbursement_realizations SET confirmation_status = 'DISPUTED' WHERE id = ${realizationId}`);
      const token = await donorSession(mine);

      const build = Bun.spawn(["bun", "build", new URL("../../frontend/test/activity-trace-smoke.tsx", import.meta.url).pathname, "--target", "browser"], { stdout: "pipe", stderr: "pipe" });
      const bundle = await new Response(build.stdout).text();
      if ((await build.exited) !== 0) throw new Error(await new Response(build.stderr).text());
      const cssBuild = Bun.spawn(["bun", new URL("../../frontend/test/build-smoke-css.ts", import.meta.url).pathname], { stdout: "pipe", stderr: "pipe" });
      const css = await new Response(cssBuild.stdout).text();
      if ((await cssBuild.exited) !== 0) throw new Error(await new Response(cssBuild.stderr).text());

      const server = Bun.serve({
        hostname: "127.0.0.1", port: 0,
        async fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/") return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/smoke.css"><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
          if (path === "/smoke.css") return new Response(css, { headers: { "Content-Type": "text/css" } });
          if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
          if (path === "/bootstrap") return Response.json({
            workspaceToken: amilToken, activityId: seed.activityId,
            donorSession: { token, contributionId: mine, expiresAt: NOW + 3600 },
          });
          return app.fetch(req);
        },
      });

      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
      try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        page.setDefaultTimeout(10000);
        page.on("pageerror", (error: Error) => console.error(error));
        await page.goto(server.url.toString());

        const donor = page.getByTestId("donor");
        const amilPanel = page.getByTestId("amil");
        await donor.getByText("Bagian Anda", { exact: false }).waitFor();
        // Delivery is complete, and the screen still says what is open around it.
        await donor.getByText("Seluruh paket diserahkan, masih ada yang terbuka").waitFor();
        await donor.getByText("Ada sengketa penyerahan").waitFor();
        await donor.getByText("Ada sumber yang belum dapat dibaca").waitFor();
        // The NFT track is pending/unreadable, not an empty success.
        await donor.getByRole("alert").filter({ hasText: "Layanan sertifikat tahap distribusi belum dikonfigurasi" }).waitFor();
        await donor.getByText("NFT bukan laporan periode dua pengesahan", { exact: false }).waitFor();
        // Another donor is not present anywhere on the page.
        const html = await page.content();
        expect(html).not.toContain("Donatur Dua");
        expect(html).not.toContain("081200000002");

        // The amil recap reads the same figures and states the report source honestly.
        await amilPanel.getByRole("heading", { name: "Status kegiatan terkini" }).waitFor();
        await amilPanel.getByText("Seluruh paket diserahkan, masih ada yang terbuka").waitFor();
        await amilPanel.getByRole("alert").filter({ hasText: "Penyimpanan bukti laporan belum dikonfigurasi" }).waitFor();

        // Phone width: no sideways scroll.
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

        // A failing source is stated, and reload by keyboard recovers it.
        failRealizationRead = true;
        const reload = donor.getByRole("button", { name: "Muat ulang penelusuran" });
        await reload.focus();
        await page.keyboard.press("Enter");
        await donor.getByRole("alert").filter({ hasText: "Catatan realisasi tidak dapat dibaca" }).first().waitFor();
        expect(await donor.getByText("Ada sengketa penyerahan").count()).toBe(0);
        failRealizationRead = false;
        await reload.focus();
        await page.keyboard.press("Enter");
        await donor.getByText("Ada sengketa penyerahan").waitFor();
      } finally {
        await browser.close();
        server.stop(true);
      }
    },
    60_000,
  );
});

describe("trace rules", () => {
  const accountability = (overrides: Record<string, unknown> = {}) => ({
    unitSummaries: [{ aidType: "Tunai", unit: "IDR", approved: "100", realized: "100", remaining: "0" }],
    totalCommittedAidIdr: "0", isRemainderClosed: false, hasOutstandingAccountability: false,
    hasUnvaluedGoods: false, totalContributionShortfall: "0", totalOverCommitmentIdr: "0", ...overrides,
  });
  const settled = { total: 1, confirmed: 1, disputed: 0, unconfirmed: 0 };

  it("only reports a settled delivery when nothing else is open", () => {
    expect(deliveryHeadline({ accountability: accountability(), recordedRealizations: 1, confirmation: settled, publicationPending: false, sourceGaps: false }))
      .toEqual({ headline: "DELIVERED_AND_SETTLED", openItems: [] });
    expect(deliveryHeadline({ accountability: accountability({ hasOutstandingAccountability: true }), recordedRealizations: 1, confirmation: settled, publicationPending: true, sourceGaps: false }))
      .toEqual({ headline: "DELIVERED_WITH_OPEN_ITEMS", openItems: ["COSTS_UNACCOUNTED", "PUBLICATION_PENDING"] });
    expect(deliveryHeadline({ accountability: accountability(), recordedRealizations: 0, confirmation: null, publicationPending: null, sourceGaps: false }).headline).toBe("NOT_STARTED");
    expect(deliveryHeadline({
      accountability: accountability({ unitSummaries: [{ aidType: "Beras", unit: "kg", approved: "10", realized: "4", remaining: "6" }] }),
      recordedRealizations: 1, confirmation: settled, publicationPending: false, sourceGaps: false,
    }).headline).toBe("IN_PROGRESS");
  });

  it("names what a frozen snapshot no longer matches", () => {
    const frozen = { proposalVersion: 1, allocatedByUnit: { IDR: "500" }, realizationCount: 2 };
    const same = { proposalVersion: 1, currencyUnit: "IDR", totalAllocatedAmount: "500", recordedRealizations: 2 };
    expect(differencesFromCurrent(frozen, same)).toEqual([]);
    expect(differencesFromCurrent(frozen, { ...same, proposalVersion: 2, totalAllocatedAmount: "550", recordedRealizations: 3 }))
      .toEqual(["PROPOSAL_VERSION", "ALLOCATED_TOTAL", "REALIZATION_COUNT"]);
    // An unreadable live count is not compared, so it cannot fake a difference or a match.
    expect(differencesFromCurrent(frozen, { ...same, recordedRealizations: null })).toEqual([]);
  });
});
