import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { CrowdfundingState, CrowdfundingStore } from "./crowdfunding-store";
import { CampaignGatewayError, type CampaignGateway } from "./crowdfunding-midtrans";
import { reportedUsedAmount, updatesDto } from "./crowdfunding-updates";

export class CampaignError extends Error {
  constructor(message: string, public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502 | 503 = 400) { super(message); }
}
export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("hex");
const text = (max = 5000) => z.string().trim().min(1).max(max);
export const registration = z.object({ name: text(120), email: z.email().max(254).transform(v => v.toLowerCase()), password: z.string().min(12).max(128), kind: z.enum(["INDIVIDUAL", "ORGANIZATION"]), organizationName: text(200).optional() }).strict().refine(v => v.kind !== "ORGANIZATION" || !!v.organizationName, "Organization name required");
export const campaignFields = z.object({ title: text(160), summary: text(500), story: text(20000), category: z.enum(["HEALTH", "EDUCATION", "HUMANITARIAN", "COMMUNITY"]), targetAmount: z.number().int().min(1000).max(1_000_000_000_000), endsAt: z.iso.datetime({ offset: true }), coverImageUrl: z.url().max(2048).refine(v => new URL(v).protocol === "https:").optional(), beneficiaryName: text(200), relationship: text(500), budgetPlan: text(10000), distributionPlan: text(10000), consent: z.boolean(), organizationName: text(200).optional() }).strict();
export interface CampaignChainRecorder { record(event: { eventId: string; campaignId: string; kind: string; payloadHash: `0x${string}` }): Promise<{ transactionHash: string }> }
export interface CampaignRuntime { store: CrowdfundingStore; gateway: CampaignGateway | null; chain: CampaignChainRecorder | null; documentKey?: Buffer | null }
export function publicUser(u: any) { return { id: u.id, name: u.name, email: u.email, kind: u.kind, organizationName: u.organizationName, role: u.role }; }
export function authenticate(s: CrowdfundingState, token: string) {
  const session = s.sessions[hash(token)];
  if (!token || !session || session.expiresAt <= Date.now() || !s.users[session.userId]) throw new CampaignError("Authentication required", 401);
  return s.users[session.userId];
}
export function operator(u: any) { if (u.role !== "OPERATOR") throw new CampaignError("Operator access required", 403); }
export function campaign(s: CrowdfundingState, id: string) { const c = s.campaigns[id]; if (!c) throw new CampaignError("Campaign not found", 404); return c; }
export function owner(c: any, u: any) { if (c.ownerId !== u.id) throw new CampaignError("Owner access required", 403); }
export function privateAccess(c: any, u: any) { if (u.role !== "OPERATOR") owner(c, u); }
export function editable(c: any) { if (!["DRAFT", "REVISION_REQUESTED"].includes(c.status)) throw new CampaignError("Submitted versions are immutable", 409); }
export function audit(c: any, actorId: string, action: string, reason: string) { c.updatedAt = new Date().toISOString(); c.history.push({ id: randomUUID(), actorId, action, reason, version: c.version, at: c.updatedAt }); }
function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function enqueue(s: CrowdfundingState, c: any, kind: string, extra: Record<string, unknown> = {}) {
  const eventId = randomUUID();
  // Only a salted commitment to private proposal/review material enters the non-PII snapshot.
  // Frozen evidence includes SHA-256 content hashes, not mutable download URLs.
  const salt = secret();
  const frozen = c.versions.find((v: any) => v.version === c.version);
  const proposal = { version: c.version, fields: frozen?.fields ?? {}, documents: (frozen?.documents ?? []).map((d: any) => ({ id: d.id, contentHash: d.contentHash, name: d.name, contentType: d.contentType, size: d.size })), review: c.reviewNotes.filter((r: any) => r.version === c.version) };
  const proposalDigest = `0x${hash(canonicalJson({ salt, proposal }))}`;
  const snapshot = { campaignId: c.id, version: c.version, proposalDigest, status: c.status, targetAmount: c.targetAmount, collectedAmount: c.collectedAmount, donationCount: c.donationCount, kind, ...extra };
  s.outbox[eventId] = { eventId, campaignId: c.id, kind, payloadHash: `0x${hash(canonicalJson({ salt, snapshot }))}`, snapshot, salt, status: "PENDING", attempts: 0, createdAt: new Date().toISOString() };
}
export function publishedCampaignMaterial(s: CrowdfundingState, c: any) {
  const u = s.users[c.ownerId];
  return { title: c.title, summary: c.summary, story: c.story, category: c.category, targetAmount: c.targetAmount, endsAt: c.endsAt, coverImageUrl: c.coverImageUrl, version: c.version, organizer: { name: u.name, kind: u.kind, organizationName: c.organizationName || u.organizationName } };
}
export function dto(s: CrowdfundingState, c: any, chainConfigured: boolean, privileged = false) {
  const events = Object.values(s.outbox).filter(e => e.campaignId === c.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.eventId.localeCompare(b.eventId));
  const confirmed = events.filter(e => e.status === "CONFIRMED");
  const chainStatus = !chainConfigured ? "UNCONFIGURED" : events.some(e => e.status === "FAILED") ? "FAILED" : !events.length || events.some(e => e.status !== "CONFIRMED") ? "PENDING" : "CONFIRMED";
  const material = !privileged && c.publicSnapshot ? c.publicSnapshot : publishedCampaignMaterial(s, c);
  const value: Record<string, any> = { id: c.id, title: material.title, summary: material.summary, story: material.story, category: material.category, targetAmount: material.targetAmount, endsAt: material.endsAt, coverImageUrl: material.coverImageUrl, status: c.status, version: material.version, organizer: material.organizer, collectedAmount: c.collectedAmount, donationCount: c.donationCount, createdAt: c.createdAt, updatedAt: c.updatedAt, chainStatus, chainTxHash: confirmed.at(-1)?.transactionHash, publishedAt: c.publishedAt, chainEvents: events.map(e => ({ eventId: e.eventId, kind: e.kind, payloadHash: e.payloadHash, transactionHash: e.transactionHash, status: e.status })), updates: updatesDto(c, privileged), reportedUsedAmount: reportedUsedAmount(c) };
  if (privileged) Object.assign(value, { beneficiaryName: c.beneficiaryName, relationship: c.relationship, budgetPlan: c.budgetPlan, distributionPlan: c.distributionPlan, consent: c.consent, documents: c.documents.map((d: any) => ({ id: d.id, name: d.name, contentType: d.contentType, size: d.size, createdAt: d.createdAt })), reviewNotes: c.reviewNotes, history: c.history });
  return value;
}
/** Operator worklist row: what awaits an operator on a campaign, without its private material. */
export function queueRow(s: CrowdfundingState, c: any) {
  const u = s.users[c.ownerId];
  const tasks: Record<string, unknown>[] = [];
  if (c.status === "SUBMITTED") tasks.push({ type: "PROPOSAL", since: c.versions.at(-1)?.at ?? c.updatedAt });
  if (c.status === "APPROVED") tasks.push({ type: "PUBLISH", since: c.reviewNotes.at(-1)?.at ?? c.updatedAt });
  for (const item of c.updates ?? []) if (item.status === "SUBMITTED") tasks.push({ type: "REPORT", since: item.submittedAt, updateId: item.id, title: item.title, usedAmount: item.usedAmount });
  return { id: c.id, title: c.title, status: c.status, version: c.version, organizer: c.organizationName || u.organizationName || u.name, updatedAt: c.updatedAt, tasks };
}
export const paymentDto = (p: any) => ({ id: p.id, token: p.token, redirectUrl: p.redirectUrl, status: p.status, amount: p.amount, refundedAmount: p.refundedAmount, retryAvailable: ["CREATING", "GATEWAY_ERROR", "PENDING"].includes(p.status) });

