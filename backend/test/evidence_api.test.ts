/**
 * The evidence package, through the HTTP it is actually used over
 * (Spec #68, ticket #70).
 *
 * The reconciliation engine, the money codec, the snapshot format, the
 * commitment and the isolated PostgreSQL are all the real ones. Only two things
 * are substituted: the clock, so expiry can be tested without waiting, and the
 * `eth_call` transport, which is a network boundary rather than a rule. Nothing
 * that decides an outcome is stubbed - a test that fakes the verdict it is
 * checking proves only that the fake works.
 *
 * The claim it is here to make: a preparation, once frozen, keeps answering
 * with what it was examined against, however far the institution's working data
 * moves afterwards - across a restart, across a second preparation with
 * different numbers, across a source that later goes missing.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../src/index";
import { createTestWorkspaceDatabase, type TestWorkspaceDatabase } from "./helpers/workspace-database";
import { createWorkspaceStore, type WorkspaceStore } from "../src/tenancy-store";
import { createEvidenceStore, type EvidenceStore } from "../src/evidence-store";
import { createEncryptedFileStore, type PrivateFileStore } from "../src/evidence-files";
import { configureWorkspace, resetWorkspace } from "../src/workspace-runtime";
import type { EthCall } from "../src/account-signature";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../src/fixtures/institutions";
import { canonicalJson, verifyCommitment } from "../src/evidence-snapshot";

const WORKSPACE = "http://localhost:3001/api/workspace";
const EVIDENCE = "http://localhost:3001/api/evidence";

const SINAR = "lpz-sinar-amanah";
const BAITUL = "lpz-baitul-maal";

const officer = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
const reader = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
const rivalOfficer = privateKeyToAccount(`0x${"44".repeat(32)}` as Hex);

const NOW = 1_800_000_000;
const KEY = Buffer.alloc(32, 3);

let database: TestWorkspaceDatabase;
let store: WorkspaceStore;
let evidence: EvidenceStore;
let fileDirectory: string;
let fileStore: PrivateFileStore;
/** Swapped per test to prove a storage failure is reported as a failure. */
let files: PrivateFileStore | undefined;
let clock = NOW;

const ethCall: EthCall = async () => "0x";

const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));

const post = (url: string, body: unknown, token?: string) =>
  request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (url: string, token?: string) =>
  request(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function signIn(account: typeof officer, institutionId: string): Promise<string> {
  const minted = await post(`${WORKSPACE}/challenge`, { institutionId, account: account.address });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: {
      ...typedData.message,
      issuedAt: BigInt(typedData.message.issuedAt),
      expiresAt: BigInt(typedData.message.expiresAt),
    },
  });
  const session = await post(`${WORKSPACE}/session`, { nonce: challenge.nonce, signature });
  expect(session.status).toBe(201);
  return (await session.json()).token;
}

const manifest = (
  role: "CLAIM" | "SOURCE",
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  label: role === "CLAIM" ? "Rekap Laporan Zakat Wilayah" : "12 Laporan Kinerja Kab/Kota",
  origin: role === "CLAIM" ? "PASTE" : "UPLOAD",
  scopeUnit: "Provinsi Riau",
  scopeLevel: "PROVINSI",
  fundTypes: ["ZAKAT"],
  balanceSheet: "ON",
  currencyUnit: "IDR",
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  cutOff: "2025-02-11T00:00:00.000Z",
  format: "baris-ledger",
  mappingVersion: "1",
  transactionDetail: "PRESENT",
  ...overrides,
});

const row = (key: string, amount: string, extra: Record<string, unknown> = {}) => ({
  key,
  bucket: "ZAKAT",
  balanceSheet: "ON",
  value: { amount, unit: "IDR" },
  ...extra,
});

