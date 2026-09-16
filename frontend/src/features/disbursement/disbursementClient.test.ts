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
