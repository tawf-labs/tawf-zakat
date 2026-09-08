import { createReportVersions } from "../report-versions";
import { Hono } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace } from "../workspace-session";
import { createRecording, RecordingError } from "../registry-recording";
import { createAttestation, attestationResponse, AttestationError } from "../report-attestation";
import { PackageError, createReportPackages } from "../report-package";
import type { Hex } from "viem";
const routes = new Hono();
routes.all("/:preparationId/reports/:packageId/recording", handle);
routes.all("/:preparationId/reports/:packageId/recording/*", handle);
routes.all("/:preparationId/reports/:packageId/publication", handle);
routes.all("/:preparationId/reports/:packageId/publication/*", handle);
routes.all("/:preparationId/reports/:packageId/attestation", attest);
routes.all("/:preparationId/reports/:packageId/attestation/*", attest);
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
    if (publication && c.req.method === "GET" && tail.length === 0 && c.req.query("view") === "versions") {
      return c.json(await createReportVersions(runtime, auth.session.institutionId, preparation, packageId).publicationView());
    }
    if (c.req.method === "GET" && tail.length === 0) return c.json({ intents: await recording.list() });
    if (publication && c.req.method === "GET" && tail.length === 1 && ["version", "history"].includes(tail[0]!)) {
      const view = await createReportVersions(runtime, auth.session.institutionId, preparation, packageId).publicationView();
      return c.json(tail[0] === "version" ? { version: view.version } : tail[0] === "history" ? { history: view.history } : view);
    }
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

/** Auditor notes over a published version. Membership opens the page; only a registry mandate signs. */
async function attest(c: import("hono").Context) {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence || !runtime.registry) return c.json({ error: "Registry bukti belum dikonfigurasi." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  const preparation = c.req.param("preparationId")!, packageId = c.req.param("packageId")!;
  try {
    await createReportPackages(runtime.evidence).read(auth.session.institutionId, preparation, packageId);
    const attestation = createAttestation(runtime, runtime.registry, auth.session.institutionId, preparation, packageId);
    const tail = c.req.path.slice(c.req.path.indexOf("/attestation") + "/attestation".length).split("/").filter(Boolean);
    const account = auth.session.account as Hex;
    if (c.req.method === "GET" && tail.length === 3 && tail[1] === "files") {
      const file = await attestation.download(account, tail[0]!, tail[2]!);
      return c.body(file.bytes as unknown as ArrayBuffer, 200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      });
    }
    if (c.req.method === "GET" && tail.length === 0) return c.json({ intents: (await attestation.list(account)).map(attestationResponse) });
    if (c.req.method === "GET" && tail.length === 1) return c.json({ intent: attestationResponse(await attestation.status(account, tail[0]!)) });
    if (c.req.method === "POST" && tail.length === 0) return c.json({ intent: attestationResponse(await attestation.prepare(account, await c.req.json())) }, 201);
    if (c.req.method === "POST" && tail.length === 2 && tail[1] === "submit") return c.json({ intent: attestationResponse(await attestation.submit(account, tail[0]!, await c.req.json())) });
    if (c.req.method === "POST" && tail.length === 2 && tail[1] === "retry") return c.json({ intent: attestationResponse(await attestation.retry(account, tail[0]!, await c.req.json())) });
    return c.notFound();
  } catch (error) {
    if (error instanceof AttestationError || error instanceof PackageError) return c.json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return c.json({ error: "JSON tidak sah." }, 400);
    return c.json({ error: "Registry atau penyimpanan tidak dapat diperiksa. Muat ulang status sebelum mengulang atestasi." }, 503);
  }
}
export default routes;
