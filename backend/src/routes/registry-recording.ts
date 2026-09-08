import { Hono } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace } from "../workspace-session";
import { createRecording, RecordingError } from "../registry-recording";
import { PackageError, createReportPackages } from "../report-package";
import type { Hex } from "viem";
const routes = new Hono();
routes.all("/:preparationId/reports/:packageId/recording", handle);
routes.all("/:preparationId/reports/:packageId/recording/*", handle);
routes.all("/:preparationId/reports/:packageId/publication", handle);
routes.all("/:preparationId/reports/:packageId/publication/*", handle);
async function handle(c: import("hono").Context) {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence || !runtime.registry) return c.json({ error: "Registry bukti belum dikonfigurasi." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  const preparation = c.req.param("preparationId")!, packageId = c.req.param("packageId")!;
  try {
    // Membership grants private review; only live registry authority grants recording.
    await createReportPackages(runtime.evidence).read(auth.session.institutionId, preparation, packageId);
    const publication = c.req.path.includes("/publication");
    const recording = createRecording(runtime, runtime.registry, auth.session.institutionId, preparation, packageId, publication);
    const marker = publication ? "/publication" : "/recording";
    const tail = c.req.path.slice(c.req.path.indexOf(marker) + marker.length).split("/").filter(Boolean);
    if (c.req.method === "GET" && tail.length === 0) return c.json({ intents: await recording.list() });
    if (publication && c.req.method === "GET" && tail[0] === "version" && tail.length === 1) return c.json({ version: await recording.version() });
    if (c.req.method === "GET" && tail.length === 1) return c.json({ intent: await recording.status(tail[0]!) });
    if (c.req.method === "POST" && tail.length === 0) return c.json({ intent: await recording.prepare(auth.session.account as Hex, await c.req.json()) }, 201);
    if (c.req.method === "POST" && tail.length === 2 && tail[1] === "submit") return c.json({ intent: await recording.submit(auth.session.account as Hex, tail[0]!, await c.req.json()) });
    if (c.req.method === "POST" && tail.length === 2 && tail[1] === "retry") return c.json({ intent: await recording.retry(auth.session.account as Hex, tail[0]!, await c.req.json()) });
    return c.notFound();
  } catch (error) {
    if (error instanceof RecordingError || error instanceof PackageError) return c.json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return c.json({ error: "JSON tidak sah." }, 400);
    return c.json({ error: "Registry atau penyimpanan tidak dapat diperiksa. Muat ulang status sebelum mengulang pengesahan." }, 503);
  }
}
export default routes;
