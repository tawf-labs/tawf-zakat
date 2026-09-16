import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore, type DisbursementStore } from "../src/disbursement-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { type EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const BASE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const admin = privateKeyToAccount(`0x${"a1".repeat(32)}` as Hex);
const adminBaitul = privateKeyToAccount(`0x${"a2".repeat(32)}` as Hex);
const officer1 = privateKeyToAccount(`0x${"b2".repeat(32)}` as Hex);
const officer1SecondAccount = privateKeyToAccount(`0x${"b3".repeat(32)}` as Hex);
const officer2Approver = privateKeyToAccount(`0x${"b4".repeat(32)}` as Hex);
const reader = privateKeyToAccount(`0x${"c3".repeat(32)}` as Hex);
const endorsementAccount1 = privateKeyToAccount(`0x${"d4".repeat(32)}` as Hex);

const NOW = 1_800_000_000;

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
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

const del = (path: string, token?: string, body?: unknown) =>
  request(path, {
    method: "DELETE",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
  disbursement = createDisbursementStore(database.handle());
  await store.ensureSchema();
  await disbursement.ensureSchema();
});

afterAll(async () => {
  resetWorkspace();
  await database.close();
});

beforeEach(async () => {
  clock = NOW;
  await database.reset();

  configureWorkspace({
    store,
    disbursement,
    ethCall,
    now: () => clock,
    sessionTtlSeconds: 3600,
    challengeTtlSeconds: 300,
  });

  for (const institution of SYNTHETIC_INSTITUTIONS) {
    await store.upsertInstitution(institutionRecordOf(institution));
  }

  await store.upsertMembership({ institutionId: SINAR, account: admin.address, role: "ADMIN" });
  await store.upsertMembership({ institutionId: SINAR, account: officer1.address, role: "OFFICER" });
  await store.upsertMembership({ institutionId: SINAR, account: officer1SecondAccount.address, role: "OFFICER" });
  await store.upsertMembership({ institutionId: SINAR, account: officer2Approver.address, role: "OFFICER" });
  await store.upsertMembership({ institutionId: SINAR, account: reader.address, role: "READER" });
  await store.upsertMembership({ institutionId: BAITUL, account: adminBaitul.address, role: "ADMIN" });

  // Setup officer 1 (creator)
  await store.createOfficerProfile({
    id: "officer-creator-1",
    institutionId: SINAR,
    displayName: "Ahmad Creator",
    account: officer1.address,
    role: "OFFICER",
    actor: admin.address,
    now: NOW,
  });
  // Link second account to officer 1
  await store.linkOfficerAccount({
    officerId: "officer-creator-1",
    institutionId: SINAR,
    account: officer1SecondAccount.address,
    role: "OFFICER",
    actor: admin.address,
    now: NOW,
  });

  // Setup officer 2 (approver)
  await store.createOfficerProfile({
    id: "officer-approver-2",
    institutionId: SINAR,
    displayName: "Siti Approver",
    account: officer2Approver.address,
    role: "OFFICER",
    actor: admin.address,
    now: NOW,
  });
});

