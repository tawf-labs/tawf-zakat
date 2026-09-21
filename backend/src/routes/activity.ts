/**
 * Distribution Activities and Contribution Allocations routes (Spec #100, Tickets #103, #107).
 *
 *   GET    /api/workspace/activities                        list activities with allocated funding totals
 *   POST   /api/workspace/activities                        create an activity from an approved proposal version
 *   GET    /api/workspace/activities/:id                    one activity with its allocations and allocation history
 *   GET    /api/workspace/activities/:id/accountability     what the activity has spent, owes and has left over
 *   GET    /api/workspace/activities/:id/trace              tracks and report snapshots for the amil recap (#114)
 *   GET    /api/workspace/activities/:id/reallocations      decisions that moved funds into or out of it
 *   POST   /api/workspace/activities/:id/reallocate         move part of an allocation to another activity
 *   POST   /api/workspace/contributions/:id/allocate        allocate part of an endorsed contribution to an activity
 *   GET    /api/workspace/contributions/:id/allocations     allocations and allocation history of one contribution
 *
 * Mutations carry `operationId`; an allocation carries the contribution's `expectedVersion`
 * and a reallocation the source activity's, optionally the target's
 * (`expectedTargetActivityVersion`). Donor-level detail is only returned to
 * contribution-mandate holders.
 */

import { Hono } from "hono";
import { buildAmilTrace } from "../activity-trace";
import type { Context } from "hono";
import { ActivityRuleError } from "../activity";
import {
  ActivityConflictError,
  ActivityNotFoundError,
  ActivityOperationConflictError,
  AllocationAvailabilityError,
  AllocationOverLimitError,
} from "../activity-store";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { operationalActor, OperationalAccessDenied } from "../operational-access";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
import { readJson, text } from "./evidence-preparation";
import {
  MISSING_OPERATION,
  MISSING_VERSION,
  READERS,
  RECORDERS,
  contributionActor,
  expectedVersionOf,
  operationIdOf,
  requestHash,
} from "./contribution";

export const activityRoutes = new Hono();

activityRoutes.onError((error, c) => {
  if (error instanceof OperationalAccessDenied) {
    return c.json({ success: false, error: error.message }, 403);
  }
  if (error instanceof ActivityConflictError || error instanceof ActivityOperationConflictError) {
    return c.json({ success: false, error: error.message }, 409);
  }
  if (
    error instanceof ActivityRuleError ||
    error instanceof AllocationOverLimitError ||
    error instanceof AllocationAvailabilityError
  ) {
    return c.json({ success: false, error: error.message }, 400);
  }
  if (error instanceof ActivityNotFoundError) {
    return c.json({ success: false, error: error.message }, 404);
  }
  throw error;
});

const isActivityPath = (path: string): boolean => {
  const p = path.replace(/^\/api\/workspace/, "");
  return p === "/activities" || p.startsWith("/activities/") || /^\/contributions\/[^/]+\/(allocate|allocations)$/.test(p);
};

activityRoutes.use("*", async (c, next) => {
  if (!isActivityPath(c.req.path)) return next();
  const runtime = workspaceRuntime();
  if (!runtime?.activities) {
    return c.json(
      {
        success: false,
        error:
          "Layanan kegiatan dan alokasi belum dikonfigurasi pada deployment ini. " +
          "Setel DATABASE_URL, lalu jalankan ulang server.",
      },
      503
    );
  }
  return next();
});

const runtimeOf = (): WorkspaceRuntime => workspaceRuntime()!;

const bodyInstitution = (body: Record<string, unknown>) =>
  typeof body.institutionId === "string" ? body.institutionId : undefined;

const DISBURSEMENT_FUNCTIONS = ["MANAGE_PROGRAMS", "PREPARE_PROPOSALS"] as const;

/** Whether this session may see donor-level detail. No officer profile means no. */
async function holdsContributionMandate(
  runtime: WorkspaceRuntime,
  session: { account: string; institutionId: string }
): Promise<boolean> {
  try {
    const actor = await operationalActor(runtime, session);
    return READERS.some((fn) => actor.allows(fn, {}));
  } catch (error) {
    if (error instanceof OperationalAccessDenied) return false;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Distribution Activities (Kegiatan Penyaluran)
// ---------------------------------------------------------------------------

activityRoutes.get("/activities", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  const activities = await runtime.activities!.listActivities(auth.session.institutionId);
  return c.json({ success: true, activities });
});

activityRoutes.post("/activities", async (c) => {
  const runtime = runtimeOf();
  const body = (await readJson(c)) ?? {};
  const auth = await authenticateWorkspace(c, runtime, bodyInstitution(body));
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const actor = await operationalActor(runtime, auth.session);
  const granted = DISBURSEMENT_FUNCTIONS.find((fn) => actor.allows(fn, {}));
  actor.require(granted ?? DISBURSEMENT_FUNCTIONS[0]);

  const proposalId = text(body.proposalId);
  if (!proposalId) return badRequest(c, "proposalId wajib diisi.");
  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const params = {
    id: text(body.id) || undefined,
    proposalId,
    name: text(body.name) || undefined,
    description: text(body.description) || undefined,
  };
  const activity = await runtime.activities!.createActivity(
    auth.session.institutionId,
    params,
    {
      id: operationId,
      account: auth.session.account,
      requestHash: requestHash(["create-activity", params.id, proposalId, params.name, params.description]),
    },
    { account: auth.session.account, officerId: actor.officer.id },
    runtime.now()
  );
  return c.json({ success: true, activity }, 201);
});

activityRoutes.get("/activities/:id", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  const activity = await runtime.activities!.getActivity(
    auth.session.institutionId,
    c.req.param("id"),
    await holdsContributionMandate(runtime, auth.session)
  );
  if (!activity) return refuse(c, 404, "not-found");
  return c.json({ success: true, activity });
});

