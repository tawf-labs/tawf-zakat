/**
 * Institutional Contribution routes (Spec #100, Ticket #102).
 *
 *   GET    /api/workspace/contributions                 list contributions (filterable by status/currency/fundType)
 *   POST   /api/workspace/contributions                 record a manual contribution outside ZKT
 *   GET    /api/workspace/contributions/:id             get one contribution with history and documents
 *   POST   /api/workspace/contributions/:id/reconcile   reconcile contribution against bank/source proof
 *   POST   /api/workspace/contributions/:id/endorse     endorse reconciled contribution for batch inclusion
 *   POST   /api/workspace/contributions/import/preview  decode and preview XLSX/CSV contribution file
 *   POST   /api/workspace/contributions/import/drafts   save an import draft (does NOT mark funds received)
 *   GET    /api/workspace/contributions/import/drafts   list import drafts
 *   GET    /api/workspace/contributions/import/drafts/:id get one import draft
 *   POST   /api/workspace/contributions/import/drafts/:id/commit commit valid rows of import draft as RECEIVED
 *   DELETE /api/workspace/contributions/import/drafts/:id discard an import draft
 *   POST   /api/workspace/contributions/:id/documents   attach source proof document
 *   GET    /api/workspace/contributions/:id/documents   list attached documents
 *
 * Every route here reads or writes donor-level detail, so each one needs a
 * contribution mandate on top of the workspace role; the role alone is not enough.
 * Mutations carry `operationId`, and version-guarded ones `expectedVersion`.
 */

import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  evaluateProofValidity,
  isContributionStatus,
  isCorrectionType,
  isCurrencyUnit,
  isSourceChannel,
  normalizeFundType,
  validateContributionInput,
  type ContributionInput,
  type ContributionStatus,
  type JenisDana,
} from "../contribution";
import {
  ContributionConflictError,
  ContributionDuplicateError,
  ContributionNotFoundError,
  ContributionOperationConflictError,
  ContributionStateError,
  type StoredContributionDocument,
} from "../contribution-store";
import { decodeTabular } from "../tabular-reader";
import { mapContributionTabular, type TabularContributionMappingResult } from "../contribution-tabular-schema";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
import { operationalActor, OperationalAccessDenied } from "../operational-access";
import { MAX_EVIDENCE_FILE_BYTES } from "../evidence-files";
import { JENIS_DANA, type CurrencyUnit } from "../reconciliation";
// Shared with `evidence-preparation.ts` rather than redefined, as `disbursement.ts` does.
import { readJson, text } from "./evidence-preparation";
import {
  validateRecoveryDecisionInput,
  type DonorRecoveryStatus,
} from "../donor-access";
import {
  DonorRecoveryConflictError,
  DonorRecoveryNotFoundError,
} from "../donor-access-store";

export const contributionRoutes = new Hono();

contributionRoutes.onError((error, c) => {
  if (error instanceof OperationalAccessDenied) {
    return c.json({ success: false, error: error.message }, 403);
  }
  if (
    error instanceof ContributionConflictError ||
    error instanceof ContributionOperationConflictError ||
    error instanceof ContributionDuplicateError ||
    error instanceof DonorRecoveryConflictError
  ) {
    return c.json({ success: false, error: error.message }, 409);
  }
  if (error instanceof ContributionStateError) {
    return c.json({ success: false, error: error.message }, 400);
  }
  if (error instanceof ContributionNotFoundError || error instanceof DonorRecoveryNotFoundError) {
    return c.json({ success: false, error: error.message }, 404);
  }
  throw error;
});

const unconfigured = (c: Context) =>
  c.json(
    {
      success: false,
      error:
        "Layanan pencatatan kontribusi lembaga belum dikonfigurasi pada deployment ini. " +
        "Setel DATABASE_URL, lalu jalankan ulang server.",
    },
    503
  );

