/**
 * Distribution-stage certificate routes (#111).
 *
 *   POST /api/activities/:activityId/certificates/:certificateId/prepare  freeze scope, return typed data to sign
 *   GET  /api/activities/:activityId/certificates                        list certificates for the activity
 *   GET  /api/activities/:activityId/certificates/:certificateId         status of one certificate
 *   POST /api/activities/:activityId/certificates/:certificateId/submit  officer's signature; relay broadcasts
 *   POST /api/activities/:activityId/certificates/:certificateId/retry   resend the same signed bytes
 *   GET  /api/public/certificates/:institutionId/:certificateId          public verifier: allowlisted aggregate only
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Hex } from "viem";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { operationalActor, OperationalAccessDenied } from "../operational-access";
import { createCertificateIssuance, CertificateError } from "../certificate-issuance";

export const certificateRoutes = new Hono();
certificateRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
certificateRoutes.onError((error, c) => {
  if (error instanceof CertificateError) return c.json({ success: false, error: error.message }, error.status);
  if (error instanceof OperationalAccessDenied) return c.json({ success: false, error: error.message }, 403);
  if (error instanceof SyntaxError) return c.json({ success: false, error: "JSON tidak sah." }, 400);
  return c.json({ success: false, error: "Registry atau layanan sertifikat tidak dapat diperiksa. Muat ulang status sebelum mengulang." }, 503);
});

function runtimeOf(): WorkspaceRuntime {
  const runtime = workspaceRuntime();
  if (!runtime?.activities || !runtime.disbursement || !runtime.certificateChain || !runtime.certificateStore) {
    throw new CertificateError("Layanan sertifikat tahap distribusi belum dikonfigurasi.", 503);
  }
  return runtime;
}

async function certificateActor(c: Context, institutionId: string | undefined) {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, institutionId);
  if (!auth.ok) return { response: auth.response } as const;
  if (!authorize(auth.session.role, "manageDisbursement")) return { response: refuse(c, 403, "forbidden") } as const;
  const actor = await operationalActor(runtime, auth.session);
  actor.require("ISSUE_CERTIFICATES");
  const issuance = createCertificateIssuance(
    runtime, { store: runtime.certificateStore!, chain: runtime.certificateChain! },
    runtime.activities!, runtime.disbursement!, auth.session.institutionId,
  );
  return { runtime, session: auth.session, issuance, account: auth.session.account as Hex } as const;
}

certificateRoutes.get("/activities/:activityId/certificates", async (c) => {
  const institutionId = c.req.query("institutionId")?.trim();
  const gate = await certificateActor(c, institutionId);
  if ("response" in gate) return gate.response;
  const activityId = c.req.param("activityId")!;
  return c.json({ success: true, certificates: await gate.issuance.list(activityId) });
});

certificateRoutes.get("/activities/:activityId/certificates/:certificateId", async (c) => {
  const institutionId = c.req.query("institutionId")?.trim();
  const gate = await certificateActor(c, institutionId);
  if ("response" in gate) return gate.response;
  const certificateId = c.req.param("certificateId")!;
  const certificate = await gate.issuance.status(certificateId);
  return c.json({ success: true, certificate, contentTotals: await gate.issuance.contentTotals(certificateId) });
});

certificateRoutes.post("/activities/:activityId/certificates/:certificateId/prepare", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const institutionId = typeof body.institutionId === "string" ? body.institutionId : undefined;
  const gate = await certificateActor(c, institutionId);
  if ("response" in gate) return gate.response;
  const activityId = c.req.param("activityId")!.trim();
  const certificateId = c.req.param("certificateId")!.trim();
  if (!activityId || !certificateId) return badRequest(c, "activityId dan certificateId wajib disertakan.");
  const intent = await gate.issuance.prepare(gate.account, activityId, certificateId);
  return c.json({ success: true, certificate: intent, contentTotals: await gate.issuance.contentTotals(certificateId) }, 201);
});

certificateRoutes.post("/activities/:activityId/certificates/:certificateId/submit", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const institutionId = typeof body.institutionId === "string" ? body.institutionId : undefined;
  const signature = typeof body.signature === "string" ? (body.signature as Hex) : undefined;
  if (!signature) return badRequest(c, "signature wajib disertakan.");
  const gate = await certificateActor(c, institutionId);
  if ("response" in gate) return gate.response;
  const certificate = await gate.issuance.submit(gate.account, c.req.param("certificateId")!, signature);
  return c.json({ success: true, certificate });
});

certificateRoutes.post("/activities/:activityId/certificates/:certificateId/retry", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const institutionId = typeof body.institutionId === "string" ? body.institutionId : undefined;
  const gate = await certificateActor(c, institutionId);
  if ("response" in gate) return gate.response;
  const certificate = await gate.issuance.retry(gate.account, c.req.param("certificateId")!);
  return c.json({ success: true, certificate });
});

export const publicCertificateRoutes = new Hono();
publicCertificateRoutes.get("/certificates/:institutionId/:certificateId", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.certificateChain || !runtime.certificateStore) return c.json({ success: false, error: "Layanan sertifikat belum dikonfigurasi." }, 503);
  const issuance = createCertificateIssuance(
    runtime, { store: runtime.certificateStore, chain: runtime.certificateChain },
    runtime.activities!, runtime.disbursement!, c.req.param("institutionId")!,
  );
  const summary = await issuance.publicSummary(c.req.param("certificateId")!);
  if (!summary) return c.json({ success: false, error: "Sertifikat tidak ditemukan atau belum diterbitkan." }, 404);
  return c.json({ success: true, certificate: summary });
});