/** Two ledgers whose gap is exactly Rp300.000.000 on PZ-1401. */
const KNOWN_GAP = {
  label: "Rekonsiliasi akhir tahun 2024",
  period: { kind: "AKHIR_TAHUN", year: 2024 },
  currencyUnit: "IDR",
  balanceSheetScope: "ON",
  claim: {
    manifest: manifest("CLAIM"),
    rows: [
      row("PZ-1401", "1500000000", { label: "BAZNAS Kab. Kampar" }),
      row("PZ-1471", "750000000", { label: "BAZNAS Kota Pekanbaru" }),
    ],
  },
  source: {
    manifest: manifest("SOURCE"),
    rows: [
      row("PZ-1401", "1200000000", { label: "BAZNAS Kab. Kampar" }),
      row("PZ-1471", "750000000", { label: "BAZNAS Kota Pekanbaru" }),
    ],
  },
};

const prepare = (token: string, body: unknown = KNOWN_GAP) => post(EVIDENCE, body, token);

const prepared = async (token: string, body: unknown = KNOWN_GAP) => {
  const response = await prepare(token, body);
  expect(response.status).toBe(201);
  return (await response.json()).preparation;
};

beforeAll(async () => {
  database = await createTestWorkspaceDatabase();
  store = createWorkspaceStore(database.handle());
  evidence = createEvidenceStore(database.handle() as never);
  await store.ensureSchema();
  await evidence.ensureSchema();

  fileDirectory = await mkdtemp(join(tmpdir(), "tawf-evidence-api-"));
  fileStore = createEncryptedFileStore({ directory: fileDirectory, key: KEY });
});

afterAll(async () => {
  resetWorkspace();
  await database.close();
  await rm(fileDirectory, { recursive: true, force: true });
});

const configure = () =>
  configureWorkspace({
    store,
    evidence,
    ...(files ? { files } : {}),
    ethCall,
    now: () => clock,
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 3600,
  });

beforeEach(async () => {
  clock = NOW;
  files = fileStore;
  await database.reset();

  for (const institution of SYNTHETIC_INSTITUTIONS) {
    await store.upsertInstitution(institutionRecordOf(institution));
  }
  await store.upsertMembership({ institutionId: SINAR, account: officer.address, role: "OFFICER" });
  await store.upsertMembership({ institutionId: SINAR, account: reader.address, role: "READER" });
  await store.upsertMembership({ institutionId: BAITUL, account: rivalOfficer.address, role: "ADMIN" });

  configure();
});

describe("freezing a preparation", () => {
  it("reconciles the two sides and keeps the discrepancy it found", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token);

    expect(preparation.outcome).toBe("RECONCILED");
    expect(preparation.result.balanced).toBe(false);
    expect(preparation.result.netDelta).toEqual({ amount: "300000000", unit: "IDR" });

    expect(preparation.findings).toHaveLength(1);
    expect(preparation.findings[0]).toMatchObject({
      kind: "AMOUNT_MISMATCH",
      key: "PZ-1401",
      bucket: "ZAKAT",
      deltaAmount: "300000000",
      deltaUnit: "IDR",
      claimAmount: "1500000000",
      sourceAmount: "1200000000",
    });
  });

  it("keeps each source's manifest, so a later reader knows what was included", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token);

    const claim = preparation.sources.find((side: any) => side.role === "CLAIM");
    expect(claim.manifest).toMatchObject({
      origin: "PASTE",
      scopeUnit: "Provinsi Riau",
      scopeLevel: "PROVINSI",
      fundTypes: ["ZAKAT"],
      balanceSheet: "ON",
      currencyUnit: "IDR",
      cutOff: "2025-02-11T00:00:00.000Z",
      format: "baris-ledger",
      mappingVersion: "1",
      // Ownership comes from the session, never from what the payload claims.
      institutionId: SINAR,
    });
  });

  it("commits to the frozen bytes, and the commitment verifies on reopening", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token);

    const reopened = await (await get(`${EVIDENCE}/${created.id}`, token)).json();
    expect(reopened.commitmentVerified).toBe(true);

    // Re-serialized canonically by the reader, exactly as a verifier would.
    const bytes = new TextEncoder().encode(canonicalJson(reopened.preparation.snapshot));
    expect(
      verifyCommitment(bytes, reopened.preparation.commitmentSalt, reopened.preparation.commitment)
    ).toBe(true);
  });

  it("stops verifying when the stored snapshot is altered underneath it", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token);

    const rewrite = async (snapshot: unknown) =>
      database
        .handle()
        .execute(
          sql`UPDATE evidence_preparations SET canonical_snapshot = ${canonicalJson(snapshot)} WHERE id = ${created.id}`
        );
    const verifiedNow = async () =>
      (await (await get(`${EVIDENCE}/${created.id}`, token)).json()).commitmentVerified;

    // Rewritten byte-identically first, so the failure below is the edit and
    // not the round trip through the reader's own serializer.
    await rewrite(created.snapshot);
    expect(await verifiedNow()).toBe(true);

    const tampered = JSON.parse(JSON.stringify(created.snapshot));
    tampered.sides[0].rows[0].amount = "1500000001";
    await rewrite(tampered);
    expect(await verifiedNow()).toBe(false);
  });
});