const runtimeOf = (): WorkspaceRuntime => workspaceRuntime()!;

export const expectedVersionOf = (body: Record<string, unknown>): number | null =>
  typeof body.expectedVersion === "number" && Number.isSafeInteger(body.expectedVersion) && body.expectedVersion >= 1
    ? body.expectedVersion
    : null;

export const operationIdOf = (body: Record<string, unknown>): string | null => {
  const id = text(body.operationId);
  return id && id.length <= 128 ? id : null;
};

export const requestHash = (components: unknown[]): string =>
  createHash("sha256").update(JSON.stringify(components)).digest("hex");

export const MISSING_OPERATION = "operationId wajib disertakan agar pengulangan permintaan tidak mencatat ganda.";
export const MISSING_VERSION = "expectedVersion wajib disertakan dan berupa bilangan bulat positif.";

/** Stored locators stay server-side; a client only needs to know the file exists and what it is. */
const documentView = ({ storageRef: _storageRef, ...doc }: StoredContributionDocument) => doc;

const isContributionPath = (path: string): boolean => {
  const p = path.replace(/^\/api\/workspace/, "");
  return p === "/contributions" || p.startsWith("/contributions/");
};

contributionRoutes.use("*", async (c, next) => {
  if (!isContributionPath(c.req.path)) {
    return next();
  }
  const runtime = workspaceRuntime();
  if (!runtime || !runtime.contributions) return unconfigured(c);
  return next();
});

type ContributionFunction = "RECORD_CONTRIBUTIONS" | "ENDORSE_CONTRIBUTIONS";

/**
 * Authenticates the session, checks the workspace role, and requires one of the
 * named contribution mandates. Returns the resolved mandate so writes record the
 * one the server found, never one the client named.
 */
export async function contributionActor(
  c: Context,
  institutionId: string | undefined,
  functions: readonly ContributionFunction[]
) {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, institutionId);
  if (!auth.ok) return { response: auth.response } as const;
  if (!authorize(auth.session.role, "prepareEvidence")) return { response: refuse(c, 403, "forbidden") } as const;

  const actor = await operationalActor(runtime, auth.session);
  const granted = functions.find((fn) => actor.allows(fn, {}));
  // `require` produces the mandate check's own refusal wording when none is held.
  const mandate = actor.require(granted ?? functions[0]);
  return {
    runtime,
    session: auth.session,
    mandate,
    canCorrect: actor.allows("ENDORSE_CONTRIBUTIONS", {}),
    identity: { account: auth.session.account, officerId: actor.officer.id },
  } as const;
}

const bodyInstitution = (body: Record<string, unknown>) =>
  typeof body.institutionId === "string" ? body.institutionId : undefined;

export const READERS = ["RECORD_CONTRIBUTIONS", "ENDORSE_CONTRIBUTIONS"] as const;
export const RECORDERS = ["RECORD_CONTRIBUTIONS"] as const;
const ENDORSERS = ["ENDORSE_CONTRIBUTIONS"] as const;

/** Decodes an uploaded import through the shared tabular reader; used by preview and draft save alike. */
function readImport(
  c: Context,
  body: Record<string, unknown>
): { mapping: TabularContributionMappingResult; fileName: string; currencyUnit: CurrencyUnit; fileIssues: unknown[] } | { response: Response } {
  const fileName = text(body.fileName);
  const contentBase64 = text(body.contentBase64);
  if (!fileName || !contentBase64) {
    return { response: badRequest(c, "fileName dan contentBase64 wajib diisi.") };
  }
  if (!isCurrencyUnit(body.currencyUnit)) {
    return { response: badRequest(c, "currencyUnit wajib IDR atau USDC_6DP; IDR dan USDC diimpor terpisah.") };
  }

  const bytes = new Uint8Array(Buffer.from(contentBase64, "base64"));
  if (bytes.length === 0) return { response: badRequest(c, "Isi berkas harus berformat base64 yang sah.") };
  if (bytes.length > MAX_EVIDENCE_FILE_BYTES) {
    return { response: badRequest(c, `Ukuran berkas melebihi batas maksimum ${MAX_EVIDENCE_FILE_BYTES} byte.`) };
  }

  const decoded = decodeTabular(bytes, fileName);
  if (decoded.issues.some((i) => i.scope === "file") || !decoded.table) {
    return {
      response: c.json({ success: false, error: "Gagal membaca berkas tabular.", issues: decoded.issues }, 400),
    };
  }

  return {
    mapping: mapContributionTabular(decoded.table, body.currencyUnit),
    fileName,
    currencyUnit: body.currencyUnit,
    fileIssues: decoded.issues,
  };
}

