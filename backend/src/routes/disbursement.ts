/**
 * Program bantuan and durable Pengajuan drafts (Spec #86, ticket #89).
 *
 *   GET    /api/workspace/programs                 programs this institution owns, archived included
 *   POST   /api/workspace/programs                  create one - always durable, never a draft
 *   GET    /api/workspace/programs/:id               one program, by id
 *   POST   /api/workspace/programs/:id/archive        archive; the row and its history stay readable
 *   GET    /api/workspace/proposals?programId=       drafts, optionally under one program
 *   POST   /api/workspace/proposals                  save a draft - including one still full of issues
 *   GET    /api/workspace/proposals/:id               reopen one, with a computed summary
 *   DELETE /api/workspace/proposals/:id               discard a draft
 *
 * Submitting a proposal for pemeriksaan is the next slice (#86's later
 * tickets) and does not exist here: every draft this router returns stays in
 * status "DRAFT".
 */

import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  FUND_TYPES,
  isFundType,
  summarizeProposalDraft,
  validateProgramInput,
  validateProposalDraft,
  withStableIds,
  type AidLine,
  type Beneficiary,
  type ProposalDraftInput,
} from "../disbursement";
import { DraftOperationConflictError, ProposalDraftConflictError } from "../disbursement-store";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
import {
  checkOperationalMandate,
  assertCanApproveProposal,
} from "../operational-mandate";
// Shared with `evidence-preparation.ts` rather than redefined: identical shape,
// no domain-specific wording, so a second copy here would just be a second
// place for it to drift.
import { readJson, text } from "./evidence-preparation";

const disbursementRoutes = new Hono();

disbursementRoutes.onError((error, c) => {
  if (error instanceof ProposalDraftConflictError || error instanceof DraftOperationConflictError) {
    return c.json({ success: false, error: error.message }, 409);
  }
  throw error;
});

/**
 * Its own message rather than `evidence-preparation.ts`'s `unconfigured`: that
 * one's copy names "Paket bukti" and encrypted document storage, which is the
 * wrong domain here - Program/Pengajuan drafts need only the workspace tables,
 * not the evidence file store.
 */
const unconfigured = (c: Context) =>
  c.json(
    {
      success: false,
      error:
        "Pengelolaan penyaluran lembaga belum dikonfigurasi pada deployment ini. " +
        "Setel DATABASE_URL, lalu jalankan ulang server agar skema ini dibuat.",
    },
    503
  );

const isDisbursementPath = (path: string) => {
  const p = path.replace(/^\/api\/workspace/, "");
  return (
    p === "/programs" ||
    p.startsWith("/programs/") ||
    p === "/proposals" ||
    p.startsWith("/proposals/") ||
    p === "/fund-types"
  );
};

disbursementRoutes.use("*", async (c, next) => {
  if (!isDisbursementPath(c.req.path)) {
    return next();
  }
  const runtime = workspaceRuntime();
  if (!runtime || !runtime.disbursement) return unconfigured(c);
  return next();
});

const runtimeOf = (): WorkspaceRuntime & { disbursement: NonNullable<WorkspaceRuntime["disbursement"]> } =>
  workspaceRuntime() as never;

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

disbursementRoutes.get("/programs", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const programs = await runtime.disbursement.listPrograms(auth.session.institutionId);
  return c.json({ success: true, programs });
});

disbursementRoutes.post("/programs", async (c) => {
  const runtime = runtimeOf();
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const auth = await authenticateWorkspace(
    c,
    runtime,
    typeof body.institutionId === "string" ? body.institutionId : undefined
  );
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const officer = await runtime.store.getOfficerForAccount(auth.session.account, auth.session.institutionId);
  if (!officer || !officer.isActive) {
    return c.json({ success: false, error: "Profil petugas belum lengkap atau nonaktif. Tindakan yang memerlukan mandat ditahan." }, 403);
  }
  const mandates = await runtime.store.activeMandatesForOfficer(auth.session.institutionId, officer.id, runtime.now());
  const mandateCheck = checkOperationalMandate(mandates, {
    fn: "MANAGE_PROGRAMS",
    now: runtime.now(),
    account: auth.session.account,
  });
  if (!mandateCheck.allowed) {
    return c.json({ success: false, error: mandateCheck.reason }, 403);
  }

  const input = {
    name: text(body.name),
    purpose: text(body.purpose),
    fundType: isFundType(body.fundType) ? body.fundType : ("" as never),
    scope: text(body.scope),
    referenceCeiling:
      body.referenceCeiling === null || body.referenceCeiling === undefined
        ? null
        : String(body.referenceCeiling).trim(),
  };
  const issues = validateProgramInput(input);
  if (issues.length > 0) {
    return c.json(
      { success: false, error: "Data program belum lengkap atau tidak sah.", issues },
      400
    );
  }

  const program = await runtime.disbursement.createProgram({
    id: crypto.randomUUID(),
    institutionId: auth.session.institutionId,
    name: input.name,
    purpose: input.purpose,
    fundType: input.fundType,
    scope: input.scope,
    referenceCeiling: input.referenceCeiling,
    createdBy: auth.session.account,
    now: runtime.now(),
  });

  return c.json({ success: true, program }, 201);
});