describe("the snapshot does not move", () => {
  it("answers with the original figures after the active input changes", async () => {
    const token = await signIn(officer, SINAR);
    const first = await prepared(token);

    // The institution keeps working: the same two Pengelola Zakat, corrected
    // numbers, a second preparation. The first must not notice.
    const corrected = {
      ...KNOWN_GAP,
      label: "Rekonsiliasi akhir tahun 2024 (revisi)",
      source: {
        manifest: manifest("SOURCE"),
        rows: [row("PZ-1401", "1500000000"), row("PZ-1471", "750000000")],
      },
    };
    const second = await prepared(token, corrected);
    expect(second.result.balanced).toBe(true);

    const reopened = await (await get(`${EVIDENCE}/${first.id}`, token)).json();
    expect(reopened.preparation.result.netDelta).toEqual({ amount: "300000000", unit: "IDR" });
    expect(reopened.preparation.findings).toHaveLength(1);
    expect(reopened.preparation.sources.find((s: any) => s.role === "SOURCE").rows[0].amount).toBe(
      "1200000000"
    );
  });

  it("survives closing the database and opening it again", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token);

    const handle = await database.reopen();
    store = createWorkspaceStore(handle);
    evidence = createEvidenceStore(handle as never);
    configure();

    const reopened = await (await get(`${EVIDENCE}/${created.id}`, token)).json();
    expect(reopened.preparation.result.netDelta).toEqual({ amount: "300000000", unit: "IDR" });
    expect(reopened.commitmentVerified).toBe(true);
  });

  it("recomputes to the same result from the snapshot it stored", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token);

    // Feeding the stored rows straight back through the same endpoint must
    // reproduce the recorded delta; the result was computed from these bytes.
    const replayed = await prepared(token, {
      ...KNOWN_GAP,
      label: "Pemeriksaan ulang",
      claim: {
        manifest: manifest("CLAIM"),
        rows: created.sources
          .find((s: any) => s.role === "CLAIM")
          .rows.map((r: any) => ({
            key: r.key,
            bucket: r.bucket,
            balanceSheet: r.balanceSheet,
            value: { amount: r.amount, unit: r.unit },
          })),
      },
      source: {
        manifest: manifest("SOURCE"),
        rows: created.sources
          .find((s: any) => s.role === "SOURCE")
          .rows.map((r: any) => ({
            key: r.key,
            bucket: r.bucket,
            balanceSheet: r.balanceSheet,
            value: { amount: r.amount, unit: r.unit },
          })),
      },
    });

    expect(replayed.result.netDelta).toEqual(created.result.netDelta);
  });
});

