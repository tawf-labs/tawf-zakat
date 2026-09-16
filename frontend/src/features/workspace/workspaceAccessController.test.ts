import { expect, it } from "bun:test";
import { createWorkspaceAccess } from "./workspaceAccessController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const stored = new Map<string, string>();
  const ended = new Map<string, "EXPIRED" | "REVOKED">();
  let sequence = 0;
  let time = 1000;
  let scheduled: (() => void) | null = null;
  let logoutUnavailable = false;
  let workspaceReply: () => Response | Promise<Response> = () => Response.json({ account: "0xaaaa", institution: { id: "institution-a" }, role: "OFFICER" });
  let privateReply = () => Response.json({ value: "private" });
  const ports: Parameters<typeof createWorkspaceAccess>[0] = { origin: "https://api.test", now: () => time,
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    schedule: task => { scheduled = task; return () => { scheduled = null; }; }, sign: async () => "0x1234",
    fetch: async (url, init) => {
      if (init?.method === "DELETE") {
        if (logoutUnavailable) throw new TypeError("Network unavailable");
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/challenge")) {
        const input = JSON.parse(String(init?.body));
        return Response.json({ challenge: { nonce: "nonce", ...input }, typedData: {
          domain: {}, types: {}, primaryType: "Access", message: { issuedAt: "1000", expiresAt: "1300" },
        } });
      }
      if (url.endsWith("/session")) return Response.json({ token: `session-${++sequence}`, institutionId: "institution-a", role: "OFFICER", expiresAt: time + 60 });
      if (url.endsWith("/workspace")) {
        const token = new Headers(init?.headers).get("Authorization")?.slice(7) ?? "";
        if (ended.has(token)) return Response.json({ reason: "unauthenticated", sessionEnd: ended.get(token) }, { status: 401 });
        return workspaceReply();
      }
      return privateReply();
    },
  };
  const access = createWorkspaceAccess(ports);
  access.connect("0xaaaa");
  return { access, stored, ended, workspaceReply: (reply: typeof workspaceReply) => { workspaceReply = reply; }, reload: () => createWorkspaceAccess(ports), failLogout: () => { logoutUnavailable = true; },
    advance: (seconds: number) => { time += seconds; scheduled?.(); }, reply: (next: typeof privateReply) => { privateReply = next; } };
}

it("does not reopen the previous account when its wallet answers after an account switch", async () => {
  const signing = deferred<void>();
  const signature = deferred<string>();
  const stored = new Map<string, string>();
  const access = createWorkspaceAccess({
    origin: "https://api.test", now: () => 1000,
    storage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { stored.set(key, value); }, removeItem: key => { stored.delete(key); } },
    schedule: () => () => {},
    sign: async () => { signing.resolve(); return signature.promise; },
    fetch: async (_url, init) => {
      const input = JSON.parse(String(init?.body));
      return Response.json({ challenge: { nonce: "challenge", institutionId: input.institutionId, account: input.account },
        typedData: { domain: {}, types: {}, primaryType: "Access", message: { issuedAt: "1000", expiresAt: "1300" } } });
    },
  });
  access.connect("0xaaaa");
  const opening = access.enter("institution-a");
  await signing.promise;
  access.connect("0xbbbb");
  signature.resolve("0x1234");
  await opening;
  expect(access.getSnapshot()).toMatchObject({ state: "CLOSED", account: "0xbbbb" });
  expect(stored.size).toBe(0);
});

it("ends access when a restricted download reports revocation", async () => {
  const { access, stored, reply } = fixture();
  await access.enter("institution-a");
  const ready = access.getSnapshot();
  if (ready.state !== "READY") throw new Error("Workspace did not open");
  reply(() => Response.json({ reason: "unauthenticated", sessionEnd: "REVOKED", error: "Sesi dicabut." }, { status: 401 }));
  await expect(ready.requests.blob("/api/evidence/preparation/files/file")).rejects.toMatchObject({ status: 401, sessionEnd: "REVOKED" });
  expect(access.getSnapshot().state).toBe("CLOSED");
  expect(stored.size).toBe(0);
});

