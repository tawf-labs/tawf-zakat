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
 * Submission, examination and restricted documents share this authenticated API.
 */

import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { toHex, type Hex } from "viem";
import { verifyAccountSignature } from "../account-signature";
import {
  computeRightsDigest,
  decidedAidLines,
  decidedIdr,
  disbursementDecisionSigningPayload,
  disbursementDecisionTypedDataWire,
  evaluateRecurringAidWarnings,
  FUND_TYPES,
  isFundType,
  isProposalDocumentCategory,
  SOP_QUORUM_HELD_MESSAGE,
  summarizeProposalDraft,
  validateDecisionIntent,
  validateProgramInput,
  validateProposalDecisionInput,
  validateProposalDraft,
  withStableIds,
  type AidLine,
  type Beneficiary,
  type DecisionBinding,
  type ExaminationChecklist,
  type ProposalDecisionIntent,
  type ProposalDocumentCategory,
  type ProposalDocumentRecord,
  type ProposalDraftInput,
} from "../disbursement";
import { decodeTabular, type TabularFormat } from "../tabular-reader";
import {
  beneficiaryExportFileName,
  beneficiaryTemplateFileName,
  generateBeneficiaryExport,
  generateBeneficiaryTemplate,
  type BeneficiarySheet,
} from "../beneficiary-template-generator";
import { attachRecurringAidWarnings, mapBeneficiaryTabular } from "../beneficiary-tabular-schema";
import {
  DecisionChallengeSpentError,
  DraftOperationConflictError,
  ProposalDraftConflictError,
  ProposalStateConflictError,
  ProposalSubmissionIncompleteError,
  type ProposalContributor,
  type StoredProposalDraft,
} from "../disbursement-store";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
import {
  assertCanApproveProposal,
} from "../operational-mandate";
import { MAX_EVIDENCE_FILE_BYTES } from "../evidence-files";
import { createRestrictedDocuments, DocumentError } from "../restricted-documents";
// Shared with `evidence-preparation.ts` rather than redefined: identical shape,
// no domain-specific wording, so a second copy here would just be a second
// place for it to drift.
import { operationalActor, OperationalAccessDenied, requestedIdr } from "../operational-access";
import { readJson, text } from "./evidence-preparation";

const randomHex = (bytes: number): Hex =>
  toHex(crypto.getRandomValues(new Uint8Array(bytes)));

const disbursementRoutes = new Hono();

disbursementRoutes.onError((error, c) => {
  if (error instanceof OperationalAccessDenied) return c.json({ success: false, error: error.message }, 403);
  if (error instanceof DecisionChallengeSpentError) return refuse(c, 401, "replayed");
  if (
    error instanceof ProposalDraftConflictError ||
    error instanceof DraftOperationConflictError ||
    error instanceof ProposalStateConflictError
  ) {
    return c.json({ success: false, error: error.message }, 409);
  }
  if (error instanceof ProposalSubmissionIncompleteError) {
    return c.json({ success: false, error: error.message, issues: error.issues }, 400);
  }
  if (error instanceof DocumentError) {
    const status =
      error.reason === "NOT_FOUND" || error.reason === "MISSING"
        ? 404
        : error.reason === "CORRUPT" || error.reason === "BINDING"
        ? 409
        : 503;
    return c.json({ success: false, error: error.message, reason: error.reason }, status);
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
    p === "/policy" ||
    p.startsWith("/policy/") ||
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

  const actor = await operationalActor(runtime, auth.session);
  actor.require("MANAGE_PROGRAMS");


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

  const target = await runtime.disbursement.getProgram(auth.session.institutionId, c.req.param("id"));
  if (!target) return refuse(c, 404, "not-found");
  const actor = await operationalActor(runtime, auth.session);
  actor.require("MANAGE_PROGRAMS", { programId: target.id });


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
  const contact = row.contact as Record<string, unknown> | null | undefined;
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
    contact: contact
      ? {
          phone: text(contact.phone) || null,
          email: text(contact.email) || null,
          relation: text(contact.relation) || null,
        }
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
      evidenceReference: text(row.evidenceReference) || null,
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
    evidenceReference: text(row.evidenceReference) || null,
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

  const actor = await operationalActor(runtime, auth.session);
  const requirePreparation = (draft: { programId: string | null; aidLines: AidLine[] }) => {
    actor.require("PREPARE_PROPOSALS", { programId: draft.programId, nominalAmount: requestedIdr(draft.aidLines) });
  };
  requirePreparation(withIds);


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
      requestHash: requestHash(["save", text(body.id), expectedVersion, draftInput]) },
    requirePreparation
  );

  return c.json(
    { success: true, draft, summary: summarizeProposalDraft(draft) },
    expectedVersion === 0 ? 201 : 200
  );
});

const docView = (doc: ProposalDocumentRecord) => ({
  id: doc.id,
  proposalId: doc.proposalId,
  beneficiaryId: doc.beneficiaryId,
  category: doc.category,
  fileName: doc.fileName,
  mimeType: doc.mimeType,
  sizeBytes: doc.sizeBytes,
  contentSha256: doc.contentSha256,
  storageStatus: doc.storageStatus,
  version: doc.version,
  createdBy: doc.createdBy,
  createdAt: doc.createdAt,
});

