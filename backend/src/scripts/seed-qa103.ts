/** Local-only QA data. No funds move. Published Hardhat accounts only.
 * DATABASE_URL=... bun src/scripts/seed-qa103.ts --simulate-approval
 * Approval is deliberately simulated because #93 has no durable decision route.
 * Each run adds uniquely named data; existing contributions are never topped up.
 */
import { mnemonicToAccount } from "viem/accounts";
import postgres from "postgres";

const base = "http://localhost:3001/api/workspace";
const institutionId = "lpz-sinar-amanah";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname))
  throw new Error("QA requires an explicit local DATABASE_URL");
if (!process.argv.includes("--simulate-approval")) throw new Error("Pass --simulate-approval to acknowledge the #93 fixture limitation");
const db = postgres(databaseUrl, { max: 1 });
const run = `qa103-${Date.now()}`;
const now = Math.floor(Date.now() / 1000);
async function request(path: string, token?: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(result)}`);
  return result;
}
const post = (path: string, token: string, body: object) => request(path, token, { operationId: crypto.randomUUID(), ...body });
async function login(index: number) {
  // Public development mnemonic, not the user's browser wallet.
  const account = mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: index });
  const { challenge, typedData } = await request("/challenge", undefined, { institutionId, account: account.address });
  const signature = await account.signTypedData({ ...typedData, message: { ...typedData.message,
    nonce: challenge.nonce, issuedAt: BigInt(challenge.issuedAt), expiresAt: BigInt(challenge.expiresAt) } });
  return (await request("/session", undefined, { institutionId, account: account.address, nonce: challenge.nonce, signature })).token as string;
}
try {
  const [institution] = await db`SELECT is_synthetic FROM institutions WHERE id=${institutionId}`;
  if (!institution?.is_synthetic) throw new Error("Refusing non-synthetic institution");
  const recorder = await login(1);
  const approver = await login(0);
  const { program } = await post("/programs", recorder, {
    name: `${run} SIMULASI`, purpose: "QA alokasi tanpa dana nyata", fundType: "ZAKAT", scope: "Sintetis 2026",
  });
  const proposals: string[] = [];
  for (const suffix of ["a", "b"]) {
    const id = `${run}-proposal-${suffix}`;
    const beneficiaryId = `${id}-recipient`;
    await post("/proposals", recorder, {
      id, expectedVersion: 0, programId: program.id, originOfRequest: "SIMULASI QA #103",
      purpose: `${run} Kegiatan ${suffix.toUpperCase()}`, personInCharge: "Petugas Sintetis",
      aidPeriod: { start: "2026-09-01", end: "2026-12-31" },
      beneficiaries: [{ id: beneficiaryId, name: "Penerima Sintetis QA", asnaf: "Fakir",
        identityBasis: { kind: "NIK", value: "3201123456789012" }, addressOrScope: "Wilayah Sintetis", guardian: null, paymentRecipient: null }],
      aidLines: [{ id: `${id}-aid`, beneficiaryId, aidType: "Simulasi bantuan", period: "2026-Q4",
        value: { kind: "MONEY", amountRequestedIdr: "1000000", amountApprovedIdr: null } }],
    });
    for (const category of ["PROPOSAL_LETTER", "BENEFICIARY_IDENTITY"]) {
      await post(`/proposals/${id}/documents`, recorder, { category, fileName: "simulasi.txt", mimeType: "text/plain",
        beneficiaryId: category === "BENEFICIARY_IDENTITY" ? beneficiaryId : null,
        contentBase64: Buffer.from("SIMULASI QA #103 - bukan dokumen atau bantuan nyata").toString("base64") });
    }
    await post(`/proposals/${id}/submit`, recorder, { expectedVersion: 1 });
    await post(`/proposals/${id}/start-examination`, approver, { expectedVersion: 1 });
    await post(`/proposals/${id}/ready`, approver, { expectedVersion: 1,
      checklist: { administrativeChecksOk: true, eligibilityChecksOk: true, alternativeIdReviewed: true, notes: "SIMULASI QA #103" } });
    // Fixture boundary: this is NOT evidence that durable approval #93 works.
    await db.begin(async tx => {
      await tx`UPDATE proposal_drafts SET status='APPROVED' WHERE id=${id} AND institution_id=${institutionId} AND status='READY_FOR_DECISION'`;
      await tx`UPDATE proposal_versions SET status='APPROVED' WHERE proposal_id=${id} AND institution_id=${institutionId}`;
    });
    proposals.push(id);
  }
  const contributions: string[] = [];
  for (const [suffix, amount, donorName, purpose] of [
    ["a", "900000", "Donor Sintetis QA A", "QA bantuan umum"],
    ["b", "400000", null, "QA bantuan pendidikan"],
  ] as const) {
    const id = `${run}-contribution-${suffix}`;
    await post("/contributions", recorder, { id, sourceChannel: "OTHER", sourceReference: `${run}-${suffix}-SIMULASI`,
      currencyUnit: "IDR", amountExact: amount, fundType: "ZAKAT", purpose, receivedAt: now, donorName });
    await post(`/contributions/${id}/reconcile`, recorder, { expectedVersion: 1, proofRef: `${run}-BUKTI-SIMULASI`, notes: "Tidak ada dana nyata" });
    await post(`/contributions/${id}/endorse`, approver, { expectedVersion: 2, notes: "Pengesahan data sintetis QA, bukan penerimaan uang nyata" });
    contributions.push(id);
  }
  console.log(JSON.stringify({ run, programId: program.id, proposals, contributions, simulatedApproval: true }, null, 2));
} finally { await db.end(); }