it("hides the report draft at expiry and restores it only after checking the old session again", async () => {
  const { access, ended, reply } = fixture();
  await access.enter("institution-a");
  const ready = access.getSnapshot();
  if (ready.state !== "READY") throw new Error("Workspace did not open");
  const draft = access.unsavedReport("preparation-a");
  if (draft.state !== "EDITABLE") throw new Error("Draft inaccessible");
  const input = { reportId: "2024", version: "2", predecessor: "p1", reason: "Correction", narrative: "Private draft", amounts: { collected: "123" } };
  draft.change(input);
  ended.set("session-1", "EXPIRED");
  reply(() => Response.json({ reason: "unauthenticated", sessionEnd: "EXPIRED" }, { status: 401 }));
  await expect(ready.requests.json("/api/evidence")).rejects.toMatchObject({ status: 401 });
  expect(access.unsavedReport("preparation-a").state).toBe("HIDDEN");
  await access.enter("institution-a");
  expect(access.unsavedReport("preparation-a")).toMatchObject({ state: "EDITABLE", value: input });
  expect(access.unsavedReport("preparation-b")).toMatchObject({ state: "EDITABLE", value: null });
  expect(() => draft.change({ ...input, narrative: "Late edit" })).toThrow("Konteks akses");
});

it("locks at local expiry and clears a retained draft if the old session was revoked before reauthentication", async () => {
  const { access, advance, ended } = fixture();
  await access.enter("institution-a");
  const draft = access.unsavedReport("preparation-a");
  if (draft.state !== "EDITABLE") throw new Error("Draft inaccessible");
  draft.change({ reportId: "2024", version: "1", predecessor: "", reason: "", narrative: "Do not restore", amounts: {} });
  ended.set("session-1", "EXPIRED");
  advance(61);
  expect(access.getSnapshot().state).toBe("CLOSED");
  expect(access.unsavedReport("preparation-a").state).toBe("HIDDEN");
  ended.set("session-1", "REVOKED");
  await access.enter("institution-a");
  expect(access.unsavedReport("preparation-a")).toMatchObject({ state: "EDITABLE", value: null });
});

it("finishes local logout and clears drafts even when server revocation cannot be confirmed", async () => {
  const { access, failLogout, stored } = fixture();
  await access.enter("institution-a");
  const draft = access.unsavedReport("preparation-a");
  if (draft.state !== "EDITABLE") throw new Error("Draft inaccessible");
  draft.change({ reportId: "2024", version: "1", predecessor: "", reason: "", narrative: "Private", amounts: {} });
  failLogout();
  expect(await access.leave()).toEqual({ serverRevoked: false });
  expect(access.getSnapshot()).toMatchObject({ state: "CLOSED", error: expect.stringContaining("belum terkonfirmasi") });
  expect(stored.size).toBe(0);
  await access.enter("institution-a");
  expect(access.unsavedReport("preparation-a")).toMatchObject({ state: "EDITABLE", value: null });
});

it("revalidates a stored session after reload without persisting report drafts", async () => {
  const { access, reload, stored } = fixture();
  await access.enter("institution-a");
  const draft = access.unsavedReport("preparation-a");
  if (draft.state !== "EDITABLE") throw new Error("Draft inaccessible");
  draft.change({ reportId: "2024", version: "1", predecessor: "", reason: "", narrative: "Never persisted", amounts: {} });
  expect([...stored.values()].join()).not.toContain("Never persisted");
  const reopened = reload();
  await reopened.connect("0xaaaa");
  expect(reopened.getSnapshot()).toMatchObject({ state: "READY", workspace: { institution: { id: "institution-a" } } });
  expect(reopened.unsavedReport("preparation-a")).toMatchObject({ state: "EDITABLE", value: null });
});

for (const bytes of [false, true]) it(`discards a late ${bytes ? "download" : "JSON response"} after logout`, async () => {
  const { access, reply } = fixture();
  await access.enter("institution-a");
  const ready = access.getSnapshot();
  if (ready.state !== "READY") throw new Error("Workspace did not open");
  const body = deferred<any>();
  const reading = deferred<void>();
  reply(() => ({ ok: true, status: 200, json: () => { reading.resolve(); return body.promise; }, blob: () => { reading.resolve(); return body.promise; } }) as Response);
  const pending = bytes ? ready.requests.blob("/api/evidence/file") : ready.requests.json("/api/evidence");
  await reading.promise;
  await access.leave();
  body.resolve(bytes ? new Blob(["private"]) : { secret: "private" });
  await expect(pending).rejects.toThrow("Konteks akses");
});

