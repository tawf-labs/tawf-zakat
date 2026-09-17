/**
 * Distribution Activities and Contribution Allocations routes (Spec #100, Ticket #103).
 *
 *   GET    /api/workspace/activities                      list activities with allocated funding totals
 *   POST   /api/workspace/activities                      create an activity from an approved proposal version
 *   GET    /api/workspace/activities/:id                  one activity with its allocations and allocation history
 *   POST   /api/workspace/contributions/:id/allocate      allocate part of an endorsed contribution to an activity
 *   GET    /api/workspace/contributions/:id/allocations   allocations and allocation history of one contribution
 *
 * Mutations carry `operationId`; an allocation also carries the contribution's
 * `expectedVersion`. Donor-level detail is only returned to contribution-mandate holders.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { ActivityRuleError } from "../activity";
import {
  ActivityConflictError,
  ActivityNotFoundError,
  ActivityOperationConflictError,
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
  if (error instanceof ActivityRuleError || error instanceof AllocationOverLimitError) {
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
