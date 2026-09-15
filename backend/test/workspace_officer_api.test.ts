import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { type EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const BASE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const admin = privateKeyToAccount(`0x${"a1".repeat(32)}` as Hex);
const officer1 = privateKeyToAccount(`0x${"b2".repeat(32)}` as Hex);
const officer1SecondAccount = privateKeyToAccount(`0x${"b3".repeat(32)}` as Hex);
const reader = privateKeyToAccount(`0x${"c3".repeat(32)}` as Hex);

const NOW = 1_800_000_000;

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let clock = NOW;

const ethCall: EthCall = async () => "0x";

const request = (path: string, init: RequestInit = {}) =>
  app.fetch(new Request(`${BASE}${path}`, init));

const post = (path: string, body: unknown, token?: string) =>
  request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const patch = (path: string, body: unknown, token?: string) =>
  request(path, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const del = (path: string, token?: string) =>
  request(path, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

const get = (path: string, token?: string) =>
  request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function signIn(
  account: { address: string; signTypedData: (payload: any) => Promise<Hex> },
  institutionId: string
): Promise<Response> {
  const minted = await post("/challenge", { institutionId, account: account.address });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: {
      ...typedData.message,
      issuedAt: BigInt(typedData.message.issuedAt),
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  });
  return post("/session", { nonce: challenge.nonce, signature });
}

const tokenFrom = async (response: Response): Promise<string> => {
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(typeof body.token).toBe("string");
  return body.token;
};

beforeAll(async () => {
  database = await createTestWorkspaceDatabase();
  store = createWorkspaceStore(database.handle());
  await store.ensureSchema();
});

afterAll(async () => {
  resetWorkspace();
  await database.close();
});

beforeEach(async () => {
  clock = NOW;
  await database.reset();

  for (const institution of SYNTHETIC_INSTITUTIONS) {
    await store.upsertInstitution(institutionRecordOf(institution));
  }

  // Setup memberships for Sinar Amanah: admin, officer1, reader
  await store.upsertMembership({ institutionId: SINAR, account: admin.address, role: "ADMIN" });
  await store.upsertMembership({ institutionId: SINAR, account: officer1.address, role: "OFFICER" });
  await store.upsertMembership({ institutionId: SINAR, account: reader.address, role: "READER" });

  configureWorkspace({
    store,
    now: () => clock,
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 86400,
    ethCall,
  });
});

describe("Akun kerja pribadi dan profil petugas (Tiket #87)", () => {
  it("mengembalikan officer: null secara jujur jika akun belum ditautkan ke profil petugas", async () => {
    const sessionRes = await signIn(officer1, SINAR);
    const token = await tokenFrom(sessionRes);

    const res = await get("", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.account.toLowerCase()).toBe(officer1.address.toLowerCase());
    expect(body.role).toBe("OFFICER");
    expect(body.officer).toBeNull();
  });

  it("administrator dapat membuat profil petugas dan menautkan akun kerja", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));

    // Admin creates an officer profile with initial account
    const createRes = await post(
      "/officers",
      {
        displayName: "Ahmad Fauzi Amil",
        account: officer1.address,
        role: "OFFICER",
      },
      adminToken
    );
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.success).toBe(true);
    expect(createBody.officer.displayName).toBe("Ahmad Fauzi Amil");
    expect(createBody.officer.isActive).toBe(true);
    expect(typeof createBody.officer.id).toBe("string");

    // Now officer1 logs in and checks workspace
    const officerToken = await tokenFrom(await signIn(officer1, SINAR));
    const workspaceRes = await get("", officerToken);
    expect(workspaceRes.status).toBe(200);
    const workspaceBody = await workspaceRes.json();
    expect(workspaceBody.officer).not.toBeNull();
    expect(workspaceBody.officer.id).toBe(createBody.officer.id);
    expect(workspaceBody.officer.displayName).toBe("Ahmad Fauzi Amil");
    expect(workspaceBody.officer.isActive).toBe(true);
  });

  it("dua akun milik petugas yang sama tetap menunjuk identitas pelaku yang sama", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));

    // 1. Create officer profile
    const createRes = await post(
      "/officers",
      {
        displayName: "Siti Rahmah Amil",
        account: officer1.address,
        role: "OFFICER",
      },
      adminToken
    );
    const { officer } = await createRes.json();

    // 2. Link second work account to the same officer
    const linkRes = await post(
      `/officers/${officer.id}/accounts`,
      {
        account: officer1SecondAccount.address,
        role: "OFFICER",
      },
      adminToken
    );
    expect(linkRes.status).toBe(201);

    // 3. Login with account 1 -> sees officer profile
    const token1 = await tokenFrom(await signIn(officer1, SINAR));
    const ws1 = await (await get("", token1)).json();
    expect(ws1.officer.id).toBe(officer.id);
    expect(ws1.officer.displayName).toBe("Siti Rahmah Amil");

    // 4. Login with account 2 -> sees the EXACT same officer profile
    const token2 = await tokenFrom(await signIn(officer1SecondAccount, SINAR));
    const ws2 = await (await get("", token2)).json();
    expect(ws2.officer.id).toBe(officer.id);
    expect(ws2.officer.displayName).toBe("Siti Rahmah Amil");
  });

  it("menolak pembuatan atau pengubahan profil oleh akun non-admin (403 forbidden)", async () => {
    const officerToken = await tokenFrom(await signIn(officer1, SINAR));
    const readerToken = await tokenFrom(await signIn(reader, SINAR));

    const tryOfficer = await post(
      "/officers",
      { displayName: "Penyamar Petugas" },
      officerToken
    );
    expect(tryOfficer.status).toBe(403);

    const tryReader = await post(
      "/officers",
      { displayName: "Penyamar Pembaca" },
      readerToken
    );
    expect(tryReader.status).toBe(403);
  });

  it("administrator dapat memperbarui nama tampilan dan status aktif petugas", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));

    const createRes = await post(
      "/officers",
      { displayName: "Budi Santoso", account: officer1.address },
      adminToken
    );
    const { officer } = await createRes.json();

    // Update display name
    const updateRes = await patch(
      `/officers/${officer.id}`,
      { displayName: "Budi Santoso, S.E." },
      adminToken
    );
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.officer.displayName).toBe("Budi Santoso, S.E.");

    // Check from officer's view
    const officerToken = await tokenFrom(await signIn(officer1, SINAR));
    const ws = await (await get("", officerToken)).json();
    expect(ws.officer.displayName).toBe("Budi Santoso, S.E.");

    // Deactivating officer terminates sessions and sets isActive = false
    const deactivateRes = await patch(
      `/officers/${officer.id}`,
      { isActive: false },
      adminToken
    );
    expect(deactivateRes.status).toBe(200);

    // Old officer session is revoked immediately
    const revokedCheck = await get("", officerToken);
    expect(revokedCheck.status).toBe(401);
  });

  it("penolakan payload identitas palsu (alamat atau nama yang dikirim pemanggil bukan bukti)", async () => {
    const officerToken = await tokenFrom(await signIn(officer1, SINAR));

    // Caller sends bogus officer info in query params or headers
    const bogusRes = await get("?officerId=fake-id&displayName=Hacker", officerToken);
    expect(bogusRes.status).toBe(200);
    const body = await bogusRes.json();
    // Database truth wins: officer is null because none is linked
    expect(body.officer).toBeNull();
  });

  it("isolasi lembaga: administrator lembaga A tidak dapat mengelola petugas lembaga B", async () => {
    const adminTokenA = await tokenFrom(await signIn(admin, SINAR));

    // Admin Sinar Amanah tries to view or manage Baitul Maal officers
    const crossList = await get("/officers?institutionId=" + BAITUL, adminTokenA);
    // Request naming another institution is refused outright
    expect(crossList.status).toBe(403);

    const crossCreate = await post(
      "/officers",
      { institutionId: BAITUL, displayName: "Penyusup" },
      adminTokenA
    );
    expect(crossCreate.status).toBe(403);
  });

  it("penghapusan atau pelepasan akun kerja mencatat audit history dan tidak menghapus atribusi historis", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));

    const createRes = await post(
      "/officers",
      { displayName: "Dewi Lestari", account: officer1.address },
      adminToken
    );
    const { officer } = await createRes.json();

    // Unlink account
    const unlinkRes = await del(`/officers/${officer.id}/accounts/${officer1.address}`, adminToken);
    expect(unlinkRes.status).toBe(200);

    // Check authority history
    const historyRes = await get("/authority-history", adminToken);
    expect(historyRes.status).toBe(200);
    const { history } = await historyRes.json();
    const actions = history.map((h: any) => h.action);
    expect(actions).toContain("CREATE_OFFICER");
    expect(actions).toContain("LINK_ACCOUNT");
    expect(actions).toContain("UNLINK_ACCOUNT");
  });
});

