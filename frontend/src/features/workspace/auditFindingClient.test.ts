import { describe, expect, it } from "bun:test";
import {
  createAuditFinding,
  downloadAuditAttachment,
  fetchAuditQueues,
  fetchPackageAuditFindings,
  outcomeUnknown,
  submitAmilFindingResponse,
  submitAuditorFindingFollowup,
  submitAuditorHandover,
  submitNoteCorrection,
} from "./auditFindingClient";
import { WorkspaceRequestError, type PrivateRequests } from "./privateRequests";

function recording() {
  const calls: { path: string; init?: RequestInit }[] = [];
  const requests: PrivateRequests = {
    contextId: "ctx-test-1",
    assertCurrent: () => {},
    async json<T = any>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (path.endsWith("/queues")) return { success: true, queues: { viewer: "AMIL", amilActionQueue: [], auditorReviewQueue: [] } } as T;
      if (path.endsWith("/findings") && !init?.method) return { success: true, viewer: "STATUS_ONLY", findings: [{ id: "af_1", detail: "STATUS_ONLY" }] } as T;
      return { success: true, finding: { id: "af_1" } } as T;
    },
    async blob(path: string, init?: RequestInit): Promise<Blob> {
      calls.push({ path, init });
      return new Blob(["isi"]);
    },
  };
  const body = (index: number) => JSON.parse(calls[index]!.init!.body as string);
  return { calls, requests, body };
}

describe("auditFindingClient (Issue #99)", () => {
  it("reads queues and package findings with the viewer the server decided", async () => {
    const { calls, requests } = recording();
    expect((await fetchAuditQueues(requests)).viewer).toBe("AMIL");
    const listed = await fetchPackageAuditFindings(requests, "prep 1", "pkg/1");
    expect(listed.viewer).toBe("STATUS_ONLY");
    expect(calls.map(c => c.path)).toEqual([
      "/api/evidence/audit-findings/queues",
      "/api/evidence/prep%201/reports/pkg%2F1/findings",
    ]);
  });

  it("sends the reviewed digest and operation id with a new finding", async () => {
    const { calls, requests, body } = recording();
    await createAuditFinding(requests, "prep_1", "pkg_1", {
      operationId: "op-1", packageDigest: `0x${"ab".repeat(32)}`, scope: "REALISASI", severity: "TEMUAN_MATERIAL",
      title: "Selisih", description: "Uraian",
      targets: { proposalId: "prop_1", proposalVersion: 1, realizationId: null, documentId: null, disputeId: "d_1" },
      workingPapers: [], sharedFiles: [],
    });
    expect(calls[0]).toMatchObject({ path: "/api/evidence/prep_1/reports/pkg_1/findings", init: { method: "POST" } });
    expect(body(0)).toMatchObject({ operationId: "op-1", packageDigest: `0x${"ab".repeat(32)}`, targets: { disputeId: "d_1" } });
  });

  it("carries the revision last read on every change to a finding", async () => {
    const { calls, requests, body } = recording();
    await submitAmilFindingResponse(requests, "af_1", { operationId: "a", expectedRevision: 2, note: "n", attachments: [] });
    await submitAuditorFindingFollowup(requests, "af_1", { operationId: "b", expectedRevision: 3, action: "SELESAI_DITUTUP", note: "n", workingPapers: [], sharedFiles: [] });
    await submitNoteCorrection(requests, "af_1", { operationId: "c", expectedRevision: 4, eventId: "afe_1", note: "n" });
    await submitAuditorHandover(requests, "af_1", { operationId: "d", expectedRevision: 5, assignmentRef: "SP-1", note: "n", toAuditor: null });
    expect(calls.map(c => c.path)).toEqual([
      "/api/evidence/audit-findings/af_1/responses",
      "/api/evidence/audit-findings/af_1/follow-ups",
      "/api/evidence/audit-findings/af_1/corrections",
      "/api/evidence/audit-findings/af_1/handover",
    ]);
    expect([0, 1, 2, 3].map(i => body(i).expectedRevision)).toEqual([2, 3, 4, 5]);
  });

  it("downloads an attachment as bytes", async () => {
    const { calls, requests } = recording();
    expect(await (await downloadAuditAttachment(requests, "af_1", "afa_2")).text()).toBe("isi");
    expect(calls[0]!.path).toBe("/api/evidence/audit-findings/af_1/attachments/afa_2");
  });

  it("treats only an explained refusal as not recorded", () => {
    expect(outcomeUnknown(new WorkspaceRequestError("Ditolak", null, 403))).toBe(false);
    expect(outcomeUnknown(new WorkspaceRequestError("Konflik", null, 409))).toBe(false);
    expect(outcomeUnknown(new WorkspaceRequestError("Server", null, 500))).toBe(true);
    expect(outcomeUnknown(new TypeError("Failed to fetch"))).toBe(true);
  });
});