disbursementRoutes.get("/programs/:id", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const program = await runtime.disbursement.getProgram(auth.session.institutionId, c.req.param("id"));
  if (!program) return refuse(c, 404, "not-found");
  return c.json({ success: true, program });
});

disbursementRoutes.post("/programs/:id/archive", async (c) => {
  const runtime = runtimeOf();
  const body = (await readJson(c)) ?? {};
  const auth = await authenticateWorkspace(
    c,
    runtime,
    typeof body.institutionId === "string" ? body.institutionId : undefined
  );
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const officer = await runtime.store.getOfficerForAccount(auth.session.account, auth.session.institutionId);
  if (!officer || !officer.isActive) {
    return c.json({ success: false, error: "Profil petugas belum lengkap atau nonaktif. Tindakan yang memerlukan mandat ditahan." }, 403);
  }
  const mandates = await runtime.store.activeMandatesForOfficer(auth.session.institutionId, officer.id, runtime.now());
  const mandateCheck = checkOperationalMandate(mandates, {
    fn: "MANAGE_PROGRAMS",
    now: runtime.now(),
    account: auth.session.account,
  });
  if (!mandateCheck.allowed) {
    return c.json({ success: false, error: mandateCheck.reason }, 403);
  }

  const program = await runtime.disbursement.setProgramStatus(
    auth.session.institutionId,
    c.req.param("id"),
    "ARCHIVED",
    runtime.now()
  );
  if (!program) return refuse(c, 404, "not-found");
  return c.json({ success: true, program });
});

// ---------------------------------------------------------------------------
// Proposal drafts
// ---------------------------------------------------------------------------

const beneficiaryFrom = (raw: unknown): Beneficiary | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const identity = row.identityBasis as Record<string, unknown> | undefined;
  const guardian = row.guardian as Record<string, unknown> | null | undefined;
  const paymentRecipient = row.paymentRecipient as Record<string, unknown> | null | undefined;
  return {
    id: text(row.id),
    name: text(row.name),
    identityBasis:
      identity?.kind === "NIK"
        ? { kind: "NIK", value: text(identity.value) }
        : { kind: "ALTERNATIVE", description: text(identity?.description) },
    asnaf: text(row.asnaf),
    addressOrScope: text(row.addressOrScope),
    guardian: guardian ? { name: text(guardian.name), relationship: text(guardian.relationship) } : null,
    paymentRecipient: paymentRecipient
      ? { name: text(paymentRecipient.name), relation: text(paymentRecipient.relation) }
      : null,
  };
};

const aidLineFrom = (raw: unknown): AidLine | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const value = row.value as Record<string, unknown> | undefined;
  if (value?.kind === "GOODS") {
    return {
      id: text(row.id),
      beneficiaryId: text(row.beneficiaryId),
      aidType: text(row.aidType),
      period: text(row.period),
      value: {
        kind: "GOODS",
        unit: text(value.unit),
        quantityRequested: String(value.quantityRequested ?? "").trim(),
        quantityApproved: null,
        valuedAmountIdr:
          value.valuedAmountIdr === null || value.valuedAmountIdr === undefined
            ? null
            : String(value.valuedAmountIdr).trim(),
      },
    };
  }
  return {
    id: text(row.id),
    beneficiaryId: text(row.beneficiaryId),
    aidType: text(row.aidType),
    period: text(row.period),
    value: {
      kind: "MONEY",
      amountRequestedIdr: String(value?.amountRequestedIdr ?? "").trim(),
      amountApprovedIdr: null,
    },
  };
};