// 1. List contributions
contributionRoutes.get("/contributions", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), READERS);
  if ("response" in who) return who.response;

  const statusParam = c.req.query("status");
  const currencyParam = c.req.query("currencyUnit");
  const fundTypeParam = c.req.query("fundType");

  const filters: { status?: ContributionStatus; currencyUnit?: CurrencyUnit; fundType?: JenisDana } = {};
  if (isContributionStatus(statusParam)) filters.status = statusParam;
  if (isCurrencyUnit(currencyParam)) filters.currencyUnit = currencyParam;
  if (fundTypeParam && (JENIS_DANA as readonly string[]).includes(fundTypeParam)) {
    filters.fundType = fundTypeParam as JenisDana;
  }

  const list = await who.runtime.contributions!.listContributions(who.session.institutionId, filters);
  if (!who.runtime.activities) return c.json({ success: true, contributions: list });

  const balances = await who.runtime.activities.contributionBalances(who.session.institutionId, list);
  return c.json({
    success: true,
    contributions: list.map((item) => ({ ...item, ...balances.get(item.id) })),
  });
});

// 2. Record manual contribution
contributionRoutes.post("/contributions", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), RECORDERS);
  if ("response" in who) return who.response;

  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const input: Partial<ContributionInput> = {
    id: text(body.id) || undefined,
    sourceChannel: isSourceChannel(body.sourceChannel) ? body.sourceChannel : undefined,
    sourceReference: text(body.sourceReference),
    currencyUnit: isCurrencyUnit(body.currencyUnit) ? body.currencyUnit : undefined,
    amountExact: text(body.amountExact),
    fundType: normalizeFundType(body.fundType) ?? undefined,
    purpose: text(body.purpose) || "Penerimaan Kontribusi Lembaga",
    receivedAt: typeof body.receivedAt === "number" ? body.receivedAt : Number(body.receivedAt) || 0,
    donorName: text(body.donorName) || null,
    donorContact: text(body.donorContact) || null,
  };

  const issues = validateContributionInput(input);
  if (issues.length > 0) {
    return c.json({ success: false, error: "Data kontribusi belum valid.", issues }, 400);
  }

  const contribution = await who.runtime.contributions!.createContribution(
    who.session.institutionId,
    input as ContributionInput,
    who.identity,
    who.runtime.now(),
    { operationId, account: who.session.account, requestHash: requestHash(["record", input]) }
  );

  return c.json({ success: true, contribution }, 201);
});

// 3. Import preview and drafts. Registered before `/contributions/:id` so "import" is never read as an id.
contributionRoutes.post("/contributions/import/preview", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), RECORDERS);
  if ("response" in who) return who.response;

  const read = readImport(c, body);
  if ("response" in read) return read.response;

  return c.json({
    success: true,
    preview: { fileName: read.fileName, ...read.mapping, fileIssues: read.fileIssues },
  });
});

