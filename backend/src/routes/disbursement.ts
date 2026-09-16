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
import { ProposalDraftConflictError } from "../disbursement-store";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
// Shared with `evidence-preparation.ts` rather than redefined: identical shape,
// no domain-specific wording, so a second copy here would just be a second
// place for it to drift.
import { readJson, text } from "./evidence-preparation";

const disbursementRoutes = new Hono();

disbursementRoutes.onError((error, c) => {
  if (error instanceof ProposalDraftConflictError) {
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

disbursementRoutes.use("*", async (c, next) => {
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

  const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : crypto.randomUUID();
  const expectedVersion =
    typeof body.expectedVersion === "number" && Number.isInteger(body.expectedVersion) ? body.expectedVersion : null;
  const now = runtime.now();

  // Retaining the original author across edits matters: "identitas penyusun
  // dari akun kerja pribadi" must not be overwritten by whoever saves next.
  const existing = await runtime.disbursement.getProposalDraft(auth.session.institutionId, id);
  const createdBy = existing?.createdBy ?? auth.session.account;
  const createdAt = existing?.createdAt ?? now;

  const draft = await runtime.disbursement.saveProposalDraft(
    {
      id,
      institutionId: auth.session.institutionId,
      programId: withIds.programId,
      createdBy,
      originOfRequest: withIds.originOfRequest,
      purpose: withIds.purpose,
      aidPeriod: withIds.aidPeriod,
      personInCharge: withIds.personInCharge,
      beneficiaries: withIds.beneficiaries,
      aidLines: withIds.aidLines,
      issues,
      createdAt,
      updatedAt: now,
    },
    existing ? expectedVersion : null
  );

  return c.json(
    { success: true, draft, summary: summarizeProposalDraft(withIds) },
    existing ? 200 : 201
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

  const deleted = await runtime.disbursement.deleteProposalDraft(auth.session.institutionId, c.req.param("id"));
  if (!deleted) return refuse(c, 404, "not-found");
  return c.body(null, 204);
});

disbursementRoutes.get("/fund-types", async (c) => c.json({ success: true, fundTypes: FUND_TYPES }));

export default disbursementRoutes;
