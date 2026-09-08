import { Hono } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace, refuse } from "../workspace-session";
import { createReportPackages, PackageError } from "../report-package";

const routes = new Hono();
routes.all("/:preparationId/reports/*", handle);
routes.all("/:preparationId/reports", handle);

async function handle(c: import("hono").Context) {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ success: false, error: "Penyimpanan paket belum tersedia." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  if (c.req.method !== "GET" && auth.session.role !== "OFFICER") return refuse(c, 403, "forbidden");
  const packages = createReportPackages(runtime.evidence, runtime.files, runtime.reportAmilRules);
  const institution = auth.session.institutionId;
  const preparationId = c.req.param("preparationId")!;
  const tail = c.req.path.split("/reports")[1]!.split("/").filter(Boolean);
  try {
    if (c.req.method === "GET") {
      if (tail[0] === "review" && tail.length === 1) return c.json(await packages.review(institution, preparationId));
      if (tail[0] === "correction" && tail.length === 1) {
        const predecessor = c.req.query("predecessor");
        if (!predecessor) return c.json({ success: false, error: "Sebutkan paket pendahulu yang akan dikoreksi." }, 400);
        return c.json({ correction: await packages.correction(institution, preparationId, predecessor) });
      }
      if (tail.length === 0) return c.json({ packages: await packages.list(institution, preparationId) });
      if (tail.length === 1) return c.json({ package: await packages.read(institution, preparationId, tail[0]!) });
    }
    if (c.req.method === "POST") {
      if (!tail.length) return c.json({ package: await packages.prepare(institution, preparationId, await c.req.json()) }, 201);
      if (tail.length === 2 && tail[1] === "freeze") return c.json({ package: await packages.freeze(institution, preparationId, tail[0]!) }, 201);
    }
    return c.notFound();
  } catch (error) {
    if (error instanceof PackageError) return c.json({ success: false, error: error.message }, error.status);
    if (error instanceof SyntaxError) return c.json({ success: false, error: "JSON tidak sah." }, 400);
    return c.json({ success: false, error: "Paket tidak dapat diproses; coba lagi setelah sumber dan penyimpanan diperiksa." }, 500);
  }
}
export default routes;