// Saving a draft re-reads the file on the server: rows, counts and totals are never taken from the client.
contributionRoutes.post("/contributions/import/drafts", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), RECORDERS);
  if ("response" in who) return who.response;

  const read = readImport(c, body);
  if ("response" in read) return read.response;

  const draft = await who.runtime.contributions!.saveImportDraft(
    who.session.institutionId,
    {
      id: text(body.id) || `contrib_draft_${crypto.randomUUID()}`,
      fileName: read.fileName,
      currencyUnit: read.currencyUnit,
      rawRowsCount: read.mapping.totalRows,
      validRowsCount: read.mapping.validRowsCount,
      invalidRowsCount: read.mapping.invalidRowsCount,
      totalValidAmount: read.mapping.totalValidAmount,
      rowsJson: JSON.stringify(read.mapping.rows),
      issuesJson: JSON.stringify(read.mapping.issues),
    },
    who.identity,
    who.runtime.now()
  );

  return c.json({ success: true, draft }, 201);
});

contributionRoutes.get("/contributions/import/drafts", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), RECORDERS);
  if ("response" in who) return who.response;

  const drafts = await who.runtime.contributions!.listImportDrafts(who.session.institutionId);
  return c.json({ success: true, drafts });
});

contributionRoutes.get("/contributions/import/drafts/:id", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), RECORDERS);
  if ("response" in who) return who.response;

  const draft = await who.runtime.contributions!.getImportDraft(who.session.institutionId, c.req.param("id"));
  if (!draft) return refuse(c, 404, "not-found");

  return c.json({ success: true, draft });
});

contributionRoutes.post("/contributions/import/drafts/:id/commit", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), RECORDERS);
  if ("response" in who) return who.response;

  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const result = await who.runtime.contributions!.commitImportDraft(
    who.session.institutionId,
    c.req.param("id"),
    who.identity,
    who.runtime.now(),
    { operationId, account: who.session.account, requestHash: requestHash(["commit_import", c.req.param("id")]) }
  );

  return c.json({ success: true, ...result });
});

contributionRoutes.delete("/contributions/import/drafts/:id", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), RECORDERS);
  if ("response" in who) return who.response;

  const draft = await who.runtime.contributions!.discardImportDraft(
    who.session.institutionId,
    c.req.param("id"),
    who.runtime.now()
  );
  return c.json({ success: true, draft });
});

// 3b. Donor contact and access recovery examination (Spec #100, Ticket #105)
contributionRoutes.get("/contributions/recovery-requests", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), READERS);
  if ("response" in who) return who.response;
  if (!who.runtime.donorAccess) {
    return c.json({ success: false, error: "Layanan akses donatur belum dikonfigurasi." }, 503);
  }

  const statusParam = c.req.query("status");
  const filter =
    statusParam && ["PENDING", "APPROVED", "REJECTED"].includes(statusParam)
      ? { status: statusParam as DonorRecoveryStatus }
      : undefined;

  const requests = await who.runtime.donorAccess.listRecoveryRequests(who.session.institutionId, filter);
  return c.json({ success: true, requests });
});

contributionRoutes.get("/contributions/recovery-requests/:id", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), READERS);
  if ("response" in who) return who.response;
  if (!who.runtime.donorAccess) {
    return c.json({ success: false, error: "Layanan akses donatur belum dikonfigurasi." }, 503);
  }

  const requestId = c.req.param("id");
  const request = await who.runtime.donorAccess.getRecoveryRequest(who.session.institutionId, requestId);
  if (!request) {
    return c.json({ success: false, error: "Permohonan pemulihan tidak ditemukan." }, 404);
  }

  return c.json({ success: true, request });
});

