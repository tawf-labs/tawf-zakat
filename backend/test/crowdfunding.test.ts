import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { createCrowdfundingStore, crowdfundingStoreFromEnv, type CrowdfundingStore } from "../src/crowdfunding-store";
import { createCrowdfundingRoutes } from "../src/routes/crowdfunding";
import { drainCampaignOutbox, hash, secret, type CampaignRuntime } from "../src/crowdfunding";
import { CampaignGatewayError, crowdfundingGatewayFromEnv } from "../src/crowdfunding-midtrans";
import legacyApp from "../src/index";
import { configureCrowdfundingForTests } from "../src/crowdfunding-runtime";

let db: PGlite;
let store: CrowdfundingStore;
let runtime: CampaignRuntime;
let app: ReturnType<typeof createCrowdfundingRoutes>;
let status: Record<string, any>;
let checkoutFails = false;
let observedIntent = false;
const fields = { title: "Community learning", summary: "Help students", story: "Public campaign story", category: "EDUCATION", targetAmount: 500000, endsAt: "2099-10-10T00:00:00.000Z", beneficiaryName: "PRIVATE BENEFICIARY", relationship: "Teacher", budgetPlan: "PRIVATE BUDGET", distributionPlan: "PRIVATE PLAN", consent: true };
async function request(path: string, method = "GET", body?: unknown, token?: string, paymentToken?: string) {
  const response = await app.request(path, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(paymentToken ? { "X-Payment-Token": paymentToken } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() as any };
}
async function register(email = "owner@example.com") {
  const r = await request("/auth/register", "POST", { name: "Owner", email, password: "long-password-123", kind: "INDIVIDUAL" });
  expect(r.status).toBe(201); return r.body;
}
async function operatorToken() {
  const token = secret();
  await store.transaction(s => { s.users.operator = { id: "operator", name: "Reviewer", email: "operator@example.com", kind: "INDIVIDUAL", role: "OPERATOR" }; s.sessions[hash(token)] = { userId: "operator", expiresAt: Date.now() + 100000 }; });
  return token;
}
async function approved(publish = true) {
  const owner = await register(); const op = await operatorToken();
  const created = await request("/campaigns", "POST", fields, owner.token); const id = created.body.campaign.id;
  expect((await request(`/campaigns/${id}/submit`, "POST", undefined, owner.token)).status).toBe(200);
  expect((await request(`/campaigns/${id}/review`, "POST", { expectedVersion: 1, decision: "APPROVE", notes: "Evidence reviewed", checks: { identity: true, consent: true, needs: true, budget: true, distribution: true }, complianceReference: "Legal review reference 001" }, op)).status).toBe(200);
  if (publish) expect((await request(`/campaigns/${id}/publish`, "POST", { expectedVersion: 1 }, op)).status).toBe(200);
  return { owner, op, id };
}
async function donate(id: string) {
  const r = await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "PRIVATE DONOR", isAnonymous: true });
  expect(r.status).toBe(201); return r.body.payment;
}
beforeEach(async () => {
  db = new PGlite();
  await db.exec(await Bun.file(new URL("../migrations/crowdfunding.sql", import.meta.url)).text());
  store = createCrowdfundingStore(db);
  checkoutFails = false; observedIntent = false;
  status = { currency: "IDR", gross_amount: "10000.00", transaction_status: "settlement", fraud_status: "accept" };
  runtime = { store, chain: null, documentKey: Buffer.alloc(32, 42), gateway: {
    async create(id) { observedIntent = await store.transaction(s => !!s.payments[id]); if (checkoutFails) throw new Error("timeout"); return { token: "sandbox-token", redirectUrl: "https://app.sandbox.midtrans.com/snap/test" }; },
    async status(id) { return { order_id: id, ...status }; },
    verify(body) { return body.signature_key === "test-trusted-signature"; },
  } };
  app = createCrowdfundingRoutes(runtime);
});
afterEach(async () => { configureCrowdfundingForTests(null); await db.close(); });

describe("crowdfunding authentication and durable isolation", () => {
  test("unconfigured fails closed and test environments never connect using env URLs", async () => {
    const unavailable = createCrowdfundingRoutes(null);
    expect((await unavailable.request("/campaigns")).status).toBe(503);
    const previous = process.env.CROWDFUNDING_DATABASE_URL;
    process.env.CROWDFUNDING_DATABASE_URL = "postgres://production.invalid/database";
    expect(crowdfundingStoreFromEnv()).toBeNull();
    if (previous === undefined) delete process.env.CROWDFUNDING_DATABASE_URL; else process.env.CROWDFUNDING_DATABASE_URL = previous;
    expect(crowdfundingGatewayFromEnv()).toBeNull();
  });
  test("hashed credentials and opaque revocable sessions; no operator registration", async () => {
    const auth = await register();
    const persisted = await store.transaction(s => ({ user: s.users[auth.user.id], sessions: s.sessions }));
    expect(persisted.user.passwordHash).toStartWith("$argon2id$");
    expect(persisted.sessions[auth.token]).toBeUndefined();
    expect(persisted.sessions[hash(auth.token)]).toBeDefined();
    expect(auth.user.passwordHash).toBeUndefined();
    expect((await request("/auth/register", "POST", { name: "Escalation", email: "op@example.com", password: "long-password-123", kind: "INDIVIDUAL", role: "OPERATOR" })).status).toBe(400);
    expect((await request("/review", "GET", undefined, auth.token)).status).toBe(403);
    expect((await request("/auth/login", "POST", { email: "owner@example.com", password: "incorrect" })).status).toBe(401);
    const login = await request("/auth/login", "POST", { email: "OWNER@example.com", password: "long-password-123" });
    expect(login.status).toBe(200);
    expect((await request("/auth/logout", "POST", undefined, login.body.token)).status).toBe(200);
    expect((await request("/auth/me", "GET", undefined, login.body.token)).status).toBe(401);
    app = createCrowdfundingRoutes({ ...runtime, store: createCrowdfundingStore(db) });
    expect((await request("/auth/me", "GET", undefined, auth.token)).body.user.id).toBe(auth.user.id);
  });
  test("login failures are persistently throttled", async () => {
    for (let i = 0; i < 10; i++) expect((await request("/auth/login", "POST", { email: "missing@example.com", password: "incorrect" })).status).toBe(401);
    expect((await request("/auth/login", "POST", { email: "missing@example.com", password: "incorrect" })).status).toBe(429);
  });
  test("transaction rollback and multiple store instances preserve atomic state", async () => {
    await expect(store.transaction(s => { s.users.partial = {}; throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect(await store.transaction(s => s.users.partial)).toBeUndefined();
    const second = createCrowdfundingStore(db);
    await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? store : second).transaction(s => { s.users[`user-${i}`] = { id: i }; })));
    expect(await store.transaction(s => Object.keys(s.users).length)).toBe(8);
  });
});

