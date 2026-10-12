import { Hono } from "hono";
import { encryptCampaignDocument, decryptCampaignDocument, parseCampaignUpload, campaignDocumentHeaders } from "../crowdfunding-documents";
import { MAX_ATTACHMENTS, campaignUpdate, createUpdate, reviewUpdate, submitUpdate, updateCreation, updateEditable, updateReview, updateRevision, updateWithdrawal, withdrawUpdate, assertUpdateContent, updateDto } from "../crowdfunding-updates";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { CampaignError, authenticate, operator, campaign, owner, privateAccess, editable, audit, enqueue, dto, queueRow, donorDto, donorId, campaignDonors, donationReceipt, publicUser, registration, campaignFields, hash, secret, paymentDto, reconcilePayment, retryCampaignPayment, publishedCampaignMaterial, drainCampaignOutbox, type CampaignRuntime } from "../crowdfunding";

const PUBLIC = ["PUBLISHED", "SUSPENDED", "CLOSED"];
const publiclyVisible = (campaign: any) => PUBLIC.includes(campaign.status) || !!campaign.publishedAt;
let dummyPasswordHash: Promise<string> | undefined;
const passwordOptions = { algorithm: "argon2id" as const, memoryCost: 19456, timeCost: 2 };
export function createCrowdfundingRoutes(configured: CampaignRuntime | null | (() => CampaignRuntime | null)) {
  const resolve = () => typeof configured === "function" ? configured() : configured;
  const runtime = new Proxy({} as CampaignRuntime, { get: (_target, property) => resolve()?.[property as keyof CampaignRuntime] });
  const app = new Hono();
  app.use("*", bodyLimit({ maxSize: 3_000_000, onError: c => c.json({ success: false, error: "Request too large" }, 413) }));
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!resolve()) return c.json({ success: false, error: "Crowdfunding storage is unconfigured" }, 503);
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ success: false, error: "Invalid request" }, 400);
    if (error instanceof CampaignError) return c.json({ success: false, error: error.message }, error.status);
    console.error("[crowdfunding] request failed; sensitive request and storage details suppressed");
    return c.json({ success: false, error: "Crowdfunding service unavailable" }, 503);
  });
  const tx = <T>(fn: Parameters<CampaignRuntime["store"]["transaction"]>[0]) => runtime!.store.transaction(fn) as Promise<T>;
  const bearer = (c: any) => c.req.header("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] || "";
  const view = (s: any, campaign: any, privileged = false) => dto(s, campaign, !!runtime?.chain, privileged);

  app.post("/auth/register", async c => {
    const input = registration.parse(await c.req.json());
    await runtime!.store.transaction(s => {
      const key = hash(`register:${input.email}`); const previous = s.attempts[key];
      const attempt = !previous || previous.until <= Date.now() ? { count: 0, until: Date.now() + 15 * 60000 } : previous;
      if (attempt.count >= 5) throw new CampaignError("Too many registration attempts; retry later", 429);
      attempt.count++; s.attempts[key] = attempt;
    });
    const passwordHash = await Bun.password.hash(input.password, passwordOptions);
    const result = await tx(s => {
      if (Object.values(s.users).some(u => u.email === input.email)) throw new CampaignError("Email already registered", 409);
      const { password, ...fields } = input;
      const user = { ...fields, id: randomUUID(), role: "FUNDRAISER", passwordHash };
      s.users[user.id] = user;
      const token = secret(); s.sessions[hash(token)] = { userId: user.id, expiresAt: Date.now() + 7 * 86400000 };
      return { token, user: publicUser(user) };
    });
    return c.json({ success: true, ...(result as object) }, 201);
  });
  app.post("/auth/login", async c => {
    const input = z.object({ email: z.email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(128) }).strict().parse(await c.req.json());
    // Persist attempt before verification: failed authentication must not roll back the throttle.
    const user = await runtime!.store.transaction(s => {
      const key = hash(input.email); const previous = s.attempts[key];
      const attempt = !previous || previous.until <= Date.now() ? { count: 0, until: Date.now() + 15 * 60000 } : previous;
      if (attempt.count >= 10) throw new CampaignError("Too many login attempts; retry later", 429);
      attempt.count++; s.attempts[key] = attempt;
      return Object.values(s.users).find(u => u.email === input.email);
    });
    // Verify an Argon2 hash even for unknown accounts, with the same generic failure.
    dummyPasswordHash ??= Bun.password.hash(secret(), passwordOptions);
    const valid = await Bun.password.verify(input.password, user?.passwordHash || await dummyPasswordHash);
    if (!user || !valid) throw new CampaignError("Invalid email or password", 401);
    const token = secret();
    await runtime!.store.transaction(s => { s.sessions[hash(token)] = { userId: user.id, expiresAt: Date.now() + 7 * 86400000 }; delete s.attempts[hash(input.email)]; });
    return c.json({ success: true, token, user: publicUser(user) });
  });
  app.get("/auth/me", async c => c.json({ success: true, user: await tx(s => publicUser(authenticate(s, bearer(c)))) }));
  app.post("/auth/logout", async c => { await tx(s => { authenticate(s, bearer(c)); delete s.sessions[hash(bearer(c))]; }); return c.json({ success: true }); });
  app.get("/campaigns", async c => c.json({ success: true, campaigns: await tx(s => Object.values(s.campaigns).filter(v => publiclyVisible(v)).map(v => view(s, v))) }));
  app.get("/mine", async c => c.json({ success: true, campaigns: await tx(s => { const u = authenticate(s, bearer(c)); return Object.values(s.campaigns).filter(v => v.ownerId === u.id).map(v => view(s, v, true)); }) }));
  app.get("/review", async c => c.json({ success: true, campaigns: await tx(s => { operator(authenticate(s, bearer(c))); return Object.values(s.campaigns).filter(v => v.status !== "DRAFT").map(v => view(s, v, true)); }) }));
  app.get("/review/queue", async c => c.json({ success: true, campaigns: await tx(s => { operator(authenticate(s, bearer(c))); return Object.values(s.campaigns).filter(v => v.status !== "DRAFT").map(v => queueRow(s, v)); }) }));
  app.get("/campaigns/:id", async c => c.json({ success: true, campaign: await tx(s => {
    const v = campaign(s, c.req.param("id"));
    const u = bearer(c) ? authenticate(s, bearer(c)) : null;
    const privileged = u && (u.id === v.ownerId || u.role === "OPERATOR");
    if (!publiclyVisible(v) && !privileged) throw new CampaignError("Campaign not found", 404);
    return view(s, v, !!privileged);
  }) }));
  app.post("/campaigns", async c => {
    const input = campaignFields.parse(await c.req.json());
    return c.json({ success: true, campaign: await tx(s => {
      const u = authenticate(s, bearer(c));
      if (u.role !== "FUNDRAISER") throw new CampaignError("Fundraiser account required", 403);
      if (Date.parse(input.endsAt) <= Date.now()) throw new CampaignError("End date must be in the future");
      const v = { ...input, id: randomUUID(), ownerId: u.id, status: "DRAFT", version: 0, collectedAmount: 0, donationCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), documents: [], reviewNotes: [], history: [], versions: [] };
      s.campaigns[v.id] = v; audit(v, u.id, "CREATE", "Campaign draft created"); return view(s, v, true);
    }) }, 201);
  });
  app.patch("/campaigns/:id", async c => {
    const input = campaignFields.partial().parse(await c.req.json());
    return c.json({ success: true, campaign: await tx(s => {
      const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); owner(v, u); editable(v);
      if (input.endsAt && Date.parse(input.endsAt) <= Date.now()) throw new CampaignError("End date must be in the future");
      Object.assign(v, input); audit(v, u.id, "EDIT", "Draft material revised"); return view(s, v, true);
    }) });
  });
  app.post("/campaigns/:id/submit", async c => c.json({ success: true, campaign: await tx(s => {
    const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); owner(v, u); editable(v);
    if (!v.consent || Date.parse(v.endsAt) <= Date.now()) throw new CampaignError("Consent and future end date required");
    v.version++; v.status = "SUBMITTED";
    v.versions.push({ version: v.version, at: new Date().toISOString(), fields: Object.fromEntries(Object.keys(campaignFields.shape).map(k => [k, v[k]])), documents: structuredClone(v.documents) });
    audit(v, u.id, "SUBMIT", "Version frozen for operator review"); return view(s, v, true);
  }) }));
  app.post("/campaigns/:id/review", async c => {
    const input = z.object({ expectedVersion: z.number().int().min(1), decision: z.enum(["REQUEST_REVISION", "REJECT", "APPROVE"]), notes: z.string().trim().min(1).max(5000), checks: z.object({ identity: z.boolean(), consent: z.boolean(), needs: z.boolean(), budget: z.boolean(), distribution: z.boolean() }).strict().optional(), complianceReference: z.string().trim().min(1).max(1000).optional() }).strict().parse(await c.req.json());
    return c.json({ success: true, campaign: await tx(s => {
      const u = authenticate(s, bearer(c)); operator(u); const v = campaign(s, c.req.param("id"));
      if (u.id === v.ownerId) throw new CampaignError("Self review forbidden", 403);
      if (v.status !== "SUBMITTED" || v.version !== input.expectedVersion) throw new CampaignError("Review version is stale; reload the submitted campaign", 409);
      if (input.decision === "APPROVE" && (!input.checks || !Object.values(input.checks).every(Boolean) || !input.complianceReference)) throw new CampaignError("Approval requires every check and a compliance reference");
      v.status = { REQUEST_REVISION: "REVISION_REQUESTED", REJECT: "REJECTED", APPROVE: "APPROVED" }[input.decision];
      v.reviewNotes.push({ ...input, actorId: u.id, version: v.version, at: new Date().toISOString() });
      audit(v, u.id, input.decision, input.notes);
      if (input.decision === "APPROVE") enqueue(s, v, "APPROVAL");
      return view(s, v, true);
    }) });
  });
  app.post("/campaigns/:id/publish", async c => {
    const input = z.object({ expectedVersion: z.number().int().min(1) }).strict().parse(await c.req.json());
    return c.json({ success: true, campaign: await tx(s => {
      const u = authenticate(s, bearer(c)); operator(u); const v = campaign(s, c.req.param("id"));
      if (u.id === v.ownerId) throw new CampaignError("Self publishing forbidden", 403);
      if (v.version !== input.expectedVersion || v.status !== "APPROVED" || Date.parse(v.endsAt) <= Date.now()) throw new CampaignError("Campaign version must be current, approved and unexpired", 409);
      v.status = "PUBLISHED"; v.publishedAt = new Date().toISOString(); v.publicSnapshot = publishedCampaignMaterial(s, v);
      audit(v, u.id, "PUBLISH", "Operator published approved version"); enqueue(s, v, "PUBLISH"); return view(s, v, true);
    }) });
  });
  app.post("/campaigns/:id/reopen", async c => {
    const input = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(1).max(5000) }).strict().parse(await c.req.json());
    return c.json({ success: true, campaign: await tx(s => {
      const u = authenticate(s, bearer(c)); operator(u); const v = campaign(s, c.req.param("id"));
      if (u.id === v.ownerId) throw new CampaignError("Self review forbidden", 403);
      if (!["APPROVED", "PUBLISHED", "SUSPENDED"].includes(v.status) || v.version !== input.expectedVersion) throw new CampaignError("Campaign version cannot be reopened; reload the campaign", 409);
      // Compatibility for already-published records created before public snapshots were introduced.
      if (v.publishedAt && !v.publicSnapshot) v.publicSnapshot = publishedCampaignMaterial(s, v);
      v.status = "REVISION_REQUESTED";
      v.reviewNotes.push({ decision: "REOPEN", notes: input.reason, actorId: u.id, version: v.version, at: new Date().toISOString() });
      audit(v, u.id, "REOPEN", input.reason); enqueue(s, v, "STATUS", { action: "REOPEN" });
      return view(s, v, true);
    }) });
  });
  app.post("/campaigns/:id/status", async c => {
    const input = z.object({ status: z.enum(["SUSPENDED", "CLOSED", "CANCELLED"]), reason: z.string().trim().min(1).max(5000) }).strict().parse(await c.req.json());
    return c.json({ success: true, campaign: await tx(s => {
      const u = authenticate(s, bearer(c)); operator(u); const v = campaign(s, c.req.param("id"));
      const allowed = input.status === "CANCELLED" ? ["DRAFT", "SUBMITTED", "REVISION_REQUESTED", "APPROVED", "PUBLISHED", "SUSPENDED"] : input.status === "SUSPENDED" ? ["PUBLISHED"] : ["PUBLISHED", "SUSPENDED"];
      if (!allowed.includes(v.status)) throw new CampaignError("Invalid status transition", 409);
      v.status = input.status; audit(v, u.id, input.status, input.reason); enqueue(s, v, "STATUS"); return view(s, v, true);
    }) });
  });
  app.post("/campaigns/:id/documents", async c => {
    const { input, bytes } = parseCampaignUpload(await c.req.json());
    const result = await runtime!.store.transaction(s => {
      const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); owner(v, u); editable(v);
      if (v.documents.length >= 10) throw new CampaignError("At most 10 private documents");
      const id = randomUUID();
      const encrypted = encryptCampaignDocument(runtime!.documentKey, v.id, id, bytes);
      const document = { name: input.name, contentType: input.contentType, id, size: bytes.length, createdAt: new Date().toISOString() };
      v.documents.push({ ...document, encrypted, contentHash: hash(bytes) }); audit(v, u.id, "DOCUMENT", "Private evidence uploaded");
      return { campaign: view(s, v, true), document };
    });
    return c.json({ success: true, ...result }, 201);
  });
  app.get("/campaigns/:id/documents/:documentId", async c => {
    const document = await runtime!.store.transaction(s => { const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); privateAccess(v, u); const d = v.documents.find((d: any) => d.id === c.req.param("documentId")); if (!d) throw new CampaignError("Document not found", 404); return d; });
    return new Response(decryptCampaignDocument(runtime!.documentKey, c.req.param("id"), document), { headers: campaignDocumentHeaders(document) });
  });
  // Kabar & laporan realisasi: fundraiser drafts, an independent operator examines before publication.
  const updateResult = (s: any, v: any, item: any) => ({ campaign: view(s, v, true), update: updateDto(item, true) });
  app.post("/campaigns/:id/updates", async c => {
    const input = updateCreation.parse(await c.req.json());
    return c.json({ success: true, ...await tx<object>(s => { const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); owner(v, u); return updateResult(s, v, createUpdate(v, u.id, input)); }) }, 201);
  });
  app.patch("/campaigns/:id/updates/:updateId", async c => {
    const input = updateRevision.parse(await c.req.json());
    return c.json({ success: true, ...await tx<object>(s => {
      const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); owner(v, u); const item = campaignUpdate(v, c.req.param("updateId")); updateEditable(item);
      assertUpdateContent({ ...item, ...input }); Object.assign(item, input); item.updatedAt = new Date().toISOString();
      return updateResult(s, v, item);
    }) });
  });
  app.delete("/campaigns/:id/updates/:updateId", async c => c.json({ success: true, campaign: await tx(s => {
    const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); owner(v, u); const item = campaignUpdate(v, c.req.param("updateId"));
    // Once submitted, an update is part of the examined record and can no longer be discarded.
    if (item.status !== "DRAFT" || item.revision) throw new CampaignError("Only never-submitted drafts can be deleted", 409);
    v.updates = v.updates.filter((other: any) => other !== item); audit(v, u.id, "UPDATE_DELETE", item.title); return view(s, v, true);
  }) }));
  app.post("/campaigns/:id/updates/:updateId/submit", async c => c.json({ success: true, ...await tx<object>(s => {
    const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); owner(v, u); const item = campaignUpdate(v, c.req.param("updateId"));
    submitUpdate(v, item, u.id); return updateResult(s, v, item);
  }) }));
  app.post("/campaigns/:id/updates/:updateId/review", async c => {
    const input = updateReview.parse(await c.req.json());
    return c.json({ success: true, ...await tx<object>(s => {
      const u = authenticate(s, bearer(c)); operator(u); const v = campaign(s, c.req.param("id"));
      if (u.id === v.ownerId) throw new CampaignError("Self review forbidden", 403);
      const item = campaignUpdate(v, c.req.param("updateId")); reviewUpdate(v, item, u.id, input); return updateResult(s, v, item);
    }) });
  });
  app.post("/campaigns/:id/updates/:updateId/withdraw", async c => {
    const input = updateWithdrawal.parse(await c.req.json());
    return c.json({ success: true, ...await tx<object>(s => {
      const u = authenticate(s, bearer(c)); operator(u); const v = campaign(s, c.req.param("id"));
      if (u.id === v.ownerId) throw new CampaignError("Self review forbidden", 403);
      const item = campaignUpdate(v, c.req.param("updateId")); withdrawUpdate(v, item, u.id, input.reason); return updateResult(s, v, item);
    }) });
  });
  app.post("/campaigns/:id/updates/:updateId/attachments", async c => {
    const { input, bytes } = parseCampaignUpload(await c.req.json(), true);
    return c.json({ success: true, ...await tx<object>(s => {
      const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); owner(v, u); const item = campaignUpdate(v, c.req.param("updateId")); updateEditable(item);
      // Kabar is published without examination, so it only carries images the fundraiser makes public.
      if (item.kind === "NEWS" && (input.visibility !== "PUBLIC" || input.contentType === "application/pdf")) throw new CampaignError("News attachments must be public images");
      if (item.attachments.length >= MAX_ATTACHMENTS) throw new CampaignError(`At most ${MAX_ATTACHMENTS} attachments per update`);
      const id = randomUUID();
      item.attachments.push({ id, name: input.name, contentType: input.contentType, visibility: input.visibility, size: bytes.length, createdAt: new Date().toISOString(), encrypted: encryptCampaignDocument(runtime!.documentKey, v.id, id, bytes), contentHash: hash(bytes) });
      item.updatedAt = new Date().toISOString();
      return updateResult(s, v, item);
    }) }, 201);
  });
  app.delete("/campaigns/:id/updates/:updateId/attachments/:attachmentId", async c => c.json({ success: true, ...await tx<object>(s => {
    const u = authenticate(s, bearer(c)); const v = campaign(s, c.req.param("id")); owner(v, u); const item = campaignUpdate(v, c.req.param("updateId")); updateEditable(item);
    if (!item.attachments.some((a: any) => a.id === c.req.param("attachmentId"))) throw new CampaignError("Attachment not found", 404);
    item.attachments = item.attachments.filter((a: any) => a.id !== c.req.param("attachmentId")); item.updatedAt = new Date().toISOString();
    return updateResult(s, v, item);
  }) }));
  app.get("/campaigns/:id/updates/:updateId/attachments/:attachmentId", async c => {
    const attachment = await runtime!.store.transaction(s => {
      const v = campaign(s, c.req.param("id")); const item = (v.updates ?? []).find((u: any) => u.id === c.req.param("updateId"));
      const a = item?.attachments.find((a: any) => a.id === c.req.param("attachmentId"));
      // Only attachments an operator released with a still-published update are public.
      if (!(a?.published && item.status === "PUBLISHED" && publiclyVisible(v))) { privateAccess(v, authenticate(s, bearer(c))); if (!a) throw new CampaignError("Attachment not found", 404); }
      return a;
    });
    return new Response(decryptCampaignDocument(runtime!.documentKey, c.req.param("id"), attachment), { headers: campaignDocumentHeaders(attachment) });
  });
  app.get("/campaigns/:id/donors", async c => {
    const page = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(50).default(10) }).parse(c.req.query());
    return c.json({ success: true, ...await tx<object>(s => {
      const v = campaign(s, c.req.param("id"));
      if (!publiclyVisible(v)) { const u = bearer(c) ? authenticate(s, bearer(c)) : null; if (!u) throw new CampaignError("Campaign not found", 404); privateAccess(v, u); }
      const donors = campaignDonors(s, v.id);
      return { total: donors.length, donors: donors.slice(page.offset, page.offset + page.limit).map(donorDto) };
    }) });
  });
  // Prayers are published unexamined; an operator can hide the text, never the donation itself.
  app.post("/campaigns/:id/donors/:donorId/hide-prayer", async c => {
    const input = z.object({ reason: z.string().trim().min(1).max(1000) }).strict().parse(await c.req.json());
    return c.json({ success: true, donor: await tx(s => {
      const u = authenticate(s, bearer(c)); operator(u); const v = campaign(s, c.req.param("id"));
      const p = campaignDonors(s, v.id).find(p => donorId(p) === c.req.param("donorId"));
      if (!p?.prayer) throw new CampaignError("Prayer not found", 404);
      if (!p.prayerHiddenAt) { p.prayerHiddenAt = new Date().toISOString(); p.prayerHiddenReason = input.reason; audit(v, u.id, "PRAYER_HIDE", input.reason); }
      return donorDto(p);
    }) });
  });
  app.post("/campaigns/:id/donations", async c => {
    const { prayer, ...input } = z.object({ amount: z.number().int().min(1000).max(1_000_000_000), donorName: z.string().trim().min(1).max(120), isAnonymous: z.boolean(), prayer: z.string().trim().max(280).optional() }).strict().parse(await c.req.json());
    if (!runtime!.gateway) throw new CampaignError("Payment gateway is unconfigured", 503);
    const accessToken = secret();
    const p = await runtime!.store.transaction(s => {
      const v = campaign(s, c.req.param("id"));
      if (v.status !== "PUBLISHED" || Date.parse(v.endsAt) <= Date.now()) throw new CampaignError("Campaign is not accepting donations", 409);
      const p = { id: `CF-${randomUUID()}`, campaignId: v.id, campaignVersion: v.version, checkoutLeaseUntil: Date.now() + 60000, ...input, ...(prayer ? { prayer } : {}), accessTokenHash: hash(accessToken), status: "CREATING", paidAmount: 0, refundedAmount: 0, createdAt: new Date().toISOString() }; s.payments[p.id] = p; return p;
    });
    try {
      const checkout = await runtime!.gateway.create(p.id, p.amount, input.isAnonymous ? "Anonymous" : input.donorName);
      const result = await runtime!.store.transaction(s => { const saved = s.payments[p.id]; Object.assign(saved, checkout); delete saved.checkoutLeaseUntil; if (saved.status === "CREATING") saved.status = "PENDING"; return paymentDto(saved); });
      return c.json({ success: true, payment: { ...result, accessToken } }, 201);
    } catch {
      // Keep the intent: a timeout can still have created an order at the gateway.
      const saved = await runtime!.store.transaction(s => { if (s.payments[p.id].status === "CREATING") s.payments[p.id].status = "GATEWAY_ERROR"; delete s.payments[p.id].checkoutLeaseUntil; return paymentDto(s.payments[p.id]); });
      return c.json({ success: false, error: "Checkout unavailable; payment is not confirmed", payment: { ...saved, accessToken } }, 502);
    }
  });
  // Public donation check by order reference. The reference is an unguessable id the donor already holds.
  app.get("/receipts/:reference", async c => {
    const reference = c.req.param("reference").trim().replace(/^cf-/i, "CF-");
    return c.json({ success: true, receipt: await tx(s => {
      const p = /^CF-[0-9a-fA-F-]{36}$/.test(reference) ? s.payments[`CF-${reference.slice(3).toLowerCase()}`] : undefined;
      if (!p) throw new CampaignError("Donation not found", 404);
      return donationReceipt(s, p);
    }) });
  });
  app.post("/payments/:id/retry", async c => {
    const id = c.req.param("id"); const token = c.req.header("X-Payment-Token") || "";
    try { return c.json({ success: true, payment: await retryCampaignPayment(runtime, id, token) }); }
    catch (error) {
      if (error instanceof CampaignError && error.status !== 502) throw error;
      const payment = await runtime.store.transaction(s => {
        const p = s.payments[id]; if (!p || !token || hash(token) !== p.accessTokenHash) throw new CampaignError("Payment access denied", 404);
        return paymentDto(p);
      });
      return c.json({ success: false, error: "Checkout recovery is uncertain; retry the same payment later", retryAvailable: true, payment }, 502);
    }
  });
  app.get("/payments/:id", async c => {
    const id = c.req.param("id");
    await tx(s => { const p = s.payments[id]; const token = c.req.header("X-Payment-Token") || ""; if (!p || !token || hash(token) !== p.accessTokenHash) throw new CampaignError("Payment access denied", 404); });
    return c.json({ success: true, payment: await reconcilePayment(runtime!, id) });
  });
  app.post("/midtrans/notification", async c => {
    const body = await c.req.json();
    if (!runtime!.gateway) throw new CampaignError("Payment gateway is unconfigured", 503);
    if (!body || !runtime!.gateway.verify(body)) throw new CampaignError("Invalid gateway signature", 401);
    await tx(s => { if (!s.payments[body.order_id]) throw new CampaignError("Payment not found", 404); });
    await reconcilePayment(runtime!, body.order_id);
    return c.json({ success: true });
  });
  app.post("/chain/retry", async c => { await tx(s => operator(authenticate(s, bearer(c)))); return c.json({ success: true, ...await drainCampaignOutbox(runtime!, true) }); });
  app.notFound(c => c.json({ success: false, error: "Crowdfunding route not found" }, 404));
  return app;
}