describe("money keeps its exact value and its unit", () => {
  it("carries trillion-scale rupiah without losing a digit", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, {
      ...KNOWN_GAP,
      claim: { manifest: manifest("CLAIM"), rows: [row("PZ-NAS", "11622127523247")] },
      source: { manifest: manifest("SOURCE"), rows: [row("PZ-NAS", "10954107312973")] },
    });

    // The gap between LPZN 2024's Tabel 2.2 and Tabel 2.3, to the rupiah.
    expect(preparation.result.netDelta).toEqual({ amount: "668020210274", unit: "IDR" });
  });

  it("reads native USDC literally, with no guess from the size of the number", async () => {
    const token = await signIn(officer, SINAR);
    const usdcManifest = (role: "CLAIM" | "SOURCE") =>
      manifest(role, { currencyUnit: "USDC_6DP" });
    const usdcRow = (key: string, amount: string) => ({
      key,
      bucket: "ZAKAT",
      balanceSheet: "ON",
      value: { amount, unit: "USDC_6DP" },
    });

    const preparation = await prepared(token, {
      ...KNOWN_GAP,
      currencyUnit: "USDC_6DP",
      claim: {
        manifest: usdcManifest("CLAIM"),
        rows: [usdcRow("D-1", "500000"), usdcRow("D-2", "1000000"), usdcRow("D-3", "1500000")],
      },
      source: {
        manifest: usdcManifest("SOURCE"),
        rows: [usdcRow("D-1", "500000"), usdcRow("D-2", "1000000"), usdcRow("D-3", "1500000")],
      },
    });

    expect(preparation.result.balanced).toBe(true);
    expect(preparation.result.netDelta.unit).toBe("USDC_6DP");
    expect(preparation.sources[0].rows.map((r: any) => r.amount)).toEqual([
      "500000",
      "1000000",
      "1500000",
    ]);
  });

  it("refuses a preparation whose two sides are in different units", async () => {
    const token = await signIn(officer, SINAR);
    const response = await prepare(token, {
      ...KNOWN_GAP,
      source: {
        manifest: manifest("SOURCE", { currencyUnit: "USDC_6DP" }),
        rows: [
          { key: "PZ-1401", bucket: "ZAKAT", balanceSheet: "ON", value: { amount: "1200000000", unit: "USDC_6DP" } },
        ],
      },
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues.some((i: any) => i.field === "source.manifest.currencyUnit")).toBe(true);
  });
});

describe("an empty period, a missing source, and a failed source are three things", () => {
  it("reconciles a period that genuinely held no rows, and says it was read", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, {
      ...KNOWN_GAP,
      claim: { manifest: manifest("CLAIM"), rows: [] },
      source: { manifest: manifest("SOURCE"), rows: [] },
    });

    expect(preparation.outcome).toBe("RECONCILED");
    expect(preparation.result.balanced).toBe(true);
    expect(preparation.sources.every((s: any) => s.status === "READ")).toBe(true);
    expect(preparation.sources.every((s: any) => s.rowCount === 0)).toBe(true);
  });

  it("keeps a preparation whose source is missing, without producing a balanced report", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, {
      ...KNOWN_GAP,
      source: {
        manifest: manifest("SOURCE"),
        status: "MISSING",
        detail: "Laporan Kinerja kabupaten belum dikirim.",
      },
    });

    expect(preparation.outcome).toBe("INCOMPLETE");
    expect(preparation.result).toBeNull();
    expect(preparation.findings).toEqual([]);
    expect(preparation.publicSummary.netDelta).toBeNull();
    expect(
      preparation.snapshot.coverageNotes.some((note: string) =>
        note.includes("Laporan Kinerja kabupaten belum dikirim.")
      )
    ).toBe(true);
  });

  it("treats a failed read the same way, and keeps its reason as evidence", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, {
      ...KNOWN_GAP,
      source: {
        manifest: manifest("SOURCE"),
        status: "FAILED",
        detail: "Basis data mitra menolak koneksi pada 2025-02-11.",
      },
    });

    expect(preparation.outcome).toBe("INCOMPLETE");
    const side = preparation.sources.find((s: any) => s.role === "SOURCE");
    expect(side.status).toBe("FAILED");
    expect(side.detail).toBe("Basis data mitra menolak koneksi pada 2025-02-11.");
    expect(side.rowCount).toBe(0);
  });

  it("says outright that a recap cannot evidence individual payments", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, {
      ...KNOWN_GAP,
      claim: {
        manifest: manifest("CLAIM", { transactionDetail: "NOT_AVAILABLE" }),
        rows: [row("PZ-1401", "1500000000"), row("PZ-1471", "750000000")],
      },
    });

    expect(
      preparation.publicSummary.coverageNotes.some((note: string) => /rincian transaksi/i.test(note))
    ).toBe(true);
    // No synthetic transactions were manufactured to fill the gap.
    expect(preparation.sources.find((s: any) => s.role === "CLAIM").rows).toHaveLength(2);
  });
});