/**
 * Amil recap of one activity from the same sources the donor sees (Ticket #114): the live
 * activity tracks plus the report snapshots that froze it, marked as historical.
 * Donor identity is not part of it; that stays behind the contribution mandate.
 */
activityRoutes.get("/activities/:id/trace", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  const trace = await buildAmilTrace(runtime, auth.session.institutionId, c.req.param("id"));
  if (!trace) return refuse(c, 404, "not-found");
  return c.json({ success: true, trace });
});

activityRoutes.get("/activities/:id/accountability", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  const accountability = await runtime.activities!.getActivityAccountability(
    auth.session.institutionId,
    c.req.param("id")
  );
  return c.json({ success: true, accountability });
});

activityRoutes.get("/activities/:id/reallocations", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  const reallocations = await runtime.activities!.listReallocationsForActivity(
    auth.session.institutionId,
    c.req.param("id")
  );
  return c.json({ success: true, reallocations });
});

activityRoutes.post("/activities/:id/reallocate", async (c: Context) => {
  const runtime = runtimeOf();
  const body = (await readJson(c)) ?? {};
  const auth = await authenticateWorkspace(c, runtime, bodyInstitution(body));
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "manageDisbursement")) return refuse(c, 403, "forbidden");

  const actor = await operationalActor(runtime, auth.session);
  const granted = DISBURSEMENT_FUNCTIONS.find((fn) => actor.allows(fn, {}));
  actor.require(granted ?? DISBURSEMENT_FUNCTIONS[0]);

  const sourceActivityId = c.req.param("id")!;
  const targetActivityId = text(body.targetActivityId);
  if (!targetActivityId) return badRequest(c, "targetActivityId wajib diisi.");
  const sourceAllocationId = text(body.sourceAllocationId);
  if (!sourceAllocationId) return badRequest(c, "sourceAllocationId wajib diisi.");
  const amountExact = text(body.amountExact);
  if (!amountExact) return badRequest(c, "amountExact wajib diisi.");
  const reason = text(body.reason);
  if (!reason) return badRequest(c, "Alasan pengalihan (reason) wajib diisi agar riwayat keputusan dapat dibaca.");
  // The source activity's version is the one being spent against, so it uses the
  // workspace-wide `expectedVersion` field every other mutation carries.
  const expectedSourceVersion = expectedVersionOf(body);
  if (expectedSourceVersion === null) return badRequest(c, MISSING_VERSION);
  const expectedTargetVersion = expectedVersionOf({ expectedVersion: body.expectedTargetActivityVersion });
  if (body.expectedTargetActivityVersion !== undefined && expectedTargetVersion === null) {
    return badRequest(c, "expectedTargetActivityVersion wajib berupa nomor versi kegiatan tujuan yang Anda muat.");
  }
  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const fundType = text(body.fundType) || null;
  const purpose = text(body.purpose) || null;

  const result = await runtime.activities!.reallocateAllocation(
    auth.session.institutionId,
    {
      sourceActivityId,
      targetActivityId,
      sourceAllocationId,
      amountExact,
      fundType,
      purpose,
      reason,
      expectedSourceVersion,
      expectedTargetVersion,
    },
    {
      id: operationId,
      account: auth.session.account,
      requestHash: requestHash([
        "reallocate",
        sourceActivityId,
        targetActivityId,
        sourceAllocationId,
        amountExact,
        fundType,
        purpose,
        reason,
        expectedSourceVersion,
        expectedTargetVersion,
      ]),
    },
    { account: auth.session.account, officerId: actor.officer.id },
    runtime.now()
  );
  return c.json({ success: true, ...result });
});

// ---------------------------------------------------------------------------
// Contribution Allocations (Alokasi Kontribusi)
// ---------------------------------------------------------------------------

activityRoutes.post("/contributions/:id/allocate", async (c: Context) => {
  const body = (await readJson(c)) ?? {};
  const who = await contributionActor(c, bodyInstitution(body), RECORDERS);
  if ("response" in who) return who.response;

  const activityId = text(body.activityId);
  if (!activityId) return badRequest(c, "activityId wajib diisi.");
  const amountExact = text(body.amountExact);
  if (!amountExact) return badRequest(c, "amountExact wajib diisi.");
  const reason = text(body.reason);
  if (!reason) return badRequest(c, "Alasan alokasi (reason) wajib diisi agar riwayat dapat dibaca.");
  const expectedVersion = expectedVersionOf(body);
  if (expectedVersion === null) return badRequest(c, MISSING_VERSION);
  const operationId = operationIdOf(body);
  if (!operationId) return badRequest(c, MISSING_OPERATION);

  const contributionId = c.req.param("id")!;
  const fundType = text(body.fundType) || null;
  const purpose = text(body.purpose) || null;

  const result = await who.runtime.activities!.allocateContribution(
    who.session.institutionId,
    { contributionId, activityId, amountExact, fundType, purpose, reason, expectedVersion },
    {
      id: operationId,
      account: who.session.account,
      requestHash: requestHash([
        "allocate", contributionId, activityId, amountExact, fundType, purpose, reason, expectedVersion,
      ]),
    },
    who.identity,
    who.runtime.now()
  );
  return c.json({ success: true, ...result });
});

activityRoutes.get("/contributions/:id/allocations", async (c) => {
  const who = await contributionActor(c, c.req.query("institutionId"), READERS);
  if ("response" in who) return who.response;

  const result = await who.runtime.activities!.listAllocationsForContribution(
    who.session.institutionId,
    c.req.param("id")
  );
  return c.json({ success: true, ...result });
});

export default activityRoutes;