// ---------------------------------------------------------------------------
// Queues and Policy
// ---------------------------------------------------------------------------

disbursementRoutes.get("/policy", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const policy = await runtime.disbursement.getInstitutionPolicy(auth.session.institutionId);
  return c.json({ success: true, policy });
});

disbursementRoutes.post("/policy", async (c) => {
  const runtime = runtimeOf();
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const auth = await authenticateWorkspace(
    c,
    runtime,
    typeof body.institutionId === "string" ? body.institutionId : undefined
  );
  if (!auth.ok) return auth.response;
  if (auth.session.role !== "ADMIN") return refuse(c, 403, "forbidden");

  const expectedVersion = typeof body.expectedVersion === "number" ? body.expectedVersion : 1;
  const policy = await runtime.disbursement.saveInstitutionPolicy(
    {
      institutionId: auth.session.institutionId,
      requireProposalLetter: body.requireProposalLetter !== undefined ? Boolean(body.requireProposalLetter) : true,
      requireIdentityDoc: body.requireIdentityDoc !== undefined ? Boolean(body.requireIdentityDoc) : true,
      requireAlternativeIdProof: body.requireAlternativeIdProof !== undefined ? Boolean(body.requireAlternativeIdProof) : true,
      requireGuardianProof: body.requireGuardianProof !== undefined ? Boolean(body.requireGuardianProof) : true,
      warnRecurringAid: body.warnRecurringAid !== undefined ? Boolean(body.warnRecurringAid) : true,
      sopRequiresMultiSignerQuorum: Boolean(body.sopRequiresMultiSignerQuorum),
      version: expectedVersion,
      updatedAt: runtime.now(),
      updatedBy: auth.session.account,
    },
    expectedVersion
  );

  return c.json({ success: true, policy });
});

// ---------------------------------------------------------------------------
// Beneficiary Import & Template (Ticket #92)
// ---------------------------------------------------------------------------

const tabularFormatOf = (value: string | undefined): TabularFormat =>
  (value ?? "").toLowerCase() === "csv" ? "csv" : "xlsx";

const sheetResponse = (c: Context, sheet: BeneficiarySheet, fileName: string) => {
  const headers = {
    "Content-Type":
      sheet.format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "no-cache",
  };
  return sheet.format === "csv"
    ? c.body(sheet.body, 200, headers)
    : c.body(sheet.body as unknown as ArrayBuffer, 200, headers);
};

/**
 * Reads an uploaded roster and maps it onto the draft model. The program and
 * aid period filled once on the proposal form are shared into the preview, and
 * recipients already on another proposal are flagged for review.
 */
async function previewBeneficiaryFile(
  runtime: ReturnType<typeof runtimeOf>,
  institutionId: string,
  input: { bytes: Uint8Array; fileName: string; proposalId: string; programId: string | null; aidPeriod: string | null }
) {
  const decoded = decodeTabular(input.bytes, input.fileName);
  if (!decoded.table) return { ok: false as const, issues: decoded.issues };

  const program = input.programId ? await runtime.disbursement.getProgram(institutionId, input.programId) : null;
  const mapping = mapBeneficiaryTabular(decoded.table, { sharedAidPeriod: input.aidPeriod ?? undefined });
  const policy = await runtime.disbursement.getInstitutionPolicy(institutionId);
  if (policy.warnRecurringAid && mapping.beneficiaries.length > 0) {
    const matches = await runtime.disbursement.findRecurringAidMatches(institutionId, input.proposalId, mapping.beneficiaries);
    attachRecurringAidWarnings(mapping, evaluateRecurringAidWarnings(mapping.beneficiaries, matches));
  }
  return {
    ok: true as const,
    preview: {
      fileName: input.fileName,
      format: decoded.format,
      sharedContext: { programName: program?.name ?? null, aidPeriod: mapping.sharedAidPeriod },
      ...mapping,
      fileIssues: decoded.issues,
    },
  };
}

disbursementRoutes.get("/proposals/template", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const format = tabularFormatOf(c.req.query("format"));
  return sheetResponse(c, generateBeneficiaryTemplate(format), beneficiaryTemplateFileName(format));
});

disbursementRoutes.post("/proposals/import/preview", async (c) => {
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

  const actor = await operationalActor(runtime, auth.session);
  actor.require("PREPARE_PROPOSALS");

  const fileName = text(body.fileName);
  const contentBase64 = text(body.contentBase64);
  if (!fileName || !contentBase64) {
    return badRequest(c, "Nama berkas dan isi berkas (base64) wajib diisi.");
  }

  const result = await previewBeneficiaryFile(runtime, auth.session.institutionId, {
    bytes: new Uint8Array(Buffer.from(contentBase64, "base64")),
    fileName,
    proposalId: text(body.proposalId),
    programId: text(body.programId) || null,
    aidPeriod: text(body.sharedAidPeriod) || null,
  });
  if (!result.ok) {
    return c.json(
      { success: false, error: result.issues[0]?.message ?? "Gagal membaca berkas tabular.", issues: result.issues },
      400
    );
  }
  return c.json({ success: true, preview: result.preview });
});