describe("malformed input", () => {
  it.each(["OFF", "BOTH"])("refuses examination of %s when sources cover only ON", async (balanceSheetScope) => {
    const token = await signIn(officer, SINAR);
    const response = await prepare(token, { ...KNOWN_GAP, balanceSheetScope });
    expect(response.status).toBe(400);
    expect((await response.json()).issues).toContainEqual(expect.objectContaining({ field: "claim.manifest.balanceSheet" }));
  });
  it("identifies the side and row for invalid negative amounts, even with an unread counterpart", async () => {
    const token = await signIn(officer, SINAR);
    const response = await prepare(token, {
      ...KNOWN_GAP,
      claim: { ...KNOWN_GAP.claim, rows: [row("invalid", "0", { value: { amount: -1, unit: "IDR" } })] },
      source: { manifest: manifest("SOURCE"), status: "MISSING", detail: "Belum dikirim" },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).issues).toContainEqual(expect.objectContaining({
      side: "CLAIM", rowIndex: 0, field: "value.amount",
    }));
    expect((await (await get(EVIDENCE, token)).json()).preparations).toEqual([]);
  });

  it("is refused with every row that needs fixing, and nothing is stored", async () => {
    const token = await signIn(officer, SINAR);
    const response = await prepare(token, {
      ...KNOWN_GAP,
      claim: {
        manifest: manifest("CLAIM"),
        rows: [row("", "1000"), { ...row("PZ-2", "1.500,00") }, { ...row("PZ-3", "1000"), bucket: "KURBAN" }],
      },
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues.map((i: any) => i.field)).toEqual(["key", "value.amount", "bucket"]);

    const listed = await (await get(EVIDENCE, token)).json();
    expect(listed.preparations).toEqual([]);
  });

  it("refuses a manifest with no cut-off rather than inventing one", async () => {
    const token = await signIn(officer, SINAR);
    const response = await prepare(token, {
      ...KNOWN_GAP,
      source: { manifest: manifest("SOURCE", { cutOff: "" }), rows: [row("PZ-1401", "1200000000")] },
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.issues.some((i: any) => i.field === "manifest.cutOff")).toBe(true);
  });
});

describe("who may do what", () => {
  it("lets an authorised reader open a package but not prepare one", async () => {
    const officerToken = await signIn(officer, SINAR);
    const created = await prepared(officerToken);

    const readerToken = await signIn(reader, SINAR);
    expect((await prepare(readerToken)).status).toBe(403);

    const reopened = await get(`${EVIDENCE}/${created.id}`, readerToken);
    expect(reopened.status).toBe(200);
  });

  it("refuses an unauthenticated caller entirely", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token);

    expect((await get(`${EVIDENCE}/${created.id}`)).status).toBe(401);
    expect((await get(EVIDENCE)).status).toBe(401);
    expect((await prepare("tawf_ws_tidak-pernah-diterbitkan")).status).toBe(401);
  });

  it("hides one institution's package from another, by id substitution too", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token);

    const rivalToken = await signIn(rivalOfficer, BAITUL);
    expect((await get(`${EVIDENCE}/${created.id}`, rivalToken)).status).toBe(404);

    const rivalList = await (await get(EVIDENCE, rivalToken)).json();
    expect(rivalList.preparations).toEqual([]);

    // Naming the owning institution in the query does not borrow its scope.
    const borrowed = await get(`${EVIDENCE}/${created.id}?institutionId=${SINAR}`, rivalToken);
    expect(borrowed.status).toBe(403);
  });

  it("stops resolving once the session is revoked", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token);

    await request(`${WORKSPACE}/session`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect((await get(`${EVIDENCE}/${created.id}`, token)).status).toBe(401);
  });
});

