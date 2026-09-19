import { Hono } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace } from "../workspace-session";
import { createAuditFindingService, AuditFindingError } from "../report-audit-findings";

const routes = new Hono();

routes.post("/:preparationId/reports/:packageId/findings", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ success: false, error: "Penyimpanan bukti belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  try {
    const body = await c.req.json();
    const service = createAuditFindingService(runtime);
    const finding = await service.createFinding(
      auth.session,
      c.req.param("preparationId"),
      c.req.param("packageId"),
      body,
    );
    return c.json({ success: true, finding }, 201);
  } catch (error) {
    if (error instanceof AuditFindingError) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    if (error instanceof SyntaxError) {
      return c.json({ success: false, error: "JSON tidak sah." }, 400);
    }
    return c.json({ success: false, error: (error as Error).message || "Gagal mencatat temuan audit." }, 500);
  }
});

routes.get("/:preparationId/reports/:packageId/findings", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ success: false, error: "Penyimpanan bukti belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  try {
    const service = createAuditFindingService(runtime);
    const findings = await service.listFindingsForPackage(auth.session, c.req.param("packageId"));
    return c.json({ success: true, findings });
  } catch (error) {
    if (error instanceof AuditFindingError) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    return c.json({ success: false, error: "Gagal memuat temuan audit." }, 500);
  }
});

routes.get("/audit-findings/queues", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ success: false, error: "Penyimpanan bukti belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  try {
    const service = createAuditFindingService(runtime);
    const queues = await service.getQueues(auth.session);
    return c.json({ success: true, queues });
  } catch (error) {
    if (error instanceof AuditFindingError) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    return c.json({ success: false, error: "Gagal memuat antrean temuan audit." }, 500);
  }
});

routes.get("/audit-findings/:findingId", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ success: false, error: "Penyimpanan bukti belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  try {
    const service = createAuditFindingService(runtime);
    const finding = await service.getFinding(auth.session, c.req.param("findingId"));
    return c.json({ success: true, finding });
  } catch (error) {
    if (error instanceof AuditFindingError) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    return c.json({ success: false, error: "Gagal memuat detail temuan audit." }, 500);
  }
});

routes.post("/audit-findings/:findingId/responses", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ success: false, error: "Penyimpanan bukti belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  try {
    const body = await c.req.json();
    const service = createAuditFindingService(runtime);
    const finding = await service.addAmilResponse(auth.session, c.req.param("findingId"), body);
    return c.json({ success: true, finding });
  } catch (error) {
    if (error instanceof AuditFindingError) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    if (error instanceof SyntaxError) {
      return c.json({ success: false, error: "JSON tidak sah." }, 400);
    }
    return c.json({ success: false, error: (error as Error).message || "Gagal menambahkan tanggapan amil." }, 500);
  }
});

routes.post("/audit-findings/:findingId/follow-ups", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ success: false, error: "Penyimpanan bukti belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  try {
    const body = await c.req.json();
    const service = createAuditFindingService(runtime);
    const finding = await service.addAuditorFollowup(auth.session, c.req.param("findingId"), body);
    return c.json({ success: true, finding });
  } catch (error) {
    if (error instanceof AuditFindingError) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    if (error instanceof SyntaxError) {
      return c.json({ success: false, error: "JSON tidak sah." }, 400);
    }
    return c.json({ success: false, error: (error as Error).message || "Gagal memproses tindak lanjut auditor." }, 500);
  }
});

routes.get("/audit-findings/:findingId/attachments/:attachmentId", async (c) => {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ success: false, error: "Penyimpanan bukti belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;

  try {
    const service = createAuditFindingService(runtime);
    const file = await service.readAttachment(
      auth.session,
      c.req.param("findingId"),
      c.req.param("attachmentId"),
    );
    return c.body(file.bytes as unknown as ArrayBuffer, 200, {
      "Content-Type": file.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      "Cache-Control": "private, no-store",
    });
  } catch (error) {
    if (error instanceof AuditFindingError) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    return c.json({ success: false, error: "Gagal mengunduh lampiran." }, 500);
  }
});

export default routes;