disbursementRoutes.get("/proposals/queue/examiner", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const actor = await operationalActor(runtime, auth.session);
  const programId = c.req.query("programId") ?? undefined;
  const queue = await runtime.disbursement.listExaminerQueue(auth.session.institutionId, programId,
    draft => actor.allows("EXAMINE_PROPOSALS", { programId: draft.programId, nominalAmount: requestedIdr(draft.aidLines) }));
  return c.json({ success: true, queue });
});

disbursementRoutes.get("/proposals/queue/revision", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const actor = await operationalActor(runtime, auth.session);
  const queue = await runtime.disbursement.listRevisionQueue(auth.session.institutionId, auth.session.account,
    draft => actor.allows("PREPARE_PROPOSALS", { programId: draft.programId, nominalAmount: requestedIdr(draft.aidLines) }));
  return c.json({ success: true, queue });
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
    summary: summarizeProposalDraft(draft),
  });
});

disbursementRoutes.get("/proposals/:id/export", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, c.req.param("id"));
  if (!draft) return refuse(c, 404, "not-found");

  const actor = await operationalActor(runtime, auth.session);
  actor.require("PREPARE_PROPOSALS", {
    programId: draft.programId,
    nominalAmount: requestedIdr(draft.aidLines),
  });

  const format = tabularFormatOf(c.req.query("format"));
  return sheetResponse(
    c,
    generateBeneficiaryExport(draft.beneficiaries, draft.aidLines, format),
    beneficiaryExportFileName(draft.id, format)
  );
});

/** Re-reads a roster kept as a private proposal document, so its invalid rows stay reviewable. */
disbursementRoutes.get("/proposals/:id/documents/:docId/import-preview", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");
  const actor = await operationalActor(runtime, auth.session);
  actor.require("PREPARE_PROPOSALS", { programId: draft.programId, nominalAmount: requestedIdr(draft.aidLines) });

  const document = await runtime.disbursement.getProposalDocument(auth.session.institutionId, proposalId, c.req.param("docId"));
  if (!document || document.category !== "BENEFICIARY_ROSTER") return refuse(c, 404, "not-found");

  const restricted = createRestrictedDocuments(runtime.evidence, runtime.files, runtime.registry?.store, runtime.disbursement);
  const { bytes } = await restricted.read({ institutionId: auth.session.institutionId, proposalId }, document.id);
  const result = await previewBeneficiaryFile(runtime, auth.session.institutionId, {
    bytes,
    fileName: document.fileName,
    proposalId,
    programId: draft.programId,
    aidPeriod: draft.aidPeriod ? `${draft.aidPeriod.start} s/d ${draft.aidPeriod.end}` : null,
  });
  if (!result.ok) {
    return c.json({ success: false, error: result.issues[0]?.message ?? "Gagal membaca berkas tabular.", issues: result.issues }, 400);
  }
  return c.json({ success: true, preview: { ...result.preview, documentId: document.id } });
});