contributionRoutes.post("/contributions/recovery-requests/:id/decision", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), RECORDERS);
  if ("response" in who) return who.response;
  if (!who.runtime.donorAccess) {
    return c.json({ success: false, error: "Layanan akses donatur belum dikonfigurasi." }, 503);
  }

  const validation = validateRecoveryDecisionInput(body);
  if (!validation.ok) {
    return c.json({ success: false, error: validation.error }, 400);
  }

  const requestId = c.req.param("id");
  const operationId = validation.value.operationId || operationIdOf(body);
  const operation = operationId
    ? {
        operationId,
        account: who.session.account,
        requestHash: requestHash(["recovery-decision", requestId, validation.value]),
      }
    : undefined;

  const result = await who.runtime.donorAccess.decideRecoveryRequest({
    institutionId: who.session.institutionId,
    requestId,
    decision: validation.value.decision,
    reason: validation.value.reason,
    expectedContributionVersion: validation.value.expectedContributionVersion,
    actorAccount: who.session.account,
    actorOfficerId: who.identity.officerId,
    now: who.runtime.now(),
    operation,
  });

  return c.json({ success: true, ...result });
});

// 4. Get single contribution
contributionRoutes.get("/contributions/:id", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), READERS);
  if ("response" in who) return who.response;

  const id = c.req.param("id");
  const store = who.runtime.contributions!;
  const contribution = await store.getContribution(who.session.institutionId, id);
  if (!contribution) return refuse(c, 404, "not-found");

  const history = await store.getHistory(who.session.institutionId, id);
  const documents = await store.listDocuments(who.session.institutionId, id);
  const corrections = await store.listCorrections(who.session.institutionId, id);
  const refunds = await store.listRefunds(who.session.institutionId, id);
  const events = await store.getEvents(who.session.institutionId, id);

  const activities = who.runtime.activities;
  const balance = activities
    ? (await activities.contributionBalances(who.session.institutionId, [contribution])).get(contribution.id)
    : undefined;

  // No persisted pilot receipt/proof binding exists yet (#108/#110).
  // Caller-supplied version hints must never manufacture evidence currentness.
  const proofValidity = evaluateProofValidity(contribution.version, null);

  return c.json({
    success: true,
    contribution: {
      ...contribution,
      ...balance,
      isCurrentVersion: true,
      proofValidity,
    },
    history,
    documents: documents.map(documentView),
    capabilities: { canCorrect: who.canCorrect },
    corrections,
    refunds,
    events,
  });
});

// 4a. Correct contribution (nominal amount or duplicate entry)
contributionRoutes.post("/contributions/:id/correct", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), ENDORSERS);
  if ("response" in who) return who.response;

  const expectedVersion = expectedVersionOf(body);
  if (expectedVersion === null) return badRequest(c, MISSING_VERSION);
  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const correctionType = text(body.correctionType);
  if (!isCorrectionType(correctionType)) {
    return badRequest(c, "Tipe koreksi harus berupa 'AMOUNT' atau 'DUPLICATE'.");
  }

  const amountExact = text(body.amountExact) || undefined;
  const reason = text(body.reason);
  if (!reason || reason.length < 5) {
    return badRequest(c, "Alasan koreksi wajib diisi (minimal 5 karakter).");
  }
  const sourceProofRef = text(body.sourceProofRef);
  if (!sourceProofRef) {
    return badRequest(c, "Referensi bukti sumber koreksi wajib disertakan.");
  }

  const id = c.req.param("id");
  const result = await who.runtime.contributions!.correctContribution(
    who.session.institutionId,
    {
      contributionId: id,
      expectedVersion,
      correctionType,
      amountExact,
      reason,
      sourceProofRef,
      endorsementMandateId: who.mandate.id,
    },
    {
      operationId,
      account: who.session.account,
      requestHash: requestHash(["correct", id, expectedVersion, correctionType, amountExact, reason, sourceProofRef]),
    },
    who.identity,
    who.runtime.now()
  );

  return c.json({ success: true, ...result });
});

// 4b. List corrections for contribution
contributionRoutes.get("/contributions/:id/corrections", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), READERS);
  if ("response" in who) return who.response;

  const corrections = await who.runtime.contributions!.listCorrections(
    who.session.institutionId,
    c.req.param("id")
  );
  return c.json({ success: true, corrections });
});