for (const status of [403, 503]) it(`keeps access for an action-specific ${status} refusal`, async () => {
  const { access, reply } = fixture();
  await access.enter("institution-a");
  const ready = access.getSnapshot();
  if (ready.state !== "READY") throw new Error("Workspace did not open");
  reply(() => Response.json({ reason: "registry-unavailable" }, { status }));
  await expect(ready.requests.json("/api/evidence")).rejects.toMatchObject({ status });
  expect(access.getSnapshot().state).toBe("READY");
});

it("clears drafts on a legacy 401 whose cause cannot establish expiry", async () => {
  const { access, reply } = fixture();
  await access.enter("institution-a");
  const ready = access.getSnapshot();
  const draft = access.unsavedReport("p");
  if (ready.state !== "READY" || draft.state !== "EDITABLE") throw new Error("Workspace did not open");
  draft.change({ reportId: "r", version: "1", predecessor: "", reason: "", narrative: "private", amounts: {} });
  reply(() => Response.json({ reason: "unauthenticated" }, { status: 401 }));
  await expect(ready.requests.json("/api/evidence")).rejects.toMatchObject({ status: 401 });
  await access.enter("institution-a");
  expect(access.unsavedReport("p")).toMatchObject({ state: "EDITABLE", value: null });
});


it("refreshes the officer name while retaining a draft for the same identity", async () => {
  const { access, workspaceReply } = fixture();
  const workspace = { account: "0xaaaa", institution: { id: "institution-a" }, role: "OFFICER", officer: { id: "person-a", displayName: "Before" } };
  workspaceReply(() => Response.json(workspace));
  await access.enter("institution-a");
  const draft = access.unsavedReport("preparation-a");
  if (draft.state !== "EDITABLE") throw new Error("Draft unavailable");
  draft.change({ reportId: "report-a", version: "1", predecessor: "", reason: "", narrative: "Private draft", amounts: {} });
  workspaceReply(() => Response.json({ ...workspace, officer: { ...workspace.officer, displayName: "After" } }));
  await access.refresh();
  expect(access.getSnapshot()).toMatchObject({ workspace: { officer: { displayName: "After" } } });
  expect(access.unsavedReport("preparation-a")).toMatchObject({ value: { narrative: "Private draft" } });
  const held = deferred<Response>();
  workspaceReply(() => held.promise);
  const refreshing = access.refresh();
  await access.connect("0xbbbb");
  held.resolve(Response.json(workspace));
  await expect(refreshing).rejects.toThrow("Konteks akses sudah berubah");
  expect(access.getSnapshot()).toMatchObject({ state: "CLOSED", account: "0xbbbb" });
});

it("invalidates old private material when refresh establishes a different officer identity", async () => {
  const { access, workspaceReply } = fixture();
  await access.enter("institution-a");
  const ready = access.getSnapshot();
  if (ready.state !== "READY") throw new Error("Workspace unavailable");
  const draft = access.unsavedReport("preparation-a");
  if (draft.state !== "EDITABLE") throw new Error("Draft unavailable");
  draft.change({ reportId: "old", version: "1", predecessor: "", reason: "", narrative: "Old identity", amounts: {} });
  workspaceReply(() => Response.json({ account: "0xaaaa", institution: { id: "institution-a" }, role: "OFFICER", officer: { id: "person-a", displayName: "Verified officer" } }));
  await access.refresh();
  expect(access.getSnapshot()).toMatchObject({ state: "READY", workspace: { officer: { id: "person-a" } } });
  expect(access.unsavedReport("preparation-a")).toMatchObject({ value: null });
  await expect(ready.requests.json("/api/evidence/private")).rejects.toThrow("Konteks akses sudah berubah");
});

it("does not restore an old authority snapshot when refresh responses arrive out of order", async () => {
  const { access, workspaceReply } = fixture();
  const workspace = { account: "0xaaaa", institution: { id: "institution-a" }, role: "OFFICER", officer: null };
  workspaceReply(() => Response.json(workspace));
  await access.enter("institution-a");
  const older = deferred<Response>();
  workspaceReply(() => older.promise);
  const pending = access.refresh();
  workspaceReply(() => Response.json({ ...workspace, endorsementAccounts: [] }));
  await access.refresh();
  older.resolve(Response.json({ ...workspace, endorsementAccounts: [{ id: "revoked", version: 1, isActive: true }] }));
  await pending;
  expect(access.getSnapshot()).toMatchObject({ workspace: { endorsementAccounts: [] } });
});