disbursementRoutes.delete("/proposals/:id", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const actor = await operationalActor(runtime, auth.session);
  const requirePreparation = (draft: { programId: string | null; aidLines: AidLine[] }) => {
    actor.require("PREPARE_PROPOSALS", { programId: draft.programId, nominalAmount: requestedIdr(draft.aidLines) });
  };


  const body = await readJson(c);
  const expectedVersion = body ? mutationVersion(body, 1) : null;
  if (!body || expectedVersion === null) return badRequest(c, "Versi yang diharapkan dan identitas penghapusan wajib diisi.");
  const id = c.req.param("id");
  const deleted = await runtime.disbursement.deleteProposalDraft(auth.session.institutionId, id, expectedVersion,
    { id: text(body.operationId), account: auth.session.account, requestHash: requestHash(["delete", id, expectedVersion]) }, requirePreparation);
  if (!deleted) return refuse(c, 404, "not-found");
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Proposal Documents
// ---------------------------------------------------------------------------

disbursementRoutes.post("/proposals/:id/documents", async (c) => {
  const runtime = runtimeOf();
  const proposalId = c.req.param("id");
  const contentType = c.req.header("content-type") || "";

  let categoryRaw: unknown;
  let beneficiaryIdRaw: unknown;
  let fileNameRaw: unknown;
  let mimeTypeRaw: unknown;
  let bytes: Uint8Array;
  let institutionIdQuery: string | undefined;

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    categoryRaw = form.get("category");
    beneficiaryIdRaw = form.get("beneficiaryId");
    fileNameRaw = form.get("fileName");
    mimeTypeRaw = form.get("mimeType");
    institutionIdQuery = (form.get("institutionId") as string) || undefined;
    const file = form.get("file");
    if (!file || typeof (file as any).arrayBuffer !== "function") {
      return badRequest(c, "Berkas wajib diunggah.");
    }
    const buf = await (file as Blob).arrayBuffer();
    bytes = new Uint8Array(buf);
    if (!fileNameRaw && (file as File).name) fileNameRaw = (file as File).name;
    if (!mimeTypeRaw && (file as Blob).type) mimeTypeRaw = (file as Blob).type;
  } else {
    const body = await readJson(c);
    if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");
    categoryRaw = body.category;
    beneficiaryIdRaw = body.beneficiaryId;
    fileNameRaw = body.fileName;
    mimeTypeRaw = body.mimeType;
    institutionIdQuery = typeof body.institutionId === "string" ? body.institutionId : undefined;
    if (typeof body.contentBase64 !== "string" || !body.contentBase64.trim()) {
      return badRequest(c, "Isi berkas (base64) wajib diisi.");
    }
    try {
      bytes = new Uint8Array(Buffer.from(body.contentBase64.trim(), "base64"));
    } catch {
      return badRequest(c, "Isi berkas harus base64 yang sah.");
    }
  }

  const auth = await authenticateWorkspace(c, runtime, institutionIdQuery);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const actor = await operationalActor(runtime, auth.session);
  const requirePreparation = (draft: { programId: string | null; aidLines: AidLine[] }) =>
    actor.require("PREPARE_PROPOSALS", { programId: draft.programId, nominalAmount: requestedIdr(draft.aidLines) });

  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");
  requirePreparation(draft);
  if (draft.status !== "DRAFT" && draft.status !== "REVISION_REQUIRED") {
    throw new ProposalStateConflictError(`Dokumen tidak dapat diunggah pada pengajuan berstatus "${draft.status}".`);
  }

  if (!isProposalDocumentCategory(categoryRaw)) {
    return badRequest(c, "Kategori dokumen tidak sah.");
  }
  const category = categoryRaw as ProposalDocumentCategory;

  const fileName = text(fileNameRaw);
  if (!fileName || fileName.length > 255) {
    return badRequest(c, "Nama berkas tidak sah.");
  }
  const mimeType = text(mimeTypeRaw) || "application/octet-stream";

  const beneficiaryId = text(beneficiaryIdRaw) || null;
  if (beneficiaryId && !draft.beneficiaries.some((b) => b.id === beneficiaryId)) {
    return badRequest(c, "ID penerima manfaat tidak ditemukan pada pengajuan ini.");
  }

  if (bytes.byteLength === 0) {
    return badRequest(c, "Berkas kosong tidak dapat disimpan.");
  }
  if (bytes.byteLength > MAX_EVIDENCE_FILE_BYTES) {
    return badRequest(c, `Berkas melebihi batas ukuran ${MAX_EVIDENCE_FILE_BYTES} byte.`);
  }

  const docId = crypto.randomUUID();
  if (!runtime.files) throw new DocumentError("Penyimpanan dokumen terlindungi belum tersedia.", "UNAVAILABLE");
  let stored;
  try {
    stored = await runtime.files.put({
      institutionId: auth.session.institutionId, preparationId: proposalId, fileId: docId, bytes,
    });
  } catch {
    throw new DocumentError("Dokumen gagal disimpan. Coba lagi setelah penyimpanan tersedia.", "UNAVAILABLE");
  }

  const doc = await runtime.disbursement.saveProposalDocument({
    id: docId,
    proposalId,
    institutionId: auth.session.institutionId,
    beneficiaryId,
    category,
    fileName,
    mimeType,
    sizeBytes: stored.sizeBytes,
    contentSha256: stored.contentSha256,
    storageStatus: "STORED",
    storageRef: stored.storageRef,
    version: draft.version,
    createdBy: auth.session.account,
    createdAt: runtime.now(),
  }, requirePreparation);

  return c.json({ success: true, document: docView(doc) }, 201);
});

disbursementRoutes.get("/proposals/:id/documents", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const verParam = c.req.query("version");
  const version = verParam ? parseInt(verParam, 10) : undefined;

  const docs = await runtime.disbursement.listProposalDocuments(auth.session.institutionId, proposalId, version);
  return c.json({ success: true, documents: docs.map(docView) });
});

disbursementRoutes.delete("/proposals/:id/documents/:docId", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const actor = await operationalActor(runtime, auth.session);
  const requirePreparation = (draft: { programId: string | null; aidLines: AidLine[] }) =>
    actor.require("PREPARE_PROPOSALS", { programId: draft.programId, nominalAmount: requestedIdr(draft.aidLines) });

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");
  requirePreparation(draft);
  if (draft.status !== "DRAFT" && draft.status !== "REVISION_REQUIRED") {
    throw new ProposalStateConflictError(`Dokumen tidak dapat dihapus pada pengajuan berstatus "${draft.status}".`);
  }

  const deleted = await runtime.disbursement.deleteProposalDocument(
    auth.session.institutionId,
    proposalId,
    c.req.param("docId"), draft.version, requirePreparation
  );
  if (!deleted) return refuse(c, 404, "not-found");
  return c.body(null, 204);
});

disbursementRoutes.get("/proposals/:id/files/:fileId", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const actor = await operationalActor(runtime, auth.session);
  let allowed = false;
  for (const fn of ["PREPARE_PROPOSALS", "EXAMINE_PROPOSALS", "APPROVE_DECISIONS"] as const) {
    try {
      actor.require(fn, { programId: draft.programId, nominalAmount: requestedIdr(draft.aidLines) });
      allowed = true;
      break;
    } catch {
      // try next mandate
    }
  }
  if (!allowed) {
    throw new OperationalAccessDenied("Akses berkas pengajuan memerlukan mandat amil, pemeriksa, atau pemutus.");
  }

  const fileId = c.req.param("fileId");
  const verParam = c.req.query("version");
  const version = verParam ? parseInt(verParam, 10) : undefined;

  const restricted = createRestrictedDocuments(
    runtime.evidence,
    runtime.files,
    runtime.registry?.store,
    runtime.disbursement
  );
  const { file, bytes } = await restricted.read(
    { institutionId: auth.session.institutionId, proposalId, version },
    fileId
  );

  c.header("Content-Type", file.mimeType);
  c.header("Content-Disposition", `attachment; filename="${encodeURIComponent(file.fileName)}"`);
  c.header("Content-Length", String(bytes.byteLength));
  return c.body(new Uint8Array(bytes).buffer);
});