describe("restricted documents", () => {
  const withFile = (contents: string) => ({
    ...KNOWN_GAP,
    files: [
      {
        role: "SOURCE",
        fileName: "laporan-kinerja.csv",
        mimeType: "text/csv",
        contentBase64: Buffer.from(contents).toString("base64"),
      },
    ],
  });

  const SENSITIVE = "nik,nama,rekening\n3201010101010001,Sartika,1234567890\n";

  it("downloads an original document with an Arabic and emoji filename", async () => {
    const token = await signIn(officer, SINAR);
    const body = withFile(SENSITIVE);
    body.files[0]!.fileName = "bukti-زكاة-📄.csv";
    const preparation = await prepared(token, body);
    const response = await get(`${EVIDENCE}/${preparation.id}/files/${preparation.files[0].id}`, token);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain("filename*=UTF-8''");
    expect(await response.text()).toBe(SENSITIVE);
  });

  it("reports storage failures without exposing private adapter paths", async () => {
    files = {
      put: async () => { throw Object.assign(new Error(`ENOSPC: write '${fileDirectory}/private/file.bin'`), { code: "ENOSPC" }); },
      get: async () => null,
    };
    configure();
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, withFile(SENSITIVE));
    expect(preparation.files[0].storageStatus).toBe("FAILED");
    expect(preparation.files[0].failureReason).toMatch(/penuh/i);
    expect(JSON.stringify(preparation)).not.toContain(fileDirectory);
  });

  it("stores the file and hands it back to an authorised reader, byte for byte", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, withFile(SENSITIVE));

    expect(preparation.files).toHaveLength(1);
    expect(preparation.files[0].storageStatus).toBe("STORED");
    expect(preparation.files[0].contentSha256).toMatch(/^0x[0-9a-f]{64}$/);

    const download = await get(
      `${EVIDENCE}/${preparation.id}/files/${preparation.files[0].id}`,
      token
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(SENSITIVE);
  });

  it("never tells a reader where the file is kept", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, withFile(SENSITIVE));

    const serialized = JSON.stringify(preparation);
    expect(serialized).not.toContain(fileDirectory);
    expect(serialized).not.toContain("storageRef");
  });

  it("refuses the download to a public reader and to another institution", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, withFile(SENSITIVE));
    const path = `${EVIDENCE}/${preparation.id}/files/${preparation.files[0].id}`;

    // The check is on the retrieval itself, not only on the page around it.
    expect((await get(path)).status).toBe(401);

    const rivalToken = await signIn(rivalOfficer, BAITUL);
    expect((await get(path, rivalToken)).status).toBe(404);
  });

  it("reports a file that failed to store as failed, with no identifier for it", async () => {
    files = {
      put: async () => {
        throw Object.assign(new Error("disk penuh"), { code: "ENOSPC" });
      },
      get: async () => null,
    };
    configure();

    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, withFile(SENSITIVE));

    expect(preparation.files[0].storageStatus).toBe("FAILED");
    expect(preparation.files[0].failureReason).toContain("disk penuh");
    expect(preparation.files[0].contentSha256).toBeNull();
    expect(
      preparation.publicSummary.coverageNotes.some((note: string) => note.includes("tidak tersimpan"))
    ).toBe(true);
    expect(preparation.publicSummary.files).toEqual({ total: 1, stored: 0, failed: 1 });

    // The figures were still computed and kept: a failed attachment does not
    // erase the reconciliation it was offered alongside.
    expect(preparation.result.netDelta).toEqual({ amount: "300000000", unit: "IDR" });

    const download = await get(
      `${EVIDENCE}/${preparation.id}/files/${preparation.files[0].id}`,
      token
    );
    expect(download.status).toBe(409);
    expect((await download.json()).status).toBe("FAILED");
  });

  it("reports a stored file that later disappears as unavailable, changing nothing else", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, withFile(SENSITIVE));
    const path = `${EVIDENCE}/${preparation.id}/files/${preparation.files[0].id}`;

    await rm(join(fileDirectory, SINAR, preparation.id), { recursive: true, force: true });

    const download = await get(path, token);
    expect(download.status).toBe(409);
    expect((await download.json()).status).toBe("UNAVAILABLE");

    const reopened = await (await get(`${EVIDENCE}/${preparation.id}`, token)).json();
    expect(reopened.preparation.files[0].contentSha256).toBe(preparation.files[0].contentSha256);
    expect(reopened.commitmentVerified).toBe(true);
  });

  it("refuses to open a file whose ciphertext was replaced", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, withFile(SENSITIVE));

    const stored = await evidence.getFile(SINAR, preparation.id, preparation.files[0].id);
    await writeFile(stored!.storageRef!, Buffer.alloc(64, 1));

    const download = await get(
      `${EVIDENCE}/${preparation.id}/files/${preparation.files[0].id}`,
      token
    );
    expect(download.status).toBe(409);
  });

  it("refuses a different valid ciphertext in place of the committed document", async () => {
    const token = await signIn(officer, SINAR);
    const preparation = await prepared(token, withFile(SENSITIVE));
    await fileStore.put({ institutionId: SINAR, preparationId: preparation.id,
      fileId: preparation.files[0].id, bytes: new TextEncoder().encode("dokumen pengganti") });
    const download = await get(`${EVIDENCE}/${preparation.id}/files/${preparation.files[0].id}`, token);
    expect(download.status).toBe(409);
    expect((await download.json()).status).toBe("UNAVAILABLE");
  });
});

