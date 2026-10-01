/** Local-only QA data. No funds move. Published Hardhat accounts only.
 * DATABASE_URL=... bun src/scripts/seed-qa103.ts
 * Uses #93's signed durable decision; only the data and accounts are synthetic.
 * Each run adds uniquely named data; existing contributions are never topped up.
 */
import { mnemonicToAccount } from "viem/accounts";
import postgres from "postgres";

const base = "http://localhost:3001/api/workspace";
const institutionId = "lpz-sinar-amanah";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname))
  throw new Error("QA requires an explicit local DATABASE_URL");
if (process.argv.includes("--simulate-approval")) throw new Error("SQL approval simulation has been removed; omit --simulate-approval");
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
// Public development mnemonic, not the user's browser wallet.
const testAccount = (index: number) => mnemonicToAccount("test test test test test test test test test test test junk", { addressIndex: index });
async function login(index: number) {
  const account = testAccount(index);
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
  // The decision signer must be distinct from both preparer and examiner.
  const signerIndex = 1000 + Number(run.slice("qa103-".length)) % 1_000_000_000;
  const signer = testAccount(signerIndex);
  const officerId = `${run}-decision`;
  await post("/officers", approver, { id: officerId, displayName: "Pengesah Sintetis QA103", account: signer.address, role: "OFFICER" });
  await post("/mandates", approver, { officerId, function: "APPROVE_DECISIONS", scopeType: "SPECIFIC_PROGRAM",
    programId: program.id, validFrom: now - 60, validUntil: now + 86400,
    assignmentRef: `${run}-SK-PENGESAH-SINTETIS`, nominalLimit: "1000000" });
  const decisionToken = await login(signerIndex);
  const proposals: string[] = [];
  const decisions: string[] = [];
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
    for (const category of ["PROPOSAL_LETTER", "RECIPIENT_VERIFICATION", "BENEFICIARY_IDENTITY"]) {
      await post(`/proposals/${id}/documents`, recorder, { category, fileName: "simulasi.txt", mimeType: "text/plain",
        beneficiaryId: category === "BENEFICIARY_IDENTITY" ? beneficiaryId : null,
        contentBase64: Buffer.from("SIMULASI QA #103 - bukan dokumen atau bantuan nyata").toString("base64") });
    }
    await post(`/proposals/${id}/submit`, recorder, { expectedVersion: 1 });
    await post(`/proposals/${id}/start-examination`, approver, { expectedVersion: 1 });
    await post(`/proposals/${id}/ready`, approver, { expectedVersion: 1,
      checklist: { administrativeChecksOk: true, eligibilityChecksOk: true, alternativeIdReviewed: true,
        recurringAidExceptions: [], notes: "SIMULASI QA #103" } });
    const { document } = await post(`/proposals/${id}/decision-documents`, decisionToken, {
      expectedVersion: 1, fileName: "sk-qa103.txt", mimeType: "text/plain",
      contentBase64: Buffer.from(`SK sintetis ${run}; bukan penyaluran nyata`).toString("base64"),
    });
    const intent = { expectedVersion: 1, action: "APPROVE", decisionReference: `SK-${id}`,
      decisionDate: new Date().toISOString().slice(0, 10), decisionDocumentId: document.id,
      approvedAidLines: [{ id: `${id}-aid`, amountApprovedIdr: "1000000" }] };
    const { challenge, typedData } = await post(`/proposals/${id}/decision-challenge`, decisionToken, intent);
    const uints = new Set(typedData.types[typedData.primaryType].filter((field: { type: string }) => field.type === "uint256")
      .map((field: { name: string }) => field.name));
    const signature = await signer.signTypedData({ ...typedData, message: Object.fromEntries(
      Object.entries(typedData.message).map(([name, value]) => [name, uints.has(name) ? BigInt(value as string) : value])
    ) });
    await post(`/proposals/${id}/decide`, decisionToken, { ...intent, signerAccount: challenge.signerAccount,
      mandateId: challenge.mandateId, nonce: challenge.nonce, signature });
    const { draft } = await request(`/proposals/${id}`, recorder);
    if (draft.status !== "APPROVED") throw new Error(`Decision not persisted for ${id}`);
    decisions.push(intent.decisionReference);
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
  console.log(JSON.stringify({ run, programId: program.id, proposals, contributions, decisions, simulatedApproval: false }, null, 2));
} finally { await db.end(); }