// ---------------------------------------------------------------------------
// Lifecycle Transitions
// ---------------------------------------------------------------------------

disbursementRoutes.post("/proposals/:id/submit", async (c) => {
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

  const expectedVersion = mutationVersion(body, 1);
  if (expectedVersion === null) return badRequest(c, "Versi yang diharapkan dan ID operasi wajib diisi.");

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const actor = await operationalActor(runtime, auth.session);
  actor.require("PREPARE_PROPOSALS", {
    programId: draft.programId,
    nominalAmount: requestedIdr(draft.aidLines),
  });

  const result = await runtime.disbursement.submitProposalDraft(
    auth.session.institutionId,
    proposalId,
    expectedVersion,
    {
      id: text(body.operationId),
      account: auth.session.account,
      requestHash: requestHash(["submit", proposalId, expectedVersion]),
    },
    { account: auth.session.account, officerId: actor.officer.id },
    runtime.now()
  );

  return c.json({ success: true, draft: result.draft, warnings: result.warnings });
});

disbursementRoutes.post("/proposals/:id/withdraw", async (c) => {
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

  const expectedVersion = mutationVersion(body, 1);
  if (expectedVersion === null) return badRequest(c, "Versi yang diharapkan dan ID operasi wajib diisi.");

  const reason = text(body.reason);
  if (!reason) return badRequest(c, "Alasan penarikan pengajuan wajib diisi.");

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const actor = await operationalActor(runtime, auth.session);
  actor.require("PREPARE_PROPOSALS", {
    programId: draft.programId,
    nominalAmount: requestedIdr(draft.aidLines),
  });

  const updated = await runtime.disbursement.withdrawProposal(
    auth.session.institutionId,
    proposalId,
    reason,
    expectedVersion,
    {
      id: text(body.operationId),
      account: auth.session.account,
      requestHash: requestHash(["withdraw", proposalId, expectedVersion, reason]),
    },
    { account: auth.session.account, officerId: actor.officer.id },
    runtime.now()
  );

  return c.json({ success: true, draft: updated });
});

disbursementRoutes.post("/proposals/:id/start-examination", async (c) => {
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

  const expectedVersion = mutationVersion(body, 1);
  if (expectedVersion === null) return badRequest(c, "Versi yang diharapkan dan ID operasi wajib diisi.");

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const actor = await operationalActor(runtime, auth.session);
  actor.require("EXAMINE_PROPOSALS", {
    programId: draft.programId,
    nominalAmount: requestedIdr(draft.aidLines),
  });

  const updated = await runtime.disbursement.startProposalExamination(
    auth.session.institutionId,
    proposalId,
    expectedVersion,
    {
      id: text(body.operationId),
      account: auth.session.account,
      requestHash: requestHash(["start-examination", proposalId, expectedVersion]),
    },
    { account: auth.session.account, officerId: actor.officer.id },
    runtime.now()
  );

  return c.json({ success: true, draft: updated });
});

disbursementRoutes.post("/proposals/:id/return", async (c) => {
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

  const expectedVersion = mutationVersion(body, 1);
  if (expectedVersion === null) return badRequest(c, "Versi yang diharapkan dan ID operasi wajib diisi.");

  const reason = text(body.reason);
  if (!reason) return badRequest(c, "Alasan pengembalian revisi wajib diisi secara jelas.");

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const actor = await operationalActor(runtime, auth.session);
  actor.require("EXAMINE_PROPOSALS", {
    programId: draft.programId,
    nominalAmount: requestedIdr(draft.aidLines),
  });

  const updated = await runtime.disbursement.returnProposalForRevision(
    auth.session.institutionId,
    proposalId,
    reason,
    expectedVersion,
    {
      id: text(body.operationId),
      account: auth.session.account,
      requestHash: requestHash(["return", proposalId, expectedVersion, reason]),
    },
    { account: auth.session.account, officerId: actor.officer.id },
    runtime.now()
  );

  return c.json({ success: true, draft: updated });
});