export async function reconcilePayment(runtime: CampaignRuntime, id: string) {
  if (!runtime.gateway) throw new CampaignError("Payment gateway is unconfigured", 503);
  const data = await runtime.gateway.status(id);
  return runtime.store.transaction(s => {
    const p = s.payments[id];
    if (!p) throw new CampaignError("Payment not found", 404);
    if (data.order_id !== id || data.currency !== "IDR" || !/^\d+(\.0{1,2})?$/.test(String(data.gross_amount)) || Number(data.gross_amount) !== p.amount || (data.fraud_status && data.fraud_status !== "accept")) throw new CampaignError("Gateway payment verification failed", 502);
    const status = data.transaction_status;
    let paid = p.paidAmount;
    let refunded = p.refundedAmount;
    if (status === "settlement" || (status === "capture" && data.fraud_status === "accept")) paid = p.amount;
    if (status === "refund" || status === "partial_refund") {
      paid = p.amount;
      // Midtrans Get Status defines refund_amount as the cumulative refunded IDR:
      // https://docs.midtrans.com/reference/get-transaction-status
      const actual = Number(data.refund_amount);
      if (!/^\d+(\.0{1,2})?$/.test(String(data.refund_amount)) || !Number.isSafeInteger(actual) || actual <= 0 || actual > p.amount || (status === "refund" && actual !== p.amount)) throw new CampaignError("Unverified refund amount", 502);
      refunded = Math.max(refunded, actual);
    }
    const previousNet = p.paidAmount - p.refundedAmount;
    const net = paid - refunded;
    const c = campaign(s, p.campaignId);
    if (paid !== p.paidAmount || refunded !== p.refundedAmount) {
      c.collectedAmount += net - previousNet;
      c.donationCount += Number(net > 0) - Number(previousNet > 0);
      audit(c, "MIDTRANS", refunded > p.refundedAmount ? "REFUND" : "PAYMENT", "Verified with the payment gateway");
      enqueue(s, c, refunded > p.refundedAmount ? "REFUND" : "PAYMENT", { paymentId: p.id, paidAmount: paid, refundedAmount: refunded });
    }
    p.paidAmount = paid; p.refundedAmount = refunded;
    p.status = refunded ? (refunded === paid ? "REFUNDED" : "PARTIALLY_REFUNDED") : paid ? "PAID" : ["deny", "cancel", "expire", "failure"].includes(status) || p.status === "FAILED" ? "FAILED" : "PENDING";
    return paymentDto(p);
  });
}