describe("the public summary", () => {
  it("keeps private manifest text and failed attachment details out of public responses", async () => {
    files = undefined;
    configure();
    const token = await signIn(officer, SINAR);
    const secret = "NIK-3201010101010001-rekening-1234567890";
    const created = await prepared(token, {
      ...KNOWN_GAP,
      label: secret,
      source: {
        manifest: manifest("SOURCE", {
          label: secret, scopeUnit: secret, scopeLevel: secret,
          format: secret, mappingVersion: secret, note: secret,
        }),
        status: "FAILED", detail: secret,
      },
      files: [{ role: "SOURCE", fileName: `${secret}.csv`, contentBase64: "YWJj" }],
    });
    const response = await get(`${EVIDENCE}/${created.id}/public`);
    expect(response.status).toBe(200);
    const { summary } = await response.json();
    expect(JSON.stringify(summary)).not.toContain(secret);
    expect(summary.outcome).toBe("INCOMPLETE");
    expect(summary.sides[1].status).toBe("FAILED");
    expect(summary.files.failed).toBe(1);
    expect(created.sources[1].detail).toBe(secret);
  });

  it("is readable with no session at all", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token);

    const response = await get(`${EVIDENCE}/${created.id}/public`);
    expect(response.status).toBe(200);

    const { summary } = await response.json();
    expect(summary.institutionId).toBe(SINAR);
    expect(summary.period).toEqual({ kind: "AKHIR_TAHUN", year: 2024 });
    expect(summary.outcome).toBe("RECONCILED");
    expect(summary.findingCounts).toEqual({ AMOUNT_MISMATCH: 1 });
    expect(summary.netDelta).toEqual({ amount: "300000000", unit: "IDR" });
  });

  it("carries no row, no label, no salt and no file location", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token, {
      ...KNOWN_GAP,
      files: [
        {
          role: "SOURCE",
          fileName: "penerima.csv",
          mimeType: "text/csv",
          contentBase64: Buffer.from("nik,nama\n3201010101010001,Sartika\n").toString("base64"),
        },
      ],
    });

    const { summary } = await (await get(`${EVIDENCE}/${created.id}/public`)).json();
    const serialized = JSON.stringify(summary);

    expect(serialized).not.toContain("BAZNAS Kab. Kampar");
    expect(serialized).not.toContain("1500000000");
    expect(serialized).not.toContain(created.commitmentSalt.slice(2));
    expect(serialized).not.toContain(fileDirectory);
    expect(summary.files).toEqual({ total: 1, stored: 1, failed: 0 });
    // Provenance survives the redaction; the rows do not.
    expect(summary.sides[0].cutOff).toBe("2025-02-11T00:00:00.000Z");
    expect(summary.sides[0].rowCount).toBe(2);
  });

  it("answers 404 for a package that does not exist, without saying whose it would be", async () => {
    const response = await get(`${EVIDENCE}/prep-tidak-ada/public`);
    expect(response.status).toBe(404);
  });
});