const draftInputFrom = (body: Record<string, unknown>): ProposalDraftInput | null => {
  const beneficiariesRaw = Array.isArray(body.beneficiaries) ? body.beneficiaries : [];
  const aidLinesRaw = Array.isArray(body.aidLines) ? body.aidLines : [];
  const beneficiaries = beneficiariesRaw.map(beneficiaryFrom);
  const aidLines = aidLinesRaw.map(aidLineFrom);
  if (beneficiaries.some((row) => row === null) || aidLines.some((row) => row === null)) return null;

  const period = body.aidPeriod as Record<string, unknown> | null | undefined;
  return {
    programId: typeof body.programId === "string" && body.programId.trim() ? body.programId.trim() : null,
    originOfRequest: text(body.originOfRequest),
    purpose: text(body.purpose),
    aidPeriod: period ? { start: text(period.start), end: text(period.end) } : null,
    personInCharge: text(body.personInCharge),
    beneficiaries: beneficiaries as Beneficiary[],
    aidLines: aidLines as AidLine[],
  };
};

disbursementRoutes.get("/proposals", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const programId = c.req.query("programId") ?? undefined;
  const drafts = await runtime.disbursement.listProposalDrafts(auth.session.institutionId, programId);
  return c.json({ success: true, drafts });
});

const mutationVersion = (body: Record<string, unknown>, minimum: number): number | null =>
  typeof body.expectedVersion === "number" && Number.isInteger(body.expectedVersion) &&
  body.expectedVersion >= minimum && body.expectedVersion < 2147483647 &&
  typeof body.operationId === "string" && body.operationId.trim().length > 0 && body.operationId.length <= 128
    ? body.expectedVersion : null;

const requestHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

disbursementRoutes.post("/proposals", async (c) => {
  const runtime = runtimeOf();
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const auth = await authenticateWorkspace(
    c,
    runtime,
    typeof body.institutionId === "string" ? body.institutionId : undefined
  );
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const expectedVersion = mutationVersion(body, 0);
  if (expectedVersion === null || (expectedVersion > 0 && !text(body.id))) {
    return badRequest(c, "Versi yang diharapkan, identitas penyimpanan, dan ID draf untuk perubahan wajib diisi dengan benar.");
  }
  const draftInput = draftInputFrom(body);
  if (!draftInput) return badRequest(c, "Bentuk penerima atau rincian bantuan tidak sah.");

  // A program named on the draft must actually belong to this institution -
  // a payload cannot make a draft point at another institution's program.
  if (draftInput.programId) {
    const program = await runtime.disbursement.getProgram(auth.session.institutionId, draftInput.programId);
    if (!program) return badRequest(c, "Program yang ditunjuk tidak ditemukan pada lembaga ini.");
  }

  const withIds = withStableIds(draftInput, () => crypto.randomUUID());
  const issues = validateProposalDraft(withIds);

  const officer = await runtime.store.getOfficerForAccount(auth.session.account, auth.session.institutionId);
  if (!officer || !officer.isActive) {
    return c.json({ success: false, error: "Profil petugas belum lengkap atau nonaktif. Tindakan yang memerlukan mandat ditahan." }, 403);
  }
  const mandates = await runtime.store.activeMandatesForOfficer(auth.session.institutionId, officer.id, runtime.now());

  let totalRequestedIdr = 0n;
  for (const line of withIds.aidLines) {
    if (line.value.kind === "MONEY" && /^\d+$/.test(line.value.amountRequestedIdr)) {
      totalRequestedIdr += BigInt(line.value.amountRequestedIdr);
    }
  }

  const mandateCheck = checkOperationalMandate(mandates, {
    fn: "PREPARE_PROPOSALS",
    programId: withIds.programId,
    nominalAmount: totalRequestedIdr > 0n ? totalRequestedIdr : null,
    now: runtime.now(),
    account: auth.session.account,
  });
  if (!mandateCheck.allowed) {
    return c.json({ success: false, error: mandateCheck.reason }, 403);
  }

  const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : crypto.randomUUID();
  const now = runtime.now();

  const draft = await runtime.disbursement.saveProposalDraft(
    {
      id,
      institutionId: auth.session.institutionId,
      programId: withIds.programId,
      createdBy: auth.session.account,
      originOfRequest: withIds.originOfRequest,
      purpose: withIds.purpose,
      aidPeriod: withIds.aidPeriod,
      personInCharge: withIds.personInCharge,
      beneficiaries: withIds.beneficiaries,
      aidLines: withIds.aidLines,
      issues,
      createdAt: now,
      updatedAt: now,
    },
    expectedVersion,
    { id: text(body.operationId), account: auth.session.account,
      requestHash: requestHash(["save", text(body.id), expectedVersion, draftInput]) }
  );

  return c.json(
    { success: true, draft, summary: summarizeProposalDraft(draft) },
    expectedVersion === 0 ? 201 : 200
  );
});