describe("campaign workflow and privacy", () => {
  test("published campaign reopening pauses payment and keeps old public material through reapproval", async () => {
    const { id, op, owner } = await approved();
    const previousEvents = await store.transaction(s => Object.values(s.outbox).map(e => ({ id: e.eventId, hash: e.payloadHash })));
    expect((await request(`/campaigns/${id}/reopen`, "POST", { expectedVersion: 1, reason: "Need revised distribution evidence" }, owner.token)).status).toBe(403);
    expect((await request(`/campaigns/${id}/reopen`, "POST", { expectedVersion: 2, reason: "Stale review" }, op)).status).toBe(409);
    expect((await request(`/campaigns/${id}/reopen`, "POST", { expectedVersion: 1, reason: "Need revised distribution evidence" }, op)).body.campaign.status).toBe("REVISION_REQUESTED");
    await request(`/campaigns/${id}`, "PATCH", { title: "Revised public title", story: "UNAPPROVED STORY", targetAmount: 900000, coverImageUrl: "https://example.com/unapproved.png" }, owner.token);
    let publicCampaign = (await request(`/campaigns/${id}`)).body.campaign;
    expect(publicCampaign.story).toBe(fields.story); expect(publicCampaign.targetAmount).toBe(fields.targetAmount); expect(publicCampaign.version).toBe(1); expect(publicCampaign.status).toBe("REVISION_REQUESTED"); expect(publicCampaign.coverImageUrl).toBeUndefined();
    expect((await request(`/campaigns/${id}`, "GET", undefined, owner.token)).body.campaign.story).toBe("UNAPPROVED STORY");
    expect((await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "Donor", isAnonymous: false })).status).toBe(409);
    expect((await request(`/campaigns/${id}/submit`, "POST", undefined, owner.token)).body.campaign.version).toBe(2);
    expect((await request(`/campaigns/${id}`)).body.campaign.version).toBe(1);
    await request(`/campaigns/${id}/review`, "POST", { expectedVersion: 2, decision: "APPROVE", notes: "Revised evidence accepted", checks: { identity: true, consent: true, needs: true, budget: true, distribution: true }, complianceReference: "Compliance revision 2" }, op);
    publicCampaign = (await request(`/campaigns/${id}`)).body.campaign; expect(publicCampaign.status).toBe("APPROVED"); expect(publicCampaign.story).toBe(fields.story);
    expect((await request("/campaigns")).body.campaigns[0].version).toBe(1);
    await request(`/campaigns/${id}/publish`, "POST", { expectedVersion: 2 }, op);
    publicCampaign = (await request(`/campaigns/${id}`)).body.campaign; expect(publicCampaign.version).toBe(2); expect(publicCampaign.story).toBe("UNAPPROVED STORY"); expect(publicCampaign.targetAmount).toBe(900000);
    await donate(id);
    const saved = await store.transaction(s => ({ versions: s.campaigns[id].versions, events: previousEvents.map(e => s.outbox[e.id].payloadHash) }));
    expect(saved.versions[0].fields.story).toBe(fields.story); expect(saved.versions[1].fields.story).toBe("UNAPPROVED STORY"); expect(saved.events).toEqual(previousEvents.map(e => e.hash));
  });
  test("reopening approved never-published proposals stays private", async () => {
    const { id, op } = await approved(false);
    expect((await request(`/campaigns/${id}/reopen`, "POST", { expectedVersion: 1, reason: "More evidence required" }, op)).status).toBe(200);
    expect((await request(`/campaigns/${id}`)).status).toBe(404);
    expect((await request("/campaigns")).body.campaigns).toHaveLength(0);
  });
  test("revision freezes historical versions; only independent operators approve and publish", async () => {
    const auth = await register(); const op = await operatorToken();
    const create = await request("/campaigns", "POST", fields, auth.token); const id = create.body.campaign.id;
    expect((await request(`/campaigns/${id}`)).status).toBe(404);
    expect((await request(`/campaigns/${id}/publish`, "POST", { expectedVersion: 1 }, auth.token)).status).toBe(403);
    expect((await request(`/campaigns/${id}/publish`, "POST", { expectedVersion: 1 }, op)).status).toBe(409);
    expect((await request(`/campaigns/${id}/submit`, "POST", undefined, auth.token)).status).toBe(200);
    expect((await request(`/campaigns/${id}`, "PATCH", { title: "mutate frozen" }, auth.token)).status).toBe(409);
    expect((await request(`/campaigns/${id}/review`, "POST", { expectedVersion: 1, decision: "APPROVE", notes: "unchecked" }, op)).status).toBe(400);
    expect((await request(`/campaigns/${id}/review`, "POST", { expectedVersion: 1, decision: "REQUEST_REVISION", notes: "Clarify budget" }, op)).body.campaign.status).toBe("REVISION_REQUESTED");
    expect((await request(`/campaigns/${id}`, "PATCH", { title: "Revised title" }, auth.token)).status).toBe(200);
    expect((await request(`/campaigns/${id}/submit`, "POST", undefined, auth.token)).body.campaign.version).toBe(2);
    expect((await request(`/campaigns/${id}/review`, "POST", { expectedVersion: 1, decision: "REJECT", notes: "Stale reviewer" }, op)).status).toBe(409);
    const versions = await store.transaction(s => s.campaigns[id].versions);
    expect(versions[0].fields.title).toBe(fields.title); expect(versions[1].fields.title).toBe("Revised title");
    await store.transaction(s => { s.users[auth.user.id].role = "OPERATOR"; });
    expect((await request(`/campaigns/${id}/review`, "POST", { expectedVersion: 1, decision: "REJECT", notes: "Self review" }, auth.token)).status).toBe(403);
  });
  test("stale publication refused; published cancellations stay public but unpublished cancellations stay private", async () => {
    const { id, op, owner } = await approved(false);
    expect((await request(`/campaigns/${id}/publish`, "POST", { expectedVersion: 2 }, op)).status).toBe(409);
    expect((await request(`/campaigns/${id}/publish`, "POST", { expectedVersion: 1 }, op)).status).toBe(200);
    expect((await request(`/campaigns/${id}/status`, "POST", { status: "CANCELLED", reason: "Organizer cannot proceed" }, op)).status).toBe(200);
    const visible = await request(`/campaigns/${id}`); expect(visible.status).toBe(200); expect(visible.body.campaign.publishedAt).toBeDefined();
    expect((await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "Donor", isAnonymous: false })).status).toBe(409);
    const draft = (await request("/campaigns", "POST", fields, owner.token)).body.campaign.id;
    await request(`/campaigns/${draft}/status`, "POST", { status: "CANCELLED", reason: "Withdrawn before review" }, op);
    expect((await request(`/campaigns/${draft}`)).status).toBe(404);
  });
  test("public DTO never discloses documents, review notes, owner email or private beneficiary data", async () => {
    const { id, owner, op } = await approved();
    const publicResult = await request(`/campaigns/${id}`);
    expect(publicResult.body.campaign.targetAmount).toBe(fields.targetAmount);
    expect(publicResult.body.campaign.chainStatus).toBe("UNCONFIGURED");
    const serialized = JSON.stringify(publicResult.body);
    for (const secret of ["PRIVATE", "owner@example", "reviewNotes", "documents", "complianceReference", "actorId"]) expect(serialized).not.toContain(secret);
    expect((await request(`/campaigns/${id}`, "GET", undefined, owner.token)).body.campaign.beneficiaryName).toBe(fields.beneficiaryName);
    expect((await request(`/campaigns/${id}/status`, "POST", { status: "CLOSED", reason: "Funding period concluded" }, op)).status).toBe(200);
    expect((await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "Donor", isAnonymous: false })).status).toBe(409);
  });
  test("private document upload validation, download ownership and frozen versions", async () => {
    const auth = await register(); const other = await register("other@example.com");
    const id = (await request("/campaigns", "POST", fields, auth.token)).body.campaign.id;
    const file = { name: "identity.pdf", contentType: "application/pdf", dataBase64: Buffer.from("%PDF-1.7 private document").toString("base64") };
    expect((await request(`/campaigns/${id}/documents`, "POST", { ...file, name: "../secret" }, auth.token)).status).toBe(400);
    expect((await request(`/campaigns/${id}/documents`, "POST", { ...file, dataBase64: Buffer.from("<script>").toString("base64") }, auth.token)).status).toBe(400);
    expect((await request(`/campaigns/${id}/documents`, "POST", file, other.token)).status).toBe(403);
    const uploaded = await request(`/campaigns/${id}/documents`, "POST", file, auth.token);
    expect(uploaded.status).toBe(201);
    const document = uploaded.body.campaign.documents[0]; expect(document.dataBase64).toBeUndefined(); expect(document.encrypted).toBeUndefined();
    const stored = await store.transaction(s => s.campaigns[id].documents[0]);
    expect(stored.dataBase64).toBeUndefined(); expect(stored.encrypted.algorithm).toBe("AES-256-GCM");
    expect(JSON.stringify(stored)).not.toContain(file.dataBase64);
    const key = runtime.documentKey; runtime.documentKey = null;
    expect((await request(`/campaigns/${id}/documents`, "POST", file, auth.token)).status).toBe(503);
    runtime.documentKey = key;
    const path = `/campaigns/${id}/documents/${document.id}`;
    expect((await request(path)).status).toBe(401);
    expect((await request(path, "GET", undefined, other.token)).status).toBe(403);
    const downloaded = await app.request(path, { headers: { Authorization: `Bearer ${auth.token}` } });
    expect(downloaded.headers.get("content-disposition")).toStartWith("attachment;");
    expect(await downloaded.text()).toBe("%PDF-1.7 private document");
    runtime.documentKey = Buffer.alloc(32, 43);
    expect((await request(path, "GET", undefined, auth.token)).status).toBe(503);
    runtime.documentKey = key;
    const oversized = await app.request(`/campaigns/${id}/documents`, { method: "POST", headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" }, body: "not-json".repeat(400000) });
    expect(oversized.status).toBe(413);
    await request(`/campaigns/${id}/submit`, "POST", undefined, auth.token);
    expect((await request(`/campaigns/${id}/documents`, "POST", file, auth.token)).status).toBe(409);
    const op = await operatorToken();
    await request(`/campaigns/${id}/review`, "POST", { expectedVersion: 1, decision: "APPROVE", notes: "Evidence reviewed", checks: { identity: true, consent: true, needs: true, budget: true, distribution: true }, complianceReference: "Compliance reference" }, op);
    const saved = await store.transaction(s => ({ c: s.campaigns[id], event: Object.values(s.outbox)[0] }));
    const frozen = saved.c.versions[0];
    expect(frozen.documents[0].contentHash).toBe(hash(Buffer.from(file.dataBase64, "base64")));
    const proposal = { version: 1, fields: frozen.fields, documents: frozen.documents.map((d: any) => ({ id: d.id, contentHash: d.contentHash, name: d.name, contentType: d.contentType, size: d.size })), review: saved.c.reviewNotes };
    const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
    expect(saved.event.snapshot.proposalDigest).toBe(`0x${hash(JSON.stringify(canonical({ salt: saved.event.salt, proposal })))}`);
    expect(JSON.stringify(saved.event.snapshot)).not.toContain("PRIVATE");
    expect((await request(`/campaigns/${id}`, "GET", undefined, auth.token)).body.campaign.chainEvents[0]).not.toHaveProperty("snapshot");
  });
});