disbursementRoutes.post("/proposals/:id/ready", async (c) => {
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

  const expectedVersion = mutationVersion(body, 1);
  if (expectedVersion === null) return badRequest(c, "Versi yang diharapkan dan ID operasi wajib diisi.");

  const checklistRaw = body.checklist as Record<string, unknown> | undefined;
  if (!checklistRaw || typeof checklistRaw !== "object") {
    return badRequest(c, "Checklist pemeriksaan kelayakan wajib diisi.");
  }
  if (checklistRaw.administrativeChecksOk !== true) {
    return badRequest(c, "Pemeriksaan administrasi harus dinyatakan lengkap dan sesuai sebelum pengajuan siap diputus.");
  }
  if (checklistRaw.eligibilityChecksOk !== true) {
    return badRequest(c, "Pemeriksaan kelayakan asnaf dan kebutuhan harus dinyatakan memenuhi syarat sebelum pengajuan siap diputus.");
  }

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const actor = await operationalActor(runtime, auth.session);
  actor.require("EXAMINE_PROPOSALS", {
    programId: draft.programId,
    nominalAmount: requestedIdr(draft.aidLines),
  });

  const checklist: ExaminationChecklist = {
    administrativeChecksOk: true,
    eligibilityChecksOk: true,
    alternativeIdReviewed: checklistRaw.alternativeIdReviewed === true,
    recurringAidExceptions: Array.isArray(checklistRaw.recurringAidExceptions)
      ? checklistRaw.recurringAidExceptions.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    notes: text(checklistRaw.notes),
  };

  const updated = await runtime.disbursement.markProposalReady(
    auth.session.institutionId,
    proposalId,
    checklist,
    expectedVersion,
    {
      id: text(body.operationId),
      account: auth.session.account,
      requestHash: requestHash(["ready", proposalId, expectedVersion, checklist]),
    },
    { account: auth.session.account, officerId: actor.officer.id },
    runtime.now()
  );

  return c.json({ success: true, draft: updated });
});

// ---------------------------------------------------------------------------
// Proposal History & Version Snapshots
// ---------------------------------------------------------------------------

disbursementRoutes.get("/proposals/:id/history", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const history = await runtime.disbursement.listProposalHistory(auth.session.institutionId, proposalId);
  return c.json({ success: true, history });
});

disbursementRoutes.get("/proposals/:id/versions/:ver", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const proposalId = c.req.param("id");
  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");

  const ver = parseInt(c.req.param("ver"), 10);
  if (isNaN(ver) || ver < 1) return badRequest(c, "Nomor versi tidak sah.");

  const versionRecord = await runtime.disbursement.getProposalVersion(auth.session.institutionId, proposalId, ver);
  if (!versionRecord) return refuse(c, 404, "not-found");

  return c.json({ success: true, version: versionRecord });
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

  const actor = await operationalActor(runtime, auth.session);
  const contributors = await runtime.disbursement.proposalContributors(auth.session.institutionId, draft.id);
  if (new Set(contributors.map(c => c.version)).size !== draft.version || contributors.some(c => !c.officerId)) {
    throw new OperationalAccessDenied("Identitas seluruh penyusun versi pengajuan belum dapat diverifikasi. Lengkapi atribusi melalui onboarding lembaga.");
  }
  for (const contributor of contributors) {
    const check = assertCanApproveProposal({
      creatorOfficerId: contributor.officerId, creatorAccount: contributor.account,
      approverOfficerId: actor.officer.id, approverAccount: auth.session.account,
    });
    if (!check.allowed) throw new OperationalAccessDenied(check.reason);
  }
  const mandate = actor.require("APPROVE_DECISIONS", {
    programId: draft.programId, nominalAmount: requestedIdr(draft.aidLines),
  });

  if (body.endorsementAccount && typeof body.endorsementAccount === "string") {
    const endorsementAcc = body.endorsementAccount.trim().toLowerCase();
    const activeEndorsements = await runtime.store.activeEndorsementAccountsForOfficer(
      auth.session.institutionId,
      actor.officer.id
    );
    const matched = activeEndorsements.find((ea) => ea.accountAddress.toLowerCase() === endorsementAcc);
    if (!matched) {
      return c.json({ success: false, error: "Akun pengesahan institusi tidak sah atau tidak diizinkan untuk petugas ini." }, 403);
    }
  }

  return c.json({ success: true, allowed: true, mandate });
});

// ---------------------------------------------------------------------------
// Keputusan lembaga: telaah, tantangan pengesahan, dan pencatatan (ticket #93)
// ---------------------------------------------------------------------------

const CHALLENGE_TTL_SECONDS = 300;

/** First reason this officer - operating from `operatorAccount`, signing as `signerAccount` - may not decide it. */
function separationOfDutiesRefusal(
  contributors: ProposalContributor[],
  officerId: string,
  operatorAccount: string,
  signerAccount: string
): string | null {
  for (const contributor of contributors) {
    const check = assertCanApproveProposal({
      creatorOfficerId: contributor.officerId,
      creatorAccount: contributor.account,
      approverOfficerId: officerId,
      approverAccount: operatorAccount,
    });
    if (!check.allowed) return check.reason;
    if (contributor.account.toLowerCase() === signerAccount.toLowerCase()) {
      return "Akun yang digunakan penyusun tidak boleh digunakan sebagai akun pengesah.";
    }
  }
  return null;
}

/** A signer is the operator's own account or an institutional account this officer is authorised for. */
async function signerRefusal(
  runtime: ReturnType<typeof runtimeOf>,
  institutionId: string,
  officerId: string,
  operatorAccount: string,
  signerAccount: string
): Promise<string | null> {
  if (signerAccount.toLowerCase() === operatorAccount.toLowerCase()) return null;
  const accounts = await runtime.store.activeEndorsementAccountsForOfficer(institutionId, officerId);
  return accounts.some((account) => account.accountAddress.toLowerCase() === signerAccount.toLowerCase())
    ? null
    : "Akun pengesahan institusi tidak sah atau tidak diizinkan untuk petugas ini.";
}