disbursementRoutes.get("/proposals/:id", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, c.req.param("id"));
  if (!draft) return refuse(c, 404, "not-found");

  return c.json({
    success: true,
    draft,
    summary: summarizeProposalDraft({
      programId: draft.programId,
      originOfRequest: draft.originOfRequest,
      purpose: draft.purpose,
      aidPeriod: draft.aidPeriod,
      personInCharge: draft.personInCharge,
      beneficiaries: draft.beneficiaries,
      aidLines: draft.aidLines,
    }),
  });
});

disbursementRoutes.delete("/proposals/:id", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const officer = await runtime.store.getOfficerForAccount(auth.session.account, auth.session.institutionId);
  if (!officer || !officer.isActive) {
    return c.json({ success: false, error: "Profil petugas belum lengkap atau nonaktif. Tindakan yang memerlukan mandat ditahan." }, 403);
  }
  const mandates = await runtime.store.activeMandatesForOfficer(auth.session.institutionId, officer.id, runtime.now());
  const mandateCheck = checkOperationalMandate(mandates, {
    fn: "PREPARE_PROPOSALS",
    now: runtime.now(),
    account: auth.session.account,
  });
  if (!mandateCheck.allowed) {
    return c.json({ success: false, error: mandateCheck.reason }, 403);
  }

  const body = await readJson(c);
  const expectedVersion = body ? mutationVersion(body, 1) : null;
  if (!body || expectedVersion === null) return badRequest(c, "Versi yang diharapkan dan identitas penghapusan wajib diisi.");
  const id = c.req.param("id");
  const deleted = await runtime.disbursement.deleteProposalDraft(auth.session.institutionId, id, expectedVersion,
    { id: text(body.operationId), account: auth.session.account, requestHash: requestHash(["delete", id, expectedVersion]) });
  if (!deleted) return refuse(c, 404, "not-found");
  return c.body(null, 204);
});

disbursementRoutes.post("/proposals/:id/verify-approval", async (c) => {
  const runtime = runtimeOf();
  const body = (await readJson(c)) ?? {};
  const auth = await authenticateWorkspace(
    c,
    runtime,
    typeof body.institutionId === "string" ? body.institutionId : undefined
  );
  if (!auth.ok) return auth.response;

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const approverOfficer = await runtime.store.getOfficerForAccount(auth.session.account, auth.session.institutionId);
  if (!approverOfficer || !approverOfficer.isActive) {
    return c.json({ success: false, error: "Profil pengesah belum lengkap atau nonaktif." }, 403);
  }

  const creatorOfficer = await runtime.store.getOfficerForAccount(draft.createdBy, auth.session.institutionId);
  const selfApprovalCheck = assertCanApproveProposal({
    creatorOfficerId: creatorOfficer?.id ?? null,
    creatorAccount: draft.createdBy,
    approverOfficerId: approverOfficer.id,
    approverAccount: auth.session.account,
  });
  if (!selfApprovalCheck.allowed) {
    return c.json({ success: false, error: selfApprovalCheck.reason }, 403);
  }

  let totalRequestedIdr = 0n;
  for (const line of draft.aidLines) {
    if (line.value.kind === "MONEY" && /^\d+$/.test(line.value.amountRequestedIdr)) {
      totalRequestedIdr += BigInt(line.value.amountRequestedIdr);
    }
  }

  const mandates = await runtime.store.activeMandatesForOfficer(
    auth.session.institutionId,
    approverOfficer.id,
    runtime.now()
  );
  const mandateCheck = checkOperationalMandate(mandates, {
    fn: "APPROVE_DECISIONS",
    programId: draft.programId,
    nominalAmount: totalRequestedIdr > 0n ? totalRequestedIdr : null,
    now: runtime.now(),
    account: auth.session.account,
  });
  if (!mandateCheck.allowed) {
    return c.json({ success: false, error: mandateCheck.reason }, 403);
  }

  if (body.endorsementAccount && typeof body.endorsementAccount === "string") {
    const endorsementAcc = body.endorsementAccount.trim().toLowerCase();
    const activeEndorsements = await runtime.store.activeEndorsementAccountsForOfficer(
      auth.session.institutionId,
      approverOfficer.id
    );
    const matched = activeEndorsements.find((ea) => ea.accountAddress.toLowerCase() === endorsementAcc);
    if (!matched) {
      return c.json({ success: false, error: "Akun pengesahan institusi tidak sah atau tidak diizinkan untuk petugas ini." }, 403);
    }
  }

  return c.json({ success: true, allowed: true, mandate: mandateCheck.mandate });
});

disbursementRoutes.get("/fund-types", async (c) => c.json({ success: true, fundTypes: FUND_TYPES }));

export default disbursementRoutes;
