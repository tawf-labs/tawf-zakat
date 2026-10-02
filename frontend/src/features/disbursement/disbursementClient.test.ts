import { describe, expect, it } from "bun:test";
import {
  deleteProposalDocument,
  downloadProposalFile,
  getInstitutionPolicy,
  getProposalVersion,
  listExaminerQueue,
  listProposalDocuments,
  listProposalHistory,
  listRevisionQueue,
  markProposalReady,
  returnProposalForRevision,
  saveInstitutionPolicy,
  startProposalExamination,
  submitProposalDraft,
  uploadProposalDocument,
  withdrawProposal,
  getProposalDecisionReview,
  createProposalDecisionChallenge,
  submitProposalDecision,
  getProposalDecision,
  signableTypedData,
} from "./disbursementClient";
import type { PrivateRequests } from "../workspace/privateRequests";

function mockRequests(
  jsonHandler: (path: string, init?: RequestInit) => Promise<any>,
  blobHandler?: (path: string, init?: RequestInit) => Promise<Blob>
): PrivateRequests {
  return {
    contextId: "test-context",
    assertCurrent: () => {},
    json: async <T>(path: string, init?: RequestInit): Promise<T> => jsonHandler(path, init),
    blob: async (path: string, init?: RequestInit): Promise<Blob> =>
      blobHandler ? blobHandler(path, init) : new Blob(["mock-data"]),
  };
}

describe("disbursementClient Ticket #91 methods", () => {
  it("manages proposal documents: list, upload, delete, download", async () => {
    let capturedPath = "";
    let capturedMethod = "";
    let capturedBody: any = null;

    const requests = mockRequests(
      async (path, init) => {
        capturedPath = path;
        capturedMethod = init?.method ?? "GET";
        if (init?.body) capturedBody = JSON.parse(init.body as string);

        if (path.includes("/documents") && capturedMethod === "GET") {
          return {
            documents: [
              {
                id: "doc-1",
                proposalId: "prop-1",
                category: "PROPOSAL_LETTER",
                fileName: "surat.pdf",
                mimeType: "application/pdf",
                sizeBytes: 1024,
                storageStatus: "STORED",
              },
            ],
          };
        }
        if (path.includes("/documents") && capturedMethod === "POST") {
          return {
            document: {
              id: "doc-new",
              proposalId: "prop-1",
              category: capturedBody.category,
              fileName: capturedBody.fileName,
              mimeType: capturedBody.mimeType,
              sizeBytes: 2048,
              storageStatus: "STORED",
            },
          };
        }
        if (capturedMethod === "DELETE") {
          return null;
        }
        return {};
      },
      async (path) => {
        capturedPath = path;
        return new Blob(["file-content"], { type: "application/pdf" });
      }
    );

    // List
    const docs = await listProposalDocuments(requests, "prop-1", 1);
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/documents?version=1");
    expect(docs.length).toBe(1);
    expect(docs[0].category).toBe("PROPOSAL_LETTER");

    // Upload
    const uploaded = await uploadProposalDocument(requests, "prop-1", {
      category: "BENEFICIARY_IDENTITY",
      beneficiaryId: "ben-1",
      fileName: "ktp.jpg",
      mimeType: "image/jpeg",
      contentBase64: "base64data",
    });
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/documents");
    expect(capturedMethod).toBe("POST");
    expect(uploaded.id).toBe("doc-new");
    expect(uploaded.category).toBe("BENEFICIARY_IDENTITY");

    // Delete
    await deleteProposalDocument(requests, "prop-1", "doc-1");
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/documents/doc-1");
    expect(capturedMethod).toBe("DELETE");

    // Download
    const blob = await downloadProposalFile(requests, "prop-1", "doc-1", 1);
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/files/doc-1?version=1");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("handles lifecycle transitions: submit, withdraw, start-examination, return, mark-ready", async () => {
    let capturedPath = "";
    let capturedBody: any = null;

    const requests = mockRequests(async (path, init) => {
      capturedPath = path;
      capturedBody = JSON.parse(init?.body as string);
      return {
        draft: {
          id: "prop-1",
          status: path.endsWith("/submit")
            ? "SUBMITTED"
            : path.endsWith("/withdraw")
            ? "WITHDRAWN"
            : path.endsWith("/start-examination")
            ? "UNDER_EXAMINATION"
            : path.endsWith("/return")
            ? "REVISION_REQUIRED"
            : "READY_FOR_DECISION",
          version: capturedBody.expectedVersion,
        },
        warnings: [],
      };
    });

    // Submit
    const sub = await submitProposalDraft(requests, "prop-1", 1, "op-1");
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/submit");
    expect(capturedBody.operationId).toBe("op-1");
    expect(sub.draft.status).toBe("SUBMITTED");

    // Withdraw
    const wd = await withdrawProposal(requests, "prop-1", 1, "op-2", "alasan batal");
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/withdraw");
    expect(capturedBody.reason).toBe("alasan batal");
    expect(wd.status).toBe("WITHDRAWN");

    // Start Exam
    const start = await startProposalExamination(requests, "prop-1", 1, "op-3");
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/start-examination");
    expect(start.status).toBe("UNDER_EXAMINATION");

    // Return
    const ret = await returnProposalForRevision(requests, "prop-1", 1, "op-4", "data kurang");
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/return");
    expect(capturedBody.reason).toBe("data kurang");
    expect(ret.status).toBe("REVISION_REQUIRED");

    // Ready
    const ready = await markProposalReady(requests, "prop-1", 1, "op-5", {
      administrativeChecksOk: true,
      eligibilityChecksOk: true,
      alternativeIdReviewed: true,
      recurringAidExceptions: ["catatan"],
      notes: "layak",
    });
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/ready");
    expect(capturedBody.checklist.administrativeChecksOk).toBe(true);
    expect(ready.status).toBe("READY_FOR_DECISION");
  });

  it("fetches examiner queue, revision queue, proposal history, version, and policy", async () => {
    let capturedPath = "";
    const requests = mockRequests(async (path, init) => {
      capturedPath = path;
      if (path.includes("/examiner")) {
        return { queue: [{ id: "prop-1", status: "SUBMITTED" }] };
      }
      if (path.includes("/revision")) {
        return { queue: [{ id: "prop-2", status: "REVISION_REQUIRED" }] };
      }
      if (path.includes("/history")) {
        return { history: [{ action: "SUBMIT", fromStatus: "DRAFT", toStatus: "SUBMITTED" }] };
      }
      if (path.includes("/versions/")) {
        return { version: { version: 1, data: {} } };
      }
      if (path.includes("/policy")) {
        return {
          policy: {
            institutionId: "sinar",
            requireProposalLetter: true,
            requireRecipientVerification: true,
            requireIdentityDoc: true,
            requireAlternativeIdProof: true,
            requireGuardianProof: true,
            warnRecurringAid: true,
            version: 1,
          },
        };
      }
      return {};
    });

    const exQ = await listExaminerQueue(requests, "prog-1");
    expect(capturedPath).toBe("/api/workspace/proposals/queue/examiner?programId=prog-1");
    expect(exQ.length).toBe(1);

    const revQ = await listRevisionQueue(requests);
    expect(capturedPath).toBe("/api/workspace/proposals/queue/revision");
    expect(revQ.length).toBe(1);

    const hist = await listProposalHistory(requests, "prop-1");
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/history");
    expect(hist.length).toBe(1);

    const ver = await getProposalVersion(requests, "prop-1", 1);
    expect(capturedPath).toBe("/api/workspace/proposals/prop-1/versions/1");
    expect(ver.version).toBe(1);

    const pol = await getInstitutionPolicy(requests);
    expect(capturedPath).toBe("/api/workspace/policy");
    expect(pol.requireProposalLetter).toBe(true);

    const savedPol = await saveInstitutionPolicy(requests, {
      expectedVersion: 1,
      warnRecurringAid: false,
    });
    expect(capturedPath).toBe("/api/workspace/policy");
    expect(savedPol.requireProposalLetter).toBe(true);
  });
});