it("inactive officers cannot obtain a new session, and reactivation never revives old tokens", async () => {
  const adminToken = await tokenFrom(await signIn(admin, SINAR));
  const { officer } = await (await post("/officers", { displayName: "Petugas sintetis", account: officer1.address }, adminToken)).json();
  const token = await tokenFrom(await signIn(officer1, SINAR));
  expect((await patch(`/officers/${officer.id}`, { isActive: false }, adminToken)).status).toBe(200);
  expect((await get("", token)).status).toBe(401);
  expect((await signIn(officer1, SINAR)).status).toBe(403);
  expect((await patch(`/officers/${officer.id}`, { isActive: true }, adminToken)).status).toBe(200);
  expect((await get("", token)).status).toBe(401);
  expect((await signIn(officer1, SINAR)).status).toBe(201);
});

it("linking an administrator preserves authority and cannot bypass successor acceptance", async () => {
  const token = await tokenFrom(await signIn(admin, SINAR));
  const { officer } = await (await post("/officers", { displayName: "Administrator sintetis", account: admin.address }, token)).json();
  const fresh = await tokenFrom(await signIn(admin, SINAR));
  expect((await (await get("", fresh)).json()).role).toBe("ADMIN");
  expect((await del(`/officers/${officer.id}/accounts/${admin.address}`, fresh)).status).toBe(409);
  expect((await patch(`/officers/${officer.id}`, { isActive: false }, fresh)).status).toBe(409);
  expect((await (await get("", fresh)).json()).capabilities.manageMembers).toBe(true);
});

