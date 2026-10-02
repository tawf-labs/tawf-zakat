/**
 * The institution, sign-in and recorded period the period report suites share
 * (ADR-0043, #130/#131): realizations on proposals published on the institution's
 * internal decision, over the real API.
 */

import { expect } from "bun:test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import app from "../../src/index";
import type { WorkspaceStore } from "../../src/tenancy-store";
import { institutionRecordOf, SYNTHETIC_INSTITUTIONS } from "../../src/fixtures/institutions";

export const BASE = "http://localhost:3001/api/workspace";
export const REPORTS = "http://localhost:3001/api/evidence/period-reports";
export const EVIDENCE = "http://localhost:3001/api/evidence";
export const SINAR = "lpz-sinar-amanah";
export const adminSinar = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
export const amilSinar = privateKeyToAccount(`0x${"22".repeat(32)}` as Hex);
export const readerSinar = privateKeyToAccount(`0x${"33".repeat(32)}` as Hex);
export const NOW = Math.floor(Date.now() / 1000);
export const YEAR = new Date(NOW * 1000).getUTCFullYear();

export const request = (url: string, init: RequestInit = {}) => app.fetch(new Request(url, init));
export const post = (url: string, body: unknown, token: string) =>
  request(url.startsWith("http") ? url : `${BASE}${url}`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
export const get = (url: string, token: string) =>
  request(url.startsWith("http") ? url : `${BASE}${url}`, { headers: { Authorization: `Bearer ${token}` } });

export async function signIn(account: typeof amilSinar): Promise<string> {
  const minted = await request(`${BASE}/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ institutionId: SINAR, account: account.address }),
  });
  const { challenge, typedData } = await minted.json();
  const signature = await account.signTypedData({
    ...typedData,
    message: { ...typedData.message, issuedAt: BigInt(typedData.message.issuedAt), expiresAt: BigInt(typedData.message.expiresAt) },
  });
  const session = await request(`${BASE}/session`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce: challenge.nonce, signature }),
  });
  return (await session.json()).token;
}

/** Institutions, an admin, an officer who records realizations, and a reader. */
export async function seedInstitution(store: WorkspaceStore) {
  for (const inst of SYNTHETIC_INSTITUTIONS) await store.upsertInstitution(institutionRecordOf(inst));
  await store.upsertMembership({ institutionId: SINAR, account: adminSinar.address, role: "ADMIN" });
  await store.upsertMembership({ institutionId: SINAR, account: amilSinar.address, role: "OFFICER" });
  await store.upsertMembership({ institutionId: SINAR, account: readerSinar.address, role: "READER" });
  for (const [id, displayName, account, role] of [
    ["off-admin", "Admin Sinar", adminSinar, "ADMIN"], ["off-amil", "Amil Sinar", amilSinar, "OFFICER"],
  ] as const) {
    await store.createOfficerProfile({ id, institutionId: SINAR, displayName, account: account.address, role, actor: adminSinar.address, now: NOW });
  }
  for (const [officerId, fn] of [["off-admin", "MANAGE_PROGRAMS"], ["off-amil", "PREPARE_PROPOSALS"], ["off-amil", "RECORD_REALIZATION"]] as const) {
    await store.grantMandate({ institutionId: SINAR, actor: adminSinar.address, now: NOW, mandate: {
      officerId, function: fn, scopeType: "ALL_PROGRAMS", assignmentRef: `SK/${fn}`, validFrom: NOW - 86400, validUntil: NOW + 86400 * 30,
    } });
  }
}

/** A program with one proposal published on the institution's internal decision. */
export async function publishedProposal(admin: string, amil: string, input: {
  program: string; fundType: string; lines: Array<{ id: string; beneficiaryId: string; name: string; value: Record<string, unknown> }>;
}) {
  const programId = (await (await post("/programs", {
    name: input.program, purpose: "Santunan", fundType: input.fundType, scope: "Tangerang Selatan", referenceCeiling: "100000000",
  }, admin)).json()).program.id;
  const draft = (await (await post("/proposals", {
    expectedVersion: 0, operationId: crypto.randomUUID(), programId, originOfRequest: "Data RT", purpose: input.program,
    personInCharge: "Bendahara", aidPeriod: { start: `${YEAR}-01-01`, end: `${YEAR}-12-31` },
    beneficiaries: input.lines.map((line, index) => ({
      id: line.beneficiaryId, name: line.name, asnaf: "Fakir", addressOrScope: "RT 03",
      identityBasis: { kind: "NIK", value: `367401010101${String(index + 1).padStart(4, "0")}` }, guardian: null, paymentRecipient: null,
    })),
    aidLines: input.lines.map((line) => ({ id: line.id, beneficiaryId: line.beneficiaryId, aidType: "Bantuan", period: `${YEAR}-01`, value: line.value })),
  }, amil)).json()).draft;
  await post(`/proposals/${draft.id}/documents`, {
    category: "RECIPIENT_VERIFICATION", fileName: "ba.txt", mimeType: "text/plain", beneficiaryId: null,
    contentBase64: Buffer.from("Berita acara").toString("base64"),
  }, amil);
  const published = await post(`/proposals/${draft.id}/publish`, {
    operationId: crypto.randomUUID(), expectedVersion: draft.version, decisionReference: "Rapat pengurus", decisionDate: `${YEAR}-01-02`,
  }, amil);
  expect(published.status).toBe(200);
  return (await published.json()).draft as { id: string; version: number };
}

export async function realize(draft: { id: string; version: number }, items: Record<string, unknown>[], amil: string) {
  const res = await post(`/proposals/${draft.id}/realizations`, {
    expectedVersion: draft.version, operationId: crypto.randomUUID(),
    items: items.map((item) => ({ reportedAt: NOW - 7200, ...item })),
  }, amil);
  expect(res.status).toBe(201);
}

/** One program, one cash handover of Rp1.000.000 recorded two hours ago. */
export async function recordOneHandover() {
  const admin = await signIn(adminSinar);
  const amil = await signIn(amilSinar);
  const draft = await publishedProposal(admin, amil, { program: "Jumat Berkah", fundType: "ZAKAT", lines: [
    { id: "aid-1", beneficiaryId: "ben-1", name: "Mustahik Satu", value: { kind: "MONEY", amountRequestedIdr: "1000000" } },
  ] });
  await realize(draft, [{ aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "1000000" }], amil);
  return { admin, amil, draft };
}
