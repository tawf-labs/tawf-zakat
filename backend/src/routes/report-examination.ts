import { Hono } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace } from "../workspace-session";
import { createReportVersions } from "../report-versions";
import { PackageError } from "../report-package";
const routes = new Hono();
routes.get("/api/public/reports/:packageId", async c => {
  c.header("Cache-Control", "no-store");
  const runtime = workspaceRuntime();
  if (!runtime?.evidence || !runtime.registry) return c.json({ error: "Ringkasan dan status registry belum tersedia." }, 503);
  try {
    const id = c.req.param("packageId");
    const location = await runtime.evidence.locateReportPackage(id);
    if (!location) return c.json({ error: "Ringkasan versi terbit tidak ditemukan." }, 404);
    return c.json({ summary: await createReportVersions(runtime, location.institutionId, location.preparationId, id).publicSummary() });
  } catch (error) {
    if (error instanceof PackageError && error.status === 404) return c.json({ error: "Ringkasan versi terbit tidak ditemukan." }, 404);
    return c.json({ error: "Ringkasan atau status terkini tidak dapat diperiksa." }, 503);
  }
});
routes.get("/api/evidence/:preparationId/reports/:packageId/examination", async c => {
  c.header("Cache-Control", "private, no-store"); c.header("Vary", "Authorization");
  c.header("X-Content-Type-Options", "nosniff");
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ error: "Paket pemeriksaan belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  try {
    const bundle = await createReportVersions(runtime, auth.session.institutionId, c.req.param("preparationId"), c.req.param("packageId")).examination();
    c.header("Content-Disposition", `attachment; filename="examination-${c.req.param("packageId").replace(/[^a-zA-Z0-9-]/g, "")}.json"`);
    return c.json(bundle);
  } catch (error) {
    if (error instanceof PackageError) return c.json({ error: error.message }, error.status);
    return c.json({ error: "Paket pemeriksaan tidak dapat dimuat; sumber tidak diganti dengan data terbaru." }, 503);
  }
});
export default routes;