it("an account cannot be reassigned to a different personal identity, even after unlinking", async () => {
  const token = await tokenFrom(await signIn(admin, SINAR));
  const { officer: first } = await (await post("/officers", { displayName: "Petugas A", account: officer1.address }, token)).json();
  const { officer: second } = await (await post("/officers", { displayName: "Petugas B" }, token)).json();
  const old = await tokenFrom(await signIn(officer1, SINAR));
  expect((await post(`/officers/${second.id}/accounts`, { account: officer1.address }, token)).status).toBe(409);
  expect((await (await get("", old)).json()).officer.id).toBe(first.id);
  await del(`/officers/${first.id}/accounts/${officer1.address}`, token);
  expect((await post(`/officers/${second.id}/accounts`, { account: officer1.address }, token)).status).toBe(409);
  expect((await post(`/officers/${first.id}/accounts`, { account: officer1.address }, token)).status).toBe(201);
  expect((await get("", old)).status).toBe(401);
});

it("failed profile creation leaves no profile, and retry after restart returns one durable result", async () => {
  const token = await tokenFrom(await signIn(admin, SINAR));
  expect((await post("/officers", { displayName: "Gagal", account: "invalid" }, token)).status).toBe(400);
  expect((await (await get("/officers", token)).json()).officers).toHaveLength(0);
  await store.upsertMembership({ institutionId: BAITUL, account: officer1SecondAccount.address, role: "OFFICER" });
  expect((await post("/officers", { displayName: "Konflik", account: officer1SecondAccount.address }, token)).status).toBe(409);
  expect((await (await get("/officers", token)).json()).officers).toHaveLength(0);
  const payload = { id: "off-retry-synthetic", displayName: "Petugas tahan restart", account: officer1.address };
  expect((await post("/officers", payload, token)).status).toBe(201);
  store = createWorkspaceStore(await database.reopen());
  await store.ensureSchema();
  configureWorkspace({ store, now: () => clock, challengeTtlSeconds: 300, sessionTtlSeconds: 86400, ethCall });
  expect((await post("/officers", payload, token)).status).toBe(201);
  const { officers } = await (await get("/officers", token)).json();
  expect(officers).toHaveLength(1);
  expect(officers[0].accounts[0].account).toBe(officer1.address.toLowerCase());
  expect((await post("/officers", { ...payload, displayName: "Different payload" }, token)).status).toBe(409);
});

it("history preserves profile values and the account identity after restart", async () => {
  const token = await tokenFrom(await signIn(admin, SINAR));
  const { officer } = await (await post("/officers", { displayName: "Nama awal", account: officer1.address }, token)).json();
  await patch(`/officers/${officer.id}`, { displayName: "Nama diperbaiki", isActive: false }, token);
  await del(`/officers/${officer.id}/accounts/${officer1.address}`, token);
  store = createWorkspaceStore(await database.reopen());
  configureWorkspace({ store, now: () => clock, challengeTtlSeconds: 300, sessionTtlSeconds: 86400, ethCall });
  const { history } = await (await get("/authority-history", token)).json();
  expect(history.find((entry: any) => entry.action === "LINK_ACCOUNT").details.officerId).toBe(officer.id);
  expect(history.find((entry: any) => entry.action === "UNLINK_ACCOUNT").details.officerId).toBe(officer.id);
  const change = history.find((entry: any) => entry.action === "UPDATE_OFFICER");
  expect(change.details.before).toEqual({ displayName: "Nama awal", isActive: true });
  expect(change.details.after).toEqual({ displayName: "Nama diperbaiki", isActive: false });
  expect(change.actor).toBe(admin.address.toLowerCase());
});

