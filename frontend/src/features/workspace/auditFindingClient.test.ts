import { describe, expect, it } from "bun:test";
import {
  createAuditFinding,
  downloadAuditAttachment,
  fetchAuditFindingDetail,
  fetchAuditQueues,
  fetchPackageAuditFindings,
  submitAmilFindingResponse,
  submitAuditorFindingFollowup,
} from "./auditFindingClient";
import type { PrivateRequests } from "./privateRequests";
import type { AuditFinding, AuditFindingQueues } from "../../../../shared/audit-findings";

function mockRequests(calls: { path: string; init?: RequestInit }[]): PrivateRequests {
  return {
    contextId: "ctx-test-1",
    assertCurrent: () => {},
    async json<T = any>(path: string, init?: RequestInit): Promise<T> {
      calls.push({ path, init });
      if (path === "/api/evidence/audit-findings/queues") {
        return {
          success: true,
          queues: {
            amilActionQueue: [],
            auditorReviewQueue: [],
          } as AuditFindingQueues,
        } as T;
      }
      if (path.includes("/findings") || path.includes("/responses") || path.includes("/follow-ups") || path.startsWith("/api/evidence/audit-findings/")) {
        const dummyFinding: AuditFinding = {
          id: "af_123",
          institutionId: "lpz-sinar",
          preparationId: "prep_1",
          packageId: "pkg_1",
          packageDigest: "0x1111",
          reportId: "REP-2026",
          version: "1",
          auditorAccount: "0xa1",
          auditorOfficerId: "off_1",
          auditorName: "Auditor Test",
          mandateRef: "SK-AUDIT",
          scope: "SUMBER_DATA",
          severity: "TEMUAN_MATERIAL",
          title: "Temuan Uji",
          description: "Deskripsi temuan uji",
          targetProposalId: null,
          targetProposalVersion: null,
          targetRealizationId: null,
          targetDocumentId: null,
          status: "OPEN",
          createdAt: 1800000000,
          updatedAt: 1800000000,
          events: [],
        };
        if (path.includes("/findings") && init?.method !== "POST") {
          return { success: true, findings: [dummyFinding] } as T;
        }
        return { success: true, finding: dummyFinding } as T;
      }
      return { success: true } as T;
    },
    async blob(path: string, init?: RequestInit): Promise<Blob> {
      calls.push({ path, init });
      return new Blob(["konten kertas kerja"]);
    },
  };
}

describe("Audit Finding Client (Issue #99, Spec #86 & #100)", () => {
  it("fetches audit queues with exact API endpoint", async () => {
    const calls: any[] = [];
    const requests = mockRequests(calls);
    const queues = await fetchAuditQueues(requests);

    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe("/api/evidence/audit-findings/queues");
    expect(queues.amilActionQueue).toEqual([]);
    expect(queues.auditorReviewQueue).toEqual([]);
  });

  it("fetches findings bound to a specific package", async () => {
    const calls: any[] = [];
    const requests = mockRequests(calls);
    const findings = await fetchPackageAuditFindings(requests, "prep_1", "pkg_1");

    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe("/api/evidence/prep_1/reports/pkg_1/findings");
    expect(findings.length).toBe(1);
    expect(findings[0].id).toBe("af_123");
  });

  it("creates finding with scope, severity, and targets", async () => {
    const calls: any[] = [];
    const requests = mockRequests(calls);
    const finding = await createAuditFinding(requests, "prep_1", "pkg_1", {
      scope: "REALISASI",
      severity: "TEMUAN_MATERIAL",
      title: "Selisih Penyaluran",
      description: "Terdapat perbedaan bukti transfer",
      targetProposalId: "prop_99",
    });

    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe("/api/evidence/prep_1/reports/pkg_1/findings");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(calls[0].init?.body as string).title).toBe("Selisih Penyaluran");
    expect(finding.id).toBe("af_123");
  });

  it("submits amil explanation and attachments", async () => {
    const calls: any[] = [];
    const requests = mockRequests(calls);
    const finding = await submitAmilFindingResponse(requests, "af_123", {
      note: "Sudah dikonfirmasi dengan bank",
      attachments: [{ fileName: "bukti.txt", mimeType: "text/plain", contentBase64: "YnVrdGk=" }],
    });

    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe("/api/evidence/audit-findings/af_123/responses");
    expect(calls[0].init?.method).toBe("POST");
    expect(finding.id).toBe("af_123");
  });

  it("submits auditor follow-up and closure", async () => {
    const calls: any[] = [];
    const requests = mockRequests(calls);
    const finding = await submitAuditorFindingFollowup(requests, "af_123", {
      action: "SELESAI_DITUTUP",
      note: "Klarifikasi bank diterima dan diverifikasi cocok",
    });

    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe("/api/evidence/audit-findings/af_123/follow-ups");
    expect(calls[0].init?.method).toBe("POST");
    expect(finding.id).toBe("af_123");
  });

  it("downloads private audit attachment via binary blob path", async () => {
    const calls: any[] = [];
    const requests = mockRequests(calls);
    const blob = await downloadAuditAttachment(requests, "af_123", "att_456");

    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe("/api/evidence/audit-findings/af_123/attachments/att_456");
    expect(await blob.text()).toBe("konten kertas kerja");
  });
});