describe("Operational Mandates and Endorsement Accounts (Ticket #90)", () => {
  it("allows admin to grant, list, update, and revoke operational mandates with audit history", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));

    // Admin grants MANAGE_PROGRAMS to officer 1
    const grantRes = await post(
      "/mandates",
      {
        officerId: "officer-creator-1",
        operationalFunction: "MANAGE_PROGRAMS",
        scopeType: "ALL_PROGRAMS",
        validFrom: NOW - 100,
        validUntil: NOW + 100_000,
        assignmentRef: "SK/2026/PROG/001",
      },
      adminToken
    );
    expect(grantRes.status).toBe(201);
    const { mandate } = await grantRes.json();
    expect(mandate.function).toBe("MANAGE_PROGRAMS");
    expect(mandate.assignmentRef).toBe("SK/2026/PROG/001");
    expect(mandate.isActive).toBe(true);

    // List mandates as admin
    const listRes = await get("/mandates", adminToken);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(listBody.mandates.length).toBe(1);
    expect(listBody.mandates[0].id).toBe(mandate.id);

    // Admin updates mandate (e.g. change assignmentRef and nominalLimit)
    const patchRes = await patch(
      `/mandates/${mandate.id}`,
      {
        assignmentRef: "SK/2026/PROG/001-REV1",
        nominalLimit: "100000000",
      },
      adminToken
    );
    expect(patchRes.status).toBe(200);
    const patchedMandate = (await patchRes.json()).mandate;
    expect(patchedMandate.assignmentRef).toBe("SK/2026/PROG/001-REV1");
    expect(patchedMandate.nominalLimit).toBe("100000000");

    // Admin revokes mandate
    const deleteRes = await del(`/mandates/${mandate.id}`, adminToken);
    expect(deleteRes.status).toBe(200);

    // Verify activeOnly list is empty
    const activeList = await get("/mandates?activeOnly=true", adminToken);
    expect((await activeList.json()).mandates.length).toBe(0);

    // Audit history records GRANT, UPDATE, REVOKE
    const historyRes = await get("/authority-history", adminToken);
    const history = (await historyRes.json()).history;
    const mandateActions = history.filter((h: any) => h.action.endsWith("_MANDATE"));
    expect(mandateActions.length).toBe(3);
    expect(mandateActions.map((h: any) => h.action)).toEqual([
      "GRANT_MANDATE",
      "UPDATE_MANDATE",
      "REVOKE_MANDATE",
    ]);
  });

  it("restricts mandate listing and management for non-admins", async () => {
    const officerToken = await tokenFrom(await signIn(officer1, SINAR));
    const readerToken = await tokenFrom(await signIn(reader, SINAR));
    const adminToken = await tokenFrom(await signIn(admin, SINAR));

    // Grant a mandate to officer 1
    await post(
      "/mandates",
      {
        officerId: "officer-creator-1",
        operationalFunction: "PREPARE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK/2026/PREP/001",
      },
      adminToken
    );

    // Officer cannot grant mandates
    const officerGrant = await post(
      "/mandates",
      {
        officerId: "officer-approver-2",
        operationalFunction: "APPROVE_DECISIONS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK/ILLEGAL",
      },
      officerToken
    );
    expect(officerGrant.status).toBe(403);

    // Reader cannot access mandates endpoint
    const readerList = await get("/mandates", readerToken);
    expect(readerList.status).toBe(403);

    // Officer can list their own mandates
    const officerList = await get("/mandates", officerToken);
    expect(officerList.status).toBe(200);
    const officerMandates = (await officerList.json()).mandates;
    expect(officerMandates.length).toBe(1);
    expect(officerMandates[0].officerId).toBe("officer-creator-1");

    // Officer cannot list other officer's mandates
    const officerSpy = await get("/mandates?officerId=officer-approver-2", officerToken);
    expect(officerSpy.status).toBe(403);
  });

  it("manages institutional endorsement accounts and authorization filtering", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));
    const officer1Token = await tokenFrom(await signIn(officer1, SINAR));
    const officer2Token = await tokenFrom(await signIn(officer2Approver, SINAR));

    // Admin registers an endorsement account authorized only for officer-approver-2
    const regRes = await post(
      "/endorsement-accounts",
      {
        accountAddress: endorsementAccount1.address,
        label: "Rekening Pengesahan Direksi",
        authorizedOfficerIds: ["officer-approver-2"],
      },
      adminToken
    );
    expect(regRes.status).toBe(201);
    const { endorsementAccount } = await regRes.json();
    expect(endorsementAccount.accountAddress.toLowerCase()).toBe(endorsementAccount1.address.toLowerCase());
    expect(endorsementAccount.authorizedOfficerIds).toEqual(["officer-approver-2"]);

    // Officer 1 (creator) should NOT see this endorsement account in active accounts
    const off1AccountsRes = await get("/endorsement-accounts", officer1Token);
    expect(off1AccountsRes.status).toBe(200);
    expect((await off1AccountsRes.json()).endorsementAccounts.length).toBe(0);

    // Officer 2 (approver) SHOULD see this endorsement account
    const off2AccountsRes = await get("/endorsement-accounts", officer2Token);
    expect(off2AccountsRes.status).toBe(200);
    const off2Accounts = (await off2AccountsRes.json()).endorsementAccounts;
    expect(off2Accounts.length).toBe(1);
    expect(off2Accounts[0].accountAddress.toLowerCase()).toBe(endorsementAccount1.address.toLowerCase());

    // Update endorsement account to allow all officers (empty array)
    const updateRes = await patch(
      `/endorsement-accounts/${endorsementAccount.id}`,
      {
        authorizedOfficerIds: [],
      },
      adminToken
    );
    expect(updateRes.status).toBe(200);

    // Now Officer 1 can see it
    const off1AccountsUpdated = await get("/endorsement-accounts", officer1Token);
    expect((await off1AccountsUpdated.json()).endorsementAccounts.length).toBe(1);

    // Revoke endorsement account
    const delRes = await del(`/endorsement-accounts/${endorsementAccount.id}`, adminToken);
    expect(delRes.status).toBe(200);

    // Officer 2 should no longer see it
    const off2AccountsAfterRevoke = await get("/endorsement-accounts", officer2Token);
    expect((await off2AccountsAfterRevoke.json()).endorsementAccounts.length).toBe(0);
  });

  it("Scenario 11: rejects an administrator without operational mandate from executing operational actions", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));

    // Admin has manageMembers and manageDisbursement role capabilities,
    // but lacks an officer profile and MANAGE_PROGRAMS operational mandate.
    const progRes = await post(
      "/programs",
      {
        name: "Program Tanpa Mandat",
        purpose: "Mencoba membuat program tanpa mandat",
        fundType: "ZAKAT",
        scope: "Nasional",
      },
      adminToken
    );
    expect(progRes.status).toBe(403);
    const progBody = await progRes.json();
    expect(progBody.error).toContain("mandat");

    // Admin also cannot create a proposal draft without PREPARE_PROPOSALS mandate
    const propRes = await post(
      "/proposals",
      {
        expectedVersion: 0,
        operationId: "admin-illegal-prop-1",
        purpose: "Proposal tanpa mandat",
        originOfRequest: "Kantor Pusat",
        personInCharge: "Admin",
        beneficiaries: [],
        aidLines: [],
      },
      adminToken
    );
    expect(propRes.status).toBe(403);
  });

  it("enforces scope and nominal limits on proposal preparation", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));
    const officerToken = await tokenFrom(await signIn(officer1, SINAR));

    // First, give officer1 MANAGE_PROGRAMS mandate to create two programs
    await post(
      "/mandates",
      {
        officerId: "officer-creator-1",
        operationalFunction: "MANAGE_PROGRAMS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK/PROG/001",
      },
      adminToken
    );

    const prog1Res = await post(
      "/programs",
      {
        name: "Program Beasiswa Pendidikan",
        purpose: "Bantuan biaya sekolah",
        fundType: "ZAKAT",
        scope: "Jakarta",
      },
      officerToken
    );
    expect(prog1Res.status).toBe(201);
    const prog1 = (await prog1Res.json()).program;

    const prog2Res = await post(
      "/programs",
      {
        name: "Program Kesehatan Mustahik",
        purpose: "Pengobatan gratis",
        fundType: "ZAKAT",
        scope: "Bandung",
      },
      officerToken
    );
    expect(prog2Res.status).toBe(201);
    const prog2 = (await prog2Res.json()).program;

    // Grant officer1 PREPARE_PROPOSALS scoped ONLY to prog1 with nominal limit 50,000,000 IDR
    await post(
      "/mandates",
      {
        officerId: "officer-creator-1",
        operationalFunction: "PREPARE_PROPOSALS",
        scopeType: "SPECIFIC_PROGRAM",
        programId: prog1.id,
        nominalLimit: "50000000",
        assignmentRef: "SK/PREP/BEASISWA",
      },
      adminToken
    );

    // Test 1: Trying to create proposal under prog2 (out of scope) -> rejected
    const outOfScopeRes = await post(
      "/proposals",
      {
        expectedVersion: 0,
        operationId: "prop-scope-fail-1",
        programId: prog2.id,
        purpose: "Pengajuan untuk prog2",
        originOfRequest: "Cabang Bandung",
        personInCharge: "Ahmad",
        beneficiaries: [],
        aidLines: [],
      },
      officerToken
    );
    expect(outOfScopeRes.status).toBe(403);
    const outOfScopeBody = await outOfScopeRes.json();
    expect(outOfScopeBody.error).toContain("program spesifik");

    // Test 2: Proposal under prog1 exceeding nominal limit (60,000,000 > 50,000,000) -> rejected
    const overLimitRes = await post(
      "/proposals",
      {
        expectedVersion: 0,
        operationId: "prop-limit-fail-1",
        programId: prog1.id,
        purpose: "Pengajuan beasiswa melebihi batas",
        originOfRequest: "Cabang Jakarta",
        personInCharge: "Ahmad",
        beneficiaries: [
          {
            id: "b-1",
            name: "Siti Penerima",
            identityBasis: { kind: "NIK", value: "3171010101010001" },
            asnaf: "FAKIR",
            addressOrScope: "Jakarta",
          },
        ],
        aidLines: [
          {
            id: "a-1",
            beneficiaryId: "b-1",
            aidType: "SPP",
            period: "2026-09",
            value: {
              kind: "MONEY",
              amountRequestedIdr: "60000000",
            },
          },
        ],
      },
      officerToken
    );
    expect(overLimitRes.status).toBe(403);
    const overLimitBody = await overLimitRes.json();
    expect(overLimitBody.error).toContain("batas nominal");

    // Test 3: Proposal within scope and under limit (30,000,000 <= 50,000,000) -> success
    const validPropRes = await post(
      "/proposals",
      {
        expectedVersion: 0,
        operationId: "prop-valid-1",
        programId: prog1.id,
        purpose: "Pengajuan beasiswa sah",
        originOfRequest: "Cabang Jakarta",
        personInCharge: "Ahmad",
        beneficiaries: [
          {
            id: "b-1",
            name: "Siti Penerima",
            identityBasis: { kind: "NIK", value: "3171010101010001" },
            asnaf: "FAKIR",
            addressOrScope: "Jakarta",
          },
        ],
        aidLines: [
          {
            id: "a-1",
            beneficiaryId: "b-1",
            aidType: "SPP",
            period: "2026-09",
            value: {
              kind: "MONEY",
              amountRequestedIdr: "30000000",
            },
          },
        ],
      },
      officerToken
    );
    expect(validPropRes.status).toBe(201);
  });

  it("Scenario 10 & US-33: prevents proposal creator from approving their own proposal even using multi-account", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));
    const creatorAccount1Token = await tokenFrom(await signIn(officer1, SINAR));
    const creatorAccount2Token = await tokenFrom(await signIn(officer1SecondAccount, SINAR));
    const approverToken = await tokenFrom(await signIn(officer2Approver, SINAR));

    // Grant officer1 PREPARE_PROPOSALS
    await post(
      "/mandates",
      {
        officerId: "officer-creator-1",
        operationalFunction: "PREPARE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK/PREP/ALL",
      },
      adminToken
    );

    // Grant BOTH officer1 and officer2 APPROVE_DECISIONS
    await post(
      "/mandates",
      {
        officerId: "officer-creator-1",
        operationalFunction: "APPROVE_DECISIONS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK/APP/ALL-CREATOR",
      },
      adminToken
    );
    await post(
      "/mandates",
      {
        officerId: "officer-approver-2",
        operationalFunction: "APPROVE_DECISIONS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK/APP/ALL-APPROVER",
      },
      adminToken
    );

    // Officer1 creates proposal with account 1
    const propRes = await post(
      "/proposals",
      {
        expectedVersion: 0,
        operationId: "prop-self-approve-test-1",
        purpose: "Pengajuan tes pemisahan pengesahan",
        originOfRequest: "Pusat",
        personInCharge: "Ahmad",
        beneficiaries: [],
        aidLines: [],
      },
      creatorAccount1Token
    );
    expect(propRes.status).toBe(201);
    const draftId = (await propRes.json()).draft.id;

    // Test 1: Creator tries to verify/approve using account 1 -> rejected
    const selfApprove1 = await post(`/proposals/${draftId}/verify-approval`, {}, creatorAccount1Token);
    expect(selfApprove1.status).toBe(403);
    const body1 = await selfApprove1.json();
    expect(body1.error).toContain("Penyusun pengajuan tidak boleh mengesahkan");

    // Test 2: Creator tries to verify/approve using secondary account 2 (same officerId) -> rejected!
    const selfApprove2 = await post(`/proposals/${draftId}/verify-approval`, {}, creatorAccount2Token);
    expect(selfApprove2.status).toBe(403);
    const body2 = await selfApprove2.json();
    expect(body2.error).toContain("Penyusun pengajuan tidak boleh mengesahkan");

    // Test 3: Separate officer (officer2Approver) verifies/approves -> success!
    const validApproval = await post(`/proposals/${draftId}/verify-approval`, {}, approverToken);
    expect(validApproval.status).toBe(200);
    const body3 = await validApproval.json();
    expect(body3.allowed).toBe(true);
    expect(body3.mandate.function).toBe("APPROVE_DECISIONS");
  });

  it("enforces temporal validity on mandates (validFrom and validUntil)", async () => {
    const adminToken = await tokenFrom(await signIn(admin, SINAR));
    const officerToken = await tokenFrom(await signIn(officer1, SINAR));

    // Mandate valid only in the future: NOW + 1,000 to NOW + 2,000
    const futureMandateRes = await post(
      "/mandates",
      {
        officerId: "officer-creator-1",
        operationalFunction: "MANAGE_PROGRAMS",
        scopeType: "ALL_PROGRAMS",
        validFrom: NOW + 1_000,
        validUntil: NOW + 2_000,
        assignmentRef: "SK/FUTURE/001",
      },
      adminToken
    );
    expect(futureMandateRes.status).toBe(201);

    // Attempting at NOW -> rejected (not yet valid)
    const futureAttempt = await post(
      "/programs",
      {
        name: "Program Masa Depan",
        purpose: "Tes masa berlaku",
        fundType: "ZAKAT",
        scope: "Jakarta",
      },
      officerToken
    );
    expect(futureAttempt.status).toBe(403);

    // Advance clock into validity window
    clock = NOW + 1_500;
    const currentAttempt = await post(
      "/programs",
      {
        name: "Program Sekarang",
        purpose: "Tes masa berlaku valid",
        fundType: "ZAKAT",
        scope: "Jakarta",
      },
      officerToken
    );
    expect(currentAttempt.status).toBe(201);

    // Advance clock past validity window
    clock = NOW + 2_001;
    const expiredAttempt = await post(
      "/programs",
      {
        name: "Program Kedaluwarsa",
        purpose: "Tes masa berlaku expired",
        fundType: "ZAKAT",
        scope: "Jakarta",
      },
      officerToken
    );
    expect(expiredAttempt.status).toBe(403);
  });

  it("enforces institution isolation for operational mandates and endorsement accounts", async () => {
    const adminSinarToken = await tokenFrom(await signIn(admin, SINAR));
    const adminBaitulToken = await tokenFrom(await signIn(adminBaitul, BAITUL));

    // Sinar grants a mandate
    const sinarGrant = await post(
      "/mandates",
      {
        officerId: "officer-creator-1",
        operationalFunction: "MANAGE_PROGRAMS",
        scopeType: "ALL_PROGRAMS",
        assignmentRef: "SK/SINAR/001",
      },
      adminSinarToken
    );
    const sinarMandateId = (await sinarGrant.json()).mandate.id;

    // Baitul admin cannot view or modify Sinar's mandate
    const baitulView = await get(`/mandates?officerId=officer-creator-1`, adminBaitulToken);
    expect(baitulView.status).toBe(200);
    expect((await baitulView.json()).mandates.length).toBe(0);

    const baitulPatch = await patch(
      `/mandates/${sinarMandateId}`,
      { assignmentRef: "SK/HACKED" },
      adminBaitulToken
    );
    expect(baitulPatch.status).toBe(404);

    const baitulDel = await del(`/mandates/${sinarMandateId}`, adminBaitulToken);
    expect(baitulDel.status).toBe(404);
  });

  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: mandate management, endorsement accounts, officer mandate display and signer selection",
    async () => {
      const built = await Bun.build({
        entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
        target: "browser",
        define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
      });
      if (!built.success) throw new Error(built.logs.join("\n"));
      const bundle = await built.outputs[0]!.text();
      let currentWallet = admin;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/") return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
          if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
          if (path === "/switch-wallet") return Response.json([currentWallet.address]);
          if (path === "/wallet-rpc") {
            const { method, params } = await req.json();
            if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([currentWallet.address]);
            if (method === "eth_chainId") return Response.json("0x7a69");
            if (method === "eth_signTypedData_v4") return Response.json(await currentWallet.signTypedData(JSON.parse(params[1])));
            return Response.json(null);
          }
          return app.fetch(req);
        },
      });
      const { chromium } = await import(process.env.REGISTRY_BROWSER_MODULE!);
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        browser = await chromium.launch({ executablePath: process.env.REGISTRY_BROWSER_EXECUTABLE, headless: true, args: ["--no-sandbox"] });
        const page = await browser.newPage();
        page.on("pageerror", (error: Error) => console.error("Mandate browser:", error.message));
        await page.goto(server.url.toString());
        page.setDefaultTimeout(10000);
        await page.getByRole("button", { name: /^0x/ }).waitFor();
        await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();

        // 1. Logged in as Admin: check headings
        await page.getByRole("heading", { name: "LPZ Sinar Amanah (sintetis)" }).waitFor({ timeout: 5000 });

        // Check Mandate Management Section
        await page.getByRole("region", { name: "Manajemen Mandat Operasional" }).waitFor();

        // Grant a mandate to officer 1
        await page.getByRole("button", { name: "Terbitkan Mandat", exact: true }).click();
        await page.getByLabel("Nomor SK / Surat Tugas *", { exact: true }).fill("SK/BROWSER/TEST/001");
        await page.getByLabel("Batas Nominal Rupiah (Opsional)", { exact: true }).fill("75000000");
        await page.getByRole("button", { name: "Terbitkan Mandat Sekarang", exact: true }).click();
        await page.getByText("Mandat operasional berhasil diterbitkan.", { exact: true }).waitFor();

        // Check Endorsement Account Section
        await page.getByRole("region", { name: "Manajemen Akun Pengesahan Lembaga" }).waitFor();
        await page.getByRole("button", { name: "Daftarkan Akun", exact: true }).click();
        await page.getByLabel("Alamat Akun Ethereum (Wallet Lembaga) *", { exact: true }).fill(endorsementAccount1.address);
        await page.getByLabel("Label / Deskripsi Rekening Pengesahan *", { exact: true }).fill("Rekening Pengesahan Smoke Test");
        await page.getByRole("button", { name: "Daftarkan Akun Pengesahan", exact: true }).click();
        await page.getByText("Akun pengesahan lembaga berhasil didaftarkan.", { exact: true }).waitFor();

        // 2. Sign out as admin and switch to officer1
        await page.getByRole("button", { name: "Keluar", exact: true }).click();
        currentWallet = officer1;
        await page.getByRole("button", { name: "Ganti akun sintetis", exact: true }).click();
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();

        // Verify Officer Mandates Card shows the newly granted mandate
        await page.getByText("Mandat Operasional Petugas").waitFor();
        await page.getByText("SK: SK/BROWSER/TEST/001").waitFor();
        await page.getByText("Rp 75.000.000").waitFor();

        // Verify Endorsement Signer Selector displays both contexts
        await page.getByText("1. Akun Operator (Pribadi)").waitFor();
        await page.getByText("2. Akun Pengesahan Lembaga").waitFor();

        // Select the registered endorsement account
        await page.getByRole("button", { name: "Pilih Penanda Tangan", exact: true }).click();
        await page.getByText("Rekening Pengesahan Smoke Test").click();

        // Endorsement signer context is now selected
        await page.getByText("Terpilih").waitFor();
        // Verify operator account did not change
        expect(await page.locator(`text=${officer1.address}`).count()).toBeGreaterThanOrEqual(1);

      } finally {
        await browser?.close();
        await server.stop(true);
      }
    }
  );
});

