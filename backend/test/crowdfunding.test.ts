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