describe("authoritative sandbox payment accounting and outbox", () => {
  test("checkout timeout before order creation recovers same intent and amount exactly once", async () => {
    const { id } = await approved(); const calls: any[] = []; const original = runtime.gateway!.create;
    runtime.gateway!.create = async (...args) => { calls.push(args); return original(...args); };
    checkoutFails = true;
    const failed = await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "Donor", isAnonymous: false });
    expect(failed.status).toBe(502); const p = failed.body.payment;
    expect((await request(`/payments/${p.id}/retry`, "POST", undefined, undefined, "wrong")).status).toBe(404);
    runtime.gateway!.status = async () => { throw new CampaignGatewayError("NOT_FOUND"); };
    checkoutFails = false;
    const recovered = await request(`/payments/${p.id}/retry`, "POST", undefined, undefined, p.accessToken);
    expect(recovered.status).toBe(200); expect(recovered.body.payment.id).toBe(p.id); expect(recovered.body.payment.status).toBe("PENDING");
    expect(calls).toEqual([[p.id, 10000, "Donor"], [p.id, 10000, "Donor"]]);
    // Before a donor starts Snap payment, status may still say not-created; keep the same checkout.
    expect((await request(`/payments/${p.id}/retry`, "POST", undefined, undefined, p.accessToken)).body.payment.token).toBe("sandbox-token"); expect(calls).toHaveLength(2);
    runtime.gateway!.status = async orderId => ({ ...status, order_id: orderId });
    expect((await request(`/payments/${p.id}/retry`, "POST", undefined, undefined, p.accessToken)).body.payment.status).toBe("PAID");
    await request(`/payments/${p.id}/retry`, "POST", undefined, undefined, p.accessToken);
    expect(calls).toHaveLength(2); expect(await store.transaction(s => Object.keys(s.payments))).toEqual([p.id]);
    expect((await request(`/campaigns/${id}`)).body.campaign.collectedAmount).toBe(10000); expect((await request(`/campaigns/${id}`)).body.campaign.donationCount).toBe(1);
  });
  test("ambiguous network failures, terminal payments and suspended campaigns never create another capture", async () => {
    const { id, op } = await approved(); checkoutFails = true;
    const failed = await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "Donor", isAnonymous: false }); const p = failed.body.payment;
    let creates = 0; runtime.gateway!.create = async () => { creates++; return { token: "new", redirectUrl: "https://app.sandbox.midtrans.com/test" }; };
    runtime.gateway!.status = async () => { throw new CampaignGatewayError("UNAVAILABLE"); };
    const ambiguous = await request(`/payments/${p.id}/retry`, "POST", undefined, undefined, p.accessToken);
    expect(ambiguous.status).toBe(502); expect(ambiguous.body.retryAvailable).toBe(true); expect(creates).toBe(0);
    await request(`/campaigns/${id}/status`, "POST", { status: "SUSPENDED", reason: "Review payment intake" }, op);
    runtime.gateway!.status = async () => { throw new CampaignGatewayError("NOT_FOUND"); };
    expect((await request(`/payments/${p.id}/retry`, "POST", undefined, undefined, p.accessToken)).status).toBe(409); expect(creates).toBe(0);
    for (const terminal of ["FAILED", "REFUNDED", "PARTIALLY_REFUNDED"]) {
      await store.transaction(s => { s.payments[p.id].status = terminal; });
      expect((await request(`/payments/${p.id}/retry`, "POST", undefined, undefined, p.accessToken)).body.payment.status).toBe(terminal);
    }
    expect(creates).toBe(0);
  });
  test("existing merchant callback dispatches CF orders to authoritative crowdfunding handling exactly once", async () => {
    const { id } = await approved(); const p = await donate(id);
    configureCrowdfundingForTests(runtime);
    const notify = (signature_key: string) => legacyApp.fetch(new Request("http://localhost/api/webhooks/payment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: p.id, signature_key, transaction_status: "settlement" }) }));
    expect((await notify("forged")).status).toBe(401);
    expect((await notify("test-trusted-signature")).status).toBe(200);
    expect((await notify("test-trusted-signature")).status).toBe(200);
    const campaign = (await request(`/campaigns/${id}`)).body.campaign;
    expect(campaign.collectedAmount).toBe(10000); expect(campaign.donationCount).toBe(1);
    expect(await store.transaction(s => Object.values(s.outbox).filter(e => e.kind === "PAYMENT").length)).toBe(1);
  });
  test("outbox lease prevents overlapping timer/manual sends across runtimes", async () => {
    await approved();
    let release!: () => void; let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let calls = 0;
    runtime.chain = { async record() { calls++; entered(); await blocked; return { transactionHash: `0x${"ab".repeat(32)}` }; } };
    const first = drainCampaignOutbox(runtime);
    await started;
    expect(await drainCampaignOutbox({ ...runtime, store: createCrowdfundingStore(db) }, true)).toEqual({ attempted: 0, confirmed: 0 });
    release(); expect((await first).confirmed).toBe(2); expect(calls).toBe(2);
    expect(await store.transaction(s => s.outboxLease)).toBeUndefined();
  });
  test("intent precedes gateway; independent tokens, webhook replay, actual partial refunds and stale settlement", async () => {
    const { id } = await approved(); const p = await donate(id);
    expect(observedIntent).toBe(true);
    expect((await request(`/payments/${p.id}`)).status).toBe(404);
    expect((await request(`/payments/${p.id}`, "GET", undefined, undefined, "wrong")).status).toBe(404);
    expect((await request("/midtrans/notification", "POST", { order_id: p.id, signature_key: "forged" })).status).toBe(401);
    const notify = () => request("/midtrans/notification", "POST", { order_id: p.id, signature_key: "test-trusted-signature", transaction_status: "settlement" });
    expect((await notify()).status).toBe(200); expect((await notify()).status).toBe(200);
    let read = (await request(`/campaigns/${id}`)).body.campaign;
    expect(read.collectedAmount).toBe(10000); expect(read.donationCount).toBe(1);
    status = { ...status, transaction_status: "partial_refund", refund_amount: "2500.00" };
    expect((await notify()).status).toBe(200); await notify();
    read = (await request(`/campaigns/${id}`)).body.campaign; expect(read.collectedAmount).toBe(7500);
    status.transaction_status = "settlement"; await notify();
    expect((await request(`/campaigns/${id}`)).body.campaign.collectedAmount).toBe(7500);
    status.transaction_status = "refund";
    expect((await notify()).status).toBe(502); // A full-refund label cannot override an inconsistent actual amount.
    status.refund_amount = "10000.00"; await notify(); await notify();
    read = (await request(`/campaigns/${id}`)).body.campaign; expect(read.collectedAmount).toBe(0); expect(read.donationCount).toBe(0);
    const polling = await request(`/payments/${p.id}`, "GET", undefined, undefined, p.accessToken);
    expect(polling.body.payment.status).toBe("REFUNDED"); expect(JSON.stringify(polling.body)).not.toContain("PRIVATE DONOR");
    expect(await store.transaction(s => Object.keys(s.outbox).length)).toBe(5);
    expect(await store.transaction(s => s.payments[p.id].accessTokenHash)).toBe(hash(p.accessToken));
  });
  test("mismatched authoritative values and fraud never credit; browser/notification status ignored", async () => {
    const { id } = await approved(); const p = await donate(id);
    for (const wrong of [{ gross_amount: "999.00" }, { currency: "USD" }, { order_id: "another-order" }, { fraud_status: "challenge" }]) {
      const original = { ...status }; Object.assign(status, wrong);
      expect((await request(`/payments/${p.id}`, "GET", undefined, undefined, p.accessToken)).status).toBe(502);
      status = original;
    }
    status.transaction_status = "pending";
    await request("/midtrans/notification", "POST", { order_id: p.id, signature_key: "test-trusted-signature", transaction_status: "settlement" });
    expect((await request(`/campaigns/${id}`)).body.campaign.collectedAmount).toBe(0);
    status.transaction_status = "partial_refund"; delete status.refund_amount;
    expect((await request(`/payments/${p.id}`, "GET", undefined, undefined, p.accessToken)).status).toBe(502);
    expect((await request(`/campaigns/${id}`)).body.campaign.collectedAmount).toBe(0);
  });
  test("gateway failure keeps recoverable intent without counting paid; expired and unpublished denied", async () => {
    const { id } = await approved(); checkoutFails = true;
    const response = await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "Donor", isAnonymous: false });
    expect(response.status).toBe(502); expect(observedIntent).toBe(true);
    expect(await store.transaction(s => s.payments[response.body.payment.id].status)).toBe("GATEWAY_ERROR");
    expect((await request(`/campaigns/${id}`)).body.campaign.collectedAmount).toBe(0);
    await store.transaction(s => { s.campaigns[id].endsAt = "2000-01-01T00:00:00.000Z"; });
    expect((await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "Donor", isAnonymous: false })).status).toBe(409);
  });
  test("durable outbox retries exact event/hash and never exposes private snapshot fields", async () => {
    const { id, op } = await approved(); const calls: any[] = [];
    runtime.chain = { async record(event) { calls.push(event); throw new Error("RPC failed"); } };
    expect((await request("/chain/retry", "POST", undefined, op)).body.confirmed).toBe(0);
    expect((await request(`/campaigns/${id}`)).body.campaign.chainStatus).toBe("FAILED");
    const saved = await store.transaction(s => Object.values(s.outbox));
    expect(saved).toHaveLength(2); expect(JSON.stringify(saved)).not.toContain("PRIVATE");
    const first = calls[0];
    runtime.store = createCrowdfundingStore(db);
    runtime.chain = { async record(event) { calls.push(event); return { transactionHash: `0x${"ab".repeat(32)}` }; } };
    expect((await drainCampaignOutbox(runtime)).attempted).toBe(0); // persisted retry backoff
    expect((await drainCampaignOutbox(runtime, true)).confirmed).toBe(2);
    expect(calls[2]).toEqual(first);
    expect((await drainCampaignOutbox(runtime)).attempted).toBe(0);
    expect((await request(`/campaigns/${id}`)).body.campaign.chainStatus).toBe("CONFIRMED");
  });
});