type ResolvedDecision =
  | { ok: false; status: 403 | 409; error: string }
  | { ok: true; binding: Omit<DecisionBinding, "nonce" | "issuedAt" | "expiresAt">; decidedLines: AidLine[] };

/**
 * Everything a decision must satisfy right now, shared by the challenge and the
 * signed submission so the two can never judge the same decision differently.
 * The mandate is checked against the nominal the decision actually commits.
 */
async function resolveDecision(
  runtime: ReturnType<typeof runtimeOf>,
  session: { institutionId: string; account: string },
  draft: StoredProposalDraft,
  intent: ProposalDecisionIntent,
  signerAccount: string
): Promise<ResolvedDecision> {
  if (draft.status !== "READY_FOR_DECISION") {
    return {
      ok: false,
      status: 409,
      error: `Pengajuan berstatus "${draft.status}"; hanya pengajuan siap keputusan (READY_FOR_DECISION) yang dapat disahkan.`,
    };
  }
  const policy = await runtime.disbursement.getInstitutionPolicy(session.institutionId);
  if (policy.sopRequiresMultiSignerQuorum) return { ok: false, status: 403, error: SOP_QUORUM_HELD_MESSAGE };

  const actor = await operationalActor(runtime, session);
  const contributors = await runtime.disbursement.proposalContributors(session.institutionId, draft.id);
  const refusal =
    separationOfDutiesRefusal(contributors, actor.officer.id, session.account, signerAccount) ??
    (await signerRefusal(runtime, session.institutionId, actor.officer.id, session.account, signerAccount));
  if (refusal) return { ok: false, status: 403, error: refusal };

  const decided = decidedAidLines(draft.aidLines, intent);
  if (!decided.ok) return { ok: false, status: 409, error: decided.error };

  const mandate = actor.check("APPROVE_DECISIONS", {
    programId: draft.programId,
    nominalAmount: decidedIdr(decided.lines),
  });
  if (!mandate.allowed) return { ok: false, status: 403, error: mandate.reason };

  return {
    ok: true,
    decidedLines: decided.lines,
    binding: {
      institutionId: session.institutionId,
      proposalId: draft.id,
      proposalVersion: draft.version,
      action: intent.action,
      rightsDigest: computeRightsDigest(decided.lines, intent),
      decisionReference: intent.decisionReference,
      decisionDate: intent.decisionDate,
      operatorOfficerId: actor.officer.id,
      operatorAccount: session.account.toLowerCase(),
      signerAccount: signerAccount.toLowerCase(),
      mandateId: mandate.mandate.id,
      mandateValidUntil: mandate.mandate.validUntil,
    },
  };
}

const staleVersion = (c: Context) =>
  c.json({ success: false, error: "Versi pengajuan sudah berubah. Muat ulang sebelum memutuskan." }, 409);

disbursementRoutes.get("/proposals/:id/decision-review", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, c.req.param("id"));
  if (!draft) return refuse(c, 404, "not-found");

  const actor = await operationalActor(runtime, auth.session);
  const contributors = await runtime.disbursement.proposalContributors(auth.session.institutionId, draft.id);
  const policy = await runtime.disbursement.getInstitutionPolicy(auth.session.institutionId);
  const mandate = actor.check("APPROVE_DECISIONS", {
    programId: draft.programId,
    nominalAmount: requestedIdr(draft.aidLines),
  });

  const refusalReason =
    (draft.status !== "READY_FOR_DECISION"
      ? `Pengajuan berstatus "${draft.status}", bukan siap keputusan.`
      : null) ??
    (policy.sopRequiresMultiSignerQuorum ? SOP_QUORUM_HELD_MESSAGE : null) ??
    separationOfDutiesRefusal(contributors, actor.officer.id, auth.session.account, auth.session.account) ??
    (mandate.allowed ? null : mandate.reason);

  return c.json({
    success: true,
    draft,
    program: draft.programId
      ? await runtime.disbursement.getProgram(auth.session.institutionId, draft.programId)
      : null,
    examination: { checklist: draft.examinationChecklist, notes: draft.examinationNotes },
    contributors,
    canDecide: refusalReason === null,
    refusalReason,
    sopQuorumHeld: policy.sopRequiresMultiSignerQuorum,
    mandate: mandate.allowed ? mandate.mandate : null,
    operator: { officerId: actor.officer.id, name: actor.officer.displayName, account: auth.session.account },
    availableSigners: {
      personal: auth.session.account,
      institutional: await runtime.store.activeEndorsementAccountsForOfficer(auth.session.institutionId, actor.officer.id),
    },
    referenceCeilingWarning:
      "Pagu referensi adalah acuan perencanaan program, bukan saldo bank terverifikasi dan tidak mereservasi anggaran lintas pengajuan.",
    quorumStatement:
      "Satu pejabat mengesahkan pencatatan keputusan lembaga; bukan bukti seluruh peserta pleno menandatangani secara digital.",
    existingDecision: await runtime.disbursement.getProposalDecision(auth.session.institutionId, draft.id),
  });
});