// 4c. Decide refund (pending payment)
contributionRoutes.post("/contributions/:id/refunds", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), READERS);
  if ("response" in who) return who.response;

  const expectedVersion = expectedVersionOf(body);
  if (expectedVersion === null) return badRequest(c, MISSING_VERSION);
  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const amountExact = text(body.amountExact);
  if (!amountExact) return badRequest(c, "Nominal pengembalian wajib diisi.");
  const reason = text(body.reason);
  if (!reason || reason.length < 5) {
    return badRequest(c, "Alasan pengembalian wajib diisi (minimal 5 karakter).");
  }
  const policyBasis = text(body.policyBasis);
  if (!policyBasis || policyBasis.length < 5) {
    return badRequest(c, "Dasar kebijakan jenis dana lembaga wajib diisi (minimal 5 karakter).");
  }

  const id = c.req.param("id");
  const refund = await who.runtime.contributions!.decideRefund(
    who.session.institutionId,
    {
      contributionId: id,
      expectedVersion,
      amountExact,
      reason,
      policyBasis,
    },
    {
      operationId,
      account: who.session.account,
      requestHash: requestHash(["decide_refund", id, expectedVersion, amountExact, reason, policyBasis]),
    },
    who.identity,
    who.runtime.now()
  );

  return c.json({ success: true, refund }, 201);
});

// 4d. List refunds for contribution
contributionRoutes.get("/contributions/:id/refunds", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), READERS);
  if ("response" in who) return who.response;

  const refunds = await who.runtime.contributions!.listRefunds(
    who.session.institutionId,
    c.req.param("id")
  );
  return c.json({ success: true, refunds });
});

// 4e. Record actual refund payment
contributionRoutes.post("/contributions/:id/refunds/:refundId/pay", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), READERS);
  if ("response" in who) return who.response;

  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const paymentProofRef = text(body.paymentProofRef);
  if (!paymentProofRef) {
    return badRequest(c, "Nomor referensi bukti transfer / pembayaran pengembalian wajib diisi.");
  }
  if (body.paidAt !== undefined &&
      (typeof body.paidAt !== "number" || !Number.isSafeInteger(body.paidAt) || body.paidAt <= 0)) {
    return badRequest(c, "Waktu pembayaran harus berupa timestamp detik yang sah.");
  }
  const paidAt = body.paidAt as number | undefined;
  const paymentNotes = text(body.paymentNotes) || undefined;

  const id = c.req.param("id");
  const refundId = c.req.param("refundId");

  const refund = await who.runtime.contributions!.payRefund(
    who.session.institutionId,
    {
      contributionId: id,
      refundId,
      paymentProofRef,
      paidAt: paidAt ?? who.runtime.now(),
      paymentNotes,
    },
    {
      operationId,
      account: who.session.account,
      requestHash: requestHash(["pay_refund", id, refundId, paymentProofRef, paidAt, paymentNotes]),
    },
    who.identity,
    who.runtime.now()
  );

  return c.json({ success: true, refund });
});

// 4f. List versioned events for contribution
contributionRoutes.get("/contributions/:id/events", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), READERS);
  if ("response" in who) return who.response;

  const events = await who.runtime.contributions!.getEvents(
    who.session.institutionId,
    c.req.param("id")
  );
  return c.json({ success: true, events });
});

// 5. Reconcile contribution against source proof
contributionRoutes.post("/contributions/:id/reconcile", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), RECORDERS);
  if ("response" in who) return who.response;

  const expectedVersion = expectedVersionOf(body);
  if (expectedVersion === null) return badRequest(c, MISSING_VERSION);
  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const proofRef = text(body.proofRef);
  if (!proofRef) {
    return badRequest(c, "Referensi bukti sumber (rekening koran/mutasi/dokumen) wajib disertakan.");
  }
  const notes = text(body.notes) || undefined;

  const updated = await who.runtime.contributions!.reconcileContribution(
    who.session.institutionId,
    c.req.param("id"),
    expectedVersion,
    { proofRef, notes },
    who.identity,
    who.runtime.now(),
    {
      operationId,
      account: who.session.account,
      requestHash: requestHash(["reconcile", c.req.param("id"), expectedVersion, proofRef, notes]),
    }
  );

  return c.json({ success: true, contribution: updated });
});

