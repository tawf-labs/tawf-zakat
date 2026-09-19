import { Hono, type Context } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace } from "../workspace-session";
import { createAuditFindingService, AuditFindingError } from "../report-audit-findings";

const routes = new Hono();
routes.all("/:preparationId/reports/:packageId/findings", handle);
routes.all("/audit-findings/*", handle);

async function handle(c: Context) {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence || !runtime.auditFindings) return c.json({ success: false, error: "Penyimpanan temuan pemeriksaan belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  const findings = createAuditFindingService(runtime);
  const session = auth.session;
  const body = async () => c.req.json();
  try {
    const packageId = c.req.param("packageId");
    if (packageId) {
      const preparationId = c.req.param("preparationId")!;
      if (c.req.method === "GET") return c.json({ success: true, ...await findings.listFindingsForPackage(session, packageId) });
      if (c.req.method === "POST") return c.json({ success: true, finding: await findings.createFinding(session, preparationId, packageId, await body()) }, 201);
      return c.notFound();
    }
    const tail = c.req.path.split("/audit-findings/")[1]!.split("/").filter(Boolean);
    if (c.req.method === "GET") {
      if (tail.length === 1 && tail[0] === "queues") return c.json({ success: true, queues: await findings.getQueues(session) });
      if (tail.length === 1) return c.json({ success: true, finding: await findings.getFinding(session, tail[0]!) });
      if (tail.length === 3 && tail[1] === "attachments") {
        const file = await findings.readAttachment(session, tail[0]!, tail[2]!);
        return c.body(file.bytes as unknown as ArrayBuffer, 200, {
          "Content-Type": file.mimeType,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
          "Cache-Control": "private, no-store",
        });
      }
    }
    if (c.req.method === "POST" && tail.length === 2) {
      const [findingId, action] = tail as [string, string];
      if (action === "responses") return c.json({ success: true, finding: await findings.addAmilResponse(session, findingId, await body()) });
      if (action === "follow-ups") return c.json({ success: true, finding: await findings.addAuditorFollowup(session, findingId, await body()) });
      if (action === "corrections") return c.json({ success: true, finding: await findings.correctNote(session, findingId, await body()) });
      if (action === "handover") return c.json({ success: true, finding: await findings.handover(session, findingId, await body()) });
    }
    return c.notFound();
  } catch (error) {
    if (error instanceof AuditFindingError) return c.json({ success: false, error: error.message }, error.status);
    if (error instanceof SyntaxError) return c.json({ success: false, error: "JSON tidak sah." }, 400);
    console.error("Audit finding request failed:", error);
    return c.json({ success: false, error: "Temuan pemeriksaan tidak dapat diproses. Hasilnya belum diketahui; muat ulang sebelum mencoba lagi." }, 500);
  }
}

export default routes;