it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)("browser: one owner drives header, keyboard profile forms, logout and delayed account changes", async () => {
  const token = await tokenFrom(await signIn(admin, SINAR));
  await post("/officers", { displayName: "Administrator sintetis", account: admin.address }, token);
  const built = await Bun.build({ entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname], target: "browser", define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) } });
  if (!built.success) throw new Error(built.logs.join("\n"));
  const bundle = await built.outputs[0]!.text();
  let wallet = admin;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 18579, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/") return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
    if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
    if (path === "/switch-wallet") { wallet = officer1; return Response.json([wallet.address]); }
    if (path === "/wallet-rpc") {
      const { method, params } = await req.json();
      if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([wallet.address]);
      if (method === "eth_chainId") return Response.json("0x7a69");
      if (method === "eth_signTypedData_v4") return Response.json(await wallet.signTypedData(JSON.parse(params[1])));
      return Response.json(null);
    }
    return app.fetch(req);
  } });
  const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
  const browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error: Error) => console.error("Officer browser:", error.message));
    await page.goto("http://127.0.0.1:18579");
    await page.getByRole("button", { name: /^0x/ }).waitFor();
    await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
    await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
    const identity = page.getByRole("button", { name: "Detail identitas petugas dan ruang kerja lembaga" });
    await identity.waitFor({ timeout: 5000 }).catch(async (error: Error) => { console.error(await page.locator("body").innerText()); throw error; });
    expect(await identity.innerText()).toContain("Administrator sintetis");
    await identity.focus(); await page.keyboard.press("Enter");
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    expect(await page.getByRole("dialog").count()).toBe(0);
    const ownProfile = page.getByRole("article", { name: "Profil Administrator sintetis", exact: true });
    await ownProfile.getByRole("button", { name: "Ubah nama", exact: true }).click();
    await ownProfile.getByLabel("Nama petugas", { exact: true }).fill("Administrator diperbarui");
    await ownProfile.getByRole("button", { name: "Simpan nama", exact: true }).click();
    await identity.getByText("Administrator diperbarui", { exact: true }).waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: "Tambah Petugas", exact: true }).click();
    await page.getByLabel("Nama petugas", { exact: true }).fill("Petugas browser sintetis");
    await page.getByRole("button", { name: "Simpan Petugas", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Petugas browser sintetis", exact: true }).waitFor();
    await identity.click();
    await page.getByRole("button", { name: "Keluar Sesi", exact: true }).click();
    await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).waitFor();
    expect(await page.getByRole("heading", { name: "Petugas browser sintetis", exact: true }).count()).toBe(0);
    expect(await identity.count()).toBe(0);
    await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();
    await identity.waitFor();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const pending = new Promise<void>(resolve => { started = resolve; });
    await page.route("**/api/workspace/officers", async (route: any) => { const response = await route.fetch(); started(); await held; await route.fulfill({ response }); });
    await page.getByRole("button", { name: "Muat ulang petugas", exact: true }).click();
    await pending;
    await page.getByRole("button", { name: "Ganti akun sintetis" }).click();
    release();
    await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).waitFor();
    expect(await identity.count()).toBe(0);
    expect(await page.getByRole("heading", { name: "Petugas browser sintetis", exact: true }).count()).toBe(0);
  } finally { await browser.close(); await server.stop(true); }
}, 60000);


it("adds officer profiles to a populated old schema without inventing legacy identities", async () => {
  const legacy = await createTestWorkspaceDatabase();
  try {
    const schema = await Bun.file(new URL("./fixtures/workspace-before-officers.sql", import.meta.url)).text();
    for (const statement of schema.split(";").filter(part => part.trim())) await legacy.handle().execute(sql.raw(statement));
    const upgraded = createWorkspaceStore(legacy.handle());
    await upgraded.upsertInstitution(institutionRecordOf(SYNTHETIC_INSTITUTIONS.find(item => item.id === SINAR)!));
    await upgraded.upsertMembership({ institutionId: SINAR, account: admin.address, role: "ADMIN" });
    await legacy.handle().execute(sql`INSERT INTO workspace_authority_history (institution_id, actor, account, role, action, occurred_at)
      VALUES (${SINAR}, ${admin.address.toLowerCase()}, ${admin.address.toLowerCase()}, 'ADMIN', 'LEGACY', ${NOW})`);
    await upgraded.ensureSchema();
    await upgraded.ensureSchema();
    configureWorkspace({ store: upgraded, now: () => clock, challengeTtlSeconds: 300, sessionTtlSeconds: 86400, ethCall });
    const token = await tokenFrom(await signIn(admin, SINAR));
    expect((await (await get("", token)).json()).officer).toBeNull();
    const { history } = await (await get("/authority-history", token)).json();
    expect(history[0].action).toBe("LEGACY");
    expect(history[0].details).toBeNull();
    expect((await post("/officers", { displayName: "Petugas setelah migrasi", account: officer1.address }, token)).status).toBe(201);
    expect(await legacy.rowCount("donations")).toBe(1);
  } finally {
    await legacy.close();
    configureWorkspace({ store, now: () => clock, challengeTtlSeconds: 300, sessionTtlSeconds: 86400, ethCall });
  }
});
