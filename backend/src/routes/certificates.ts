/**
 * Distribution-stage certificate routes (#111).
 *
 *   POST /api/activities/:activityId/certificates/:certificateId/prepare  freeze scope, return typed data to sign
 *   GET  /api/activities/:activityId/certificates                        list certificates for the activity
 *   GET  /api/activities/:activityId/certificates/:certificateId         status of one certificate
 *   POST /api/activities/:activityId/certificates/:certificateId/submit  officer's signature; relay broadcasts
 *   POST /api/activities/:activityId/certificates/:certificateId/retry   resend the same signed bytes
 *   POST /api/activities/:activityId/certificates/:certificateId/correct prepare the next version (#112); signed via submit
 *   GET  /api/activities/:activityId/certificates/:certificateId/history read-only version history (any workspace reader)
 *   GET  /api/public/certificates/:institutionId/:certificateId          public verifier: official head, allowlisted aggregate only
 *   GET  /api/public/certificates/:institutionId/:certificateId/versions/:version   one historical version
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Hex } from "viem";
import { workspaceRuntime, type WorkspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace, badRequest, refuse } from "../workspace-session";
import { authorize } from "../tenancy";
import { operationalActor, OperationalAccessDenied } from "../operational-access";
import { createCertificateIssuance, CertificateError } from "../certificate-issuance";
import { CertificateBudgetError } from "../certificate-budget";

export const certificateRoutes = new Hono();
certificateRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
certificateRoutes.onError((error, c) => {
  if (error instanceof CertificateError) return c.json({ success: false, error: error.message }, error.status);
  if (error instanceof CertificateBudgetError) return c.json({ success: false, error: error.message }, 503);
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
  return c.json({
    success: true, certificate, contentTotals: await gate.issuance.contentTotals(certificateId),
    line: await gate.issuance.line(certificate.certification.certificateId),
  });
});

/** Read-only: a reader (for example an auditor's workspace session) may follow the history of a
 * certificate line but holds no capability to prepare, sign or correct on the institution's behalf. */
certificateRoutes.get("/activities/:activityId/certificates/:certificateId/history", async (c) => {
  const runtime = runtimeOf();
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId")?.trim());
  if (!auth.ok) return auth.response;
  if (!authorize(auth.session.role, "viewWorkspace")) return refuse(c, 403, "forbidden");
  const issuance = createCertificateIssuance(
    runtime, { store: runtime.certificateStore!, chain: runtime.certificateChain! },
    runtime.activities!, runtime.disbursement!, auth.session.institutionId,
  );
  const line = await issuance.line(c.req.param("certificateId")!);
  return c.json({ success: true, line });
});

certificateRoutes.post("/activities/:activityId/certificates/:certificateId/correct", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const institutionId = typeof body.institutionId === "string" ? body.institutionId : undefined;
  const gate = await certificateActor(c, institutionId);
  if ("response" in gate) return gate.response;
  const activityId = c.req.param("activityId")!.trim();
  const certificateId = c.req.param("certificateId")!.trim();
  const certificate = await gate.issuance.prepareCorrection(gate.account, activityId, certificateId, body.reason, body.note);
  return c.json({
    success: true, certificate, contentTotals: await gate.issuance.contentTotals(certificate.id),
    line: await gate.issuance.line(certificateId),
  }, 201);
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
publicCertificateRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  await next();
});
publicCertificateRoutes.onError((error, c) => c.json({ success: false, error: error instanceof CertificateError
  ? error.message : "Isi atau bukti chain sertifikat tidak dapat diperiksa. Verifikasi ditahan." }, 503));
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
publicCertificateRoutes.get("/certificates/:institutionId/:certificateId/versions/:version", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.certificateChain || !runtime.certificateStore) return c.json({ success: false, error: "Layanan sertifikat belum dikonfigurasi." }, 503);
  const issuance = createCertificateIssuance(
    runtime, { store: runtime.certificateStore, chain: runtime.certificateChain },
    runtime.activities!, runtime.disbursement!, c.req.param("institutionId")!,
  );
  const summary = await issuance.publicSummary(c.req.param("certificateId")!, c.req.param("version")!);
  if (!summary) return c.json({ success: false, error: "Versi sertifikat tidak ditemukan atau belum diterbitkan." }, 404);
  return c.json({ success: true, certificate: summary });
});