describe("disbursementClient Ticket #93 methods", () => {
  it("converts exactly the uint256 fields of the wire typed data to bigint", () => {
    const signable = signableTypedData({
      domain: { name: "ZKT Disbursement Decision", version: "1" },
      types: {
        DisbursementDecision: [
          { name: "proposalVersion", type: "uint256" },
          { name: "decisionDate", type: "string" },
          { name: "mandateValidUntil", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
        ],
      },
      primaryType: "DisbursementDecision",
      message: { proposalVersion: 2, decisionDate: "2026-09-17", mandateValidUntil: 1800086400, expiresAt: 1800000300 },
    });
    expect(signable.message).toEqual({
      proposalVersion: 2n,
      decisionDate: "2026-09-17",
      mandateValidUntil: 1800086400n,
      expiresAt: 1800000300n,
    });
  });

  it("calls review, challenge, decide and decision read on their own paths", async () => {
    const calls: { path: string; method: string; body: any }[] = [];
    const requests = mockRequests(async (path, init) => {
      calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : null });
      return { success: true };
    });
    const intent = {
      action: "APPROVE" as const,
      decisionReference: "SK-001",
      decisionDate: "2026-09-17",
      decisionDocumentId: "doc-1",
      notes: null,
      rejectionReason: null,
      approvedAidLines: [{ id: "aid-1", amountApprovedIdr: "300000" }],
    };

    await getProposalDecisionReview(requests, "prop-1");
    await createProposalDecisionChallenge(requests, "prop-1", { ...intent, signerAccount: "0x123", expectedVersion: 1 });
    await submitProposalDecision(requests, "prop-1", {
      ...intent,
      signerAccount: "0x123",
      mandateId: "man-123",
      nonce: "0xnonce",
      signature: "0xsig",
      expectedVersion: 1,
      operationId: "op-1",
    });
    await getProposalDecision(requests, "prop-1");

    expect(calls.map(({ path, method }) => `${method} ${path}`)).toEqual([
      "GET /api/workspace/proposals/prop-1/decision-review",
      "POST /api/workspace/proposals/prop-1/decision-challenge",
      "POST /api/workspace/proposals/prop-1/decide",
      "GET /api/workspace/proposals/prop-1/decision",
    ]);
    expect(calls[1]!.body.approvedAidLines).toEqual(intent.approvedAidLines);
    expect(calls[2]!.body.operationId).toBe("op-1");
  });
});

