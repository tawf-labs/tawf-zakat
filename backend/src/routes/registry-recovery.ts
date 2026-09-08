import { Hono } from "hono";
import { type WorkspaceRuntime, workspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace } from "../workspace-session";
import { recoverRegistry, recoveryStatus } from "../registry-recovery";
import { z } from "zod";
import { MAX_EVIDENCE_FILE_BYTES } from "../evidence-files";
import { createRestrictedDocuments, DocumentError } from "../restricted-documents";
const routes = new Hono();
/** Recovery metadata may be read after confirmation; this never grants a paper download. */
async function recoverySubject(runtime: WorkspaceRuntime, institutionId: string, preparationId: string, intentId: string | undefined, actor: string) {
  if (intentId) {
    const intent = await runtime.registry?.store.get(institutionId, intentId, "ATTESTATION");
    const saved = intent && await runtime.evidence!.findReportPackage(institutionId, intent.statement.packageId);
    if (!intent || !saved || JSON.parse(saved.canonical).preparationId !== preparationId) throw new DocumentError("Atestasi tidak ditemukan.", "NOT_FOUND");
    if (intent.statement.auditor.toLowerCase() !== actor.toLowerCase()) {
      const attempt = await runtime.registry!.store.attempt(institutionId, intent.id);
      if (!attempt || (await runtime.registry!.chain.observe(intent, attempt.hash)).state !== "CONFIRMED") throw new DocumentError("Atestasi tidak ditemukan.", "NOT_FOUND");
    }
  }
  return { institutionId, preparationId, intentId };
}
routes.all("/recovery/files", async c => {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ error: "Penyimpanan belum dikonfigurasi." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  try {
    const documents = createRestrictedDocuments(runtime.evidence, runtime.files, runtime.registry?.store);
    if (c.req.method === "GET") {
      const subject = await recoverySubject(runtime, auth.session.institutionId, c.req.query("preparationId") ?? "", c.req.query("intentId"), auth.session.account);
      return c.json({ files: await documents.inspect(subject) });
    }
    if (c.req.method !== "POST") return c.notFound();
    if (auth.session.role === "READER") return c.json({ error: "Peran pembaca tidak dapat memulihkan berkas." }, 403);
    const input = z.object({ preparationId: z.string().min(1).max(200), fileId: z.string().min(1).max(200),
      intentId: z.string().min(1).max(100).optional(), contentBase64: z.string().max(Math.ceil(MAX_EVIDENCE_FILE_BYTES / 3) * 4) }).strict().safeParse(await c.req.json());
    if (!input.success) return c.json({ error: "Parameter backup tidak sah." }, 400);
    const subject = await recoverySubject(runtime, auth.session.institutionId, input.data.preparationId, input.data.intentId, auth.session.account);
    const bytes = Buffer.from(input.data.contentBase64, "base64");
    if (bytes.toString("base64") !== input.data.contentBase64) return c.json({ error: "Backup tidak cocok dengan sumber yang dikomitmenkan." }, 409);
    return c.json({ file: await documents.restore(subject, input.data.fileId, bytes) });
  } catch (error) {
    if (error instanceof DocumentError) return c.json({ error: error.message }, error.reason === "NOT_FOUND" ? 404 : (error.reason === "BINDING" || error.reason === "CORRUPT") ? 409 : 503);
    return c.json({ error: "Berkas belum dapat dipulihkan; periksa backup dan kunci penyimpanan." }, 503);
  }
});
routes.all("/recovery", async c => {
  const runtime = workspaceRuntime();
  if (!runtime?.registry) return c.json({ error: "Registry belum dikonfigurasi." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  try {
    if (c.req.method === "GET") return c.json({ recovery: await recoveryStatus(runtime.registry, auth.session.institutionId) });
    if (c.req.method !== "POST") return c.notFound();
    if (auth.session.role === "READER") return c.json({ error: "Peran pembaca tidak dapat menjalankan pemulihan." }, 403);
    const body = await c.req.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) return c.json({ error: "Pemulihan tidak menerima perubahan parameter." }, 400);
    return c.json({ recovery: await recoverRegistry(runtime.registry, auth.session.institutionId) });
  } catch { return c.json({ error: "Pemulihan belum selesai; periksa ulang. Checkpoint terakhir tetap tersimpan." }, 503); }
});
export default routes;