describe("storing a preparation is all-or-nothing", () => {
  it("leaves nothing behind when a write inside the transaction fails", async () => {
    const token = await signIn(officer, SINAR);
    const created = await prepared(token);
    const before = (await (await get(EVIDENCE, token)).json()).preparations.length;

    // Two files sharing one primary key: the second insert fails partway
    // through, after the preparation row has already been written.
    const duplicate = {
      id: "file-bentrok",
      role: "CLAIM" as const,
      fileName: "a.csv",
      mimeType: "text/csv",
      sizeBytes: 1,
      contentSha256: `0x${"ab".repeat(32)}`,
      storageStatus: "STORED" as const,
      storageRef: "/tmp/a",
      failureReason: null,
    };

    const attempt = evidence.savePreparation({
      id: "prep-gagal",
      institutionId: SINAR,
      preparedBy: officer.address.toLowerCase(),
      label: "Persiapan yang gagal disimpan",
      periodKind: "AKHIR_TAHUN",
      periodYear: 2024,
      currencyUnit: "IDR",
      outcome: "RECONCILED",
      commitment: `0x${"cd".repeat(32)}`,
      commitmentScheme: "HMAC-SHA256",
      commitmentSalt: `0x${"ef".repeat(32)}`,
      canonicalSnapshot: "{}",
      resultJson: null,
      publicSummary: { preparationId: "prep-gagal" } as never,
      createdAt: NOW,
      sides: [],
      findings: [],
      files: [duplicate, duplicate],
    });

    expect(attempt).rejects.toThrow();
    await attempt.catch(() => undefined);

    const after = await (await get(EVIDENCE, token)).json();
    expect(after.preparations).toHaveLength(before);
    expect(after.preparations.map((p: any) => p.id)).toEqual([created.id]);
    expect(await evidence.getPreparation(SINAR, "prep-gagal")).toBeNull();
  });
});

describe("the workspace lists what it holds", () => {
  it("shows this institution's preparations and their finding counts", async () => {
    const token = await signIn(officer, SINAR);
    await prepared(token);

    const workspace = await (await get(WORKSPACE, token)).json();
    expect(workspace.evidencePackages).toHaveLength(1);
    expect(workspace.evidencePackages[0]).toMatchObject({
      label: "Rekonsiliasi akhir tahun 2024",
      outcome: "RECONCILED",
      findingCount: 1,
      currencyUnit: "IDR",
    });

    const rivalToken = await signIn(rivalOfficer, BAITUL);
    expect((await (await get(WORKSPACE, rivalToken)).json()).evidencePackages).toEqual([]);
  });
});