describe("disbursementClient Ticket #94 realization methods", () => {
  it("sends the realization, evidence, confirmation and dispute requests the API routes accept", async () => {
    const client = await import("./disbursementClient");
    const calls: { path: string; method: string; body: any }[] = [];
    const requests = mockRequests(async (path, init) => {
      calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : null });
      if (path.endsWith("/realization-summary")) return { summary: { proposalId: "prop-1" }, notice: "Catatan dari server" };
      if (path.endsWith("/realizations") && !init?.method) return { realizations: [] };
      if (path.endsWith("/realization-documents")) return { documents: [] };
      if (path.endsWith("/otp-verify") || path.endsWith("/bast-verify")) return { realization: { id: "rea-1" } };
      if (path.endsWith("/disputes") && !init?.method) return { disputes: [] };
      if (path.endsWith("/incomplete-evidence")) return { queue: [] };
      return {};
    });

    await client.recordRealizations(requests, "prop-1", {
      operationId: "op-1",
      expectedVersion: 3,
      batchGroupId: "kelompok-op-1",
      items: [{ aidLineId: "aid-1", beneficiaryId: "ben-1", method: "CASH", amountIdr: "500000", reportedAt: 1720000000,
        paymentRecipient: { name: "SD Negeri 1", relation: "Sekolah" }, notes: null }],
    });
    expect((await client.getProposalRealizationSummary(requests, "prop-1")).notice).toBe("Catatan dari server");
    await client.getProposalRealizations(requests, "prop-1");
    await client.uploadRealizationDocument(requests, "prop-1", "rea-1", {
      operationId: "op-2", documentType: "RECEIPT_OR_BAST", fileName: "bast.pdf", mimeType: "application/pdf",
      contentBase64: "Zm9v", batchGroupId: "kelompok-op-1", allocations: [{ realizationId: "rea-1", amountIdr: "500000" }],
    });
    await client.listRealizationDocuments(requests, "prop-1");
    await client.issueRealizationOtp(requests, "prop-1", "rea-1", "080000000123");
    await client.verifyRealizationOtp(requests, "prop-1", "rea-1", { nonce: "otp-1", otpCode: "123456" });
    await client.verifyBastBySecondOfficer(requests, "prop-1", "rea-1", { notes: "Sesuai" });
    await client.recordRealizationDispute(requests, "prop-1", "rea-1", { operationId: "op-recordRealizationDispute", complainantType: "BENEFICIARY", subject: "AMOUNT", reason: "Kurang", disputedAmountIdr: "100000" });
    await client.examineRealizationDispute(requests, "prop-1", "rea-1", "disp-1", { operationId: "op-examineRealizationDispute", outcome: "RESOLVED", notes: "Selesai" });
    await client.listRealizationDisputes(requests, "prop-1", "rea-1");
    await client.listIncompleteEvidenceQueue(requests);

    const base = "/api/workspace/proposals";
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST ${base}/prop-1/realizations`,
      `GET ${base}/prop-1/realization-summary`,
      `GET ${base}/prop-1/realizations`,
      `POST ${base}/prop-1/realizations/rea-1/documents`,
      `GET ${base}/prop-1/realization-documents`,
      `POST ${base}/prop-1/realizations/rea-1/otp-challenge`,
      `POST ${base}/prop-1/realizations/rea-1/otp-verify`,
      `POST ${base}/prop-1/realizations/rea-1/bast-verify`,
      `POST ${base}/prop-1/realizations/rea-1/disputes`,
      `POST ${base}/prop-1/realizations/rea-1/disputes/disp-1/examinations`,
      `GET ${base}/prop-1/realizations/rea-1/disputes`,
      `GET ${base}/queue/incomplete-evidence`,
    ]);
    expect(calls[0]!.body).toMatchObject({ operationId: "op-1", expectedVersion: 3, items: [{ method: "CASH", paymentRecipient: { name: "SD Negeri 1" } }] });
    expect(calls[3]!.body).toMatchObject({ operationId: "op-2", allocations: [{ realizationId: "rea-1", amountIdr: "500000" }] });
    expect(calls[5]!.body).toEqual({ recipientContact: "080000000123" });
    expect(calls[9]!.body).toEqual({ operationId: "op-examineRealizationDispute", outcome: "RESOLVED", notes: "Selesai" });
  });

  it("sends the revision, cancellation, and remainder closure requests Ticket #96 requires", async () => {
    const client = await import("./disbursementClient");
    const calls: { path: string; method: string; body?: unknown }[] = [];
    const requests = {
      institutionId: "sinar",
      assertCurrent: () => {},
      json: async (path: string, init?: RequestInit) => {
        calls.push({
          path,
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (path.endsWith("/revisions")) return { revisions: [{ id: "rev-1", revisionNumber: 1 }] };
        if (path.includes("/revisions/rev-1/decision-challenge")) {
          return { challenge: { nonce: "n-1" }, typedData: { domain: {}, types: {}, primaryType: "T", message: {} } };
        }
        if (path.includes("/cancel-challenge")) {
          return { challenge: { nonce: "n-cancel" }, typedData: { domain: {}, types: {}, primaryType: "T", message: {} } };
        }
        if (path.includes("/close-remainder-challenge")) {
          return { challenge: { nonce: "n-close" }, typedData: { domain: {}, types: {}, primaryType: "T", message: {} }, preview: {} };
        }
        return { revision: { id: "rev-1" }, draft: { id: "prop-1", version: 2 }, decision: { id: "dec-1" }, closure: { id: "cls-1" } };
      },
    } as unknown as PrivateRequests;

    await client.listProposalRevisions(requests, "prop-1");
    await client.getProposalRevision(requests, "prop-1", "rev-1");
    await client.proposeRevision(requests, "prop-1", {
      reason: "Perubahan mustahik",
      beneficiaries: [],
      aidLines: [],
      expectedVersion: 1,
    });
    await client.withdrawRevision(requests, "prop-1", "rev-1", { reason: "Dibatalkan amil" });
    await client.startRevisionExamination(requests, "prop-1", "rev-1");
    await client.returnRevision(requests, "prop-1", "rev-1", { reason: "Perbaiki berkas" });
    await client.markRevisionReady(requests, "prop-1", "rev-1", { notes: "Siap diputus" });
    await client.createRevisionDecisionChallenge(requests, "prop-1", "rev-1", {
      signerAccount: "0x123",
      action: "APPROVE",
      decisionReference: "SK-REV-1",
      decisionDate: "2026-09-18",
      decisionDocumentId: "doc-1",
    });
    await client.submitRevisionDecision(requests, "prop-1", "rev-1", {
      nonce: "n-1",
      signature: "0xsig",
      operationId: "op-rev-decide",
    });

    await client.createCancelProposalChallenge(requests, "prop-1", {
      signerAccount: "0x123",
      decisionReference: "SK-BATAL-1",
      decisionDate: "2026-09-18",
      decisionDocumentId: "doc-cancel",
    });
    await client.cancelProposal(requests, "prop-1", {
      nonce: "n-cancel",
      signature: "0xsigcancel",
      operationId: "op-cancel",
    });

    await client.createCloseRemainderChallenge(requests, "prop-1", {
      signerAccount: "0x123",
      decisionReference: "SK-TUTUP-1",
      decisionDate: "2026-09-18",
      decisionDocumentId: "doc-close",
    });
    await client.closeProposalRemainder(requests, "prop-1", {
      nonce: "n-close",
      signature: "0xsigclose",
      operationId: "op-close",
    });
    await client.getProposalClosure(requests, "prop-1");

    const base = "/api/workspace/proposals";
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${base}/prop-1/revisions`,
      `GET ${base}/prop-1/revisions/rev-1`,
      `POST ${base}/prop-1/revisions`,
      `POST ${base}/prop-1/revisions/rev-1/withdraw`,
      `POST ${base}/prop-1/revisions/rev-1/start-examination`,
      `POST ${base}/prop-1/revisions/rev-1/return`,
      `POST ${base}/prop-1/revisions/rev-1/ready`,
      `POST ${base}/prop-1/revisions/rev-1/decision-challenge`,
      `POST ${base}/prop-1/revisions/rev-1/decide`,
      `POST ${base}/prop-1/cancel-challenge`,
      `POST ${base}/prop-1/decide`,
      `POST ${base}/prop-1/close-remainder-challenge`,
      `POST ${base}/prop-1/decide`,
      `GET ${base}/prop-1/closure`,
    ]);
    expect(calls[10]!.body).toMatchObject({ action: "CANCEL", nonce: "n-cancel" });
    expect(calls[12]!.body).toMatchObject({ action: "CLOSE_REMAINDER", nonce: "n-close" });
  });
});