// 6. Endorse contribution for batch inclusion
contributionRoutes.post("/contributions/:id/endorse", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), ENDORSERS);
  if ("response" in who) return who.response;

  const expectedVersion = expectedVersionOf(body);
  if (expectedVersion === null) return badRequest(c, MISSING_VERSION);
  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const notes = text(body.notes) || undefined;

  const updated = await who.runtime.contributions!.endorseContribution(
    who.session.institutionId,
    c.req.param("id"),
    expectedVersion,
    { mandateId: who.mandate.id, notes },
    who.identity,
    who.runtime.now(),
    {
      operationId,
      account: who.session.account,
      requestHash: requestHash(["endorse", c.req.param("id"), expectedVersion, notes]),
    }
  );

  return c.json({ success: true, contribution: updated });
});

// 7. Attach restricted source proof document. Uploading never changes the contribution's status.
contributionRoutes.post("/contributions/:id/documents", async (c) => {
  const body = await readJson(c);
  if (!body) return badRequest(c, "Badan permintaan bukan JSON yang sah.");

  const who = await contributionActor(c, bodyInstitution(body), RECORDERS);
  if ("response" in who) return who.response;

  const contributionId = c.req.param("id");
  const store = who.runtime.contributions!;
  const contribution = await store.getContribution(who.session.institutionId, contributionId);
  if (!contribution) return refuse(c, 404, "not-found");

  const fileName = text(body.fileName);
  if (!fileName || fileName.length > 255) return badRequest(c, "Nama berkas tidak sah.");
  const bytes = new Uint8Array(Buffer.from(text(body.contentBase64), "base64"));
  if (bytes.length === 0) return badRequest(c, "Berkas kosong tidak dapat diunggah.");
  if (bytes.length > MAX_EVIDENCE_FILE_BYTES) {
    return badRequest(c, `Ukuran berkas melebihi batas maksimum ${MAX_EVIDENCE_FILE_BYTES} byte.`);
  }

  // No file store means no document, said plainly, rather than a record claiming bytes it never kept.
  if (!who.runtime.files) {
    return c.json({ success: false, error: "Penyimpanan dokumen terlindungi belum tersedia." }, 503);
  }
  const docId = `contrib_doc_${crypto.randomUUID()}`;
  let stored;
  try {
    stored = await who.runtime.files.put({
      institutionId: who.session.institutionId,
      preparationId: contributionId,
      fileId: docId,
      bytes,
    });
  } catch {
    return c.json({ success: false, error: "Dokumen gagal disimpan. Coba lagi setelah penyimpanan tersedia." }, 503);
  }

  const doc = await store.attachDocument({
    id: docId,
    contributionId,
    institutionId: who.session.institutionId,
    category: text(body.category) || "BUKTI_SUMBER",
    fileName,
    mimeType: text(body.mimeType) || "application/octet-stream",
    sizeBytes: stored.sizeBytes,
    contentSha256: stored.contentSha256,
    storageStatus: "STORED",
    storageRef: stored.storageRef,
    createdBy: who.session.account,
    createdAt: who.runtime.now(),
  });

  return c.json({ success: true, document: documentView(doc) }, 201);
});

contributionRoutes.get("/contributions/:id/documents", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), READERS);
  if ("response" in who) return who.response;

  const docs = await who.runtime.contributions!.listDocuments(who.session.institutionId, c.req.param("id"));
  return c.json({ success: true, documents: docs.map(documentView) });
});

export default contributionRoutes;