describe("donor wall and prayers", () => {
  async function give(id: string, body: Record<string, unknown>, settle = true) {
    const r = await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "Budi", isAnonymous: false, ...body });
    expect(r.status).toBe(201);
    if (settle) expect((await request(`/payments/${r.body.payment.id}`, "GET", undefined, undefined, r.body.payment.accessToken)).body.payment.status).toBe("PAID");
    return r.body.payment;
  }
  test("lists only confirmed donations with amounts; anonymous donors stay unnamed and prayers are optional", async () => {
    const { id, owner } = await approved();
    expect((await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "Budi", isAnonymous: false, prayer: "x".repeat(281) })).status).toBe(400);
    const named = await give(id, { prayer: "  Semoga lekas pulih.  " });
    await give(id, { donorName: "PRIVATE DONOR", isAnonymous: true, prayer: "Aamiin" });
    await give(id, { donorName: "Siti", prayer: "" });
    await give(id, { donorName: "Unpaid", prayer: "Not confirmed yet" }, false);
    const wall = await request(`/campaigns/${id}/donors`);
    expect(wall.status).toBe(200); expect(wall.body.total).toBe(3);
    const byName = (name: string | null) => wall.body.donors.find((d: any) => d.name === name);
    expect(byName("Budi")).toMatchObject({ amount: 10000, prayer: "Semoga lekas pulih." });
    expect(byName(null)).toMatchObject({ amount: 10000, prayer: "Aamiin" });
    expect(byName("Siti").prayer).toBeUndefined();
    expect(Date.parse(byName("Budi").paidAt)).toBeGreaterThan(0);
    for (const hidden of ["PRIVATE DONOR", "Unpaid", "Not confirmed", named.id, "CF-", "accessToken"]) expect(JSON.stringify(wall.body)).not.toContain(hidden);
    const page = await request(`/campaigns/${id}/donors?offset=1&limit=1`);
    expect(page.body.total).toBe(3); expect(page.body.donors).toHaveLength(1); expect(page.body.donors[0].id).toBe(wall.body.donors[1].id);
    expect((await request(`/campaigns/${id}/donors?limit=500`)).status).toBe(400);
    status = { ...status, transaction_status: "refund", refund_amount: "10000.00" };
    await request(`/payments/${named.id}`, "GET", undefined, undefined, named.accessToken);
    expect((await request(`/campaigns/${id}/donors`)).body.donors.map((d: any) => d.name).sort()).toEqual(["Siti", null].sort());
    const unpublished = (await request("/campaigns", "POST", fields, owner.token)).body.campaign.id;
    expect((await request(`/campaigns/${unpublished}/donors`)).status).toBe(404);
    expect((await request(`/campaigns/${unpublished}/donors`, "GET", undefined, owner.token)).body.total).toBe(0);
  });
  test("an operator hides an unfit prayer while the donation stays listed", async () => {
    const { id, owner, op } = await approved();
    await give(id, { prayer: "TEKS TIDAK PANTAS" }); await give(id, { donorName: "Siti" });
    const wall = (await request(`/campaigns/${id}/donors`)).body.donors;
    const target = wall.find((d: any) => d.prayer); const silent = wall.find((d: any) => !d.prayer);
    const path = `/campaigns/${id}/donors/${target.id}/hide-prayer`;
    expect((await request(path, "POST", { reason: "Kata kasar" })).status).toBe(401);
    expect((await request(path, "POST", { reason: "Kata kasar" }, owner.token)).status).toBe(403);
    expect((await request(`/campaigns/${id}/donors/${silent.id}/hide-prayer`, "POST", { reason: "Nothing to hide" }, op)).status).toBe(404);
    expect((await request(path, "POST", { reason: "Kata kasar" }, op)).body.donor).toMatchObject({ amount: 10000, prayerHidden: true });
    expect((await request(path, "POST", { reason: "Again" }, op)).status).toBe(200);
    const after = await request(`/campaigns/${id}/donors`);
    expect(after.body.total).toBe(2);
    expect(after.body.donors.find((d: any) => d.id === target.id)).toMatchObject({ name: "Budi", amount: 10000, prayerHidden: true });
    expect(JSON.stringify(after.body)).not.toContain("TIDAK PANTAS"); expect(JSON.stringify(after.body)).not.toContain("Kata kasar");
    expect(await store.transaction(s => s.campaigns[id].history.filter((h: any) => h.action === "PRAYER_HIDE").length)).toBe(1);
  });
});

