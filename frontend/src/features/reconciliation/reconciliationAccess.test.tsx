import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReconciliationWorkbench } from "./ReconciliationWorkbench";
import { InternalModePanel } from "./InternalModePanel";
import { runInternalReconciliation, runInterInstitutionReconciliation } from "./reconciliationClient";

describe("reconciliation runs only through the workspace session", () => {
  it("sends both modes through the supplied authenticated client", async () => {
    const calls: { path: string; body: unknown }[] = [];
    const post = async <T,>(path: string, body: unknown) => {
      calls.push({ path, body });
      return { report: "inter" } as T;
    };
    await runInternalReconciliation(post, { fromBlock: 1 });
    expect(await runInterInstitutionReconciliation(post, { claim: {}, source: {}, options: {} } as never)).toBe("inter" as never);
    expect(calls.map((call) => call.path)).toEqual(["/api/reconciliation/internal", "/api/reconciliation/antar-lembaga"]);
    expect(calls[0]!.body).toEqual({ fromBlock: 1 });
  });

  it("renders inside the workspace and refuses to mount without its client", () => {
    const requests = { json: async () => ({}) as never };
    expect(renderToStaticMarkup(<ReconciliationWorkbench requests={requests} />)).toContain("Jalankan rekonsiliasi");
    expect(() => renderToStaticMarkup(<InternalModePanel />)).toThrow("ruang kerja");
  });
});
