/**
 * Integration tests for Program bantuan and draf pengajuan banyak penerima
 * (Spec #86, ticket #89).
 *
 * Covers the ticket's own acceptance scenarios:
 * 1. One program, two pengajuan drafts, a hundred penerima - survives re-read.
 * 2. Alternative identity basis (no NIK) is accepted, no fictitious NIK required.
 * 3. An incomplete draft still saves, together with its issues.
 * 15. High-precision IDR and goods in different units are not summed together.
 * Plus: version conflict is refused, and institution isolation holds even
 * when a caller supplies another institution's program/draft id directly.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createDisbursementStore, type DisbursementStore } from "../src/disbursement-store";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";

const WORKSPACE = "http://localhost:3001/api/workspace";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const officer = privateKeyToAccount(`0x${"21".repeat(32)}` as Hex);
const rivalOfficer = privateKeyToAccount(`0x${"24".repeat(32)}` as Hex);
const reader = privateKeyToAccount(`0x${"27".repeat(32)}` as Hex);

const NOW = 1_800_000_000;

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let disbursement: DisbursementStore;
let clock = NOW;

const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));

const post = (url: string, body: unknown, token?: string) =>
  request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(url === `${WORKSPACE}/proposals` ? { operationId: crypto.randomUUID(), expectedVersion: 0, ...(body as object) } : body),
  });

const get = (url: string, token?: string) =>
  request(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

const del = (url: string, token?: string) =>
  request(url, { method: "DELETE", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ operationId: crypto.randomUUID(), expectedVersion: 1 }) });

async function signIn(account: typeof officer, institutionId: string): Promise<string> {
  const minted = await post(`${WORKSPACE}/challenge`, { institutionId, account: account.address });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: { ...typedData.message, issuedAt: BigInt(typedData.message.issuedAt), expiresAt: BigInt(typedData.message.expiresAt) },
  });
  const session = await post(`${WORKSPACE}/session`, { nonce: challenge.nonce, signature });
  expect(session.status).toBe(201);
  return (await session.json()).token;
}

const nik = (n: number) => String(1_000_000_000_000_000n + BigInt(n)).padStart(16, "0");

function moneyBeneficiary(i: number) {
  return {
    id: "",
    name: `Mustahik ${i}`,
    identityBasis: { kind: "NIK", value: nik(i) },
    asnaf: "Fakir",
    addressOrScope: `Desa Uji No. ${i}`,
    guardian: null,
    paymentRecipient: null,
  };
}

function moneyAidLine(beneficiaryId: string, amountIdr: string, period = "2026-Q1") {
  return {
    id: "",
    beneficiaryId,
    aidType: "Bantuan tunai",
    period,
    value: { kind: "MONEY", amountRequestedIdr: amountIdr },
  };
}

describe("Program bantuan and draf pengajuan (Ticket #89)", () => {
  beforeAll(async () => {
    database = await createTestWorkspaceDatabase();
    store = createWorkspaceStore(database.handle());
    disbursement = createDisbursementStore(database.handle() as never);
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

    for (const item of SYNTHETIC_INSTITUTIONS) {
      await store.upsertInstitution(institutionRecordOf(item));
    }
    const adminSinar = SYNTHETIC_INSTITUTIONS.find(i => i.id === SINAR)!.members.find(m => m.role === "ADMIN")!.account;
    const adminBaitul = SYNTHETIC_INSTITUTIONS.find(i => i.id === BAITUL)!.members.find(m => m.role === "ADMIN")!.account;
    await store.upsertMembership({ institutionId: SINAR, account: adminSinar, role: "ADMIN" });
    await store.upsertMembership({ institutionId: BAITUL, account: adminBaitul, role: "ADMIN" });

    await store.upsertMembership({ institutionId: SINAR, account: officer.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: BAITUL, account: rivalOfficer.address, role: "OFFICER" });
    await store.upsertMembership({ institutionId: SINAR, account: reader.address, role: "READER" });

    const off1 = await store.createOfficerProfile({
      id: "off-sinar-officer",
      institutionId: SINAR,
      displayName: "Petugas Sinar",
      account: officer.address,
      role: "OFFICER",
      actor: adminSinar,
      now: clock,
    });
    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar,
      now: clock,
      mandate: {
        officerId: off1.id,
        function: "MANAGE_PROGRAMS",
        scopeType: "ALL_PROGRAMS",
        validFrom: clock - 3600,
        validUntil: clock + 86400 * 365,
        assignmentRef: "SK-PROGRAM-01",
      },
    });
    await store.grantMandate({
      institutionId: SINAR,
      actor: adminSinar,
      now: clock,
      mandate: {
        officerId: off1.id,
        function: "PREPARE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        validFrom: clock - 3600,
        validUntil: clock + 86400 * 365,
        assignmentRef: "SK-DRAFT-01",
      },
    });

    const off2 = await store.createOfficerProfile({
      id: "off-baitul-officer",
      institutionId: BAITUL,
      displayName: "Petugas Baitul",
      account: rivalOfficer.address,
      role: "OFFICER",
      actor: adminBaitul,
      now: clock,
    });
    await store.grantMandate({
      institutionId: BAITUL,
      actor: adminBaitul,
      now: clock,
      mandate: {
        officerId: off2.id,
        function: "MANAGE_PROGRAMS",
        scopeType: "ALL_PROGRAMS",
        validFrom: clock - 3600,
        validUntil: clock + 86400 * 365,
        assignmentRef: "SK-BAITUL-01",
      },
    });
    await store.grantMandate({
      institutionId: BAITUL,
      actor: adminBaitul,
      now: clock,
      mandate: {
        officerId: off2.id,
        function: "PREPARE_PROPOSALS",
        scopeType: "ALL_PROGRAMS",
        validFrom: clock - 3600,
        validUntil: clock + 86400 * 365,
        assignmentRef: "SK-BAITUL-02",
      },
    });

    configureWorkspace({
      store,
      disbursement,
      now: () => clock,
      ethCall: async () => "0x",
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });
  });

  describe("Programs", () => {
    it("refuses without a workspace session", async () => {
      const res = await get(`${WORKSPACE}/programs`);
      expect(res.status).toBe(401);
    });

    it("refuses a reader from creating a program", async () => {
      const token = await signIn(reader, SINAR);
      const res = await post(
        `${WORKSPACE}/programs`,
        { name: "Program Ramadhan", purpose: "Bantuan sembako", fundType: "ZAKAT", scope: "2026" },
        token
      );
      expect(res.status).toBe(403);
    });

    it("creates a durable program, listable and readable, and archiving keeps it readable (Q9/AC1)", async () => {
      const token = await signIn(officer, SINAR);
      const created = await post(
        `${WORKSPACE}/programs`,
        { name: "Program Ramadhan 1447H", purpose: "Bantuan sembako bulanan", fundType: "ZAKAT", scope: "Kabupaten X, 2026", referenceCeiling: "500000000" },
        token
      );
      expect(created.status).toBe(201);
      const { program } = await created.json();
      expect(program.name).toBe("Program Ramadhan 1447H");
      expect(program.status).toBe("ACTIVE");

      const archived = await post(`${WORKSPACE}/programs/${program.id}/archive`, {}, token);
      expect(archived.status).toBe(200);
      expect((await archived.json()).program.status).toBe("ARCHIVED");

      const listed = await get(`${WORKSPACE}/programs`, token);
      const { programs } = await listed.json();
      expect(programs.find((p: any) => p.id === program.id)?.status).toBe("ARCHIVED");
    });

    it("rejects a program with an empty name and a non-integer reference ceiling", async () => {
      const token = await signIn(officer, SINAR);
      const res = await post(
        `${WORKSPACE}/programs`,
        { name: "  ", purpose: "x", fundType: "ZAKAT", scope: "2026", referenceCeiling: "12.50" },
        token
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.issues.some((i: any) => i.field === "name")).toBe(true);
      expect(body.issues.some((i: any) => i.field === "referenceCeiling")).toBe(true);
    });

    it("isolates programs by institution", async () => {
      const officerToken = await signIn(officer, SINAR);
      const rivalToken = await signIn(rivalOfficer, BAITUL);
      const created = await post(
        `${WORKSPACE}/programs`,
        { name: "Program Sinar", purpose: "p", fundType: "ZAKAT", scope: "2026" },
        officerToken
      );
      const { program } = await created.json();

      const crossRead = await get(`${WORKSPACE}/programs/${program.id}`, rivalToken);
      expect(crossRead.status).toBe(404);

      const listedByRival = await get(`${WORKSPACE}/programs`, rivalToken);
      expect((await listedByRival.json()).programs).toHaveLength(0);
    });
  });

  describe("Proposal drafts", () => {
    it("requires a valid version and retry identity, including deletes", async () => {
      const token = await signIn(officer, SINAR);
      const { draft } = await (await post(`${WORKSPACE}/proposals`, { purpose: "Original", beneficiaries: [], aidLines: [] }, token)).json();
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      for (const expectedVersion of [undefined, null, "1", -1, 1.5]) {
        const response = await request(`${WORKSPACE}/proposals`, { method: "POST", headers,
          body: JSON.stringify({ id: draft.id, operationId: crypto.randomUUID(), expectedVersion, purpose: "Overwrite", beneficiaries: [], aidLines: [] }) });
        expect(response.status).toBe(400);
      }
      expect((await post(`${WORKSPACE}/proposals`, { id: draft.id, expectedVersion: 1, operationId: "", beneficiaries: [], aidLines: [] }, token)).status).toBe(400);
      expect((await request(`${WORKSPACE}/proposals/${draft.id}`, { method: "DELETE", headers })).status).toBe(400);
      expect((await (await get(`${WORKSPACE}/proposals/${draft.id}`, token)).json()).draft.purpose).toBe("Original");
    });

    it("replays saves durably, rejects reused operation IDs with changed contents, and never resurrects deleted drafts", async () => {
      const token = await signIn(officer, SINAR);
      const input = { operationId: crypto.randomUUID(), expectedVersion: 0, purpose: "Original", beneficiaries: [], aidLines: [] };
      const first = await (await post(`${WORKSPACE}/proposals`, input, token)).json();
      const retry = await (await post(`${WORKSPACE}/proposals`, input, token)).json();
      expect(retry).toEqual(first);
      const edit = { ...input, id: first.draft.id, expectedVersion: 1, operationId: crypto.randomUUID(), purpose: "Edited" };
      const results = await Promise.all([post(`${WORKSPACE}/proposals`, edit, token), post(`${WORKSPACE}/proposals`, edit, token)]);
      expect(results.map(r => r.status)).toEqual([200, 200]);
      expect(await results[0]!.json()).toEqual(await results[1]!.json());
      expect((await post(`${WORKSPACE}/proposals`, { ...edit, purpose: "Different" }, token)).status).toBe(409);
      await database.reopen();
      store = createWorkspaceStore(database.handle());
      disbursement = createDisbursementStore(database.handle());
      configureWorkspace({ store, disbursement, now: () => clock, ethCall: async () => "0x", challengeTtlSeconds: 300, sessionTtlSeconds: 3600 });
      expect(await (await post(`${WORKSPACE}/proposals`, input, token)).json()).toEqual(first);
      expect((await (await get(`${WORKSPACE}/proposals`, token)).json()).drafts).toHaveLength(1);
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const url = `${WORKSPACE}/proposals/${first.draft.id}`;
      expect((await del(url, token)).status).toBe(409); // stale version 1
      const deletion = { method: "DELETE", headers, body: JSON.stringify({ expectedVersion: 2, operationId: crypto.randomUUID() }) };
      expect((await request(url, deletion)).status).toBe(204);
      expect((await request(url, deletion)).status).toBe(204);
      expect((await post(`${WORKSPACE}/proposals`, { ...edit, expectedVersion: 2, operationId: crypto.randomUUID() }, token)).status).toBe(409);
      expect((await get(url, token)).status).toBe(404);
    });

    it("allows only one of two concurrent edits and rejects create collisions", async () => {
      const token = await signIn(officer, SINAR);
      const input = { id: crypto.randomUUID(), purpose: "Original", beneficiaries: [], aidLines: [] };
      await post(`${WORKSPACE}/proposals`, input, token);
      expect((await post(`${WORKSPACE}/proposals`, input, token)).status).toBe(409);
      const responses = await Promise.all(["A", "B"].map(purpose => post(`${WORKSPACE}/proposals`, { ...input, expectedVersion: 1, purpose }, token)));
      expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    });

    async function createProgram(token: string) {
      const res = await post(
        `${WORKSPACE}/programs`,
        { name: "Program Uji", purpose: "Bantuan bulanan", fundType: "ZAKAT", scope: "2026", referenceCeiling: "1000000000000" },
        token
      );
      return (await res.json()).program;
    }

    it("saves an incomplete draft together with its issues, rather than refusing to save (Scenario 3)", async () => {
      const token = await signIn(officer, SINAR);
      const res = await post(
        `${WORKSPACE}/proposals`,
        {
          programId: null,
          originOfRequest: "",
          purpose: "",
          aidPeriod: null,
          personInCharge: "",
          beneficiaries: [],
          aidLines: [],
        },
        token
      );
      expect(res.status).toBe(201);
      const { draft } = await res.json();
      expect(draft.issues.length).toBeGreaterThan(0);
      expect(draft.issues.some((i: any) => i.field === "programId")).toBe(true);
      expect(draft.issues.some((i: any) => i.field === "beneficiaries")).toBe(true);
    });

    it("accepts an alternative identity basis without a fictitious NIK (Scenario 2)", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);

      const res = await post(
        `${WORKSPACE}/proposals`,
        {
          programId: program.id,
          originOfRequest: "Permohonan RT 04",
          purpose: "Bantuan anak yatim",
          aidPeriod: { start: "2026-01-01", end: "2026-03-31" },
          personInCharge: "Amil A",
          beneficiaries: [
            {
              id: "",
              name: "Anak Yatim B",
              identityBasis: { kind: "ALTERNATIVE", description: "Belum memiliki KTP; surat keterangan RT No. 12/2026" },
              asnaf: "Yatim",
              addressOrScope: "RT 04 RW 02",
              guardian: { name: "Wali C", relationship: "Paman" },
              paymentRecipient: null,
            },
          ],
          aidLines: [],
        },
        token
      );
      expect(res.status).toBe(201);
      const { draft } = await res.json();
      expect(draft.beneficiaries[0].identityBasis.kind).toBe("ALTERNATIVE");
      expect(draft.issues.some((i: any) => i.field === "identityBasis")).toBe(false);
    });

    it("keeps one program with two proposal drafts and a hundred penerima, correct after re-read/restart (Scenario 1)", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);

      const beneficiaries = Array.from({ length: 100 }, (_, i) => moneyBeneficiary(i + 1));
      const savedIds: string[] = [];

      const draftAId = crypto.randomUUID();
      const firstSave = await post(
        `${WORKSPACE}/proposals`,
        {
          id: draftAId,
          programId: program.id,
          originOfRequest: "Permohonan periode 1",
          purpose: "Penyaluran triwulan 1",
          aidPeriod: { start: "2026-01-01", end: "2026-03-31" },
          personInCharge: "Amil A",
          beneficiaries,
          aidLines: [],
        },
        token
      );
      expect(firstSave.status).toBe(201);
      const savedDraft = (await firstSave.json()).draft;
      expect(savedDraft.beneficiaries).toHaveLength(100);
      expect(new Set(savedDraft.beneficiaries.map((b: any) => b.id)).size).toBe(100);
      savedIds.push(...savedDraft.beneficiaries.map((b: any) => b.id));

      const draftBId = crypto.randomUUID();
      const secondSave = await post(
        `${WORKSPACE}/proposals`,
        {
          id: draftBId,
          programId: program.id,
          originOfRequest: "Permohonan periode 2",
          purpose: "Penyaluran triwulan 2",
          aidPeriod: { start: "2026-04-01", end: "2026-06-30" },
          personInCharge: "Amil A",
          beneficiaries: [moneyBeneficiary(101)],
          aidLines: [],
        },
        token
      );
      expect(secondSave.status).toBe(201);

      // Simulate a real database restart, not merely a re-read against the
      // same open connection - the honest version of "durability". The
      // module-level `store`/`disbursement` are reassigned too, so later
      // tests' `beforeEach` keeps writing through a live handle.
      await database.reopen();
      store = createWorkspaceStore(database.handle());
      disbursement = createDisbursementStore(database.handle() as never);
      configureWorkspace({ store, disbursement, now: () => clock, ethCall: async () => "0x", challengeTtlSeconds: 300, sessionTtlSeconds: 3600 });
      const token2 = await signIn(officer, SINAR);

      const listedDrafts = await get(`${WORKSPACE}/proposals?programId=${program.id}`, token2);
      const { drafts } = await listedDrafts.json();
      expect(drafts).toHaveLength(2);

      const reread = await get(`${WORKSPACE}/proposals/${draftAId}`, token2);
      const { draft, summary } = await reread.json();
      expect(draft.beneficiaries).toHaveLength(100);
      expect(new Set(draft.beneficiaries.map((b: any) => b.id))).toEqual(new Set(savedIds));
      expect(summary.uniqueBeneficiaryCount).toBe(100);

      const program2 = await get(`${WORKSPACE}/programs/${program.id}`, token2);
      expect((await program2.json()).program.name).toBe("Program Uji");
    });

    it("preserves IDR precision and never sums different goods units, nor invents a zero valuation (Scenario 15)", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);

      const b1 = moneyBeneficiary(1);
      const b2 = moneyBeneficiary(2);
      const b3 = moneyBeneficiary(3);
      const largeAmount = "9007199254740993"; // 2^53 + 2: unsafe as a JS number, exact as text.

      const draftId = crypto.randomUUID();
      const res = await post(
        `${WORKSPACE}/proposals`,
        {
          id: draftId,
          programId: program.id,
          originOfRequest: "o",
          purpose: "p",
          aidPeriod: { start: "2026-01-01", end: "2026-01-31" },
          personInCharge: "Amil A",
          beneficiaries: [b1, b2, b3],
          aidLines: [
            { id: "", beneficiaryId: "", aidType: "Bantuan tunai", period: "2026-01", value: { kind: "MONEY", amountRequestedIdr: largeAmount } },
            { id: "", beneficiaryId: "", aidType: "Sembako", period: "2026-01", value: { kind: "GOODS", unit: "kg beras", quantityRequested: "10", valuedAmountIdr: null } },
            { id: "", beneficiaryId: "", aidType: "Sembako", period: "2026-01", value: { kind: "GOODS", unit: "liter minyak", quantityRequested: "5", valuedAmountIdr: null } },
          ],
        },
        token
      );
      // beneficiaryId left blank above is invalid on purpose to prove the
      // request shape below is what actually gets exercised; resend it wired
      // to the real recipient ids instead of asserting on that intermediate call.
      expect(res.status).toBe(201);
      const firstDraft = (await res.json()).draft;
      const [rb1, rb2, rb3] = firstDraft.beneficiaries;

      const resend = await post(
        `${WORKSPACE}/proposals`,
        {
          id: draftId,
          expectedVersion: firstDraft.version,
          programId: program.id,
          originOfRequest: "o",
          purpose: "p",
          aidPeriod: { start: "2026-01-01", end: "2026-01-31" },
          personInCharge: "Amil A",
          beneficiaries: [rb1, rb2, rb3],
          aidLines: [
            { id: "", beneficiaryId: rb1.id, aidType: "Bantuan tunai", period: "2026-01", value: { kind: "MONEY", amountRequestedIdr: largeAmount } },
            { id: "", beneficiaryId: rb2.id, aidType: "Sembako", period: "2026-01", value: { kind: "GOODS", unit: "kg beras", quantityRequested: "10", valuedAmountIdr: null } },
            { id: "", beneficiaryId: rb3.id, aidType: "Sembako", period: "2026-01", value: { kind: "GOODS", unit: "liter minyak", quantityRequested: "5", valuedAmountIdr: null } },
          ],
        },
        token
      );
      expect(resend.status).toBe(200);
      const { draft, summary } = await resend.json();

      const moneyLine = draft.aidLines.find((l: any) => l.value.kind === "MONEY");
      expect(moneyLine.value.amountRequestedIdr).toBe(largeAmount);
      expect(summary.totalsByUnit.IDR).toBe(largeAmount);
      expect(summary.totalsByUnit["Sembako:kg beras"]).toBe("10");
      expect(summary.totalsByUnit["Sembako:liter minyak"]).toBe("5");
      // Different units never collapse into one key, and an unknown goods
      // valuation does not fabricate an IDR figure.
      expect(summary.totalsByUnit.IDR).not.toContain("15");
      expect(summary.isPartial).toBe(true);
    });

    it("rejects a stale version instead of silently overwriting a newer save (version conflict)", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);
      const draftId = crypto.randomUUID();

      const first = await post(
        `${WORKSPACE}/proposals`,
        { id: draftId, programId: program.id, originOfRequest: "o", purpose: "p1", aidPeriod: { start: "2026-01-01", end: "2026-01-31" }, personInCharge: "A", beneficiaries: [], aidLines: [] },
        token
      );
      const v1 = (await first.json()).draft.version;

      const second = await post(
        `${WORKSPACE}/proposals`,
        { id: draftId, expectedVersion: v1, programId: program.id, originOfRequest: "o", purpose: "p2", aidPeriod: { start: "2026-01-01", end: "2026-01-31" }, personInCharge: "A", beneficiaries: [], aidLines: [] },
        token
      );
      expect(second.status).toBe(200);

      // Retry using the now-stale v1 - must be refused, not silently applied
      // over the change `second` already made.
      const staleRetry = await post(
        `${WORKSPACE}/proposals`,
        { id: draftId, expectedVersion: v1, programId: program.id, originOfRequest: "o", purpose: "p3-should-not-apply", aidPeriod: { start: "2026-01-01", end: "2026-01-31" }, personInCharge: "A", beneficiaries: [], aidLines: [] },
        token
      );
      expect(staleRetry.status).toBe(409);

      const reread = await get(`${WORKSPACE}/proposals/${draftId}`, token);
      expect((await reread.json()).draft.purpose).toBe("p2");
    });

    it("isolates proposal drafts by institution, even when the id is known", async () => {
      const officerToken = await signIn(officer, SINAR);
      const rivalToken = await signIn(rivalOfficer, BAITUL);
      const program = await createProgram(officerToken);

      const created = await post(
        `${WORKSPACE}/proposals`,
        { programId: program.id, originOfRequest: "o", purpose: "p", aidPeriod: { start: "2026-01-01", end: "2026-01-31" }, personInCharge: "A", beneficiaries: [], aidLines: [] },
        officerToken
      );
      const { draft } = await created.json();

      const crossRead = await get(`${WORKSPACE}/proposals/${draft.id}`, rivalToken);
      expect(crossRead.status).toBe(404);

      const crossDelete = await del(`${WORKSPACE}/proposals/${draft.id}`, rivalToken);
      expect(crossDelete.status).toBe(404);

      // A rival institution cannot even point a new draft at this institution's program.
      const crossCreate = await post(
        `${WORKSPACE}/proposals`,
        { programId: program.id, originOfRequest: "o", purpose: "p", aidPeriod: { start: "2026-01-01", end: "2026-01-31" }, personInCharge: "A", beneficiaries: [], aidLines: [] },
        rivalToken
      );
      expect(crossCreate.status).toBe(400);
    });

    it("blocks an exact duplicate aid line for the same beneficiary/type/period/amount", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);
      const beneficiary = moneyBeneficiary(1);

      const first = await post(
        `${WORKSPACE}/proposals`,
        {
          programId: program.id,
          originOfRequest: "o",
          purpose: "p",
          aidPeriod: { start: "2026-01-01", end: "2026-01-31" },
          personInCharge: "A",
          beneficiaries: [beneficiary],
          aidLines: [],
        },
        token
      );
      const draft1 = (await first.json()).draft;
      const bid = draft1.beneficiaries[0].id;

      const withDuplicate = await post(
        `${WORKSPACE}/proposals`,
        {
          id: draft1.id,
          expectedVersion: draft1.version,
          programId: program.id,
          originOfRequest: "o",
          purpose: "p",
          aidPeriod: { start: "2026-01-01", end: "2026-01-31" },
          personInCharge: "A",
          beneficiaries: draft1.beneficiaries,
          aidLines: [moneyAidLine(bid, "500000"), moneyAidLine(bid, "500000")],
        },
        token
      );
      expect(withDuplicate.status).toBe(200);
      const { draft } = await withDuplicate.json();
      expect(draft.issues.some((i: any) => i.message.includes("duplikat"))).toBe(true);
    });

    it("deletes a draft", async () => {
      const token = await signIn(officer, SINAR);
      const program = await createProgram(token);
      const created = await post(
        `${WORKSPACE}/proposals`,
        { programId: program.id, originOfRequest: "o", purpose: "p", aidPeriod: { start: "2026-01-01", end: "2026-01-31" }, personInCharge: "A", beneficiaries: [], aidLines: [] },
        token
      );
      const { draft } = await created.json();

      const deleted = await del(`${WORKSPACE}/proposals/${draft.id}`, token);
      expect(deleted.status).toBe(204);

      const reread = await get(`${WORKSPACE}/proposals/${draft.id}`, token);
      expect(reread.status).toBe(404);
    });
  });

  // Opt-in, like the existing browser suites (officer-smoke, workspace-access-smoke):
  // needs a real Chromium and is skipped unless REGISTRY_BROWSER_MODULE is set.
  // `WorkspacePanel` already renders `DisbursementPanel`, so the same page bundle
  // `officer-smoke.tsx` builds is reused rather than adding a second entry point.
  it.skipIf(!process.env.REGISTRY_BROWSER_MODULE)(
    "browser: manual program/draf form, incomplete draft, header/context, navigation and keyboard",
    async () => {
      const built = await Bun.build({
        entrypoints: [new URL("../../frontend/test/officer-smoke.tsx", import.meta.url).pathname],
        target: "browser",
        define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: "" }) },
      });
      if (!built.success) throw new Error(built.logs.join("\n"));
      const bundle = await built.outputs[0]!.text();
      const wallet = officer;
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/") return new Response('<!doctype html><div id="root"></div><script type="module" src="/smoke.js"></script>', { headers: { "Content-Type": "text/html" } });
          if (path === "/smoke.js") return new Response(bundle, { headers: { "Content-Type": "application/javascript" } });
          if (path === "/switch-wallet") return Response.json([wallet.address]);
          if (path === "/wallet-rpc") {
            const { method, params } = await req.json();
            if (["eth_accounts", "eth_requestAccounts"].includes(method)) return Response.json([wallet.address]);
            if (method === "eth_chainId") return Response.json("0x7a69");
            if (method === "eth_signTypedData_v4") return Response.json(await wallet.signTypedData(JSON.parse(params[1])));
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
        page.on("pageerror", (error: Error) => console.error("Disbursement browser:", error.message));
        await page.goto(server.url.toString());
        page.setDefaultTimeout(10000);
        await page.getByRole("button", { name: /^0x/ }).waitFor();
        await page.getByLabel("Pengelola Zakat", { exact: true }).selectOption(SINAR);
        await page.getByRole("button", { name: "Tandatangani dan masuk", exact: true }).click();

        // Header/konteks: the institution's own name, read from the session it opened.
        await page.getByRole("heading", { name: "LPZ Sinar Amanah (sintetis)" }).waitFor({ timeout: 5000 });

        // Navigasi + form manual: create a program.
        await page.getByRole("button", { name: "Program baru", exact: true }).click();
        await page.getByLabel("Nama program", { exact: true }).fill("Program Ramadhan Sintetis");
        await page.getByLabel("Tujuan", { exact: true }).fill("Bantuan sembako bulanan");
        await page.getByLabel("Cakupan/periode", { exact: true }).fill("2026");
        await page.getByRole("button", { name: "Simpan program", exact: true }).focus();
        await page.keyboard.press("Enter"); // keyboard: submit without a mouse click

        // Navigasi: the newly created program is selected automatically, so its
        // own detail card (never the select's option text) is what proves it saved.
        await page.locator("p").filter({ hasText: /^Program Ramadhan Sintetis$/ }).waitFor({ timeout: 5000 });

        // Draf belum lengkap: start a Pengajuan, add one beneficiary without a
        // valid NIK, save anyway, and see the issue rather than a refusal.
        await page.getByRole("button", { name: "Pengajuan baru", exact: true }).click();
        await page.getByText("Belum tersimpan", { exact: true }).waitFor();
        await page.getByLabel("Asal permohonan", { exact: true }).fill("Permohonan RT 04");
        await page.getByRole("button", { name: "Tambah penerima", exact: true }).click();
        await page.getByLabel("Nama", { exact: true }).fill("Mustahik Sintetis");
        await page.getByLabel("Asnaf", { exact: true }).fill("Fakir");
        await page.getByLabel("Alamat/cakupan", { exact: true }).fill("Desa Uji");
        await page.getByRole("button", { name: "Simpan draf", exact: true }).click();
        await page.getByText(/NIK harus 16 digit/).waitFor({ timeout: 5000 });
        await page.getByText(/Draf server · versi 1/).waitFor({ timeout: 5000 });

        // Existing drafts become dirty after editing; aid references work before any save.
        await page.getByLabel("Tujuan pengajuan", { exact: true }).fill("Draf A");
        await page.getByText("Belum tersimpan · berdasarkan versi 1", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Tambah penerima", exact: true }).click();
        await page.getByLabel("Nama", { exact: true }).nth(1).fill("Penerima kedua");
        for (const index of [1, 2]) {
          await page.getByRole("button", { name: "Tambah rincian", exact: true }).click();
          await page.getByLabel(`Penerima rincian ${index}`, { exact: true }).selectOption({ label: index === 1 ? "Mustahik Sintetis" : "Penerima kedua" });
          await page.getByLabel(`Jenis bantuan ${index}`, { exact: true }).fill("Tunai");
          await page.getByLabel(`Periode rincian ${index}`, { exact: true }).fill("2026-Q1");
          await page.getByLabel(`Jumlah rupiah ${index}`, { exact: true }).fill("9007199254740993");
        }
        const save = async () => {
          const response = page.waitForResponse((r: any) => new URL(r.url()).pathname === "/api/workspace/proposals" && r.request().method() === "POST");
          await page.getByRole("button", { name: "Simpan draf", exact: true }).click();
          const result = await (await response).json();
          await page.getByText(`Draf server · versi ${result.draft.version}`, { exact: true }).waitFor();
          return result.draft;
        };
        const draftA = await save();
        expect(draftA.aidLines.map((line: any) => line.beneficiaryId)).toEqual(draftA.beneficiaries.map((b: any) => b.id));
        expect(draftA.issues.some((issue: any) => issue.field === "beneficiaryId")).toBe(false);

        // New / existing selection mounts the selected draft, never the previous editor.
        await page.getByRole("button", { name: "Pengajuan baru", exact: true }).click();
        expect(await page.getByLabel("Tujuan pengajuan", { exact: true }).inputValue()).toBe("");
        await page.getByLabel("Tujuan pengajuan", { exact: true }).fill("Draf B");
        const draftB = await save();
        expect(draftB.id).not.toBe(draftA.id);
        await page.getByRole("button", { name: /Draf A ·/ }).click();
        await page.waitForFunction(() => Array.from((globalThis as any).document.querySelectorAll("input")).some((input: any) => input.value === "Draf A"));
        expect(await page.getByLabel("Tujuan pengajuan", { exact: true }).inputValue()).toBe("Draf A");
        await page.getByLabel("Tujuan pengajuan", { exact: true }).fill("Perubahan belum disimpan");
        page.once("dialog", (dialog: any) => dialog.dismiss());
        await page.getByRole("button", { name: /Draf B ·/ }).click();
        expect(await page.getByLabel("Tujuan pengajuan", { exact: true }).inputValue()).toBe("Perubahan belum disimpan");
        page.once("dialog", (dialog: any) => dialog.accept());
        await page.getByRole("button", { name: /Draf B ·/ }).click();
        await page.waitForFunction(() => Array.from((globalThis as any).document.querySelectorAll("input")).some((input: any) => input.value === "Draf B"));

        // A program change closes the old editor; the old draft's program is unchanged.
        await page.getByRole("button", { name: "Program baru", exact: true }).click();
        await page.getByLabel("Nama program", { exact: true }).fill("Program kedua");
        await page.getByLabel("Tujuan", { exact: true }).fill("Tujuan kedua");
        await page.getByLabel("Cakupan/periode", { exact: true }).fill("2027");
        const programResponse = page.waitForResponse((r: any) => new URL(r.url()).pathname === "/api/workspace/programs" && r.request().method() === "POST");
        await page.getByRole("button", { name: "Simpan program", exact: true }).click();
        const secondProgram = (await (await programResponse).json()).program;
        await page.getByLabel("Tujuan pengajuan", { exact: true }).waitFor({ state: "detached" });
        expect((await disbursement.getProposalDraft(SINAR, draftA.id))?.programId).toBe(draftA.programId);

        // Drop the response AFTER the real backend commits. Retry must recover that operation.
        await page.getByRole("button", { name: "Pengajuan baru", exact: true }).click();
        await page.getByLabel("Tujuan pengajuan", { exact: true }).fill("Respons hilang");
        let lost = false;
        await page.route("**/api/workspace/proposals", async (route: any) => {
          if (route.request().method() !== "POST" || lost) return route.continue();
          lost = true;
          await route.fetch();
          await route.abort("failed");
        });
        await page.getByRole("button", { name: "Simpan draf", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "Hasil penyimpanan belum diketahui" }).waitFor();
        expect(await page.getByLabel("Tujuan pengajuan", { exact: true }).isDisabled()).toBe(true);
        await page.getByRole("button", { name: "Pengajuan baru", exact: true }).click();
        await page.getByText("Selesaikan pemeriksaan penyimpanan draf sebelum berpindah.", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Periksa penyimpanan", exact: true }).click();
        await page.getByText("Draf server · versi 1", { exact: true }).waitFor();
        const recovered = await disbursement.listProposalDrafts(SINAR, secondProgram.id);
        expect(recovered).toHaveLength(1);
        expect(recovered[0]?.purpose).toBe("Respons hilang");

      } finally {
        await browser?.close();
        await server.stop(true);
      }
    },
    60000
  );
});
