import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CampaignError, audit } from "./crowdfunding";

// Kabar (NEWS) and laporan realisasi (REALIZATION) attach to an already-published campaign.
// Kabar is published by the fundraiser directly; a realization report states how money was used,
// so an operator examines it first. Both are immutable once published: a mistake is fixed by
// publishing a correction, never by editing the public record.
const text = (max: number) => z.string().trim().min(1).max(max);
const content = { title: text(160), body: text(10000), usedAmount: z.number().int().min(1).max(1_000_000_000_000).optional(), carriedOutAt: z.iso.date().optional() };
export const updateCreation = z.object({ kind: z.enum(["NEWS", "REALIZATION"]), ...content, correctsId: z.uuid().optional() }).strict();
export const updateRevision = z.object(content).partial().strict();
export const updateReview = z.object({ expectedRevision: z.number().int().min(1), decision: z.enum(["PUBLISH", "REQUEST_REVISION", "REJECT"]), notes: text(5000), publicAttachmentIds: z.array(z.uuid()).max(5).optional() }).strict();
export const updateWithdrawal = z.object({ reason: text(5000) }).strict();
export const MAX_UPDATES = 30;
export const MAX_ATTACHMENTS = 5;

export function reportable(c: any) { if (!c.publishedAt || c.status === "CANCELLED") throw new CampaignError("Only published campaigns accept news and realization reports", 409); }
export function campaignUpdate(c: any, id: string) { const u = (c.updates ?? []).find((u: any) => u.id === id); if (!u) throw new CampaignError("Campaign update not found", 404); return u; }
export function updateEditable(u: any) { if (!["DRAFT", "REVISION_REQUESTED"].includes(u.status)) throw new CampaignError("Submitted updates are immutable", 409); }
export function assertUpdateContent(u: any) {
  if (u.kind !== "REALIZATION") {
    if (u.usedAmount !== undefined || u.carriedOutAt !== undefined) throw new CampaignError("Only realization reports carry a used amount and activity date");
    return;
  }
  if (!u.usedAmount || !u.carriedOutAt) throw new CampaignError("Realization report requires a used amount and activity date");
  // Dates are calendar days; the slack admits "today" in every Indonesian time zone.
  if (Date.parse(u.carriedOutAt) > Date.now() + 14 * 3600000) throw new CampaignError("Activity date cannot be in the future");
}
const counted = (u: any) => u.kind === "REALIZATION" && u.status === "PUBLISHED" && !u.supersededById;
/** Reported by the fundraiser and examined by an operator; not a bank balance or proof of receipt. */
export const reportedUsedAmount = (c: any) => (c.updates ?? []).filter(counted).reduce((sum: number, u: any) => sum + u.usedAmount, 0);
export function correctionTarget(c: any, u: any) {
  if (!u.correctsId) return null;
  const target = campaignUpdate(c, u.correctsId);
  if (target.kind !== u.kind || target.status !== "PUBLISHED" || target.supersededById) throw new CampaignError("Only a current published update of the same kind can be corrected", 409);
  return target;
}
export function assertWithinCollected(c: any, u: any) {
  if (u.kind !== "REALIZATION") return;
  const replaced = correctionTarget(c, u)?.usedAmount ?? 0;
  if (reportedUsedAmount(c) - replaced + u.usedAmount > c.collectedAmount) throw new CampaignError("Reported used amount exceeds confirmed donations", 409);
}
export function createUpdate(c: any, actorId: string, input: z.infer<typeof updateCreation>) {
  reportable(c);
  assertUpdateContent(input);
  c.updates ??= [];
  if (c.updates.length >= MAX_UPDATES) throw new CampaignError(`At most ${MAX_UPDATES} updates per campaign`);
  correctionTarget(c, input);
  const now = new Date().toISOString();
  const u = { ...input, id: randomUUID(), status: "DRAFT", revision: 0, createdAt: now, updatedAt: now, attachments: [], reviewNotes: [] };
  c.updates.push(u); audit(c, actorId, "UPDATE_CREATE", u.title);
  return u;
}
function publish(c: any, u: any, releasedAttachmentIds: string[]) {
  for (const a of u.attachments) a.published = releasedAttachmentIds.includes(a.id);
  const target = correctionTarget(c, u);
  if (target) target.supersededById = u.id;
  u.status = "PUBLISHED"; u.publishedAt = u.updatedAt = new Date().toISOString();
}
export function submitUpdate(c: any, u: any, actorId: string) {
  reportable(c); updateEditable(u); assertUpdateContent(u); assertWithinCollected(c, u);
  u.revision++; u.submittedAt = u.updatedAt = new Date().toISOString();
  if (u.kind === "NEWS") {
    // Unexamined by design: an operator can still withdraw it afterwards.
    publish(c, u, u.attachments.map((a: any) => a.id));
    return audit(c, actorId, "UPDATE_PUBLISH", u.title);
  }
  u.status = "SUBMITTED";
  audit(c, actorId, "UPDATE_SUBMIT", u.title);
}
export function reviewUpdate(c: any, u: any, actorId: string, input: z.infer<typeof updateReview>) {
  if (u.status !== "SUBMITTED" || u.revision !== input.expectedRevision) throw new CampaignError("Review is stale; reload the submitted update", 409);
  if (input.decision === "PUBLISH") {
    reportable(c); assertWithinCollected(c, u);
    // The fundraiser proposes which attachments may be public; the operator still opts in to each one.
    const released = input.publicAttachmentIds ?? [];
    for (const id of released) if (!u.attachments.some((a: any) => a.id === id && a.visibility === "PUBLIC")) throw new CampaignError("Only attachments proposed as public can be published");
    publish(c, u, released);
  } else {
    u.status = input.decision === "REJECT" ? "REJECTED" : "REVISION_REQUESTED";
    u.updatedAt = new Date().toISOString();
  }
  u.reviewNotes.push({ decision: input.decision, notes: input.notes, actorId, revision: u.revision, at: u.updatedAt });
  audit(c, actorId, `UPDATE_${input.decision}`, input.notes);
}
export function withdrawUpdate(c: any, u: any, actorId: string, reason: string) {
  if (u.status !== "PUBLISHED") throw new CampaignError("Only published updates can be withdrawn", 409);
  u.status = "WITHDRAWN"; u.withdrawnReason = reason; u.withdrawnAt = u.updatedAt = new Date().toISOString();
  // A withdrawn correction no longer replaces the record it corrected.
  for (const other of c.updates) if (other.supersededById === u.id) delete other.supersededById;
  u.reviewNotes.push({ decision: "WITHDRAW", notes: reason, actorId, revision: u.revision, at: u.withdrawnAt });
  audit(c, actorId, "UPDATE_WITHDRAW", reason);
}
const attachmentDto = (a: any) => ({ id: a.id, name: a.name, contentType: a.contentType, size: a.size });
export function updateDto(u: any, privileged: boolean) {
  const shared = { id: u.id, kind: u.kind, title: u.title, status: u.status, publishedAt: u.publishedAt, correctsId: u.correctsId, supersededById: u.supersededById };
  if (privileged) return { ...shared, body: u.body, usedAmount: u.usedAmount, carriedOutAt: u.carriedOutAt, revision: u.revision, createdAt: u.createdAt, updatedAt: u.updatedAt, submittedAt: u.submittedAt, withdrawnAt: u.withdrawnAt, withdrawnReason: u.withdrawnReason, reviewNotes: u.reviewNotes, attachments: u.attachments.map((a: any) => ({ ...attachmentDto(a), createdAt: a.createdAt, visibility: a.visibility, published: !!a.published })) };
  // A withdrawn update stays visible as a marker so the public record never silently shrinks.
  if (u.status === "WITHDRAWN") return { ...shared, withdrawnAt: u.withdrawnAt, withdrawnReason: u.withdrawnReason };
  return { ...shared, body: u.body, usedAmount: u.usedAmount, carriedOutAt: u.carriedOutAt, attachments: u.attachments.filter((a: any) => a.published).map(attachmentDto) };
}
export function updatesDto(c: any, privileged: boolean) {
  const updates = (c.updates ?? []).filter((u: any) => privileged || ["PUBLISHED", "WITHDRAWN"].includes(u.status));
  return updates.map((u: any) => updateDto(u, privileged)).sort((a: any, b: any) => (b.publishedAt ?? b.createdAt ?? "").localeCompare(a.publishedAt ?? a.createdAt ?? ""));
}