describe("public donation receipt check", () => {
  test("a donor checks a donation by reference; chain evidence appears only once recorded", async () => {
    const { id } = await approved();
    const created = await request(`/campaigns/${id}/donations`, "POST", { amount: 10000, donorName: "PRIVATE DONOR", isAnonymous: false, prayer: "PRIVATE PRAYER" });
    const payment = created.body.payment; const path = `/receipts/${payment.id}`;
    expect((await request("/receipts/CF-00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await request("/receipts/TRX-123")).status).toBe(404);
    const pending = await request(path);
    expect(pending.body.receipt).toMatchObject({ reference: payment.id, status: "PENDING", campaign: { id, title: fields.title } });
    expect(pending.body.receipt.amount).toBeUndefined();
    await request(`/payments/${payment.id}`, "GET", undefined, undefined, payment.accessToken);
    const confirmed = await request(`/receipts/${payment.id.toUpperCase()}`);
    expect(confirmed.body.receipt).toMatchObject({ status: "CONFIRMED", amount: 10000, refundedAmount: 0, campaign: { organizer: { name: "Owner" } } });
    expect(Date.parse(confirmed.body.receipt.paidAt)).toBeGreaterThan(0);
    expect(confirmed.body.receipt.chain).toBeUndefined();
    for (const hidden of ["PRIVATE", "accessToken", "token", "owner@example", "salt", "snapshot"]) expect(JSON.stringify(confirmed.body)).not.toContain(hidden);
    // A failed recording stays invisible; only a confirmed one is reported.
    runtime.chain = { async record() { throw new Error("rpc down"); } };
    await drainCampaignOutbox(runtime, true);
    expect((await request(path)).body.receipt.chain).toBeUndefined();
    const transactionHash = `0x${"ab".repeat(32)}`;
    runtime.chain = { async record() { return { transactionHash }; } };
    await drainCampaignOutbox(runtime, true);
    const recorded = (await request(path)).body.receipt;
    expect(recorded.chain).toMatchObject({ transactionHash, kind: "PAYMENT" });
    expect(recorded.chain.payloadHash).toBe(await store.transaction(s => Object.values(s.outbox).find(e => e.snapshot.paymentId === payment.id)!.payloadHash));
    status = { ...status, transaction_status: "partial_refund", refund_amount: "4000.00" };
    await request(`/payments/${payment.id}`, "GET", undefined, undefined, payment.accessToken);
    expect((await request(path)).body.receipt).toMatchObject({ status: "PARTIALLY_REFUNDED", amount: 10000, refundedAmount: 4000, chain: { kind: "PAYMENT" } });
  });
});

describe("campaign news and realization reports", () => {
  const news = { kind: "NEWS", title: "Kelas dimulai", body: "Kegiatan belajar sudah berjalan." };
  const realization = { kind: "REALIZATION", title: "Pembelian buku", body: "Buku telah dibagikan kepada siswa.", usedAmount: 6000, carriedOutAt: "2026-01-15" };
  const pdf = { name: "kuitansi.pdf", contentType: "application/pdf", dataBase64: Buffer.from("%PDF-1.7 PRIVATE RECEIPT").toString("base64") };
  const photo = { name: "kegiatan.png", contentType: "image/png", dataBase64: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("photo")]).toString("base64") };
  async function funded() {
    const context = await approved(); const payment = await donate(context.id);
    expect((await request(`/payments/${payment.id}`, "GET", undefined, undefined, payment.accessToken)).body.payment.status).toBe("PAID");
    return context;
  }
  async function draft(id: string, token: string, body: unknown = news) {
    const r = await request(`/campaigns/${id}/updates`, "POST", body, token); expect(r.status).toBe(201); return r.body.update;
  }
  async function published(id: string, owner: string, op: string, body: any = news) {
    const update = await draft(id, owner, body); const path = `/campaigns/${id}/updates/${update.id}`;
    expect((await request(`${path}/submit`, "POST", undefined, owner)).status).toBe(200);
    if (body.kind === "REALIZATION") expect((await request(`${path}/review`, "POST", { expectedRevision: 1, decision: "PUBLISH", notes: "Diperiksa terhadap lampiran" }, op)).status).toBe(200);
    return update;
  }

  test("operator worklist lists pending proposals, publications and reports without private material", async () => {
    const { id, owner, op } = await funded();
    expect((await request("/review/queue")).status).toBe(401);
    expect((await request("/review/queue", "GET", undefined, owner.token)).status).toBe(403);
    await request("/campaigns", "POST", fields, owner.token);
    const waiting = (await request("/campaigns", "POST", { ...fields, title: "Second proposal" }, owner.token)).body.campaign.id;
    await request(`/campaigns/${waiting}/submit`, "POST", undefined, owner.token);
    const report = await draft(id, owner.token, realization);
    await published(id, owner.token, op);
    const row = async (campaignId: string) => (await request("/review/queue", "GET", undefined, op)).body.campaigns.find((c: any) => c.id === campaignId);
    expect((await row(id)).tasks).toEqual([]);
    await request(`/campaigns/${id}/updates/${report.id}/submit`, "POST", undefined, owner.token);
    const queue = await request("/review/queue", "GET", undefined, op);
    expect(queue.body.campaigns).toHaveLength(2);
    expect(await row(id)).toMatchObject({ title: fields.title, status: "PUBLISHED", organizer: "Owner", tasks: [{ type: "REPORT", updateId: report.id, title: realization.title, usedAmount: 6000 }] });
    expect((await row(waiting)).tasks).toMatchObject([{ type: "PROPOSAL" }]);
    expect(Date.parse((await row(waiting)).tasks[0].since)).toBeGreaterThan(0);
    for (const hidden of ["PRIVATE", "owner@example", "story", "history", "reviewNotes", "documents"]) expect(JSON.stringify(queue.body)).not.toContain(hidden);
    await request(`/campaigns/${waiting}/review`, "POST", { expectedVersion: 1, decision: "APPROVE", notes: "Evidence reviewed", checks: { identity: true, consent: true, needs: true, budget: true, distribution: true }, complianceReference: "Reference" }, op);
    expect((await row(waiting)).tasks).toMatchObject([{ type: "PUBLISH" }]);
    await request(`/campaigns/${id}/updates/${report.id}/review`, "POST", { expectedRevision: 1, decision: "REJECT", notes: "Tanpa bukti" }, op);
    expect((await row(id)).tasks).toEqual([]);
  });

  test("news is published by its owner without examination and can still be withdrawn by an operator", async () => {
    const { id, owner, op } = await approved(); const other = await register("other@example.com");
    const update = await draft(id, owner.token); const path = `/campaigns/${id}/updates/${update.id}`;
    expect((await request(`${path}/attachments`, "POST", { ...pdf, visibility: "PUBLIC" }, owner.token)).status).toBe(400);
    expect((await request(`${path}/attachments`, "POST", { ...photo, visibility: "PRIVATE" }, owner.token)).status).toBe(400);
    const image = (await request(`${path}/attachments`, "POST", { ...photo, visibility: "PUBLIC" }, owner.token)).body.update.attachments[0];
    expect((await request(`${path}/attachments/${image.id}`)).status).toBe(401);
    expect((await request(`/campaigns/${id}`)).body.campaign.updates).toEqual([]);
    expect((await request(`${path}/submit`, "POST", undefined, other.token)).status).toBe(403);
    expect((await request(`${path}/submit`, "POST", undefined, owner.token)).body.update.status).toBe("PUBLISHED");
    const visible = (await request(`/campaigns/${id}`)).body.campaign.updates;
    expect(visible).toHaveLength(1);
    expect(visible[0]).toMatchObject({ kind: "NEWS", title: news.title, status: "PUBLISHED", attachments: [{ id: image.id, name: "kegiatan.png" }] });
    expect((await app.request(`${path}/attachments/${image.id}`)).status).toBe(200);
    expect((await request(path, "PATCH", { body: "Rewrite history" }, owner.token)).status).toBe(409);
    expect((await request(`${path}/submit`, "POST", undefined, owner.token)).status).toBe(409);
    expect((await request(`${path}/review`, "POST", { expectedRevision: 1, decision: "REJECT", notes: "Not reviewable" }, op)).status).toBe(409);
    const correction = await published(id, owner.token, op, { ...news, title: "Ralat jadwal", correctsId: update.id });
    expect((await request(`/campaigns/${id}`)).body.campaign.updates.find((u: any) => u.id === update.id).supersededById).toBe(correction.id);
    expect((await request(`${path}/withdraw`, "POST", { reason: "Memuat data pribadi" }, op)).status).toBe(200);
    expect((await request(`${path}/attachments/${image.id}`)).status).toBe(401);
    expect((await request(`/campaigns/${id}`)).body.campaign.updates.find((u: any) => u.id === update.id)).toMatchObject({ status: "WITHDRAWN", withdrawnReason: "Memuat data pribadi" });
  });

  test("only the owner of a published campaign drafts updates; realization reports stay private until an operator publishes", async () => {
    const { id, owner, op } = await funded(); const other = await register("other@example.com");
    const unpublished = (await request("/campaigns", "POST", fields, owner.token)).body.campaign.id;
    expect((await request(`/campaigns/${unpublished}/updates`, "POST", news, owner.token)).status).toBe(409);
    expect((await request(`/campaigns/${id}/updates`, "POST", news)).status).toBe(401);
    expect((await request(`/campaigns/${id}/updates`, "POST", news, other.token)).status).toBe(403);
    expect((await request(`/campaigns/${id}/updates`, "POST", news, op)).status).toBe(403);
    expect((await request(`/campaigns/${id}/updates`, "POST", { ...news, usedAmount: 5000 }, owner.token)).status).toBe(400);
    const update = await draft(id, owner.token, realization); const path = `/campaigns/${id}/updates/${update.id}`;
    expect(update.status).toBe("DRAFT");
    expect((await request(`${path}/review`, "POST", { expectedRevision: 1, decision: "PUBLISH", notes: "Too early" }, op)).status).toBe(409);
    expect((await request(path, "PATCH", { body: "Kegiatan belajar berjalan dua kali sepekan." }, owner.token)).status).toBe(200);
    expect((await request(`${path}/submit`, "POST", undefined, other.token)).status).toBe(403);
    expect((await request(`${path}/submit`, "POST", undefined, owner.token)).body.update.status).toBe("SUBMITTED");
    expect((await request(path, "PATCH", { body: "Late edit" }, owner.token)).status).toBe(409);
    expect((await request(path, "DELETE", undefined, owner.token)).status).toBe(409);
    expect((await request(`/campaigns/${id}`)).body.campaign.updates).toEqual([]);
    expect((await request(`${path}/review`, "POST", { expectedRevision: 1, decision: "PUBLISH", notes: "Self" }, owner.token)).status).toBe(403);
    expect((await request(`${path}/review`, "POST", { expectedRevision: 2, decision: "PUBLISH", notes: "Stale" }, op)).status).toBe(409);
    expect((await request(`${path}/review`, "POST", { expectedRevision: 1, decision: "REQUEST_REVISION", notes: "Tambahkan tanggal kegiatan" }, op)).body.update.status).toBe("REVISION_REQUESTED");
    expect((await request(`/campaigns/${id}`)).body.campaign.updates).toEqual([]);
    expect((await request(`${path}/submit`, "POST", undefined, owner.token)).body.update.revision).toBe(2);
    expect((await request(`${path}/review`, "POST", { expectedRevision: 2, decision: "PUBLISH", notes: "INTERNAL NOTE" }, op)).body.update.status).toBe("PUBLISHED");
    const visible = await request(`/campaigns/${id}`);
    expect(visible.body.campaign.updates).toHaveLength(1);
    expect(visible.body.campaign.updates[0]).toMatchObject({ kind: "REALIZATION", title: realization.title, body: "Kegiatan belajar berjalan dua kali sepekan.", status: "PUBLISHED" });
    for (const hidden of ["INTERNAL NOTE", "reviewNotes", "actorId", "Tambahkan tanggal", "revision"]) expect(JSON.stringify(visible.body)).not.toContain(hidden);
    expect((await request(path, "PATCH", { body: "Rewrite history" }, owner.token)).status).toBe(409);
    const unsubmitted = await draft(id, owner.token);
    expect((await request(`/campaigns/${id}/updates/${unsubmitted.id}`, "DELETE", undefined, owner.token)).status).toBe(200);
    expect((await request(`/campaigns/${id}`, "GET", undefined, owner.token)).body.campaign.updates).toHaveLength(1);
    // Publishing an update records no chain event: recording them on chain is an undecided product question.
    expect(await store.transaction(s => Object.values(s.outbox).filter(e => /UPDATE/.test(e.kind)).length)).toBe(0);
  });

  test("reported used amount counts only published realization reports and never exceeds confirmed donations", async () => {
    const { id, owner, op } = await funded();
    expect((await request(`/campaigns/${id}/updates`, "POST", { ...realization, usedAmount: undefined }, owner.token)).status).toBe(400);
    expect((await request(`/campaigns/${id}/updates`, "POST", { ...realization, carriedOutAt: "2099-01-01" }, owner.token)).status).toBe(400);
    const excessive = await draft(id, owner.token, { ...realization, usedAmount: 10001 });
    expect((await request(`/campaigns/${id}/updates/${excessive.id}/submit`, "POST", undefined, owner.token)).status).toBe(409);
    const first = await draft(id, owner.token, realization);
    await request(`/campaigns/${id}/updates/${first.id}/submit`, "POST", undefined, owner.token);
    expect((await request(`/campaigns/${id}`)).body.campaign.reportedUsedAmount).toBe(0);
    await request(`/campaigns/${id}/updates/${first.id}/review`, "POST", { expectedRevision: 1, decision: "PUBLISH", notes: "Sesuai kuitansi" }, op);
    const summary = (await request(`/campaigns/${id}`)).body.campaign;
    expect(summary).toMatchObject({ collectedAmount: 10000, reportedUsedAmount: 6000 });
    expect(summary.updates[0]).toMatchObject({ usedAmount: 6000, carriedOutAt: "2026-01-15" });
    const second = await draft(id, owner.token, { ...realization, usedAmount: 5000 });
    expect((await request(`/campaigns/${id}/updates/${second.id}/submit`, "POST", undefined, owner.token)).status).toBe(409);
    expect((await request(`/campaigns/${id}/updates/${second.id}`, "PATCH", { usedAmount: 4000 }, owner.token)).status).toBe(200);
    await request(`/campaigns/${id}/updates/${second.id}/submit`, "POST", undefined, owner.token);
    await request(`/campaigns/${id}/updates/${second.id}/review`, "POST", { expectedRevision: 1, decision: "REJECT", notes: "Tanpa bukti" }, op);
    expect((await request(`/campaigns/${id}`)).body.campaign.reportedUsedAmount).toBe(6000);
    // Reports remain possible after the collection period is closed.
    await request(`/campaigns/${id}/status`, "POST", { status: "CLOSED", reason: "Funding period concluded" }, op);
    await published(id, owner.token, op, { ...realization, usedAmount: 4000 });
    expect((await request(`/campaigns/${id}`)).body.campaign.reportedUsedAmount).toBe(10000);
  });

  test("published updates are corrected by a superseding update and withdrawn with a public marker", async () => {
    const { id, owner, op } = await funded();
    const original = await published(id, owner.token, op, realization);
    const article = await published(id, owner.token, op);
    expect((await request(`/campaigns/${id}/updates`, "POST", { ...news, correctsId: original.id }, owner.token)).status).toBe(409);
    const correction = await published(id, owner.token, op, { ...realization, usedAmount: 9000, correctsId: original.id });
    let view = (await request(`/campaigns/${id}`)).body.campaign;
    expect(view.reportedUsedAmount).toBe(9000);
    expect(view.updates.find((u: any) => u.id === original.id).supersededById).toBe(correction.id);
    expect(view.updates.find((u: any) => u.id === correction.id).correctsId).toBe(original.id);
    expect((await request(`/campaigns/${id}/updates`, "POST", { ...realization, correctsId: original.id }, owner.token)).status).toBe(409);
    expect((await request(`/campaigns/${id}/updates/${correction.id}/withdraw`, "POST", { reason: "Kuitansi tidak sah" }, owner.token)).status).toBe(403);
    expect((await request(`/campaigns/${id}/updates/${correction.id}/withdraw`, "POST", { reason: "Kuitansi tidak sah" }, op)).status).toBe(200);
    expect((await request(`/campaigns/${id}/updates/${correction.id}/withdraw`, "POST", { reason: "Again" }, op)).status).toBe(409);
    view = (await request(`/campaigns/${id}`)).body.campaign;
    expect(view.reportedUsedAmount).toBe(6000);
    const marker = view.updates.find((u: any) => u.id === correction.id);
    expect(marker).toMatchObject({ status: "WITHDRAWN", withdrawnReason: "Kuitansi tidak sah" });
    expect(marker.body).toBeUndefined(); expect(marker.usedAmount).toBeUndefined();
    expect(view.updates.find((u: any) => u.id === original.id).supersededById).toBeUndefined();
    expect(view.updates.find((u: any) => u.id === article.id).status).toBe("PUBLISHED");
  });

  test("report attachments stay private unless proposed public by the fundraiser and released by the operator", async () => {
    const { id, owner, op } = await funded(); const other = await register("other@example.com");
    const update = await draft(id, owner.token, realization); const path = `/campaigns/${id}/updates/${update.id}`;
    expect((await request(`${path}/attachments`, "POST", pdf, owner.token)).status).toBe(400);
    expect((await request(`${path}/attachments`, "POST", { ...photo, visibility: "PUBLIC" }, other.token)).status).toBe(403);
    expect((await request(`${path}/attachments`, "POST", { ...photo, visibility: "PUBLIC", dataBase64: Buffer.from("<script>").toString("base64") }, owner.token)).status).toBe(400);
    const receipt = (await request(`${path}/attachments`, "POST", { ...pdf, visibility: "PRIVATE" }, owner.token)).body.update.attachments[0];
    const discarded = (await request(`${path}/attachments`, "POST", { ...photo, visibility: "PUBLIC" }, owner.token)).body.update.attachments[1];
    expect((await request(`${path}/attachments/${discarded.id}`, "DELETE", undefined, owner.token)).body.update.attachments).toHaveLength(1);
    const shown = (await request(`${path}/attachments`, "POST", { ...photo, visibility: "PUBLIC" }, owner.token)).body.update.attachments[1];
    const held = (await request(`${path}/attachments`, "POST", { ...photo, name: "wajah.png", visibility: "PUBLIC" }, owner.token)).body.update.attachments[2];
    expect(shown.encrypted).toBeUndefined();
    expect(JSON.stringify(await store.transaction(s => s.campaigns[id].updates))).not.toContain(photo.dataBase64);
    await request(`${path}/submit`, "POST", undefined, owner.token);
    expect((await request(`${path}/attachments`, "POST", { ...photo, visibility: "PUBLIC" }, owner.token)).status).toBe(409);
    expect((await request(`${path}/attachments/${shown.id}`)).status).toBe(401);
    expect((await app.request(`${path}/attachments/${receipt.id}`, { headers: { Authorization: `Bearer ${op}` } })).status).toBe(200);
    expect((await request(`${path}/review`, "POST", { expectedRevision: 1, decision: "PUBLISH", notes: "Checked", publicAttachmentIds: [receipt.id] }, op)).status).toBe(400);
    expect((await request(`${path}/review`, "POST", { expectedRevision: 1, decision: "PUBLISH", notes: "Checked", publicAttachmentIds: [shown.id] }, op)).status).toBe(200);
    const visible = (await request(`/campaigns/${id}`)).body.campaign.updates[0];
    expect(visible.attachments).toEqual([{ id: shown.id, name: "kegiatan.png", contentType: "image/png", size: shown.size }]);
    const download = await app.request(`${path}/attachments/${shown.id}`);
    expect(download.status).toBe(200); expect(download.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await download.arrayBuffer()).toString("base64")).toBe(photo.dataBase64);
    for (const hidden of [receipt.id, held.id]) {
      expect((await request(`${path}/attachments/${hidden}`)).status).toBe(401);
      expect((await request(`${path}/attachments/${hidden}`, "GET", undefined, other.token)).status).toBe(403);
    }
    const owned = await app.request(`${path}/attachments/${receipt.id}`, { headers: { Authorization: `Bearer ${owner.token}` } });
    expect(await owned.text()).toBe("%PDF-1.7 PRIVATE RECEIPT");
    await request(`${path}/withdraw`, "POST", { reason: "Foto keliru" }, op);
    expect((await request(`${path}/attachments/${shown.id}`)).status).toBe(401);
  });
});
