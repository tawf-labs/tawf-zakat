import { Hono } from "hono";
import { workspaceRuntime } from "../workspace-runtime";
import { authenticateWorkspace } from "../workspace-session";
import { recoverRegistry, recoveryStatus } from "../registry-recovery";
import { z } from "zod";
import { recoveryFiles, inspectRecoveryFiles, restoreRecoveryFile, RecoveryFileError } from "../evidence-recovery";
import { MAX_EVIDENCE_FILE_BYTES } from "../evidence-files";
const routes = new Hono();
routes.all("/recovery/files", async c => {
  const runtime = workspaceRuntime();
  if (!runtime?.evidence) return c.json({ error: "Penyimpanan belum dikonfigurasi." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  try {
    if (c.req.method === "GET") {
      const files = await recoveryFiles(runtime, auth.session.institutionId, c.req.query("preparationId") ?? "", c.req.query("intentId"), auth.session.account);
      return c.json({ files: await inspectRecoveryFiles(runtime, files) });
    }
    if (c.req.method !== "POST") return c.notFound();
    if (auth.session.role === "READER") return c.json({ error: "Peran pembaca tidak dapat memulihkan berkas." }, 403);
    const input = z.object({ preparationId: z.string().min(1).max(200), fileId: z.string().min(1).max(200),
      intentId: z.string().min(1).max(100).optional(), contentBase64: z.string().max(Math.ceil(MAX_EVIDENCE_FILE_BYTES / 3) * 4) }).strict().safeParse(await c.req.json());
    if (!input.success) return c.json({ error: "Parameter backup tidak sah." }, 400);
    const files = await recoveryFiles(runtime, auth.session.institutionId, input.data.preparationId, input.data.intentId, auth.session.account);
    return c.json({ file: await restoreRecoveryFile(runtime, files, input.data.fileId, input.data.contentBase64) });
  } catch (error) {
    if (error instanceof RecoveryFileError) return c.json({ error: error.message }, error.status);
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