disbursementRoutes.post("/proposals/:id/decision-challenge", async (c) => {
  const runtime = runtimeOf();
  const body = (await readJson(c)) ?? {};
  const auth = await authenticateWorkspace(
    c,
    runtime,
    typeof body.institutionId === "string" ? body.institutionId : undefined
  );
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const intent = validateDecisionIntent(body);
  if (!intent.ok) return badRequest(c, intent.error);

  const signerAccount =
    typeof body.signerAccount === "string" ? body.signerAccount.trim().toLowerCase() : auth.session.account.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(signerAccount)) return badRequest(c, "Alamat akun pengesah tidak sah.");

  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, c.req.param("id"));
  if (!draft) return refuse(c, 404, "not-found");
  if (body.expectedVersion !== draft.version) return staleVersion(c);

  const resolved = await resolveDecision(runtime, auth.session, draft, intent.value, signerAccount);
  if (!resolved.ok) return c.json({ success: false, error: resolved.error }, resolved.status);

  const issuedAt = runtime.now();
  const challenge = await runtime.disbursement.createDecisionChallenge({
    ...resolved.binding,
    nonce: randomHex(32),
    issuedAt,
    expiresAt: issuedAt + CHALLENGE_TTL_SECONDS,
  });

  return c.json({ success: true, challenge, typedData: disbursementDecisionTypedDataWire(challenge) }, 201);
});

disbursementRoutes.post("/proposals/:id/decide", async (c) => {
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

  const validation = validateProposalDecisionInput(body);
  if (!validation.ok) return badRequest(c, validation.error);
  const input = validation.value;

  const operationId = text(body.operationId);
  if (!operationId) return badRequest(c, "ID operasi wajib diisi.");

  const proposalId = c.req.param("id");
  const operation = { id: operationId, account: auth.session.account, requestHash: requestHash(["decide", proposalId, input]) };

  // An identical retry returns the committed decision, even though the proposal no longer awaits one.
  const committed = await runtime.disbursement.getProposalDraftOperation(auth.session.institutionId, operation.account, operationId);
  if (committed) {
    if (committed.requestHash !== operation.requestHash) throw new DraftOperationConflictError();
    return c.json({ success: true, ...JSON.parse(committed.resultJson) }, 200);
  }

  const challenge = await runtime.disbursement.readDecisionChallenge(input.nonce);
  if (!challenge) return refuse(c, 401, "unknown-challenge");
  if (challenge.consumedAt !== null) return refuse(c, 401, "replayed");
  if (runtime.now() > challenge.expiresAt) return refuse(c, 401, "expired");

  const draft = await runtime.disbursement.getProposalDraft(auth.session.institutionId, proposalId);
  if (!draft) return refuse(c, 404, "not-found");
  if (draft.version !== input.expectedVersion) return staleVersion(c);

  const resolved = await resolveDecision(runtime, auth.session, draft, input, input.signerAccount);
  if (!resolved.ok) return c.json({ success: false, error: resolved.error }, resolved.status);

  // What is true now must be exactly what was signed: rights, operator, signer, mandate and its validity.
  const signed = challenge as Record<string, unknown>;
  const changed =
    input.mandateId !== challenge.mandateId ||
    Object.entries(resolved.binding).some(([field, value]) => signed[field] !== value);
  if (changed) {
    return c.json(
      {
        success: false,
        error: "Konteks pengesahan (isi keputusan, operator, akun pengesah, versi, atau mandat) berubah sejak tanda tangan diminta. Minta tantangan baru.",
      },
      409
    );
  }

  let rpcUnavailable = false;
  const proof = await verifyAccountSignature({
    typedData: disbursementDecisionSigningPayload(challenge),
    account: input.signerAccount,
    signature: input.signature,
    ethCall: async (call) => {
      try {
        return await runtime.ethCall(call);
      } catch (error) {
        rpcUnavailable = true;
        throw error;
      }
    },
  });
  if (!proof.ok && rpcUnavailable) {
    return c.json(
      {
        success: false,
        reason: "signature-unverifiable",
        error: "Tanda tangan akun kontrak belum dapat diperiksa karena jaringan tidak tersedia. Keputusan belum dicatat; coba lagi.",
      },
      503
    );
  }
  if (!proof.ok) return refuse(c, 401, proof.reason);

  const result = await runtime.disbursement.recordProposalDecision(
    auth.session.institutionId,
    draft.id,
    { input, decidedLines: resolved.decidedLines, challenge },
    operation,
    { account: auth.session.account, officerId: resolved.binding.operatorOfficerId },
    runtime.now()
  );

  return c.json({ success: true, draft: result.draft, decision: result.decision }, 200);
});

/** Readable by anyone who may read the proposal itself (see `GET /proposals/:id`). */
disbursementRoutes.get("/proposals/:id/decision", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId") ?? undefined);
  if (!auth.ok) return auth.response;

  const decision = await runtime.disbursement.getProposalDecision(auth.session.institutionId, c.req.param("id"));
  if (!decision) return refuse(c, 404, "not-found");

  return c.json({ success: true, decision });
});

disbursementRoutes.get("/fund-types", async (c) => c.json({ success: true, fundTypes: FUND_TYPES }));

export default disbursementRoutes;
