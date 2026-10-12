/**
 * Reconciliation and period figures are staff tools: the mounted app refuses
 * anyone without an active workspace session before a route reads a ledger.
 */
import { afterEach, describe, expect, it } from "bun:test";
import app from "../src/index";
import { configureWorkspace, resetWorkspace, type WorkspaceRuntime } from "../src/workspace-runtime";

const ENDPOINTS = [
  ["/api/reconciliation/antar-lembaga", {}],
  ["/api/reconciliation/internal", {}],
  ["/api/period-report/verify", { period: { kind: "AKHIR_TAHUN", year: 2026 } }],
] as const;
const post = (path: string, body: unknown, token?: string) =>
  app.fetch(new Request(`http://localhost:3001${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
/** Only the two reads the door performs; the routes behind it keep their own sources. */
const memberRuntime = (active: boolean) => ({
  now: () => 1_800_000_000,
  store: {
    sessionStateFor: async () => active
      ? { state: "ACTIVE", session: { account: "0xabc", institutionId: "lpz-sinar-amanah" } }
      : { state: "EXPIRED" },
    activeMembershipFor: async () => ({ institutionId: "lpz-sinar-amanah", role: "ADMIN", isActive: true }),
  },
}) as unknown as WorkspaceRuntime;

afterEach(() => resetWorkspace());

describe("staff tool access", () => {
  it("is unavailable while no workspace is configured", async () => {
    for (const [path, body] of ENDPOINTS) expect((await post(path, body)).status).toBe(503);
  });

  it("refuses callers without an active workspace session", async () => {
    configureWorkspace(memberRuntime(true));
    for (const [path, body] of ENDPOINTS) {
      const response = await post(path, body);
      expect(response.status).toBe(401);
      expect((await response.json()).reason).toBe("unauthenticated");
    }
    configureWorkspace(memberRuntime(false));
    for (const [path, body] of ENDPOINTS) expect((await post(path, body, "expired-token")).status).toBe(401);
  });

  it("lets an active workspace member through to the route", async () => {
    configureWorkspace(memberRuntime(true));
    // Past the door the route answers for itself: a malformed ledger is a 400, not a 401.
    expect((await post("/api/reconciliation/antar-lembaga", {}, "member-token")).status).toBe(400);
    expect((await post("/api/period-report/verify", {}, "member-token")).status).toBe(400);
  });

  it("no longer offers the retired AI draft endpoint", async () => {
    configureWorkspace(memberRuntime(true));
    expect((await post("/api/period-report/draft", { period: { kind: "AKHIR_TAHUN", year: 2026 } }, "member-token")).status).toBe(404);
  });
});