export async function retryCampaignPayment(runtime: CampaignRuntime, id: string, accessToken: string) {
  if (!runtime.gateway) throw new CampaignError("Payment gateway is unconfigured", 503);
  const leaseOwner = randomUUID();
  const accepting = (s: CrowdfundingState, p: any) => {
    const c = campaign(s, p.campaignId);
    if (c.status !== "PUBLISHED" || Date.parse(c.endsAt) <= Date.now() || (p.campaignVersion !== undefined && p.campaignVersion !== c.version)) throw new CampaignError("Campaign is not accepting this payment; no new checkout created", 409);
  };
  const initial = await runtime.store.transaction(s => {
    const p = s.payments[id];
    if (!p || !accessToken || hash(accessToken) !== p.accessTokenHash) throw new CampaignError("Payment access denied", 404);
    if (["PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(p.status)) return { terminal: paymentDto(p) };
    accepting(s, p);
    if (p.checkoutLeaseUntil > Date.now()) throw new CampaignError("Checkout recovery already in progress; retry shortly", 409);
    p.checkoutLeaseOwner = leaseOwner; p.checkoutLeaseUntil = Date.now() + 60000;
    return { terminal: null };
  });
  if (initial.terminal) return initial.terminal;
  try {
    try {
      const verified = await reconcilePayment(runtime, id);
      if (verified.status !== "PENDING" || (verified.token && verified.redirectUrl)) return verified;
      // An order exists but checkout credentials were lost: do not risk a duplicate capture.
      throw new CampaignError("Gateway order exists but checkout is unavailable; retry status later", 502);
    } catch (error) {
      if (!(error instanceof CampaignGatewayError) || error.code !== "NOT_FOUND") throw error;
    }
    const intent = await runtime.store.transaction(s => {
      const p = s.payments[id];
      accepting(s, p);
      if (p.checkoutLeaseOwner !== leaseOwner) throw new CampaignError("Checkout recovery lease expired", 409);
      return { ...p };
    });
    // Snap status can say not-created before the donor starts payment; reuse existing checkout.
    if (intent.token && intent.redirectUrl) return paymentDto(intent);
    if (intent.paidAmount || intent.refundedAmount || intent.status === "FAILED") return paymentDto(intent);
    const checkout = await runtime.gateway.create(id, intent.amount, intent.isAnonymous ? "Anonymous" : intent.donorName);
    return await runtime.store.transaction(s => {
      const p = s.payments[id]; Object.assign(p, checkout);
      if (["CREATING", "GATEWAY_ERROR"].includes(p.status)) p.status = "PENDING";
      return paymentDto(p);
    });
  } finally {
    await runtime.store.transaction(s => { const p = s.payments[id]; if (p.checkoutLeaseOwner === leaseOwner) { delete p.checkoutLeaseOwner; delete p.checkoutLeaseUntil; } });
  }
}

export async function drainCampaignOutbox(runtime: CampaignRuntime, force = false) {
  if (!runtime.chain) throw new CampaignError("Campaign chain is unconfigured", 503);
  const leaseOwner = randomUUID();
  // A DB lease serializes timer/manual retries across API processes sharing this store.
  // Five minutes exceeds the adapter's 120-second receipt timeout; renew before each call.
  const events = await runtime.store.transaction(s => {
    if (s.outboxLease && s.outboxLease.expiresAt > Date.now()) return [];
    const due = Object.values(s.outbox).filter(e => e.status !== "CONFIRMED" && (force || !e.nextAttemptAt || e.nextAttemptAt <= Date.now()))
      .sort((a, b) => a.attempts - b.attempts || a.createdAt.localeCompare(b.createdAt) || a.eventId.localeCompare(b.eventId)).slice(0, 30);
    if (due.length) s.outboxLease = { owner: leaseOwner, expiresAt: Date.now() + 300000 };
    return due.map(e => ({ ...e }));
  });
  let confirmed = 0;
  let attempted = 0;
  try {
    for (const event of events) {
      const owned = await runtime.store.transaction(s => {
        if (s.outboxLease?.owner !== leaseOwner) return false;
        s.outboxLease.expiresAt = Date.now() + 300000; return true;
      });
      if (!owned) break;
      attempted++;
      try {
        const receipt = await runtime.chain.record({ eventId: event.eventId, campaignId: event.campaignId, kind: event.kind, payloadHash: event.payloadHash });
        if (!/^0x[0-9a-fA-F]{64}$/.test(receipt.transactionHash)) throw new Error("Invalid chain transaction hash");
        await runtime.store.transaction(s => { const e = s.outbox[event.eventId]; e.status = "CONFIRMED"; e.transactionHash = receipt.transactionHash; e.attempts++; delete e.error; delete e.nextAttemptAt; });
        confirmed++;
      } catch {
        await runtime.store.transaction(s => { const e = s.outbox[event.eventId]; if (e.status !== "CONFIRMED") { e.status = "FAILED"; e.attempts++; e.nextAttemptAt = Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(e.attempts - 1, 7)); e.error = "Chain recording failed; retry available"; } });
      }
    }
  } finally {
    await runtime.store.transaction(s => { if (s.outboxLease?.owner === leaseOwner) delete s.outboxLease; });
  }
  return { attempted, confirmed };
}
