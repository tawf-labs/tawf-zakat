import { Hono } from "hono";
import { authorityChangeInput } from "../report-authority-input";
import { authenticateWorkspace } from "../workspace-session";
import { workspaceRuntime } from "../workspace-runtime";
import type { Hex } from "viem";
const routes = new Hono();
routes.all("*", async c => {
  const runtime = workspaceRuntime();
  if (!runtime?.registry) return c.json({ error: "Registry belum dikonfigurasi." }, 503);
  const auth = await authenticateWorkspace(c, runtime, c.req.query("institutionId"));
  if (!auth.ok) return auth.response;
  const { institutionId, account } = auth.session;
  const chain = runtime.registry.chain;
  c.header("Cache-Control", "no-store");
  try {
    const tail = c.req.path.split("/authority")[1] ?? "";
    if (c.req.method === "GET" && !tail) {
      const subject = c.req.query("account") ?? account;
      if (!/^0x[0-9a-fA-F]{40}$/.test(subject)) return c.json({ error: "Akun tidak sah." }, 400);
      return c.json({ authority: await chain.authoritySnapshot(institutionId, subject as Hex) });
    }
    if (c.req.method === "GET" && tail === "/history") {
      const from = c.req.query("fromBlock") ?? "0";
      if (!/^\d{1,20}$/.test(from)) return c.json({ error: "Blok tidak sah." }, 400);
      return c.json(await chain.authorityHistory(institutionId, BigInt(from)));
    }
    if (c.req.method === "GET" && /^\/receipt\/0x[0-9a-fA-F]{64}$/.test(tail)) return c.json({ receipt: await chain.authorityReceipt(tail.slice(9) as Hex) });
    if (c.req.method === "POST" && tail === "/prepare") {
      const input = authorityChangeInput.safeParse(await c.req.json());
      if (!input.success) return c.json({ error: "Perubahan otoritas tidak sah." }, 400);
      return c.json({ transaction: await chain.prepareAuthorityChange(institutionId, account as Hex, input.data) }, 201);
    }
    return c.notFound();
  } catch (error) {
    if (error instanceof SyntaxError) return c.json({ error: "JSON tidak sah." }, 400);
    return c.json({ error: "Kewenangan atau receipt tidak dapat diverifikasi. Tindakan ditunda; periksa role live dan jaringan." }, 503);
  }
});
export default routes;
